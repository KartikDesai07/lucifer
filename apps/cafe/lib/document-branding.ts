// The tab title and icon, as one pure rule. Two places apply it: the server helper for the public pages
// (lib/public-metadata.ts, /login and /m) and the device (components/layout/DocumentBranding.tsx, every staff
// screen, whose frame is static and so cannot read Settings on the server).
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_PRODUCT_LOGO_URL } from "@/lib/branding-default-logo-url";
import { productImageUrl } from "@/lib/images";

export const METADATA_DESCRIPTION =
  "Point-of-sale and management system for restaurants and cafes";

type BrandingSource = { restaurantName?: string | null; productLogo?: string | null } | null | undefined;

/** The "(3) " that PosPulseProvider stamps ahead of the tab title while diners' requests are open. It strips this
 *  before re-deriving the base title each time, so the stamp is idempotent and survives Next resetting the title. */
export const TITLE_PREFIX_RE = /^\(\d+\)\s/;

/** The cafe's title for the tab, keeping the open-request prefix the current title carries: the device's branding
 *  must never wipe the count the pulse put there. Equal to `current` when it is already branded. */
export function brandedTitle(current: string, title: string): string {
  const prefix = TITLE_PREFIX_RE.exec(current)?.[0] ?? "";
  return `${prefix}${title}`;
}

/** The cafe's name (trimmed; the product's name when it has none) and its tab icon (the uploaded logo's versioned
 *  URL; the built-in mark when none). `?.` on purpose: the document may predate a field. */
export function brandingOf(settings: BrandingSource): { title: string; iconHref: string } {
  return {
    title: settings?.restaurantName?.trim() || APP_NAME,
    iconHref: productImageUrl(settings?.productLogo ?? undefined) ?? DEFAULT_PRODUCT_LOGO_URL,
  };
}
