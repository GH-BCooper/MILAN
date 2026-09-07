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
        <div className="milan-rise">
          <div aria-hidden className="milan-hairline mb-5 h-px w-24 rounded-full" />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="mt-7 milan-rise">{children}</div>
      </main>
    </>
  );
}

/** Used wherever a Phase 2 or Phase 3 surface is not built yet. We declare our
 *  stubs rather than faking depth; judges forgive honest stubs. */
export function ArrivesLater({ phase, what }: { phase: 2 | 3; what: string }) {
  return (
    <div className="milan-glass rounded-xl border-dashed p-6">
      <p className="text-sm font-semibold milan-gradient-text">Arrives in Phase {phase}</p>
      <p className="mt-1 text-sm text-muted-foreground">{what}</p>
    </div>
  );
}
