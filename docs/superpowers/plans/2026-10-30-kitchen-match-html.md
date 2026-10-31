# U4: the Kitchen (/kitchen) rebuilt to the owner's HTML: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /kitchen looks exactly like the owner's HTML Kitchen card board at 1280, 1280 collapsed, 1024, 820 and 390 px,
as one board (no status columns), with every option the Kitchen has today kept and placed as the approved design says.

**Architecture:** the HTML's measured values are the spec. The page keeps its queries and writes (`useKitchenBoard`,
`useTickKitchenLine`, `useMarkOrderReady`, `useKitchenRealtime`) and the payload libs untouched; new pure libs turn a
`KitchenOrderCard` into the HTML's words (`lib/kitchen-view.ts`: code, where line, time pill, round groups, footer,
button; `lib/kitchen-header.ts`: the type filter, the second line, staleness) and hold the class strings
(`lib/kitchen-layout.ts`); a new hook `hooks/use-kitchen-actions.ts` owns the tick / Mark ready handlers, toasts and
in-flight sets (Q7's fix lives there); the components under `components/kitchen/` draw them. The page fills the screen
under the shell header; the board is its only scroller. Each task ends with a measured comparison of the HTML and our
dev build (`compare-ui.mjs`).

**Tech Stack:** Next.js 15.5 (app router), React 19, TanStack Query v5, Tailwind v4 (tokens in
`apps/cafe/app/globals.css`, breakpoints `tab` 720 / `lg` 1024 / `desk` 1100 / `xl` 1280, `max-tab:` below 720,
`pointer-coarse:` / `pointer-fine:`), the shadcn/Radix kit, next/font (Geist), `node:test` + tsx source-reading and
render tests in `apps/cafe/lib/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md` (APPROVED by the owner 2026-10-30: "proper
easy to use, easy to understand and proper smooth working … ye design approve hai"; "design §N", the owner's Q1–Q10 in
design §4) and `docs/superpowers/specs/2026-10-29-kitchen-html-values.md` ("values §N"). Shell and theme:
`docs/superpowers/specs/2026-10-19-u0-html-values.md`; U3's patterns: `docs/superpowers/specs/2026-10-28-floor-match-html-design.md`.
Today's page, every word and every test pin (P1–P86, labels L / G / B / BUD):
`D:\kd\pos-dev-keep\ui-redesign\inventory\kitchen-features.md` ("inventory §N", elements E1–E52, states S1–S24);
shots of today's page `D:\kd\pos-dev-keep\ui-redesign\current-kitchen\`; the HTML's shots `design\spec-shots-kitchen\`.

## Global Constraints

- **The HTML's numbers are the spec.** Every element a task names takes the HTML's size, spacing, font family / size /
  weight / letter-spacing / line-height, colour, radius, border, per breakpoint, exactly (values §1–§6). A visible
  difference that is not a mapped item of design §4–§8 is a defect, never a "minor"; a new one goes to the controller.
- **Layout (design §5):** `KITCHEN_PAGE_CLASS` = `POS_PAGE_CLASS` + `flex flex-col overflow-hidden`; children: the
  refresh strip (Task 2), then the board = the only scroller, padding `16px 20px 24px` from 720 px and `12px 12px 84px`
  below, each bottom plus `env(safe-area-inset-bottom)`, the HTML's 8 px scrollbar (as `FLOOR_SCROLLER_CLASS`). Grid
  from 1024 px: `repeat(auto-fill, minmax(min(320px, calc((100% - 33px) / 3)), 1fr))`, column gap 16, row gap 10;
  below 1024: `repeat(auto-fill, minmax(min(300px, 100%), 1fr))`, gap 10; `align-items: start` (own heights). Cards per
  row: 3 × 325.33 (1280), 3 × 377.33 (collapsed), 3 × 292 (1024), 2 × 347 (820), 1 × 366 (390).
- **Touch (ruling R1):** the HTML's sizes where the HTML has the element (line rows, 46 px button, 36 px filter, 26 px
  pill); 44 px for our own controls with no HTML element (the strip's Try again hit area). Hover only where a pointer
  can hover (R14).
- **Safe area (U1 P49):** the board's foot, the strip and the toasts respect `env(safe-area-inset-bottom)` at every width.
- **Colours:** U0 tokens only (`bg-card`, `border-border`, `border-border-2`, `bg-surface-3`, `bg-seg`, `shadow-seg`,
  `bg-ink`, `text-on-ink`, `bg-hover`, `text-muted-foreground` = `--text-2`, `text-subtle-foreground` = `--text-3`,
  `status-ok` / `status-warn` / `status-bad` with `-ink` and `-tint`); the Mark ready green is `bg-status-ok-ink`
  (#198038) with white text; per-band / per-kind class maps live in `lib/` (pin ui-constants:106). The raw Tailwind
  palette colours (orange / blue / amber / red / green) leave the Kitchen files. No `light-dark()`, no runtime
  `color-mix()`, no `in oklab` gradient, no `mask-image`.
- **WebView 109 (U3 VC-1):** every flex `<button>` whose children rely on stretch gets `w-full` children or
  `items-stretch` (the line row's text column, the Mark ready label). `overflow: clip`, never `hidden`, for pure clipping.
- **Words (design §11):** exactly the listed changes; singular / plural right ("1 active order"); test-used names keep
  their text ("Mark {name} done", "Kitchen", "Service", "Try again", "Undo", "All caught up", "Loading orders…").
- **Behaviour stays (design §6.7):** every request and its timing, both POST bodies (`seenFiredAt = card.newestFiredAt`),
  optimistic writes and their restore, the invalidates, both Undo toasts, the lost-ticket rule, FIFO, the 60-card cap,
  skip-KOT, the board never blanking on a failed poll, roles. **No new request of any kind.** The API route and
  `lib/kitchen-board.ts`, `lib/kitchen-cards.ts`, `lib/kitchen-lines*.ts` are not changed. `KitchenFreshnessChip` is not
  changed (`/now-serving` uses it).
- **The paper never changes:** no file of the S1 43-file pin (`lib/printer/kot-text/text-kot-print.test.ts:323`), no
  slip / print file; `print-budget.test.ts` green.
- **Tests:** look pins (L / G) move on purpose with the reason in the commit body; behaviour pins (B) keep their meaning
  and move with the code; budget pins (BUD) never loosen (inventory §4; `lib/kitchen-paths.test.ts`). Every new Kitchen
  file joins the kitchen-paths hygiene list and gets a line budget there. New test files go into `apps/cafe/package.json`
  `testChain`; every assertion carries a message. TDD (RED seen first). New and touched files ≤ 300 lines. Single files:
  `node --import tsx --test lib/<name>.test.ts` from `apps/cafe`.
- **Each task ends** with, in `apps/cafe`: `npm test` (the chain), `npm run typecheck`, `npm run lint` green; then the
  measured match.
- **The measured match (every task):** probes `D:\kd\pos-dev-keep\ui-redesign\match\kitchen\probes\task-N.json` made by
  a `make-task-N.mjs` beside them (U3's pattern `match\floor\probes\make-task-*.mjs`). The mock's entry: click
  `text=Rohan K.`, type `1234`, wait 2800, (collapsed: click `button[title='Collapse']`), click
  `nav button[title='Kitchen']`; phone: the tab bar's "More", wait 700, the More sheet's "Kitchen"; wait 2300;
  `mockClock` `2026-10-19T21:30:00+05:30`; mock states via `["set", {tickets: …}]` (values §0 "What was patched").
  Ours: `signin`, `guard`, (collapsed: `[data-ui='nav-collapse']`), `goto /kitchen`; our data put into the HTML's
  states with `rewrite` on `GET /api/kitchen` (cards with the HTML's tables, items, ages; a token; a parcel; two rounds;
  long words). Run `COMPARE_BASE=http://localhost:3120 node D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs
  D:\kd\pos-dev-keep\ui-redesign\e2e\e2e4g-uimatch.env <probes> D:\kd\pos-dev-keep\ui-redesign\match\kitchen\task-N\run-<k>`
  at the five viewports. Done = `compare.md` lists no difference, or only rows the task names as mapped (each citing
  design §N). A task touching the header re-runs U0's `match\probes\task-3.json` and `task-4.json`.
- **Environment:** the dev server on `http://localhost:3120` (scratch DB `pos_scratch_e2e_4g_uimatch`; admin
  `e2eadmin`, the password typed from the env file, never printed). Never touch :3110; never run `next build` in the
  repo; never restart the dev server (ask the controller). Probes are read-only (`guard`): every `POST /api/kitchen`
  answered locally or aborted. Local only: no network, no connectors, no push.
