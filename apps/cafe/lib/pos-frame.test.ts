// U1 Task 1 (2026-10-21): the /pos page frame and the shell header's /pos variant, the owner's HTML Order screen
// (docs/superpowers/specs/2026-10-20-pos-html-values.md: values 1.1-1.4 header, 2.0 body grid, 6.2 main's bottom
// padding; design 5 and 6.1). Pure pins on lib/pos-layout.ts and lib/pos-clock.ts, then source pins on the markup
// (no React test framework here: lib/table-flow-paths.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { clockPrinterWords, posClockLabel } from "./pos-clock";
import { PRINTER_BUTTON_NAME_BAD, PRINTER_BUTTON_NAME_OK } from "./printer/printer-dot";
import { MAIN_PADDING_BLEED_CLASS } from "./shell-layout";
import * as layout from "./pos-layout";
import {
  DASHBOARD_HEADER_REM,
  POS_ALERT_HEIGHT_VAR,
  POS_ASIDE_CLASS,
  POS_BODY_COLUMNS_PX,
  POS_BODY_GRID_CLASS,
  POS_CART_CLASS,
  POS_HEADER_GAP_PX,
  POS_MAIN_CLASS,
  POS_MAIN_PAD_B_PX,
  POS_PAGE_CLASS,
  POS_SWITCH_MIN_PX,
  isPosPath,
  posBodyColumnsPx,
  posHeaderRoom,
  posMainPadBottomPx,
  posSwitchMinPx,
} from "./pos-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

const HEADER = "components/layout/Header.tsx";
const BRAND = "components/layout/PosHeaderBrand.tsx";
const QUICK_TABS = "components/layout/HeaderQuickTabs.tsx";
const PRINTER_BUTTON = "components/print/PrinterStatusButton.tsx";
const PAGE = "app/(dashboard)/pos/page.tsx";

/** Each needle must appear, in this order. */
function inOrder(src: string, needles: string[], what: string): void {
  let last = -1;
  for (const needle of needles) {
    const at = src.indexOf(needle, last + 1);
    assert.ok(at > last, `${what}: "${needle}" must come after the previous landmark`);
    last = at;
  }
}

// ── The clock words (values 0.1) ─────────────────────────────────────────────────────────────────────────────────

test("posClockLabel: the HTML's header clock, \"Mon, 19 Oct 9:30 PM\", in the cafe's time", () => {
  assert.equal(posClockLabel(new Date("2026-10-19T21:30:00+05:30")), "Mon, 19 Oct 9:30 PM", "the mock-up's clock (values 0.1)");
  assert.equal(posClockLabel(new Date("2026-10-20T00:00:00+05:30")), "Tue, 20 Oct 12:00 AM", "midnight is 12 AM of the new day");
  assert.equal(posClockLabel(new Date("2026-10-20T12:00:00+05:30")), "Tue, 20 Oct 12:00 PM", "noon is 12 PM");
  assert.equal(posClockLabel(new Date("2026-10-20T09:05:00+05:30")), "Tue, 20 Oct 9:05 AM", "minutes keep two digits, hours none");
  assert.equal(posClockLabel(new Date("2026-10-19T18:30:00Z")), "Tue, 20 Oct 12:00 AM", "an instant reads in the cafe's zone (IST), not the machine's");
});

// ── The route ────────────────────────────────────────────────────────────────────────────────────────────────────

test("isPosPath: /pos and the pages below it, never a path that only starts with the letters", () => {
  assert.equal(isPosPath("/pos"), true, "/pos is the POS");
  assert.equal(isPosPath("/pos/x"), true, "a page below /pos is the POS");
  assert.equal(isPosPath("/posx"), false, "/posx is another page");
  assert.equal(isPosPath("/"), false, "the dashboard is not the POS");
  assert.equal(isPosPath("/orders"), false, "Orders is not the POS");
});

// ── The body grid (values 2.0) ───────────────────────────────────────────────────────────────────────────────────

