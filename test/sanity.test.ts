import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("vitest runs in workers pool", () => {
    expect(1 + 1).toBe(2);
  });
});
