# U5: the Menu (/products, /categories, the editors) and the Printer panel rebuilt to the owner's HTML: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /products, /categories, the item and category editors and the header printer panel look exactly like the
owner's HTML Menu screen and Printer panel at 1280, 1280 collapsed, 1024, 820 and 390 px, with every option we have today
kept and placed as the approved design says, and printing byte-identical.

**Architecture:** the HTML's measured values are the spec. The pages keep their queries and writes (`useProducts`,
`useCategories`, `useStations`, every mutation hook and its request); pure libs turn our data into the HTML's words
(`lib/menu-view.ts`) and hold the class strings (`lib/menu-layout.ts`, `lib/menu-list-layout.ts`,
`lib/menu-editor-layout.ts`, `components/print/printer-classes.ts`); the components under `components/menu/`,
`components/products/` and `components/print/` draw them. Both Menu routes fill the screen under the shell header (the
list column / the categories body is the only scroller); the item editor and the printer panel are right-side panels from
1280 px and full-screen bottom sheets below. Each task ends with a measured comparison of the HTML and our dev build
(`compare-ui.mjs`).

**Tech Stack:** Next.js 15.5 (app router), React 19, TanStack Query v5, Tailwind v4 (tokens in
`apps/cafe/app/globals.css`, breakpoints `tab` 720 / `lg` 1024 / `desk` 1100 / `xl` 1280, `max-tab:` below 720,
`pointer-coarse:` / `pointer-fine:`, container queries), the shadcn/Radix kit, next/font (Geist, Geist Mono), `node:test`
+ tsx source-reading and render tests in `apps/cafe/lib/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-31-menu-printer-match-html-design.md` (APPROVED by the owner 2026-11-01: "Han,
approve hai"; "design §N", the owner's Q1–Q9 in design §4) and `docs/superpowers/specs/2026-10-31-menu-printer-html-values.md`
("values §N"). Shell and theme: `docs/superpowers/specs/2026-10-19-u0-html-values.md`. Today's screens, every word and
every test pin: `D:\kd\pos-dev-keep\ui-redesign\inventory\menu-features.md` ("menu inv", pins menu P1–P140) and
`inventory\printer-panel-features.md` ("printer inv", pins printer P1–P167); shots of today's screens `current-menu\`,
`current-printer\`; the HTML's shots `design\spec-shots-menu\`, `design\spec-shots-printer\`.

## Global Constraints

- **The HTML's numbers are the spec.** Every element a task names takes the HTML's size, spacing, font family / size /
  weight / letter-spacing / line-height, colour, radius, border, per breakpoint, exactly (values §1–§21). A visible
  difference that is not a mapped item of design §4–§10 is a defect, never a "minor"; a new one goes to the controller.
- **Menu layout (design §5):** `MENU_PAGE_CLASS` = `POS_PAGE_CLASS` + `flex flex-col overflow-hidden` (as
  `KITCHEN_PAGE_CLASS`); `MenuPageShell` leaves `/products` and `/categories` only. Items body: `240px minmax(0,1fr)` when
  the page box ≥ 1000 px (container query), else one column; the list column is the only scroller, padding `20px 24px
  28px` from 720 px, `16px 14px 92px` below, each bottom plus `env(safe-area-inset-bottom)`; U3's 8 px scrollbar. Table
  from 816 px (`useMediaQuery("(min-width: 816px)")`, one list mounted), the Category column when the list box ≥ 738 px
  (container query), cards below 816.
- **Header (design §6.1, Q5, Q8):** title "Menu" on both routes; second line `"{n} items · {m} categories[ · {k} sold
  out]"` from the active list; the view switch (links, 36 px track, labels hidden below 720) and Add ("Add item" / "Add
  category", "Add" below 720) are the page's actions (admin only); below 720 they stay in the header while the title
  block keeps ≥ 64 px (`phoneTitleMinPx: 64`), else the body row; the shell's "Tables" / "New order" not drawn on these
  routes below 1280 px (the /kitchen rule `hidden xl:inline-flex`).
- **Right-side panels (owner rule 2026-10-22):** the item editor (500 px) and the printer panel (`min(420px,100%)`) are
  side panels only from 1280 px; below 1280 they are full screen and slide up from the bottom (U2's
  `ORDER_DETAIL_SHEET_CLASS` frame); every fixed footer pads `env(safe-area-inset-bottom)`.
- **Touch (ruling R1):** the HTML's sizes where the HTML has the element (36 px header controls, 38 px toolbar controls,
  36 px rail rows, 40×24 switches, 32 px edit / bulk buttons, 28×22 category arrows, 46 px editor buttons, 40 / 36 / 32 px
  printer buttons, 44 px Done); 44 px hit areas for our own controls with no HTML element on touch (the drag grip).
  Hover only where a pointer can hover (R14). Inputs 16 px below 720.
- **Safe area (U1 P49):** the list's foot, the sticky bulk bar, the editor and panel footers, the bottom sheets and the
  toasts respect `env(safe-area-inset-bottom)` at every width.
- **Colours:** U0 tokens only (`bg-card`, `bg-surface-2`, `bg-surface-3`, `border-border`, `border-border-2`, `bg-seg`,
  `shadow-seg`, `bg-ink` / `text-on-ink`, `bg-hover`, `text-muted-foreground` = `--text-2`, `text-subtle-foreground` =
  `--text-3`; the HTML's `--accent` = `primary` (hover `primary-hover`), `--accent-t` = `status-info-tint`, `--accent-i`
  = `status-info-ink`; `status-ok|warn|bad` with `-ink` / `-tint`); the HTML's
  `color-mix(in oklab …)` borders as precomputed `rgba(36,161,72,.3)` / `rgba(255,131,43,.35)` / `rgba(218,30,40,.4)`;
  hues from `categoryHueMap` (`lib/pos-categories.ts`). No `light-dark()`, no runtime `color-mix()`, no `in oklab`
  gradient, no `mask-image`.