test("the body grid literal holds the HTML's four column sets (values 2.0 bodyCols), one per width", () => {
  const { wide, desk, tablet } = POS_BODY_COLUMNS_PX;
  assert.deepEqual([wide.aside, wide.cart, desk.aside, desk.cart, tablet.cart], [200, 360, 220, 380, 340], "the HTML's column widths");
  const cls = tokens(POS_BODY_GRID_CLASS);
  for (const needle of [
    "grid",
    "min-h-0",
    "grid-cols-[minmax(0,1fr)]",
    `lg:grid-cols-[minmax(0,1fr)_${tablet.cart}px]`,
    `desk:grid-cols-[${desk.aside}px_minmax(0,1fr)_${desk.cart}px]`,
    `wide:grid-cols-[${wide.aside}px_minmax(0,1fr)_${wide.cart}px]`,
  ]) {
    assert.ok(cls.includes(needle), `POS_BODY_GRID_CLASS must carry "${needle}"`);
  }
  assert.equal(cls.filter((t) => t.includes("grid-cols-")).length, 4, "exactly the four column sets, no stray tier");
});

test("posBodyColumnsPx gives the HTML's measured grid-template-columns at the five viewports (values 2.0)", () => {
  const cases: Array<[string, number, boolean, number[]]> = [
    ["d1280", 1280, false, [200, 488, 360]],
    ["c1280", 1280, true, [220, 604, 380]],
    ["t1024", 1024, false, [608, 340]],
    ["t820", 820, false, [744]],
    ["p390", 390, false, [390]],
    ["1100 (desk, the rail)", 1100, false, [220, 424, 380]],
    ["1099 (still the tablet's two columns)", 1099, false, [683, 340]],
  ];
  for (const [label, viewportWidth, collapsed, expected] of cases) {
    assert.deepEqual(posBodyColumnsPx({ viewportWidth, collapsed }), expected, `${label}: the body grid's columns`);
  }
});

// ── The page and its regions (values 1.1, 6.2, 15.1) ─────────────────────────────────────────────────────────────

test("the page fills the screen under the 56px header: a vh base with a dvh override, bleeding <main>'s padding", () => {
  const cls = tokens(POS_PAGE_CLASS);
  for (const bleed of tokens(MAIN_PADDING_BLEED_CLASS)) assert.ok(cls.includes(bleed), `POS_PAGE_CLASS bleeds <main>'s padding: "${bleed}"`);
  const alert = "var(" + POS_ALERT_HEIGHT_VAR + ",0px)";
  assert.ok(cls.includes(`h-[calc(100vh-${DASHBOARD_HEADER_REM}rem-${alert})]`), "the vh base: the window minus the 56px header");
  assert.ok(cls.includes(`supports-[height:1dvh]:h-[calc(100dvh-${DASHBOARD_HEADER_REM}rem-${alert})]`), "the dvh override where it exists");
  assert.equal(DASHBOARD_HEADER_REM * 16, 56, "the header is the HTML's 56px (values 1.2)");
  assert.ok(cls.includes("relative"), "the page is the box the phone and tablet cart bar sits in");
  assert.ok(!cls.some((t) => t.startsWith("min-h-")), "no floor: the regions scroll on their own, the page never grows past the screen");
  assert.ok(!cls.some((t) => t.endsWith("overflow-hidden")), "nothing is clipped at the page's edge");
});

test("main keeps the HTML's mainPadB at its foot: 150px on a phone, 100px below 1024px, 16px from 1024px (values 6.2)", () => {
  assert.deepEqual(POS_MAIN_PAD_B_PX, { phone: 150, cmp: 100, base: 16 }, "the HTML's three values");
  const cases: Array<[number, number]> = [[390, 150], [719, 150], [720, 100], [820, 100], [1023, 100], [1024, 16], [1280, 16]];
  for (const [w, px] of cases) assert.equal(posMainPadBottomPx(w), px, `${w}px: main's bottom padding`);
  const cls = tokens(POS_MAIN_CLASS);
  assert.ok(cls.includes(`pb-${POS_MAIN_PAD_B_PX.base / 4}`), "16px from 1024px");
  assert.ok(cls.includes(`max-lg:pb-[${POS_MAIN_PAD_B_PX.cmp}px]`), "100px below 1024px");
  assert.ok(cls.includes(`max-tab:pb-[${POS_MAIN_PAD_B_PX.phone}px]`), "150px on a phone");
  for (const t of ["overflow-auto", "min-w-0", "min-h-0"]) assert.ok(cls.includes(t), `main is the HTML's scroller column: "${t}"`);
});

