import { describe, it, expect } from "vitest";
import { welcomeText, welcomeHtml, welcomeSubject } from "../src/email/welcome-template";

const input = {
  customerName: "Marco",
  licenseKey: "SHOP-AAAA-BBBB-CCCC",
  pdfUrl: "https://example/welcome.pdf",
};

describe("welcomeText", () => {
  it("includes the license key", () => {
    expect(welcomeText(input)).toContain("SHOP-AAAA-BBBB-CCCC");
  });
  it("includes the customer name", () => {
    expect(welcomeText(input)).toContain("Marco");
  });
  it("includes the install command for both platforms", () => {
    const text = welcomeText(input);
    expect(text).toContain("/installer-macos.sh");
    expect(text).toContain("/installer-windows.ps1");
  });
  // -UseBasicParsing is what stops PowerShell showing customers a "Script
  // Execution Risk" malware warning (whose own recommended action is to add
  // this switch). Losing it silently would put that prompt back in front of
  // every Windows buyer, so both renderings assert it.
  it("keeps -UseBasicParsing on the Windows one-liner", () => {
    expect(welcomeText(input)).toContain("iwr -UseBasicParsing");
    expect(welcomeHtml(input)).toContain("iwr -UseBasicParsing");
  });
  it("warns Mac users about the paste block and the invisible password", () => {
    const text = welcomeText(input);
    expect(text).toContain("Paste Blocked");
    expect(text).toContain("Paste Anyway");
    expect(text).toMatch(/password/i);
  });
  it("includes the pdf url", () => {
    expect(welcomeText(input)).toContain("https://example/welcome.pdf");
  });
});

describe("welcomeHtml", () => {
  it("starts with doctype", () => {
    expect(welcomeHtml(input)).toMatch(/^<!doctype html>/);
  });
  it("escapes the customer name", () => {
    const html = welcomeHtml({ ...input, customerName: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("escapes the pdf url in href attribute", () => {
    const html = welcomeHtml({ ...input, pdfUrl: 'https://x/"><script>1</script>' });
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;');
  });
  // The template used to print the key a second time in a "paste it here"
  // block; that block is gone and § 01 is now the single source. Assert
  // presence rather than a count so the test tracks the template as designed.
  it("includes the license key in the § 01 key box", () => {
    const html = welcomeHtml(input);
    const matches = html.match(/SHOP-AAAA-BBBB-CCCC/g);
    expect(matches?.length).toBeGreaterThanOrEqual(1);
  });
  it("warns Mac users about the paste block", () => {
    expect(welcomeHtml(input)).toContain("Paste Anyway");
  });
});

describe("welcomeSubject", () => {
  it("matches the documented subject line", () => {
    expect(welcomeSubject()).toBe("Welcome to Shop OS, your license key and install instructions");
  });
});
