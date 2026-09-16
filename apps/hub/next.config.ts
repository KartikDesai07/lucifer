import type { NextConfig } from "next";

// The owner Hub — a separate Next.js + Mongoose app on its OWN free account +
// its OWN free M0 "registry" cluster. It resolves/manages config but is NEVER in
// a cafe's request path (a Hub outage must not stop a cafe billing —
// 00-architecture-decisions.md §2). Hosted on the same Node.js runtime as the cafe
// so Mongoose's global connection cache (lib/db.ts) works reliably.

// Security response headers (mirrors the cafe's next.config; CLAUDE.md §8). The
// panel is the crown jewel — deny framing, no referrer leakage, HSTS. A strict
// CSP with nonces is a tracked follow-up (F3.4 panel hardening).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // The shared workspace package ships raw TypeScript (single source of truth —
  // schemas, constants, utils, codec). Next transpiles it as first-party source
  // (build-rule #31, CODE 3) — the same mechanism the cafe app uses.
  transpilePackages: ["@pos/shared"],
  // Keep Mongoose a runtime dependency rather than bundling it into the function
  // output (recommended for Mongoose on Vercel/Node).
  serverExternalPackages: ["mongoose"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
