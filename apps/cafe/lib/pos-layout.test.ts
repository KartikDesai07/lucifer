// POS "New Order" layout ARITHMETIC pins (CB-1 S3; CB-1c round 2, 2026-08-30:
// a DEFINITE vh/dvh root — vh base, dvh override — that subtracts the
// RequestAlertBar's own published height via POS_ALERT_HEIGHT_VAR, plus a
// below-xl min-height floor so a short landscape phone still shows one tile
// row instead of an empty grid).
//
// lib/pos-layout.ts (S0/contract) is the single source of the class
// strings/numbers the S1/S2 slices consume. This file pins the ARITHMETIC —
// the breakpoint matrix holds, computed from the constants (never re-typed
// numbers), plus that the class strings encode those same numbers.
// Source-read pins live in lib/pos-layout-paths.test.ts + lib/pos-header-paths.test.ts.
//
// Column-count tiering (viewport breakpoints keyed by sidebar state, not a
// container query) is UNCHANGED by round 2, and is not there because the
// staff tablet's browser lacks dvh or container-query support — CB-1c
// corrected that CB-1b inference (the live stylesheet's un-fallbacked
// oklch() colours are what a pre-Chromium-111 engine would actually choke
// on, and the owner confirmed correct colours). The tiers stay viewport-
// keyed because they are plain data these pins can verify directly, simpler
// than a container query for that purpose — not a fallback for missing
// support.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BREAKPOINT_SM_PX,
  BREAKPOINT_MD_PX,
  BREAKPOINT_LG_PX,
  BREAKPOINT_XL_PX,
  BREAKPOINT_2XL_PX,
  POS_TWO_PANE_MIN_PX,
  SIDEBAR_WIDTH_REM,
  SIDEBAR_WIDTH_ICON_REM,
  DASHBOARD_HEADER_REM,
  MAIN_PADDING_Y_REM_BASE,
  MAIN_PADDING_Y_REM_MD,
  MAIN_PADDING_X_REM_BASE,
  MAIN_PADDING_X_REM_MD,
  POS_CART_COLUMN_REM,
  POS_RAIL_REM,
  POS_PANE_GAP_REM,
  POS_ROOT_CHROME_REM_BASE,
  POS_ROOT_CHROME_REM_MD,
  POS_ROOT_CHROME_REM_XL,
  POS_ROOT_FLOOR_REM_BASE,
  POS_ROOT_FLOOR_REM_XL,
  POS_ROOT_GAP_COUNT,
  POS_ROOT_GAP_REM,
  POS_MOBILE_STACK_REM,
  POS_TILE_MIN_REM,
  POS_ALERT_HEIGHT_VAR,
  POS_ROOT_CLASS,
  POS_INSET_CLASS,
  POS_SPLIT_CLASS,
  POS_DESKTOP_CART_CLASS,
  POS_MOBILE_ONLY_CLASS,
  POS_DESKTOP_ONLY_CLASS,
  POS_MOBILE_BAR_CLASS,
  POS_CART_SHEET_CLASS,
  POS_CART_SHEET_PANEL_CLASS,
  POS_CART_LIST_CLASS,
  POS_CHIP_ROW_CLASS,
  POS_CHIP_CLASS,
  POS_GRID_CLASS_SIDEBAR_EXPANDED,
  POS_GRID_CLASS_SIDEBAR_COLLAPSED,
  POS_GRID_GAP_REM,
  POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED,
  POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED,
  POS_MIN_TILE_PX,
  POS_HEADER_ROW_REM,
  POS_CHIP_STRIP_REM,
  POS_SEARCH_ROW_REM,
  POS_MOBILE_BAR_REM,
  POS_TILE_CARD_PADDING_PX,
  POS_TILE_THUMB_PX,
  POS_TILE_ROW_GAP_PX,
  POS_MIN_NAME_BOX_PX,
  POS_TILE_OPTIONS_RESERVE_CLASS,
} from "@/lib/pos-layout";

const REM_PX = 16;

type SidebarState = "expanded" | "collapsed";
const SIDEBAR_STATES: ReadonlyArray<SidebarState> = ["expanded", "collapsed"];
const GRID_TIERS: Record<SidebarState, ReadonlyArray<{ minPx: number; cols: number }>> = {
  expanded: POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED,
  collapsed: POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED,
};

// ── pure helpers mirroring lib/pos-layout.ts's own formula ──────────────────

