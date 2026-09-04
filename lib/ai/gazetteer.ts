/**
 * The gazetteer: Milan's deterministic knowledge, with no network attached.
 *
 * This file is what makes CLAUDE.md invariant 8 true. Level 2 of the provider
 * chain reads nothing but these tables, so the pipeline still classifies, still
 * triages and still routes when Gemini, Groq and the conference wifi are all
 * unavailable at once. It is worse than a model. It is never unavailable.
 *
 * Keywords are matched against the lower-cased original text AND the English
 * working copy, so a Hindi report is caught by its Devanagari terms even when
 * translation itself has failed.
 *
 * Everything here is hand-authored from the Jharkhand seed set. When a
 * misclassification is found, the fix is a term in this file or a few-shot
 * example in `lib/ai/prompts/` -- never a hard-coded challenge id.
 */
import type { Domain, Hazard } from "@/lib/db/schema";

/* ------------------------------------------------------------------ safety */

/**
 * Content that must never be published and whose media must be purged.
 * Deliberately narrow: a false positive silences a citizen, which is a worse
 * failure than a false negative that a human then catches at /admin/triage.
 */
export const UNSAFE_TERMS: Array<{ term: string; category: string }> = [
  { term: "kill myself", category: "SELF_HARM" },
  { term: "suicide", category: "SELF_HARM" },
  { term: "end my life", category: "SELF_HARM" },
  { term: "atmahatya", category: "SELF_HARM" },
  { term: "आत्महत्या", category: "SELF_HARM" },
  { term: "जान दे दूंगा", category: "SELF_HARM" },
  { term: "kill him", category: "VIOLENCE_THREAT" },
  { term: "kill them", category: "VIOLENCE_THREAT" },
  { term: "burn down", category: "VIOLENCE_THREAT" },
  { term: "jaan se maar", category: "VIOLENCE_THREAT" },
  { term: "जान से मार", category: "VIOLENCE_THREAT" },
  { term: "बम", category: "VIOLENCE_THREAT" },
  { term: "raped", category: "SEXUAL_VIOLENCE" },
  { term: "rape", category: "SEXUAL_VIOLENCE" },
  { term: "बलात्कार", category: "SEXUAL_VIOLENCE" },
  { term: "molested", category: "SEXUAL_VIOLENCE" },
  { term: "child abuse", category: "CHILD_SAFETY" },
  { term: "trafficking", category: "CHILD_SAFETY" },
  { term: "तस्करी", category: "CHILD_SAFETY" },
  { term: "witch hunt", category: "TARGETED_HARASSMENT" },
  { term: "daayan", category: "TARGETED_HARASSMENT" },
  { term: "डायन", category: "TARGETED_HARASSMENT" },
];

/** Which helpline the citizen is shown when S1 rejects. Never a dead end. */
export const HELPLINE_FOR: Record<string, { number: string; label: string }> = {
  SELF_HARM: { number: "14416", label: "Tele-MANAS mental health helpline" },
  VIOLENCE_THREAT: { number: "112", label: "Emergency response" },
  SEXUAL_VIOLENCE: { number: "181", label: "Women helpline" },
  CHILD_SAFETY: { number: "1098", label: "Childline" },
  TARGETED_HARASSMENT: { number: "112", label: "Emergency response" },
  UNKNOWN: { number: "112", label: "Emergency response" },
};

/* --------------------------------------------------------------- grievance */

/**
 * A grievance is a complaint with a known fix and an accountable officer.
 * CPGRAMS and JharSewa already do that well; Milan routes unsolved problems to
 * a lab. These phrases are the tell: a sanctioned scheme, a fitted asset, a
 * named official, money that did not arrive.
 *
 * `weight` lets several weak signals add up to a decision rather than one
 * ambiguous word deciding on its own.
 */
