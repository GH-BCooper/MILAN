"use client";

/**
 * The button a judge presses.
 *
 * It calls /api/ledger/verify, which walks the chain from genesis and recomputes
 * every hash. Green means no entry has been altered or removed since it was
 * written. Red names the sequence number where the chain first disagrees with
 * itself, which is the useful half — "something is wrong" is not evidence,
 * "entry 412 does not hash to what entry 413 says it does" is.
 */
import { useState } from "react";

interface Result {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string | null;
  headSeq: number;
  sealedLegacy: number;
  head: { seq: number; entryHash: string | null; count: number };
  anchor: { seq: number; at: string; receipt: { provider: string; status: string; detail: string } | null } | null;
}

export function VerifyChainButton() {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setError(null);
    try {
      const response = await fetch("/api/ledger/verify", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult((await response.json()) as Result);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("done");
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={state === "running"}
          className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {state === "running" ? "Walking the chain…" : "Verify chain"}
        </button>
        <p className="text-xs text-muted-foreground">
          Recomputes every hash from the first entry. Nothing is written; you can press it as often as
          you like.
        </p>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="status">
          The verifier could not be reached: {error}
        </p>
      ) : null}

      {result ? (
        <div
          role="status"
          className={`mt-3 rounded-md border p-4 ${result.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}
        >
          <p className={`text-base font-bold ${result.ok ? "text-emerald-900" : "text-red-900"}`}>
            {result.ok ? "Chain intact" : `Chain broken at entry ${result.brokenAtSeq}`}
          </p>
          <p className={`mt-1 text-sm ${result.ok ? "text-emerald-900" : "text-red-900"}`}>
            {result.ok
              ? `${result.checked} entries checked, from genesis to entry ${result.headSeq}. Every prev_hash matches the entry before it and every entry_hash matches its own fields.`
              : result.reason}
          </p>
          <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">Head hash: </dt>
              <dd className="inline break-all font-mono">{result.headHash ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Entries: </dt>
              <dd className="inline tabular-nums">{result.head.count}</dd>
            </div>
            {result.sealedLegacy > 0 ? (
              <div className="sm:col-span-2">
                <dt className="inline font-semibold">Covered by the legacy seal: </dt>
                <dd className="inline">
                  {result.sealedLegacy} entries written before Phase 3, whose payload hashes are recorded
                  inside the chain itself rather than recomputable from their own content_hash.
                </dd>
              </div>
            ) : null}
            {result.anchor ? (
              <div className="sm:col-span-2">
                <dt className="inline font-semibold">Last anchor: </dt>
                <dd className="inline">
                  entry {result.anchor.seq} at {result.anchor.at.slice(0, 16).replace("T", " ")} UTC —{" "}
                  {result.anchor.receipt?.status === "anchored" || result.anchor.receipt?.status === "pending"
                    ? `submitted to ${result.anchor.receipt.provider}`
                    : "no third-party timestamp (local provider)"}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
