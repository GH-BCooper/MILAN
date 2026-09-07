import type { Metadata } from "next";

import { FeatureGrid, PortalShell, StepList } from "../../landing-chrome";

export const metadata: Metadata = {
  title: "Citizen portal",
  description:
    "Report a local problem in Hindi or English, track it with an ID, and confirm the outcome yourself with a verified account.",
};

/* Deliberately the shallowest of the three portals. A person reporting a
   flooded culvert on a ₹6,000 Android phone gets four routes, large targets,
   and no jargon. Depth belongs on the university and industry portals. */
export default function CitizenPortalPage() {
  return (
    <PortalShell
      eyebrow="For citizens · नागरिकों के लिए"
      title="Report it. Track it. Confirm it."
      titleHi="समस्या दर्ज करें, स्थिति देखें, पुष्टि करें"
      lede="Tell us the problem in your own language. A quick, free account with an email and phone verification code keeps every report attached to you. When somebody says it is fixed, you are the one who confirms it — the impact counter moves on your confirmation and nowhere else."
      primary={{ href: "/register", label: "Create an account" }}
      secondary={{ href: "/track", label: "Track with an ID" }}
    >
      <StepList
        heading="What happens to your report"
        steps={[
          {
            title: "You describe it",
            body:
              "Hindi, English or a mix. Add a photo and a location if you can. Your original words are kept and shown beside the English working copy at the same size — never hidden behind a toggle.",
          },
          {
            title: "It is triaged in the open",
            body:
              "If it is a grievance with a known fix, we forward it to CPGRAMS and tell you where it went. If it is an unsolved problem, it becomes a challenge with a hazard linkage and a clock.",
          },
          {
            title: "A university team claims it",
            body:
              "The challenge is pushed to departments whose declared capability matches. Discovery is never luck, and every state has a deadline with an automatic escalation.",
          },
          {
            title: "You confirm the outcome",
            body:
              "When work is claimed complete, you get a verification link. Until you confirm, the outcome renders grey everywhere — including in a company's CSR report.",
          },
        ]}
      />

      <FeatureGrid
        heading="Everything you can do"
        blurb="Reporting and full report detail need a verified account; tracking by ID and the list of challenges stay open to everyone."
        features={[
          {
            href: "/submit",
            title: "Report a problem",
            tag: "Sign in",
            body: "Bilingual form with photo and location. A tracking ID in seconds.",
          },
          {
            href: "/track",
            title: "Track a report",
            tag: "No login",
            body: "Enter your tracking ID to see the current state, who holds it, and the deadline.",
          },
          {
            href: "/challenges",
            title: "Browse challenges",
            body: "Every problem on the platform, on a map and in a list, with district and status.",
          },
          {
            href: "/me",
            title: "My reports",
            tag: "Sign in",
            body: "All of your reports in one place, with your pending confirmations.",
          },
          {
            href: "/stats",
            title: "Public statistics",
            body: "District-level counts, hazard mix, and confirmed impact — all clickable to source.",
          },
          {
            href: "/ledger",
            title: "The credit ledger",
            body: "The append-only, hash-chained record of who contributed what. Verify it yourself.",
          },
        ]}
      />
    </PortalShell>
  );
}