export const GRIEVANCE_TERMS: Array<{ term: string; weight: number }> = [
  { term: "sanctioned", weight: 0.35 },
  { term: "स्वीकृत", weight: 0.35 },
  { term: "swikrit", weight: 0.3 },
  { term: "tender was passed", weight: 0.35 },
  { term: "not been built", weight: 0.3 },
  { term: "not built", weight: 0.3 },
  { term: "नहीं बनी", weight: 0.3 },
  { term: "नहीं बना", weight: 0.3 },
  { term: "was fitted", weight: 0.3 },
  { term: "were fitted", weight: 0.3 },
  { term: "installed but", weight: 0.3 },
  { term: "लगा दिया गया", weight: 0.25 },
  { term: "pmgsy", weight: 0.3 },
  { term: "पीएमजीएसवाई", weight: 0.3 },
  { term: "jal jeevan", weight: 0.3 },
  { term: "जल जीवन", weight: 0.3 },
  { term: "mgnrega payment", weight: 0.35 },
  { term: "pension has not", weight: 0.4 },
  { term: "पेंशन नहीं", weight: 0.4 },
  { term: "ration card", weight: 0.3 },
  { term: "राशन कार्ड", weight: 0.3 },
  { term: "bribe", weight: 0.4 },
  { term: "रिश्वत", weight: 0.4 },
  { term: "contractor took", weight: 0.3 },
  { term: "ठेकेदार", weight: 0.2 },
  { term: "block development officer", weight: 0.25 },
  { term: "bdo", weight: 0.2 },
  { term: "junior engineer", weight: 0.2 },
  { term: "no officer has", weight: 0.15 },
  { term: "complaint", weight: 0.15 },
  { term: "शिकायत", weight: 0.15 },
  { term: "scheme", weight: 0.15 },
  { term: "योजना", weight: 0.15 },
];

/**
 * The counterweight. These say "nobody knows how to fix this", which is exactly
 * what Milan exists for, and they pull a borderline item back from CPGRAMS.
 */
export const RESEARCH_TERMS: Array<{ term: string; weight: number }> = [
  { term: "crack", weight: 0.2 },
  { term: "दरार", weight: 0.2 },
  { term: "erosion", weight: 0.25 },
  { term: "कटाव", weight: 0.25 },
  { term: "subsid", weight: 0.3 },
  { term: "धंस", weight: 0.3 },
  { term: "contaminat", weight: 0.25 },
  { term: "fluoride", weight: 0.3 },
  { term: "arsenic", weight: 0.3 },
  { term: "dries up", weight: 0.2 },
  { term: "सूख", weight: 0.2 },
  { term: "water table", weight: 0.25 },
  { term: "landslide", weight: 0.25 },
  { term: "slips", weight: 0.15 },
  { term: "elephant", weight: 0.25 },
  { term: "हाथी", weight: 0.25 },
  { term: "heat", weight: 0.15 },
  { term: "लू", weight: 0.2 },
  { term: "forest fire", weight: 0.25 },
  { term: "आग", weight: 0.15 },
  { term: "silt", weight: 0.2 },
  { term: "seep", weight: 0.2 },
  { term: "रिस", weight: 0.2 },
];

/** Which external system a forwarded grievance goes to. */
export function grievanceTargetFor(text: string): string {
  const t = text.toLowerCase();
  if (/pension|राशन|ration|मनरेगा|mgnrega/.test(t)) return "JharSewa";
  if (/pmgsy|पीएमजीएसवाई|jal jeevan|जल जीवन|road|सड़क/.test(t)) return "CPGRAMS";
  return "CPGRAMS";
}

/* ---------------------------------------------------------------- domains */

