import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Middleware is UX, not security.
 *
 * It reads the session cookie only — it does not hit the database, because
 * middleware runs on every matched request and a database round trip here would
 * cost more than the page it is protecting. That means it can tell you whether
 * somebody is signed in, but not what role they hold.
 *
 * The role check that actually matters is `requireRole()` inside the page or
 * server action (lib/auth/guards.ts). A caller can invoke a server action
 * directly and never pass through this file. Middleware redirects; the server
 * guard refuses.
 */
const PROTECTED_PREFIXES = ["/me", "/hei", "/industry", "/gov", "/admin", "/demo"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const cookie = getSessionCookie(request);
  if (!cookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/me/:path*", "/hei/:path*", "/industry/:path*", "/gov/:path*", "/admin/:path*", "/demo/:path*"],
};
