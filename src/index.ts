/**
 * Blueprint OS License Server (Cloudflare Worker)
 *
 * Endpoints:
 *   GET  /                       -> health check
 *   GET  /admin                  -> admin dashboard UI (HTML page; auth happens client-side)
 *   GET  /validate?key=...       -> validate a license key (public)
 *   GET  /refresh?key=...        -> re-validate, bump last_seen (public, used by skills periodically)
 *   POST /issue                  -> issue a new license key (admin: requires bearer ADMIN_TOKEN)
 *   POST /admin/set-installer?key=...&installer=legacy|v2 -> choose which installer a customer's /install link serves (admin)
 *   POST /revoke?key=...         -> soft revoke (sets cancelled_at; record preserved) (admin)
 *   POST /delete?key=...         -> hard delete (wipes KV record + cached PDF) (admin)
 *   POST /delete-bulk            -> hard delete an array of keys (admin, max 200/call)
 *   POST /update-license?key=... -> patch lifetimeUpdates flags (admin)
 *   GET  /list                   -> list all licenses (admin)
 *
 * Data lives in the LICENSES KV namespace, keyed by license-key string.
 * Each record:
 *   {
 *     key, customer, email, product,
 *     created_at, valid_until: string|null, cancelled_at: string|null,
 *     last_seen: string|null, activations: number
 *   }
 */

import { ADMIN_HTML } from "./admin-html.js";
import { INSTALLS_HTML } from "./installs-html.js";
import { LicenseRecord, IssueLicenseInput, issueLicense, updateLicenseFlags } from "./license-core.js";
import { StripeClient } from "./payments/stripe.js";
import { PayPalClient } from "./payments/paypal.js";
import { validateCoupon, BASE_PRICE_CENTS } from "./payments/coupon.js";
import { handleStripeWebhook } from "./handlers/stripe-webhook.js";
import { handlePayPalWebhook } from "./handlers/paypal-webhook.js";
import { handlePaymentSuccess, renderWelcomePdfBytes, sendWelcomeEmailForLicense } from "./handlers/payment-success.js";
import { welcomeHtml, welcomeText } from "./email/welcome-template.js";
import { type InstallerKind, buildInstallPage, buildInvalidKeyPage, buildMacCommand, buildWindowsBat, buildZipWithExecutable } from "./install-page.js";

export interface Env {
  LICENSES: KVNamespace;
  ADMIN_TOKEN: string;
  // "v2" makes records without an installer flag get the v2 installer.
  // Unset (the default, and not in wrangler.toml) means legacy.
  DEFAULT_INSTALLER?: string;
  SERVICE_NAME: string;
  SERVICE_VERSION: string;

  // Assets binding — always present once [assets] is configured in wrangler.toml.
  ASSETS: Fetcher;

  // Browser Rendering for per-customer PDF generation
  BROWSER: Fetcher;

  // Stripe (test mode for now; production keys added in Task 25)
  STRIPE_SECRET_KEY_TEST?: string;
  STRIPE_WEBHOOK_SECRET_TEST?: string;
  STRIPE_PRICE_ID_TEST?: string; // public price ID used by checkout session creation (Task 12)

  // Stripe production stubs (activated in Task 25 cutover)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;

  // Per-product Stripe price IDs (live values via `wrangler secret put`).
  // FOUNDATION falls back to the legacy STRIPE_PRICE_ID / *_TEST for backward
  // compat with the existing /blueprint-os flow if the new secret isn't set.
  // CONSULTATION has no legacy fallback; required for /products consultation buys.
  STRIPE_PRICE_ID_FOUNDATION?: string;
  STRIPE_PRICE_ID_CONSULTATION?: string;
  STRIPE_PRICE_ID_LEAD_HANDLER?: string;
  STRIPE_PRICE_ID_BUNDLE?: string;
  STRIPE_PRICE_ID_AI_ASSISTANT?: string;

  // Calendly booking URL sent in the consultation welcome email
  CALENDLY_CONSULTATION_URL?: string;
  // Calendly booking URL for the Foundation setup + training sessions
  CALENDLY_SETUP_URL?: string;
  // Calendly booking URLs for the per-product install calls (public; set in wrangler.toml [vars])
  CALENDLY_LEAD_HANDLER_URL?: string;
  CALENDLY_AI_ASSISTANT_URL?: string;

  // PayPal
  PAYPAL_CLIENT_ID_TEST?: string;
  PAYPAL_CLIENT_SECRET_TEST?: string;
  PAYPAL_WEBHOOK_ID_TEST?: string;
  PAYPAL_ENV?: "sandbox" | "live" | string; // allow runtime values outside the union

  // PayPal production stubs (activated in Task 25 cutover)
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;

  // Resend
  RESEND_API_KEY?: string;
}

// InstallLog is written by the Windows/Mac installer on success or error.
// Keyed in KV as install-log:{licenseKey}:{timestamp_ms}, TTL 180 days.
interface InstallLog {
  license_key: string;
  timestamp: string;
  // success/error/retry/progress arrive via POST /install-log from the installers;
  // page_view/download are written internally by the funnel routes so the
  // admin view shows the whole journey per key.
  status: "success" | "error" | "retry" | "progress" | "page_view" | "download";
  error_message?: string;
  step?: string;
  machine?: { os?: string; ps_version?: string; username?: string; source?: string };
  // v2 installer diagnostics (all optional; old installers never send them)
  run_id?: string;
  support_code?: string;
  step_title?: string;
  command?: string;
  exit_code?: number;
  output_tail?: string;
  hint?: string;
  duration_ms?: number;
  installer_version?: string;
  truncated?: boolean;
  notes?: string[];
  timeline?: Record<string, unknown>[];
  snapshot?: Record<string, unknown>;
}

const MAX_LOG_BYTES = 32 * 1024;
const byteLen = (s: string) => new TextEncoder().encode(s).length;
const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const put = <T extends object>(o: T, k: string, v: unknown) => { if (v !== undefined) (o as any)[k] = v; };

// Keep only the timeline fields the installer's step runner produces, capped.
function cleanTimelineEntry(e: unknown): Record<string, unknown> | undefined {
  if (!isObj(e)) return undefined;
  const out: Record<string, unknown> = {};
  put(out, "id", str(e.id, 80));
  put(out, "title", str(e.title, 160));
  put(out, "status", str(e.status, 20));
  put(out, "attempts", num(e.attempts));
  put(out, "durationMs", num(e.durationMs));
  put(out, "error", str(e.error, 600));
  put(out, "command", str(e.command, 300));
  put(out, "exitCode", num(e.exitCode));
  put(out, "outTail", str(e.outTail, 1500));
  put(out, "hint", str(e.hint, 300));
  if (e.retried === true) out.retried = true;
  return out;
}

