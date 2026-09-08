"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { member, userProfiles } from "@/lib/db/schema";
import { DocumentRejectedError, processDocument } from "@/lib/media/document";
import { putObject } from "@/lib/media/storage";

/**
 * Registration. Zod-validated inside the action, always — a client can call a
 * server action with anything at all.
 *
 * There is no self-serve organisation creation this cut. An HEI or industry
 * registrant picks from the seeded list; real institutional onboarding (an MoU,
 * a nodal officer, a verified email domain) is a declared stub. What IS built:
 * every HEI/Industry registrant must submit a proof of affiliation and a
 * supporting document, and an admin must approve it on /admin/verification
 * before their dashboard unlocks (lib/auth/guards.ts requireRole).
 */
const RegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Please give your full name.").max(120),
    email: z.string().trim().toLowerCase().email("That does not look like an email address."),
    password: z.string().min(8, "Use at least 8 characters."),
    // Required for every role — citizens included, per product decision (see
    // PROGRESS.md "Decisions": the earlier no-login, no-phone design is
    // deliberately overridden).
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\- ]{6,20}$/, "Use digits only, with an optional country code."),
    // ADMIN is deliberately absent here: a platform administrator account is
    // created out of band (seed data or a DB script), never through public
    // registration — see CLAUDE.md roles list and lib/auth/guards.ts. This
    // enum is the actual gate: even a raw POST to this action with
    // role=ADMIN is rejected by Zod before it ever reaches the database.
    role: z.enum(["CITIZEN", "HEI_MEMBER", "INDUSTRY", "GOVERNMENT"]),
    preferredLang: z.enum(["en", "hi"]).default("en"),
    districtCode: z.string().trim().min(1).optional().or(z.literal("")),
    orgId: z.string().trim().min(1).optional().or(z.literal("")),
    proofType: z.string().trim().min(1).optional().or(z.literal("")),
    proofTypeOther: z.string().trim().max(160).optional().or(z.literal("")),
    designation: z.string().trim().max(160).optional().or(z.literal("")),
    idNumber: z.string().trim().max(80).optional().or(z.literal("")),
    orgEmail: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    const needsProof = v.role === "HEI_MEMBER" || v.role === "INDUSTRY";
    if (needsProof && !v.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orgId"],
        message: "Choose your institution or firm from the list.",
      });
    }
    if (needsProof && !v.proofType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proofType"],
        message: "Choose what you can show as proof of affiliation.",
      });
    }
    if (needsProof && v.proofType === "OTHER" && !v.proofTypeOther) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proofTypeOther"],
        message: "Describe what you can show as proof of affiliation.",
      });
    }
    if (needsProof && !v.designation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designation"],
        message: "Say what your role is there (e.g. \"Assistant Professor, Civil Engineering\").",
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
  const raw = Object.fromEntries(formData);
  const parsed = RegisterSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return { error: "Please check the highlighted fields.", fieldErrors: flat.fieldErrors };
  }
  const input = parsed.data;
  const needsProof = input.role === "HEI_MEMBER" || input.role === "INDUSTRY";
  const proofType = input.proofType === "OTHER" ? input.proofTypeOther || "" : input.proofType;

  // The proof document. Read before the account is created so a bad upload
  // fails the whole registration rather than leaving a half-verified account.
  let proofDocumentKey: string | null = null;
  if (needsProof) {
    const file = formData.get("proofDocument");
    if (!(file instanceof File) || file.size === 0) {
      return {
        error: "Please attach a supporting document for your proof of affiliation.",
        fieldErrors: { proofDocument: ["A file is required."] },
      };
    }
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const doc = processDocument(bytes, file.type);
      const stored = await putObject(doc.storageKey, doc.bytes, doc.mime);
      // Storage can fail (invariant 8: nothing on the demo path may depend on a
      // third-party API succeeding) — the registration still completes, and
      // the missing document is visible to the reviewing admin as null.
      proofDocumentKey = stored?.storageKey ?? null;
    } catch (e) {
      if (e instanceof DocumentRejectedError) {
        return { error: e.message, fieldErrors: { proofDocument: [e.message] } };
      }
      throw e;
    }
  }

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
        phone: input.phone,
        preferredLang: input.preferredLang,
        districtCode: input.districtCode || null,
        orgId: input.orgId || null,
        orgVerificationStatus: needsProof ? "PENDING" : "NOT_APPLICABLE",
        orgProofType: needsProof ? proofType || null : null,
        orgProofMeta: needsProof
          ? { designation: input.designation || null, idNumber: input.idNumber || null, orgEmail: input.orgEmail || null }
          : null,
        orgProofDocumentKey: proofDocumentKey,
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
    // Never let a registration failure fall through to Next.js's generic
    // error boundary — the citizen loses every field they typed and has no
    // idea what happened. Log it server-side and hand back a plain message.
    console.error("registerAction failed", e);
    return { error: "Something went wrong creating your account. Please try again." };
  }

  redirect("/verify-account");
}

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
