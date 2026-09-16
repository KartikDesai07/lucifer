import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

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

// Content-Security-Policy for the public diner surface ONLY (§6 item 9): /m and
// /m/*, the unauthenticated QR-ordering pages. The admin panel is deliberately
// excluded from any CSP — see the comment on securityHeaders above, a wrong
// CSP white-screens the panel, which the public surface (small, purpose-built
// pages) doesn't carry the same risk for. BotID's client script and the
// requests it makes are proxied same-origin by the rewrites withBotId installs
// below, so `'self'` is expected to cover it; the docs are silent on CSP
// specifics, so this is empirically re-verified post-deploy and again on a
// real phone by the CR2.5 device leg.
const publicSurfaceCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${
    process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
  }`, // 'unsafe-eval' is Next dev/HMR only — production must never carry it
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://res.cloudinary.com${
    r2PublicHost ? ` https://${r2PublicHost}` : ""
  }`,
  "font-src 'self' data:",
  "connect-src 'self'", // BotID traffic is same-origin via its rewrites
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const publicSurfaceHeaders = [{ key: "Content-Security-Policy", value: publicSurfaceCsp }];

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
    return [
      { source: "/:path*", headers: securityHeaders },
      // Public diner surface only — see publicSurfaceCsp's comment above.
      { source: "/m", headers: publicSurfaceHeaders },
      { source: "/m/:path*", headers: publicSurfaceHeaders },
    ];
  },
  // Browsers probe /favicon.ico at the origin root on their own, regardless of
  // any <link rel="icon"> in the document head (MDN). app/favicon.ico (the
  // static create-next-app default) is deleted, so without this rewrite that
  // probe 404s; route both paths to the same branding bytes so the product
  // logo is the single answer either way.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/api/branding/productLogo" }];
  },
};

// Vercel BotID: wraps the config with the rewrites its client script needs to
// call same-origin (see instrumentation-client.ts for the protected-route
// list). Must wrap the final exported config, not an intermediate object.
export default withBotId(nextConfig);
