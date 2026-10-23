// U2 Task 7 (2026-10-23): the order detail's actions (docs/superpowers/specs/2026-10-22-orders-html-values.md 11.7 quick
// actions, 11.8 danger link, 11.9 foot; docs/superpowers/specs/2026-10-23-orders-match-html-design.md 6.9, 6.10, 6.11, Q7;
// controller rulings P2 and P6): the quick actions' words and the foot as a pure model (lib/order-detail-view.ts), their
// classes (lib/orders-layout.ts), then source pins — the grid, the danger link and the foot are drawn inside
// components/orders/OrderDetailSheet.tsx (Ruling P2) with today's print handlers and their pinned attribute pairs. Who
// gets the cancel, and the cancel sheet itself: lib/orders-cancel-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detailFoot, quickActions, type QuickAction } from "./order-detail-view";
import {
  ORDER_DANGER_CLASS,
  ORDER_DETAIL_FOOT_CLASS,
  ORDER_DETAIL_SCROLL_CLASS,
  ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS,
  ORDER_EDIT_ITEMS_CLASS,
  ORDER_QUICK_ACTION_CLASS,
  ORDER_QUICK_GRID_CLASS,
  ORDER_QUICK_LABEL_CLASS,
  ORDER_SETTLE_CLASS,
  detailFootClass,
  quickGridClass,
} from "./orders-layout";
import { minutesBefore, order, printed, settled } from "./orders-lanes.fixtures";
import { stripComments } from "./source-pin-utils";
import { cn } from "./utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const hasAll = (cls: string, needles: string[], what: string): void => {
  for (const n of needles) assert.ok(tokens(cls).includes(n), `${what}: "${n}" (has "${cls}")`);
};
const SHEET = "components/orders/OrderDetailSheet.tsx";
const words = (list: QuickAction[]): string[] => list.map((a) => `${a.key}:${a.label}`);

// ── quickActions (design 6.9; values 11.7, 11.10) ───────────────────────────────────────────────────────────────────

test("quickActions: an open tab at a table, bill not printed — Print bill · Reprint KOT · Share bill · Move table (one row of four)", () => {
  assert.deepEqual(words(quickActions(order("1", { tableNo: "T-4" }))), ["bill:Print bill", "kot:Reprint KOT", "share:Share bill", "move:Move table"], "the HTML's open set, our words");
});

test("quickActions: a bill printed for the current total reads 'Reprint bill'; printed but changed since reads 'Print bill' again (billPrintedNow, Q11)", () => {
  assert.equal(quickActions(printed("1", { tableNo: "T-1", total: 1063 }))[0].label, "Reprint bill", "printed now");
  assert.equal(quickActions(printed("1", { tableNo: "T-1", total: 1063, billFirstPrintedTotal: 900 }))[0].label, "Print bill", "the bill moved since its print");
});

test("quickActions: an open tab with a token — five: Print bill · Reprint KOT · Share bill · Reprint token · Move table (3 + 2)", () => {
  assert.deepEqual(
    words(quickActions(order("1", { tableNo: "T-4", tokenNumber: 12 }))),
    ["bill:Print bill", "kot:Reprint KOT", "share:Share bill", "token:Reprint token", "move:Move table"],
    "our token between Share and Move (today's order)",
  );
});

test("quickActions: a walk-in open tab — 'Assign table' (MoveTableDialog assigns a table to a tab with none)", () => {
  assert.equal(quickActions(order("1", {})).at(-1)?.label, "Assign table", "no table: Assign");
  assert.equal(quickActions(order("1", { tableNo: "" })).at(-1)?.label, "Assign table", "an empty table name: Assign");
});

test("quickActions: a settled bill — Reprint bill · Reprint KOT · Share bill (+ Reprint token with a token); never Move", () => {
  const paid = settled("1", 879, 879);
  assert.deepEqual(words(quickActions(paid)), ["bill:Reprint bill", "kot:Reprint KOT", "share:Share bill"], "our settled set (the HTML's has no KOT: mapped)");
  assert.deepEqual(words(quickActions({ ...paid, tokenNumber: 7 })).at(-1), "token:Reprint token", "with a token");
  assert.ok(!quickActions({ ...paid, tableNo: "T-4" }).some((a) => a.key === "move"), "a settled bill never moves");
});

