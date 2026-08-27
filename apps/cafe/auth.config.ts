import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { ADMIN_ROUTES, SESSION_MAX_AGE_SECONDS } from "@/lib/constants";
import { BOTID_CLIENT_PATH_PREFIX, PUBLIC_MENU_PATH } from "@pos/shared/public";

// Edge-compatible Auth.js config consumed by middleware.ts.
// MUST NOT import Mongoose, bcrypt, or any Node-only module.
// The real credential check (DB + bcrypt) lives in lib/auth.ts.

// The ONE predicate for "is this page public" (CR2.1's QR menu). middleware.ts
// imports this exact function rather than re-deriving the rule — the two
// files MUST NOT drift, and a source pin (lib/public-surface-paths.test.ts)
// asserts both reference it. Matches PUBLIC_MENU_PATH itself and any
// sub-path ("/m", "/m/<token>") and nothing else: a naive startsWith(PATH)
// would wrongly admit "/menu", "/m-admin", "/mx".
//
// BOTID_CLIENT_PATH_PREFIX (2026-08-20 field fix): BotID's browser challenge
// assets are served same-origin under this fixed prefix by withBotId()'s
// rewrites — but middleware runs BEFORE rewrites, so without this exemption
// an anonymous diner's challenge script 307s to /login and the protected
// public POST breaks on any device without a panel session cookie. These
// paths carry no cafe data (they proxy to Vercel's bot-protection service).
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === PUBLIC_MENU_PATH ||
    pathname.startsWith(`${PUBLIC_MENU_PATH}/`) ||
    pathname.startsWith(BOTID_CLIENT_PATH_PREFIX)
  );
}

export default {
  // Behind a proxy/edge host (Cloudflare/Vercel) Auth.js v5 must trust the
  // forwarded host header to build correct callback URLs; without it login can
  // break on the deployed host. AUTH_SECRET is still required in production.
  trustHost: true,
  providers: [
    // Stub provider: keeps the credentials shape available to the edge runtime.
    // Actual `authorize` (bcrypt + DB lookup) is defined in lib/auth.ts.
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: () => null,
    }),
  ],
  pages: { signIn: "/login" },
  // maxAge bounds how long a token (and thus a deactivated login) can live.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Public auth page: send already-signed-in users to the dashboard.
      if (pathname.startsWith("/login")) {
        return isLoggedIn ? Response.redirect(new URL("/", nextUrl)) : true;
      }

      // Public QR menu (CR2.1): no session required. MIRRORS middleware.ts's
      // own isPublicPath() check verbatim — both files import this exported
      // predicate rather than each re-deriving the "/m" vs "/m/<token>" rule,
      // so a source pin (lib/public-surface-paths.test.ts) can assert they
      // stay in lock-step. Tenant resolution (unknown host -> 404) happens in
      // middleware.ts BEFORE this callback ever runs, so a public menu page
      // for a nonexistent tenant is already gone by this point.
      if (isPublicPath(pathname)) return true;

      // Every other matched route requires a session.
      if (!isLoggedIn) return false;

      // Admin-only sections: staff are redirected home.
      const isAdminRoute = ADMIN_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      );
      if (isAdminRoute && auth?.user?.role !== "admin") {
        return Response.redirect(new URL("/", nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      // `user` is only present on sign-in (the authorize() return value).
      // The edge config never hits the DB; the Node instance (lib/auth.ts)
      // overrides this callback to re-validate role/isActive against Mongo.
      if (user) {
        token.id = user.id ?? "";
        token.role = user.role;
        token.lastValidated = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
