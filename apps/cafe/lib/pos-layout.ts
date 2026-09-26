// POS "New Order" screen layout contract (CB-1, 2026-08-28; CB-1b fallbacks;
// CB-1c 2026-08-30: body dvh floor, alert-bar budget, single-line chip strip).
//
// One place for the class strings and numbers that make the phone / tablet /
// desktop layouts agree with each other. Everything here is a plain literal so
// Tailwind's source scanner still sees every class name, and so the layout
// pins (lib/pos-layout.test.ts + lib/pos-layout-paths.test.ts +
// lib/pos-header-paths.test.ts) can read the SAME constants the page renders
// instead of re-typing them.
//
// Mode switch: `xl` (1280px). Below it the screen is single-pane — compact
// header, category chips, full-width grid, a sticky bottom bar that opens the
// cart in a bottom sheet. At xl+ the classic two-pane (rail + grid | cart
// column) renders. Neither `md` (768) nor `lg` (1024) can be the switch: the
// dashboard sidebar reserves SIDEBAR_WIDTH_REM (16rem, expanded by default on
// every load) of in-flow width from md up, so a two-pane 1024px screen has
// 1024 - 256 - 48 - 12 - 352 - 176 - 12 = 168px left for the grid — v1's
// ~56px tiles (the owner's "menu nahi dikh raha"). Single-pane at 1024 gives
// the grid ~720px instead. (Review CB-1 F1 — the first draft switched at lg
// and had left the sidebar out of the matrix entirely.)
//
// Browser floor — corrected (CB-1c, 2026-08-29; full evidence trail in the
// CB-1c plan/review docs + auto-memory browser-floor-must-be-measured).
// CB-1b wrongly inferred the staff tablet lacked dvh; the real cause was
// <body> min-h-screen (100vh = the LARGEST mobile viewport, URL bar
// retracted) overflowing the visible viewport by the toolbar height. Hence:
// (1) <body> floors at min-h-dvh where dvh exists (app/layout.tsx); (2) the
// POS root keeps a DEFINITE height — vh base, dvh override — subtracting the
// RequestAlertBar's published height (POS_ALERT_HEIGHT_VAR). A percent height
// chain (html/body/shell 100%) was tried and rejected by a headless probe
// (CB-1c review): a percentage child of a min-height:auto flex item counts as
// auto in the item's minimum, so <main> grew to the WHOLE grid; and a
// definite shell un-stuck the header on every tall route. Nothing outside
// this page's own boxes (and the body floor) may change height semantics.
// Viewport-keyed column tiers stay (simpler than a container query, not a
// fallback).

// Tailwind's default viewport breakpoints (px), pinned so the layout test can
// compute the pane-width matrix without importing Tailwind.
export const BREAKPOINT_SM_PX = 640;
export const BREAKPOINT_MD_PX = 768;
export const BREAKPOINT_LG_PX = 1024;
export const BREAKPOINT_XL_PX = 1280;
export const BREAKPOINT_2XL_PX = 1536;
// The viewport width at which the two-pane desktop layout switches on.
export const POS_TWO_PANE_MIN_PX = BREAKPOINT_XL_PX;

// The dashboard sidebar (components/ui/sidebar.tsx SIDEBAR_WIDTH /
// SIDEBAR_WIDTH_ICON — parity-pinned by lib/pos-layout-paths.test.ts) takes
// this much in-flow width from md up (expanded / icon-collapsed); below md it
// is an overlay Sheet and takes none.
export const SIDEBAR_WIDTH_REM = 16;
export const SIDEBAR_WIDTH_ICON_REM = 3;

// Vertical chrome above the POS root (rem): the dashboard's sticky h-14 header
// (3.5rem) plus <main>'s vertical padding (p-4 = 2rem below md, p-6 = 3rem at
// md+). Was one static 7rem, wrong at every breakpoint. The RequestAlertBar
// (variable height, only when QR requests / unprinted self-orders exist) is
// budgeted separately through POS_ALERT_HEIGHT_VAR below.
export const DASHBOARD_HEADER_REM = 3.5;
export const MAIN_PADDING_Y_REM_BASE = 2;
export const MAIN_PADDING_Y_REM_MD = 3;
export const MAIN_PADDING_X_REM_BASE = 1;
export const MAIN_PADDING_X_REM_MD = 1.5;

