import { StripeClient, StripePromotionCode } from "./stripe";

export interface CouponValidationResult {
  valid: boolean;
  error?: string;
  // Present when valid:
  code?: string;
  promotionCodeId?: string;
  finalPrice?: number;        // cents
  discountAmount?: number;    // cents
  label?: string;
  affiliate?: string | null;
}

export const BASE_PRICE_CENTS = 200000;

export interface ValidateCouponOptions {
  // Redemptions Stripe cannot see (PayPal sales). Added to Stripe's counts so
  // limits like the Founding 50 cap hold across both checkouts.
  extraRedemptions?: number;
  // PayPal cannot enforce Stripe-side restrictions (single customer, first
  // purchase), so restricted codes are refused there.
  channel?: "stripe" | "paypal";
}

const paypalRedemptionKey = (code: string) => `coupon-redemptions:paypal:${code.trim().toUpperCase()}`;

export async function getPaypalRedemptions(kv: KVNamespace, code: string): Promise<number> {
  const raw = await kv.get(paypalRedemptionKey(code));
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function recordPaypalRedemption(kv: KVNamespace, code: string): Promise<void> {
  const n = await getPaypalRedemptions(kv, code);
  await kv.put(paypalRedemptionKey(code), String(n + 1));
}

export async function validateCoupon(
  stripe: StripeClient,
  code: string,
  opts: ValidateCouponOptions = {}
): Promise<CouponValidationResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { valid: false, error: "Enter a code to apply." };
  const extra = Math.max(0, opts.extraRedemptions ?? 0);

  let promo: StripePromotionCode | null;
  try {
    promo = await stripe.findPromotionCode(trimmed);
  } catch (e) {
    return { valid: false, error: `Could not validate code: ${(e as Error).message}` };
  }

  if (!promo) return { valid: false, error: "Code not recognized." };
  if (!promo.active) return { valid: false, error: "This code is no longer active." };
  if (promo.expires_at && promo.expires_at * 1000 <= Date.now()) {
    return { valid: false, error: "This code has expired." };
  }

  const coupon = promo.promotion.coupon;
  if (coupon.valid === false) return { valid: false, error: "This code is no longer active." };
  if (promo.max_redemptions !== null && promo.max_redemptions !== undefined && promo.times_redeemed + extra >= promo.max_redemptions) {
    return { valid: false, error: `${trimmed} has reached its redemption limit.` };
  }
  if (opts.channel === "paypal") {
    const r = promo.restrictions;
    if (promo.customer || r?.first_time_transaction || (r?.minimum_amount ?? 0) > BASE_PRICE_CENTS) {
      return { valid: false, error: `${trimmed} can only be used with card checkout.` };
    }
  }
  if (coupon.max_redemptions !== null && coupon.times_redeemed + extra >= coupon.max_redemptions) {
    const isFoundingFifty = trimmed.startsWith("FOUNDING") || coupon.metadata.campaign === "founding-50";
    return {
      valid: false,
      error: isFoundingFifty
        ? `${trimmed} is sold out, Founding 50 cohort closed.`
        : `${trimmed} has reached its redemption limit.`,
    };
  }

  let discountAmount = 0;
  if (coupon.amount_off !== null) {
    discountAmount = coupon.amount_off;
  } else if (coupon.percent_off !== null) {
    discountAmount = Math.round(BASE_PRICE_CENTS * (coupon.percent_off / 100));
  }
  const finalPrice = Math.max(0, BASE_PRICE_CENTS - discountAmount);
  const dollarsOff = (discountAmount / 100).toFixed(2);

  return {
    valid: true,
    code: trimmed,
    promotionCodeId: promo.id,
    finalPrice,
    discountAmount,
    label: `${trimmed}, $${dollarsOff} off`,
    affiliate: coupon.metadata.affiliate ?? null,
  };
}
