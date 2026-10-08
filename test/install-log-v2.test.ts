import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";

function envWithStore() {
  const store: Record<string, string> = {};
  const env = {
    LICENSES: {
      async get(k: string, t?: string) { const v = store[k]; return v == null ? null : t === "json" ? JSON.parse(v) : v; },
      async put(k: string, v: string) { store[k] = v; },
      async list({ prefix }: { prefix: string }) { return { keys: Object.keys(store).filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
    } as any,
    ADMIN_TOKEN: "x", SERVICE_NAME: "t", SERVICE_VERSION: "1", ASSETS: {} as any,
  } as Env;
  return { env, store };
}
const post = (env: Env, body: unknown) => worker.fetch(new Request("https://x/install-log", { method: "POST", body: JSON.stringify(body) }), env);
const KEY = "SHOP-AB12-CD34-EF56";

describe("POST /install-log (v2 fields)", () => {
  it("still accepts the old shape unchanged", async () => {
    const { env, store } = envWithStore();
    const res = await post(env, { license_key: KEY, status: "success", step: "complete", machine: { os: "Windows 11", username: "bob" } });
    expect(res.status).toBe(200);
    const saved = JSON.parse(Object.values(store)[0]);
    expect(saved.status).toBe("success");
    expect(saved.machine.username).toBe("bob");
  });

  it("still accepts the old retry status", async () => {
    const { env, store } = envWithStore();
    expect((await post(env, { license_key: KEY, status: "retry", step: "x" })).status).toBe(200);
    expect(JSON.parse(Object.values(store)[0]).status).toBe("retry");
  });

  it("accepts progress with run id, support code and step title", async () => {
    const { env, store } = envWithStore();
    const res = await post(env, { license_key: KEY, status: "progress", step: "claude-code", step_title: "Installing Claude Code", run_id: "r1", support_code: "BP-7K2Q" });
    expect(res.status).toBe(200);
    const saved = JSON.parse(Object.values(store)[0]);
    expect(saved).toMatchObject({ status: "progress", run_id: "r1", support_code: "BP-7K2Q", step_title: "Installing Claude Code" });
  });

  it("stores diagnostics (command, exit code, output tail, hint, timeline, snapshot)", async () => {
    const { env, store } = envWithStore();
    await post(env, {
      license_key: KEY, status: "error", step: "plugins", run_id: "r1", support_code: "BP-7K2Q", error_message: "boom",
      command: "claude plugin install x", exit_code: 1, output_tail: "tail", hint: "GitHub unreachable", duration_ms: 1234,
      installer_version: "2.0.0",
      timeline: [{ id: "a", status: "ok" }], snapshot: { os: "Windows", git: false }, evil_field: "dropped",
    });
    const saved = JSON.parse(Object.values(store)[0]);
    expect(saved.command).toBe("claude plugin install x");
    expect(saved.exit_code).toBe(1);
    expect(saved.duration_ms).toBe(1234);
    expect(saved.installer_version).toBe("2.0.0");
    expect(saved.snapshot.git).toBe(false);
    expect(saved.timeline[0]).toMatchObject({ id: "a", status: "ok" });
    expect(saved.evil_field).toBeUndefined();
  });

  it("keeps the full license key and the client machine shape", async () => {
    const { env, store } = envWithStore();
    await post(env, { license_key: KEY, status: "success", machine: { os: "macOS 14", source: "installer-v2", junk: "x" } });
    const [name, raw] = Object.entries(store)[0];
    expect(name.startsWith(`install-log:${KEY}:`)).toBe(true);
    const saved = JSON.parse(raw);
    expect(saved.license_key).toBe(KEY);
    expect(saved.machine).toEqual({ os: "macOS 14", source: "installer-v2" });
  });

  it("stores notes (max 10 strings, 300 chars each, non-strings dropped)", async () => {
    const { env, store } = envWithStore();
    const notes = Array.from({ length: 14 }, (_, i) => `n${i}`);
    notes[0] = "x".repeat(900);
    notes[1] = 42 as any;
    await post(env, { license_key: KEY, status: "success", notes });
    const saved = JSON.parse(Object.values(store)[0]);
    expect(saved.notes.length).toBe(10);
    expect(saved.notes[0].length).toBe(300);
    expect(saved.notes.every((n: unknown) => typeof n === "string")).toBe(true);
  });

  it("keeps timeline entry fields (retried, hint, command, exitCode, outTail) and drops unknown ones", async () => {
    const { env, store } = envWithStore();
    await post(env, {
      license_key: KEY, status: "error", step: "plugins",
      timeline: [
        { id: "a", title: "A", status: "ok", attempts: 2, durationMs: 50, retried: true, secret: "no" },
        { id: "b", title: "B", status: "failed", error: "e", command: "c", exitCode: 1, outTail: "t".repeat(9000), hint: "h" },
        "not an object",
      ],
    });
    const saved = JSON.parse(Object.values(store)[0]);
    expect(saved.timeline).toHaveLength(2);
    expect(saved.timeline[0]).toEqual({ id: "a", title: "A", status: "ok", attempts: 2, durationMs: 50, retried: true });
    expect(saved.timeline[1]).toMatchObject({ command: "c", exitCode: 1, hint: "h", error: "e" });
    expect(saved.timeline[1].outTail.length).toBeLessThanOrEqual(1500);
  });

  it("caps oversized fields so one report cannot bloat KV", async () => {
    const { env, store } = envWithStore();
    await post(env, { license_key: KEY, status: "error", step: "x", output_tail: "z".repeat(200000), error_message: "e".repeat(50000) });
    const raw = Object.values(store)[0];
    expect(raw.length).toBeLessThanOrEqual(32 * 1024);
  });

  it("keeps stored JSON under 32 KB even with a huge timeline and snapshot", async () => {
    const { env, store } = envWithStore();
    const timeline = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, title: "t".repeat(500), status: "ok", error: "e".repeat(5000), outTail: "o".repeat(5000) }));
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < 200; i++) snapshot[`k${i}`] = "v".repeat(1000);
    await post(env, { license_key: KEY, status: "error", step: "x", output_tail: "z".repeat(9000), error_message: "e".repeat(9000), timeline, snapshot });
    const raw = Object.values(store)[0];
    expect(raw.length).toBeLessThanOrEqual(32 * 1024);
    expect(JSON.parse(raw).status).toBe("error");
  });

  it("rejects an unknown status", async () => {
    const { env } = envWithStore();
    expect((await post(env, { license_key: KEY, status: "weird" })).status).toBe(400);
  });

  it("rejects a missing license key and a non-object body", async () => {
    const { env } = envWithStore();
    expect((await post(env, { status: "success" })).status).toBe(400);
    expect((await post(env, null)).status).toBe(400);
  });

  it("progress entries do not make /install-status report installed", async () => {
    const { env } = envWithStore();
    await post(env, { license_key: KEY, status: "progress", step: "a" });
    const res = await worker.fetch(new Request(`https://x/install-status?key=${KEY}`), env);
    expect(await res.json()).toEqual({ installed: false });
  });
});