async function handleInstallLog(req: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }
  if (!isObj(body) || typeof body.license_key !== "string" || !body.license_key.trim() || !body.status || !["success", "error", "retry", "progress"].includes(body.status)) {
    return json(req, { error: "license_key and status are required (success | error | retry | progress)" }, 400);
  }
  const timestamp = new Date().toISOString();
  const log: InstallLog = { license_key: body.license_key.trim().slice(0, 64), timestamp, status: body.status };
  put(log, "error_message", str(body.error_message, 4000));
  put(log, "step", str(body.step, 120));
  if (isObj(body.machine)) {
    const m: Record<string, string> = {};
    for (const k of ["os", "ps_version", "username", "source"]) { const v = str(body.machine[k], 120); if (v) m[k] = v; }
    log.machine = m;
  }
  if (body.truncated === true) log.truncated = true;
  put(log, "run_id", str(body.run_id, 64));
  put(log, "support_code", str(body.support_code, 16));
  put(log, "step_title", str(body.step_title, 160));
  put(log, "command", str(body.command, 1000));
  put(log, "exit_code", num(body.exit_code));
  put(log, "output_tail", str(body.output_tail, 6000));
  put(log, "hint", str(body.hint, 300));
  put(log, "duration_ms", num(body.duration_ms));
  put(log, "installer_version", str(body.installer_version, 20));
  if (Array.isArray(body.notes)) {
    const notes = body.notes.filter((n: unknown) => typeof n === "string" && n).slice(0, 10).map((n: string) => n.slice(0, 300));
    if (notes.length) log.notes = notes;
  }
  if (Array.isArray(body.timeline)) {
    log.timeline = body.timeline.slice(0, 30).map(cleanTimelineEntry).filter((e: Record<string, unknown> | undefined): e is Record<string, unknown> => !!e && Object.keys(e).length > 0);
  }
  if (isObj(body.snapshot)) log.snapshot = body.snapshot;

  // Hard ceiling: shed the bulkiest parts first so the headline fields always survive.
  const fits = () => byteLen(JSON.stringify(log)) <= MAX_LOG_BYTES;
  if (!fits() && log.timeline) log.timeline = log.timeline.map(({ outTail, ...rest }) => rest);
  if (!fits()) delete log.snapshot;
  if (!fits()) delete log.timeline;
  if (!fits()) { log.output_tail = log.output_tail?.slice(-2000); log.error_message = log.error_message?.slice(0, 1500); }
  if (!fits()) { delete log.notes; delete log.command; }
  const stored = JSON.stringify(log);
  // Progress is chatty (~10-15 entries per run): short TTL keeps the 1000-key list windows usable.
  const ttlDays = log.status === "progress" ? 7 : 180;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  await env.LICENSES.put(`install-log:${log.license_key}:${Date.now()}:${rand}`, stored, { expirationTtl: ttlDays * 24 * 60 * 60 });
  if (log.status === "error" && log.run_id) {
    try {
      const marker = `install-alert-now:${log.license_key}:${log.run_id}`;
      if (!(await env.LICENSES.get(marker)) && (await immediateAlertAllowed(env, log.license_key))) {
        const ok = await sendInstallAlert(env, `Blueprint OS install failed: ${log.support_code ?? log.license_key} (${log.step_title ?? log.step ?? "unknown step"})`, buildInstallAlertText(log, log.license_key));
        if (ok) await env.LICENSES.put(marker, "1", { expirationTtl: 7 * 24 * 3600 });
      }
    } catch { /* an alert problem never fails the report */ }
  }
  return json(req, { ok: true, logged_at: timestamp });
}

// Internal funnel event writer. Shares the install-log:{key}:{ts} shape so
// the admin install-logs view shows page views and downloads inline with
// install outcomes. Best-effort: a KV hiccup must never affect the response.
async function logFunnelEvent(
  env: Env,
  licenseKey: string,
  status: "page_view" | "download",
  step?: string,
): Promise<void> {
  try {
    const log: InstallLog = {
      license_key: licenseKey,
      timestamp: new Date().toISOString(),
      status,
      ...(step ? { step } : {}),
    };
    await env.LICENSES.put(`install-log:${licenseKey}:${Date.now()}`, JSON.stringify(log), {
      expirationTtl: 180 * 24 * 60 * 60,
    });
  } catch {
    // best-effort
  }
}

// Beacon hit by the /bp-setup skill (via WebFetch — curl isn't on the vault
// permission allowlist) when the onboarding interview completes. Records a
// success/bp_setup_complete event so the dashboard distinguishes "installed"
// from "onboarded". GET because WebFetch can't POST; the key alone is the
// credential, same as every other public license endpoint.
async function handleSetupComplete(req: Request, url: URL, env: Env): Promise<Response> {
  const res = await resolveInstallLicense(env, url.searchParams.get("key"));
  if (!res.ok) return json(req, { ok: false, error: res.reason }, 404);
  const log: InstallLog = {
    license_key: res.key,
    timestamp: new Date().toISOString(),
    status: "success",
    step: "bp_setup_complete",
    machine: { source: "bp-setup" },
  };
  await env.LICENSES.put(`install-log:${res.key}:${Date.now()}`, JSON.stringify(log), {
    expirationTtl: 180 * 24 * 60 * 60,
  });
  return json(req, { ok: true });
}

// Public, boolean-only: has this key ever reported a successful install?
// Polled by the /install page to flip to its success state. Reveals nothing
// beyond what holding the key already grants.
async function handleInstallStatus(req: Request, url: URL, env: Env): Promise<Response> {
  const key = (url.searchParams.get("key") || "").trim().toUpperCase();
  if (!key) return json(req, { error: "key required" }, 400);
  const list = await env.LICENSES.list({ prefix: `install-log:${key}:`, limit: 1000 });
  for (const k of [...list.keys].reverse()) {
    const entry = await env.LICENSES.get<InstallLog>(k.name, "json");
    if (entry?.status === "success") {
      return json(req, { installed: true, at: entry.timestamp });
    }
  }
  return json(req, { installed: false });
}

const ADMIN_INSTALLS_URL = "https://shop-os-license-server.glenn-15d.workers.dev/admin/installs";

// Everything in an InstallLog except license_key/timestamp/status comes from an
// unauthenticated endpoint. Flatten control characters (CR/LF would let a
// stored value forge extra header-like lines) and cap the length.
const oneLine = (v: unknown, max = 300): string =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const multiLine = (v: unknown, max = 6000): string =>
  String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
const escHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildInstallAlertText(log: InstallLog, licRaw: string, extra: { hungMinutes?: number } = {}): string {
  const lic = oneLine(licRaw, 64);
  const snap = (isObj(log.snapshot) ? log.snapshot : {}) as Record<string, unknown>;
  const title = oneLine(log.step_title), step = oneLine(log.step);
  const retried = (Array.isArray(log.timeline) ? log.timeline : []).filter((e) => isObj(e) && e.retried === true);
  const notes = (Array.isArray(log.notes) ? log.notes : []).map((n) => oneLine(n)).filter(Boolean);
  const os = oneLine(log.machine?.os ?? snap.os) || "unknown";
  const lines = [
    extra.hungMinutes != null
      ? `A Blueprint OS install for ${lic} may be HUNG: last report was ${extra.hungMinutes} minutes ago and nothing came after it.`
      : `A Blueprint OS install for ${lic} failed.`,
    ``,
    ...(log.support_code ? [`Support code: ${oneLine(log.support_code)}`] : []),
    `Step:  ${title || step || "unknown"}${title && step ? ` (${step})` : ""}`,
    ...(log.error_message ? [`Error: ${oneLine(log.error_message, 1500)}`] : []),
    ...(log.hint ? [`Looks like: ${oneLine(log.hint)}`] : []),
    ...(log.command ? [`Command: ${oneLine(log.command, 1000)}${log.exit_code != null ? `  (exit ${oneLine(log.exit_code, 12)})` : ""}`] : []),
    ...(log.output_tail ? [``, `Last output:`, multiLine(log.output_tail)] : []),
    ...(retried.length
      ? [``, `Retried steps:`, ...retried.map((e) => {
          const n = typeof e.attempts === "number" && e.attempts > 1 ? e.attempts - 1 : 1;
          return `- ${oneLine(e.title ?? e.id, 160) || "unknown"}: retried ${n} time${n === 1 ? "" : "s"}`;
        })]
      : []),
    ...(notes.length ? [``, `Notes:`, ...notes.map((n) => `- ${n}`)] : []),
    ``,
    `When:  ${oneLine(log.timestamp, 40)}`,
    `OS:    ${os} (${oneLine(log.machine?.source) || "installer"})`,
    ...(snap.node ? [`Node:  ${oneLine(snap.node, 40)}`] : []),
    ...(snap.git !== undefined ? [`Git:   ${snap.git === true ? "present" : snap.git === false ? "absent" : oneLine(snap.git, 40)}`] : []),
    ...(snap.elevated !== undefined ? [`Admin: ${snap.elevated === true ? "yes" : snap.elevated === false ? "no" : oneLine(snap.elevated, 40)}`] : []),
    ...(log.duration_ms != null ? [`Ran for: ${Math.round(log.duration_ms / 1000)}s`] : []),
    ...(log.installer_version ? [`Installer: v${oneLine(log.installer_version, 20)}`] : []),
    ``,
    `Full step timeline: ${ADMIN_INSTALLS_URL}${log.run_id ? `?run=${encodeURIComponent(oneLine(log.run_id, 64))}` : ""}`,
  ];
  return lines.join("\n");
}

// The report endpoint is unauthenticated: only email immediately for a real
// license and under a small global hourly cap. Otherwise the sweep covers it.
const IMMEDIATE_ALERT_HOURLY_CAP = 10;
async function immediateAlertAllowed(env: Env, licenseKey: string): Promise<boolean> {
  const record = await env.LICENSES.get(licenseKey.toUpperCase(), "json");
  if (!record) return false;
  const capKey = `install-alert-cap:${new Date().toISOString().slice(0, 13)}`;
  const n = Number((await env.LICENSES.get(capKey)) ?? 0) || 0;
  if (n >= IMMEDIATE_ALERT_HOURLY_CAP) return false;
  await env.LICENSES.put(capKey, String(n + 1), { expirationTtl: 2 * 3600 });
  return true;
}

// Sends the text as plain text plus an escaped HTML twin (clients that render
// HTML show the stored values as literal text, never as markup).
async function sendInstallAlert(env: Env, subject: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Blueprint.ai <glenn@blueprintit.ai>",
        to: "glenn@blueprintit.ai",
        subject: oneLine(subject, 200),
        text,
        html: `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap">${escHtml(text)}</pre>`,
      }),
    });
    return resp.ok;
  } catch { return false; }
}

// KV list() returns at most 1000 keys per call; follow the cursor (bounded).
async function listAllKeys(env: Env, prefix: string, maxPages = 25, counter?: { ops: number }): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    if (counter) counter.ops++;
    const res = await env.LICENSES.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) }) as { keys: { name: string }[]; list_complete?: boolean; cursor?: string };
    for (const k of res.keys) names.push(k.name);
    if (res.list_complete !== false || !res.cursor) break;
    cursor = res.cursor;
  }
  return names;
}
// install-log:{key}:{ms}[:{rand}] -> ms
const keyTs = (name: string): number => Number(name.split(":")[2]);

