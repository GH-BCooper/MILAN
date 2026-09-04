/**
 * Notifications: the "push, never browse" half of the product claim.
 *
 * A professor never goes looking for a challenge. The notification arrives with
 * a direct action link to the claim page for that specific challenge. No
 * notification in Milan may link to a list page, and `assertPushNotBrowse`
 * enforces that rather than trusting everyone to remember.
 *
 * Three channels behind one interface:
 *   - the in-app row in `notifications`, which is always written;
 *   - email via Resend, if a key is configured;
 *   - SMS and WhatsApp, which are mock inboxes this cut.
 *
 * CLAUDE.md invariant 8: none of it may fail the caller. A challenge that
 * routed correctly but could not send an email has still routed correctly, and
 * the failure is logged rather than thrown.
 */
import "server-only";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export type Channel = "inapp" | "email" | "sms" | "whatsapp";

export interface NotifyInput {
  userId?: string | null;
  orgId?: string | null;
  email?: string | null;
  phone?: string | null;
  kind: string;
  title: string;
  body: string;
  /** Must point at a specific thing to act on, never at a list. */
  actionUrl: string;
  channels?: Channel[];
}

export interface NotifyResult {
  notificationId: string | null;
  delivered: Channel[];
  failed: Array<{ channel: Channel; reason: string }>;
}

/**
 * A notification that lands on a list page is a notification that asks the
 * recipient to go looking, which is the behaviour Milan exists to replace.
 * Thrown, not logged: this is a programming error, not a runtime condition.
 */
const LIST_PATHS = ["/hei/inbox", "/challenges", "/gov", "/admin", "/bounties", "/industry/discover"];

export function assertPushNotBrowse(actionUrl: string): void {
  const path = actionUrl.split("?")[0].replace(/\/+$/, "");
  if (LIST_PATHS.includes(path)) {
    throw new Error(
      `Notification action_url "${actionUrl}" points at a list page. ` +
        `Push, never browse: link to the specific challenge, project or claim page.`,
    );
  }
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  assertPushNotBrowse(input.actionUrl);

  const at = clockNow();
  const channels = input.channels ?? ["inapp", "email"];
  const delivered: Channel[] = [];
  const failed: NotifyResult["failed"] = [];
  let notificationId: string | null = null;

  // The in-app row is the durable record. It is written first and separately,
  // so a mail outage never costs someone the notification itself.
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: input.userId ?? null,
        orgId: input.orgId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        createdAt: at,
      })
      .returning({ id: notifications.id });
    notificationId = row.id;
    delivered.push("inapp");
  } catch (e) {
    failed.push({ channel: "inapp", reason: (e as Error).message });
  }

  for (const channel of channels) {
    if (channel === "inapp") continue;
    try {
      const sent = await send(channel, input);
      if (sent) delivered.push(channel);
      else failed.push({ channel, reason: "not configured" });
    } catch (e) {
      failed.push({ channel, reason: (e as Error).message });
    }
  }

  return { notificationId, delivered, failed };
}

/** Several recipients, one message. Used by S5 to multicast a routed challenge. */
export async function notifyMany(inputs: NotifyInput[]): Promise<NotifyResult[]> {
  const out: NotifyResult[] = [];
  for (const input of inputs) out.push(await notify(input));
  return out;
}

/* ---------------------------------------------------------------- channels */

async function send(channel: Channel, input: NotifyInput): Promise<boolean> {
  switch (channel) {
    case "email":
      return sendEmail(input);
    case "sms":
      return sendSms(input);
    case "whatsapp":
      return sendWhatsApp(input);
    default:
      return false;
  }
}

function absolute(path: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return path.startsWith("http") ? path : `${base}${path}`;
}

/**
 * Resend. Absent a key this returns false rather than throwing, and the caller
 * records "email: not configured" — which is the truth, and better than a
 * pretend success on a slide.
 */
async function sendEmail(input: NotifyInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  if (!key || !from || !input.email) return false;

  const url = absolute(input.actionUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: input.title,
      text: `${input.body}\n\n${url}\n\nMilan — Government of Jharkhand`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`resend HTTP ${response.status}: ${body.slice(0, 160)}`);
  }
  return true;
}

/**
 * The mock SMS inbox.
 *
 * Declared stub: a real gateway needs a DLT-registered sender ID and a template
 * approval, which is a fortnight of paperwork rather than an afternoon of code.
 * The message that would have been sent is logged verbatim and written to the
 * outbox, so /admin can show a judge exactly what the citizen would receive.
 */
async function sendSms(input: NotifyInput): Promise<boolean> {
  if (process.env.SMS_MODE !== "mock" || !input.phone) return false;
  const text = `${input.title}. ${input.body} ${absolute(input.actionUrl)}`.slice(0, 320);
  console.info(`[notify/sms:mock] to=${maskPhone(input.phone)} ${text}`);
  await recordMock("sms", input, text);
  return true;
}

/** The mock WhatsApp path. Same stub, same honesty. */
async function sendWhatsApp(input: NotifyInput): Promise<boolean> {
  if (!input.phone) return false;
  const text = `*${input.title}*\n${input.body}\n${absolute(input.actionUrl)}`;
  console.info(`[notify/whatsapp:mock] to=${maskPhone(input.phone)}`);
  await recordMock("whatsapp", input, text);
  return true;
}

async function recordMock(channel: string, input: NotifyInput, text: string): Promise<void> {
  const { outbox } = await import("@/lib/db/schema");
  await db.insert(outbox).values({
    topic: `notify.${channel}.mock`,
    payload: {
      to: input.phone ?? input.email ?? null,
      kind: input.kind,
      text,
      actionUrl: input.actionUrl,
      note: "Mock channel. No message left this process; this row is what a real gateway would have sent.",
    },
    createdAt: clockNow(),
  });
}

/** Never log a citizen's full number, not even to our own console. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}
