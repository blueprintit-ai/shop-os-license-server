import { describe, it, expect } from "vitest";
import { handlePayPalWebhook } from "../src/handlers/paypal-webhook";

const baseEnv = {
  LICENSES: {} as any,
  ASSETS: {} as any,
  PAYPAL_CLIENT_ID_TEST: "cid",
  PAYPAL_CLIENT_SECRET_TEST: "sec",
  PAYPAL_WEBHOOK_ID_TEST: "wh_test",
  PAYPAL_ENV: "sandbox" as const,
};

describe("handlePayPalWebhook", () => {
  it("returns 500 when PayPal credentials missing", async () => {
    const req = new Request("https://x/webhook/paypal", { method: "POST", body: "{}" });
    const res = await handlePayPalWebhook(req, { ...baseEnv, PAYPAL_CLIENT_ID_TEST: undefined } as any);
    expect(res.status).toBe(500);
  });

  it("returns 401 when required headers missing", async () => {
    const req = new Request("https://x/webhook/paypal", { method: "POST", body: "{}" });
    const res = await handlePayPalWebhook(req, baseEnv as any);
    expect(res.status).toBe(401);
  });
});
