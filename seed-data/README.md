# seed-data

The human team authored this dataset on 2026-09-04, replacing the placeholder
CSVs Claude generated to get Phase 1 built. Two files are still outstanding.

| File | Status |
|---|---|
| `districts.csv` | Real — 24 districts, 263 blocks |
| `heis.csv` | Real — 12 institutions |
| `capabilities.csv` | Real — 47 departments and labs |
| `challenges.csv` | Real — 25 citizen reports |
| `industry.csv` | Real — 8 firms |
| `blocks.csv` | **Stale placeholder. No longer read** — superseded by `districts.csv` |
| `voice-note.mp3` | **Empty file. Not yet recorded** — BACKLOG.md §2.2 |
| `voice-note.transcript.txt` | Written, but has no recording to transcribe |

Still open before the demo, and not optional:

1. **The Hindi has not been checked by a native speaker.** `PHASE_1_LEARN.md` §7.3
   makes this a blocking item. 7 reports are in Hindi and 1 in Santali (`sat`).
2. **`seed_status` and `corroborations` were assigned by Claude on 2026-09-05**,
   not by the team. They are demo staging, not field data: which three reports
   have already been resolved, and how many extra people reported each problem.
   Every other value in this file is the team's. Review them, or overwrite them.

## Column contracts

The seed script (`seed/index.mts`) reads exactly these columns. Add rows freely;
do not rename columns without changing the script.

### districts.csv
`district_code,district_name,district_name_hi,block_code,block_name,lat,lng,vulnerability_index`

One row per **block**, repeating its district's code, name, Devanagari name and
vulnerability index. The seeder splits this into the `districts` and `blocks`
tables.

- `district_code` is the 3-letter code and is the second-to-last segment of every
  tracking ID issued there (`JH-2026-GUM-0042`).
- `lat`/`lng` are the **block** centroid. The district centroid is not a column:
  it is derived as the mean of that district's block centroids, and the run
  prints how many were derived that way.
- `vulnerability_index` is a **district-level** value. Blocks inherit it.
- There is no `block_name_hi` column, so every block's Devanagari name is null.
- A row with an empty `block_code` is treated as district-only and is legitimate.

### blocks.csv
**No longer read.** It described the 2026-09-04 placeholder geography and its
district codes no longer exist. `districts.csv` is the single geography source.

### heis.csv
`hei_code,hei_name,district_code,lat,lng,type,website`

- There is no `slug` column. The seeder derives one from `hei_name` and
  de-duplicates it, so the same name always yields the same slug and re-runs stay
  idempotent. Better Auth's organisation plugin requires it to be unique.
- `type` (`CENTRAL_INSTITUTE`, `STATE_ENGG_COLLEGE`, …) has no schema column and
  is **not stored**. The run warns about it.

### capabilities.csv
`hei_code,department,lab_name,specialisation_tags,faculty_name,faculty_designation,declared_capacity,capacity_window`

- `specialisation_tags` is **pipe**-separated (semicolons are also accepted).
  These tags are what S5 routes against in Phase 2, so they matter more than they
  look.
- `capacity_window` is `YYYY-MM-DD..YYYY-MM-DD` and is split into `capacity_from`
  and `capacity_to`.
- `hei_code` must exist in `heis.csv`; unknown codes are skipped with a warning.

### challenges.csv
`district_code,block_code,title,body_original,body_lang,domain,hazard,severity_hint,people_affected,recurrence,lat,lng,reporter_name`

- `body_lang` is an ISO code — `en`, `hi`, `sat` (Santali) all appear. When it is
  `en`, `body_en` is the citizen's own words; otherwise `body_en` stays null and
  Phase 2's S0 translates it. `body_original` is never destroyed.
- `domain` must be one of the ten `domain` enum values, `hazard` one of the eight
  `hazard` values. A typo is caught at seed time with its CSV line number.
- `severity_hint` (0..1) is seeded into `severity`. Phase 2's S1 recomputes it;
  `>= 0.7` is the human-gate threshold.
- `people_affected` is a plain count. A `people_affected_bucket` column
  (`1-10`, `10-100`, `100-1000`, `1000+`) is also accepted and stored as the
  bucket midpoint, which is what the intake wizard writes.
- `recurrence` is one of `one-off`, `seasonal`, `yearly`, `constant`.

**Two columns that are demo staging, assigned by Claude — see the note above:**

- `seed_status` — `SUBMITTED` (the default) / `CLOSED` / `CITIZEN_VERIFIED`. Rows
  that are not `SUBMITTED` are backdated ~210 days so `/stats` has history to
  show on stage. Three rows carry it:
  - the Simdega footbridge and the Bokaro school are `CITIZEN_VERIFIED`, so the
    impact counter reads 2. It increments at `CITIZEN_VERIFIED` and nowhere else.
  - the Khunti lac study is `CLOSED` — concluded with an advisory, with no
    physical work for a citizen to confirm.
- `corroborations` — how many *extra* people reported the same thing, scaled to
  the report's own `people_affected` and `recurrence`. Seeded rows are anonymous
  (`user_id` null), so the `unique(challenge_id, user_id)` anti-brigading
  constraint does not limit them.

Both are optional. The run warns when either is missing.

### industry.csv
`org_name,sector,district_focus,domain_interests,csr_contact_title`

- `slug` is derived from `org_name`, as for HEIs.
- `district_focus` is a pipe-separated list. The schema stores one district, so
  the **first known** code is the firm's anchor and the run warns about the rest.
- `sector`, `domain_interests` and `csr_contact_title` have no schema column and
  are **not stored**. Phase 4's industry matching needs `domain_interests`; that
  is a declared gap, not an oversight.
- There are no `lat`, `lng` or `website` columns, so those are null.
