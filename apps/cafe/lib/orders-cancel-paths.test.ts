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

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const PAGE = "app/(dashboard)/orders/page.tsx";
const DASHBOARD = "app/(dashboard)/page.tsx";
const DIALOG = "components/orders/CancelOrderDialog.tsx";

// ── The pages (Ruling P6; design 6.6, 6.11; Review Focus 4) ─────────────────────────────────────────────────────────

test("the /orders page: admins get the detail's cancel; after a cancel the detail shows the cancelled order the server returns, chosen like a settle", () => {
  const src = read(PAGE);
  const el = src.slice(src.indexOf("<OrderDetailSheet"), src.indexOf("/>", src.indexOf("<OrderDetailSheet")) + 2);
  assert.match(el, /onCancel=\{isAdmin \? setCancelling : undefined\}/, "admins only (staff never see the danger link)");
  assert.match(el, /cancelOpen=\{cancelling !== null\}/, "the frame holds while the cancel sheet is up");
  const confirm = src.slice(src.indexOf("const confirmCancel = async (reason: string) => {"), src.indexOf("};", src.indexOf("const confirmCancel")));
  assert.match(confirm, /setDetail\(await cancelOrder\.mutateAsync\(\{ id: cancelling\._id, data: \{ reason \} \}\)\);\s*setCancelling\(null\);/, "the cancelled order the server returns becomes the detail (design 6.6: Notify kitchen at hand)");
  assert.ok(src.indexOf("const setDetail = ") < src.indexOf("const confirmCancel"), "setDetail (tappedChoice under the latest key) is the one used");
  assert.match(src, /\{isAdmin && \(\s*<CancelOrderDialog\s+order=\{cancelling\}/, "the dialog mounts for admins only, as today");
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
  const overlay = src.indexOf('<DialogPrimitive.Overlay data-ui="cancel-sheet" className={CONFIRM_SHEET_SCRIM_CLASS}>');
  const content = src.indexOf('<DialogPrimitive.Content data-ui="cancel-panel" className={CONFIRM_SHEET_PANEL_CLASS}>');
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