// Pane width is unchanged by CB-1b/CB-1c (still viewport minus sidebar minus
// main padding minus the two-pane cart+rail gap) — only COLUMN COUNT stopped
// reading it (that's now a plain viewport breakpoint, see colsFor below).
function paneWidthPx(viewportPx: number, sidebarState: SidebarState = "expanded"): number {
  const sidebarRem =
    viewportPx >= BREAKPOINT_MD_PX ? (sidebarState === "expanded" ? SIDEBAR_WIDTH_REM : SIDEBAR_WIDTH_ICON_REM) : 0;
  const paddingXRem = viewportPx >= BREAKPOINT_MD_PX ? MAIN_PADDING_X_REM_MD : MAIN_PADDING_X_REM_BASE;
  let pane = viewportPx - sidebarRem * REM_PX - 2 * paddingXRem * REM_PX;
  if (viewportPx >= POS_TWO_PANE_MIN_PX) {
    pane -= (POS_PANE_GAP_REM + POS_CART_COLUMN_REM + POS_RAIL_REM + POS_PANE_GAP_REM) * REM_PX;
  }
  return pane;
}

// Column count is a VIEWPORT breakpoint keyed by sidebar state (CB-1b, kept
// in CB-1c) — no container query, no pane width input.
function colsFor(viewportPx: number, sidebarState: SidebarState): number {
  const tiers = GRID_TIERS[sidebarState];
  let cols = tiers[0].cols;
  for (const tier of tiers) {
    if (tier.minPx <= viewportPx) cols = tier.cols;
  }
  return cols;
}

function tilePx(panePx: number, cols: number): number {
  return (panePx - (cols - 1) * POS_GRID_GAP_REM * REM_PX) / cols;
}

// ── A. breakpoint matrix ─────────────────────────────────────────────────────

const VIEWPORTS = [360, 412, 740, 768, 820, 1024, 1280, 1366, 1536, 1920];

// g1: the bare (base, un-prefixed) pr-N reserve, parsed from the real class
// string — never re-typed — anchored to the BASE utility (not the
// xl:pointer-fine:pr-7 variant) via the (?:^|\s)...(?:\s|$) fence.
const reserveMatch = POS_TILE_OPTIONS_RESERVE_CLASS.match(/(?:^|\s)pr-(\d+)(?:\s|$)/);
assert.ok(reserveMatch, `expected a bare pr-N token in POS_TILE_OPTIONS_RESERVE_CLASS ("${POS_TILE_OPTIONS_RESERVE_CLASS}")`);
const RESERVE_PX = Number(reserveMatch![1]) * 4;

test("PIN: every POS breakpoint keeps the grid tile at or above POS_MIN_TILE_PX, sidebar expanded OR collapsed — and the product-name box left over after card padding/thumb/row-gap/reserve never drops below POS_MIN_NAME_BOX_PX (CB-1d.1 g1)", () => {
  for (const vw of VIEWPORTS) {
    for (const sidebarState of SIDEBAR_STATES) {
      const pane = paneWidthPx(vw, sidebarState);
      const cols = colsFor(vw, sidebarState);
      const tile = tilePx(pane, cols);
      assert.ok(
        tile >= POS_MIN_TILE_PX,
        `viewport ${vw}px (sidebar ${sidebarState}): pane ${pane}px -> ${cols} cols -> tile ${tile.toFixed(1)}px ` +
          `is below POS_MIN_TILE_PX (${POS_MIN_TILE_PX}px)`,
      );

      const nameBox = tile - 2 * POS_TILE_CARD_PADDING_PX - POS_TILE_THUMB_PX - POS_TILE_ROW_GAP_PX - RESERVE_PX;
      assert.ok(
        nameBox >= POS_MIN_NAME_BOX_PX,
        `viewport ${vw}px (sidebar ${sidebarState}): tile ${tile.toFixed(1)}px -> name box ${nameBox.toFixed(1)}px ` +
          `is below POS_MIN_NAME_BOX_PX (${POS_MIN_NAME_BOX_PX}px)`,
      );
    }
  }
});

test("PIN: desktop two-pane column counts match the sidebar-aware v1 parity target (viewport breakpoints, no scrollbar subtraction any more)", () => {
  assert.equal(colsFor(1280, "expanded"), 3, "1280px two-pane grid (sidebar expanded) must give 3 columns");
  assert.equal(colsFor(1536, "expanded"), 4, "1536px two-pane grid (sidebar expanded) must give 4 columns");
  assert.equal(colsFor(1920, "expanded"), 4, "1920px two-pane grid (sidebar expanded) must give 4 columns");
  assert.equal(colsFor(1280, "collapsed"), 4, "1280px two-pane grid (sidebar collapsed) must give 4 columns");
});

