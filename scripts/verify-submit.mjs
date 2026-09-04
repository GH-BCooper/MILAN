/**
 * Task 1.6 verification: submit a Hindi and an English report end to end against
 * a live server, with a photo, and prove the photo's GPS EXIF was destroyed.
 *
 * The fixture image is generated here with real EXIF GPS tags written into it,
 * so "EXIF is stripped" is demonstrated rather than asserted.
 */
import { config } from "dotenv";
import postgres from "postgres";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

config({ path: ".env.local" });

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/* ------------------------------------------------ a photo that carries GPS */

/**
 * Build a JPEG with a real EXIF block containing GPS coordinates. Written by
 * hand because the point is to control exactly what goes in.
 * Coordinates: 22.918 N, 84.585 E — the embankment in Basia, Gumla.
 */
function exifWithGps() {
  // GPS IFD: version, N/S ref, lat, E/W ref, lng
  const gpsEntries = [
    { tag: 0x0000, type: 1, count: 4, raw: Buffer.from([2, 3, 0, 0]) },
    { tag: 0x0001, type: 2, count: 2, raw: Buffer.from("N\0") },
    { tag: 0x0002, type: 5, count: 3, rational: [[22, 1], [55, 1], [4800, 100]] },
    { tag: 0x0003, type: 2, count: 2, raw: Buffer.from("E\0") },
    { tag: 0x0004, type: 5, count: 3, rational: [[84, 1], [35, 1], [600, 100]] },
  ];

  // Lay out a little-endian TIFF header, one IFD0 pointing at a GPS IFD.
  const header = Buffer.alloc(8);
  header.write("II", 0, "ascii");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);

  const ifd0Count = 1;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const gpsIfdOffset = 8 + ifd0Size;

  const ifd0 = Buffer.alloc(ifd0Size);
  ifd0.writeUInt16LE(ifd0Count, 0);
  ifd0.writeUInt16LE(0x8825, 2); // GPSInfoIFDPointer
  ifd0.writeUInt16LE(4, 4); // LONG
  ifd0.writeUInt32LE(1, 6);
  ifd0.writeUInt32LE(gpsIfdOffset, 10);
  ifd0.writeUInt32LE(0, 14); // no next IFD

  const gpsCount = gpsEntries.length;
  const gpsDirSize = 2 + gpsCount * 12 + 4;
  const gpsDir = Buffer.alloc(gpsDirSize);
  gpsDir.writeUInt16LE(gpsCount, 0);

  const overflow = [];
  let overflowOffset = gpsIfdOffset + gpsDirSize;

  gpsEntries.forEach((e, i) => {
    const at = 2 + i * 12;
    gpsDir.writeUInt16LE(e.tag, at);
    gpsDir.writeUInt16LE(e.type, at + 2);
    gpsDir.writeUInt32LE(e.count, at + 4);

    if (e.rational) {
      const buf = Buffer.alloc(8 * e.rational.length);
      e.rational.forEach(([n, d], j) => {
        buf.writeUInt32LE(n, j * 8);
        buf.writeUInt32LE(d, j * 8 + 4);
      });
      gpsDir.writeUInt32LE(overflowOffset, at + 8);
      overflow.push(buf);
      overflowOffset += buf.length;
    } else {
      e.raw.copy(gpsDir, at + 8);
    }
  });
  gpsDir.writeUInt32LE(0, 2 + gpsCount * 12);

  return Buffer.concat([Buffer.from("Exif\0\0"), header, ifd0, gpsDir, ...overflow]);
}

async function makeFixture() {
  const base = await sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 120, g: 140, b: 110 } },
  })
    .jpeg()
    .toBuffer();

  const withExif = await sharp(base).withExif({}).jpeg().toBuffer();

  // sharp's withExif does not write GPS, so splice our own APP1 segment in
  // directly after SOI. That is exactly what a phone camera does.
  const app1Payload = exifWithGps();
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([((app1Payload.length + 2) >> 8) & 0xff, (app1Payload.length + 2) & 0xff]),
    app1Payload,
  ]);

  return Buffer.concat([withExif.subarray(0, 2), app1, withExif.subarray(2)]);
}

const fixture = await makeFixture();
writeFileSync("/tmp/milan-exif-fixture.jpg", fixture);

{
  const meta = await sharp(fixture).metadata();
  record(
    "fixture photo carries an EXIF block before upload",
    Boolean(meta.exif) && meta.exif.length > 0,
    `${meta.exif ? meta.exif.length : 0} bytes of EXIF`,
  );
}

/* ---------------------------------------------------------------- submit */

