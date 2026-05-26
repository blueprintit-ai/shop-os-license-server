import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";

function envWith(mapping: Record<string, string> = {}): Env {
  return {
    LICENSES: {
      async get(k: string) { return mapping[k] ?? null; },
    } as any,
    ADMIN_TOKEN: "x", SERVICE_NAME: "test", SERVICE_VERSION: "1",
    ASSETS: {} as any,
  } as Env;
}

describe("GET /payment-status", () => {
  it("returns 400 when neither id provided", async () => {
    const res = await worker.fetch(new Request("https://x/payment-status"), envWith());
    expect(res.status).toBe(400);
  });

  it("returns pending when session not found", async () => {
    const res = await worker.fetch(
      new Request("https://x/payment-status?session_id=cs_test_unknown"),
      envWith()
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("pending");
  });

  it("returns succeeded + licenseKey when stripe session found", async () => {
    const res = await worker.fetch(
      new Request("https://x/payment-status?session_id=cs_test_x"),
      envWith({ "payment:stripe:cs_test_x": "SHOP-ABCD-EFGH-JKMN" })
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("succeeded");
    expect(j.licenseKey).toBe("SHOP-ABCD-EFGH-JKMN");
  });

  it("looks up paypal_order_id when provided", async () => {
    const res = await worker.fetch(
      new Request("https://x/payment-status?paypal_order_id=ORDER-99"),
      envWith({ "payment:paypal:ORDER-99": "SHOP-WXYZ-1234-5678" })
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("succeeded");
    expect(j.licenseKey).toBe("SHOP-WXYZ-1234-5678");
  });
});
