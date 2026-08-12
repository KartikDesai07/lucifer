import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { ADMIN_ROUTES, SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

// Edge-compatible Auth.js config consumed by middleware.ts.
// MUST NOT import Mongoose, bcrypt, or any Node-only module.
// The real credential check (DB + bcrypt) lives in lib/auth.ts.
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
