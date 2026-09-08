"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { user as userTable, userProfiles } from "@/lib/db/schema";
import { MediaRejectedError, processImage } from "@/lib/media/upload";
import { MEDIA_BUCKET, putObject, removeObjects } from "@/lib/media/storage";

export type UpdatePhotoResult = { ok: true; url: string } | { ok: false; error: string };

/** The `image` column holds a public URL, not a bare storage key (see putObject
 *  below), so removal needs to recover the key to purge the now-orphaned
 *  object. Best-effort only: if the URL shape doesn't match (a custom
 *  S3_PUBLIC_URL with a non-default bucket name, say) we skip the storage
 *  purge rather than fail the removal — the DB reference clearing is the part
 *  that must not fail. */
function storageKeyFromPublicUrl(url: string): string | null {
  const marker = `/${MEDIA_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length) || null;
}

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

export type RemovePhotoResult = { ok: true } | { ok: false; error: string };

/** Clears the avatar back to the initials placeholder. The DB write is the
 *  correctness-critical part (invariant: no dangling reference to a photo the
 *  citizen asked removed); the storage purge is best-effort cleanup and never
 *  blocks the DB clear. */
export async function removeProfilePhotoAction(): Promise<RemovePhotoResult> {
  const me = await requireUser();

  const [row] = await db
    .select({ image: userTable.image })
    .from(userTable)
    .where(eq(userTable.id, me.id))
    .limit(1);

  try {
    await db.update(userTable).set({ image: null }).where(eq(userTable.id, me.id));
  } catch (e) {
    console.error("[profile] photo removal failed", e);
    return { ok: false, error: "Could not remove your photo. Try again in a moment." };
  }

  if (row?.image) {
    const key = storageKeyFromPublicUrl(row.image);
    if (key) {
      await removeObjects([key]).catch((e) => console.error("[profile] orphaned photo purge failed", e));
    }
  }

  revalidatePath("/profile");
  return { ok: true };
}

export type DeleteAccountResult = { error: string };

/**
 * Deletes everything Milan holds about the account: the login (`user`, which
 * cascades to `session`, `account`, `member` and `user_profiles`).
 *
 * Invariant 2 makes this a genuine hard delete only for an account with no
 * permanent footprint. `ledger_entries.author_id` and similar FKs (challenges
 * reported, credit edges) have no cascade on purpose — the ledger is
 * append-only and a contribution cannot be erased by the person who made it.
 * When that FK stops the delete, we fall back to anonymising the login
 * instead of silently doing nothing: the account can no longer sign in and
 * carries no personal data, while the historical record it is attached to
 * survives, exactly as invariant 2 and invariant 9 require.
 */
export async function deleteAccountAction(): Promise<DeleteAccountResult> {
  const me = await requireUser();

  try {
    await db.delete(userTable).where(eq(userTable.id, me.id));
  } catch (e) {
    const code = (e as { cause?: { code?: string }; code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    if (code !== "23503") {
      console.error("[profile] account deletion failed", e);
      return { error: "Something went wrong deleting your account. Please try again." };
    }
    // Foreign-key restrained: this account has a permanent footprint
    // (a ledger entry, a reported challenge, a credit edge). Anonymise
    // instead of deleting outright.
    await db
      .update(userProfiles)
      .set({ fullName: "Deleted account", phone: null, orgId: null, orgProofMeta: null, orgProofDocumentKey: null })
      .where(eq(userProfiles.userId, me.id));
    await db
      .update(userTable)
      .set({ name: "Deleted account", email: `deleted-${me.id}@milan.invalid`, image: null })
      .where(eq(userTable.id, me.id));
    await auth.api.revokeSessions({ headers: await headers() }).catch(() => {});
    await auth.api.signOut({ headers: await headers() }).catch(() => {});
    redirect("/");
  }

  await auth.api.signOut({ headers: await headers() }).catch(() => {});
  redirect("/");
}
