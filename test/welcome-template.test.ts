import { describe, it, expect } from "vitest";
import { welcomeText, welcomeHtml, welcomeSubject } from "../src/email/welcome-template";

const input = {
  customerName: "Marco",
  licenseKey: "SHOP-AAAA-BBBB-CCCC",
  pdfUrl: "https://example/welcome.pdf",
  bookingUrl: "https://calendly.com/blueprintit/shop-os-setup",
  installUrl: "https://shop-os-license-server.glenn-15d.workers.dev/install?key=SHOP-TEST-TEST-TEST",
};

describe("welcomeText", () => {
  it("includes the license key", () => {
    expect(welcomeText(input)).toContain("SHOP-AAAA-BBBB-CCCC");
  });
  it("includes the customer name", () => {
    expect(welcomeText(input)).toContain("Marco");
  });
  it("includes the booking link for the setup and training sessions", () => {
    expect(welcomeText(input)).toContain("https://calendly.com/blueprintit/shop-os-setup");
  });
  // Calendly hosts ONE 1-hour event ("Shop OS Foundation Setup"), not two
  // 30-minute ones. Copy that tells customers to book two separate sessions
  // sends them looking for an event type that does not exist.
  it("describes one booking covering both halves of the hour", () => {
    const text = welcomeText(input);
    expect(text).toMatch(/First 30 minutes, setup/);
    expect(text).toMatch(/Second 30 minutes, training/);
    expect(text).toMatch(/One booking covers both halves/i);
    expect(text).not.toMatch(/split them across\s+two days/i);
  });
  // Policy since 2026-08-30: the email offers BOTH paths. Self install is an
  // optional personalized link (no raw commands to paste), and the guided
  // onboarding hour stays the primary, still-recommended path.
  it("offers the personalized self-install link without raw paste-me commands", () => {
    const text = welcomeText(input);
    expect(text).toContain("INSTALL IT YOURSELF (OPTIONAL)");
    expect(text).toContain(input.installUrl);
    expect(text).not.toMatch(/installer-macos|installer-windows|iwr -UseBasicParsing|curl -fsSL/);
  });
  it("keeps the booking section alongside self install", () => {
    const text = welcomeText(input);
    expect(text).toContain("BOOK YOUR ONBOARDING HOUR");
    expect(text).toContain(input.bookingUrl);
    expect(text).toMatch(/does not use\s+up your setup and training session/);
  });
  it("lists the prep items for the setup session", () => {
    const text = welcomeText(input);
    expect(text).toContain("https://claude.ai/onboarding");
    expect(text).toMatch(/login password/i);
    expect(text).toMatch(/where the vault should live/i);
  });
  it("lists the prep items for the training half", () => {
    const text = welcomeText(input);
    expect(text).toMatch(/who should be in the room/i);
    expect(text).toMatch(/past quotes/i);
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
  it("escapes the booking url in href attribute", () => {
    const html = welcomeHtml({ ...input, bookingUrl: 'https://x/"><svg onload=alert(1)>' });
    expect(html).not.toContain('"><svg');
    expect(html).toContain('&quot;');
  });
  it("includes the license key in the § 01 key box", () => {
    const html = welcomeHtml(input);
    const matches = html.match(/SHOP-AAAA-BBBB-CCCC/g);
    expect(matches?.length).toBeGreaterThanOrEqual(1);
  });
  it("links the booking url", () => {
    expect(welcomeHtml(input)).toContain('href="https://calendly.com/blueprintit/shop-os-setup"');
  });
  it("offers the self-install link without raw paste-me commands", () => {
    const html = welcomeHtml(input);
    expect(html).toContain(`href="${input.installUrl}"`);
    expect(html).not.toMatch(/installer-macos|installer-windows|iwr -UseBasicParsing|curl -fsSL/);
  });
});

describe("welcomeSubject", () => {
  it("matches the documented subject line", () => {
    expect(welcomeSubject()).toBe("Welcome to Shop OS, your license key and next steps");
  });
});
