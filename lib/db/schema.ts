/**
 * Milan's database schema. The whole product is downstream of this file.
 *
 * Phase 1 creates every column that Phases 2 and 3 will fill, so that later
 * phases are additive and never rewrite a migration. Columns marked
 * "Phase 2" / "Phase 3" are deliberately null for now.
 *
 * Rules that live in the database rather than in application code:
 *   - `challenge_status` is a real Postgres enum, so an illegal state cannot be
 *     written even by a stray SQL statement.
 *   - `corroborations` carries unique(challenge_id, user_id) — the anti-brigading
 *     constraint. One person corroborates a challenge once.
 *   - `ledger_entries` is append-only. The rule that enforces it is in the
 *     hand-written migration, not in convention (CLAUDE.md invariant 2).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth-schema";

export * from "./auth-schema";

/** Postgres `tsvector`. Drizzle has no built-in, and we only ever read it via SQL. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/* ------------------------------------------------------------------ enums */

export const roleEnum = pgEnum("role", [
  "CITIZEN",
  "HEI_MEMBER",
  "INDUSTRY",
  "GOVERNMENT",
  "ADMIN",
  // Present in the enum, no separate UI this cut.
  "ASSISTED_SUBMITTER",
  "INDEPENDENT_INNOVATOR",
  "EXPERT_PANEL",
]);

export const challengeStatusEnum = pgEnum("challenge_status", [
  // The happy path.
  "SUBMITTED",
  "TRIAGED",
  "CLASSIFIED",
  "CLUSTERED",
  "PRIORITISED",
  "VERIFIED",
  "ROUTED",
  "CLAIMED",
  "PROPOSAL_APPROVED",
  "IN_RESEARCH",
  "SOLUTION_PUBLISHED",
  "INDUSTRY_INTEREST",
  "IMPLEMENTED",
  "CITIZEN_VERIFIED",
  "CLOSED",
  // Branches and terminals.
  "REJECTED_UNSAFE",
  "FORWARDED_EXTERNAL",
  "NEEDS_MORE_INFO",
  "MERGED",
  "UNCLAIMED_ESCALATED",
  "BOUNTY_LISTED",
  "AT_RISK",
  "FORKED",
  "PARKED",
  "WITHDRAWN",
  // In the enum, no UI this cut.
  "AGREEMENT_SIGNED",
  "PILOT",
  "DISPUTED",
]);

export const domainEnum = pgEnum("domain", [
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
]);

/** NDMA hazard classes. The linkage is what makes an item a Disaster Management
 *  item rather than a public-works item, and it is a weighted term in the score. */
export const hazardEnum = pgEnum("hazard", [
  "FLOOD",
  "DROUGHT",
  "LANDSLIDE",
  "HEATWAVE",
  "MINING_SUBSIDENCE",
  "EPIDEMIC",
  "FOREST_FIRE",
  "NONE",
]);

export const licenceEnum = pgEnum("licence", ["CC_BY", "RESTRICTED"]);

export const orgTypeEnum = pgEnum("org_type", ["HEI", "INDUSTRY", "GOVERNMENT"]);

export const slaKindEnum = pgEnum("sla_kind", [
  "CLAIM_WINDOW",
  "WIDEN",
  "OPEN_ALL",
  "BREACH",
  "GRAND_CHALLENGE",
  "PROPOSAL_DUE",
  "SILENT_30",
  "SILENT_45",
  "IMPACT_UNCONFIRMED_30",
  "ANNUAL_REVIEW",
]);

export const ledgerKindEnum = pgEnum("ledger_kind", [
  "PROBLEM_TEXT",
  "MEDIA",
  "PROPOSAL",
  "REPORT",
  "STATE_CHANGE",
  "CREDIT_EDGE",
  "ACCESS",
  "OVERRIDE",
  "ANCHOR",
]);

/* -------------------------------------------------------------- geography */

export const districts = pgTable("districts", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  nameHi: text("name_hi"),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  /** 0.00–1.00. A weighted term in the priority score (Phase 2). */
  vulnerabilityIndex: numeric("vulnerability_index", { precision: 3, scale: 2 }),
});

