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

test("PIN: PosHeader hides its title below md, and reuses POS_HEADER_CONTROL_CLASS on its controls", () => {
  const src = stripComments(readSrc(POS_HEADER));
  const h2Match = src.match(/<h2[^>]*className="([^"]*)"/);
  assert.ok(h2Match, "PosHeader must render an <h2> with a className");
  assert.ok(h2Match![1].includes("hidden"), 'the <h2> className must include "hidden" (hidden below md)');
  assert.ok(h2Match![1].includes("md:block"), 'the <h2> className must include "md:block"');
  const occurrences = (src.match(/POS_HEADER_CONTROL_CLASS/g) ?? []).length;
  assert.ok(occurrences >= 4, `expected POS_HEADER_CONTROL_CLASS referenced (import + usages) >=4 times, found ${occurrences}`);
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
  assert.match(src, /<TableSelector\b/, "landmark: PosHeader must render <TableSelector");
});

test("PIN: PosHeader gives exactly one control the flex/truncate chip class, and >=2 the fixed chip class (review F10)", () => {
  const src = stripComments(readSrc(POS_HEADER));
  const importBlock = src.match(/import\s*\{[^}]*\}\s*from\s*"@\/lib\/pos-layout"/);
  const body = importBlock ? src.replace(importBlock[0], "") : src;
  const flexCount = (body.match(/POS_HEADER_CHIP_FLEX_CLASS/g) ?? []).length;
  const fixedCount = (body.match(/POS_HEADER_CHIP_FIXED_CLASS/g) ?? []).length;
  assert.equal(flexCount, 1, `expected exactly 1 FLEX chip, found ${flexCount} — a 2nd flex-1 chip re-creates F10's 360px two-glyph truncation`);
  assert.ok(fixedCount >= 2, `expected >=2 FIXED chips, found ${fixedCount}`);
});

test("PIN: PosHeader never reverts to the old hand-rolled min-w-0 flex-1 xl:flex-none literal — the chip classes replace it", () => {
  const src = stripComments(readSrc(POS_HEADER));
  assert.ok(!src.includes("min-w-0 flex-1 xl:flex-none"), "must not hardcode the old literal — use POS_HEADER_CHIP_FLEX_CLASS");
  assert.match(src, /POS_HEADER_CHIP_FLEX_CLASS/, "landmark: PosHeader.tsx must still reference POS_HEADER_CHIP_FLEX_CLASS");
});

test("PIN: TableSelector and CustomerSearch import POS_HEADER_CHIP_ICON_CLASS and truncate their trigger label (review F10)", () => {
  for (const { label, path: rel } of [
    { label: "TableSelector", path: TABLE_SELECTOR },
    { label: "CustomerSearch", path: CUSTOMER_SEARCH },
  ]) {
    const src = stripComments(readSrc(rel));
    assert.match(
      src,
      /import\s*\{[^}]*POS_HEADER_CHIP_ICON_CLASS[^}]*\}\s*from\s*"@\/lib\/pos-layout"/,
      `${label} must import POS_HEADER_CHIP_ICON_CLASS from @/lib/pos-layout`,
    );
    assert.match(src, /<span className="min-w-0 truncate">/, `${label}'s trigger label span must be "min-w-0 truncate"`);
  }
});

test("PIN: CustomerSearch's empty trigger label reads Customer, not Walk-In (the table chip already owns that word); TableSelector's still does", () => {
  const csSrc = stripComments(readSrc(CUSTOMER_SEARCH));
  const csLabel = csSrc.match(/<span className="min-w-0 truncate">\{value \? value\.name : "([^"]+)"\}<\/span>/);
  assert.ok(csLabel, "CustomerSearch's trigger label must be a value ? value.name : \"...\" ternary");
  assert.equal(csLabel![1], "Customer", `CustomerSearch's empty-state fallback must be "Customer", found "${csLabel![1]}"`);
  assert.match(csSrc, /POS_HEADER_CHIP_ICON_CLASS/, "landmark: CustomerSearch must still use POS_HEADER_CHIP_ICON_CLASS");
  assert.match(csSrc, /title=\{value \? value\.name : "Select customer"\}/, "CustomerSearch's trigger must carry a title=");

  const tsSrc = stripComments(readSrc(TABLE_SELECTOR));
  assert.match(
    tsSrc,
    /<span className="min-w-0 truncate">\{value \? `Table \$\{value\}` : "Walk-In"\}<\/span>/,
    "TableSelector's trigger label must still fall back to Walk-In — a table can genuinely be none",
  );
  assert.match(tsSrc, /title=\{/, "TableSelector's trigger must carry a title=");
});

test("PIN: OpenTabsButton shows a full label at xl+ and icon+count only below xl, both readable via aria-label/title (review F10)", () => {
  const src = stripComments(readSrc(OPEN_TABS_BUTTON));
  assert.match(src, /aria-label=\{`Open tabs \(\$\{tabs\.length\}\)`\}/, "the trigger must carry aria-label={`Open tabs (${tabs.length})`}");
  assert.match(src, /title=\{`Open tabs \(\$\{tabs\.length\}\)`\}/, "the trigger must carry a matching title=");
  assert.match(src, /<span className="hidden truncate xl:inline">/, "the xl+ label span must be hidden truncate xl:inline");
  assert.match(src, /<span className="tabular-nums xl:hidden">\{tabs\.length\}<\/span>/, "the below-xl fallback must show the bare count");
  assert.ok(!src.includes('"xl:hidden">Tabs<'), "must not revert to the old bare \"Tabs\" label below xl — aria-label/title carry the word now");
});

test("PIN: TableSelector, CustomerSearch, and OpenTabsButton each accept a className and apply it to their trigger", () => {
  for (const { label, path: rel } of [
    { label: "TableSelector", path: TABLE_SELECTOR },
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
