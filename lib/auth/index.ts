/**
 * Better Auth: email + password sessions, plus the organisation plugin.
 *
 * The organisation is the unit that matters in Milan. An HEI member has no
 * personal claim on a challenge; their department does. A government user is
 * scoped to a district, because the DC of Gumla should not be approving
 * Dhanbad's gate items.
 *
 * Milan's own role lives on `user_profiles.role`, not on the Better Auth user,
 * because the role determines database-level scoping (district, organisation)
 * that the auth tables know nothing about. `lib/auth/guards.ts` is what the rest
 * of the codebase calls.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");

export const auth = betterAuth({
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // No mail server on the demo path, and a citizen with a feature phone has no
    // inbox to check. Identity tiers are the production answer (loophole row 7);
    // this cut ships the tier column and verifies nothing.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    // On by default in production. The default window is tight enough that our
    // own verification script trips it, so it is stated explicitly rather than
    // left to surprise us on stage.
    // Storage is per-instance memory: on Vercel each function instance keeps its
    // own counter, so this slows an attacker down rather than stopping one. A
    // shared store is a declared stub.
    enabled: true,
    window: 60,
    max: 100,
  },
  user: {
    additionalFields: {},
  },
  plugins: [
    organization({
      // No self-serve organisation creation this cut. Real institutional
      // onboarding — an MoU, a nodal officer, a verified domain — is a declared
      // stub; organisations come from the seed.
      allowUserToCreateOrganization: false,
    }),
    // Must be last: it lets server actions set the session cookie.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
