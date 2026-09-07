"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { MediaRejectedError, processImage } from "@/lib/media/upload";
import { putObject } from "@/lib/media/storage";

export type UpdatePhotoResult = { ok: true; url: string } | { ok: false; error: string };

/** Re-uses the same EXIF-stripping, content-hashed pipeline as citizen evidence
 *  photos (lib/media/upload.ts) — a profile photo carries the same GPS risk. */
export async function updateProfilePhotoAction(formData: FormData): Promise<UpdatePhotoResult> {
  const me = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }

  try {
    const processed = await processImage(Buffer.from(await file.arrayBuffer()), file.type);
    const stored = await putObject(processed.storageKey, processed.bytes, processed.mime);
    if (!stored?.publicUrl) {
      return { ok: false, error: "The photo could not be stored right now. Try again in a moment." };
    }

    await db.update(userTable).set({ image: stored.publicUrl }).where(eq(userTable.id, me.id));
    revalidatePath("/profile");
    return { ok: true, url: stored.publicUrl };
  } catch (e) {
    if (e instanceof MediaRejectedError) return { ok: false, error: e.message };
    console.error("[profile] photo upload failed", e);
    return { ok: false, error: "That photo could not be processed." };
  }
}