/** Keyword to domain. First table wins the highest total weight, not the first hit. */
export const DOMAIN_TERMS: Array<{ term: string; domain: Domain; weight: number }> = [
  // WATER
  { term: "embankment", domain: "WATER", weight: 0.9 },
  { term: "बांध", domain: "WATER", weight: 0.9 },
  { term: "बाँध", domain: "WATER", weight: 0.9 },
  { term: "bund", domain: "WATER", weight: 0.8 },
  { term: "river", domain: "WATER", weight: 0.6 },
  { term: "नदी", domain: "WATER", weight: 0.6 },
  { term: "well", domain: "WATER", weight: 0.6 },
  { term: "कुआं", domain: "WATER", weight: 0.7 },
  { term: "कुएं", domain: "WATER", weight: 0.7 },
  { term: "कुँआ", domain: "WATER", weight: 0.7 },
  { term: "hand pump", domain: "WATER", weight: 0.7 },
  { term: "चापाकल", domain: "WATER", weight: 0.7 },
  { term: "water", domain: "WATER", weight: 0.5 },
  { term: "पानी", domain: "WATER", weight: 0.5 },
  { term: "dak", domain: "WATER", weight: 0.4 },
  { term: "dam", domain: "WATER", weight: 0.7 },
  { term: "डैम", domain: "WATER", weight: 0.7 },
  { term: "canal", domain: "WATER", weight: 0.6 },
  { term: "नहर", domain: "WATER", weight: 0.6 },
  { term: "spring", domain: "WATER", weight: 0.5 },
  // HEALTHCARE
  { term: "fluoride", domain: "HEALTHCARE", weight: 1.0 },
  { term: "फ्लोराइड", domain: "HEALTHCARE", weight: 1.0 },
  { term: "loose motion", domain: "HEALTHCARE", weight: 0.9 },
  { term: "diarrho", domain: "HEALTHCARE", weight: 0.9 },
  { term: "दस्त", domain: "HEALTHCARE", weight: 0.8 },
  { term: "fainting", domain: "HEALTHCARE", weight: 0.9 },
  { term: "बेहोश", domain: "HEALTHCARE", weight: 0.9 },
  { term: "heat stroke", domain: "HEALTHCARE", weight: 1.0 },
  { term: "clinic", domain: "HEALTHCARE", weight: 0.6 },
  { term: "अस्पताल", domain: "HEALTHCARE", weight: 0.7 },
  { term: "hospital", domain: "HEALTHCARE", weight: 0.6 },
  { term: "anaemia", domain: "HEALTHCARE", weight: 0.8 },
  { term: "malaria", domain: "HEALTHCARE", weight: 0.9 },
  { term: "बीमार", domain: "HEALTHCARE", weight: 0.5 },
  // AGRICULTURE
  { term: "paddy", domain: "AGRICULTURE", weight: 0.9 },
  { term: "धान", domain: "AGRICULTURE", weight: 0.9 },
  { term: "kharif", domain: "AGRICULTURE", weight: 0.9 },
  { term: "खरीफ", domain: "AGRICULTURE", weight: 0.9 },
  { term: "crop", domain: "AGRICULTURE", weight: 0.7 },
  { term: "फसल", domain: "AGRICULTURE", weight: 0.7 },
  { term: "field", domain: "AGRICULTURE", weight: 0.4 },
  { term: "खेत", domain: "AGRICULTURE", weight: 0.6 },
  { term: "elephant", domain: "AGRICULTURE", weight: 0.5 },
  { term: "हाथी", domain: "AGRICULTURE", weight: 0.5 },
  { term: "harvest", domain: "AGRICULTURE", weight: 0.6 },
  { term: "irrigation", domain: "AGRICULTURE", weight: 0.6 },
  { term: "सिंचाई", domain: "AGRICULTURE", weight: 0.6 },
  // ENVIRONMENT
  { term: "subsidence", domain: "ENVIRONMENT", weight: 1.0 },
  { term: "धंस", domain: "ENVIRONMENT", weight: 0.9 },
  { term: "open cast", domain: "ENVIRONMENT", weight: 0.9 },
  { term: "opencast", domain: "ENVIRONMENT", weight: 0.9 },
  { term: "mine", domain: "ENVIRONMENT", weight: 0.6 },
  { term: "खदान", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "खान", domain: "ENVIRONMENT", weight: 0.5 },
  { term: "smoke", domain: "ENVIRONMENT", weight: 0.6 },
  { term: "धुआँ", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "धुआं", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "dust", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "धूल", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "pollution", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "प्रदूषण", domain: "ENVIRONMENT", weight: 0.7 },
  { term: "forest", domain: "ENVIRONMENT", weight: 0.5 },
  { term: "जंगल", domain: "ENVIRONMENT", weight: 0.5 },
  { term: "sal forest", domain: "ENVIRONMENT", weight: 0.8 },
  // LIVELIHOODS
  { term: "lac", domain: "LIVELIHOODS", weight: 0.8 },
  { term: "लाह", domain: "LIVELIHOODS", weight: 0.8 },
  { term: "kusum", domain: "LIVELIHOODS", weight: 0.7 },
  { term: "mahua", domain: "LIVELIHOODS", weight: 0.6 },
  { term: "महुआ", domain: "LIVELIHOODS", weight: 0.6 },
  { term: "tendu", domain: "LIVELIHOODS", weight: 0.7 },
  { term: "migrat", domain: "LIVELIHOODS", weight: 0.6 },
  { term: "पलायन", domain: "LIVELIHOODS", weight: 0.8 },
  { term: "मज़दूरी", domain: "LIVELIHOODS", weight: 0.5 },
  { term: "livelihood", domain: "LIVELIHOODS", weight: 0.7 },
  { term: "income", domain: "LIVELIHOODS", weight: 0.4 },
  // EDUCATION
  { term: "school", domain: "EDUCATION", weight: 0.8 },
  { term: "स्कूल", domain: "EDUCATION", weight: 0.8 },
  { term: "विद्यालय", domain: "EDUCATION", weight: 0.8 },
  { term: "anganwadi", domain: "EDUCATION", weight: 0.7 },
  { term: "आंगनबाड़ी", domain: "EDUCATION", weight: 0.7 },
  { term: "teacher", domain: "EDUCATION", weight: 0.7 },
  { term: "शिक्षक", domain: "EDUCATION", weight: 0.7 },
  { term: "classroom", domain: "EDUCATION", weight: 0.8 },
  // SANITATION
  { term: "toilet", domain: "SANITATION", weight: 0.9 },
  { term: "शौचालय", domain: "SANITATION", weight: 0.9 },
  { term: "open defecation", domain: "SANITATION", weight: 1.0 },
  { term: "drain", domain: "SANITATION", weight: 0.6 },
  { term: "नाली", domain: "SANITATION", weight: 0.6 },
  { term: "sewage", domain: "SANITATION", weight: 0.8 },
  { term: "garbage", domain: "SANITATION", weight: 0.7 },
  { term: "कचरा", domain: "SANITATION", weight: 0.7 },
  // ACCESSIBILITY
  { term: "cut off", domain: "ACCESSIBILITY", weight: 0.7 },
  { term: "ghat road", domain: "ACCESSIBILITY", weight: 0.9 },
  { term: "footbridge", domain: "ACCESSIBILITY", weight: 0.9 },
  { term: "culvert", domain: "ACCESSIBILITY", weight: 0.6 },
  { term: "पुलिया", domain: "ACCESSIBILITY", weight: 0.6 },
  { term: "पुल", domain: "ACCESSIBILITY", weight: 0.7 },
  { term: "bridge", domain: "ACCESSIBILITY", weight: 0.7 },
  { term: "raft", domain: "ACCESSIBILITY", weight: 0.7 },
  { term: "road is", domain: "ACCESSIBILITY", weight: 0.5 },
  { term: "रास्ता", domain: "ACCESSIBILITY", weight: 0.5 },
  // URBAN_INFRA
  { term: "colony", domain: "URBAN_INFRA", weight: 0.6 },
  { term: "कॉलोनी", domain: "URBAN_INFRA", weight: 0.6 },
  { term: "storm water", domain: "URBAN_INFRA", weight: 0.8 },
  { term: "waterlogg", domain: "URBAN_INFRA", weight: 0.8 },
  { term: "जलजमाव", domain: "URBAN_INFRA", weight: 0.8 },
  { term: "houses gone", domain: "URBAN_INFRA", weight: 0.7 },
  { term: "municipal", domain: "URBAN_INFRA", weight: 0.7 },
  { term: "नगर निगम", domain: "URBAN_INFRA", weight: 0.7 },
  // PUBLIC_SERVICE
  { term: "pmgsy", domain: "PUBLIC_SERVICE", weight: 0.8 },
  { term: "jal jeevan", domain: "PUBLIC_SERVICE", weight: 0.8 },
  { term: "जल जीवन", domain: "PUBLIC_SERVICE", weight: 0.8 },
  { term: "pension", domain: "PUBLIC_SERVICE", weight: 0.8 },
  { term: "पेंशन", domain: "PUBLIC_SERVICE", weight: 0.8 },
  { term: "ration", domain: "PUBLIC_SERVICE", weight: 0.7 },
  { term: "राशन", domain: "PUBLIC_SERVICE", weight: 0.7 },
  { term: "certificate", domain: "PUBLIC_SERVICE", weight: 0.6 },
];

