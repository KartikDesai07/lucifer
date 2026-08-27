import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { publicCartTotals, type PublicGstConfig } from "@pos/shared/public";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import { stripComments } from "@/lib/source-pin-utils";

// CR2.1 adversarial-review regression pins. Every pin here corresponds to a
// defect (or an unpinned load-bearing behaviour) the review of the public
// QR-menu surface actually surfaced — they are the net that keeps those exact
// mistakes from shipping twice. Same source-read technique as
// public-surface-paths.test.ts, which holds the surface's ORIGINAL pins; this
// file exists separately only because that one sits at the ~300-line cap.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Pins forbid/require CODE shapes — a comment explaining a rule must not trip
// the pin that enforces it (bit this repo once already).

const PUBLIC_MENU_LIB = "apps/cafe/lib/public-menu.ts";
const MENU_ROUTE = "apps/cafe/app/api/public/menu/route.ts";
const TABLE_TOKEN_ROUTE = "apps/cafe/app/api/public/table/[token]/route.ts";
const PUBLIC_TABLES_ROUTE = "apps/cafe/app/api/public/tables/route.ts";
const MINT_ROUTE = "apps/cafe/app/api/tables/[tableNo]/token/route.ts";
const QR_PAGE = "apps/cafe/app/(dashboard)/tables/qr/page.tsx";
const QR_SHEET = "apps/cafe/components/tables/QrSheet.tsx";
const TABLES_PAGE = "apps/cafe/app/(dashboard)/tables/page.tsx";

// ── 1. The menu route's .select() mirrors PublicProductSource exactly ────────

test("PIN: GET /api/public/menu's .select() carries every PublicProductSource field — the projection boundary can't leak, but an under-fetch would silently null a diner-visible field", () => {
  const lib = stripComments(readSrc(PUBLIC_MENU_LIB));
  const route = stripComments(readSrc(MENU_ROUTE));

  const ifaceMatch = lib.match(/interface PublicProductSource \{([\s\S]*?)\n\}/);
  assert.ok(ifaceMatch, "PublicProductSource must exist in lib/public-menu.ts");
  const ifaceFields = [...ifaceMatch[1].matchAll(/^\s*(\w+)\??:/gm)]
    .map((m) => m[1])
    .filter((f) => f !== "_id"); // _id rides the lean doc; never in .select()

  // Anchored to Product.find — the route's FIRST .select() belongs to the
  // Category query and must not satisfy this pin.
  const selectMatch = route.match(/Product\.find\(PUBLIC_PRODUCT_FILTER\)[\s\S]*?\.select\("([^"]+)"\)/);
  assert.ok(selectMatch, "the menu route must .select() a literal field list on the Product query");
  const selected = selectMatch[1].split(/\s+/);

  // Mutation this catches: adding a field to PublicProductSource (so
  // toPublicMenuItem starts reading it) without widening the route's
  // .select() — lean() would hand the mapper `undefined` and the public menu
  // would ship e.g. every item nameless or priceless, with tsc none the wiser.
  assert.deepEqual(
    selected.sort(),
    ifaceFields.sort(),
    "the .select() list and PublicProductSource must name the same fields",
  );
});

// ── 2. The mint/regenerate route stays admin-only ─────────────────────────────

test("PIN: POST /api/tables/[tableNo]/token guards with requireAdmin — re-minting invalidates a printed sticker, the one destructive write CR2.1 added", () => {
  const src = stripComments(readSrc(MINT_ROUTE));

  // Mutation this catches: swapping requireAdmin for requireAuth (or dropping
  // the guard while refactoring) — any staff login could then silently kill
  // every printed sticker in the room, and nothing else pins this route (the
  // middleware matcher excludes /api entirely).
  assert.match(
    src,
    /const authed = await requireAdmin\(\);/,
    "the token route must call requireAdmin before minting",
  );
  assert.ok(
    !src.includes("requireAuth("),
    "the token route must not fall back to the weaker requireAuth",
  );
});

// ── 3. restaurantName is picked, never spread ─────────────────────────────────