// Failure sweep: for every license with an install error that is 30min-24h
// old and has no later success, send one ops alert email (deduped per error
// via an install-alert marker, 7-day TTL). Also flags runs that look hung: the
// latest report is a `progress` older than 30 min (a run that ended in
// success/error is never hung; the launch step sends no progress report).
// Runs on the cron trigger and via POST /admin/run-failure-sweep.
const SWEEP_KV_BUDGET = 800;
async function sweepFailedInstalls(env: Env): Promise<{ checked: number; alerts: number; truncated: boolean }> {
  if (!env.RESEND_API_KEY) return { checked: 0, alerts: 0, truncated: false };
  const now = Date.now();
  // Workers cap subrequests (1000); count every KV operation and stop cleanly.
  const budget = { ops: 0 };
  const left = () => SWEEP_KV_BUDGET - budget.ops;
  const names = await listAllKeys(env, "install-log:", 25, budget);
  const byKey = new Map<string, { ts: number; name: string }[]>();
  for (const name of names) {
    const parts = name.split(":");
    if (parts.length < 3) continue;
    const ts = Number(parts[2]);
    if (!Number.isFinite(ts)) continue;
    const lic = parts[1];
    if (lic === "unknown") continue;
    if (now - ts > 24 * 3600e3) continue;
    if (!byKey.has(lic)) byKey.set(lic, []);
    byKey.get(lic)!.push({ ts, name });
  }
  for (const e of byKey.values()) e.sort((a, b) => a.ts - b.ts);
  // Newest activity first so the freshest installs are served if the budget runs out.
  const ordered = [...byKey.entries()].sort((a, b) => b[1][b[1].length - 1].ts - a[1][a[1].length - 1].ts);
  let alerts = 0;
  let truncated = false;
  for (const [lic, entries] of ordered) {
    // loads + up to 2 marker gets + 2 puts
    if (left() < 8) { truncated = true; break; }
    const take = Math.min(200, entries.length, left() - 6);
    if (take < entries.length) truncated = true;
    budget.ops += take;
    // Progress entries are written ~10-15 per run; load the last 24h (bounded) and
    // drop progress before applying the 20-entry window.
    const all = await Promise.all(
      entries.slice(-take).map(async (e) => ({ ts: e.ts, log: await env.LICENSES.get<InstallLog>(e.name, "json").catch(() => null) })),
    );
    const present = all.filter((l) => l.log);
    const loaded = present.filter((l) => l.log!.status !== "progress").slice(-20);

    // Hung run: the newest install report (ignoring funnel page_view/download) is a
    // mid-run report (progress, or a retry from the step runner).
    const lastReport = [...present].reverse().find((l) => ["progress", "success", "error", "retry"].includes(l.log!.status));
    if (lastReport && (lastReport.log!.status === "progress" || lastReport.log!.status === "retry") && now - lastReport.ts >= 30 * 60e3) {
      const marker = `install-alert-hung:${lic}:${lastReport.ts}`;
      budget.ops++;
      if (!(await env.LICENSES.get(marker))) {
        const minutes = Math.round((now - lastReport.ts) / 60e3);
        const lg = lastReport.log!;
        const sub = `Blueprint OS install may be stuck: ${lg.support_code ?? lic} (${lg.step_title ?? lg.step ?? "unknown step"})`;
        budget.ops += 2;
        if (await sendInstallAlert(env, sub, buildInstallAlertText(lg, lic, { hungMinutes: minutes }))) {
          await env.LICENSES.put(marker, "1", { expirationTtl: 7 * 24 * 3600 });
          alerts++;
        }
      }
    }

    const errors = loaded.filter((l) => l.log?.status === "error" && now - l.ts >= 30 * 60e3);
    if (errors.length === 0) continue;
    const lastError = errors[errors.length - 1];
    if (loaded.some((l) => l.log?.status === "success" && l.ts > lastError.ts)) continue;
    const log = lastError.log!;
    // v2 errors are emailed immediately; the sweep is the safety net if that email failed.
    if (log.run_id) { budget.ops++; if (await env.LICENSES.get(`install-alert-now:${lic}:${log.run_id}`)) continue; }
    const marker = `install-alert:${lic}:${lastError.ts}`;
    budget.ops++;
    if (await env.LICENSES.get(marker)) continue;
    const subject = `Blueprint OS install failed: ${log.support_code ?? lic} (${log.step_title ?? log.step ?? "unknown step"})`;
    const text = buildInstallAlertText(log, lic) + `\n\nSuggested move: email the customer their booking link before they email you.`;
    budget.ops += 2;
    if (await sendInstallAlert(env, subject, text)) {
      await env.LICENSES.put(marker, "1", { expirationTtl: 7 * 24 * 3600 });
      alerts++;
    }
  }
  return { checked: byKey.size, alerts, truncated };
}

async function handleAdminInstallLogs(req: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;
  const url = new URL(req.url);
  const filterKey = url.searchParams.get("key");
  const prefix = filterKey ? `install-log:${filterKey}:` : "install-log:";
  // Key order is by license, not by time, so a plain list()+limit hides recent
  // entries once volume grows. List every key (paginated), newest first, then
  // load until we have 500 entries or hit the per-request read budget.
  const names = (await listAllKeys(env, prefix)).filter((n) => Number.isFinite(keyTs(n))).sort((a, b) => keyTs(b) - keyTs(a));
  const logs: InstallLog[] = [];
  let reads = 0;
  let counted = 0;
  for (let i = 0; i < names.length && counted < 500 && reads < 900; i += 50) {
    const chunk = names.slice(i, i + 50);
    reads += chunk.length;
    for (const entry of await Promise.all(chunk.map((n) => env.LICENSES.get<InstallLog>(n, "json")))) if (entry) { logs.push(entry); if (entry.status !== "progress") counted++; }
  }
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  // Progress is chatty: keep only the newest progress per license, and only while
  // nothing newer (success/error) exists for it, so the page shows "in progress" runs.
  const newestFinal = new Map<string, number>();
  for (const l of logs) if (l.status === "success" || l.status === "error") {
    const t = new Date(l.timestamp).getTime();
    if (!newestFinal.has(l.license_key) || newestFinal.get(l.license_key)! < t) newestFinal.set(l.license_key, t);
  }
  const seenProgress = new Set<string>();
  const out = logs.filter((l) => {
    if (l.status !== "progress") return true;
    if (seenProgress.has(l.license_key)) return false;
    seenProgress.add(l.license_key);
    return !(newestFinal.get(l.license_key)! >= new Date(l.timestamp).getTime());
  }).slice(0, 500);
  return json(req, { ok: true, count: out.length, logs: out });
}

// IssueRequest is the shape of the admin POST /issue JSON body.
// IssueLicenseInput (from license-core) is a superset; we parse into this
// leaner type so the handler stays explicit about what the HTTP API accepts.
interface IssueRequest {
  customer: string;
  email: string;
  product?: string;
  valid_until?: string | null;
  lifetimeUpdates?: boolean;
}

// ----- CORS -----

const ALLOWED_ORIGINS = new Set([
  "https://blueprintit.ai",
  "https://www.blueprintit.ai",
  "http://localhost:5173", // Vite dev
  "http://localhost:3000", // alt dev port
]);

// Match any Vercel preview deployment of the blueprint-it-website project.
// Hashes change per deploy; pattern stays stable.
const VERCEL_PREVIEW_RE = /^https:\/\/blueprint-it-website-[a-z0-9-]+\.vercel\.app$/;

function originAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin) || VERCEL_PREVIEW_RE.test(origin);
}

// Base URL for post-checkout redirects (Stripe success_url / cancel_url).
// Mirrors the requester's origin so localhost dev, Vercel preview, and
// production all redirect back to the same surface the buyer started on.
// Falls back to the production site for unknown / missing origins.
function redirectBase(req: Request): string {
  const origin = req.headers.get("Origin") ?? "";
  return originAllowed(origin) ? origin : "https://blueprintit.ai";
}

// Full preflight response headers (OPTIONS only).
function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Minimal CORS headers for actual (non-preflight) JSON responses.
// Omits preflight-only fields (Allow-Methods, Allow-Headers, Max-Age).
function corsResponseHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = { Vary: "Origin" };
  if (originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// ----- helpers -----

function json(req: Request, body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsResponseHeaders(req),
    },
  });
}

function nowISO(): string {
  return new Date().toISOString();
}

function isExpired(record: LicenseRecord): boolean {
  if (!record.valid_until) return false;
  return new Date(record.valid_until).getTime() < Date.now();
}

async function requireAdmin(req: Request, env: Env): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN) {
    return json(req, { error: "server misconfigured: ADMIN_TOKEN not set" }, 500);
  }
  if (auth !== expected) {
    return json(req, { error: "unauthorized" }, 401);
  }
  return null;
}

function getStripe(env: Env): StripeClient {
  const key = env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY_TEST;
  if (!key) throw new Error("No Stripe secret key configured.");
  return new StripeClient(key);
}

