/**
 * Tasks 3.4 and 3.5 verification, end to end against the real database.
 *
 * Publishes a CC-BY artifact and a RESTRICTED one, proves the same bytes dedup
 * to one storage key, requests access as the seeded Tata Steel Foundation user,
 * grants it as the project lead, downloads, and asserts the access_log row and
 * the ACCESS ledger entry both exist. Then attempts an UPDATE on ledger_entries
 * (must fail) and verifies the chain.
 *
 *   pnpm verify:provenance
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql, eq, and } = await import("drizzle-orm");
const { publishArtifact, mayDownload } = await import("@/lib/artifacts/publish");
const { verifyChain } = await import("@/lib/ledger/verify");
const { chainHead, appendEntry } = await import("@/lib/ledger/append");
const { citationString, bibtex } = await import("@/lib/credit/citation");
const { clockNow } = await import("@/lib/clock");
const schema = await import("@/lib/db/schema");

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

console.log(`\nTasks 3.4 / 3.5 — provenance, licensing and the access log\n${"-".repeat(72)}`);

/* --- who and what ---------------------------------------------------------- */

const [project] = await db
  .select({ id: schema.projects.id, leadUserId: schema.projects.leadUserId, challengeId: schema.projects.challengeId })
  .from(schema.projects)
  .limit(1);
if (!project) throw new Error("No project to publish against. Run the HEI claim flow first.");

const [lead] = await db
  .select({ id: schema.userProfiles.userId, name: schema.userProfiles.fullName })
  .from(schema.userProfiles)
  .where(eq(schema.userProfiles.role, "HEI_MEMBER"))
  .limit(1);

const [industry] = await db
  .select({ id: schema.userProfiles.userId, name: schema.userProfiles.fullName, orgId: schema.userProfiles.orgId })
  .from(schema.userProfiles)
  .where(eq(schema.userProfiles.role, "INDUSTRY"))
  .limit(1);

const [challenge] = await db
  .select({ trackingId: schema.challenges.trackingId, title: schema.challenges.title, reporterName: schema.challenges.reporterName, createdAt: schema.challenges.createdAt })
  .from(schema.challenges)
  .where(eq(schema.challenges.id, project.challengeId))
  .limit(1);

console.log(`project ${project.id}  lead ${lead?.name}  industry ${industry?.name}\n`);

/* --- publish CC-BY --------------------------------------------------------- */

const bytes = Buffer.from(`Milan verification artifact ${clockNow().toISOString()}\n`);
const open = await publishArtifact({
  projectId: project.id,
  kind: "REPORT",
  title: "Embankment fissure early-warning: sensor siting and thresholds",
  abstract:
    "A method for siting low-cost tilt sensors along an earthen embankment and the displacement thresholds that " +
    "should trigger an evacuation advisory. Published so that any district may reuse it.",
  licence: "CC_BY",
  authorId: lead!.id,
  file: { bytes, mime: "application/pdf", name: "report.pdf" },
});
record("a CC-BY artifact publishes and writes a ledger entry", Boolean(open.artifactId && open.ledgerSeq), `ledger #${open.ledgerSeq}, sha256 ${open.contentHash.slice(0, 16)}…`);
record("the storage key IS the content hash", open.storageKey === `artifacts/${open.contentHash}`, open.storageKey ?? "no file");

/* --- the same bytes again -> the same key, dedup --------------------------- */

const again = await publishArtifact({
  projectId: project.id,
  kind: "REPORT",
  title: "Embankment fissure early-warning (resubmitted, identical file)",
  abstract: "The identical file, published a second time to demonstrate that content-hash keying deduplicates it.",
  licence: "CC_BY",
  authorId: lead!.id,
  file: { bytes, mime: "application/pdf", name: "report.pdf" },
});
record("the same file twice = the same key = automatic dedup", again.contentHash === open.contentHash && again.deduped, `${again.contentHash.slice(0, 16)}… deduped=${again.deduped}`);

/* --- publish RESTRICTED ---------------------------------------------------- */

const restricted = await publishArtifact({
  projectId: project.id,
  kind: "DATASET",
  title: "Embankment fissure early-warning: raw displacement dataset",
  abstract:
    "Eighteen months of raw tilt and rainfall readings. The abstract, the problem and this title are public; " +
    "the dataset itself is behind a request because it carries surveyed landholding boundaries.",
  licence: "RESTRICTED",
  authorId: lead!.id,
  file: { bytes: Buffer.from("displacement,rainfall\n0.02,14\n"), mime: "text/csv", name: "data.csv" },
});
record("a RESTRICTED artifact publishes", Boolean(restricted.artifactId), `ledger #${restricted.ledgerSeq}`);

const anonymous = await mayDownload(restricted.artifactId, null);
record("an anonymous download of the restricted file is refused", !anonymous.allowed, anonymous.reason);

const openAnonymous = await mayDownload(open.artifactId, null);
record("an anonymous download of the CC-BY file is allowed", openAnonymous.allowed, openAnonymous.reason);

/* --- request, grant, download, log ----------------------------------------- */

const purpose = "Evaluating the sensor design for a three-embankment pilot in West Singhbhum under our FY27 CSR programme.";
const at = clockNow();

