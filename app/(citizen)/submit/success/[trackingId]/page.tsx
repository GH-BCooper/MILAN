import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { CopyButton } from "@/components/copy-button";
import { PipelineTrace } from "@/components/pipeline-trace";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";
import { challenges } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report received" };

/** What actually happens next, in the citizen's terms. No jargon, no acronyms. */
const NEXT_STEPS = [
  {
    title: "We check it is safe and real",
    body: "If it is a complaint with a known fix, we forward it to CPGRAMS and tell you where it went.",
  },
  {
    title: "We look for others reporting the same thing",
    body: "If your neighbours reported it too, the reports are joined together and everyone is credited.",
  },
  {
    title: "We score it and a district officer checks the serious ones",
    body: "Every part of that score is shown to you, and you can see how it was worked out.",
  },
  {
    title: "We send it to matched university departments",
    body: "They have a fixed time to claim it. If nobody does, it escalates automatically.",
  },
  {
    title: "You confirm whether it was actually fixed",
    body: "Only your confirmation counts as impact. Nobody else can mark your problem solved.",
  },
];

export default async function SubmitSuccessPage({
  params,
}: {
  params: Promise<{ trackingId: string }>;
}) {
  const { trackingId } = await params;
  const decoded = decodeURIComponent(trackingId);

  const [challenge] = await db
    .select({
      trackingId: challenges.trackingId,
      districtCode: challenges.districtCode,
      status: challenges.status,
    })
    .from(challenges)
    .where(eq(challenges.trackingId, decoded))
    .limit(1);

  if (!challenge) notFound();

  const publicPath = `/c/${challenge.trackingId}`;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-800">
          Report received
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Thank you. Write this number down.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground" lang="hi">
          धन्यवाद। यह नंबर लिख लीजिए।
        </p>

        {/* The tracking ID is the citizen's entire relationship with the
            platform. It gets the largest type on the page, and it is selectable. */}
        <div className="mt-6 rounded-lg border-2 border-primary bg-accent p-5 text-center">
          <p className="text-xs uppercase tracking-widest text-accent-foreground">Your tracking ID</p>
          <p className="mt-2 select-all break-all font-mono text-3xl font-bold tracking-tight sm:text-4xl">
            {challenge.trackingId}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <CopyButton value={challenge.trackingId} label="Copy tracking ID" />
            <CopyButton value={publicPath} label="Copy link" absolute />
          </div>
        </div>

        <p className="mt-4 text-sm">
          You can check this report at any time, with no login, at{" "}
          <Link className="font-medium text-primary underline underline-offset-4" href={publicPath}>
            {publicPath}
          </Link>{" "}
          — or by entering the tracking ID on{" "}
          <Link className="font-medium text-primary underline underline-offset-4" href="/track">
            the track page
          </Link>
          .
        </p>

        {/* The trace runs here, on the citizen's own success page. They watch
            their report being triaged, classified, deduplicated, scored and
            routed in about six seconds — and so does a judge. It starts by
            itself only for a report that has not been through the pipeline yet;
            re-opening this page later shows the button instead of re-running. */}
        <PipelineTrace
          trackingId={challenge.trackingId}
          districtCode={challenge.districtCode}
          autoStart={challenge.status === "SUBMITTED"}
          heading="What is happening to your report, right now"
        />

        <section className="mt-10" aria-labelledby="next-heading">
          <h2 id="next-heading" className="text-lg font-semibold">
            What happens next
          </h2>
          <ol className="mt-4 space-y-4">
            {NEXT_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href={publicPath}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            See my report
          </Link>
          <Link
            href="/submit"
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            Report something else
          </Link>
        </div>
      </main>
    </>
  );
}
