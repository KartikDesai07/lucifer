import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig, { isPublicPath } from "@/auth.config";
import { resolveTenantFromHost } from "@/lib/tenant";
import { ADMIN_ROUTES } from "@/lib/constants";

const { auth } = NextAuth(authConfig);

// Edge middleware (F1.4): (1) resolve the cafe from the host header and stamp an
// `x-tenant-id` request header (Tier B asserts it matches THIS deployment's
// TENANT_ID, so a misrouted host never serves the wrong cafe's shell), then (2) run
// the v1 auth guard (preserving auth.config's authorized() policy). Edge-safe — NO
// Mongoose: resolveTenantFromHost's custom-domain lookup is an F1 stub
// (CLAUDE.md §19 / build-rule #19). API routes are excluded by the matcher and
// authorize themselves, so /api/health (the failover poller's target) is never
// blocked by tenant resolution.
export default auth(async (req) => {
  const { nextUrl } = req;

  // ── 1) Tenant resolution ────────────────────────────────────────────────────
  const tenant = await resolveTenantFromHost(req.headers.get("host"));
  if (!tenant) {
    // Unknown / reserved subdomain (or apex / unmapped custom domain): not a cafe.
    return new NextResponse("Not found", { status: 404 });
  }
  // Tier B: the deployment IS the tenant — never serve the wrong cafe.
  const configured = process.env.TENANT_ID;
  if (configured && tenant.tenantId !== configured) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Propagate the resolved tenant to route handlers / server components.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-tenant-id", tenant.tenantId);
  const proceed = NextResponse.next({ request: { headers: requestHeaders } });

  // ── 2) Auth guard (verbatim policy from v1 auth.config authorized()) ──────────
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = nextUrl;

  // Public QR menu (CR2.1): skip the auth bounce entirely. Tenant resolution
  // above has ALREADY run — an unknown host already returned 404 before this
  // line — so a public menu for a nonexistent tenant still never renders.
  // isPublicPath() is imported from auth.config.ts (MIRRORS its authorized()
  // callback verbatim); a source pin asserts both files reference it.
  if (isPublicPath(pathname)) {
    return proceed;
  }

  // Public auth page: send already-signed-in users to the dashboard.
  if (pathname.startsWith("/login")) {
    return isLoggedIn ? NextResponse.redirect(new URL("/", nextUrl)) : proceed;
  }
  // Every other matched (page) route requires a session.
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }
  // Admin-only sections: staff are redirected home.
  const isAdminRoute = ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  if (isAdminRoute && req.auth?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", nextUrl));
  }
  return proceed;
});

export const config = {
  // Guard page routes only. API routes authorize themselves; Next internals and the
  // favicon are always allowed.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
