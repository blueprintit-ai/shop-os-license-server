import { describe, it, expect } from "vitest";
import worker, { Env } from "../src/index";

// Minimal env stub — CORS logic never touches KV or secrets.
const env = {} as unknown as Env;

describe("CORS", () => {
  it("OPTIONS preflight from allowed origin returns 204 with ACA-O", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/validate", {
        method: "OPTIONS",
        headers: {
          Origin: "https://blueprintit.ai",
          "Access-Control-Request-Method": "GET",
        },
      }),
      env
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://blueprintit.ai");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("GET from allowed origin returns ACA-O matching the request Origin", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/", {
        headers: { Origin: "http://localhost:5173" },
      }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("Disallowed origin gets no ACA-O header", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/", {
        headers: { Origin: "https://evil.example.com" },
      }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("Vercel preview deployment of this project is allowed", async () => {
    const previewOrigin = "https://blueprint-it-website-rk5rq9b5v-blueprint-its-projects.vercel.app";
    const res = await worker.fetch(
      new Request("https://example.com/", { headers: { Origin: previewOrigin } }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(previewOrigin);
  });

  it("Unrelated *.vercel.app origin is rejected", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/", {
        headers: { Origin: "https://malicious-project-abc.vercel.app" },
      }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
