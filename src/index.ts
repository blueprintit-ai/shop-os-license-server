/**
 * Shop OS License Server (Cloudflare Worker)
 *
 * Endpoints:
 *   GET  /                       -> health check
 *   GET  /admin                  -> admin dashboard UI (HTML page; auth happens client-side)
 *   GET  /validate?key=...       -> validate a license key (public)
 *   GET  /refresh?key=...        -> re-validate, bump last_seen (public, used by skills periodically)
 *   POST /issue                  -> issue a new license key (admin: requires bearer ADMIN_TOKEN)
 *   POST /revoke?key=...         -> revoke a license key (admin)
 *   GET  /list                   -> list all licenses (admin)
 *
 * Data lives in the LICENSES KV namespace, keyed by license-key string.
 * Each record:
 *   {
 *     key, customer, email, product, entitlements: string[],
 *     created_at, valid_until: string|null, cancelled_at: string|null,
 *     last_seen: string|null, activations: number
 *   }
 */

import { ADMIN_HTML } from "./admin-html.js";
import { LicenseRecord, IssueLicenseInput, issueLicense } from "./license-core.js";
import { StripeClient } from "./payments/stripe.js";
import { PayPalClient } from "./payments/paypal.js";
import { validateCoupon } from "./payments/coupon.js";
import { handleStripeWebhook } from "./handlers/stripe-webhook.js";
import { handlePayPalWebhook } from "./handlers/paypal-webhook.js";
import { handlePaymentSuccess } from "./handlers/payment-success.js";

export interface Env {
  LICENSES: KVNamespace;
  ADMIN_TOKEN: string;
  SERVICE_NAME: string;
  SERVICE_VERSION: string;

  // Assets binding — always present once [assets] is configured in wrangler.toml.
  ASSETS: Fetcher;

  // Stripe (test mode for now; production keys added in Task 25)
  STRIPE_SECRET_KEY_TEST?: string;
  STRIPE_WEBHOOK_SECRET_TEST?: string;
  STRIPE_PRICE_ID_TEST?: string; // public price ID used by checkout session creation (Task 12)

  // Stripe production stubs (activated in Task 25 cutover)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;

  // PayPal
  PAYPAL_CLIENT_ID_TEST?: string;
  PAYPAL_CLIENT_SECRET_TEST?: string;
  PAYPAL_WEBHOOK_ID_TEST?: string;
  PAYPAL_ENV?: "sandbox" | "live" | string; // allow runtime values outside the union

  // PayPal production stubs (activated in Task 25 cutover)
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;

  // Resend
  RESEND_API_KEY?: string;
}

// IssueRequest is the shape of the admin POST /issue JSON body.
// IssueLicenseInput (from license-core) is a superset; we parse into this
// leaner type so the handler stays explicit about what the HTTP API accepts.
interface IssueRequest {
  customer: string;
  email: string;
  product?: string;
  entitlements?: string[];
  valid_until?: string | null;
}

// ----- CORS -----

const ALLOWED_ORIGINS = new Set([
  "https://blueprintit.ai",
  "https://www.blueprintit.ai",
  "http://localhost:5173", // Vite dev
  "http://localhost:3000", // alt dev port
]);

// Match any Vercel preview deployment of the blueprint-it-website project.
// Hashes change per deploy; pattern stays stable.
const VERCEL_PREVIEW_RE = /^https:\/\/blueprint-it-website-[a-z0-9-]+\.vercel\.app$/;

function originAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin) || VERCEL_PREVIEW_RE.test(origin);
}

// Base URL for post-checkout redirects (Stripe success_url / cancel_url).
// Mirrors the requester's origin so localhost dev, Vercel preview, and
// production all redirect back to the same surface the buyer started on.
// Falls back to the production site for unknown / missing origins.
function redirectBase(req: Request): string {
  const origin = req.headers.get("Origin") ?? "";
  return originAllowed(origin) ? origin : "https://blueprintit.ai";
}

// Full preflight response headers (OPTIONS only).
function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Minimal CORS headers for actual (non-preflight) JSON responses.
// Omits preflight-only fields (Allow-Methods, Allow-Headers, Max-Age).
function corsResponseHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = { Vary: "Origin" };
  if (originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// ----- helpers -----

function json(req: Request, body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsResponseHeaders(req),
    },
  });
}

function nowISO(): string {
  return new Date().toISOString();
}

function isExpired(record: LicenseRecord): boolean {
  if (!record.valid_until) return false;
  return new Date(record.valid_until).getTime() < Date.now();
}

async function requireAdmin(req: Request, env: Env): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN) {
    return json(req, { error: "server misconfigured: ADMIN_TOKEN not set" }, 500);
  }
  if (auth !== expected) {
    return json(req, { error: "unauthorized" }, 401);
  }
  return null;
}

function getStripe(env: Env): StripeClient {
  const key = env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY_TEST;
  if (!key) throw new Error("No Stripe secret key configured.");
  return new StripeClient(key);
}