test("the regions: the category column from 1100px, the cart column from 1024px, each the HTML's surface with its rule", () => {
  const aside = tokens(POS_ASIDE_CLASS);
  for (const t of ["hidden", "desk:flex", "flex-col", "min-h-0", "bg-card", "border-r", "border-border"]) {
    assert.ok(aside.includes(t), `the aside (values 2.1): "${t}"`);
  }
  const cart = tokens(POS_CART_CLASS);
  for (const t of ["hidden", "lg:flex", "flex-col", "min-h-0", "relative", "z-[15]", "overflow-y-auto", "overflow-x-hidden", "overscroll-contain", "bg-card", "border-l", "border-border"]) {
    assert.ok(cart.includes(t), `the cart column (values 5.1): "${t}"`);
  }
});

test("the old two-pane and stacked-phone frame is gone, not left dead (design 5)", () => {
  for (const name of [
    "POS_ROOT_CLASS",
    "POS_INSET_CLASS",
    "POS_SPLIT_CLASS",
    "POS_DESKTOP_CART_CLASS",
    "POS_TWO_PANE_MIN_PX",
    "POS_MOBILE_STACK_REM",
    "POS_ROOT_FLOOR_REM_BASE",
    "POS_ROOT_CHROME_REM_XL",
    // U1 Task 2 (values 3.1, design 6.3): the interim pane, its floor, the chip strip and the rail's gate.
    "POS_PANE_CLASS",
    "POS_PANE_FLOOR_PX",
    "POS_CHIP_CLASS",
    "POS_CHIP_ROW_CLASS",
    "POS_DESKTOP_ONLY_CLASS",
    // U1 Task 3 (values 4.1, 4.3; owner Q5/Q6): the HTML's auto-fill card grid replaced the viewport tiers, and the HTML
    // card replaced the tile with its thumbnail row and corner options button.
    "POS_GRID_CLASS_SIDEBAR_EXPANDED",
    "POS_GRID_CLASS_SIDEBAR_COLLAPSED",
    "POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED",
    "POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED",
    "posGridColumns",
    "POS_GRID_GAP_REM",
    "POS_MIN_TILE_PX",
    "POS_MIN_NAME_BOX_PX",
    "POS_TILE_CARD_PADDING_PX",
    "POS_TILE_THUMB_PX",
    "POS_TILE_ROW_GAP_PX",
    "POS_TILE_OPTIONS_BUTTON_CLASS",
    "POS_TILE_OPTIONS_RESERVE_CLASS",
    // U1 Task 4 (values 5.2, 5.4; owner Q9): the Table and Customer chips left the header row for the cart head's
    // cells, and the HTML's line stepper (its own sizes, ruling R1) replaced the cart's touch-target stepper.
    "POS_HEADER_CHIP_FIXED_CLASS",
    "POS_HEADER_CHIP_FLEX_CLASS",
    "POS_CART_STEPPER_CLASS",
  ]) {
    assert.ok(!(name in layout), `lib/pos-layout.ts must no longer export ${name}`);
  }
});

// U1 Task 6: PosHeader draws nothing in the page's flow (the switch button and its panel portal into the shell's header,
// the Floor hand-off renders nothing), so it sits first in the page, outside the body grid; the interim control row
// above the toolbar (Task 2's ruling P5) is gone and the toolbar is main's first child again.
test("pos/page.tsx renders the HTML's body grid: the aside, the menu column and the cart, in that order", () => {
  const src = read(PAGE);
  assert.ok(!src.includes("pos-controls") && !src.includes("POS_CONTROLS_CLASS"), "no control row in the menu column");
  inOrder(
    src,
    [
      "className={POS_PAGE_CLASS}",
      "<PosHeader",
      '<div data-ui="pos-body" className={POS_BODY_GRID_CLASS}>',
      '<aside data-ui="pos-aside" className={POS_ASIDE_CLASS}>',
      "<CategorySidebar",
      "</aside>",
      '<div data-ui="pos-main" className={POS_MAIN_CLASS}>',
      "<ProductGrid",
      '<section data-ui="pos-cart" className={POS_CART_CLASS}>',
      "<Cart {...cartProps}",
      "</section>",
      "<MobileCartBar",
    ],
    "pos/page.tsx",
  );
  assert.ok(!/<main\b/.test(src), "the menu column is a div: the shell's <main> already holds the page");
});

