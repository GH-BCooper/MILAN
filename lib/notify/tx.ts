/**
 * A notification written inside the caller's transaction.
 *
 * `notify()` in this directory opens its own connection, which is right for a
 * request handler: an email that fails must not roll back a decision an officer
 * has made. The reaper is the other case. PHASE_3_BUILD.md Task 3.2 requires the
 * action, the `fired_at` stamp, the ledger entry, the notifications and the
 * outbox event to be one transaction, so that a crash halfway leaves a deadline
 * that will simply fire again — idempotent by construction.
 *
 * So the durable half (the in-app row, and the verbatim text a mock SMS or
 * WhatsApp gateway would have sent) is written here on `tx`. The out-of-process
 * half (a real email) is returned as an intent for the caller to send after
 * commit, where a failure costs nothing.
 */
import "server-only";

import { clockNow } from "@/lib/clock";
import type { Tx } from "@/lib/db";
import { notifications, outbox } from "@/lib/db/schema";
import { assertPushNotBrowse, type Channel, type NotifyInput } from "./index";

export interface PendingSend {
  email?: string | null;
  title: string;
  body: string;
  actionUrl: string;
}

function absolute(path: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return path.startsWith("http") ? path : `${base}${path}`;
}

export async function notifyInTx(tx: Tx, input: NotifyInput): Promise<PendingSend | null> {
  assertPushNotBrowse(input.actionUrl);
  const at = clockNow();
  const channels: Channel[] = input.channels ?? ["inapp", "email"];

  await tx.insert(notifications).values({
    userId: input.userId ?? null,
    orgId: input.orgId ?? null,
    kind: input.kind,
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    createdAt: at,
  });

  // The mock channels are recorded verbatim, so /demo can show a judge exactly
  // what the citizen's phone would have shown, without a phone.
  for (const channel of channels) {
    if (channel !== "sms" && channel !== "whatsapp") continue;
    if (!input.phone) continue;
    const text =
      channel === "sms"
        ? `${input.title}. ${input.body} ${absolute(input.actionUrl)}`.slice(0, 320)
        : `*${input.title}*\n${input.body}\n${absolute(input.actionUrl)}`;
    await tx.insert(outbox).values({
      topic: `notify.${channel}.mock`,
      payload: {
        to: input.phone,
        kind: input.kind,
        text,
        actionUrl: input.actionUrl,
        note: "Mock channel. No message left this process; this row is what a real gateway would have sent.",
      },
      createdAt: at,
    });
  }

  if (channels.includes("email") && input.email) {
    await tx.insert(outbox).values({
      topic: "notify.email",
      payload: { to: input.email, kind: input.kind, title: input.title, body: input.body, actionUrl: input.actionUrl },
      createdAt: at,
    });
    return { email: input.email, title: input.title, body: input.body, actionUrl: input.actionUrl };
  }
  return null;
}