function getPayPal(env: Env): PayPalClient {
  const envType = (env.PAYPAL_ENV ?? "sandbox") as "sandbox" | "live";
  const cid = env.PAYPAL_CLIENT_ID ?? env.PAYPAL_CLIENT_ID_TEST;
  const sec = env.PAYPAL_CLIENT_SECRET ?? env.PAYPAL_CLIENT_SECRET_TEST;
  if (!cid || !sec) throw new Error("PayPal credentials not configured.");
  return new PayPalClient(envType, cid, sec);
}

// ----- handlers -----

async function handleHealth(req: Request, env: Env): Promise<Response> {
  return json(req, {
    name: env.SERVICE_NAME ?? "shop-os-license-server",
    version: env.SERVICE_VERSION ?? "1.0.0",
    ok: true,
  });
}

async function handleValidate(req: Request, url: URL, env: Env, bumpLastSeen: boolean): Promise<Response> {
  const key = url.searchParams.get("key");
  if (!key) return json(req, { valid: false, error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json(req, { valid: false, error: "not found" }, 404);

  if (record.cancelled_at) {
    return json(req, { valid: false, error: "revoked", cancelled_at: record.cancelled_at }, 403);
  }
  if (isExpired(record)) {
    return json(req, { valid: false, error: "expired", valid_until: record.valid_until }, 403);
  }

  if (bumpLastSeen) {
    record.last_seen = nowISO();
    record.activations = (record.activations ?? 0) + 1;
    await env.LICENSES.put(key, JSON.stringify(record));
  }

  return json(req, {
    valid: true,
    customer: record.customer,
    product: record.product,
    // Legacy compat: some deployed installs may read `entitlements` from the
    // /validate response. Licenses no longer store it; emit the static
    // default every Foundation license always had.
    entitlements: ["foundation"],
    valid_until: record.valid_until,
    activated_at: record.last_seen,
  });
}

// ----- Self install: personalized install page + per-customer installer files -----

async function resolveInstallLicense(
  env: Env,
  keyRaw: string | null,
): Promise<{ ok: true; key: string; customer: string; installer: InstallerKind } | { ok: false; reason: string }> {
  const key = (keyRaw || "").trim().toUpperCase();
  if (!key) return { ok: false, reason: "This link is missing its license key." };
  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return { ok: false, reason: "We could not find a license for this link. Check that the full link from your welcome email was used." };
  if (record.cancelled_at) return { ok: false, reason: "This license has been revoked." };
  if (isExpired(record)) return { ok: false, reason: "This license has expired." };
  return { ok: true, key, customer: record.customer, installer: record.installer === "v2" || record.installer === "legacy" ? record.installer : env.DEFAULT_INSTALLER === "v2" ? "v2" : "legacy" };
}

async function handleInstallPage(req: Request, url: URL, env: Env): Promise<Response> {
  const res = await resolveInstallLicense(env, url.searchParams.get("key"));
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...corsResponseHeaders(req) };
  if (!res.ok) return new Response(buildInvalidKeyPage(res.reason), { status: 404, headers });
  const bookingUrl = env.CALENDLY_SETUP_URL ?? env.CALENDLY_CONSULTATION_URL ?? "https://calendly.com/blueprintit/shop-os-foundation-setup";
  await logFunnelEvent(env, res.key, "page_view", "install_page");
  return new Response(buildInstallPage({ key: res.key, customer: res.customer }, bookingUrl), { status: 200, headers });
}

async function handleInstallScript(req: Request, url: URL, env: Env): Promise<Response> {
  const res = await resolveInstallLicense(env, url.searchParams.get("key"));
  if (!res.ok) return json(req, { error: res.reason }, 404);
  const os = (url.searchParams.get("os") || "").toLowerCase();
  if (os !== "mac" && os !== "windows") return json(req, { error: "os must be 'mac' or 'windows'" }, 400);
  const info = { key: res.key, customer: res.customer };
  // Hand the starters this Worker's origin only when it is https; otherwise
  // (e.g. local dev) omit it and the starters use their built-in default.
  const v2 = url.protocol === "https:" ? { licenseServer: url.origin } : {};
  if (res.installer === "v2" && !v2.licenseServer) console.warn(`install-script: non-https origin ${url.origin}; v2 file omits SHOPOS_LICENSE_SERVER`);
  let mac: string, win: string;
  try {
    mac = os === "mac" ? buildMacCommand(info, res.installer, v2) : "";
    win = os === "windows" ? buildWindowsBat(info, res.installer, v2) : "";
  } catch (e) {
    console.warn(`install-script: v2 refused for ${res.key}: ${e instanceof Error ? e.message : e}`);
    return json(req, { error: "this license cannot be served by the v2 installer" }, 400);
  }
  await logFunnelEvent(env, res.key, "download", os);
  if (os === "mac") {
    // Zip so the .command keeps its execute bit — a bare download has none
    // and macOS refuses to run it ("appropriate access privileges").
    const zip = buildZipWithExecutable("Install Blueprint OS.command", mac);
    return new Response(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="Install Blueprint OS.zip"',
        "Cache-Control": "no-store",
        ...corsResponseHeaders(req),
      },
    });
  }
  return new Response(win, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Install Blueprint OS.bat"',
      "Cache-Control": "no-store",
      ...corsResponseHeaders(req),
    },
  });
}

async function handleIssue(req: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  let body: IssueRequest;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid JSON body" }, 400);
  }
  if (!body.customer || !body.email) {
    return json(req, { error: "customer and email are required" }, 400);
  }

  const input: IssueLicenseInput = {
    customer: body.customer,
    email: body.email,
    product: body.product,
    valid_until: body.valid_until,
    lifetimeUpdates: body.lifetimeUpdates,
  };
  const record = await issueLicense(env.LICENSES, input);

  return json(req, { ok: true, license: record }, 201);
}

async function handleUpdateLicense(req: Request, url: URL, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  const key = url.searchParams.get("key");
  if (!key) return json(req, { error: "missing key" }, 400);

  let body: { lifetimeUpdates?: boolean };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid JSON body" }, 400);
  }

  const patch: { lifetimeUpdates?: boolean } = {};
  if (typeof body.lifetimeUpdates === "boolean") patch.lifetimeUpdates = body.lifetimeUpdates;
  if (Object.keys(patch).length === 0) {
    return json(req, { error: "no updatable fields provided" }, 400);
  }

  const updated = await updateLicenseFlags(env.LICENSES, key, patch);
  if (!updated) return json(req, { error: "not found" }, 404);
  return json(req, { ok: true, license: updated });
}

async function handleSetInstaller(req: Request, url: URL, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;
  const key = (url.searchParams.get("key") || "").trim().toUpperCase();
  const installer = url.searchParams.get("installer");
  if (!key) return json(req, { error: "missing key" }, 400);
  if (installer !== "legacy" && installer !== "v2") return json(req, { error: "installer must be 'legacy' or 'v2'" }, 400);
  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json(req, { error: "not found" }, 404);
  record.installer = installer;
  await env.LICENSES.put(key, JSON.stringify(record));
  return json(req, { ok: true, key, installer });
}

