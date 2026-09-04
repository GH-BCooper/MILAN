# Phase 1 — LEARN

**Phase 1 = the foundation.** Repo, database, auth, roles, seed data, the intake wizard, the public
tracking page. At the end of Phase 1 a real person can submit a real problem on a real deployed URL
and get a tracking ID back. No AI yet.

Read this **before** you hand `PHASE_1_BUILD.md` to Claude Code. You do not need to be able to write
this code — you need to be able to *read* it, debug it at 2am, and answer a judge who asks
"what is actually in your database?"

Time to read properly: **90 minutes.** Time to skim: 20.

---

## 1. Next.js 15 App Router — the 20% you need

Everything in Milan is one Next.js app. Two ideas do 90% of the work.

### Server Components (RSC) are the default
A component in `app/` runs **on the server** unless it says `"use client"` at the top. Server
components can `await` a database query directly in the component body. There is no `useEffect`,
no loading spinner, no API call.

```tsx
// app/(public)/challenges/page.tsx — runs on the server, talks to Postgres directly
export default async function ChallengesPage() {
  const rows = await db.select().from(challenges).limit(50);
  return <ChallengeList rows={rows} />;
}
```

Add `"use client"` only when you need `useState`, `onClick`, or a browser API (the map, the SSE
trace panel, the submit wizard). **Rule of thumb: push `"use client"` as deep down the tree as
possible.** A client component can receive server-rendered children as props.

### Route groups and the file conventions
- `app/(public)/challenges/page.tsx` → URL `/challenges`. The `(public)` folder **does not appear
  in the URL** — it exists to give a group of routes a shared `layout.tsx` and shared middleware
  treatment. That is exactly how we separate citizen / HEI / industry / gov shells.
- `page.tsx` = the route. `layout.tsx` = a wrapper that persists across navigation.
  `loading.tsx` = the streaming fallback. `error.tsx` = the error boundary.
  `route.ts` = an API endpoint (no UI).
- `app/(public)/c/[trackingId]/page.tsx` → `/c/JH-2026-GUM-0042`, and you read
  `params.trackingId`. In Next 15 `params` and `searchParams` are **Promises** — you must `await`
  them. This trips up every tutorial written before 2025.

### Server Actions
A function marked `"use server"` can be called from a client component but executes on the server.
This is how the submit form writes to the database without us writing an API route.

```tsx
// actions.ts
"use server";
export async function submitChallenge(input: unknown) {
  const parsed = SubmitSchema.parse(input);   // Zod — never trust the client
  // ...write, return trackingId
}
```

**What to remember:** validate with Zod inside the action, always. The client can call the action
with anything.

**Read:** the Next.js docs pages "Server Components", "Server Actions and Mutations", "Route Groups",
"Dynamic Routes". ~40 minutes.

---

## 2. Postgres, Drizzle and why the schema is the product

Drizzle is a thin, typed layer over SQL. You write the schema in TypeScript, it generates SQL
migrations, and your queries are type-checked against the schema.

```ts
export const challenges = pgTable("challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  trackingId: text("tracking_id").notNull().unique(),
  status: challengeStatus("status").notNull().default("SUBMITTED"),
  bodyOriginal: text("body_original").notNull(),
  bodyLang: text("body_lang").notNull(),
  bodyEn: text("body_en"),
  districtCode: text("district_code").references(() => districts.code),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
```

Two commands matter:
- `pnpm drizzle-kit generate` — diff the TS schema against the last migration, emit SQL
- `pnpm drizzle-kit migrate` — apply pending SQL to the database

Never hand-edit an applied migration. Add a new one.

### Postgres concepts you will be asked about
- **Enum types** — `challenge_status` is a real Postgres enum, so an illegal state cannot be written
  even by a stray SQL statement. This is a defence, not decoration.
- **Foreign keys** — a challenge cannot point at a district that does not exist.
- **Indexes** — a `WHERE district_code = ...` on 25 rows is free; on 250,000 rows it is not.
  We index the columns we filter on from day one because it costs nothing to do it now.
