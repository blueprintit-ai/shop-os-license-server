import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, { Env, buildInstallAlertText } from "../src/index";
import { INSTALLS_HTML } from "../src/installs-html";

const KEY = "SHOP-AB12-CD34-EF56";
function makeEnv(pageSize = 1000) {
  const store: Record<string, string> = {};
  const env = {
    LICENSES: {
      async get(k: string, t?: string) { const v = store[k]; return v == null ? null : t === "json" ? JSON.parse(v) : v; },
      async put(k: string, v: string) { store[k] = v; },
      // Real KV semantics: sorted keys, page size, cursor, list_complete.
      async list({ prefix, cursor }: { prefix?: string; limit?: number; cursor?: string }) {
        const all = Object.keys(store).filter((k) => k.startsWith(prefix ?? "")).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + pageSize);
        const done = start + pageSize >= all.length;
        return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + pageSize) };
      },
    } as any,
    ADMIN_TOKEN: "x", SERVICE_NAME: "t", SERVICE_VERSION: "1", ASSETS: {} as any, RESEND_API_KEY: "re_test",
  } as Env;
  return { env, store };
}
let sent: any[];
beforeEach(() => { sent = []; vi.stubGlobal("fetch", async (url: string, init: any) => { if (String(url).includes("resend")) { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); } throw new Error("unexpected fetch " + url); }); });
const seed = (store: Record<string, string>, key = KEY) => { store[key] = JSON.stringify({ customer: "C", email: "c@x.com" }); };
const post = (env: Env, body: unknown) => worker.fetch(new Request("https://x/install-log", { method: "POST", body: JSON.stringify(body) }), env);
const sweep = (env: Env) => worker.fetch(new Request("https://x/admin/run-failure-sweep", { method: "POST", headers: { Authorization: "Bearer x" } }), env);
const put = (store: Record<string, string>, key: string, ts: number, log: any, rand = "aaaa") => { store[`install-log:${key}:${ts}:${rand}`] = JSON.stringify({ license_key: key, timestamp: new Date(ts).toISOString(), ...log }); };

describe("immediate failure alert (v2)", () => {
  it("emails once per run with support code, command, tail and hint", async () => {
    const { env, store } = makeEnv(); seed(store);
    const err = { license_key: KEY, status: "error", step: "plugins", step_title: "Installing the Blueprint OS skills", run_id: "r1", support_code: "BP-7K2Q", error_message: "Could not install x", command: "claude plugin install x", exit_code: 1, output_tail: "fatal: unable to access github.com", hint: "GitHub unreachable, likely a firewall or proxy.", snapshot: { os: "Windows 11", git: false, node: "v22" } };
    await post(env, err);
    await post(env, err);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("BP-7K2Q");
    expect(sent[0].text).toContain("claude plugin install x");
    expect(sent[0].text).toContain("GitHub unreachable");
    expect(sent[0].text).toContain("Windows 11");
  });
  it("does not email for old-style errors (the sweep still handles those)", async () => {
    const { env, store } = makeEnv(); seed(store);
    await post(env, { license_key: KEY, status: "error", step: "x", error_message: "old" });
    expect(sent).toHaveLength(0);
  });
  it("an email failure never fails the report", async () => {
    const { env, store } = makeEnv(); seed(store);
    vi.stubGlobal("fetch", async () => { throw new Error("resend down"); });
    const res = await post(env, { license_key: KEY, status: "error", step: "x", run_id: "r2", support_code: "BP-AAAA" });
    expect(res.status).toBe(200);
  });
  it("shows notes and retried steps in the alert", async () => {
    const { env, store } = makeEnv(); seed(store);
    await post(env, { license_key: KEY, status: "error", step: "plugins", run_id: "r3", support_code: "BP-NOTE", notes: ["settings.json was rebuilt"], timeline: [{ id: "git", title: "Checking Git", status: "ok", attempts: 3, retried: true }, { id: "plugins", title: "Plugins", status: "error", attempts: 1 }] });
    expect(sent[0].text).toContain("settings.json was rebuilt");
    expect(sent[0].text).toMatch(/Checking Git.*retried 2 times/);
  });
});