/* ---------------------------------------------------------------- hazards */

export const HAZARD_TERMS: Array<{ term: string; hazard: Hazard; weight: number }> = [
  { term: "flood", hazard: "FLOOD", weight: 0.9 },
  { term: "बाढ़", hazard: "FLOOD", weight: 0.9 },
  { term: "embankment", hazard: "FLOOD", weight: 0.8 },
  { term: "बांध", hazard: "FLOOD", weight: 0.7 },
  { term: "बाँध", hazard: "FLOOD", weight: 0.7 },
  { term: "bund", hazard: "FLOOD", weight: 0.7 },
  { term: "swollen river", hazard: "FLOOD", weight: 0.85 },
  { term: "overflow", hazard: "FLOOD", weight: 0.7 },
  { term: "erosion", hazard: "FLOOD", weight: 0.7 },
  { term: "कटाव", hazard: "FLOOD", weight: 0.7 },
  { term: "monsoon", hazard: "FLOOD", weight: 0.4 },
  { term: "बरसात", hazard: "FLOOD", weight: 0.4 },
  { term: "waterlogg", hazard: "FLOOD", weight: 0.7 },

  { term: "drought", hazard: "DROUGHT", weight: 0.9 },
  { term: "सूखा", hazard: "DROUGHT", weight: 0.9 },
  { term: "dried up", hazard: "DROUGHT", weight: 0.8 },
  { term: "dries", hazard: "DROUGHT", weight: 0.7 },
  { term: "सूख", hazard: "DROUGHT", weight: 0.7 },
  { term: "rohor", hazard: "DROUGHT", weight: 0.7 },
  { term: "water table", hazard: "DROUGHT", weight: 0.7 },
  { term: "no rain", hazard: "DROUGHT", weight: 0.7 },
  { term: "rains have gone wrong", hazard: "DROUGHT", weight: 0.6 },

  { term: "landslide", hazard: "LANDSLIDE", weight: 0.95 },
  { term: "भूस्खलन", hazard: "LANDSLIDE", weight: 0.95 },
  { term: "slips every", hazard: "LANDSLIDE", weight: 0.8 },
  { term: "hillside", hazard: "LANDSLIDE", weight: 0.6 },
  { term: "ghat road", hazard: "LANDSLIDE", weight: 0.7 },
  { term: "slope", hazard: "LANDSLIDE", weight: 0.5 },

  { term: "heat", hazard: "HEATWAVE", weight: 0.6 },
  { term: "heatwave", hazard: "HEATWAVE", weight: 0.95 },
  { term: "लू", hazard: "HEATWAVE", weight: 0.85 },
  { term: "गर्मी", hazard: "HEATWAVE", weight: 0.5 },
  { term: "fainting", hazard: "HEATWAVE", weight: 0.7 },
  { term: "बेहोश", hazard: "HEATWAVE", weight: 0.6 },
  { term: "दोपहर", hazard: "HEATWAVE", weight: 0.3 },

  { term: "subsidence", hazard: "MINING_SUBSIDENCE", weight: 0.95 },
  { term: "धंस", hazard: "MINING_SUBSIDENCE", weight: 0.85 },
  { term: "open cast", hazard: "MINING_SUBSIDENCE", weight: 0.7 },
  { term: "opencast", hazard: "MINING_SUBSIDENCE", weight: 0.7 },
  { term: "underground fire", hazard: "MINING_SUBSIDENCE", weight: 0.9 },
  { term: "धुआँ", hazard: "MINING_SUBSIDENCE", weight: 0.5 },
  { term: "abandoned pit", hazard: "MINING_SUBSIDENCE", weight: 0.8 },

  { term: "epidemic", hazard: "EPIDEMIC", weight: 0.9 },
  { term: "outbreak", hazard: "EPIDEMIC", weight: 0.85 },
  { term: "loose motion", hazard: "EPIDEMIC", weight: 0.75 },
  { term: "diarrho", hazard: "EPIDEMIC", weight: 0.8 },
  { term: "दस्त", hazard: "EPIDEMIC", weight: 0.7 },
  { term: "cholera", hazard: "EPIDEMIC", weight: 0.95 },
  { term: "open defecation", hazard: "EPIDEMIC", weight: 0.6 },
  { term: "महामारी", hazard: "EPIDEMIC", weight: 0.9 },

  { term: "forest fire", hazard: "FOREST_FIRE", weight: 0.95 },
  { term: "वनाग्नि", hazard: "FOREST_FIRE", weight: 0.95 },
  { term: "sal forest", hazard: "FOREST_FIRE", weight: 0.4 },
  { term: "fires in the", hazard: "FOREST_FIRE", weight: 0.8 },
  { term: "आग", hazard: "FOREST_FIRE", weight: 0.4 },
];

