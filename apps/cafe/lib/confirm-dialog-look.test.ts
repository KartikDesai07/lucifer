// U1 Task 12 (2026-10-22): the shared ConfirmDialog takes an optional `look="sheet"` = the owner's HTML confirm (values
// 12.1 in docs/superpowers/specs/2026-10-20-pos-html-values.md; values 0.3 sheetAlign / sheetPad / sheetRadius; design 3,
// 4 Q4, 6.12). Only the three POS prompts (components/pos/PosPrompts.tsx) and the send-discard confirm
// (components/pos/SendDiscard.tsx) pass it; the default look stays today's, byte for byte, for every other caller (about
// 30: deletes, cancels, the leave guard, the floor, settings). No React test framework here: raw readFileSync pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readRaw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(readRaw(rel));

const CONFIRM = "components/shared/ConfirmDialog.tsx";
const PROMPTS = "components/pos/PosPrompts.tsx";
const DISCARD = "components/pos/SendDiscard.tsx";

/** Whitespace-insensitive form of a raw JSX block (its comment included): only the indentation may differ. */
const normalise = (src: string): string => src.replace(/\s+/g, " ").trim();

/** The class-string literal a `const NAME = "...";` declares in ConfirmDialog.tsx. */
function confirmConst(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} =\\s*"([^"]*)";`));
  assert.ok(m, `ConfirmDialog.tsx must declare ${name} as one plain string literal`);
  return m![1];
}

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const abs = path.join(dirAbs, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(abs);
  }
}

// Today's tree (2026-10-22, before Task 12), its comment included: the kit AlertDialog with its own header, footer,
// Cancel and Action.
const TODAY_DEFAULT = `
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {cancelLabel}
          </AlertDialogCancel>
          {/* Keep the dialog open while the mutation runs; the caller closes it. */}
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isLoading}
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>`;

test("PIN (U1 Task 12, design 3): the default look is today's tree, unchanged for every caller that does not ask for the sheet", () => {
  const raw = readRaw(CONFIRM);
  assert.ok(normalise(raw).includes(normalise(TODAY_DEFAULT)), "the default branch renders today's kit AlertDialog tree exactly (about 30 callers keep it)");
  const src = readSrc(CONFIRM);
  for (const def of ['confirmLabel = "Confirm",', 'cancelLabel = "Cancel",', "destructive = true,", "isLoading = false,"]) {
    assert.ok(src.includes(def), `today's default stays: ${def}`);
  }
  assert.match(src, /look\?: "default" \| "sheet";/, "the new prop is optional: default or sheet");
  assert.ok(src.includes('look = "default",'), "a caller that passes nothing gets today's look");
  const branch = src.indexOf('if (look === "sheet")');
  assert.ok(branch > 0, "the sheet is its own branch");
  assert.ok(branch < src.indexOf("<AlertDialog open={open} onOpenChange={onOpenChange}>"), "taken before today's tree, which stays as it was");
  for (const kit of ["AlertDialogContent", "AlertDialogHeader", "AlertDialogFooter", "AlertDialogTitle", "AlertDialogDescription", "AlertDialogAction", "AlertDialogCancel"]) {
    assert.ok(src.includes(`  ${kit},`), `today's kit import of ${kit} stays`);
  }
});

test("PIN (U1 Task 12, owner Q4): only the POS prompts and the send-discard confirm wear the sheet; no other caller changes", () => {
  const files: string[] = [];
  walk(path.join(CAFE_ROOT, "components"), files);
  walk(path.join(CAFE_ROOT, "app"), files);
  const sheetUsers: string[] = [];
  let callers = 0;
  for (const abs of files) {
    const src = stripComments(readFileSync(abs, "utf8"));
    if (!src.includes("<ConfirmDialog")) continue;
    callers += 1;
    const rel = path.relative(CAFE_ROOT, abs).split(path.sep).join("/");
    for (const m of src.matchAll(/<ConfirmDialog\b[\s\S]*?\/>/g)) {
      if (/\blook=/.test(m[0])) sheetUsers.push(rel);
    }
  }
  assert.ok(callers >= 20, `landmark: the shared confirm has many callers, found ${callers}`);
  assert.deepStrictEqual(
    [...new Set(sheetUsers)].sort(),
    [DISCARD, PROMPTS].sort(),
    "a look is passed only by PosPrompts and SendDiscard (design 3: default unchanged for everyone else)",
  );
  const prompts = readSrc(PROMPTS);
  assert.equal(prompts.split('look="sheet"').length - 1, 3, 'every one of the three POS prompts passes look="sheet"');
  const discard = readSrc(DISCARD);
  assert.equal(discard.split('look="sheet"').length - 1, 1, 'the send-discard confirm passes look="sheet"');
});

