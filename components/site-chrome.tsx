import { headers } from "next/headers";

import { LandingHeader } from "@/app/(landing)/landing-chrome";
import { SiteHeader } from "@/components/site-header";

/**
 * The navbar, rendered exactly once.
 *
 * This is the only place in the tree that renders a header. Route-group
 * layouts, page shells and pages must never render one themselves — the
 * doubled navbar came from exactly that (a group layout plus RoleShell each
 * rendering <SiteHeader />), and centralising it here makes a repeat
 * structurally impossible rather than conventionally discouraged.
 *
 * Two headers exist because the landing site is deliberately different: `/`
 * and `/portals/*` get the portal switcher, everything else gets the
 * role-aware app navbar. A server component cannot see the URL it renders
 * for, so middleware stamps it on `x-pathname` (see middleware.ts) and this
 * component reads it back. If the header is ever missing, the app navbar is
 * the fallback: it is correct for every route except the landing ones, and a
 * missing header must never mean a missing navbar.
 *
 * Enforced, not just documented: scripts/verify-hei.mts (signed in) and
 * scripts/verify-routes.mjs (signed out) fetch pages and count navbars.
 */
export async function SiteChrome() {
  const list = await headers();
  const raw = list.get("x-pathname") ?? "";
  const pathname = raw.split("?")[0].split("#")[0];
  const isLanding = pathname === "/" || pathname === "/portals" || pathname.startsWith("/portals/");
  if (isLanding) return <LandingHeader />;
  return <SiteHeader />;
}
