# Why the reaper runs daily and not every five minutes

`PHASE_3_BUILD.md` Task 3.2 specifies `*/5 * * * *`, and that is the correct schedule. An SLA ladder
that advances once a day makes "no challenge may silently die" a 24-hour promise rather than a
5-minute one.

**Vercel Hobby refuses any cron that runs more than once a day, and it refuses it by failing the
entire deployment.** That is why production sat on the Phase 2 build while Phase 3 was being written:
every git-triggered deploy after `vercel.json` gained the 5-minute cron was rejected with

```
Hobby accounts are limited to daily cron jobs. This cron expression (*/5 * * * *)
would run more than once per day.
```

So `vercel.json` ships `0 1 * * *`. On Pro, change that one line back to `*/5 * * * *` and redeploy —
nothing else needs to change.

## What this does not affect

- **The demo.** `/demo`'s clock buttons advance the clock and run the reaper in the same click, and
  the live log is read from that call's return value. The cron is not on the demo path.
- **Correctness.** Deadlines are durable rows compared against `clock_now()`, not timers. A reaper
  that runs late fires everything that became due while it was not running, in `due_at` order. Late
  is late; nothing is lost.
- **Manual runs.** `/api/cron/reaper` accepts `CRON_SECRET` as a bearer token, an `x-cron-secret`
  header or a `?secret=` parameter, so an external scheduler (cron-job.org, GitHub Actions, a state
  data-centre scheduler) can call it every five minutes for free:

```bash
curl -H "authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reaper
```

That is also the honest answer to "what happens in production at scale": the reaper is a plain
authenticated endpoint, safe to run concurrently (`FOR UPDATE SKIP LOCKED`), so the schedule is a
deployment concern rather than an architectural one.
