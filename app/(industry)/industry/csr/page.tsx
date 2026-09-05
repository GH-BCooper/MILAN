import Link from "next/link";

import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/guards";
import { csrReport } from "@/lib/csr/report";

export const dynamic = "force-dynamic";
export const metadata = { title: "CSR report" };

/**
 * The audit-ready §135 export, on screen.
 *
 * Confirmed and unconfirmed impact are rendered as two separate blocks with two
 * separate beneficiary totals, and the unconfirmed one is grey. They are never
 * summed on this page, in the CSV or in the PDF, because summing them is exactly
 * the thing that makes a CSR report worthless.
 */
export default async function CsrPage() {
  const user = await requireRole("INDUSTRY", "ADMIN");
  if (!user.orgId) {
    return (
      <RoleShell title="CSR report" subtitle="This account is not attached to an organisation.">
        <p className="rounded-lg border border-dashed border-border bg-muted p-6 text-sm text-muted-foreground">
          A CSR report is produced for a company. Ask an administrator to attach this account to one.
        </p>
      </RoleShell>
    );
  }

  const report = await csrReport(user.orgId, user.fullName);

  return (
    <RoleShell
      title="CSR report"
      subtitle={`Companies Act 2013, section 135. ${report.rows.length} project${report.rows.length === 1 ? "" : "s"} supported across ${report.districts.length} district${report.districts.length === 1 ? "" : "s"}.`}
    >
      <div className="space-y-8">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border-2 border-emerald-600 bg-emerald-50 p-4">
            <p className="text-3xl font-bold tabular-nums text-emerald-950">{report.confirmed}</p>
            <p className="mt-1 text-sm font-semibold text-emerald-900">Confirmed by the citizen</p>
            <p className="mt-1 text-xs text-emerald-900">
              {report.beneficiariesConfirmed.toLocaleString("en-IN")} beneficiaries. This is the figure
              you can put in front of an auditor.
            </p>
          </div>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-3xl font-bold tabular-nums text-amber-900">{report.partial}</p>
            <p className="mt-1 text-sm font-semibold text-amber-900">Partly confirmed</p>
            <p className="mt-1 text-xs text-amber-900">
              The citizen said it was partly fixed. Reported separately, never rounded up.
            </p>
          </div>
          <div className="rounded-lg border border-neutral-300 bg-neutral-100 p-4">
            <p className="text-3xl font-bold tabular-nums text-neutral-500">{report.unconfirmed}</p>
            <p className="mt-1 text-sm font-semibold text-neutral-600">Claimed, not confirmed</p>
            <p className="mt-1 text-xs text-neutral-600">
              {report.beneficiariesUnconfirmed.toLocaleString("en-IN")} claimed beneficiaries, deliberately
              NOT added to the figure on the left.
            </p>
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          <Link href="/api/industry/csr?format=csv" className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Export CSV
          </Link>
          <Link href="/api/industry/csr?format=pdf" className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold">
            Export PDF
          </Link>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Every project, with its impact status</h2>
          {report.rows.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
              You have not expressed interest in anything yet.{" "}
              <Link href="/industry/discover" className="text-primary underline underline-offset-4">
                Browse challenges and published solutions
              </Link>
              .
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Challenge</th>
                    <th className="py-2 pr-3">District</th>
                    <th className="py-2 pr-3">Hazard</th>
                    <th className="py-2 pr-3">Institution</th>
                    <th className="py-2 pr-3 text-right">Artifacts</th>
                    <th className="py-2 pr-3 text-right">Beneficiaries</th>
                    <th className="py-2">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => {
                    const grey = r.impact_status === "CLAIMED, NOT CONFIRMED" || r.impact_status === "NO IMPLEMENTATION CLAIMED";
                    return (
                      <tr key={r.tracking_id} className={`border-b border-border/60 ${grey ? "text-neutral-500" : ""}`}>
                        <td className="py-2 pr-3">
                          <Link href={`/c/${r.tracking_id}`} className="underline-offset-4 hover:underline">
                            {r.challenge}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{r.tracking_id}</span>
                        </td>
                        <td className="py-2 pr-3 text-xs">{r.district ?? "—"}</td>
                        <td className="py-2 pr-3 text-xs">{r.ndma_hazard?.replace(/_/g, " ").toLowerCase() ?? "—"}</td>
                        <td className="py-2 pr-3 text-xs">{r.institution ?? "not yet claimed"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.artifacts}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.beneficiaries ?? "—"}</td>
                        <td className="py-2 text-xs">
                          <span
                            className={`rounded px-2 py-0.5 font-medium ${
                              r.impact_status === "CONFIRMED BY CITIZEN"
                                ? "bg-emerald-100 text-emerald-900"
                                : r.impact_status === "PARTLY CONFIRMED BY CITIZEN"
                                  ? "bg-amber-100 text-amber-900"
                                  : r.impact_status === "DISPUTED BY CITIZEN"
                                    ? "bg-red-100 text-red-900"
                                    : "bg-neutral-200 text-neutral-600"
                            }`}
                          >
                            {r.impact_status.toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-muted p-4 text-sm">
          <p className="font-semibold">Declared stubs on this page.</p>
          <p className="mt-1 text-muted-foreground">
            Spend columns are blank in the export because payment rails are not implemented; they are
            provided for the filer rather than filled with a number we invented. E-signature and MoU
            negotiation threads are not implemented either — Milan generates the MoU from a template and
            hashes it into the append-only ledger, which settles the dispute an MoU actually produces.
          </p>
        </section>
      </div>
    </RoleShell>
  );
}