// The amber RequestAlertBar sits in flow between the header and <main>, so the
// POS root cannot know its height from CSS alone. The bar publishes its own
// offsetHeight (px) on <html> under this custom property — synchronously in a
// layout effect so the first frame is right, then via a ResizeObserver as its
// content wraps — and removes it whenever it renders nothing. The root's
// height subtracts `var(--pos-alert-h, 0px)` below xl (at xl+ the v1 desktop
// keeps its normal page growth). Any other page ignores the variable.
export const POS_ALERT_HEIGHT_VAR = "--pos-alert-h";

// Desktop (xl+) two-pane geometry, unchanged from v1: cart column 22rem, rail
// 11rem (w-44), page gap 0.75rem (gap-3) between rail|grid and grid|cart.
// (v1 switched at md; the geometry itself is the same.)
export const POS_CART_COLUMN_REM = 22;
export const POS_RAIL_REM = 11;
export const POS_PANE_GAP_REM = 0.75;

// Root: a DEFINITE app-screen height (viewport-bounded, no document scroll
// when nothing extra is on the page). `vh` is the base every browser
// understands; where `dvh` exists it takes over, so the visible viewport —
// not the URL-bar-retracted one — is what gets divided up, and the on-screen
// keyboard (interactive-widget=resizes-content) shrinks it. Below xl the
// height budgets the header + TOP padding (4.5rem / 5rem) AND the alert bar's
// published height; the root is FULL-BLEED (negative margins over <main>'s
// side and bottom padding, children re-inset with POS_INSET_CLASS) so its
// bottom edge IS the screen edge and the sticky bar needs no margins of its
// own (a negative margin on a sticky element lets its border box hang below
// the viewport while stuck — reviewer probe, CB-1b). No overflow-hidden: it
// would clip the bar when the floor bites and make the root, not the
// viewport, the bar's sticky container.
// Floors: below xl the root never drops under its own chrome stack plus ONE
// tile row (POS_ROOT_FLOOR_REM_BASE) — on a ~300px-tall landscape phone the
// document then scrolls by the ~56px deficit with the bar stuck in view,
// rather than showing a header, a strip, a search box and NO products (the
// headless probe showed a floor on the scroller alone hides that row under
// the bar). At xl+ the two-pane keeps its normal margins, v1's un-gated 30rem
// floor (re-gated to xl here — it was what made phone landscape scroll) and
// the 6.5rem chrome CB-1 shipped (header + both paddings; v1's static 7rem was
// wrong at every breakpoint) — identical to the CB-1/CB-1b desktop, which is
// the "desktop unchanged" the owner accepted.
export const POS_ROOT_CHROME_REM_BASE = DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_BASE / 2; // 4.5
export const POS_ROOT_CHROME_REM_MD = DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_MD / 2; // 5
export const POS_ROOT_CHROME_REM_XL = DASHBOARD_HEADER_REM + MAIN_PADDING_Y_REM_MD; // 6.5
export const POS_ROOT_FLOOR_REM_XL = 30;
// The root's min-content stack below xl (rem): header controls row (h-10),
// category strip (h-10 chips + pb-1), search row (components/ui/input.tsx
// h-9 — parity-pinned), the bottom bar (p-3 + h-12 button + p-3;
// env(safe-area-inset-bottom) is 0 on the staff devices) and FOUR gap-3
// boundaries — root: header|split and split|bar; pane: strip|grid;
// ProductGrid: search|scroller (the fourth was missed once and cost the
// height matrix 12px on every row — CB-1c review F3). Whatever a viewport has
// above this stack is the grid. Two known 1px-class approximations, kept out
// of the constants on purpose: the bar's `border-t` adds 1px the 4.5rem does
// not carry (so the landscape-phone floor shows its one tile row 1px short —
// CB-1c review F5), and on a desktop browser with classic scrollbars an
// overflowing chip strip is ~15px taller than 2.75rem (tablets and phones use
// overlay scrollbars; below-xl desktop windows are not a staff device).
export const POS_HEADER_ROW_REM = 2.5;
export const POS_CHIP_STRIP_REM = 2.75;
export const POS_SEARCH_ROW_REM = 2.25;
export const POS_MOBILE_BAR_REM = 4.5;
export const POS_ROOT_GAP_REM = 0.75;
export const POS_ROOT_GAP_COUNT = 4;
export const POS_MOBILE_STACK_REM =
  POS_HEADER_ROW_REM +
  POS_CHIP_STRIP_REM +
  POS_SEARCH_ROW_REM +
  POS_MOBILE_BAR_REM +
  POS_ROOT_GAP_COUNT * POS_ROOT_GAP_REM; // 15