async function handleRevoke(req: Request, url: URL, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  const key = url.searchParams.get("key");
  if (!key) return json(req, { error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json(req, { error: "not found" }, 404);
  if (record.cancelled_at) {
    return json(req, { ok: true, already_cancelled: true, cancelled_at: record.cancelled_at });
  }

  record.cancelled_at = nowISO();
  await env.LICENSES.put(key, JSON.stringify(record));
  return json(req, { ok: true, key, cancelled_at: record.cancelled_at });
}

async function handleDelete(req: Request, url: URL, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  const key = url.searchParams.get("key");
  if (!key) return json(req, { error: "missing key" }, 400);

  const record = await env.LICENSES.get<LicenseRecord>(key, "json");
  if (!record) return json(req, { error: "not found" }, 404);

  await env.LICENSES.delete(key);
  await env.LICENSES.delete(`pdf:welcome:${key}`);
  return json(req, { ok: true, key, deleted: true });
}

async function handleDeleteBulk(req: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  let body: { keys?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    return json(req, { error: "keys must be a non-empty array" }, 400);
  }
  if (body.keys.length > 200) {
    return json(req, { error: "max 200 keys per call" }, 400);
  }

  const results: Array<{ key: string; deleted: boolean; error?: string }> = [];
  let deleted = 0;
  let missing = 0;
  for (const raw of body.keys as unknown[]) {
    const key = typeof raw === "string" ? raw : String(raw);
    if (!key.startsWith("SHOP-")) {
      results.push({ key, deleted: false, error: "invalid key format" });
      continue;
    }
    try {
      const record = await env.LICENSES.get<LicenseRecord>(key, "json");
      if (!record) {
        results.push({ key, deleted: false, error: "not found" });
        missing++;
        continue;
      }
      await env.LICENSES.delete(key);
      await env.LICENSES.delete(`pdf:welcome:${key}`);
      results.push({ key, deleted: true });
      deleted++;
    } catch (e) {
      results.push({ key, deleted: false, error: (e as Error).message });
    }
  }
  return json(req, { ok: true, requested: (body.keys as unknown[]).length, deleted, missing, results });
}

async function handleList(req: Request, env: Env): Promise<Response> {
  const adminCheck = await requireAdmin(req, env);
  if (adminCheck) return adminCheck;

  const list = await env.LICENSES.list({ limit: 1000 });
  const records: LicenseRecord[] = [];
  for (const k of list.keys) {
    if (!k.name.startsWith("SHOP-")) continue;
    const r = await env.LICENSES.get<LicenseRecord>(k.name, "json");
    if (r) records.push(r);
  }
  return json(req, { ok: true, count: records.length, licenses: records });
}

// Public counter for the Founding 50 cohort. Returns paid+offset where offset
// covers Glenn's 12 friend gift spots (those licenses should be issued with a
// non-"founding-50" cohort so they aren't double-counted).
const FOUNDING_50_OFFSET = 12;
const FOUNDING_50_TOTAL = 50;

async function handleFounding50Count(req: Request, env: Env): Promise<Response> {
  let paidCount = 0;
  try {
    const list = await env.LICENSES.list({ limit: 1000 });
    for (const k of list.keys) {
      if (!k.name.startsWith("SHOP-")) continue;
      const r = await env.LICENSES.get<LicenseRecord>(k.name, "json");
      // Legacy field: cohort no longer exists on new records, but old
      // founding-50 licenses in KV still carry it and should keep counting.
      if (r && (r as LicenseRecord & { cohort?: string }).cohort === "founding-50") paidCount++;
    }
  } catch {
    // Fall through with paidCount=0 so the page always renders something.
  }
  const redeemed = Math.min(paidCount + FOUNDING_50_OFFSET, FOUNDING_50_TOTAL);
  const body = JSON.stringify({ ok: true, redeemed, total: FOUNDING_50_TOTAL });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...corsResponseHeaders(req),
    },
  });
}

// ----- router -----

