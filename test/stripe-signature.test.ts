import { describe, it, expect, vi } from "vitest";
import { verifyStripeSignature } from "../src/handlers/stripe-webhook";
import { handleStripeWebhook } from "../src/handlers/stripe-webhook";

async function makeSig(payload: string, ts: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `t=${ts},v1=${hex}`;
}

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";

  it("accepts a valid signature", async () => {
    const payload = '{"event": "fake"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSig(payload, ts, secret);
    expect(await verifyStripeSignature(payload, sig, secret)).toBe(true);
  });

  it("rejects when body is tampered", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSig('{"a":1}', ts, secret);
    expect(await verifyStripeSignature('{"a":2}', sig, secret)).toBe(false);
  });

  it("rejects when secret is wrong", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSig("x", ts, secret);
    expect(await verifyStripeSignature("x", sig, "whsec_wrong")).toBe(false);
  });

  it("rejects when v1 missing", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(await verifyStripeSignature("x", `t=${ts}`, secret)).toBe(false);
  });

  it("rejects when timestamp is too old", async () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes old
    const sig = await makeSig("x", oldTs, secret);
    expect(await verifyStripeSignature("x", sig, secret)).toBe(false);
  });
});

describe("handleStripeWebhook", () => {
  it("returns 401 when stripe-signature header missing", async () => {
    const req = new Request("https://x.example/webhook/stripe", { method: "POST", body: "{}" });
    const env = { LICENSES: {} as any, ASSETS: {} as any, STRIPE_WEBHOOK_SECRET_TEST: "whsec_test" } as any;
    const res = await handleStripeWebhook(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 500 when webhook secret not configured", async () => {
    const req = new Request("https://x.example/webhook/stripe", { method: "POST", body: "{}", headers: { "stripe-signature": "t=x,v1=y" } });
    const env = { LICENSES: {} as any, ASSETS: {} as any } as any;
    const res = await handleStripeWebhook(req, env);
    expect(res.status).toBe(500);
  });

  it("returns 401 when signature invalid", async () => {
    const req = new Request("https://x.example/webhook/stripe", {
      method: "POST",
      body: '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{}}}',
      headers: { "stripe-signature": "t=999,v1=deadbeef" },
    });
    const env = { LICENSES: {} as any, ASSETS: {} as any, STRIPE_WEBHOOK_SECRET_TEST: "whsec_test" } as any;
    const res = await handleStripeWebhook(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 200 (ignored) for non-checkout.session.completed events", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"id":"evt_2","type":"customer.created","data":{"object":{}}}';
    const sig = await makeSig(body, ts, "whsec_test");
    const req = new Request("https://x.example/webhook/stripe", { method: "POST", body, headers: { "stripe-signature": sig } });
    const env = { LICENSES: {} as any, ASSETS: {} as any, STRIPE_WEBHOOK_SECRET_TEST: "whsec_test", STRIPE_SECRET_KEY_TEST: "sk_test_x" } as any;
    const res = await handleStripeWebhook(req, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ignored");
  });

  // The Stripe account is shared with other Blueprint IT products (My Study Guide, the portal). Their checkouts carry
  // no productType and must never be treated as a Shop OS purchase (a 2026-11-01 My Study Guide checkout got a license).
  it.each([
    ["another product's checkout (no productType)", { family_id: "fam_1", kind: "subscription" }],
    ["no metadata at all", undefined],
    ["an unknown productType", { productType: "something-else" }],
  ])("ignores %s without fetching the session or issuing a license", async (_label, metadata) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ id: "evt_3", type: "checkout.session.completed", data: { object: { id: "cs_live_other", customer_email: "someone@example.com", amount_total: 0, metadata } } });
    const sig = await makeSig(body, ts, "whsec_test");
    const req = new Request("https://x.example/webhook/stripe", { method: "POST", body, headers: { "stripe-signature": sig } });
    const kvPut = vi.fn();
    const env = { LICENSES: { put: kvPut, get: vi.fn() } as any, ASSETS: {} as any, STRIPE_WEBHOOK_SECRET_TEST: "whsec_test", STRIPE_SECRET_KEY_TEST: "sk_test_x" } as any;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not call Stripe"));
    try {
      const res = await handleStripeWebhook(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ignored");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(kvPut).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