test("PIN: regression oracles — two retired breakpoint/tiering choices starved the grid; the shipped xl-switch does not", () => {
  // OLD v1 md-switch (retired): two-pane from md (768px) — once the sidebar
  // is counted the pane goes NEGATIVE, so the two-pane literally did not fit.
  // Frozen historical fact, independent of which column-tiering system (the
  // retired container-query one, or today's viewport one) was in play.
  const OLD_MD_PANE_768 =
    768 -
    SIDEBAR_WIDTH_REM * REM_PX -
    2 * MAIN_PADDING_X_REM_MD * REM_PX -
    POS_PANE_GAP_REM * REM_PX -
    POS_CART_COLUMN_REM * REM_PX -
    POS_RAIL_REM * REM_PX -
    POS_PANE_GAP_REM * REM_PX;
  assert.equal(OLD_MD_PANE_768, -88, "sanity: retired v1's md-switch pane at 768px must compute to -88px");
  assert.ok(OLD_MD_PANE_768 < POS_MIN_TILE_PX, "retired v1's md-switch two-pane at 768px never fit at all (negative pane)");

  // FIRST CB-1 DRAFT (review F1): sidebar-aware but switched at lg (1024),
  // not xl — same 168px pane as above. At the time this was tested against
  // the (now-retired) CONTAINER-QUERY tiers {0:2, 400:3, 672:4} (25rem/42rem
  // in px) — that system is gone (CB-1b), so this oracle keeps those numbers
  // as a frozen historical fact rather than re-deriving them from a constant
  // that no longer exists.
  const DRAFT_LG_PANE_1024 =
    1024 -
    SIDEBAR_WIDTH_REM * REM_PX -
    2 * MAIN_PADDING_X_REM_MD * REM_PX -
    POS_PANE_GAP_REM * REM_PX -
    POS_CART_COLUMN_REM * REM_PX -
    POS_RAIL_REM * REM_PX -
    POS_PANE_GAP_REM * REM_PX;
  const RETIRED_CONTAINER_TIERS = [
    { minPx: 0, cols: 2 },
    { minPx: 400, cols: 3 },
    { minPx: 672, cols: 4 },
  ];
  let draftCols = RETIRED_CONTAINER_TIERS[0].cols;
  for (const tier of RETIRED_CONTAINER_TIERS) if (tier.minPx <= DRAFT_LG_PANE_1024) draftCols = tier.cols;
  const draftTile = tilePx(DRAFT_LG_PANE_1024, draftCols);
  assert.equal(draftCols, 2, `sanity: the first draft's lg-switch pane (${DRAFT_LG_PANE_1024}px) must land in the retired 2-column tier`);
  assert.ok(
    draftTile < POS_MIN_TILE_PX,
    `regression: the first draft's lg-switch produced an ${draftTile.toFixed(1)}px tile at 1024 — even sidebar-aware, lg was still the wrong breakpoint`,
  );

  // Shipped: xl-switch means 1024 stays single-pane; column count now comes
  // from the viewport-keyed colsFor (CB-1b), not a pane-width container query.
  const shippedPane = paneWidthPx(1024, "expanded");
  const shippedCols = colsFor(1024, "expanded");
  const shippedTile = tilePx(shippedPane, shippedCols);
  assert.ok(
    shippedTile >= POS_MIN_TILE_PX,
    `regression: the shipped xl-switch single-pane 1024 (${shippedPane}px, ${shippedCols} cols, ` +
      `${shippedTile.toFixed(1)}px tile) must be >= POS_MIN_TILE_PX`,
  );
});

// ── B. the two grid class strings encode exactly their tier tables ─────────

const NAMED_BREAKPOINT_PX: Record<string, number> = {
  sm: BREAKPOINT_SM_PX,
  md: BREAKPOINT_MD_PX,
  lg: BREAKPOINT_LG_PX,
  xl: BREAKPOINT_XL_PX,
  "2xl": BREAKPOINT_2XL_PX,
};

function parseGridTiers(cls: string): Array<{ minPx: number; cols: number }> {
  const tiers: Array<{ minPx: number; cols: number }> = [];
  const bareMatch = cls.match(/(?:^|\s)grid-cols-(\d+)(?:\s|$)/);
  if (bareMatch) tiers.push({ minPx: 0, cols: Number(bareMatch[1]) });
  for (const m of cls.matchAll(/(sm|md|lg|xl|2xl):grid-cols-(\d+)/g)) {
    tiers.push({ minPx: NAMED_BREAKPOINT_PX[m[1]], cols: Number(m[2]) });
  }
  tiers.sort((a, b) => a.minPx - b.minPx);
  return tiers;
}

test("PIN: POS_GRID_CLASS_SIDEBAR_EXPANDED/COLLAPSED each encode exactly their POS_GRID_COLUMN_TIERS_SIDEBAR_* table", () => {
  assert.deepStrictEqual(
    parseGridTiers(POS_GRID_CLASS_SIDEBAR_EXPANDED),
    POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED as unknown as ReturnType<typeof parseGridTiers>,
    "the tiers parsed out of POS_GRID_CLASS_SIDEBAR_EXPANDED must exactly match POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED",
  );
  assert.deepStrictEqual(
    parseGridTiers(POS_GRID_CLASS_SIDEBAR_COLLAPSED),
    POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED as unknown as ReturnType<typeof parseGridTiers>,
    "the tiers parsed out of POS_GRID_CLASS_SIDEBAR_COLLAPSED must exactly match POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED",
  );
});

