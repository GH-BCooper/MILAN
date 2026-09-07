# PMTiles Basemap Setup — Tier 1, Item 2

**Why:** The map (`components/milan-map.tsx`) reads `NEXT_PUBLIC_PMTILES_URL`. If set, it
builds a `pmtiles://<url>` vector source over HTTP **range requests** and renders the
standard Protomaps basemap layers (`earth`, `water`, `landuse`, `roads`, `boundaries`).
If unset/unreachable it falls back to a blank canvas and says so. Today the var is empty,
so the map shows dots on grey — the single most "unfinished" thing on a projector.

The `.pmtiles` file must be **Protomaps-format** (the standard basemap schema the code
already references). Both routes below produce exactly that.

---

## Option A — Recommended: a Jharkhand extract (fast, free)

The `pmtiles` CLI (already a dependency: `pmtiles@^4.1.0`) can clip a region from any
Protomaps archive.

```bash
# 1. Get a Protomaps basemap archive. The free world basemap is released on GitHub:
#    https://github.com/protomaps/protomaps-basemap/releases  ->  protomaps-basemap-*.pmtiles
#    (Large download; or order a custom India/Jharkhand region from protomaps.com instead.)
mkdir -p ~/milan-tiles && cd ~/milan-tiles
# ...download protomaps-basemap-LATEST.pmtiles here...

# 2. Clip to Jharkhand's bounding box (approx lon 83.3–88.0, lat 21.9–25.0).
npx pmtiles extract protomaps-basemap-*.pmtiles jharkhand.pmtiles \
  --bbox 83.3,21.9,88.0,25.0

# 3. Result is a small Jharkhand-only archive.
ls -lh jharkhand.pmtiles
```

> Prefer this over a whole-planet file: smaller, faster range requests, no quota.

## Option B — Build from OpenStreetMap (free, heavier)

Only if you want the absolute latest OSM data. Requires `osmium-tool` + `tippecanoe`.

```bash
# 1. India PBF: https://download.geofabrik.de/asia/india.html
osmium extract india-latest.osm.pbf --bbox 83.3,21.9,88.0,25.0 -o jharkhand.pbf
# 2. PBF -> MBTiles
tippecanoe -o jharkhand.mbtiles --force --coalesce-densest-as-needed \
  --generate-ids --buffer 64 --extend-zoom-out 2 jharkhand.pbf
# 3. MBTiles -> PMTiles (Protomaps basemap schema)
npx pmtiles convert jharkhand.mbtiles jharkhand.pmtiles
```

> Note: Option B produces raw OSM layers, NOT the `earth/water/landuse/roads/boundaries`
> schema `milan-map.tsx` expects, so it will render blank there. **Use Option A for
> this project** unless you also rewrite the style layers in `milan-map.tsx`.

---

## Host it

### Online demo (wifi on) — Supabase Storage
1. In the Supabase dashboard, create a **public** bucket (e.g. `maps`), upload `jharkhand.pmtiles`.
2. The public URL looks like:
   `https://<project>.supabase.co/storage/v1/object/public/maps/jharkhand.pmtiles`
   (Supabase Storage supports HTTP range requests, which the `pmtiles` protocol needs.)
3. Set it in `.env.local`:
   ```bash
   NEXT_PUBLIC_PMTILES_URL=https://<project>.supabase.co/storage/v1/object/public/maps/jharkhand.pmtiles
   ```

### Offline demo (wifi OFF) — MinIO (already in `docker-compose.yml`)
The offline demo cannot fetch a remote URL, so serve the file **locally**. MinIO is already
running in compose (bucket `media`, anonymous download enabled by `minio-init`).

```bash
# 1. Bring the stack up (already part of the rehearsal).
docker compose up -d

# 2. Copy the archive into the media bucket.
#    (brew install minio-mc / apt install minio-client, or use the mc container)
mc alias set local http://localhost:9000 milan milan-offline-secret
mc cp jharkhand.pmtiles local/media/jharkhand.pmtiles

# 3. It is now reachable at (anonymous GET, range-supported):
#    http://localhost:9000/media/jharkhand.pmtiles
```

4. Set it in **`.env.offline.example`** (so the offline profile loads the local tiles):
   ```bash
   NEXT_PUBLIC_PMTILES_URL=http://localhost:9000/media/jharkhand.pmtiles
   ```
   - For the **laptop-only** offline run, `localhost` is correct.
   - For the **phone-over-4G** test (Item 4), the phone cannot reach the laptop's
     `localhost`. Use the laptop LAN IP instead:
     `http://<laptop-ip>:9000/media/jharkhand.pmtiles` (find it with `hostname -I`).

---

## Apply + verify

`NEXT_PUBLIC_*` vars are **inlined at build time** in Next.js. After setting the var you
MUST rebuild:

```bash
# Offline:
cp .env.offline.example .env.local
pnpm build && pnpm demo:offline      # serves on http://localhost:3000

# Online (dev):
pnpm dev                             # http://localhost:3000
```

**Verify:** open `/demo` (or any map view — submit wizard, `/challenges`).
- The Jharkhand basemap (light land, blue water, dashed boundaries) draws under the markers.
- The line *"Basemap tiles are not loaded, so only the points are shown"* is **gone**.
- On a misconfigured URL, the map degrades to blank + that message rather than crashing —
  that fallback is expected behaviour, not a bug.

**Judge line:** *"No tile API, no token, no vendor that can fail on stage — the basemap is a
static Protomaps archive served from our own storage."*

---

## Checklist
- [ ] `jharkhand.pmtiles` produced (Option A)
- [ ] Hosted: Supabase (online) **and/or** MinIO (offline)
- [ ] `NEXT_PUBLIC_PMTILES_URL` set in `.env.local` (and `.env.offline.example` for offline)
- [ ] `pnpm build` re-run after setting the var
- [ ] Basemap visible in `/demo`; fallback message absent
- [ ] Phone test uses LAN-IP URL, not `localhost`
