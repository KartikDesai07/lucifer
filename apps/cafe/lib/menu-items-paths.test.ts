import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { STAFF_PRODUCT_BULK_ACTIONS } from "@pos/shared/schemas";
import { MENU_CHIPS_CLASS, MENU_LIST_SCROLLER_CLASS, MENU_PAGE_CLASS } from "@/lib/menu-layout";

// Slice B source pins (Menu redesign, 2026-09-30) — the Items page, its
// admin/staff gating, the icon render order, and the editor's icon sentinel.
// Each pin below was mutation-tested by temporarily breaking the named source
// file and confirming the assertion fails for the stated reason.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const ITEM_ROW_MENU = "apps/cafe/components/menu/ItemRowMenu.tsx";
const ITEM_CARDS = "apps/cafe/components/menu/ItemCards.tsx";
const ITEMS_TABLE = "apps/cafe/components/menu/ItemsTable.tsx";
const ITEMS_TOOLBAR = "apps/cafe/components/menu/ItemsToolbar.tsx";
const BULK_BAR = "apps/cafe/components/menu/BulkBar.tsx";
const PRODUCTS_PAGE = "apps/cafe/app/(dashboard)/products/page.tsx";
const ITEMS_PAGE_STATE = "apps/cafe/hooks/use-items-page-state.ts";
const ITEM_ART = "apps/cafe/components/menu/ItemArt.tsx";
const PRODUCT_CARD = "apps/cafe/components/pos/ProductCard.tsx";
const PUBLIC_INITIAL_TILE = "apps/cafe/components/public/PublicInitialTile.tsx";
const PRODUCT_FORM_SHEET = "apps/cafe/components/products/ProductFormSheet.tsx";

// ── C17 replacement: archived items keep Edit + Restore, on BOTH surfaces ──

test("PIN: ItemRowMenu renders Edit UNCONDITIONALLY (before the archived ternary) plus Restore (not Archive) when archived — the C17 replacement, G8", () => {
  const src = stripComments(readSrc(ITEM_ROW_MENU));
  assert.match(src, /archived\s*\?/, "positive landmark: ItemRowMenu must branch on the archived prop");
  assert.match(src, /onRestore\(product\)/, "ItemRowMenu must call onRestore in its archived branch");
  assert.match(src, /ArchiveRestore/, "ItemRowMenu must use the ArchiveRestore icon for the archived branch");
  // Mutation this catches: removing the archived branch entirely, which would
  // leave every row -- even an archived one -- offering only Archive again,
  // silently reintroducing C17 (an archived item unreachable for re-homing).
  assert.match(src, /onArchive\(product\)/, "positive landmark: the non-archived branch must still offer Archive");
  // G8 — Edit must sit BEFORE the archived ternary (rendered on every row,
  // not moved inside just the non-archived branch). Mutation this catches:
  // hoisting Edit into only the `archived ? (...) : (` branch, which would
  // silently drop Edit from every archived row while this file's other
  // assertions above still pass.
  const editIdx = src.indexOf("onEdit(product)");
  const ternaryIdx = src.search(/archived\s*\?/);
  assert.ok(editIdx >= 0 && ternaryIdx >= 0, "both onEdit(product) and the archived ternary must be present");
  assert.ok(editIdx < ternaryIdx, "onEdit(product) must appear BEFORE the archived ternary — Edit must render on every row, archived or not");
});

test("PIN: ItemCards mounts the admin ItemRowMenu (the C17 replacement covers the phone surface too)", () => {
  const src = stripComments(readSrc(ITEM_CARDS));
  assert.match(src, /<ItemRowMenu\b/, "ItemCards.tsx must mount ItemRowMenu — the ux-owner-fidelity MAJOR finding: a phone admin had no Edit/Archive/Restore reach at all");
  assert.match(src, /isAdmin\s*&&\s*!selectMode/, "the ItemRowMenu mount must be gated to admin AND out of Select mode (a select-mode tap toggles selection, not the menu)");
});