// One product tile's minimum height (ProductGrid TILE_MIN_HEIGHT, min-h-[6.5rem]
// — parity-pinned) — the smallest grid worth showing.
export const POS_TILE_MIN_REM = 6.5;
export const POS_ROOT_FLOOR_REM_BASE = POS_MOBILE_STACK_REM + POS_TILE_MIN_REM; // 21.5
export const POS_ROOT_CLASS =
  "-mx-4 -mb-4 flex min-h-[21.5rem] h-[calc(100vh-4.5rem-var(--pos-alert-h,0px))] flex-col gap-3 supports-[height:1dvh]:h-[calc(100dvh-4.5rem-var(--pos-alert-h,0px))] md:-mx-6 md:-mb-6 md:h-[calc(100vh-5rem-var(--pos-alert-h,0px))] md:supports-[height:1dvh]:h-[calc(100dvh-5rem-var(--pos-alert-h,0px))] xl:mx-0 xl:mb-0 xl:min-h-[30rem] xl:h-[calc(100vh-6.5rem)] xl:supports-[height:1dvh]:h-[calc(100dvh-6.5rem)]";
// Re-insets the header row and the rail|grid split inside the full-bleed root
// below xl; a no-op at xl+ where the root itself sits inside main's padding.
export const POS_INSET_CLASS = "px-4 md:px-6 xl:px-0";

// The rail|grid + cart split. Single column below xl; the cart gets its fixed
// 22rem column only from xl.
export const POS_SPLIT_CLASS = "grid min-h-0 flex-1 gap-3 xl:grid-cols-[1fr_22rem]";

// Left pane: chips-over-grid below xl, rail-beside-grid at xl+. min-w-0 is
// load-bearing (CB-1d.1b): as a grid item the pane's automatic minimum width
// is its min-content width, and the chip strip — ONE non-wrapping line of
// shrink-0 chips — contributes the SUM of every chip (overflow-x-auto on the
// strip does not shrink that contribution). With 12 categories the floor was
// ~1225px, the single auto column sized to it, and a 412px phone laid the
// whole POS out at 1241px wide: two 608px tiles per row — the owner's "bahut
// bade bade box" (device pass 2026-09-04; the CB-1d.3 phone run had recorded
// innerWidth 1241 in its layout block, unnoticed). min-w-0 lets the track
// size to the viewport and the strip scroll sideways as designed.
export const POS_PANE_CLASS = "flex min-h-0 min-w-0 flex-col gap-3 xl:flex-row";

// Desktop cart column wrapper / mobile bar wrapper — mutually exclusive by
// breakpoint, so exactly one cart mount is visible at any width.
export const POS_DESKTOP_CART_CLASS = "hidden min-h-0 xl:block";
export const POS_MOBILE_ONLY_CLASS = "xl:hidden";
export const POS_DESKTOP_ONLY_CLASS = "hidden xl:flex";

