import type { Metadata } from "next";

import { FeatureGrid, PortalShell, StepList } from "../../landing-chrome";

export const metadata: Metadata = {
  title: "University portal",
  description:
    "Claim routed, verified civic challenges as real final-year projects, with capability matching, an SLA clock and an unerasable credit ledger.",
};

export default function UniversityPortalPage() {
  return (
    <PortalShell
      eyebrow="For universities & HEIs · विश्वविद्यालयों के लिए"
      title="Real problems, not invented ones."
      titleHi="असली समस्याएँ, बनावटी परियोजनाएँ नहीं"
      lede="Around 200,000 Indian students invent a fake final-year project every year because no real one was routed to them. Milan routes verified, citizen-reported, hazard-linked problems to the department whose declared capability actually matches — with a deadline, a supervisor, and a credit record nobody can erase."
      primary={{ href: "/hei", label: "Open the HEI dashboard" }}
      secondary={{ href: "/hei/inbox", label: "See the routed inbox" }}
    >
      <StepList
        heading="How a challenge reaches your lab"
        steps={[
          {
            title: "Declare your capability",
            body:
              "Departments, equipment, methods and supervisors. This is the vector the router matches against — an unfilled capability profile means an empty inbox, by design.",
          },
          {
            title: "The router pushes, you do not hunt",
            body:
              "Priority is computed by plain TypeScript from severity, corroborations, hazard linkage, district vulnerability and staleness. The top three contributing terms are shown as the routing reason.",
          },
          {
            title: "Claim it against a clock",
            body:
              "A claim opens an SLA deadline with an escalation ladder. Nothing can sit unowned and nothing can silently die — the reaper runs every five minutes.",
          },
          {
            title: "Ship artifacts, keep the credit",
            body:
              "Every upload is stored by its SHA-256 content hash and appended to the ledger with prev_hash and author. We do not stop you sharing your work — we make it impossible to erase who did it.",
          },
        ]}
      />

      <FeatureGrid
        heading="Your dashboard"
        blurb="Signed in as an HEI member. Role is checked in middleware and rechecked server-side in every handler."
        features={[
          {
            href: "/hei",
            title: "Institution overview",
            tag: "Dashboard",
            body: "Active claims, deadlines at risk, team load and confirmed outcomes to date.",
          },
          {
            href: "/hei/inbox",
            title: "Routed inbox",
            tag: "Matched",
            body: "Challenges pushed to your capability profile, each with its priority breakdown.",
          },
          {
            href: "/hei/capability",
            title: "Capability profile",
            body: "Declare departments, methods and equipment. This drives everything you are sent.",
          },
          {
            href: "/hei/challenge-bank",
            title: "Challenge bank",
            body: "The full open bank, filterable by hazard, district and difficulty, for course planning.",
          },
          {
            href: "/hei/projects/1",
            title: "Project workspace",
            body: "Milestones, artifact uploads, supervisor sign-off and the live SLA countdown.",
          },
          {
            href: "/ledger",
            title: "Credit ledger",
            body: "Your team's append-only contribution chain, verifiable by anyone, forever.",
          },
          {
            href: "/bounties",
            title: "Bounties",
            body: "Industry-funded challenges where a solved problem also carries a stipend.",
          },
          {
            href: "/challenges",
            title: "Public challenge map",
            body: "Everything on the platform with its district, hazard linkage and current holder.",
          },
          {
            href: "/register",
            title: "Register an institution",
            tag: "New",
            body: "Create an HEI organisation and invite supervisors and student teams.",
          },
        ]}
      />
    </PortalShell>
  );
}
