// test/installer-switch.test.ts
import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";
import { buildWindowsBat, buildMacCommand, V2_RAW_BASE } from "../src/install-page";

const INFO = { key: "SHOP-AB12-CD34-EF56", customer: "Acme" };

describe("v2 install files", () => {
  it("windows v2: no admin relaunch, fetches the dashboard repo's starter, key in env, BOM write, -File", () => {
    const bat = buildWindowsBat(INFO, "v2");
    expect(bat).toContain("raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer/start-windows.ps1");
    expect(bat).not.toContain("net session");
    expect(bat).not.toContain("RunAs");
    expect(bat).toContain(`set "SHOPOS_LICENSE_KEY=${INFO.key}"`);
    expect(bat).toContain("UTF8Encoding($true)");
    expect(bat).toMatch(/-File "%SHOPOS_SETUP_PS1%"/);
    expect(bat).not.toMatch(/\biex\b/i);
    expect(bat).toContain("\r\n");
  });
  it("mac v2: exports the key, fetches start-macos.sh from the dashboard repo, keeps the window open", () => {
    const cmd = buildMacCommand(INFO, "v2");
    expect(cmd).toContain(`export SHOPOS_LICENSE_KEY="${INFO.key}"`);
    expect(cmd).toContain("raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer/start-macos.sh");
    expect(cmd).toMatch(/read -r -p/);
  });
  it("legacy stays exactly as before (default argument)", () => {
    expect(buildWindowsBat(INFO)).toBe(buildWindowsBat(INFO, "legacy"));
    expect(buildWindowsBat(INFO)).toContain("shop-os-installer/main/scripts/setup-windows.ps1");
  });
});

function makeEnv(record: Record<string, unknown>, vars: Partial<Env> = {}) {
  const store: Record<string, string> = { [INFO.key]: JSON.stringify(record) };
  const env = {
    LICENSES: {
      async get(k: string, t?: string) { const v = store[k]; return v == null ? null : t === "json" ? JSON.parse(v) : v; },
      async put(k: string, v: string) { store[k] = v; },
      async list() { return { keys: [] }; },
    } as any,
    ADMIN_TOKEN: "tok", SERVICE_NAME: "t", SERVICE_VERSION: "1", ASSETS: {} as any, ...vars,
  } as Env;
  return { env, store };
}
const rec = { key: INFO.key, customer: "Acme", email: "a@b", product: "p", created_at: "2026-01-01", valid_until: null, cancelled_at: null, last_seen: null, activations: 0, lifetimeUpdates: false };
const script = (env: Env) => worker.fetch(new Request(`https://x/install-script?key=${INFO.key}&os=windows`), env).then((r) => r.text());

describe("per-customer switch", () => {
  it("serves legacy when nothing is set", async () => {
    expect(await script(makeEnv(rec).env)).toContain("shop-os-installer");
  });
  it("serves v2 for a flagged customer only", async () => {
    expect(await script(makeEnv({ ...rec, installer: "v2" }).env)).toContain("shop-os-dashboard/main/installer/start-windows.ps1");
  });
  it("honours DEFAULT_INSTALLER when the record has no flag", async () => {
    expect(await script(makeEnv(rec, { DEFAULT_INSTALLER: "v2" } as any).env)).toContain("start-windows.ps1");
  });
  it("record flag beats the default (instant rollback for one customer)", async () => {
    expect(await script(makeEnv({ ...rec, installer: "legacy" }, { DEFAULT_INSTALLER: "v2" } as any).env)).toContain("shop-os-installer");
  });
  it("admin can flip a customer and back", async () => {
    const { env, store } = makeEnv(rec);
    const flip = (v: string) => worker.fetch(new Request(`https://x/admin/set-installer?key=${INFO.key}&installer=${v}`, { method: "POST", headers: { Authorization: "Bearer tok" } }), env);
    expect((await flip("v2")).status).toBe(200);
    expect(JSON.parse(store[INFO.key]).installer).toBe("v2");
    expect((await flip("legacy")).status).toBe(200);
    expect(JSON.parse(store[INFO.key]).installer).toBe("legacy");
  });
  it("rejects non-admins and bad values", async () => {
    const { env } = makeEnv(rec);
    expect((await worker.fetch(new Request(`https://x/admin/set-installer?key=${INFO.key}&installer=v2`, { method: "POST" }), env)).status).toBe(401);
    expect((await worker.fetch(new Request(`https://x/admin/set-installer?key=${INFO.key}&installer=bogus`, { method: "POST", headers: { Authorization: "Bearer tok" } }), env)).status).toBe(400);
  });
});

