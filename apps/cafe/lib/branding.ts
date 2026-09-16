import { createHash } from "node:crypto";

import cache from "@/lib/cache";
import { connectDB } from "@/lib/db";
import { parseImageRef } from "@/lib/images";
import { readSettings } from "@/lib/settings";
import { BrandingAsset } from "@/models/BrandingAsset";
import { Settings, type ISettings } from "@/models/Settings";
import {
  BRANDING_PRUNE_GRACE_MS,
  BRANDING_PRUNE_MAX_PENDING,
  BRANDING_VERSION_LEN,
  IMAGE_CONTENT_TYPES,
  type BrandingSlot,
} from "@/lib/constants";

// Server-side store for the two branding logos (see models/BrandingAsset.ts for
// why they live in the cafe's own DB, content-addressed, rather than on the asset
// plane or the Settings doc). SERVER ONLY — imports node:crypto and Mongoose. The
// client-safe half (ref encode/parse, URL building) stays in lib/images.ts.

// ── Content-type validation ─────────────────────────────────────────────────

// File signatures, so what we store is provably the image type it claims to be.
// This matters more here than for a product image: branding bytes are served back
// from OUR OWN origin, and a Content-Type we merely took the client's word for
// would let a signed-in admin park arbitrary content on the app's domain.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF_TAG = "RIFF";
const WEBP_TAG = "WEBP";
const RIFF_TAG_OFFSET = 0;
const WEBP_TAG_OFFSET = 8;
const WEBP_HEADER_BYTES = 12;

const SIGNATURE_CHECKS: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": (bytes) =>
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
  "image/jpeg": (bytes) =>
    bytes.length >= JPEG_SOI.length &&
    bytes.subarray(0, JPEG_SOI.length).equals(JPEG_SOI),
  "image/webp": (bytes) =>
    bytes.length >= WEBP_HEADER_BYTES &&
    bytes.subarray(RIFF_TAG_OFFSET, RIFF_TAG_OFFSET + RIFF_TAG.length).toString("latin1") ===
      RIFF_TAG &&
    bytes.subarray(WEBP_TAG_OFFSET, WEBP_TAG_OFFSET + WEBP_TAG.length).toString("latin1") ===
      WEBP_TAG,
};

// `Object.hasOwn`, never `in` or a bare index lookup. Both maps are plain object
// literals, so they inherit Object.prototype: `"constructor" in SIGNATURE_CHECKS`
// is true and `SIGNATURE_CHECKS["constructor"]` is the Object function, which is
// callable and returns a truthy value — so an `in`-based allow-list plus a bare
// lookup would let `Content-Type: constructor` (or `toString`) pass BOTH gates
// and store arbitrary bytes. Confirmed by probe, not reasoning.
export function isSupportedBrandingType(contentType: string): boolean {
  return (
    Object.hasOwn(IMAGE_CONTENT_TYPES, contentType) &&
    Object.hasOwn(SIGNATURE_CHECKS, contentType)
  );
}

export function hasMatchingSignature(bytes: Buffer, contentType: string): boolean {
  if (!Object.hasOwn(SIGNATURE_CHECKS, contentType)) return false;
  // `=== true` so a check that somehow returned a truthy non-boolean cannot pass.
  return SIGNATURE_CHECKS[contentType](bytes) === true;
}

// ── Versioning ──────────────────────────────────────────────────────────────

// Content hash prefix. Doubles as the document key, the ref's cache key and the
// response ETag, so identical bytes re-uploaded produce the same URL (no
// pointless cache miss) and different bytes always produce a different one.
export function brandingVersion(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, BRANDING_VERSION_LEN);
}

