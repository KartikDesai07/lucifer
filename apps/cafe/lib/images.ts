// The opaque image ref (F2 §3.7, Step F2.11). Product docs store ONE string
// (F2c pins `image` as a lean String) and only this module — plus the upload
// route's delete dispatch — ever interprets it:
//
//   "r2:<key>"      → an object key in the cafe's own R2 bucket (F2.11+ uploads)
//   "<publicId>"    → a legacy Cloudinary public_id (v1 uploads, no prefix)
//
// Everything else (products page, POS grid, CSV import, models) passes the
// string through untouched, so the app stays store-agnostic and a cafe carrying
// both generations of refs renders both. Returns null (→ placeholder) when
// there is no image or the matching store's public base is not configured.
//
// Client-safe: only NEXT_PUBLIC_ env (inlined at build) — no Node imports.

import type { ImageStore } from "@/lib/platform";

const R2_REF_PREFIX = "r2:";

export interface ParsedImageRef {
  store: ImageStore;
  ref: string; // R2 object key, or Cloudinary public_id
}

// Encode an R2 object key as a stored ref.
export function r2Ref(key: string): string {
  return `${R2_REF_PREFIX}${key}`;
}

// Split a stored ref into {store, ref}. A bare string (no "r2:" prefix) is a
// legacy Cloudinary public_id — v1 never generated colons in its ids, so the
// prefix cannot collide with existing data.
export function parseImageRef(
  ref: string | null | undefined,
): ParsedImageRef | null {
  if (!ref) return null;
  if (ref.startsWith(R2_REF_PREFIX)) {
    const key = ref.slice(R2_REF_PREFIX.length);
    return key ? { store: "r2", ref: key } : null;
  }
  return { store: "cloudinary", ref };
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