test("PIN: neither grid class string uses a container query — the viewport tiers are kept as plain testable data, not a missing-support fallback", () => {
  for (const [label, cls] of [
    ["POS_GRID_CLASS_SIDEBAR_EXPANDED", POS_GRID_CLASS_SIDEBAR_EXPANDED],
    ["POS_GRID_CLASS_SIDEBAR_COLLAPSED", POS_GRID_CLASS_SIDEBAR_COLLAPSED],
  ] as const) {
    assert.ok(!cls.includes("@container"), `${label} must not include @container`);
    assert.ok(!cls.includes("@min-"), `${label} must not include @min-`);
    assert.match(cls, /grid-cols-2/, `landmark: ${label} must still carry the bare grid-cols-2 base tier`);
  }
});

// ── C. arithmetic pins on the other class strings ───────────────────────────

test("PIN: POS_ROOT_CHROME_REM_BASE/_MD count only the TOP half of main's own vertical padding (the root bleeds over the bottom half via its own negative margins below xl); POS_ROOT_CHROME_REM_XL counts BOTH paddings (the v1 two-pane keeps normal margins); POS_ROOT_FLOOR_REM_XL is the unchanged v1 desktop floor", () => {
  assert.equal(POS_ROOT_CHROME_REM_BASE, DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_BASE / 2, "POS_ROOT_CHROME_REM_BASE must equal DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_BASE / 2");
  assert.equal(POS_ROOT_CHROME_REM_BASE, 4.5, "POS_ROOT_CHROME_REM_BASE must be 4.5");
  assert.equal(POS_ROOT_CHROME_REM_MD, DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_MD / 2, "POS_ROOT_CHROME_REM_MD must equal DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_MD / 2");
  assert.equal(POS_ROOT_CHROME_REM_MD, 5, "POS_ROOT_CHROME_REM_MD must be 5");
  assert.equal(POS_ROOT_CHROME_REM_XL, DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_MD, "POS_ROOT_CHROME_REM_XL must equal DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_MD (both paddings)");
  assert.equal(POS_ROOT_CHROME_REM_XL, 6.5, "POS_ROOT_CHROME_REM_XL must be 6.5");
  assert.equal(POS_ROOT_FLOOR_REM_XL, 30, "POS_ROOT_FLOOR_REM_XL must be 30 — the v1 two-pane's original desktop floor, unchanged");
});

test("PIN: POS_MOBILE_STACK_REM sums the four below-xl rows plus POS_ROOT_GAP_COUNT gap-3 boundaries to a literal 15rem, and POS_ROOT_FLOOR_REM_BASE adds ONE tile row on top of that", () => {
  assert.equal(
    POS_MOBILE_STACK_REM,
    POS_HEADER_ROW_REM + POS_CHIP_STRIP_REM + POS_SEARCH_ROW_REM + POS_MOBILE_BAR_REM + POS_ROOT_GAP_COUNT * POS_ROOT_GAP_REM,
    "POS_MOBILE_STACK_REM must equal the sum of the four row constants plus POS_ROOT_GAP_COUNT gap-3 boundaries",
  );
  // Deliberately a literal, not just internal-consistency: the point of this
  // pin is that the stack IS 15rem, not merely that it agrees with itself.
  assert.equal(POS_MOBILE_STACK_REM, 15, "POS_MOBILE_STACK_REM must be exactly 15rem");
  assert.equal(POS_ROOT_GAP_COUNT, 4, "POS_ROOT_GAP_COUNT must be 4 — root: header|split and split|bar, pane: strip|grid, ProductGrid: search|scroller");
  assert.equal(POS_ROOT_FLOOR_REM_BASE, POS_MOBILE_STACK_REM + POS_TILE_MIN_REM, "POS_ROOT_FLOOR_REM_BASE must equal the stack plus one POS_TILE_MIN_REM row");
  assert.equal(POS_ROOT_FLOOR_REM_BASE, 21.5, "POS_ROOT_FLOOR_REM_BASE must be exactly 21.5rem");
});

// Utility/variant split for a single Tailwind token: `utility` is the part
// after the LAST `:` (so a bracketed arbitrary value like
// `supports-[height:1dvh]:h-[calc(...)]` is not mistaken for two tokens);
// `variants` is everything before it (empty for a bare, un-prefixed token).
function utilityOf(token: string): string {
  const idx = token.lastIndexOf(":");
  return idx >= 0 ? token.slice(idx + 1) : token;
}