function getPayPal(env: Env): PayPalClient {
  const envType = (env.PAYPAL_ENV ?? "sandbox") as "sandbox" | "live";
  const cid = env.PAYPAL_CLIENT_ID ?? env.PAYPAL_CLIENT_ID_TEST;
  const sec = env.PAYPAL_CLIENT_SECRET ?? env.PAYPAL_CLIENT_SECRET_TEST;
  if (!cid || !sec) throw new Error("PayPal credentials not configured.");
  return new PayPalClient(envType, cid, sec);
}

// ----- handlers -----

async function handleHealth(req: Request, env: Env): Promise<Response> {
  return json(req, {
    name: env.SERVICE_NAME ?? "shop-os-license-server",
    version: env.SERVICE_VERSION ?? "1.0.0",
    ok: true,
  });
}

async function handleValidate(req: Request, url: URL, env: Env, bumpLastSeen: boolean): Promise<Response> {
  const key = url.searchParams.get("key");
  if (!key) return json(req, { valid: false, error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json(req, { valid: false, error: "not found" }, 404);

  if (record.cancelled_at) {
    return json(req, { valid: false, error: "revoked", cancelled_at: record.cancelled_at }, 403);
  }
  if (isExpired(record)) {
    return json(req, { valid: false, error: "expired", valid_until: record.valid_until }, 403);
  }

  if (bumpLastSeen) {
    record.last_seen = nowISO();
    record.activations = (record.activations ?? 0) + 1;
    await env.LICENSES.put(key, JSON.stringify(record));
  }

  return json(req, {
    valid: true,
    customer: record.customer,
    product: record.product,
    entitlements: record.entitlements,
    valid_until: record.valid_until,
    activated_at: record.last_seen,
  });
}

async function handleIssue(req: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  let body: IssueRequest;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid JSON body" }, 400);
  }
  if (!body.customer || !body.email) {
    return json(req, { error: "customer and email are required" }, 400);
  }

  const input: IssueLicenseInput = {
    customer: body.customer,
    email: body.email,
    product: body.product,
    entitlements: body.entitlements,
    valid_until: body.valid_until,
  };
  const record = await issueLicense(env.LICENSES, input);

  return json(req, { ok: true, license: record }, 201);
}

async function handleRevoke(req: Request, url: URL, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  const key = url.searchParams.get("key");
  if (!key) return json(req, { error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json(req, { error: "not found" }, 404);
  if (record.cancelled_at) {
    return json(req, { ok: true, already_cancelled: true, cancelled_at: record.cancelled_at });
  }

  record.cancelled_at = nowISO();
  await env.LICENSES.put(key, JSON.stringify(record));
  return json(req, { ok: true, key, cancelled_at: record.cancelled_at });
}

async function handleList(req: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  const list = await env.LICENSES.list({ limit: 1000 });
  const records: LicenseRecord[] = [];
  for (const k of list.keys) {
    if (!k.name.startsWith("SHOP-")) continue;
    const r = await env.LICENSES.get<LicenseRecord>(k.name, "json");
    if (r) records.push(r);
  }
  return json(req, { ok: true, count: records.length, licenses: records });
}

// ----- router -----

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    try {
      // Serve welcome PDF from assets binding at the canonical /welcome.pdf URL.
      if (method === "GET" && path === "/welcome.pdf") {
        const asset = await env.ASSETS.fetch(new Request("https://placeholder/shop-os-welcome.pdf"));
        if (!asset.ok) return new Response("Not found", { status: 404 });
        return new Response(asset.body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'inline; filename="shop-os-welcome.pdf"',
            "Cache-Control": "public, max-age=3600",
            ...corsResponseHeaders(req),
          },
        });
      }

      if (path === "/" && method === "GET") return handleHealth(req, env);
      if ((path === "/admin" || path === "/admin/") && method === "GET") {
        return new Response(ADMIN_HTML, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-frame-options": "DENY",
            "referrer-policy": "no-referrer",
          },
        });
      }
      if (path === "/validate" && method === "GET") return handleValidate(req, url, env, false);
      if (path === "/refresh" && method === "GET") return handleValidate(req, url, env, true);
      if (path === "/issue" && method === "POST") return handleIssue(req, env);
      if (path === "/revoke" && method === "POST") return handleRevoke(req, url, env);
      if (path === "/list" && method === "GET") return handleList(req, env);

      if (req.method === "POST" && url.pathname === "/validate-coupon") {
        let body: { code?: string };
        try { body = await req.json(); } catch { body = {}; }
        if (!body.code) return json(req, { valid: false, error: "Code is required." }, 400);
        try {
          const stripe = getStripe(env);
          const result = await validateCoupon(stripe, body.code);
          return json(req, result);
        } catch (e) {
          return json(req, { valid: false, error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/create-stripe-checkout-session") {
        type Body = { email: string; code?: string };
        let body: Body;
        try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }
        if (!body.email) return json(req, { error: "Email is required." }, 400);

        try {
          const stripe = getStripe(env);
          const priceId = env.STRIPE_PRICE_ID ?? env.STRIPE_PRICE_ID_TEST;
          if (!priceId) return json(req, { error: "STRIPE_PRICE_ID not configured." }, 500);

          let promotionCodeId: string | undefined;
          let promoCode: string | undefined;
          let affiliate: string | null = null;

          if (body.code) {
            const r = await validateCoupon(stripe, body.code);
            if (!r.valid) return json(req, { error: r.error }, 400);
            promotionCodeId = r.promotionCodeId;
            promoCode = r.code;
            affiliate = r.affiliate ?? null;
          }

          const session = await stripe.createCheckoutSession({
            priceId,
            customerEmail: body.email,
            promotionCodeId,
            successUrl: `${redirectBase(req)}/shop-ossi/thank-you?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${redirectBase(req)}/shop-ossi#purchase`,
            metadata: {
              source: "shop-ossi",
              ...(promoCode ? { promoCode } : {}),
              ...(affiliate ? { affiliate } : {}),
            },
          });
          return json(req, { checkoutUrl: session.url, sessionId: session.id });
        } catch (e) {
          return json(req, { error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/webhook/stripe") {
        return handleStripeWebhook(req, env);
      }

      if (req.method === "POST" && url.pathname === "/create-paypal-order") {
        type Body = { email: string; code?: string };
        let body: Body;
        try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }
        if (!body.email) return json(req, { error: "Email is required." }, 400);

        try {
          let finalPrice = 75000;
          let promoCode: string | undefined;
          let affiliate: string | null = null;
          let discountAmount: number | undefined;

          if (body.code) {
            const stripe = getStripe(env);
            const r = await validateCoupon(stripe, body.code);
            if (!r.valid) return json(req, { error: r.error }, 400);
            finalPrice = r.finalPrice ?? 75000;
            promoCode = r.code;
            affiliate = r.affiliate ?? null;
            discountAmount = r.discountAmount;
          }

          const paypal = getPayPal(env);
          const order = await paypal.createOrder({
            amount: finalPrice,
            payerEmail: body.email,
            metadata: {
              source: "shop-ossi",
              email: body.email,
              ...(promoCode ? { promoCode } : {}),
              ...(affiliate ? { affiliate } : {}),
              ...(discountAmount ? { discountAmount: String(discountAmount) } : {}),
            },
          });
          return json(req, { orderId: order.id });
        } catch (e) {
          return json(req, { error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/capture-paypal-order") {
        type Body = { orderId: string; email?: string };
        let body: Body;
        try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }
        if (!body.orderId) return json(req, { error: "orderId is required." }, 400);

        try {
          const paypal = getPayPal(env);
          const captured = await paypal.captureOrder(body.orderId);
          if (captured.status !== "COMPLETED") {
            return json(req, { error: `Capture status: ${captured.status}` }, 400);
          }

          const customId = captured.purchase_units?.[0]?.custom_id ?? "{}";
          let metadata: Record<string, string> = {};
          try { metadata = JSON.parse(customId); } catch { metadata = {}; }

          const email = body.email ?? metadata.email ?? captured.payer?.email_address ?? "";
          const customer =
            `${captured.payer?.name?.given_name ?? ""} ${captured.payer?.name?.surname ?? ""}`.trim() ||
            metadata.email ||
            email ||
            "Customer";

          const amountValue = captured.purchase_units?.[0]?.amount?.value;
          const amountCents = amountValue ? Math.round(parseFloat(amountValue) * 100) : 75000;

          const result = await handlePaymentSuccess(env, {
            paymentProvider: "paypal",
            paymentId: body.orderId,
            customer,
            email,
            amount: amountCents,
            promoCode: metadata.promoCode,
            affiliate: metadata.affiliate ?? null,
            discountAmount: metadata.discountAmount ? parseInt(metadata.discountAmount, 10) : undefined,
          });

          return json(req, { license: result.license.key, alreadyIssued: result.alreadyIssued });
        } catch (e) {
          return json(req, { error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/webhook/paypal") {
        return handlePayPalWebhook(req, env);
      }

      if (req.method === "GET" && url.pathname === "/payment-status") {
        const sessionId = url.searchParams.get("session_id");
        const paypalOrderId = url.searchParams.get("paypal_order_id");
        if (!sessionId && !paypalOrderId) {
          return json(req, { error: "Provide session_id or paypal_order_id." }, 400);
        }
        const idemKey = sessionId
          ? `payment:stripe:${sessionId}`
          : `payment:paypal:${paypalOrderId}`;
        const licenseKey = await env.LICENSES.get(idemKey);
        if (!licenseKey) return json(req, { status: "pending" });
        return json(req, { status: "succeeded", licenseKey });
      }

      return json(req, { error: "not found", path, method }, 404);
    } catch (err) {
      return json(req, { error: "internal error", detail: String(err) }, 500);
    }
  },
};
