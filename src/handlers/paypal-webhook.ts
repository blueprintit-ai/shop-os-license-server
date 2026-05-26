import { handlePaymentSuccess } from "./payment-success";
import { PayPalClient } from "../payments/paypal";

export async function handlePayPalWebhook(
  req: Request,
  env: {
    LICENSES: KVNamespace;
    ASSETS: Fetcher;
    RESEND_API_KEY?: string;
    PAYPAL_ENV?: "sandbox" | "live" | string;
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    PAYPAL_WEBHOOK_ID?: string;
    PAYPAL_CLIENT_ID_TEST?: string;
    PAYPAL_CLIENT_SECRET_TEST?: string;
    PAYPAL_WEBHOOK_ID_TEST?: string;
  }
): Promise<Response> {
  const envType = (env.PAYPAL_ENV ?? "sandbox") as "sandbox" | "live";
  const cid = env.PAYPAL_CLIENT_ID ?? env.PAYPAL_CLIENT_ID_TEST;
  const sec = env.PAYPAL_CLIENT_SECRET ?? env.PAYPAL_CLIENT_SECRET_TEST;
  const webhookId = env.PAYPAL_WEBHOOK_ID ?? env.PAYPAL_WEBHOOK_ID_TEST;
  if (!cid || !sec || !webhookId) return new Response("PayPal not configured", { status: 500 });

  const transmissionId = req.headers.get("paypal-transmission-id");
  const transmissionTime = req.headers.get("paypal-transmission-time");
  const certUrl = req.headers.get("paypal-cert-url");
  const authAlgo = req.headers.get("paypal-auth-algo");
  const transmissionSig = req.headers.get("paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return new Response("Missing PayPal headers", { status: 401 });
  }

  const rawBody = await req.text();
  const paypal = new PayPalClient(envType, cid, sec);
  const valid = await paypal.verifyWebhookSignature({
    transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig,
    webhookId, rawBody,
  });
  if (!valid) return new Response("Invalid signature", { status: 401 });

  const event = JSON.parse(rawBody) as { event_type: string; resource: any };
  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    return new Response("ignored", { status: 200 });
  }

  const capture = event.resource;
  const supplementary = capture.supplementary_data?.related_ids;
  const orderId = supplementary?.order_id ?? capture.id;
  const customId = capture.custom_id ?? "{}";
  let metadata: Record<string, string> = {};
  try { metadata = JSON.parse(customId); } catch {}

  const amountCents = capture.amount?.value
    ? Math.round(parseFloat(capture.amount.value) * 100)
    : 75000;

  await handlePaymentSuccess(env, {
    paymentProvider: "paypal",
    paymentId: orderId,
    customer: metadata.email ?? capture.payee?.email_address ?? "Customer",
    email: metadata.email ?? capture.payee?.email_address ?? "",
    amount: amountCents,
    promoCode: metadata.promoCode,
    affiliate: metadata.affiliate ?? null,
    discountAmount: metadata.discountAmount ? parseInt(metadata.discountAmount, 10) : undefined,
  });
  return new Response("ok", { status: 200 });
}