// ── R13 / G4: phone tap opens the editor (admin) or toggles selection ───────

test("PIN: ItemCards — a tap toggles selection in Select mode for EVERY role (G4), opens the editor for an admin outside it, and is a no-op for staff outside it", () => {
  const src = stripComments(readSrc(ITEM_CARDS));
  assert.match(
    src,
    /if\s*\(selectMode\)\s*\{\s*onToggleSelect\(product\._id\);\s*return;\s*\}/,
    "Select mode must toggle selection and return BEFORE any role check — this must fire for staff too",
  );
  assert.match(src, /if\s*\(isAdmin\)\s*onEdit\(product\);/, "outside Select mode, only an admin tap opens the editor");
  // Mutation this catches: the pre-fix-round shape gated the WHOLE handler on
  // isAdmin first (`if (!isAdmin) return;`), which made Select mode itself
  // unreachable for staff — exactly the G4 defect.
  assert.ok(!/if\s*\(!isAdmin\)\s*return;/.test(src), "the handler must NOT bail out on staff before checking selectMode (that was the G4 bug)");
});

test("PIN: ItemCards' In stock switch stops propagation (must not also fire the card's tap handler)", () => {
  const src = stripComments(readSrc(ITEM_CARDS));
  assert.match(
    src,
    /onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}\s*\n\s*aria-label=\{`In stock/,
    "the In stock Switch must call e.stopPropagation() on click, immediately before its aria-label prop",
  );
});

test("PIN: N5 — ItemCards' card carries no role=\"button\" / tabIndex / onKeyDown (pointer-only tap convenience; a Checkbox and a Switch already live inside it, and staff now reach it too — nesting an implicit-role interactive card around them is a nested-interactive a11y violation)", () => {
  const src = stripComments(readSrc(ITEM_CARDS));
  assert.match(src, /onClick=\{handleTap\}/, "positive landmark: the pointer onClick convenience must remain");
  assert.ok(!/role=\{tappable \? "button"/.test(src), 'the card must not conditionally render role="button"');
  assert.ok(!/tabIndex=\{tappable \? 0/.test(src), "the card must not conditionally render a tabIndex");
  assert.ok(!/onKeyDown=\{/.test(src), "the card must carry no onKeyDown handler at all — keyboard users select via the Checkbox and edit via the ⋯ menu's Edit item");
});

test("PIN: G11 — ItemCards shows the struck-through raw price on a discount, same rule as ItemsTable's PriceCell (R11)", () => {
  const src = stripComments(readSrc(ITEM_CARDS));
  assert.match(src, /price\.discount > 0 &&/, "ItemCards must branch on price.discount > 0, the same predicate PriceCell uses");
  assert.match(src, /text-muted-foreground line-through/, "the raw price must render with the line-through class");
});

// ── Admin gating: ⋯ / Import / Add / empty-state CTAs ──────────────────────

// Moved on purpose (U5 Task 1; menu P62 / P63): Add item is the shared MenuPageHeader's action (with the view switch) and
// Import CSV is the toolbar's, where the HTML's Veg control sits (owner Q5). Same meaning: admin only, both.
test("PIN: the Items page shows Import CSV + Add item only inside an isAdmin branch", () => {
  const header = stripComments(readSrc("apps/cafe/components/menu/MenuPageHeader.tsx"));
  assert.match(header, /Add item/, "positive landmark: Add item must still exist");
  assert.match(header, /actions=\{isAdmin && \(\s*<>\s*<MenuViewSwitch/, "the switch and Add must be gated behind isAdmin &&, not rendered unconditionally");
  const toolbar = stripComments(readSrc(ITEMS_TOOLBAR));
  assert.match(toolbar, /Import CSV/, "positive landmark: Import CSV must still exist");
  assert.equal((toolbar.match(/\{isAdmin && \(\s*<button type="button" data-ui="menu-import/g) ?? []).length, 2, "both Import CSV buttons (the label and the phone's icon) are gated behind isAdmin &&");
  const page = stripComments(readSrc(PRODUCTS_PAGE));
  assert.match(page, /onImport=\{\(\) => setImportOpen\(true\)\}/, "the toolbar's Import opens the import wizard");
});

test("PIN: ItemsTable renders the checkbox column for EVERY role (G4 — staff need it to reach the two stock bulk actions), but keeps the QR switch and row menu admin-only (staff see a read-only QR label, no menu)", () => {
  const src = stripComments(readSrc(ITEMS_TABLE));
  // G4: the checkbox column header and each row's Checkbox must NOT be
  // isAdmin-gated — mutation this catches: re-adding an `isAdmin &&` guard
  // around either, which would make the staff bulk actions unreachable again.
  assert.match(src, /<TableHead className="w-10" \/>/, "the selection checkbox column header must exist");
  assert.ok(!/\{isAdmin\s*&&\s*<TableHead className="w-10"/.test(src), "the checkbox column header must NOT be gated behind isAdmin");
  assert.match(src, /<Checkbox\s*\n\s*className=\{BRAND_CHECKBOX_SQUARE_CLASS\}/, "every row must render a Checkbox");
  assert.ok(!/\{isAdmin\s*&&\s*\(\s*<TableCell>\s*<Checkbox/.test(src), "the row Checkbox must NOT be gated behind isAdmin");
  assert.match(src, /isAdmin\s*\?\s*\(\s*<Switch/, "the QR column must render a live Switch only when isAdmin");
  assert.match(src, />\{qrVisible \? "Shown" : "Hidden"\}<\/span>/, "R20: staff must see a read-only Shown/Hidden label, not a disabled switch");
  assert.match(src, /\{isAdmin\s*&&\s*\(\s*<TableCell className="text-right">\s*<ItemRowMenu/, "the ⋯ row menu column must be admin-only");
});

test("PIN: ItemCards shows the Select checkbox for EVERY role once Select mode is on (G4), but the ⋯ row menu stays admin-only", () => {
  const src = stripComments(readSrc(ITEM_CARDS));
  assert.match(src, /\{selectMode\s*&&\s*\(\s*<Checkbox/, "the card checkbox must render whenever selectMode is on, regardless of role");
  assert.ok(!/\{isAdmin\s*&&\s*selectMode\s*&&\s*\(\s*<Checkbox/.test(src), "the card checkbox must NOT additionally require isAdmin");
  assert.match(src, /\{isAdmin\s*&&\s*!selectMode\s*&&\s*\(\s*<ItemRowMenu/, "the ⋯ row menu must stay admin-only");
});

test("PIN: ItemsToolbar hides the Archived status option from staff but shows the phone Select toggle to EVERY role (G4)", () => {
  const src = stripComments(readSrc(ITEMS_TOOLBAR));
  // Moved on purpose (U5 Task 1; menu P20 / P21 / P24): the status control is the filter select now, same rule.
  assert.match(
    src,
    /options\s*=\s*FILTER_ORDER\.filter\(\(f\)\s*=>\s*f\s*!==\s*"archived"\s*\|\|\s*isAdmin\)/,
    "the filter option list must filter out 'archived' for non-admins",
  );
  // G4 — a staff member must be able to enter Select mode too (it's their
  // only way to reach the two stock bulk actions), so this button must NOT
  // be isAdmin-gated. Mutation this catches: re-adding `{isAdmin && (` around
  // the phone Select toggle.
  assert.match(src, /onClick=\{onToggleSelectMode\}/, "the phone Select toggle's onClick must exist");
  assert.ok(!/\{isAdmin\s*&&\s*\(\s*<Button[\s\S]{0,120}onToggleSelectMode/.test(src), "the phone Select toggle must NOT be gated behind isAdmin");
});

// ── Staff QR read-only (R20) + bulk actions ⊆ STAFF_PRODUCT_BULK_ACTIONS ────

test("PIN: BulkBar only offers Move/Archive (and lg+ inline duplicates) inside isAdmin branches — staff get just the two stock actions", () => {
  const src = stripComments(readSrc(BULK_BAR));
  assert.match(src, /Out of stock/, "positive landmark: the out-of-stock action must exist");
  assert.match(src, /In stock/, "positive landmark: the in-stock action must exist");
  assert.match(
    src,
    /\{isAdmin\s*&&\s*!archived\s*&&\s*\(/,
    "Move/Archive (and the More menu holding them) must be gated behind isAdmin && !archived",
  );
  // Vision guard on the shared source of truth: the two actions BulkBar always
  // offers must be exactly STAFF_PRODUCT_BULK_ACTIONS — if a route ever adds a
  // third staff-safe action without updating this component, that drift shows
  // up as a real UI/contract mismatch, not a passing-by-accident test.
  assert.deepEqual(
    [...STAFF_PRODUCT_BULK_ACTIONS].sort(),
    ["in-stock", "out-of-stock"],
    "STAFF_PRODUCT_BULK_ACTIONS must be exactly the two stock actions BulkBar always renders",
  );
});

test("PIN: BulkBar disables every action once the selection exceeds PRODUCT_BULK_MAX, with the capped-selection message built from the constant", () => {
  const src = stripComments(readSrc(BULK_BAR));
  assert.match(src, /const overCap = count > PRODUCT_BULK_MAX;/, "BulkBar must compare the selection count against PRODUCT_BULK_MAX");
  assert.match(
    src,
    /Select up to \{PRODUCT_BULK_MAX\} items at a time\./,
    "the capped-selection message must be built from the PRODUCT_BULK_MAX constant, not a hardcoded number",
  );
  assert.match(src, /disabled\s*=\s*isPending\s*\|\|\s*overCap;/, "every action button must read the combined disabled flag");
});

// ── Icon render order: photo, then icon, then initial ───────────────────────

test("PIN: ItemArt renders photo, then icon, then the name's initial, in that order", () => {
  const src = stripComments(readSrc(ITEM_ART));
  const photoIdx = src.indexOf("if (url && !failed)");
  const iconIdx = src.indexOf("productIconComponent(icon)");
  const initialIdx = src.indexOf('name.charAt(0).toUpperCase()');
  assert.ok(photoIdx >= 0 && iconIdx >= 0 && initialIdx >= 0, "all three fallback stages must be present in ItemArt.tsx");
  assert.ok(iconIdx < photoIdx, "productIconComponent must be computed before the photo branch returns (available for the fallback)");
  assert.match(src, /\{Icon \? <Icon[^/]*\/> : name\.charAt\(0\)\.toUpperCase\(\) \|\| "/, "the no-photo branch must render the icon when present, else the initial");
});

// U1 Task 3 (owner Q6, design 6.4): the /pos card is the owner's HTML card — the item's photo in the HTML's photo area
// when it has one, nothing otherwise (the 40px thumbnail with its icon / initial fallback is gone from the POS; the
// Items page's ItemArt keeps the three stages above).
test("PIN: ProductCard shows the item's photo in the HTML's photo area, or nothing — no icon / initial fallback", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.ok(src.includes("const photo = productImageUrl(product.image, CARD_PHOTO_PX, { fit: true });"), "the photo is the stored image ref, resolved by lib/images.ts (scaled to fit, cropped once by the box)");
  assert.ok(src.includes("{photo && ("), "the area renders only when there is a photo");
  assert.ok(!src.includes("productIconComponent"), "no icon fallback on the POS card");
  assert.ok(!src.includes("charAt(0)"), "no initial fallback on the POS card");
});

test("PIN: PublicInitialTile renders photo, then icon, then the initial (in the no-photo/failed branch)", () => {
  const src = stripComments(readSrc(PUBLIC_INITIAL_TILE));
  assert.match(src, /const Icon = productIconComponent\(icon\);/, "PublicInitialTile must resolve the icon prop via productIconComponent");
  assert.match(
    src,
    /\{Icon \? <Icon className="h-\[55%\] w-\[55%\]" \/> : initialOf\(name\)\}/,
    "the tile's fallback span must render the icon when present, else initialOf(name)",
  );
  // Vision guard: the photo branch must still return before this fallback is
  // reached — otherwise "photo then icon" would be unreachable order, not a
  // live one.
  assert.match(src, /if \(url && !failed\) \{/, "positive landmark: the photo branch must still short-circuit ahead of the icon/initial fallback");
});

// ── Editor: icon ?? null sentinel (create sends only when chosen) ──────────

test('PIN: ProductFormSheet sends `icon: values.icon ?? null` on every edit submit (the explicit-clear sentinel, same pattern as variations/publicVisible)', () => {
  const src = stripComments(readSrc(PRODUCT_FORM_SHEET));
  assert.match(src, /icon:\s*values\.icon\s*\?\?\s*null/, "the edit submit's update payload must send icon: values.icon ?? null");
  // Vision guard: the create path must NOT send this sentinel (the create
  // schema's icon is a plain optional enum with no null branch) — it must
  // spread `values`, whose icon is undefined (omitted) unless chosen.
  assert.match(src, /await createProduct\.mutateAsync\(\{\s*\.\.\.values,/, "create must spread values (icon sent only when chosen, never forced to null)");
});

test("PIN: ProductFormSheet resets an unknown stored icon to undefined via isProductIconKey (a stale key must not resend and 400)", () => {
  const src = stripComments(readSrc(PRODUCT_FORM_SHEET));
  assert.match(
    src,
    /icon:\s*isProductIconKey\(product\.icon\)\s*\?\s*product\.icon\s*:\s*undefined,/,
    "the form reset must narrow product.icon through isProductIconKey, falling back to undefined",
  );
});

// ── Fix round (browser pass + adversarial review, 2026-09-30) ──────────────

const MOVE_ITEMS_DIALOG = "apps/cafe/components/menu/MoveItemsDialog.tsx";
const ITEMS_LIST_SECTION = "apps/cafe/components/menu/ItemsListSection.tsx";
const MENU_ITEMS_LIB = "apps/cafe/lib/menu-items.ts";

test("PIN: G12 — MoveItemsDialog resets its category selection on OPEN (an effect keyed on `open`), not only on close", () => {
  const src = stripComments(readSrc(MOVE_ITEMS_DIALOG));
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*if \(open\) setCategoryId\(""\);\s*\}, \[open\]\);/,
    "an effect must clear categoryId whenever `open` becomes true",
  );
  // Mutation this catches: the pre-fix-round shape only cleared categoryId
  // inside the Dialog's own onOpenChange(next) when `next` was false (i.e.
  // on CLOSE), which never re-ran when the dialog was reopened for a second
  // bulk selection while the same mounted instance stayed alive.
  assert.ok(!/if \(!next\) setCategoryId\(""\);/.test(src), "the old close-only reset must be gone");
});

test("PIN: G13 — ItemArt resets its broken-image `failed` flag when the image ref changes", () => {
  const src = stripComments(readSrc(ITEM_ART));
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*setFailed\(false\);\s*\}, \[image\]\);/,
    "an effect keyed on the image prop must reset failed to false",
  );
});

test("PIN: G18 — the Items page's full-page ErrorState uses item-worded copy and retryLabel=\"Try again\"", () => {
  const src = stripComments(readSrc(ITEMS_LIST_SECTION));
  assert.match(src, /title="Couldn't load items"/, "the full ErrorState must use item-worded title copy");
  assert.match(src, /retryLabel="Try again"/, "the full ErrorState must pass retryLabel=\"Try again\"");
});

test("PIN: G20 — BulkBar's action row carries flex-wrap as an overflow safety net", () => {
  const src = stripComments(readSrc(BULK_BAR));
  assert.match(src, /className="flex w-full min-w-0 flex-wrap items-center gap-2"/, "the bulk bar's action row must include flex-wrap");
});

test("PIN: item 1 — the one horizontally scrolling row (the phone's category chips) is contained ([contain:inline-size] on its own overflow-x-auto box), and the frame down to it never stretches", () => {
  // Moved on purpose (U5 Task 1; menu P20-P24, the chip row's pin): the status segmented control is a select now, so one
  // scroll box is left, the chips; the paper shell's min-w-0 column is the Menu frame (no scroll of its own) and the list
  // column (min-w-0, overflow-x clip) the chips live in. Same meaning: nothing in the toolbar can widen the page.
  const tokens = (cls: string): string[] => cls.split(/\s+/);
  assert.ok(tokens(MENU_CHIPS_CLASS).includes("overflow-x-auto") && tokens(MENU_CHIPS_CLASS).includes("[contain:inline-size]"), "the chip row's scroll box carries [contain:inline-size]");
  const toolbar = stripComments(readSrc(ITEMS_TOOLBAR));
  assert.equal([...toolbar.matchAll(/overflow-x-auto/g)].length, 0, "ItemsToolbar draws no scroll box of its own: the chip row is its own component");
  assert.ok(tokens(MENU_LIST_SCROLLER_CLASS).includes("min-w-0") && tokens(MENU_LIST_SCROLLER_CLASS).includes("overflow-x-clip"), "the list column carries min-w-0 and clips sideways");
  assert.ok(tokens(MENU_PAGE_CLASS).includes("overflow-hidden"), "the page frame never scrolls or stretches");
  assert.match(toolbar, /flex min-w-0|MENU_TOOLBAR_START_CLASS/, "the toolbar's start group is min-w-0");
});

test("PIN: N4 — the status control is a FILTER (one kit select driving the filter and the view), never role=tablist/tab (which carries a roving-tabindex/arrow-key/tabpanel contract this control doesn't implement)", () => {
  // Moved on purpose (U5 Task 1; menu P20 / P21 / P24): the segmented group became the HTML's filter select (a kit dropdown);
  // it is still a filter, never tabs, and still ONE control for the status filter and the active / archived view.
  const src = stripComments(readSrc(ITEMS_TOOLBAR));
  assert.match(src, /ariaLabel="Show"[\s\S]{0,80}value=\{isArchived \? "archived" : status\}/, "the filter select shows the status, Archived while that view is on");
  assert.match(src, /onValueChange=\{\(v\) => onStatusChange\(v as MenuStatusFilter\)\}/, "and routes every pick through the one status handler");
  assert.ok(!/role="tablist"/.test(src), 'role="tablist" must not appear — this is a filter, not a tab panel switch');
  assert.ok(!/role="tab"/.test(src), 'role="tab" must not appear on the option buttons');
  assert.ok(!/aria-selected=/.test(src), "aria-selected must not appear");
  assert.ok(!/role="group" aria-label="Status"/.test(src), "the old segmented group is gone");
  assert.ok(!/<select\b/.test(src), "never a native select");

  const hookSrc = stripComments(readSrc(ITEMS_PAGE_STATE));
  assert.match(
    hookSrc,
    /const handleStatusChange = \(next: MenuStatusFilter\) => \{/,
    "the page's state must own ONE handler that both the status filter and the active/archived view route through",
  );
  const pageSrc = stripComments(readSrc(PRODUCTS_PAGE));
  assert.match(pageSrc, /onStatusChange=\{state\.handleStatusChange\}/, "the page wires it to the toolbar");
  assert.ok(!/variant=\{isArchived \? "outline" : "secondary"\}/.test(pageSrc), "the old separate Active/Archived button pair must be removed");
});

test("PIN: item 2 (deep link timing) — the Items page applies ?status= only once auth is resolved, and an admin-only archived link still applies then", () => {
  // Moved with the code (U5 Task 1, ruling M1): the effect lives in the page's state hook.
  const src = stripComments(readSrc(ITEMS_PAGE_STATE));
  assert.match(src, /if\s*\(authLoading\)\s*return;/, "the ?status= effect must bail out while auth is still loading");
  assert.match(src, /\}, \[authLoading, isAdmin\]\);/, "the effect must be keyed on [authLoading, isAdmin] so it re-applies once the session resolves");
  assert.match(src, /if\s*\(isAdmin\)\s*setView\("archived"\);/, "an archived deep link must still switch the view once isAdmin resolves true");
});

test("PIN: wording — itemSubLine uses \"modifier(s)\", never \"add-on(s)\"", () => {
  const src = stripComments(readSrc(MENU_ITEMS_LIB));
  assert.match(src, /\$\{product\.modifiers\.length\} modifier\$\{product\.modifiers\.length === 1 \? "" : "s"\}/, "itemSubLine must build its modifier clause from the word 'modifier'");
  assert.ok(!/add-on/.test(src), "menu-items.ts must not use the word 'add-on' anywhere");
});

// ── Second fresh-eyes round (N2, N3) ────────────────────────────────────────

test('PIN: N2 — the filter select\'s labels drop their counts in the Archived view (labelCounts is null when isArchived, so "Sold out" never shows a number computed from the wrong list)', () => {
  const src = stripComments(readSrc(ITEMS_TOOLBAR));
  assert.match(src, /const labelCounts = isArchived \? null : counts;/, "labelCounts must be null in the Archived view");
  assert.match(src, /const n = labelCounts \? countOf\(f, labelCounts\) : null;/, "the label's count reads labelCounts, not counts directly");
  // Moved on purpose (U5 Task 1): countOf answers null for Archived (it never has a count) and every other filter a number.
  assert.match(src, /return null;\s*\}/, "Archived carries no count");
  assert.equal((src.match(/if \(filter === "[a-z-]+"\) return c\./g) ?? []).length, 4, "all four counted filters read their own count");
});

test("PIN: N3 — the empty-state title never reads a stale status: ItemsListSection takes no status (its words come from the search), and the title row's filter is archived while the Archived view is on", () => {
  // Moved on purpose (U5 Task 1; menu P4x): the per-status empty words ("Nothing is out of stock.") became the HTML's "No items
  // here" + "Try another search or filter.", so the status prop is gone; the same guarantee, one place down.
  const list = stripComments(readSrc(ITEMS_LIST_SECTION));
  assert.ok(!/status: MenuStatusFilter/.test(list), "ItemsListSection takes no status prop");
  const src = stripComments(readSrc(PRODUCTS_PAGE));
  assert.match(src, /filter=\{isArchived \? "archived" : status\}/, "the title row reads archived while the Archived view is on");
});

// Perf (s58 browser probe): below lg the page built all 105 table rows hidden
// next to the cards (210 In stock switches in the DOM). Once the width is known
// only one list mounts; null (server) keeps both, CSS-gated.
test("PIN: ItemsListSection mounts only the list for the current width (useMediaQuery(LG_UP_QUERY))", () => {
  const src = stripComments(readSrc("apps/cafe/components/menu/ItemsListSection.tsx"));
  assert.match(src, /const wide = useMediaQuery\(LG_UP_QUERY\)/, "the section must read the lg media query");
  assert.match(src, /\{wide !== false && <div className="hidden[^"]*lg:block">\s*<ItemsTable/, "the table mounts only when wide is not false");
  assert.match(src, /\{wide !== true && <div className="lg:hidden">\s*<ItemCards/, "the cards mount only when wide is not true");
  const hook = stripComments(readSrc("apps/cafe/hooks/use-media-query.ts"));
  assert.match(hook, /LG_UP_QUERY = "\(min-width: 1024px\)"/, "LG_UP_QUERY must equal Tailwind's lg breakpoint");
  assert.match(hook, /\(\) => null,?\s*\)/, "the server snapshot must be null (unknown width -> both lists, CSS-gated)");
});