// ── The header's /pos variant (values 1.2-1.4, design 6.1) ───────────────────────────────────────────────────────

test("Header: on /pos the HTML's Order header (brand, the actions box, the clock block, then ours); elsewhere the title header", () => {
  const src = read(HEADER);
  assert.match(src, /import \{ isPosPath \} from "@\/lib\/pos-layout";/, "the header reads the route through isPosPath");
  assert.match(src, /const pos = isPosPath\(pathname\);/, "one flag for the variant");
  assert.match(src, /\{pos \? \(\s*<PosHeaderBrand\b[\s\S]*?\) : \(\s*<BrandTile\b/, "the brand block on /pos, the phone's mini logo elsewhere");
  assert.match(src, /\{pos \? \(\s*<h1 data-ui="header-title" className="sr-only">\{title\}<\/h1>\s*\) : \(\s*<HeaderTitle\b/, "no title block on /pos: its h1 stays for screen readers");
  assert.match(src, /\{pos && <PosHeaderClock\b/, "the clock block only on /pos");
  inOrder(src, ["ref={actionsRef}", "<HeaderQuickTabs />", "<PosHeaderClock", "<RefreshButton />", "<TokenSheet />", "<PrinterStatusButton"], "Header");
  // U1 Task 6 (Task 1's review): only /pos hands the printer's tone over, so every other page's header is as before.
  assert.match(src, /<PrinterStatusButton onToneChange=\{pos \? setPrinterTone : undefined\} \/>/, "the clock's dot takes the printer button's own tone, on /pos only");
  assert.match(src, /const room = usePosHeaderRoom\(pos, actionsBox\);/, "the room rule measures the slot's own actions box (ruling R6's pattern)");
});

// The bar keeps one literal (every page's U0 header, pinned in lib/shell-look-paths.test.ts); on /pos the header and
// its actions box carry data-pos, and the data-pos: tokens give them the HTML's Order header.
test("Header: the /pos bar is 56px tall with 16px gaps, not sticky; its actions box takes the free width, right-aligned", () => {
  const src = read(HEADER);
  assert.match(src, /<header className="[^"]*" data-ui="header" data-pos=\{pos \? "" : undefined\} data-room-out=\{room\.level > 0 \? "" : undefined\}>/, "the header carries data-pos on /pos, and data-room-out while the room rule has a part out");
  const bar = tokens(src.match(/<header className="([^"]*)"/)?.[1] ?? "");
  for (const t of ["data-pos:h-14", "data-pos:min-w-0", "data-pos:gap-4", "data-pos:static", "data-pos:z-auto", "border-b", "border-border", "bg-card", "px-3", "tab:px-5"]) {
    assert.ok(bar.includes(t), `the /pos header (values 1.2): "${t}"`);
  }
  // U1 Task 6 (Task 1's review): a part the room rule takes out is held at the header's right edge, so the header is
  // its positioned ancestor while one is out (static, as the HTML's, otherwise).
  assert.ok(bar.includes("data-room-out:relative"), "the header positions the parts the room rule takes out");
  const box = /<div ref=\{actionsRef\}([^>]*)\/>/.exec(src)?.[1] ?? "";
  assert.match(box, /data-pos=\{pos \? "" : undefined\}/, "the actions box carries data-pos on /pos");
  // U1 Task 6 (Task 1's review): the switch-order button is the HTML's 42px, not U0's 36px header button, so the box
  // drops the header-button look on /pos (every other page keeps it).
  assert.match(box, /data-header-actions=\{pos \? undefined : ""\}/, "no header-button look on /pos");
  const boxTokens = tokens(/className="([^"]*)"/.exec(box)?.[1] ?? "");
  for (const t of ["min-w-0", "items-center", "data-pos:flex-1", "data-pos:justify-end", "data-pos:gap-1.5", "data-pos:overflow-x-auto", "data-pos:empty:flex"]) {
    assert.ok(boxTokens.includes(t), `the /pos actions box (values 1.2): "${t}"`);
  }
  assert.equal(POS_HEADER_GAP_PX, 16, "the HTML's header gap");
});

test("HeaderQuickTabs: Tables and New order are not drawn on /pos (design 6.1)", () => {
  const src = read(QUICK_TABS);
  assert.match(src, /import \{ isPosPath \} from "@\/lib\/pos-layout";/, "the quick links read the route through isPosPath");
  assert.match(src, /if \(isPosPath\(pathname\)\) return null;/, "nothing on /pos");
  assert.ok(src.indexOf("if (isPosPath(pathname)) return null;") < src.indexOf("HEADER_QUICK_TABS.map("), "before any link renders");
});

test("PosHeaderBrand: the cafe's name in Shrikhand over the nav's \"{product} · {device}\" line, from 720px and not in the wide nav", () => {
  const src = read(BRAND);
  assert.match(src, /data-ui="pos-header-brand" className="flex min-w-max items-center gap-2\.5"/, "the HTML's brand wrapper");
  assert.match(src, /<BrandTile\b[^>]*size="mini"[^>]*className="tab:hidden"/, "the phone's mini logo");
  assert.ok(src.includes('"hidden flex-col tab:flex wide:hidden"'), "the brand text: 720px and up, not beside the wide nav (values 0.3 brandText)");
  assert.ok(src.includes('className="font-brand-script text-[20px] font-normal leading-[1.1] text-brand-red"'), "line 1: Shrikhand 20/1.1 in --brand");
  assert.match(src, /<NavDeviceLine lead=\{VENDOR_PRODUCT_NAME\}[^>]*className="text-\[12px\] leading-\[1\.3\] text-muted-foreground"/, "line 2: the nav's words, 12/1.3 --text-2");
});

test("PosHeaderClock: \"● Printer\" and the time, from 720px; its dot is the printer button's tone, read from no source of its own", () => {
  const src = read(BRAND);
  assert.ok(src.includes('"hidden h-7 min-w-max items-center gap-3.5 border-l border-border pl-4 tab:flex"'), "the clock block (values 1.2)");
  assert.ok(src.includes('className="flex items-center gap-1.5 text-[12px] text-muted-foreground"'), "the printer indicator: 12px --text-2, a 6px gap");
  // U1 final fix wave (the final review's minor 3): the dot's state is also said in words, for screen readers only.
  assert.match(src, /Printer\s*\{printerWords && <span className="sr-only"> \{printerWords\}<\/span>\}/, "\"Printer\" then, unseen, its state");
  assert.ok(src.includes("const printerWords = clockPrinterWords(tone);"), "the words come from lib/pos-clock.ts (unit-tested)");
  assert.match(src, /cn\("size-1\.5 rounded-\[50%\]", CLOCK_DOT_CLASS\[tone\]\)/, "a 6px round dot (the HTML's 50% radius) in the tone's colour");
  assert.match(src, /green: PRINTER_DOT_OK_CLASS,\s*red: PRINTER_DOT_WARN_CLASS,\s*none: "bg-transparent",/, "green ok, orange off, nothing while the button shows no dot");
  assert.match(src, /className="text-\[13px\] font-medium">\{posClockLabel\(now\)\}</, "the time: 13/500, the header's own minute clock");
  for (const banned of ["usePrintHostDot", "usePrintHostContext", "useDevicePrinter", "usePrintLane", "useDeviceOnline", "useDesktopPrinterChosen", "useDotPrinters", "usePosPulseContext", "useQuery", "apiGet", "fetch(", "setInterval", "useNow("]) {
    assert.ok(!src.includes(banned), `no request, poll or second printer read in the brand/clock file: "${banned}"`);
  }
  const button = read(PRINTER_BUTTON);
  // U1 final fix wave (the Task 6 review's FIX BEFORE MERGE): handed over before the first paint, so the clock's dot is
  // never one frame stale entering /pos.
  assert.match(button, /useLayoutEffect\(\(\) => onToneChange\?\.\(tone\), \[onToneChange, tone\]\);/, "the printer button hands its own tone over before paint");
});

// ── The room rule (design 6.1, ruling R6's measuring pattern) ───────────────────────────────────────────────────

test("posHeaderRoom: the brand text hides first, then the clock block, only while the actions box would be under the switch button's minimum", () => {
  const brandWidth = 138.47;
  const clockWidth = 207.84;
  const at = (room: 0 | 1 | 2, actionsWidth: number, brand = brandWidth, clock = clockWidth) =>
    posHeaderRoom({ room, actionsWidth, brandWidth: brand, clockWidth: clock });
  assert.ok(POS_SWITCH_MIN_PX > 0, "landmark: a minimum exists");
  assert.equal(at(0, 273.69), 0, "the HTML's 820px header: everything fits");
  assert.equal(at(0, POS_SWITCH_MIN_PX), 0, "exactly the minimum still fits");
  assert.equal(at(0, POS_SWITCH_MIN_PX - 1), 1, "1px short: the brand text goes first");
  assert.equal(at(1, POS_SWITCH_MIN_PX - 1 + brandWidth), 1, "measured again without it: it stays hidden (no flapping)");
  assert.equal(at(1, POS_SWITCH_MIN_PX + brandWidth), 0, "room for it again: it comes back");
  assert.equal(at(0, 0), 2, "a full row: the clock block goes too");
  assert.equal(at(2, brandWidth + clockWidth + POS_HEADER_GAP_PX), 2, "measured again without both: still not room for the clock");
  assert.equal(at(2, POS_SWITCH_MIN_PX + clockWidth + POS_HEADER_GAP_PX), 1, "room for the clock again: it comes back, the brand text stays out");
  assert.equal(at(0, 100, 0), 2, "a brand text the width already hides frees nothing: the clock block goes");
  assert.equal(at(0, 0, 0, 0), 2, "a phone (nothing to hide): the level changes nothing on screen");
});

// U1 Task 6 (Task 1's review): the minimum is the real button's, measured from its parts: the tile, the pill and the
// chevron (the text column is the only part that shrinks), the three gaps, the paddings and border — so a two-digit
// "12 open" pill asks for its own few pixels more, and a button the box squeezes still reads its true minimum.
test("posSwitchMinPx / posHeaderRoom: the switch button's measured minimum (count-aware), the fixed one only before it is measured", () => {
  const edges = 6 + 10 + 1 + 1;
  assert.equal(posSwitchMinPx({ fixedParts: [30, 53.34, 16], gap: 10, edges }), 148, "the HTML's button with \"8 open\": 147.34, rounded up");
  assert.equal(posSwitchMinPx({ fixedParts: [30, 60.5, 16], gap: 10, edges }), 155, "a wider pill (\"12 open\"): a wider minimum");
  const room = (actionsWidth: number, switchMin?: number) =>
    posHeaderRoom({ room: 0, actionsWidth, brandWidth: 138.47, clockWidth: 207.84, switchMin });
  assert.equal(room(150), 0, "unmeasured: the fixed minimum (148) fits in 150");
  assert.equal(room(150, 155), 1, "measured 155: the brand text goes first");
  assert.equal(room(155, 155), 0, "exactly the measured minimum fits");
  assert.equal(POS_SWITCH_MIN_PX, 148, "the fallback is the HTML's one-digit button");
  const src = read(BRAND);
  assert.ok(src.includes("return posSwitchMinPx({ fixedParts, gap: px(style.columnGap), edges });"), "the hook measures the real button's parts");
  assert.ok(src.includes(`.filter((child) => child.getAttribute("data-ui") !== "pos-switch-text")`), "every part but the text column");
  assert.ok(src.includes(`querySelector<HTMLElement>("[data-ui='pos-switch']")`), "the switch button in the slot's own actions box");
  assert.ok(src.includes("new MutationObserver("), "it arrives by a portal and its pill's words change: the box's contents are watched");
});

// U1 final fix wave (the final review's minor 3): the clock block's "● Printer" carried its state by colour alone; the
// state is said too (screen readers only), in the printer button's own words ("Printer connected — …").
test("clockPrinterWords: the printer button's words for the dot's tone; none while it draws no dot", () => {
  assert.equal(clockPrinterWords("green"), "connected", "green: connected");
  assert.equal(clockPrinterWords("red"), "not connected", "red: not connected");
  assert.equal(clockPrinterWords("none"), null, "no dot (checking, or nothing set up): nothing said");
  assert.ok(PRINTER_BUTTON_NAME_OK.startsWith(`Printer ${clockPrinterWords("green")} —`), "the button's title says the same for green");
  assert.ok(PRINTER_BUTTON_NAME_BAD.startsWith(`Printer ${clockPrinterWords("red")} —`), "the button's title says the same for red");
});
