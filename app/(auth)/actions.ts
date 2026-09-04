"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { member, userProfiles } from "@/lib/db/schema";

/**
 * Registration. Zod-validated inside the action, always — a client can call a
 * server action with anything at all.
 *
 * There is no self-serve organisation creation this cut. An HEI or industry
 * registrant picks from the seeded list; real institutional onboarding (an MoU,
 * a nodal officer, a verified email domain) is a declared stub.
 */
const RegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Please give your full name.").max(120),
    email: z.string().trim().toLowerCase().email("That does not look like an email address."),
    password: z.string().min(8, "Use at least 8 characters."),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\- ]{6,20}$/, "Use digits only, with an optional country code.")
      .optional()
      .or(z.literal("")),
    role: z.enum(["CITIZEN", "HEI_MEMBER", "INDUSTRY", "GOVERNMENT", "ADMIN"]),
    preferredLang: z.enum(["en", "hi"]).default("en"),
    districtCode: z.string().trim().min(1).optional().or(z.literal("")),
    orgId: z.string().trim().min(1).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if ((v.role === "HEI_MEMBER" || v.role === "INDUSTRY") && !v.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orgId"],
        message: "Choose your institution or firm from the list.",
      });
    }
    // A government user without a district could approve anybody's gate items.
    if (v.role === "GOVERNMENT" && !v.districtCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["districtCode"],
        message: "A government account must be scoped to a district.",
      });
    }
  });

export type RegisterState = { error?: string; fieldErrors?: Record<string, string[]> };

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const parsed = RegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return { error: "Please check the highlighted fields.", fieldErrors: flat.fieldErrors };
  }
  const input = parsed.data;

  try {
    const result = await auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.fullName },
      headers: await headers(),
    });

    const userId = result.user.id;
    const now = clockNow();

    await db.transaction(async (tx) => {
      await tx.insert(userProfiles).values({
        userId,
        role: input.role,
        fullName: input.fullName,
        phone: input.phone || null,
        preferredLang: input.preferredLang,
        districtCode: input.districtCode || null,
        orgId: input.orgId || null,
      });

      // The organisation plugin's membership row. An HEI member's claim on a
      // challenge is their organisation's, not theirs.
      if (input.orgId) {
        await tx.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: input.orgId,
          userId,
          role: "member",
          createdAt: now,
        });
      }
    });
  } catch (e) {
    if (e instanceof APIError) {
      return { error: e.body?.message ?? "That email is already registered." };
    }
    throw e;
  }

  redirect("/me");
}

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