/**
 * The block hazard profile, keyed by district.
 *
 * This is prior knowledge, not evidence: it nudges an ambiguous report toward
 * the hazard that district actually lives with, and never overrides a hazard
 * the text names outright. Derived from the JSDMA district disaster management
 * plans that `seed-data/districts.csv` also carries the vulnerability index from.
 */
export const DISTRICT_HAZARD_PRIOR: Record<string, Partial<Record<Hazard, number>>> = {
  SAH: { FLOOD: 0.35 },
  GUM: { FLOOD: 0.25, DROUGHT: 0.15 },
  SIM: { FLOOD: 0.2 },
  SKH: { FLOOD: 0.25 },
  RAN: { FLOOD: 0.15, HEATWAVE: 0.1 },
  BOK: { FLOOD: 0.15, MINING_SUBSIDENCE: 0.15 },
  DHN: { MINING_SUBSIDENCE: 0.4 },
  RAM: { MINING_SUBSIDENCE: 0.3 },
  HAZ: { MINING_SUBSIDENCE: 0.2, DROUGHT: 0.1 },
  CHA: { MINING_SUBSIDENCE: 0.15 },
  ESB: { MINING_SUBSIDENCE: 0.15 },
  WSB: { MINING_SUBSIDENCE: 0.2, FOREST_FIRE: 0.1 },
  PAL: { DROUGHT: 0.35, HEATWAVE: 0.25 },
  GAR: { DROUGHT: 0.35, HEATWAVE: 0.2 },
  LAT: { LANDSLIDE: 0.3, FOREST_FIRE: 0.2 },
  KHU: { DROUGHT: 0.2, FOREST_FIRE: 0.1 },
  GOD: { EPIDEMIC: 0.2, DROUGHT: 0.15 },
  DUM: { DROUGHT: 0.25 },
  PAK: { EPIDEMIC: 0.15, FLOOD: 0.15 },
  DEO: { DROUGHT: 0.15 },
  JAM: { DROUGHT: 0.15 },
  GIR: { DROUGHT: 0.15, MINING_SUBSIDENCE: 0.1 },
  KOD: { DROUGHT: 0.2 },
  LOH: { LANDSLIDE: 0.2, DROUGHT: 0.15 },
};

