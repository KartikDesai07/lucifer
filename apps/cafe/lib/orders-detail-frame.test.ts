// U2 Task 5 (2026-10-23): the order detail's frames and the Orders page's choice (docs/superpowers/specs/
// 2026-10-23-orders-match-html-design.md 6.6, Q8, the owner's right-panel rule of 2026-10-22; docs/superpowers/specs/
// 2026-10-22-orders-html-values.md 11.1 container, 12 the sheet, 13 no selection; rulings P9 and P11; Review Focus 2):
// which frame mounts at which width (exactly one, none while the width is unknown; the frame in use kept while the
// payment or move sheet it opened is up), the frames' classes, and source pins on components/orders/OrderDetailSheet.tsx,
// OrderDetailHead.tsx and app/(dashboard)/orders/page.tsx (the choice itself: lib/orders-choice.test.ts; the shared
// media query list both read: lib/use-media-query.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { POS_CART_SHEET_CLASS, POS_CART_SHEET_SCRIM_CLASS } from "./pos-layout";
import {
  ORDERS_DETAIL_COLUMN_CLASS,
  ORDERS_XL_QUERY,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_SCROLL_CLASS,
  ORDER_DETAIL_SHEET_CLASS,
  ORDER_DETAIL_SHEET_SCRIM_CLASS,
  ORDER_DETAIL_SIDE_CLASS,
  frameInUse,
  orderDetailFrame,
  type OrderDetailFrame,
  type OrderDetailPlace,
} from "./orders-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const hasAll = (cls: string, needles: string[], what: string): void => {
  for (const n of needles) assert.ok(tokens(cls).includes(n), `${what}: "${n}" (has "${cls}")`);
};
const SHEET = "components/orders/OrderDetailSheet.tsx";
const PAGE = "app/(dashboard)/orders/page.tsx";
const DASHBOARD = "app/(dashboard)/page.tsx";

// ── The frame per width (design 6.6, Q8; owner rule 2026-10-22) ────────────────────────────────────────────────────

test("ORDERS_XL_QUERY: the owner's 1280px line for right panels", () => {
  assert.equal(ORDERS_XL_QUERY, "(min-width: 1280px)", "side panels only from 1280px (owner rule 2026-10-22)");
});

test("orderDetailFrame: from 1280px the column on /orders and a side sheet elsewhere; below, the bottom sheet on both; none while the width is unknown", () => {
  assert.equal(orderDetailFrame("page", true), "column", "/orders from 1280px: the HTML's 400px column");
  assert.equal(orderDetailFrame("overlay", true), "side", "the dashboard from 1280px: a 400px side sheet over a scrim");
  assert.equal(orderDetailFrame("page", false), "bottom", "/orders below 1280px: full screen from the bottom");
  assert.equal(orderDetailFrame("overlay", false), "bottom", "the dashboard below 1280px: the same bottom sheet");
  for (const place of ["page", "overlay"] as OrderDetailPlace[]) {
    assert.equal(orderDetailFrame(place, null), null, `${place}: the width not known yet (server render) renders no frame`);
  }
});

test("frameInUse: while the payment or move sheet the detail opened is up, the frame it opened from stays at any width; once it closes, the frame follows the width", () => {
  const frames: (OrderDetailFrame | null)[] = ["column", "side", "bottom", null];
  for (const held of frames) {
    for (const forWidth of frames) {
      assert.equal(frameInUse(held, forWidth, true), held, `a sheet up: ${held} stays (the width says ${forWidth})`);
      assert.equal(frameInUse(held, forWidth, false), forWidth, `no sheet up: ${forWidth} (held ${held})`);
    }
  }
  // The crossings Review Focus 2 names, for both places.
  assert.equal(frameInUse(orderDetailFrame("page", true), orderDetailFrame("page", false), true), "column", "/orders 1280 -> 1000 with the payment up: no bottom sheet mounts over it");
  assert.equal(frameInUse(orderDetailFrame("overlay", false), orderDetailFrame("overlay", true), true), "bottom", "the dashboard 1000 -> 1280: no side sheet (and kit scrim) over the payment");
});

