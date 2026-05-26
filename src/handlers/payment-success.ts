import { issueLicense, markEmailSent, LicenseRecord } from "../license-core";
import { sendWelcomeEmail, ResendSendInput, ResendResponse } from "../email/resend";

export interface PaymentSuccessInput {
  paymentProvider: "stripe" | "paypal";
  paymentId: string;
  customer: string;
  email: string;
  amount: number;           // cents
  promoCode?: string;
  affiliate?: string | null;
  discountAmount?: number;  // cents
}

// Promo codes that automatically grant lifetime-updates entitlement.
// FOUNDING50 is the live Founding 50 cohort coupon. Add future codes here
// only if their redeemers should also inherit the "lifetime updates" benefit.
const LIFETIME_PROMO_CODES = new Set(["FOUNDING50"]);

export function deriveFlagsFromPromo(
  promoCode: string | undefined
): { lifetimeUpdates: boolean; cohort: string } {
  if (promoCode && LIFETIME_PROMO_CODES.has(promoCode.toUpperCase())) {
    return { lifetimeUpdates: true, cohort: "founding-50" };
  }
  return { lifetimeUpdates: false, cohort: "" };
}

export interface PaymentSuccessResult {
  license: LicenseRecord;
  alreadyIssued: boolean;
  emailResult: { ok: boolean; error?: string };
}

type SendEmailFn = (apiKey: string, input: ResendSendInput) => Promise<ResendResponse>;

export interface PaymentSuccessOptions {
  sendEmail?: SendEmailFn;
}

export async function handlePaymentSuccess(
  env: {
    LICENSES: KVNamespace;
    RESEND_API_KEY?: string;
    ASSETS: Fetcher;
  },
  input: PaymentSuccessInput,
  options: PaymentSuccessOptions = {}
): Promise<PaymentSuccessResult> {
  const sendEmail = options.sendEmail ?? sendWelcomeEmail;
  const idemKey = `payment:${input.paymentProvider}:${input.paymentId}`;
  const existingKey = await env.LICENSES.get(idemKey);

  let license: LicenseRecord;
  let alreadyIssued = false;

  if (existingKey) {
    alreadyIssued = true;
    const raw = await env.LICENSES.get(existingKey);
    if (!raw) {
      // Edge case: idempotency record exists but license is gone (deleted manually?). Re-issue.
      const flags = deriveFlagsFromPromo(input.promoCode);
      license = await issueLicense(env.LICENSES, {
        customer: input.customer,
        email: input.email,
        lifetimeUpdates: flags.lifetimeUpdates,
        cohort: flags.cohort,
        metadata: {
          paymentProvider: input.paymentProvider,
          paymentId: input.paymentId,
          amount: input.amount,
          promoCode: input.promoCode,
          affiliate: input.affiliate ?? undefined,
          discountAmount: input.discountAmount,
        },
      });
      await env.LICENSES.put(idemKey, license.key);
    } else {
      license = JSON.parse(raw) as LicenseRecord;
    }
  } else {
    const flags = deriveFlagsFromPromo(input.promoCode);
    license = await issueLicense(env.LICENSES, {
      customer: input.customer,
      email: input.email,
      lifetimeUpdates: flags.lifetimeUpdates,
      cohort: flags.cohort,
      metadata: {
        paymentProvider: input.paymentProvider,
        paymentId: input.paymentId,
        amount: input.amount,
        promoCode: input.promoCode,
        affiliate: input.affiliate ?? undefined,
        discountAmount: input.discountAmount,
      },
    });
    await env.LICENSES.put(idemKey, license.key);
  }

  // Send email only if not already sent
  let emailResult: { ok: boolean; error?: string } = { ok: true };
  if (!license.metadata?.welcomeEmailSentAt) {
    if (env.RESEND_API_KEY) {
      const pdfB64 = await loadPdfBase64(env.ASSETS);
      const send = await sendEmail(env.RESEND_API_KEY, {
        to: license.email,
        customerName: license.customer,
        licenseKey: license.key,
        pdfUrl: "https://shop-os-license-server.glenn-15d.workers.dev/welcome.pdf",
        attachmentBase64: pdfB64,
        attachmentFilename: "shop-os-welcome.pdf",
      });
      if (send.error) {
        emailResult = { ok: false, error: send.error.message };
      } else {
        await markEmailSent(env.LICENSES, license.key);
        emailResult = { ok: true };
      }
    } else {
      emailResult = { ok: false, error: "RESEND_API_KEY not configured." };
    }
  }

  return { license, alreadyIssued, emailResult };
}

// Cache the encoded PDF at module scope. The welcome PDF is a static asset
// bundled with the Worker; it never changes within a deployment. Re-fetching
// and re-encoding ~256 KB on every webhook is pure waste — Workers isolates
// reuse module state across requests, so one fetch per isolate cold-start
// is sufficient.
let cachedPdfB64: string | null = null;

async function loadPdfBase64(assets: Fetcher): Promise<string> {
  if (cachedPdfB64) return cachedPdfB64;
  const resp = await assets.fetch(new Request("https://placeholder/shop-os-welcome.pdf"));
  const buf = await resp.arrayBuffer();
  cachedPdfB64 = arrayBufferToBase64(buf);
  return cachedPdfB64;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
