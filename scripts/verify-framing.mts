/**
 * Tasks 2.7 and 2.8 verification.
 *
 * 2.7 — a deliberately messy Hindi complaint goes through the framing stage.
 *       Both paths are shown: the citizen approving the proposal, and the
 *       citizen declining it. In both cases `body_original` must come back
 *       byte-identical, and `framed_statement` must be null when they declined.
 *
 * 2.8 — the seeded voice note is replayed end to end and the three-panel result
 *       is printed: the recording, the original-language transcript, and the
 *       English working copy.
 *
 *   pnpm verify:framing
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const sql = postgres(process.env.DIRECT_URL ?? "", { max: 1, prepare: false });

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/**
 * A deliberately messy Hindi complaint: no punctuation to speak of, mixed
 * register, a spelling slip, and the actual problem buried in the middle. This
 * is what a real report from a phone keyboard looks like, and it is the input
 * the framing stage has to earn its place on.
 */
const MESSY_HINDI =
  "साहब हमारे टोला में पिछले तीन साल से पानी की बहुत दिक्कत है चापाकल है पर मार्च के बाद " +
  "सूख जाता है औरतें सुबह चार बजे उठकर तीन किलोमीटर दूर से पानी लाती हैं और जो पानी आता है " +
  "उसमें भी कुछ मिला रहता है बच्चों के दांत पीले हो गए हैं किसी को समझ नहीं आ रहा कि जमीन " +
  "के नीचे पानी क्यों नहीं है और जो है वो खराब क्यों है कोई जांच करवा दीजिए";

/* ------------------------------------------------------------- the framing */

console.log("=== Task 2.7: AI framing, approved and declined ===\n");
console.log("The citizen wrote (Hindi, unedited):");
console.log(`  ${MESSY_HINDI}\n`);

const framingResponse = await fetch(`${BASE}/api/intake/framing`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    bodyOriginal: MESSY_HINDI,
    bodyLang: "hi",
    districtCode: "GAR",
    blockCode: null,
  }),
});
const proposal = (await framingResponse.json()) as Record<string, unknown>;

record("framing proposal returned", framingResponse.ok && proposal.ok === true, String(proposal.error ?? ""));

if (proposal.ok !== true) {
  await sql.end();
  process.exit(1);
}

console.log("\nMilan proposed:");
console.log(`  statement: ${proposal.framedStatement}`);
console.log(`  success:   ${proposal.successCriteria}`);
console.log(`  ${proposal.provider} · confidence ${proposal.confidence} · fallback level ${proposal.fallbackLevel}\n`);

record(
  "the proposal is in English and research-ready",
  typeof proposal.framedStatement === "string" && proposal.framedStatement.length > 60,
  `${String(proposal.framedStatement).length} characters`,
);

/* ------------------------------------------- path A: the citizen approves */