export default {
  // Cron (see [triggers] in wrangler.toml): alert on installs that failed and
  // never recovered, so a stuck self-installer gets human follow-up fast.
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(sweepFailedInstalls(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    try {
      // Admin-only: preview the welcome email. Pass ?format=text for plain-text version,
      // ?key=... for a license key, ?name=... for customer name.
      if (method === "GET" && path === "/admin/preview-welcome-email") {
        const adminCheck = await requireAdmin(req, env);
        if (adminCheck) return adminCheck;
        const url = new URL(req.url);
        const licenseKey = url.searchParams.get("key") || "SHOP-PREV-IEW0-0000";
        const customerName = url.searchParams.get("name") || "Test Customer";
        const format = url.searchParams.get("format") || "html";
        const input = {
          customerName,
          licenseKey,
          pdfUrl: `https://shop-os-license-server.glenn-15d.workers.dev/welcome.pdf`,
          bookingUrl: env.CALENDLY_SETUP_URL ?? env.CALENDLY_CONSULTATION_URL ?? "https://calendly.com/blueprintit/shop-os-foundation-setup",
          installUrl: `https://shop-os-license-server.glenn-15d.workers.dev/install?key=${encodeURIComponent(licenseKey)}`,
        };
        if (format === "text") {
          return new Response(welcomeText(input), {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...corsResponseHeaders(req) },
          });
        }
        return new Response(welcomeHtml(input), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...corsResponseHeaders(req) },
        });
      }

      // Admin-only: render the per-customer welcome PDF on demand for previewing.
      // Use: curl -H "Authorization: Bearer $(cat ~/.shopos-admin-token)" \
      //        "https://shop-os-license-server.glenn-15d.workers.dev/admin/preview-welcome.pdf?key=SHOP-XXXX-YYYY-ZZZZ" \
      //        -o preview.pdf
      if (method === "GET" && path === "/admin/preview-welcome.pdf") {
        const adminCheck = await requireAdmin(req, env);
        if (adminCheck) return adminCheck;
        const url = new URL(req.url);
        const licenseKey = url.searchParams.get("key") || "SHOP-PREV-IEW0-0000";
        const pdfBytes = await renderWelcomePdfBytes(env, licenseKey);
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'inline; filename="shop-os-welcome-preview.pdf"',
            "Cache-Control": "no-store",
            ...corsResponseHeaders(req),
          },
        });
      }

      // Serve welcome PDF at /welcome.pdf. With ?key=SHOP-XXXX-XXXX-XXXX,
      // render the per-customer personalized PDF (same one attached to the
      // welcome email) when the license exists. Otherwise serve the generic
      // static PDF from the assets binding.
      //
      // The personalized render goes through Cloudflare Browser Rendering
      // which is rate-limited and ~slow, so we cache the bytes in KV under
      // `pdf:welcome:<licenseKey>` after the first render. PDFs are immutable
      // per-customer, so no eviction strategy is needed.
      if (method === "GET" && path === "/welcome.pdf") {
        const licenseKey = url.searchParams.get("key");
        if (licenseKey && /^SHOP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(licenseKey)) {
          const record = await env.LICENSES.get(licenseKey, "json");
          if (record) {
            const cacheKey = `pdf:welcome:${licenseKey}`;
            let pdfBytes: ArrayBuffer | null = await env.LICENSES.get(cacheKey, "arrayBuffer");
            if (!pdfBytes) {
              const rendered = await renderWelcomePdfBytes(env, licenseKey);
              await env.LICENSES.put(cacheKey, rendered);
              pdfBytes = rendered.buffer.slice(
                rendered.byteOffset,
                rendered.byteOffset + rendered.byteLength,
              ) as ArrayBuffer;
            }
            return new Response(pdfBytes, {
              status: 200,
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": 'inline; filename="shop-os-welcome.pdf"',
                "Cache-Control": "private, max-age=3600",
                ...corsResponseHeaders(req),
              },
            });
          }
        }
        const asset = await env.ASSETS.fetch(new Request("https://placeholder/shop-os-welcome.pdf"));
        if (!asset.ok) return new Response("Not found", { status: 404 });
        return new Response(asset.body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'inline; filename="shop-os-welcome.pdf"',
            "Cache-Control": "public, max-age=3600",
            ...corsResponseHeaders(req),
          },
        });
      }

      if (path === "/" && method === "GET") return handleHealth(req, env);
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
      if ((path === "/admin/installs" || path === "/admin/installs/") && method === "GET") {
        return new Response(INSTALLS_HTML, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-frame-options": "DENY",
            "referrer-policy": "no-referrer",
          },
        });
      }
      // Admin: manually (re)send the welcome email for a license key. Uses the
      // exact production pipeline (PDF attachments, Resend), ignoring the
      // welcomeEmailSentAt flag — a manual resend is deliberate.
      if (method === "POST" && path === "/admin/send-welcome-email") {
        const adminCheck = await requireAdmin(req, env);
        if (adminCheck) return adminCheck;
        const key = (url.searchParams.get("key") || "").trim().toUpperCase();
        if (!key) return json(req, { error: "key query param required" }, 400);
        const record = await env.LICENSES.get<LicenseRecord>(key, "json");
        if (!record) return json(req, { error: "license not found" }, 404);
        const result = await sendWelcomeEmailForLicense(env, record);
        return json(
          req,
          { ok: result.ok, to: record.email, ...(result.error ? { error: result.error } : {}) },
          result.ok ? 200 : 502,
        );
      }

      if (path === "/install" && method === "GET") return handleInstallPage(req, url, env);
      if (path === "/install-status" && method === "GET") return handleInstallStatus(req, url, env);
      if (path === "/setup-complete" && method === "GET") return handleSetupComplete(req, url, env);
      if (method === "POST" && path === "/admin/run-failure-sweep") {
        const adminCheck = await requireAdmin(req, env);
        if (adminCheck) return adminCheck;
        return json(req, await sweepFailedInstalls(env));
      }
      if (path === "/install-script" && method === "GET") return handleInstallScript(req, url, env);
      if (path === "/validate" && method === "GET") return handleValidate(req, url, env, false);
      if (path === "/refresh" && method === "GET") return handleValidate(req, url, env, true);
      if (path === "/issue" && method === "POST") return handleIssue(req, env);
      if (path === "/admin/set-installer" && method === "POST") return handleSetInstaller(req, url, env);
      if (path === "/revoke" && method === "POST") return handleRevoke(req, url, env);
      if (path === "/delete" && method === "POST") return handleDelete(req, url, env);
      if (path === "/delete-bulk" && method === "POST") return handleDeleteBulk(req, env);
      if (path === "/update-license" && method === "POST") return handleUpdateLicense(req, url, env);
      if (path === "/list" && method === "GET") return handleList(req, env);
      if (path === "/founding50-redeemed" && method === "GET") return handleFounding50Count(req, env);

      if (req.method === "POST" && url.pathname === "/validate-coupon") {
        let body: { code?: string };
        try { body = await req.json(); } catch { body = {}; }
        if (!body.code) return json(req, { valid: false, error: "Code is required." }, 400);
        try {
          const stripe = getStripe(env);
          const result = await validateCoupon(stripe, body.code);
          return json(req, result);
        } catch (e) {
          return json(req, { valid: false, error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/create-stripe-checkout-session") {
        type Body = {
          email?: string;
          code?: string;
          productType?: "foundation" | "consultation" | "lead-handler" | "bundle" | "ai-assistant";
        };
        let body: Body;
        try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }

        // productType defaults to "foundation" so the existing PurchaseSection on
        // /blueprint-os (which doesn't send the field) keeps working unchanged.
        const productType = body.productType ?? "foundation";
        const KNOWN_TYPES = ["foundation", "consultation", "lead-handler", "bundle", "ai-assistant"] as const;
        if (!KNOWN_TYPES.includes(productType)) {
          return json(req, { error: "productType must be one of 'foundation', 'consultation', 'lead-handler', 'bundle', 'ai-assistant'." }, 400);
        }

        // Email is required for Foundation (we pre-collect it before checkout to
        // pass to Stripe). For Consultation we let Stripe Checkout collect it
        // inline since there's no coupon flow to pre-validate against.
        if (productType === "foundation" && !body.email) {
          return json(req, { error: "Email is required." }, 400);
        }

        try {
          const stripe = getStripe(env);
          const priceByType: Record<string, { id?: string; envName: string }> = {
            consultation: { id: env.STRIPE_PRICE_ID_CONSULTATION, envName: "STRIPE_PRICE_ID_CONSULTATION" },
            "lead-handler": { id: env.STRIPE_PRICE_ID_LEAD_HANDLER, envName: "STRIPE_PRICE_ID_LEAD_HANDLER" },
            bundle: { id: env.STRIPE_PRICE_ID_BUNDLE, envName: "STRIPE_PRICE_ID_BUNDLE" },
            "ai-assistant": { id: env.STRIPE_PRICE_ID_AI_ASSISTANT, envName: "STRIPE_PRICE_ID_AI_ASSISTANT" },
            foundation: {
              id: env.STRIPE_PRICE_ID_FOUNDATION ?? env.STRIPE_PRICE_ID ?? env.STRIPE_PRICE_ID_TEST,
              envName: "STRIPE_PRICE_ID_FOUNDATION",
            },
          };
          const { id: priceId, envName } = priceByType[productType];
          if (!priceId) {
            return json(req, { error: `${envName} not configured.` }, 500);
          }

          let promotionCodeId: string | undefined;
          let promoCode: string | undefined;
          let affiliate: string | null = null;

          // Coupons only apply to Foundation in v1; Consultation has no coupon
          // flow yet (see spec non-goals).
          if (productType === "foundation" && body.code) {
            const r = await validateCoupon(stripe, body.code);
            if (!r.valid) return json(req, { error: r.error }, 400);
            promotionCodeId = r.promotionCodeId;
            promoCode = r.code;
            affiliate = r.affiliate ?? null;
          }

          // Pick the right redirect surface per product so the customer lands
          // on the page that knows how to render their post-purchase state.
          // Foundation keeps its dedicated thank-you page (license key UI).
          // Everything else lands on /products/thank-you, which branches on
          // the ?product= param. Bundle purchases include a license, but the
          // welcome email carries the key, so the products page suffices.
          const successUrl = productType === "foundation"
            ? `${redirectBase(req)}/blueprint-os/thank-you?session_id={CHECKOUT_SESSION_ID}`
            : `${redirectBase(req)}/products/thank-you?session_id={CHECKOUT_SESSION_ID}&product=${productType}`;
          const cancelUrl = productType === "foundation"
            ? `${redirectBase(req)}/blueprint-os#purchase`
            : `${redirectBase(req)}/products`;
          const source = productType === "foundation" ? "shop-ossi" : "products";

          const session = await stripe.createCheckoutSession({
            priceId,
            customerEmail: body.email,
            promotionCodeId,
            successUrl,
            cancelUrl,
            metadata: {
              source,
              productType,
              ...(promoCode ? { promoCode } : {}),
              ...(affiliate ? { affiliate } : {}),
            },
          });
          return json(req, { checkoutUrl: session.url, sessionId: session.id });
        } catch (e) {
          return json(req, { error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/webhook/stripe") {
        return handleStripeWebhook(req, env);
      }

      if (req.method === "POST" && url.pathname === "/create-paypal-order") {
        type Body = { email: string; code?: string };
        let body: Body;
        try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }
        if (!body.email) return json(req, { error: "Email is required." }, 400);

        try {
          let finalPrice = BASE_PRICE_CENTS;
          let promoCode: string | undefined;
          let affiliate: string | null = null;
          let discountAmount: number | undefined;

          if (body.code) {
            const stripe = getStripe(env);
            const r = await validateCoupon(stripe, body.code);
            if (!r.valid) return json(req, { error: r.error }, 400);
            finalPrice = r.finalPrice ?? BASE_PRICE_CENTS;
            promoCode = r.code;
            affiliate = r.affiliate ?? null;
            discountAmount = r.discountAmount;
          }

          const paypal = getPayPal(env);
          const order = await paypal.createOrder({
            amount: finalPrice,
            payerEmail: body.email,
            metadata: {
              source: "shop-ossi",
              email: body.email,
              ...(promoCode ? { promoCode } : {}),
              ...(affiliate ? { affiliate } : {}),
              ...(discountAmount ? { discountAmount: String(discountAmount) } : {}),
            },
          });
          return json(req, { orderId: order.id });
        } catch (e) {
          return json(req, { error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/capture-paypal-order") {
        type Body = { orderId: string; email?: string };
        let body: Body;
        try { body = await req.json(); } catch { return json(req, { error: "Bad JSON" }, 400); }
        if (!body.orderId) return json(req, { error: "orderId is required." }, 400);

        try {
          const paypal = getPayPal(env);
          const captured = await paypal.captureOrder(body.orderId);
          if (captured.status !== "COMPLETED") {
            return json(req, { error: `Capture status: ${captured.status}` }, 400);
          }

          const customId = captured.purchase_units?.[0]?.custom_id ?? "{}";
          let metadata: Record<string, string> = {};
          try { metadata = JSON.parse(customId); } catch { metadata = {}; }

          const email = body.email ?? metadata.email ?? captured.payer?.email_address ?? "";
          const customer =
            `${captured.payer?.name?.given_name ?? ""} ${captured.payer?.name?.surname ?? ""}`.trim() ||
            metadata.email ||
            email ||
            "Customer";

          const amountValue = captured.purchase_units?.[0]?.amount?.value;
          const amountCents = amountValue ? Math.round(parseFloat(amountValue) * 100) : BASE_PRICE_CENTS;

          const result = await handlePaymentSuccess(env, {
            paymentProvider: "paypal",
            paymentId: body.orderId,
            customer,
            email,
            amount: amountCents,
            promoCode: metadata.promoCode,
            affiliate: metadata.affiliate ?? null,
            discountAmount: metadata.discountAmount ? parseInt(metadata.discountAmount, 10) : undefined,
            // PayPal flow is Foundation-only — Consultation is Stripe-only in v1.
            productType: "foundation",
          });

          // license is always non-null on the Foundation branch.
          if (!result.license) {
            return json(req, { error: "License issuance failed unexpectedly." }, 500);
          }
          return json(req, { license: result.license.key, alreadyIssued: result.alreadyIssued });
        } catch (e) {
          return json(req, { error: (e as Error).message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/webhook/paypal") {
        return handlePayPalWebhook(req, env);
      }

      if (req.method === "GET" && url.pathname === "/payment-status") {
        const sessionId = url.searchParams.get("session_id");
        const paypalOrderId = url.searchParams.get("paypal_order_id");
        if (!sessionId && !paypalOrderId) {
          return json(req, { error: "Provide session_id or paypal_order_id." }, 400);
        }
        const idemKey = sessionId
          ? `payment:stripe:${sessionId}`
          : `payment:paypal:${paypalOrderId}`;
        const licenseKey = await env.LICENSES.get(idemKey);
        if (!licenseKey) return json(req, { status: "pending" });
        return json(req, { status: "succeeded", licenseKey });
      }

      // Serve installer scripts
      if (method === "GET" && path === "/installer-macos.sh") {
        const asset = await env.ASSETS.fetch(new Request("https://placeholder/setup-macos.sh"));
        if (!asset.ok) return new Response("Not found", { status: 404 });
        return new Response(asset.body, {
          status: 200,
          headers: {
            "Content-Type": "application/x-sh",
            "Content-Disposition": 'attachment; filename="setup-macos.sh"',
            "Cache-Control": "public, max-age=3600",
            ...corsResponseHeaders(req),
          },
        });
      }

      if (method === "GET" && path === "/installer-windows.ps1") {
        const asset = await env.ASSETS.fetch(new Request("https://placeholder/setup-windows.ps1"));
        if (!asset.ok) return new Response("Not found", { status: 404 });
        return new Response(asset.body, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            ...corsResponseHeaders(req),
          },
        });
      }

      // Installer telemetry — public write, admin read
      if (method === "POST" && path === "/install-log") {
        return handleInstallLog(req, env);
      }
      if (method === "GET" && path === "/admin/install-logs") {
        return handleAdminInstallLogs(req, env);
      }

      return json(req, { error: "not found", path, method }, 404);
    } catch (err) {
      return json(req, { error: "internal error", detail: String(err) }, 500);
    }
  },
};
