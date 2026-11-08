import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// The public pages' tab title and icon: lib/public-metadata.ts (the /login and /m generateMetadata) over the pure rule
// in lib/document-branding.ts. Source-read pins, as in lib/branding-paths.test.ts, where items 4 and 4b lived until P2
// N2 moved the metadata out of the root layout; they moved here unchanged so that file (over 300 lines) does not grow.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Scans forward from an opening `{` at `openIdx`, counting brace depth, and returns the index of its MATCHING closing
// `}` (the same helper as lib/branding-paths.test.ts), so a function body is never cut at its first nested `}`.
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

const PUBLIC_METADATA = "apps/cafe/lib/public-metadata.ts";
const DOCUMENT_BRANDING = "apps/cafe/lib/document-branding.ts";

// ── 4. generateMetadata never 500s the login page; title falls back to APP_NAME ──

test("PIN: lib/public-metadata.ts's readPublicMetadata (the /login and /m generateMetadata) reads Settings inside a try whose catch still returns metadata (never throws), the title falls back to APP_NAME, and the tab icon is version-stamped from Settings with a brandingUrl fallback", () => {
  const src = stripComments(readSrc(PUBLIC_METADATA));
  const rule = stripComments(readSrc(DOCUMENT_BRANDING));

  assert.match(
    src,
    /export async function readPublicMetadata\(\): Promise<Metadata>/,
    "public-metadata.ts must export readPublicMetadata",
  );

  const fnStart = src.indexOf("export async function readPublicMetadata");
  const braceOpenIdx = src.indexOf("{", fnStart);
  const braceCloseIdx = matchingBraceEnd(src, braceOpenIdx);
  const fnBody = src.slice(braceOpenIdx + 1, braceCloseIdx);

  const tryIdx = fnBody.indexOf("try {");
  const catchIdx = fnBody.indexOf("} catch {", tryIdx);
  assert.ok(tryIdx >= 0, "the Settings read must be inside a try block");
  assert.ok(catchIdx > tryIdx, "a } catch { must follow the try block");

  const tryBody = fnBody.slice(tryIdx, catchIdx);
  const catchBody = fnBody.slice(catchIdx);

  // Mutation this catches: letting the catch re-throw (or omit a return) — a
  // Settings read that throws here 500s the LOGIN page for every operator,
  // not just the one screen that shows the tab icon.
  assert.match(
    catchBody,
    /return \{/,
    "the catch block must still return a Metadata object — it must never rethrow or fall through with no return",
  );
  assert.ok(
    !/\bthrow\b/.test(catchBody),
    "the catch block must not rethrow — a throw here 500s the login page when the DB is down",
  );

  // Mutation this catches: seeding `title` from settings.restaurantName alone
  // (dropping the `|| APP_NAME` fallback, or the `?.` that lets a `.lean()`
  // doc predating the field, or no doc at all, reach here without throwing) —
  // a cafe that never set a restaurantName would then get an empty tab title
  // instead of the generic product name, or the whole function would throw.
  assert.match(
    rule,
    /title: settings\?\.restaurantName\?\.trim\(\) \|\| APP_NAME,/,
    "brandingOf's title must read settings?.restaurantName defensively and fall back to APP_NAME when unset",
  );
  assert.match(tryBody, /brandingOf\(await readSettings\(\)\)/, "the try branch must take title and icon from brandingOf over readSettings()");
  assert.match(
    catchBody,
    /title: APP_NAME,/,
    "the catch branch's fallback metadata must also use APP_NAME for the title",
  );

  // The owner's headline requirement for this redesign: the tab icon comes
  // from Settings, version-stamped (immutable-cacheable) when a productLogo
  // is set, degrading to the unversioned branding route otherwise. Mutation
  // this catches: dropping the `?? brandingUrl(...)` fallback (a cafe with no
  // productLogo saved would get `null` handed to `icons.icon[0].url`), or
  // swapping in the raw ref/settings field instead of going through
  // productImageUrl, which is what turns the ref into a real, versioned URL.
  assert.match(
    rule,
    /iconHref: productImageUrl\(settings\?\.productLogo \?\? undefined\) \?\? DEFAULT_PRODUCT_LOGO_URL,/,
    "brandingOf's iconHref must derive from productImageUrl(settings?.productLogo), falling back to DEFAULT_PRODUCT_LOGO_URL (F5) when unset",
  );
  assert.match(
    tryBody,
    /icons: \{ icon: \[\{ url: iconHref \}\] \}/,
    "the try branch's returned Metadata must set icons.icon from iconHref — a title-only return would leave the tab icon dead code",
  );
  assert.match(
    catchBody,
    /icons: \{ icon: \[\{ url: DEFAULT_PRODUCT_LOGO_URL \}\] \},/,
    "the catch branch's fallback metadata must still set an icon via brandingUrl(\"productLogo\") — a DB-down login page must not lose its tab icon too",
  );
});

// ── 4b. layout.tsx never calls the upserting getSettings on the public /login path ──

test('PIN: the public metadata helper (/login, /m) never calls getSettings — only its read-only twin readSettings', () => {
  const src = stripComments(readSrc(PUBLIC_METADATA));

  assert.match(
    src,
    /\breadSettings\b/,
    "public-metadata.ts must read Settings via readSettings",
  );
  // Mutation this catches: swapping readSettings for getSettings — getSettings()
  // upserts, and its `timestamps: true` bumps updatedAt on EVERY call (verified
  // by probe), so anonymous /login traffic would drive a write against a 512MB
  // M0 with no backups on every uncached render.
  assert.ok(
    !/\bgetSettings\b/.test(src),
    "public-metadata.ts must never call getSettings — it is a public render path, and getSettings() upserts on every call",
  );
});