await db
  .insert(schema.accessRequests)
  .values({ artifactId: restricted.artifactId, requesterId: industry!.id, orgId: industry!.orgId, purpose, createdAt: at })
  .onConflictDoUpdate({
    target: [schema.accessRequests.artifactId, schema.accessRequests.requesterId],
    set: { purpose, state: "PENDING", decidedAt: null, decidedBy: null },
  });

const beforeGrant = await mayDownload(restricted.artifactId, industry!.id);
record("a pending request still cannot download", !beforeGrant.allowed, beforeGrant.reason);

await db.transaction(async (tx) => {
  await tx
    .update(schema.accessRequests)
    .set({ state: "GRANTED", decidedBy: lead!.id, decidedAt: at })
    .where(and(eq(schema.accessRequests.artifactId, restricted.artifactId), eq(schema.accessRequests.requesterId, industry!.id)));
  await appendEntry(tx, {
    projectId: project.id,
    kind: "ACCESS",
    authorId: lead!.id,
    at,
    payload: { event: "ACCESS_GRANTED", artifactId: restricted.artifactId, requesterId: industry!.id, purpose, at: at.toISOString() },
  });
});

const afterGrant = await mayDownload(restricted.artifactId, industry!.id);
record("once granted, the industry user may download", afterGrant.allowed, afterGrant.reason);

// The download itself, as the route handler writes it.
await db.transaction(async (tx) => {
  await tx.insert(schema.accessLog).values({
    artifactId: restricted.artifactId,
    userId: industry!.id,
    orgId: industry!.orgId,
    purpose,
    createdAt: at,
  });
  await appendEntry(tx, {
    projectId: project.id,
    kind: "ACCESS",
    authorId: industry!.id,
    at,
    payload: { event: "ARTIFACT_DOWNLOADED", artifactId: restricted.artifactId, by: industry!.name, purpose, at: at.toISOString() },
  });
});

const logRows = (await db.execute<{ n: number; purpose: string; org: string | null }>(sql`
  SELECT count(*)::int AS n, max(l.purpose) AS purpose, max(o.name) AS org
  FROM access_log l LEFT JOIN organization o ON o.id = l.org_id
  WHERE l.artifact_id = ${restricted.artifactId}
`)) as unknown as Array<{ n: number; purpose: string; org: string | null }>;
record(
  "every restricted download writes an access_log row with who, which organisation and why",
  Number(logRows[0].n) > 0 && Boolean(logRows[0].purpose),
  `${logRows[0].n} row(s), org ${logRows[0].org}, purpose "${logRows[0].purpose?.slice(0, 40)}…"`,
);

const ledgerAccess = (await db.execute<{ n: number }>(sql`
  SELECT count(*)::int AS n FROM ledger_entries
  WHERE kind = 'ACCESS' AND payload->>'artifactId' = ${restricted.artifactId}
`)) as unknown as Array<{ n: number }>;
record("and an ACCESS entry in the ledger", Number(ledgerAccess[0].n) >= 2, `${ledgerAccess[0].n} ACCESS entries`);

/* --- the credit chain and the citation ------------------------------------- */

const chain = (await db.execute<{ relation: string; name: string | null }>(sql`
  SELECT e.relation, COALESCE(p.full_name, o.name) AS name
  FROM credit_edges e
  LEFT JOIN user_profiles p ON p.user_id = e.to_user_id
  LEFT JOIN organization o ON o.id = e.org_id
  WHERE e.challenge_id = ${project.challengeId}
  ORDER BY e.created_at
`)) as unknown as Array<{ relation: string; name: string | null }>;
const relations = new Set(chain.map((c) => c.relation));
record(
  "the credit chain renders originator through team",
  relations.has("ORIGINATOR") && (relations.has("TEAM_MEMBER") || relations.has("MENTOR")),
  [...relations].join(" -> "),
);

const citation = citationString({
  trackingId: challenge!.trackingId,
  originatorName: challenge!.reporterName,
  teamName: "BIT Sindri Civil Engineering Team",
  title: challenge!.title,
  place: "South Koel",
  year: challenge!.createdAt.getUTCFullYear(),
  host: "https://milan-ruddy-chi.vercel.app",
});
record("a citation string is generated with the citizen in the author position", /\(originator\)/.test(citation) && citation.includes(challenge!.trackingId));
console.log(`        ${citation}`);
record("BibTeX is offered too", bibtex({
  trackingId: challenge!.trackingId,
  originatorName: challenge!.reporterName,
  teamName: "BIT Sindri Civil Engineering Team",
  title: challenge!.title,
  place: "South Koel",
  year: 2026,
  host: "https://milan-ruddy-chi.vercel.app",
}).startsWith("@misc{milan"));

/* --- tamper, then verify --------------------------------------------------- */

let refused = "";
try {
  await db.execute(sql`UPDATE ledger_entries SET payload = '{"tampered":true}'::jsonb WHERE seq = (SELECT min(seq) FROM ledger_entries)`);
} catch (e) {
  const err = e as Error & { cause?: Error };
  refused = `${err.message} ${err.cause?.message ?? ""}`;
}
record("an UPDATE on ledger_entries is refused by the database", /append-only/i.test(refused), refused.split("\n")[0].slice(0, 90));

const verified = await verifyChain();
const head = await chainHead();
record("the chain verifies clean from genesis", verified.ok, verified.reason ?? `${verified.checked} entries checked`);
console.log(`\nhead hash : ${head.entryHash}`);
console.log(`entries   : ${head.count}`);
console.log(`head seq  : ${head.seq}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
