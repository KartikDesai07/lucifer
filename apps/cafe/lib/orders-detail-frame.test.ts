// U2 Task 5 (2026-10-23): the order detail's frames and the Orders page's choice (docs/superpowers/specs/
// 2026-10-23-orders-match-html-design.md 6.6, Q8, the owner's right-panel rule of 2026-10-22; docs/superpowers/specs/
// 2026-10-22-orders-html-values.md 11.1 container, 12 the sheet, 13 no selection; ruling P9; Review Focus 2): which frame
// mounts at which width (exactly one, none while the width is unknown), the frames' classes, the page's choice (the
// first row taken only into an empty choice, dropped on any filter change, an auto-picked row giving way below 1280px),
// and source pins on components/orders/OrderDetailSheet.tsx and app/(dashboard)/orders/page.tsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { POS_CART_SHEET_CLASS } from "./pos-layout";
import {
  ORDERS_DETAIL_COLUMN_CLASS,
  ORDERS_XL_QUERY,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_SCROLL_CLASS,
  ORDER_DETAIL_SHEET_CLASS,
  ORDER_DETAIL_SHEET_SCRIM_CLASS,
  ORDER_DETAIL_SIDE_CLASS,
  orderDetailFrame,
  type OrderDetailPlace,
} from "./orders-layout";
import { engageChoice, noChoice, settleChoice, tappedChoice } from "./orders-choice";
import { order, state } from "./orders-lanes.fixtures";

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

// ── The frames' classes (values 11.1, 12; U1 Task 14's cart sheet) ──────────────────────────────────────────────────

test("ORDER_DETAIL_COLUMN_CLASS: fills the page's 400px column, which carries the look (one column frame, never two)", () => {
  hasAll(ORDER_DETAIL_COLUMN_CLASS, ["flex", "min-h-0", "flex-1", "flex-col", "leading-[normal]"], "the column frame");
  for (const look of ["border-l", "bg-card", "w-[400px]"]) {
    assert.ok(!tokens(ORDER_DETAIL_COLUMN_CLASS).includes(look), `the column frame draws no "${look}": the page's column has it`);
  }
  hasAll(ORDERS_DETAIL_COLUMN_CLASS, ["border-l", "border-border", "bg-card"], "landmark: the page's column carries the surface and its rule");
});

