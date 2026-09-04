/**
 * `pnpm seed` — load `seed-data/*.csv` into the database.
 *
 * Two rules govern this file:
 *
 *   1. It never invents a row. If a CSV column is empty, the column is left
 *      null and a warning is printed. Made-up districts and made-up institutions
 *      are exactly the kind of thing a judge catches.
 *   2. It is idempotent. Running it twice leaves the same database. Every insert
 *      is an upsert keyed on something stable, and challenges are keyed on the
 *      title plus the district so a re-run updates rather than duplicates.
 *
 * `pnpm seed --reset` truncates first. That is the one-command restore path for
 * a corrupted demo database, and the Phase 3 /demo console calls it.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import Papa from "papaparse";

config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const {
  account,
  blocks,
  capabilities,
  challengeMedia,
  challenges,
  corroborations,
  creditEdges,
  districts,
  ledgerEntries,
  member,
  organisationsMeta,
  organization,
  user,
  userProfiles,
} = await import("@/lib/db/schema");
const { clockNow } = await import("@/lib/clock");
const { nextTrackingId } = await import("@/lib/db/trackingId");
const { contentHashOf } = await import("@/lib/db/stateMachine");

const DATA_DIR = join(process.cwd(), "seed-data");
const RESET = process.argv.includes("--reset");
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "milan2026";

const warnings: string[] = [];
function warn(message: string) {
  warnings.push(message);
}

/* ----------------------------------------------------------------- CSV IO */

function readCsv<T extends Record<string, string>>(name: string): T[] {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`seed-data/${name} is missing. Ask the human team for it; do not invent it.`);
  }
  if (statSync(path).size === 0) {
    throw new Error(`seed-data/${name} is empty. Ask the human team for it; do not invent it.`);
  }
  const parsed = Papa.parse<T>(readFileSync(path, "utf8").replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length) {
    throw new Error(`seed-data/${name}: ${parsed.errors[0].message} (row ${parsed.errors[0].row})`);
  }
  return parsed.data;
}

/** Empty string means "not supplied", which is null, and it is worth a warning. */
function nullable(value: string | undefined, where: string): string | null {
  const v = value?.trim();
  if (!v) {
    warn(`${where} is empty — column left null`);
    return null;
  }
  return v;
}

/** Same, but silent: some columns are legitimately optional. */
function optional(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function num(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return Number.isFinite(Number(v)) ? v : null;
}

/** People affected is captured as a bucket; we store the midpoint. */
const BUCKET_MIDPOINT: Record<string, number> = {
  "1-10": 5,
  "10-100": 55,
  "100-1000": 550,
  "1000+": 2000,
};

/* ------------------------------------------------------------------ users */

/**
 * Better Auth hashes passwords with scrypt. We import its own hasher rather than
 * re-implementing it, so a seeded account signs in exactly like a registered one.
 */
async function hashPassword(plain: string): Promise<string> {
  const { hashPassword } = await import("better-auth/crypto");
  return hashPassword(plain);
}

/** Better Auth 1.7 scopes account identity by issuer. Ask the library rather
 *  than hard-coding the string, so an upgrade cannot silently break sign-in. */
async function credentialIssuer(): Promise<string> {
  const { createLocalAccountIssuer } = await import("better-auth/db");
  return createLocalAccountIssuer("credential");
}

interface DemoAccount {
  email: string;
  name: string;
  role: "CITIZEN" | "HEI_MEMBER" | "GOVERNMENT" | "INDUSTRY" | "ADMIN";
  districtCode?: string;
  orgSlug?: string;
  note: string;
}

/** The five accounts we demo with. PHASE_1_LEARN.md section 7.5. */
const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "sunita@demo.milan.in",
    name: "Sunita Devi",
    role: "CITIZEN",
    districtCode: "GUM",
    note: "reports the cracked embankment",
  },
  {
    email: "hod.civil@bitsindri.demo.milan.in",
    name: "Head of Civil Engineering, BIT Sindri",
    role: "HEI_MEMBER",
    orgSlug: "bit-sindri",
    districtCode: "DHA",
    note: "claims routed challenges",
  },
  {
    email: "dc.gumla@jh.gov.demo.milan.in",
    name: "Deputy Commissioner, Gumla",
    role: "GOVERNMENT",
    districtCode: "GUM",
    note: "district scoped to GUM",
  },
  {
    email: "csr@tatasteelfoundation.demo.milan.in",
    name: "CSR Lead, Tata Steel Foundation",
    role: "INDUSTRY",
    orgSlug: "tata-steel-foundation",
    districtCode: "EAS",
    note: "expresses industry interest",
  },
  {
    email: "admin@milan.demo.milan.in",
    name: "Milan Administrator",
    role: "ADMIN",
    note: "platform administrator",
  },
];

