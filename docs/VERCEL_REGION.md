# Why the functions are pinned to Mumbai

`vercel.json` sets `"regions": ["bom1"]`. That one line is worth about sixteen
seconds on the demo, and the reason is worth knowing before somebody "cleans it
up".

## What we measured

The pipeline verified at **7.4s** locally and **23.9s** on the first Vercel
deployment. The obvious suspicion — that the models were slower in production —
was wrong. The per-stage model latencies recorded in `ai_runs` for that run:

| Stage | Model call |
|---|---|
| S1 | 754 ms |
| S2 | 886 ms |
| S3 | 685 ms |
| S5 | 712 ms |

Four calls, three seconds of model time, inside a twenty-four second run. The
other twenty-one seconds were the gaps *between* stages, and the submit itself
took 5.3s against 1.0s locally.

Those gaps are database round trips. Supabase is at
`aws-0-ap-south-1.pooler.supabase.com` — Mumbai. Vercel's default function
region is `iad1`, Washington DC. Every query in every stage was crossing the
Indian Ocean and the Atlantic, and the pipeline makes a lot of small queries: a
context load, a kNN prior, a vector search, a state transition with its ledger
append and outbox event, a capability scan, a route insert.

## The fix

Put the functions where the data is. `bom1` is Vercel's Mumbai region.

**On the Hobby plan this file is not enough.** After deploying with
`"regions": ["bom1"]` the response header still read:

```
x-vercel-id: bom1::iad1::m8pn7-...
```

`bom1` is the edge that accepted the request; `iad1` is where the function
actually ran. Hobby projects execute in the single region configured on the
project, and the `regions` key is honoured on Pro and above. So somebody with
dashboard access has to set it once:

> **Vercel → the `milan` project → Settings → Functions → Function Region →
> Mumbai, South Asia (bom1) → Save, then redeploy.**

It is one dropdown and it is worth about sixteen seconds of the demo. The
`regions` key stays in `vercel.json` regardless: it documents the intent, and it
is what takes effect the moment the project is on a plan that reads it.

This is also the right answer for the product rather than only for the demo: the
users are in Jharkhand, the data is in Mumbai, and a citizen on a 3G connection
in Gumla should not be waiting on a packet that has been to Virginia and back.

## If you move the database

Change both together, or this file becomes a lie. The regions must match:

| Supabase region | Vercel region |
|---|---|
| `ap-south-1` (Mumbai) | `bom1` |
| `ap-southeast-1` (Singapore) | `sin1` |
| `us-east-1` (N. Virginia) | `iad1` |

## The cron entry

`vercel.json` also declares the SLA reaper on a five-minute schedule, which
CLAUDE.md section 3 requires. `/api/cron/reaper` is Phase 3 Task 3.2 and does
not exist yet — Vercel tolerates a cron pointing at a route that 404s, and
declaring it now means Phase 3 adds a file rather than also remembering to add
the schedule.
