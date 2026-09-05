/**
 * Milan time, in the browser.
 *
 * `clockNow()` reads a server-side offset, so a client component cannot call
 * it. But a countdown that ignored the demo offset would be worse than no
 * countdown: Phase 3's console moves the clock forward thirty days so a judge
 * can watch an SLA breach happen, and a timer still counting real seconds would
 * sit still while every other number on the screen jumped.
 *
 * So the server renders its own `clockNow()` into the page, and this module
 * measures the difference between that and the device's clock once. The result
 * absorbs both the demo offset and whatever the viewer's phone is wrong by.
 *
 * This is the only sanctioned wall-clock read on the client, and it lives here
 * for the same reason the server one lives in `index.ts`: one file to check.
 */

/** Milliseconds between this device's clock and Milan's. */
export function clockSkewMs(serverNowIso: string): number {
  // The rule that forbids a raw clock read exempts lib/clock, which is exactly
  // why both sanctioned reads live here rather than being scattered behind
  // one-off disable comments in components.
  return new Date(serverNowIso).getTime() - Date.now();
}

/** Milan-now in the browser, given the server timestamp rendered into the page. */
export function browserClockNowMs(skewMs: number): number {
  return Date.now() + skewMs;
}
