export interface StripePromotionCode {
  id: string;
  code: string;
  active: boolean;
  coupon: {
    id: string;
    amount_off: number | null;       // cents
    percent_off: number | null;
    currency: string | null;
    duration: string;
    metadata: Record<string, string>;
    max_redemptions: number | null;
    times_redeemed: number;
  };
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  customer_email: string | null;
  amount_total: number;             // cents
  metadata: Record<string, string>;
  discounts?: { promotion_code: string | StripePromotionCode }[];
}

export class StripeClient {
  constructor(
    private secretKey: string,
    // Dependency-injected fetch; defaults to the global fetch. Allows unit tests
    // to pass a vi.fn() mock without touching the non-configurable Workers-runtime
    // globalThis.fetch (which cannot be spied on via vi.spyOn in the workers pool).
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(
    path: string,
    init: RequestInit & { form?: Record<string, string> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
    };
    let body: BodyInit | undefined;
    if (init.form) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.form)) params.set(k, v);
      body = params.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const resp = await this.fetchImpl(`https://api.stripe.com${path}`, {
      method: init.method ?? "GET",
      headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
      body,
    });
    const text = await resp.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!resp.ok) {
      const err = data as { error?: { message?: string; code?: string } };
      const code = err.error?.code ?? "unknown";
      const message = err.error?.message ?? text;
      throw new Error(`Stripe ${resp.status} [${code}]: ${message}`);
    }
    return data as T;
  }

  // Look up an active promotion code by its customer-facing string (e.g. "FOUNDING50").
  // Returns null if not found / not active.
  async findPromotionCode(code: string): Promise<StripePromotionCode | null> {
    const data = await this.call<{ data: StripePromotionCode[] }>(
      `/v1/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1&expand[]=data.coupon`,
    );
    return data.data[0] ?? null;
  }

  // Create a Stripe Checkout session for the Foundation product, with optional promo code.
  async createCheckoutSession(input: {
    priceId: string;
    customerEmail: string;
    promotionCodeId?: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<StripeCheckoutSession> {
    const form: Record<string, string> = {
      "mode": "payment",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      "customer_email": input.customerEmail,
      "success_url": input.successUrl,
      "cancel_url": input.cancelUrl,
    };
    if (input.promotionCodeId) {
      form["discounts[0][promotion_code]"] = input.promotionCodeId;
    }
    for (const [k, v] of Object.entries(input.metadata)) {
      form[`metadata[${k}]`] = v;
    }
    return this.call<StripeCheckoutSession>("/v1/checkout/sessions", { method: "POST", form });
  }

  async retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
    return this.call<StripeCheckoutSession>(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=discounts.0.promotion_code.coupon`,
    );
  }
}
