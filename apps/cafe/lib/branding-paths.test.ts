import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// The productLogo/logo branding wiring (public GET route, admin-gated PUT,
// the DB-backed asset store, the Settings form/fields, ImageUpload's dual
// transport, the sidebar fallback, the login page, and the /favicon.ico
// rewrite) has no test framework coverage — there is no React/route test
// framework in this repo, by design (see customer-privacy-paths.test.ts's
// header). These are source-read pins (readFileSync over the REAL source),
// the same technique as that file and due-payment-ui-paths.test.ts.
//
// NOT duplicated here — already pinned elsewhere:
//   - lib/branding.ts's own helpers (isSupportedBrandingType,
//     hasMatchingSignature, brandingVersion, putBrandingAsset,
//     getBrandingAsset) are presumably unit-pinned in their own test file;
//     this file only pins that the ROUTE actually CALLS them, not their
//     internal behavior.
//   - lib/images.ts's parseImageRef/productImageUrl/localRef/brandingUrl
//     ref-parsing behavior — also presumably unit-pinned elsewhere; this file
//     only pins that the COMPONENTS call them with the right arguments.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// These pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it. (This bit this repo once already on a banned-string pin.)

// Scans forward from an opening `{` at `openIdx`, counting brace depth, and
// returns the index of its MATCHING closing `}` — used to pull a whole
// function/object BODY out of the source text without truncating on the
// first nested `}` a naive indexOf would hit.
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

const BRANDING_ROUTE = "apps/cafe/app/api/branding/[slot]/route.ts";
const ROOT_LAYOUT = "apps/cafe/app/layout.tsx";
const FAVICON_FILE = "apps/cafe/app/favicon.ico";
const NEXT_CONFIG = "apps/cafe/next.config.ts";
const SETTINGS_FORM = "apps/cafe/components/settings/SettingsForm.tsx";
const GENERAL_SETTINGS_FIELDS = "apps/cafe/components/settings/GeneralSettingsFields.tsx";
const IMAGE_UPLOAD = "apps/cafe/components/shared/ImageUpload.tsx";
const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const LOGIN_PAGE = "apps/cafe/app/(auth)/login/page.tsx";
const BRANDING_ASSET_MODEL = "apps/cafe/models/BrandingAsset.ts";
const BRANDING_LIB = "apps/cafe/lib/branding.ts";
const MIDDLEWARE_FILE = "apps/cafe/middleware.ts";
const UPLOAD_ROUTE = "apps/cafe/app/api/upload/route.ts";
const R2_LIB = "apps/cafe/lib/r2.ts";

// ── 1. GET is public, PUT is admin-gated ─────────────────────────────────────

