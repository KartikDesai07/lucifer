// The tab title and icon for the PUBLIC pages (/login and /m), whose frames are the only ones still rendered per
// request. Server only (Mongoose). The staff frames are static and brand the tab on the device instead.
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_PRODUCT_LOGO_URL } from "@/lib/branding-default-logo";
import { brandingOf, METADATA_DESCRIPTION } from "@/lib/document-branding";
import { readSettings } from "@/lib/settings";

export async function readPublicMetadata(): Promise<Metadata> {
  try {
    // readSettings(), NOT getSettings(): these pages are public, and getSettings() upserts — its `timestamps: true`
    // bumps `updatedAt` on every call, so anonymous traffic would drive writes against a 512MB M0.
    const { title, iconHref } = brandingOf(await readSettings());
    return { title, description: METADATA_DESCRIPTION, icons: { icon: [{ url: iconHref }] } };
  } catch {
    // A DB-down Settings read must never throw here: generateMetadata throwing turns the LOGIN page into a 500,
    // locking every operator out of a POS whose shell would otherwise render fine. A missing tab icon is not worth
    // that; fall back to static, DB-free metadata.
    return {
      title: APP_NAME,
      description: METADATA_DESCRIPTION,
      icons: { icon: [{ url: DEFAULT_PRODUCT_LOGO_URL }] },
    };
  }
}
