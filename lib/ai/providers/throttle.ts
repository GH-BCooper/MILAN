/**
 * Per-provider pacing and cool-off.
 *
 * Both free tiers we run on are tight: Gemini's free quota is a daily request
 * count, and Groq's `on_demand` tier caps tokens per minute at 8,000 — roughly
 * five of our prompts. A batch backfill of 25 challenges walks straight into
 * both, and the first run of `pnpm pipeline:run --all` did exactly that.
 *
 * Two mechanisms, both deliberately invisible to a single live run:
 *
 *  - a minimum interval between calls to the same provider, off by default and
 *    switched on by the batch CLI, so a backfill paces itself instead of
 *    hammering a limit;
 *  - a cool-off after a 429, so the rest of a batch stops paying the round trip
 *    to a provider that has already said no. The chain drops to the next level
 *    immediately instead of spending its timeout budget rediscovering the limit.
 *
 * Neither slows the demo path: on a single challenge nothing is queued and
 * nothing is cooling off.
 */

import { elapsedMs } from "@/lib/clock";

const lastCallAt = new Map<string, number>();
const coolingUntil = new Map<string, number>();

/** `AI_MIN_INTERVAL_MS=8000` paces every provider; the batch CLI sets it. */
function minIntervalMs(provider: string): number {
  const specific = process.env[`${provider.toUpperCase()}_MIN_INTERVAL_MS`];
  const general = process.env.AI_MIN_INTERVAL_MS;
  const raw = specific ?? general;
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * True while this provider is in its post-429 cool-off AND the caller is not
 * willing to wait for it.
 *
 * A live request is never willing to wait: a citizen watching the trace would
 * rather have a rule-tier answer now than a model answer in forty seconds, so
 * the chain drops a level. A batch backfill is the opposite — nobody is
 * watching, and a whole run classified by the gazetteer because the first
 * challenge hit a rate limit is a waste of the run. So when pacing is switched
 * on (which only the batch CLI does), the provider stays "available" and `pace`
 * waits the cool-off out instead.
 *
 * That distinction was not theoretical: the first paced backfill finished eight
 * challenges in 22 seconds because every one after the first 429 skipped Groq
 * entirely and fell to level 2.
 */
export function isCoolingOff(provider: string): boolean {
  const until = coolingUntil.get(provider);
  if (until === undefined) return false;
  if (elapsedMs() >= until) {
    coolingUntil.delete(provider);
    return false;
  }
  return minIntervalMs(provider) === 0;
}

export function secondsUntilWarm(provider: string): number {
  const until = coolingUntil.get(provider) ?? 0;
  return Math.max(0, Math.ceil((until - elapsedMs()) / 1000));
}

/**
 * Record that a provider refused us. `retryAfterSeconds` comes from the
 * response header when the provider sends one; otherwise a conservative
 * default, because guessing low just earns another 429.
 */
export function coolOff(provider: string, retryAfterSeconds?: number | null): void {
  const seconds = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : 60;
  coolingUntil.set(provider, elapsedMs() + seconds * 1000);
}

/** Wait, if pacing is on, until this provider may be called again. */
export async function pace(provider: string): Promise<void> {
  const interval = minIntervalMs(provider);
  if (interval === 0) return;

  const last = lastCallAt.get(provider) ?? 0;
  // Whichever is further away: the minimum gap since our last call, or the end
  // of a cool-off the provider asked for. Honouring a Retry-After we were given
  // is the difference between backing off and being throttled harder.
  const coolUntil = coolingUntil.get(provider) ?? 0;
  const readyAt = Math.max(last + interval, coolUntil);
  const wait = readyAt - elapsedMs();

  if (wait > 0) {
    console.info(`[ai/throttle] waiting ${Math.ceil(wait / 1000)}s for ${provider}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  coolingUntil.delete(provider);
  lastCallAt.set(provider, elapsedMs());
}

/** Parse `Retry-After`, which may be seconds or an HTTP date. */
export function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(raw);
  return Number.isFinite(asDate) ? Math.ceil((asDate - elapsedMs()) / 1000) : null;
}

/** For tests and for the smoke script, which must start from a clean slate. */
export function resetThrottle(): void {
  lastCallAt.clear();
  coolingUntil.clear();
}
