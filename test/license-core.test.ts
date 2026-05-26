import { describe, it, expect } from "vitest";
import { generateLicenseKey, buildLicenseRecord, issueLicense, updateLicenseFlags, type LicenseRecord } from "../src/license-core";

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

describe("lifetime updates + cohort fields", () => {
  it("defaults lifetimeUpdates=false and cohort='' when not provided", () => {
    const rec = buildLicenseRecord({ customer: "Acme", email: "a@b.co" });
    expect(rec.lifetimeUpdates).toBe(false);
    expect(rec.cohort).toBe("");
  });

  it("respects explicit lifetimeUpdates and cohort inputs", () => {
    const rec = buildLicenseRecord({
      customer: "Acme",
      email: "a@b.co",
      lifetimeUpdates: true,
      cohort: "founding-50",
    });
    expect(rec.lifetimeUpdates).toBe(true);
    expect(rec.cohort).toBe("founding-50");
  });
});

describe("updateLicenseFlags", () => {
  function makeKv(initial: Record<string, string> = {}): KVNamespace {
    const store = new Map<string, string>(Object.entries(initial));
    return {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
    } as unknown as KVNamespace;
  }

  it("returns null when the key is not found", async () => {
    const kv = makeKv();
    const out = await updateLicenseFlags(kv, "SHOP-NOPE-NOPE-NOPE", { lifetimeUpdates: true });
    expect(out).toBeNull();
  });

  it("patches lifetimeUpdates and cohort independently", async () => {
    const seed: LicenseRecord = buildLicenseRecord({ customer: "x", email: "x@y.z" });
    const kv = makeKv({ [seed.key]: JSON.stringify(seed) });

    const after1 = await updateLicenseFlags(kv, seed.key, { lifetimeUpdates: true });
    expect(after1?.lifetimeUpdates).toBe(true);
    expect(after1?.cohort).toBe("");

    const after2 = await updateLicenseFlags(kv, seed.key, { cohort: "partner" });
    expect(after2?.lifetimeUpdates).toBe(true);
    expect(after2?.cohort).toBe("partner");
  });

  it("backfills defaults on records that predate the new fields", async () => {
    const legacy = {
      key: "SHOP-LEG1-LEG2-LEG3",
      customer: "old",
      email: "old@x.y",
      product: "shop-os-foundation",
      entitlements: ["foundation"],
      created_at: new Date().toISOString(),
      valid_until: null,
      cancelled_at: null,
      last_seen: null,
      activations: 0,
    } as unknown as LicenseRecord;
    const kv = makeKv({ [legacy.key]: JSON.stringify(legacy) });

    const after = await updateLicenseFlags(kv, legacy.key, { cohort: "beta" });
    expect(after?.cohort).toBe("beta");
    expect(after?.lifetimeUpdates).toBe(false);
  });
});
