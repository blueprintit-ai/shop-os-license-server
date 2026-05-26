import { describe, it, expect, vi } from "vitest";
import { handlePaymentSuccess, deriveFlagsFromPromo } from "../src/handlers/payment-success";
import { LicenseRecord } from "../src/license-core";

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

function fakeAssets() {
  return {
    async fetch() {
      const bytes = new TextEncoder().encode("%PDF-fake");
      return new Response(bytes, { status: 200 });
    },
  } as unknown as Fetcher;
}

describe("handlePaymentSuccess", () => {
  it("issues a license and stores the idempotency mapping", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const result = await handlePaymentSuccess(
      { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() },
      { paymentProvider: "stripe", paymentId: "cs_test_1", customer: "Acme", email: "a@b.co", amount: 50000 },
      { sendEmail }
    );
    expect(result.alreadyIssued).toBe(false);
    expect(result.license.key).toMatch(/^SHOP-/);
    const idemKey = await kv.get("payment:stripe:cs_test_1");
    expect(idemKey).toBe(result.license.key);
    expect(result.emailResult.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("is idempotent across repeat calls with same paymentId", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const env = { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() };
    const input = { paymentProvider: "stripe" as const, paymentId: "cs_test_dup", customer: "Acme", email: "a@b.co", amount: 50000 };
    const a = await handlePaymentSuccess(env, input, { sendEmail });
    const b = await handlePaymentSuccess(env, input, { sendEmail });
    expect(b.alreadyIssued).toBe(true);
    expect(b.license.key).toBe(a.license.key);
  });

  it("does not re-send email when welcomeEmailSentAt is already set", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const env = { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() };
    const input = { paymentProvider: "stripe" as const, paymentId: "cs_idem_email", customer: "Acme", email: "a@b.co", amount: 50000 };
    await handlePaymentSuccess(env, input, { sendEmail });
    expect(sendEmail).toHaveBeenCalledOnce();
    sendEmail.mockClear();
    const result = await handlePaymentSuccess(env, input, { sendEmail });
    expect(result.alreadyIssued).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("attaches both the welcome PDF and the first-week guide PDF", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_dual" });
    await handlePaymentSuccess(
      { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() },
      { paymentProvider: "stripe", paymentId: "cs_dual_attach", customer: "Acme", email: "a@b.co", amount: 50000 },
      { sendEmail }
    );
    expect(sendEmail).toHaveBeenCalledOnce();
    const input = sendEmail.mock.calls[0][1] as { attachments?: Array<{ filename: string }> };
    expect(input.attachments?.map(a => a.filename)).toEqual([
      "shop-os-welcome.pdf",
      "shop-os-first-week-guide.pdf",
    ]);
  });

  it("records promoCode and affiliate in license metadata", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const r = await handlePaymentSuccess(
      { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() },
      { paymentProvider: "stripe", paymentId: "cs_attr", customer: "Acme", email: "a@b.co", amount: 34900, promoCode: "FOUNDING50", affiliate: "cabinet-pro", discountAmount: 15100 },
      { sendEmail }
    );
    expect(r.license.metadata?.promoCode).toBe("FOUNDING50");
    expect(r.license.metadata?.affiliate).toBe("cabinet-pro");
    expect(r.license.metadata?.discountAmount).toBe(15100);
  });

  it("re-issues license when idempotency mapping points to deleted license", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const env = { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() };
    const input = { paymentProvider: "stripe" as const, paymentId: "cs_orphan", customer: "Acme", email: "a@b.co", amount: 50000 };
    const first = await handlePaymentSuccess(env, input, { sendEmail });
    // Simulate manual license deletion
    await kv.delete(first.license.key);
    const second = await handlePaymentSuccess(env, input, { sendEmail });
    expect(second.alreadyIssued).toBe(true);
    expect(second.license.key).not.toBe(first.license.key); // new key issued
    expect(await kv.get("payment:stripe:cs_orphan")).toBe(second.license.key); // mapping updated
  });

  it("auto-flags FOUNDING50 redeemers with lifetimeUpdates + cohort='founding-50'", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const r = await handlePaymentSuccess(
      { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() },
      { paymentProvider: "stripe", paymentId: "cs_founding", customer: "F", email: "f@x.y", amount: 50000, promoCode: "FOUNDING50" },
      { sendEmail }
    );
    expect(r.license.lifetimeUpdates).toBe(true);
    expect(r.license.cohort).toBe("founding-50");
  });

  it("does not auto-flag non-FOUNDING50 promos (e.g. INSIDER100)", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ id: "em_1" });
    const r = await handlePaymentSuccess(
      { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() },
      { paymentProvider: "stripe", paymentId: "cs_insider", customer: "I", email: "i@x.y", amount: 0, promoCode: "INSIDER100" },
      { sendEmail }
    );
    expect(r.license.lifetimeUpdates).toBe(false);
    expect(r.license.cohort).toBe("");
  });

  it("deriveFlagsFromPromo is case-insensitive on FOUNDING50", () => {
    expect(deriveFlagsFromPromo("founding50").lifetimeUpdates).toBe(true);
    expect(deriveFlagsFromPromo("FoUnDiNg50").lifetimeUpdates).toBe(true);
    expect(deriveFlagsFromPromo(undefined).lifetimeUpdates).toBe(false);
    expect(deriveFlagsFromPromo("").lifetimeUpdates).toBe(false);
  });

  it("does not mark welcomeEmailSentAt when email fails", async () => {
    const kv = memoryKv();
    const sendEmail = vi.fn().mockResolvedValue({ error: { message: "Resend down" } });
    const env = { LICENSES: kv, RESEND_API_KEY: "re_x", ASSETS: fakeAssets() };
    const input = { paymentProvider: "stripe" as const, paymentId: "cs_email_fail", customer: "Acme", email: "a@b.co", amount: 50000 };
    const r = await handlePaymentSuccess(env, input, { sendEmail });
    expect(r.emailResult.ok).toBe(false);
    expect(r.emailResult.error).toMatch(/Resend down/);
    // The license in KV should NOT have welcomeEmailSentAt set
    const stored = JSON.parse(await kv.get(r.license.key)!) as { metadata?: { welcomeEmailSentAt?: string } };
    expect(stored.metadata?.welcomeEmailSentAt).toBeUndefined();
  });
});
