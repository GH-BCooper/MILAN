import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Supabase Storage, behind a small interface.
 *
 * Nothing on the demo path may depend on a third-party API succeeding, so an
 * upload failure is returned, never thrown: the challenge is still created and
 * the photo is simply missing. A citizen who reported a cracked embankment on a
 * bad connection has still reported it.
 */
export const MEDIA_BUCKET = "media";

export interface StoredObject {
  storageKey: string;
  publicUrl: string | null;
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function publicUrlFor(storageKey: string): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  return `${url}/storage/v1/object/public/${MEDIA_BUCKET}/${storageKey}`;
}

export async function putObject(
  storageKey: string,
  bytes: Buffer,
  mime: string,
): Promise<StoredObject | null> {
  const supabase = client();
  if (!supabase) return null;

  try {
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storageKey, bytes, { contentType: mime, upsert: true });

    // "already exists" is success: the key is the content hash, so identical
    // bytes are the same object by definition.
    if (error && !/already exists|duplicate/i.test(error.message)) {
      console.error("[storage] upload failed", { storageKey, message: error.message });
      return null;
    }
    return { storageKey, publicUrl: publicUrlFor(storageKey) };
  } catch (e) {
    console.error("[storage] upload threw", { storageKey, message: (e as Error).message });
    return null;
  }
}

export async function getObject(storageKey: string): Promise<Buffer | null> {
  const supabase = client();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(storageKey);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
