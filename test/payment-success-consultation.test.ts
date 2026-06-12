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
});

const baseInput = (overrides: Partial<Parameters<typeof handlePaymentSuccess>[1]> = {}) => ({
  paymentProvider: "stripe" as const,
  paymentId: "cs_test_consult_1",
  customer: "Acme Cabinets",
  email: "owner@acmecabinets.com",
  amount: 15000,
  productType: "consultation" as const,
  ...overrides,
});

describe("handlePaymentSuccess — consultation branch", () => {
  it("sends the Calendly email and never issues a license", async () => {
    const env = baseEnv();
    const sendConsultation = vi.fn().mockResolvedValue({ id: "em_consult_1" });
    const sendEmail = vi.fn(); // Foundation path; must NOT be called

    const result = await handlePaymentSuccess(env, baseInput(), {
      sendEmail,
      sendConsultation,
    });

    expect(result.license).toBeNull();
    expect(result.alreadyIssued).toBe(false);
    expect(result.emailResult.ok).toBe(true);

    // Idempotency record uses the same key shape as Foundation
    const idemKey = await env.LICENSES.get("payment:stripe:cs_test_consult_1");
    expect(idemKey).toBe("consultation-owner@acmecabinets.com");

    // Foundation welcome email must NOT be sent for consultations
    expect(sendEmail).not.toHaveBeenCalled();

    // Consultation email sent once with the right inputs
    expect(sendConsultation).toHaveBeenCalledOnce();
    const [apiKey, payload] = sendConsultation.mock.calls[0];
    expect(apiKey).toBe("re_test");
    expect(payload.to).toBe("owner@acmecabinets.com");
    expect(payload.calendlyUrl).toBe("https://calendly.com/blueprintit/1-hour-meeting");
    // When a real customer name is provided, the template uses it verbatim.
    expect(payload.customerName).toBe("Acme Cabinets");
  });

  it("is idempotent on repeat webhook fires for the same session", async () => {
    const env = baseEnv();
    const sendConsultation = vi.fn().mockResolvedValue({ id: "em_consult_dup" });

    const first = await handlePaymentSuccess(env, baseInput({ paymentId: "cs_test_consult_dup" }), { sendConsultation });
    const second = await handlePaymentSuccess(env, baseInput({ paymentId: "cs_test_consult_dup" }), { sendConsultation });

    expect(first.alreadyIssued).toBe(false);
    expect(second.alreadyIssued).toBe(true);

    // Email sent exactly once across both calls (idempotency guards the send)
    expect(sendConsultation).toHaveBeenCalledOnce();
  });

  it("falls back to email-prefix when customer name is the generic 'Customer'", async () => {
    const env = baseEnv();
    const sendConsultation = vi.fn().mockResolvedValue({ id: "em_consult_2" });

    await handlePaymentSuccess(
      env,
      baseInput({ paymentId: "cs_test_consult_nameless", customer: "Customer", email: "shop@example.com" }),
      { sendConsultation },
    );

    expect(sendConsultation).toHaveBeenCalledOnce();
    expect(sendConsultation.mock.calls[0][1].customerName).toBe("shop");
  });

  it("returns an error when CALENDLY_CONSULTATION_URL is not configured", async () => {
    const env = { ...baseEnv(), CALENDLY_CONSULTATION_URL: undefined };
    const sendConsultation = vi.fn();

    const result = await handlePaymentSuccess(env, baseInput({ paymentId: "cs_test_consult_no_calendly" }), {
      sendConsultation,
    });

    expect(result.emailResult.ok).toBe(false);
    expect(result.emailResult.error).toMatch(/CALENDLY_CONSULTATION_URL/);
    expect(sendConsultation).not.toHaveBeenCalled();
  });

  it("returns an error when RESEND_API_KEY is not configured", async () => {
    const env = { ...baseEnv(), RESEND_API_KEY: undefined };
    const sendConsultation = vi.fn();

    const result = await handlePaymentSuccess(env, baseInput({ paymentId: "cs_test_consult_no_resend" }), {
      sendConsultation,
    });

    expect(result.emailResult.ok).toBe(false);
    expect(result.emailResult.error).toMatch(/RESEND_API_KEY/);
    expect(sendConsultation).not.toHaveBeenCalled();
  });
});