test("PIN (U1 Task 12, values 12.1): the sheet is the HTML confirm — a Radix alert dialog whose scrim holds the 420px panel, title over body, stacked 46px buttons (the action first)", () => {
  const src = readSrc(CONFIRM);
  assert.match(src, /import \* as AlertDialogPrimitive from "@radix-ui\/react-alert-dialog";/, "the Radix alert dialog itself: role alertdialog, the focus on Cancel, Escape = cancel, no dismiss on an outside tap");
  const sheet = src.slice(src.indexOf("function ConfirmSheet("));
  assert.ok(sheet.length > 0 && src.includes("function ConfirmSheet("), "landmark: the sheet look's own function");
  const overlay = sheet.indexOf("<AlertDialogPrimitive.Overlay");
  const content = sheet.indexOf("<AlertDialogPrimitive.Content");
  assert.ok(overlay > 0 && content > overlay && sheet.indexOf("</AlertDialogPrimitive.Overlay>") > sheet.indexOf("</AlertDialogPrimitive.Content>"), "the scrim holds the panel (values 12.1: centred, a bottom sheet below 720px)");
  assert.ok(sheet.includes("className={SHEET_SCRIM_CLASS}") && sheet.includes("className={SHEET_PANEL_CLASS}"), "the scrim and the panel wear the HTML's frame");
  assert.ok(sheet.includes("<AlertDialogPrimitive.Title className={SHEET_TITLE_CLASS}>{title}</AlertDialogPrimitive.Title>"), "the 18px title");
  assert.ok(/\{description && \(\s*<AlertDialogPrimitive\.Description className=\{SHEET_BODY_CLASS\}>\{description\}<\/AlertDialogPrimitive\.Description>\s*\)\}/.test(sheet), "the body under it, only when there is one");
  const action = sheet.indexOf("<AlertDialogPrimitive.Action");
  const cancel = sheet.indexOf("<AlertDialogPrimitive.Cancel");
  assert.ok(action > 0 && cancel > action, "values 12.1: the action first, then Cancel");
  const actionTag = sheet.slice(action, sheet.indexOf("</AlertDialogPrimitive.Action>"));
  assert.match(actionTag, /onClick=\{\(e\) => \{\s*e\.preventDefault\(\);\s*onConfirm\(\);\s*\}\}/, "the action keeps the dialog open while it runs (the caller closes it), as today");
  assert.ok(actionTag.includes("disabled={isLoading}"), "the action is off while it runs");
  assert.ok(actionTag.includes("destructive ? SHEET_DESTRUCTIVE_CLASS : SHEET_ACTION_CLASS"), "--bad when destructive, else --accent");
  assert.ok(actionTag.includes('{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}') && actionTag.includes("{confirmLabel}"), "today's spinner inside the action while it runs, then its label");
  const cancelTag = sheet.slice(cancel, sheet.indexOf("</AlertDialogPrimitive.Cancel>"));
  assert.ok(cancelTag.includes("disabled={isLoading}") && cancelTag.includes("SHEET_CANCEL_CLASS") && cancelTag.includes("{cancelLabel}"), "Cancel in --surface-3, off while the action runs, today's word");

  assert.equal(
    confirmConst(src, "SHEET_SCRIM_CLASS"),
    "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0",
    "values 12.1 scrim: fixed, z-index 50, --scrim, fadeIn .2s; sheetAlign / sheetPad: centred in 16px, along the foot with no padding below 720px",
  );
  assert.equal(
    confirmConst(src, "SHEET_PANEL_CLASS"),
    "flex w-full max-w-[420px] flex-col gap-4 rounded-[14px] border border-border bg-card p-5 [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in max-tab:rounded-[14px_14px_0_0]",
    "values 12.1 panel: 420px, --surface, a 1px --border, sheetRadius 14 (14 14 0 0 below 720px), --pop, padding 20, gap 16, sheetIn .34s",
  );
  assert.equal(confirmConst(src, "SHEET_TITLE_CLASS"), "text-[18px] font-semibold tracking-[-0.01em]", "values 12.1 title: 18px 600 -.01em");
  assert.equal(confirmConst(src, "SHEET_BODY_CLASS"), "mt-1.5 text-[14px] leading-[1.5] text-pretty text-muted-foreground", "values 12.1 body: 14px --text-2, 6px under the title, line-height 1.5, text-wrap pretty");
  assert.equal(confirmConst(src, "SHEET_BUTTONS_CLASS"), "flex flex-col gap-2", "values 12.1 buttons: stacked, 8px apart");
  assert.equal(
    confirmConst(src, "SHEET_BUTTON_CLASS"),
    "flex h-[46px] w-full cursor-pointer items-center justify-center rounded-[10px] border px-1.5 py-px text-[14.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50",
    "values 12.1 button: 46px, a 1px rule, radius 10, 14.5px 600, the UA's 1px 6px (the spinner and the label centred in one row)",
  );
  assert.equal(confirmConst(src, "SHEET_ACTION_CLASS"), "border-primary bg-primary text-primary-foreground", "values 12.1 kind 1: --accent fill and rule, --on-accent text");
  assert.equal(confirmConst(src, "SHEET_DESTRUCTIVE_CLASS"), "border-status-bad bg-status-bad text-white", "design 6.12: a destructive action in --bad with white text");
  assert.equal(confirmConst(src, "SHEET_CANCEL_CLASS"), "border-transparent bg-surface-3 text-foreground", "values 12.1 kind 0: --surface-3, --text, a transparent rule");
});
