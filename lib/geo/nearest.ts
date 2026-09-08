/**
 * Resolving a GPS point to a district and block.
 *
 * District resolution is **point-in-polygon** over the boundary asset in
 * `jharkhand-districts.json` (see lib/geo/polygon.ts for provenance). When no
 * polygon contains the point — outside the state, or in the sliver a rounded
 * boundary can open — we fall back to nearest-centroid, which is also what
 * block resolution uses within the resolved district: we hold real boundary
 * geometry for 24 districts and centroids only for 263 blocks.
 *
 * The citizen can always correct the district and block by dropdown. Geolocation
 * in rural Jharkhand is not reliable and the demo must not depend on it. The
 * dropdown is the source of truth; this function only supplies the default.
 */

import { districtAt } from "./polygon";

const EARTH_RADIUS_KM = 6371;

export interface Centroid {
  code: string;
  lat: number | null;
  lng: number | null;
  districtCode?: string;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function nearest<T extends Centroid>(
  lat: number,
  lng: number,
  candidates: T[],
): { match: T; distanceKm: number } | null {
  let best: { match: T; distanceKm: number } | null = null;
  for (const c of candidates) {
    if (c.lat === null || c.lng === null) continue;
    const d = haversineKm(lat, lng, Number(c.lat), Number(c.lng));
    if (!best || d < best.distanceKm) best = { match: c, distanceKm: d };
  }
  return best;
}

/**
 * How far past the nearest district centroid a point can be and still count
 * as "basically inside Jharkhand" — the 4-decimal polygon simplification
 * (see polygon.ts) can open a small gap right on a border, and a genuine
 * border village must not be told it is out of coverage over that. Anything
 * further out than this is a different state, or a different country, and
 * the wizard says so rather than quietly filing it under the nearest
 * district anyway.
 */
export const OUTSIDE_JHARKHAND_BUFFER_KM = 25;

/**
 * Whether a point counts as inside Milan's coverage area. A polygon hit is
 * always inside; a polygon miss is inside only within the border buffer
 * above — otherwise `resolvePoint`'s nearest-centroid fallback would happily
 * assign a district to a point in, say, Kolkata or Patna.
 */
export function isWithinJharkhand(
  districtCode: string | null,
  districtDistanceKm: number | null,
): boolean {
  if (!districtCode) return false;
  return districtDistanceKm === null || districtDistanceKm <= OUTSIDE_JHARKHAND_BUFFER_KM;
}

/**
 * Resolve a point to a district and, where we hold blocks for that district, a
 * block. Polygon containment decides the district; a block is only offered
 * when it belongs to the resolved district — otherwise a point near a border
 * could pick a block from the wrong district.
 *
 * `districtDistanceKm` is null on a polygon hit (there is no meaningful
 * "distance to the district") and carries the centroid fallback distance
 * otherwise, which the wizard uses to warn that a pin looks far from anywhere
 * the seeded database knows.
 */
export function resolvePoint(
  lat: number,
  lng: number,
  districts: Centroid[],
  blocks: Centroid[],
): { districtCode: string | null; blockCode: string | null; districtDistanceKm: number | null } {
  const hit = districtAt(lat, lng);

  let districtCode: string | null;
  let districtDistanceKm: number | null = null;

  if (hit) {
    districtCode = hit.code;
  } else {
    const fallback = nearest(lat, lng, districts);
    districtCode = fallback?.match.code ?? null;
    districtDistanceKm = fallback?.distanceKm ?? null;
  }

  if (!districtCode) return { districtCode: null, blockCode: null, districtDistanceKm: null };

  const inDistrict = blocks.filter((b) => b.districtCode === districtCode);
  const block = nearest(lat, lng, inDistrict);

  return {
    districtCode,
    blockCode: block?.match.code ?? null,
    districtDistanceKm,
  };
}
