"use server";

import { currentUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { bugReportTypeEnum, bugReports } from "@/lib/db/schema";
import { MediaRejectedError, processImage } from "@/lib/media/upload";
import { putObject } from "@/lib/media/storage";
import { z } from "zod";

const BugReportSchema = z.object({
  type: z.enum(bugReportTypeEnum.enumValues),
  issue: z.string().trim().min(10, "Describe the issue in at least 10 characters.").max(4000),
  pageUrl: z.string().trim().max(500).optional(),
});

export type SubmitBugResult = { ok: true } | { ok: false; error: string };

/** Everything a bug report needs: what kind, what happened, and optionally a screenshot. */
export async function submitBugReportAction(formData: FormData): Promise<SubmitBugResult> {
  const parsed = BugReportSchema.safeParse({
    type: formData.get("type"),
    issue: formData.get("issue"),
    pageUrl: formData.get("pageUrl") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That form is not valid." };
  }

  const user = await currentUser();

  let photoKey: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const processed = await processImage(Buffer.from(await file.arrayBuffer()), file.type);
      const stored = await putObject(processed.storageKey, processed.bytes, processed.mime);
      photoKey = stored?.storageKey ?? null;
    } catch (e) {
      if (e instanceof MediaRejectedError) return { ok: false, error: e.message };
      console.error("[report-bug] image processing failed", e);
      // The screenshot is a nice-to-have, not a reason to lose the report.
    }
  }

  await db.insert(bugReports).values({
    reporterId: user?.id ?? null,
    type: parsed.data.type,
    issue: parsed.data.issue,
    pageUrl: parsed.data.pageUrl || null,
    photoKey,
  });

  return { ok: true };
}
