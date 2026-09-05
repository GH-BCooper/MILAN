"use client";

/**
 * One ledger entry, with its payload and a hash calculator underneath.
 *
 * The expander is not decoration. The argument Milan makes is "you do not have
 * to trust us" — and that is only true if a person holding a file can compute
 * its SHA-256 in their own browser and compare it, byte for byte, with what the
 * ledger says. So the panel does exactly that, using the browser's own
 * SubtleCrypto, with no upload: the file never leaves the machine.
 */
import { useState } from "react";

export interface EntryView {
  seq: number;
  kind: string;
  trackingId: string | null;
  author: string | null;
  contentHash: string;
  prevHash: string | null;
  entryHash: string | null;
  createdAt: string;
  payload: unknown;
}

function short(h: string | null): string {
  return h ? `${h.slice(0, 8)}…${h.slice(-4)}` : "—";
}

export function LedgerEntryRow({ entry }: { entry: EntryView }) {
  const [open, setOpen] = useState(false);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function hashFile(file: File) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    setFileHash(
      Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
    setFileName(file.name);
  }

  return (
    <li className="border-b border-border/60">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-2 py-3 text-left hover:bg-muted"
      >
        <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">#{entry.seq}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold">{entry.kind}</span>
        <span className="min-w-0 flex-1 text-sm">
          {entry.trackingId ?? <span className="text-muted-foreground">no challenge</span>}
          {entry.author ? <span className="text-muted-foreground"> · {entry.author}</span> : null}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{short(entry.entryHash)}</span>
        <span className="text-xs text-muted-foreground">{entry.createdAt.slice(0, 16).replace("T", " ")}</span>
      </button>

      {open ? (
        <div className="space-y-3 bg-muted/50 px-2 pb-4 pt-1">
          <dl className="grid gap-1 text-xs sm:grid-cols-3">
            <div className="sm:col-span-3">
              <dt className="font-semibold">content_hash</dt>
              <dd className="break-all font-mono">{entry.contentHash}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="font-semibold">prev_hash</dt>
              <dd className="break-all font-mono">{entry.prevHash ?? "genesis"}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="font-semibold">entry_hash</dt>
              <dd className="break-all font-mono">{entry.entryHash ?? "not linked"}</dd>
            </div>
          </dl>

          <div>
            <p className="text-xs font-semibold">payload</p>
            <pre className="mt-1 max-h-64 overflow-auto rounded border border-border bg-background p-2 text-[11px]">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </div>

          <div className="rounded border border-border bg-background p-3">
            <p className="text-xs font-semibold">Hold the file? Check it yourself.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your browser computes the SHA-256 locally. Nothing is uploaded. If the result matches the
              content hash above, you are holding the same bytes this entry commits to.
            </p>
            <input
              type="file"
              className="mt-2 block w-full text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void hashFile(f);
              }}
            />
            {fileHash ? (
              <p className={`mt-2 break-all font-mono text-xs ${fileHash === entry.contentHash ? "text-emerald-700" : "text-red-700"}`}>
                {fileName}: {fileHash}
                <span className="block font-sans font-semibold">
                  {fileHash === entry.contentHash ? "Match — this is the file this entry commits to." : "No match against this entry's content hash."}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
