import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

/**
 * Route-level role gating. Next 16 calls this a proxy (it was `middleware.ts`
 * before the rename).
 *
 * This is a redirect convenience only — every page and server action
 * independently re-checks the session via requireAdmin / requireStudent, which
 * is what actually protects the data.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isAdminRoute = pathname.startsWith("/admin");
  // The exam runner lives outside /student so it can render full-screen without
  // the navigation shell — but it is still a student-only route.
  const isStudentRoute =
    pathname.startsWith("/student") || pathname.startsWith("/exam");

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Wrong role for this tree — send them to their own home rather than /login,
  // which would look like a broken logout.
  if (isAdminRoute && session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/student/dashboard", request.url));
  }
  if (isStudentRoute && session.role !== "STUDENT") {
    return NextResponse.redirect(new URL("/admin/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/student/:path*", "/exam/:path*"],
};
