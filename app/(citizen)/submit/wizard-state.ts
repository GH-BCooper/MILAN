"use client";

import type { PeopleBucket } from "./schema";

/**
 * All wizard state in one reducer, and the whole thing persisted to
 * localStorage on every change.
 *
 * A citizen on a 3G connection in Gumla loses the tab, the battery dies, the
 * browser evicts the page. Losing four screens of typing at that point means
 * they do not report the problem at all. The draft key is stable per draft so a
 * half-finished report survives a reload.
 */

export interface UploadedMedia {
  storageKey: string;
  contentHash: string;
  mime: string;
  bytes: number;
  exifStripped: true;
  consentGiven: boolean;
  previewUrl: string | null;
  fileName: string;
}

export interface WizardState {
  step: number;
  bodyOriginal: string;
  bodyLang: "hi" | "en";
  media: UploadedMedia[];
  consentGiven: boolean;
  districtCode: string;
  blockCode: string | null;
  lat: number | null;
  lng: number | null;
  locationAccuracyM: number | null;
  locationSource: "none" | "gps" | "pin" | "dropdown";
  peopleAffectedBucket: PeopleBucket | "";
  recurrence: "one-off" | "seasonal" | "yearly" | "constant" | "";
  urgencySelfReport: number;
  framedStatement: string;
  successCriteria: string;
  framingApprovedByCitizen: boolean;
  reporterName: string;
}

export const FIRST_STEP = 1;
export const LAST_STEP = 6;

export const STEP_TITLES: Record<number, { en: string; hi: string }> = {
  1: { en: "What is the problem?", hi: "समस्या क्या है?" },
  2: { en: "Photo or evidence", hi: "फोटो या सबूत" },
  3: { en: "Where is it?", hi: "यह कहाँ है?" },
  4: { en: "Who does it affect?", hi: "यह किसे प्रभावित करता है?" },
  5: { en: "Check the wording", hi: "शब्दों की जाँच करें" },
  6: { en: "Review and submit", hi: "समीक्षा करें और भेजें" },
};

export const initialState: WizardState = {
  step: FIRST_STEP,
  bodyOriginal: "",
  bodyLang: "hi",
  media: [],
  consentGiven: false,
  districtCode: "",
  blockCode: null,
  lat: null,
  lng: null,
  locationAccuracyM: null,
  locationSource: "none",
  peopleAffectedBucket: "",
  recurrence: "",
  urgencySelfReport: 3,
  framedStatement: "",
  successCriteria: "",
  framingApprovedByCitizen: false,
  reporterName: "",
};

export type WizardAction =
  | { type: "set"; patch: Partial<WizardState> }
  | { type: "addMedia"; media: UploadedMedia }
  | { type: "removeMedia"; contentHash: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: number }
  | { type: "hydrate"; state: WizardState }
  | { type: "reset" };

export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "set":
      return { ...state, ...action.patch };
    case "addMedia":
      return { ...state, media: [...state.media, action.media].slice(0, 3) };
    case "removeMedia":
      return { ...state, media: state.media.filter((m) => m.contentHash !== action.contentHash) };
    case "next":
      return { ...state, step: Math.min(LAST_STEP, state.step + 1) };
    case "back":
      return { ...state, step: Math.max(FIRST_STEP, state.step - 1) };
    case "goto":
      return { ...state, step: Math.min(LAST_STEP, Math.max(FIRST_STEP, action.step)) };
    case "hydrate":
      return action.state;
    case "reset":
      return initialState;
    default:
      return state;
  }
}

/** Which steps may be left, and why not. Step 2 and 5 are always skippable. */
export function stepBlocker(state: WizardState, step: number): string | null {
  switch (step) {
    case 1:
      if (state.bodyOriginal.trim().length < 40) {
        return `Please write at least 40 characters — ${state.bodyOriginal.trim().length} so far.`;
      }
      return null;
    case 2:
      if (state.media.length > 0 && !state.consentGiven) {
        return "Please confirm you have permission to share these photos.";
      }
      return null;
    case 3:
      if (!state.districtCode) return "Choose the district.";
      return null;
    case 4:
      if (!state.peopleAffectedBucket) return "Choose roughly how many people are affected.";
      if (!state.recurrence) return "Choose how often this happens.";
      return null;
    case 5:
      return null;
    case 6:
      return null;
    default:
      return null;
  }
}

const DRAFT_PREFIX = "milan:draft:";

export function draftKey(id: string) {
  return `${DRAFT_PREFIX}${id}`;
}

export function loadDraft(id: string): WizardState | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    // Merge over the initial state so a draft written by an older build, missing
    // a field we added since, still opens instead of crashing the wizard.
    return { ...initialState, ...parsed };
  } catch {
    return null;
  }
}

export function saveDraft(id: string, state: WizardState) {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(state));
  } catch {
    // Private browsing, or a full quota. A draft that cannot be saved is not a
    // reason to stop somebody reporting a problem.
  }
}

export function clearDraft(id: string) {
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    /* see saveDraft */
  }
}
