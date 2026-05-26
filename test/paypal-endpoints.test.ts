import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    LICENSES: {} as any,
    ADMIN_TOKEN: "x",
    SERVICE_NAME: "test",
    SERVICE_VERSION: "1",
    ASSETS: {} as any,
    PAYPAL_CLIENT_ID_TEST: "cid",
    PAYPAL_CLIENT_SECRET_TEST: "sec",
    PAYPAL_ENV: "sandbox",
    STRIPE_SECRET_KEY_TEST: "sk_test_x",
    ...over,
  } as Env;
}

describe("POST /create-paypal-order", () => {
  it("returns 400 when body is not JSON", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/create-paypal-order", { method: "POST", body: "not-json" }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });
  it("returns 400 when email missing", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/create-paypal-order", { method: "POST", body: JSON.stringify({}) }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/email is required/i);
  });
  it("returns 500 when PayPal credentials missing", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/create-paypal-order", { method: "POST", body: JSON.stringify({ email: "a@b.co" }) }),
      makeEnv({ PAYPAL_CLIENT_ID_TEST: undefined, PAYPAL_CLIENT_ID: undefined })
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /capture-paypal-order", () => {
  it("returns 400 when orderId missing", async () => {
    const res = await worker.fetch(
      new Request("https://x.example/capture-paypal-order", { method: "POST", body: JSON.stringify({}) }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/orderId is required/i);
  });
});
