// U2 Task 7 (2026-10-23): who gets the order detail's cancel and what it opens (docs/superpowers/specs/
// 2026-10-23-orders-match-html-design.md 6.6, 6.10, 6.11, 11; controller ruling P6; Review Focus 4): the /orders page
// gives admins the detail's "Cancel this order" and shows the cancelled order the server returns; the dashboard gives
// none; the cancel dialog is the owner's HTML confirm sheet (components/orders/CancelOrderDialog.tsx; lib/sheet-frame.ts
// CONFIRM_SHEET_*, pinned in lib/sheet-frame.test.ts); the settings hints quote the new button words. Source pins (the
// detail's actions themselves: lib/orders-actions.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { cn } from "./utils";
import * as frame from "./sheet-frame";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const PAGE = "app/(dashboard)/orders/page.tsx";
const DASHBOARD = "app/(dashboard)/page.tsx";
const DIALOG = "components/orders/CancelOrderDialog.tsx";

// ── The pages (Ruling P6; design 6.6, 6.11; Review Focus 4) ─────────────────────────────────────────────────────────

// The final fix wave (2026-10-23; the whole-branch review's Important 1) moved the page's cancel state and its confirm
// into hooks/use-cancel-sheet.ts over the pure controller lib/orders-cancel-sheet.ts (tested there): the same meaning —
// admins only, the frame held while the sheet is up, the server's cancelled order chosen through setDetail — plus Escape
// closing only an idle sheet and a late success never swapping a newer choice (the page sits at its 300-line budget).
test("the /orders page: admins get the detail's cancel; after a cancel the detail shows the cancelled order the server returns, chosen like a settle (hooks/use-cancel-sheet.ts)", () => {
  const src = read(PAGE);
  assert.match(src, /const cancel = useCancelSheet\(setDetail\);/, "the page's cancel sheet, choosing through setDetail");
  assert.ok(src.indexOf("const setDetail = ") >= 0 && src.indexOf("const setDetail = ") < src.indexOf("useCancelSheet(setDetail)"), "setDetail (tappedChoice under the latest key) is the one used");
  assert.ok(!src.includes("useCancelOrder") && !src.includes("mutateAsync"), "the request lives in the hook, not the page");
  const el = src.slice(src.indexOf("<OrderDetailSheet"), src.indexOf("/>", src.indexOf("<OrderDetailSheet")) + 2);
  assert.match(el, /onCancel=\{isAdmin \? cancel\.open : undefined\}/, "admins only (staff never see the danger link)");
  assert.match(el, /cancelOpen=\{cancel\.order !== null\}/, "the frame holds while the cancel sheet is up");
  assert.match(
    src,
    /\{isAdmin && \(\s*<CancelOrderDialog\s+order=\{cancel\.order\}\s+onOpenChange=\{cancel\.onOpenChange\}\s+onConfirm=\{cancel\.confirm\}\s+isPending=\{cancel\.isPending\}\s*\/>/,
    "the dialog mounts for admins only, as today, closing and confirming through the controller",
  );
});

test("hooks/use-cancel-sheet.ts: the controller's ports — the sheet's order mirrored in a ref read after the await, 'pending' = the cancel request's isPending, today's request and setDetail", () => {
  const src = read("hooks/use-cancel-sheet.ts");
  assert.match(src, /import \{ useCancelOrder \} from "@\/hooks\/use-orders";/, "today's cancel request (its toasts and invalidations)");
  assert.match(src, /import \{ cancelSheet[^}]*\} from "@\/lib\/orders-cancel-sheet";/, "the tested controller");
  assert.match(src, /const \[order, setOrder\] = useState<Order \| null>\(null\);/, "the sheet's order (the render's)");
  assert.match(src, /const openFor = useRef<Order \| null>\(null\);/, "and as of now (a ref)");
  assert.match(src, /openFor: \(\) => openFor\.current,/, "the success reads the ref, never a render's stale value");
  assert.match(src, /setOpenFor: \(o\) => \{\s*openFor\.current = o;\s*setOrder\(o\);\s*\},/, "every open and close sets both at once");
  assert.match(src, /pending: \(\) => cancelOrder\.isPending,/, "in flight = the request's isPending (Escape closes only an idle sheet)");
  assert.match(src, /send: \(id, reason\) => cancelOrder\.mutateAsync\(\{ id, data: \{ reason \} \}\),/, "today's request, unchanged");
  assert.match(src, /\bchoose,\s/, "the page's setDetail chooses the cancelled order");
  assert.match(src, /isPending: cancelOrder\.isPending/, "the dialog's spinner and disabled states, as today");
});

test("line budgets (global constraints): the Orders page ≤ 300 lines, the cancel dialog ≤ 300 (house style)", () => {
  const lines = (rel: string): number => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length;
  assert.ok(lines(PAGE) <= 300, `app/(dashboard)/orders/page.tsx ≤ 300 (has ${lines(PAGE)})`);
  assert.ok(lines(DIALOG) <= 300, `CancelOrderDialog.tsx ≤ 300 (has ${lines(DIALOG)})`);
});

test("the dashboard gives no cancel (it mounts no cancel dialog): no 'Cancel this order' there (Review Focus 4)", () => {
  const dash = read(DASHBOARD);
  const at = dash.indexOf("<OrderDetailSheet");
  const el = dash.slice(at, dash.indexOf("/>", at) + 2);
  assert.ok(at >= 0, "landmark: the dashboard's detail");
  for (const prop of ["onCancel=", "cancelOpen="]) assert.ok(!el.includes(prop), `the dashboard passes no ${prop}`);
  assert.ok(!dash.includes("CancelOrderDialog"), "no cancel dialog on the dashboard");
});

// ── The cancel dialog in the HTML confirm sheet (design 6.10) ───────────────────────────────────────────────────────

test("CancelOrderDialog: the HTML confirm sheet (lib/sheet-frame.ts CONFIRM_SHEET_*) — the scrim holds the 420px panel; title, today's sentence, the reason, then Cancel order and Keep order", () => {
  const src = read(DIALOG);
  assert.match(src, /import \* as DialogPrimitive from "@radix-ui\/react-dialog";/, "a Radix dialog (the field takes the focus as it opens, as today)");
  // The verification fix (Ruling P17; moved on purpose): the scrim and the panel wear the cancel sheet's own classes,
  // composed over U1's CONFIRM_SHEET_* (pinned below), so on a phone the sheet opens at the window's top.
  const overlay = src.indexOf('<DialogPrimitive.Overlay data-ui="cancel-sheet" className={CANCEL_SCRIM_CLASS}>');
  const content = src.search(/<DialogPrimitive\.Content\s+data-ui="cancel-panel"\s+\{\.\.\.openerFocus\}\s+className=\{CANCEL_PANEL_CLASS\}/);
  assert.ok(overlay > 0 && content > overlay && src.indexOf("</DialogPrimitive.Overlay>") > src.indexOf("</DialogPrimitive.Content>"), "the scrim holds the panel (U1's confirm frame)");
  assert.match(src, /<DialogPrimitive\.Title className=\{CONFIRM_SHEET_TITLE_CLASS\}>Cancel \{order\.orderId\}\?<\/DialogPrimitive\.Title>/, "the title, today's words");
  assert.match(
    src,
    /<DialogPrimitive\.Description className=\{CONFIRM_SHEET_BODY_CLASS\}>\s*Total \{inr\(order\.total\)\}\. The order stays on record, but it leaves\s+sales totals and the payment mix, and any customer due it created\s+is reversed\. This cannot be undone\.\s*<\/DialogPrimitive\.Description>/,
    "today's sentence",
  );
  const order_ = ['data-ui="cancel-text"', 'data-ui="cancel-reason-field"', 'data-ui="cancel-buttons"'].map((n) => src.indexOf(n));
  assert.ok(order_.every((i, k) => i > 0 && (k === 0 || i > order_[k - 1])), "text, the reason, the buttons");
  assert.match(src, /<div data-ui="cancel-buttons" className=\{BUTTONS_CLASS\}>/, "stacked 8px apart");
  assert.match(src, /const BUTTONS_CLASS = "flex flex-col gap-2";/, "values 12.1 buttons (a literal at the call site, as the move sheet's)");
  assert.ok(!src.includes("BRAND_CONTROL_CLASS") && !src.includes("@/components/ui/dialog"), "the kit dialog and its h-10 control are gone (P22 moved on purpose)");
});

// Ruling P17 (the verification fix, V-C F1): the Android keyboard never resizes the WebView, so a sheet along the
// window's foot lies under it while the reason is typed. Below 720px the cancel sheet (our own reason field; the HTML
// confirm has none) opens at the window's TOP instead: 16px under the top edge plus the top safe-area inset, radius 14
// all round, the same full width and inner layout (padding 20 all round: no bottom inset away from the foot). Only this
// sheet: U1's ConfirmDialog keeps its bottom frame (the shared CONFIRM_SHEET_* strings are pinned unchanged in
// lib/sheet-frame.test.ts).
const FRAME = frame as unknown as Record<string, string>;
/** A module-level `const NAME = cn(...)` in the dialog, resolved through the real cn(): its string arguments as written,
 *  its identifiers from lib/sheet-frame.ts — the class string the element renders. */
function composedConst(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} = cn\\(([\\s\\S]*?)\\);\\n`));
  assert.ok(m, `landmark: const ${name} = cn(...)`);
  const args = m![1].match(/"[^"]*"|[A-Z][A-Z0-9_]*/g) ?? [];
  return cn(
    ...args.map((a) => {
      if (a.startsWith('"')) return a.slice(1, -1);
      assert.ok(a in FRAME, `${name}: ${a} comes from lib/sheet-frame.ts`);
      return FRAME[a];
    }),
  );
}
const sorted = (cls: string): string[] => cls.split(/\s+/).filter(Boolean).sort();

test("CancelOrderDialog (Ruling P17): below 720px the sheet opens at the window's top (16px + the top inset, radius 14 all round), composed over U1's confirm frame; 720px and up it is U1's centred panel", () => {
  const src = read(DIALOG);
  assert.match(src, /const CANCEL_SCRIM_CLASS = cn\(CONFIRM_SHEET_SCRIM_CLASS, "[^"]*"\);/, "the scrim: U1's confirm scrim plus the cancel sheet's own literal");
  assert.match(src, /const CANCEL_PANEL_CLASS = cn\(CONFIRM_SHEET_PANEL_CLASS, "[^"]*"\);/, "the panel: U1's confirm panel plus the cancel sheet's own literal");
  const scrim = composedConst(src, "CANCEL_SCRIM_CLASS");
  assert.deepEqual(
    sorted(scrim),
    sorted("fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-start max-tab:p-0 max-tab:pt-[calc(16px+env(safe-area-inset-top))]"),
    "the scrim: centred in 16px from 720px; below, the panel at the top, 16px + the top inset under the edge, full width",
  );
  assert.ok(!sorted(scrim).includes("max-tab:items-end"), "never along the window's foot below 720px (the keyboard would cover it)");
  const panel = composedConst(src, "CANCEL_PANEL_CLASS");
  assert.deepEqual(
    sorted(panel),
    sorted("flex w-full max-w-[420px] flex-col gap-4 rounded-[14px] border border-border bg-card p-5 [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in max-tab:rounded-[14px] max-tab:pb-5"),
    "the panel: U1's 420px confirm panel; below 720px radius 14 all round and padding 20 all round (no bottom inset: it is not at the foot)",
  );
  for (const gone of ["max-tab:rounded-[14px_14px_0_0]", "max-tab:pb-[calc(20px+env(safe-area-inset-bottom))]"]) {
    assert.ok(!sorted(panel).includes(gone), `the foot-sheet look goes on the cancel sheet: ${gone}`);
  }
  assert.ok(sorted(frame.CONFIRM_SHEET_SCRIM_CLASS).includes("max-tab:items-end"), "U1's ConfirmDialog keeps its bottom frame (the shared string unchanged)");
  assert.ok(sorted(frame.CONFIRM_SHEET_PANEL_CLASS).includes("max-tab:rounded-[14px_14px_0_0]"), "U1's confirm panel keeps its foot radius");
});

// V-C F4 (the verification fix): the sheet is opened from the page's state (no Radix trigger), so its close focus fell
// to <body>. The shared hook (hooks/use-opener-focus.ts, U1 ruling P22) gives the focus back to the opener (the detail's
// "Cancel this order") on "Keep order" and Escape; `focusPanel: false` keeps the reason field's focus on open (Ruling
// P17), Radix's own first-control focus, as today.
test("CancelOrderDialog: the focus goes back to what opened it (Keep order, Escape) through the shared opener hook; the reason field keeps the focus on open", () => {
  const src = read(DIALOG);
  assert.match(src, /import \{ useOpenerFocus \} from "@\/hooks\/use-opener-focus";/, "the shared hook");
  assert.match(src, /const openerFocus = useOpenerFocus\(\{ focusPanel: false \}\);/, "the close half only: the open focus stays Radix's (the field)");
  assert.ok(src.indexOf("useOpenerFocus({ focusPanel: false })") < src.indexOf("if (!order) return null;"), "called before the early return (one hook order every render)");
  assert.equal(src.split("{...openerFocus}").length - 1, 1, "spread once, on the panel");
  assert.ok(!/\bautoFocus\b|onOpenAutoFocus=|onCloseAutoFocus=/.test(src), "no other focus handling on the sheet");
});

// The final fix wave (the whole-branch review's Important 1b): on touch below 1280 the sheet sits over the detail's bottom
// sheet, and Radix defers a touch outside press to the next click, when the detail could be the top layer — so a scrim
// tap risked closing both. As the HTML confirm and U1's ConfirmDialog look="sheet", an outside press never dismisses it:
// "Keep order" and Escape (idle only, lib/orders-cancel-sheet.ts) are the ways out.
test("CancelOrderDialog: an outside press (the scrim, a touch deferred to its click) never dismisses the sheet — so it can never fall through to the detail beneath", () => {
  const src = read(DIALOG);
  const at = src.indexOf("<DialogPrimitive.Content");
  const content = src.slice(at, src.indexOf('<div data-ui="cancel-text">', at)); // the panel's opening tag
  assert.ok(at > 0 && content.includes('data-ui="cancel-panel"'), "landmark: the sheet's panel");
  assert.match(content, /onPointerDownOutside=\{\(e\) => e\.preventDefault\(\)\}/, "a press outside the panel does not close it");
  assert.match(content, /onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/, "nor any outside interaction");
  assert.match(src, /<DialogPrimitive\.Root open=\{!!order\} onOpenChange=\{onOpenChange\}>/, "Escape and Keep order go to the page's onOpenChange (closing only an idle sheet)");
});

test("CancelOrderDialog: 'Reason (required)' over the 48px field (SHEET_FIELD_CLASS on the kit Textarea), 200 characters; 'At least 3 characters.' in --bad-i; the same rules as today", () => {
  const src = read(DIALOG);
  assert.match(src, /<label htmlFor="cancel-reason" className=\{CAPTION_CLASS\}>Reason \(required\)<\/label>/, "the caption");
  const field = src.slice(src.indexOf("<Textarea"), src.indexOf("/>", src.indexOf("<Textarea")));
  for (const attr of ['id="cancel-reason"', "value={reason}", "onChange={(e) => setReason(e.target.value)}", 'placeholder="e.g. duplicate order, guest walked out"', "maxLength={ORDER_REASON_MAX_LEN}", "rows={1}", "disabled={isPending}", "aria-invalid={tooShort}", "className={cn(SHEET_FIELD_CLASS, REASON_FIELD_CLASS)}"]) {
    assert.ok(field.includes(attr), `the field: ${attr}`);
  }
  assert.match(src, /const REASON_FIELD_CLASS = "h-auto min-h-12 resize-y py-3";/, "a textarea at least 48px (the field's 48 as its floor)");
  assert.match(src, /const canConfirm = trimmed\.length >= ORDER_REASON_MIN_LEN && !isPending;/, "today's rule");
  assert.match(src, /const tooShort = trimmed\.length > 0 && trimmed\.length < ORDER_REASON_MIN_LEN;/, "today's rule");
  assert.match(src, /\{tooShort && \(\s*<p id="cancel-reason-short" data-ui="cancel-reason-short" className=\{SHORT_CLASS\}>\s*At least \{ORDER_REASON_MIN_LEN\} characters\.\s*<\/p>/, "the message");
  assert.match(src, /const SHORT_CLASS = "text-\[13px\] font-medium text-status-bad-ink";/, "13/500 --bad-i");
  assert.match(src, /useEffect\(\(\) => \{\s*setReason\(""\);\s*\}, \[order\?\._id\]\);/, "a fresh reason for each order, as today");
});

test("CancelOrderDialog: 'Cancel order' in --bad (off until 3 characters and while sending, today's spinner), sends the trimmed reason; 'Keep order' on --surface-3 closes it", () => {
  const src = read(DIALOG);
  const confirm = src.slice(src.indexOf('data-ui="cancel-confirm"'), src.indexOf("</button>", src.indexOf('data-ui="cancel-confirm"')));
  assert.ok(confirm.includes("disabled={!canConfirm}") && confirm.includes("onClick={() => onConfirm(trimmed)}"), "today's submit");
  assert.ok(confirm.includes("className={cn(CONFIRM_SHEET_BUTTON_CLASS, CONFIRM_SHEET_DESTRUCTIVE_CLASS, BRAND_PRESS_CLASS)}"), "46px, --bad, white");
  assert.match(confirm, /\{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" \/>\}\s*Cancel order/, "the spinner, then the words");
  assert.match(src, /<DialogPrimitive\.Close data-ui="cancel-keep" disabled=\{isPending\} className=\{cn\(CONFIRM_SHEET_BUTTON_CLASS, KEEP_CLASS, BRAND_PRESS_CLASS\)\}>\s*Keep order\s*<\/DialogPrimitive\.Close>/, "the HTML confirm's second button (kind 0), our words");
  assert.match(src, /const KEEP_CLASS = "border-transparent bg-surface-3 text-foreground";/, "values 12.1 kind 0: --surface-3, --text, a transparent rule (ConfirmDialog's own)");
  assert.ok(src.indexOf('data-ui="cancel-confirm"') < src.indexOf('data-ui="cancel-keep"'), "the action first");
});

test("Settings hints quote the new button words (design 11): 'press Reprint KOT' and 'press Reprint token' on any order in Orders", () => {
  assert.ok(read("app/(dashboard)/settings/kitchen-ticket/page.tsx").includes("To see it on paper, save, then press Reprint KOT on any order in Orders."), "kitchen ticket");
  assert.ok(read("app/(dashboard)/settings/tokens/page.tsx").includes("To see it on paper, save, then press Reprint token on any order in Orders."), "tokens");
});
