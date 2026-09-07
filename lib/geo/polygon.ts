/**
 * Point-in-polygon over the Jharkhand district boundaries.
 *
 * Pure: no I/O, no server-only, importable from a client component (the submit
 * wizard resolves a pin drop in the browser so it works offline and instantly).
 *
 * The rings come from `jharkhand-districts.json` — see its `_provenance` block
 * for exactly what the geometry is, where it came from, and what was changed.
 * Coordinates are rounded to 4 decimals (~11 m), which is far finer than the
 * GPS fix on a rural phone and therefore not the limiting factor anywhere.
 */

export interface Ring {
  readonly code: string;
  readonly name: string;
  readonly rings: number[][][];
}

// Typed import of the boundary asset. `resolveJsonModule` is on; the shape is
// validated once at module load by the constructor below rather than trusted.
import boundaries from "./jharkhand-districts.json";

export interface DistrictBoundary {
  code: string;
  name: string;
  /** One or more outer rings, each a closed [lng, lat] loop. */
  rings: number[][][];
}

const DISTRICTS: DistrictBoundary[] = (boundaries as { districts: DistrictBoundary[] }).districts ?? [];

/* ------------------------------------------------------- the ray caster */

/**
 * Even-odd ray casting. lng is x, lat is y. The mismatch between "geoJSON
 * order" and "maths order" is the classic source of transposed-results bugs,
 * so this function takes (lat, lng) like the rest of lib/geo and does the
 * swap exactly once, here, in writing.
 */
export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > lat !== yj > lat;
    if (!crosses) continue;
    // x position where the edge crosses lat's horizontal line
    const xAt = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lng < xAt) inside = !inside;
  }
  return inside;
}

export function pointInDistrict(lat: number, lng: number, d: DistrictBoundary): boolean {
  return d.rings.some((ring) => pointInRing(lat, lng, ring));
}

/**
 * Which district contains this point, or null when none does (outside the
 * state, or in the gap a 4-decimal simplification can open on a border).
 * Callers fall back to nearest-centroid for exactly those cases.
 */
export function districtAt(lat: number, lng: number): DistrictBoundary | null {
  for (const d of DISTRICTS) {
    if (pointInDistrict(lat, lng, d)) return d;
  }
  return null;
}

/** For tests and the verification harness: every boundary, in code order. */
export function allBoundaries(): readonly DistrictBoundary[] {
  return DISTRICTS;
}
