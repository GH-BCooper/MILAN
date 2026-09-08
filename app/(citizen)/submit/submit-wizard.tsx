"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, MapPin, Search, Trash2, Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isWithinJharkhand, resolvePoint, type Centroid } from "@/lib/geo/nearest";
import { proposeFramingAction, submitChallengeAction, uploadEvidenceAction } from "./actions";
import { PhotoBlur } from "./photo-blur";
import { MODERATION_MESSAGE, moderate } from "@/lib/moderation/blocklist";
import { MIN_BODY_CHARS, PEOPLE_BUCKETS, RECURRENCE } from "./schema";
import {
  FIRST_STEP,
  LAST_STEP,
  STEP_TITLES,
  clearDraft,
  initialState,
  loadDraft,
  reducer,
  saveDraft,
  stepBlocker,
  type WizardState,
} from "./wizard-state";

// MapLibre touches `window` at import time, so it must not be server-rendered.
const MilanMap = dynamic(() => import("@/components/milan-map").then((m) => m.MilanMap), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />,
});

export interface DistrictOption extends Centroid {
  name: string;
  nameHi: string | null;
}
export interface BlockOption extends Centroid {
  name: string;
  nameHi: string | null;
  districtCode: string;
}

/** Written in citizen voice, not in ours. These are what a real report sounds like. */
const EXAMPLES = {
  hi: [
    "हमारे गाँव के ऊपर वाले बाँध में दरार आ गई है और बरसात में पानी रिसता है।",
    "मार्च के बाद हमारा कुआँ सूख जाता है और औरतों को तीन किलोमीटर दूर से पानी लाना पड़ता है।",
    "बरसात में नाले पर पुलिया न होने से गाँव का रास्ता छह हफ्ते बंद रहता है।",
  ],
  en: [
    "There is a crack in the embankment above our village and water seeps through it in the monsoon.",
    "Our well dries up after March and the women have to carry water from three kilometres away.",
    "The village road is cut off for six weeks each monsoon because the stream has no culvert.",
  ],
} as const;

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function SubmitWizard({
  districts,
  blocks,
  draftId,
  reporterDisplayName,
}: {
  districts: DistrictOption[];
  blocks: BlockOption[];
  draftId: string;
  /** The signed-in citizen's own account name — display only. The server is
   *  the one that decides what actually gets stored (see actions.ts); this is
   *  never sent back to it as free text. */
  reporterDisplayName: string | null;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  /* Step 5: the AI's proposed wording. Null until it has been asked for. */
  const [framing, setFraming] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "ready"; provider: string; fallbackLevel: number; confidence: number }
    | { state: "failed"; error: string }
  >({ state: "idle" });
  const framingAsked = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  /* Restore the draft once, on mount. */
  useEffect(() => {
    const saved = loadDraft(draftId);
    if (saved) dispatch({ type: "hydrate", state: saved });
    setHydrated(true);
  }, [draftId]);

  /* Persist on every change. */
  useEffect(() => {
    if (hydrated) saveDraft(draftId, state);
  }, [state, draftId, hydrated]);

  /* Move focus to the step heading so a screen reader announces the new step. */
  useEffect(() => {
    if (hydrated) headingRef.current?.focus();
  }, [state.step, hydrated]);

  /* Ask for a proposed wording when the citizen first reaches step 5.
     Once only: re-asking would overwrite an edit they had already made. */
  useEffect(() => {
    if (!hydrated || state.step !== 5 || framingAsked.current) return;
    if (state.bodyOriginal.trim().length < MIN_BODY_CHARS) return;
    framingAsked.current = true;
    setFraming({ state: "loading" });

    void proposeFramingAction({
      bodyOriginal: state.bodyOriginal.trim(),
      bodyLang: state.bodyLang,
      districtCode: state.districtCode || null,
      blockCode: state.blockCode,
    }).then((result) => {
      if (!result.ok) {
        setFraming({ state: "failed", error: result.error });
        return;
      }
      setFraming({
        state: "ready",
        provider: result.provider,
        fallbackLevel: result.fallbackLevel,
        confidence: result.confidence,
      });
      // The proposal fills the editable box. It is not stored anywhere until
      // the citizen ticks approval on submit.
      dispatch({
        type: "set",
        patch: {
          framedStatement: result.framedStatement,
          successCriteria: state.successCriteria.trim() || result.successCriteria,
        },
      });
    });
  }, [
    hydrated,
    state.step,
    state.bodyOriginal,
    state.bodyLang,
    state.districtCode,
    state.blockCode,
    state.successCriteria,
  ]);

  const blocker = stepBlocker(state, state.step);
  const blocksForDistrict = useMemo(
    () => blocks.filter((b) => b.districtCode === state.districtCode),
    [blocks, state.districtCode],
  );

  const set = useCallback((patch: Partial<WizardState>) => dispatch({ type: "set", patch }), []);

  function goNext() {
    setAttempted(true);
    if (blocker) return;
    setAttempted(false);
    dispatch({ type: "next" });
  }

  /* ------------------------------------------------------------ geolocation */

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setLocationNote("This browser cannot find your location. Please choose the district below.");
      return;
    }
    setLocating(true);
    setLocationNote(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const resolved = resolvePoint(latitude, longitude, districts, blocks);
        const inside = isWithinJharkhand(resolved.districtCode, resolved.districtDistanceKm);
        set({
          lat: latitude,
          lng: longitude,
          locationAccuracyM: Math.round(accuracy),
          locationSource: "gps",
          districtCode: inside ? (resolved.districtCode ?? "") : "",
          blockCode: inside ? resolved.blockCode : null,
          locationOutsideCoverage: !inside,
        });
        setLocationNote(
          !inside
            ? "This location is outside Milan's coverage area (Jharkhand only)."
            : resolved.districtCode
              ? "We guessed the district from your location. Please check it and correct it if it is wrong."
              : "We could not match that point to a district. Please choose one below.",
        );
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocationNote(
          "We could not get your location. Drop a pin on the map, or just choose the district below.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const onPinChange = useCallback(
    (lat: number, lng: number) => {
      const resolved = resolvePoint(lat, lng, districts, blocks);
      const inside = isWithinJharkhand(resolved.districtCode, resolved.districtDistanceKm);
      set({
        lat,
        lng,
        locationAccuracyM: null,
        locationSource: "pin",
        districtCode: inside ? (resolved.districtCode ?? "") : "",
        blockCode: inside ? resolved.blockCode : null,
        locationOutsideCoverage: !inside,
      });
      setLocationNote(
        inside
          ? "Pin moved. Check the district and block below."
          : "This location is outside Milan's coverage area (Jharkhand only).",
      );
    },
    [districts, blocks, set],
  );

  /* --------------------------------------------------------- place search */

  /**
   * A citizen reporting on someone else's behalf may not be standing at the
   * problem. This geocodes free text against Nominatim's public OSM API — no
   * key, no billing account, which is exactly why it is the pragmatic choice
   * here — and moves the pin to the first result.
   *
   * Invariant 8: nothing on the demo path may depend on a live third-party
   * API succeeding. A network failure, a timeout, or an empty result list
   * all fall through to the same message and leave the citizen free to place
   * the pin by hand or by GPS instead; nothing here blocks the wizard.
   */
  const [placeQuery, setPlaceQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function searchPlace() {
    const q = placeQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(`${q}, Jharkhand, India`)}`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (results.length === 0) {
        setSearchError("No place found by that name. You can still place the pin yourself.");
        return;
      }
      const { lat, lon } = results[0];
      onPinChange(Number(lat), Number(lon));
    } catch {
      setSearchError(
        "Could not search for that place right now. Place the pin yourself, or try again.",
      );
    } finally {
      clearTimeout(timeout);
      setSearching(false);
    }
  }

  /* ---------------------------------------------------------------- upload */

  /**
   * Photos are STAGED, not uploaded: each one goes through the blur step first
   * (photo-blur.tsx), and only the edited bytes — blur baked in, on this device
   * — are ever sent to the server. The unblurred original never leaves the
   * phone, which is the whole privacy argument.
   */
  const [pending, setPending] = useState<File | null>(null);
  const [queue, setQueue] = useState<File[]>([]);

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    const room = 3 - state.media.length - (pending ? 1 : 0) - queue.length;
    const next = Array.from(files).slice(0, Math.max(0, room));
    if (next.length === 0) {
      setUploadError("You can attach up to three photos.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setPending((current) => current ?? next.shift()!);
    setQueue((q) => [...q, ...next]);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function uploadStaged(attach: { file: File; facesBlurred: boolean }) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", attach.file);
      form.append("facesBlurred", attach.facesBlurred ? "true" : "false");
      const result = await uploadEvidenceAction(form);
      if (result.ok) {
        dispatch({
          type: "addMedia",
          media: {
            storageKey: result.storageKey,
            contentHash: result.contentHash,
            mime: result.mime,
            bytes: result.bytes,
            exifStripped: true,
            consentGiven: state.consentGiven,
            facesBlurred: attach.facesBlurred,
            previewUrl: result.previewUrl,
            fileName: attach.file.name,
          },
        });
      } else {
        setUploadError(result.error);
      }
    } finally {
      setUploading(false);
      // Advance the queue: next photo to blur, or done.
      setPending(queue[0] ?? null);
      setQueue((q) => q.slice(1));
    }
  }

  function cancelPending() {
    setPending(queue[0] ?? null);
    setQueue((q) => q.slice(1));
  }

  /* ---------------------------------------------------------------- submit */

  async function onSubmit() {
    setSubmitting(true);
    setSubmitError(null);

    const result = await submitChallengeAction({
      bodyOriginal: state.bodyOriginal.trim(),
      bodyLang: state.bodyLang,
      media: state.media.map((m) => ({
        storageKey: m.storageKey,
        contentHash: m.contentHash,
        mime: m.mime,
        bytes: m.bytes,
        exifStripped: true as const,
        consentGiven: state.consentGiven,
      })),
      districtCode: state.districtCode,
      blockCode: state.blockCode,
      lat: state.lat,
      lng: state.lng,
      locationAccuracyM: state.locationAccuracyM,
      peopleAffectedBucket: state.peopleAffectedBucket,
      recurrence: state.recurrence,
      urgencySelfReport: state.urgencySelfReport,
      framedStatement: state.framedStatement.trim() || null,
      successCriteria: state.successCriteria.trim() || null,
      framingApprovedByCitizen: state.framingApprovedByCitizen,
      includeReporterName: state.includeReporterName,
    });

    if (!result.ok) {
      setSubmitError(result.error);
      setSubmitting(false);
      return;
    }

    clearDraft(draftId);
    router.push(`/submit/success/${result.trackingId}`);
  }

  if (!hydrated) {
    return <div className="h-96 animate-pulse rounded-lg bg-muted" aria-hidden />;
  }

  const charCount = state.bodyOriginal.trim().length;
  // Deterministic, offline, no model call — see lib/moderation/blocklist.ts.
  // Only surfaced once there is enough text to judge fairly; a half-typed
  // word must not flash a warning at the citizen.
  const moderation = charCount >= 8 ? moderate(state.bodyOriginal) : { blocked: false, reason: null };
  const districtName = districts.find((d) => d.code === state.districtCode)?.name ?? null;
  const blockName = blocks.find((b) => b.code === state.blockCode)?.name ?? null;

  return (
    // Step 5 (the wording review) gets the full width the page allows it, so
    // its two textareas can sit genuinely side by side with room to read.
    // Every other step stays a centred, phone-width-friendly column.
    <div className={state.step === 5 ? "" : "mx-auto max-w-2xl"}>
      {/* Progress. The step count is spelled out, not implied by a bar. */}
      <ol className="flex flex-wrap gap-1.5" aria-label="Progress">
        {Array.from({ length: LAST_STEP }, (_, i) => i + 1).map((n) => (
          <li key={n} className="flex-1">
            <div
              className={`h-1.5 rounded-full ${n <= state.step ? "bg-primary" : "bg-border"}`}
              aria-hidden
            />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs font-medium text-muted-foreground">
        Step {state.step} of {LAST_STEP}
      </p>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-2 text-2xl font-bold tracking-tight outline-none"
      >
        {STEP_TITLES[state.step].en}
        <span lang="hi" className="ms-2 text-lg font-normal text-muted-foreground">
          {STEP_TITLES[state.step].hi}
        </span>
      </h1>

      <div className="mt-6">
        {/* ------------------------------------------------ step 1: the text */}
        {state.step === 1 ? (
          <div className="space-y-4">
            <fieldset>
              <legend className="text-sm font-medium">Language / भाषा</legend>
              <div className="mt-2 flex gap-2">
                {(["hi", "en"] as const).map((lang) => (
                  <Button
                    key={lang}
                    type="button"
                    variant={state.bodyLang === lang ? "default" : "outline"}
                    onClick={() => set({ bodyLang: lang })}
                    aria-pressed={state.bodyLang === lang}
                  >
                    {lang === "hi" ? "हिन्दी" : "English"}
                  </Button>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="body">
                Describe the problem in your own words
                <span lang="hi" className="ms-2 font-normal text-muted-foreground">
                  अपने शब्दों में लिखें
                </span>
              </Label>
              <Textarea
                id="body"
                name="body"
                rows={8}
                lang={state.bodyLang}
                value={state.bodyOriginal}
                onChange={(e) => set({ bodyOriginal: e.target.value })}
                aria-describedby="body-count body-help"
                className="text-base"
              />
              <p id="body-count" className="text-xs text-muted-foreground" aria-live="polite">
                {charCount} characters
                {charCount < MIN_BODY_CHARS ? ` — at least ${MIN_BODY_CHARS} needed` : " — thank you"}
              </p>
              <p id="body-help" className="text-xs text-muted-foreground">
                Your words are kept exactly as you write them and shown beside any translation. They
                are never replaced.
              </p>
              {moderation.blocked ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{MODERATION_MESSAGE}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <div className="milan-glass rounded-xl bg-muted p-4">
              <p className="text-sm font-medium">For example</p>
              <ul className="mt-2 space-y-2">
                {EXAMPLES[state.bodyLang].map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      lang={state.bodyLang}
                      onClick={() => set({ bodyOriginal: example })}
                      className="text-start text-sm text-primary underline underline-offset-4"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* --------------------------------------------- step 2: the evidence */}
        {state.step === 2 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A photo helps, but it is not required. You can add up to three.
            </p>

            <Alert>
              <AlertDescription className="text-sm">
                <strong className="font-semibold">Blur faces and number plates yourself, before upload.</strong>{" "}
                Each photo opens in a blur step: tap every face and plate, and the blur is applied on
                your phone — the unblurred photo never leaves this device. This is not automatic
                detection (not built, declared); what you tap is what gets blurred. Location data is
                also removed from every photo before it is stored.
              </AlertDescription>
            </Alert>

            {pending ? (
              <div className="mt-3">
                <PhotoBlur file={pending} onAttach={uploadStaged} onCancel={cancelPending} busy={uploading} />
              </div>
            ) : null}

            <div>
              <input
                ref={fileInput}
                id="evidence"
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="sr-only"
                onChange={(e) => onFiles(e.target.files)}
                disabled={uploading || state.media.length >= 3}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={uploading || state.media.length >= 3}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload aria-hidden className="size-4" /> Take or choose a photo
                  </>
                )}
              </Button>
            </div>

            {uploadError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            ) : null}

            {state.media.length > 0 ? (
              <ul className="space-y-2">
                {state.media.map((m) => (
                  <li
                    key={m.contentHash}
                    className="flex items-center gap-3 milan-glass rounded-xl p-3"
                  >
                    {m.previewUrl ? (
                      // An arbitrary Supabase object of unknown dimensions, shown
                      // at 56px in a list. next/image buys nothing here and would
                      // route a citizen's photo through the optimiser.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.previewUrl}
                        alt=""
                        className="size-14 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="size-14 rounded bg-muted" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.fileName}
                        {m.facesBlurred ? (
                          <span className="ml-2 rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-900">
                            blurred
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(m.bytes / 1024).toFixed(0)} KB · location data removed
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => dispatch({ type: "removeMedia", contentHash: m.contentHash })}
                    >
                      <Trash2 aria-hidden className="size-4" />
                      <span className="sr-only">Remove {m.fileName}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {state.media.length > 0 ? (
              <div className="flex items-start gap-3 milan-glass rounded-xl p-3">
                <input
                  id="consent"
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={state.consentGiven}
                  onChange={(e) => set({ consentGiven: e.target.checked })}
                />
                <Label htmlFor="consent" className="text-sm font-normal leading-snug">
                  I confirm I have permission to share this image and understand faces may be
                  visible.
                </Label>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------ step 3: the place */}
        {state.step === 3 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="place-search">Search for a place</Label>
              <div className="flex gap-2">
                <Input
                  id="place-search"
                  value={placeQuery}
                  onChange={(e) => setPlaceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void searchPlace();
                    }
                  }}
                  placeholder="e.g. Namkum block, Ranchi"
                  className="h-11"
                />
                <Button type="button" variant="outline" onClick={() => void searchPlace()} disabled={searching || !placeQuery.trim()}>
                  {searching ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />}
                  <span className="sr-only">Search</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Useful if you are reporting on someone else&apos;s behalf and are not at the
                location yourself.
              </p>
              {searchError ? (
                <p className="text-sm text-amber-600 dark:text-amber-300" role="status">
                  {searchError}
                </p>
              ) : null}
            </div>

            <Button type="button" variant="outline" onClick={useMyLocation} disabled={locating}>
              {locating ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" /> Finding you…
                </>
              ) : (
                <>
                  <MapPin aria-hidden className="size-4" /> Use my current location
                </>
              )}
            </Button>

            {locationNote ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {locationNote}
              </p>
            ) : null}

            <div className="h-64 sm:h-80">
              <MilanMap
                ariaLabel="Tap the map to place a pin on the problem location"
                className="h-full"
                pin={state.lat !== null && state.lng !== null ? { lat: state.lat, lng: state.lng } : null}
                onPinChange={onPinChange}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Tap the map to place a pin, or drag the pin to move it. The district and block below
              are what we actually use — please correct them if the pin is wrong.
            </p>

            {state.locationOutsideCoverage ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  This location is outside Milan&apos;s coverage area (Jharkhand only). Move the
                  pin back inside Jharkhand, search for a place inside the state, or choose a
                  district below, to continue.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="district">District / जिला</Label>
              <select
                id="district"
                className={selectClass}
                value={state.districtCode}
                onChange={(e) =>
                  set({
                    districtCode: e.target.value,
                    blockCode: null,
                    locationSource: "dropdown",
                    locationOutsideCoverage: false,
                  })
                }
              >
                <option value="">Select a district</option>
                {districts.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                    {d.nameHi ? ` / ${d.nameHi}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="block">Block / प्रखंड (optional)</Label>
              <select
                id="block"
                className={selectClass}
                value={state.blockCode ?? ""}
                onChange={(e) => set({ blockCode: e.target.value || null })}
                disabled={blocksForDistrict.length === 0}
              >
                <option value="">
                  {blocksForDistrict.length ? "Select a block" : "No blocks listed for this district"}
                </option>
                {blocksForDistrict.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                    {b.nameHi ? ` / ${b.nameHi}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------ step 4: the scale */}
        {state.step === 4 ? (
          <div className="space-y-6">
            <fieldset>
              <legend className="text-sm font-medium">
                Roughly how many people does this affect?
              </legend>
              <p className="mt-1 text-xs text-muted-foreground">
                An estimate is fine. Nobody expects an exact number.
              </p>
              <div className="mt-3 space-y-2">
                {PEOPLE_BUCKETS.map((b) => (
                  <label
                    key={b.value}
                    className="flex min-h-11 items-center gap-3 milan-glass rounded-xl p-3"
                  >
                    <input
                      type="radio"
                      name="people"
                      className="size-5"
                      value={b.value}
                      checked={state.peopleAffectedBucket === b.value}
                      onChange={() => set({ peopleAffectedBucket: b.value })}
                    />
                    <span className="text-sm">{b.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium">How often does it happen?</legend>
              <div className="mt-3 space-y-2">
                {RECURRENCE.map((r) => (
                  <label
                    key={r}
                    className="flex min-h-11 items-center gap-3 milan-glass rounded-xl p-3"
                  >
                    <input
                      type="radio"
                      name="recurrence"
                      className="size-5"
                      value={r}
                      checked={state.recurrence === r}
                      onChange={() => set({ recurrence: r })}
                    />
                    <span className="text-sm capitalize">
                      {r === "one-off" ? "Once, not repeating" : r}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium">How urgent does it feel to you? (1 to 5)</legend>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label
                    key={n}
                    className="flex min-h-11 flex-col items-center gap-1 milan-glass rounded-xl p-3"
                  >
                    <input
                      type="radio"
                      name="urgency"
                      className="size-5"
                      value={n}
                      checked={state.urgencySelfReport === n}
                      onChange={() => set({ urgencySelfReport: n })}
                      aria-label={
                        n === 1 ? "1, not urgent" : n === 5 ? "5, very urgent" : String(n)
                      }
                    />
                    <span className="text-sm font-medium">{n}</span>
                  </label>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>Not urgent</span>
                <span>Very urgent</span>
              </div>
            </fieldset>
          </div>
        ) : null}

        {/* ---------------------------------------------- step 5: the framing */}
        {/* Invariant 6, at the moment it matters most. The citizen's own words
            and the AI's proposal sit side by side, the same size, both editable.
            Nothing is stored as the framed statement unless they tick approval,
            and if they decline their own words are used and that is recorded. */}
        {state.step === 5 ? (
          <div className="space-y-8">
            {/* One line of status instead of a stacked alert per state — the
                citizen needs to know whether to wait, not read three paragraphs. */}
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {framing.state === "loading" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Milan is suggesting a clearer wording — you can change or refuse it.
                </>
              ) : framing.state === "failed" ? (
                "Milan could not suggest a wording this time. Your own words will be used — nothing is lost."
              ) : framing.state === "ready" ? (
                <>
                  Milan&apos;s suggestion is on the right. Edit it, or leave the tick below unticked
                  to keep your own words.
                  <span className="font-mono text-[11px] opacity-70">
                    · {framing.provider} {framing.confidence.toFixed(2)}
                  </span>
                </>
              ) : null}
            </p>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="milan-glass space-y-3 rounded-xl p-5">
                <Label htmlFor="original-readonly" className="text-sm font-semibold">
                  Your words
                </Label>
                <Textarea
                  id="original-readonly"
                  rows={12}
                  lang={state.bodyLang}
                  value={state.bodyOriginal}
                  onChange={(e) => set({ bodyOriginal: e.target.value })}
                  className="text-base"
                />
              </section>

              <section className="milan-glass space-y-3 rounded-xl p-5">
                <Label htmlFor="framed" className="text-sm font-semibold milan-gradient-text">
                  Milan&apos;s suggested wording
                </Label>
                <Textarea
                  id="framed"
                  rows={12}
                  lang="en"
                  value={state.framedStatement}
                  placeholder={
                    framing.state === "loading"
                      ? "Suggesting…"
                      : "No suggestion — your own words above will be used."
                  }
                  onChange={(e) => set({ framedStatement: e.target.value })}
                  className="text-base"
                />
              </section>
            </div>

            <section className="milan-glass space-y-3 rounded-xl p-5">
              <Label htmlFor="success" className="text-sm font-semibold">
                What would success look like?
              </Label>
              <Textarea
                id="success"
                rows={4}
                placeholder="How would you know the problem was actually solved?"
                value={state.successCriteria}
                onChange={(e) => set({ successCriteria: e.target.value })}
                className="text-base"
              />
            </section>

            <label
              htmlFor="approve"
              className="milan-glass flex items-start gap-3 rounded-xl border border-border p-4 text-sm"
            >
              <input
                id="approve"
                type="checkbox"
                className="mt-0.5 size-5"
                checked={state.framingApprovedByCitizen}
                disabled={!state.framedStatement.trim()}
                onChange={(e) => set({ framingApprovedByCitizen: e.target.checked })}
              />
              <span>
                I approve Milan&apos;s wording.
                <span className="ms-1 text-xs text-muted-foreground">
                  Leave unticked to keep your own words — either way, your original is kept.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {/* ----------------------------------------------- step 6: the review */}
        {state.step === 6 ? (
          <div className="space-y-5">
            <section className="milan-glass rounded-xl p-4">
              <h2 className="text-sm font-semibold">Your words, exactly as you wrote them</h2>
              <p lang={state.bodyLang} className="mt-2 whitespace-pre-wrap text-base">
                {state.bodyOriginal}
              </p>
            </section>

            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["Language", state.bodyLang === "hi" ? "हिन्दी (Hindi)" : "English"],
                ["District", districtName ?? "—"],
                ["Block", blockName ?? "Not given"],
                [
                  "Location pin",
                  state.lat !== null && state.lng !== null
                    ? `${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}`
                    : "Not given",
                ],
                [
                  "People affected",
                  PEOPLE_BUCKETS.find((b) => b.value === state.peopleAffectedBucket)?.label ?? "—",
                ],
                ["How often", state.recurrence || "—"],
                ["Urgency", `${state.urgencySelfReport} of 5`],
                ["Photos", state.media.length === 0 ? "None" : `${state.media.length} attached`],
              ].map(([label, value]) => (
                <div key={label} className="milan-glass rounded-xl p-3">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <label
              htmlFor="includeReporterName"
              className="flex items-start gap-3 milan-glass rounded-xl p-3 text-sm"
            >
              <input
                id="includeReporterName"
                type="checkbox"
                className="mt-0.5 size-5"
                checked={state.includeReporterName}
                onChange={(e) => set({ includeReporterName: e.target.checked })}
              />
              <span>
                Include my name on this report
                {reporterDisplayName ? (
                  <>
                    {" "}
                    <span className="font-medium">({reporterDisplayName})</span>
                  </>
                ) : null}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Untick this to report anonymously. Either way you are credited as the
                  originator, permanently — your account is never disclosed if you untick it.
                </span>
              </span>
            </label>

            {submitError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </div>

      {attempted && blocker ? (
        <Alert variant="destructive" role="alert" className="mt-4">
          <AlertDescription>{blocker}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-8 flex gap-3">
        {state.step > FIRST_STEP ? (
          <Button type="button" variant="outline" onClick={() => dispatch({ type: "back" })}>
            <ChevronLeft aria-hidden className="size-4" /> Back
          </Button>
        ) : null}

        {state.step < LAST_STEP ? (
          <Button type="button" className="flex-1" onClick={goNext}>
            Continue <ChevronRight aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button type="button" className="flex-1" onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Check aria-hidden className="size-4" /> Submit my report
              </>
            )}
          </Button>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Your answers are saved on this device as you go, so you can close this page and come back.
      </p>
    </div>
  );
}
