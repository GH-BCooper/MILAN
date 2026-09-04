import Link from "next/link";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_COLOUR } from "@/components/status-colour";
import type { MapMarker } from "@/components/milan-map";
import { db } from "@/lib/db";
import {
  challenges,
  districts,
  domainEnum,
  hazardEnum,
  challengeStatusEnum,
  type ChallengeStatus,
  type Domain,
  type Hazard,
} from "@/lib/db/schema";
import { ChallengeMap } from "./challenge-map";

export const metadata = { title: "Challenges" };
export const dynamic = "force-dynamic";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto";

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{ district?: string; domain?: string; hazard?: string; status?: string }>;
}) {
  const filters = await searchParams;

  // Every filter value is validated against the enum before it reaches SQL.
  const where: SQL[] = [];
  const district = filters.district?.trim().toUpperCase();
  const domain = domainEnum.enumValues.includes(filters.domain as Domain)
    ? (filters.domain as Domain)
    : undefined;
  const hazard = hazardEnum.enumValues.includes(filters.hazard as Hazard)
    ? (filters.hazard as Hazard)
    : undefined;
  const status = challengeStatusEnum.enumValues.includes(filters.status as ChallengeStatus)
    ? (filters.status as ChallengeStatus)
    : undefined;

  if (district) where.push(eq(challenges.districtCode, district));
  if (domain) where.push(eq(challenges.domain, domain));
  if (hazard) where.push(eq(challenges.hazard, hazard));
  if (status) where.push(eq(challenges.status, status));

  const [rows, districtRows] = await Promise.all([
    db
      .select({
        id: challenges.id,
        trackingId: challenges.trackingId,
        title: challenges.title,
        status: challenges.status,
        domain: challenges.domain,
        hazard: challenges.hazard,
        lat: challenges.lat,
        lng: challenges.lng,
        districtCode: challenges.districtCode,
        districtName: districts.name,
        corroborationCount: challenges.corroborationCount,
        createdAt: challenges.createdAt,
      })
      .from(challenges)
      .leftJoin(districts, eq(districts.code, challenges.districtCode))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(challenges.createdAt))
      .limit(500),
    db.select({ code: districts.code, name: districts.name }).from(districts).orderBy(asc(districts.name)),
  ]);

  const markers: MapMarker[] = rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({
      id: r.id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      label: `${r.trackingId}: ${r.title}`,
      href: `/c/${r.trackingId}`,
      colour: STATUS_COLOUR[r.status],
    }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Challenges</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every problem reported to Milan, with its current status. Nothing is hidden and nothing is
          deleted.
        </p>

        {/* A plain GET form: filters live in the URL, so a filtered view is a
            link somebody can send to a colleague, and it works with no JS. */}
        <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-56">
            <label htmlFor="district" className="text-xs font-medium text-muted-foreground">
              District
            </label>
            <select id="district" name="district" defaultValue={district ?? ""} className={selectClass}>
              <option value="">All districts</option>
              {districtRows.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:w-56">
            <label htmlFor="domain" className="text-xs font-medium text-muted-foreground">
              Domain
            </label>
            <select id="domain" name="domain" defaultValue={domain ?? ""} className={selectClass}>
              <option value="">All domains</option>
              {domainEnum.enumValues.map((d) => (
                <option key={d} value={d}>
                  {d.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:w-56">
            <label htmlFor="hazard" className="text-xs font-medium text-muted-foreground">
              Hazard
            </label>
            <select id="hazard" name="hazard" defaultValue={hazard ?? ""} className={selectClass}>
              <option value="">All hazards</option>
              {hazardEnum.enumValues.map((h) => (
                <option key={h} value={h}>
                  {h.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:w-56">
            <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? ""} className={selectClass}>
              <option value="">All statuses</option>
              {challengeStatusEnum.enumValues.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Apply
            </button>
            <Link
              href="/challenges"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Clear
            </Link>
          </div>
        </form>

        <div className="mt-6">
          <ChallengeMap markers={markers} />
        </div>

        <p className="mt-8 text-sm font-medium" aria-live="polite">
          {rows.length} {rows.length === 1 ? "challenge" : "challenges"}
          {district ? ` in ${districtRows.find((d) => d.code === district)?.name ?? district}` : ""}
        </p>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing matches those filters.{" "}
            <Link className="text-primary underline underline-offset-4" href="/challenges">
              Clear them
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/c/${r.trackingId}`}
                    className="font-mono text-sm font-semibold text-primary underline underline-offset-4"
                  >
                    {r.trackingId}
                  </Link>
                  <StatusBadge status={r.status} />
                  {r.hazard && r.hazard !== "NONE" ? (
                    <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {r.hazard.replaceAll("_", " ")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-base">{r.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.districtName ?? "District not given"} ·{" "}
                  {r.corroborationCount === 1
                    ? "1 person reported this"
                    : `${r.corroborationCount} people reported this`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
