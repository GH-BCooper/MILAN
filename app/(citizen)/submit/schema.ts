import { z } from "zod";

/**
 * The contract between the wizard and the server action. One schema, shared:
 * the client uses it to decide when a step is complete, the server uses it to
 * decide what it will accept. The server parse is the one that matters.
 */

/** Loophole row 8: a floor on effort. Forty characters is roughly one sentence,
 *  which is the least that can describe a real problem. */
export const MIN_BODY_CHARS = 40;

export const RECURRENCE = ["one-off", "seasonal", "yearly", "constant"] as const;

/** Captured as a bucket because nobody knows the exact number, and a spurious
 *  precise figure would be scored as though it were real. Stored as the midpoint. */
export const PEOPLE_BUCKETS = [
  { value: "1-10", label: "Between 1 and 10 people", midpoint: 5 },
  { value: "10-100", label: "Between 10 and 100 people", midpoint: 55 },
  { value: "100-1000", label: "Between 100 and 1,000 people", midpoint: 550 },
  { value: "1000+", label: "More than 1,000 people", midpoint: 2000 },
] as const;

export type PeopleBucket = (typeof PEOPLE_BUCKETS)[number]["value"];

export function bucketMidpoint(bucket: string): number | null {
  return PEOPLE_BUCKETS.find((b) => b.value === bucket)?.midpoint ?? null;
}

export const UploadedMediaSchema = z.object({
  storageKey: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  exifStripped: z.literal(true),
  consentGiven: z.boolean(),
});

export const SubmitSchema = z.object({
  // Step 1
  bodyOriginal: z
    .string()
    .trim()
    .min(MIN_BODY_CHARS, `Please describe the problem in at least ${MIN_BODY_CHARS} characters.`)
    .max(5000, "Please keep it under 5,000 characters."),
  bodyLang: z.enum(["hi", "en"]),

  // Step 2
  media: z.array(UploadedMediaSchema).max(3).default([]),

  // Step 3
  districtCode: z.string().trim().min(1, "Choose the district."),
  blockCode: z.string().trim().min(1).nullable().default(null),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  locationAccuracyM: z.number().int().nonnegative().nullable().default(null),

  // Step 4
  peopleAffectedBucket: z.enum(["1-10", "10-100", "100-1000", "1000+"]),
  recurrence: z.enum(RECURRENCE),
  urgencySelfReport: z.number().int().min(1).max(5),

  // Step 5 — Phase 1 proposes the citizen's own text; Phase 2 Task 2.7 adds the
  // AI rewrite. The approval flag means the same thing either way.
  framedStatement: z.string().trim().max(1000).nullable().default(null),
  successCriteria: z.string().trim().max(1000).nullable().default(null),
  framingApprovedByCitizen: z.boolean().default(false),

  // Step 6
  reporterName: z.string().trim().max(120).nullable().default(null),
});

export type SubmitInput = z.infer<typeof SubmitSchema>;

/** A title for the list views. The citizen never types one — asking for a title
 *  is asking them to do our summarising. Phase 2 S2 replaces this with a real
 *  framed statement; until then, their own first clause is the honest choice. */
export function deriveTitle(body: string): string {
  const firstSentence = body.split(/[।.!?\n]/)[0].trim();
  const candidate = firstSentence.length >= 12 ? firstSentence : body.trim();
  return candidate.length > 110 ? `${candidate.slice(0, 107).trimEnd()}…` : candidate;
}
