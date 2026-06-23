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

const nextConfig: NextConfig = {
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
    // Cloudinary-hosted product images (CLAUDE.md §13) — store public_id, build URL at render time.
    // `unoptimized`: we already request sized/optimized Cloudinary URLs (w_/h_/c_fill via
    // lib/images.ts), so Next's own optimizer is redundant; serving the Cloudinary URL directly is
    // simplest and loses nothing. remotePatterns still allow-lists the host.
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
