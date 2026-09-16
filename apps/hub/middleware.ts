import NextAuth from "next-auth";

import authConfig from "@/auth.config";

// Edge middleware for the Hub — a FIRST-PASS page guard only: an unauthenticated
// browser hitting a panel page is redirected to /login (via auth.config's
// authorized() callback). It is edge-safe (NO Mongoose). The REAL authorization
// — role === 'owner', the IP allowlist, step-up freshness, and audit — lives in
// the route-handler gate (lib/panel-gate.ts), per fed-secrets-vault.json §E
// ("checked in the route handler, NOT only middleware"). API routes are excluded
// here and gate themselves, so this guard is never load-bearing for the API.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Guard page routes only. /api/* authorize themselves (the gate); Next
  // internals + favicon are always allowed.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