- **Transactions** — `BEGIN ... COMMIT`. Either the state change *and* the ledger append *and* the
  deadline row all happen, or none of them do. This is the single most important database idea in
  Milan; without it the ledger can disagree with the challenge table and the whole provenance claim
  collapses.
- **Extensions**: `pgvector` (semantic similarity, Phase 2), `pg_trgm` (fuzzy text search),
  `pgcrypto` (`digest()` for SHA-256 in SQL if we need it), `unaccent`.

**Read:** the Drizzle "Get Started with Supabase" guide plus the "Schema declaration" page. 25 min.

---

## 3. Auth and roles — Better Auth

Better Auth gives us email/password sessions plus an **organisation plugin**. The organisation is
the unit that matters here: an HEI member does not have a personal claim on a challenge, their
*department* does.

Model to hold in your head:

```
user ──belongs to──▶ member ──of──▶ organisation (an HEI, a firm, a district office)
 └─ role: CITIZEN | HEI_MEMBER | INDUSTRY | GOVERNMENT | ADMIN
```

- A **citizen** has a user and no organisation.
- An **HEI member** has a user + membership in an HEI organisation, and a departmental affiliation.
- A **government** user is scoped to a district (`district_code`), because the DC of Gumla should
  not be approving Dhanbad's gate items.

Two enforcement points, both required:
1. `middleware.ts` — cheap, redirects an unauthorised user away from `/gov/*` before the page renders.
2. **Server-side recheck inside the handler** — because middleware can be bypassed by a direct
   server action call. Middleware is UX; the server check is security. Say this in Q&A if asked.

---

## 4. The domain model — learn these by heart

You will be asked about all of this in Q&A, so learn the *reasons*, not just the names.

### Tracking ID
Format: `JH-2026-GUM-0042` = state · year · district code · zero-padded sequence.
Human-readable, sayable over a phone, tells you the district at a glance. Generated at submit time,
returned in seconds, and it is the citizen's whole relationship with the platform.

### The state machine
```
SUBMITTED → TRIAGED → CLASSIFIED → CLUSTERED → PRIORITISED → VERIFIED → ROUTED → CLAIMED
→ PROPOSAL_APPROVED → IN_RESEARCH → SOLUTION_PUBLISHED → INDUSTRY_INTEREST → IMPLEMENTED
→ CITIZEN_VERIFIED → CLOSED
```
Branches and terminals: `REJECTED_UNSAFE`, `FORWARDED_EXTERNAL`, `NEEDS_MORE_INFO`, `MERGED`,
`UNCLAIMED_ESCALATED`, `BOUNTY_LISTED`, `AT_RISK`, `FORKED`, `PARKED`, `WITHDRAWN`.
Also in the enum with no UI this cut: `AGREEMENT_SIGNED`, `PILOT`, `DISPUTED`.

**The point of a state machine** is that "what happens next" is a property of the data, not of
somebody remembering. Phase 3's SLA engine attaches a deadline to every non-terminal state; that is
only possible because the set of states is finite and explicit.

### The seven priority terms (Phase 2 computes them; Phase 1 stores the inputs)
severity · people affected · corroborations · **hazard linkage** · block vulnerability index ·
recurrence · official endorsement.
Phase 1's job is only to make sure the intake form *captures* the raw inputs for these.

### NDMA hazard linkage
Flood, drought, landslide, heatwave, mining subsidence, epidemic, forest fire. Every challenge gets
one plus a linkage strength. This is what makes a "cracked embankment" a Disaster Management item
and not a public-works item. Under the **DM Act 2005**, disaster management is defined to include
*prevention, mitigation and preparedness* — not only response. Memorise that sentence.

### Why not CPGRAMS
CPGRAMS/JharSewa: a complaint with a **known fix** goes to an **accountable officer**.
Milan: an **unsolved problem** goes to a **lab**, with an SLA and IP tracking. Different workflow,
different output. And when S1 decides an item is a grievance, we forward it and tell the citizen —
we integrate, we do not duplicate.

