import "server-only";

/**
 * Registration-time OTP verification for email and phone.
 *
 * Deliberately not the Better Auth `phoneNumber` plugin: that plugin wants to
 * own `user.phoneNumber` as a login identifier, which would fight with
 * `userProfiles.phone` and the district/org scoping that already lives there
 * (CLAUDE.md: one schema). Instead this reuses Better Auth's own generic
 * `verification` key/value table — the same table the framework already
 * migrates and owns — and the existing `notify()` provider chain (Resend or
 * Mailpit for email; the mock SMS outbox for phone, per CLAUDE.md invariant 8:
 * nothing on the demo path depends on a live SMS gateway succeeding).
 */
import { randomInt, randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { verification } from "@/lib/db/auth-schema";
import { notify } from "@/lib/notify";

export type OtpKind = "email" | "phone";
// "reset_password" is the forgot-password flow (app/(auth)/forgot-password):
// same code/verify mechanics, a different identifier namespace so a live
// registration code and a live reset code for the same email never collide.
export type OtpPurpose = "register" | "reset_password";

const TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

function identifierFor(kind: OtpKind, purpose: OtpPurpose, value: string): string {
  return `otp:${purpose}:${kind}:${value.trim().toLowerCase()}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Demo-mode visibility: when there is no real SMS gateway (there never is,
 *  this cut — see lib/notify), the code the mock channel "sent" is handed back
 *  so the UI can show it on screen rather than pretending a phone buzzed. */
export interface RequestOtpResult {
  sent: boolean;
  /** Only set when the channel is a declared stub (mock SMS, or email with no
   *  provider configured) — never set when a real send actually happened. */
  demoCode: string | null;
}

export async function requestOtp(
  kind: OtpKind,
  value: string,
  purpose: OtpPurpose = "register",
): Promise<RequestOtpResult> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const identifier = identifierFor(kind, purpose, value);
  const now = clockNow();

  // One live code per identifier: replace rather than accumulate rows.
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: randomUUID(),
    identifier,
    value: hashCode(code),
    expiresAt: new Date(now.getTime() + TTL_MS),
    createdAt: now,
    updatedAt: now,
  });

  if (kind === "email") {
    const result = await notify({
      email: value,
      kind: "OTP_EMAIL",
      title: "Your Milan verification code",
      body: `Your verification code is ${code}. It expires in 10 minutes.`,
      actionUrl: "/verify-account",
      channels: ["email"],
    });
    const delivered = result.delivered.includes("email");
    return { sent: delivered, demoCode: delivered ? null : code };
  }

  const result = await notify({
    phone: value,
    kind: "OTP_SMS",
    title: "Milan verification code",
    body: `Your code is ${code}.`,
    actionUrl: "/verify-account",
    channels: ["sms"],
  });
  const delivered = result.delivered.includes("sms");
  // A real Twilio send is configured only when all three vars are present; in
  // that case the code must NOT be shown on screen. Otherwise (mock inbox or a
  // failed send) surface it so the demo is never stuck waiting for a phone.
  const realGateway = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
  return { sent: delivered, demoCode: realGateway && delivered ? null : code };
}

export async function verifyOtp(
  kind: OtpKind,
  value: string,
  code: string,
  purpose: OtpPurpose = "register",
): Promise<boolean> {
  const identifier = identifierFor(kind, purpose, value);
  const [row] = await db
    .select()
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);

  if (!row) return false;
  if (row.expiresAt.getTime() < clockNow().getTime()) {
    await db.delete(verification).where(eq(verification.identifier, identifier));
    return false;
  }

  const expected = Buffer.from(row.value, "hex");
  const actual = Buffer.from(hashCode(code), "hex");
  const match = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (match) {
    await db.delete(verification).where(eq(verification.identifier, identifier));
  }
  return match;
}

/**
 * Mints a Better Auth-compatible password-reset token, but only ever called
 * after this module's own `verifyOtp("reset_password", ...)` has already
 * succeeded — the OTP is the gate, this token is just the handoff.
 *
 * Written directly into the same `verification` table Better Auth's core
 * `/reset-password` endpoint reads via `internalAdapter.consumeVerificationValue`
 * (identifier `reset-password:<token>`, value = user id). That lets
 * app/(auth)/forgot-password/actions.ts finish the job with
 * `auth.api.resetPassword({ token, newPassword })` — Better Auth's own
 * password hashing and account update — instead of a second hand-rolled
 * "set password" path. Reuse the platform's primitive; keep the OTP gate ours.
 */
export async function createResetPasswordToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  const now = clockNow();
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  return token;
}
