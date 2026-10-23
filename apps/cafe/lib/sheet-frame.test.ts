// U1 audit wave (ruling P54; report-clean Important 1): the owner's HTML sheet frame lives once in lib/sheet-frame.ts —
// the scrim, the panel and its caps, the 46px stepper, the 48px field, the foot and the round ✕ (values 0.3
// sheetAlign / sheetPad / sheetRadius / csMaxH, 8.1-8.3, 9.1, 10.1, 11.1, 12.1 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md). The sheets that held byte-for-byte copies import it and keep
// only what differs (the z-index, the width, border, overflow, gap, padding, sheetIn) as literals at the call site.
// These pins hold the shared values once, every importer's composition, and — the point of the refactor — every
// element's class SET exactly as it was before (the strings below are the pre-refactor ones, base 310dda2), so the
// compiled CSS and the rendered look are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { cn } from "@/lib/utils";
import * as frame from "@/lib/sheet-frame";
import { PAY_PANEL_CLASS, PAY_SCRIM_CLASS } from "@/lib/payment-sheet";
import {
  MOVE_SCRIM_CLASS,
  SELECTOR_SCRIM_CLASS,
  TABLE_CLOSE_CLASS,
  TABLE_FOOT_CLASS,
  TABLE_PANEL_CLASS,
} from "@/lib/table-sheet";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const sorted = (cls: string): string[] => cls.split(/\s+/).filter(Boolean).sort();
const FRAME = frame as unknown as Record<string, string>;

const VOID = "components/pos/VoidItemDialog.tsx";
const CONFIRM = "components/shared/ConfirmDialog.tsx";
const MODIFIER = "components/pos/ModifierModal.tsx";
const CUSTOMER = "components/pos/CustomerSearch.tsx";
const PAYMENT = "lib/payment-sheet.ts";
const TABLE = "lib/table-sheet.ts";

/** A module-level `const NAME = cn(...)` in a component, resolved: its string arguments as written, its identifiers
 *  from lib/sheet-frame.ts, through the real cn() — the class string the element renders. */
function composedConst(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} = cn\\(([\\s\\S]*?)\\);\\n`));
  assert.ok(m, `landmark: const ${name} = cn(...)`);
  const args = m![1].match(/"[^"]*"|[A-Z][A-Z0-9_]*/g) ?? [];
  assert.ok(args.length >= 2, `${name}: a shared part and the call site's own literal`);
  return cn(
    ...args.map((a) => {
      if (a.startsWith('"')) return a.slice(1, -1);
      assert.ok(a in FRAME, `${name}: ${a} comes from lib/sheet-frame.ts`);
      return FRAME[a];
    }),
  );
}

function assertSameSet(actual: string, expected: string, what: string): void {
  assert.deepEqual(sorted(actual), sorted(expected), `${what}: the same classes as before the shared frame (ruling P54)`);
}

// ── the shared values, once ─────────────────────────────────────────────────────────────────────────────────────────

