import { SiteHeader } from "@/components/site-header";
import { BugForm } from "./bug-form";

export const metadata = { title: "Report a bug" };

export default function ReportBugPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <div className="milan-hairline mb-5 h-px w-24 rounded-full" />
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Report a bug</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Something broken in the platform itself — not a civic problem. This goes straight to the
          admin bug queue, not the routing pipeline.
        </p>
        <div className="mt-7">
          <BugForm />
        </div>
      </main>
    </>
  );
}