/* -------------------------------------------------------------- solvability */

/**
 * Capital works: the fix is a tender and a contractor, not a research question.
 * Milan still records it and still routes it, but it is routed to a different
 * shortlist and a judge should hear us say so.
 */
export const CAPITAL_WORKS_TERMS = [
  "build a bridge",
  "construct a road",
  "new building",
  "concrete road",
  "पक्की सड़क",
  "पुल बनवा",
  "tender",
  "निविदा",
];

/* ---------------------------------------------------------------- matching */

/** Case-insensitive substring hit. Devanagari has no case, which costs nothing. */
export function hits(haystack: string, term: string): boolean {
  return haystack.includes(term.toLowerCase());
}

/**
 * Sum the weights of every term that appears, grouped by the label it votes for.
 * Several weak signals adding up beats one keyword deciding alone, which is the
 * single most common way a keyword classifier embarrasses itself.
 */
export function tally<K extends string>(
  text: string,
  table: Array<{ term: string; weight: number } & Record<string, unknown>>,
  keyOf: (row: { term: string; weight: number } & Record<string, unknown>) => K,
): Map<K, { score: number; matched: string[] }> {
  const lower = text.toLowerCase();
  const out = new Map<K, { score: number; matched: string[] }>();
  for (const row of table) {
    if (!hits(lower, row.term)) continue;
    const key = keyOf(row);
    const current = out.get(key) ?? { score: 0, matched: [] };
    current.score += row.weight;
    current.matched.push(row.term);
    out.set(key, current);
  }
  return out;
}

