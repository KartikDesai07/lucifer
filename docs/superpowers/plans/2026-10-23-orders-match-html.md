# U2: the Orders page (/orders) rebuilt to the owner's HTML: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /orders and its order detail (also opened by the dashboard) look exactly like the owner's HTML Orders screen at
1280, 1280 collapsed, 1024, 820 and 390 px, with every option /orders has today kept and placed as the design says.

**Architecture:** the HTML's measured values are the spec. The page keeps its one list query (`useOrdersInfinite`, the
same endpoint and filters), its detail component (`OrderDetailSheet`, whose print / settle / move logic and pins stay in
that file) and its cancel flow; small pure helpers in `lib/orders-*.ts` turn our data into the HTML's words (lanes, rows,
detail), new presentational components draw them, and the detail gets three frames (the 400 px column on /orders from
1280 px, a 400 px side sheet on the dashboard from 1280 px, full screen from the bottom below 1280 px). Each task ends
with a measured comparison of the HTML and our dev build (`compare-ui.mjs`).

**Tech Stack:** Next.js 15.5 (app router), React 19, Tailwind v4 (tokens in `apps/cafe/app/globals.css`, breakpoints
`tab` 720 / `lg` 1024 / `desk` 1100 / `xl` 1280, the `wide` variant, container queries `@container` / `@min-[700px]:`),
the shadcn/Radix kit, next/font (Geist, Geist Mono), `node:test` + tsx source-reading tests in `apps/cafe/lib/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-23-orders-match-html-design.md` (decisions Q1–Q11 and the mapping; "design §N")
and `docs/superpowers/specs/2026-10-22-orders-html-values.md` (the exact values; "values §N"). Shell and theme:
`docs/superpowers/specs/2026-10-19-u0-html-values.md` ("U0 values §N"); U1's sheets:
`docs/superpowers/specs/2026-10-20-pos-html-values.md` ("U1 values §N"). What /orders has today, every word and every
test pin (P1–P75): `D:\kd\pos-dev-keep\ui-redesign\inventory\orders-features.md` ("inventory §N"); shots of today's
page: `D:\kd\pos-dev-keep\ui-redesign\current-orders\`; the HTML's shots: `design\spec-shots-orders\`.

## Global Constraints

- **The HTML's numbers are the spec.** Every element in a task's values sections takes the HTML's size, spacing, font
  family/size/weight/letter-spacing/line-height, colour, radius, border and shadow, per breakpoint, exactly. A visible
  difference that is not a mapped item of design §4–§6 is a defect, never a "minor"; a new one is shown to the
  controller (who asks the owner), never parked.
- **Layout (design §5):** the page fills the screen under the shell header like /pos (it reuses `POS_PAGE_CLASS` from
  `lib/pos-layout.ts`: `<main>`'s padding bled, height `100dvh − 56px − var(--pos-alert-h)` with the 100vh fallback; the
  alert strip publishes `--pos-alert-h` on every page). Body grid `minmax(0,1fr) 400px` from 1280 px on /orders, one
  column below. The list's form follows the list column's own width by container query (values §0.2): table ≥ 700 px,
  Items column ≥ 900 px, lane cards ≥ 560 px (else the phone strip). Below 1280 px the detail is never a column or a side
  sheet (owner rule 2026-10-22).
- **Touch (ruling R1):** the HTML's sizes on touch screens too; 44 px only for our own controls the HTML has no element
  for. Inputs 16 px below 720 px (ruling R36). `leading-normal` where the HTML sets none, in the rebuilt parts.
- **Safe area (U1 P49):** everything at the window's foot adds `env(safe-area-inset-bottom)` at every width (the list
  scroller's foot room, the detail's foot, the bottom sheet's foot).
- **Colours:** the U0 tokens (U0 values §1.1) and `lib/ui` (`STATUS_CLASSES`, `PAY_PILL_KIND`); no `light-dark()`, no
  runtime `color-mix()` (WebView 109; precomputed hex); no raw palette classes (`amber-100` etc.) in the rebuilt files;
  kit files (`components/ui/*`) and anything `/m` reaches keep only preset-set tokens (`lib/kit-look-paths.test.ts`).
- **Words (design §4, §11):** the HTML's words where the HTML has the same element; our words for our own features and
  data; singular / plural right ("1 item", "1 order", "1 match"). Section 11 of the design lists every visible word that
  changes; nothing else changes its words.
- **Behaviour stays (design §6.12):** every request and its timing, Load more, the 30 s first-page refresh, focus refetch,
  realtime, the trim on leave, the phone search's 350 ms wait, every print path and guard, the settle latch and notices,
  the move flow, the cancel request (admin only), every validation and message. **No new request of any kind:** the same
  `GET /api/orders` with the filters it takes today (`status`, `payment`, `tableNo`, `date`, `phone`, `limit`,
  `before`). The only behaviour changes are the owner's: lanes and the first view (Q1–Q3, Q10), the phone-only search
  across lanes (Q4), the date box opening on Today (Q5), Edit items (Q7), the detail frames and the first-row choice
  (Q8, design §6.6), the Due words (Q9), the "Bill printed" rule (Q11), the cancel moving into the detail (design §6.9).
- **The paper never changes:** no file of the S1 43-file pin (`lib/printer/kot-text/text-kot-print.test.ts:323`), not
  `OrderReceipt`, `KOTReceipt`, `TokenSlip`, `components/print/slip/*`, `lib/print-routing.ts`; `print-budget.test.ts`
  green; the off-screen print sources stay mounted in `OrderDetailSheet.tsx`.
- **Line budgets (never loosened):** `PaymentModal.tsx` ≤ 300, `use-host-routing.ts` ≤ 300, `desktop-shell.ts` ≤ 150,
  `RequestAlertBar.tsx` ≤ 150; new files ≤ 300 lines each (house style); `app/(dashboard)/orders/page.tsx` ≤ 300.
- **Tests:** a test that pins a class string, a word or a structure this work changes is changed in the same commit, with
  the reason in the commit body (inventory §4 labels each pin: L and G pins move with the look; B pins keep their meaning
  — if code moves, the pin moves with the same meaning; BUD pins never loosen). The format-sensitive print pins on
  `OrderDetailSheet.tsx` (P24–P39, P41, P42, P47–P50) keep passing unchanged unless a task says otherwise. New test files
  go into `apps/cafe/package.json` `testChain`; every assertion carries a message. TDD for behaviour and structure (RED
  seen first). Each task ends with the cafe chain (`npm run test:chain` in apps/cafe), typecheck and lint green.
- **The measured match (every task):** probes in `D:\kd\pos-dev-keep\ui-redesign\match\orders\probes\task-N.json`
  (template `match\probes\_template.json`; the mock's entry to Orders: after sign-in click `nav button[title='Orders']`,
  on the phone the tab bar's button with text exactly "Orders"; `mockClock` `2026-10-19T21:30:00+05:30`; ours:
  `signin`, `guard`, `goto /orders`). Cover every element of the task's values sections (props the HTML fixes; not widths
  that depend on text or data); add `data-ui="…"` in our markup where a text locator is not stable. Our data is put in
  the HTML's states with the local `patch` / `rewrite` actions (e.g. an open tab with a printed bill:
  `billFirstPrintedAt` + `billFirstPrintedTotal = total` in the list response; a due bill; a cancelled order). Run
  `COMPARE_BASE=http://localhost:3120 node D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs
  D:\kd\pos-dev-keep\ui-redesign\e2e\e2e4g-uimatch.env <probes> D:\kd\pos-dev-keep\ui-redesign\match\orders\task-N\run-<k>`
  at the five viewports. Done = `compare.md` lists no difference, or only rows the task names as mapped. A task that
  touches the header, nav or tab bar also re-runs U0's `match\probes\task-3.json` and `task-4.json`.
- **Environment:** the dev server on `http://localhost:3120` (scratch DB `pos_scratch_e2e_4g_uimatch`, admin `e2eadmin`,
  the password from the env file, typed, never printed). Never touch :3110 (the owner's preview); never run `next build`
  in the repo; never restart the dev server (ask the controller). Read-only on data in probes and shots (the `guard`
  action: every non-GET aborted, the print lease answered locally): never press Settle, Cancel order, Move, Add
  customer or anything that prints. Local only: no network, no connectors, no push.
- **Commits:** on `feat/ui-orders`, one per green task, `git commit -F <file>` (message files written with the Write tool
  in the scratch space), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge.

## Review Focus

1. **The query never grows:** for every lane × date × payment × table × phone combination `ordersQuery` returns only
   today's filter keys; Open never sends `date`; a typed phone never sends `status`; Paid and Due give the same filters
   (one shared query, so switching between them is a cache hit like any filter switch today); the idle request count on
   /orders over 240 s equals main's. Owned by Task 2 (unit tests over the combinations) and Task 8 (the count).
2. **One detail at a time across the 1280 px boundary:** a chosen order stays chosen when the window crosses 1280 px; at
   no width are two detail frames (two settle flows, two sets of print sources, two payment sheets) mounted; while the
   payment sheet is open the auto-picked first row never replaces the order being paid. Owned by Task 5 (pins + a render
   test of the frame choice; the auto-pick fills only an empty choice).
3. **Sparse Paid / Due pages:** with 50 settled orders loaded, none of them due, and more to load, the Due lane shows "No
   due bills in the latest 50 settled orders" / "Load more to check older ones." with Load more, its card reads "0+";
   the same for Paid; Load more stays one request per tap. Owned by Tasks 2 and 4 (unit tests).
4. **The dashboard's detail behaves as before:** opened from Live tables and Recent orders it settles, moves and prints
   exactly as today, shows no "Cancel this order" (the dashboard provides no cancel), and a press inside the payment /
   move / customer sheet never closes it (ruling P38). Owned by Tasks 5 and 7 (pins on the dashboard's props and the
   nested-dialog rule).
5. **Long and large values at 390 px:** a 40-character customer name, a 12-line order, a ₹1,00,000 total and a table
   name like "Rooftop-12" never push anything sideways (no page scroll at 390 px; names cut with an ellipsis, totals
   whole). Owned by Task 4 (rows) and Task 6 (detail), each with a probe state using `patch`.

---

### Task 1: The /orders frame and its header

**Files:**
- Create: `apps/cafe/lib/orders-layout.ts` (the frame's class constants and `isOrdersPath`)
- Modify: `apps/cafe/app/(dashboard)/orders/page.tsx` (the frame: no `MenuPageShell`, no "Today" header action; the
  body grid with the list column and the detail column slot at ≥ 1280 px; the current filters and table stay inside the
  list column until Tasks 2–4 replace them), `apps/cafe/components/layout/Header.tsx` (`data-orders`: gap 12 px),
  `apps/cafe/components/layout/HeaderQuickTabs.tsx` (on /orders the New order label shows on the phone too)
- Test: `lib/polish-pages-paths.test.ts` (PIN D1 for orders: the frame; PIN D2/D4 needles that read the page's return),
  `lib/header-quick-tabs.test.ts`, `lib/page-header-slot.test.ts` (the Orders fixture is a fixture; only if a pinned
  page string moves); new `lib/orders-layout.test.ts`

**Interfaces:**
- Produces: `isOrdersPath(pathname: string): boolean` (`/orders` and `/orders/…`, not `/orders-x`);
  `ORDERS_PAGE_CLASS` (= `POS_PAGE_CLASS` + `flex flex-col overflow-hidden`), `ORDERS_BODY_CLASS` (grid, one column;
  `xl:grid-cols-[minmax(0,1fr)_400px]`), `ORDERS_LIST_COLUMN_CLASS` (`@container` + flex column, min-w-0, min-h-0),
  `ORDERS_TOP_CLASS` (values §2.2 top block: padding 14 20 12 / phone 10 12 12, gap 12), `ORDERS_SCROLLER_CLASS`
  (values §2.2: overflow-y auto, padding 0 20 28 / phone 0 12 92, plus the bottom inset); `data-ui` names
  `orders-page`, `orders-body`, `orders-list`, `orders-top`, `orders-scroller`, `orders-detail-column`.
- Rules: values §1 (header: on /orders `gap:12px`, the title and our description, New order 36 px with its label at
  every width, the printer), §2, §21.1 regions. The header keeps Tables / Refresh / Tokens (design §6.1). The page's
  `PageHeader` keeps `eyebrow="Service"`, `title="Orders"`, `description="View, filter and manage orders."`, no actions.

- [ ] **Step 1: tests first.** `orders-layout.test.ts`: `isOrdersPath` cases; the body grid literal holds
  `xl:grid-cols-[minmax(0,1fr)_400px]`; `ORDERS_PAGE_CLASS` contains `POS_PAGE_CLASS`. Paths: page.tsx has no
  `MenuPageShell` and no `actions=` on its `PageHeader`; Header has `data-orders` with the 12 px gap; HeaderQuickTabs
  shows the label on /orders (reason: design §5, §6.1). RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons (P1, P63-mutation needles for orders, P6 if `BRAND_*` classes leave the page);
  chain, typecheck, lint.
- [ ] **Step 4: probes** `task-1.json`: values §1.3 (header, title, subtitle box, New order, printer; mini logo on the
  phone) and §21.1 regions (page, header, body grid, list column) at the five viewports; re-run U0 `task-3.json`,
  `task-4.json`. Mapped: the subtitle's words (design §6.1), Tables / Refresh / Tokens (ours), no detail column below
  1280 (owner rule), the detail column's contents (Task 5).
- [ ] **Step 5: commit.**

### Task 2: Lanes, the lane query and the lane numbers

**Files:**
- Create: `apps/cafe/lib/orders-lanes.ts`, `apps/cafe/components/orders/OrdersLanes.tsx` (cards + phone strip)
- Modify: `apps/cafe/app/(dashboard)/orders/page.tsx` (state: lane, date, payment, table, phone; URL seeding through
  `seedFromUrl`; the query from `ordersQuery`; the shown rows from `laneRows`; the status select goes)
- Test: `lib/order-list-query.test.ts` (P8, P9 keep), `lib/polish-pages-paths.test.ts` (filter pins that name the status
  select), `lib/realtime-live-state.test.ts` (P10 keeps); new `lib/orders-lanes.test.ts`

**Interfaces:**
- Produces:
  - `type OrdersLane = "all" | "open" | "paid" | "due" | "cancelled"`; `ORDERS_LANES: readonly { key: OrdersLane;
    label: "All" | "Open" | "Paid" | "Due" | "Cancelled"; dot: string }[]` (dots `bg-subtle-foreground`, `--info`,
    `--ok`, `--bill`, `--bad` as `STATUS_CLASSES[kind].dot`).
  - `type OrdersDate = { kind: "today" } | { kind: "yesterday" } | { kind: "all" } | { kind: "day"; date: string }`.
  - `interface OrdersFilterState { lane: OrdersLane; date: OrdersDate; payment: SettlementPayMode | null; tableNo:
    string | null; phone: string }` and `DEFAULT_ORDERS_FILTERS` (lane `open`, date today, rest empty).
  - `ordersQuery(s: OrdersFilterState, now: Date): OrderFilters` — phone non-empty → no `status`, date / payment / table
    apply; else `all` → no status; `open` → `status: "Pending"`, **no date**; `paid` / `due` → `status: "Completed"`;
    `cancelled` → `status: "Cancelled"`; date today → `cafeDateString(now)`, yesterday → `cafeDateString(now − 24 h)`,
    all → none, day → its date. Never any other key.
  - `orderDue(o: Order): number` (`Completed` → `max(0, total − paidAmount)`, else 0).
  - `laneRows(lane: OrdersLane, rows: Order[], searching: boolean): Order[]` — searching → rows as given; `paid` → due
    0; `due` → due > 0; `open` → printed bills first (`billPrintedNow`), then oldest `createdAt`; else as given.
  - `laneSummary(lane, rows: Order[], more: boolean, date: OrdersDate, now: Date): { count: string; amount: string;
    line: string; tone: "warn" | "bill" | "plain" }` — count `"{n}"` or `"{n}+"` when `more`; amount `inr(Σ total)` (Due:
    Σ due) with "+" when `more`; lines per design §6.2 (Open "1 bill waiting to be paid" / "2 bills waiting to be paid" /
    "{n} open 30+ min" (`warn`) / "All in service"; Paid "Avg ₹x per bill" / "No payments {when}"; Due "Unpaid at
    billing" (`bill`) / "Nothing to collect"; Cancelled "Not charged" / "None {when}"; All "{n} orders" / "No orders
    {when}"); `{when}` = "today" / "yesterday" / "on 22 Oct" / "yet".
  - `LANE_IDLE_LINES: Record<OrdersLane, string>` = All "Every order", Open "Tabs at the tables now", Paid "Settled
    bills", Due "Money still owed", Cancelled "Not charged".
  - `seedFromUrl(search: string): Partial<OrdersFilterState>` — `status=Pending` or `payment=Unpaid` → lane open;
    `status=Cancelled` → cancelled; `status=Completed` → paid; another known `payment` → that payment; `date=YYYY-MM-DD`
    → day; a seed with a status or payment and no date → date all; a date with no status → lane all.
- Rules: values §3 with five lanes (cards `repeat(5,minmax(0,1fr))` gap 8, 92 px; the chosen card's 2 px `--text`
  outline; the number row's height kept empty on the others; the strip's five tabs, the chosen one with its count, the
  others the dot alone; the current-lane row's amount, line and, on Open with a printed bill, "Settle {code}" which
  chooses that order (Task 5 wires the choice; here it calls an `onChoose(order)` prop)). Tapping a lane clears the
  phone search and the choice. While a phone is typed no lane is lit.

- [ ] **Step 1: tests first.** `orders-lanes.test.ts`: `ordersQuery` over every lane × the four dates × payment ×
  table × phone (exact objects; Open has no `date`; phone has no `status`; Paid and Due equal); `orderDue`; `laneRows`
  (paid / due split, open sort with two printed bills and three not, searching passes through); `laneSummary` for each
  lane with 0 / 1 / 2 rows, `more` ("50+", "0+"), each `{when}`; `seedFromUrl` for the dashboard links
  (`?payment=Unpaid&status=Pending`, `?status=Cancelled`, `?date=2026-10-18`, `?payment=Cash`); paths: the page has no
  "Filter by status" select (reason: owner Q2). RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-2.json`: values §3.2 cards (d1280, c1280, t820; ours also t1024 where our list is 908
  wide) and §3.3 strip (p390; t1024 is mapped: our list there is wider than the HTML's), the chosen card, a hovered card
  (`--text-3` border), Paid chosen. Mapped: five lanes (Q2), the idle cards' lines and empty number rows (Q1), card
  widths, t1024 cards instead of the strip (owner rule).
- [ ] **Step 5: commit.**

### Task 3: Toolbar: phone search, date box, Filters panel, chips

**Files:**
- Create: `apps/cafe/components/orders/OrdersToolbar.tsx` (search, date box, Filters button),
  `apps/cafe/components/orders/OrdersDateBox.tsx` (the dropdown + "Pick a day…" calendar),
  `apps/cafe/components/orders/OrdersFiltersPanel.tsx` (the panel and the chips row)
- Modify: `apps/cafe/lib/orders-lanes.ts` (chips), `apps/cafe/app/(dashboard)/orders/page.tsx` (the old search, filter
  selects, "Filters" / "{n} active" / "Clear all" row and `DatePicker` go), `apps/cafe/components/orders/OrderFilterSelect.tsx`
  (removed if unused, its pins moved)
- Test: `lib/date-input.test.ts` (P11: the DatePicker import moves to the date box or the calendar is the kit's — move
  the pin on purpose), `lib/no-native-pickers-paths.test.ts` (P13 keeps), `lib/polish-pages-paths.test.ts`
  (P6/P20 `BRAND_CONTROL_CLASS` files), extend `lib/orders-lanes.test.ts`

**Interfaces:**
- Consumes: Task 2's `OrdersFilterState`, `OrdersDate`.
- Produces: `filterChips(s: OrdersFilterState, phone: boolean): { key: "payment" | "table" | "date"; label: string }[]`
  (payment Cash / Online / Split → "Paid by {mode}", Due → "Due bills", Credit → "Credit bills"; table → the table name;
  `phone` only, date not today → "Yesterday" / "All dates" / "22 Oct 2026"); `clearAllFilters(s)` (payment, table, phone
  cleared; date kept); `dateLabel(d: OrdersDate): string` ("Today", "Yesterday", "All dates", "22 Oct 2026").
- Rules: values §4 (row gap 8; search 40 px radius 9, `flex:1 1 220px` / phone `0px`, icon 15, input 14 px (16 below
  720), placeholder "Search by customer phone", `inputMode="tel"`, aria-label "Search by customer phone", the round ✕
  "Clear search"; the date box 160 px (min 130) 40 px radius 9 13.5/500 with the chevron, hidden below 720 px; Filters
  40 px radius 9 13.5/500, the word hidden on the phone, `--text` border when open or with chips, the count badge),
  §5 (the panel in the page flow: radius 12, padding 14, gap 14, rise .25s; groups: phone "Date" first, "Payment" Any ·
  Cash · Online · Split · Due · Credit, "Table" kit select 260 × 38 "All tables" + tables; footer Reset / Done), §6
  (chips 28 px `--accent-t` / `--accent-i`, ✕ circle in a token tint, "Clear all"). The date box: a kit `Popover` listing
  Today / Yesterday / All dates / Pick a day… (each 36 px row, the chosen one ticked); "Pick a day…" shows the kit
  `Calendar` (`mode="single"`, `defaultMonth` = the chosen day) in the same popover; a picked day closes it. Escape closes
  the Filters panel. The 350 ms phone wait and "clear clears the debounced value too" stay (today's).

- [ ] **Step 1: tests first.** `filterChips` / `clearAllFilters` / `dateLabel` cases; paths: the search's placeholder
  and aria are "Search by customer phone" (reason: owner Q4); the page has no `<DatePicker` and no "{n} active" (reason:
  owner Q5, design §6.3); RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-3.json`: values §4.2 (row, search, icon, input, date box, Filters at the five
  viewports), §5.2 (panel open, its groups, footer; phone with Date), §6 (one chip: ours "Paid by Cash"; HTML "Dine-in" —
  compare the chip's box, colours and the ✕ circle size), the search typed state (✕ shown). Mapped: our payment pills
  and no Order type group (design §7), "Pick a day…" (Q5), the placeholder words (Q4), the date box's popover list (the
  HTML's is the browser's native list: not measured).
- [ ] **Step 5: commit.**

### Task 4: The list: head, table, cards, states, Load more

**Files:**
- Create: `apps/cafe/lib/orders-row.ts`
- Modify: `apps/cafe/components/orders/OrderTable.tsx` (the list box: head, table rows, card rows, skeleton, empty
  states; keeps its file name), `apps/cafe/app/(dashboard)/orders/page.tsx` (list head, error / offline / empty / Load
  more placement inside the scroller), `apps/cafe/lib/orders-lanes.ts` (`listHead`, `emptyText`)
- Test: `lib/polish-pages-paths.test.ts` (P3–P5, P15, P16: the xl table/cards switch becomes the container query; the
  row icon buttons go; the empty words change per design §11 — move on purpose), `lib/token-sheet-paths.test.ts` (P18:
  the token label's count and guard move with the code), `lib/order-list-query.test.ts` (P8 keeps); new
  `lib/orders-row.test.ts`

**Interfaces:**
- Consumes: Task 2's `orderDue`, `laneRows`, `OrdersLane`; `recentOrderCode` (`components/dashboard/RecentOrders.tsx`,
  export as is), `channelOf` + `CHANNEL_LABELS`, `billPrintedNow`, `tokenLabelOf`, `STATUS_CLASSES`.
- Produces:
  - `orderTitle(o: Order): string` — takeaway channel → "Takeaway"; else a table → "Table {tableNo}"; else QR → "QR
    order"; else "Walk-In".
  - `orderNumber(o: Order): string` — "#" + the last `-` segment of `orderId` ("#014").
  - `orderStatus(o: Order): { label: string; kind: StatusKind }` — Pending: "Bill printed" (`bill`) when
    `billPrintedNow`, else "In kitchen" (`info`); Cancelled "Cancelled" (`bad`); Completed with `orderDue > 0` "Due"
    (`bill`); else "Paid · {Cash | Online | Split}" (`ok`).
  - `orderAge(o: Order, now: Date): { text: string; short: string; tone: "bad" | "warn" | "plain" }` — Pending: "Open
    {m} min" / "Open {h}h {m}m" (short without "Open "), `warn` from 30 min, `bad` from 60; else "Today" / "22 Oct" with
    short = the clock time; `m = max(1, round(minutes))`.
  - `itemsSummary(o: Order): string` — "{qty}× {first name}" + " +{n} more" for more lines; "—" when none.
  - `orderRowView(o: Order, now: Date): OrderRowView` = `{ key, code, codeTone: "bill" | "plain", title, number,
    sub (number · channel word [· Token n]), customer ("Walk-in" when no `customerId`), customerSub ("No customer added"
    | null), items, time, age, status, amount, struck, dueText ("₹x due" | null), settle: boolean (Pending) }`.
  - `listHead(lane, count: number, more: boolean, searching: boolean): { left: string; right: string; dueNote: boolean }`
    ("8 open orders", "12+ paid orders", "1 match in all orders", "4 matches in all orders"; right "Bills printed first,
    then oldest" on Open not searching, else "Newest first"; `dueNote` on Due).
  - `emptyText(i: { lane; searching: string; filtersOn: boolean; more: boolean; loaded: number; date: OrdersDate }):
    { title: string; text: string }` (design §6.5 and Q10 words).
- Rules: values §7 (head 12.5 px, the count 600 `--text`; the Due note line 12.5 `--text-3`), §8 (table ≥ 700 px:
  head `minmax(150px,1.3fr) minmax(110px,1fr) [minmax(140px,1.4fr)] 92px 124px 92px 84px` gap 12 padding 10 16; rows
  padding 11 16, the bar, `--accent-t` when chosen, hover `--hover`; cells per design §6.4; the "Settle" button 32 px
  centred text, hover `--ink`, calls `onChoose(order)`), §9 (cards < 700 px), §10.3 row states, §13 (empty box). Whole
  row = `onChoose(order)`: the row's title is a real `<button>` (its accessible name the order's title and number)
  stretched over the row by an `::after` layer, and "Settle" sits above that layer — no control inside another (axe
  `nested-interactive`); the chosen row carries `aria-current="true"`. Skeleton: 6 rows in the current form.
  Error (`ErrorState`, the pinned props) and offline line in the list area; Load more under the list box (40 px, radius
  9, 1 px `--border`, 13.5/500; "Load more" / "Loading…" / "Retry") also under an empty Paid / Due list when `more`;
  the load-more error line 12.5 px `--bad-i` above it.

- [ ] **Step 1: tests first.** `orders-row.test.ts`: titles (table, takeaway, QR with and without table, walk-in),
  numbers, every status (printed / not, due via Credit, short Cash, Split), ages at 1 / 29.6 / 30 / 61 minutes and an
  older day, items summary (1 line qty 2, 3 lines, none), the row view's customer for a walk-in and a named customer;
  `listHead` and `emptyText` for each case incl. Q10's sparse page; paths: OrderTable has no `aria-label="View order"`
  icon and uses `@min-[700px]` (reason: design §6.4, values §0.2); RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-4.json`: values §7, §8.2 (c1280, t820, and ours at t1024 with the Items column — compare
  against the HTML's x1600 row values by `rel`), §9.2 (d1280, p390), §10.3 (chosen, cancelled struck, due line), §13
  (empty Due), the long-values state (Review Focus 5: `patch` a 40-character name, 12 lines, ₹1,00,000, "Rooftop-12");
  ours `patch` one open tab to a printed bill for the "Bill printed" tile and pill. Mapped: our titles / subs / channel
  words, no customer sub for named customers, no "Collect" (design §6.4), Load more (ours), t1024 table (owner rule).
- [ ] **Step 5: commit.**

### Task 5: The detail: frames, choosing, head and steps

**Files:**
- Create: `apps/cafe/lib/order-detail-view.ts`, `apps/cafe/components/orders/OrderDetailHead.tsx`
- Modify: `apps/cafe/components/orders/OrderDetailSheet.tsx` (three frames; the header/body markup moves to the new parts;
  every print / settle / move line and the off-screen sources stay as they are), `apps/cafe/app/(dashboard)/orders/page.tsx`
  (the column slot, the choice: `detail` state + the auto-pick), `apps/cafe/lib/orders-layout.ts` (detail frame
  classes)
- Test: `lib/nested-dialog.test.ts` (P41: the `<SheetContent ref={sheetRef} … onInteractOutside>` stays on the sheet
  frames), `lib/realtime-live-state.test.ts` (P10: `order={liveOrderOf(detail, list)}` and the dashboard's keep),
  `lib/print-routing.test.ts` (P14 keeps), new `lib/order-detail-view.test.ts`, new `lib/orders-detail-frame.test.ts`

**Interfaces:**
- Produces:
  - `OrderDetailSheet` props gain `place?: "page" | "overlay"` (default `"overlay"`: the dashboard) and
    `onCancel?: (order: Order) => void` (used in Task 7). `"page"` from 1280 px renders the column (a `<div>` frame,
    `data-ui="order-detail"`, values §11.1: 400 px, `--surface`, 1 px `--border` left, no shadow, no ✕); `"overlay"`
    from 1280 px renders the kit `Sheet` side right at 400 px (the column's look + the ✕, over the kit scrim); both below
    1280 px render the bottom sheet (`ORDER_DETAIL_SHEET_CLASS`: fixed inset 0 z 15, the /pos cart sheet's slide up /
    down, values §12 ✕ 34 px). The width comes from `useMediaQuery("(min-width: 1280px)")`; `null` (not known yet)
    renders no frame. Exactly one frame is mounted for a given width.
  - `ORDERS_XL_QUERY = "(min-width: 1280px)"` in `lib/orders-layout.ts`.
  - `detailMeta(o: Order, now: Date): { icon: "type" | "staff" | "token" | "clock"; text: string; tone: "bad" | "warn" |
    "plain" }[]` (channel word; `receiver`; "Token n" when it has one; clock: open "8:22 PM · 1h 8m" coloured as
    `orderAge`, today "8:16 PM", older "22 Oct · 8:16 PM").
  - `detailSteps(o: Order): { label: string; state: "done" | "cur" | "todo" | "bad" | "due"; time: string }[]` (design
    §6.7: open Opened / Kitchen ("Sent", or "Not needed" done when `orderSkipsKitchen`, else cur "Not sent") / Bill
    printed ("Printed") / Paid with the first not-done step `cur` and "Next" when it has no time; settled four done
    ("Paid" no time); settled with due → last "Due" (`due`); cancelled Opened + Cancelled (`bad`, `cancelledAt` time)).
- Rules: values §11.1–11.3 (head padding 16 18, gap 14; tile 46 radius 12 `--ink`; name 18/600 −.01em + "#014" Geist
  Mono 12.5 `--text-3`; meta 12.5 `--text-2` gap 4 10 with the 13 px icons (the token icon our ticket glyph); steps box
  radius 12 `--surface-2` 1 px `--border-2`, 14 px dots, connectors, labels 12/600, times 11), §12 (bottom sheet: no
  scrim drawn, the ✕). The page's choice (design §6.6): `detail` state as today; on /orders at ≥ 1280 px when `detail` is
  null and the shown list has rows, the first row is set as `detail` (once; a refresh never swaps it); a lane, date,
  filter or search change sets `detail` to null (then the next first row is set); "Select an order to see its details."
  in the column when the list is empty. The dashboard passes nothing new.

- [ ] **Step 1: tests first.** `order-detail-view.test.ts`: meta for an open tab (with token, 68 min), a settled one, an
  older day; steps for open (sent / not sent / skip-kitchen / printed), settled, settled with due, cancelled.
  `orders-detail-frame.test.ts` (source-reading): one `useMediaQuery(ORDERS_XL_QUERY)` in OrderDetailSheet, the column
  branch has no `SheetContent`, both sheet branches keep `ref={sheetRef}` + `onInteractOutside`, the null width renders
  no frame; the page sets the auto-pick only when `detail` is null; RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-5.json`: values §11.3 (head, tile, name, number, meta, steps at d1280 / c1280 in the
  column; t820 / p390 in the bottom sheet incl. the ✕), §21.1 detail regions, §12 sheet boxes; the dashboard (shots only:
  ≥ 1280 side sheet, 390 bottom sheet). Mapped: our meta items (no guests, the token), the bottom sheet at 1024 / 820
  (owner rule; the HTML's is a column / side sheet), "Not needed".
- [ ] **Step 5: commit.**

### Task 6: The detail body: customer, items, sums, void trail, cancel note

**Files:**
- Create: `apps/cafe/components/orders/OrderDetailBody.tsx`
- Modify: `apps/cafe/lib/order-detail-view.ts` (`detailSums`), `apps/cafe/components/orders/OrderDetailSheet.tsx`
  (renders the body part), `apps/cafe/components/orders/OrderVoidTrail.tsx` (the void trail in the items box)
- Test: `lib/reward-void-trail.test.ts` (P46, P54: the reward arm `item.reward ? … line-through … FREE … ) : (` keeps its
  shape in the new markup), `lib/removed-modifiers-paths.test.ts` (P44, P53), `lib/gst-discount.test.ts` (P40:
  `discountLineLabel(`), extend `lib/order-detail-view.test.ts`

**Interfaces:**
- Produces: `detailSums(o: Order): { rows: { label: string; value: string; tone: "bad" | "bill" | "plain" }[];
  totalLabel: "To pay" | "Bill total" | "Not charged"; total: string; struck: boolean }` — "Subtotal"; discount
  `discountLineLabel(kind)` "−₹x" (`bad`); each charge (`chargesFromOrder`); GST when `gstAmount > 0`: "GST @{rate}%"
  (exclusive) / "Incl. GST @{rate}%" (inclusive) — check against `lib/receipt.ts` that the rows add up to `total`;
  settled: "Paid by Cash" / "Paid online" / split "Paid in cash" + "Paid online" (`splitCash`, `splitOnline`) / short
  "Paid ₹x"; "Due at billing" (`bill`) when `orderDue > 0`.
- Rules: values §11.4 (customer row: 36 px avatar, initials of the first two words in `--accent-t` / `--accent-i`; a
  walk-in "?" on `--surface-3`, "Walk-in customer" / "No customer added"; no "+ Add customer"), §11.5 (items box:
  `--surface-2`, radius 12, padding 12 14 14; head "{n} items" / "Amount" 11.5 uppercase; lines grid `28px 1fr auto`;
  meta = `orderItemModifierLines` + instructions joined ", ", the reward note "Reward — free"; reward lines struck price
  + "FREE"; dashed dividers; sums 13 px; total 22/600 Geist Mono, struck `--text-3` when cancelled), design §6.8 void
  trail (caption, struck lines, "round {n} · {reason} — {who}, {date}"), §11.6 the red note with our words "Cancelled at
  {time} by {who}." + "Reason: {reason}". The body scrolls; nothing in it shrinks (`flex-none` on the parts).

- [ ] **Step 1: tests first.** `detailSums` for an open tab with a discount + a table charge + exclusive GST, inclusive
  GST, a split settle, a short Cash settle, a Due-mode settle, a cancelled order (struck); paths: the body renders
  `detailSums`, the reward arm shape holds (reason: design §6.8); RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-6.json`: values §11.4, §11.5 (box, head, three lines with meta, dividers, sums rows,
  total) for an open tab, §11.6 cancelled note, §11.10 a split and a due order (ours from the seed: a split, a Due-mode
  and a cancelled order chosen by `click`), the long-values state at p390. Mapped: our sums rows (GST shown, design §6.8,
  values §20 #15 not copied), "Due at billing" (Q9), the void trail and our cancel note words.
- [ ] **Step 5: commit.**

### Task 7: Quick actions, Cancel this order, the cancel sheet, the foot

**Files:**
- Create: `apps/cafe/components/orders/OrderDetailActions.tsx` (the quick actions grid, the danger link, the foot)
- Modify: `apps/cafe/components/orders/OrderDetailSheet.tsx` (passes its existing handlers `printBill`,
  `printKitchenSlip`, `printToken`, `setMoveOpen(true)`, `openSettle` into the actions part; the adjacent attribute pins
  `onClick={printBill} disabled={enqueuePending}` etc. move WITH the buttons into the new file on purpose, same meaning),
  `apps/cafe/components/orders/CancelOrderDialog.tsx` (the HTML confirm sheet with our reason field),
  `apps/cafe/lib/sheet-frame.ts` (the confirm sheet's class strings moved here from `ConfirmDialog.tsx`, unchanged
  strings: `CONFIRM_SHEET_SCRIM_CLASS`, `CONFIRM_SHEET_PANEL_CLASS`, `CONFIRM_SHEET_TITLE_CLASS`,
  `CONFIRM_SHEET_BODY_CLASS`, `CONFIRM_SHEET_BUTTON_CLASS`), `apps/cafe/components/shared/ConfirmDialog.tsx` (imports them),
  `apps/cafe/app/(dashboard)/orders/page.tsx` (`onCancel` to the detail for admins; after a cancel `setDetail(cancelled)`),
  `apps/cafe/app/(dashboard)/settings/kitchen-ticket/page.tsx` and `settings/tokens/page.tsx` (the quoted button word,
  design §11)
- Test: `lib/print-host-band-paths.test.ts` (P28), `lib/print-routing.test.ts` (P29–P34), `lib/print-token-lanes-paths
  .test.ts` (P37, P38), `lib/skip-kot-paths.test.ts` (P39), `lib/table-flow-paths.test.ts` (P50),
  `lib/settle-flow-paths.test.ts` (P47, P48), `lib/sheet-frame.test.ts`, `lib/polish-pages-paths.test.ts` (P22),
  new `lib/orders-actions.test.ts`

**Interfaces:**
- Consumes: Task 5's `place` / `onCancel` props; `offerPosTable(tableNo, now)` (`lib/pos-table-handoff.ts`).
- Produces: `quickActions(o: Order): { key: "bill" | "kot" | "share" | "token" | "move"; label: string }[]` in
  `lib/order-detail-view.ts` — bill "Print bill" (Pending, not printed) / "Reprint bill"; kot "Reprint KOT" /
  "Notify kitchen" (cancelled); share "Share bill"; token "Reprint token" (a token and not cancelled); move "Move table"
  (Pending with a table) / "Assign table" (Pending walk-in).
- Rules: values §11.7 (grid radius 12, 1 px `--border`, 62 px buttons, 18 px icons, 12/600; one row up to four, five
  as 3 + 2 on a 6-column grid; never shrinks), §11.8 ("Cancel this order" 13/600 `--bad-i`, hover `--bad-t`, only with
  `onCancel` and not cancelled), §11.9 (foot: "Edit items" 48 px outline with the pencil — a `Link` to `/pos`
  (`prefetch={false}`) whose click calls `offerPosTable(order.tableNo, Date.now())`, only for a Pending tab with a table;
  "Settle & pay · ₹x" 48 px 15/600 accent → `openSettle`; columns `1fr 2fr`, one button full width; no foot when settled
  or cancelled; bottom padding 14 + inset), design §6.10 cancel sheet (420 px, title "Cancel {orderId}?", today's
  sentence, "Reason (required)" + `SHEET_FIELD_CLASS` textarea 48 px min, "At least 3 characters." `--bad-i`, "Cancel
  order" `--bad` 46 px with the spinner, "Keep order" `--surface-3`; same disable and submit rules; `isAdmin` mount as
  today). Toasts unchanged.

- [ ] **Step 1: tests first.** `orders-actions.test.ts`: `quickActions` for an open tab (not printed / printed / with
  token / walk-in), a settled order, a cancelled order; paths: the actions part keeps
  `onClick={printBill} disabled={enqueuePending}`, `onClick={printKitchenSlip} disabled={enqueuePending}`,
  `{hasToken && (` + `onClick={printToken} disabled={enqueuePending}` (pins moved with the same meaning), "Cancel this
  order" renders only with `onCancel`, the dashboard passes no `onCancel`, Edit items calls `offerPosTable` and only for a
  table tab; `sheet-frame.test.ts`: the five confirm strings equal U1's; RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-7.json`: values §11.7 (unsqueezed `sel-t7` look: grid and buttons for 4 / 3 / 2
  actions), §11.8 danger, §11.9 foot (Edit items + Settle & pay; full width) at the five viewports; the cancel sheet vs
  U1 values §12.1 confirm (box, title, body, buttons; our field as mapped); hover on a quick action and the danger link.
  Mapped: our action set and words (design §6.9, §11), 3 + 2 rows with a token, no Refund (design §7), no squeeze
  (values §20 #2–#3).
- [ ] **Step 5: commit.**

### Task 8: Whole verification (controller)

- [ ] All `match\orders\probes` files together at the five viewports (+ U0 `all-probes.json` for the shell): no
  difference except named mapped items; side-by-side shots of every state and size for the owner in
  `D:\kd\pos-dev-keep\ui-redesign\match\orders\final\shots\` (an `index.html` as U1's).
- [ ] Every suite (cafe chain, typecheck, lint; shared; print-tools; release-native), the live legs (dashboard, print,
  staff-pin, orders, tables, table-move), a production build in `D:\kd\uib` (take the idle BASE count on main's build
  first; stop :3110 / :3130 first; serve again after), every page's first screen (`baseline.mjs` FOLD=1), the local a11y
  check on /orders and the dashboard with the detail, the Filters panel and the cancel sheet open, the idle request count
  on /orders (240 s, `tools\net-count.mjs` with `MSYS_NO_PATHCONV=1`; same kinds and number as main), the S1 pin, the
  print budget, laptop fit (1366×768, 1280×800, 1100×800, 1024×768), the bottom inset at every width
  (`reviews\u1\audit\inset-check.mjs`), the emulator on WebView 109 (/orders portrait and landscape, the bottom sheet,
  the payment and move sheets over it; a look at 154 for the safe area), the write paths for real on uimatch through
  :3130 (settle, move, assign, cancel with a reason, the four reprints; then reseed).
- [ ] A fresh Claude Fable 5.1 whole-branch review; one fix wave (its findings + every FIX BEFORE MERGE minor); its scoped
  re-review; the plan's Results; memory; the next page's prompt; ask the owner for the merge OK and, separately, the
  push.

## Results

(2026-10-22 → 24, branch `feat/ui-orders`, base main `3d72d4d`; 16 commits, 66 files, +8788 / −978 before this Results
commit. Not merged, not pushed. Ledger with every ruling and review: `.superpowers/sdd/2026-10-23-orders-match-html/progress.md`,
copied to `D:\kd\pos-dev-keep\ui-redesign\reviews\u2\`.)

### Commits
- Docs: `3c662db` (values + design), `b095871` (this plan).
- Tasks: T1 `296d23c` frame + header · T2 `06f6a90` lanes + query · T3 `4b08830` + `09e7db7` toolbar, date box, Filters,
  chips · T4 `2d23928` + `c19eba0` + `d56a628` the list · T5 `dd6fed3` + `7056d7f` detail frames, choice, head, steps ·
  T6 `5adb2ea` detail body · T7 `8b78f67` quick actions, Cancel this order, cancel sheet, foot.
- Final fix wave (after the Claude Fable 5.1 review): `2c9a152`.
- Verification fixes: `903914c`, `274f413`.

### Tests and checks
- Cafe chain at `274f413`: 6835 tests / 6834 pass / 0 fail / 1 skipped (main `3d72d4d`: 6639); tsc clean (incremental and
  full); lint 0 errors, the 2 old warnings; shared 1015; print-tools 11; release-native 12. Mobile, desktop, hub,
  packages untouched.
- Live legs (V-A, at `2c9a152`): 22 legs, 1387 checks, 0 failed (the U1 set + dues + money).
- The paper: S1 43/43 SHA-256 unchanged, `print-budget.test.ts` unchanged, no slip / printer / print-routing / receipt
  file in the diff.
- Requests: idle /orders 240 s = main's build (pulse 12, orders 8, tables 8; the first view asks `status=Pending&limit=50`);
  a run can also catch the six one-time warm-route prefetches (one pass per session at the first pulse the sidebar sees;
  refills after 30 min; warm-routes unchanged — U1's /pos audit counted the same six on main); dashboard = U1. No new or
  faster request.
- Write paths for real on uimatch (V-D, 1280 and 390, /orders and the dashboard): 10 settles (cash, split, short + due,
  Due mode), 4 moves / assigns, 4 cancels with a reason (open and settled), 13 print jobs (bill, KOT, token, the cancel
  notice, moved slips), Edit items via the Floor hand-off, staff without Cancel: 0 requests different from main.
- Measured match (V-B, production build): U2 probes 116 differences in 12,813 checks, every one an accepted mapped row;
  U0 shell probes 217 in 14,959, all classed (U1 rows, the /orders header items of design 6.1, the reseed's data); 355
  side-by-side pairs: `D:\kd\pos-dev-keep\ui-redesign\match\orders\final\shots\index.html`. First screens: 76 routes
  200, console identical to U1. A11y: 0 axe violations (12 screens, 19 open states, + 6 after the verification fixes).
  /m unchanged.
- Laptop fit 1366×768, 1280×800 (open / collapsed), 1100×800, 1024×768, 820×1180, 390×844: no page scroll; the column's
  foot on screen at ≥1280; the bottom sheet's foot below. Bottom inset (25 px) respected everywhere on /orders.
- Emulator: WebView 109 portrait and landscape (/orders, the bottom sheet, payment / move / cancel over it, the dashboard's
  detail) and 154 (safe area): pass; payment / move sheets 99.14 % on 109 (R41).
- Production build of `274f413` in `D:\kd\uib`: the owner's preview on :3110 (uibase) and the check twin on :3130.

### Reviews
- Seven task reviews (fix rounds: T3 ×1, T4 ×1, T5 ×1; controller rulings applied in T4 before review); final Claude
  Fable 5.1 whole-branch review: With fixes, 0 C / 1 I / 10 m (chain, tsc, eslint and 8 mutation probes clean) → one fix
  wave (10 items) → re-review (Fable): all addressed; the verification fixes reviewed: Approved, their minors re-reviewed
  clean.

### What the owner will see differently from the HTML (mapped, each with its ruling)
Five lanes with numbers on the chosen lane only (Q1, Q2); Due = money owed at billing with its own words (Q3, Q9); the
phone-only search (Q4); the date box with "Pick a day…" (Q5); row Settle opens the detail (Q6); Edit items only for
table tabs (Q7); below 1280 the detail is full screen from the bottom, never a column or side sheet (owner rule); our
titles / channel words / Token / void trail / cancel note / reason field; the HTML's clipped quick actions and clipped
row Settle not copied (P7); the card's day on older rows (P18); the cancel sheet at the top on phones and in short
windows (P17); the cancel sheet never closes on an outside tap (P16).

### Owner notes (decisions or pre-existing items, nothing changed for them)
- The detail is a snapshot: the list rows carry no `updatedAt`, so another device's change shows in the detail only after
  a tap or a settle / move / cancel here (pre-existing, inventory 8.1; now visible all day in the ≥1280 column; the real
  fix is the server sending `updatedAt` on list rows). After a print the detail keeps "Print bill" until the 30 s list
  refresh.
- "Print bill" on a never-printed open tab prints a slip headed DUPLICATE (main's `reprint: true`, kept).
- Days-old open tabs read "Open 720h 5m" (the HTML's formula, P15).
- Phone landscape: the Android keyboard leaves ~122 CSS px, so the cancel sheet's field is under it even at the top (a
  keyboard-aware layout would be new work). WebView 154 reports a 52 px top inset, so the cancel sheet opens 68 px down.
- WebView 109 draws only ~1 frame of the bottom sheet's slide (as U1's cart sheet; 154 smooth).
- With classic Windows scrollbars the table's Items tracks can run up to 13 px into the row's right padding at
  940–952 px columns (nothing clipped).
- The U0 nav's account row ends 12 px above the window's foot at 820 / 1024 / 1280 (inside a 25 px inset on tablets that
  report one): shell, not this page.
- The Filters panel's Payment pills still say "pressed" to screen readers for a single choice (minor).
- Scratch databases left by V-A: eight `pos_scratch_va_u2_*` (not dropped; the owner's OK needed, with U0's three).

### Left for later
The next page session (prompt `D:\kd\pos-dev-keep\ui-redesign\prompt-u3.md`); the owner's merge OK and, separately, the
push.
