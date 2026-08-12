import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Edge-compatible Auth.js config for the Hub, consumed by middleware.ts. MUST
// NOT import Mongoose, node:crypto, or the vault — the real credential check
// (TOTP verify + DB) lives in lib/auth.ts (Node runtime). Mirrors the cafe split
// (apps/cafe/auth.config.ts) but the Hub is single-owner, so the guard is just
// "logged in or go to /login" — role/IP/step-up are enforced by the route-handler
// gate (lib/panel-gate.ts), never by middleware alone (fed-secrets-vault.json §E).
// ─────────────────────────────────────────────────────────────────────────────

export default {
  // Behind Vercel's proxy, Auth.js v5 must trust the forwarded host to build
  // correct callback URLs. AUTH_SECRET is still required in production.
  trustHost: true,
  providers: [
    // Stub: keeps the credential SHAPE (email + TOTP code — the Hub owner has NO
    // password by design) available to the edge runtime. The real authorize
    // (TOTP verify + Mongo) is defined in lib/auth.ts.
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Authenticator code", type: "text" },
      },
      authorize: () => null,
    }),
  ],
  pages: { signIn: "/login" },
  // SHORT session (§E "short session lifetimes"): a stolen Hub JWT expires fast.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;
      if (pathname.startsWith("/login")) {
        return isLoggedIn ? Response.redirect(new URL("/", nextUrl)) : true;
      }
      // Every other matched page route requires a session (first-pass only).
      return isLoggedIn;
    },
    jwt({ token, user }) {
      // `user` is present ONLY at sign-in (the lib/auth.ts authorize() return).
      // Copy identity + the server-minted sid ONCE; subsequent re-encodes leave
      // them untouched (the panel gate re-reads HubUser fresh, so no DB here).
      // We NEVER read a client-supplied `session` here — that keeps `sid` (and
      // thus step-up freshness) unforgeable via the /api/auth/session update path.
      if (user) {
        token.id = user.id ?? "";
        token.role = user.role;
        token.sid = user.sid;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.sid = token.sid;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
