import { describe, it, expect, vi } from "vitest";
import { PayPalClient } from "../src/payments/paypal";

// Strategy: dependency injection.
// vi.spyOn(globalThis, "fetch") is unreliable in the @cloudflare/vitest-pool-workers runtime
// because globalThis.fetch is the Workers-runtime fetch (non-configurable property).
// Instead, PayPalClient accepts an optional fetchImpl constructor param — tests pass vi.fn().

/** Returns a minimal PayPalOrder response shape. */
function makeOrder(overrides: Partial<{
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
}> = {}) {
  return {
    id: "ORDER-123",
    status: "CREATED" as const,
    purchase_units: [
      { amount: { currency_code: "USD", value: "500.00" }, custom_id: "{}" },
    ],
    links: [],
    ...overrides,
  };
}

/** Builds a two-call fetch mock: first call = OAuth token, second call = API response. */
function makeOAuthThenApi(apiResponse: unknown, apiStatus = 200): ReturnType<typeof vi.fn> {
  const oauthResp = new Response(
    JSON.stringify({ access_token: "AT", expires_in: 3600 }),
    { status: 200 },
  );
  const apiResp = new Response(JSON.stringify(apiResponse), { status: apiStatus });
  return vi.fn()
    .mockResolvedValueOnce(oauthResp)
    .mockResolvedValueOnce(apiResp);
}

describe("PayPalClient", () => {
  // ── Plan test 1: createOrder converts cents to decimal string ────────────────
  it("createOrder converts cents to decimal dollar string and sends Basic auth on OAuth call", async () => {
    const fetchMock = makeOAuthThenApi(makeOrder());
    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    await client.createOrder({ amount: 50000, metadata: {}, payerEmail: "a@b.co" });

    // OAuth call: Basic header and grant_type body
    const oauthInit = fetchMock.mock.calls[0][1] as RequestInit;
    const oauthHeaders = oauthInit.headers as Record<string, string>;
    expect(oauthHeaders["Authorization"]).toBe(`Basic ${btoa("cid:secret")}`);
    expect(oauthInit.body).toBe("grant_type=client_credentials");

    // API call: amount converted correctly
    const apiInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(apiInit.body as string);
    expect(body.purchase_units[0].amount.value).toBe("500.00");
    expect(body.purchase_units[0].amount.currency_code).toBe("USD");
  });

  // ── Plan test 2: createOrder encodes metadata as custom_id ──────────────────
  it("createOrder encodes metadata as JSON in custom_id", async () => {
    const fetchMock = makeOAuthThenApi(makeOrder());
    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    const metadata = { promoCode: "FOUNDING50", source: "shop-ossi" };
    await client.createOrder({ amount: 50000, metadata, payerEmail: "a@b.co" });

    const apiInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(apiInit.body as string);
    expect(body.purchase_units[0].custom_id).toBe(JSON.stringify(metadata));
  });

  // ── Controller test: Bearer header flows through to API call ────────────────
  it("call() passes Bearer access token on the API request after OAuth", async () => {
    const fetchMock = makeOAuthThenApi(makeOrder());
    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    await client.getOrder("ORDER-123");

    const apiInit = fetchMock.mock.calls[1][1] as RequestInit;
    const apiHeaders = apiInit.headers as Record<string, string>;
    expect(apiHeaders["Authorization"]).toBe("Bearer AT");
  });

  // ── Plan test 3: auth token is reused when not expired ──────────────────────
  it("reuses cached access token across consecutive calls (OAuth called only once)", async () => {
    const oauthResp = new Response(
      JSON.stringify({ access_token: "AT", expires_in: 3600 }),
      { status: 200 },
    );
    const apiResp1 = new Response(JSON.stringify(makeOrder()), { status: 200 });
    const apiResp2 = new Response(JSON.stringify(makeOrder({ id: "ORDER-456" })), { status: 200 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(oauthResp)
      .mockResolvedValueOnce(apiResp1)
      .mockResolvedValueOnce(apiResp2);

    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    await client.getOrder("ORDER-123");
    await client.getOrder("ORDER-456");

    // fetchMock called 3 times total: 1 OAuth + 2 API
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // First call is OAuth, second and third are API calls
    const call0Url = fetchMock.mock.calls[0][0] as string;
    const call1Url = fetchMock.mock.calls[1][0] as string;
    const call2Url = fetchMock.mock.calls[2][0] as string;
    expect(call0Url).toContain("/v1/oauth2/token");
    expect(call1Url).toContain("/v2/checkout/orders/ORDER-123");
    expect(call2Url).toContain("/v2/checkout/orders/ORDER-456");
  });

  // ── Plan test 4: verifyWebhookSignature returns true on SUCCESS ──────────────
  it("verifyWebhookSignature returns true when PayPal responds SUCCESS", async () => {
    const fetchMock = makeOAuthThenApi({ verification_status: "SUCCESS" });
    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    const ok = await client.verifyWebhookSignature({
      transmissionId: "tid",
      transmissionTime: "2026-01-01T00:00:00Z",
      certUrl: "https://api-m.sandbox.paypal.com/v1/notifications/certs/cert.pem",
      authAlgo: "SHA256withRSA",
      transmissionSig: "sig==",
      webhookId: "WH-001",
      rawBody: JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED" }),
    });

    expect(ok).toBe(true);
  });

  // ── Controller test: verifyWebhookSignature returns false on FAILURE ─────────
  it("verifyWebhookSignature returns false when PayPal responds FAILURE", async () => {
    const fetchMock = makeOAuthThenApi({ verification_status: "FAILURE" });
    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    const ok = await client.verifyWebhookSignature({
      transmissionId: "tid",
      transmissionTime: "2026-01-01T00:00:00Z",
      certUrl: "https://api-m.sandbox.paypal.com/v1/notifications/certs/cert.pem",
      authAlgo: "SHA256withRSA",
      transmissionSig: "badsig==",
      webhookId: "WH-001",
      rawBody: JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED" }),
    });

    expect(ok).toBe(false);
  });

  // ── Controller test: custom_id is truncated to 127 chars ────────────────────
  it("custom_id is truncated to at most 127 chars when metadata JSON exceeds that length", async () => {
    const fetchMock = makeOAuthThenApi(makeOrder());
    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);

    // Build metadata whose JSON is well over 127 chars
    const metadata: Record<string, string> = {
      promoCode: "FOUNDING50",
      source: "shop-ossi",
      affiliate: "some-very-long-affiliate-slug-that-pushes-past-the-limit",
      extra: "additional-data-to-make-it-even-longer-than-one-twenty-seven-characters",
    };
    const rawJson = JSON.stringify(metadata);
    expect(rawJson.length).toBeGreaterThan(127);

    await client.createOrder({ amount: 50000, metadata, payerEmail: "a@b.co" });

    const apiInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(apiInit.body as string);
    expect(body.purchase_units[0].custom_id.length).toBeLessThanOrEqual(127);
  });

  // ── call() throws on non-2xx ─────────────────────────────────────────────────
  it("call() throws with PayPal error message on non-2xx response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "AT", expires_in: 3600 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "ORDER_NOT_FOUND" }), { status: 404 }),
      );

    const client = new PayPalClient("sandbox", "cid", "secret", fetchMock as unknown as typeof fetch);
    await expect(client.getOrder("MISSING")).rejects.toThrow(/PayPal 404/);
  });
});
