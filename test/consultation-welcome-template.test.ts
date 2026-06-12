import { describe, it, expect } from "vitest";
import {
  consultationSubject,
  consultationText,
  consultationHtml,
} from "../src/email/consultation-welcome-template";

const fixture = {
  customerName: "Marco",
  calendlyUrl: "https://calendly.com/blueprintit/1-hour-meeting",
};

describe("consultation-welcome-template", () => {
  it("subject matches the contract used in the spec", () => {
    expect(consultationSubject()).toBe("Your Blueprint IT consultation, pick a time");
  });

  it("plain-text body includes the customer name and Calendly URL", () => {
    const text = consultationText(fixture);
    expect(text).toContain("Hi Marco");
    expect(text).toContain("https://calendly.com/blueprintit/1-hour-meeting");
    expect(text).toContain("Glenn Chua");
    expect(text).toContain("glenn@blueprintit.ai");
  });

  it("HTML body includes the customer name and Calendly URL", () => {
    const html = consultationHtml(fixture);
    expect(html).toContain("Hi Marco");
    expect(html).toContain('href="https://calendly.com/blueprintit/1-hour-meeting"');
    expect(html).toContain("Glenn Chua");
  });

  it("HTML body escapes name and URL to prevent injection", () => {
    const dangerous = consultationHtml({
      customerName: "<script>alert(1)</script>",
      calendlyUrl: 'https://example.com/"><svg onload=alert(1)>',
    });
    // Customer name special chars get HTML-escaped (no live <script> rendered).
    expect(dangerous).not.toContain("<script>alert");
    expect(dangerous).toContain("&lt;script&gt;");
    // URL attribute special chars get escaped so the <svg> tag never closes
    // out of the href="..." attribute. Literal "onload=alert(1)" text may
    // remain as benign text inside the quoted attr — what matters is the
    // attribute boundary holds.
    expect(dangerous).not.toContain('"><svg');
    expect(dangerous).toContain("&quot;");
    expect(dangerous).toContain("&lt;svg");
  });

  it("plain-text body matches the expected shape (snapshot)", () => {
    expect(consultationText(fixture)).toMatchSnapshot();
  });

  it("HTML body matches the expected shape (snapshot)", () => {
    expect(consultationHtml(fixture)).toMatchSnapshot();
  });
});