test("PIN: POS_ROOT_CLASS is a DEFINITE vh/dvh chain (CB-1c round 2) — every below-xl height token subtracts the published alert-bar variable, xl+ height tokens don't, the two min-h floors are variant-scoped (F13), and the full-bleed negative margins stay", () => {
  // Needles built from the constants (never re-typed literals) — testing.md's
  // "build by concatenation" rule, so a drifted constant trips this pin
  // instead of a hand-typed number silently agreeing with itself.
  const baseH = "h-[calc(100vh-" + POS_ROOT_CHROME_REM_BASE + "rem-var(" + POS_ALERT_HEIGHT_VAR + ",0px))]";
  const baseDvh = "supports-[height:1dvh]:h-[calc(100dvh-" + POS_ROOT_CHROME_REM_BASE + "rem-var(" + POS_ALERT_HEIGHT_VAR + ",0px))]";
  const mdH = "md:h-[calc(100vh-" + POS_ROOT_CHROME_REM_MD + "rem-var(" + POS_ALERT_HEIGHT_VAR + ",0px))]";
  const mdDvh = "md:supports-[height:1dvh]:h-[calc(100dvh-" + POS_ROOT_CHROME_REM_MD + "rem-var(" + POS_ALERT_HEIGHT_VAR + ",0px))]";
  const xlH = "xl:h-[calc(100vh-" + POS_ROOT_CHROME_REM_XL + "rem)]";
  const xlDvh = "xl:supports-[height:1dvh]:h-[calc(100dvh-" + POS_ROOT_CHROME_REM_XL + "rem)]";
  const floorBase = "min-h-[" + POS_ROOT_FLOOR_REM_BASE + "rem]";
  const floorXl = "xl:min-h-[" + POS_ROOT_FLOOR_REM_XL + "rem]";

  for (const needle of [baseH, baseDvh, mdH, mdDvh, xlH, xlDvh, floorBase, floorXl, "-mx-4", "-mb-4", "md:-mx-6", "md:-mb-6", "xl:mx-0", "xl:mb-0"]) {
    assert.ok(POS_ROOT_CLASS.includes(needle), `POS_ROOT_CLASS must include "${needle}"`);
  }

  const tokens = POS_ROOT_CLASS.split(/\s+/).filter(Boolean);

  // Landmarks (paired with every negative pin below, per testing.md).
  assert.ok(tokens.includes("flex"), "landmark: POS_ROOT_CLASS must still carry the bare flex token");
  assert.ok(tokens.includes("flex-col"), "landmark: POS_ROOT_CLASS must still carry flex-col");
  assert.ok(tokens.includes("gap-3"), "landmark: POS_ROOT_CLASS must still carry gap-3");
  assert.ok(tokens.includes("-mx-4"), "landmark: POS_ROOT_CLASS must still carry -mx-4");

  // Variant-aware negatives (review finding F13): a naive whole-string
  // "no min-h token" or "no vh token outside xl:" check would either reject
  // the two LEGITIMATE floor tokens or miss a stray one hiding under a
  // different variant — so every check below reads utility vs. variant per
  // token, never the raw string.
  for (const t of tokens) {
    const utility = utilityOf(t);

    if (utility.startsWith("min-h-")) {
      assert.ok(
        t === floorBase || t === floorXl,
        `token "${t}" starts with min-h- but is neither the base floor "${floorBase}" nor the xl floor "${floorXl}"`,
      );
    }
    assert.ok(!utility.startsWith("pb-"), `token "${t}" must not reserve bottom padding — the bar is an in-flow sticky child now (POS_MOBILE_BAR_CLASS)`);
    assert.ok(
      utility !== "overflow-hidden",
      `token "${t}" must not be overflow-hidden (any variant) — it would clip the sticky bar in the phone-landscape floor deficit case`,
    );
    if (utility.startsWith("h-[")) {
      if (!t.startsWith("xl:")) {
        assert.ok(
          t.includes("var(" + POS_ALERT_HEIGHT_VAR + ",0px)"),
          `below-xl height token "${t}" must subtract var(${POS_ALERT_HEIGHT_VAR},0px) — the alert bar's published height`,
        );
      } else {
        assert.ok(!t.includes("var("), `xl-prefixed height token "${t}" must NOT reference var( — the alert-bar budget only applies below xl`);
      }
    }
  }
});

// ── C2. height-chain matrix (CB-1c round 2 — the min-content stack vs. the
// DEFINITE vh/dvh root, alert-bar budget included; plan §H0's headless-
// -Chrome arbiter probe validated this formula against the real chain) ─────

// Visible-height figures are DOCUMENTED ESTIMATES (plan §H0's own probe
// numbers, arbiter-validated design), not measured facts about every real
// device out there. 740x360's 360 is the arbiter's own probe value (the full
// viewport height, not a browser-chrome-adjusted figure); the 300 row models
// the same phone with its address bar still showing (a toolbar-visible
// landscape phone).
const ALERT_BAND_PX_ESTIMATE = 48; // py-2 + text-sm content estimate — real height comes from the ResizeObserver at runtime; this is only a plausible test value.
// Modelling note (no assertion change): the runtime subtracts the band's REAL
// measured offsetHeight, not this estimate — a band that wraps to more lines
// on a narrow phone can legitimately be taller than 48px, and a taller band
// can legitimately make the POS_ROOT_FLOOR_REM_BASE (21.5rem) floor bite on a
// device/row that this estimate alone would show clearing it.

