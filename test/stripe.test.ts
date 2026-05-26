import { describe, it, expect, vi } from "vitest";
import { StripeClient } from "../src/payments/stripe";

// Strategy: dependency injection.
// vi.spyOn(globalThis, "fetch") is unreliable in the @cloudflare/vitest-pool-workers runtime
// because globalThis.fetch is the Workers-runtime fetch (non-configurable property).
// Instead, StripeClient accepts an optional fetchImpl constructor param — tests pass vi.fn().

function makeSession(overrides: Partial<{
  id: string;
  url: string;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  customer_email: string | null;
  amount_total: number;
  metadata: Record<string, string>;
}> = {}) {
  return {
    id: "cs_test_xyz",
    url: "https://checkout.stripe.com/pay/cs_test_xyz",
    payment_status: "paid" as const,
    customer_email: "a@b.co",
    amount_total: 50000,
    metadata: {},
    ...overrides,
  };
}

describe("StripeClient", () => {
  it("findPromotionCode hits the right URL with code and active=true, and sends Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const c = new StripeClient("sk_test_x", fetchMock as unknown as typeof fetch);
    await c.findPromotionCode("FOUNDING50");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/v1/promotion_codes");
    expect(url).toContain("code=FOUNDING50");
    expect(url).toContain("active=true");

    // Authorization header must carry the bearer token.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk_test_x");
  });

  it("findPromotionCode returns null when no results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const c = new StripeClient("sk_test_x", fetchMock as unknown as typeof fetch);
    expect(await c.findPromotionCode("nope")).toBeNull();
  });

  it("createCheckoutSession encodes promotionCodeId in form", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_1",
          url: "https://stripe",
          payment_status: "unpaid",
          customer_email: null,
          amount_total: 0,
          metadata: {},
        }),
        { status: 200 },
      ),
    );
    const c = new StripeClient("sk_test_x", fetchMock as unknown as typeof fetch);
    await c.createCheckoutSession({
      priceId: "price_1",
      customerEmail: "a@b.co",
      promotionCodeId: "promo_1",
      successUrl: "https://x/ok",
      cancelUrl: "https://x/no",
      metadata: { source: "shop-ossi" },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = init.body as string;
    expect(body).toContain("discounts%5B0%5D%5Bpromotion_code%5D=promo_1");
    expect(body).toContain("metadata%5Bsource%5D=shop-ossi");
    expect(body).toContain("customer_email=a%40b.co");
    expect(body).toContain("mode=payment");
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_1");
  });

  it("call() throws with Stripe error message on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "No such promotion_code" } }),
        { status: 404 },
      ),
    );
    const c = new StripeClient("sk_test_x", fetchMock as unknown as typeof fetch);
    await expect(c.findPromotionCode("BAD")).rejects.toThrow(/No such promotion_code/);
  });

  it("retrieveCheckoutSession hits the session URL with promotion_code expansion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeSession()), { status: 200 }),
    );
    const c = new StripeClient("sk_test_x", fetchMock as unknown as typeof fetch);
    const session = await c.retrieveCheckoutSession("cs_test_xyz");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/v1/checkout/sessions/cs_test_xyz");
    expect(url).toContain("expand[]=discounts.0.promotion_code.coupon");
    expect(session.payment_status).toBe("paid");
    expect(session.amount_total).toBe(50000);
    expect(session.customer_email).toBe("a@b.co");
  });
});
