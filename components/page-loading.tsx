import { Loader2 } from "lucide-react";

/** The Suspense/loading.tsx fallback for every route. Replaces the empty
 *  rectangle a page used to show while its data fetched with a visible spinner
 *  so a slow query never reads as a broken page. */
export function PageLoading() {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <Loader2 className="size-8 animate-spin" aria-hidden />
      <p className="text-sm">Loading…</p>
    </div>
  );
}
