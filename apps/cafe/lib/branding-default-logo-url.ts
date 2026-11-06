import { brandingUrl } from "@/lib/images";

// The tab icon for a cafe with no logo saved (F5), split out of lib/branding-default-logo.ts because that file hashes
// the built-in mark with node:crypto and so cannot be bundled for the device, where components/layout/DocumentBranding
// (through lib/document-branding.ts) needs this URL. The version is the content hash of the built-in mark's bytes,
// written out; lib/branding-paths.test.ts (F5) fails if it ever differs from the hash the server computes.
export const DEFAULT_PRODUCT_LOGO_URL = `${brandingUrl("productLogo")}?v=05c305115509`;