// Bottom cart bar (below xl): the LAST child of the full-bleed root column,
// sticky to the viewport bottom. In-flow means no reserved padding, no overlap
// with the sidebar (it lives inside the content column) and no `fixed`-
// position surprises under an on-screen keyboard; sticky means it stays in
// view when the page is taller than the viewport (RequestAlertBar, the min-h
// floor, a browser whose 100vh exceeds the visible area). It carries NO
// margins: the root's own full-bleed puts its bottom edge on the screen edge
// — the white strip the owner saw was <main>'s padding under a reserved gap.
export const POS_MOBILE_BAR_CLASS =
  "sticky bottom-0 z-20 shrink-0 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]";
export const POS_MOBILE_BAR_BUTTON_CLASS =
  "flex h-12 w-full items-center justify-between touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Cart bottom sheet height: `vh` base, `dvh` where supported (with
// interactive-widget=resizes-content, set in the dashboard layout, the
// on-screen keyboard then shrinks the sheet and its scroll region scrolls the
// focused input into view).
export const POS_CART_SHEET_CLASS =
  "h-[90vh] rounded-t-xl p-0 supports-[height:1dvh]:h-[90dvh] [&>button]:hidden";
// The Cart INSIDE that sheet scrolls as one panel: when the sheet is shorter
// than header + list + notes + footer (phone landscape; portrait with the
// keyboard up) the footer's inputs and CTAs must stay reachable by scrolling
// instead of overflowing past the sheet's bottom edge (review CB-1 F3).
export const POS_CART_SHEET_PANEL_CLASS =
  "h-full overflow-y-auto overscroll-contain rounded-none border-0";
// The cart's line list keeps at least this much height before the panel
// itself starts scrolling — otherwise flex shrinks the list to 0 first and
// the operator sees a cart with no items in it. The Cart root scrolls in BOTH
// mounts (Cart.tsx), so on a short desktop window the footer is reached by
// scrolling the card rather than overflowing it. No overscroll-contain here:
// a drag that runs out of list must chain to the panel so the CTAs come up.
export const POS_CART_LIST_CLASS = "min-h-48 flex-1 overflow-y-auto p-2";

// D9.8 (owner decision 2026-09-26) — the cart footer's "More" control and the
// panel it opens. The occasional money controls (reward, promo, discount, the
// GST preset, extra charges) moved off the always-visible footer stack and
// behind this one button; components/pos/CartMoreMenu.tsx carries the full why.
// 44px tall on touch, compacting to 32px only on an xl+ FINE pointer — the
// POS_HEADER_CONTROL_CLASS idiom (keying the SHRINK on a fine pointer is
// cascade-proof where a coarse re-floor would depend on emission order,
// CB-1d.1 V1), so glass never gets a smaller target than touch.
export const POS_CART_MORE_BUTTON_CLASS =
  "flex h-11 w-full items-center justify-start gap-1.5 px-2 text-sm font-medium text-muted-foreground xl:pointer-fine:h-8 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// The panel the More button opens. Width is capped to the viewport so it can
// never overhang a phone screen, and the height cap + scroll keeps its
// contents reachable when the reward ladder is long or the on-screen keyboard
// is up — vh base with a dvh override, the POS_DIALOG_LIST_CAP_CLASS pattern,
// for exactly the reason given there.
export const POS_CART_MORE_PANEL_CLASS =
  "w-[min(20rem,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto p-3 supports-[height:1dvh]:max-h-[60dvh]";

// Instant-tap feel (CB-1d.1 L1): no double-tap-zoom delay, no long-press text
// selection, and a compositor-only pressed state (scale/opacity — never paint)
// gated to coarse pointers, which have no hover to carry feedback. Duplicated
// VERBATIM inside the interactive tokens below (the scanner and the string
// pins need plain literals); a paths pin keeps every copy in sync. Never on
// an input.
export const POS_PRESS_FEEDBACK_CLASS =
  "touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Header controls (Table / Customer / Open tabs / KOT / Move table): 40px tall
