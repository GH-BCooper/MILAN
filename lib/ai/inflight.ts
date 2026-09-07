/**
 * One pipeline run per challenge at a time.
 *
 * The success page POSTs to start a run and then polls the trace endpoint;
 * without this guard, a double-click (or a citizen refreshing mid-run) would
 * start a second pass over the same challenge and spend twice. Module scope
 * is deliberate — the guard lives with the server process, not in a table.
 */
const inflight = new Map<string, Promise<void>>();

/**
 * Starts `run` unless one is already in flight for this challenge.
 * Returns true when this call started the work, false when it was a no-op.
 */
export function runOnce(challengeId: string, run: () => Promise<void>): boolean {
  if (inflight.has(challengeId)) return false;
  const p = run()
    .catch((e) => {
      // A crashed run is logged, never unhandled: the trace page falls back to
      // its cap message and the challenge stays exactly where the crash left it.
      console.error(`[pipeline] background run for ${challengeId} failed`, e);
    })
    .finally(() => {
      inflight.delete(challengeId);
    });
  inflight.set(challengeId, p);
  return true;
}
