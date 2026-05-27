import puppeteer from "@cloudflare/puppeteer";
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
        generateCustomWelcomePdf(env, license.key),
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

export async function renderWelcomePdfBytes(env: any, licenseKey: string): Promise<Uint8Array> {
  const resp = await env.ASSETS.fetch(new Request("https://placeholder/shop-os-welcome-template.html"));
  let html = await resp.text();
  html = html.replace("SHOP-XXXX-YYYY-ZZZZ", licenseKey);

  // Puppeteer/Chrome PDF doesn't honor CSS `@page` margins or `@page` margin-box
  // footers the way headless Chrome's CLI does. Override @page margin to zero and
  // move content offset to body padding so the parchment body background fills the
  // entire page edge-to-edge. The footer is recreated via puppeteer's footerTemplate.
  //
  // Page layout rules:
  //   - Page 1: cover, intro paragraph, and §01 (license key) — cover does NOT force a break
  //   - Page 2: starts with §02 (Claude Pro subscription) — forced page break before it
  //   - Subsequent sections flow naturally
  const puppeteerOverride = `
    <style>
      @page {
        margin: 1.5in 0 1.5in 0 !important;
        background: #f4efe3 !important;
      }
      html, body {
        background-color: #f4efe3 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      body {
        padding-left: 0.75in !important;
        padding-right: 0.75in !important;
      }
      .cover {
        page-break-after: auto !important;
        break-after: auto !important;
        margin-bottom: 32pt !important;
      }
      h2[data-anchor="§ 02"] {
        page-break-before: always !important;
        break-before: page !important;
        margin-top: 0 !important;
        border-top: none !important;
        padding-top: 0 !important;
      }
      .signature {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    </style>
  `;
  html = html.replace("</head>", puppeteerOverride + "</head>");

  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfBytes = await page.pdf({
    format: "Letter",
    printBackground: true,
    margin: { top: "1.0in", right: 0, bottom: "1.0in", left: 0 },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width:100%;height:100%;background-color:#f4efe3;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
    `,
    footerTemplate: `
      <div style="width:100%;height:100%;background-color:#f4efe3;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;margin:0;padding:0;">
        <div style="margin:0 0.75in;padding-top:14pt;border-top:0.5pt solid #1c6ea4;font-family:'SF Mono','Menlo','Consolas',monospace;font-size:7.5pt;color:#2a3f55;text-transform:uppercase;letter-spacing:0.1em;display:flex;justify-content:space-between;">
          <span>Blueprint IT &middot; Shop OS Foundation</span>
          <span>blueprintit.ai &middot; page <span class="pageNumber"></span></span>
        </div>
      </div>
    `,
  });
  await browser.close();
  return pdfBytes;
}

async function generateCustomWelcomePdf(env: any, licenseKey: string): Promise<string> {
  const pdfBytes = await renderWelcomePdfBytes(env, licenseKey);
  // Pre-warm the cache read by GET /welcome.pdf?key=... so the customer's
  // thank-you page never has to wait on a cold Browser API render. Best-effort:
  // if this fails the email still ships and the public endpoint will re-render
  // and cache on first access.
  try {
    await env.LICENSES.put(`pdf:welcome:${licenseKey}`, pdfBytes);
  } catch {
    // swallow: email path must not fail because of a cache write
  }
  return arrayBufferToBase64(pdfBytes.buffer as ArrayBuffer);
}
