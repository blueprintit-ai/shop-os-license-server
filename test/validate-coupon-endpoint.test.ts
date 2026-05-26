import { describe, it, expect, vi } from "vitest";
import worker, { Env } from "../src/index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    LICENSES: {} as any,
    ADMIN_TOKEN: "test-admin",
    SERVICE_NAME: "test",
    SERVICE_VERSION: "1.0.0",
    ASSETS: {} as any,
    STRIPE_SECRET_KEY_TEST: "sk_test_x",
    ...overrides,
  } as Env;
}

describe("POST /validate-coupon", () => {
  it("returns 400 when code missing", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/validate-coupon", { method: "POST", body: JSON.stringify({}) }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toMatch(/required/i);
  });

  it("returns 500 when no Stripe key configured", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/validate-coupon", { method: "POST", body: JSON.stringify({ code: "X" }) }),
      makeEnv({ STRIPE_SECRET_KEY_TEST: undefined, STRIPE_SECRET_KEY: undefined })
    );
    expect(res.status).toBe(500);
  });

  // Successful validation requires real Stripe calls. That path is integration-tested in Task 18.
});