test("the shared sheet frame's values (values 0.3, 8.1-8.3, 9.1, 10.1, 11.1, 12.1)", () => {
  assert.equal(
    frame.SHEET_SCRIM_BASE,
    "fixed inset-0 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0",
    "the scrim: fixed, --scrim, fadeIn .2s; sheetAlign / sheetPad: centred in 16px, along the foot with no padding below 720px; no z-index of its own",
  );
  assert.ok(!sorted(frame.SHEET_SCRIM_BASE).some((t) => /^z-/.test(t)), "the z-index is the call site's literal");
  assert.equal(
    frame.SHEET_PANEL_BASE,
    "flex w-full flex-col rounded-[14px] bg-card [box-shadow:var(--pop)] outline-none max-tab:rounded-[14px_14px_0_0]",
    "the panel: a full-width column on --surface, sheetRadius 14 (14 14 0 0 below 720px), --pop",
  );
  for (const own of ["max-w-", "border", "overflow-", "gap-", "p-", "px-", "pt-", "pb-", "motion-safe:"]) {
    assert.ok(!sorted(frame.SHEET_PANEL_BASE).some((t) => t.startsWith(own)), `the panel base leaves ${own}… to each sheet`);
  }
  assert.equal(
    frame.SHEET_PANEL_CAP_CLASS,
    "tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:supports-[height:1dvh]:max-h-[88dvh]",
    "values 0.3 csMaxH: 100dvh - 32px, 88dvh below 720px, the vh caps the base",
  );
  assert.equal(frame.SHEET_STEPPER_CLASS, "flex h-[46px] items-center rounded-[10px] border border-border", "values 10.1 stepper: 46px, 1px --border, radius 10");
  assert.equal(frame.SHEET_STEP_CLASS, "h-11 w-[42px] cursor-pointer border-0 bg-transparent px-1.5 py-px text-[18px] text-foreground", "values 10.1 − / +: 42x44, 18px --text, the UA's padding");
  assert.equal(frame.SHEET_QTY_CLASS, "min-w-6 text-center text-[15px] font-semibold", "values 10.1 qty: min 24px, 15px 600");
  assert.equal(
    frame.SHEET_FIELD_CLASS,
    "h-12 rounded-[12px] border-[1.5px] border-border px-3 py-0 text-[15px] leading-[normal] placeholder:text-subtle-foreground md:text-[15px] max-tab:text-base",
    "values 8.3 field: 48px, radius 12, a 1.5px --border rule, 0 12px, 15px (16px below 720px, ruling R36), --text-3 placeholder",
  );
  assert.equal(
    frame.SHEET_FOOT_CLASS,
    "flex flex-none flex-col gap-2 border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]",
    "values 8.2 foot: 12px 16px and 14px + the safe area, gap 8, a --border-2 rule",
  );
  assert.equal(
    frame.SHEET_CLOSE_CLASS,
    "flex size-8 flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-muted-foreground",
    "values 8.1 / 9.1 ✕: 32px round on --surface-3, --text-2, the UA's 1px 6px",
  );
});

// A part shared but still copied in one of the sheets would drift again: none of the six files that held the copies
// spells a shared string any more (review M-2, the fix round: the fence covers these files only, so an unrelated
// element elsewhere that happens to share a string is not pushed onto the sheet frame).
test("PIN: no copy of a shared part is left in the sheets that import the frame", () => {
  const parts = Object.entries(FRAME).filter(([, v]) => typeof v === "string");
  assert.ok(parts.length >= 9, "landmark: the frame's nine parts");
  for (const rel of [VOID, CONFIRM, MODIFIER, CUSTOMER, PAYMENT, TABLE]) {
    const src = readFileSync(path.join(CAFE_ROOT, rel), "utf8");
    for (const [name, value] of parts) {
      assert.ok(!src.includes(value), `${rel} must import ${name}, not copy it`);
    }
  }
});

// ── every importer: its import, its composition, and its elements' class sets unchanged ─────────────────────────────

test("PIN: the void dialog draws its scrim, panel, ✕, stepper, reason field and foot from the shared frame, classes unchanged", () => {
  const src = readSrc(VOID);
  assert.match(src, /import \{[^}]*\bSHEET_SCRIM_BASE\b[^}]*\} from "@\/lib\/sheet-frame";/, "the import");
  assert.ok(src.includes('const SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");'), "the scrim at 50");
  assert.ok(
    src.includes('const PANEL_CLASS = cn(SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, "max-w-[420px] overflow-hidden border border-border motion-safe:animate-sheet-in");'),
    "the 420px bordered panel, capped, sheetIn .34s",
  );
  assertSameSet(composedConst(src, "SCRIM_CLASS"), "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0", "void scrim");
  assertSameSet(
    composedConst(src, "PANEL_CLASS"),
    "flex w-full max-w-[420px] flex-col overflow-hidden rounded-[14px] border border-border bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:supports-[height:1dvh]:max-h-[88dvh]",
    "void panel",
  );
  for (const [needle, what] of [
    ['data-ui="void-close" aria-label="Close" className={cn(SHEET_CLOSE_CLASS, BRAND_PRESS_CLASS)}', "the head's ✕"],
    ["aria-labelledby={qtyId} className={SHEET_STEPPER_CLASS}", "the stepper"],
    ["className={cn(SHEET_STEP_CLASS, BRAND_PRESS_CLASS)}", "− / +"],
    ['data-ui="void-qty" className={SHEET_QTY_CLASS}', "the qty"],
    ["className={SHEET_FIELD_CLASS}", "the reason's 48px field"],
    ['data-ui="void-foot" className={SHEET_FOOT_CLASS}', "the foot"],
  ] as const) {
    assert.ok(src.includes(needle), `${what}: ${needle}`);
  }
  for (const gone of ["const CLOSE_CLASS", "const STEPPER_CLASS", "const STEP_CLASS", "const QTY_CLASS", "const FIELD_INPUT_CLASS", "const FOOT_CLASS"]) {
    assert.ok(!src.includes(gone), `no local copy: ${gone}`);
  }
});

