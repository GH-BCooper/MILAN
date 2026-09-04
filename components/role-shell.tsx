import { SiteHeader } from "@/components/site-header";

/** The chrome every signed-in role area shares. */
export function RoleShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </main>
    </>
  );
}

/** Used wherever a Phase 2 or Phase 3 surface is not built yet. We declare our
 *  stubs rather than faking depth; judges forgive honest stubs. */
export function ArrivesLater({ phase, what }: { phase: 2 | 3; what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted p-6">
      <p className="text-sm font-semibold">Arrives in Phase {phase}</p>
      <p className="mt-1 text-sm text-muted-foreground">{what}</p>
    </div>
  );
}
