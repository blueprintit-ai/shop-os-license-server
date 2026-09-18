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
  paymentId: "cs_test_bundle_1",
  customer: "Acme Cabinets",
  email: "owner@acmecabinets.com",
  amount: 200000,
  productType: "bundle" as const,
  ...overrides,
});

describe("handlePaymentSuccess — bundle branch", () => {
  it("issues a Foundation license AND sends both welcome and lead-handler emails", async () => {
    const env = baseEnv();
    const sendEmail = vi.fn(async () => ({ id: "welcome_1" }));
    const sendLeadHandler = vi.fn(async () => ({ id: "lh_1" }));
    const result = await handlePaymentSuccess(env, baseInput(), { sendEmail, sendLeadHandler });

    expect(result.license).not.toBeNull();
    expect(result.license!.email).toBe("owner@acmecabinets.com");
    expect(result.emailResult.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendLeadHandler).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — retry re-issues nothing and re-sends nothing", async () => {
    const env = baseEnv();
    const sendEmail = vi.fn(async () => ({ id: "welcome_1" }));
    const sendLeadHandler = vi.fn(async () => ({ id: "lh_1" }));
    const first = await handlePaymentSuccess(env, baseInput(), { sendEmail, sendLeadHandler });
    const second = await handlePaymentSuccess(env, baseInput(), { sendEmail, sendLeadHandler });
    expect(second.alreadyIssued).toBe(true);
    expect(second.license!.key).toBe(first.license!.key);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendLeadHandler).toHaveBeenCalledTimes(1);
  });

  it("bundle license records productType bundle in metadata", async () => {
    const env = baseEnv();
    const sendEmail = vi.fn(async () => ({ id: "welcome_1" }));
    const sendLeadHandler = vi.fn(async () => ({ id: "lh_1" }));
    const result = await handlePaymentSuccess(env, baseInput(), { sendEmail, sendLeadHandler });
    expect(result.license!.metadata?.productType).toBe("bundle");
  });
});
