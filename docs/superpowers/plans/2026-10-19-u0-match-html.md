# U0 rebuilt to the owner's HTML: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the shell (every page), the dashboard, the login page and the lock cover look exactly like the owner's HTML
mock-up at 1280, 1024, 820 and 390 px, with every feature of ours kept.

**Architecture:** the HTML's exact values (values document) are the spec. Our existing components are rebuilt in place
(same data, hooks and behaviour) to the HTML's structure and numbers; where the HTML has no counterpart, the design
document's section 5 says how our feature is drawn. Each task ends with a measured comparison of the HTML and our dev
build (`compare-ui.mjs`) showing no difference for its elements.

**Tech Stack:** Next.js 15.5 (app router), React 19, Tailwind v4 (`@theme inline` tokens in `apps/cafe/app/globals.css`,
custom breakpoints, container queries), the shadcn/Radix kit, next/font (Geist, Geist Mono, Shrikhand), `node:test` + tsx.

**Spec:** `docs/superpowers/specs/2026-10-19-u0-match-html-design.md` (decisions and mapping) and
`docs/superpowers/specs/2026-10-19-u0-html-values.md` (the exact values; "values §N" below).

## Global Constraints

- **The HTML's numbers are the spec.** Every element in a task's values sections takes the HTML's size, spacing, font
  family/size/weight/letter-spacing/line-height, colour, radius, border and shadow, per breakpoint, exactly. A visible
  difference that is not a mapped feature of design §5 is a defect, never a "minor".
- **Breakpoints as the HTML:** phone `< 720px`, tablet `720–1099px`, desk `≥ 1100px`, wide sidebar `≥ 1280px` (and not
  collapsed), `cmp < 1024px`. Add Tailwind breakpoints `tab: 45rem` (720) and `desk: 68.75rem` (1100); `lg` (1024) and
  `xl` (1280) exist. The dashboard's `cw` rules (values §3.0) are container queries on the dashboard content
  (`@container`), not viewport queries.