// U2 Task 7 (2026-10-23; design 6.10): the confirm sheet's classes moved here from ConfirmDialog.tsx so the Orders cancel
// sheet (components/orders/CancelOrderDialog.tsx) wears the same frame — the strings exactly U1's (pinned before in
// ConfirmDialog.tsx; moved on purpose, same strings). The final fix wave (Ruling P14; moved on purpose): the panel adds
// the bottom safe-area inset on phones, where it lies along the window's foot (U1 P49: everything at the window's foot,
// every width) — for both callers at once; the insets are 0 in browsers, so nothing moves there.
test("PIN: the confirm sheet's classes live in the shared frame, U1's strings with the phone's bottom inset (Ruling P14) (ConfirmDialog and the Orders cancel sheet import them)", () => {
  const own = readSrc("lib/sheet-frame.ts");
  assert.ok(own.includes('export const CONFIRM_SHEET_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");'), "the scrim at 50");
  assert.match(
    own,
    /export const CONFIRM_SHEET_PANEL_CLASS = cn\(\s*SHEET_PANEL_BASE,\s*"max-w-\[420px\] gap-4 border border-border p-5 max-tab:pb-\[calc\(20px\+env\(safe-area-inset-bottom\)\)\] motion-safe:animate-sheet-in",?\s*\);/,
    "the 420px bordered panel, padding 20 (20 + the bottom inset on a phone), gap 16, uncapped",
  );
  assertSameSet(frame.CONFIRM_SHEET_SCRIM_CLASS, "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0", "confirm scrim");
  assert.deepEqual(
    sorted(frame.CONFIRM_SHEET_PANEL_CLASS),
    sorted("flex w-full max-w-[420px] flex-col gap-4 rounded-[14px] border border-border bg-card p-5 [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in max-tab:rounded-[14px_14px_0_0] max-tab:pb-[calc(20px+env(safe-area-inset-bottom))]"),
    "confirm panel: U1's classes plus the phone's bottom inset (Ruling P14)",
  );
  assert.ok(frame.CONFIRM_SHEET_PANEL_CLASS.includes("p-5"), "padding 20 everywhere else (tailwind-merge keeps p-5 beside the phone's pb)");
  assert.equal(frame.CONFIRM_SHEET_TITLE_CLASS, "text-[18px] font-semibold tracking-[-0.01em]", "values 12.1 title: 18px 600 -.01em");
  assert.equal(frame.CONFIRM_SHEET_BODY_CLASS, "mt-1.5 text-[14px] leading-[1.5] text-pretty text-muted-foreground", "values 12.1 body: 14px --text-2, 6px under the title, 1.5, pretty");
  assert.equal(
    frame.CONFIRM_SHEET_BUTTON_CLASS,
    "flex h-[46px] w-full cursor-pointer items-center justify-center rounded-[10px] border px-1.5 py-px text-[14.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50",
    "values 12.1 button: 46px, a 1px rule, radius 10, 14.5px 600, the UA's 1px 6px",
  );
  assert.equal(frame.CONFIRM_SHEET_DESTRUCTIVE_CLASS, "border-status-bad bg-status-bad text-white", "design 6.12: a destructive action in --bad with white text");
  const src = readSrc(CONFIRM);
  for (const name of ["CONFIRM_SHEET_SCRIM_CLASS", "CONFIRM_SHEET_PANEL_CLASS", "CONFIRM_SHEET_TITLE_CLASS", "CONFIRM_SHEET_BODY_CLASS", "CONFIRM_SHEET_BUTTON_CLASS", "CONFIRM_SHEET_DESTRUCTIVE_CLASS"]) {
    assert.match(src, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/lib/sheet-frame";`), `ConfirmDialog imports ${name}`);
  }
  for (const gone of ["const SHEET_SCRIM_CLASS", "const SHEET_PANEL_CLASS", "const SHEET_TITLE_CLASS", "const SHEET_BODY_CLASS", "const SHEET_BUTTON_CLASS", "const SHEET_DESTRUCTIVE_CLASS"]) {
    assert.ok(!src.includes(gone), `no local copy in ConfirmDialog: ${gone}`);
  }
  const cancel = readSrc("components/orders/CancelOrderDialog.tsx");
  for (const name of ["CONFIRM_SHEET_SCRIM_CLASS", "CONFIRM_SHEET_PANEL_CLASS", "CONFIRM_SHEET_TITLE_CLASS", "CONFIRM_SHEET_BODY_CLASS", "CONFIRM_SHEET_BUTTON_CLASS", "CONFIRM_SHEET_DESTRUCTIVE_CLASS", "SHEET_FIELD_CLASS"]) {
    assert.match(cancel, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/lib/sheet-frame";`), `the Orders cancel sheet imports ${name}`);
  }
});

test("PIN: the item options modal draws its scrim, panel, note field and stepper from the shared frame, classes unchanged", () => {
  const src = readSrc(MODIFIER);
  assert.match(src, /import \{[^}]*\bSHEET_STEPPER_CLASS\b[^}]*\} from "@\/lib\/sheet-frame";/, "the import");
  assert.ok(src.includes('const SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-20");'), "the scrim at 20 (over the phone's tab bar)");
  assert.ok(
    src.includes('const PANEL_CLASS = cn(SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, "max-w-[440px] overflow-hidden motion-safe:animate-sheet-in");'),
    "the 440px borderless panel, capped, sheetIn .34s",
  );
  assertSameSet(composedConst(src, "SCRIM_CLASS"), "fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0", "item options scrim");
  assertSameSet(
    composedConst(src, "PANEL_CLASS"),
    "flex w-full max-w-[440px] flex-col overflow-hidden rounded-[14px] bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:supports-[height:1dvh]:max-h-[88dvh]",
    "item options panel",
  );
  for (const [needle, what] of [
    ["className={SHEET_FIELD_CLASS}", "the kitchen note's 48px field"],
    ['aria-label="Quantity" className={SHEET_STEPPER_CLASS}', "the stepper"],
    ["className={cn(SHEET_STEP_CLASS, BRAND_PRESS_CLASS)}", "− / +"],
    ['data-ui="pos-item-qty" className={SHEET_QTY_CLASS}', "the qty"],
  ] as const) {
    assert.ok(src.includes(needle), `${what}: ${needle}`);
  }
  for (const gone of ["const NOTE_FIELD_CLASS", "const STEPPER_CLASS", "const STEP_CLASS", "const QTY_CLASS"]) {
    assert.ok(!src.includes(gone), `no local copy: ${gone}`);
  }
});