- **WebView 109 (U3 VC-1):** every flex `<button>` / link whose children rely on stretch gets `w-full` children or
  `items-stretch` (rail rows, name buttons, switch rows, mode rows, More options, the view switch). `overflow: clip`,
  never `hidden`, for pure clipping. Filtered lists keep a permanent wrapper (U3 VC-3).
- **Selects:** the kit dropdown only (never a native `<select>`, pin `lib/no-native-pickers-paths.test.ts`), its trigger
  in the HTML's 38 px look (`MENU_SELECT_TRIGGER_CLASS`).
- **Words (design §12, Q7):** exactly the listed changes; singular / plural right ("1 item", "1 item marked sold out");
  test-used names keep their text unless §12 changes them; the save toasts stay "Item added" / "Item updated".
- **Behaviour stays (design §6.12, §7.9):** every request and its timing, every body, the optimistic writes and their
  restore, the invalidates, staff powers (stock only), the 500 bulk cap, the deep links (`?status=`, `?category=`), the
  import wizard, the drag arrange and its `?fresh=1` recovery, the delete check. **No new request of any kind.** The
  only client-side behaviour changes are the approved ones: Q1 (default sort = arranged order), the "In stock" filter,
  the select-all, Q9 (base price hidden in Sizes mode; a new sized item sends `price: 0`). Printing: every hook, lib,
  bridge, API and printer call the panel uses is byte-identical; markup and classes only.
- **The paper never changes:** no file of the S1 43-file pin (`lib/printer/kot-text/text-kot-print.test.ts:322`), no slip /
  print file; `print-budget.test.ts` green; `lib/printer/printer-dot.ts` untouched (300/300).
- **Tests:** look pins (L / G) move on purpose with the reason in the commit body; behaviour pins (B) keep their meaning
  and move with the code; budget pins (BUD) never loosen. New test files go into `apps/cafe/package.json` `testChain`
  (one entry per file); every assertion carries a message. TDD (RED seen first). New and touched files ≤ 300 lines
  (the products page 298, `ProductFormSheet` 295, `/categories` page 327, `ImportProductsDialog` 312 split when touched).
  Single files: `node --import tsx --test lib/<name>.test.ts` from `apps/cafe`.
- **Each task ends** with, in `apps/cafe`: `npm test` (the chain), `npm run typecheck`, and lint
  (`NODE_OPTIONS=--max-old-space-size=6144 npx eslint .` if `npm run lint` crashes) green; then the measured match.
- **The measured match (every task):** probes `D:\kd\pos-dev-keep\ui-redesign\match\menu\probes\task-N.json` (printer:
  `match\printer\probes\task-5.json`) made by a `make-task-N.mjs` beside them (U4's pattern
  `match\kitchen\probes\make-task-*.mjs`, the template `match\probes\_template.json`, the header of `tools\compare-ui.mjs`
  for every action and prop). The mock's entry: click `text=Rohan K.`, type `1234`, wait 2800, (collapsed: click
  `button[title='Collapse']`), click `nav button[title='Menu']`; phone: the tab bar's "More", wait 700, the More sheet's
  "Menu"; wait 2300; `mockClock` `2026-10-19T21:30:00+05:30`; mock states as values §0 "What was patched" (`["set", …]`);
  the printer panel by `["set", {pr: {…defaults, open: true}}]` (values §0: the HTML's Menu header has no printer
  button). Ours: `signin`, `guard`, (collapsed: `[data-ui='nav-collapse']`), `goto /products` (or `/categories`); our data
  put into the HTML's states with `rewrite` of `GET /api/bootstrap` / `GET /api/products` (the master path, menu inv
  D3.1: a rewritten state removes the stored copy `pos.masters.v1`, as `tools\menu-current-shots.mjs` does). Run
  `COMPARE_BASE=http://localhost:3120 node D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs
  D:\kd\pos-dev-keep\ui-redesign\e2e\e2e4g-uimatch.env <probes> D:\kd\pos-dev-keep\ui-redesign\match\menu\task-N\run-<k>`
  at **1280×800 and 390×844 at least, and every viewport the task changes** (the full five-viewport run is Task 6's).
  Done = `compare.md` lists no difference, or only rows the task names as mapped (each citing design §N). A task touching
  the header re-runs U0's `match\probes\task-3.json` and `task-4.json`. An HTML bug is never copied: it is a mapped row.
- **Environment:** the dev server on `http://localhost:3120` (scratch DB `pos_scratch_e2e_4g_uimatch`; admin
  `e2eadmin`, the password typed from the env file, never printed; staff `priya`). Never touch :3110 / :3130; never run
  `next build` in the repo; never restart the dev server (ask the controller). Probes are read-only (`guard`): every
  non-GET answered locally or aborted. Never upload a photo (no storage keys exist). Local only: no network, no
  connectors, no push.
- **Commits:** on `feat/ui-menu-printer`, one per green task, `git commit -F <file>` (message written with the Write
  tool in the scratch space), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge.

## Review Focus

1. **Archived view round trip:** Archived → All → Archived with items selected → the header line keeps the active counts
   (never "0 items"), the selection clears on each switch, the rail / filter counts match the list shown, and the only
   requests are today's (`GET /api/products?archived=true` on entering the view). Owned by Task 1 (`menu-view` tests +
   a page wiring pin) and Task 2.
2. **Sizes mode and the hidden base price (Q9):** add an item in Sizes mode → the POST body has `price: 0` and today's
   `variations`; edit an existing sized item → the PUT carries its stored `price` unchanged; a hidden base-price error can
   never block Save; Sizes → Single shows the stored base price. Owned by Task 3 (`product-form-values` tests).
3. **Long words at 360 / 375 / 390 / 430 and 1024** (menu inv §7.1: a 64-character name, a 42-character unbroken name, a
   42-character category, 20 sizes, "₹49–1,00,000" with a discount, three badges) → no sideways page scroll, no name or
   price cut (names wrap, Q2), the switch columns keep 72 px. Owned by Task 2 (probe states at 360 / 375 / 430,
   `scrollWidth = clientWidth`) and Task 4 (category rows).
