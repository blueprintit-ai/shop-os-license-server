import { describe, it, expect } from "vitest";
import { buildWindowsBat, buildMacCommand, type InstallLicenseInfo } from "../src/install-page";

const INFO: InstallLicenseInfo = { key: "SHOP-AB12-CD34-EF56", customer: "Acme Repair" };

// 2026-10-06: the install page was rolled back from shop-os-dashboard's
// installer to shop-os-installer's, because the dashboard installer did not
// yet install Claude Code or the plugins, had no folder picker, and failed on
// a customer's Windows PC. These tests pin the restored flow so a future
// re-cutover is a deliberate change (update these tests with it), not an
// accident.

describe("buildWindowsBat", () => {
  it("points at shop-os-installer's scripts, not shop-os-dashboard's installer", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).toContain("raw.githubusercontent.com/blueprintit-ai/shop-os-installer/main/scripts/setup-windows.ps1");
    expect(bat).not.toMatch(/raw\.githubusercontent\.com\/blueprintit-ai\/shop-os-dashboard/);
  });

  it("relaunches as administrator (the old installer needs it for WinGet)", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).toContain("net session");
    expect(bat).toContain("Verb RunAs");
  });

  it("carries the license key in SHOPOS_LICENSE_KEY, not as a --license argument", () => {
    const bat = buildWindowsBat(INFO);
    expect(bat).toContain(`set "SHOPOS_LICENSE_KEY=${INFO.key}"`);
    expect(bat).not.toContain("--license");
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
  it("points at shop-os-installer's scripts, not shop-os-dashboard's installer", () => {
    const cmd = buildMacCommand(INFO);
    expect(cmd).toContain("raw.githubusercontent.com/blueprintit-ai/shop-os-installer/main/scripts/setup-macos.sh");
    expect(cmd).not.toMatch(/raw\.githubusercontent\.com\/blueprintit-ai\/shop-os-dashboard/);
  });

  it("carries the license key in SHOPOS_LICENSE_KEY, not as a --license argument", () => {
    const cmd = buildMacCommand(INFO);
    expect(cmd).toContain(`export SHOPOS_LICENSE_KEY="${INFO.key}"`);
    expect(cmd).not.toContain("--license");
  });

  it("refuses to run an empty download and surfaces a non-zero setup exit instead of saying 'close this window'", () => {
    const full = buildMacCommand(INFO);
    // Judge the code, not the comments (a comment explains the old shape).
    const cmd = full.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    // Download-then-run, not bash -c "$(curl ...)": an empty body must stop.
    expect(cmd).toMatch(/SETUP_SCRIPT="\$\(curl -fsSL [^)]+setup-macos\.sh\)"/);
    expect(cmd).toContain('if [ -z "$SETUP_SCRIPT" ]');
    expect(cmd).toContain('/bin/bash -c "$SETUP_SCRIPT"');
    expect(cmd).not.toMatch(/bash -c "\$\(curl/);
    // The setup script's exit status is checked before the all-clear line.
    expect(cmd).toContain("rc=$?");
    expect(cmd.indexOf('if [ "$rc" -ne 0 ]')).toBeLessThan(cmd.indexOf("You can close this window."));
  });

  it("neutralises control characters in the customer name so a comment line can't become code", () => {
    const evil = { key: INFO.key, customer: "Acme\nrm -rf /\r\n" };
    const cmd = buildMacCommand(evil);
    const bat = buildWindowsBat(evil);
    expect(cmd).not.toContain("\nrm -rf /");
    expect(bat).not.toContain("\nrm -rf /");
    expect(cmd).toContain("Licensed to: Acme rm -rf /");
  });

  // Regression test: an earlier draft of this generator used `//`
  // (JS-style) comments inside this function's bash template literal
  // instead of `#` (bash-style), which would have shipped a broken
  // .command file to every Mac customer — bash treats a bare `//` line as
  // an attempt to execute a file named `/`, a syntax/exec error. TypeScript
  // itself has no way to catch that, since the comment-shaped text is just
  // string content from the compiler's point of view.
  it("never emits a JS-style `//` comment into the generated bash script", () => {
    const cmd = buildMacCommand(INFO);
    const lines = cmd.split("\n");
    for (const line of lines) {
      expect(line.trimStart().startsWith("//")).toBe(false);
    }
  });
});