export const blocks = pgTable(
  "blocks",
  {
    code: text("code").primaryKey(),
    districtCode: text("district_code")
      .notNull()
      .references(() => districts.code),
    name: text("name").notNull(),
    nameHi: text("name_hi"),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    vulnerabilityIndex: numeric("vulnerability_index", { precision: 3, scale: 2 }),
  },
  (t) => [index("blocks_district_idx").on(t.districtCode)],
);

/* --------------------------------------------------------------- identity */

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("CITIZEN"),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    preferredLang: text("preferred_lang").notNull().default("en"),
    districtCode: text("district_code").references(() => districts.code),
    blockCode: text("block_code").references(() => blocks.code),
    /** Loophole row 7: the production design is a decaying trust score driven by
     *  confirmed/rejected reports. Phase 1 ships a constant plus a rate limit. */
    trustScore: numeric("trust_score", { precision: 3, scale: 2 }).notNull().default("0.50"),
    /** 1 = phone only, 2 = verified by an official, 3 = Aadhaar-tier. Phase 1 seeds 1. */
    verifiedTier: integer("verified_tier").notNull().default(1),
    orgId: text("org_id").references(() => organization.id),
  },
  (t) => [index("user_profiles_role_idx").on(t.role), index("user_profiles_district_idx").on(t.districtCode)],
);

export const organisationsMeta = pgTable(
  "organisations_meta",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    orgType: orgTypeEnum("org_type").notNull(),
    /** AICTE/UGC code for an HEI; null for a firm or a district office. */
    heiCode: text("hei_code"),
    districtCode: text("district_code").references(() => districts.code),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    website: text("website"),
  },
  (t) => [index("organisations_meta_type_idx").on(t.orgType), index("organisations_meta_district_idx").on(t.districtCode)],
);

/* ------------------------------------------------------- capability graph */

/** What S5 routes against in Phase 2: a department, its labs, its tags, and how
 *  much capacity it has declared for a given window. */
