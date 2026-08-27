import {
  failure,
  notFound,
  requireAdmin,
  serverError,
  success,
} from "@/lib/api-helpers";
import {
  BRANDING_SLOTS,
  BRANDING_SLOT_MAX_BYTES,
  BRANDING_VERSION_LEN,
  type BrandingSlot,
} from "@/lib/constants";
import {
  DEFAULT_PRODUCT_LOGO,
  getBrandingBytes,
  getBrandingMeta,
  hasMatchingSignature,
  isSupportedBrandingType,
  putBrandingAsset,
  resolveActiveVersion,
  type BrandingMeta,
  type StoredBranding,
} from "@/lib/branding";
import { localRef } from "@/lib/images";

export const dynamic = "force-dynamic";

const SECONDS_PER_YEAR = 31_536_000;

// A version-stamped URL names exactly one set of bytes (documents are keyed by
// content hash), so it can be cached as hard as HTTP allows. That is what lets a
// receipt print its logo on a tablet with no network at print time.
const IMMUTABLE_CACHE = `public, max-age=${SECONDS_PER_YEAR}, immutable`;

// Everything else: cacheable but revalidated. Used for the unversioned URL (the
// login screen, the /favicon.ico probe) and whenever the bytes we are about to
// send are NOT the version that was asked for. Never `immutable` in that case —
// pinning the wrong image in a browser's cache for a year is unrecoverable.
const REVALIDATE_CACHE = "public, max-age=0, must-revalidate";

const VERSION_PATTERN = new RegExp(`^[0-9a-f]{${BRANDING_VERSION_LEN}}$`);

type Params = { params: Promise<{ slot: string }> };

// Closed enum, matched by identity — never a cast, so no crafted path segment can
// reach a slot the storage layer does not know about.
function asSlot(value: string): BrandingSlot | null {
  return BRANDING_SLOTS.find((slot) => slot === value) ?? null;
}

// Human-facing noun for the 413 copy (A16) — a hero-image upload rejected with
// "Logo must be under…" would actively mislead whoever is looking at it.
const SLOT_LABELS: Record<BrandingSlot, string> = {
  logo: "Logo",
  productLogo: "Logo",
  heroImage: "Hero image",
};

// BRANDING_SLOT_MAX_BYTES is a total map over BrandingSlot, but every other
// map lookup on this branding path is Object.hasOwn-gated (lib/branding.ts) —
// kept consistent here rather than trusting a bare index into an object literal.
function maxBytesFor(slot: BrandingSlot): number {
  return Object.hasOwn(BRANDING_SLOT_MAX_BYTES, slot)
    ? BRANDING_SLOT_MAX_BYTES[slot]
    : BRANDING_SLOT_MAX_BYTES.logo;
}

// Copy the stored bytes into a standalone Uint8Array for the response body.
// A view over `bytes.buffer` would be wrong as well as untypeable: Buffer.from()
// hands back a slice of a POOLED ArrayBuffer, so the raw buffer holds unrelated
// memory beyond byteLength.
function imageBody(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

// RFC 9110 If-None-Match: a comma-separated list of entity-tags, or "*". Weak
// prefixes are compared weakly, which is correct for a byte-identical image.
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .includes(etag);
}