---

## 5. Maps without a token — MapLibre + PMTiles

Mapbox and Google Maps need a billed API key, which is a stage risk and a cost. **Protomaps**
packages the whole basemap as a single `.pmtiles` file that MapLibre GL reads over HTTP range
requests. You download a Jharkhand extract once, put it in Supabase Storage (or `/public`), and the
map works forever with no token, no quota, and no network dependency on a vendor.

What you need to understand: a **tile** is a small square image/vector chunk of the map at a zoom
level; PMTiles is just an archive format that lets the browser fetch byte ranges of the chunks it
needs. Markers and choropleth layers are drawn by us on top.

---

## 6. Deploy on day one, not day six

The most common hackathon death is "it works on my machine" discovered at hour 130. Phase 1 Task 1.1
ends with a deployed URL. Every subsequent commit goes through the same pipeline. If the deploy
breaks, you find out in 3 minutes rather than 3 days.

Vercel specifics worth knowing:
- Server components run in a **serverless function** — no in-memory state survives between requests.
  This is exactly why SLA deadlines are **durable rows** and not `setTimeout` timers.
- **Environment variables** set in the Vercel dashboard, not committed. `NEXT_PUBLIC_*` is exposed
  to the browser; everything else is server-only. Never prefix a secret with `NEXT_PUBLIC_`.
- Use the **transaction pooler** connection string (port 6543) at runtime, the **direct/session**
  string (5432) for migrations. Serverless + non-pooled Postgres = connection exhaustion.

---

## 7. Things you must do yourself after Phase 1 completes

Claude Code cannot do these. Do them the same evening.

1. **Verify the seed on the deployed URL, not locally.** Open `/challenges` on your phone over
   mobile data. If the map is slow on 4G in Anantapur, it will be slow in the demo hall.
2. **Read all 20–25 seeded challenges out loud.** They must sound like citizens, not like an AI.
   Rewrite any that sound generated. This is a 30-minute task that judges notice.
3. **Check the Hindi.** Get a native speaker to confirm the Hindi seed text and every Hindi UI label.
   A wrong Devanagari label on stage is a credibility hole.
4. **Record the voice note properly** if you have not: quiet room, phone at arm's length, 15–20 s,
   Hindi, the Sunita embankment story. Save the ground-truth transcript.
5. **Create the real user accounts you will demo with** and write the credentials on paper:
   - `sunita@demo` (CITIZEN, Gumla)
   - `hod.civil@bitsindri` (HEI_MEMBER, BIT Sindri, Civil)
   - `dc.gumla@jh.gov` (GOVERNMENT, district_code=GUM)
   - `csr@tatasteelfoundation` (INDUSTRY)
   - `admin@milan` (ADMIN)
   Put them in a password manager AND on a printed card. On stage, nobody can remember a password.
6. **Take a database backup** (`pg_dump`) after seeding, and store it. Your one-command restore path
   for a corrupted demo database.
7. **Start the deck.** The "what we stubbed" slide is written from `PROGRESS.md` §Stubbed. Begin it now.
8. **Assign the loophole table.** 16 rows, split across the team, drilled every night.

---

## 8. Self-check before you start Phase 2

Answer these without looking anything up:

- Why is a state stored as a Postgres enum rather than a string?
- Why does the ledger append and the state change have to be in the same transaction?
- What is the difference between the 5432 and 6543 Supabase connection strings, and where is each used?
- What does `"use client"` actually change?
- Why does a middleware role check not remove the need for a server-side role check?
- Give the tracking ID format and say what each segment means.
- Name the seven priority terms.
- Name the NDMA hazards Milan tracks.
- In one sentence, why is Milan not CPGRAMS?
- Why do we deploy on day one?

If you can answer all ten, Phase 2 will make sense. If not, reread §2, §3 and §4.