// ── The frames' classes (values 11.1, 12; U1 Task 14's cart sheet) ──────────────────────────────────────────────────

test("ORDER_DETAIL_COLUMN_CLASS: fills the page's 400px column, which carries the look (one column frame, never two)", () => {
  hasAll(ORDER_DETAIL_COLUMN_CLASS, ["flex", "min-h-0", "flex-1", "flex-col", "leading-[normal]"], "the column frame");
  for (const look of ["border-l", "bg-card", "w-[400px]"]) {
    assert.ok(!tokens(ORDER_DETAIL_COLUMN_CLASS).includes(look), `the column frame draws no "${look}": the page's column has it`);
  }
  hasAll(ORDERS_DETAIL_COLUMN_CLASS, ["border-l", "border-border", "bg-card"], "landmark: the page's column carries the surface and its rule");
});

test("ORDER_DETAIL_SHEET_CLASS: the bottom sheet over the whole window at z 15, the 1px rule on its left, no shadow; the /pos cart sheet's slide up and down, no scrim drawn", () => {
  assert.equal(ORDER_DETAIL_SHEET_CLASS, POS_CART_SHEET_CLASS, "the /pos cart sheet's one constant (the two cannot drift)");
  assert.equal(ORDER_DETAIL_SHEET_SCRIM_CLASS, POS_CART_SHEET_SCRIM_CLASS, "and its overlay's");
  hasAll(
    ORDER_DETAIL_SHEET_CLASS,
    ["fixed", "inset-0", "z-[15]", "flex", "flex-col", "border-l", "border-border", "bg-card", "font-sans", "leading-[normal]", "text-foreground", "outline-none"],
    "values 12 / 11.1 at 390 (owner rule: the phone's sheet at every width below 1280px)",
  );
  const slides = tokens(POS_CART_SHEET_CLASS).filter((t) => t.includes("animate-cart-sheet-"));
  assert.deepEqual(slides, ["motion-safe:data-[state=open]:animate-cart-sheet-up", "motion-safe:data-[state=closed]:animate-cart-sheet-down"], "landmark: the cart sheet's slides");
  hasAll(ORDER_DETAIL_SHEET_CLASS, slides, "the same slides, reused (not copied keyframes)");
  assert.ok(!tokens(ORDER_DETAIL_SHEET_CLASS).some((t) => /shadow/.test(t)), "no shadow");
  assert.ok(!tokens(ORDER_DETAIL_SHEET_CLASS).some((t) => /^(?:max-)?(?:sm|md|lg|xl|tab|desk|wide):/.test(t)), "one form below 1280px: no width variant");
  assert.equal(ORDER_DETAIL_SHEET_SCRIM_CLASS, "hidden", "no scrim drawn (values 12 at 390: the sheet covers it; owner rule)");
});

test("ORDER_DETAIL_SCROLL_CLASS: under the head the rest scrolls (values 11.1), the HTML's body (values 11.4, U2 Task 6): padding 14 18 18, the parts 14px apart; its foot clears the window's safe-area inset (U1 P49)", () => {
  hasAll(
    ORDER_DETAIL_SCROLL_CLASS,
    ["flex", "min-h-0", "flex-1", "flex-col", "gap-3.5", "overflow-y-auto", "overflow-x-hidden", "px-[18px]", "pt-3.5", "pb-[calc(18px+env(safe-area-inset-bottom))]"],
    "the detail's scrolling part",
  );
});

