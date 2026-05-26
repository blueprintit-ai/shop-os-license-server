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

const BASE_PRICE_CENTS = 75000;

export async function validateCoupon(
  stripe: StripeClient,
  code: string
): Promise<CouponValidationResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { valid: false, error: "Enter a code to apply." };

  let promo: StripePromotionCode | null;
  try {
    promo = await stripe.findPromotionCode(trimmed);
  } catch (e) {
    return { valid: false, error: `Could not validate code: ${(e as Error).message}` };
  }

  if (!promo) return { valid: false, error: "Code not recognized." };
  if (!promo.active) return { valid: false, error: "This code is no longer active." };

  const coupon = promo.promotion.coupon;
  if (coupon.max_redemptions !== null && coupon.times_redeemed >= coupon.max_redemptions) {
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
