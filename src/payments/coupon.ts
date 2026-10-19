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
  couponId?: string;
}

export const BASE_PRICE_CENTS = 200000;

export interface ValidateCouponOptions {
  // When given, PayPal sales and pending PayPal orders recorded in KV count
  // toward Stripe's limits, so caps like the Founding 50 hold across both
  // checkouts. Stripe only counts its own redemptions.
  kv?: KVNamespace;
  // PayPal cannot enforce Stripe-side restrictions (single customer, first
  // purchase), so restricted codes are refused there.
  channel?: "stripe" | "paypal";
  // The PayPal order being captured: its own hold must not count against it.
  excludeOrderId?: string;
}

// KV layout (all keyed by PayPal order id, so retries never double count):
//   paypal-order-coupon:<orderId>                -> {"code","couponId"}  (7 days)
//   coupon-hold:<couponId>:<orderId>             -> code                 (3 hours, pending order)
//   coupon-use:paypal:<couponId>:<orderId>       -> code                 (completed sale)
//   coupon-use-code:paypal:<CODE>:<orderId>      -> "1"                  (completed sale, per code)
const HOLD_TTL_SECONDS = 3 * 60 * 60;
const norm = (code: string) => code.trim().toUpperCase();

async function countKeys(kv: KVNamespace, prefix: string, exclude?: string): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) if (!exclude || !k.name.endsWith(`:${exclude}`)) n++;
    cursor = page.list_complete ? undefined : (page as { cursor?: string }).cursor;
  } while (cursor);
  return n;
}

async function paypalUsage(kv: KVNamespace, couponId: string, code: string, excludeOrderId?: string) {
  const [couponUses, holds, codeUses] = await Promise.all([
    countKeys(kv, `coupon-use:paypal:${couponId}:`),
    countKeys(kv, `coupon-hold:${couponId}:`, excludeOrderId),
    countKeys(kv, `coupon-use-code:paypal:${norm(code)}:`),
  ]);
  return { coupon: couponUses + holds, code: codeUses + holds };
}

/** Hold one use of the coupon while a PayPal order awaits payment. */
export async function holdPaypalCoupon(kv: KVNamespace, orderId: string, code: string, couponId: string): Promise<void> {
  await kv.put(`paypal-order-coupon:${orderId}`, JSON.stringify({ code: norm(code), couponId }), { expirationTtl: 7 * 24 * 3600 });
  await kv.put(`coupon-hold:${couponId}:${orderId}`, norm(code), { expirationTtl: HOLD_TTL_SECONDS });
}

export async function getPaypalOrderCoupon(kv: KVNamespace, orderId: string): Promise<{ code: string; couponId: string } | null> {
  return kv.get<{ code: string; couponId: string }>(`paypal-order-coupon:${orderId}`, "json");
}

/** Record a completed PayPal sale once per order and release its hold. */
export async function recordPaypalRedemption(kv: KVNamespace, orderId: string, code: string): Promise<void> {
  const mapped = await getPaypalOrderCoupon(kv, orderId);
  const c = norm(mapped?.code ?? code);
  await kv.put(`coupon-use-code:paypal:${c}:${orderId}`, "1");
  if (mapped?.couponId) {
    await kv.put(`coupon-use:paypal:${mapped.couponId}:${orderId}`, c);
    await kv.delete(`coupon-hold:${mapped.couponId}:${orderId}`);
  }
}

export async function validateCoupon(
  stripe: StripeClient,
  code: string,
  opts: ValidateCouponOptions = {}
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
  if (promo.expires_at && promo.expires_at * 1000 <= Date.now()) {
    return { valid: false, error: "This code has expired." };
  }

  const coupon = promo.promotion.coupon;
  if (coupon.valid === false) return { valid: false, error: "This code is no longer active." };
  const extra = opts.kv ? await paypalUsage(opts.kv, coupon.id, trimmed, opts.excludeOrderId) : { coupon: 0, code: 0 };
  if (promo.max_redemptions !== null && promo.max_redemptions !== undefined && promo.times_redeemed + extra.code >= promo.max_redemptions) {
    return { valid: false, error: `${trimmed} has reached its redemption limit.` };
  }
  if (opts.channel === "paypal") {
    const r = promo.restrictions;
    if (promo.customer || r?.first_time_transaction || (r?.minimum_amount ?? 0) > BASE_PRICE_CENTS) {
      return { valid: false, error: `${trimmed} can only be used with card checkout.` };
    }
  }
  if (coupon.max_redemptions !== null && coupon.times_redeemed + extra.coupon >= coupon.max_redemptions) {
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
    couponId: coupon.id,
  };
}