test("ORDER_DETAIL_SIDE_CLASS: the kit sheet at the column's 400px on --surface with its left rule, square, unpadded; the kit's own close hidden (the head's ✕ is the one)", () => {
  hasAll(
    ORDER_DETAIL_SIDE_CLASS,
    ["flex", "flex-col", "w-[400px]", "sm:max-w-none", "gap-0", "p-0", "rounded-none", "border-l", "border-border", "bg-card", "font-sans", "leading-[normal]", "text-foreground", "[&>button]:hidden"],
    "design 6.6 dashboard side sheet",
  );
});

// ── OrderDetailSheet: one width, one frame (source pins) ────────────────────────────────────────────────────────────

/** The source of `function NAME(` up to the next top-level function. */
function functionSrc(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `landmark: OrderDetailSheet.tsx has ${name}`);
  const end = src.indexOf("\nfunction ", at + 1);
  return src.slice(at, end < 0 ? undefined : end);
}

test("OrderDetailSheet: one useMediaQuery(ORDERS_XL_QUERY) gives the frame for the width; the frame in use is latched while the payment or move sheet is up (frameInUse); the place defaults to the dashboard's overlay", () => {
  const src = read(SHEET);
  assert.equal(src.split("useMediaQuery(").length - 1, 1, "one width read in the sheet");
  assert.match(src, /const forWidth = orderDetailFrame\(place, useMediaQuery\(ORDERS_XL_QUERY\)\);/, "the frame for the width");
  assert.match(src, /const \[heldFrame, setHeldFrame\] = useState\(forWidth\);/, "the frame in use is held");
  // U2 Task 7: the page's cancel sheet joins the latch (same meaning: no frame mounts under an open nested sheet). The
  // final fix wave (moved on purpose): only while there is an order — a detail with none holds no sheet.
  assert.match(src, /const frame = frameInUse\(heldFrame, forWidth, !!order && \(settleOpen \|\| moveOpen \|\| cancelOpen\)\);/, "kept while the payment (with its customer sheet), the move sheet or the page's cancel sheet is up over an order");
  assert.match(src, /if \(frame !== heldFrame\) setHeldFrame\(frame\);/, "stored during render, only on a change");
  assert.ok(src.indexOf("const [settleOpen, setSettleOpen]") < src.indexOf("frameInUse(") && src.indexOf("const [moveOpen, setMoveOpen]") < src.indexOf("frameInUse("), "the latch reads both sheets' state");
  assert.match(src, /<DetailFrame frame=\{frame\}/, "the frame drawn is the one in use");
  assert.match(src, /place = "overlay"/, "the dashboard passes nothing new: the overlay frames");
  assert.match(src, /place\?: OrderDetailPlace;/, "the place prop");
  assert.match(src, /onCancel\?: \(order: Order\) => void;/, "the cancel prop (Task 7 draws the danger link)");
  assert.ok(!src.includes("useNow("), "no clock of its own: /orders runs one minute timer (the head ticks only without the page's)");
});