// Content-Length is deliberately NOT set: the runtime derives it from the body,
// and a hand-written value that the platform's transfer encoding disagrees with
// truncates the image instead of merely being redundant.
function imageHeaders(meta: BrandingMeta, cacheControl: string): Headers {
  return new Headers({
    "Content-Type": meta.contentType,
    "Cache-Control": cacheControl,
    ETag: `"${meta.version}"`,
    "X-Content-Type-Options": "nosniff",
    // Only bites when the URL is opened as a document rather than through an
    // <img>: the built-in mark is an SVG, and a document-context SVG is the one
    // shape that could execute script on this origin.
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
}

function imageResponse(
  asset: StoredBranding,
  cacheControl: string,
  ifNoneMatch: string | null,
): Response {
  const headers = imageHeaders(asset, cacheControl);
  if (etagMatches(ifNoneMatch, `"${asset.version}"`)) {
    // 304 repeats the validators and cache headers, never the body.
    return new Response(null, { status: 304, headers });
  }
  return new Response(imageBody(asset.bytes), { status: 200, headers });
}

// GET /api/branding/[slot] — the bytes behind a branding ref.
//
// PUBLIC on purpose, and the only unauthenticated data route in the app besides
// /api/health. It has to be: the browser fetches the tab icon on the LOGIN page,
// before any session exists, and the /favicon.ico rewrite hits it with no session
// at all. What it exposes is a logo that is printed on every customer's receipt —
// public by nature. The slot is a closed enum, so this cannot be steered at any
// other collection or key. Not rate-limited, matching /api/health; the bytes are
// capped per slot (BRANDING_SLOT_MAX_BYTES, A16) and version-stamped URLs are
// served `immutable`, so real traffic is answered by caches rather than the cluster.
export async function GET(req: Request, { params }: Params) {
  const { slot: raw } = await params;
  const slot = asSlot(raw);
  if (!slot) return notFound("Unknown branding slot");

  const ifNoneMatch = req.headers.get("if-none-match");
  const requested = new URL(req.url).searchParams.get("v");
  const wantsVersion = requested !== null && VERSION_PATTERN.test(requested);

  try {
    // A version that was asked for AND that we hold is the only case that earns
    // `immutable`, because it is the only case where the URL and the bytes
    // provably agree.
    if (wantsVersion) {
      const meta = await getBrandingMeta(slot, requested);
      if (meta) {
        if (etagMatches(ifNoneMatch, `"${meta.version}"`)) {
          return new Response(null, {
            status: 304,
            headers: imageHeaders(meta, IMMUTABLE_CACHE),
          });
        }
        const asset = await getBrandingBytes(slot, requested);
        if (asset) return imageResponse(asset, IMMUTABLE_CACHE, ifNoneMatch);
      }
      // Fall through: a client whose Settings copy is old enough that its version
      // has been pruned. Serving the CURRENT logo beats a broken image on a
      // receipt, and it is safe precisely because it will not be sent as
      // `immutable` below.
    }

    const active = await resolveActiveVersion(slot);
    if (active) {
      const asset = await getBrandingBytes(slot, active);
      if (asset) return imageResponse(asset, REVALIDATE_CACHE, ifNoneMatch);
    }

    // Nothing SAVED for this slot — which is also what an admin clearing the
    // field in Settings produces, so removal genuinely takes effect here even
    // though the pruned bytes may still exist. The product slot falls back to the
    // built-in mark so a browser tab never shows the framework's default icon;
    // the restaurant slot has no sensible stand-in and its callers render their
    // own placeholder.
    if (slot === "productLogo") {
      return imageResponse(DEFAULT_PRODUCT_LOGO, REVALIDATE_CACHE, ifNoneMatch);
    }
    return notFound("No image set for this slot");
  } catch (error) {
    // The built-in mark is a compile-time constant that needs no database, so the
    // one surface promised never to fall back to a framework default keeps its
    // icon even while Mongo is unreachable.
    if (slot === "productLogo") {
      return imageResponse(DEFAULT_PRODUCT_LOGO, REVALIDATE_CACHE, ifNoneMatch);
    }
    return serverError("Failed to load branding image", error);
  }
}

// PUT /api/branding/[slot] — store bytes for a slot and return their ref. Admin only.
//
// Bytes arrive as the raw request body (not base64, not multipart): the client has
// already downscaled and re-encoded to webp, and raw keeps the request well under
// the platform's 4.5MB body ceiling. Deliberately does NOT touch Settings — the
// settings form stays the single writer of the ref, exactly as product image
// uploads work. Combined with content-addressed storage, that means an upload the
// admin never saves changes nothing the cafe can see.
export async function PUT(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { slot: raw } = await params;
  const slot = asSlot(raw);
  if (!slot) return notFound("Unknown branding slot");

  const contentType = (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!isSupportedBrandingType(contentType)) {
    return failure("Use a PNG, JPEG or WebP image", 400);
  }

  const maxBytes = maxBytesFor(slot);
  const tooLarge = `${SLOT_LABELS[slot]} must be under ${Math.floor(maxBytes / 1024)}KB after resizing`;

  // Reject on the DECLARED length first, so an oversized body is refused before
  // it is materialised in the function's memory. The real check below still
  // stands — Content-Length is the client's claim, not a fact.
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return failure(tooLarge, 413);
  }

  try {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) return failure("The image is empty", 400);
    if (bytes.length > maxBytes) return failure(tooLarge, 413);
    // The declared type must match the actual file signature — see lib/branding.ts.
    if (!hasMatchingSignature(bytes, contentType)) {
      return failure("That file is not a valid PNG, JPEG or WebP image", 400);
    }

    const saved = await putBrandingAsset(slot, bytes, contentType);
    return success({
      ref: localRef(slot, saved.version),
      version: saved.version,
      bytes: saved.bytes,
    });
  } catch (error) {
    return serverError("Failed to save branding image", error);
  }
}
