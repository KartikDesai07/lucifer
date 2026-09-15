import { NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { buildManifest, MANIFEST_CONTENT_TYPE } from "@/lib/pos-install";

// CB-1d.2 — the web app manifest, served from a route handler (not
// app/manifest.ts) so it can read Settings for the cafe's branded name.
//
// readSettings(), NEVER getSettings(): this route is fetched PUBLICLY and
// cookie-less by the browser's own manifest fetch (no session to gate it,
// and /api is outside the middleware matcher — see middleware.ts), so
// anonymous install-prompt traffic must never drive a write against a
// 512MB M0 with no backups. getSettings() upserts and its `timestamps: true`
// bumps `updatedAt` on every call (lib/settings.ts:12-30); readSettings() is
// the read-only twin (lib/settings.ts:45-53) built for exactly this kind of
// render/fetch path.
//
// Deliberate envelope exception: this body is a W3C web app manifest, a
// spec-defined shape the browser parses directly — same precedent as
// app/api/branding/[slot]/route.ts serving raw bytes instead of
// { success, data }.
//
// no-store: a Settings rename must be visible on the NEXT install prompt,
// not stuck behind a stale cached manifest.
const MANIFEST_CACHE_CONTROL = "no-store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let name = "";
  try {
    const settings = await readSettings();
    name = settings?.restaurantName?.trim() ?? "";
  } catch {
    // DB down or any other failure: fall back to the generic product name
    // inside buildManifest. This route must never 500 and must never echo
    // the error — a broken manifest fetch would silently fall back to a
    // letter-tile install icon, which is an acceptable degrade; a 500 is not.
    name = "";
  }

  return new NextResponse(JSON.stringify(buildManifest(name)), {
    status: 200,
    headers: {
      "Content-Type": MANIFEST_CONTENT_TYPE,
      "Cache-Control": MANIFEST_CACHE_CONTROL,
    },
  });
}
