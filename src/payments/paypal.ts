export interface PayPalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  purchase_units: {
    amount: { currency_code: string; value: string };
    custom_id?: string;
    invoice_id?: string;
  }[];
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  links: { href: string; rel: string; method: string }[];
}

export interface PayPalCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
}

export type PayPalEnv = "sandbox" | "live";

const BASES: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export class PayPalClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private base: string;

  constructor(
    private env: PayPalEnv,
    private clientId: string,
    private clientSecret: string,
    // Dependency-injected fetch; defaults to the global fetch. Allows unit tests
    // to pass a vi.fn() mock without touching the non-configurable Workers-runtime
    // globalThis.fetch (which cannot be spied on via vi.spyOn in the workers pool).
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.base = BASES[env];
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const creds = btoa(`${this.clientId}:${this.clientSecret}`);
    const resp = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`PayPal OAuth ${resp.status}: ${text}`);
    }
    const data = (await resp.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const resp = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await resp.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!resp.ok) {
      throw new Error(`PayPal ${resp.status}: ${text}`);
    }
    return data as T;
  }

  async createOrder(input: {
    amount: number;             // cents (will be divided by 100 for PayPal's string format)
    currency?: string;
    metadata: Record<string, string>;
    payerEmail: string;
  }): Promise<PayPalOrder> {
    const usd = (input.amount / 100).toFixed(2);
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: input.currency ?? "USD", value: usd },
          description: "Shop OS Foundation, one-time license",
          custom_id: JSON.stringify(input.metadata).slice(0, 127),
        },
      ],
      payer: { email_address: input.payerEmail },
      application_context: {
        brand_name: "Blueprint IT",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      },
    };
    return this.call<PayPalOrder>("/v2/checkout/orders", { method: "POST", body: JSON.stringify(body) });
  }

  async captureOrder(orderId: string): Promise<PayPalOrder & { purchase_units: { payments: { captures: PayPalCapture[] } }[] }> {
    return this.call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST" });
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    return this.call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  async verifyWebhookSignature(input: {
    transmissionId: string;
    transmissionTime: string;
    certUrl: string;
    authAlgo: string;
    transmissionSig: string;
    webhookId: string;
    rawBody: string;
  }): Promise<boolean> {
    const data = await this.call<{ verification_status: "SUCCESS" | "FAILURE" }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: JSON.stringify({
          transmission_id: input.transmissionId,
          transmission_time: input.transmissionTime,
          cert_url: input.certUrl,
          auth_algo: input.authAlgo,
          transmission_sig: input.transmissionSig,
          webhook_id: input.webhookId,
          webhook_event: JSON.parse(input.rawBody),
        }),
      }
    );
    return data.verification_status === "SUCCESS";
  }
}
