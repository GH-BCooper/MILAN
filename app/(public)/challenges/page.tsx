import Link from "next/link";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_COLOUR } from "@/components/status-colour";
import {
  SEVERITY_BANDS,
  SeverityChip,
  isSeverityBandKey,
} from "@/components/severity-chip";
import type { MapMarker } from "@/components/milan-map";
import { db } from "@/lib/db";
import {
  challenges,
  districts,
  domainEnum,
  challengeStatusEnum,
  type ChallengeStatus,
  type Domain,
} from "@/lib/db/schema";
import { ChallengeMap } from "./challenge-map";

export const metadata = { title: "Challenges" };
export const dynamic = "force-dynamic";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

/**
 * Lifecycle bands (Task 4.8): the 28-state machine is honest, but a citizen
 * scanning the board thinks in chapters, not states. A band is a set of
 * statuses; composing `band` with `status` is legal and simply narrows.
 */
const LIFECYCLE_BANDS = {
  intake: {
    label: "Intake — reported, being processed",
    statuses: [
      "SUBMITTED",
      "NEEDS_MORE_INFO",
      "TRIAGED",
      "CLASSIFIED",
      "CLUSTERED",
      "PRIORITISED",
      "VERIFIED",
    ],
  },
  open: {
    label: "Open for a team to claim",
    statuses: ["ROUTED", "UNCLAIMED_ESCALATED", "BOUNTY_LISTED"],
  },
  research: {
    label: "In research",
    statuses: [
      "CLAIMED",
      "PROPOSAL_APPROVED",
      "IN_RESEARCH",
      "AT_RISK",
      "AGREEMENT_SIGNED",
      "PILOT",
    ],
  },
  solution: {
    label: "Solution published",
    statuses: ["SOLUTION_PUBLISHED", "INDUSTRY_INTEREST", "FORKED"],
  },
  done: {
    label: "Implemented",
    statuses: ["IMPLEMENTED", "CITIZEN_VERIFIED", "CLOSED"],
  },
  archived: {
    label: "Off the board (merged, forwarded, parked)",
    statuses: [
      "REJECTED_UNSAFE",
      "FORWARDED_EXTERNAL",
      "MERGED",
      "PARKED",
      "WITHDRAWN",
      "DISPUTED",
    ],
  },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly ChallengeStatus[] }
>;

type LifecycleBandKey = keyof typeof LIFECYCLE_BANDS;

