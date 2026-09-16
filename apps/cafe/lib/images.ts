// The opaque image ref (F2 §3.7, Step F2.11). Product docs store ONE string
// (F2c pins `image` as a lean String) and only this module — plus the upload
// route's delete dispatch — ever interprets it:
//
//   "r2:<key>"      → an object key in the cafe's own R2 bucket (F2.11+ uploads)
//   "local:<slot>:<version>" → a branding logo in the cafe's OWN database,
//                     served by /api/branding/<slot> (needs no asset-plane config)
//   "<publicId>"    → a legacy Cloudinary public_id (v1 uploads, no prefix)
//
// Everything else (products page, POS grid, CSV import, models) passes the
// string through untouched, so the app stays store-agnostic and a cafe carrying
// both generations of refs renders both. Returns null (→ placeholder) when
// there is no image or the matching store's public base is not configured.
//
// Client-safe: only NEXT_PUBLIC_ env (inlined at build) — no Node imports.

import {
  BRANDING_SLOTS,
  BRANDING_VERSION_LEN,
  type BrandingSlot,
} from "@/lib/constants";
import type { ImageStore } from "@/lib/platform";

const R2_REF_PREFIX = "r2:";
const LOCAL_REF_PREFIX = "local:";

// Route that serves branding bytes out of the cafe's own database. Same-origin,
// so it needs no next.config remotePatterns entry and no NEXT_PUBLIC_* env —
// which is the entire point: a logo renders on a deployment with zero asset
// config.
const BRANDING_ROUTE = "/api/branding";

const VERSION_PATTERN = new RegExp(`^[0-9a-f]{${BRANDING_VERSION_LEN}}$`);

// Discriminated so a "local" ref carries its slot as a BrandingSlot and its
// version as a definite string — callers building a branding URL need no cast
// and cannot forget the version.
export type ParsedImageRef =
  | { store: ImageStore; ref: string } // R2 object key, or Cloudinary public_id
  | { store: "local"; ref: BrandingSlot; version: string };

// Encode an R2 object key as a stored ref.
export function r2Ref(key: string): string {
  return `${R2_REF_PREFIX}${key}`;
}

// Encode a branding slot + content version as a stored ref. The version rides
// INSIDE the ref so that replacing a logo changes every URL derived from it —
// the bytes can then be cached immutably, which is what lets a receipt print
// its logo on a tablet that is offline at print time.
export function localRef(slot: BrandingSlot, version: string): string {
  return `${LOCAL_REF_PREFIX}${slot}:${version}`;
}

function isBrandingSlot(value: string): value is BrandingSlot {
  return (BRANDING_SLOTS as readonly string[]).includes(value);
}

// Split a stored ref into {store, ref}. A bare string (no known prefix) is a
// legacy Cloudinary public_id — v1 never generated colons in its ids, so no
// prefix can collide with existing data.
export function parseImageRef(
  ref: string | null | undefined,
): ParsedImageRef | null {
  if (!ref) return null;
  if (ref.startsWith(R2_REF_PREFIX)) {
    const key = ref.slice(R2_REF_PREFIX.length);
    return key ? { store: "r2", ref: key } : null;
  }
  if (ref.startsWith(LOCAL_REF_PREFIX)) {
    // Both halves are validated, not just split: a malformed ref must render as
    // the placeholder rather than build a URL that 404s on every screen.
    const [slot, version, ...rest] = ref.slice(LOCAL_REF_PREFIX.length).split(":");
    if (rest.length > 0) return null;
    if (!slot || !isBrandingSlot(slot)) return null;
    if (!version || !VERSION_PATTERN.test(version)) return null;
    return { store: "local", ref: slot, version };
  }
  return { store: "cloudinary", ref };
}

// The always-current URL for a branding slot, with no version to cache against.
// For the two callers that cannot read a ref: the login screen (public — it has
// no session, so it cannot fetch Settings) and the /favicon.ico rewrite (the
// browser's automatic root probe). Served revalidate-always, so it is correct
// at the cost of one conditional request.
export function brandingUrl(slot: BrandingSlot): string {
  return `${BRANDING_ROUTE}/${slot}`;
}

export interface ProductImageUrlOptions {
  // Cloudinary only: c_fill square-crops (fine for product tiles), but a wide
  // logo needs c_fit (scale to bound, no crop) — the OrderReceipt/AppSidebar
  // logo call sites pass this; product image call sites leave it unset.
  fit?: boolean;
}

// Build the render URL for a stored ref at render time (never store full URLs).
// R2 objects are uploaded pre-sized (IMAGE_MAX_DIMENSION_PX) and served as-is
// from the bucket's public base, so `size`/`opts` only participate on the
// Cloudinary branch, which transforms on delivery.
export function productImageUrl(
  ref: string | undefined,
  size = 300,
  opts?: ProductImageUrlOptions,
): string | null {
  const parsed = parseImageRef(ref);
  if (!parsed) return null;

  if (parsed.store === "local") {
    // Version-stamped so the response can be cached immutably; `size`/`fit`
    // don't participate for the same reason as R2 — the bytes are stored
    // pre-sized by the client's canvas downscale, and there is no transform tier.
    return `${brandingUrl(parsed.ref)}?v=${parsed.version}`;
  }

  if (parsed.store === "r2") {
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
    if (!base) return null;
    const encodedKey = parsed.ref
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `${base.replace(/\/+$/, "")}/${encodedKey}`;
  }

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return null;
  const crop = opts?.fit ? "c_fit" : "c_fill";
  const transform = `w_${size},h_${size},${crop},f_auto,q_auto`;
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${parsed.ref}`;
}