4. **The phone header with Tokens on and off at 360 / 390 / 430** → the switch and Add sit in the header while the title
   keeps ≥ 64 px and drop to the body row otherwise, never flapping across a resize; staff see no actions. Owned by Task 1
   (`page-header-slot` tests with the floor + a probe at the three widths, both token states).
5. **The printer panel across 1280 while open** (a window resized or a tablet rotated) → it re-frames without losing its
   state or mounting a second panel; the 20 s alarm's "Show" still opens it; Escape and Done close it and focus returns to
   the button; on `/printers` the inline panel has no frame and no Done. Owned by Task 5 (frame tests + probes).

---

### Task 1: The Menu frame, the header, the toolbar, the rail, the states, the default order (both routes' headers)

**Files:**
- Create: `lib/menu-layout.ts` (`MENU_PAGE_CLASS`, `MENU_BODY_CLASS` (grid + container), `MENU_RAIL_*`,
  `MENU_LIST_SCROLLER_CLASS`, `MENU_TOOLBAR_*`, `MENU_SEARCH_*`, `MENU_SELECT_TRIGGER_CLASS`, `MENU_TITLE_ROW_*`,
  `MENU_EMPTY_BOX_*`, `MENU_VIEW_SWITCH_*`, `MENU_ADD_CLASS`, `isMenuPagePath`), `lib/menu-view.ts` (pure words),
  `components/menu/MenuViewSwitch.tsx`, `components/menu/CategoryRail.tsx`, `components/menu/MenuSelect.tsx`
- Modify: `app/(dashboard)/products/page.tsx` (split as it grows: e.g. `components/menu/ItemsPageHeader.tsx`),
  `components/menu/ItemsToolbar.tsx`, `components/menu/ItemsListSection.tsx` (states only), `lib/menu-items.ts`
  ("in-stock"), `lib/products-sort.ts` (Q1), `lib/page-titles.ts`, `components/layout/page-header-slot.tsx` +
  `components/shared/PageHeader.tsx` (the phone floor), `components/layout/HeaderQuickTabs.tsx` (Menu rule),
  `components/layout/AppToaster.tsx` (inset set), `app/(dashboard)/categories/page.tsx` (header only: title, line, switch,
  Add; the frame `MENU_PAGE_CLASS` with one scroller)
- Test: `lib/menu-view.test.ts` (new), `lib/menu-layout.test.ts` (new), `lib/products-sort.test.ts`,
  `lib/menu-items.test.ts`, `lib/page-header-slot.test.ts`, `lib/menu-items-paths.test.ts`,
  `lib/menu-categories-paths.test.ts`, the header-quick-tabs and app-toaster pins

**Interfaces:**
- Produces: `isMenuPagePath(pathname: string): boolean` (`/products`, `/categories` and below);
  `menuHeaderLine(c: { items: number; categories: number; soldOut: number }): string`;
  `menuTitleCount(n: number, filter: MenuStatusFilter): string`; `MENU_FILTER_LABELS: Record<MenuStatusFilter,
  string>`; `MenuSelect` props `{ value: string; onValueChange(v: string): void; options: { value: string; label:
  string }[]; icon?: "folder" | "funnel"; ariaLabel: string; className?: string }`; `CategoryRail` props `{ categories:
  Category[]; counts: Map<string, { items: number; soldOut: number }>; allCount: number; allSoldOut: number; selectedId:
  string | null; onSelect(id: string | null): void }`; `MenuViewSwitch` props `{ current: "items" | "categories" }`;
  `PageHeaderInfo.phoneTitleMinPx?: number`; `MENU_LIST_SCROLLER_CLASS` (Task 2 renders the list inside it);
  `MENU_SELECT_TRIGGER_CLASS` (Tasks 3, 4 reuse it); `MenuStatusFilter` gains `"in-stock"`.

- [ ] **Step 1: Write the failing tests**
  - `menu-view.test.ts`: `menuHeaderLine({items:105,categories:11,soldOut:2})` = `"105 items · 11 categories · 2 sold
    out"`; `soldOut:0` leaves the part out; `items:1,categories:1` = `"1 item · 1 category"`; `menuTitleCount(71,"all")` =
    `"71 items"`, `(1,"out-of-stock")` = `"1 item · sold out"`, `(2,"hidden")` = `"2 items · hidden on qr menu"`,
    `(3,"in-stock")` = `"3 items · in stock"`, `(0,"archived")` = `"0 items · archived"` (values §4.6).
  - `products-sort.test.ts`: the default sort orders by the categories' `order` (Q1: a category with `order` 1 before
    one with `order` 7 whatever the names), name inside a category, an unknown category last; `desc` reverses the
    categories only.
  - `menu-items.test.ts`: `"in-stock"` keeps `available !== false`; `isMenuStatusFilter("in-stock")` true; the status
    counts gain `inStock`.
  - `page-header-slot.test.ts`: `actionsFitBesideTitle({ actionsInHeader: true, titleWidth: 70, actionsWidth: 170,
    minTitle: 64 })` true, `titleWidth: 49` false; the default floor stays 140 (`HEADER_TITLE_MIN_PX`).
  - `menu-layout.test.ts` (source + string pins): `MENU_PAGE_CLASS` contains `POS_PAGE_CLASS`; the scroller's paddings
    `pt-5 px-6 pb-[calc(28px+env(safe-area-inset-bottom))]` from `tab:` and `pt-4 px-3.5 pb-[calc(92px+env(...))]` below;
    the rail track `240px`; `HeaderQuickTabs` hides both links on Menu paths below `xl` (the /kitchen rule);
    `AppToaster` gives Menu paths the /tables set; `pageTitleFor("/products")` = `pageTitleFor("/categories")` = "Menu".
