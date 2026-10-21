// POS header-chip SOURCE pins (CB-1 S3, split out of lib/pos-layout-paths.test.ts
// to keep both files under the ~300-line convention). Covers PosHeader.tsx,
// TableSelector.tsx, CustomerSearch.tsx, OpenTabsButton.tsx — the review F10
// fixed/flex/icon chip treatment for the 360px two-glyph truncation bug, and
// the xl-switch rename. No React/route test framework exists here (see
// lib/table-flow-paths.test.ts), so these are raw readFileSync pins. Own
// readSrc wiring — shares no module with either companion file beyond
// lib/source-pin-utils.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const POS_HEADER = "apps/cafe/components/pos/PosHeader.tsx";
const TABLE_SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";
const CUSTOMER_SEARCH = "apps/cafe/components/pos/CustomerSearch.tsx";
const OPEN_TABS_BUTTON = "apps/cafe/components/pos/OpenTabsButton.tsx";

// U0 Task 3 (ruling R4): "POS Terminal" is the page header's title now (the shell's 56px header, values 2.5), so the
// row keeps only its controls and no page shows its title twice.
test("PIN: PosHeader names the page through the header slot (no title of its own), and reuses POS_HEADER_CONTROL_CLASS on its controls", () => {
  const src = stripComments(readSrc(POS_HEADER));
  assert.match(src, /<PageHeader title="POS Terminal" \/>/, "the page's title goes to the shell header");
  assert.ok(!/<h[12]\b/.test(src), "no heading of its own in the row");
  // U1 Task 4: the Table and Customer chips left the row (owner Q9), so its controls are the KOT reprint and Open tabs.
  const occurrences = (src.match(/POS_HEADER_CONTROL_CLASS/g) ?? []).length;
  assert.ok(occurrences >= 3, `expected POS_HEADER_CONTROL_CLASS referenced (import + usages) >=3 times, found ${occurrences}`);
});

test("PIN: every flex-wrap in PosHeader is xl-gated — neither the outer row nor the controls row wraps below xl", () => {
  const src = stripComments(readSrc(POS_HEADER));
  const idxs: number[] = [];
  for (let i = src.indexOf("flex-wrap"); i >= 0; i = src.indexOf("flex-wrap", i + 1)) idxs.push(i);
  assert.ok(idxs.length >= 2, `landmark: PosHeader must contain >=2 flex-wrap occurrences (outer row + controls row), found ${idxs.length}`);
  for (const idx of idxs) {
    assert.equal(src.slice(idx - 3, idx), "xl:", `the flex-wrap at index ${idx} must be immediately preceded by "xl:" (not lg:) — an ungated one reopens the phone wrap bug`);
  }
  assert.match(src, /"flex items-center justify-between gap-2 xl:flex-wrap"/, "the OUTER row must carry xl:flex-wrap too — v1 wrapped at desktop");
  assert.match(src, /<OpenTabsButton\b/, "landmark: PosHeader must render <OpenTabsButton");
});

// U1 Task 4 (owner Q9, design 6.5): the Table and Customer chips are the cart head's two cells now
// (components/pos/CartHead.tsx, pinned in lib/pos-layout-paths.test.ts); the row keeps the KOT reprint and Open tabs
// until U1 Task 6, and the Floor hand-off, which still selects a table through onTableChange.
test("PIN: the Table and Customer chips left PosHeader for the cart's cells (owner Q9) — no chip, no chip class, no move opener", () => {
  const src = stripComments(readSrc(POS_HEADER));
  for (const gone of [
    "<TableSelector",
    "<CustomerSearch",
    "LayoutGrid",
    "POS_HEADER_CHIP_FIXED_CLASS",
    "POS_HEADER_CHIP_FLEX_CLASS",
    "POS_HEADER_CHIP_ICON_CLASS",
    "onMoveTable",
    "onCustomerChange",
    "min-w-0 flex-1 xl:flex-none",
  ]) {
    assert.ok(!src.includes(gone), `PosHeader must no longer carry ${gone}: the cells live in the cart head`);
  }
  assert.ok(src.includes("onSelect={onTableChange}"), "the Floor hand-off still selects a table");
});

test("PIN: TableSelector opens from the trigger it is given (the cart's Table cell) — its dialog is today's", () => {
  const src = stripComments(readSrc(TABLE_SELECTOR));
  assert.match(src, /trigger: ReactElement;/, "TableSelector must take the cell it opens from");
  assert.ok(src.includes("<DialogTrigger asChild>{trigger}</DialogTrigger>"), "the cell is the dialog's trigger");
  for (const gone of ["LayoutGrid", "POS_HEADER_CHIP_ICON_CLASS", "className?: string", "disabled?: boolean"]) {
    assert.ok(!src.includes(gone), `TableSelector must no longer carry its chip's ${gone}: the cell brings its own look and lock`);
  }
  assert.ok(src.includes("<DialogTitle>Select table</DialogTitle>"), "landmark: today's dialog (U1 Task 11 restyles it)");
});