async function submitOne({ lang, body, districtCode, blockCode, withPhoto }) {
  let media = [];

  if (withPhoto) {
    const form = new FormData();
    form.append("file", new Blob([fixture], { type: "image/jpeg" }), "embankment.jpg");

    const res = await fetch(`${BASE}/api/intake/media`, { method: "POST", body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(`upload failed: ${json.error}`);
    media = [
      {
        storageKey: json.storageKey,
        contentHash: json.contentHash,
        mime: json.mime,
        bytes: json.bytes,
        exifStripped: true,
        consentGiven: true,
      },
    ];
  }

  const res = await fetch(`${BASE}/api/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bodyOriginal: body,
      bodyLang: lang,
      media,
      districtCode,
      blockCode,
      lat: 22.918,
      lng: 84.585,
      locationAccuracyM: 12,
      peopleAffectedBucket: "10-100",
      recurrence: "seasonal",
      urgencySelfReport: 5,
      framedStatement: null,
      successCriteria: "The embankment holds through one full monsoon.",
      framingApprovedByCitizen: true,
      reporterName: "Verification script",
    }),
  });

  return { result: await res.json(), media };
}

const HINDI =
  "हमारे गाँव के ऊपर जो बाँध है उसमें बड़ी दरार आ गई है। पिछली बरसात में पानी रिसने लगा था। अगर यह टूट गया तो नीचे के तीस घर बह जाएँगे।";
const ENGLISH =
  "The approach road to our village floods every monsoon because the stream crossing has no culvert, and the school children cannot get across for weeks at a time.";

console.log(`\nSubmitting against ${BASE}\n${"-".repeat(60)}`);

const hindi = await submitOne({
  lang: "hi",
  body: HINDI,
  districtCode: "GUM",
  blockCode: "GUM-BAS",
  withPhoto: true,
});
record(
  "Hindi report submitted with a photo",
  hindi.result.ok,
  hindi.result.ok ? hindi.result.trackingId : hindi.result.error,
);

const english = await submitOne({
  lang: "en",
  body: ENGLISH,
  districtCode: "LAT",
  blockCode: "LAT-MAN",
  withPhoto: false,
});
record(
  "English report submitted",
  english.result.ok,
  english.result.ok ? english.result.trackingId : english.result.error,
);

/* ------------------------------------------------------------- the checks */

console.log(`\nStored state\n${"-".repeat(60)}`);

if (hindi.result.ok) {
  const [row] = await sql`
    SELECT c.tracking_id, c.body_lang, c.body_original, c.body_en, c.status,
           c.district_code, c.block_code, c.people_affected, c.urgency_self_report,
           (SELECT count(*)::int FROM challenge_media m WHERE m.challenge_id = c.id) AS media,
           (SELECT count(*)::int FROM ledger_entries l WHERE l.challenge_id = c.id) AS ledger,
           (SELECT count(*)::int FROM credit_edges e WHERE e.challenge_id = c.id AND e.relation = 'ORIGINATOR') AS originator,
           (SELECT count(*)::int FROM outbox o WHERE o.payload ->> 'trackingId' = c.tracking_id) AS events
    FROM challenges c WHERE c.tracking_id = ${hindi.result.trackingId}
  `;

  record("tracking ID has the district in it", row.tracking_id.includes("-GUM-"), row.tracking_id);
  record("the citizen's Hindi is stored verbatim", row.body_original === HINDI);
  record("body_en is null until Phase 2 translates it", row.body_en === null);
  record("body_lang recorded as hi", row.body_lang === "hi");
  record("status is SUBMITTED", row.status === "SUBMITTED");
  record("people_affected stored as the bucket midpoint (55)", row.people_affected === 55);
  record("one media row written", row.media === 1);
  record("one PROBLEM_TEXT ledger entry written", row.ledger === 1);
  record("one ORIGINATOR credit edge written", row.originator === 1);
  record("one outbox event written", row.events === 1);

  const [mediaRow] = await sql`
    SELECT storage_key, content_hash, exif_stripped, faces_blurred, consent_given, bytes
    FROM challenge_media WHERE challenge_id = (SELECT id FROM challenges WHERE tracking_id = ${hindi.result.trackingId})
  `;
  record("exif_stripped recorded true", mediaRow.exif_stripped === true);
  record(
    "faces_blurred honestly recorded false (declared stub)",
    mediaRow.faces_blurred === false,
  );
  record("consent recorded", mediaRow.consent_given === true);
  record(
    "storage key is the content hash of the stored bytes",
    mediaRow.storage_key === `${mediaRow.content_hash}.jpg`,
    mediaRow.storage_key,
  );

  /* The real test: fetch the stored object back and look for EXIF. */
  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${mediaRow.storage_key}`;
  const downloaded = Buffer.from(await (await fetch(publicUrl)).arrayBuffer());
  const storedMeta = await sharp(downloaded).metadata();

  record(
    "downloaded object has NO EXIF block at all",
    !storedMeta.exif,
    storedMeta.exif ? `${storedMeta.exif.length} bytes still present` : "no EXIF",
  );
  record(
    "downloaded object contains no GPS marker bytes",
    !downloaded.includes(Buffer.from("Exif\0\0")),
  );
  record(
    "downloaded bytes hash to the stored content hash",
    createHash("sha256").update(downloaded).digest("hex") === mediaRow.content_hash,
  );
}

if (english.result.ok) {
  const [row] = await sql`
    SELECT body_original, body_en, body_lang, tracking_id
    FROM challenges WHERE tracking_id = ${english.result.trackingId}
  `;
  record("English report: body_en is the citizen's own words", row.body_en === ENGLISH);
  record("English report: body_original untouched", row.body_original === ENGLISH);
  record("English report: tracking ID carries its district", row.tracking_id.includes("-LAT-"));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (hindi.result.ok) console.log(`Hindi report:   ${hindi.result.trackingId}`);
if (english.result.ok) console.log(`English report: ${english.result.trackingId}`);

await sql.end();
process.exit(failed.length ? 1 : 0);
