import type { NextConfig } from "next";

// Hosted on a Node.js runtime (Vercel) where Mongoose's connection cache works
// reliably. Cloudflare Workers was dropped: its per-request I/O isolation makes a
// cached MongoDB socket unusable across requests (intermittent 500s) — see DEPLOY.md.

// Security response headers (CLAUDE.md §8, Step 8.2). Deliberately omits a strict
// Content-Security-Policy for now — a wrong CSP white-screens the panel, which is
// the exact failure we're trying to avoid; CSP with nonces is a tracked follow-up.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "0" }, // modern guidance: disable the legacy auditor
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

// Allow-list the cafe's R2 public host (r2.dev or a custom/Worker domain) for
// next/image, derived from the same env lib/images.ts renders from. Per-tenant
// deploys (Tier B) bake their own host at build time.
const r2PublicHost = (() => {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // The shared workspace package ships raw TypeScript (single source of truth for
  // the reused spine — schemas, constants, utils, API envelope, hook factory).
  // Next must transpile it like first-party source (build-rule #31, CODE 3).
  transpilePackages: ["@pos/shared"],
  // Keep Mongoose a runtime dependency rather than bundling it into the serverless
  // function output (recommended for Mongoose on Vercel/Node).
  serverExternalPackages: ["mongoose"],
  experimental: {
    // Rewrite heavy barrel imports to per-module paths so unused exports are
    // tree-shaken from the client bundle (CLAUDE.md §17). lucide-react is
    // already covered by Next's defaults; recharts + date-fns are the wins.
    optimizePackageImports: ["recharts", "date-fns", "lucide-react"],
  },
  images: {
    // Product images — an opaque stored ref, URL built at render time (lib/images.ts):
    // the cafe's own R2 public base (pre-sized at upload) or a legacy Cloudinary
    // transform URL. `unoptimized`: both stores already serve sized/encoded images,
    // so Next's optimizer is redundant. remotePatterns still allow-lists the hosts.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https" as const, hostname: "res.cloudinary.com" },
      ...(r2PublicHost
        ? [{ protocol: "https" as const, hostname: r2PublicHost }]
        : []),
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