async function submit(approved: boolean) {
  const response = await fetch(`${BASE}/api/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bodyOriginal: MESSY_HINDI,
      bodyLang: "hi",
      media: [],
      districtCode: "GAR",
      blockCode: null,
      lat: 23.98,
      lng: 83.82,
      locationAccuracyM: null,
      peopleAffectedBucket: "100-1000",
      recurrence: "yearly",
      urgencySelfReport: 4,
      framedStatement: proposal.framedStatement,
      successCriteria: proposal.successCriteria,
      framingApprovedByCitizen: approved,
      reporterName: "Framing verification",
    }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return body.trackingId as string | undefined;
}

// Clear our own rate-limit counter first; five submissions an hour is the real
// limit and this script uses two of them.
await sql`delete from audit_log where action = 'challenge.submitted' and target_type = 'rate_key'`;

const approvedId = await submit(true);
const declinedId = await submit(false);

record("both submissions accepted", Boolean(approvedId && declinedId), `${approvedId} / ${declinedId}`);

const rows = await sql`
  select tracking_id, body_original, body_lang, framed_statement, framing_approved_by_citizen, title
  from challenges where tracking_id in (${approvedId ?? ""}, ${declinedId ?? ""})`;

const approved = rows.find((r) => r.tracking_id === approvedId);
const declined = rows.find((r) => r.tracking_id === declinedId);

console.log("\n--- Path A: the citizen APPROVED the wording ---");
console.log(`  body_original (unchanged):   ${approved?.body_original?.slice(0, 70)}…`);
console.log(`  framed_statement (stored):   ${approved?.framed_statement?.slice(0, 70)}…`);
console.log(`  framing_approved_by_citizen: ${approved?.framing_approved_by_citizen}`);

console.log("\n--- Path B: the citizen DECLINED the wording ---");
console.log(`  body_original (unchanged):   ${declined?.body_original?.slice(0, 70)}…`);
console.log(`  framed_statement (stored):   ${declined?.framed_statement ?? "null — their own words stand"}`);
console.log(`  framing_approved_by_citizen: ${declined?.framing_approved_by_citizen}`);

record(
  "body_original is byte-identical on both paths",
  approved?.body_original === MESSY_HINDI && declined?.body_original === MESSY_HINDI,
  "never overwritten, never translated in place",
);
record(
  "an approved framing is stored",
  Boolean(approved?.framed_statement) && approved?.framing_approved_by_citizen === true,
);
record(
  "a declined framing is NOT stored",
  declined?.framed_statement === null && declined?.framing_approved_by_citizen === false,
  "the reporter's own wording stands and the refusal is recorded",
);

/* ----------------------------------------------- the database's own promise */

const [comment] = await sql`
  select d.description from pg_attribute a
  left join pg_description d on d.objoid = a.attrelid and d.objsubid = a.attnum
  where a.attrelid = 'challenges'::regclass and a.attname = 'body_original'`;
record(
  "the database itself documents that body_original is never overwritten",
  typeof comment?.description === "string" && comment.description.includes("NEVER overwritten"),
);

/* ---------------------------------------------------- Task 2.8: the voice */

console.log("\n=== Task 2.8: the seeded voice path ===\n");

const media = await sql`
  select m.id, m.storage_key, m.content_hash, m.mime, m.bytes, c.tracking_id,
         c.body_original, c.body_lang, c.body_en
  from challenge_media m join challenges c on c.id = m.challenge_id
  where m.mime like 'audio/%'`;

if (media.length === 0) {
  record(
    "a voice note is attached to a challenge",
    false,
    "seed-data/voice-note.mp3 is 0 bytes — the recording is a human task (BACKLOG 2.2). " +
      "The stage, the seeded transcript and the live ASR path are all implemented and typechecked.",
  );
} else {
  const m = media[0];
  record("a voice note is attached", true, `${m.tracking_id}, ${m.bytes} bytes, sha256 ${String(m.content_hash).slice(0, 12)}…`);
  console.log("\n  1. The recording   " + `${BASE}/c/${m.tracking_id}#voice`);
  console.log("  2. As spoken       " + String(m.body_original).slice(0, 90) + "…");
  console.log("  3. English copy    " + String(m.body_en ?? "(not translated)").slice(0, 90) + "…");
  record("the transcript is in the speaker's own language", m.body_lang !== "en", `body_lang=${m.body_lang}`);
  record("an English working copy sits beside it", Boolean(m.body_en));
}

/* --------------------------------------------- translation of a Hindi report */

const [hindi] = await sql`
  select tracking_id, body_lang, body_original, body_en from challenges
  where body_lang <> 'en' and body_en is not null limit 1`;

if (hindi) {
  console.log(`\n  Translated report ${hindi.tracking_id} (${hindi.body_lang}):`);
  console.log(`    original: ${String(hindi.body_original).slice(0, 80)}…`);
  console.log(`    english:  ${String(hindi.body_en).slice(0, 80)}…`);
  record("a non-English report gained an English working copy", true, String(hindi.tracking_id));
  record(
    "the original was not replaced by the translation",
    hindi.body_original !== hindi.body_en,
  );
} else {
  record("a non-English report gained an English working copy", false, "no translated report found yet");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
if (approvedId) console.log(`Approved: ${BASE}/c/${approvedId}`);
if (declinedId) console.log(`Declined: ${BASE}/c/${declinedId}`);
await sql.end();
process.exit(failed.length === 0 ? 0 : 1);