// with 14px text wherever a finger might tap; the compact 32px / 12px
// `size="sm"` look returns at xl+ only behind `pointer-fine:` — keying the
// SHRINK on a fine pointer is cascade-proof where a coarse re-floor would
// depend on emission order, so glass never gets smaller targets at any width
// (CB-1d.1 V1). tailwind-merge lets these override the size variant.
export const POS_HEADER_CONTROL_CLASS =
  "h-10 text-sm xl:pointer-fine:h-8 xl:pointer-fine:text-xs touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// Below xl the header is ONE non-wrapping row, so only one control may
// flex-shrink and truncate — the customer chip (names are the long values).
// The table / move-table chip is content-sized (capped at 7rem so an
// operator-typed table name cannot starve the customer chip), both chips
// drop their leading icon below xl, and Open tabs shows icon + count only:
// review CB-1 F10 probed a 360px header down to two visible glyphs per chip
// when both chips shared the leftover width. Budget at 360px (328px row):
// KOT 40 + tabs ~68 + table ≤112 + 3 gaps 24 = ≤244 → customer ≥84px.
export const POS_HEADER_CHIP_FIXED_CLASS = "shrink-0 max-w-28 xl:max-w-none";
export const POS_HEADER_CHIP_FLEX_CLASS = "min-w-0 flex-1 xl:flex-none";
export const POS_HEADER_CHIP_ICON_CLASS = "hidden h-4 w-4 xl:block";

// Category chips row (below xl): ONE sideways-scrolling line at every width,
// phones and tablets alike (owner decision 2026-08-29 — "category line",
// chosen over the 2–3-row cloud). CB-1b's three-row wrapping cloud (≈9rem)
// plus the header and search rows ate ~59% of a landscape tablet's visible
// height — the owner's "category half page me aa raha hai". A single 40px
// strip gives that ~100px back to the menu. `shrink-0` so the flex column
// never squeezes the strip when the grid competes for height; the selected
// chip is kept in view by CategoryChips (scrollIntoView on change), so a
// category that scrolled off the strip is never lost. No scroll-snap: a
// `snap-x` container is inert without `snap-*` on the chips. "All" first.
export const POS_CHIP_ROW_CLASS = "flex shrink-0 gap-2 overflow-x-auto pb-1";
// inline-flex is load-bearing: the label span inside is truncated with a
// max-width, which only applies once the span is a flex item (max-width and
// overflow are ignored on a plain inline box inside an inline-block button).
export const POS_CHIP_CLASS =
  "inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Product grid columns are decided by VIEWPORT breakpoints + the sidebar's
// state (ProductGrid reads useSidebar()), which together determine the grid
// pane's real width — chosen in CB-1b over a container query, and kept in
// CB-1c because the tiers are plain data the pins can verify (the browser-
// floor reason CB-1b gave was wrong). Below md the sidebar is an overlay,
// so both strings agree there. Every tier keeps tiles ≥ POS_MIN_TILE_PX for
// pane = viewport − sidebar − main padding − [xl+: gaps + cart + rail] (the
// matrix pin in lib/pos-layout.test.ts derives exactly that). No 5-column
// tier: the ≥1536 desktop keeps its v1 four columns.
export const POS_GRID_CLASS_SIDEBAR_EXPANDED =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4";
export const POS_GRID_CLASS_SIDEBAR_COLLAPSED =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-4";
export const POS_GRID_GAP_REM = 0.5;
// The same tiers as data (viewport px → columns), for the layout pins' tile-
// width matrix. Keep in step with the two class strings above (the test
// asserts each string encodes exactly its table).
export const POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED: ReadonlyArray<{ minPx: number; cols: number }> = [
  { minPx: 0, cols: 2 },
  { minPx: BREAKPOINT_SM_PX, cols: 3 },
  { minPx: BREAKPOINT_LG_PX, cols: 4 },
  { minPx: BREAKPOINT_XL_PX, cols: 3 },
  { minPx: BREAKPOINT_2XL_PX, cols: 4 },
];
export const POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED: ReadonlyArray<{ minPx: number; cols: number }> = [
  { minPx: 0, cols: 2 },
  { minPx: BREAKPOINT_SM_PX, cols: 3 },
  { minPx: BREAKPOINT_MD_PX, cols: 4 },
  { minPx: BREAKPOINT_XL_PX, cols: 4 },
];
// Tile-internal geometry (ProductGrid markup, parity-pinned): what's left of
// a tile after card padding, thumb, row gap and the options-button reserve is
// the product-name box; the matrix pin floors it at POS_MIN_NAME_BOX_PX
// (= the 1280/expanded/coarse tier's 136px tile — the CB-1d.1 V3 trade-off,
// 40px button ⇒ pr-9, accepted at arbitration g1).
export const POS_TILE_CARD_PADDING_PX = 10;
export const POS_TILE_THUMB_PX = 40;
export const POS_TILE_ROW_GAP_PX = 8;
export const POS_MIN_NAME_BOX_PX = 32;
// Coarse lower bound on tile width ("menu nahi dikh raha"). NOTE: at 128px
// the name box would be only 24px (128 − 20 pad − 40 thumb − 8 gap − 36
// reserve), BELOW the enforced 32px name floor — so with pr-9 the BINDING
// constraint is the nameBox >= POS_MIN_NAME_BOX_PX matrix pin (tightest real
// tier: 136px tile), and this constant is the retained secondary bound.
export const POS_MIN_TILE_PX = 128;

