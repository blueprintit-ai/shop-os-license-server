import { describe, it, expect, vi } from "vitest";
import { sendWelcomeEmail } from "../src/email/resend";

describe("sendWelcomeEmail", () => {
  it("posts to Resend with Bearer auth and correct body shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 })
    );
    const r = await sendWelcomeEmail("re_test", {
      to: "marco@example.com",
      customerName: "Marco",
      licenseKey: "SHOP-AAAA-BBBB-CCCC",
      pdfUrl: "https://x/welcome.pdf",
    }, fetchMock as unknown as typeof fetch);

    expect(r.id).toBe("msg_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_test");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.from).toContain("glenn@blueprintit.ai");
    expect(body.to).toBe("marco@example.com");
    expect(body.subject).toContain("Welcome to Shop OS");
    expect(body.html).toContain("SHOP-AAAA-BBBB-CCCC");
    expect(body.text).toContain("SHOP-AAAA-BBBB-CCCC");
    expect(body.reply_to).toBe("glenn@blueprintit.ai");
    expect(body.attachments).toBeUndefined();
  });

  it("includes attachment when base64 + filename provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_456" }), { status: 200 })
    );
    await sendWelcomeEmail("re_test", {
      to: "marco@example.com",
      customerName: "Marco",
      licenseKey: "SHOP-AAAA-BBBB-CCCC",
      pdfUrl: "https://x/welcome.pdf",
      attachmentBase64: "JVBERi0xLjQK", // "%PDF-1.4\n" in base64
      attachmentFilename: "shop-os-welcome.pdf",
    }, fetchMock as unknown as typeof fetch);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.attachments).toEqual([
      { filename: "shop-os-welcome.pdf", content: "JVBERi0xLjQK" },
    ]);
  });

  it("returns error object on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 })
    );
    const r = await sendWelcomeEmail("re_bad", {
      to: "marco@example.com",
      customerName: "Marco",
      licenseKey: "SHOP-AAAA-BBBB-CCCC",
      pdfUrl: "https://x/welcome.pdf",
    }, fetchMock as unknown as typeof fetch);

    expect(r.id).toBeUndefined();
    expect(r.error?.message).toMatch(/Invalid API key/i);
  });
});