/** Deterministic ids so a re-run updates the same rows instead of making new ones. */
function stableId(kind: string, key: string): string {
  return `${kind}_${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 24)}`;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const started = Date.now();
  const now = clockNow();

  if (RESET) {
    console.log("--reset: truncating every seeded table\n");
    // ledger_entries refuses UPDATE and DELETE, but TRUNCATE is deliberately
    // left open precisely so that this restore path exists. See migration 0002.
    await db.execute(sql`
      TRUNCATE TABLE
        ledger_entries, credit_edges, corroborations, challenge_media, challenges,
        capabilities, organisations_meta, user_profiles, member, account, session,
        organization, "user", blocks, districts, outbox, notifications, audit_log,
        ai_runs, sla_deadlines
      RESTART IDENTITY CASCADE
    `);
  }

  /* ---------------------------------------------------------- geography */

  const districtRows = readCsv<Record<string, string>>("districts.csv");
  for (const d of districtRows) {
    await db
      .insert(districts)
      .values({
        code: d.code.trim(),
        name: d.name.trim(),
        nameHi: optional(d.name_hi),
        lat: num(d.lat),
        lng: num(d.lng),
        vulnerabilityIndex: num(d.vulnerability_index),
      })
      .onConflictDoUpdate({
        target: districts.code,
        set: {
          name: d.name.trim(),
          nameHi: optional(d.name_hi),
          lat: num(d.lat),
          lng: num(d.lng),
          vulnerabilityIndex: num(d.vulnerability_index),
        },
      });
  }

  const districtCodes = new Set(districtRows.map((d) => d.code.trim()));

  const blockRows = readCsv<Record<string, string>>("blocks.csv");
  for (const b of blockRows) {
    if (!districtCodes.has(b.district_code.trim())) {
      warn(`blocks.csv: block ${b.code} points at unknown district ${b.district_code} — skipped`);
      continue;
    }
    await db
      .insert(blocks)
      .values({
        code: b.code.trim(),
        districtCode: b.district_code.trim(),
        name: b.name.trim(),
        nameHi: optional(b.name_hi),
        lat: num(b.lat),
        lng: num(b.lng),
        vulnerabilityIndex: num(b.vulnerability_index),
      })
      .onConflictDoUpdate({
        target: blocks.code,
        set: {
          districtCode: b.district_code.trim(),
          name: b.name.trim(),
          nameHi: optional(b.name_hi),
          lat: num(b.lat),
          lng: num(b.lng),
          vulnerabilityIndex: num(b.vulnerability_index),
        },
      });
  }

  /* ------------------------------------------------------ organisations */

  const heiRows = readCsv<Record<string, string>>("heis.csv");
  const industryRows = readCsv<Record<string, string>>("industry.csv");
  const orgIdBySlug = new Map<string, string>();

  async function upsertOrg(input: {
    slug: string;
    name: string;
    orgType: "HEI" | "INDUSTRY" | "GOVERNMENT";
    heiCode: string | null;
    districtCode: string | null;
    lat: string | null;
    lng: string | null;
    website: string | null;
  }) {
    const id = stableId("org", input.slug);
    await db
      .insert(organization)
      .values({ id, name: input.name, slug: input.slug, createdAt: now })
      .onConflictDoUpdate({ target: organization.slug, set: { name: input.name } });

    const [row] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, input.slug))
      .limit(1);

    await db
      .insert(organisationsMeta)
      .values({
        orgId: row.id,
        orgType: input.orgType,
        heiCode: input.heiCode,
        districtCode: input.districtCode,
        lat: input.lat,
        lng: input.lng,
        website: input.website,
      })
      .onConflictDoUpdate({
        target: organisationsMeta.orgId,
        set: {
          orgType: input.orgType,
          heiCode: input.heiCode,
          districtCode: input.districtCode,
          lat: input.lat,
          lng: input.lng,
          website: input.website,
        },
      });

    orgIdBySlug.set(input.slug, row.id);
    return row.id;
  }

  for (const h of heiRows) {
    const districtCode = h.district_code?.trim() || null;
    if (districtCode && !districtCodes.has(districtCode)) {
      warn(`heis.csv: ${h.name} points at unknown district ${districtCode} — district left null`);
    }
    await upsertOrg({
      slug: h.slug.trim(),
      name: h.name.trim(),
      orgType: "HEI",
      heiCode: nullable(h.hei_code, `heis.csv ${h.name}.hei_code`),
      districtCode: districtCode && districtCodes.has(districtCode) ? districtCode : null,
      lat: num(h.lat),
      lng: num(h.lng),
      website: optional(h.website),
    });
  }

  for (const f of industryRows) {
    const districtCode = f.district_code?.trim() || null;
    await upsertOrg({
      slug: f.slug.trim(),
      name: f.name.trim(),
      orgType: "INDUSTRY",
      heiCode: null,
      districtCode: districtCode && districtCodes.has(districtCode) ? districtCode : null,
      lat: num(f.lat),
      lng: num(f.lng),
      website: optional(f.website),
    });
  }

  /* --------------------------------------------------- demo user accounts */

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const issuer = await credentialIssuer();
  const userIdByEmail = new Map<string, string>();

  for (const acc of DEMO_ACCOUNTS) {
    const id = stableId("usr", acc.email);

    await db
      .insert(user)
      .values({
        id,
        name: acc.name,
        email: acc.email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: user.email, set: { name: acc.name, updatedAt: now } });

    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, acc.email)).limit(1);
    userIdByEmail.set(acc.email, row.id);

    // Better Auth stores credentials in `account` with providerId 'credential'.
    const existingAccount = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, row.id), eq(account.providerId, "credential")))
      .limit(1);

    if (existingAccount.length === 0) {
      await db.insert(account).values({
        id: stableId("acc", acc.email),
        issuer,
        accountId: row.id,
        providerId: "credential",
        userId: row.id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db
        .update(account)
        .set({ password: passwordHash, issuer, updatedAt: now })
        .where(eq(account.id, existingAccount[0].id));
    }

    const orgId = acc.orgSlug ? (orgIdBySlug.get(acc.orgSlug) ?? null) : null;
    if (acc.orgSlug && !orgId) warn(`demo account ${acc.email} references unknown org ${acc.orgSlug}`);

    await db
      .insert(userProfiles)
      .values({
        userId: row.id,
        role: acc.role,
        fullName: acc.name,
        preferredLang: acc.role === "CITIZEN" ? "hi" : "en",
        districtCode: acc.districtCode ?? null,
        orgId,
        // Demo accounts are pre-verified; a real citizen starts at tier 1.
        verifiedTier: acc.role === "CITIZEN" ? 2 : 3,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { role: acc.role, fullName: acc.name, districtCode: acc.districtCode ?? null, orgId },
      });

    if (orgId) {
      const existingMember = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, row.id)))
        .limit(1);
      if (existingMember.length === 0) {
        await db.insert(member).values({
          id: stableId("mem", `${orgId}:${row.id}`),
          organizationId: orgId,
          userId: row.id,
          role: "owner",
          createdAt: now,
        });
      }
    }
  }

  /* ---------------------------------------------------------- capabilities */

  const capabilityRows = readCsv<Record<string, string>>("capabilities.csv");
  const heiIdByCode = new Map<string, string>();
  for (const h of heiRows) {
    const id = orgIdBySlug.get(h.slug.trim());
    if (id) heiIdByCode.set(h.hei_code.trim(), id);
  }

  let capabilityCount = 0;
  for (const c of capabilityRows) {
    const orgId = heiIdByCode.get(c.hei_code?.trim() ?? "");
    if (!orgId) {
      warn(`capabilities.csv: unknown hei_code ${c.hei_code} — row skipped`);
      continue;
    }

    const tags = (c.specialisation_tags ?? "")
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) warn(`capabilities.csv: ${c.hei_code}/${c.department} has no specialisation tags`);

    // Idempotency key: one capability per organisation per department per lab.
    const existing = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(
        and(
          eq(capabilities.orgId, orgId),
          eq(capabilities.department, c.department.trim()),
          eq(capabilities.labName, c.lab_name?.trim() ?? ""),
        ),
      )
      .limit(1);

    const values = {
      orgId,
      department: c.department.trim(),
      labName: c.lab_name?.trim() ?? "",
      specialisationTags: tags,
      facultyName: optional(c.faculty_name),
      facultyDesignation: optional(c.faculty_designation),
      declaredCapacity: Number(c.declared_capacity ?? 0) || 0,
      capacityFrom: optional(c.capacity_from),
      capacityTo: optional(c.capacity_to),
      active: true,
    };

    if (existing.length) {
      await db.update(capabilities).set(values).where(eq(capabilities.id, existing[0].id));
    } else {
      await db.insert(capabilities).values(values);
    }
    capabilityCount += 1;
  }

  /* ------------------------------------------------------------ challenges */

  const challengeRows = readCsv<Record<string, string>>("challenges.csv");
  const sunitaId = userIdByEmail.get("sunita@demo.milan.in") ?? null;
  const blockCodes = new Set(blockRows.map((b) => b.code.trim()));

  let corroborationCount = 0;
  let mediaCount = 0;
  let heroChallengeId: string | null = null;

  for (const [index, row] of challengeRows.entries()) {
    const districtCode = row.district_code?.trim() || null;
    if (districtCode && !districtCodes.has(districtCode)) {
      warn(`challenges.csv row ${index + 2}: unknown district ${districtCode} — row skipped`);
      continue;
    }
    const blockCode = row.block_code?.trim() || null;
    if (blockCode && !blockCodes.has(blockCode)) {
      warn(`challenges.csv row ${index + 2}: unknown block ${blockCode} — block left null`);
    }

    const bodyLang = (row.body_lang?.trim() || "en").toLowerCase();
    // When the citizen wrote in English, the English working copy is their own
    // words. body_original is never destroyed, and never translated away.
    const bodyEn = row.body_en?.trim() || (bodyLang === "en" ? row.body_original.trim() : null);
    if (!bodyEn) warn(`challenges.csv row ${index + 2}: no English copy — Phase 2 S0 will translate`);

    const bucket = row.people_affected_bucket?.trim() ?? "";
    if (bucket && !(bucket in BUCKET_MIDPOINT)) {
      warn(`challenges.csv row ${index + 2}: unknown people_affected bucket "${bucket}"`);
    }

    const seedStatus = (row.seed_status?.trim() || "SUBMITTED") as "SUBMITTED" | "CLOSED" | "CITIZEN_VERIFIED";
    // Three rows are backdated so /stats has real history to show on stage.
    const createdAt =
      seedStatus === "SUBMITTED" ? now : new Date(now.getTime() - 210 * 86_400_000 + index * 86_400_000);

    const existing = await db
      .select({ id: challenges.id, trackingId: challenges.trackingId })
      .from(challenges)
      .where(and(eq(challenges.title, row.title.trim()), eq(challenges.bodyOriginal, row.body_original.trim())))
      .limit(1);

    const values = {
      status: seedStatus,
      title: row.title.trim(),
      bodyOriginal: row.body_original.trim(),
      bodyLang,
      bodyEn,
      districtCode,
      blockCode: blockCode && blockCodes.has(blockCode) ? blockCode : null,
      lat: num(row.lat),
      lng: num(row.lng),
      peopleAffected: BUCKET_MIDPOINT[bucket] ?? null,
      recurrence: optional(row.recurrence),
      urgencySelfReport: Number(row.urgency_self_report ?? 0) || null,
      reporterName: optional(row.reporter_name),
      // Only the hero challenge is attached to a demo account; the rest are
      // anonymous reports, which is what the real intake mostly looks like.
      reporterId: index === 0 ? sunitaId : null,
      impactConfirmed: seedStatus === "CITIZEN_VERIFIED",
      corroborationCount: 1 + (Number(row.corroborations ?? 0) || 0),
      updatedAt: createdAt,
    };

    let challengeId: string;
    if (existing.length) {
      challengeId = existing[0].id;
      await db.update(challenges).set(values).where(eq(challenges.id, challengeId));
    } else {
      challengeId = await db.transaction(async (tx) => {
        const trackingId = await nextTrackingId(tx, districtCode);
        const [inserted] = await tx
          .insert(challenges)
          .values({ ...values, trackingId, createdAt })
          .returning({ id: challenges.id });

        // The originator credit edge, and the ledger entry that makes it
        // impossible to erase who reported this.
        await tx.insert(creditEdges).values({
          challengeId: inserted.id,
          toUserId: index === 0 ? sunitaId : null,
          relation: "ORIGINATOR",
          declaredRole: values.reporterName ?? "Anonymous reporter",
          createdAt,
        });

        await tx.insert(ledgerEntries).values({
          challengeId: inserted.id,
          kind: "PROBLEM_TEXT",
          contentHash: contentHashOf({
            trackingId,
            bodyOriginal: values.bodyOriginal,
            bodyLang: values.bodyLang,
            reporterName: values.reporterName,
          }),
          authorId: index === 0 ? sunitaId : null,
          payload: { trackingId, source: "seed", reporterName: values.reporterName },
          createdAt,
        });

        return inserted.id;
      });
    }

    if (index === 0) heroChallengeId = challengeId;

    // Corroborations are anonymous in the seed: one row per extra reporter, with
    // a null user_id. The unique(challenge_id, user_id) constraint only bites on
    // signed-in users, which is exactly the anti-brigading behaviour we want.
    const wanted = Number(row.corroborations ?? 0) || 0;
    const have = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(corroborations)
      .where(eq(corroborations.challengeId, challengeId));
    const missing = wanted - Number(have[0]?.n ?? 0);
    for (let i = 0; i < missing; i += 1) {
      await db.insert(corroborations).values({
        challengeId,
        userId: null,
        lat: num(row.lat),
        lng: num(row.lng),
        distanceKm: "0.500",
        weight: "1.000",
        deviceFingerprint: `seed-${randomUUID().slice(0, 8)}`,
        createdAt,
      });
      corroborationCount += 1;
    }
  }

  /* ----------------------------------------------- the hero voice note */

  const voicePath = join(DATA_DIR, "voice-note.mp3");
  if (!existsSync(voicePath) || statSync(voicePath).size === 0) {
    warn(
      "seed-data/voice-note.mp3 is missing or empty — the Sunita voice note is NOT attached. " +
        "Record it (PHASE_1_LEARN.md section 7.4) and re-run the seed.",
    );
  } else if (heroChallengeId) {
    const bytes = readFileSync(voicePath);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `media/${contentHash}.mp3`;

    const uploaded = await uploadToStorage(storageKey, bytes, "audio/mpeg");
    if (uploaded) {
      const existing = await db
        .select({ id: challengeMedia.id })
        .from(challengeMedia)
        .where(eq(challengeMedia.contentHash, contentHash))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(challengeMedia).values({
          challengeId: heroChallengeId,
          storageKey,
          contentHash,
          mime: "audio/mpeg",
          bytes: bytes.byteLength,
          // An audio file carries no EXIF, and no faces.
          exifStripped: true,
          facesBlurred: true,
          consentGiven: true,
          createdAt: now,
        });
        mediaCount += 1;
      }
    }
  }

  /* ---------------------------------------------------------------- report */

  const counts = await db.execute<{ table: string; n: number }>(sql`
    SELECT 'districts' AS table, count(*)::int AS n FROM districts
    UNION ALL SELECT 'blocks', count(*)::int FROM blocks
    UNION ALL SELECT 'organisations', count(*)::int FROM organization
    UNION ALL SELECT 'users', count(*)::int FROM "user"
    UNION ALL SELECT 'capabilities', count(*)::int FROM capabilities
    UNION ALL SELECT 'challenges', count(*)::int FROM challenges
    UNION ALL SELECT 'corroborations', count(*)::int FROM corroborations
    UNION ALL SELECT 'credit_edges', count(*)::int FROM credit_edges
    UNION ALL SELECT 'ledger_entries', count(*)::int FROM ledger_entries
    UNION ALL SELECT 'challenge_media', count(*)::int FROM challenge_media
  `);

  console.log("\nRow counts");
  console.log("-".repeat(40));
  for (const r of counts) console.log(`${String(r.table).padEnd(20)} ${String(r.n).padStart(6)}`);

  console.log("\nDemo accounts (password: " + DEMO_PASSWORD + ")");
  console.log("-".repeat(78));
  for (const a of DEMO_ACCOUNTS) {
    console.log(`${a.role.padEnd(12)} ${a.email.padEnd(42)} ${a.note}`);
  }

  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s)`);
    console.log("-".repeat(40));
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  console.log(
    `\nSeeded in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(capabilities processed: ${capabilityCount}, corroborations added: ${corroborationCount}, media added: ${mediaCount})`,
  );
  console.log(
    "\nREMINDER: seed-data/ is placeholder data generated by Claude. " +
      "Replace it with the real Jharkhand dataset before the demo — see seed-data/README.md.",
  );
}

/**
 * Supabase Storage upload. Returns false rather than throwing when Storage is
 * unreachable: nothing on the demo path may depend on a third-party API
 * succeeding, and a missing voice note must not stop the seed.
 */
async function uploadToStorage(key: string, bytes: Buffer, mime: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    warn("Supabase Storage credentials are not set — voice note not uploaded");
    return false;
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const bucket = "media";
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === bucket)) {
      const { error } = await supabase.storage.createBucket(bucket, { public: true });
      if (error && !/already exists/i.test(error.message)) {
        warn(`Storage: could not create bucket "${bucket}": ${error.message}`);
        return false;
      }
    }

    // The object key IS the content hash, so re-uploading the same bytes is a
    // no-op and the ledger can cite the object by hash.
    const path = key.replace(/^media\//, "");
    const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (error) {
      warn(`Storage: upload failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    warn(`Storage: ${(e as Error).message}`);
    return false;
  }
}

await main();
process.exit(0);
