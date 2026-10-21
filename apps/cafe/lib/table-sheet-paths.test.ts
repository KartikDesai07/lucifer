// The "Choose a table" sheet's SOURCE pins (U1 Task 11; values 9.1-9.3 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// values 0.3 csMaxH, sheetAlign / sheetPad / sheetRadius; design 4 Q1 / Q4, 6.12). Two dialogs take the HTML's table
// picker: the New Order picker (components/pos/TableSelector.tsx, from the cart's Table cell) and the Move / Assign dialog
// (components/orders/MoveTableDialog.tsx + MoveTablePicker.tsx, from a resumed tab's Table cell AND the Orders page /
// dashboard order sheet). Their shared parts are components/pos/TableSheet.tsx (head, legend, area, tile) and
// lib/table-sheet.ts (words, tile rules, look). No React test framework here: raw readFileSync pins. The grouping pins
// are lib/table-areas-picker-paths.test.ts; the move's money and print pins stay in charge-ui-paths, table-flow-paths and
// print-routing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";
const SHEET = "apps/cafe/components/pos/TableSheet.tsx";
const LIB = "apps/cafe/lib/table-sheet.ts";
const DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const PICKER = "apps/cafe/components/orders/MoveTablePicker.tsx";

const tokensOf = (src: string, name: string): string[] => src.match(new RegExp(`const ${name} =\\s*"([^"]*)"`))?.[1]?.split(/\s+/) ?? [];
function expectTokens(src: string, name: string, list: string[]): void {
  const tokens = tokensOf(src, name);
  assert.ok(tokens.length > 0, `landmark: ${name} is a class string`);
  for (const t of list) assert.ok(tokens.includes(t), `${name}: "${t}"`);
}

// Owner Q1: the HTML's title "Choose a table" (was "Select table") and its legend; today's description as the sub; the
// tile words "Free" / "₹x open" / "Occupied" / "Reserved" / "Current" (lib/table-sheet.ts, unit-tested there); today's
// "Walk-In (no table)" at the foot. The tap: today's (resume an open tab, else select the table; Walk-In selects none).
test("PIN: the table picker is the HTML's sheet with today's taps (TableSelector)", () => {
  const src = readSrc(SELECTOR);
  const has = (re: RegExp, what: string) => assert.match(src, re, what);
  has(/<TableSheetHead title=\{TABLE_SHEET_TITLE\} sub=\{SELECTOR_DESCRIPTION\} \/>/, "the HTML's title over today's description");
  has(/<TableLegend items=\{SELECTOR_LEGEND\} \/>/, "the HTML's legend");
  has(/const tileOf = \(t: Table\) => selectorTile\(t, \{ selected: value === t\.tableNo, tabs, canResume: !!onResume \}\);/, "every tile from the one rule");
  has(/onClick=\{\(\) => \(tile\.resume \? resume\(tile\.resume\) : select\(t\.tableNo\)\)\}/, "a tap resumes the open tab, else selects the table");
  has(/disabled=\{tile\.disabled\}/, "occupied without a tab and reserved stay disabled");
  has(/onClick=\{\(\) => select\(undefined\)\}[^>]*>\s*\{WALK_IN_TABLE_LABEL\}\s*<\/button>/, "Walk-In selects none");
  has(/<DialogPrimitive\.Overlay data-ui="tp-sheet" className=\{SELECTOR_SCRIM_CLASS\}>/, "its scrim");
  has(/\{\.\.\.openerFocus\}/, "the panel takes the focus as it opens and gives it back to the cell (ruling P22's way)");
  for (const gone of ["@/components/ui/dialog", "@/components/ui/button", "Select table", "lucide-react"]) {
    assert.ok(!src.includes(gone), `no ${gone}: the HTML's table sheet (U1 Task 11)`);
  }
  const lib = readSrc(LIB);
  assert.ok(lib.includes('export const TABLE_SHEET_TITLE = "Choose a table";'), "owner Q1: the HTML's title");
  assert.ok(lib.includes('export const WALK_IN_TABLE_LABEL = "Walk-In (no table)";'), "today's walk-in words");
});

