/**
 * The signed link that lets Sunita confirm a fix from an SMS.
 *
 * Requiring a login here would lose most of the confirmations, and the
 * confirmation is the only thing that moves the impact counter (invariant 7) —
 * so a login wall would quietly turn the most credible number on the page into
 * a small one. The link is therefore an HMAC over the challenge id, signed with
 * BETTER_AUTH_SECRET, valid for 90 days, and it authorises exactly one action:
 * answering yes / partly / no about that one challenge.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { clockNowMs } from "@/lib/clock";

const TTL_MS = 90 * 86_400_000;

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set — confirmation links cannot be signed.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `<challengeId>.<expiryMs>.<hmac>`, url-safe. */
export function verifyToken(challengeId: string, expiresAtMs = clockNowMs() + TTL_MS): string {
  const payload = `${challengeId}.${expiresAtMs}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyLinkFor(challengeId: string): string {
  return `/me/verify/${verifyToken(challengeId)}`;
}

export function readVerifyToken(token: string): { challengeId: string } | { error: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { error: "This confirmation link is malformed." };
  const [challengeId, expiry, mac] = parts;

  const expected = Buffer.from(sign(`${challengeId}.${expiry}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { error: "This confirmation link could not be verified. Ask for a new one." };
  }
  if (Number(expiry) < clockNowMs()) {
    return { error: "This confirmation link has expired. Ask for a new one." };
  }
  return { challengeId };
}
