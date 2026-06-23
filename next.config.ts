import type { NextConfig } from "next";

// NOTE: We intentionally do NOT call initOpenNextCloudflareForDev() here.
// This app uses no Cloudflare bindings (KV/D1/R2/DO) — it reads process.env
// and opens a Mongoose TCP connection, both of which OpenNext provides at
// runtime on Workers. The dev hook only proxies CF bindings into `next dev`,
// and on Windows it boots the workerd runtime at config-load and crashes the
// build (OpenNext is not fully Windows-compatible). Omitting it keeps `next
// build` / `next dev` clean; the production build runs on Cloudflare's Linux CI.

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
  experimental: {
    // Rewrite heavy barrel imports to per-module paths so unused exports are
    // tree-shaken from the client bundle (CLAUDE.md §17). lucide-react is
    // already covered by Next's defaults; recharts + date-fns are the wins.
    optimizePackageImports: ["recharts", "date-fns", "lucide-react"],
  },
  images: {
    // Cloudinary-hosted product images (CLAUDE.md §13) — store public_id, build URL at render time.
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
