import { describe, it, expect, vi } from "vitest";
import { validateCoupon } from "../src/payments/coupon";
import { StripeClient } from "../src/payments/stripe";

function makePromo(over: Partial<{
  active: boolean;
  amount_off: number | null;
  percent_off: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  metadata: Record<string, string>;
  code: string;
}> = {}) {
  return {
    id: "promo_1",
    code: over.code ?? "FOUNDING50",
    active: over.active ?? true,
    max_redemptions: null as number | null,
    times_redeemed: 0,
    promotion: {
      type: "coupon" as const,
      coupon: {
        id: "coup_1",
        amount_off: "amount_off" in over ? over.amount_off! : 15100,
        percent_off: over.percent_off ?? null,
        currency: "usd",
        duration: "once",
        metadata: over.metadata ?? {},
        max_redemptions: over.max_redemptions ?? 50,
        times_redeemed: over.times_redeemed ?? 0,
        valid: true,
      },
    },
    restrictions: {
      first_time_transaction: false,
      minimum_amount: null as number | null,
      minimum_amount_currency: null as string | null,
    },
  };
}

function stripeMock(promo: ReturnType<typeof makePromo> | null) {
  const c = new StripeClient("sk_test_x");
  c.findPromotionCode = vi.fn().mockResolvedValue(promo);
  return c;
}

describe("validateCoupon", () => {
  it("rejects empty", async () => {
    const r = await validateCoupon(stripeMock(makePromo()), "   ");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/enter a code/i);
  });

  it("rejects unknown code", async () => {
    const r = await validateCoupon(stripeMock(null), "NOPE");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not recognized/i);
  });

  it("accepts FOUNDING50 with $151 off, finalPrice 349.00", async () => {
    const r = await validateCoupon(stripeMock(makePromo({ amount_off: 15100 })), "founding50");
    expect(r.valid).toBe(true);
    expect(r.code).toBe("FOUNDING50");
    expect(r.finalPrice).toBe(34900);
    expect(r.discountAmount).toBe(15100);
    expect(r.label).toMatch(/FOUNDING50/);
    expect(r.label).toMatch(/151\.00/);
  });

  it("rejects when max_redemptions reached, with sold-out message for FOUNDING", async () => {
    const r = await validateCoupon(stripeMock(makePromo({ times_redeemed: 50 })), "FOUNDING50");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sold out/i);
  });

  it("handles percent_off coupons (100% off)", async () => {
    const r = await validateCoupon(stripeMock(makePromo({ amount_off: null, percent_off: 100 })), "INSIDER1");
    expect(r.valid).toBe(true);
    expect(r.finalPrice).toBe(0);
    expect(r.discountAmount).toBe(50000);
  });

  it("returns affiliate from coupon metadata", async () => {
    const r = await validateCoupon(stripeMock(makePromo({ metadata: { affiliate: "cabinet-pro" } })), "CABINETPRO");
    expect(r.valid).toBe(true);
    expect(r.affiliate).toBe("cabinet-pro");
  });

  it("returns affiliate null when not present", async () => {
    const r = await validateCoupon(stripeMock(makePromo({ metadata: {} })), "X");
    expect(r.valid).toBe(true);
    expect(r.affiliate).toBeNull();
  });

  // Controller-added test 1: inactive code path
  it("rejects inactive promotion code", async () => {
    const r = await validateCoupon(stripeMock(makePromo({ active: false })), "OLDCODE");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/no longer active/i);
  });

  // Controller-added test 2: Stripe API error path
  it("wraps Stripe API errors as user-facing message", async () => {
    const c = new StripeClient("sk_test_x");
    c.findPromotionCode = vi.fn().mockRejectedValue(new Error("Stripe 500: down"));
    const r = await validateCoupon(c, "ANY");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/could not validate/i);
  });
});
