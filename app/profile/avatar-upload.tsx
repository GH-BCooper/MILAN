"use client";

import { useRef, useState } from "react";
import { Loader2, Pencil, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { removeProfilePhotoAction, updateProfilePhotoAction } from "./actions";

export function AvatarUpload({ image, initials }: { image: string | null; initials: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(image);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    const result = await updateProfilePhotoAction(formData);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUrl(result.url);
    // Let the same input fire onChange again for a re-upload of the same file.
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onRemove() {
    setRemoving(true);
    setError(null);
    const previous = url;
    setUrl(null); // optimistic: revert to the initials placeholder immediately
    const result = await removeProfilePhotoAction();
    setRemoving(false);
    if (!result.ok) {
      setUrl(previous);
      setError(result.error);
    }
  }

  return (
    <div>
      <div className="relative inline-block">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending || removing}
          className="group relative block size-16 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Change profile photo"
        >
          <Avatar className="size-16">
            {url ? <AvatarImage src={url} alt="" /> : null}
            <AvatarFallback>{initials || "?"}</AvatarFallback>
          </Avatar>
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
            {pending ? <Loader2 className="size-5 animate-spin" /> : <Pencil className="size-5" />}
          </span>
        </button>
        {url ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={pending || removing}
            aria-label="Remove profile photo"
            title="Remove photo"
            className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
          >
            {removing ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onChange}
      />
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
