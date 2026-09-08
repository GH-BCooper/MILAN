/**
 * /profile — the account page reached by clicking your own name in the header
 * (item 11). Shows the identity Milan holds for you and what has been verified,
 * plus a password reset. Fields Milan does not collect (date of birth / age) are
 * shown as such rather than invented.
 */
import { eq } from "drizzle-orm";

import { RoleBadge } from "@/components/role-badge";
import { RoleShell } from "@/components/role-shell";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { organization, user as userTable, userProfiles } from "@/lib/db/schema";
import { AvatarUpload } from "./avatar-upload";
import { DeleteAccountForm } from "./delete-account-form";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile" };

function Verified({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="rounded border border-emerald-500/40 bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
      verified
    </span>
  ) : (
    <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
      not verified
    </span>
  );
}

function Row({ label, value, badge }: { label: string; value: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-sm font-medium">
        {value}
        {badge}
      </dd>
    </div>
  );
}

export default async function ProfilePage() {
  const me = await requireUser("/profile");

  const [row] = await db
    .select({
      image: userTable.image,
      emailVerified: userTable.emailVerified,
      phone: userProfiles.phone,
      phoneVerified: userProfiles.phoneVerified,
      verifiedTier: userProfiles.verifiedTier,
      orgName: organization.name,
    })
    .from(userTable)
    .innerJoin(userProfiles, eq(userProfiles.userId, userTable.id))
    .leftJoin(organization, eq(organization.id, userProfiles.orgId))
    .where(eq(userTable.id, me.id))
    .limit(1);

  const initials = me.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <RoleShell title="Your profile" subtitle="What Milan holds for your account, and what has been verified.">
      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <div className="milan-glass rounded-xl p-5">
          <div className="flex items-center gap-4">
            <AvatarUpload image={row?.image ?? null} initials={initials} />
            <div>
              <p className="text-lg font-semibold">{me.fullName}</p>
              <div className="mt-1">
                <RoleBadge role={me.role} districtCode={me.districtCode} />
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Click your photo to change it — JPEG, PNG or WebP, EXIF stripped on upload.
          </p>
        </div>

        <dl className="milan-glass divide-y divide-border rounded-xl px-5">
          <Row label="Full name" value={me.fullName} badge={<Verified ok={(row?.verifiedTier ?? 1) >= 2} />} />
          <Row label="Date of birth / age" value={<span className="text-muted-foreground">Not collected</span>} />
          <Row label="Email" value={me.email} badge={<Verified ok={Boolean(row?.emailVerified)} />} />
          <Row
            label="Phone"
            value={row?.phone ?? <span className="text-muted-foreground">Not given</span>}
            badge={<Verified ok={Boolean(row?.phoneVerified)} />}
          />
          <Row label="Identity tier" value={`Tier ${row?.verifiedTier ?? 1} of 3`} />
          {row?.orgName ? <Row label="Organisation" value={row.orgName} /> : null}
          {me.districtCode ? <Row label="District" value={me.districtCode} /> : null}
        </dl>
      </div>

      <section className="mt-10 max-w-md">
        <h2 className="text-lg font-semibold">Reset your password</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Changing it signs out every other device.
        </p>
        <PasswordForm />
      </section>

      <section className="mt-10 max-w-md">
        <h2 className="text-lg font-semibold text-destructive">Delete account</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Removes everything Milan holds about you from the database.
        </p>
        <DeleteAccountForm />
      </section>
    </RoleShell>
  );
}
