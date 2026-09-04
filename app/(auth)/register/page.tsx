import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { districts, organisationsMeta, organization } from "@/lib/db/schema";
import { RegisterForm, type Option } from "./register-form";

export const metadata = { title: "Register" };
// Reads the seeded district and organisation lists on every request.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const [districtRows, orgRows] = await Promise.all([
    db.select({ code: districts.code, name: districts.name }).from(districts).orderBy(asc(districts.name)),
    db
      .select({ id: organization.id, name: organization.name, orgType: organisationsMeta.orgType })
      .from(organization)
      .leftJoin(organisationsMeta, eq(organisationsMeta.orgId, organization.id))
      .orderBy(asc(organization.name)),
  ]);

  const districtOptions: Option[] = districtRows.map((d) => ({
    value: d.code,
    label: `${d.name} (${d.code})`,
  }));

  const orgOptions: Option[] = orgRows.map((o) => ({
    value: o.id,
    label: o.orgType ? `${o.name} — ${o.orgType}` : o.name,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Create an account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You do not need an account to report a problem. Register to keep a permanent record of your
        reports and the credit attached to them.
      </p>

      <div className="mt-6">
        <RegisterForm districts={districtOptions} organisations={orgOptions} />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Already registered?{" "}
        <Link className="font-medium text-primary underline underline-offset-4" href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
