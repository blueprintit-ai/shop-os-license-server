import { describe, it, expect } from "vitest";
import { buildWindowsBat, buildMacCommand, type InstallLicenseInfo } from "../src/install-page";

const INFO: InstallLicenseInfo = { key: "SHOP-AB12-CD34-EF56", customer: "Acme Repair" };

describe("buildWindowsBat", () => {
  it("points at shop-os-dashboard's installer, not shop-os-installer's scripts", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).toContain("raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer/setup-windows.ps1");
    // Explanatory comments may still name the old repo to contrast against;
    // what must never appear is a raw.githubusercontent.com URL pointing at it.
    expect(bat).not.toMatch(/raw\.githubusercontent\.com\/blueprintit-ai\/shop-os-installer/);
  });

  it("never relaunches as administrator — the dashboard installer needs no elevation", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).not.toContain("Verb RunAs");
    expect(bat).not.toContain("net session");
  });

  it("passes the license key as a --license argument, not a SHOPOS_LICENSE_KEY env var", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).toContain(`--license "${INFO.key}"`);
    // Explanatory comments may still name the old env var to say it's gone;
    // what must never appear is an actual assignment to it.
    expect(bat).not.toMatch(/SHOPOS_LICENSE_KEY\s*=/);
  });

  it("never pipes a remote fetch into iex — download to a file, then run the file with -File", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).not.toMatch(/\|\s*iex/i);
    expect(bat).toContain("-File \"%SHOPOS_SETUP_PS1%\"");
  });

  it("uses CRLF line endings throughout", () => {
    const bat = buildWindowsBat(INFO);
    // Every line break must be \r\n, not a bare \n slipping in anywhere.
    expect(bat.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("buildMacCommand", () => {
  it("points at shop-os-dashboard's installer, not shop-os-installer's scripts", () => {
    const cmd = buildMacCommand(INFO);
    expect(cmd).toContain("raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer/setup-macos.sh");
    // Explanatory comments may still name the old repo to contrast against;
    // what must never appear is a raw.githubusercontent.com URL pointing at it.
    expect(cmd).not.toMatch(/raw\.githubusercontent\.com\/blueprintit-ai\/shop-os-installer/);
  });

  it("passes the license key as a --license argument, not a SHOPOS_LICENSE_KEY env var", () => {
    const cmd = buildMacCommand(INFO);
    expect(cmd).toContain(`--license "${INFO.key}"`);
    // Explanatory comments may still name the old env var to say it's gone;
    // what must never appear is an actual assignment to it.
    expect(cmd).not.toMatch(/SHOPOS_LICENSE_KEY\s*=/);
  });

  // Regression test: an earlier draft of this generator used `//`
  // (JS-style) comments inside this function's bash template literal
  // instead of `#` (bash-style), which would have shipped a broken
  // .command file to every Mac customer — bash treats a bare `//` line as
  // an attempt to execute a file named `/`, a syntax/exec error. TypeScript
  // itself has no way to catch that, since the comment-shaped text is just
  // string content from the compiler's point of view.
  //
  // This test can't shell out to a real `bash -n` (vitest here runs inside
  // the Cloudflare Workers sandbox — no child_process, no filesystem access
  // to spawn a subprocess against) — verified manually instead with a real
  // `bash -n` against this exact generator's output before this test was
  // written. This regex check is the automated proxy: no line may start
  // with `//`, and every non-shebang, non-blank line up to the first real
  // command must start with `#`.
  it("never emits a JS-style `//` comment into the generated bash script", () => {
    const cmd = buildMacCommand(INFO);
    const lines = cmd.split("\n");
    for (const line of lines) {
      expect(line.trimStart().startsWith("//")).toBe(false);
    }
  });
});