interface DeviceRow {
  readonly label: string;
  readonly visibleH: number;
  readonly mdPlus: boolean;
}

const DEVICE_MATRIX_BASE: ReadonlyArray<DeviceRow> = [
  { label: "360x640 phone portrait", visibleH: 560, mdPlus: false },
  { label: "412x915 phone portrait", visibleH: 800, mdPlus: false },
  { label: "740x360 phone landscape (full viewport, arbiter probe value)", visibleH: 360, mdPlus: false },
  { label: "740x300 phone landscape (toolbar showing)", visibleH: 300, mdPlus: false },
  { label: "768x1024 tablet portrait", visibleH: 904, mdPlus: true },
  { label: "1024x768 tablet landscape", visibleH: 648, mdPlus: true },
  { label: "~1100x~600 owner tablet landscape", visibleH: 600, mdPlus: true },
];

type DeviceMatrixRow = DeviceRow & { readonly bandPx: number };

// Each row appears twice: once with no alert band, once with the estimated
// band height — the root's height chain must hold either way.
const DEVICE_MATRIX: ReadonlyArray<DeviceMatrixRow> = DEVICE_MATRIX_BASE.flatMap((row) => [
  { ...row, bandPx: 0 },
  { ...row, bandPx: ALERT_BAND_PX_ESTIMATE },
]);

const LANDSCAPE_LABELS = new Set([
  "740x360 phone landscape (full viewport, arbiter probe value)",
  "740x300 phone landscape (toolbar showing)",
]);

// chromePx: the header plus the TOP HALF of main's own vertical padding only
// — the root bleeds over the BOTTOM half via its own negative margins below
// xl, so only the top half is chrome the root's own height has to subtract.
function chromePxFor(row: DeviceRow): number {
  const chromeRem = row.mdPlus ? POS_ROOT_CHROME_REM_MD : POS_ROOT_CHROME_REM_BASE;
  return chromeRem * REM_PX;
}

function rootRawPxFor(row: DeviceMatrixRow): number {
  return row.visibleH - chromePxFor(row) - row.bandPx;
}

function rootPxFor(row: DeviceMatrixRow): number {
  return Math.max(rootRawPxFor(row), POS_ROOT_FLOOR_REM_BASE * REM_PX);
}

function gridPxFor(row: DeviceMatrixRow): number {
  return rootPxFor(row) - POS_MOBILE_STACK_REM * REM_PX;
}

function docScrollPxFor(row: DeviceMatrixRow): number {
  return rootPxFor(row) - rootRawPxFor(row);
}

const MIN_GRID_PX = POS_TILE_MIN_REM * REM_PX; // 104

test("PIN: every non-landscape device in the matrix (either alert-band value) never document-scrolls and keeps >=104px of grid", () => {
  for (const row of DEVICE_MATRIX) {
    if (LANDSCAPE_LABELS.has(row.label)) continue;
    const docScroll = docScrollPxFor(row);
    const grid = gridPxFor(row);
    assert.equal(docScroll, 0, `${row.label} (band ${row.bandPx}px): document must not scroll, got ${docScroll}px`);
    assert.ok(grid >= MIN_GRID_PX, `${row.label} (band ${row.bandPx}px): grid ${grid}px must be >= ${MIN_GRID_PX}px`);
  }
});

test("PIN: both phone-landscape rows hit the root floor at every alert-band value — accepted Q1 deficit (the floor keeps one tile row and the sticky bar in view, rather than a header/strip/search with NO products)", () => {
  for (const row of DEVICE_MATRIX) {
    if (!LANDSCAPE_LABELS.has(row.label)) continue;
    const docScroll = docScrollPxFor(row);
    const grid = gridPxFor(row);
    assert.ok(docScroll > 0, `${row.label} (band ${row.bandPx}px): must have a positive document-scroll deficit, got ${docScroll}px`);
    assert.equal(grid, MIN_GRID_PX, `${row.label} (band ${row.bandPx}px): grid must sit exactly at the floor (${MIN_GRID_PX}px)`);
  }
});

test("PIN: with the alert band present, the owner-tablet row still clears double the grid floor", () => {
  const ownerRow = DEVICE_MATRIX.find(
    (r) => r.label === "~1100x~600 owner tablet landscape" && r.bandPx === ALERT_BAND_PX_ESTIMATE,
  );
  assert.ok(ownerRow, "owner-tablet-with-band row must exist in DEVICE_MATRIX");
  const grid = gridPxFor(ownerRow!);
  assert.ok(grid >= MIN_GRID_PX * 2, `owner-tablet with alert band: grid ${grid}px must be >= ${MIN_GRID_PX * 2}px`);
});

