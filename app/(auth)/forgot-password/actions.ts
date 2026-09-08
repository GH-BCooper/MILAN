"use server";

/**
 * Forgot-password flow. Reuses the exact OTP mechanism verify-account already
 * uses (lib/auth/otp.ts) rather than Better Auth's own email-link reset
 * (auth.api.requestPasswordReset), because that path needs an
 * emailAndPassword.sendResetPassword callback and a real mail gateway — this
 * app has neither configured as the default demo path (CLAUDE.md invariant
 * 8). What IS reused from Better Auth is its `/reset-password` primitive
 * (auth.api.resetPassword) for the actual password write: once our OTP is
 * verified we mint a token in the same `verification` table Better Auth's
 * endpoint reads (see lib/auth/otp.ts createResetPasswordToken), so the
 * password hash + account update is Better Auth's own code, not a second
 * hand-rolled path.
 *
 * No account enumeration: every step responds the same way whether or not the
 * email matches an account. A code is only ever actually sent to a channel
 * that is *verified* on that account (CLAUDE.md: OTP goes to the citizen's
 * verified channel, not whatever they typed).
 */
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createResetPasswordToken, requestOtp, verifyOtp, type OtpKind, type RequestOtpResult } from "@/lib/auth/otp";
import { db } from "@/lib/db";
import { user as userTable, userProfiles } from "@/lib/db/schema";

const EmailSchema = z.string().trim().toLowerCase().email();
const CodeSchema = z.string().trim().regex(/^[0-9]{6}$/);

async function findAccount(email: string) {
  const [row] = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      emailVerified: userTable.emailVerified,
      phone: userProfiles.phone,
      phoneVerified: userProfiles.phoneVerified,
    })
    .from(userTable)
    .leftJoin(userProfiles, eq(userProfiles.userId, userTable.id))
    .where(eq(userTable.email, email))
    .limit(1);
  return row ?? null;
}

/** Never log or return a citizen's full number. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export interface LookupResult {
  ok: boolean;
  error?: string;
  email: string;
  emailAvailable: boolean;
  phoneAvailable: boolean;
  maskedPhone: string | null;
}

/** Step 1: locate the account (if any) and report which verified channels a
 *  code can go to. Always succeeds from the citizen's point of view — an
 *  unknown email simply has neither channel available, so the next step's
 *  "send code" silently does nothing rather than exposing a "no such
 *  account" error a stranger could use to enumerate emails. */
export async function lookupAccountAction(email: string): Promise<LookupResult> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) {
    return { ok: false, error: "That does not look like an email address.", email, emailAvailable: false, phoneAvailable: false, maskedPhone: null };
  }
  const account = await findAccount(parsed.data);
  return {
    ok: true,
    email: parsed.data,
    emailAvailable: Boolean(account?.emailVerified),
    phoneAvailable: Boolean(account?.phone && account.phoneVerified),
    maskedPhone: account?.phone ? maskPhone(account.phone) : null,
  };
}

/** Step 2a: send (or resend) a reset code to one verified channel. Silently a
 *  no-op — same shape, `sent: false, demoCode: null` — when there is no
 *  account or that particular channel is not verified, so the UI never has to
 *  branch on "does this account exist." */
export async function requestResetCodeAction(kind: OtpKind, email: string): Promise<RequestOtpResult> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return { sent: false, demoCode: null };

  const account = await findAccount(parsed.data);
  if (!account) return { sent: false, demoCode: null };

  if (kind === "email") {
    if (!account.emailVerified) return { sent: false, demoCode: null };
    return requestOtp("email", account.email, "reset_password");
  }
  if (!account.phone || !account.phoneVerified) return { sent: false, demoCode: null };
  return requestOtp("phone", account.phone, "reset_password");
}

export type VerifyResetState =
  | Record<string, never>
  | { ok: true; token: string }
  | { ok: false; error: string };

/** Step 2b: check the code the citizen typed. Either channel is enough — the
 *  product requirement is "verified email and/or phone," not both — so
 *  success on this call for *either* kind unlocks step 3. */
export async function verifyResetCodeAction(kind: OtpKind, email: string, code: string): Promise<VerifyResetState> {
  const emailParsed = EmailSchema.safeParse(email);
  const codeParsed = CodeSchema.safeParse(code);
  if (!emailParsed.success || !codeParsed.success) {
    return { ok: false, error: "Enter the 6-digit code." };
  }

  const account = await findAccount(emailParsed.data);
  if (!account) return { ok: false, error: "That code did not match, or it has expired." };

  const value = kind === "email" ? account.email : account.phone;
  if (!value) return { ok: false, error: "That code did not match, or it has expired." };

  const match = await verifyOtp(kind, value, codeParsed.data, "reset_password");
  if (!match) return { ok: false, error: "That code did not match, or it has expired." };

  const token = await createResetPasswordToken(account.id);
  return { ok: true, token };
}

export type ResetPasswordState = { error?: string; ok?: boolean };

const NewPasswordSchema = z
  .object({
    token: z.string().trim().min(1),
    newPassword: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

/** Step 3: the only place a new password is actually written, and only ever
 *  reachable with a token minted by verifyResetCodeAction above — i.e. only
 *  after a real OTP check passed. Uses Better Auth's own `/reset-password`
 *  endpoint so hashing and the credential-account update are its code, not
 *  ours. */
export async function resetPasswordAction(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const parsed = NewPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the password fields." };
  }

  try {
    // No `headers()` here — unlike sign-up/sign-in this endpoint sets no
    // session cookie, it only consumes the token and rewrites the credential
    // account, so it needs no request context.
    await auth.api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.newPassword },
    });
  } catch (e) {
    if (e instanceof APIError) {
      return { error: "That reset link has expired. Please request a new code." };
    }
    console.error("resetPasswordAction failed", e);
    return { error: "Something went wrong setting your new password. Please try again." };
  }

  return { ok: true };
}