test("quickActions: a cancelled order — Reprint bill · Notify kitchen (today's stop notice) · Share bill; no token, no move", () => {
  const cancelled = order("1", { status: "Cancelled", tableNo: "T-7", tokenNumber: 3, cancelledAt: minutesBefore(0) });
  assert.deepEqual(words(quickActions(cancelled)), ["bill:Reprint bill", "kot:Notify kitchen", "share:Share bill"], "design 6.9");
});

test("quickActions: the token and move gates are the sheet's own (hasToken: a token and not cancelled; isOpenTab: Pending)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["open, token", { tokenNumber: 1 }],
    ["open, no token", {}],
    ["settled, token", { status: "Completed", tokenNumber: 1 }],
    ["cancelled, token", { status: "Cancelled", tokenNumber: 1 }],
    ["token 0", { tokenNumber: 0 }],
  ];
  for (const [what, over] of cases) {
    const o = order("1", over);
    const keys = quickActions(o).map((a) => a.key);
    const hasToken = o.tokenNumber !== undefined && o.status !== "Cancelled";
    assert.equal(keys.includes("token"), hasToken, `${what}: the token action iff hasToken`);
    assert.equal(keys.includes("move"), o.status === "Pending", `${what}: the move action iff isOpenTab`);
  }
});

// ── detailFoot (design 6.9, Q7; values 11.9) ────────────────────────────────────────────────────────────────────────

test("detailFoot: an open tab at a table — Edit items for that table + 'Settle & pay · ₹x'; a walk-in tab Settle & pay alone; settled and cancelled none", () => {
  assert.deepEqual(detailFoot(order("1", { tableNo: "T-4", total: 1063 })), { editTable: "T-4", settleLabel: "Settle & pay · ₹1,063" }, "both buttons");
  assert.deepEqual(detailFoot(order("1", { total: 100000 })), { editTable: null, settleLabel: "Settle & pay · ₹1,00,000" }, "a walk-in: Settle & pay full width");
  assert.equal(detailFoot(settled("1", 879, 879)), null, "a settled bill: no foot");
  assert.equal(detailFoot(order("1", { status: "Cancelled", tableNo: "T-7" })), null, "a cancelled order: no foot");
});

// ── The classes (values 11.7-11.9) ──────────────────────────────────────────────────────────────────────────────────

test("ORDER_QUICK_GRID_CLASS / quickGridClass: a 1px --border box, radius 12, clipped, on --surface, never shrinking; up to four in one row, five as 3 + 2 on six columns", () => {
  hasAll(ORDER_QUICK_GRID_CLASS, ["grid", "flex-none", "overflow-hidden", "rounded-[12px]", "border", "border-border", "bg-card"], "values 11.7 grid");
  assert.ok(!tokens(ORDER_QUICK_GRID_CLASS).some((t) => /^(shrink|min-h-0)/.test(t)), "never squeezed (values 20 #2-#3 not copied)");
  assert.equal(quickGridClass(2), cn(ORDER_QUICK_GRID_CLASS, "grid-cols-2"), "two: repeat(2, minmax(0, 1fr))");
  assert.equal(quickGridClass(3), cn(ORDER_QUICK_GRID_CLASS, "grid-cols-3"), "three");
  assert.equal(quickGridClass(4), cn(ORDER_QUICK_GRID_CLASS, "grid-cols-4"), "four");
  const five = quickGridClass(5);
  hasAll(five, ["grid-cols-6", "[&>*]:col-span-2", "[&>:nth-child(n+4)]:col-span-3", "[&>:nth-child(n+4)]:border-t", "[&>:nth-child(4)]:[border-left:0]"], "five: three of two columns, then two of three under a rule; the fourth starts its row");
});

