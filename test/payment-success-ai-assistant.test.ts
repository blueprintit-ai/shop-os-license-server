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
  paymentId: "cs_test_aiassistant_1",
  customer: "Acme Cabinets",
  email: "owner@acmecabinets.com",
  amount: 100000,
  productType: "ai-assistant" as const,
  ...overrides,
});

describe("handlePaymentSuccess — ai-assistant branch", () => {
  it("issues no license and sends the setup email with the setup booking link", async () => {
    const env = baseEnv();
    const sendAiAssistant = vi.fn(async () => ({ id: "email_1" }));
    const result = await handlePaymentSuccess(env, baseInput(), { sendAiAssistant });

    expect(result.license).toBeNull();
    expect(result.alreadyIssued).toBe(false);
    expect(result.emailResult.ok).toBe(true);
    expect(sendAiAssistant).toHaveBeenCalledTimes(1);
    const args = sendAiAssistant.mock.calls[0] as unknown[];
    expect(args[0]).toBe("re_test");
    expect(args[1]).toMatchObject({
      to: "owner@acmecabinets.com",
      bookingUrl: "https://calendly.com/blueprintit/ai-assistant-setup?email=owner%40acmecabinets.com&name=Acme+Cabinets",
    });
  });

  it("uses CALENDLY_AI_ASSISTANT_URL when configured, never the Foundation setup link", async () => {
    const env = { ...baseEnv(), CALENDLY_AI_ASSISTANT_URL: "https://calendly.com/blueprintit/override" };
    const sendAiAssistant = vi.fn(async () => ({ id: "email_1" }));
    await handlePaymentSuccess(env, baseInput(), { sendAiAssistant });
    const url = (sendAiAssistant.mock.calls[0] as unknown[])[1] as { bookingUrl: string };
    expect(url.bookingUrl.startsWith("https://calendly.com/blueprintit/override?")).toBe(true);
  });

  it("omits the name prefill when the payment has no real customer name", async () => {
    const env = baseEnv();
    const sendAiAssistant = vi.fn(async () => ({ id: "email_1" }));
    await handlePaymentSuccess(env, baseInput({ customer: "Customer" }), { sendAiAssistant });
    expect((sendAiAssistant.mock.calls[0] as unknown[])[1]).toMatchObject({
      bookingUrl: "https://calendly.com/blueprintit/ai-assistant-setup?email=owner%40acmecabinets.com",
    });
  });

  it("is idempotent — webhook retry does not re-send the email", async () => {
    const env = baseEnv();
    const sendAiAssistant = vi.fn(async () => ({ id: "email_1" }));
    await handlePaymentSuccess(env, baseInput(), { sendAiAssistant });
    const second = await handlePaymentSuccess(env, baseInput(), { sendAiAssistant });
    expect(second.alreadyIssued).toBe(true);
    expect(sendAiAssistant).toHaveBeenCalledTimes(1);
  });

  it("records payment (payment-status sees succeeded) even if email fails", async () => {
    const env = baseEnv();
    const sendAiAssistant = vi.fn(async () => ({ error: { message: "boom" } }));
    const result = await handlePaymentSuccess(env, baseInput(), { sendAiAssistant });
    expect(result.emailResult.ok).toBe(false);
    const kv = env.LICENSES as unknown as { store: Map<string, string> };
    expect(kv.store.get("payment:stripe:cs_test_aiassistant_1")).toBeTruthy();
  });
});