// ── C3. xl (desktop two-pane) root/floor matrix — arbiter F5 datapoint ─────
// At xl the alert-bar budget never applies (the C-section pin above proves no
// xl height token references var(--pos-alert-h,...)), so every row here
// models the band as 0px — not because the band can't render at xl, but
// because xl's height tokens never subtract it (v1's un-budgeted desktop
// behaviour, unchanged by CB-1c). "grid" isn't computed here: at xl the
// layout is the two-pane rail|grid|cart split, not the below-xl single-column
// min-content stack that gridPxFor/POS_MOBILE_STACK_REM model.
interface XlDeviceRow {
  readonly label: string;
  readonly visibleH: number;
}

const XL_DEVICE_MATRIX: ReadonlyArray<XlDeviceRow> = [
  { label: "1280x560 short desktop window", visibleH: 560 },
  { label: "1280x800 desktop", visibleH: 800 },
  { label: "1920x1080 desktop", visibleH: 1080 },
];

function xlChromePx(): number {
  return POS_ROOT_CHROME_REM_XL * REM_PX;
}

function xlRootRawPxFor(row: XlDeviceRow): number {
  return row.visibleH - xlChromePx();
}

function xlRootPxFor(row: XlDeviceRow): number {
  return Math.max(xlRootRawPxFor(row), POS_ROOT_FLOOR_REM_XL * REM_PX);
}

function xlDocScrollPxFor(row: XlDeviceRow): number {
  return xlRootPxFor(row) - xlRootRawPxFor(row);
}

test("PIN: xl root/floor matrix — POS_ROOT_CHROME_REM_XL + POS_ROOT_FLOOR_REM_XL reproduce the arbiter's F5 desktop-floor datapoint (1280x560 root 480px, doc-scroll 24px) and the two floor-clearing rows scroll 0", () => {
  const EXPECTED: Record<string, { root: number; docScroll: number }> = {
    "1280x560 short desktop window": { root: 480, docScroll: 24 },
    "1280x800 desktop": { root: 696, docScroll: 0 },
    "1920x1080 desktop": { root: 976, docScroll: 0 },
  };
  for (const row of XL_DEVICE_MATRIX) {
    const expected = EXPECTED[row.label];
    assert.ok(expected, `no expectation recorded for "${row.label}"`);
    assert.equal(xlRootPxFor(row), expected!.root, `${row.label}: root px must be ${expected!.root}`);
    assert.equal(
      xlDocScrollPxFor(row),
      expected!.docScroll,
      `${row.label}: document-scroll deficit must be ${expected!.docScroll}`,
    );
  }
});

test("PIN: POS_INSET_CLASS re-insets the header/split inside the full-bleed root, a no-op at xl+", () => {
  assert.equal(POS_INSET_CLASS, "px-4 md:px-6 xl:px-0");
});

test("PIN: POS_CART_SHEET_CLASS carries a vh base with a supports-dvh override, plus the Radix-X hider", () => {
  assert.ok(POS_CART_SHEET_CLASS.includes("h-[90vh]"), "POS_CART_SHEET_CLASS must include h-[90vh]");
  assert.ok(POS_CART_SHEET_CLASS.includes("supports-[height:1dvh]:h-[90dvh]"), "POS_CART_SHEET_CLASS must include supports-[height:1dvh]:h-[90dvh]");
  assert.ok(POS_CART_SHEET_CLASS.includes("[&>button]:hidden"), "POS_CART_SHEET_CLASS must still hide Radix's own close button");
});

test("PIN: POS_MOBILE_BAR_CLASS is sticky and in-flow, carrying NO margins of its own — the full-bleed ROOT (not the bar) reaches the screen edge now", () => {
  assert.match(POS_MOBILE_BAR_CLASS, /(^|\s)sticky(\s|$)/, "POS_MOBILE_BAR_CLASS must include sticky");
  assert.match(POS_MOBILE_BAR_CLASS, /(^|\s)shrink-0(\s|$)/, "POS_MOBILE_BAR_CLASS must include shrink-0");
  assert.ok(
    !POS_MOBILE_BAR_CLASS.includes("-mb"),
    "POS_MOBILE_BAR_CLASS must not carry its own -mb margin — a negative margin on a sticky element hangs its border box below the viewport while stuck",
  );
  assert.ok(!POS_MOBILE_BAR_CLASS.includes("-mx"), "POS_MOBILE_BAR_CLASS must not carry its own -mx margin — the full-bleed ROOT already reaches the screen edge");
  assert.ok(!POS_MOBILE_BAR_CLASS.includes("fixed"), "POS_MOBILE_BAR_CLASS must not be position:fixed — it's an in-flow sticky child");
  assert.ok(!POS_MOBILE_BAR_CLASS.includes("inset-x-0"), "POS_MOBILE_BAR_CLASS must not carry the old inset-x-0 (fixed-position leftover)");
  assert.ok(!POS_MOBILE_BAR_CLASS.includes("left-0"), "POS_MOBILE_BAR_CLASS must not carry the old left-0 (fixed-position leftover, sidebar tracking is gone too)");
});

