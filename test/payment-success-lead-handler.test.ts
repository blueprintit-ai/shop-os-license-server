import { describe, it, expect, vi } from "vitest";
import { handlePaymentSuccess } from "../src/handlers/payment-success";

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
      return new Response(new TextEncoder().encode("%PDF-fake"), { status: 200 });
    },
  } as unknown as Fetcher;
}

const baseEnv = () => ({
  LICENSES: memoryKv(),
  RESEND_API_KEY: "re_test",
  ASSETS: fakeAssets(),
  CALENDLY_CONSULTATION_URL: "https://calendly.com/blueprintit/1-hour-meeting",
  CALENDLY_SETUP_URL: "https://calendly.com/blueprintit/shop-os-foundation-setup",
});

const baseInput = (overrides: Partial<Parameters<typeof handlePaymentSuccess>[1]> = {}) => ({
  paymentProvider: "stripe" as const,
  paymentId: "cs_test_leadhandler_1",
  customer: "Acme Cabinets",
  email: "owner@acmecabinets.com",
  amount: 100000,
  productType: "lead-handler" as const,
  ...overrides,
});

describe("handlePaymentSuccess — lead-handler branch", () => {
  it("issues no license and sends the install email with the setup booking link", async () => {
    const env = baseEnv();
    const sendLeadHandler = vi.fn(async () => ({ id: "email_1" }));
    const result = await handlePaymentSuccess(env, baseInput(), { sendLeadHandler });

    expect(result.license).toBeNull();
    expect(result.alreadyIssued).toBe(false);
    expect(result.emailResult.ok).toBe(true);
    expect(sendLeadHandler).toHaveBeenCalledTimes(1);
    const args = sendLeadHandler.mock.calls[0] as unknown[];
    expect(args[0]).toBe("re_test");
    expect(args[1]).toMatchObject({
      to: "owner@acmecabinets.com",
      bookingUrl: "https://calendly.com/blueprintit/shop-os-foundation-setup",
    });
  });

  it("falls back to the consultation Calendly link when no setup URL configured", async () => {
    const env = { ...baseEnv(), CALENDLY_SETUP_URL: undefined };
    const sendLeadHandler = vi.fn(async () => ({ id: "email_1" }));
    await handlePaymentSuccess(env, baseInput(), { sendLeadHandler });
    expect(sendLeadHandler.mock.calls[0][1]).toMatchObject({
      bookingUrl: "https://calendly.com/blueprintit/1-hour-meeting",
    });
  });

  it("is idempotent — webhook retry does not re-send the email", async () => {
    const env = baseEnv();
    const sendLeadHandler = vi.fn(async () => ({ id: "email_1" }));
    await handlePaymentSuccess(env, baseInput(), { sendLeadHandler });
    const second = await handlePaymentSuccess(env, baseInput(), { sendLeadHandler });
    expect(second.alreadyIssued).toBe(true);
    expect(sendLeadHandler).toHaveBeenCalledTimes(1);
  });

  it("records payment (payment-status sees succeeded) even if email fails", async () => {
    const env = baseEnv();
    const sendLeadHandler = vi.fn(async () => ({ error: { message: "boom" } }));
    const result = await handlePaymentSuccess(env, baseInput(), { sendLeadHandler });
    expect(result.emailResult.ok).toBe(false);
    const kv = env.LICENSES as unknown as { store: Map<string, string> };
    expect(kv.store.get("payment:stripe:cs_test_leadhandler_1")).toBeTruthy();
  });
});