function assetId(slot: BrandingSlot, version: string): string {
  return `${slot}:${version}`;
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface StoredBranding {
  bytes: Buffer;
  contentType: string;
  version: string;
}

export interface BrandingMeta {
  contentType: string;
  version: string;
}

// Content is immutable per key, so caching it in-process is unconditionally
// safe — there is no "stale isolate serves the wrong bytes" case the way there
// would be if documents were keyed by slot alone.
const BRANDING_CACHE_TTL_SECONDS = 300;
const cacheKey = (slot: BrandingSlot, version: string) => `branding:${assetId(slot, version)}`;

// Just enough to answer a conditional request. The unversioned URL (the login
// screen and the browser's /favicon.ico probe) revalidates on every view, and
// pulling a 512KB base64 payload out of a 512MB M0 to then answer an empty 304
// is the one hot cost on this route.
export async function getBrandingMeta(
  slot: BrandingSlot,
  version: string,
): Promise<BrandingMeta | null> {
  const cached = cache.get<StoredBranding>(cacheKey(slot, version));
  if (cached) return { contentType: cached.contentType, version: cached.version };

  await connectDB();
  const doc = await BrandingAsset.findById(assetId(slot, version))
    .select("contentType version")
    .lean();
  return doc ? { contentType: doc.contentType, version: doc.version } : null;
}

// Null when that exact version is not held. THROWS when the stored bytes fail
// their integrity check, so the route logs a 500 rather than quietly serving a
// truncated image: Buffer.from(s, "base64") accepts malformed input without
// error, so the stored decoded length is the only proof the round-trip held.
export async function getBrandingBytes(
  slot: BrandingSlot,
  version: string,
): Promise<StoredBranding | null> {
  const key = cacheKey(slot, version);
  const cached = cache.get<StoredBranding>(key);
  if (cached) return cached;

  await connectDB();
  const doc = await BrandingAsset.findById(assetId(slot, version)).lean();
  if (!doc) return null;

  const bytes = Buffer.from(doc.dataB64, "base64");
  if (bytes.length !== doc.bytes) {
    throw new Error(
      `Stored branding asset "${assetId(slot, version)}" is corrupt: ${bytes.length} bytes decoded, ${doc.bytes} expected`,
    );
  }
  const asset: StoredBranding = {
    bytes,
    contentType: doc.contentType,
    version: doc.version,
  };
  cache.set(key, asset, BRANDING_CACHE_TTL_SECONDS);
  return asset;
}

// Per-slot accessor for the ref Settings stores for that slot (A8, CR2.4).
// A two-way ternary stopped being total the moment a THIRD slot existed, and
// heroImage's ref is also NESTED (under `appearance`), unlike the two logos —
// so this is a total map, one reader per slot, gated by Object.hasOwn like
// every other map lookup in this file (SIGNATURE_CHECKS above). Degradation
// is identical for all three slots either way: a Settings document with no
// `appearance` subdoc at all (every document written before CR2.4) and an
// explicit `""` both read back as `undefined` here, which resolveActiveVersion
// below turns into `null` — the same outcome an empty `logo`/`productLogo`
// field has always had.
const SLOT_REF_READERS: Record<BrandingSlot, (s: ISettings | null) => string | undefined> = {
  logo: (s) => s?.logo,
  productLogo: (s) => s?.productLogo,
  heroImage: (s) => s?.appearance?.heroImage,
};

function slotRef(settings: ISettings | null, slot: BrandingSlot): string | undefined {
  if (!Object.hasOwn(SLOT_REF_READERS, slot)) return undefined;
  return SLOT_REF_READERS[slot](settings);
}

// The .select() projection for a FRESH, uncached read of just the one field a
// slot's prune needs (A14, below) — heroImage's is the nested dotted path,
// the two logos are each a bare top-level field.
const SLOT_SETTINGS_PROJECTION: Record<BrandingSlot, string> = {
  logo: "logo",
  productLogo: "productLogo",
  heroImage: "appearance.heroImage",
};

// Shared by resolveActiveVersion's cached read and putBrandingAsset's own
// uncached read (A14): a ref only counts as "active" for a slot when it
// parses as a LOCAL ref AND names that same slot — the guard that stops a
// mis-keyed ref from cross-wiring one slot's saved version into another's
// (e.g. the restaurant logo into the browser tab icon).
function activeVersionFromRef(ref: string | undefined, slot: BrandingSlot): string | null {
  const parsed = parseImageRef(ref);
  if (!parsed || parsed.store !== "local" || parsed.ref !== slot) return null;
  return parsed.version;
}

// The version this cafe has actually SAVED for a slot, read from Settings —
// never from whatever bytes happen to be stored. This is what makes clearing the
// field in Settings a real removal: the unversioned URL resolves through here, so
// an unreferenced upload stops being served even though its bytes linger until
// the next prune.
export async function resolveActiveVersion(
  slot: BrandingSlot,
): Promise<string | null> {
  const settings = await readSettings();
  return activeVersionFromRef(slotRef(settings, slot), slot);
}

// ── Write ───────────────────────────────────────────────────────────────────

// Store bytes under their content hash and return the ref's version. ADDITIVE:
// the version Settings currently points at keeps resolving, so an upload the
// admin abandons cannot change what the cafe prints. Then prune that slot down
// to the new version plus the saved one, which bounds this collection at two
// documents per slot on a cluster with 512MB and no backups.
export async function putBrandingAsset(
  slot: BrandingSlot,
  bytes: Buffer,
  contentType: string,
): Promise<{ version: string; bytes: number }> {
  const version = brandingVersion(bytes);
  await connectDB();

  await BrandingAsset.findByIdAndUpdate(
    assetId(slot, version),
    {
      $set: {
        slot,
        contentType,
        dataB64: bytes.toString("base64"),
        bytes: bytes.length,
        version,
      },
    },
    { upsert: true, runValidators: true },
  );

  const keep = [version];
  // A14: read the active ref UNCACHED — never readSettings()/resolveActiveVersion
  // — because readSettings() can be serving a copy of Settings up to
  // TTL.SETTINGS (45s) stale. A concurrent Settings PUT that just saved THIS
  // slot's new ref would be invisible to a cached read for up to that long,
  // and the prune below would then delete the very version that save just
  // pointed at.
  const activeDoc = (await Settings.findOne()
    .select(SLOT_SETTINGS_PROJECTION[slot])
    .lean()) as ISettings | null;
  const active = activeVersionFromRef(slotRef(activeDoc, slot), slot);
  if (active && active !== version) keep.push(active);

  // Grace window (A14, BRANDING_PRUNE_GRACE_MS): even an uncached read can
  // still race a Settings save that commits AFTER this SELECT runs, so a
  // document is only eligible for collection once it has sat unreferenced for
  // the WHOLE window — comfortably longer than any realistic gap between
  // "upload" and "Save" in the Appearance tab. An upload that is genuinely
  // abandoned gets collected by the next put after it clears.
  await BrandingAsset.deleteMany({
    slot,
    version: { $nin: keep },
    updatedAt: { $lt: new Date(Date.now() - BRANDING_PRUNE_GRACE_MS) },
  });

  // Hard count bound (post-review fix, BRANDING_PRUNE_MAX_PENDING): the grace
  // window above only ever collects OLD orphans, so a burst of same-slot
  // uploads inside that window (auditioning several heroes before ever
  // saving) would otherwise grow this slot's document count without bound —
  // and a branding flow that never uploads again for that slot never triggers
  // another put to collect the final window's leftovers. Keep the newest
  // BRANDING_PRUNE_MAX_PENDING non-kept documents regardless of age, and
  // collect anything beyond that on every put — this caps the slot at
  // ≤ 2 kept + BRANDING_PRUNE_MAX_PENDING pending documents.
  const overflow = await BrandingAsset.find({ slot, version: { $nin: keep } })
    .sort({ updatedAt: -1 })
    .skip(BRANDING_PRUNE_MAX_PENDING)
    .select("_id")
    .lean();
  if (overflow.length > 0) {
    await BrandingAsset.deleteMany({ _id: { $in: overflow.map((doc) => doc._id) } });
  }

  return { version, bytes: bytes.length };
}

// ── Built-in default ────────────────────────────────────────────────────────

// Extracted to its own file (post-review split, keeping this file under the
// repo's ~300-line cap) — re-exported here so every existing "@/lib/branding"
// import site (the route, the two test files) keeps working unchanged.
export { DEFAULT_PRODUCT_LOGO } from "@/lib/branding-default-logo";
