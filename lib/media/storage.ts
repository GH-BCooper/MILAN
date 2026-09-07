import "server-only";

import { createClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

/**
 * Object storage behind a small interface.
 *
 * Nothing on the demo path may depend on a third-party API succeeding, so an
 * upload failure is returned, never thrown: the challenge is still created and
 * the photo is simply missing. A citizen who reported a cracked embankment on a
 * bad connection has still reported it.
 *
 * Two backends, selected by what env is present (see `backend()`):
 *   - Supabase Storage (online) when NEXT_PUBLIC_SUPABASE_URL + service key set.
 *   - S3 / MinIO (offline) when S3_ENDPOINT + credentials set. MinIO runs in
 *     docker-compose with the `media` bucket set to anonymous download, so the
 *     offline demo can actually store and serve a citizen photo with the wifi off
 *     — turning the "photo upload silently fails" stub into a demonstrable truth.
 */
export const MEDIA_BUCKET = "media";

export interface StoredObject {
  storageKey: string;
  publicUrl: string | null;
}

/* ---------------------------------------------------------- backend select */

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function s3Client(): S3Client | null {
  const endpoint = process.env.S3_ENDPOINT;
  const key = process.env.S3_ACCESS_KEY;
  const secret = process.env.S3_SECRET_KEY;
  if (!endpoint || !key || !secret) return null;
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: true, // required for MinIO and most on-prem S3
  });
}

function s3Bucket(): string {
  return process.env.S3_BUCKET ?? MEDIA_BUCKET;
}

function backend(): "supabase" | "s3" | null {
  if (supabaseClient()) return "supabase";
  if (s3Client()) return "s3";
  return null;
}

/* --------------------------------------------------------------- public url */

export function publicUrlFor(storageKey: string): string | null {
  const supabase = supabaseClient();
  if (supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return `${url}/storage/v1/object/public/${MEDIA_BUCKET}/${storageKey}`;
  }
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) {
    const bucket = s3Bucket();
    const base =
      process.env.S3_PUBLIC_URL?.replace(/\/+$/, "") ?? `${endpoint.replace(/\/+$/, "")}/${bucket}`;
    return `${base}/${storageKey}`;
  }
  return null;
}

/* ----------------------------------------------------------------- put/get */

export async function putObject(
  storageKey: string,
  bytes: Buffer,
  mime: string,
): Promise<StoredObject | null> {
  const supabase = supabaseClient();
  if (supabase) {
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

  const s3 = s3Client();
  if (s3) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket(),
          Key: storageKey,
          Body: bytes,
          ContentType: mime,
        }),
      );
      return { storageKey, publicUrl: publicUrlFor(storageKey) };
    } catch (e) {
      console.error("[storage] s3 upload failed", { storageKey, message: (e as Error).message });
      return null;
    }
  }

  return null;
}

export async function getObject(storageKey: string): Promise<Buffer | null> {
  const supabase = supabaseClient();
  if (supabase) {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(storageKey);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  const s3 = s3Client();
  if (s3) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: s3Bucket(), Key: storageKey }));
      const body = res.Body as unknown as Readable | null;
      if (!body) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    } catch (e) {
      console.error("[storage] s3 download failed", { storageKey, message: (e as Error).message });
      return null;
    }
  }

  return null;
}

/**
 * Delete objects. Used by S1 when a report is rejected as unsafe: the media is
 * purged, not merely unlinked, because "we kept a copy of the thing we refused
 * to publish" is not a defensible answer.
 *
 * Returns the keys it removed. A storage outage is reported, never thrown --
 * the rejection itself must still complete.
 */
export async function removeObjects(storageKeys: string[]): Promise<string[]> {
  if (storageKeys.length === 0) return [];
  const supabase = supabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).remove(storageKeys);
      if (error) {
        console.error("[storage] purge failed", { keys: storageKeys.length, message: error.message });
        return [];
      }
      return (data ?? []).map((o) => o.name);
    } catch (e) {
      console.error("[storage] purge threw", { message: (e as Error).message });
      return [];
    }
  }

  const s3 = s3Client();
  if (s3) {
    try {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: s3Bucket(),
          Delete: { Objects: storageKeys.map((Key) => ({ Key })) },
        }),
      );
      return storageKeys;
    } catch (e) {
      console.error("[storage] s3 purge failed", { keys: storageKeys.length, message: (e as Error).message });
      return [];
    }
  }

  return [];
}
