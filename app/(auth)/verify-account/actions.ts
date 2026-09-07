"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requestOtp, verifyOtp, type RequestOtpResult } from "@/lib/auth/otp";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { user as userTable, userProfiles } from "@/lib/db/schema";

export type VerifyState = { ok: boolean; message: string } | Record<string, never>;

const CodeSchema = z.object({ code: z.string().trim().regex(/^[0-9]{6}$/, "Enter the 6-digit code.") });

export async function verifyEmailCodeAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const me = await requireUser();
  const parsed = CodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid code." };

  const match = await verifyOtp("email", me.email, parsed.data.code);
  if (!match) return { ok: false, message: "That code did not match, or it has expired." };

  // Better Auth owns emailVerified on its own `user` table.
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, me.id));
  revalidatePath("/verify-account");
  return { ok: true, message: "Email verified." };
}

export async function verifyPhoneCodeAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const me = await requireUser();
  const parsed = CodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid code." };

  const [profile] = await db.select({ phone: userProfiles.phone }).from(userProfiles).where(eq(userProfiles.userId, me.id)).limit(1);
  if (!profile?.phone) return { ok: false, message: "No phone number is on your account." };

  const match = await verifyOtp("phone", profile.phone, parsed.data.code);
  if (!match) return { ok: false, message: "That code did not match, or it has expired." };

  await db.update(userProfiles).set({ phoneVerified: true }).where(eq(userProfiles.userId, me.id));
  revalidatePath("/verify-account");
  return { ok: true, message: "Phone verified." };
}

export async function resendOtpAction(kind: "email" | "phone"): Promise<RequestOtpResult> {
  const me = await requireUser();
  if (kind === "email") return requestOtp("email", me.email);

  const [profile] = await db.select({ phone: userProfiles.phone }).from(userProfiles).where(eq(userProfiles.userId, me.id)).limit(1);
  if (!profile?.phone) return { sent: false, demoCode: null };
  return requestOtp("phone", profile.phone);
}