- [ ] **Step 2: Run them; see each fail** (`node --import tsx --test lib/menu-view.test.ts lib/products-sort.test.ts
  lib/menu-items.test.ts lib/page-header-slot.test.ts lib/menu-layout.test.ts` → FAIL: missing exports / wrong order).
- [ ] **Step 3: Implement**
  - Frame (design §5; values §1.2): both pages render `<div className={MENU_PAGE_CLASS}>` (no `MenuPageShell`); Items:
    `MENU_BODY_CLASS` = `@container/menu grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] @[1000px]/menu:grid-cols-[240px_minmax(0,1fr)]`;
    the list column `MENU_LIST_SCROLLER_CLASS` (flex column, gap 12, `overflow-y-auto overflow-x-clip`, the paddings
    above, U3's 8 px scrollbar).
  - Header (design §6.1; values §2): `<PageHeader title="Menu" description={menuHeaderLine(…)} phoneTitleMinPx={64}
    actions={isAdmin && (<><MenuViewSwitch current="items" /><Button …>Add item</Button></>)} />` (the eyebrow goes;
    move pins menu P7 / P62 / P63 on purpose); the line counts the active list (in the Archived view read the active list
    from the query cache with `useQueryClient().getQueryData(PRODUCT_KEYS.all)`; no new query; while unknown, "Loading
    items…"). View switch: two `next/link` with `prefetch={false}`, track `flex h-9 gap-0.5 rounded-[9px] bg-surface-3
    p-[3px]`, links `flex items-center gap-[7px] rounded-[7px] px-3 text-[13px]` on = `bg-seg shadow-seg font-semibold
    text-foreground` / off `font-medium text-muted-foreground`, icons 15 px stroke 1.8 (values §2 paths), label
    `max-tab:hidden`, `aria-current="page"` on the current one. Add: `h-9 rounded-[8px] px-3.5 text-[13.5px] font-semibold
    gap-1.5` accent, hover `accent-h`, the 14 px plus stroke 2.4; label "Add item" / "Add category" from 720, "Add"
    below.
  - Phone floor: `PageHeaderInfo.phoneTitleMinPx`; `actionsFitBesideTitle` takes `minTitle` (default
    `HEADER_TITLE_MIN_PX`); below 720 a page that set it is measured like R6 with its floor (others: unchanged, always
    the body row).
  - `HeaderQuickTabs`: Menu paths take the /kitchen class (`hidden xl:inline-flex`). `AppToaster`: Menu paths join the
    /tables + /kitchen inset set.
  - Toolbar (values §4; design §6.3): the search box (`h-[38px] rounded-[9px] border bg-card px-2.5 gap-2`, the 15 px
    magnifier `text-subtle-foreground`, input 14 px (16 px below 720), placeholder "Search items", the clear ✕ 22 px round
    `bg-surface-3` `title="Clear search"` while the query is non-empty); the category `MenuSelect` (folder icon,
    `flex-[1_1_180px]`, shown at ≥ 720 when the page box < 1000: container query) with "All categories ({n})" then
    "{name} ({n})" in arranged order; the filter `MenuSelect` (funnel, `flex-[0_0_200px]`, phone `flex-[1_1_160px]`):
    "All items ({n})", "In stock ({n})", "Sold out ({n})", "Hidden on QR menu ({n})", then "Archived" (admin) — the
    status control's pins (menu P20, P21, P24) move on purpose with the same meaning (a filter, never tabs); Import CSV
    (admin): outline 38 px "Import CSV" from 720, a 38×38 icon button `aria-label="Import CSV"` below; phone: the 38 px
    Filters button (badge when the filter ≠ All) toggling the wrap, the 38 px Select button (`aria-pressed`, today's
    select mode) and the always-visible chips row (32 px pills, "All {n}", hue dots 7 px, chosen `bg-ink text-on-ink`,
    `flex-none` so it never collapses; values §4.5).
  - Rail (values §3; design §6.2): `CategoryRail` (aside `border-r bg-card px-2.5 py-3 overflow-y-auto`, shown from a
    1000 px page box), rows 36 px fixed (`flex-none`), dot 8 px from `categoryHueMap`, sold-out chip, count; chosen row
    `bg-status-info-tint text-status-info-ink font-semibold`; a pick = today's `setCategoryId` + clear selection.
  - Title row (values §4.6) ≥ 720; states (design §6.8): the skeleton in the list's shape, today's `ErrorState`, the
    shared `RefreshStrip` (only on a failed / paused read with data) in place of the inline "Couldn't refresh" line,
    words "Couldn't refresh the menu. Showing the last update." / "Try again"; the HTML's empty box (values §4.7) for a
    filtered empty ("No items match “{q}”" / "No items here" + "Try another search or filter."), our guided empties in
    the same box.
  - `/categories`: the same header (switch current = "categories", "Add category"), `MENU_PAGE_CLASS`, its body the one
    scroller (Task 4 restyles the rows).
- [ ] **Step 4: Run the tests until green; then the chain, typecheck, lint.**
- [ ] **Step 5: Measured match** at 1280×800, 1280 collapsed, 1024×768, 820×1180, 390×844 (this task changes every
  width) for: default, a picked category (rail / select / chip), each filter, a search with and without results, the
  Archived view, the phone Filters wrap, the empty state; the header at 360 / 390 / 430 with Tokens on and off; U0's
  `match\probes\task-3.json` and `task-4.json`. Mapped rows: no Veg control / Popular (design §9), Import CSV in the
  toolbar (Q5), the printer button in our header (values §15), rail rows 36 px and the chips visible (§10), our dots'
  hues, no section heads.
- [ ] **Step 6: Commit** (moved pins named in the body).

### Task 2: The list: table, cards, badges, switches, toasts, the bulk bar

**Files:**
- Create: `lib/menu-list-layout.ts` (table / head / row / cells / cards / badges / switches / bulk-bar classes),
  `components/menu/ItemBadges.tsx`, `components/menu/MenuSwitch.tsx` (the kit Switch in the HTML's 40×24 look)
- Modify: `components/menu/ItemsTable.tsx` (the HTML's grid list; split head into `ItemsTableHead.tsx` if > 300),
  `components/menu/ItemCards.tsx`, `components/menu/ItemArt.tsx` (a 34 px size), `components/menu/BulkBar.tsx`,
  `components/menu/ItemsBulkSection.tsx`, `components/menu/ItemsListSection.tsx`, `app/(dashboard)/products/page.tsx`
  (select-all, edit wiring), `hooks/use-products.ts` (toast words only), `lib/menu-view.ts` (`menuPriceText`,
  `menuSizesText`, `menuItemBadges`, `bulkToastText`), `lib/menu-items.ts` if a helper moves
- Delete: `components/menu/ItemRowMenu.tsx` (Edit → the pencil; Archive / Restore → the editor, Task 3)
- Test: `lib/menu-view.test.ts`, `lib/menu-list-layout.test.ts` (new), `lib/menu-items-paths.test.ts` (menu P3–P5,
  P8, P9, P11, P12, P19, P74 moved on purpose), the products hook toast pins

**Interfaces:**
- Consumes: `MENU_LIST_SCROLLER_CLASS`, `menuTitleCount` (Task 1); `categoryHueMap`.
- Produces: `menuPriceText(p: Product): { text: string; struck?: string }` (`"₹229"`, `"₹249–449"`, Indian grouping,
  `struck` = today's undiscounted text when discounted); `menuSizesText(p: Product): string` ("Single price", "Small ·
  Large", one size's name) + `" · {m} modifiers"`; `menuItemBadges(p: Product, ctx: { archived: boolean }): ("sold-out" |
  "hidden" | "archived" | "no-kot")[]` (that order); `bulkToastText(result: ProductBulkResult, action): string`;
  `ItemArt` `size: 34` support; `MenuSwitch` props `{ checked: boolean; onCheckedChange(v: boolean): void; tone: "ok" |
  "accent"; disabled?: boolean; "aria-label": string }`. Task 3 opens the editor through today's `onEdit(product)`.

- [ ] **Step 1: Write the failing tests**
  - `menu-view.test.ts`: price `₹229`; sizes 249 / 449 → `"₹249–449"`; equal sizes → `"₹100"`; 1,00,000 grouping →
    `"₹49–1,00,000"`; a 10 % discount gives `struck`; sizes text "Single price" (no variations), "Small · Large",
    "Regular · Medium · Large", with modifiers `"Small · Large · 4 modifiers"`; badges order Sold out → Hidden on QR →
    Archived → No KOT; bulk toasts `"1 item marked sold out"`, `"2 items marked sold out"`, `"3 items back in stock"`,
    moved / archived / restored keep today's counts in the HTML's form.
  - `menu-list-layout.test.ts`: the grid tracks `18px minmax(200px,2fr) minmax(120px,1fr) 110px 72px 72px 32px` with the
    Category track only under `@[738px]/list:`; gap 14; row padding `10px 14px`, head `9px 14px` `bg-surface-2` sticky
    `top-0`; the name `[overflow-wrap:anywhere]` with no `truncate` (Q2); `ItemArt` 34 px radius 8 (Q3); the switch 40×24,
    knob 18 at 3 / 19 px; the bulk bar `bg-ink text-on-ink` sticky at the scroller's foot with the tab-bar offset + inset
    below 720; no `ItemRowMenu` import anywhere.
  - Paths pins: staff see `"Shown"` / `"Hidden"` in the QR column (menu P8's meaning); the card's select-mode tap order
    (menu P9) kept; no `onKeyDown` on cards (P3–P5) kept; the bulk cap words and `overCap` (P11, P12) kept.
- [ ] **Step 2: Run them; see each fail.**
- [ ] **Step 3: Implement**
  - Table (values §5; design §6.4; Q2–Q4): the white list (`rounded-[12px] border bg-card overflow-clip`, a permanent
    wrapper), `@container/list`; sticky head (12.5 px 500 `--text-2`): the select-all box (✓ / – / empty, the 500 cap),
    the sort buttons "Item" / "Category" / "Price" / "Stock" (box icon) with today's keys and `aria-sort`, "QR" (QR icon);
    rows: check 18 (radius 5, `border-[1.5px]`), the Item button (art 34 + gap 10 + name 14 px 600 wrapping + line 2:
    badges then the sizes text 12 px `--text-3`; below the Category track the category first: "Waffles · Single price"),
    Category (7 px dot + 13 px `--text-2`, ellipsis), Price (Geist Mono 13.5 px 600 right + the struck 12 px
    `--text-3` line), Stock / QR `MenuSwitch` (staff: the QR words), Edit pencil 32 px (admin; `title="Edit item"`,
    hover `bg-surface-3`). Selected row `bg-status-info-tint`; archived row `opacity-60`; hover `pointer-fine:hover:bg-hover`.
  - Cards (values §6; design §6.5): rows `px-3.5 py-3 gap-3` inside the same list; select-mode check 18; art 34; the name
    block (14.5 px 600 wrapping; line 2 12.5 px `--text-2`: price Geist Mono 600 `--text` (+ struck) · category · "{n}
    sizes"; badges row gap 5 mt 4); the stock cell ("In stock" / "Sold out" 10.5 px `--text-3` over the switch).
  - Badges (values §7.1): table 20 px / card 19 px, icons 11 / 10 px stroke 2.2; Sold out `bg-status-bad-tint
    text-status-bad-ink`, Hidden on QR `bg-surface-3 text-muted-foreground`, Archived same, No KOT
    `bg-status-warn-tint text-status-warn-ink` (printer icon).
  - Toasts (Q7; `hooks/use-products.ts`, words only, requests unchanged): availability `"{name} marked sold out"` /
    `"{name} is back in stock"`, QR `"{name} hidden from QR menu"` / `"{name} shown on QR menu"`, archive `"{name}
    archived · hidden everywhere"`, restore `"{name} restored"`, bulk `bulkToastText`; the name read from the products
    cache by id (no request); errors unchanged.
  - Bulk bar (values §8; Q6): `rounded-[10px] bg-ink text-on-ink pl-3.5 pr-2.5 py-2 gap-2 flex-wrap`, sticky at the list
    scroller's foot (`sticky bottom-0`, below 720 above the tab bar + inset), "{n} item(s) selected" 13.5 px 600, buttons
    32 px (`border border-white/[.22]`, radius 8, 12.5 px 600, icons 14, hover `bg-white/10`; labels hidden when the
    list < 520 px → icon-only 38×32 with `aria-label`): Mark sold out, Back in stock, Move to category (admin), Archive
    (admin, active), Restore (Archived view), ✕ "Clear selection"; the cap words in the bar; the "More" menu goes.
- [ ] **Step 4: Run the tests until green; then the chain, typecheck, lint.**
- [ ] **Step 5: Measured match** at all five viewports (the list changes everywhere): default, badges (rewritten: sold out
  + hidden + archived + No KOT), a range price, a discount, select one / all / the bulk bar, a stock and a QR switch tap
  (answered locally) + toast, staff; long words at 360 / 375 / 390 / 430 / 1024. Mapped: the art tile (Q3), wrapped names
  and badges on line 2 (Q2), no Category column at 820 (Q4), the sort heads, the struck price, the No KOT badge, the bulk
  bar's place (Q6) and buttons, no Popular / New / veg (design §9).
- [ ] **Step 6: Commit.**

### Task 3: The item editor and its dialogs

**Files:**
- Create: `lib/menu-editor-layout.ts` (frame / head / body / footer / field / ₹ box / sizes rows / switches card /
  dialog box classes), `components/products/ItemEditorFrame.tsx` (side ≥ 1280, bottom sheet below),
  `components/products/PriceModeField.tsx` (Single price / Sizes, Q9), `components/products/ItemSwitchesCard.tsx`
- Modify: `components/products/ProductFormSheet.tsx` (logic stays; split to stay ≤ 300), `VariationsField.tsx`,
  `VariationInput.tsx`, `ModifierInput.tsx`, `ModifiersPreselectedField.tsx`, `PublicVisibleField.tsx`,
  `KitchenTicketField.tsx`, `ProductArtField.tsx`, `IconPicker.tsx`, `ImportProductsDialog.tsx` (frame; split: it is 312),
  `components/menu/MoveItemsDialog.tsx`, `app/(dashboard)/products/page.tsx` (archive / restore from the editor)
- Test: `lib/product-form-values.test.ts` (new or the existing form-shape test), `lib/menu-editor-layout.test.ts` (new),
  the ProductFormSheet / FormSheet pins (menu P14, P51, P53, P59 null sentinels kept)

**Interfaces:**
- Consumes: `MENU_SELECT_TRIGGER_CLASS`, `MenuSwitch` (Tasks 1, 2); U2's bottom-sheet frame
  (`ORDER_DETAIL_SHEET_CLASS` / `lib/nested-dialog.ts` for the confirm over it); `useMediaQuery("(min-width: 1280px)")`.
- Produces: `ItemEditorFrame` props `{ open: boolean; onOpenChange(o: boolean): void; title: string; sub: string;
  footer: ReactNode; children: ReactNode }`; `MENU_DIALOG_BOX_CLASS` (Task 4 reuses it for the category editor);
  `priceForSave(values: { hasVariations: boolean; price: number }, isNew: boolean): number` (Q9: a new item in Sizes mode
  → 0; otherwise the form's price unchanged).

- [ ] **Step 1: Write the failing tests**
  - `product-form-values.test.ts`: a new item in Sizes mode saves `price: 0` with its `variations`; an edited sized item
    keeps its stored `price`; Single mode sends the typed price; a hidden (Sizes-mode) base-price error never blocks the
    submit; switching Sizes → Single shows the stored price; the null sentinels (`icon`, `publicVisible`, `stationId`,
    `noKot`, `variations: values.variations ?? null`) unchanged.
  - `menu-editor-layout.test.ts`: the side aside `w-[500px]` from `xl`, the bottom sheet below; head padding `16px 18px
    14px`, title 18 px 600, sub 13 px; body `px-[18px] pt-4 pb-[22px] gap-5`; footer `px-[18px] pt-3
    pb-[calc(14px+env(safe-area-inset-bottom))]` with Cancel `flex-1 h-[46px]` and Save `flex-[2] h-[46px]`; inputs 42 px
    radius 10 14.5 px (16 px below 720); the ₹ box max-width 220; sizes grid `minmax(0,1fr) 130px 36px` gap 8; "Add size"
    34 px dashed; the switches card radius 12 rows `px-3.5 py-3`; the dialog box 440 px radius 14 padding 20 gap 16.
- [ ] **Step 2: Run them; see each fail.**
- [ ] **Step 3: Implement** (values §9; design §6.9): the frame (scrim z 45 / panel z 46 at ≥ 1280 with `sheetIn .3s`;
  below 1280 the U2 bottom-sheet frame), head "Add item" / "Edit item" + "Add a new item to the menu" / "{name} ·
  {category}", the 34 px round ✕; fixed footer Cancel + Save ("Add to menu" / "Save changes"; today's submit, pending and
  disabled rules); the fields in design §6.9's order and words (Item name; Category; Price + Single price / Sizes with
  Q9; Discount % box; Photo and icon (72 px preview, 36 px outline "Upload image" / "Choose icon"); Modifiers + the
  "Modifiers come ticked" switch row; the switches card In stock / Show on QR menu with the HTML's subs where true for us;
  Kitchen station + Kitchen ticket (KOT); Archive item (opens today's "Archive item?" confirm, nested over the editor) /
  Restore item (edit only)). Today's validation and messages unchanged. The icon picker and the move dialog in
  `MENU_DIALOG_BOX_CLASS` (440, the phone's bottom sheet + inset); the import wizard in the same look at today's width.
- [ ] **Step 4: Run the tests until green; then the chain, typecheck, lint.**
- [ ] **Step 5: Measured match** at 1280×800, 1024×768 and 390×844 (+ 820 for the bottom sheet): Add (empty), Edit a
  single-price item, Edit a sized item (Sizes rows), Save with an empty form (errors; nothing sent), the icon picker, the
  move dialog. Mapped: the bottom sheet below 1280 (owner rule), our extra fields (Discount, Photo and icon, Modifiers,
  Kitchen), no Food type / Popular / PIN note (design §9), today's validation words.
- [ ] **Step 6: Commit.**

### Task 4: /categories: the rows, the category editor, the delete check

**Files:**
- Create: `lib/menu-categories-layout.ts` (row / arrows / dot / meta / chips / buttons / note classes),
  `components/menu/CategoryEditorDialog.tsx`, `components/menu/CategoryDeleteDialog.tsx` (split out of the 327-line page)
- Modify: `app/(dashboard)/categories/page.tsx` (≤ 300 after the split), `components/menu/CategoryRow.tsx`,
  `components/menu/CategoryArrangeList.tsx`, `components/menu/CategoryKitchenTicketField.tsx`, `hooks/use-categories.ts`
  (toast words only), `lib/menu-view.ts` (`categoryMetaText`)
- Test: `lib/menu-view.test.ts`, `lib/menu-categories-paths.test.ts` (menu P27–P30 branch order and the Delete
  conjunction kept; P41, P42 arrows moved on purpose with `aria-disabled` and the labels kept), `lib/category-arrange*`
  tests green unchanged

**Interfaces:**
- Consumes: `MENU_DIALOG_BOX_CLASS`, `MENU_SELECT_TRIGGER_CLASS`, `MenuSwitch`, `categoryHueMap`, `CONFIRM_SHEET_*`.
- Produces: `categoryMetaText(c: { items: number; soldOut: number; archived: number; noKot: boolean; phone: boolean }):
  string`.

- [ ] **Step 1: Write the failing tests**: `categoryMetaText` → `"3 items"`, `"1 item"`, `"5 items · 1 sold out"`,
  `"3 items · 1 archived"`, phone + no KOT `"3 items · No KOT"`; the toasts `"{name} added · add items to it from
  Items"`, `"{name} saved"`, `"{name} deleted"` (errors unchanged); the row classes (padding `10px 12px 10px 10px`, gap
  12, arrows 28×22 stacked gap 2, dot 10 px, name 14.5 px 600, meta 12.5 px `--text-3` ellipsis, station chip 26 px
  ≥ 720, No KOT chip `bg-status-warn-tint text-status-warn-ink` ≥ 720, edit / delete 34 px, delete `text-subtle-foreground`
  with `title="Move or archive its items first"` while it holds items); the grip `touch-none` only on the handle button
  with a 44 px hit area on `pointer-coarse`.
- [ ] **Step 2: Run them; see each fail.**
- [ ] **Step 3: Implement** (values §10–§11; design §6.10–§6.11): the body note (our sentence) and the white card with
  one group; each row: grip, arrows, hue dot, the name block as a link to `/products?category={id}` (today's count-link
  destination), the meta, the station chip (the stations list the page already loads; absent = the default station's
  name), the No KOT chip, Edit (`title="Edit category"`), Delete (today's check dialog in the confirm-sheet look, its four
  branches and "View them" kept). The category editor in `MENU_DIALOG_BOX_CLASS`: "Add category" / "Edit category" +
  "Categories group items in New Order and the QR menu.", Name 42 px, Kitchen station + "Where this category’s KOTs
  print.", the KOT card (today's switch and words where the HTML's sub is not true), Save 46 px ("Add category" / "Save
  changes"). Requests, the optimistic arrange and the `?fresh=1` recovery unchanged.
- [ ] **Step 4: Run the tests until green; then the chain, typecheck, lint.**
- [ ] **Step 5: Measured match** at all five viewports: the list, a category with No KOT / archived / sold out
  (rewritten), Add, Edit, a name error, the delete check (counts loading, with items, empty), long names at 360 / 430.
  Mapped: no section heads / Colour group (design §9), our grip and note, our delete check, the station names.
- [ ] **Step 6: Commit.**

### Task 5: The printer panel (look only)

**Files:**
- Create: `components/print/PrinterPanelFrame.tsx` (side ≥ 1280 / bottom sheet below; head, scroll body, fixed Done
  footer), `components/print/PanelSection.tsx` (the HTML's section card for the panel; `PrinterSection` stays for
  `/printers`' setup sections)
- Modify: `components/print/printer-classes.ts` (the HTML's button / input / select / row / segmented / switch / status
  classes; the 44 px constants stay for the setup sections), `PrinterStatusButton.tsx` (the frame only; the button
  itself unchanged), `PrinterPanel.tsx`, `PrinterStatusBanner.tsx`, `WaitingSlipsCard.tsx`, `PrinterSetupCard.tsx`,
  `PrintWhereSection.tsx`, `PrinterAdvanced.tsx`, `DevicePrinterSection.tsx`, `BrowserPrinterConnect.tsx`,
  `NativePrinterPicker.tsx`, `DesktopPrinterPicker.tsx`, `DesktopPrintMethod.tsx`, `FindNetworkPrinters.tsx`,
  `OtherDevicePrinters.tsx`, `PaperSizeToggle.tsx`, `TextKotSection.tsx`, `PrinterTestSlip.tsx`, `PrinterTestTips.tsx`,
  `PrintHostCardParts.tsx`, `BillPrinterSection.tsx` — classes and markup only
- Test: `lib/printer-dot-ui-paths.test.ts`, `lib/printer-ui-paths.test.ts` (printer P8, P19, P39, P40 moved on purpose;
  every B pin kept: P3–P6, P13–P15, P24–P26, P43, P45, P47, P56, P69, P79, P84, P95, P118), `lib/printer-panel-layout.test.ts`
  (new)

**Interfaces:**
- Consumes: U2's bottom-sheet frame; `useMediaQuery("(min-width: 1280px)")`.
- Produces: `PrinterPanelFrame` props `{ open: boolean; onOpenChange(o: boolean): void; children: ReactNode }` (title
  "Printer", sub "Printer status and setup for this device", Done = close); `PanelSection` props `{ icon: ReactNode;
  title: string; sub?: string; id?: string; children: ReactNode }` (keeps `id="printer-where"` /
  `data-printer-target="device"` where the caller passes them).

- [ ] **Step 1: Write the failing tests** (`printer-panel-layout.test.ts` + moved pins): the frame `w-[420px]` side panel
  from `xl` with the HTML's `lineIn .3s` (the existing `html-line-in` keyframes at .3s), the bottom sheet below; head padding `18px 20px 14px`,
  "Printer" 17 px 600, sub 12.5 px `--text-2` with no full stop; ✕ 34 px radius 8 hover `bg-hover`; body `px-5 py-4
  gap-3` `bg-background` (`--bg`); footer `px-5 pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))]` with Done `h-11
  w-full rounded-[10px] text-[14.5px] font-semibold`; the section card `rounded-[12px] border bg-card overflow-clip`, head
  `px-4 py-3.5 gap-3` with the 34 px tile radius 9 `bg-surface-3 text-muted-foreground`, title 14 px 600, sub 12.5 px
  `--text-3`, body `px-4 pb-4 gap-3`; the status card ok / bad / checking classes (design §7.3, the precomputed rgba
  borders, the bad "!" in `text-foreground`); buttons: primary 40 px radius 9 14 px 600, secondary 36 px radius 8 13.5 px
  500, the card's fix button 32 px 12.5 px, Remove `text-status-bad-ink` with the bad rgba border; the panel files still
  hold no `h-8|h-9|h-10` / `size="sm"` token (the sizes come from `printer-classes.ts`); `usePosPulseContext(` still
  called once in `PrinterPanel.tsx`; no `useReactToPrint` / `pageStyle` in panel files; the panel order Waiting < Banner
  < Setup < Bill kept; `/printers` renders `<PrinterPanel />` with no frame and no Done.
- [ ] **Step 2: Run them; see each fail.**
- [ ] **Step 3: Implement** (values §15–§21; design §7): the frame (Radix Dialog as U2's detail sheet; the alarm's
  `onOpenPrinterPanel` still opens it; Escape / ✕ / Done / a scrim tap close it; focus returns to the button); the
  status card; the waiting card (design §7.5); every section in `PanelSection`; the controls by design §7.4 (Connect
  printer / Find printers / Use this network printer / Print all slips on this device = primary 40; the rest secondary
  36; Remove looks; the steps with 20 px circles; the connected row with the pulsing dot; Paper width segmented 32 px;
  the Windows print-method radios as the HTML's mode rows; the 38×22 switch rows; selects 38 px; inputs 42 px; More
  options collapsible with the chevron turning 180°); words per design §7.7 ("Paper width"; the Remove note's " — even a
  phone."; the sub's full stop) and nothing else. No hook, lib, bridge, request or printer call changes (diff the
  non-markup lines: none).
- [ ] **Step 4: Run the tests until green; then the chain, typecheck, lint; `npm test` in `packages/shared`
  (print-budget) green; the S1 pin green.**
- [ ] **Step 5: Measured match** at all five viewports with the HTML's panel (`["set", {pr: …}]`: default, This device
  not connected, connected, More options open) against ours on `/products`: the browser lane as found, the Android lane
  (fake `window.PosNative`: none / connected / failed) and the Windows lane (fake `window.posDesktop`), waiting slips,
  printers mode (`tools\printer-current-shots.mjs`'s fakes); `/printers` at 1280 and 390. Mapped: our banner words and
  states (design §7.3), our sections and controls with no counterpart (§7.2, §7.5), the left-out HTML parts (§7.8), the
  bottom sheet below 1280 (owner rule).
- [ ] **Step 6: Commit.**

### Task 6: Whole verification (controller)

- [ ] The full five-viewport run of every probe of Tasks 1–5 (`match\menu\final\`, `match\printer\final\`) with the
  side-by-side shots index; every row mapped.
- [ ] A fresh Claude Fable 5.1 whole-branch review (prepared review worktree, `link-modules.ps1 -Copy` from PowerShell,
  junctions removed with `[System.IO.Directory]::Delete` before `git worktree remove`), ONE fix wave, its scoped
  re-review (sonnet; Fable only if the wave changed logic).
- [ ] Two verifiers in parallel from brief files: V-1 desktop on :3130 (the rebuilt `D:\kd\uib`): the suites + live legs
  + the paper (S1 43/43, print-budget) + every probe at five viewports + a11y (`tools\a11y-check.mjs`, open dialogs
  included) + /m + laptop fit + the bottom inset (`reviews\u1\audit\inset-check.mjs`) + the write paths for real on
  uimatch (product create / edit / stock / QR / archive / restore / bulk / move; category create / edit / arrange / delete
  round trips: every request equal to main's; the printer panel opened and closed, nothing saved), then reseed uimatch;
  V-2 the emulator: WebView 109 in full (109's button rule sweep; the a11y tree after filter round trips) + on 154 the
  first screens and the bottom inset. The idle request count BASE (main's build) and NEW (this build), each alone
  (`tools\net-count.mjs`, `MSYS_NO_PATHCONV=1`): the controller's.
- [ ] Findings: one check each, ONE reviewed fix round, then a desktop smoke on the rebuilt build.
- [ ] The Results section below; memory; the next page's prompt (U6 = Reservations); drop this session's own
  `pos_scratch_va_u5_*` DBs; ask the owner for the merge OK and, separately, the push.

## Results

(filled at the end of the session)
