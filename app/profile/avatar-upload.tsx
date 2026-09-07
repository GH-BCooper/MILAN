"use client";

import { useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { updateProfilePhotoAction } from "./actions";

export function AvatarUpload({ image, initials }: { image: string | null; initials: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(image);
  const [pending, setPending] = useState(false);
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
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
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
