/**
 * Shop OS License Server (Cloudflare Worker)
 *
 * Endpoints:
 *   GET  /                       -> health check
 *   GET  /admin                  -> admin dashboard UI (HTML page; auth happens client-side)
 *   GET  /validate?key=...       -> validate a license key (public)
 *   GET  /refresh?key=...        -> re-validate, bump last_seen (public, used by skills periodically)
 *   POST /issue                  -> issue a new license key (admin: requires bearer ADMIN_TOKEN)
 *   POST /revoke?key=...         -> revoke a license key (admin)
 *   GET  /list                   -> list all licenses (admin)
 *
 * Data lives in the LICENSES KV namespace, keyed by license-key string.
 * Each record:
 *   {
 *     key, customer, email, product, entitlements: string[],
 *     created_at, valid_until: string|null, cancelled_at: string|null,
 *     last_seen: string|null, activations: number
 *   }
 */

import { ADMIN_HTML } from "./admin-html.js";

interface Env {
  LICENSES: KVNamespace;
  ADMIN_TOKEN: string;
  SERVICE_NAME: string;
  SERVICE_VERSION: string;
}

interface LicenseRecord {
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
}

interface IssueRequest {
  customer: string;
  email: string;
  product?: string;
  entitlements?: string[];
  valid_until?: string | null;
}

// Crockford Base32 alphabet (no 0/O, 1/I, U).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const DEFAULT_PRODUCT = "shop-os-foundation";
const DEFAULT_ENTITLEMENTS = ["foundation"];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });

function generateLicenseKey(): string {
  // 12 random bytes => 96 bits of entropy. Encode the first 12 chars of Crockford
  // for a SHOP-XXXX-XXXX-XXXX shape (60 bits effective; plenty for license keys).
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += CROCKFORD[bytes[i] % 32];
  }
  return `SHOP-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function isExpired(record: LicenseRecord): boolean {
  if (!record.valid_until) return false;
  return new Date(record.valid_until).getTime() < Date.now();
}

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN) {
    return json({ error: "server misconfigured: ADMIN_TOKEN not set" }, 500);
  }
  if (auth !== expected) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

// ----- handlers -----

async function handleHealth(env: Env): Promise<Response> {
  return json({
    name: env.SERVICE_NAME ?? "shop-os-license-server",
    version: env.SERVICE_VERSION ?? "1.0.0",
    ok: true,
  });
}

async function handleValidate(url: URL, env: Env, bumpLastSeen: boolean): Promise<Response> {
  const key = url.searchParams.get("key");
  if (!key) return json({ valid: false, error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json({ valid: false, error: "not found" }, 404);

  if (record.cancelled_at) {
    return json({ valid: false, error: "revoked", cancelled_at: record.cancelled_at }, 403);
  }
  if (isExpired(record)) {
    return json({ valid: false, error: "expired", valid_until: record.valid_until }, 403);
  }

  if (bumpLastSeen) {
    record.last_seen = nowISO();
    record.activations = (record.activations ?? 0) + 1;
    await env.LICENSES.put(key, JSON.stringify(record));
  }

  return json({
    valid: true,
    customer: record.customer,
    product: record.product,
    entitlements: record.entitlements,
    valid_until: record.valid_until,
    activated_at: record.last_seen,
  });
}

async function handleIssue(request: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(request, env);
  if (adminCheck) return adminCheck;

  let body: IssueRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.customer || !body.email) {
    return json({ error: "customer and email are required" }, 400);
  }

  // Generate a unique key, retrying on the (astronomical) chance of collision.
  let key = generateLicenseKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.LICENSES.get(key);
    if (!existing) break;
    key = generateLicenseKey();
  }

  const record: LicenseRecord = {
    key,
    customer: body.customer,
    email: body.email,
    product: body.product ?? DEFAULT_PRODUCT,
    entitlements: body.entitlements ?? DEFAULT_ENTITLEMENTS,
    created_at: nowISO(),
    valid_until: body.valid_until ?? null,
    cancelled_at: null,
    last_seen: null,
    activations: 0,
  };
  await env.LICENSES.put(key, JSON.stringify(record));

  return json({ ok: true, license: record }, 201);
}

async function handleRevoke(request: Request, url: URL, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(request, env);
  if (adminCheck) return adminCheck;

  const key = url.searchParams.get("key");
  if (!key) return json({ error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json({ error: "not found" }, 404);
  if (record.cancelled_at) {
    return json({ ok: true, already_cancelled: true, cancelled_at: record.cancelled_at });
  }

  record.cancelled_at = nowISO();
  await env.LICENSES.put(key, JSON.stringify(record));
  return json({ ok: true, key, cancelled_at: record.cancelled_at });
}

async function handleList(request: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(request, env);
  if (adminCheck) return adminCheck;

  const list = await env.LICENSES.list({ limit: 1000 });
  const records: LicenseRecord[] = [];
  for (const k of list.keys) {
    const r = await env.LICENSES.get<LicenseRecord>(k.name, "json");
    if (r) records.push(r);
  }
  return json({ ok: true, count: records.length, licenses: records });
}

// ----- router -----

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    try {
      if (path === "/" && method === "GET") return handleHealth(env);
      if ((path === "/admin" || path === "/admin/") && method === "GET") {
        return new Response(ADMIN_HTML, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-frame-options": "DENY",
            "referrer-policy": "no-referrer",
          },
        });
      }
      if (path === "/validate" && method === "GET") return handleValidate(url, env, false);
      if (path === "/refresh" && method === "GET") return handleValidate(url, env, true);
      if (path === "/issue" && method === "POST") return handleIssue(request, env);
      if (path === "/revoke" && method === "POST") return handleRevoke(request, url, env);
      if (path === "/list" && method === "GET") return handleList(request, env);
      return json({ error: "not found", path, method }, 404);
    } catch (err) {
      return json({ error: "internal error", detail: String(err) }, 500);
    }
  },
};