test("PIN: the customer sheet draws its panel and foot from the shared frame, classes unchanged (its scrim keeps its own colour by path)", () => {
  const src = readSrc(CUSTOMER);
  assert.match(src, /import \{ SHEET_FOOT_CLASS, SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS \} from "@\/lib\/sheet-frame";/, "the import");
  assertSameSet(
    composedConst(src, "PANEL_CLASS"),
    "flex w-full max-w-[460px] flex-col overflow-hidden rounded-[14px] border border-border bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-html-sheet-in-cs tab:h-[600px] tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:h-[88vh] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:supports-[height:1dvh]:h-[88dvh] max-tab:supports-[height:1dvh]:max-h-[88dvh]",
    "customer panel",
  );
  assert.ok(src.includes('data-ui="cs-foot" className={SHEET_FOOT_CLASS}'), "the shared foot");
  assert.ok(!src.includes("const FOOT_CLASS"), "no local copy of the foot");
  // Its scrim is not the shared one: no colour of its own (--scrim from the cart cell, clear over the payment sheet).
  assert.ok(!src.includes("SHEET_SCRIM_BASE"), "the customer scrim keeps its own frame (its colour is chosen by path)");
});

test("PIN: the payment sheet and the table / move sheets draw their frame from the shared parts, classes unchanged", () => {
  const pay = readSrc(PAYMENT);
  assert.match(pay, /import \{ SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, SHEET_SCRIM_BASE \} from "@\/lib\/sheet-frame";/, "the payment sheet's import");
  assert.ok(pay.includes('export const PAY_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");'), "the payment scrim at 50");
  assertSameSet(PAY_SCRIM_CLASS, "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0", "payment scrim");
  assertSameSet(
    PAY_PANEL_CLASS,
    "flex w-full max-w-[420px] flex-col gap-4 overflow-y-auto rounded-[14px] bg-card px-[18px] pt-[18px] pb-3.5 [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:pb-[calc(12px+env(safe-area-inset-bottom))] max-tab:supports-[height:1dvh]:max-h-[88dvh]",
    "payment panel",
  );
  const table = readSrc(TABLE);
  assert.match(table, /import \{ SHEET_CLOSE_CLASS, SHEET_FOOT_CLASS, SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, SHEET_SCRIM_BASE \} from "@\/lib\/sheet-frame";/, "the table sheet's import");
  assert.ok(table.includes('export const SELECTOR_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-[46]");'), "the picker at the HTML's 46");
  assert.ok(table.includes('export const MOVE_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");'), "the move layer at 50");
  assert.ok(table.includes("export const TABLE_CLOSE_CLASS = SHEET_CLOSE_CLASS;") && table.includes("export const TABLE_FOOT_CLASS = SHEET_FOOT_CLASS;"), "the ✕ and the foot are the shared ones");
  assertSameSet(SELECTOR_SCRIM_CLASS, "fixed inset-0 z-[46] flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0", "table picker scrim");
  assertSameSet(MOVE_SCRIM_CLASS, "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0", "move dialog scrim");
  assertSameSet(
    TABLE_PANEL_CLASS,
    "flex w-full max-w-[600px] flex-col overflow-hidden rounded-[14px] border border-border bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-html-sheet-in-cs tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:supports-[height:1dvh]:max-h-[88dvh]",
    "table panel",
  );
  assertSameSet(TABLE_CLOSE_CLASS, "flex size-8 flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-muted-foreground", "table ✕");
  assertSameSet(TABLE_FOOT_CLASS, "flex flex-none flex-col gap-2 border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]", "table foot");
});

// cn() is tailwind-merge: it would silently drop a class that conflicts with a later one. None of the shared parts and
// the call sites' literals conflict, so every class survives (the set pins above prove it per element; this names why).
test("cn() keeps every class of the shared parts and a call site's literal (no tailwind-merge conflict)", () => {
  const all = [frame.SHEET_PANEL_BASE, frame.SHEET_PANEL_CAP_CLASS, "max-w-[420px] overflow-hidden border border-border motion-safe:animate-sheet-in"];
  assert.deepEqual(sorted(cn(...all)), sorted(all.join(" ")), "the panel's parts and a sheet's own classes all survive");
  assert.deepEqual(sorted(cn(frame.SHEET_SCRIM_BASE, "z-[46]")), sorted(`${frame.SHEET_SCRIM_BASE} z-[46]`), "the scrim and its z-index both survive");
});
