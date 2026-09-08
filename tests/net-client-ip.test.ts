import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIp } from "@/lib/net/clientIp";

function h(init: Record<string, string>) {
  return new Headers(init);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp trust model (X-C3)", () => {
  it("ignores XFF entirely when no trusted proxy is configured", () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("TRUST_PROXY", undefined);
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 198.51.100.2" }))).toBeNull();
    expect(clientIp(h({ "x-real-ip": "203.0.113.9" }))).toBeNull();
    expect(clientIp(h({}))).toBeNull();
  });

  it("uses the LAST XFF hop behind a trusted proxy (the one our proxy added)", () => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("TRUST_PROXY", "1");
    // Client-supplied spoof first, trusted proxy appended the real peer last.
    expect(
      clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    ).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("treats Vercel as a trusted proxy", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TRUST_PROXY", undefined);
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip only behind a trusted proxy", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(h({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("returns null for a spoofed chain of empty/malformed hops", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(h({ "x-forwarded-for": "  , ," }))).toBeNull();
  });
});