test("PIN: the menu route reads ONLY settings.restaurantName, settings.allowTableChange, settings.gstEnabled, settings.gstRate and settings.gstMode, and never spreads the Settings doc — the doc carries FSSAI/owner mobile, none of which may reach the internet", () => {
  const src = stripComments(readSrc(MENU_ROUTE));

  // Mutation this catches: a future `...settings` (or an extra field picked
  // without a decision) — readSettings() returns the FULL lean Settings doc,
  // so a spread would publish the cafe's FSSAI number and the owner's mobile
  // on an unauthenticated route.
  assert.ok(!src.includes("...settings"), "the Settings doc must never be spread into the payload");
  assert.match(
    src,
    /restaurantName: settings\?\.restaurantName \?\? ""/,
    "restaurantName must be the one explicitly picked Settings field",
  );
  assert.match(
    src,
    /allowTableChange: settings\?\.allowTableChange \?\? true/,
    "allowTableChange must be picked with a true fallback (CR2.2) — selfOrderMode/showPastOrdersToDiner stay server-side",
  );
  // CR2.2 review FIX1: the gst block, picked field-by-field like the two
  // above — never a spread of a `GstConfig`-shaped object either.
  assert.match(src, /enabled: settings\?\.gstEnabled \?\? false/, "gst.enabled must fall back to false");
  assert.match(src, /rate: settings\?\.gstRate \?\? 0/, "gst.rate must fall back to 0");
  assert.match(src, /mode: settings\?\.gstMode \?\? "inclusive"/, "gst.mode must fall back to inclusive");
  const settingsReads = src.match(/settings\?\.(\w+)/g) ?? [];
  assert.deepEqual(
    [...new Set(settingsReads)].sort(),
    [
      "settings?.allowTableChange",
      "settings?.gstEnabled",
      "settings?.gstMode",
      "settings?.gstRate",
      "settings?.restaurantName",
    ],
    "no OTHER Settings field may be read into this route",
  );
});

// ── 3b. publicCartTotals ≡ computeOrderTotals at zero discount ─────────────

test("PARITY: publicCartTotals (shared, diner-display) matches computeOrderTotals (server, the real bill) over the full {inclusive,exclusive,disabled} x {rate} x {charge} x {subtotal} grid at zero discount — any drift here is the cart quietly showing a total the kitchen will not actually charge", () => {
  const gstShapes: Array<{ enabled: boolean; mode: "inclusive" | "exclusive" }> = [
    { enabled: true, mode: "inclusive" },
    { enabled: true, mode: "exclusive" },
    { enabled: false, mode: "inclusive" }, // disabled — mode is irrelevant when enabled is false
  ];
  const rates = [0, 5, 18];
  const charges = [0, 20];
  const subtotals = [0, 199, 200, 201];

  for (const { enabled, mode } of gstShapes) {
    for (const rate of rates) {
      for (const charge of charges) {
        for (const subtotal of subtotals) {
          const gst: PublicGstConfig = { enabled, rate, mode };
          const cfg: GstConfig = { gstEnabled: enabled, gstRate: rate, gstMode: mode };
          const label = `enabled=${enabled} mode=${mode} rate=${rate} charge=${charge} subtotal=${subtotal}`;

          const shared = publicCartTotals(subtotal, charge, gst);
          const real = computeOrderTotals({
            items: [{ price: subtotal, qty: 1 }],
            discount: 0,
            charge,
            cfg,
          });

          assert.equal(shared.gstAmount, real.gstAmount, `gstAmount drift at ${label}`);
          assert.equal(shared.total, real.total, `total drift at ${label}`);
        }
      }
    }
  }
});

// ── 4. Cache headers: exact success literals, no-store on every non-success ──

