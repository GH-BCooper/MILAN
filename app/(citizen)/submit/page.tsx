import { asc } from "drizzle-orm";
import { currentUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { blocks, districts } from "@/lib/db/schema";
import { SubmitWizard } from "./submit-wizard";

export const metadata = { title: "Report a problem" };
export const dynamic = "force-dynamic";

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const [{ draft }, user, districtRows, blockRows] = await Promise.all([
    searchParams,
    currentUser(),
    db
      .select({ code: districts.code, name: districts.name, nameHi: districts.nameHi, lat: districts.lat, lng: districts.lng })
      .from(districts)
      .orderBy(asc(districts.name)),
    db
      .select({
        code: blocks.code,
        name: blocks.name,
        nameHi: blocks.nameHi,
        lat: blocks.lat,
        lng: blocks.lng,
        districtCode: blocks.districtCode,
      })
      .from(blocks)
      .orderBy(asc(blocks.name)),
  ]);

  // One draft per browser tab unless the citizen returns to a specific draft.
  // The id only ever names a localStorage key; it is never sent to the server.
  // Scoped by user id so a draft left behind by one account (their name, their
  // chosen language, their half-written report) never bleeds into another
  // account signed in later on the same shared/library device.
  // Signed out, every draft on the device shares the one "anon" key: there is no
  // account to scope it to, and a report in progress must survive a refresh.
  const draftId = draft && /^[A-Za-z0-9_-]{6,64}$/.test(draft) ? draft : `current-${user?.id ?? "anon"}`;

  return (
    <>
      {/* Wide enough for step 5's two-column wording review to breathe; the
          wizard itself narrows back to a centred column for every other step
          (see submit-wizard.tsx) so nothing else on the page gets wider by
          accident. */}
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <SubmitWizard
          draftId={draftId}
          reporterDisplayName={user?.fullName ?? null}
          districts={districtRows.map((d) => ({
            code: d.code,
            name: d.name,
            nameHi: d.nameHi,
            lat: d.lat === null ? null : Number(d.lat),
            lng: d.lng === null ? null : Number(d.lng),
          }))}
          blocks={blockRows.map((b) => ({
            code: b.code,
            name: b.name,
            nameHi: b.nameHi,
            districtCode: b.districtCode,
            lat: b.lat === null ? null : Number(b.lat),
            lng: b.lng === null ? null : Number(b.lng),
          }))}
        />
      </main>
    </>
  );
}