test("ORDER_DETAIL_SHEET_CLASS: the bottom sheet over the whole window at z 15, the 1px rule on its left, no shadow; the /pos cart sheet's slide up and down, no scrim drawn", () => {
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

test("ORDER_DETAIL_SCROLL_CLASS: under the head the rest scrolls (values 11.1); its foot clears the window's safe-area inset (U1 P49)", () => {
  hasAll(
    ORDER_DETAIL_SCROLL_CLASS,
    ["flex", "min-h-0", "flex-1", "flex-col", "overflow-y-auto", "overflow-x-hidden", "pb-[calc(16px+env(safe-area-inset-bottom))]"],
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

// ── The page's choice (design 6.6; ruling P9; Review Focus 2) ───────────────────────────────────────────────────────

test("settleChoice: from 1280px an empty choice takes the first row shown (auto); below 1280px or with the width unknown, nothing is taken", () => {
  const f = state({});
  const first = order("1");
  assert.deepEqual(settleChoice(noChoice(f), f, true, first), { order: first, auto: true, filters: f }, "the HTML's column shows the first row");
  for (const xl of [false, null]) {
    const empty = noChoice(f);
    assert.equal(settleChoice(empty, f, xl, first), empty, `xl=${xl}: nothing chosen until a row is tapped (same object: no store)`);
  }
  const empty = noChoice(f);
  assert.equal(settleChoice(empty, f, true, undefined), empty, "an empty list: nothing chosen ('Select an order to see its details.')");
});

test("settleChoice: the auto-pick only fills an empty choice — a refresh with a new first row never swaps the order shown", () => {
  const f = state({});
  const held = settleChoice(noChoice(f), f, true, order("1"));
  assert.equal(settleChoice(held, f, true, order("9")), held, "a new order on top: the same choice (the same object)");
  const tapped = tappedChoice(order("5"), f);
  assert.equal(settleChoice(tapped, f, true, order("1")), tapped, "a tapped order is never replaced by the first row");
});

test("settleChoice: any change of the filters (a new state object: lane, date, payment, table, chip, Clear all, the searched phone) drops the choice, then the next first row is taken", () => {
  const f = state({});
  const tapped = tappedChoice(order("5"), f);
  const g = { ...f, lane: "paid" as const };
  assert.deepEqual(settleChoice(tapped, g, true, order("7")), { order: order("7"), auto: true, filters: g }, "from 1280px: the new list's first row");
  assert.deepEqual(settleChoice(tapped, g, false, order("7")), noChoice(g), "below 1280px: none (the sheet closes)");
  assert.deepEqual(settleChoice(tapped, g, true, undefined), noChoice(g), "an empty new list: none");
});

test("settleChoice (ruling P9): below 1280px an auto-picked row gives way (no full-screen sheet pops open); a tapped one stays chosen across the line", () => {
  const f = state({});
  const auto = settleChoice(noChoice(f), f, true, order("1"));
  assert.deepEqual(settleChoice(auto, f, false, order("1")), noChoice(f), "auto-picked, the window drops below 1280px: cleared");
  const back = settleChoice(noChoice(f), f, true, order("2"));
  assert.equal(back.order?._id, "2", "back over 1280px: the first row shown then");
  const tapped = tappedChoice(order("5"), f);
  assert.equal(settleChoice(tapped, f, false, order("1")), tapped, "tapped: stays chosen below 1280px (the bottom sheet shows it)");
  assert.equal(settleChoice(tapped, f, true, order("1")), tapped, "and back over 1280px (the column shows it)");
});

test("engageChoice (Review Focus 2): a press or focus inside the detail makes an auto-picked order the operator's, so the payment it opened is never taken away below 1280px", () => {
  const f = state({});
  const auto = settleChoice(noChoice(f), f, true, order("1"));
  const engaged = engageChoice(auto);
  assert.deepEqual(engaged, { order: auto.order, auto: false, filters: f }, "the same order, now the operator's");
  assert.equal(settleChoice(engaged, f, false, order("1")), engaged, "it stays chosen below 1280px");
  const tapped = tappedChoice(order("5"), f);
  assert.equal(engageChoice(tapped), tapped, "a tapped choice: unchanged (the same object: no store)");
  const none = noChoice(f);
  assert.equal(engageChoice(none), none, "no choice: unchanged");
});

test("settleChoice is settled: a settled choice settles to itself at every width (the page stores during render only when it changes)", () => {
  const f = state({});
  for (const xl of [true, false, null]) {
    for (const start of [noChoice(f), tappedChoice(order("5"), f), settleChoice(noChoice(f), f, true, order("1")), noChoice(state({ lane: "all" }))]) {
      const once = settleChoice(start, f, xl, order("1"));
      assert.equal(settleChoice(once, f, xl, order("1")), once, `xl=${xl}: settling twice changes nothing`);
    }
  }
});

// The page's choice and its detail's frame read the same query. With a MediaQueryList per reader the browser reports
// each on its own (a microtask between them), so the detail re-rendered first and opened its bottom sheet for a moment
// on an auto-picked row the page was about to drop — whose focus then "engaged" it (found by the live check; ruling P9).
test("useMediaQuery: one shared list and one change listener per query, so every reader (the page and its detail) re-renders in one pass, parent first", () => {
  const hook = read("hooks/use-media-query.ts");
  assert.equal(hook.split("window.matchMedia(").length - 1, 1, "the list is made once per query (in sharedList)");
  assert.match(hook, /const lists = new Map<string, \{ list: MediaQueryList; readers: Set<\(\) => void> \}>\(\);/, "one list and its readers per query");
  assert.match(hook, /list\.addEventListener\("change", \(\) => \{\s*for \(const tell of \[\.\.\.readers\]\) tell\(\);\s*\}\);/, "one listener tells every reader in the same call");
  assert.match(hook, /readers\.add\(onChange\);/, "a reader joins the query's set");
  assert.match(hook, /readers\.delete\(onChange\);/, "and leaves it on unmount");
  assert.match(hook, /\(\) => sharedList\(query\)\.list\.matches,/, "the snapshot reads the shared list");
});

// ── OrderDetailSheet: one width, one frame (source pins) ────────────────────────────────────────────────────────────

/** The source of `function DetailFrame(` up to the next top-level function. */
function detailFrameSrc(src: string): string {
  const at = src.indexOf("function DetailFrame(");
  assert.ok(at >= 0, "landmark: OrderDetailSheet.tsx draws its frames in DetailFrame");
  const end = src.indexOf("\nfunction ", at + 1);
  return src.slice(at, end < 0 ? undefined : end);
}

test("OrderDetailSheet: one useMediaQuery(ORDERS_XL_QUERY) picks the frame through orderDetailFrame; the place defaults to the dashboard's overlay", () => {
  const src = read(SHEET);
  assert.equal(src.split("useMediaQuery(").length - 1, 1, "one width read in the sheet");
  assert.match(src, /orderDetailFrame\(place, useMediaQuery\(ORDERS_XL_QUERY\)\)/, "the frame follows the width (one frame per width)");
  assert.match(src, /place = "overlay"/, "the dashboard passes nothing new: the overlay frames");
  assert.match(src, /place\?: OrderDetailPlace;/, "the place prop");
  assert.match(src, /onCancel\?: \(order: Order\) => void;/, "the cancel prop (Task 7 draws the danger link)");
});

test("DetailFrame: no frame while the width is unknown; the column is a plain div with no SheetContent; both sheets keep ref={sheetRef} and the nested-dialog rule (ruling P38)", () => {
  const frame = detailFrameSrc(read(SHEET));
  assert.match(frame, /if \(frame === null\) return null;/, "the width not known yet: no frame");
  const column = frame.slice(frame.indexOf('if (frame === "column")'), frame.indexOf("<Sheet open"));
  assert.ok(column.length > 0, "landmark: the column branch comes before the sheets");
  assert.match(column, /<div data-ui="order-detail" className=\{ORDER_DETAIL_COLUMN_CLASS\}>/, "the column frame");
  assert.ok(!/SheetContent|DialogPrimitive|<Sheet\b|onClose/.test(column), "the column branch mounts no dialog");
  assert.match(
    column,
    /\{open \? \(\s*children\s*\) : \(\s*<p data-ui="order-detail-none" className="m-auto p-6 text-center text-\[14px\] text-muted-foreground">\s*Select an order to see its details\.\s*<\/p>/,
    "nothing chosen: the HTML's words, centred, 14px --text-2, padding 24 (values 13) — no buttons without an order",
  );
  const NESTED = String.raw`onInteractOutside=\{\(e\) => keepOpenForNestedDialog\(e, sheetRef\.current\)\}`;
  assert.match(frame, new RegExp(String.raw`<SheetContent\s+ref=\{sheetRef\}[^>]*className=\{ORDER_DETAIL_SIDE_CLASS\}[^>]*` + NESTED), "the side sheet");
  assert.match(frame, new RegExp(String.raw`<DialogPrimitive\.Content\s+ref=\{sheetRef\}[^>]*className=\{ORDER_DETAIL_SHEET_CLASS\}[^>]*` + NESTED), "the bottom sheet");
  assert.match(frame, /<DialogPrimitive\.Overlay className=\{ORDER_DETAIL_SHEET_SCRIM_CLASS\} \/>/, "the bottom sheet's overlay is mounted and never drawn (the scroll lock stays)");
  assert.match(frame, /frame === "side" \?/, "one sheet branch per frame");
  assert.equal(frame.split("ref={sheetRef}").length - 1, 2, "exactly the two sheet panels hold the ref");
});

test("OrderDetailSheet: the frame wraps the head, the body and the off-screen print sources; the payment and move dialogs stay beside it (mounted once at every width)", () => {
  const src = read(SHEET);
  const ret = src.slice(src.indexOf("  return (\n    <>\n      <DetailFrame"));
  assert.ok(ret.length > 0, "landmark: the sheet's return opens with the frame");
  const frameEnd = ret.indexOf("</DetailFrame>");
  const inside = ret.slice(0, frameEnd);
  assert.match(inside, /<OrderDetailHead\b/, "the head inside the frame");
  assert.ok(inside.includes('className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden'), "the print sources inside the frame");
  assert.match(inside, /onClose=\{frame === "column" \? undefined : \(\) => onOpenChange\(false\)\}/, "the ✕ in the sheets only (no ✕ in the column)");
  assert.match(inside, /<div data-ui="order-detail-scroll" className=\{ORDER_DETAIL_SCROLL_CLASS\}>/, "under the head the rest scrolls (values 11.1)");
  const after = ret.slice(frameEnd);
  assert.match(after, /<PaymentModal\b/, "the payment sheet beside the frame");
  assert.match(after, /<MoveTableDialog\b/, "the move sheet beside the frame");
  assert.equal(src.split("<PaymentModal").length - 1, 1, "one payment sheet");
  assert.equal(src.split("<OrderReceipt ").length - 1, 1, "one set of print sources");
});

// ── The pages (design 6.6, 6.11) ───────────────────────────────────────────────────────────────────────────────────

test("the /orders page: the detail mounts in the 400px column slot as place=\"page\" with the page's tick; the slot keeps a press or focus inside as the operator's", () => {
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
  assert.match(sheet, /\border=\{liveOrderOf\(detail, list\)\}/, "the live row (P10)");
  assert.match(sheet, /\bonSettled=\{setDetail\}/, "a settle or a move keeps the fresher order chosen");
  assert.equal(src.split("<OrderDetailSheet").length - 1, 1, "one detail on the page");
});

test("the /orders page: the choice settles during render through settleChoice (the auto-pick fills only an empty choice), the window read once", () => {
  const src = read(PAGE);
  assert.match(src, /const xl = useMediaQuery\(ORDERS_XL_QUERY\);/, "the 1280px line");
  assert.match(src, /const \[held, setHeld\] = useState<OrdersChoice>\(\(\) => noChoice\(filters\)\);/, "the stored choice");
  assert.match(src, /const choice = settleChoice\(held, filters, xl, shown\[0\]\);/, "settled for the filters, the width and the first row shown");
  assert.match(src, /if \(choice !== held\) setHeld\(choice\);/, "stored only when it changes (no loop; no frame ever shows a stale choice)");
  assert.match(src, /const detail = choice\.order;/, "the detail is the settled choice");
  assert.match(src, /const setDetail = \(order: Order \| null\) => setHeld\(tappedChoice\(order, filters\)\);/, "a tap (or a settle) chooses");
  assert.match(src, /const engage = \(\) => setHeld\(engageChoice\);/, "engaging keeps it");
  assert.ok(!/\[detail, setDetail\] = useState/.test(src), "no second detail state");
});

test("the dashboard passes nothing new: its detail is the default overlay (a side sheet from 1280px, the bottom sheet below)", () => {
  const dash = read(DASHBOARD);
  const at = dash.indexOf("<OrderDetailSheet");
  const el = dash.slice(at, dash.indexOf("/>", at) + 2);
  assert.ok(at >= 0, "landmark: the dashboard's detail");
  for (const prop of ["place=", "onCancel=", "now="]) assert.ok(!el.includes(prop), `the dashboard passes no ${prop}`);
});