test("ORDER_QUICK_ACTION_CLASS: 62px, the icon over the 12/600 label 5px apart, 0 4px, one line; a 1px --border rule on its left but the first's; hover --hover", () => {
  hasAll(
    ORDER_QUICK_ACTION_CLASS,
    ["flex", "h-[62px]", "cursor-pointer", "flex-col", "items-center", "justify-center", "gap-[5px]", "border-l", "border-border", "first:[border-left:0]", "bg-transparent", "px-1", "py-0", "text-center", "text-[12px]", "font-semibold", "whitespace-nowrap", "text-foreground", "hover:bg-hover"],
    "values 11.7 button",
  );
});

test("ORDER_DANGER_CLASS: centred, 6px 10px, radius 8, 13/600 --bad-i, hover --bad-t, never shrinking (values 11.8)", () => {
  hasAll(
    ORDER_DANGER_CLASS,
    ["flex", "flex-none", "items-center", "gap-1.5", "self-center", "cursor-pointer", "rounded-[8px]", "[border:0]", "bg-transparent", "px-2.5", "py-1.5", "text-[13px]", "font-semibold", "text-status-bad-ink", "hover:bg-status-bad-tint"],
    "values 11.8",
  );
});

test("ORDER_DETAIL_FOOT_CLASS / detailFootClass: 12px 18px, 14px + the safe-area inset below (12px + the inset on a phone), a 1px --border rule, 8px apart; 1fr 2fr with Edit items, one column without", () => {
  hasAll(
    ORDER_DETAIL_FOOT_CLASS,
    ["grid", "flex-none", "gap-2", "border-t", "border-border", "bg-card", "px-[18px]", "pt-3", "pb-[calc(14px+env(safe-area-inset-bottom))]", "max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]"],
    "values 11.9 foot (cartFootB; U1 P49: the window's foot adds the inset)",
  );
  assert.equal(detailFootClass(true), cn(ORDER_DETAIL_FOOT_CLASS, "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"), "both buttons");
  assert.equal(detailFootClass(false), cn(ORDER_DETAIL_FOOT_CLASS, "grid-cols-1"), "Settle & pay alone, full width");
});

test("ORDER_EDIT_ITEMS_CLASS and ORDER_SETTLE_CLASS: 48px radius 10, the UA's 1px 6px, one line; Edit items 14/600 outlined on --surface (hover --hover), Settle & pay 15/600 on --accent (hover --accent-h)", () => {
  hasAll(
    ORDER_EDIT_ITEMS_CLASS,
    ["flex", "h-12", "cursor-pointer", "items-center", "justify-center", "gap-[7px]", "rounded-[10px]", "border", "border-border", "bg-card", "px-1.5", "py-px", "text-[14px]", "font-semibold", "whitespace-nowrap", "text-foreground", "hover:bg-hover"],
    "values 11.9 Edit items",
  );
  hasAll(
    ORDER_SETTLE_CLASS,
    ["flex", "h-12", "cursor-pointer", "items-center", "justify-center", "gap-2", "rounded-[10px]", "[border:0]", "bg-primary", "px-1.5", "py-px", "text-[15px]", "font-semibold", "whitespace-nowrap", "text-primary-foreground", "hover:bg-primary-hover"],
    "values 11.9 primary",
  );
});

test("ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS: with a foot under it the body's bottom room is the HTML's 18px (the foot takes the inset)", () => {
  assert.equal(ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS, "pb-[18px]", "values 11.4: padding-bottom 18");
  assert.ok(tokens(cn(ORDER_DETAIL_SCROLL_CLASS, ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS)).includes("pb-[18px]"), "it replaces the inset room");
  assert.ok(!cn(ORDER_DETAIL_SCROLL_CLASS, ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS).includes("safe-area"), "no second inset over the foot");
});

// ── The sheet draws them (Ruling P2; source pins) ───────────────────────────────────────────────────────────────────

