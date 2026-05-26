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
      const [welcomeB64, firstWeekB64] = await Promise.all([
        loadAssetBase64(env.ASSETS, "shop-os-welcome.pdf"),
        loadAssetBase64(env.ASSETS, "shop-os-first-week-guide.pdf"),
      ]);
      const send = await sendEmail(env.RESEND_API_KEY, {
        to: license.email,
        customerName: license.customer,
        licenseKey: license.key,
        pdfUrl: "https://shop-os-license-server.glenn-15d.workers.dev/welcome.pdf",
        attachments: [
          { filename: "shop-os-welcome.pdf", content: welcomeB64 },
          { filename: "shop-os-first-week-guide.pdf", content: firstWeekB64 },
        ],
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

// Cache encoded asset bytes at module scope. The bundled PDFs never change
// within a deployment; re-fetching and re-encoding hundreds of KB on every
// webhook is pure waste. Workers isolates reuse module state across requests,
// so one fetch+encode per filename per cold-start is sufficient.
const assetB64Cache = new Map<string, string>();

async function loadAssetBase64(assets: Fetcher, filename: string): Promise<string> {
  const cached = assetB64Cache.get(filename);
  if (cached) return cached;
  const resp = await assets.fetch(new Request(`https://placeholder/${filename}`));
  const buf = await resp.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  assetB64Cache.set(filename, b64);
  return b64;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
