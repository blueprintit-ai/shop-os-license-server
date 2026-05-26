import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    LICENSES: {} as any,
    ADMIN_TOKEN: "test-admin",
    SERVICE_NAME: "test",
    SERVICE_VERSION: "1.0.0",
    ASSETS: {} as any,
    STRIPE_SECRET_KEY_TEST: "sk_test_x",
    STRIPE_PRICE_ID_TEST: "price_test_x",
    ...overrides,
  } as Env;
}

describe("POST /create-stripe-checkout-session", () => {
  it("returns 400 when body is not JSON", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/create-stripe-checkout-session", { method: "POST", body: "not-json" }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when email missing", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/create-stripe-checkout-session", {
        method: "POST", body: JSON.stringify({ code: "X" })
      }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/email is required/i);
  });

  it("returns 500 when no price ID configured", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/create-stripe-checkout-session", {
        method: "POST", body: JSON.stringify({ email: "a@b.co" })
      }),
      makeEnv({ STRIPE_PRICE_ID_TEST: undefined, STRIPE_PRICE_ID: undefined })
    );
    expect(res.status).toBe(500);
    const j = await res.json();
    expect(j.error).toMatch(/PRICE_ID/i);
  });

  // Success path requires real Stripe — covered by Task 18 integration test.
});