- **Commits:** on `feat/ui-kitchen`, one per green task, `git commit -F <file>` (message written with the Write tool in
  the scratch space), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge.

## Review Focus

1. **Two quick taps (Q7):** tick line A then line B before A's write answers, or Mark ready then its Undo while the write
   runs → every control comes back enabled when its own write ends; the requests sent are exactly today's (one per tap).
   Owned by Task 4 (hook test with two deferred writes resolving out of order).
2. **Filter and churn:** Tables chosen while only walk-in cards exist → "No orders here" (not "All caught up"); a poll
   adds a matching card → it shows; the second line counts what is shown; below 720 px the board always shows All even
   after a filter was chosen at 820 (rotation). Owned by Task 2 (`kitchen-header` unit tests + page wiring pin).
3. **Every code / where combination:** table ± token, no table ± token, parcel ± token, self-order, ticket numbering
   off, two and three rounds, an approximate round → the exact words of design §6.3 / §11. Owned by Task 3 and Task 4
   (table-driven `kitchen-view` tests).
4. **Narrow phones 360 / 375 / 390 / 430 with long words** (inventory §7.1: a 24-char table name, a 64-char item + a
   24-char variation, a 42-char unbroken word, a 200-char note, "Mark ready · 12 not ticked") → no sideways page scroll,
   nothing clipped, the button label on one line. Owned by Task 4 and Task 5 (probe states at 360 / 375 / 430, scrollWidth
   = clientWidth).
