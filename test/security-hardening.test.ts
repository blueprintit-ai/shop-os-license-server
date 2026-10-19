import { describe, it, expect, vi, afterEach } from "vitest";
import { isLicenseKey, getLicenseRecord, updateLicenseFlags, buildLicenseRecord } from "../src/license-core";
import { validateCoupon, getPaypalRedemptions, recordPaypalRedemption } from "../src/payments/coupon";
import { StripeClient } from "../src/payments/stripe";
import { handleStripeWebhook } from "../src/handlers/stripe-webhook";

function memKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const kv = {
    get: vi.fn(async (k: string, type?: string) => {
      const v = store.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    }),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
  return { kv: kv as unknown as KVNamespace, store, raw: kv };
}

describe("license key format guard", () => {
  it("accepts generated keys and rejects internal KV names", () => {
    const rec = buildLicenseRecord({ customer: "x", email: "x@y.z" });
    expect(isLicenseKey(rec.key)).toBe(true);
    for (const bad of [
      "install-alert-cap:2026-10-19T14",
      "payment:stripe:cs_123",
      "coupon-redemptions:paypal:FOUNDING50",
      "SHOP-",
      "SHOP-LLLL-OOOO-IIII",
      "shop-abcd-efgh-jkmn",
      "",
    ]) {
      expect(isLicenseKey(bad)).toBe(false);
    }
  });

  it("getLicenseRecord ignores counters stored in the same namespace", async () => {
    const { kv } = memKv({ "install-alert-cap:2026-10-19T14": "3" });
    expect(await getLicenseRecord(kv, "install-alert-cap:2026-10-19T14")).toBeNull();
  });

  it("getLicenseRecord rejects a record stored under a different key", async () => {
    const rec = buildLicenseRecord({ customer: "x", email: "x@y.z" });
    const other = "SHOP-AAAA-BBBB-CCCC";
    const { kv } = memKv({ [other]: JSON.stringify(rec) });
    expect(await getLicenseRecord(kv, other)).toBeNull();
  });

  it("getLicenseRecord returns real licenses", async () => {
    const rec = buildLicenseRecord({ customer: "x", email: "x@y.z" });
    const { kv } = memKv({ [rec.key]: JSON.stringify(rec) });
    expect((await getLicenseRecord(kv, rec.key))?.customer).toBe("x");
  });

  it("updateLicenseFlags refuses non-license keys without writing", async () => {
    const { kv, raw } = memKv({ "payment:stripe:cs_1": JSON.stringify({ key: "payment:stripe:cs_1" }) });
    expect(await updateLicenseFlags(kv, "payment:stripe:cs_1", { lifetimeUpdates: true })).toBeNull();
    expect(raw.put).not.toHaveBeenCalled();
  });
});

function promo(over: Record<string, unknown> = {}) {
  return {
    id: "promo_1",
    code: "FOUNDING50",
    active: true,
    max_redemptions: null as number | null,
    times_redeemed: 0,
    expires_at: null as number | null,
    customer: null as string | null,
    promotion: {
      type: "coupon" as const,
      coupon: {
        id: "coup_1", amount_off: 25000, percent_off: null, currency: "usd", duration: "once",
        metadata: {}, max_redemptions: 50 as number | null, times_redeemed: 0, valid: true,
      },
    },
    restrictions: { first_time_transaction: false, minimum_amount: null as number | null, minimum_amount_currency: null },
    ...over,
  };
}
function stripeWith(p: unknown) {
  const c = new StripeClient("sk_test_x");
  c.findPromotionCode = vi.fn().mockResolvedValue(p);
  return c;
}

describe("coupon limits across Stripe and PayPal", () => {
  it("counts PayPal redemptions toward the coupon cap", async () => {
    const p = promo();
    p.promotion.coupon.times_redeemed = 45;
    expect((await validateCoupon(stripeWith(p), "FOUNDING50", { extraRedemptions: 4 })).valid).toBe(true);
    const r = await validateCoupon(stripeWith(p), "FOUNDING50", { extraRedemptions: 5 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sold out/i);
  });

  it("enforces the promotion code's own limit", async () => {
    const r = await validateCoupon(stripeWith(promo({ max_redemptions: 3, times_redeemed: 3 })), "FOUNDING50");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/redemption limit/i);
  });

  it("rejects expired codes", async () => {
    const r = await validateCoupon(stripeWith(promo({ expires_at: Math.floor(Date.now() / 1000) - 60 })), "FOUNDING50");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/expired/i);
  });

  it("refuses customer-restricted and first-purchase codes on PayPal only", async () => {
    const restricted = promo({ customer: "cus_123" });
    expect((await validateCoupon(stripeWith(restricted), "FOUNDING50")).valid).toBe(true);
    expect((await validateCoupon(stripeWith(restricted), "FOUNDING50", { channel: "paypal" })).valid).toBe(false);
    const firstTime = promo({ restrictions: { first_time_transaction: true, minimum_amount: null, minimum_amount_currency: null } });
    expect((await validateCoupon(stripeWith(firstTime), "FOUNDING50", { channel: "paypal" })).valid).toBe(false);
  });

  it("PayPal redemption counter increments per code", async () => {
    const { kv } = memKv();
    expect(await getPaypalRedemptions(kv, "founding50")).toBe(0);
    await recordPaypalRedemption(kv, "FOUNDING50");
    await recordPaypalRedemption(kv, " founding50 ");
    expect(await getPaypalRedemptions(kv, "FOUNDING50")).toBe(2);
  });
});

async function signedEvent(type: string, sessionId = "cs_test_1") {
  const body = JSON.stringify({ id: "evt_1", type, data: { object: { id: sessionId } } });
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://x.example/webhook/stripe", { method: "POST", body, headers: { "stripe-signature": `t=${ts},v1=${hex}` } });
}

describe("Stripe webhook only licenses our own paid checkouts", () => {
  afterEach(() => vi.restoreAllMocks());

  function env() {
    const { kv, raw } = memKv();
    return { e: { LICENSES: kv, ASSETS: {} as any, STRIPE_WEBHOOK_SECRET_TEST: "whsec_test", STRIPE_SECRET_KEY_TEST: "sk_test_x" } as any, raw };
  }

  it("ignores checkouts without our source tag (payment links, invoices)", async () => {
    vi.spyOn(StripeClient.prototype, "retrieveCheckoutSession").mockResolvedValue({ id: "cs_test_1", payment_status: "paid", metadata: {} } as any);
    const { e, raw } = env();
    const res = await handleStripeWebhook(await signedEvent("checkout.session.completed"), e);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/not a Blueprint OS checkout/);
    expect(raw.put).not.toHaveBeenCalled();
  });

  it("ignores our checkouts that are not paid yet", async () => {
    vi.spyOn(StripeClient.prototype, "retrieveCheckoutSession").mockResolvedValue({ id: "cs_test_1", payment_status: "unpaid", metadata: { source: "shop-ossi", productType: "foundation" } } as any);
    const { e, raw } = env();
    const res = await handleStripeWebhook(await signedEvent("checkout.session.completed"), e);
    expect(await res.text()).toMatch(/payment not complete/);
    expect(raw.put).not.toHaveBeenCalled();
  });

  it("still ignores unrelated event types", async () => {
    const { e } = env();
    const res = await handleStripeWebhook(await signedEvent("customer.created"), e);
    expect(await res.text()).toBe("ignored");
  });
});
