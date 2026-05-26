import { describe, it, expect, vi } from "vitest";
import worker, { Env } from "../src/index";

describe("GET /welcome.pdf", () => {
  it("returns the PDF with correct headers when ASSETS has the file", async () => {
    const pdfBody = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF magic bytes
    const assetsFetch = vi.fn().mockResolvedValue(
      new Response(pdfBody, { status: 200, headers: { "Content-Type": "application/pdf" } })
    );
    const env = { ASSETS: { fetch: assetsFetch } } as unknown as Env;

    const req = new Request("https://x.example/welcome.pdf", {
      method: "GET",
      headers: { Origin: "https://blueprintit.ai" },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="shop-os-welcome.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://blueprintit.ai");
    expect(assetsFetch).toHaveBeenCalledOnce();
  });

  it("returns 404 when ASSETS does not have the file", async () => {
    const assetsFetch = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    const env = { ASSETS: { fetch: assetsFetch } } as unknown as Env;
    const req = new Request("https://x.example/welcome.pdf", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });
});