test("PIN: POS_SPLIT_CLASS gives the cart its fixed column only from xl, never md or lg", () => {
  const splitCols = `xl:grid-cols-[1fr_${POS_CART_COLUMN_REM}rem]`;
  assert.ok(POS_SPLIT_CLASS.includes(splitCols), `POS_SPLIT_CLASS must include "${splitCols}"`);
  assert.ok(!POS_SPLIT_CLASS.includes("md:grid-cols"), "POS_SPLIT_CLASS must not flip to two-pane at md");
});

test("PIN: exactly one cart mount is visible at any width — the desktop/mobile-only class literals switch at xl", () => {
  assert.equal(POS_DESKTOP_CART_CLASS, "hidden min-h-0 xl:block");
  assert.equal(POS_MOBILE_ONLY_CLASS, "xl:hidden");
  assert.ok(POS_DESKTOP_ONLY_CLASS.startsWith("hidden "), 'POS_DESKTOP_ONLY_CLASS must start with "hidden "');
  assert.ok(POS_DESKTOP_ONLY_CLASS.includes("xl:flex"), 'POS_DESKTOP_ONLY_CLASS must include "xl:flex"');
});

test("PIN: the cart sheet's scrollable panel and its line-list floor carry the right utility classes", () => {
  assert.match(POS_CART_SHEET_PANEL_CLASS, /(^|\s)h-full(\s|$)/, "POS_CART_SHEET_PANEL_CLASS must include h-full");
  assert.match(POS_CART_SHEET_PANEL_CLASS, /overflow-y-auto/, "POS_CART_SHEET_PANEL_CLASS must include overflow-y-auto");
  assert.match(POS_CART_LIST_CLASS, /(^|\s)min-h-32(\s|$)/, "POS_CART_LIST_CLASS must include min-h-32");
  assert.match(POS_CART_LIST_CLASS, /(^|\s)flex-1(\s|$)/, "POS_CART_LIST_CLASS must include flex-1");
  assert.ok(
    !POS_CART_LIST_CLASS.includes("overscroll-contain"),
    "POS_CART_LIST_CLASS must NOT include overscroll-contain — a drag that runs out of list must chain to the scrolling panel so the CTAs come up",
  );
});

test("PIN: POS_CHIP_ROW_CLASS is ONE sideways-scrolling line at every width below xl — no md: wrapping cloud any more (owner decision 2026-08-29, CB-1c: the wrapping cloud ate ~59% of a landscape tablet's visible height)", () => {
  const tokens = POS_CHIP_ROW_CLASS.split(/\s+/).filter(Boolean);
  assert.ok(tokens.includes("flex"), "POS_CHIP_ROW_CLASS must include flex");
  assert.ok(tokens.includes("shrink-0"), "POS_CHIP_ROW_CLASS must include shrink-0");
  assert.ok(tokens.includes("gap-2"), "POS_CHIP_ROW_CLASS must include gap-2");
  assert.ok(tokens.includes("overflow-x-auto"), "POS_CHIP_ROW_CLASS must include overflow-x-auto");
  assert.ok(tokens.includes("pb-1"), "POS_CHIP_ROW_CLASS must include pb-1");

  // Landmarks for the negatives below.
  assert.ok(tokens.includes("flex"), "landmark: POS_CHIP_ROW_CLASS must carry flex");
  assert.ok(tokens.includes("gap-2"), "landmark: POS_CHIP_ROW_CLASS must carry gap-2");

  // Negatives: no md: token of ANY kind (the whole wrapping-cloud variant set
  // is retired, not just flex-wrap/max-h/overflow-y-auto individually).
  assert.ok(!tokens.some((t) => t.startsWith("md:")), "POS_CHIP_ROW_CLASS must carry no md: token at all — one scrolling line at every width below xl");
  assert.ok(!POS_CHIP_ROW_CLASS.includes("flex-wrap"), "POS_CHIP_ROW_CLASS must not include flex-wrap — CB-1b's retired wrapping cloud");
  assert.ok(!POS_CHIP_ROW_CLASS.includes("max-h"), "POS_CHIP_ROW_CLASS must not include a max-h cap — no cloud, nothing to cap");
});

test("PIN: POS_CHIP_CLASS is inline-flex with items-center — the label span's max-w truncate only works on a flex item", () => {
  assert.ok(POS_CHIP_CLASS.startsWith("inline-flex"), `POS_CHIP_CLASS must start with "inline-flex", got "${POS_CHIP_CLASS}"`);
  assert.match(POS_CHIP_CLASS, /(^|\s)items-center(\s|$)/, "POS_CHIP_CLASS must include items-center");
});