describe("v2 hardening", () => {
  it("v2 files also carry SHOPOS_LICENSE_SERVER when given", () => {
    const o = { licenseServer: "https://lic.example.workers.dev" };
    expect(buildWindowsBat(INFO, "v2", o)).toContain('set "SHOPOS_LICENSE_SERVER=https://lic.example.workers.dev"');
    expect(buildMacCommand(INFO, "v2", o)).toContain('export SHOPOS_LICENSE_SERVER="https://lic.example.workers.dev"');
  });
  it("v2 refuses a key or server with shell-significant characters", () => {
    expect(() => buildWindowsBat({ key: 'X" & calc & "', customer: "A" }, "v2")).toThrow();
    expect(() => buildMacCommand({ key: 'X"; rm -rf ~; "', customer: "A" }, "v2")).toThrow();
    expect(() => buildMacCommand(INFO, "v2", { licenseServer: "https://a.b/\";x" })).toThrow();
  });
  it("v2 sanitises a newline in the customer name", () => {
    const bat = buildWindowsBat({ key: INFO.key, customer: "A\r\nnet user x" }, "v2");
    expect(bat.split("\r\n").some((l) => l.startsWith("net user"))).toBe(false);
  });
  it("V2_RAW_BASE is a single exported constant used by both files", () => {
    expect(buildWindowsBat(INFO, "v2")).toContain(V2_RAW_BASE + "/start-windows.ps1");
    expect(buildMacCommand(INFO, "v2")).toContain(V2_RAW_BASE + "/start-macos.sh");
  });
});

describe("legacy regression snapshot", () => {
  it("legacy .bat is byte-for-byte unchanged", () => { expect(buildWindowsBat(INFO)).toMatchSnapshot(); });
  it("legacy .command is byte-for-byte unchanged", () => { expect(buildMacCommand(INFO)).toMatchSnapshot(); });
});

describe("set-installer edge cases", () => {
  const post = (env: Env, q: string) => worker.fetch(new Request(`https://x/admin/set-installer?${q}`, { method: "POST", headers: { Authorization: "Bearer tok" } }), env);
  it("unknown license -> 404", async () => {
    expect((await post(makeEnv(rec).env, "key=SHOP-NOPE-0000-0000&installer=v2")).status).toBe(404);
  });
  it("missing key -> 400", async () => {
    expect((await post(makeEnv(rec).env, "installer=v2")).status).toBe(400);
  });
  it("GET is not a route", async () => {
    const r = await worker.fetch(new Request(`https://x/admin/set-installer?key=${INFO.key}&installer=v2`, { headers: { Authorization: "Bearer tok" } }), makeEnv(rec).env);
    expect(r.status).toBe(404);
  });
  it("a bad value does not modify the record", async () => {
    const { env, store } = makeEnv(rec);
    await post(env, `key=${INFO.key}&installer=V2%3B`);
    expect(JSON.parse(store[INFO.key]).installer).toBeUndefined();
  });
  it("mac script for a v2 customer is a zip containing the v2 starter URL and the worker origin", async () => {
    const r = await worker.fetch(new Request(`https://lic.test/install-script?key=${INFO.key}&os=mac`), makeEnv({ ...rec, installer: "v2" }).env);
    const txt = new TextDecoder().decode(new Uint8Array(await r.arrayBuffer()));
    expect(txt).toContain("start-macos.sh");
    expect(txt).toContain('export SHOPOS_LICENSE_SERVER="https://lic.test"');
    expect(txt).toContain('read -r -p "Press Enter to close..." _ < /dev/tty');
    expect(txt).toContain("exit $rc");
    expect(txt).toContain("--connect-timeout 20 -m 120");
    expect(txt).toContain("Right-click");
  });
  it("windows v2 script carries the request origin as SHOPOS_LICENSE_SERVER", async () => {
    const r = await worker.fetch(new Request(`https://lic.test/install-script?key=${INFO.key}&os=windows`), makeEnv({ ...rec, installer: "v2" }).env);
    expect(await r.text()).toContain('set "SHOPOS_LICENSE_SERVER=https://lic.test"');
  });
  it("the install page works for both flags", async () => {
    for (const installer of ["legacy", "v2"]) {
      const r = await worker.fetch(new Request(`https://x/install?key=${INFO.key}`), makeEnv({ ...rec, installer }).env);
      expect(r.status).toBe(200);
    }
  });
});

describe("fix round 1", () => {
  it("v2 .bat never embeds the temp path in a quoted PowerShell string (O'Brien-safe)", () => {
    const bat = buildWindowsBat(INFO, "v2");
    expect(bat).not.toContain("'%SHOPOS_SETUP_PS1%'");
    expect(bat).not.toMatch(/'[^'\r\n]*%[A-Z_]+%[^'\r\n]*'/);
    expect(bat).toContain("WriteAllText($env:SHOPOS_SETUP_PS1,");
  });
  it("v2 .bat enables TLS 1.2 before downloading", () => {
    expect(buildWindowsBat(INFO, "v2")).toContain("[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072;");
  });
  it("malformed stored flag falls back to legacy / the default", async () => {
    expect(await script(makeEnv({ ...rec, installer: "V2; rm" }).env)).toContain("shop-os-installer");
    expect(await script(makeEnv({ ...rec, installer: 7 }, { DEFAULT_INSTALLER: "v2" } as any).env)).toContain("start-windows.ps1");
  });
  it("non-https origin: v2 served without SHOPOS_LICENSE_SERVER (starter default applies)", async () => {
    const r = await worker.fetch(new Request(`http://localhost:8787/install-script?key=${INFO.key}&os=windows`), makeEnv({ ...rec, installer: "v2" }).env);
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain("start-windows.ps1");
    expect(t).not.toContain("SHOPOS_LICENSE_SERVER");
  });
});
