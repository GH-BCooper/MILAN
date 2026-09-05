import "server-only";

import type { PendingSend } from "@/lib/notify/tx";

/**
 * Email, sent after the transaction committed.
 *
 * Invariant 8: nothing on the demo path may depend on a live third-party API
 * succeeding. No key, or a Resend outage, means the in-app notification and the
 * outbox row (already committed) stand on their own and this is a no-op.
 */
export async function deliverAfterCommit(sends: PendingSend[]): Promise<number> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  if (!key || !from) return 0;

  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  let sent = 0;
  for (const s of sends) {
    if (!s.email) continue;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [s.email],
          subject: s.title,
          text: `${s.body}\n\n${s.actionUrl.startsWith("http") ? s.actionUrl : base + s.actionUrl}\n\nMilan — Government of Jharkhand`,
        }),
      });
      if (res.ok) sent++;
    } catch {
      // Logged by the caller's result, never thrown at the reaper.
    }
  }
  return sent;
}
