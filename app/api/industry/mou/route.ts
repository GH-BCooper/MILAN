/**
 * The MoU document.
 *
 * Task 3.7 step 4 is explicit: generate the document, do not implement signing.
 * So this renders a real PDF from a template and hashes it into the ledger.
 * That is a smaller thing than an e-signature flow and a more useful one — the
 * dispute an MoU actually produces is "that is not the version we agreed", and a
 * hash on an append-only chain settles it. Signing is a declared stub and the
 * document says so on its own face.
 */
import { eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { challenges, industryInterests, organization, projects, userProfiles } from "@/lib/db/schema";
import { appendEntry } from "@/lib/ledger/append";
import { sha256Hex } from "@/lib/ledger/hash";
import { renderPdf, type PdfLine } from "@/lib/pdf/simple";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireUser();
  const interestId = new URL(request.url).searchParams.get("interest");
  if (!interestId) return new Response("Missing interest id.", { status: 400 });

  const [row] = await db
    .select({
      id: industryInterests.id,
      state: industryInterests.state,
      message: industryInterests.message,
      challengeId: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      firm: organization.name,
      projectId: projects.id,
      projectTitle: projects.title,
      leadName: userProfiles.fullName,
    })
    .from(industryInterests)
    .innerJoin(challenges, eq(challenges.id, industryInterests.challengeId))
    .innerJoin(organization, eq(organization.id, industryInterests.orgId))
    .leftJoin(projects, eq(projects.challengeId, challenges.id))
    .leftJoin(userProfiles, eq(userProfiles.userId, projects.leadUserId))
    .where(eq(industryInterests.id, interestId))
    .limit(1);

  if (!row) return new Response("No such expression of interest.", { status: 404 });

  const at = clockNow();
  const lines: PdfLine[] = [
    { text: "Memorandum of Understanding", size: 18, bold: true },
    { text: "Milan - Government of Jharkhand - Disaster risk reduction", size: 10, spaceBefore: 4 },
    { text: `Reference: ${row.trackingId} / EOI ${row.id}`, size: 9, spaceBefore: 8 },
    { text: `Drafted ${at.toISOString().slice(0, 19).replace("T", " ")} UTC`, size: 9 },

    { text: "1. Parties", size: 13, bold: true, spaceBefore: 16 },
    { text: `The funding partner: ${row.firm}.`, size: 10 },
    { text: `The research team: ${row.projectTitle ?? "to be confirmed"}${row.leadName ? `, led by ${row.leadName}` : ""}.`, size: 10 },
    { text: "The originating citizen, named on the public credit chain at the URL below, is not a party to this memorandum and their credit is not transferable by it.", size: 10 },

    { text: "2. The challenge", size: 13, bold: true, spaceBefore: 14 },
    { text: `${row.trackingId}: ${row.title}`, size: 10 },

    { text: "3. What the funding partner proposed", size: 13, bold: true, spaceBefore: 14 },
    { text: row.message ?? "Not stated.", size: 10 },

    { text: "4. Credit", size: 13, bold: true, spaceBefore: 14 },
    {
      text:
        "On acceptance a FUNDER edge is written to Milan's append-only credit ledger. Neither party may " +
        "remove the other, nor the originating citizen, from that chain. Publication of the work is " +
        "governed by the licence the team chose on each artifact; the title, the problem and the " +
        "abstract of every artifact remain public regardless of licence.",
      size: 10,
    },

    { text: "5. What this document is not", size: 13, bold: true, spaceBefore: 14 },
    {
      text:
        "This is a generated draft. It is not executed, it carries no signature, and it transfers no " +
        "money. E-signature, payment rails and negotiation are declared stubs in this release of Milan. " +
        "What this document does carry is a SHA-256 hash written into an append-only ledger at the " +
        "moment of generation, so that the version the parties discussed cannot later be disputed.",
      size: 10,
    },

    { text: "6. Verification", size: 13, bold: true, spaceBefore: 14 },
    { text: `Public record: ${(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/c/${row.trackingId}`, size: 10 },
  ];

  const pdf = renderPdf(lines, "MoU");
  const hash = sha256Hex(pdf);

  await db.transaction(async (tx) => {
    await appendEntry(tx, {
      challengeId: row.challengeId,
      projectId: row.projectId,
      kind: "PROPOSAL",
      authorId: user.id,
      at,
      contentHash: hash,
      payload: {
        event: "MOU_GENERATED",
        interestId: row.id,
        trackingId: row.trackingId,
        firm: row.firm,
        contentHash: hash,
        generatedBy: user.fullName,
        at: at.toISOString(),
        note: "A generated draft, unsigned. E-signature and payment rails are declared stubs; the hash is what settles a version dispute.",
      },
    });
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="milan-mou-${row.trackingId}.pdf"`,
      "x-milan-content-hash": hash,
    },
  });
}
