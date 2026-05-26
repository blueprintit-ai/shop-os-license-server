/**
 * license-core.ts
 *
 * License-core types and helpers — pure key/record builders plus KV-side-effect
 * functions (issue, markEmailSent). Handlers in index.ts (and future webhook
 * handlers in Tasks 7-11) import from here.
 *
 * Key-generation uses the Crockford Base32 alphabet (0-9 A-Z minus I, L, O, U)
 * and crypto.getRandomValues() for cryptographically-secure entropy.
 * Format: SHOP-XXXX-XXXX-XXXX (12 Crockford chars split into three groups of 4).
 */

// Crockford Base32: 0-9 + A-Z, excluding I, L, O, U. 32 characters.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface LicenseRecord {
  key: string;
  customer: string;
  email: string;
  product: string;
  entitlements: string[];
  created_at: string;
  valid_until: string | null;
  cancelled_at: string | null;
  last_seen: string | null;
  activations: number;
  metadata?: {
    paymentProvider?: "stripe" | "paypal";
    paymentId?: string;
    amount?: number; // cents (integer); use Math.round() if converting from decimal dollars
    promoCode?: string;
    affiliate?: string;
    discountAmount?: number; // cents (integer)
    welcomeEmailSentAt?: string | null;
  };
}

export interface IssueLicenseInput {
  customer: string;
  email: string;
  product?: string;
  entitlements?: string[];
  valid_until?: string | null;
  metadata?: LicenseRecord["metadata"];
}

/**
 * Generate a unique license key in SHOP-XXXX-XXXX-XXXX format.
 * Uses crypto.getRandomValues() for cryptographically-secure entropy.
 * Characters are drawn from the Crockford Base32 alphabet.
 */
export function generateLicenseKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += CROCKFORD[bytes[i] % 32];
  }
  return `SHOP-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/**
 * Build a LicenseRecord from input, populating all defaults.
 * Pure function — no KV access.
 */
export function buildLicenseRecord(input: IssueLicenseInput): LicenseRecord {
  return {
    key: generateLicenseKey(),
    customer: input.customer,
    email: input.email,
    product: input.product ?? "shop-os-foundation",
    entitlements: input.entitlements ?? ["foundation"],
    created_at: new Date().toISOString(),
    valid_until: input.valid_until ?? null,
    cancelled_at: null,
    last_seen: null,
    activations: 0,
    metadata: input.metadata,
  };
}

/**
 * Issue a new license: generate a unique key (with up to 3 collision retries),
 * write the record to KV, and return the saved record.
 *
 * Collision retries preserve the behavior of the original handleIssue in index.ts.
 * At 32^12 ~10^18 possible keys the retry path is effectively unreachable in production,
 * but we keep it for correctness.
 */
export async function issueLicense(
  kv: KVNamespace,
  input: IssueLicenseInput
): Promise<LicenseRecord> {
  const record = buildLicenseRecord(input);

  // Retry key generation on the vanishingly unlikely chance of collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await kv.get(record.key);
    if (!existing) break;
    if (attempt === 2) {
      throw new Error("issueLicense: exhausted collision retries");
    }
    record.key = generateLicenseKey();
  }

  await kv.put(record.key, JSON.stringify(record));
  return record;
}

/**
 * Stamp the welcomeEmailSentAt timestamp on an existing license record.
 * Called by Task 9/13 after the welcome email is dispatched.
 * No-op if the key is not found (safe to call idempotently).
 */
export async function markEmailSent(
  kv: KVNamespace,
  licenseKey: string
): Promise<void> {
  const raw = await kv.get(licenseKey);
  if (!raw) {
    console.warn(`markEmailSent: license key not found in KV: ${licenseKey}`);
    return;
  }
  const rec = JSON.parse(raw) as LicenseRecord;
  rec.metadata = {
    ...(rec.metadata ?? {}),
    welcomeEmailSentAt: new Date().toISOString(),
  };
  await kv.put(licenseKey, JSON.stringify(rec));
}
