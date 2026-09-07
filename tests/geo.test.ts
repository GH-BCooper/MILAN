/**
 * District resolution, without a database.
 *
 * The old nearest-centroid resolver was a declared stub — wrong near every
 * boundary, honestly documented. These tests pin its replacement to real
 * Jharkhand geography: known cities, the exact boundary case the old code got
 * wrong, the outside-the-state fallback, and a mutual validation of the
 * boundary asset against the seeded district coordinates (every seeded
 * centroid must fall inside its own polygon — if either dataset drifted, this
 * is the test that catches it).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { allBoundaries, districtAt } from "@/lib/geo/polygon";
import { haversineKm, resolvePoint, type Centroid } from "@/lib/geo/nearest";

/** The seeded district centroids, exactly as districts.csv carries them. */
function seedDistricts(): Centroid[] {
  const lines = readFileSync("seed-data/districts.csv", "utf8").trim().split("\n").slice(1);
  const seen = new Map<string, Centroid>();
  for (const line of lines) {
    const [code, , , , , lat, lng] = line.split(",");
    if (!seen.has(code)) seen.set(code, { code, lat: Number(lat), lng: Number(lng) });
  }
  return [...seen.values()];
}

describe("the boundary asset", () => {
  it("covers all 24 seeded districts", () => {
    const codes = new Set(allBoundaries().map((d) => d.code));
    for (const seed of seedDistricts()) {
      expect(codes.has(seed.code), `boundary missing ${seed.code}`).toBe(true);
    }
    expect(codes.size).toBe(24);
  });

  it("mutually validates: every seeded centroid lies inside its own polygon", () => {
    for (const seed of seedDistricts()) {
      const hit = districtAt(Number(seed.lat), Number(seed.lng));
      expect(hit?.code, `centroid of ${seed.code} resolved to ${hit?.code}`).toBe(seed.code);
    }
  });
});

describe("districtAt — known places", () => {
  it("resolves the cities a judge will type", () => {
    expect(districtAt(23.3441, 85.3096)?.code).toBe("RAN"); // Ranchi
    expect(districtAt(22.7996, 86.1835)?.code).toBe("ESB"); // Jamshedpur
    expect(districtAt(23.7957, 86.4304)?.code).toBe("DHN"); // Dhanbad
    expect(districtAt(23.0459, 84.5416)?.code).toBe("GUM"); // Gumla town
    expect(districtAt(23.9916, 85.3627)?.code).toBe("HAZ"); // Hazaribagh
    expect(districtAt(24.2708, 87.2526)?.code).toBe("DUM"); // Dumka
    // Interior of Jamtara, the smallest district in the set (bbox midpoint).
    expect(districtAt(23.9811, 86.8807)?.code).toBe("JAM");
  });

  it("returns null outside the state, so the fallback can take over", () => {
    expect(districtAt(28.6139, 77.2090)).toBeNull(); // Delhi
    expect(districtAt(25.5941, 85.1376)).toBeNull(); // Patna
  });
});

describe("resolvePoint — the boundary case the stub got wrong", () => {
  const districts = seedDistricts();
  const blocks: Centroid[] = [
    { code: "GUM-BAS", lat: 22.9167, lng: 84.5833, districtCode: "GUM" },
    { code: "GUM-RAI", lat: 23.0833, lng: 84.45, districtCode: "GUM" },
  ];

  it("a point inside Gumla but nearer Lohardaga's centroid resolves to Gumla", () => {
    const lat = 23.22;
    const lng = 84.925;
    // The premise, checked rather than assumed: nearest-centroid really would
    // have said Lohardaga here. If the seed centroids ever move, this
    // precondition — not the assertion — is what breaks.
    const loh = districts.find((d) => d.code === "LOH")!;
    const gum = districts.find((d) => d.code === "GUM")!;
    expect(haversineKm(lat, lng, Number(loh.lat), Number(loh.lng))).toBeLessThan(
      haversineKm(lat, lng, Number(gum.lat), Number(gum.lng)),
    );

    const resolved = resolvePoint(lat, lng, districts, blocks);
    expect(resolved.districtCode).toBe("GUM");
    expect(resolved.districtDistanceKm).toBeNull(); // polygon hit: no distance reported
  });

  it("falls back to nearest-centroid outside the state, and says how far", () => {
    const resolved = resolvePoint(24.7, 85.0, districts, blocks); // near Bihar border, north of the state
    // Whatever it picks, it must be an honest centroid hit with a distance.
    expect(resolved.districtCode).not.toBeNull();
    expect(resolved.districtDistanceKm).not.toBeNull();
    expect(resolved.blockCode).toBeNull(); // no block list entry matches that district
  });

  it("only offers a block belonging to the resolved district", () => {
    const resolved = resolvePoint(23.0459, 84.5416, districts, blocks); // Gumla town
    expect(resolved.districtCode).toBe("GUM");
    expect(["GUM-BAS", "GUM-RAI"]).toContain(resolved.blockCode);
  });
});