test("PIN: GET /api/branding/[slot] carries no auth guard (public — the login page and the browser's /favicon.ico probe have no session), while PUT requires requireAdmin", () => {
  const src = stripComments(readSrc(BRANDING_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const putStart = src.indexOf("export async function PUT");
  assert.ok(getStart >= 0 && putStart > getStart, "GET must exist before PUT");

  const getBody = src.slice(getStart, putStart);
  const putBody = src.slice(putStart);

  // Mutation this catches: wrapping GET in requireAuth/requireAdmin — the
  // login page's tab icon and the bare /favicon.ico browser probe both hit
  // this route with zero session, and a 401 there breaks the tab icon on
  // every unauthenticated screen, forever.
  assert.ok(
    !/\brequireAuth\s*\(/.test(getBody) && !/\brequireAdmin\s*\(/.test(getBody),
    "GET's body must not call requireAuth or requireAdmin — it is the one route besides /api/health that must stay open with no session",
  );

  const adminCallIdx = putBody.indexOf("const admin = await requireAdmin();");
  assert.ok(
    adminCallIdx >= 0,
    "PUT must gate on requireAdmin — anyone able to write these bytes can plant an arbitrary image behind a public, cached URL",
  );

  // Pinning the requireAdmin() call alone proves nothing: `requireAdmin()`
  // returns an error-shaped value on failure rather than throwing, so the
  // guard only does anything if its result is actually checked and returned
  // on. Mutation this catches: deleting the `if ("error" in admin) return
  // admin.error;` line — tsc and eslint stay green (admin's type still union
  // in scope, just never narrowed), but PUT then falls straight through to
  // the write for ANY signed-in staff member, not just admins.
  const adminGuardWindow = putBody.slice(adminCallIdx, adminCallIdx + 120);
  assert.match(
    adminGuardWindow,
    /if \("error" in admin\) return admin\.error;/,
    'PUT must immediately follow requireAdmin() with `if ("error" in admin) return admin.error;` — declaring `admin` without enforcing its error branch opens the write to any signed-in staff member',
  );
});

// ── 2. immutable Cache-Control only on a version match; 304 driven by if-none-match ──

test("PIN: GET's IMMUTABLE_CACHE is reachable ONLY inside the branch that confirmed the requested ?v is a version we hold, and both its inline 304 and the shared imageResponse 304 are driven by etagMatches", () => {
  const src = stripComments(readSrc(BRANDING_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const putStart = src.indexOf("export async function PUT");
  const getBody = src.slice(getStart, putStart);

  const wantsVersionIdx = getBody.indexOf("if (wantsVersion) {");
  assert.ok(
    wantsVersionIdx >= 0,
    "GET must gate the held-version fast path behind `if (wantsVersion)`",
  );
  const braceOpenIdx = getBody.indexOf("{", wantsVersionIdx);
  const braceCloseIdx = matchingBraceEnd(getBody, braceOpenIdx);
  const wantsVersionBody = getBody.slice(braceOpenIdx + 1, braceCloseIdx);
  const afterWantsVersion = getBody.slice(braceCloseIdx + 1);

  // The inline 304 (an exact version match, no byte fetch at all) must itself
  // be gated by etagMatches — never returned the instant a meta record is found.
  const etagIdx = wantsVersionBody.indexOf('etagMatches(ifNoneMatch, `"${meta.version}"`)');
  const statusIdx = wantsVersionBody.indexOf("status: 304");
  assert.ok(
    etagIdx >= 0,
    'the held-version 304 must be guarded by etagMatches(ifNoneMatch, `"${meta.version}"`)',
  );
  assert.ok(
    statusIdx > etagIdx,
    "the held-version 304 response must be inside the etagMatches-guarded branch, not reachable independently of it",
  );

  // Sanity check so the negative assertion below isn't vacuously true.
  assert.match(
    wantsVersionBody,
    /IMMUTABLE_CACHE/,
    "the wantsVersion branch is expected to be the only user of IMMUTABLE_CACHE",
  );

  // Mutation this catches: hoisting IMMUTABLE_CACHE into the active-version
  // fallback or the catch block — a client whose ?v names a version that has
  // since been pruned would then have the CURRENT (different) bytes told to
  // its browser as `immutable` under a URL that named a different version,
  // pinning the wrong image for a year.
  assert.ok(
    !/IMMUTABLE_CACHE/.test(afterWantsVersion),
    "IMMUTABLE_CACHE must never appear outside the branch that matched the requested version — the active-version fallback and the catch block must use only REVALIDATE_CACHE",
  );

  // imageResponse is shared by both the held-version and fallback paths, so
  // its own 304 must be etagMatches-gated too, independent of its callers.
  const irStart = src.indexOf("function imageResponse(");
  assert.ok(irStart >= 0, "imageResponse must exist");
  const irBraceOpen = src.indexOf("{", irStart);
  const irBraceClose = matchingBraceEnd(src, irBraceOpen);
  const irBody = src.slice(irBraceOpen + 1, irBraceClose);
  const irEtagIdx = irBody.indexOf('etagMatches(ifNoneMatch, `"${asset.version}"`)');
  const irStatusIdx = irBody.indexOf("status: 304");
  assert.ok(
    irEtagIdx >= 0,
    'imageResponse\'s 304 must be guarded by etagMatches(ifNoneMatch, `"${asset.version}"`)',
  );
  assert.ok(
    irStatusIdx > irEtagIdx,
    "imageResponse's 304 response must be inside its etagMatches-guarded branch, not returned unconditionally",
  );
});

// ── 3. PUT enforces type, signature and size ────────────────────────────────

test("PIN: PUT /api/branding/[slot] enforces isSupportedBrandingType, hasMatchingSignature, and a per-slot byte cap — all three, not a subset", () => {
  const src = stripComments(readSrc(BRANDING_ROUTE));
  const putStart = src.indexOf("export async function PUT");
  const putBody = src.slice(putStart);

  // Mutation this catches: dropping any one of the three checks lets a
  // caller either upload a file whose declared Content-Type is bogus, whose
  // bytes don't actually match a supported signature (e.g. a renamed
  // script), or whose size blows past the slot's cap into the cafe's own
  // database — the storage of last resort, with no CDN in front of it.
  assert.match(
    putBody,
    /if \(!isSupportedBrandingType\(contentType\)\)/,
    "PUT must reject an unsupported declared Content-Type via isSupportedBrandingType",
  );
  assert.match(
    putBody,
    /bytes\.length > maxBytes/,
    "PUT must reject bytes over the slot's own cap",
  );
  assert.match(
    putBody,
    /if \(!hasMatchingSignature\(bytes, contentType\)\)/,
    "PUT must reject bytes whose file signature does not match the declared Content-Type",
  );
});

// ── 3b. per-slot byte cap (A16): read from BRANDING_SLOT_MAX_BYTES, never a bare shared literal, and the 413 copy is slot-parameterized ──

test('PIN: the branding route reads its byte cap from BRANDING_SLOT_MAX_BYTES[slot] (A16), and the 413 copy names the SLOT\'s own label — never a hardcoded "Logo" for every slot', () => {
  const src = stripComments(readSrc(BRANDING_ROUTE));
  const putStart = src.indexOf("export async function PUT");
  const putBody = src.slice(putStart);

  // Mutation this catches: reverting to a single MAX_BRANDING_BYTES constant
  // for every slot — a hero banner would then be capped at the LOGO's much
  // smaller 512KB ceiling instead of its own larger one.
  assert.match(
    src,
    /BRANDING_SLOT_MAX_BYTES/,
    "the route must import/use BRANDING_SLOT_MAX_BYTES, not a single shared cap",
  );
  assert.match(
    putBody,
    /const maxBytes = maxBytesFor\(slot\);/,
    "PUT must resolve its byte cap per-slot before either 413 check runs",
  );
  assert.match(
    putBody,
    /const tooLarge = `\$\{SLOT_LABELS\[slot\]\} must be under/,
    "the 413 copy must be built from the slot's own label, not a fixed noun",
  );
  // Mutation this catches: a tooLarge template that still hardcodes "Logo" —
  // a hero-image upload rejected with "Logo must be under…" actively
  // misleads whoever is looking at the error.
  assert.ok(
    !/`Logo must be under/.test(putBody),
    'the 413 message template must never hardcode "Logo" — it must read the slot label from SLOT_LABELS',
  );
});

// ── 4. generateMetadata never 500s the login page; title falls back to APP_NAME ──

test("PIN: app/layout.tsx's generateMetadata reads Settings inside a try whose catch still returns metadata (never throws), the title falls back to APP_NAME, and the tab icon is version-stamped from Settings with a brandingUrl fallback", () => {
  const src = stripComments(readSrc(ROOT_LAYOUT));

  assert.match(
    src,
    /export async function generateMetadata\(\): Promise<Metadata>/,
    "layout.tsx must export generateMetadata",
  );

  const fnStart = src.indexOf("export async function generateMetadata");
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
    tryBody,
    /const title = settings\?\.restaurantName\?\.trim\(\) \|\| APP_NAME;/,
    "the try branch's title must read settings?.restaurantName defensively and fall back to APP_NAME when unset",
  );
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
    tryBody,
    /const iconHref =\s*productImageUrl\(settings\?\.productLogo\) \?\? brandingUrl\("productLogo"\);/,
    "the try branch's iconHref must derive from productImageUrl(settings?.productLogo), falling back to brandingUrl(\"productLogo\") when unset",
  );
  assert.match(
    tryBody,
    /icons: \{ icon: \[\{ url: iconHref \}\] \},/,
    "the try branch's returned Metadata must set icons.icon from iconHref — a title-only return would leave the tab icon dead code",
  );
  assert.match(
    catchBody,
    /icons: \{ icon: \[\{ url: brandingUrl\("productLogo"\) \}\] \},/,
    "the catch branch's fallback metadata must still set an icon via brandingUrl(\"productLogo\") — a DB-down login page must not lose its tab icon too",
  );
});

// ── 4b. layout.tsx never calls the upserting getSettings on the public /login path ──

test('PIN: app/layout.tsx never calls getSettings — only its read-only twin readSettings', () => {
  const src = stripComments(readSrc(ROOT_LAYOUT));

  assert.match(
    src,
    /\breadSettings\b/,
    "layout.tsx must read Settings via readSettings",
  );
  // Mutation this catches: swapping readSettings for getSettings — getSettings()
  // upserts, and its `timestamps: true` bumps updatedAt on EVERY call (verified
  // by probe), so anonymous /login traffic would drive a write against a 512MB
  // M0 with no backups on every uncached render.
  assert.ok(
    !/\bgetSettings\b/.test(src),
    "layout.tsx must never call getSettings — it is a public render path, and getSettings() upserts on every call",
  );
});

// ── 5. No static app/favicon.ico — it would silently shadow the dynamic icon ──

test("PIN: apps/cafe/app/favicon.ico does not exist — Next's file-convention metadata overrides metadata.icons/generateMetadata, which would make the dynamic product logo permanently dead code", () => {
  const faviconPath = path.join(REPO_ROOT, FAVICON_FILE);
  assert.ok(
    !existsSync(faviconPath),
    "apps/cafe/app/favicon.ico must not exist — its mere presence overrides generateMetadata's icons entry regardless of what Settings.productLogo holds",
  );
});

// ── 6. /favicon.ico is rewritten to the branding route ──────────────────────

test("PIN: next.config.ts rewrites /favicon.ico to /api/branding/productLogo — the browser's automatic root probe bypasses <link rel=\"icon\"> entirely", () => {
  const src = stripComments(readSrc(NEXT_CONFIG));
  const fnStart = src.indexOf("async rewrites()");
  assert.ok(fnStart >= 0, "next.config.ts must define an async rewrites() function");
  const braceOpenIdx = src.indexOf("{", fnStart);
  const braceCloseIdx = matchingBraceEnd(src, braceOpenIdx);
  const rewritesBody = src.slice(braceOpenIdx, braceCloseIdx + 1);

  assert.match(
    rewritesBody,
    /source:\s*"\/favicon\.ico",\s*destination:\s*"\/api\/branding\/productLogo"/,
    "rewrites() must map /favicon.ico to /api/branding/productLogo — without it, the browser's own /favicon.ico probe 404s regardless of the deleted static file",
  );
});

// ── 7. SettingsForm's defaultValues includes productLogo ───────────────────

test("PIN: SettingsForm's defaultValues includes productLogo — settingsSchema requires it on every submit, and zodResolver validates the FULL object", () => {
  const src = stripComments(readSrc(SETTINGS_FORM));
  const defaultsIdx = src.indexOf("defaultValues: {");
  assert.ok(defaultsIdx >= 0, "useForm must be seeded with defaultValues");
  const braceOpenIdx = src.indexOf("{", defaultsIdx);
  const braceCloseIdx = matchingBraceEnd(src, braceOpenIdx);
  const defaultsBody = src.slice(braceOpenIdx + 1, braceCloseIdx);

  // Mutation this catches: dropping the productLogo line from defaultValues —
  // a Settings document written before this field existed has no key for it,
  // so zodResolver would see `undefined` for a REQUIRED field and silently
  // block Save with no field visibly wrong (productLogo has no UI validation
  // message of its own on this path).
  assert.match(
    defaultsBody,
    /productLogo:\s*settings\.productLogo\s*\?\?\s*""\s*,/,
    "defaultValues must seed productLogo from settings.productLogo, falling back to an empty string — omitting it fails the whole form's Save on a doc written before this field existed",
  );
});

// ── 8. GeneralSettingsFields wires both slots to their matching Controller ──

test("PIN: GeneralSettingsFields renders ImageUpload for BOTH slot=\"logo\" and slot=\"productLogo\", each bound to the matching Controller name= — a swapped or missing binding would let the two logos overwrite each other", () => {
  const src = stripComments(readSrc(GENERAL_SETTINGS_FIELDS));

  const logoNameIdx = src.indexOf('name="logo"');
  const productLogoNameIdx = src.indexOf('name="productLogo"');
  assert.ok(logoNameIdx >= 0, "a Controller with name=\"logo\" must exist");
  assert.ok(productLogoNameIdx >= 0, "a Controller with name=\"productLogo\" must exist");

  // Bound narrowly to the ImageUpload immediately inside each Controller
  // (a short forward window) rather than anywhere in the file — a stray
  // slot="logo" elsewhere in the file must not satisfy this pin.
  const logoWindow = src.slice(logoNameIdx, logoNameIdx + 200);
  const productLogoWindow = src.slice(productLogoNameIdx, productLogoNameIdx + 200);

  // Mutation this catches: swapping the slot props between the two
  // Controllers (name="logo" rendering slot="productLogo", and vice versa) —
  // the restaurant logo upload would then silently overwrite the product
  // logo's stored asset (and vice versa), since PUT is keyed on the slot in
  // the ImageUpload prop, not on the field name.
  assert.match(
    logoWindow,
    /slot="logo"/,
    "the name=\"logo\" Controller's ImageUpload must carry slot=\"logo\"",
  );
  assert.ok(
    !/slot="productLogo"/.test(logoWindow),
    "the name=\"logo\" Controller must not be bound to slot=\"productLogo\"",
  );
  assert.match(
    productLogoWindow,
    /slot="productLogo"/,
    "the name=\"productLogo\" Controller's ImageUpload must carry slot=\"productLogo\"",
  );
  assert.ok(
    !/slot="logo"/.test(productLogoWindow),
    "the name=\"productLogo\" Controller must not be bound to slot=\"logo\"",
  );
});

// ── 9. ImageUpload's two transports never cross ─────────────────────────────

test("PIN: ImageUpload's branding branch PUTs to /api/branding/<slot>, and the product branch still goes through /api/upload — a future refactor collapsing them would route menu photos into the cafe's own database", () => {
  const src = stripComments(readSrc(IMAGE_UPLOAD));

  const brandingFnStart = src.indexOf("async function uploadBranding");
  assert.ok(brandingFnStart >= 0, "uploadBranding must exist");
  const brandingBraceOpen = src.indexOf("{", brandingFnStart);
  const brandingBraceClose = matchingBraceEnd(src, brandingBraceOpen);
  const brandingBody = src.slice(brandingBraceOpen + 1, brandingBraceClose);

  assert.match(
    brandingBody,
    /fetch\(`\/api\/branding\/\$\{slot\}`,\s*\{\s*method:\s*"PUT"/,
    "uploadBranding must PUT to /api/branding/<slot> directly",
  );
  assert.ok(
    !/\/api\/upload/.test(brandingBody),
    "uploadBranding must never call /api/upload — that path is the R2/Cloudinary grant flow, not the cafe-DB branding store",
  );

  const preparedFnStart = src.indexOf("async function uploadPrepared");
  assert.ok(preparedFnStart >= 0, "uploadPrepared must exist");
  const preparedBraceOpen = src.indexOf("{", preparedFnStart);
  const preparedBraceClose = matchingBraceEnd(src, preparedBraceOpen);
  const preparedBody = src.slice(preparedBraceOpen + 1, preparedBraceClose);

  assert.match(
    preparedBody,
    /apiSend<UploadGrant>\("\/api\/upload",\s*"POST"/,
    "uploadPrepared (product images) must still request a grant from /api/upload",
  );
  assert.ok(
    !/\/api\/branding/.test(preparedBody),
    "uploadPrepared must never call /api/branding — product images must not land in the cafe's own database",
  );

  // The dispatch itself: `slot ? uploadBranding(...) : uploadPrepared(...)` —
  // pinning the two functions alone proves nothing if the caller never
  // actually branches between them on `slot`.
  assert.match(
    src,
    /const ref = slot \? await uploadBranding\(slot, blob\) : await uploadPrepared\(blob\);/,
    "the upload dispatch must branch on `slot` between uploadBranding and uploadPrepared",
  );
});

// ── 10. AppSidebar falls back to the product logo, restaurant logo first ───

test("PIN: AppSidebar shows the restaurant logo first, then the saved product logo, then the unversioned branding route — never the product logo ahead of the restaurant's own mark", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));

  const logoUrlIdx = src.indexOf("const logoUrl = productImageUrl(settings.data?.logo,");
  const productLogoUrlIdx = src.indexOf("const productLogoUrl = productImageUrl(settings.data?.productLogo,");
  assert.ok(logoUrlIdx >= 0, "logoUrl must be derived from settings.data?.logo");
  assert.ok(productLogoUrlIdx > logoUrlIdx, "productLogoUrl must be derived (and declared after logoUrl) from settings.data?.productLogo");

  // Mutation this catches: reordering the `??` chain (e.g.
  // `productLogoUrl ?? logoUrl ?? brandingUrl(...)`) — the product's generic
  // mark would then permanently mask a cafe's own uploaded logo, since
  // `productLogoUrl` may resolve to a real URL more often than an unset
  // `logoUrl` would. Also catches dropping the final `brandingUrl("productLogo")`
  // link — an unbranded cafe with neither logo saved would then hand `<Image>`
  // a `null` src instead of the route that answers with the built-in mark.
  assert.match(
    src,
    /const displayLogoUrl = logoUrl \?\? productLogoUrl \?\? brandingUrl\("productLogo"\);/,
    'displayLogoUrl must try logoUrl (the restaurant\'s own mark) FIRST, then productLogoUrl, then brandingUrl("productLogo") only when both are unset',
  );
});

// ── 11. Login page has no session-bound dependency, and degrades gracefully ─

test("PIN: the login page renders its icon via brandingUrl (not a session-gated fetch), never imports useSettings, and has an onError fallback for a broken image", () => {
  const src = stripComments(readSrc(LOGIN_PAGE));

  // Mutation this catches: swapping brandingUrl for useSettings-derived data
  // — the login page has no session, so /api/settings (which requires one)
  // would 401 and the tab/login icon would never render.
  assert.match(
    src,
    /const productLogoSrc = brandingUrl\("productLogo"\);/,
    "the login page must derive its icon src from brandingUrl(\"productLogo\") — the unversioned, session-free route",
  );
  assert.ok(
    !/useSettings/.test(src),
    "the login page must never import or call useSettings — it has no session, and /api/settings requires one",
  );

  // Mutation this catches: dropping onError — a broken/failed image fetch
  // (e.g. the DB is down and getBrandingAsset threw) would then leave a
  // permanently broken <img> icon on the one screen every operator sees
  // before they can do anything else.
  assert.match(
    src,
    /onError=\{\(\) => setIconFailed\(true\)\}/,
    "the product logo <Image> must have an onError fallback that flips to the generic icon tile",
  );
});

// ── 12. BrandingAsset's slot and contentType are both closed enums ─────────

test("PIN: BrandingAsset's slot and contentType are both enum-constrained at the storage layer — a free-text slot would upsert a document no route's asSlot() could look back up, and a free-text contentType would let stored bytes be echoed to browsers under any Content-Type", () => {
  const src = stripComments(readSrc(BRANDING_ASSET_MODEL));

  assert.match(
    src,
    /slot:\s*\{\s*type:\s*String,\s*required:\s*true,\s*enum:\s*\[\.\.\.BRANDING_SLOTS\]\s*\}/,
    "slot must be declared with enum: [...BRANDING_SLOTS] — a crafted slot value would upsert a document no route's asSlot() would ever be able to look back up or prune",
  );
  assert.match(
    src,
    /contentType:\s*\{\s*type:\s*String,\s*required:\s*true,\s*enum:\s*Object\.keys\(IMAGE_CONTENT_TYPES\),?\s*\}/,
    "contentType must be declared with enum: Object.keys(IMAGE_CONTENT_TYPES) — a free-text value stored here is echoed verbatim as the response's Content-Type header",
  );
});

// ── 13. lib/branding.ts's content-type gates use Object.hasOwn, never `in` ──

test('PIN: lib/branding.ts\'s isSupportedBrandingType and hasMatchingSignature both gate their maps with Object.hasOwn (never the `in` operator), and hasMatchingSignature compares its check\'s result === true', () => {
  const src = stripComments(readSrc(BRANDING_LIB));

  const isSupportedStart = src.indexOf("export function isSupportedBrandingType");
  const hasMatchingStart = src.indexOf("export function hasMatchingSignature", isSupportedStart);
  const brandingVersionStart = src.indexOf("export function brandingVersion", hasMatchingStart);
  assert.ok(
    isSupportedStart >= 0 && hasMatchingStart > isSupportedStart && brandingVersionStart > hasMatchingStart,
    "isSupportedBrandingType and hasMatchingSignature must both exist, in this order",
  );

  const isSupportedBody = src.slice(isSupportedStart, hasMatchingStart);
  const hasMatchingBody = src.slice(hasMatchingStart, brandingVersionStart);

  // Mutation this catches (confirmed by probe elsewhere in this repo):
  // IMAGE_CONTENT_TYPES/SIGNATURE_CHECKS are plain object literals, so they
  // inherit Object.prototype — `"constructor" in SIGNATURE_CHECKS` is true
  // and `SIGNATURE_CHECKS["constructor"]` is a callable, truthy function. An
  // `in` check (or a bare index lookup) would let `Content-Type: constructor`
  // pass both gates and store arbitrary bytes on the app's own origin.
  assert.match(
    isSupportedBody,
    /Object\.hasOwn\(IMAGE_CONTENT_TYPES, contentType\)/,
    "isSupportedBrandingType must gate IMAGE_CONTENT_TYPES with Object.hasOwn",
  );
  assert.match(
    isSupportedBody,
    /Object\.hasOwn\(SIGNATURE_CHECKS, contentType\)/,
    "isSupportedBrandingType must also gate SIGNATURE_CHECKS with Object.hasOwn",
  );
  assert.ok(
    !/\bcontentType\s+in\s+(IMAGE_CONTENT_TYPES|SIGNATURE_CHECKS)\b/.test(isSupportedBody),
    'isSupportedBrandingType must never use the `in` operator on either map',
  );

  assert.match(
    hasMatchingBody,
    /Object\.hasOwn\(SIGNATURE_CHECKS, contentType\)/,
    "hasMatchingSignature must gate SIGNATURE_CHECKS with Object.hasOwn before indexing it",
  );
  assert.ok(
    !/\bcontentType\s+in\s+SIGNATURE_CHECKS\b/.test(hasMatchingBody),
    'hasMatchingSignature must never use the `in` operator on SIGNATURE_CHECKS',
  );
  // Mutation this catches: comparing truthily instead of `=== true` — a check
  // that somehow returned a truthy non-boolean would then pass.
  assert.match(
    hasMatchingBody,
    /SIGNATURE_CHECKS\[contentType\]\(bytes\) === true/,
    "hasMatchingSignature must compare its check's result === true, not merely truthy",
  );
});

// ── 14. putBrandingAsset's prune is additive, never destroying the saved version ──

test("PIN: putBrandingAsset's prune keeps BOTH the new version and the SAVED version, reads that saved ref UNCACHED (A14), and respects the grace window before deleting anything", () => {
  const src = stripComments(readSrc(BRANDING_LIB));
  const fnStart = src.indexOf("export async function putBrandingAsset");
  // putBrandingAsset is followed by the re-export of DEFAULT_PRODUCT_LOGO
  // (post-review file-size split moved its definition to its own file —
  // branding-default-logo.ts); that re-export line is this file's own next
  // section marker now.
  const nextSectionIdx = src.indexOf('export { DEFAULT_PRODUCT_LOGO }', fnStart);
  assert.ok(
    fnStart >= 0 && nextSectionIdx > fnStart,
    "putBrandingAsset must exist, followed by the built-in default section",
  );
  const fnBody = src.slice(fnStart, nextSectionIdx);

  assert.match(
    fnBody,
    /const keep = \[version\];/,
    "the prune's keep-list must start with the just-written version",
  );

  // A14: the active ref must be read fresh, never through readSettings() (the
  // 45s in-process cache) — a stale cached ref could disagree with what a
  // concurrent Settings save just committed and prune the version it points at.
  assert.ok(
    !/\breadSettings\s*\(/.test(fnBody),
    "putBrandingAsset must never call readSettings — its prune's active-ref read must be uncached",
  );
  assert.ok(
    !/\bresolveActiveVersion\s*\(/.test(fnBody),
    "putBrandingAsset must not delegate to resolveActiveVersion either — that function reads through the cached readSettings()",
  );
  assert.match(
    fnBody,
    /Settings\.findOne\(\)\s*\.select\(SLOT_SETTINGS_PROJECTION\[slot\]\)\s*\.lean\(\)/,
    "putBrandingAsset must read the active ref via a fresh, projected Settings.findOne().select(...).lean() — not the cached readSettings()",
  );
  assert.match(
    fnBody,
    /if \(active && active !== version\) keep\.push\(active\);/,
    "the saved active version must be pushed onto the keep-list whenever it differs from the new one",
  );

  // Mutation this catches: dropping the updatedAt grace clause — an upload a
  // concurrent Settings save is mid-flight toward could then be pruned before
  // that save lands, even though putBrandingAsset just read the ref uncached.
  assert.match(
    fnBody,
    /BrandingAsset\.deleteMany\(\{\s*slot,\s*version:\s*\{\s*\$nin:\s*keep\s*\},\s*updatedAt:\s*\{\s*\$lt:\s*new Date\(Date\.now\(\)\s*-\s*BRANDING_PRUNE_GRACE_MS\)\s*\},?\s*\}\);/,
    "the prune's deleteMany must scope to this slot, exclude everything in keep, AND only collect documents older than BRANDING_PRUNE_GRACE_MS — a wider deleteMany would prune other slots, and one with no grace clause could collect a concurrent fresh upload",
  );

  // Post-review count-bound (BRANDING_PRUNE_MAX_PENDING): the grace window
  // above only ever collects OLD orphans, so a burst of same-slot uploads
  // inside that window (auditioning several heroes before ever saving) would
  // otherwise grow a slot's document count without bound, since branding is a
  // set-once flow that may never upload to that slot again. Mutation this
  // catches: removing the second, age-INDEPENDENT pass — a slot's document
  // count would then have no hard ceiling at all.
  assert.match(
    fnBody,
    /BrandingAsset\.find\(\{ slot, version: \{ \$nin: keep \} \}\)\s*\.sort\(\{ updatedAt: -1 \}\)\s*\.skip\(BRANDING_PRUNE_MAX_PENDING\)/,
    "putBrandingAsset must ALSO query the slot's non-kept documents sorted newest-first, skip the newest BRANDING_PRUNE_MAX_PENDING, and delete the rest — an age-independent hard count bound on top of the grace window",
  );
});

// ── 14b. putBrandingAsset's active-ref reader (A8/A14): total, Object.hasOwn-gated, never a two-way ternary ──

test('PIN: lib/branding.ts resolves a slot\'s Settings ref via a total SLOT_REF_READERS map gated by Object.hasOwn — never a `slot === "logo" ?` two-way ternary, which cannot express a third slot', () => {
  const src = stripComments(readSrc(BRANDING_LIB));

  // Mutation this catches: reverting to `slot === "logo" ? settings?.logo :
  // settings?.productLogo` — a THIRD slot (heroImage) would then silently
  // resolve to productLogo's ref instead of its own nested appearance field.
  assert.ok(
    !/slot === "logo" \?/.test(src),
    'lib/branding.ts must not contain a `slot === "logo" ?` two-way ternary — it cannot express a third slot',
  );
  assert.match(
    src,
    /const SLOT_REF_READERS: Record<BrandingSlot, \(s: ISettings \| null\) => string \| undefined> = \{/,
    "lib/branding.ts must declare a total SLOT_REF_READERS map, one reader per BrandingSlot",
  );
  assert.match(
    src,
    /heroImage: \(s\) => s\?\.appearance\?\.heroImage,/,
    "the heroImage reader must read the NESTED appearance.heroImage field, not a top-level one",
  );
  assert.match(
    src,
    /if \(!Object\.hasOwn\(SLOT_REF_READERS, slot\)\) return undefined;/,
    "the reader-map lookup must be gated by Object.hasOwn, matching every other map lookup in this file (SIGNATURE_CHECKS)",
  );
});

// ── 15. middleware.ts's matcher excludes /api — GET /api/branding depends on it ──

test('PIN: middleware.ts\'s matcher excludes /api via a negative lookahead — GET /api/branding being public depends on the request never reaching the auth guard at all, not only on the route file', () => {
  const src = stripComments(readSrc(MIDDLEWARE_FILE));

  // Mutation this catches: narrowing or dropping the `api` exclusion from the
  // negative lookahead — /api routes would then be routed through the auth
  // guard first, and the login page's tab icon plus the browser's bare
  // /favicon.ico probe (both session-free) would be redirected to /login
  // instead of getting image bytes.
  assert.match(
    src,
    /matcher:\s*\[\s*"\/\(\(\?!api\|_next\/static\|_next\/image\|favicon\.ico\)\.\*\)"\s*\]/,
    'middleware.ts\'s matcher must be `["/((?!api|_next/static|_next/image|favicon.ico).*)"]`',
  );
});

// ── 16. The product-image path also gates IMAGE_CONTENT_TYPES with Object.hasOwn ──

test('PIN: /api/upload\'s grant schema and lib/r2.ts\'s presignProductImagePut both gate IMAGE_CONTENT_TYPES with Object.hasOwn, not `in` or a bare lookup — the same inherited-key hazard as the branding gates, on the product-image path', () => {
  const uploadSrc = stripComments(readSrc(UPLOAD_ROUTE));
  assert.match(
    uploadSrc,
    /Object\.hasOwn\(IMAGE_CONTENT_TYPES, t\)/,
    "the upload grant schema's contentType refine must gate IMAGE_CONTENT_TYPES with Object.hasOwn",
  );
  assert.ok(
    !/\bt\s+in\s+IMAGE_CONTENT_TYPES\b/.test(uploadSrc),
    'the upload grant schema must never fall back to the `in` operator on IMAGE_CONTENT_TYPES',
  );

  const r2Src = stripComments(readSrc(R2_LIB));
  assert.match(
    r2Src,
    /Object\.hasOwn\(IMAGE_CONTENT_TYPES, contentType\)/,
    "presignProductImagePut must gate IMAGE_CONTENT_TYPES with Object.hasOwn before indexing it for the file extension",
  );
  assert.ok(
    !/\bcontentType\s+in\s+IMAGE_CONTENT_TYPES\b/.test(r2Src),
    'presignProductImagePut must never fall back to the `in` operator on IMAGE_CONTENT_TYPES',
  );
});
