// Platform constants + types (F1). Tier-agnostic runtime config: the SAME code path
// serves Tier B (deploy-per-tenant — the shipped model) and a future Tier-A shared
// app, so a later switch needs no rewrite. See docs/PLATFORM.md.

export type HostingTier = "A" | "B";

// Tier B (deploy-per-tenant) is the shipped default; "A" (one shared paid app) is a
// documented escape only — not built, not marketed (PLATFORM.md §3).
export const HOSTING_TIER: HostingTier =
  process.env.HOSTING_TIER === "A" ? "A" : "B";

export type ImageStore = "r2" | "cloudinary";

// The image store NEW uploads target (F2.11 retargeted the asset plane to the
// cafe's own Cloudflare R2 — the decided sole-free path, PLATFORM.md §7 flag 2 —
// so "r2" is now the default). IMAGE_STORE=cloudinary keeps a deploy on its
// single per-cafe Cloudinary account (never pooled — F2 §2.11). Renders and
// deletes dispatch per-REF (lib/images.ts), not on this flag, so legacy
// Cloudinary images keep working either way.
export const IMAGE_STORE: ImageStore =
  process.env.IMAGE_STORE === "cloudinary" ? "cloudinary" : "r2";

// Subdomains that are NOT tenants (platform infra / reserved). resolveTenantFromHost
// rejects these so www/app/api/admin/hub never resolve to a cafe.
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www",
  "app",
  "api",
  "admin",
  "hub",
];

// The resolved per-tenant config a runtime carries (from env in Tier B; from the Hub
// registry in Tier A). `mongoUris` is a placeholder for the F2 ClusterRouter (the
// CORE + time-sharded LEDGER pool). No `tenantId` ever lives inside a cafe's DATA
// (physical isolation, build-rule #30) — this is runtime routing config, not data.
export interface TenantConfig {
  tenantId: string;
  subdomain: string;
  mongoUris: string[];
  imageStore: ImageStore;
  customHostname?: string;
}