test("OrderDetailSheet: the quick actions grid under the body with today's print handlers — the pinned pairs onClick={printBill} disabled={enqueuePending} etc. moved WITH the buttons (same meaning)", () => {
  const src = read(SHEET);
  assert.match(src, /import \{[^}]*\bquickActions\b[^}]*\} from "@\/lib\/order-detail-view";/, "the words from lib/order-detail-view.ts");
  assert.match(src, /const quick = order \? quickActions\(order\) : \[\];/, "the live order's actions (none while a sheet closes)");
  const at = src.indexOf('<div data-ui="order-detail-quick" className={quickGridClass(quick.length)}>');
  assert.ok(at > src.indexOf("<OrderDetailBody"), "the grid, after the body");
  const grid = src.slice(at, src.indexOf("</div>", at));
  assert.match(grid, /<QuickAction onClick=\{printBill\} disabled=\{enqueuePending\} label=\{quickLabel\("bill"\)\}/, "Print bill / Reprint bill = today's Print (P28, P34)");
  assert.match(grid, /<QuickAction onClick=\{printKitchenSlip\} disabled=\{enqueuePending\} label=\{quickLabel\("kot"\)\}/, "Reprint KOT / Notify kitchen = today's KOT (P28, P34)");
  assert.match(grid, /href=\{whatsAppLink\(order, restaurantName, receiptFooter\)\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/, "Share bill = today's WhatsApp link");
  assert.match(grid, /\{hasToken && \(\s*<QuickAction onClick=\{printToken\} disabled=\{enqueuePending\} label=\{quickLabel\("token"\)\}/, "Reprint token: gated, disabled while a print is queued (P37)");
  assert.match(grid, /\{isOpenTab && \(\s*<QuickAction onClick=\{\(\) => setMoveOpen\(true\)\} label=\{quickLabel\("move"\)\}/, "Move / Assign table on an open tab (all staff)");
  const order_ = ["onClick={printBill}", "onClick={printKitchenSlip}", "whatsAppLink(order", "onClick={printToken}", "setMoveOpen(true)"].map((n) => grid.indexOf(n));
  assert.deepEqual([...order_].sort((a, b) => a - b), order_, "in quickActions' order: bill, kot, share, token, move");
  assert.ok(order_.every((i) => i >= 0), "every action in the grid");
  assert.match(src, /\{order && \(\s*<div data-ui="order-detail-quick"/, "drawn only with a live order");
  assert.match(src, /const quickLabel = \(key: QuickActionKey\): string => quick\.find\(\(a\) => a\.key === key\)\?\.label \?\? "";/, "each label is quickActions'");
  for (const gone of ["<SheetFooter", "Settle &amp; Pay", "HandCoins", "Print token again", '<Button variant="outline"']) assert.ok(!src.includes(gone), `today's footer is gone: ${gone}`);
});

test("QuickAction: a plain button with the HTML's look and press, its icon then its label", () => {
  const src = read(SHEET);
  const fn = src.slice(src.indexOf("function QuickAction("), src.indexOf("\nfunction ", src.indexOf("function QuickAction(") + 1));
  assert.ok(fn.length > 0, "landmark: QuickAction");
  assert.match(fn, /<button\s+type="button"\s+data-ui="order-detail-quick-action"\s+onClick=\{onClick\}\s+disabled=\{disabled\}\s+className=\{cn\(ORDER_QUICK_ACTION_CLASS, BRAND_PRESS_CLASS\)\}/, "values 11.7 + the HTML's press");
  assert.match(fn, /\{icon\}\s*<span data-ui="order-detail-quick-label" className=\{ORDER_QUICK_LABEL_CLASS\}>\{label\}<\/span>/, "the icon, then the label");
  assert.match(
    src,
    /data-ui="order-detail-quick-action"[^>]*className=\{cn\(ORDER_QUICK_ACTION_CLASS, BRAND_PRESS_CLASS\)\}[^>]*>\s*<Glyph path=\{QUICK_PATHS\.share\} \/>\s*<span data-ui="order-detail-quick-label" className=\{ORDER_QUICK_LABEL_CLASS\}>\{quickLabel\("share"\)\}<\/span>/,
    "the share link wears the same look",
  );
});

test("ORDER_QUICK_LABEL_CLASS: one line, cut with an ellipsis inside its cell (a phone narrower than 390px), never spilling", () => {
  assert.equal(ORDER_QUICK_LABEL_CLASS, "max-w-full truncate", "the label never passes its cell");
});

test("OrderDetailSheet: 'Cancel this order' only when the page gives the cancel and the order is not cancelled; it hands the live order to the page (Ruling P6)", () => {
  const src = read(SHEET);
  assert.match(src, /onCancel,\s/, "the prop is read");
  const at = src.indexOf("{order && onCancel && !isCancelled && (");
  assert.ok(at > src.indexOf('<div data-ui="order-detail-quick"'), "under the quick actions, inside the scrolling body");
  const link = src.slice(at, src.indexOf("</button>", at));
  assert.match(link, /<button type="button" data-ui="order-detail-danger" onClick=\{\(\) => onCancel\(order\)\} className=\{cn\(ORDER_DANGER_CLASS, BRAND_PRESS_CLASS\)\}>/, "values 11.8");
  assert.match(link, /<Glyph path=\{QUICK_PATHS\.ban\} size=\{15\} stroke=\{1\.9\} \/>\s*Cancel this order/, "the ban glyph 15px, the HTML's words");
  assert.equal(src.split("Cancel this order").length - 1, 1, "one danger link");
  const scrollEnd = src.indexOf("</div>", src.indexOf("Cancel this order"));
  assert.ok(src.indexOf('<div data-ui="order-detail-scroll"') < at && scrollEnd > at, "inside the body (it scrolls with it)");
});

test("OrderDetailSheet: the foot under the body — Edit items (a Link to /pos, no prefetch, its plain click hands the table over: offerPosTable) only for an open tab at a table, then Settle & pay → openSettle; none when settled or cancelled", () => {
  const src = read(SHEET);
  assert.match(src, /import Link from "next\/link";/, "next/link");
  assert.match(src, /import \{ offerPosTable \} from "@\/lib\/pos-table-handoff";/, "the Floor's hand-off (no new request)");
  assert.match(src, /const foot = order \? detailFoot\(order\) : null;/, "the live order's foot");
  assert.match(src, /const editTable = foot\?\.editTable \?\? null;/, "the table Edit items hands over");
  const at = src.indexOf("{foot && (");
  assert.ok(at > src.indexOf("Cancel this order") && at < src.indexOf("pointer-events-none absolute left-[-9999px]"), "after the scrolling body, before the print sources");
  const foot = src.slice(at, src.indexOf("pointer-events-none absolute left-[-9999px]"));
  assert.match(foot, /<div data-ui="order-detail-foot" className=\{detailFootClass\(editTable !== null\)\}>/, "values 11.9 columns");
  assert.match(foot, /\{editTable !== null && \(\s*<Link\s+href="\/pos"\s+prefetch=\{false\}/, "Edit items only for a tab at a table: a plain /pos link (the warm prefetch, no ?table=)");
  assert.match(foot, /onClick=\{\(e\) => \{\s*if \(e\.button === 0 && !e\.metaKey && !e\.ctrlKey && !e\.shiftKey && !e\.altKey\) offerPosTable\(editTable, Date\.now\(\)\);\s*\}\}/, "a plain click hands the table over (a new-tab click opens a plain New Order, as the Floor's tile)");
  assert.match(foot, /<Glyph path=\{QUICK_PATHS\.pencil\} size=\{16\} stroke=\{1\.9\} \/>\s*Edit items/, "the pencil, the HTML's words");
  assert.match(foot, /<button type="button" data-ui="order-detail-settle" onClick=\{openSettle\} className=\{cn\(ORDER_SETTLE_CLASS, BRAND_PRESS_CLASS\)\}>\s*\{foot\.settleLabel\}\s*<\/button>/, "Settle & pay · ₹x = today's Settle & Pay (the same latch)");
  assert.match(src, /className=\{cn\(ORDER_DETAIL_SCROLL_CLASS, foot && ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS\)\}/, "with a foot the body's bottom room is 18px (the foot takes the inset)");
});

test("OrderDetailSheet: the frame stays while the page's cancel sheet is up, as for the payment and move sheets (frameInUse)", () => {
  const src = read(SHEET);
  assert.match(src, /cancelOpen\?: boolean;/, "the page says when its cancel sheet is open");
  assert.match(src, /cancelOpen = false,/, "the dashboard: never");
  assert.match(src, /const frame = frameInUse\(heldFrame, forWidth, settleOpen \|\| moveOpen \|\| cancelOpen\);/, "a frame mounted under the open cancel sheet would take Radix's top layer");
});
