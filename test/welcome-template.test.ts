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
  it("includes the install command", () => {
    expect(welcomeText(input)).toContain("npx -y --package=github:blueprintit-ai/shop-os-installer");
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
  it("includes the license key twice (header box + paste-it block)", () => {
    const html = welcomeHtml(input);
    const matches = html.match(/SHOP-AAAA-BBBB-CCCC/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("welcomeSubject", () => {
  it("matches the documented subject line", () => {
    expect(welcomeSubject()).toBe("Welcome to Shop OS, your license key and install instructions");
  });
});
