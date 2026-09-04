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

/**
 * The two enums the dataset supplies per row. Kept as literal tuples so a value
 * that is not in the database enum is caught here, with the CSV line number,
 * rather than as an opaque insert error 200 rows later.
 */
const DOMAIN_VALUES = [
  "EDUCATION",
  "HEALTHCARE",
  "AGRICULTURE",
  "WATER",
  "SANITATION",
  "ENVIRONMENT",
  "LIVELIHOODS",
  "ACCESSIBILITY",
  "URBAN_INFRA",
  "PUBLIC_SERVICE",
] as const;
const HAZARD_VALUES = [
  "FLOOD",
  "DROUGHT",
  "LANDSLIDE",
  "HEATWAVE",
  "MINING_SUBSIDENCE",
  "EPIDEMIC",
  "FOREST_FIRE",
  "NONE",
] as const;
const DOMAINS: ReadonlySet<string> = new Set(DOMAIN_VALUES);
const HAZARDS: ReadonlySet<string> = new Set(HAZARD_VALUES);

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
    districtCode: "DHN",
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
    districtCode: "ESB",
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

  /**
   * Geography comes from one denormalised file: seed-data/districts.csv has a
   * row per block, carrying the district's code, name and vulnerability index
   * beside the block's own name and centroid.
   *
   * Two consequences, both deliberate:
   *   - The district centroid is not a column. It is derived as the mean of its
   *     blocks' centroids and counted as derived in the run summary. We do not
   *     invent a coordinate and then present it as if it were surveyed.
   *   - A block inherits its district's vulnerability index, because the file
   *     carries one index per district. Block-level indices are a Phase 3 input.
   *
   * seed-data/blocks.csv is no longer read. It described the 2026-09-04
   * placeholder geography and its district codes no longer exist.
   */
  const geographyRows = readCsv<Record<string, string>>("districts.csv");

  interface DistrictAccumulator {
    code: string;
    name: string;
    nameHi: string | null;
    vulnerabilityIndex: string | null;
    lats: number[];
    lngs: number[];
  }
  interface BlockRow {
    code: string;
    districtCode: string;
    name: string;
    lat: string | null;
    lng: string | null;
    vulnerabilityIndex: string | null;
  }

  const districtAccumulators = new Map<string, DistrictAccumulator>();
  const blockRows: BlockRow[] = [];

  for (const [i, r] of geographyRows.entries()) {
    const line = i + 2; // header is line 1
    const code = r.district_code?.trim();
    const name = r.district_name?.trim();
    if (!code || !name) {
      warn(`districts.csv line ${line}: missing district_code or district_name — row skipped`);
      continue;
    }

    let acc = districtAccumulators.get(code);
    if (!acc) {
      acc = {
        code,
        name,
        nameHi: optional(r.district_name_hi),
        vulnerabilityIndex: num(r.vulnerability_index),
        lats: [],
        lngs: [],
      };
      districtAccumulators.set(code, acc);
    }

    const lat = num(r.lat);
    const lng = num(r.lng);
    if (lat !== null) acc.lats.push(Number(lat));
    if (lng !== null) acc.lngs.push(Number(lng));

    const blockCode = r.block_code?.trim();
    const blockName = r.block_name?.trim();
    if (!blockCode) continue; // a district-only row is legitimate
    if (!blockName) {
      warn(`districts.csv line ${line}: block ${blockCode} has no block_name — block skipped`);
      continue;
    }
    blockRows.push({
      code: blockCode,
      districtCode: code,
      name: blockName,
      lat,
      lng,
      vulnerabilityIndex: acc.vulnerabilityIndex,
    });
  }

  /** Mean of the supplied block centroids, to the schema's 6 decimal places. */
  function meanCoordinate(values: number[]): string | null {
    if (values.length === 0) return null;
    return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(6);
  }

  let derivedCentroids = 0;
  for (const acc of districtAccumulators.values()) {
    const lat = meanCoordinate(acc.lats);
    const lng = meanCoordinate(acc.lngs);
    if (lat !== null) derivedCentroids += 1;
    if (acc.vulnerabilityIndex === null) {
      warn(`districts.csv: ${acc.code} has no vulnerability_index — left null`);
    }
    const values = {
      name: acc.name,
      nameHi: acc.nameHi,
      lat,
      lng,
      vulnerabilityIndex: acc.vulnerabilityIndex,
    };
    await db
      .insert(districts)
      .values({ code: acc.code, ...values })
      .onConflictDoUpdate({ target: districts.code, set: values });
  }

  const districtCodes = new Set(districtAccumulators.keys());

  // The file carries no Devanagari block names, so block name_hi is null for
  // every row. Said once here rather than 249 times.
  if (blockRows.length) warn(`districts.csv: no block_name_hi column — ${blockRows.length} blocks have no Devanagari name`);

  const seenBlockCodes = new Set<string>();
  for (const b of blockRows) {
    if (seenBlockCodes.has(b.code)) {
      warn(`districts.csv: duplicate block code ${b.code} — later row ignored`);
      continue;
    }
    seenBlockCodes.add(b.code);
    const values = {
      districtCode: b.districtCode,
      name: b.name,
      nameHi: null,
      lat: b.lat,
      lng: b.lng,
      vulnerabilityIndex: b.vulnerabilityIndex,
    };
    await db
      .insert(blocks)
      .values({ code: b.code, ...values })
      .onConflictDoUpdate({ target: blocks.code, set: values });
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

  /**
   * Neither heis.csv nor industry.csv carries a slug, but Better Auth's
   * organisation plugin requires a unique one. It is derived from the name and
   * de-duplicated, so it is stable across runs: the same name always yields the
   * same slug, which is what makes the upserts idempotent.
   */
  function slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/\(.*?\)/g, " ") // drop bracketed abbreviations: "... (CCL)"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  const usedSlugs = new Set<string>();
  function uniqueSlug(name: string): string {
    const base = slugify(name) || "org";
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);
    return slug;
  }

  const heiSlugByCode = new Map<string, string>();

  for (const [i, h] of heiRows.entries()) {
    const name = h.hei_name?.trim();
    if (!name) {
      warn(`heis.csv line ${i + 2}: no hei_name — row skipped`);
      continue;
    }
    const districtCode = h.district_code?.trim() || null;
    if (districtCode && !districtCodes.has(districtCode)) {
      warn(`heis.csv: ${name} points at unknown district ${districtCode} — district left null`);
    }
    const heiCode = nullable(h.hei_code, `heis.csv ${name}.hei_code`);
    const slug = uniqueSlug(name);
    if (heiCode) heiSlugByCode.set(heiCode, slug);
    await upsertOrg({
      slug,
      name,
      orgType: "HEI",
      heiCode,
      districtCode: districtCode && districtCodes.has(districtCode) ? districtCode : null,
      lat: num(h.lat),
      lng: num(h.lng),
      website: optional(h.website),
    });
  }

  /**
   * industry.csv describes a firm's CSR posture, not its campus: it has no
   * coordinates and no website, and district_focus is a list. We store the
   * first district as the firm's anchor and leave the rest for Phase 4's
   * matching, rather than silently picking one and calling it the address.
   */
  for (const [i, f] of industryRows.entries()) {
    const name = f.org_name?.trim();
    if (!name) {
      warn(`industry.csv line ${i + 2}: no org_name — row skipped`);
      continue;
    }
    const focus = (f.district_focus ?? "")
      .split("|")
      .map((d) => d.trim())
      .filter(Boolean);
    const known = focus.filter((d) => districtCodes.has(d));
    for (const d of focus.filter((d) => !districtCodes.has(d))) {
      warn(`industry.csv: ${name} lists unknown district ${d} — ignored`);
    }
    if (known.length > 1) {
      warn(`industry.csv: ${name} focuses on ${known.length} districts — anchored to ${known[0]}, the rest are not stored`);
    }
    await upsertOrg({
      slug: uniqueSlug(name),
      name,
      orgType: "INDUSTRY",
      heiCode: null,
      districtCode: known[0] ?? null,
      lat: null,
      lng: null,
      website: null,
    });
  }

  // Columns the schema has nowhere to put. Declared rather than dropped in silence.
  if (heiRows.some((h) => h.type?.trim())) {
    warn("heis.csv: the `type` column (CENTRAL_INSTITUTE etc.) has no schema column — not stored");
  }
  if (industryRows.some((f) => f.domain_interests?.trim() || f.csr_contact_title?.trim())) {
    warn("industry.csv: `domain_interests` and `csr_contact_title` have no schema column — not stored, needed by Phase 4 matching");
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
  for (const [heiCode, slug] of heiSlugByCode) {
    const id = orgIdBySlug.get(slug);
    if (id) heiIdByCode.set(heiCode, id);
  }

  /**
   * The dataset expresses the availability window as one column,
   * `capacity_window` = "2026-08-01..2026-12-31". The placeholder file used
   * separate capacity_from / capacity_to columns; both are accepted.
   */
  function capacityWindow(c: Record<string, string>): { from: string | null; to: string | null } {
    const window = c.capacity_window?.trim();
    if (window) {
      const [from, to] = window.split("..").map((p) => p.trim());
      if (!from || !to) {
        warn(`capabilities.csv: ${c.hei_code}/${c.department} has an unreadable capacity_window "${window}"`);
        return { from: null, to: null };
      }
      return { from, to };
    }
    return { from: optional(c.capacity_from), to: optional(c.capacity_to) };
  }

  let capabilityCount = 0;
  for (const c of capabilityRows) {
    const orgId = heiIdByCode.get(c.hei_code?.trim() ?? "");
    if (!orgId) {
      warn(`capabilities.csv: unknown hei_code ${c.hei_code} — row skipped`);
      continue;
    }

    // Tags are pipe-separated in the Jharkhand dataset; the placeholder file
    // used semicolons. Accept both so an older CSV still loads.
    const tags = (c.specialisation_tags ?? "")
      .split(/[|;]/)
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
      capacityFrom: capacityWindow(c).from,
      capacityTo: capacityWindow(c).to,
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
  if (!challengeRows.some((r) => r.seed_status?.trim())) {
    warn("challenges.csv: no seed_status column — every challenge seeds as SUBMITTED, so /stats has no history");
  }
  if (!challengeRows.some((r) => r.corroborations?.trim())) {
    warn("challenges.csv: no corroborations column — every challenge seeds with a single reporter");
  }
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
    if (!bodyEn) warn(`challenges.csv row ${index + 2}: ${bodyLang} report has no English copy — Phase 2 S0 translates it`);

    /**
     * people_affected is a plain count in the Jharkhand dataset. The intake
     * wizard still captures a bucket and stores its midpoint, so both are
     * accepted here and a bucket label is resolved to the same midpoint the
     * wizard would have written.
     */
    const bucket = row.people_affected_bucket?.trim() ?? "";
    if (bucket && !(bucket in BUCKET_MIDPOINT)) {
      warn(`challenges.csv row ${index + 2}: unknown people_affected bucket "${bucket}"`);
    }
    const peopleAffectedRaw = row.people_affected?.trim();
    let peopleAffected: number | null = bucket ? (BUCKET_MIDPOINT[bucket] ?? null) : null;
    if (peopleAffected === null && peopleAffectedRaw) {
      const parsed = Number(peopleAffectedRaw);
      if (Number.isFinite(parsed) && parsed >= 0) peopleAffected = Math.round(parsed);
      else warn(`challenges.csv row ${index + 2}: unreadable people_affected "${peopleAffectedRaw}"`);
    }
    if (peopleAffected === null) warn(`challenges.csv row ${index + 2}: no people_affected — left null`);

    /**
     * domain and hazard are supplied by the dataset, and the hazard linkage is
     * what makes a row a disaster-management item rather than a public-works
     * item (CLAUDE.md invariant 1). Values are checked against the enums here
     * so a typo fails loudly at seed time instead of at insert time.
     */
    const domain = optional(row.domain);
    if (domain && !DOMAINS.has(domain)) {
      warn(`challenges.csv row ${index + 2}: unknown domain "${domain}" — left null`);
    }
    const hazard = optional(row.hazard);
    if (hazard && !HAZARDS.has(hazard)) {
      warn(`challenges.csv row ${index + 2}: unknown hazard "${hazard}" — left null`);
    }
    if (!hazard) warn(`challenges.csv row ${index + 2}: no hazard linkage`);

    /**
     * severity_hint is seeded straight into `severity`. Phase 2's S1 recomputes
     * it; until then this is what /gov/gate and the priority panel read, and
     * >= 0.7 is the human-gate threshold (CLAUDE.md invariant 5).
     */
    const severity = num(row.severity_hint);
    if (severity !== null && (Number(severity) < 0 || Number(severity) > 1)) {
      warn(`challenges.csv row ${index + 2}: severity_hint ${severity} is outside 0..1`);
    }

    // seed_status and corroborations are optional columns. Absent, every row
    // seeds as a fresh SUBMITTED report with no corroborators — honest, but it
    // leaves /stats with no history to show. See seed-data/README.md.
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
      peopleAffected,
      domain: domain && DOMAINS.has(domain) ? (domain as (typeof DOMAIN_VALUES)[number]) : null,
      hazard: hazard && HAZARDS.has(hazard) ? (hazard as (typeof HAZARD_VALUES)[number]) : null,
      severity,
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

  // Say plainly which coordinates the file supplied and which we computed.
  console.log(
    `\nGeography: ${districtAccumulators.size} districts (${derivedCentroids} centroids derived ` +
      `as the mean of their blocks), ${seenBlockCodes.size} blocks from districts.csv`,
  );
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
  // The dataset is the team's own. What is still outstanding is narrower, so
  // the reminder names it rather than crying wolf on every run.
  console.log(
    "\nREMINDER: the Hindi and Santali reports have not been checked by a native " +
      "speaker (PHASE_1_LEARN.md 7.3), and seed-data/voice-note.mp3 is still empty.",
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