// The move dialog keeps its titles and descriptions (they describe our slip), takes the sheet's look, its confirm step
// (the charge preview and "New total") in the HTML's note box, "Remove from table" as a red link and "Cancel". Its layer:
// z-index 50 (ruling P26's way, as the payment sheet), above the Orders page's order sheet (z 50, earlier in the DOM).
test("PIN: the move / assign dialog is the HTML's sheet with today's steps (MoveTableDialog, MoveTablePicker)", () => {
  const src = readSrc(DIALOG);
  const has = (re: RegExp, what: string) => assert.match(src, re, what);
  has(/<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>\s*<DialogPrimitive\.Portal>\s*<DialogPrimitive\.Overlay data-ui="tp-sheet" className=\{MOVE_SCRIM_CLASS\}>/, "the kit's Root over the sheet's own frame");
  has(/<TableSheetHead\s+title=\{isAssign \? "Assign a table" : "Move table"\}/, "our titles stay");
  assert.ok(src.includes("Pick a free table to seat this tab at — the kitchen gets a slip so they can match it to the ticket they're holding."), "the assign description stays");
  assert.ok(src.includes("Pick a free table to move this tab to — the kitchen gets a"), "the move description stays");
  has(/<div data-ui="mt-note" className=\{MOVE_NOTE_CLASS\}>\s*\{preview\.note && <p>\{preview\.note\}<\/p>\}/, "the charge preview in the HTML's note box");
  has(/onClick=\{confirmMove\}[^>]*>\s*\{confirmLabel\}\s*<\/button>/, "the confirm button fires the one mutation path");
  has(/onClick=\{cancelPending\}[^>]*>\s*Cancel\s*<\/button>/, "Cancel goes back to the tables");
  has(/disabled=\{moveTable\.isPending\}\s+onClick=\{confirmMove\}/, "locked while the move is in flight");
  has(/\{\.\.\.openerFocus\}/, "the focus goes back to what opened it (the cell, the order sheet's button)");
  assert.ok(!src.includes("@/components/ui/button") && !src.includes("DialogContent"), "the HTML's sheet, not the kit's dialog body");
  const picker = readSrc(PICKER);
  assert.match(picker, /const tileOf = \(t: Table\) => moveTile\(t, currentTableNo\);/, "every tile from the one rule");
  assert.match(picker, /disabled=\{tile\.disabled \|\| busy\}/, "only free, non-current tables, and none while the move is in flight");
  assert.match(picker, /onClick=\{\(\) => onPick\(t\)\}/, "a tap only reports the table (the dialog's confirm step does the rest)");
  assert.ok(!picker.includes("@/components/ui/button"), "the HTML's foot, not the kit's buttons");
  const lib = readSrc(LIB);
  assert.match(lib, /export const MOVE_SCRIM_CLASS =\s*"fixed inset-0 z-50 /, "the move layer at 50, over the Orders sheet");
  assert.match(lib, /export const SELECTOR_SCRIM_CLASS =\s*"fixed inset-0 z-\[46\] /, "the picker at the HTML's 46");
});

// Values 9.1 (the frame, head, legend, body, area, tile) and 9.2 (the tile looks): the --scrim (fadeIn .2s; the panel
// centred in 16px, on the foot below 720px); the 600px panel at most 100dvh - 32px (88dvh below 720px), a 1px --border,
// radius 14 (14 14 0 0), --pop, sheetIn .32s; the head 16 16 10, 17/600 over 12.5 --text-2, the 32px round ✕; the legend
// 0 16 10, 12px --text-2, 14px apart, 8px dots; the body 4 16 18, 16px between areas; an area's head 12px 600 .04em
// upper-case --text-2 over the auto-fill grid (minmax(92px, 1fr), 8px); the 78px tile (1.5px rule, radius 12, 9px 10px,
// rise .35s 20 ms apart, the 2px lift on hover where it can be tapped), its name 17/600, seats 11 --text-2, the label
// row 11.5/500 with a 6px dot; the tones of 9.2 (and ours for an occupied table with no tab: --surface-2 / --text-3).
test("PIN: the table sheet's look is the HTML's (values 9.1, 9.2)", () => {
  const lib = readSrc(LIB);
  for (const scrim of ["SELECTOR_SCRIM_CLASS", "MOVE_SCRIM_CLASS"]) {
    expectTokens(lib, scrim, ["fixed", "inset-0", "flex", "items-center", "justify-center", "bg-scrim", "p-4", "motion-safe:animate-scrim-in", "max-tab:items-end", "max-tab:p-0"]);
  }
  expectTokens(lib, "TABLE_PANEL_CLASS", [
    "flex", "w-full", "max-w-[600px]", "flex-col", "overflow-hidden", "rounded-[14px]", "border", "border-border", "bg-card",
    "[box-shadow:var(--pop)]", "motion-safe:animate-html-sheet-in-cs", "tab:max-h-[calc(100vh-32px)]", "max-tab:max-h-[88vh]",
    "max-tab:rounded-[14px_14px_0_0]",
  ]);
  expectTokens(lib, "TABLE_HEAD_CLASS", ["flex", "flex-none", "items-center", "gap-2.5", "px-4", "pt-4", "pb-2.5"]);
  expectTokens(lib, "TABLE_TITLE_CLASS", ["text-[17px]", "font-semibold"]);
  expectTokens(lib, "TABLE_SUB_CLASS", ["text-[12.5px]", "text-muted-foreground"]);
  expectTokens(lib, "TABLE_CLOSE_CLASS", ["flex", "size-8", "flex-none", "items-center", "justify-center", "rounded-[50%]", "border-0", "bg-surface-3", "text-muted-foreground"]);
  expectTokens(lib, "TABLE_LEGEND_CLASS", ["flex", "flex-none", "flex-wrap", "gap-3.5", "px-4", "pb-2.5", "text-[12px]", "text-muted-foreground"]);
  expectTokens(lib, "TABLE_LEGEND_DOT_CLASS", ["size-2", "rounded-[50%]"]);
  // U1 final fix wave (the Task 11 review's FIX BEFORE MERGE): a foot always follows the body and adds the safe area
  // itself, so the body keeps the plain 18px (the same at inset 0).
  expectTokens(lib, "TABLE_BODY_CLASS", ["flex", "min-h-0", "flex-1", "flex-col", "gap-4", "overflow-auto", "px-4", "pt-1", "pb-[18px]"]);
  assert.ok(!/TABLE_BODY_CLASS =\s*"[^"]*safe-area/.test(lib), "no second safe-area gap above the foot");
  expectTokens(lib, "TABLE_AREA_CLASS", ["flex", "flex-col", "gap-2"]);
  expectTokens(lib, "TABLE_AREA_HEAD_CLASS", ["flex", "justify-between", "text-[12px]", "font-semibold", "tracking-[0.04em]", "uppercase", "text-muted-foreground"]);
  expectTokens(lib, "TABLE_GRID_CLASS", ["grid", "grid-cols-[repeat(auto-fill,minmax(92px,1fr))]", "gap-2"]);
  expectTokens(lib, "TABLE_TILE_CLASS", [
    "flex", "h-[78px]", "min-w-0", "cursor-pointer", "flex-col", "justify-between", "rounded-[12px]", "border-[1.5px]", "px-2.5",
    "py-[9px]", "text-left", "text-foreground", "motion-safe:animate-html-rise-row", "disabled:cursor-not-allowed",
  ]);
  const tile = tokensOf(lib, "TABLE_TILE_CLASS");
  assert.ok(tile.includes("enabled:hover:[transform:translateY(-2px)]!"), "the 2px lift on hover, only where a tap does something (important, as the HTML's, over the rise's fill)");
  assert.ok(!tile.some((t) => t.startsWith("hover:")), "never on a disabled tile");
  expectTokens(lib, "TABLE_TILE_TOP_CLASS", ["flex", "w-full", "items-baseline", "justify-between"]);
  expectTokens(lib, "TABLE_TILE_NAME_CLASS", ["text-[17px]", "font-semibold"]);
  expectTokens(lib, "TABLE_TILE_SEATS_CLASS", ["text-[11px]", "text-muted-foreground"]);
  expectTokens(lib, "TABLE_TILE_LABEL_CLASS", ["flex", "items-center", "gap-[5px]", "overflow-hidden", "whitespace-nowrap", "text-[11.5px]", "font-medium"]);
  expectTokens(lib, "TABLE_TILE_DOT_CLASS", ["size-1.5", "flex-none", "rounded-[50%]"]);
  // values 9.2's tones: [tile, dot, label].
  const tones: Record<string, [string, string, string]> = {
    free: ["border-border bg-card", "bg-status-ok", "text-status-ok-ink"],
    open: ["border-status-info-border bg-status-info-tint", "bg-status-info", "text-status-info-ink"],
    reserved: ["border-status-reserved-border bg-status-reserved-tint", "bg-status-reserved", "text-status-reserved-ink"],
    current: ["border-primary bg-accent [box-shadow:0_0_0_3px_var(--accent)]", "bg-primary", "text-accent-foreground"],
    occupied: ["border-border bg-surface-2", "bg-subtle-foreground", "text-subtle-foreground"],
  };
  for (const [kind, [t, d, l]] of Object.entries(tones)) {
    assert.ok(lib.includes(`${kind}: { tile: "${t}", dot: "${d}", label: "${l}" }`), `the ${kind} tile's tones`);
  }
  const sheet = readSrc(SHEET);
  assert.match(sheet, /style=\{\{ animationDelay: tileDelay\(index\) \}\}/, "each tile rises 20 ms after the one before (values 9.2 d)");
  assert.match(sheet, /<svg width="13" height="13" viewBox="0 0 24 24"[^>]*strokeWidth="2\.4"[^>]*>\s*<path d="M6 6l12 12M18 6 6 18" \/>/, "the HTML's 13px ✕");
  const css = readFileSync(path.join(REPO_ROOT, "apps/cafe/app/globals.css"), "utf8");
  assert.ok(css.includes("--animate-html-rise-row: brand-rise 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "a tile's rise .35s");
  assert.ok(css.includes("--animate-html-sheet-in-cs: sheet-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "the sheet's sheetIn .32s");
});