/** The best-scoring label, or null when nothing matched at all. */
export function best<K extends string>(
  tallied: Map<K, { score: number; matched: string[] }>,
): { key: K; score: number; matched: string[] } | null {
  let winner: { key: K; score: number; matched: string[] } | null = null;
  for (const [key, v] of tallied) {
    if (!winner || v.score > winner.score) winner = { key, score: v.score, matched: v.matched };
  }
  return winner;
}

/** The domain and hazard keywords a challenge implies, for S5's tag overlap. */
export function keywordSetFor(domain: Domain | null, hazard: Hazard | null): string[] {
  const set = new Set<string>();
  if (domain) {
    set.add(domain.toLowerCase().replaceAll("_", "-"));
    for (const extra of DOMAIN_TAG_EXPANSION[domain] ?? []) set.add(extra);
  }
  if (hazard && hazard !== "NONE") {
    set.add(hazard.toLowerCase().replaceAll("_", "-"));
    for (const extra of HAZARD_TAG_EXPANSION[hazard] ?? []) set.add(extra);
  }
  return [...set];
}

/** Maps our enums onto the vocabulary `seed-data/capabilities.csv` actually uses. */
export const DOMAIN_TAG_EXPANSION: Record<Domain, string[]> = {
  WATER: ["water", "hydrology", "groundwater", "water-resources", "river-training", "irrigation"],
  HEALTHCARE: ["health", "public-health", "epidemiology", "water-quality", "biomedical"],
  AGRICULTURE: ["agriculture", "agronomy", "crop", "soil", "horticulture", "farm"],
  ENVIRONMENT: ["environment", "environmental", "pollution", "air-quality", "mining", "ecology"],
  LIVELIHOODS: ["livelihood", "rural-development", "forestry", "ntfp", "entrepreneurship"],
  EDUCATION: ["education", "pedagogy", "school", "e-learning"],
  SANITATION: ["sanitation", "wastewater", "solid-waste", "wash"],
  ACCESSIBILITY: ["transport", "roads", "bridge", "structural", "civil", "connectivity"],
  URBAN_INFRA: ["urban", "drainage", "storm-water", "planning", "civil", "structural"],
  PUBLIC_SERVICE: ["governance", "public-policy", "service-delivery", "information-systems"],
};

export const HAZARD_TAG_EXPANSION: Record<Hazard, string[]> = {
  FLOOD: ["flood", "flood-resilience", "embankment", "hydraulics", "river-training", "drainage"],
  DROUGHT: ["drought", "groundwater", "water-harvesting", "watershed", "irrigation"],
  LANDSLIDE: ["landslide", "slope-stability", "geotechnical", "soil-mechanics"],
  HEATWAVE: ["heat", "heat-stress", "thermal-comfort", "occupational-health"],
  MINING_SUBSIDENCE: ["mining", "subsidence", "rock-mechanics", "geotechnical", "mine-closure"],
  EPIDEMIC: ["epidemiology", "water-quality", "public-health", "disease-surveillance"],
  FOREST_FIRE: ["forest-fire", "forestry", "remote-sensing", "fire"],
  NONE: [],
};
