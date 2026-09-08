import "server-only";

/**
 * Client IP trust model — rate limiting, loophole row 7 (X-C3 / C-12).
 *
 * `x-forwarded-for` is only meaningful when the app sits behind a proxy that
 * OVERWRITES it (Vercel does; nginx/caddy with `proxy_set_header
 * X-Forwarded-For $remote_addr` do). When the app is directly reachable the
 * header is plain client input, and rotating it grants a fresh rate-limit
 * budget per spoofed value — the X-C3 bypass: 8 anonymous submissions in
 * seconds, each keyed to `ip:<spoof>`.
 *
 * So an IP is only ever taken from the header chain behind a trusted proxy:
 *
 *  - `VERCEL === "1"` — Vercel strips any client-supplied XFF and sets the
 *    header to the real client address;
 *  - `TRUST_PROXY === "1"` — self-hosted behind a proxy configured to append
 *    the peer address (the entry we can trust is the LAST one, because it is
 *    the one our own proxy added).
 *
 * Anywhere else the header is ignored and we return null: anonymous traffic
 * then shares one bucket instead of minting a fresh one per header value.
 * Signed-in users are unaffected — the limiter keys on userId when present.
 */
export function clientIp(headersList: Headers): string | null {
  if (process.env.VERCEL === "1" || process.env.TRUST_PROXY === "1") {
    const chain = headersList.get("x-forwarded-for");
    if (chain) {
      const hops = chain.split(",").map((s) => s.trim()).filter(Boolean);
      if (hops.length > 0) return hops[hops.length - 1];
    }
    const realIp = headersList.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  return null;
}