- **Touch:** the rebuilt parts (shell, dashboard, login, lock) use the HTML's sizes on touch screens too: no
  `pointer-coarse:` enlargement in them (the HTML's own phone values apply below 720 px). Other pages keep theirs.
- **Line height:** where the HTML sets none, use `leading-normal` (values §0.3), in the rebuilt parts only (no global
  change: other pages keep Tailwind's 1.5).
- **Colours:** the HTML's light values (values §1.1) as tokens; no runtime `color-mix()` on staff screens (WebView 109):
  precomputed hex (avatar tints values §1.6, the chart's 60 % bar `#75A7FF`). Kit files (`components/ui/*`) and anything
  `/m` reaches keep using only preset-set tokens (`lib/kit-look-paths.test.ts`).
- **Behaviour stays:** data, requests, routes, roles, printing, the paper (S1 43-file pin, `print-budget.test.ts`), the
  PIN rules (5 wrong / 10 min per person, 20 / cafe-day blocks), the 90-day session, the 1-hour auto-lock. No new
  recurring request; the only new request is the user-driven `POST /api/sign-in/verify-pin` (Task 6).
- **Words:** the HTML's words where the HTML has the element ("Home", "Order", "New order", "End of day", "Needs
  attention", "Show", "Hide", "PIN needed to view", …); our words where the words come from our data or features
  (design §5).
- **Tests:** a test that pins a class string, a word or a structure this work changes is changed in the same commit, with
  the reason in the commit body; new test files go into `apps/cafe/package.json` `testChain`; every assertion carries a
  message. TDD for behaviour and structure (RED seen first).
- **The measured match (every task):** write `D:\kd\pos-dev-keep\ui-redesign\match\probes\task-N.json` covering every
  element of the task's values sections (props the HTML fixes: heights, fixed widths, paddings, gaps, radii, borders,
  font props, colours, grid column widths, positions that layout decides; not widths that depend on text or data), with
  locators for both sides (add `data-ui="…"` attributes in our markup where a text locator is not stable). Run
  `COMPARE_BASE=http://localhost:3120 node D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs
  D:\kd\pos-dev-keep\ui-redesign\e2e\e2e4g-uimatch.env <probes> D:\kd\pos-dev-keep\ui-redesign\match\task-N\run-<k>` at
  desktop 1280×800, desktop-collapsed (1280×800 after Collapse), tablet 1024×768 (touch), tablet-p 820×1180 (touch),
  phone 390×844 (touch, mobile). Done = `compare.md` lists no difference, or only differences the task names as
  mapped features. Put the last `compare.md` path and its count in the report.
- **Environment:** the dev server for comparisons runs on `http://localhost:3120` against the scratch database
  `pos_scratch_e2e_4g_uimatch` (demo data up to today; admin `e2eadmin` with the env file's password, PINs admin 9753,
  priya 2468, rahul 1357, amit 8642). Never touch port 3110 (the owner's preview), never run `next build` in the repo,
  never restart the dev server (ask the controller). Local only: no network, no connectors, no push.
- **Commits:** one per step that turns a test green, `git commit -F <file>` (message files written with the Write tool
  in your scratch space), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch
  `feat/ui-redesign`; never merge.
- **Where things are:** `D:\kd\pos-dev-keep\ui-redesign\match\code-map.md` maps every file, prop and pinning test of the
  shell, the dashboard, sign-in/lock and the theme (its section 7 lists the pins at risk per area). The HTML's reference
  shots: `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots\`.

## Review Focus

1. **/pos after the nav width change** (232 / 76 / 0 px instead of 256 / 48 px and the mobile sheet): the product grid's
   column maths (`lib/pos-layout.ts`, `ProductGrid` reads `useSidebar`) must give a full, unclipped grid at 1280,
   1280-collapsed, 1024, 820 and 390. Owned by Task 2 (a pos-layout test per width).
2. **Pages whose `PageHeader` actions are complex** (Order Requests' alert settings dialog, Expenses' More menu,
   Kitchen's Now Serving link, QR codes' print buttons, the back-link eyebrows of Settings sections, Festival cards and
   Expense categories): they work from the header on ≥ 720 px and from the body row on a phone, rendered once (never
   twice). Owned by Task 3 (a render test per kind).
3. **Phone bottom space:** nothing hides behind the 59 px tab bar: page bottom padding 92 px, sheets above it, toasts at
   140 px, and /pos's own cart bar sits above the tab bar (`calc(60px + env(safe-area-inset-bottom))`, as the HTML's
   order screen). Owned by Task 4.
4. **The sales mask:** a wrong PIN in the reveal dialog counts in the same per-person limit as the PIN sign-in; a person
   without a PIN gets the design's message; locking or leaving the dashboard hides the figures; another person signing
   in within the hour does not see them. Owned by Task 6.
5. **The lock cover over the new shell:** the cover still covers the rail, the tab bar and every sheet; `inert` and the
   focus trap still hold; the no-flash script still hides the page on reload. Owned by Task 10 (the existing
   screen-lock tests plus a check that the tab bar is a body child the cover makes inert).

---

### Task 1: Theme tokens, fonts and breakpoints

**Files:**
- Modify: `apps/cafe/app/globals.css` (`:root` and `@theme inline`; the `.dark` block gets the HTML's dark values for
  the new names only, opaque per ruling R2 where a tint fallback needs it), `apps/cafe/lib/fonts.ts` (add Shrikhand),
  `apps/cafe/app/layout.tsx` (add its variable), `apps/cafe/lib/ui/status.ts` and `apps/cafe/lib/ui/avatar.ts` (HTML
  status colours, the eight avatar hues of values §1.6 as precomputed bg/fg hex)
- Test: `apps/cafe/lib/theme-tokens.test.ts`, `apps/cafe/lib/fonts-paths.test.ts`, `apps/cafe/lib/ui-constants.test.ts`,
  `apps/cafe/lib/brand-contrast.test.ts`, `apps/cafe/lib/css-compat.test.ts` (must stay green)

**Interfaces:**
- Produces tokens (Tailwind names `bg-*`/`text-*`/`border-*`): `surface-2 #FAFAFA`, `surface-3 #E9E9EC`, `border-2
  #ECECEF`, `hover #F2F2F4`, `seg #FFFFFF`, `link #0F62FE`, `accent-b #A6C8FF`, `nav #111113`, `nav-2 #27272A`,
  `nav-t #C8C8CC`, `nav-t2 #8B8B93`, `nav-on` (rgba(255,255,255,.09) flattened over `#111113` = `#262628` where a fallback
  is needed), `brand-red #C8381F` (the HTML's `--brand`), `brand-nav-name #FF6B4A` (the HTML's `--brand-nav`), `toast
  #18181B`, `toast-t #FFFFFF`, `toast-a #A9C8B2`, `glass` (rgba(255,255,255,.9)), the status set `ok/ok-i/ok-t`,
  `warn/…`, `bad/…`, `info/…/info-b`, `bill/…/bill-b`, `res/…/res-b` with the HTML light values (staff-only names under
  the existing `status-*` scheme where they already exist; `--status-ok-ink` back to `#198038`), shadows `shadow-seg`
  (`--seg-sh`) and `shadow-pop` (`--pop`). Fonts: `font-mono` = Geist Mono, `font-brand-script` = Shrikhand.
  Breakpoints `tab:` (45rem) and `desk:` (68.75rem).

- [ ] **Step 1: tests first.** `theme-tokens.test.ts`: one assertion per new token with the HTML hex (message names the
  values § row); the status inks equal values §1.1; `fonts-paths.test.ts`: `lib/fonts.ts` loads `Shrikhand` weight 400
  through `next/font/google` with a CSS variable registered in `@theme inline` as `--font-brand-script`;
  `theme-tokens.test.ts`: `@theme inline` declares `--breakpoint-tab: 45rem` and `--breakpoint-desk: 68.75rem`;
  `ui-constants.test.ts`: the eight avatar hues map to the values §1.6 bg/fg hex. Run them: RED.
- [ ] **Step 2: implement** the tokens, the font and the breakpoints. Keep every existing token name working (other
  pages use them); where U0 changed an HTML value for contrast, the HTML value returns and `brand-contrast.test.ts` drops
  or adjusts that pair with the reason "owner's HTML value (design §9)".
- [ ] **Step 3:** the five test files GREEN; `css-compat.test.ts` GREEN; the cafe chain, typecheck, lint.
- [ ] **Step 4: commit** (one commit; the body lists every pin changed and why).

No probes for this task (it has no screen of its own); Task 2 onwards measure the tokens in use.

### Task 2: The sidebar and the rail (every page)

**Files:**
- Modify: `apps/cafe/components/layout/AppSidebar.tsx` (render the HTML nav; keep its data array, filters, warm
  routes, `prefetch={false}`, active-path helpers), `SidebarBrand.tsx` (values §2.3 brand block), the four group
  components `SidebarMenuGroup.tsx`, `SidebarTablesGroup.tsx`, `SidebarReportsGroup.tsx`, `SidebarSettingsGroup.tsx`
  (wide: sub-rows under the row; rail: a flyout panel), `SidebarAccount.tsx` (only the user card trigger here; its menu
  becomes the profile sheet in Task 4), `apps/cafe/components/ui/sidebar.tsx` (widths `14.5rem` / `4.75rem`; the
  provider, `useSidebar`, the cookie and Ctrl/⌘+B stay; the mobile sheet is no longer rendered below 720 px),
  `apps/cafe/components/brand/brand-classes.ts` (NAV classes to the HTML values), `apps/cafe/lib/pos-layout.ts` and the
  POS grid code that reads the sidebar width, `apps/cafe/app/(dashboard)/layout.tsx` (grid as values §2.2)
- Test: `lib/sidebar-paths.test.ts`, `lib/sidebar-order-paths.test.ts`, `lib/pos-layout-paths.test.ts`,
  `lib/header-quick-tabs.test.ts` (the nav literals it mirrors), `lib/settings-shell-paths.test.ts`,
  `lib/printer-ui-paths.test.ts`, `lib/kitchen-paths.test.ts`, `lib/now-serving-paths.test.ts`,
  `lib/order-request-paths.test.ts`, `lib/branding-paths.test.ts`, `lib/screen-lock-paths.test.ts`

**Interfaces:**
- Consumes: Task 1 tokens and breakpoints.
- Produces: `NAV_WIDTH_WIDE_PX = 232`, `NAV_WIDTH_RAIL_PX = 76` (exported from `lib/pos-layout.ts`, used by the POS
  grid); `navWidthPx({ viewportWidth, collapsed }): number` = `0` below 720, `232` at ≥ 1280 and not collapsed, else
  `76`; the nav item data with HTML labels (design §5.2: groups Operate / Manage; "Home", "Order", rail label
  "Bookings" for Reservations).

- [ ] **Step 1: tests first.** `pos-layout-paths.test.ts`: `navWidthPx` returns 0 / 76 / 232 / 76 for (390, false),
  (1024, false), (1280, false), (1280, true), and the grid columns the POS computes at 1280, 1280-collapsed, 1024, 820,
  390 are each ≥ 1 and the grid's total width fits the viewport minus the nav (message per width);
  `sidebar-order-paths.test.ts`: group labels "Operate" and "Manage", the item order of design §5.2, labels "Home" and
  "Order"; `sidebar-paths.test.ts`: the rail label of Reservations is "Bookings" below 1280 px or when collapsed. RED.
- [ ] **Step 2: implement** values §2.3 exactly (wide and rail; Collapse/Expand at ≥ 1280 px remembered on the device;
  the brand tile shows the cafe's uploaded logo, else the first letter in Shrikhand on `brand-red`; line 2 "{product
  name} · {device print name}"; the grey Order Requests badge; the user card). Sub-rows and flyouts per design §5.2.
- [ ] **Step 3:** the changed pins GREEN with reasons; the cafe chain, typecheck, lint.
- [ ] **Step 4: probes** for values §2.3 (nav box, brand tile, name lines, group label, separator (rail), item
  height/width/padding/font/radius/colours active and resting, active bar, badge, Collapse, divider, user card,
  avatar) at the five viewports; run; fix until clean. Also open `/pos` at the five viewports and attach a shot of each
  (Review Focus 1).
- [ ] **Step 5: commit.**

### Task 3: The page header and the request strip (every page)

**Files:**
- Modify: `apps/cafe/components/layout/Header.tsx` (values §2.5: 56 px; the title/subtitle slot; global buttons),
  `apps/cafe/components/shared/PageHeader.tsx` (keeps its props; fills the header slot, see below),
  `apps/cafe/components/layout/HeaderQuickTabs.tsx` (becomes the header's Tables (outline) and New order (primary)
  buttons, HTML sizes), `apps/cafe/components/layout/RefreshButton.tsx`, `apps/cafe/components/pos/TokenSheet.tsx`
  (trigger only), `apps/cafe/components/print/PrinterStatusButton.tsx` + `printer-classes.ts` (the 36×36 outline button
  and the 10 px dot with the 2 px surface ring at top −3 / right −3), `apps/cafe/components/orders/RequestAlertBar.tsx`
  (the strip, design §5.3; keep ≤ 150 lines and every behaviour pinned), `apps/cafe/app/(dashboard)/layout.tsx`
- Create: `apps/cafe/components/layout/page-header-slot.tsx` (a small context: the shell renders the slot, `PageHeader`
  registers `{ title, description, eyebrow, actions }` into it), `apps/cafe/lib/page-titles.ts` (route → title for the
  server render, so the title never flashes; titles equal each page's `PageHeader` title)
- Test: `lib/printer-dot-ui-paths.test.ts`, `lib/sidebar-order-paths.test.ts`, `lib/header-quick-tabs.test.ts`,
  `lib/token-sheet-paths.test.ts`, `lib/page-refresh.test.ts`, `lib/pos-layout-paths.test.ts`,
  `lib/settings-shell-paths.test.ts`, `lib/common-components.test.ts`, `lib/polish-pages-paths.test.ts` (must stay
  green: pages keep their literal `eyebrow`/`title` props), `lib/tables-floor-paths.test.ts`,
  `lib/expense-ui-paths.test.ts`, `lib/print-host-band-paths.test.ts`, `lib/self-order-alert-paths.test.ts`; new
  `lib/page-header-slot.test.ts`

**Interfaces:**
- Produces: `PageHeaderSlotProvider`, `usePageHeader()` (the shell side), `PageHeader` unchanged props; `pageTitleFor(pathname): string`.
- Rules: the header shows `pageTitleFor(pathname)` on the server render; `PageHeader` (client) sets title, subtitle
  (`description`) and actions after mount. A string `eyebrow` is not shown (the HTML header has no section line; it
  stays as the sr-only text of the title's group); a non-string `eyebrow` (a back link) renders as a 36×36 outline icon
  button before the title, keeping its href. At ≥ 720 px the page's `actions` render in the header before the global
  buttons; below 720 px they render once in a row at the top of the page body (decided by one media-query hook after
  mount, never rendered twice). The page body no longer shows `PageHeader`'s `<h2>` block; the header's title is the
  page's `<h1>`.

- [ ] **Step 1: tests first.** `page-header-slot.test.ts`: `pageTitleFor` returns each page's `PageHeader` title for
  every route in `app/(dashboard)` (one assertion per route, message names the route); `PageHeader` renders nothing in
  the body at ≥ 720 px and its actions exactly once at each width (render with a stub media hook); a non-string eyebrow
  becomes a link with its href. Update `common-components.test.ts` (the `<h2>` expectation → the header slot contract,
  reason in the commit). `printer-dot-ui-paths.test.ts`: the header order becomes: (phone) mini logo, title block, page
  actions, Tables, New order, Refresh, Tokens, printer; `sidebar-order-paths.test.ts`: header classes per values §2.5.
  RED.
- [ ] **Step 2: implement.** Header exactly values §2.5 (padding 0 20px / 0 12px, min-height 56, bottom border, sticky,
  z-index 3; title 15/600 line-height 1.2; subtitle 12 px `text-2` ellipsised; 36 px buttons: outline 1px `border`,
  radius 8, 13.5/500, gap 7, icon 15; primary `accent`, 13.5/600, gap 6, plus icon 14 stroke 2.4; labels hidden on a
  phone). Default subtitle when a page gives none: "{cafe name} · {weekday, day month}". The strip per design §5.3.
- [ ] **Step 3:** pins GREEN with reasons; the cafe chain, typecheck, lint.
- [ ] **Step 4: probes** for values §2.5 on the dashboard and on `/orders` (title, subtitle, End of day/New
  order/printer boxes and styles, the dot, mini logo on a phone) and for the strip (height, colours, font sizes) with a
  pending request in the database (create one through the demo seeder's data or `/m` locally); run; fix until clean.
  Attach shots of `/requests`, `/expenses`, `/kitchen`, `/settings/business`, `/tables/qr` at 1280 and 390 (Review
  Focus 2).
- [ ] **Step 5: commit.**

### Task 4: Phone tab bar, the More / profile sheet, Ctrl/⌘+L, toasts

**Files:**
- Create: `apps/cafe/components/layout/TabBar.tsx` (values §2.6), `apps/cafe/components/layout/ProfileSheet.tsx`
  (values §2.7 without the Theme block; rows design §5.4)
- Modify: `apps/cafe/components/layout/SidebarAccount.tsx` (the user card opens `ProfileSheet`; the dropdown goes),
  `apps/cafe/app/(dashboard)/layout.tsx` (mount the tab bar below 720 px; page bottom padding 92 px on a phone),
  `apps/cafe/components/lock/ScreenLock.tsx` (Ctrl/⌘+L → `requestScreenLock("manual")`, ignored inside inputs),
  the Toaster (`apps/cafe/components/ui/sonner.tsx` or where `<Toaster>` is configured: values §2.8 look and offsets),
  the POS cart bar (sits above the tab bar on a phone)
- Test: `lib/screen-lock-paths.test.ts` (menu items now in the sheet: same order and copy), `lib/sidebar-order-paths.test.ts`,
  new `lib/tab-bar-paths.test.ts`

**Interfaces:**
- Produces: `TAB_BAR_ITEMS` (Home `/`, Floor `/tables`, Order `/pos`, Orders `/orders`) and `moreItemsFor(role, tokensOn)`
  (every allowed destination not in the tab bar, groups with their sub-pages); `ProfileSheet({ open, onOpenChange })`.

- [ ] **Step 1: tests first.** `tab-bar-paths.test.ts`: the four tabs and More with the HTML labels; the active colour
  rule; `moreItemsFor("staff", false)` has no admin-only item; group tiles list their sub-pages; the More button's
  accessible name is "More". `screen-lock-paths.test.ts`: the sheet rows in order Lock screen, Switch user, Change
  password, Sign out with the existing copy; the footer "Auto-locks after {n} min without activity" / "Auto-lock is
  off"; Ctrl/⌘+L calls `requestScreenLock("manual")` and not inside an input. RED.
- [ ] **Step 2: implement** values §2.6, §2.7, §2.8 exactly (the phone sheet slides from the bottom over the scrim;
  tablet/desktop panel anchored as values §2.1 `menuLeft/menuBottom/menuW`); a group tile opens a second view with a back
  arrow (design §5.4).
- [ ] **Step 3:** GREEN; the cafe chain, typecheck, lint.
- [ ] **Step 4: probes** for the tab bar (bar box, tab boxes, icon size, label font, colours, glass), the sheet at 1280,
  1024 and 390 (panel box, user block, grid buttons 86.5×72 on a phone, rows 52 px, chip), the toast box at each width;
  run; fix until clean. Attach phone shots of `/pos` with a cart, `/orders` scrolled to the bottom, and a toast
  (Review Focus 3).
- [ ] **Step 5: commit.**

### Task 5: Dashboard frame, header actions, attention, period row, the card shell

**Files:**
- Modify: `apps/cafe/app/(dashboard)/page.tsx` (values §3.0 container: padding 20px 24px 28px / 16px 14px 92px, gap 16,
  no max-width; `@container` for `cw`; the title row goes (the header has it); `PageHeader` with title "Dashboard",
  subtitle "{cafe} · {today}", actions End of day + date), `apps/cafe/components/reports/EndOfDayButton.tsx` (the
  dashboard renders it in the HTML's outline 36 px style with the date as a second outline button; the reports pages
  keep their look: a `variant` prop), `apps/cafe/components/dashboard/AttentionStrip.tsx` (values §3.1, design §5.5
  mapping), `apps/cafe/components/dashboard/RangeBar.tsx` (values §3.2 on the dashboard: track 36 px, `surface-3`, radius
  9, padding 3, gap 2; buttons radius 7, 0 12px, 13 px, selected `seg` + `shadow-seg` 600 / others `text-2` 500; the
  reports pages keep theirs: a `variant` prop), `apps/cafe/components/dashboard/DashCard.tsx` (values §3.0 generic card:
  radius 14, padding 18px 20px, title 15/600, subtitle 12.5 `text-3` margin-top 3, header links 13/500 `link`, row rules
  `border-2`)
- Test: `lib/dashboard-layout-paths.test.ts`, the dashboard pins of code-map §7.3, `lib/report*` pins that read
  `RangeBar`/`EndOfDayButton` (must stay green: reports unchanged)

- [ ] **Step 1: tests first:** the attention item mapping (strong/rest/action/dot/href per design §5.5, one assertion
  each); the period track and button classes; the card shell classes; the page container padding and `@container`; the
  reports' `RangeBar` and `EndOfDayButton` classes unchanged. RED.
- [ ] **Step 2: implement** values §3.0–§3.2 exactly with our data and words; the phone attention card (closed by
  default, chevron rotation, rows 46 px, action 28 px); "All clear" state in 13 px `text-2`.
- [ ] **Step 3:** GREEN; chain, typecheck, lint.
- [ ] **Step 4: probes** (the content box per viewport from values §3.18, the attention label/chip/pill, the phone card,
  the period title/sub/track/buttons, one generic card's padding/radius/title/sub/link); run; fix until clean.
- [ ] **Step 5: commit.**

### Task 6: Net sales hero, bill breakdown, the sales mask

**Files:**
- Modify: `apps/cafe/components/dashboard/SalesHero.tsx` (values §3.3), `apps/cafe/components/dashboard/KpiChange.tsx`
  (the hero's pill and mini deltas as values §3.3 `dl()`: `↑ 12.4%`, `#6FDC8C` on `rgba(66,190,101,.16)` flattened, down
  `#FF8389`; reports keep theirs), `apps/cafe/lib/staff-pin-signin.ts` (add `verifyOwnStaffPin`), `apps/cafe/components/ui/pin-pad.tsx`
  (a `size` variant: `"reveal"` = values §3.16 keys 50 px radius 14 digits 24 px, dots 14 px with the `bad-t` fill on
  error; the default stays for Task 10)
- Create: `apps/cafe/components/dashboard/BillBreakdown.tsx` (values §3.4; the reports keep `MoneyBreakdownCard`),
  `apps/cafe/components/dashboard/SalesReveal.tsx` (the button, hint and dialog of values §3.3/§3.16), `apps/cafe/lib/sales-reveal.ts`
  (pure: `revealState({ shown, until, by, me, now })` → `{ label, icon, bg, title, hint, hintIcon, hintColor }` per the
  values §3.3 table; `maskMoney(text, shown)`; session-storage read/write), `apps/cafe/app/api/sign-in/verify-pin/route.ts`
- Test: new `lib/sales-reveal.test.ts`, `lib/staff-pin-signin.test.ts`, `lib/sign-in-paths.test.ts`, new
  `scripts/verify-staff-pin-live-cases-reveal.ts` registered in `verify-staff-pin-live.ts`, `lib/dashboard-layout-paths.test.ts`

**Interfaces:**
- `verifyOwnStaffPin({ staffId, pin, now? }): Promise<{ ok: true } | { ok: false, failure }>`: the same order as
  `verifyStaffPinSignIn` without the device check (shape → rate-limit slot → person, PIN set, not blocked → constant-time
  compare → wrong keeps the slot and counts the day; right refunds).
- `POST /api/sign-in/verify-pin` `{ pin }`: `requireAuth()`; the staff id from the session only; answers `{ ok: true }`
  or `{ ok: false, code }` with the same codes as the PIN sign-in; `Cache-Control: no-store`.
- `SALES_REVEAL_MS = 3_600_000`; storage key `pos.salesReveal` holding `{ by, until }` in sessionStorage.

- [ ] **Step 1: tests first.** `sales-reveal.test.ts`: the three states of values §3.3 (labels, titles, hints with
  minutes, colours); `maskMoney` gives "₹ • • • •" and the bill rows "• • • •"; a different `me` than `by` is masked and
  needs the PIN; expiry after 60 min. `staff-pin-signin.test.ts`: `verifyOwnStaffPin` takes a slot before the compare,
  refunds a right PIN, keeps a wrong one, answers blocked/nopin/wait. Live leg: the route refuses a signed-out caller,
  answers ok for the right PIN, a wrong PIN shows in the same window as a PIN sign-in. RED.
- [ ] **Step 2: implement** values §3.3, §3.4, §3.16, §3.17 exactly with our KPIs and our bill rows (design §5.5); the
  no-PIN messages of design §7; locking (`SCREEN_LOCK_EVENT`) and leaving the dashboard set shown to false; the toast
  "Sales visible for the next hour · tap the eye to hide".
- [ ] **Step 3:** GREEN (unit + the live leg); chain, typecheck, lint.
- [ ] **Step 4: probes** (hero box per viewport from values §3.18, padding, radius, label, the figure 60/42 px Geist Mono
  500 −0.04em line-height 1, pill, reveal button 36 px, hint, minis grid columns and value 24 px; the receipt box, head,
  rules, rows, total 22 px, torn edge; the dialog panel 360 px, keys 100.66×50, dots) masked and revealed; run; fix until
  clean.
- [ ] **Step 5: commit.**

### Task 7: Sales by hour (CSS bars) and Live tables

**Files:**
- Create: `apps/cafe/components/dashboard/HourBars.tsx` (values §3.5), `apps/cafe/lib/dashboard/hour-bars.ts` (pure:
  the window of hours (first to last hour with sales in either series, at least 8), `step`, ticks with `kf`, bar heights,
  the comparison polyline points, peak/quietest/vs per values §3.5 with our series and comparison label)
- Modify: `apps/cafe/components/dashboard/RangeCards.tsx` (`SalesCard` renders `HourBars` in hour mode; day mode
  (multi-day periods) uses the same bars per day with the values §3.5 look), `apps/cafe/components/dashboard/LiveFloorPanel.tsx`
  (values §3.6 with our tables, areas and statuses mapped to Free / Eating / Bill printed / Reserved), delete
  `apps/cafe/components/dashboard/SalesChart.tsx` and `chart-size.ts` if nothing else imports them (the chart.js
  importers pin then lists only `components/reports/ReportChart.tsx`)
- Test: new `lib/dashboard/hour-bars.test.ts`, `lib/dashboard-layout-paths.test.ts`, the chart.js importers pin

- [ ] **Step 1: tests first:** `hour-bars.test.ts`: window, step and ticks (`₹6k, ₹4k, ₹2k, ₹0` for a 5,360 max),
  heights, future hours, peak/quietest strings, vs % and colour, polyline points (values §3.5 formulas);
  LiveFloorPanel: the status mapping table and the sub line "{inUse} of {total} in use · {reserved} reserved". RED.
- [ ] **Step 2: implement** values §3.5 and §3.6 exactly (210 px plot, 70 px grid lines, bars max 34 px radius 5 5 2 2,
  the tooltip, x labels every 2nd hour (every 3rd on a phone), 92 px tiles 52 px tall).
- [ ] **Step 3:** GREEN; chain, typecheck, lint.
- [ ] **Step 4: probes** (card boxes and grid columns per values §3.18, plot box, a bar's width/radius, tick font, legend,
  footer, tables status bar, legend, zone label, tile box/padding/fonts per state); run; fix until clean.
- [ ] **Step 5: commit.**

### Task 8: Recent orders, Today's reservations, How guests paid, Where orders came from, Money leaks

**Files:**
- Modify: `apps/cafe/components/dashboard/RecentOrders.tsx` (values §3.7), `TodayReservations.tsx` (values §3.8; "Seat"
  keeps its action), `RangeCards.tsx` (`PaymentMixCard` values §3.9, `ChannelsCard` values §3.10, `LeaksCard`),
  `MoneyLeaks.tsx` (values §3.11), `RankedList.tsx` if its rows change (pinned bar class: change with reason)
- Test: `lib/dashboard-layout-paths.test.ts` and the code-map §7.3 pins of these cards

- [ ] **Step 1: tests first:** each card's row structure and words (our data: "#NNN · {table|Walk-in}", the code tile
  `T{n}`/`TA`/…, pay pill kinds; the reservation time pill; the payment total and bar; source tiles; leak rows and the
  total pill). RED.
- [ ] **Step 2: implement** values §3.7–§3.11 exactly with our data and empty/error/loading states in the card shell.
- [ ] **Step 3:** GREEN; chain, typecheck, lint.
- [ ] **Step 4: probes** (per card: box per viewport, header, a row's grid/padding/fonts/tiles/pills); run; fix until
  clean.
- [ ] **Step 5: commit.**

### Task 9: Top items, Sales by category, Slow movers, Busy hours

**Files:**
- Modify: `apps/cafe/components/dashboard/RangeCards.tsx` (`TopItemsCard` values §3.12, `CategoriesCard` values §3.13,
  `SlowItemsCard` values §3.14, `BusyHoursCard`), `apps/cafe/components/dashboard/BusyHours.tsx` (values §3.15: 30 px
  cells radius 6, 40 px day column, 13 hour columns of our heat hours, gap 4, min-width 560 with horizontal scroll on a
  phone (the HTML does not transpose), the "Busiest: …" line and the legend 14 px squares)
- Test: `lib/dashboard-layout-paths.test.ts`, the busy-hours pins

- [ ] **Step 1: tests first** (row structures, the busy-hours grid columns and the phone scroll instead of transpose,
  the legend). RED.
- [ ] **Step 2: implement** values §3.12–§3.15 exactly.
- [ ] **Step 3:** GREEN; chain, typecheck, lint.
- [ ] **Step 4: probes;** run; fix until clean. Then run all dashboard probes (Tasks 5–9) together at the five viewports
  and compare the full-page boxes with values §3.18.
- [ ] **Step 5: commit.**

### Task 10: Login, the lock cover, the staff picker, the PIN pad

**Files:**
- Modify: `apps/cafe/components/auth/AuthShell.tsx` (values §4.2: tint, top bar with the brand tile, the cafe name in
  Shrikhand 20 px `brand-red`, "{product} · {device}", the Online chip from `navigator.onLine` with the `online`/`offline`
  events, divider, clock; main padding; the card per breakpoint; the footer "Powered by Sandbee POS"),
  `apps/cafe/components/auth/PinSignIn.tsx` (values §4.3–§4.4: the head row, search, role tabs always shown (All staff /
  Admin / Staff with counts), the 6/4/3-column grid, tiles 60/52 px avatars, tile states incl. "PIN blocked" `bad-i`, the
  PIN pad view), `apps/cafe/components/ui/pin-pad.tsx` (default size = values §4.4: dots 13 px border 1.5 ink/
  `text-3`, red ring without fill after a wrong PIN, keys height 60 (phone 62) radius 10 digits 22 px, Clear 13.5 px, ⌫
  19 px, gap 10, max-width 300), `apps/cafe/app/(auth)/login/page.tsx` and `apps/cafe/components/lock/LockPasswordForm.tsx`
  (design §5.6 form style), `apps/cafe/components/lock/ScreenLock.tsx` (the cover's look only), `apps/cafe/lib/staff-display.ts`
  if the avatar colours move to `lib/ui/avatar.ts`
- Test: `lib/login-pin-paths.test.ts`, `lib/staff-pin-ui-paths.test.ts`, `lib/screen-lock-paths.test.ts`,
  `lib/common-components.test.ts` (PinPad), `lib/sign-in-paths.test.ts`, code-map §7.4 pins

- [ ] **Step 1: tests first:** the tabs show at any count; tab counts; the search filters by name; "No staff found for
  “{q}”."; tile sub states; the Online chip words; the PIN pad's dot/key classes per state; the password form classes;
  the cover still makes the tab bar and the rail `inert`. RED.
- [ ] **Step 2: implement** values §4.2–§4.5 exactly with our behaviour and messages (design §5.6).
- [ ] **Step 3:** GREEN; chain, typecheck, lint.
- [ ] **Step 4: probes** for the picker and the PIN pad at the five viewports (values §4.5 boxes: card, head, tabs,
  grid, avatar, dots row, keypad, Forgot, footer; header row elements); the login page's password form at 1280 and 390;
  run; fix until clean.
- [ ] **Step 5: commit.**

### Task 11: Whole verification (controller)

- [ ] All probe files together at the five viewports: no difference except named mapped features; side-by-side shots
  of every screen and size for the owner (`D:\kd\pos-dev-keep\ui-redesign\match\final\`).
- [ ] Every suite (cafe chain, typecheck, lint; shared; mobile and desktop if touched; print-tools; release-native),
  the live legs (staff-pin incl. the reveal cases, bootstrap, dashboard, print, appearance), a production build in
  `D:\kd\uib`, every other page's first screen (`baseline.mjs` FOLD=1) with the new shell, the local a11y check, the
  emulator on WebView 109 (`/`, `/pos`, `/orders`, the printer panel, the lock, the reveal), the S1 pin, the print
  budget, the idle request count.
- [ ] A fresh Claude Fable 5.1 whole-branch review; one fix wave; the plan's Results; the owner's preview on 3110 with
  the new build; the merge question.