export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{
    district?: string;
    domain?: string;
    status?: string;
    band?: string;
    severity?: string;
  }>;
}) {
  const filters = await searchParams;

  // Every filter value is validated against the enum before it reaches SQL.
  const where: SQL[] = [];
  const district = filters.district?.trim().toUpperCase();
  const domain = domainEnum.enumValues.includes(filters.domain as Domain)
    ? (filters.domain as Domain)
    : undefined;
  const status = challengeStatusEnum.enumValues.includes(
    filters.status as ChallengeStatus,
  )
    ? (filters.status as ChallengeStatus)
    : undefined;
  const band = (
    filters.band && filters.band in LIFECYCLE_BANDS ? filters.band : undefined
  ) as LifecycleBandKey | undefined;
  // The JDIP wireframe calls this "severity"; it bands the same priority
  // score the cards badge, so the filter and the chip can never drift apart.
  const severity = isSeverityBandKey(filters.severity)
    ? filters.severity
    : undefined;

  if (district) where.push(eq(challenges.districtCode, district));
  if (domain) where.push(eq(challenges.domain, domain));
  if (status) where.push(eq(challenges.status, status));
  if (band)
    where.push(inArray(challenges.status, [...LIFECYCLE_BANDS[band].statuses]));
  if (severity === "unscored") {
    where.push(isNull(challenges.priorityScore));
  } else if (severity) {
    const sev = SEVERITY_BANDS.find((b) => b.key === severity);
    if (sev?.min !== null && sev?.min !== undefined) {
      where.push(sql`${challenges.priorityScore} >= ${sev.min}`);
    }
    if (sev?.max !== null && sev?.max !== undefined) {
      where.push(sql`${challenges.priorityScore} < ${sev.max}`);
    }
  }

  const [rows, districtRows] = await Promise.all([
    db
      .select({
        id: challenges.id,
        trackingId: challenges.trackingId,
        title: challenges.title,
        status: challenges.status,
        domain: challenges.domain,
        lat: challenges.lat,
        lng: challenges.lng,
        districtCode: challenges.districtCode,
        districtName: districts.name,
        corroborationCount: challenges.corroborationCount,
        priorityScore: challenges.priorityScore,
        createdAt: challenges.createdAt,
      })
      .from(challenges)
      .leftJoin(districts, eq(districts.code, challenges.districtCode))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(challenges.createdAt))
      .limit(500),
    db
      .select({ code: districts.code, name: districts.name })
      .from(districts)
      .orderBy(asc(districts.name)),
  ]);

  // Highest priority first; unscored reports sit at the end rather than the
  // top, so an unscored page never outranks a scored one by accident.
  const displayRows = [...rows].sort(
    (a, b) =>
      (b.priorityScore === null ? -1 : Number(b.priorityScore)) -
      (a.priorityScore === null ? -1 : Number(a.priorityScore)),
  );

  const markers: MapMarker[] = displayRows
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
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Challenges</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every problem reported to Milan, with its current status. Nothing is
          hidden and nothing is deleted.
        </p>

        {/* A plain GET form: filters live in the URL, so a filtered view is a
            link somebody can send to a colleague, and it works with no JS. */}
        <form
          method="get"
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="district"
              className="text-xs font-medium text-muted-foreground"
            >
              District
            </label>
            <select
              id="district"
              name="district"
              defaultValue={district ?? ""}
              className={selectClass}
            >
              <option value="">All districts</option>
              {districtRows.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="domain"
              className="text-xs font-medium text-muted-foreground"
            >
              Domain
            </label>
            <select
              id="domain"
              name="domain"
              defaultValue={domain ?? ""}
              className={selectClass}
            >
              <option value="">All domains</option>
              {domainEnum.enumValues.map((d) => (
                <option key={d} value={d}>
                  {d.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:w-56">
            <label
              htmlFor="severity"
              className="text-xs font-medium text-muted-foreground"
            >
              Severity
            </label>
            <select
              id="severity"
              name="severity"
              defaultValue={severity ?? ""}
              className={selectClass}
            >
              <option value="">All severities</option>
              <option value="critical">Critical (75–100)</option>
              <option value="high">High (50–74)</option>
              <option value="moderate">Moderate (25–49)</option>
              <option value="low">Low (under 25)</option>
              <option value="unscored">Not scored yet</option>
            </select>
          </div>

          <div className="sm:w-64">
            <label
              htmlFor="band"
              className="text-xs font-medium text-muted-foreground"
            >
              Lifecycle
            </label>
            <select
              id="band"
              name="band"
              defaultValue={band ?? ""}
              className={selectClass}
            >
              <option value="">Every stage of life</option>
              {(Object.keys(LIFECYCLE_BANDS) as LifecycleBandKey[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {LIFECYCLE_BANDS[key].label}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="sm:w-56">
            <label
              htmlFor="status"
              className="text-xs font-medium text-muted-foreground"
            >
              Status (exact)
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ""}
              className={selectClass}
            >
              <option value="">All statuses</option>
              {challengeStatusEnum.enumValues.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Apply
            </button>
            {/* A plain <a>, not next/link: a soft client nav leaves the
                uncontrolled <select> DOM nodes on their stale values, so the
                filters look un-cleared. A full document load resets them. */}
            <a
              href="/challenges"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Clear
            </a>
          </div>
        </form>

        <div className="mt-6">
          <ChallengeMap markers={markers} />
        </div>

        <p className="mt-8 text-sm font-medium" aria-live="polite">
          {displayRows.length}{" "}
          {displayRows.length === 1 ? "challenge" : "challenges"}
          {district
            ? ` in ${districtRows.find((d) => d.code === district)?.name ?? district}`
            : ""}
        </p>

        {displayRows.length === 0 ? (
          <div className="milan-glass mt-3 rounded-xl p-5 text-sm">
            <p className="font-semibold">Nothing matches that combination.</p>
            <p className="mt-1 text-muted-foreground">
              The filters are exact on purpose — what you see is all there is,
              never a sample. Loosen one and the board fills back in: a district
              the pipeline is still processing will sit under <em>Intake</em>,
              and a report the scoring stage has not reached yet is under{" "}
              <em>Not scored yet</em>.
            </p>
            <p className="mt-2">
              <Link
                className="text-primary underline underline-offset-4"
                href="/challenges"
              >
                Clear the filters
              </Link>
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border milan-glass rounded-xl">
            {displayRows.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/c/${r.trackingId}`}
                    className="font-mono text-sm font-semibold text-primary underline underline-offset-4"
                  >
                    {r.trackingId}
                  </Link>
                  <StatusBadge status={r.status} />
                  <SeverityChip
                    score={
                      r.priorityScore === null ? null : Number(r.priorityScore)
                    }
                  />
                  {r.domain ? (
                    <span className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {r.domain.replaceAll("_", " ")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-base font-medium text-foreground">
                  {r.title}
                </p>
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
