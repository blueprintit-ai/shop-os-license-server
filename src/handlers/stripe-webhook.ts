import { handlePaymentSuccess, ProductType } from "./payment-success";
import { StripeClient } from "../payments/stripe";

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = 300
): Promise<boolean> {
  // Format: t=12345,v1=abc...,v0=...
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // Timestamp tolerance check — reject replayed webhooks older than 5 minutes.
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${ts}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const macHex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(macHex, v1);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StripeWebhookEnv {
  LICENSES: KVNamespace;
  RESEND_API_KEY?: string;
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY_TEST?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_WEBHOOK_SECRET_TEST?: string;
  CALENDLY_CONSULTATION_URL?: string;
}

export async function handleStripeWebhook(req: Request, env: StripeWebhookEnv): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 401 });
  const secret = env.STRIPE_WEBHOOK_SECRET ?? env.STRIPE_WEBHOOK_SECRET_TEST;
  if (!secret) return new Response("Webhook secret not configured", { status: 500 });
  const rawBody = await req.text();
  const valid = await verifyStripeSignature(rawBody, sig, secret);
  if (!valid) return new Response("Invalid signature", { status: 401 });

  const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: any } };
  if (event.type !== "checkout.session.completed") {
    return new Response("ignored", { status: 200 });
  }

  const session = event.data.object;
  const stripeKey = env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY_TEST;
  if (!stripeKey) return new Response("Stripe key not configured", { status: 500 });

  // Re-fetch with expanded discounts to get the promo code reliably.
  const stripe = new StripeClient(stripeKey);
  const full = await stripe.retrieveCheckoutSession(session.id);

  const promoCode = full.metadata?.promoCode ?? extractPromoFromSession(full);
  const affiliate = full.metadata?.affiliate ?? null;

  // productType is set by /create-stripe-checkout-session in session metadata.
  // Missing or unknown values fall back to "foundation" so any pre-existing
  // sessions in flight during deploy keep going through the original path.
  const rawType = full.metadata?.productType;
  const productType: ProductType = rawType === "consultation" ? "consultation" : "foundation";

  await handlePaymentSuccess(env, {
    paymentProvider: "stripe",
    paymentId: session.id,
    customer: full.customer_email ?? session.customer_email ?? "Customer",
    email: full.customer_email ?? session.customer_email ?? "",
    amount: full.amount_total ?? session.amount_total ?? 0,
    promoCode,
    affiliate,
    discountAmount: session.total_details?.amount_discount ?? undefined,
    productType,
  });
  return new Response("ok", { status: 200 });
}

function extractPromoFromSession(s: any): string | undefined {
  const d = s.discounts?.[0];
  if (d?.promotion_code) {
    if (typeof d.promotion_code === "string") return undefined;
    return d.promotion_code.code;
  }
  return undefined;
}