describe("hung-run sweep", () => {
  it("alerts when the last report is an old progress with nothing after it", async () => {
    const { env, store } = makeEnv();
    const ts = Date.now() - 45 * 60e3;
    put(store, KEY, ts, { status: "progress", step: "claude-code", step_title: "Installing Claude Code", run_id: "r9", support_code: "BP-HUNG" });
    await sweep(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/Installing Claude Code/);
    expect(sent[0].text).toMatch(/BP-HUNG/);
    expect(sent[0].text).toMatch(/minutes ago/);
    await sweep(env);
    expect(sent).toHaveLength(1);
  });
  it("stays quiet when a success followed", async () => {
    const { env, store } = makeEnv();
    const t1 = Date.now() - 50 * 60e3, t2 = Date.now() - 40 * 60e3;
    put(store, KEY, t1, { status: "progress", step: "a" });
    put(store, KEY, t2, { status: "success", step: "complete" });
    await sweep(env);
    expect(sent).toHaveLength(0);
  });
  it("a run whose last report is success is never hung (launch sends no progress)", async () => {
    const { env, store } = makeEnv();
    for (let i = 0; i < 5; i++) put(store, KEY, Date.now() - (3 * 3600e3 - i * 60e3), { status: "progress", step: "s" + i }, "p" + i + "xx");
    put(store, KEY, Date.now() - 2 * 3600e3, { status: "success", step: "complete" });
    await sweep(env);
    expect(sent).toHaveLength(0);
  });
  it("does not alert for a progress entry younger than 30 minutes", async () => {
    const { env, store } = makeEnv();
    put(store, KEY, Date.now() - 10 * 60e3, { status: "progress", step: "a" });
    await sweep(env);
    expect(sent).toHaveLength(0);
  });
  it("still alerts for an old error buried under many progress entries", async () => {
    const { env, store } = makeEnv();
    const base = Date.now() - 5 * 3600e3;
    put(store, KEY, base, { status: "error", step: "plugins", error_message: "boom" });
    for (let i = 0; i < 40; i++) put(store, KEY, base + 60e3 + i * 1000, { status: "progress", step: "s" + i }, "q" + String(i).padStart(3, "0"));
    // a later successful retry would silence it; none here, but the last entry is progress (hung) too
    await sweep(env);
    expect(sent).toHaveLength(2); // the error alert plus the hung alert for the trailing progress
    expect(sent.filter((m) => m.text.includes("boom"))).toHaveLength(1);
  });
  it("paginates list() so licenses beyond the first page are swept", async () => {
    const { env, store } = makeEnv(3);
    for (let i = 0; i < 10; i++) put(store, `SHOP-AAAA-BBBB-000${i}`, Date.now() - 3600e3, { status: "success", step: "complete" });
    put(store, "SHOP-ZZZZ-ZZZZ-ZZZZ", Date.now() - 2 * 3600e3, { status: "error", step: "plugins", error_message: "late-page" });
    await sweep(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("late-page");
  });
  it("an error that already got the immediate email is not emailed again, but one whose email failed is", async () => {
    const { env, store } = makeEnv();
    const ts = Date.now() - 2 * 3600e3;
    put(store, KEY, ts, { status: "error", step: "x", run_id: "rr1", error_message: "sent-already" });
    store[`install-alert-now:${KEY}:rr1`] = "1";
    put(store, "SHOP-OTHR-OTHR-OTHR", ts, { status: "error", step: "x", run_id: "rr2", error_message: "never-sent" });
    await sweep(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("never-sent");
  });
});

describe("immediate alert gating", () => {
  const err = (n: number, key = KEY) => ({ license_key: key, status: "error", step: "x", run_id: "run" + n, support_code: "BP-" + n });
  it("unknown license: no immediate email, sweep still handles it", async () => {
    const { env, store } = makeEnv();
    await post(env, err(1));
    expect(sent).toHaveLength(0);
    expect(Object.keys(store).some((k) => k.startsWith("install-alert-now:"))).toBe(false);
  });
  it("caps immediate emails per UTC hour", async () => {
    const { env, store } = makeEnv(); seed(store);
    for (let i = 0; i < 14; i++) await post(env, err(i));
    expect(sent).toHaveLength(10);
  });
  it("old no-run_id error is swept but not emailed immediately", async () => {
    const { env, store } = makeEnv(); seed(store);
    await post(env, { license_key: KEY, status: "error", step: "x", error_message: "legacy" });
    expect(sent).toHaveLength(0);
    const k = Object.keys(store).find((n) => n.startsWith("install-log:"))!;
    const old = Date.now() - 2 * 3600e3;
    store[`install-log:${KEY}:${old}:zzzz`] = store[k]; delete store[k];
    await sweep(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("legacy");
  });
});

describe("hung detection with retry reports and budget", () => {
  it("progress then a retry 45 min ago then nothing -> exactly one email", async () => {
    const { env, store } = makeEnv();
    put(store, KEY, Date.now() - 50 * 60e3, { status: "progress", step: "a", step_title: "Step A" });
    put(store, KEY, Date.now() - 45 * 60e3, { status: "retry", step: "b", step_title: "Retrying B", support_code: "BP-RTRY" });
    await sweep(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Retrying B");
    await sweep(env);
    expect(sent).toHaveLength(1);
  });
  it("progress older than 24h is not alerted", async () => {
    const { env, store } = makeEnv();
    put(store, KEY, Date.now() - 26 * 3600e3, { status: "progress", step: "a" });
    await sweep(env);
    expect(sent).toHaveLength(0);
  });
  it("stays under the KV budget with many licenses and serves newest first", async () => {
    const { env, store } = makeEnv(1000);
    let ops = 0;
    const kv = env.LICENSES as any;
    for (const m of ["get", "put", "list"]) { const o = kv[m].bind(kv); kv[m] = async (...a: any[]) => { ops++; return o(...a); }; }
    for (let i = 0; i < 1200; i++) put(store, `SHOP-AAAA-BBBB-${String(i).padStart(4, "0")}`, Date.now() - 31 * 60e3 - i * 1000, { status: "progress", step: "s", support_code: "BP-" + i }, "xxxx");
    const res: any = await (await sweep(env)).json();
    expect(ops).toBeLessThan(1000);
    expect(res.truncated).toBe(true);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].text).toContain("BP-0");
    expect(sent.some((m) => m.text.includes("BP-1199"))).toBe(false);
  });
});

describe("admin install-logs listing", () => {
  const list = (env: Env, q = "") => worker.fetch(new Request("https://x/admin/install-logs" + q, { headers: { Authorization: "Bearer x" } }), env).then((r) => r.json() as Promise<any>);
  it("paginates past the first page and keeps only the latest progress of an unfinished run", async () => {
    const { env, store } = makeEnv(4);
    for (let i = 0; i < 12; i++) put(store, `SHOP-AAAA-BBBB-00${String(i).padStart(2, "0")}`, Date.now() - i * 1000, { status: "success", step: "complete" });
    for (let i = 0; i < 6; i++) put(store, KEY, Date.now() - 100000 + i * 1000, { status: "progress", step: "s" + i }, "r" + i + "xx");
    const out = await list(env);
    expect(out.logs.filter((l: any) => l.status === "success")).toHaveLength(12);
    const prog = out.logs.filter((l: any) => l.status === "progress");
    expect(prog).toHaveLength(1);
    expect(prog[0].step).toBe("s5");
  });
  it("drops progress once the same key has a later success", async () => {
    const { env, store } = makeEnv();
    put(store, KEY, Date.now() - 5000, { status: "progress", step: "a" });
    put(store, KEY, Date.now() - 1000, { status: "success", step: "complete" });
    const out = await list(env);
    expect(out.logs.map((l: any) => l.status)).toEqual(["success"]);
  });
});

describe("escaping of unauthenticated fields", () => {
  const X = `<script>alert("x")</script>'"&`;
  const evil = {
    license_key: KEY, status: "error", step: X, step_title: X, run_id: X, support_code: "BP-EVIL", error_message: X, command: X, exit_code: 1,
    output_tail: X, hint: X, installer_version: X, notes: [X], machine: { os: X, ps_version: X, username: X, source: X },
    snapshot: { os: X, node: X, git: X, [X]: X, elevated: X },
    timeline: [{ id: X, title: X, status: X, error: X, command: X, outTail: X, hint: X, retried: true, attempts: 2 }],
  };
  function rendered(): string {
    const script = INSTALLS_HTML.split("<script>")[1].split("</script>")[0];
    const grab = (name: string) => { const i = script.indexOf("function " + name + "("); expect(i).toBeGreaterThan(-1); let d = 0, j = script.indexOf("{", i); const s = j; for (; j < script.length; j++) { if (script[j] === "{") d++; else if (script[j] === "}" && --d === 0) break; } return script.slice(i, j + 1); };
    const fn = new Function(grab("esc") + "\n" + grab("fmtMs") + "\n" + grab("detailHtml") + "\nreturn detailHtml;")();
    return fn({ ...evil, timestamp: "2026-10-07T00:00:00Z", duration_ms: 1500 });
  }
  it("admin detail escapes every stored field", () => {
    const html = rendered();
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("'\"");
    expect(html).toContain("&#39;");
    expect(html).toContain("BP-EVIL");
    expect(html).toContain("retried 1 time");
  });
  it("alert text keeps content on one line where it must and the html twin is escaped", async () => {
    const { env, store } = makeEnv(); seed(store);
    await post(env, { ...evil, step_title: "a\r\nBcc: evil@x.com <b>" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).not.toMatch(/[\r\n]/);
    expect(sent[0].html).toBeDefined();
    expect(sent[0].html).not.toMatch(/<script/i);
    expect(sent[0].html).not.toContain("<b>");
    expect(sent[0].html).toContain("&lt;script&gt;");
  });
  it("sweep alert html is escaped too", async () => {
    const { env, store } = makeEnv();
    put(store, KEY, Date.now() - 2 * 3600e3, { status: "error", step: X, error_message: X, command: X, output_tail: X, hint: X, notes: [X] });
    await sweep(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(/<script/i);
  });
  it("admin link run id is url-encoded", () => {
    const t = buildInstallAlertText({ license_key: KEY, status: "error", timestamp: "t", run_id: "a b&c=<d>" } as any, KEY);
    expect(t).toContain("run=a%20b%26c%3D%3Cd%3E");
  });
});

describe("buildInstallAlertText", () => {
  it("falls back gracefully for fields an old installer never sends", () => {
    const t = buildInstallAlertText({ license_key: KEY, status: "error", timestamp: "2026-10-07T00:00:00Z", step: "x" } as any, KEY);
    expect(t).toContain("Step:");
    expect(t).not.toContain("undefined");
  });
});

describe("admin page markup", () => {
  it("page script is syntactically valid", () => { new Function(INSTALLS_HTML.split("<script>")[1].split("</script>")[0]); });
  it("renders the new fields and an In progress pill", () => {
    for (const s of ["support_code", "output_tail", "In progress", "run_id", "timeline", "notes"]) expect(INSTALLS_HTML).toContain(s);
  });
});
