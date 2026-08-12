import { RESERVED_SUBDOMAINS } from "./platform";

// Host → tenant resolution (F1). A PURE, fully unit-testable function used by the
// edge middleware to scope a request to its cafe. In Tier B the deployment IS the
// tenant, so the resolved id is asserted against process.env.TENANT_ID in the
// middleware; the function stays tier-agnostic so a Tier-A switch needs no rewrite.

export interface ResolvedTenant {
  tenantId: string;
  subdomain: string;
}

// Custom-domain → tenant lookup. STUB in F1 (always null). F3 wires an EDGE-SAFE
// lookup (the CORE registry via fetch / KV) — NEVER Mongoose, since this runs on the
// Edge runtime (CLAUDE.md §19 / build-rule #19).
async function customDomainLookup(_host: string): Promise<string | null> {
  return null;
}

export async function resolveTenantFromHost(
  host: string | null | undefined,
): Promise<ResolvedTenant | null> {
  if (!host) return null;
  const h = host.toLowerCase().split(":")[0].trim(); // strip any :port
  if (!h) return null;

  // Local dev: bare localhost / loopback (no subdomain) → a single "dev" tenant.
  if (h === "localhost" || h === "127.0.0.1") {
    return { tenantId: "dev", subdomain: "dev" };
  }

  const rootDomain = (process.env.ROOT_DOMAIN ?? "").toLowerCase();
  let sub: string | null = null;

  if (h.endsWith(".localhost")) {
    sub = h.slice(0, -".localhost".length); // cafe.localhost → cafe
  } else if (/^[a-z0-9-]+---[a-z0-9-]+\.vercel\.app$/.test(h)) {
    sub = h.split("---")[0]; // cafe---branch.vercel.app (preview) → cafe
  } else if (rootDomain && h.endsWith("." + rootDomain)) {
    sub = h.slice(0, -("." + rootDomain).length); // cafe.<ROOT_DOMAIN> → cafe
  } else {
    sub = await customDomainLookup(h); // custom domain (F1 stub → null)
  }

  if (!sub) return null;
  if (RESERVED_SUBDOMAINS.includes(sub)) return null; // www/app/api/admin/hub
  // Tier B: tenantId === subdomain; the middleware asserts it equals TENANT_ID.
  return { tenantId: sub, subdomain: sub };
}
