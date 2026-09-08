import type { Metadata } from "next";

import { FeatureGrid, PortalShell, StepList } from "../../landing-chrome";

export const metadata: Metadata = {
  title: "Industry portal",
  description:
    "Discover verified civic demand by district, fund bounties, and export a CSR report where every claimed outcome is citizen-confirmed or visibly grey.",
};

export default function IndustryPortalPage() {
  return (
    <PortalShell
      eyebrow="For industry & CSR · उद्योग के लिए"
      title="CSR against verified demand."
      titleHi="सत्यापित ज़रूरत पर सीएसआर व्यय"
      lede="Every challenge here was reported by a named citizen, corroborated, and scored by deterministic code you can read. Fund the ones that match your mandate, follow the work through to an outcome, and export a report in which an unconfirmed claim is never allowed to look confirmed."
      primary={{ href: "/industry/discover", label: "Discover challenges" }}
      secondary={{ href: "/industry/csr", label: "See a CSR export" }}
    >
      <StepList
        heading="From discovery to a defensible report"
        steps={[
          {
            title: "Filter to your mandate",
            body:
              "By district, domain, priority band, state and corroboration count. Every filter maps to a column you can inspect — no opaque relevance ranking.",
          },
          {
            title: "Register interest",
            body:
              "Interest opens a threaded conversation with the district and the claiming institution, and puts an SLA clock on the response. Nobody can leave you waiting silently.",
          },
          {
            title: "Fund a bounty",
            body:
              "Attach a stipend to a specific challenge. The bounty is public, so a student team can see the money exists before deciding to claim.",
          },
          {
            title: "Export CSR evidence",
            body:
              "The export carries confirmed and unconfirmed outcomes side by side, unconfirmed rendered grey. The impact counter only ever moves on a citizen confirmation.",
          },
        ]}
      />

      <FeatureGrid
        heading="Your dashboard"
        blurb="Signed in as an industry partner."
        features={[
          {
            href: "/industry/discover",
            title: "Discovery",
            tag: "Dashboard",
            body: "Filter verified challenges by district, domain, priority band and corroborations.",
          },
          {
            href: "/industry/csr",
            title: "CSR portfolio & export",
            tag: "Export",
            body: "Spend, funded challenges and outcomes — confirmed in colour, unconfirmed in grey.",
          },
          {
            href: "/bounties",
            title: "Bounty board",
            body: "Every funded challenge on the platform, with its funder and its current claimant.",
          },
          {
            href: "/industry/interests/1",
            title: "Interest threads",
            body: "Your registered interests and the district's responses, each under an SLA clock.",
          },
          {
            href: "/stats",
            title: "State statistics",
            body: "District coverage, domain mix and confirmed impact for board-level reporting.",
          },
          {
            href: "/ledger",
            title: "Provenance ledger",
            body: "Hash-chained proof of who did the work you funded. Independently verifiable.",
          },
          {
            href: "/challenges",
            title: "Public challenge map",
            body: "The whole pipeline in the open, before you commit a rupee.",
          },
          {
            href: "/register",
            title: "Register a firm",
            tag: "New",
            body: "Create an industry organisation and add CSR team members.",
          },
        ]}
      />
    </PortalShell>
  );
}