// Touch targets: cart qty steppers / remove (36px, compacting to 28px only on
// an xl+ FINE pointer) and the tile's "add with note" corner button — 40px now
// (CB-1d.1 V3: 32px sat under every comfort bar), same pointer-fine compact.
export const POS_CART_STEPPER_CLASS =
  "h-9 w-9 xl:pointer-fine:h-7 xl:pointer-fine:w-7 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
export const POS_TILE_OPTIONS_BUTTON_CLASS =
  "h-10 w-10 xl:pointer-fine:h-8 xl:pointer-fine:w-8 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// Title clearance for that button: 40px + 4px inset − 10px card padding =
// 34px ⇒ pr-9 (pr-7 was sized for the 32px button the same way).
export const POS_TILE_OPTIONS_RESERVE_CLASS = "pr-9 xl:pointer-fine:pr-7";
// Primary/secondary cart CTAs: 48px on touch; `size="lg"`'s 40px only at
// xl + FINE pointer (glass keeps 48px — the V1 invariant is uniform, g4).
export const POS_CART_CTA_CLASS =
  "w-full h-12 xl:pointer-fine:h-10 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// CB-2 — the cart's "GST Discount" preset toggle: the 36px control tier (the
// stepper's), full width, compacting to 32px only on an xl+ FINE pointer.
export const POS_CART_GST_BUTTON_CLASS =
  "h-9 w-full xl:pointer-fine:h-8 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Dialog list caps (CB-1d.1 V2, the CB-1c residual): a plain-vh cap ignores
// the URL bar / on-screen keyboard, pushing a capped list — and the dialog's
// escape buttons — off a keyboard-shrunk phone viewport. vh base + dvh
// override (POS_CART_SHEET_CLASS pattern); 60vh pickers, 50vh Move table.
export const POS_DIALOG_LIST_CAP_CLASS = "max-h-[60vh] supports-[height:1dvh]:max-h-[60dvh]";
export const POS_MOVE_TABLE_LIST_CAP_CLASS = "max-h-[50vh] supports-[height:1dvh]:max-h-[50dvh]";

// The (dashboard) layout mounts <TouchFeel /> (components/shared/TouchFeel.tsx),
// which publishes this attribute on <html> while the staff dashboard is mounted
// (POS_ALERT_HEIGHT_VAR's publish/remove pattern). globals.css keys its touch-
// feel rules on it: dialogs/sheets portal to <body>, out of reach of in-flow
// wrapper classes, and /m — which never mounts the publisher — stays untouched.
export const POS_TOUCH_ATTR = "data-pos-touch";
