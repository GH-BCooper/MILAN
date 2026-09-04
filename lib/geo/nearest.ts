/**
 * Resolving a GPS point to a district and block.
 *
 * This is **nearest-centroid**, not point-in-polygon. We hold one lat/lng per
 * district and per block and pick the closest one. That is wrong near a boundary
 * — a point three kilometres inside Gumla but closer to a Lohardaga block
 * centroid resolves to Lohardaga.
 *
 * We accept that for two reasons. Real boundary geometry for 24 districts and
 * their blocks is a large asset we do not have, and more importantly the citizen
 * can always correct the district and block by dropdown. Geolocation in rural
 * Jharkhand is not reliable and the demo must not depend on it. The dropdown is
 * the source of truth; this function only supplies the default.
 *
 * Replacing this with a real point-in-polygon lookup is a drop-in change: the
 * signature does not mention centroids.
 */

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
 * Resolve a point to a district and, where we hold blocks for that district, a
 * block. A block is only offered when it belongs to the resolved district —
 * otherwise a point near a border could pick a block from the wrong district.
 */
export function resolvePoint(
  lat: number,
  lng: number,
  districts: Centroid[],
  blocks: Centroid[],
): { districtCode: string | null; blockCode: string | null; districtDistanceKm: number | null } {
  const district = nearest(lat, lng, districts);
  if (!district) return { districtCode: null, blockCode: null, districtDistanceKm: null };

  const inDistrict = blocks.filter((b) => b.districtCode === district.match.code);
  const block = nearest(lat, lng, inDistrict);

  return {
    districtCode: district.match.code,
    blockCode: block?.match.code ?? null,
    districtDistanceKm: district.distanceKm,
  };
}