export const capabilities = pgTable(
  "capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    labName: text("lab_name"),
    specialisationTags: text("specialisation_tags").array().notNull().default(sql`'{}'::text[]`),
    facultyName: text("faculty_name"),
    facultyDesignation: text("faculty_designation"),
    /** Number of student teams this capability can take in the window. */
    declaredCapacity: integer("declared_capacity").notNull().default(0),
    capacityFrom: date("capacity_from"),
    capacityTo: date("capacity_to"),
    /** Phase 2. 768-d, cached on the hash of the tag string. */
    embedding: vector("embedding", { dimensions: 768 }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("capabilities_org_idx").on(t.orgId),
    index("capabilities_tags_idx").using("gin", t.specialisationTags),
    index("capabilities_active_idx").on(t.active),
    index("capabilities_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/* ------------------------------------------------------ challenges: spine */

export const challenges = pgTable(
  "challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** JH-2026-GUM-0042 : state, year, district, sequence. Sayable over a phone. */
    trackingId: text("tracking_id").notNull().unique(),
    status: challengeStatusEnum("status").notNull().default("SUBMITTED"),

    // The citizen's words. `body_original` is never destroyed, never hidden,
    // and always rendered beside `body_en` at the same size and weight.
    bodyOriginal: text("body_original").notNull(),
    bodyLang: text("body_lang").notNull().default("en"),
    bodyEn: text("body_en"),
    title: text("title").notNull(),

    // Phase 2 (S2 framing). The citizen approves the rewrite or keeps their own.
    framedStatement: text("framed_statement"),
    successCriteria: text("success_criteria"),
    framingApprovedByCitizen: boolean("framing_approved_by_citizen").notNull().default(false),

    reporterId: text("reporter_id").references(() => user.id),
    /** Kept even for anonymous submissions so the credit chain has a name to show. */
    reporterName: text("reporter_name"),
    /** An ASHA worker or panchayat volunteer who filed on someone's behalf. */
    assistedBy: text("assisted_by").references(() => user.id),

    districtCode: text("district_code").references(() => districts.code),
    blockCode: text("block_code").references(() => blocks.code),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    locationAccuracyM: integer("location_accuracy_m"),

    /** Stored as the bucket midpoint: 1-10 -> 5, 10-100 -> 55, 100-1000 -> 550, 1000+ -> 2000. */
    peopleAffected: integer("people_affected"),
    recurrence: text("recurrence"),
    urgencySelfReport: integer("urgency_self_report"),

    // Phase 2 (S1/S3). Null until the pipeline runs.
    domain: domainEnum("domain"),
    hazard: hazardEnum("hazard"),
    hazardStrength: numeric("hazard_strength", { precision: 3, scale: 2 }),
    severity: numeric("severity", { precision: 3, scale: 2 }),
    priorityScore: numeric("priority_score", { precision: 6, scale: 3 }),
    /** Every term, its weight and its value — this is what makes the number clickable. */
    priorityBreakdown: jsonb("priority_breakdown"),
    scoringVersion: text("scoring_version"),

    /** S1 decides. A grievance is forwarded to CPGRAMS/JharSewa and the citizen is told where. */
    isGrievance: boolean("is_grievance").notNull().default(false),
    forwardedRef: text("forwarded_ref"),

    // Clustering (Phase 2). Duplicates are signal: nothing is discarded.
    clusterId: uuid("cluster_id"),
    isParent: boolean("is_parent").notNull().default(false),
    parentId: uuid("parent_id"),
    corroborationCount: integer("corroboration_count").notNull().default(1),

    officialEndorsed: boolean("official_endorsed").notNull().default(false),
    endorsedBy: text("endorsed_by").references(() => user.id),

    /** True when the fix is a tender, not a research question — routed differently. */
    capitalWorks: boolean("capital_works").notNull().default(false),
    solvability: text("solvability"),

    /** Phase 2. The HNSW index is created in the Phase 2 migration, not here. */
    embedding: vector("embedding", { dimensions: 768 }),

    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body_en, '') || ' ' || body_original)`,
    ),

    /** Invariant 7: flipped only at CITIZEN_VERIFIED. Not on publish, not on funding. */
    impactConfirmed: boolean("impact_confirmed").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("challenges_tracking_idx").on(t.trackingId),
    index("challenges_status_idx").on(t.status),
    index("challenges_district_idx").on(t.districtCode),
    index("challenges_block_idx").on(t.blockCode),
    index("challenges_domain_idx").on(t.domain),
    index("challenges_hazard_idx").on(t.hazard),
    index("challenges_cluster_idx").on(t.clusterId),
    index("challenges_search_idx").using("gin", t.searchTsv),
    index("challenges_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    // Phase 2. At 25 rows this changes nothing; the honest answer to "would this
    // work at 250,000 challenges?" is "yes, and here is the index".
    index("challenges_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("challenges_parent_idx").on(t.parentId),
  ],
);

export const challengeMedia = pgTable(
  "challenge_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    /** Every object in Storage is keyed by its own SHA-256, so the same photo
     *  uploaded twice is one object and the ledger can cite it by hash. */
    storageKey: text("storage_key").notNull(),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    exifStripped: boolean("exif_stripped").notNull().default(false),
    /** Declared stub for this cut: face and plate blurring is not implemented. */
    facesBlurred: boolean("faces_blurred").notNull().default(false),
    consentGiven: boolean("consent_given").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("challenge_media_challenge_idx").on(t.challengeId)],
);

export const corroborations = pgTable(
  "corroborations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    /** Distance from the challenge point. A corroboration from 200km away is
     *  worth less than one from the same village; `weight` carries that. */
    distanceKm: numeric("distance_km", { precision: 8, scale: 3 }),
    weight: numeric("weight", { precision: 4, scale: 3 }).notNull().default("1.000"),
    deviceFingerprint: text("device_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The anti-brigading constraint. One account, one corroboration per challenge.
    uniqueIndex("corroborations_challenge_user_uniq").on(t.challengeId, t.userId),
    index("corroborations_challenge_idx").on(t.challengeId),
  ],
);

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentChallengeId: uuid("parent_challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    blockCode: text("block_code").references(() => blocks.code),
    /** NEAR_DUP = the same incident reported twice. BLOCK_SYSTEMIC = many
     *  different incidents in one block that share a cause. */
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clusters_block_idx").on(t.blockCode)],
);

/* -------------------------------------------------- routing and projects */

export const routes = pgTable(
  "routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    capabilityId: uuid("capability_id").references(() => capabilities.id),
    rank: integer("rank").notNull(),
    matchScore: numeric("match_score", { precision: 6, scale: 3 }),
    /** Written by the model, but only around facts we hand it. Invariant 4. */
    reasonText: text("reason_text"),
    /** The top three contributing terms, weight x value. The model never invents these. */
    reasonTerms: jsonb("reason_terms"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    claimWindowEndsAt: timestamp("claim_window_ends_at", { withTimezone: true }),
    state: text("state").notNull().default("OFFERED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("routes_challenge_idx").on(t.challengeId),
    index("routes_org_idx").on(t.orgId),
    index("routes_state_idx").on(t.state),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id),
    leadUserId: text("lead_user_id").references(() => user.id),
    mentorUserId: text("mentor_user_id").references(() => user.id),
    title: text("title").notNull(),
    /** OPEN publishes under CC-BY; RESTRICTED keeps the artifact behind an access log. */
    ipTrack: text("ip_track").notNull().default("OPEN"),
    status: text("status").notNull().default("ACTIVE"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Drives the SILENT_30 / SILENT_45 ladders in Phase 3. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    forkedFrom: uuid("forked_from"),
  },
  (t) => [index("projects_challenge_idx").on(t.challengeId), index("projects_org_idx").on(t.orgId)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    declaredRole: text("declared_role"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_members_uniq").on(t.projectId, t.userId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

/* ------------------------------------------------------- accountability */

/**
 * Invariant 1: every challenge in a non-terminal state has at least one open
 * row here. `tests/invariant.test.ts` is the CI query that proves it.
 * Deadlines are durable rows, not setTimeout timers, because a serverless
 * function keeps no in-memory state between requests.
 */
export const slaDeadlines = pgTable(
  "sla_deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: slaKindEnum("kind").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The reaper's only query, every 5 minutes. Partial so it stays small
    // however many deadlines have already fired.
    index("sla_deadlines_open_due_idx")
      .on(t.dueAt)
      .where(sql`fired_at IS NULL AND cancelled_at IS NULL`),
    index("sla_deadlines_challenge_idx").on(t.challengeId),
  ],
);

/**
 * Invariant 2: append-only. No UPDATE, no DELETE — enforced by a trigger in the
 * hand-written migration, not by convention.
 * Phase 1 writes `content_hash` and leaves `prev_hash`/`entry_hash` null.
 * TODO(Phase 3 Task 3.4): backfill and link the chain, then make them NOT NULL.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    challengeId: uuid("challenge_id").references(() => challenges.id),
    projectId: uuid("project_id").references(() => projects.id),
    kind: ledgerKindEnum("kind").notNull(),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    prevHash: char("prev_hash", { length: 64 }),
    entryHash: char("entry_hash", { length: 64 }),
    authorId: text("author_id").references(() => user.id),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_seq_idx").on(t.seq),
    index("ledger_entries_challenge_idx").on(t.challengeId),
    index("ledger_entries_kind_idx").on(t.kind),
  ],
);

/** "We do not stop people from sharing work. We make it impossible to erase who did it." */
export const creditEdges = pgTable(
  "credit_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => user.id),
    toUserId: text("to_user_id").references(() => user.id),
    orgId: text("org_id").references(() => organization.id),
    /** ORIGINATOR CORROBORATOR TEAM_MEMBER MENTOR FUNDER IMPLEMENTER */
    relation: text("relation").notNull(),
    declaredRole: text("declared_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_edges_challenge_idx").on(t.challengeId), index("credit_edges_to_user_idx").on(t.toUserId)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract"),
    storageKey: text("storage_key"),
    contentHash: char("content_hash", { length: 64 }),
    licence: licenceEnum("licence").notNull().default("CC_BY"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("artifacts_project_idx").on(t.projectId)],
);

/** A RESTRICTED artifact can still be read — but never anonymously. */
export const accessLog = pgTable(
  "access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id),
    orgId: text("org_id").references(() => organization.id),
    purpose: text("purpose"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_log_artifact_idx").on(t.artifactId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    actionUrl: text("action_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId), index("notifications_org_idx").on(t.orgId)],
);

/**
 * The transactional outbox. A state change and its event are written in one
 * transaction; a worker drains the table afterwards. This is why Milan needs no
 * Kafka: at state scale, a Postgres table covers every event we emit.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_unprocessed_idx")
      .on(t.createdAt)
      .where(sql`processed_at IS NULL`),
  ],
);

/** Every model call, successful or not, with the fallback level it landed on.
 *  A failed AI call is never swallowed; it is recorded here. */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id").references(() => challenges.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    provider: text("provider"),
    model: text("model"),
    /** 0 = primary (Gemini), 1 = Groq, 2 = deterministic rules. */
    fallbackLevel: integer("fallback_level").notNull().default(0),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    latencyMs: integer("latency_ms"),
    /** SHA-256 of the prompt input, so an identical input reuses the cached output. */
    inputHash: char("input_hash", { length: 64 }),
    output: jsonb("output"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_runs_challenge_idx").on(t.challengeId),
    index("ai_runs_stage_idx").on(t.stage),
    index("ai_runs_input_hash_idx").on(t.inputHash),
  ],
);

/**
 * The AI response cache.
 *
 * Keyed on sha256(stage + prompt version + canonical input). Every stage is a
 * pure function of its input, so an identical input can reuse an identical
 * output — which is what makes the pipeline idempotent and the live trace safe
 * to replay on stage without spending a token or risking the venue wifi.
 *
 * A cache hit still writes an `ai_runs` row with `provider: 'cache'`, so the
 * trace never overstates what actually ran.
 */
export const aiCache = pgTable(
  "ai_cache",
  {
    /** sha256(stage + version + canonical input JSON). */
    key: char("key", { length: 64 }).primaryKey(),
    stage: text("stage").notNull(),
    version: text("version").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    fallbackLevel: integer("fallback_level").notNull().default(0),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    latencyMs: integer("latency_ms"),
    output: jsonb("output").notNull(),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_cache_stage_idx").on(t.stage)],
);

/**
 * Labelled training data, produced by humans correcting the machine.
 *
 * Every override at /admin/triage and every override at /gov/gate lands here
 * with the model's proposal beside the human's correction and the mandatory
 * reason. We do not fine-tune (no GPU budget, no labelled data — we say so on
 * the slide); these rows are what the embedding kNN prior learns from, so the
 * system improves from its own corrected history without retraining anything.
 */
export const trainingCorrections = pgTable(
  "training_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id").references(() => challenges.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    /** The exact text the model saw, so a correction can be replayed. */
    inputText: text("input_text"),
    inputHash: char("input_hash", { length: 64 }),
    proposed: jsonb("proposed"),
    corrected: jsonb("corrected"),
    /** Never null in practice: the UI makes it mandatory. */
    reason: text("reason"),
    correctedBy: text("corrected_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("training_corrections_stage_idx").on(t.stage),
    index("training_corrections_challenge_idx").on(t.challengeId),
  ],
);

/** Every human override carries a mandatory reason and becomes labelled training data. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    reason: text("reason"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorId),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);

/** Single row. Phase 3 moves the clock offset here so the demo console can drive it. */
export const demoState = pgTable("demo_state", {
  id: integer("id").primaryKey().default(1),
  clockOffsetDays: integer("clock_offset_days").notNull().default(0),
  emergencyMode: boolean("emergency_mode").notNull().default(false),
  /** Which hazard the emergency filter is pinned to. Display and sort only — never the stored score. */
  emergencyHazard: text("emergency_hazard"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const industryInterests = pgTable(
  "industry_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id),
    message: text("message"),
    state: text("state").notNull().default("EXPRESSED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("industry_interests_challenge_idx").on(t.challengeId), index("industry_interests_org_idx").on(t.orgId)],
);

/* ------------------------------------------------------------- type aliases */

export type ChallengeStatus = (typeof challengeStatusEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
export type Domain = (typeof domainEnum.enumValues)[number];
export type Hazard = (typeof hazardEnum.enumValues)[number];
export type SlaKind = (typeof slaKindEnum.enumValues)[number];
export type LedgerKind = (typeof ledgerKindEnum.enumValues)[number];
export type OrgType = (typeof orgTypeEnum.enumValues)[number];
export type Challenge = typeof challenges.$inferSelect;
export type Capability = typeof capabilities.$inferSelect;
export type AiRun = typeof aiRuns.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;