test("DetailFrame: no frame while the width is unknown; the column is a plain div with no SheetContent, its words only once the list has answered; both sheets keep ref={sheetRef} and the nested-dialog rule (ruling P38)", () => {
  const frame = functionSrc(read(SHEET), "DetailFrame");
  assert.match(frame, /if \(frame === null\) return null;/, "the width not known yet: no frame");
  const column = frame.slice(frame.indexOf('if (frame === "column")'), frame.indexOf("<Sheet open"));
  assert.ok(column.length > 0, "landmark: the column branch comes before the sheets");
  assert.match(column, /<div data-ui="order-detail" className=\{ORDER_DETAIL_COLUMN_CLASS\}>/, "the column frame");
  assert.ok(!/SheetContent|DialogPrimitive|<Sheet\b|onClose/.test(column), "the column branch mounts no dialog");
  assert.match(
    column,
    /\{open \? \(\s*children\s*\) : waiting \? null : \(\s*<p data-ui="order-detail-none" className="m-auto p-6 text-center text-\[14px\] text-muted-foreground">\s*Select an order to see its details\.\s*<\/p>/,
    "nothing chosen: nothing while the list has not answered, then the HTML's words (values 13) — no buttons without an order",
  );
  const NESTED = String.raw`onInteractOutside=\{\(e\) => keepOpenForNestedDialog\(e, sheetRef\.current\)\}`;
  assert.match(frame, new RegExp(String.raw`<SheetContent\s+ref=\{sheetRef\}[^>]*className=\{ORDER_DETAIL_SIDE_CLASS\}[^>]*` + NESTED), "the side sheet");
  assert.match(frame, new RegExp(String.raw`<DialogPrimitive\.Content\s+ref=\{sheetRef\}[^>]*className=\{ORDER_DETAIL_SHEET_CLASS\}[^>]*` + NESTED), "the bottom sheet");
  assert.match(frame, /<DialogPrimitive\.Overlay className=\{ORDER_DETAIL_SHEET_SCRIM_CLASS\} \/>/, "the bottom sheet's overlay is mounted and never drawn (the scroll lock stays)");
  assert.match(frame, /frame === "side" \?/, "one sheet branch per frame");
  assert.equal(frame.split("ref={sheetRef}").length - 1, 2, "exactly the two sheet panels hold the ref");
  assert.match(read(SHEET), /waiting=\{listPending\}/, "the page's pending list reaches the column");
});

test("OrderDetailSheet: the frame wraps the head, the body and the off-screen print sources; the payment and move dialogs stay beside it (mounted once at every width)", () => {
  const src = read(SHEET);
  const ret = src.slice(src.indexOf("  return (\n    <>\n      <DetailFrame"));
  assert.ok(ret.length > 0, "landmark: the sheet's return opens with the frame");
  const frameEnd = ret.indexOf("</DetailFrame>");
  const inside = ret.slice(0, frameEnd);
  assert.match(inside, /<OrderDetailHead order=\{order\} now=\{now\}/, "the head inside the frame, on the page's tick when given");
  assert.ok(inside.includes('className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden'), "the print sources inside the frame");
  assert.match(inside, /onClose=\{frame === "column" \? undefined : \(\) => onOpenChange\(false\)\}/, "the ✕ in the sheets only (no ✕ in the column)");
  // U2 Task 7: over the foot the body's bottom room is 18px (the foot takes the inset); same frame.
  assert.match(inside, /<div data-ui="order-detail-scroll" className=\{cn\(ORDER_DETAIL_SCROLL_CLASS, foot && ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS\)\}>/, "under the head the rest scrolls (values 11.1)");
  assert.match(inside, /<div data-ui="order-detail-foot"/, "the foot inside the frame, under the body (values 11.9)");
  const after = ret.slice(frameEnd);
  assert.match(after, /<PaymentModal\b/, "the payment sheet beside the frame");
  assert.match(after, /<MoveTableDialog\b/, "the move sheet beside the frame");
  assert.equal(src.split("<PaymentModal").length - 1, 1, "one payment sheet");
  assert.equal(src.split("<OrderReceipt ").length - 1, 1, "one set of print sources");
});

test("KeepWhileClosing: through a sheet's close the last head and body stay drawn; the buttons and the print sources always follow the live order (the print guards unchanged)", () => {
  const src = read(SHEET);
  const keep = functionSrc(src, "KeepWhileClosing");
  assert.match(keep, /useLayoutEffect\(\(\) => \{\s*if \(show\) last\.current = children;\s*\}\);/, "the last shown children, kept after each commit with an order");
  assert.match(keep, /return show \? children : last\.current;/, "drawn only while the panel closes");
  const ret = src.slice(src.indexOf("  return (\n    <>\n      <DetailFrame"), src.indexOf("</DetailFrame>"));
  const kept = [...ret.matchAll(/<KeepWhileClosing show=\{!!order\}>([\s\S]*?)<\/KeepWhileClosing>/g)].map((m) => m[1]);
  assert.equal(kept.length, 2, "two kept parts: the head and the body");
  assert.match(kept[0], /^\s*\{order && <OrderDetailHead\b/, "the head");
  assert.match(kept[1], /^\s*\{order && <OrderDetailBody order=\{order\} \/>\}\s*$/, "the body (U2 Task 6: OrderDetailBody)");
  for (const part of kept) {
    // U2 Task 7: today's footer became the quick actions, the danger link and the foot (same meaning: never kept).
    for (const live of ["order-detail-quick", "order-detail-danger", "order-detail-foot", "onClick={printBill}", "onClick={printKitchenSlip}", "onClick={printToken}", "onCancel(", "<OrderReceipt", "<KOTReceipt", "<TokenSlip", "openSettle"]) {
      assert.ok(!part.includes(live), `${live} is never kept: it follows the live order`);
    }
  }
  const guard = functionSrc(src, "OrderDetailSheet");
  assert.match(guard, /const printBill = \(\) => \{[\s\S]*?if \(!order\) \{\s*toast\.error\(PRINT_ORDER_CHANGED_MESSAGE\);/, "landmark: Print still refuses a closed order (the live `order`)");
  assert.match(guard, /useLayoutEffect\(\(\) => \{\s*shownOrderRef\.current = order;\s*\}, \[order\]\);/, "landmark: localPrintOf still compares against the live order");
});

test("OrderDetailHead: the page's tick when given, else a minute tick of its own (the dashboard)", () => {
  const head = read("components/orders/OrderDetailHead.tsx");
  assert.match(head, /return now \? <HeadAt \{\.\.\.props\} now=\{now\} \/> : <HeadTicking \{\.\.\.props\} \/>;/, "one timer per page: the head ticks only without the page's");
  assert.match(head, /function HeadTicking\(props: Omit<OrderDetailHeadProps, "now">\) \{\s*return <HeadAt \{\.\.\.props\} now=\{useNow\(HEAD_CLOCK_MS\) \?\? new Date\(\)\} \/>;/, "its own minute");
  assert.match(head, /const HEAD_CLOCK_MS = 60_000;/, "once a minute, as the Orders page's");
});

// ── The pages (design 6.6, 6.11) ───────────────────────────────────────────────────────────────────────────────────

test("the /orders page: the detail mounts in the 400px column slot as place=\"page\" with the page's tick and its pending list; the slot keeps a press or focus inside as the operator's", () => {
  const src = read(PAGE);
  const slot = src.indexOf('<div data-ui="orders-detail-column" className={ORDERS_DETAIL_COLUMN_CLASS}');
  assert.ok(slot >= 0, "landmark: the column slot");
  const tag = src.slice(slot, src.indexOf(">", slot) + 1);
  assert.match(tag, /onPointerDownCapture=\{engage\}/, "a press inside the detail (or a sheet it opened) engages it");
  assert.match(tag, /onFocusCapture=\{engage\}/, "so does focus (the keyboard)");
  const sheet = src.slice(src.indexOf("<OrderDetailSheet", slot), src.indexOf("/>", src.indexOf("<OrderDetailSheet", slot)) + 2);
  assert.ok(src.indexOf("<OrderDetailSheet") > slot && src.indexOf("</div>", slot) > src.indexOf("<OrderDetailSheet"), "the detail inside the slot");
  assert.match(sheet, /\bplace="page"/, "the column frame from 1280px");
  assert.match(sheet, /\bnow=\{now\}/, "the meta clock reads the page's minute tick");
  assert.match(sheet, /\blistPending=\{listPending\}/, "the column waits for the list's answer");
  assert.match(sheet, /\border=\{liveOrderOf\(detail, list\)\}/, "the live row (P10)");
  assert.match(sheet, /\bonSettled=\{setDetail\}/, "a settle or a move keeps the fresher order chosen");
  assert.equal(src.split("<OrderDetailSheet").length - 1, 1, "one detail on the page");
});

test("the /orders page (ruling P11): the choice is keyed on the filter edits and the TYPED phone; the debounced search landing is not an edit; no row is taken until the list has answered; a tap or a settle reads the latest key", () => {
  const src = read(PAGE);
  assert.match(src, /const \[filterEdits, setFilterEdits\] = useState\(0\);/, "the edits count");
  assert.match(src, /const editFilters = \(update: \(f: OrdersFilterState\) => OrdersFilterState\) => \{\s*setFilters\(update\);\s*setFilterEdits\(\(n\) => n \+ 1\);\s*\};/, "an edit sets the filters and counts once");
  assert.match(src, /const setFilter = \(patch: Partial<OrdersFilterState>\) => editFilters\(\(f\) => \(\{ \.\.\.f, \.\.\.patch \}\)\);/, "lane, date, payment, table, chips, the search ✕: edits");
  const clear = src.slice(src.indexOf("const clearFilters"), src.indexOf("};", src.indexOf("const clearFilters")));
  assert.ok(clear.includes("editFilters(clearAllFilters)"), "Clear all / Reset: an edit");
  const debounce = src.slice(src.indexOf("const t = setTimeout(() => {"), src.indexOf("}, PHONE_DEBOUNCE_MS);"));
  assert.ok(debounce.includes("setFilters((f) => (f.phone === phone ? f : { ...f, phone }));"), "landmark: the debounced phone lands in the filters");
  assert.ok(!/editFilters|setFilterEdits/.test(debounce), "the debounced search landing is not an edit (it never drops the choice)");
  const seed = src.slice(src.indexOf("seedFromUrl(window.location.search)"), src.indexOf("}, []);", src.indexOf("seedFromUrl(window.location.search)")));
  assert.ok(seed.includes("setFilterEdits((n) => n + 1)"), "the URL seed is an edit (a row taken from the unseeded list goes)");
  assert.match(src, /const key = choiceKey\(filterEdits, phoneInput\);/, "the key: the edits and the typed phone");
  assert.match(src, /const listPending = orders\.data === undefined \|\| phoneInput\.trim\(\) !== filters\.phone;/, "pending: no answer yet, or a typed phone not searched yet");
  assert.match(src, /const xl = useMediaQuery\(ORDERS_XL_QUERY\);/, "the 1280px line");
  assert.match(src, /const \[held, setHeld\] = useState<OrdersChoice>\(\(\) => noChoice\(key\)\);/, "the stored choice");
  assert.match(src, /const choice = settleChoice\(held, key, xl, listPending \? undefined : shown\[0\]\);/, "no first row from a pending list (the rows shown are the old search's)");
  assert.match(src, /if \(choice !== held\) setHeld\(choice\);/, "stored only when it changes (no loop; no frame ever shows a stale choice)");
  assert.match(src, /const detail = choice\.order;/, "the detail is the settled choice");
  assert.match(src, /const keyRef = useRef\(key\);\s*useLayoutEffect\(\(\) => \{\s*keyRef\.current = key;\s*\}\);/, "the latest key, after each commit");
  assert.match(src, /const setDetail = \(order: Order \| null\) => setHeld\(tappedChoice\(order, keyRef\.current\)\);/, "a tap, or a settle landing later, is stored under the latest key");
  assert.match(src, /const engage = \(\) => setHeld\(engageChoice\);/, "engaging keeps it");
  assert.ok(!/\[detail, setDetail\] = useState/.test(src), "no second detail state");
});

test("the dashboard passes nothing new: its detail is the default overlay (a side sheet from 1280px, the bottom sheet below)", () => {
  const dash = read(DASHBOARD);
  const at = dash.indexOf("<OrderDetailSheet");
  const el = dash.slice(at, dash.indexOf("/>", at) + 2);
  assert.ok(at >= 0, "landmark: the dashboard's detail");
  for (const prop of ["place=", "onCancel=", "now=", "listPending="]) assert.ok(!el.includes(prop), `the dashboard passes no ${prop}`);
});

