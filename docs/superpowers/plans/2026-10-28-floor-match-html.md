# U3: the Floor (/tables) rebuilt to the owner's HTML: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /tables looks exactly like the owner's HTML Floor screen at 1280, 1280 collapsed, 1024, 820 and 390 px, with
every option the Floor has today kept and placed as the approved design says.

**Architecture:** the HTML's measured values are the spec. The page keeps its queries (`useTables`, the open bills
`OPEN_TABS_FILTERS`, today's reservations, settings), its actions hook (`useFloorActions`) and the hand-off; pure rules
in `lib/floor-tiles.ts` (filters, counts, areas, sections, the header line, the stay words) and a new
`lib/floor-view.ts` (what a tile shows: tone, words, accessible name) turn our data into the HTML's words;
`lib/floor-layout.ts` holds the frame and control classes and two scroll helpers; the components under
`components/tables/Floor*` draw them. The page fills the screen under the shell header and is its own scroller, as the
HTML's screen. Each task ends with a measured comparison of the HTML and our dev build (`compare-ui.mjs`).

**Tech Stack:** Next.js 15.5 (app router), React 19, Tailwind v4 (tokens in `apps/cafe/app/globals.css`, breakpoints
`tab` 720 / `lg` 1024 / `desk` 1100 / `xl` 1280, `max-tab:` below 720, `pointer-coarse:` / `pointer-fine:`), the
shadcn/Radix kit, next/font (Geist), `node:test` + tsx source-reading and render tests in `apps/cafe/lib/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-28-floor-match-html-design.md` (the owner's Q1–Q4 and every call; "design §N")
and `docs/superpowers/specs/2026-10-28-floor-html-values.md` (the exact values; "values §N"). Shell and theme:
`docs/superpowers/specs/2026-10-19-u0-html-values.md` ("U0 values §N"); the confirm sheet: U1's
`lib/sheet-frame.ts` `CONFIRM_SHEET_*`. Today's page, every word and every test pin (P1–P84):
`D:\kd\pos-dev-keep\ui-redesign\inventory\floor-features.md` ("inventory §N", elements E1–E59, tile kinds K1–K11);
shots of today's page: `D:\kd\pos-dev-keep\ui-redesign\current-floor\`; the HTML's shots: `design\spec-shots-floor\`.

## Global Constraints

- **The HTML's numbers are the spec.** Every element in a task's values sections takes the HTML's size, spacing, font
  family / size / weight / letter-spacing / line-height, colour, radius, border and shadow, per breakpoint, exactly. A
  visible difference that is not a mapped item of design §4–§8 is a defect, never a "minor"; a new one goes to the
  controller (who asks the owner), never parked.
- **Layout (design §5):** the page fills the screen under the shell header (`FLOOR_PAGE_CLASS` = `POS_PAGE_CLASS` +
  `flex flex-col overflow-hidden`); the refresh strip is its first child (never scrolls); the scroller below holds the
  body with the HTML's padding `20px 24px 28px` / phone `16px 14px 92px`, each bottom plus
  `env(safe-area-inset-bottom)`, and the HTML's 8 px scrollbar. Grid `repeat(auto-fill, minmax(140px, 1fr))`, gap 10;
  below 720 px `minmax(114px, 1fr)` (design §5, my call: 3 × 114 at 390, two columns below 390).
- **Touch (ruling R1):** the HTML's sizes on touch screens too (tabs and pills 32 px, tiles 112 / 100); 44 px for our own
  controls with no HTML element (the ⋯ trigger, the strip's Try again hit area); Show all tables / Open Setup are 40 px
  as U2's empty-state buttons. Hover only where a pointer can hover (R14; Tailwind v4's `hover:` already is).
- **Safe area (U1 P49):** the scroller's foot, the refresh strip, the toasts and the confirm sheet respect
  `env(safe-area-inset-bottom)` at every width.
- **Colours:** U0 tokens only (`bg-card`, `border-border`, `bg-surface-2`, `bg-surface-3`, `bg-seg`, `shadow-seg`,
  `bg-ink`, `text-on-ink`, `text-muted-foreground` = `--text-2`, `text-subtle-foreground` = `--text-3`, `status-ok`,
  `status-info`, `status-bill`, `status-reserved`, `status-warn`, `status-bad` with their `-ink`, `-tint`, `-border`);
  the per-state tile tones live in `lib/` (pin ui-constants:106: no file under `components/` holds `bg-status-`
  classes of two kinds). No `light-dark()`, no runtime `color-mix()`, no `in oklab` gradient (Tailwind v4's
  `bg-linear-*` writes one: use an arbitrary `[background:linear-gradient(...)]` with plain stops), no `mask-image`.
  The `--brand-*` classes leave the Floor files (they have no dark values).
- **Words (design §4, §11):** the HTML's words where the HTML has the same element; ours for our features and data;
  singular / plural right ("1 seat", "1 table"). Design §11 lists every visible word that changes; nothing else changes.
- **Behaviour stays (design §6.9):** every request and its timing, the one `useNow(FLOOR_CLOCK_TICK_MS)`, the open-bill
  check before every write, the CAS echo, per-table busy, the two confirms and Reserve, commit-before-navigate on Seat
  now, the plain-click hand-off (`offerOnPlainClick`), the table never in the URL, the grid never blanking on a failed
  poll, the only role read in `FloorEmptyState`, the filters reset on every visit. **No new request of any kind.**
- **The paper never changes:** the Floor prints nothing; no file of the S1 43-file pin
  (`lib/printer/kot-text/text-kot-print.test.ts:323`), no slip / receipt / print-routing file; `print-budget.test.ts`
  green.
- **Shared things that must not move:** `TABLE_STATUS_META` (Setup rows and the dashboard read it), the dashboard's Live
  tables (`LiveFloorPanel`, `lib/dashboard/live-tables.ts`), `lib/table-areas.ts`, `lib/table-pick.ts`,
  `lib/pos-table-handoff.ts`, `/tables/setup`, `/tables/qr`, the staff toaster on every page but /pos and /tables.
- **Tests:** pins on look (L / G) move on purpose with the reason in the commit body; pins on behaviour (B) keep their
  meaning (if code moves, the pin moves with the same meaning); budget pins (BUD) never loosen (inventory §4 labels
  each). Two B meanings retire by the owner's answers (design §6.9): P11 "chips never hide a state off-screen" (Q4) and
  header-quick-tabs "every dashboard screen gets both buttons" (Q1, /tables only). Every new Floor file joins
  `FLOOR_FILES` in `lib/tables-floor-paths.test.ts`. New test files go into `apps/cafe/package.json` `testChain`; every
  assertion carries a message. TDD for behaviour and structure (RED seen first). New and touched files ≤ 300 lines.
  Single files run with `node --import tsx --test lib/<name>.test.ts` from `apps/cafe`.
- **Each task ends** with, in `apps/cafe`: `npm test` (the chain), `npm run typecheck`, `npm run lint` green; then the
  measured match below.
- **The measured match (every task):** probes in `D:\kd\pos-dev-keep\ui-redesign\match\floor\probes\task-N.json`, made
  by a `make-task-N.mjs` beside them (U2's pattern, `match\orders\probes\make-task-*.mjs`; template
  `match\probes\_template.json`). The mock's entry: click `text=Rohan K.`, type `1234`, wait 2800, (collapsed: click
  `button[title='Collapse']`), click `nav button[title='Floor']` (phone: the tab bar's button whose text is exactly
  "Floor"), wait 2300; `mockClock` `2026-10-19T21:30:00+05:30`. Ours: `signin`, `guard`, (collapsed:
  `[data-ui='nav-collapse']`), `goto /tables`. Cover every element of the task's values sections (props the HTML fixes,
  not text-dependent widths); add `data-ui="…"` names where a text locator is not stable. Our data is put in the HTML's
  states with `patch` / `rewrite` on GETs (a printed bill: `billFirstPrintedAt` + `billFirstPrintedTotal = total` on an
  open-bill row; a long stay: an older `createdAt`; a booking; a charge; long names). Run
  `COMPARE_BASE=http://localhost:3120 node D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs
  D:\kd\pos-dev-keep\ui-redesign\e2e\e2e4g-uimatch.env <probes> D:\kd\pos-dev-keep\ui-redesign\match\floor\task-N\run-<k>`
  at the five viewports. Done = `compare.md` lists no difference, or only rows the task names as mapped (each mapped
  row cites design §N). A task that touches the header re-runs U0's `match\probes\task-3.json` and `task-4.json`.
- **Environment:** the dev server on `http://localhost:3120` (scratch DB `pos_scratch_e2e_4g_uimatch`, admin
  `e2eadmin`, the password typed from the env file, never printed). Never touch :3110 (the owner's preview); never run
  `next build` in the repo; never restart the dev server (ask the controller). Read-only on data in probes (`guard`):
  never press Reserve, Free table, Seat now or follow a tile link in a probe. Local only: no network, no connectors,
  no push.
- **Commits:** on `feat/ui-floor`, one per green task, `git commit -F <file>` (message written with the Write tool in
  the scratch space), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge.

## Review Focus

1. **The chosen area drifts away:** a refresh, the area heal or another device empties or removes the chosen area, or
   the floor drops below two groups → the page shows "All" (no stuck filter, no tab lit wrongly, no empty page while
   tiles exist). Owned by Task 2 (`effectiveArea` unit tests and a render test of the page's wiring).
2. **Counts and filters agree:** for every area × pill, the pill's count equals the tiles the grid shows when that pill
   is chosen; an Occupied table with a printed bill counts once, under Bill printed; an Available table holding a bill
   (K7) counts as Available; "Other tables" counts like any area. Owned by Task 2 (combinations test).
3. **Narrow phones (360, 375, 390):** no status word clipped beside the ⋯, seats never wrap, a 24-character name
   truncates, no sideways page scroll, the ⋯ hit area never over the detail line. Owned by Task 3 and Task 4 (probe
   states with long and 3-digit names, `elementFromPoint` checks at 360 / 375 / 390).
4. **Taps unchanged:** a plain click on an Open / New order tile still hands off and navigates; Seat now and Free still
   confirm; a busy tile is no target; the ⋯ stays a sibling of the tile surface; the new wrapper (rise, hover) never
   changes what a tap hits. Owned by Task 3 and Task 4 (pins on the structure, the hand-off pins kept).
5. **Refresh failure and recovery:** the strip shows only after the retried poll fails with data on screen, Try again
   re-reads tables and open bills, the strip leaves on success, the header line keeps "Updated {m} min ago". Owned by
   Task 5 (unit + probe with an aborted poll).

---

### Task 1: The /tables frame and its header

**Files:**
- Create: `apps/cafe/lib/floor-layout.ts`, `apps/cafe/lib/floor-layout.test.ts` (add to `testChain`)
- Modify: `apps/cafe/app/(dashboard)/tables/page.tsx` (no `MenuPageShell`; the frame, the scroller and the body; the
  current chips / live line / grid stay inside the body until later tasks replace them),
  `apps/cafe/components/layout/Header.tsx` (`data-floor`: gap 12), `apps/cafe/components/layout/HeaderQuickTabs.tsx`
  (on /tables: Tables not drawn, New order in the Floor look with its label at every width),
  `apps/cafe/components/layout/header-classes.ts` (`HEADER_FLOOR_NEW_ORDER_CLASS`)
- Test: `lib/header-quick-tabs.test.ts`, `lib/orders-layout.test.ts` (its quick-tab needles), `lib/tables-floor-paths.test.ts`

**Interfaces:**
- Produces: `FLOOR_PATH = "/tables"`; `isFloorPath(pathname: string): boolean` (true for `/tables` and `/tables/` only:
  `/tables/setup`, `/tables/qr`, `/tablesx` keep U0's header); `FLOOR_PAGE_CLASS`; `FLOOR_SCROLLER_CLASS` (overflow-y
  auto, overflow-x hidden, `leading-[normal]`, `pt-5 px-6 pb-[calc(28px+env(safe-area-inset-bottom))]`, below 720
  `pt-4 px-3.5 pb-[calc(92px+env(safe-area-inset-bottom))]`, the 8 px scrollbar:
  `[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar-thumb]:rounded-[8px]
  [&::-webkit-scrollbar-thumb]:bg-border`); `FLOOR_BODY_CLASS` (`flex flex-col gap-4`); `data-ui` names `floor-page`,
  `floor-scroller`, `floor-body`; `HEADER_FLOOR_NEW_ORDER_CLASS` (values §1.2 Takeaway: 36 px, padding 0 12, 13.5 px
  500, gap 6, 14 px icon, `hover:bg-surface-2`, the kit outline's border / surface / text, `HTML_PRESS_CLASS`).
- The page keeps `PageHeader eyebrow="Service" title="Floor"` in both branches (P14, P55), its description as today
  (Task 5 changes the words). The error branch renders inside the same frame and scroller.

- [ ] **Step 1: tests first.** `floor-layout.test.ts`: `isFloorPath` cases (`/tables` and `/tables/` true; `/tables/setup`,
  `/tables/qr`, `/tablesx`, `/table`, `/pos` false); `FLOOR_PAGE_CLASS` contains `POS_PAGE_CLASS`; the scroller literal
  holds both bottom `calc(…+env(safe-area-inset-bottom))` values and the scrollbar classes. Source pins: page.tsx has no
  `MenuPageShell`; `data-ui="floor-page"` wraps `data-ui="floor-scroller"`; Header has `data-floor` with
  `data-floor:gap-3`; HeaderQuickTabs on `isFloorPath` drops Tables and gives New order `HEADER_FLOOR_NEW_ORDER_CLASS`
  with `labelClass` `inline` (reason: design §4 Q1, §6.1). Move the two quick-tab pins on purpose (header-quick-tabs
  :54, :64-69; orders-layout :164-171): `HEADER_QUICK_TABS` still holds exactly two; both are drawn on every page but
  /pos and /tables. Run `node --import tsx --test lib/floor-layout.test.ts lib/header-quick-tabs.test.ts` → RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-1.json`: values §1.2–§1.3 (header box, title, subtitle box, New order box / font /
  colours / border / radius / icon, hover background at the two 1280 sizes, printer; the mini logo on the phone), §0.3
  and §13.1 regions (the page box, the scroller box and padding, the body's first child's x / width = 1000 / 1156 /
  900 / 696 / 362). Re-run U0 `task-3.json`, `task-4.json`. Mapped: the subtitle's words (Task 5), the "New order" word
  (design Q1), Refresh / Tokens (ours, U0).
- [ ] **Step 5: commit.**

### Task 2: Filters, counts, area tabs and the status pills

**Files:**
- Modify: `apps/cafe/lib/floor-tiles.ts` (filters, counts, areas, sections), `apps/cafe/lib/floor-layout.ts` (control
  classes + two scroll helpers), `apps/cafe/components/tables/FloorStatusChips.tsx` (the HTML's pills),
  `apps/cafe/app/(dashboard)/tables/page.tsx` (area + filter state, the controls row, the filtered-empty words and its
  reset), `apps/cafe/app/globals.css` (one token `--on-ink-muted`: light `#a9a9b2`, dark `#52525b`, and its `--color-`
  twin)
- Create: `apps/cafe/components/tables/FloorAreaTabs.tsx`, `apps/cafe/hooks/use-scroll-fades.ts`
- Test: `lib/floor-tiles.test.ts`, `lib/floor-layout.test.ts`, `lib/tables-floor-paths.test.ts` (P11, P12 move;
  `FLOOR_FILES` gains the two new files)

**Interfaces:**
- Produces in `lib/floor-tiles.ts` (replacing today's `FloorFilter`, `statusCounts`, `filterTiles`, `emptyFilterText`):
  - `type FloorFilter = "all" | "free" | "occupied" | "billed" | "reserved"`;
    `FLOOR_FILTERS: readonly { key: FloorFilter; label: string }[]` = All, Available, Occupied, Bill printed, Reserved
    (the HTML's order and words).
  - `floorFilterOf(tile: FloorTileModel): Exclude<FloorFilter, "all">`: Occupied → `billed` when `tile.tab` and
    `billPrintedNow(tile.tab)` (`lib/dashboard/live-tables.ts`), else `occupied`; Available → `free` (K7 too);
    Reserved → `reserved`.
  - `floorCounts(tiles: readonly FloorTileModel[]): Record<FloorFilter, number>`; `filterTiles(tiles, filter:
    FloorFilter)` by `floorFilterOf`.
  - `FLOOR_ALL_AREAS = "all"`; `interface FloorAreaTab { key: string; name: string }`;
    `floorAreaTabs(tiles, areas: readonly Area[] | undefined): FloorAreaTab[]`: `[]` unless `groupByArea` over all
    tiles gives two or more groups; else `{ key: FLOOR_ALL_AREAS, name: "All" }` then each group (server order, "Other
    tables" last, key `NO_AREA_KEY`).
  - `effectiveArea(chosen: string, tabs: readonly FloorAreaTab[]): string`: `chosen` when a tab has that key, else
    `FLOOR_ALL_AREAS`.
  - `tilesInArea(tiles, areas, area: string): FloorTileModel[]` (all tiles for `FLOOR_ALL_AREAS`).
  - `floorSections(tiles, areas, filter: FloorFilter, area: string): FloorSections`: grouped from all tiles (headings
    judged before the filters, as today), then the area, then the filter; `summary` = `tableCountText(shown.length)`
    ("1 table", "4 tables"); empty groups dropped.
  - `FLOOR_EMPTY_FILTER_TEXT = "No tables match this filter."`.
- Produces in `lib/floor-layout.ts`: `edgeFades(m: { scrollLeft: number; scrollWidth: number; clientWidth: number }):
  { start: boolean; end: boolean }` (1 px tolerance); `revealScrollLeft(view: { scrollLeft: number; clientWidth: number
  }, item: { offsetLeft: number; offsetWidth: number }, margin: number): number` (the smallest change that shows the item
  whole, `margin` px clear of each edge; unchanged when already visible); `FLOOR_CONTROLS_CLASS` (values §2.2: flex,
  wrap, gap 10, items-center, justify-between); `FLOOR_TABS_TRACK_CLASS` (§2.3: `bg-surface-3`, radius 8, padding 2,
  gap 2, `max-w-full`); `FLOOR_TAB_CLASS` + `_ON` (`bg-seg shadow-seg`) / `_OFF` (transparent, our `hover:bg-hover`);
  `FLOOR_PILLS_ROW_CLASS` (§2.4: gap 6, `max-w-full`); `FLOOR_PILL_CLASS` + `_ON` (`border-ink bg-ink text-on-ink`,
  count `text-on-ink-muted`) / `_OFF` (`border-border bg-card text-ink`, count `text-subtle-foreground`, our
  `hover:bg-hover`); `FLOOR_FADE_*` (24 px, `[background:linear-gradient(...)]` from the row's own background to
  `transparent`: the pills into `var(--background)`, the tabs into `var(--surface-3)` inside the track's 2 px padding).
  Rows scroll sideways with no visible bar (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`). Focus: an inset
  2 px `ring-primary` ring (`focus-visible:ring-inset`), so no padding changes the HTML's 32 / 36 px heights.
- Produces: `useScrollFades(row: RefObject<HTMLElement | null>): { start: boolean; end: boolean }` (scroll listener +
  ResizeObserver, passive); `FloorAreaTabs({ tabs, value, onChange })` (`role="group" aria-label="Filter tables by
  area"`, each tab `aria-pressed`, `data-ui="floor-area-tab"`); `FloorStatusChips({ counts, value, onChange })`
  (`role="group" aria-label="Filter tables by status"` kept, `aria-pressed` kept, `data-ui="floor-pill"`, the 8 px dots
  from `FLOOR_FILTER_DOT: Record<Exclude<FloorFilter, "all">, string>` in `lib/floor-layout.ts` = free `bg-status-ok`,
  occupied `bg-status-info`, billed `bg-status-bill`, reserved `bg-status-reserved`; Task 3's tile tones use the same
  dot classes). Both scroll the chosen button into view with `revealScrollLeft` (the row's `scrollLeft` only, never
  `scrollIntoView`: it would scroll the page) on first paint and on a change.
- Page: `const [area, setArea] = useState(FLOOR_ALL_AREAS)`; `const areaTabs = floorAreaTabs(tiles, areas.data)`;
  `const shownArea = effectiveArea(area, areaTabs)`; pill counts `floorCounts(tilesInArea(tiles, areas.data,
  shownArea))`; `sections = floorSections(tiles, areas.data, filter, shownArea)`; the flat grid branch uses the same
  filtered tiles; the tabs drawn only when `areaTabs.length > 0`; the filtered-empty branch's title is
  `FLOOR_EMPTY_FILTER_TEXT` and "Show all tables" sets the filter to `"all"` and the area to `FLOOR_ALL_AREAS` (its look
  moves in Task 6).

- [ ] **Step 1: tests first.** `floor-tiles.test.ts` (pins moved on purpose: statusCounts → floorCounts, emptyFilterText,
  the section summaries; reason design §6.3 / §6.4): **Review Focus 1** — `floorAreaTabs`: no tabs with one group or
  none, areas not loaded → no tabs, "Other tables" last, an area holding no table gets no tab; `effectiveArea`: a
  removed / emptied area and hidden tabs give `FLOOR_ALL_AREAS`. **Review Focus 2** — for a floor of 3 areas + Other
  tables holding every kind (K1 printed and not, K2, K5, K7, K8), for every area × filter:
  `floorCounts(tilesInArea(…))[f]` equals the number of tiles in `floorSections(…, f, area).groups`; a printed K1 is
  `billed`, not `occupied`; K7 is `free`. `floor-layout.test.ts`: `edgeFades` (at rest: end only; scrolled mid: both; at
  the end: start only; fits: none; 0.5 px rounding); `revealScrollLeft` (hidden right, hidden left, already visible:
  unchanged, the margin respected). Source pins (reason Q4, design §6.3): the pills row has `overflow-x-auto`, the
  group label and `aria-pressed`; the area tabs' group label; no `scrollIntoView(` in the Floor files; P12's literal
  moves to `floorSections(tiles, areas.data, filter, shownArea)`; the page passes `shownArea`, never `area`, to
  `floorSections` and `tilesInArea`. A render test (renderToStaticMarkup of `FloorAreaTabs` with a value no tab has → no
  tab pressed, and of the page's choice through `effectiveArea` → "All" pressed). Run → RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-2.json`: values §2.2–§2.6 (the row box per viewport incl. the two-line rows at 820 / 390,
  the track, each tab's box / font / on look, each pill's box / font / dot / count colour / on look, the pills' and tabs'
  `overflowX` at 390, hover at the two 1280 sizes), §5.1 states (`area-*`, `f-*`, `indoor-res`) with our areas, §5.2's
  words, and the fades (present at 390 at rest, gone at the row's end). Mapped: our area names and counts (data),
  "Other tables", the counts following the area (design §6.3), the fades and the reveal (Q4), the inset focus ring, the
  off tabs' / pills' hover (design §8 #12), the chosen count's colour (#7), the empty state's look (Task 6).
- [ ] **Step 5: commit.**

### Task 3: Sections and tiles: the HTML's anatomy, tones and words

**Files:**
- Create: `apps/cafe/lib/floor-view.ts`, `apps/cafe/lib/floor-view.test.ts` (add to `testChain`)
- Modify: `apps/cafe/lib/floor-tiles.ts` (`FLOOR_GRID_CLASS`, `formatStayMinutes`, `FLOOR_TAP_HINT` replacing
  `FLOOR_PRIMARY_LABEL`), `apps/cafe/components/tables/FloorAreaSections.tsx` (the HTML's head, no divider),
  `apps/cafe/components/tables/FloorTile.tsx` (the anatomy from `floorTileView`), `apps/cafe/lib/floor-layout.ts`
  (tile and section classes)
- Test: `lib/floor-tiles.test.ts` (P16, the stay words, P17), `lib/tables-floor-paths.test.ts` (P6, P8 landmark, P12
  divider, P13)

**Interfaces:**
- Produces in `lib/floor-tiles.ts`: `formatStayMinutes(minutes)`: "—" (null / not finite), "Just now" (< 1), "{m} min"
  (< 60), "{h}h {m}m" (≥ 60, e.g. "1h 0m", "1h 12m"); `FLOOR_TAP_HINT: Record<FloorPrimary, string | null>` = open
  "open the bill", new-order "start a new order", seat-now "seat guests", free "free the table", none null (no tile
  draws an action word any more); `FLOOR_GRID_CLASS` = `grid gap-2.5
  [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]
  max-tab:[grid-template-columns:repeat(auto-fill,minmax(114px,1fr))]`.
- Produces in `lib/floor-view.ts`:
  - `type FloorTone = "free" | "occupied" | "billed" | "reserved"`;
    `FLOOR_TILE_TONES: Record<FloorTone, { tile: string; dot: string; label: string }>` = free `border-border bg-card`
    / `bg-status-ok` / `text-status-ok-ink`; occupied `border-status-info-border bg-status-info-tint` /
    `bg-status-info` / `text-status-info-ink`; billed `border-status-bill-border bg-status-bill-tint` /
    `bg-status-bill` / `text-status-bill-ink`; reserved `border-status-reserved-border bg-status-reserved-tint` /
    `bg-status-reserved` / `text-status-reserved-ink` (values §4.2; the probes prove each resolved rgb).
  - `type FloorDetail = { kind: "money"; amount: string; stay: string } | { kind: "text"; text: string; phoneText?:
    string } | { kind: "skeleton" }`.
  - `interface FloorTileView { tone: FloorTone; label: string; detail: FloorDetail; seats: string; longStay: boolean;
    accessibleName: string }`; `floorTileView(tile: FloorTileModel, tabsFailed: boolean): FloorTileView` by design
    §6.5's table: Occupied + bill → money (`inr(total)`, `formatStayMinutes`), tone `billed` + "Bill printed" when
    `floorFilterOf(tile) === "billed"`; Occupied, no bill → "No open bill" (bills known) / "Bill not loaded" (failed) /
    skeleton (loading); Available + bill (K7) → money, tone free; Available → the charge `"{label} {inr(amount)}"`
    (`tableChargeOf`) or `{ text: "Tap to seat guests", phoneText: "Tap to seat" }`; Reserved →
    `"{formatTime(time)} · {name}"` or "Held"; `seats` = `seatsText(capacity)` (`lib/table-sheet.ts`);
    `accessibleName` = `"{tableNo}, {label}, {detail words}"` + `", long stay"` when long stay + `" — {FLOOR_TAP_HINT}"`
    when the tile has one.
- Produces in `lib/floor-layout.ts`: `FLOOR_TILE_CLASS` (values §4.1: flex column, `justify-between`, gap 8, 1.5 px
  border, radius 14, padding 12, `min-h-[112px] max-tab:min-h-[100px]`, `w-full`, `text-left`, `text-foreground`,
  `leading-[normal]`), `FLOOR_TILE_TOP_CLASS` (flex, `items-start`, `justify-between`, gap 8), name (`min-w-0 truncate
  text-[20px] font-semibold tracking-[-0.01em]`, `title` = the full name), seats (`flex-none whitespace-nowrap
  text-[12px] text-muted-foreground`), bottom block (flex column, gap 2), status line (`flex items-center gap-1.5
  text-[12.5px] font-medium` + the tone's label; the word `whitespace-nowrap`, never truncated), dot (`size-[7px]
  flex-none rounded-full` + the tone's dot), detail (`truncate text-[12.5px] text-muted-foreground`; money = amount + "
  · " + stay; the phone word shown below 720 and the long word from 720), section (flex column, gap 10), section head
  (values §3.1: `items-baseline`, gap 8; name 15 px 600, truncating with `title`; count 12 px `text-muted-foreground`).
- Kept exactly: the tile's Link / button / div choice, `offerOnPlainClick`, the ⋯ as a sibling (its look moves in Task 4).

- [ ] **Step 1: tests first.** `floor-view.test.ts`: one case per row of design §6.5's table (tone, label, detail,
  seats "1 seat" / "4 seats", the accessible name with and without long stay and a tap). `floor-tiles.test.ts` (moved on
  purpose, reason design §6.5): `formatStayMinutes` 0 / 38 / 59 / 60 "1h 0m" / 72 "1h 12m" / 120 "2h 0m" / NaN; P17
  `FLOOR_TAP_HINT.free === "free the table"`; P16 the new grid literal with both minimums. Render tests
  (renderToStaticMarkup of `FloorTile` for K1 printed / not, K2, K3, K4, K5 with and without a charge, K7, K8 with and
  without a booking, K10): the status word, the detail words, the tone classes, no action word, the phone word for K5.
  Source pins (moved on purpose): the tile reads `floorTileView` and `FLOOR_TILE_TONES` (P6, P8 landmark); P13 keeps its
  meaning — the status word has `whitespace-nowrap` and no `truncate`; the section has no divider (P12's
  `border-brand-rule` needle retired, design §6.4). **Review Focus 3:** the name truncates, the seats never wrap. RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-3.json`: values §3.1–§3.2 (sections and heads), §4.1–§4.5 (tile box, padding, border,
  radius, every inner box, fonts, colours per tone with patched data for each kind, the detail's ellipsis), §0.2 grid
  (column count and track per viewport), §4.7 (a 3-digit name at 390 keeps a 100 px tile), plus 360 × 780 and 375 × 812
  viewports for Review Focus 3 (two columns, nothing clipped, `overflowX` 0). Mapped: our names "T-3" (design §6.5),
  our detail words, "Tap to seat" on the phone, the 114 px phone minimum (two columns below 390).
- [ ] **Step 5: commit.**

### Task 4: The tile's right slot, motion and focus; Long stay's words elsewhere

**Files:**
- Modify: `apps/cafe/components/tables/FloorTile.tsx` (the wrapper, the slot, busy, rise, hover, press, focus,
  `aria-label`), `apps/cafe/components/tables/FloorTileMenu.tsx` (the trigger), `apps/cafe/app/(dashboard)/tables/page.tsx`
  (the first-paint rise index), `apps/cafe/lib/floor-layout.ts` (the slot and trigger classes), `apps/cafe/app/globals.css`
  (`--animate-html-rise-floor: brand-rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both` if absent; `brand-rise` must be the
  HTML's `rise`: opacity 0 → 1, `translateY(12px)` → none, U0 values §1.5 — if it is not, a `floor-rise` keyframe that
  is), `apps/cafe/components/settings/BusinessDetailsFields.tsx` (the Long stay hint), `docs/GO-LIVE-CHECKLIST.md` §4
  (the live floor's Long stay line)
- Test: `lib/tables-floor-paths.test.ts` (P11's trigger needle), `lib/html-motion-paths.test.ts` if it lists the
  animation tokens

**Interfaces:**
- The wrapper `div.relative` (the tile's grid item) carries the rise (`motion-safe:animate-html-rise-floor`, delay
  `tileDelay(index)` from `lib/table-sheet.ts`: 20 ms steps capped at 0.3 s, ruling P52) only when the page passes a
  non-null `riseIndex: number | null` — the page gives indexes (per section, after filtering) on the grid's first paint
  only, `null` afterwards and for tiles mounted later (design §6.5: no replay on a tab / pill change); and, on tappable
  tiles, the hover lift `hover:-translate-y-[3px] hover:[box-shadow:0_12px_28px_rgba(0,0,0,0.1)]` with
  `transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]`. The surface presses
  `active:scale-[.98]` and keeps a 2 px `ring-primary` focus ring with a 1 px offset.
- The right slot (design §6.5): the ⋯ trigger (`FloorTileMenu`, still rendered after `{surface}`) = a lucide `Ellipsis`
  16 px glyph, `aria-label="More actions for {tableNo}"`, an absolute button at the tile's right edge with its bottom
  30 px above the tile's foot (= the detail line's top on 112 and 100 px tiles), 44 × 44 under `pointer-coarse:`, 32 ×
  32 under `pointer-fine:`, the glyph aligned to the box's bottom-right so its centre sits on the status line's centre
  and its right edge on the tile's inner edge. The long-stay mark: a 14 px lucide `Clock` in `text-status-bad-ink` at
  the same place inside the surface, `title="Long stay"` with sr-only "Long stay", hidden below 720 px; the stay text
  then `font-semibold text-status-bad-ink`. Busy: a 14 px `Loader2` spinning at the same place — inside the still-mounted
  trigger (disabled, today's; its ⋯ glyph swapped for the spinner, so a keyboard user's focus is not lost) or, on a tile
  with no menu, inside the surface's slot; the surface `opacity-70`, `aria-busy`, not a target (today's). The status line keeps the slot's room (`pr-[22px]`)
  when the tile has a slot, so "Reserved" + ⋯ fit 88 px.
- The surface's `aria-label` = `view.accessibleName`; a busy tile's has no tap hint.
- Long stay words (design §11): the Settings hint → "An occupied table's time turns red, with a Long stay clock, once
  its bill has been open this long. 15 to 600 minutes."; the runbook's live-floor Long stay line says the same.

- [ ] **Step 1: tests first.** Render: a K5 tile has the trigger after the surface with the two size classes and the
  bottom offset; a long-stay K1 has the clock with `title`, the below-720 hiding class and the red stay; a busy K5 has the
  disabled trigger showing the spinner (no ⋯ glyph), `aria-busy`, no `<a` / `<button` surface; the wrapper carries the rise class only with a
  `riseIndex`. Source pins: the trigger is no longer `h-10 w-10` (P11's 40 px needle moves to the 44 / 32 classes,
  reason design §6.5 and the 44 px rule); the page computes rise indexes once (a ref that turns off after the first paint
  with tiles). **Review Focus 4:** the surface is still the only Link / button; the ⋯ never inside it (P11's order needle
  kept); the `offerOnPlainClick` pins unchanged. RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-4.json`: the trigger's box and glyph per viewport (K5 and a patched K8), the clock (≥ 720)
  and the red stay with a patched old bill, hover lift (1280 sizes: box −3 px, the shadow), press (mouse down), the focus
  ring, the first-paint rise (two snapshots), and `elementFromPoint` at the detail line's right end on 360 / 375 / 390
  tiles hitting the surface, not the ⋯ (Review Focus 3). The busy look is proven by the render test (a probe may not
  hold a write). Mapped: the ⋯ and the clock (ours, design §6.5), the 0.3 s cap, the focus ring.
- [ ] **Step 5: commit.**

### Task 5: The header's second line, the refresh strip, the toasts

**Files:**
- Create: `apps/cafe/components/tables/FloorRefreshStrip.tsx` (by `git mv` of `FloorLiveIndicator.tsx`; if `git mv` is
  refused, keep the old file name and change its export)
- Modify: `apps/cafe/lib/floor-tiles.ts` (the summary, freshness and header-line words), `apps/cafe/app/(dashboard)/tables/page.tsx`
  (the description from `floorHeaderLine`, the strip above the scroller), `apps/cafe/components/layout/AppToaster.tsx`
  (`FLOOR_TOASTER_PROPS`), `apps/cafe/lib/floor-layout.ts` (strip classes)
- Test: `lib/floor-tiles.test.ts`, `lib/app-toaster-paths.test.ts`, `lib/tables-floor-paths.test.ts` (`INDICATOR` path)

**Interfaces:**
- Produces in `lib/floor-tiles.ts`: `floorSummaryText(tiles, tabsKnown): string` = `"{o} of {n} occupied · {r}
  reserved"` (o = status Occupied, billed included; r = Reserved; whole floor) + `" · {inr(running)} running"` only
  when `tabsKnown` and the running sum > 0; `updatedLabel(atMs, nowMs)`: "Updated just now" (< 60 s or a future stamp),
  "Updated {m} min ago", "Updated over an hour ago"; `floorHeaderLine(input: { tiles: readonly FloorTileModel[];
  tabsKnown: boolean; updatedAtMs: number; nowMs: number | null }): string` = the summary, then
  `" · " + updatedLabel(updatedAtMs, nowMs ?? updatedAtMs)` when `updatedAtMs > 0`.
- Produces: `FloorRefreshStrip({ show: boolean; onRetry: () => void })`: nothing when `!show`; else `role="status"`
  `data-ui="floor-refresh-strip"`, the U0 strip's band classes exactly (`RequestAlertBar`: `min-h-10`, `py-1`,
  `px-3 tab:px-5`, `border-b border-border`, `bg-status-warn-tint`, 13 px `text-status-warn-ink`, `leading-[normal]`),
  a 14 px warn glyph, "Couldn't refresh the floor. Showing the last update.", and "Try again" as the U0 strip's 30 px
  outline button (its classes) with its hit area grown to 44 px under `pointer-coarse:` by a pseudo-element (the
  strip's height unchanged). `show` = today's `tables.isError || openTabs.isError` while a list is on screen.
- `FLOOR_TOASTER_PROPS` = the staff props with `className` `toaster group
  bottom-[calc(140px+env(safe-area-inset-bottom))]! tab:bottom-[calc(92px+env(safe-area-inset-bottom))]!
  lg:bottom-[calc(24px+env(safe-area-inset-bottom))]!`; the one `<Toaster>` element picks `isPosPath ? POS :
  isFloorPath ? FLOOR : STAFF` (no remount).
- The page's description: "Loading tables…" before the list; then `floorHeaderLine({ tiles, tabsKnown, updatedAtMs,
  nowMs })` (the stamp = today's `min(tables.dataUpdatedAt, openTabs.dataUpdatedAt)` of those > 0).

- [ ] **Step 1: tests first.** `floor-tiles.test.ts` (moved on purpose, reason design §6.2): `floorSummaryText` "3 of 10
  occupied · 1 reserved · ₹1,787 running", no running at ₹0 or with the bills unknown, "0 of 0 occupied · 0 reserved";
  `updatedLabel` at 59 999 / 60 000 ms, 59 / 60 min, a future stamp; `floorHeaderLine` with and without a stamp. Render:
  the strip absent / present, its words, `role="status"`, the button's classes. Source pins: the page renders the strip
  before `data-ui="floor-scroller"` inside `floor-page`; `retryAll` refetches tables and open bills (kept); the toaster
  pin moves on purpose ("/pos only" → "/pos and /tables", every other page keeps the staff set; the three-way choice in
  one element). **Review Focus 5:** the strip shows only when a list is on screen and a query failed (the first-load
  error branch keeps `ErrorState`). RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-5.json`: the header's second line box and font at every viewport (the ellipsis at 390),
  the strip with an aborted open-bills poll (`rewrite` to a refused URL, ≥ 2 polls so the retry fails too): box,
  colours, the button's box (vs U0's request strip), its place under the U0 strip when the seed's requests show, the
  body's first child 20 / 16 px below; a toast's bottom with the CDP safe-area override (the
  `reviews\u1\audit\inset-check.mjs` method). Mapped: the words of design §6.2 / §11, the strip (ours).
- [ ] **Step 5: commit.**

### Task 6: Seat now and Free table in the confirm sheet; loading, error, no tables, filtered empty

**Files:**
- Modify: `apps/cafe/components/tables/FloorDialogs.tsx` (`look="sheet"`), `apps/cafe/app/(dashboard)/tables/page.tsx`
  (skeleton, error, empty states), `apps/cafe/lib/floor-layout.ts` (empty / skeleton classes)
- Test: `lib/confirm-dialog-look.test.ts` (the sheet users list gains `components/tables/FloorDialogs.tsx`),
  `lib/tables-floor-paths.test.ts` (P3, P4 role read, P12 branch order kept)

**Interfaces:**
- `FloorDialogs` passes `look="sheet"` to `ConfirmDialog`; words, `destructive`, `isLoading`, the fade latch and the
  ignored close while confirming stay (the sheet's Escape / Cancel call `onOpenChange(false)`, which the hook ignores
  while confirming — verify the sheet branch keeps that path; if it closes itself, that is a behaviour change: stop and
  tell the controller). Seat now uses the accent, Free table `--bad` (`CONFIRM_SHEET_DESTRUCTIVE_CLASS`), Cancel
  `bg-surface-3`.
- Skeleton: 8 tiles of the new shape (`h-[112px] max-tab:h-[100px] rounded-[14px]`) in `FLOOR_GRID_CLASS`.
- First-load error: today's `ErrorState` and words inside the scroller.
- No tables and filtered empty in the HTML's empty style (values §5.2: centred, 14 px `text-muted-foreground`, padding
  48 0; a title line 14 px 600 `text-foreground` where we have one, as U2's empty states — reuse U2's empty classes from
  `lib/orders-*` if exported, else mirror them in `lib/floor-layout.ts`): admin "No tables yet" / "Add your tables on the
  Setup page to see them here." / "Open Setup" (40 px accent link button), staff "Floor plan not set up" / "Ask an admin
  to add tables on the Setup page."; filtered: "No tables match this filter." + "Show all tables" (40 px outline; both
  resets from Task 2).

- [ ] **Step 1: tests first.** Render: the filtered empty's words and button; the admin / staff empty words; the
  skeleton's eight tiles; source pins: `FloorDialogs` passes `look="sheet"` (the confirm-dialog-look list updated on
  purpose, reason design §6.6); the role read still only in `FloorEmptyState` (P4); the branch order kept (P12). RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-6.json`: the empty line (values §5.2) with a filter that matches nothing (patch), the
  button below it; the confirm sheet (U1 values: 420 px, title, body, 46 px buttons; a bottom sheet below 720 with the
  inset) opened by a K8 tap and a K2 tap and closed with Cancel (never confirmed); the skeleton (`delay` on the tables
  GET with no device copy); the error (`rewrite` both reads to a refused URL). Mapped: our words, Show all tables (ours,
  as U2's Clear filters).
- [ ] **Step 5: commit.**

### Task 7: Whole verification (controller)

- [ ] All `match\floor\probes` files together at the five viewports (+ 360 / 375 for Review Focus 3, + U0
  `all-probes.json` for the shell): no difference except named mapped items; side-by-side shots of every state and size
  for the owner in `D:\kd\pos-dev-keep\ui-redesign\match\floor\final\shots\` (an `index.html` as U2's).
- [ ] Every suite (cafe chain, typecheck, lint; shared; print-tools; release-native), the live legs
  (`verify:tables-floor:live`, `verify:tables:live`, and U2's set: dashboard, print, staff-pin, orders, table-move), the
  hand-off by hand in a browser (a tile into a bill, into a new order, Seat now), a production build in `D:\kd\uib` (take
  the idle BASE count on main's build first; stop :3110 / :3130 after checking their command lines; serve both again),
  every page's first screen (`baseline.mjs` FOLD=1), the local a11y check on /tables with the menu and both confirms open
  (`tools\a11y-check.mjs`), the idle request count on /tables (240 s, `tools\net-count.mjs`, `MSYS_NO_PATHCONV=1`, run
  alone; same kinds and number as main), the S1 pin, the print budget, laptop fit (1366×768, 1280×800, 1100×800,
  1024×768), a classic-scrollbar run at 1280 (6 × 157, the header still), the bottom inset at every width
  (`reviews\u1\audit\inset-check.mjs`), the emulator on WebView 109 and 154 (/tables portrait and landscape, the confirm
  sheet, the scroll fades, the hand-off into /pos), the write paths for real on uimatch through :3130 (Reserve, Free from
  Reserved and from Occupied, Seat now, a tap into a bill and into a new order; then reseed).
- [ ] A fresh Claude Fable 5.1 whole-branch review; one fix wave (its findings + every FIX BEFORE MERGE minor); its
  scoped re-review; the four verifier agents (V-A..V-D, U2's briefs); one reviewed fix round and a smoke on the rebuilt
  build; the plan's Results; memory; the next page's prompt; ask the owner for the merge OK and, separately, the push.

## Results

(filled in at the end)
