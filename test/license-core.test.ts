import { describe, it, expect } from "vitest";
import { generateLicenseKey, buildLicenseRecord, issueLicense } from "../src/license-core";

// Crockford Base32 alphabet: 0-9, A-Z minus I, L, O, U.
// Regex character class: [0-9A-HJKMNP-TV-Z]
const CROCKFORD_RE = /^SHOP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe("generateLicenseKey", () => {
  it("matches SHOP-XXXX-XXXX-XXXX format with Crockford characters", () => {
    const key = generateLicenseKey();
    expect(key).toMatch(CROCKFORD_RE);
  });

  it("does not include ambiguous chars (I, L, O, U — Crockford exclusions)", () => {
    for (let i = 0; i < 200; i++) {
      const key = generateLicenseKey();
      // Strip the fixed "SHOP-" prefix and dashes before checking the character set.
      const chars = key.replace(/^SHOP-/, "").replace(/-/g, "");
      expect(chars).not.toMatch(/[ILOU]/);
    }
  });

  it("produces distinct keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add(generateLicenseKey());
    expect(keys.size).toBeGreaterThan(95);
  });
});

describe("buildLicenseRecord", () => {
  it("fills defaults", () => {
    const rec = buildLicenseRecord({ customer: "Acme", email: "a@b.co" });
    expect(rec.product).toBe("shop-os-foundation");
    expect(rec.entitlements).toEqual(["foundation"]);
    expect(rec.cancelled_at).toBeNull();
    expect(rec.activations).toBe(0);
    expect(rec.last_seen).toBeNull();
    expect(rec.valid_until).toBeNull();
    expect(rec.key).toMatch(CROCKFORD_RE);
  });

  it("respects metadata when provided", () => {
    const rec = buildLicenseRecord({
      customer: "Acme",
      email: "a@b.co",
      metadata: { paymentProvider: "stripe", paymentId: "cs_test_1", amount: 50000 },
    });
    expect(rec.metadata?.paymentProvider).toBe("stripe");
    expect(rec.metadata?.amount).toBe(50000);
    expect(rec.metadata?.paymentId).toBe("cs_test_1");
  });
});

describe("issueLicense collision handling", () => {
  it("throws after 3 collisions", async () => {
    const alwaysCollidingKv = {
      get: async () => "occupied",
      put: async () => {},
    } as unknown as KVNamespace;
    await expect(
      issueLicense(alwaysCollidingKv, { customer: "x", email: "x@y.z" })
    ).rejects.toThrow(/exhausted collision retries/);
  });
});