test("PIN: CustomerSearch keeps its chip for the payment popup and opens from the cart's Customer cell when given one", () => {
  const src = stripComments(readSrc(CUSTOMER_SEARCH));
  assert.match(src, /trigger\?: ReactElement;/, "an optional trigger (the cart's Customer cell)");
  assert.match(src, /<DialogTrigger asChild>\s*\{trigger \?\? \(/, "the given trigger, else today's chip");
  assert.match(
    src,
    /import\s*\{[^}]*POS_HEADER_CHIP_ICON_CLASS[^}]*\}\s*from\s*"@\/lib\/pos-layout"/,
    "the chip (PaymentModal's) keeps its icon class",
  );
  assert.match(src, /<span className="min-w-0 truncate">/, "the chip's label span stays \"min-w-0 truncate\"");
});

test("PIN: CustomerSearch's empty trigger label reads Customer, not Walk-In (the table chip already owns that word)", () => {
  const csSrc = stripComments(readSrc(CUSTOMER_SEARCH));
  const csLabel = csSrc.match(/<span className="min-w-0 truncate">\{value \? value\.name : "([^"]+)"\}<\/span>/);
  assert.ok(csLabel, "CustomerSearch's trigger label must be a value ? value.name : \"...\" ternary");
  assert.equal(csLabel![1], "Customer", `CustomerSearch's empty-state fallback must be "Customer", found "${csLabel![1]}"`);
  assert.match(csSrc, /POS_HEADER_CHIP_ICON_CLASS/, "landmark: CustomerSearch must still use POS_HEADER_CHIP_ICON_CLASS");
  assert.match(csSrc, /title=\{value \? value\.name : "Select customer"\}/, "CustomerSearch's trigger must carry a title=");
});

test("PIN: OpenTabsButton shows a full label at xl+ and icon+count only below xl, both readable via aria-label/title (review F10)", () => {
  const src = stripComments(readSrc(OPEN_TABS_BUTTON));
  assert.match(src, /aria-label=\{`Open tabs \(\$\{tabs\.length\}\)`\}/, "the trigger must carry aria-label={`Open tabs (${tabs.length})`}");
  assert.match(src, /title=\{`Open tabs \(\$\{tabs\.length\}\)`\}/, "the trigger must carry a matching title=");
  assert.match(src, /<span className="hidden truncate xl:inline">/, "the xl+ label span must be hidden truncate xl:inline");
  assert.match(src, /<span className="tabular-nums xl:hidden">\{tabs\.length\}<\/span>/, "the below-xl fallback must show the bare count");
  assert.ok(!src.includes('"xl:hidden">Tabs<'), "must not revert to the old bare \"Tabs\" label below xl — aria-label/title carry the word now");
});

// U1 Task 4: TableSelector's trigger is the cart's Table cell (its own look), so it takes no className any more.
test("PIN: CustomerSearch and OpenTabsButton each accept a className and apply it to their trigger", () => {
  for (const { label, path: rel } of [
    { label: "CustomerSearch", path: CUSTOMER_SEARCH },
    { label: "OpenTabsButton", path: OPEN_TABS_BUTTON },
  ]) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /className\?:\s*string/, `${label} must declare className?: string`);
    assert.match(src, /cn\([^)]*\bclassName\b[^)]*\)/, `${label} must apply className via a cn(...) call on its trigger`);
  }
});

test("PIN: no stray lg: token remains in PosHeader/CustomerSearch/OpenTabsButton — the mode switch moved to xl", () => {
  const FILES: Array<{ label: string; path: string; xlLandmark: RegExp }> = [
    { label: "PosHeader.tsx", path: POS_HEADER, xlLandmark: /xl:flex-wrap/ },
    { label: "CustomerSearch.tsx", path: CUSTOMER_SEARCH, xlLandmark: /xl:max-w-\[12rem\]/ },
    { label: "OpenTabsButton.tsx", path: OPEN_TABS_BUTTON, xlLandmark: /xl:hidden/ },
  ];
  for (const { label, path: rel, xlLandmark } of FILES) {
    const src = stripComments(readSrc(rel));
    assert.ok(!src.includes("lg:"), `${label} must not carry a stray lg: token — the mode switch moved to xl`);
    assert.match(src, xlLandmark, `landmark: ${label} must carry its xl: token (${xlLandmark})`);
  }
});