5. **Stale and recovery:** the strip shows once the last good answer is ≥ 60 s old with data on screen (a failed poll or
   offline), the second line reads "Updated 1 min ago", Try again only refetches, the strip leaves on success, the first-
   load error never shows the strip. Owned by Task 2 (`kitchenStale` tests + a probe holding the polls).

---

### Task 1: The /kitchen frame, the board scroller and grid, the header's buttons, the toasts' place

**Files:**
- Create: `apps/cafe/lib/kitchen-layout.ts`, `apps/cafe/lib/kitchen-layout.test.ts`, `apps/cafe/hooks/use-kitchen-actions.ts`
- Modify: `apps/cafe/app/(dashboard)/kitchen/page.tsx` (no `MenuPageShell`; the frame + board; the handlers move to the
  hook), `apps/cafe/components/kitchen/KitchenBoardBody.tsx` (the grid class), `apps/cafe/components/layout/Header.tsx`
  (`data-kitchen` → `gap-3`), `apps/cafe/components/layout/HeaderQuickTabs.tsx` (on /kitchen both links
  `hidden xl:inline-flex`), `apps/cafe/components/layout/AppToaster.tsx` (/kitchen takes the /tables inset set),
  `apps/cafe/components/now-serving/NowServingLink.tsx` (the button variant in U3's header outline look, `max-tab:hidden`)
- Test: `lib/kitchen-paths.test.ts` (P8 budgets, P41, P55 moved), `lib/header-quick-tabs.test.ts`, app-toaster pin,
  `lib/now-serving-paths.test.ts`

**Interfaces:**
- Produces: `KITCHEN_PATH = "/kitchen"`; `isKitchenPath(pathname: string): boolean` (`/kitchen`, `/kitchen/`);
  `KITCHEN_PAGE_CLASS`; `KITCHEN_BOARD_CLASS` (the scroller: `min-h-0 flex-1 overflow-y-auto overflow-x-hidden
  leading-[normal]`, `pt-4 px-5 pb-[calc(24px+env(safe-area-inset-bottom))]`, `max-tab:pt-3 max-tab:px-3
  max-tab:pb-[calc(84px+env(safe-area-inset-bottom))]`, the 8 px scrollbar classes of `FLOOR_SCROLLER_CLASS`);
  `KITCHEN_GRID_CLASS` (the two grids of the constraints, `items-start`); `data-ui` `kitchen-page`, `kitchen-board`,
  `kitchen-grid`.
- Produces: `useKitchenActions(): { onToggleLine(row: KitchenRow, done: boolean): void; onReady(card:
  KitchenOrderCardData): void; lineInFlight(id: string): boolean; readyInFlight(orderId: string): boolean }` — today's
  `handleToggle` / `handleReady` bodies moved as they are (Task 4 changes how the flags clear).

- [ ] **Step 1: tests first.** `kitchen-layout.test.ts`: `isKitchenPath` cases (`/kitchen`, `/kitchen/` true;
  `/kitchenx`, `/settings/kitchen-ticket`, `/now-serving` false); `KITCHEN_PAGE_CLASS` contains `POS_PAGE_CLASS`; the
  board holds both `calc(…+env(safe-area-inset-bottom))` feet and the scrollbar classes; the grid literal holds both
  track rules, `gap-x-4 gap-y-2.5` from `lg`, `gap-2.5` below, `items-start`. Source pins (move on purpose, reason
  design §5 / §6.1 / Q8 / Q10): page.tsx has no `MenuPageShell`, `data-ui="kitchen-page"` wraps `data-ui="kitchen-board"`;
  Header carries `data-kitchen` with `data-kitchen:gap-3`; HeaderQuickTabs on `isKitchenPath` gives both links
  `hidden xl:inline-flex`; AppToaster returns the inset set for /kitchen; NowServingLink's button variant carries
  `max-tab:hidden` and U3's outline header class. Budgets: page ≤ 156 stays, the hook ≤ 120. Run → RED.
- [ ] **Step 2: implement.** The page keeps `PageHeader eyebrow="Service" title="Kitchen"`, its description and the
  summary / chip for now (Task 2 replaces them); the summary line moves into the board above the grid.
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-1.json`: values §1.2 regions (page, header, board box and padding, the first card's x and
  width per viewport = 252 / 96 / 96 / 96 / 12 and 325.33 / 377.33 / 292 / 347 / 366), §2.2 header (height 56, gap 12,
  printer), the quick links present at 1280 and absent at 1024 / 820 / 390, Now Serving absent at 390 (tokens on by
  `rewrite` of the bootstrap's `tokenEnabled`), the toast's bottom = 24 / 92 / 140 + inset. Re-run U0 `task-3.json`,
  `task-4.json`. Mapped: the card contents (Tasks 3–4), the second line (Task 2), the filter (Task 2).
- [ ] **Step 5: commit.**

### Task 2: The second line, the type filter, the refresh strip

**Files:**
- Create: `apps/cafe/lib/kitchen-header.ts`, `apps/cafe/lib/kitchen-header.test.ts`,
  `apps/cafe/components/kitchen/KitchenTypeFilter.tsx`, `apps/cafe/components/shared/RefreshStrip.tsx`
- Modify: `apps/cafe/components/tables/FloorRefreshStrip.tsx` (renders `RefreshStrip` with its words and `floor-*`
  names: same markup), `apps/cafe/app/(dashboard)/kitchen/page.tsx`, `apps/cafe/components/kitchen/KitchenBoardBody.tsx`
  (the filtered-empty box), `apps/cafe/lib/kitchen-layout.ts` (filter classes)
- Test: `lib/kitchen-header.test.ts`, `lib/floor-refresh-strip.test.ts` (unchanged and green), `lib/kitchen-paths.test.ts`

**Interfaces:**
- Consumes: `updatedLabel(atMs, nowMs)` from `lib/floor-tiles.ts` (U3's freshness words), `KITCHEN_STALE_MS`,
  `KitchenOrderCard`.
- Produces: `type KitchenFilter = "all" | "tables" | "walkin"`; `KITCHEN_FILTERS: readonly { key: KitchenFilter; label:
  string }[]` = All / Tables / Walk-In; `kitchenFilterOf(card): Exclude<KitchenFilter, "all">` ("walkin" when
  `tableLabel === "Walk-In"` — the server's no-table label, `lib/kitchen-board.ts:213` — else "tables");
  `filterCards(cards, filter): KitchenOrderCardData[]`; `averageWaitMinutes(cards, nowMs): number | null` (mean of
  `nowMs − cardFiredAt` over the cards, rounded; null for none); `kitchenAgeWords(minutes: number): string` ("Now" < 1,
  "{m} min" < 60, "{h}h {m}m"); `kitchenHeaderLine({ cards, updatedAtMs, nowMs }): string` ("{n} active order(s)[ ·
  average wait {w}] · {updatedLabel}"); `kitchenStale(updatedAtMs, nowMs): boolean` (`updatedAtMs > 0 && nowMs −
  updatedAtMs ≥ KITCHEN_STALE_MS`); `KITCHEN_EMPTY_FILTER_TEXT = "No orders here"`.
- Produces: `RefreshStrip({ show, message, onRetry, ui }: { show: boolean; message: string; onRetry: () => void; ui:
  "floor" | "kitchen" })` — `data-ui` `${ui}-refresh-strip` / `-message` / `-retry`, U3's classes (moved to
  `lib/ui/refresh-strip.ts`, re-exported by `lib/floor-layout.ts` under their FLOOR_ names).

- [ ] **Step 1: tests first.** `kitchen-header.test.ts`: `kitchenFilterOf` (a table, "Walk-In", a parcel with no table
  → walkin); `filterCards` per filter; the counts / average follow the filter; `averageWaitMinutes` (exact ms then
  rounded: ages 4, 2, 24 → 10); `kitchenAgeWords` (0.4 → "Now", 1 → "1 min", 59 → "59 min", 60 → "1h 0m", 75 → "1h 15m",
  600 → "10h 0m"); `kitchenHeaderLine` ("1 active order · average wait 4 min · Updated just now"; none → "0 active orders
  · Updated just now"; 3 cards, stamp 70 s old → "… · Updated 1 min ago"); `kitchenStale` (0 → false; 59 999 → false;
  60 000 → true). Page pins: `description={board.data !== undefined ? kitchenHeaderLine(…) : "Loading orders…"}` (P48's
  ternary keeps its meaning: no line on the error / offline branches), the chip and the old summary gone from the page,
  `filter` reset per visit (state in the page), below 720 px the page passes "all" (`useMediaQuery("(min-width:
  720px)")`), the strip above the board with `kitchenStale(...)` and `onRetry={() => void board.refetch()}`. Render test:
  `KitchenTypeFilter` = `role="group"` "Filter orders by type", three buttons with `aria-pressed`, the HTML's classes.
  Run → RED.
- [ ] **Step 2: implement.** The filter is `actions` content with `max-tab:hidden`; values §2.1: track `h-9 rounded-[8px]
  bg-surface-3 p-0.5 gap-0.5`, tab `rounded-[6px] px-3 text-[13px] font-medium text-foreground whitespace-nowrap`, chosen
  `bg-seg shadow-seg`, hover `pointer-fine:hover:bg-hover` on the others; kept out of the shell's `[data-header-actions]`
  36 px button rule. The strip words "Couldn't refresh the kitchen board. Showing the last update.".
- [ ] **Step 3:** chain, typecheck, lint green (`floor-refresh-strip.test.ts` unchanged).
- [ ] **Step 4: probes** `task-2.json`: values §2.1 type control (track box, each tab box / font / colours, chosen chip,
  hidden on the phone), §2.3 subtitle box (12 px, `--text-2`, ellipsis), the strip (held polls) at all widths, the
  filtered-empty box. Mapped: our filter words (Q2), the line's words (Q3), the strip (Q3).
- [ ] **Step 5: commit.**

### Task 3: The card: frame, head row, footer, Mark ready

**Files:**
- Create: `apps/cafe/lib/kitchen-view.ts`, `apps/cafe/lib/kitchen-view.test.ts`
- Modify: `apps/cafe/components/kitchen/KitchenOrderCard.tsx`, `apps/cafe/lib/kitchen-layout.ts` (card classes, the
  band tint map, the button kinds), `apps/cafe/lib/orders-row.ts` (`orderNumberOf`), `apps/cafe/hooks/use-kitchen-actions.ts`
  (the Ready toast's where: `readyToastMessage({ ...card, tableLabel: kitchenCardCode(card) })`; `lib/kitchen-cards.ts`
  and its P32 tests stay unchanged)
- Test: `lib/kitchen-view.test.ts`, `lib/kitchen-paths.test.ts` (P12, P46, P65 moved with their meaning)

**Interfaces:**
- Consumes: `kitchenAgeWords`, `kitchenAgeBand` (`lib/kitchen-board.ts`), `tokenLabelOf` (`lib/token-view.ts`).
- Produces: `orderNumberOf(orderId: string): string` (`"#" + last "-" part`; `orderNumber(o)` calls it);
  `kitchenCardCode(card): string` (table name; else `tokenLabelOf(card.tokenNumber)` when defined; else "Parcel" /
  "Walk-In"); `kitchenWhereLine(card): string` (design §6.3: "Table · Order #012 · Token 12", "Parcel · Order #013" when
  the code is the token, "Order #014 · Self-order"); `kitchenPill(card, nowMs): { text: string; band: "fresh" | "warn" |
  "late"; title?: string; srLate: boolean }` ("~" when `cardFiredAtApprox`, title "approximate — fired before age
  tracking"); `kitchenCardLate(card, nowMs): boolean` (band late and not `allDone`); `kitchenFooter(card): { left:
  string; right: string }` (left "KOT #9, #12 · 9:26 PM" / "Sent 9:26 PM", right "{d} of {n} done"; times in
  `CAFE_TIMEZONE`, "~" before an approximate first time); `kitchenButton(card): { label: string; kind: "open" | "done" }`
  ("Mark ready · {n} not ticked" / "Mark ready").
- `KitchenOrderCard` props unchanged (`card`, `now`, `onToggleLine`, `onReady`, `lineInFlight`, `readyInFlight`), plus
  `rise: boolean` (Task 4 sets it).

- [ ] **Step 1: tests first.** `kitchen-view.test.ts`, table-driven over Review Focus 3: every code / where combination;
  the pill text / band / title at 0.4, 9, 10, 19, 20, 75 min and approximate; late border only while lines are open;
  footer with numbers on (one and two rounds) and off; the button label and kind at 0, 1, 3 of 3 ticked
  ("Mark ready · 1 not ticked"). Card render test: the head row / where / pill / footer / button classes from
  `kitchen-layout.ts` (values §4.1), the code `text-[20px] font-bold tracking-[-0.01em] leading-[1.1]`, the pill
  `h-[26px] px-[9px] rounded-full text-[12.5px] font-bold`, the button `mx-3 mt-1.5 mb-3 h-[46px] rounded-[10px]
  text-[14.5px] font-semibold` with `bg-ink text-on-ink` / `bg-status-ok-ink text-white`, the frame `rounded-[12px]
  border overflow-clip bg-card` with `border-status-bad` when late, "Late" in an `sr-only` span, one
  `tokenLabelOf(card.tokenNumber)` behind `!== undefined` (P65), no `disabled=` mentioning `allDone` (P12), no "Ready to
  serve". Toast: "Parcel marked ready — 1 line not ticked", "Token 12 marked ready". Run → RED.
- [ ] **Step 2: implement.** The where line and the code wrap with `break-words [overflow-wrap:anywhere]`.
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-3.json` (rewritten GET with the HTML's seed as our cards): values §4.1–§4.2 head row, code,
  where, pill (each band, values §4.4), footer, button (both kinds), card border normal / late, heights. Mapped: our
  codes and where words (Q6 / Q9), the button words and the darker green (Q5), the footer's "KOT #" words.
- [ ] **Step 5: commit.**

### Task 4: The lines, round dividers, the rise, and the in-flight fix (Q7)

**Files:**
- Modify: `apps/cafe/components/kitchen/KitchenLineCard.tsx` (the row button), `apps/cafe/components/kitchen/KitchenOrderCard.tsx`
  (groups + dividers), `apps/cafe/lib/kitchen-view.ts` (`kitchenRoundGroups`), `apps/cafe/lib/kitchen-layout.ts` (row
  classes), `apps/cafe/hooks/use-kitchen-actions.ts` (Q7), `apps/cafe/components/kitchen/KitchenBoardBody.tsx` (the rise set)
- Create: `apps/cafe/lib/kitchen-actions.test.ts`
- Test: `lib/kitchen-view.test.ts`, `lib/kitchen-paths.test.ts` (P49 moved on purpose; P70, P71 kept)

**Interfaces:**
- Produces: `kitchenRoundGroups(card): { round: number; label: string | null; lines: KitchenRow[] }[]` (lines in
  today's order; `label` null for the first round and for every round of a one-round card, else "Round {r} · KOT #{t} ·
  {h:mm PM}" with "KOT #{t} · " left out when the round has no number and "~" before an approximate time).
- `useKitchenActions` in-flight flags clear when THAT call's write settles: `mutateAsync(vars).catch(() => undefined)
  .finally(() => clear(id))` (the hook-level `onError` still raises today's error toast; requests unchanged).
- The row: `<button type="button" role="checkbox" aria-checked={row.done} aria-label="Mark {name} done"
  disabled={pending}>` with values §4.1's classes (`flex w-full items-start gap-2.5 px-3 py-[9px] text-left`, opacity .5
  when done, `pointer-fine:hover:bg-hover`), the box (`size-[18px] mt-0.5 rounded-[5px] border-[1.5px]
  border-subtle-foreground`; done `bg-status-ok border-status-ok` with the 11 px white tick, drawn only when done), the
  quantity `min-w-[26px] text-[15px] font-bold` "{qty}×", the text column `min-w-0 flex-1` (name 15 px 500, struck when
  done; `orderItemModifierLines(row)` lines 12.5 px `--text-2`, a "NO …" line `text-foreground font-semibold`; "Note:
  {instructions}" 12.5 px 600 `text-status-warn-ink`), every text `[overflow-wrap:anywhere]`.
- The rise: a card rises (the HTML's `rise .35s cubic-bezier(.2,.8,.2,1) both`, `motion-reduce:animate-none`) when its
  `orderId` was not in the previous answer's ids (first paint, a new order, a card returning by the lost-ticket rule);
  never on a filter change. The board keeps one permanent wrapper (U3 VC-3).

- [ ] **Step 1: tests first.** `kitchenRoundGroups` (one round; rounds 1+2; 1+2+3 with numbers off; approximate);
  `kitchen-actions.test.ts`: two ticks whose writes resolve B then A → both rows enabled at the end; Ready then Undo while
  the Ready write is pending → the card's button enabled after both settle; one POST per tap (mutate spies); the toast
  words unchanged. Row render test (the classes above, `role="checkbox"`, `aria-checked`, the label, no `<label
  className="… min-h-10 min-w-10">` any more: P49 moved, reason design §6.3, the whole row is the HTML's button; 38 px
  one-line row ≥ R1's HTML size). Rise pin: a ref of seen ids, `animate-[kitchen-rise…]` only on first sight. Run → RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-4.json`: values §4.1–§4.2 rows (row box 38 / 54 / 56, checkbox, quantity, name, meta,
  note), §4.6 done look, §5.4 hover at 1280 only, §5.5 focus on a row, §4.7 long words at 360 / 375 / 390 / 430 / 1024
  (scrollWidth = clientWidth, nothing clipped), round dividers (ours). Emulate WebView 109's button rule
  (`@layer x { button { align-items: flex-start } }`, `match\floor\final\verify-check\VC-1-reproduce\probe-live.mjs`) on
  one run: rows unchanged. Mapped: the dividers and "NO …" lines (Q6, ours), the tick drawn only when ticked (design §8 #1).
- [ ] **Step 5: commit.**

### Task 5: Loading, error, offline, empty, filtered empty; the words left

**Files:**
- Modify: `apps/cafe/components/kitchen/KitchenBoardBody.tsx` (≤ 102 lines: split a `KitchenBoardStates.tsx` if
  needed), `apps/cafe/lib/kitchen-layout.ts` (empty box, skeleton)
- Test: `lib/kitchen-paths.test.ts` (P44 / P45 branch order kept), `lib/kitchen-layout.test.ts`

- [ ] **Step 1: tests first.** Branch order unchanged (loading → error without data → offline without data → empty →
  filtered empty → grid); the skeleton = six `Skeleton` boxes `h-[195px] rounded-[12px]` in `KITCHEN_GRID_CLASS`; the
  empty box `rounded-[12px] border-[1.5px] border-dashed border-border px-3 py-7 text-center text-[13px]
  text-subtle-foreground` with "All caught up" (13 px 600 `--text-2`) and today's line; the filtered box "No orders
  here"; `ErrorState` words and Try again unchanged; the offline line unchanged. Run → RED.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** chain, typecheck, lint green.
- [ ] **Step 4: probes** `task-5.json`: values §3.6 empty box (75 px tall at each width), the skeleton grid, the error
  and offline states' place, every page's first screen unchanged elsewhere. Mapped: the words inside the boxes (design
  §6.5).
- [ ] **Step 5: commit.**

### Task 6: Whole verification (controller)

- [ ] The final probes over every state of values §11 at the five viewports; side-by-side shots index
  (`match\kitchen\final\shots\index.html`); 360 / 375 / 430 phones; a classic scrollbar at 1280; the bottom inset at every
  width (`reviews\u1\audit\inset-check.mjs`); a11y (`tools\a11y-check.mjs`) on /kitchen with the strip and a filtered
  empty; idle requests on /kitchen = main's (`tools\net-count.mjs`, the BASE count taken on main's build first, alone,
  `MSYS_NO_PATHCONV=1`); the live legs; a production build in `D:\kd\uib`; the emulator on WebView 109 and 154; the
  write paths for real on uimatch through :3130 (tick, un-tick, Undo, Mark ready open / all ticked, its Undo, two quick
  ticks), then reseed; the Fable 5.1 whole-branch review, one fix wave, its re-review; the four verifiers (V-A..V-D);
  then the Results below.

## Results

(2026-10-29 → 30, branch `feat/ui-kitchen`, base main `736566b`; 14 commits, 40 files, +4043 / −509 before this Results
commit. Not merged, not pushed. Ledger with every ruling (K1–K7) and review:
`.superpowers/sdd/2026-10-30-kitchen-match-html/progress.md`, copied with the briefs and reports to
`D:\kd\pos-dev-keep\ui-redesign\reviews\u4\`.)

### Commits
- Docs: `9f5f691` (values + design), `c406963` (approved + this plan), `3831c8c` (design §12, the build's changes).
- Tasks: T1 `e9fc3a8` frame, board, grid, header buttons, toasts · T2 `85f22ec` + `c49d17e` second line, filter, refresh
  strip · T3 `331bbf1` + `5a5ad45` the card's frame, head, footer, Mark ready · T4 `d55177e` + `fd4b3d5` + `cf86c7e` the
  line rows, round dividers, rise, the in-flight fix · T5 `7ca5595` loading / error / offline / empty states.
- Final fix wave (after the Claude Fable 5.1 review): `aa8c735` (I1 the strip's rule; I2 → the owner's Q11).
- Verification fix: `9fcb4d0` (VC-1, the pill's screen-reader ", Late").

### Tests and checks
- Cafe chain at `9fcb4d0`: 7009 tests / 7008 pass / 0 fail / 1 skipped (main `736566b`: 6934); typecheck and the full
  `tsc --noEmit` clean; lint 0 errors, the 2 old warnings (on this PC `npm run lint` can crash natively:
  `NODE_OPTIONS=--max-old-space-size=6144 npx eslint .`). Shared 1015, print-tools 11, release-native 12; mobile,
  desktop, hub, packages untouched. New test files in testChain: kitchen-layout, kitchen-header, kitchen-filter-states,
  kitchen-view, kitchen-rows, kitchen-actions (kitchen-paths extended).
- Live legs (V-A at `aa8c735`): 18 legs, every exit 0 (kitchen, kitchen-ready, tokens, skip-kot, slips, print-template,
  tables-floor, tables, staff-pin, bootstrap, dashboard, print, appearance, orders, orders-idem, table-move, menu-orders,
  money).
- The paper: S1 43/43 SHA-256 unchanged, `print-budget.test.ts` unchanged; no slip / printer / print-routing / receipt
  file and no kitchen API / payload lib (`app/api/kitchen/route.ts`, `lib/kitchen-board.ts`, `lib/kitchen-cards.ts`,
  `lib/kitchen-lines*.ts`) in the diff.
- Requests: idle /kitchen 240 s = main's build's BASE exactly (`GET /api/kitchen` 24, `GET /api/order-requests/pulse`
  12; `match\kitchen\final\idle-base-kitchen.json` / `idle-new-kitchen.json`). No new or faster request.
- Write paths for real on uimatch (V-D at `aa8c735`, 1280 and 390): tick, un-tick, the tick's Undo, two quick ticks and
  Mark ready + Undo with the writes slowed (Q7), Mark ready with lines open and all ticked, the filter and Try again,
  staff priya: 40 `POST /api/kitchen`, one per press, every body byte-identical to main's, 0 differences, no print.
- Measured match (V-B at `aa8c735`, production build): U4 probes 126 differences in 6,252 checks, every one an accepted
  mapped row or the owner's Q11; the Floor's shared refresh strip 0 / 441; U0 shell probes 215 / 14,959 (U3's rows and
  the reseed's data); 323 side-by-side pairs: `D:\kd\pos-dev-keep\ui-redesign\match\kitchen\final\shots\index.html`.
  First screens: 76 routes 200, logs byte-identical to U3's. A11y: 0 axe violations in 13 /kitchen states (1280, 390),
  the rows' descriptions read, "Late" once. /m unchanged.
- Laptop fit 1366×768, 1280×800 (open / collapsed), 1100×800, 1024×768, 820×1180, 430×932, 390×844, 375×812, 360×800 with
  tokens on and off: no sideways scroll, cards per row 3 × 325.33 / 3 × 377.33 / 3 × 292 / 2 × 347 / 1, the phone line
  whole, the quick links only from 1280, Now Serving only from 720. A classic scrollbar at 1280: 3 × 322.656, the header
  still. The bottom inset (25 px) respected by the board's foot, the strip and the toasts.
- Emulator (V-C at `aa8c735`, smoke S-E at `9fcb4d0`; the app on :3130 because another project holds 127.0.0.1:3110):
  WebView 109 portrait / landscape and 154: the header, board, rows (109's button rule within ~1 CSS px of Chrome), the
  filter round trips (a mixed board with a walk-in card: every card stays in 109's and 154's accessibility tree), the
  rise, no console errors; VC-1 fixed on 154.
- Production build of `9fcb4d0` in `D:\kd\uib` (BUILD_ID `oMexRQld8t5ZJtorRg9Uf`): the owner's preview on :3110 (uibase)
  and the check twin on :3130 (uimatch, reseeded 2026-10-30 after the writing runs).
- Smoke S-D (desktop, `9fcb4d0`, uimatch reseeded): 0 DEFECT. Idle /kitchen 240 s × 3: `GET /api/kitchen` 24 and pulse
  12 every run (= BASE), each run also catching the shell's six one-time warm-route prefetches (`/`, `/tables`, `/pos`,
  `/orders`, `/requests`, `/reservations` once each: U2's known first-load race, /tables shows the same six). U4 probes
  task-1…5 equal V-B's rows plus VC-1's ", Late" in the task-3 words check (the probe literal updated after) and the
  reseed's order-requests strip moving the task-5 states 40 px down (data). a11y 0 violations at 1280 / 390 in 7 states;
  the Late pill reads "25 min, Late" once.

### Reviews
- Five task reviews, each three lenses (spec, logic, keep) and a skeptic check per Important finding. Fix rounds: T2 ×1
  (K3), T3 ×1 (K4 + the bad-stamp guard), T4 ×2 (the rows' accessible description, K5).
- The final Claude Fable 5.1 whole-branch review: With fixes, 0 C / 2 I / 3 M (M1–M3 LATER); I1 fixed, I2 → the owner's
  Q11 → one fix wave → its Fable re-review: all addressed, no new breakage.
- Verification (V-A, V-B, V-D PASS; V-C two minors: VC-1 fixed, VC-2 LATER, K7) → one fix round (re-reviewed) → smokes
  S-E (cut by the account's session limit once, resumed) and S-D.

### What the owner will see differently from the HTML (mapped, each with its decision or ruling)
One board instead of the three status columns, no column heads or tabs (Q1); the filter "All · Tables · Walk-In" (Q2);
the second line "{n} active orders · average wait {m} min · Updated …" and, on phones, "{n} active orders · avg wait {m}"
(Q3, Q11); the refresh strip under the header on a failed or offline refresh (Q3, I1); "Mark ready" (ink while lines are
open with "· {n} not ticked", a darker green when all are ticked) instead of Start cooking / Mark ready / Served (Q5);
our codes (table name, Token {n}, Parcel, Walk-In), the where line "Table · Order #012 · Token 12 · Self-order", "Note: …",
"NO …" lines, round dividers, the footer "KOT #9, #12 · 9:26 PM" (Q6, Q9, K4); the quick links only from 1280 (Q8) and Now
Serving from 720 (Q10); "1h 15m" past an hour; a ticked line dims its words, not the whole row (K5); cards keep their own
heights; the HTML's own slips not copied (design §8).

### Owner notes (decisions or pre-existing items, nothing changed for them)
- Every new order's first round gets no fire stamp from the server, so every first-round card shows "~" before its age
  and the hover title "approximate — fired before age tracking" (main the same); on WebView 109 a screen reader then hears
  only that title (VC-2, K7). A server stamp for round 1 (outside this UI phase) or a UI tweak (the title on the "~" only)
  is the owner's call.
- The wide second line's "Updated …" tail is cut by the ellipsis at 1280 with the nav open and at 820 with tokens on
  (counts and average whole).
- The average has no "~" even when every card's age is approximate.
- An empty board under Tables / Walk-In shows "All caught up" (the "No orders here" box only when the filter hides cards).
- The filter's Walk-In test reads the server's "Walk-In" label: a table literally named "Walk-In" counts as walk-in.
- Enter toggles a line too (the HTML's row button; today's checkbox took Space only).
- On a first-load error or offline before the first load the header shows the shell's default line "{cafe} · {date}"
  (K6).
- The phone board shows its thin 8 px scrollbar; the Walk-In filter comes back when a phone screen widens to 720+.
- The kit skeleton barely shows on the page background (F22, app-wide); the offline line stays 14 px.
- Deferred minors for a later pass (final review M1–M3 and the task reviews): the R6 actions row inside the board with no
  gap (720–745 px in the app with tokens on), a failed Mark ready's restore rises the card, an optimistic write resets the
  freshness clock during an outage, a row in flight keeps its pointer and hover, a card whose first round is 2+ gets no
  divider, two test gaps (the tick's Undo while pending, the idle fall-through row).
- Another project of the owner (a vite server) now listens on 127.0.0.1:3110: a browser on `localhost:3110` may reach it
  instead of the preview; the preview answers on `http://localhost:3110` over IPv6 and the twin on :3130.
- The U0 nav's account row sits inside a 25 px tablet inset (shell, open U0 item).
- Scratch databases left by V-A (the owner's OK needed to drop them, with the older ones): `pos_scratch_va_u4_bootstrap`,
  `_kitchen`, `_money`.

### Left for later
The next page session (prompt `D:\kd\pos-dev-keep\ui-redesign\prompt-u5.md`, the owner picks the page); the owner's merge
OK and, separately, the push.
