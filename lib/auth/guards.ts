/**
 * Server-side authorisation. This is the real check.
 *
 * `middleware.ts` also gates these routes, but middleware is UX: it redirects an
 * unauthorised user before a page renders. It can be bypassed by calling a
 * server action directly, so every handler and every server action calls one of
 * these as well. Say this in Q&A if asked.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { organisationsMeta, userProfiles, type Role } from "@/lib/db/schema";
import { auth } from "./index";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface MilanUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  fullName: string;
  districtCode: string | null;
  blockCode: string | null;
  orgId: string | null;
  preferredLang: string;
  verifiedTier: number;
}

/** The session and profile of the current request, or null when signed out. */
export async function currentUser(): Promise<MilanUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  // A Better Auth user with no Milan profile is a half-finished registration.
  // Treat them as a citizen rather than crashing the page.
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: profile?.role ?? "CITIZEN",
    fullName: profile?.fullName ?? session.user.name,
    districtCode: profile?.districtCode ?? null,
    blockCode: profile?.blockCode ?? null,
    orgId: profile?.orgId ?? null,
    preferredLang: profile?.preferredLang ?? "en",
    verifiedTier: profile?.verifiedTier ?? 1,
  };
}

/** Redirects to /login when signed out. Use in pages. */
export async function requireUser(returnTo?: string): Promise<MilanUser> {
  const user = await currentUser();
  if (!user) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${next}`);
  }
  return user;
}

/** Redirects a signed-out user to /login and a wrong-role user to /. */
export async function requireRole(...roles: Role[]): Promise<MilanUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    // ADMIN is deliberately not a wildcard. An admin who needs a gov screen is
    // given the GOVERNMENT role too; implicit superuser access is how audit
    // trails get holes in them.
    redirect("/?denied=role");
  }
  return user;
}

/**
 * A government user is scoped to a district. The DC of Gumla must not be able to
 * open a Dhanbad-scoped page, and this is the function that stops them.
 * ADMIN is exempt because the admin console is cross-district by definition.
 */
export async function requireDistrict(code: string): Promise<MilanUser> {
  const user = await requireUser();
  if (user.role === "ADMIN") return user;
  if (user.districtCode !== code) {
    throw new ForbiddenError(
      `${user.email} is scoped to district ${user.districtCode ?? "(none)"} and cannot act on ${code}.`,
    );
  }
  return user;
}

/** Membership of the organisation, checked against `user_profiles.org_id`. */
export async function requireOrgMember(orgId: string): Promise<MilanUser> {
  const user = await requireUser();
  if (user.role === "ADMIN") return user;
  if (user.orgId !== orgId) {
    throw new ForbiddenError(`${user.email} is not a member of organisation ${orgId}.`);
  }
  return user;
}

/** The district a challenge-scoped gov page should be checked against. */
export async function orgDistrict(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ districtCode: organisationsMeta.districtCode })
    .from(organisationsMeta)
    .where(eq(organisationsMeta.orgId, orgId))
    .limit(1);
  return row?.districtCode ?? null;
}
