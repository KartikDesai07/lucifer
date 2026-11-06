import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// P2 N2: the root layout and the dashboard layout read no Settings and no session on the server, so every staff
// frame can be served static. The tab title and icon are set on the device (DocumentBranding); the public pages
// (/login, /m) keep a server-side generateMetadata of their own.
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

const STATIC_LAYOUTS = ["app/layout.tsx", "app/(dashboard)/layout.tsx"];

test("PIN: the root and dashboard layouts read no session, no Settings, no request data, and have no generateMetadata", () => {
  for (const rel of STATIC_LAYOUTS) {
    const src = code(rel);
    assert.match(src, /export const metadata:\s*Metadata\s*=/, `${rel}: landmark, a static metadata object`);
    for (const banned of ["auth(", "readSettings", "getSettings", "cookies(", "headers(", "generateMetadata"]) {
      assert.ok(!src.includes(banned), `${rel} must not contain ${banned}: it would make every staff route dynamic`);
    }
  }
});

test("PIN: the static metadata carries the generic title, and the dashboard keeps manifest and both icons", () => {
  const root = code("app/layout.tsx");
  assert.match(root, /title:\s*APP_NAME/, "root title");
  assert.match(root, /icons:\s*\{\s*icon:\s*\[\{\s*url:\s*DEFAULT_PRODUCT_LOGO_URL\s*\}\]\s*\}/, "root tab icon");
  const dash = code("app/(dashboard)/layout.tsx");
  assert.match(dash, /title:\s*APP_NAME/, "dashboard title");
  assert.match(dash, /manifest:\s*MANIFEST_PATH/, "dashboard manifest");
  assert.match(dash, /icon:\s*\[\{\s*url:\s*DEFAULT_PRODUCT_LOGO_URL\s*\}\]/, "dashboard tab icon re-declared (Next replaces icons per segment)");
  assert.match(dash, /apple:\s*\[\{\s*url:\s*APPLE_TOUCH_ICON_PATH\s*\}\]/, "dashboard apple icon");
});

test("PIN: the dashboard layout renders <DocumentBranding /> inside MasterDataProvider", () => {
  const src = code("app/(dashboard)/layout.tsx");
  const open = src.indexOf("<MasterDataProvider>");
  const close = src.indexOf("</MasterDataProvider>");
  const at = src.indexOf("<DocumentBranding />");
  assert.ok(open >= 0 && close > open, "landmark: MasterDataProvider wraps the shell");
  assert.ok(at > open && at < close, "DocumentBranding sits inside MasterDataProvider (settings are seeded there)");
});

test("PIN: DocumentBranding re-applies on a path change, writes only a differing value, and renders nothing", () => {
  const src = code("components/layout/DocumentBranding.tsx");
  assert.match(src, /^\s*"use client"/, "a client component");
  assert.match(src, /usePathname\(\)/, "reads the pathname");
  assert.match(src, /\[[^\]]*pathname[^\]]*\]/, "pathname is in the effect deps (Next may re-render its own title/icon on navigation)");
  assert.match(src, /useSettings\(\)/, "reads the settings");
  assert.match(src, /brandingOf\(/, "uses the pure core");
  assert.match(src, /document\.title\s*!==/, "writes the title only when it differs");
  assert.match(src, /return null/, "renders nothing");
});

test("PIN: /login and /m export generateMetadata from the shared public helper (readSettings, never getSettings)", () => {
  for (const rel of ["app/(auth)/login/page.tsx", "app/m/layout.tsx"]) {
    const src = code(rel);
    assert.match(src, /export (async )?function generateMetadata|export const generateMetadata/, `${rel} exports generateMetadata`);
    assert.match(src, /readPublicMetadata\(\)/, `${rel} uses the shared helper`);
    assert.ok(!src.includes("getSettings"), `${rel} must never getSettings: public page, it upserts`);
  }
  const helper = code("lib/public-metadata.ts");
  assert.match(helper, /readSettings\(\)/, "the helper reads with readSettings");
  assert.ok(!helper.includes("getSettings"), "the helper never calls getSettings");
  assert.match(helper, /catch\s*\{[\s\S]*title:\s*APP_NAME/, "a DB-down read falls back to static metadata");
  assert.match(helper, /brandingOf\(/, "the helper uses the pure core");
});
