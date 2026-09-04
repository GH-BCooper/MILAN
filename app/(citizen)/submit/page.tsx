import { asc } from "drizzle-orm";

import { SiteHeader } from "@/components/site-header";
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
  const draftId = draft && /^[A-Za-z0-9_-]{6,64}$/.test(draft) ? draft : "current";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <SubmitWizard
          draftId={draftId}
          defaultReporterName={user?.fullName ?? null}
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