test("PIN: public cache headers — spec literals on success, and every 404/503 goes out no-store so a transient failure or miss is never served after it stopped being true", () => {
  const menu = stripComments(readSrc(MENU_ROUTE));
  const tables = stripComments(readSrc(PUBLIC_TABLES_ROUTE));
  const tableToken = stripComments(readSrc(TABLE_TOKEN_ROUTE));

  // Mutation this catches (success side): weakening `private, max-age=0,
  // must-revalidate` on the charge route — a stale cached charge is a price
  // the diner never consented to (CCPA, D4a) — or dropping the menu's
  // burst-buffer headers and letting every scan hit the M0.
  assert.ok(menu.includes('"public, max-age=30, stale-while-revalidate=60"'), "menu success Cache-Control literal");
  assert.ok(tables.includes('"public, max-age=30, stale-while-revalidate=60"'), "tables success Cache-Control literal");
  assert.ok(tableToken.includes('"private, max-age=0, must-revalidate"'), "table-charge success Cache-Control literal");

  // Mutation this catches (error side): returning the catch path through the
  // success-header helper again — an explicit max-age makes even a 503
  // storable (RFC 9111), so a one-second Mongo hiccup would be re-served to
  // diners for the full cache window after recovery.
  for (const [name, src] of [["menu", menu], ["tables", tables]] as const) {
    const catchAt = src.indexOf("catch (error)");
    const noStoreAt = src.indexOf('"no-store"');
    assert.ok(catchAt >= 0 && noStoreAt > catchAt, `${name} route: the catch path must set Cache-Control no-store`);
  }
  assert.ok(tableToken.includes('"no-store"'), "table route: noStore helper must exist");
  const wrapped404s = tableToken.match(/noStore\(notFound\(/g) ?? [];
  assert.equal(wrapped404s.length, 2, "BOTH table-route 404s (bad shape, no match) must be wrapped in noStore — a bare 404 is heuristically cacheable and a freshly minted token must resolve on the very next scan");
  assert.match(tableToken, /noStore\(serverError\(/, "the table route's 503 must be wrapped in noStore");
});

// ── 5. The QR sheet prints through react-to-print isolation ───────────────────

test("PIN: /tables/qr prints via react-to-print's isolated iframe, never window.print() — a whole-document print puts the admin sidebar/header on the sticker sheet", () => {
  const page = stripComments(readSrc(QR_PAGE));
  const sheet = stripComments(readSrc(QR_SHEET));

  // Mutation this catches: reverting to the one-liner window.print() (the
  // original defect) — the (dashboard) layout has no print CSS, so the first
  // A4 sheet gains the header band and, viewport permitting, the sidebar.
  assert.ok(!page.includes("window.print("), "the QR page must not print the whole document");
  assert.ok(!sheet.includes("window.print("), "QrSheet must not print the whole document");
  assert.match(page, /useReactToPrint\(\{/, "the QR page must use react-to-print");
  assert.match(page, /contentRef: sheetRef/, "the print job must target the sheet subtree only");
  assert.match(page, /pageStyle: QR_PRINT_STYLE/, "the A4 @page rules must ride pageStyle into the ISOLATED iframe");
  assert.ok(!sheet.includes("<style>"), "QrSheet must not inject print CSS into the dashboard document — it belongs to the print iframe");
});

// ── 6. The QR surface is reachable and the mint seam has a caller ─────────────

test("PIN: the Tables page links to /tables/qr and QrSheet drives useMintTableToken — without both, no pre-CR2 table can EVER get a QR and the sheet is reachable only by typed URL", () => {
  const tablesPage = stripComments(readSrc(TABLES_PAGE));
  const sheet = stripComments(readSrc(QR_SHEET));

  // Mutation this catches: the original review finding — useMintTableToken
  // shipped with ZERO call sites and no navigation reached /tables/qr, so
  // CR2.1's deliverable ("stickers go on the tables") was unattainable for
  // every existing table and a tampered sticker could never be revoked.
  assert.match(tablesPage, /href="\/tables\/qr"/, "the Tables page must link to the QR sheet");
  assert.match(sheet, /const mint = useMintTableToken\(\);/, "QrSheet must instantiate the mint hook");
  assert.match(sheet, /mint\.mutate\(table\.tableNo\)/, "a token-less table must offer first-mint");
  assert.match(sheet, /mint\.mutateAsync\(regenerating\.tableNo\)/, "a tokened table must offer regenerate");
  // The hook's own contract (hooks/use-tables.ts): regeneration invalidates
  // the printed sticker, so the calling dialog must say so.
  assert.match(sheet, /ConfirmDialog/, "regenerate must go through a confirmation dialog");
});
