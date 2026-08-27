import { createHash } from "node:crypto";

import { BRANDING_VERSION_LEN } from "@/lib/constants";
import type { StoredBranding } from "@/lib/branding";

// Extracted from lib/branding.ts (post-review file-size split, keeping that
// file under the repo's ~300-line cap) — the product's own built-in mark,
// served for the productLogo slot until an owner uploads theirs. Generic by
// design (CLAUDE.md: never hardcode a cafe's identity) and inline rather
// than a file in public/, so the branding route is the single URL that
// always answers with an icon — a browser tab must never fall back to the
// framework's default — and so it can still be served when the DATABASE is
// down. Deliberately self-contained: only a TYPE-only import from
// lib/branding.ts (erased at compile time, no runtime import cycle), so this
// file never depends on that module having finished evaluating.
//
// SVG is safe HERE and only here: these bytes are a compile-time constant we
// authored, never client input (uploads are raster-only — see lib/branding.ts).
const DEFAULT_PRODUCT_LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
  '<rect width="64" height="64" rx="14" fill="#0f172a"/>',
  '<rect x="18" y="13" width="28" height="38" rx="3" fill="#ffffff"/>',
  '<rect x="23" y="21" width="18" height="3.5" rx="1.75" fill="#0f172a"/>',
  '<rect x="23" y="30" width="18" height="3.5" rx="1.75" fill="#0f172a"/>',
  '<rect x="23" y="39" width="11" height="3.5" rx="1.75" fill="#0f172a"/>',
  "</svg>",
].join("");

const DEFAULT_PRODUCT_LOGO_BYTES = Buffer.from(DEFAULT_PRODUCT_LOGO_SVG, "utf8");

// Same content-hash scheme as lib/branding.ts's own brandingVersion — inlined
// rather than imported, so this file carries no RUNTIME dependency back on
// that module (only the StoredBranding type above, which compiles away).
const DEFAULT_PRODUCT_LOGO_VERSION = createHash("sha256")
  .update(DEFAULT_PRODUCT_LOGO_BYTES)
  .digest("hex")
  .slice(0, BRANDING_VERSION_LEN);

export const DEFAULT_PRODUCT_LOGO: StoredBranding = {
  bytes: DEFAULT_PRODUCT_LOGO_BYTES,
  contentType: "image/svg+xml",
  version: DEFAULT_PRODUCT_LOGO_VERSION,
};
