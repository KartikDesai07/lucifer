# U1: the POS terminal (/pos) rebuilt to the owner's HTML: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /pos and every dialog and sheet it opens look exactly like the owner's HTML Order screen at 1280, 1280
collapsed, 1024, 820 and 390 px, with every option /pos has today kept and placed as the design says.

**Architecture:** the HTML's measured values are the spec. Our components are rebuilt in place on the same hooks,
callbacks and requests (`usePosTab`, `buildCartProps`, `PosModals`, the print bridge stay); only markup, classes, a few
small UI-only helpers and the layout constants change. Where the HTML has no counterpart, design §6 says how our feature
is drawn. Each task ends with a measured comparison of the HTML and our dev build (`compare-ui.mjs`).

**Tech Stack:** Next.js 15.5 (app router), React 19, Tailwind v4 (tokens in `apps/cafe/app/globals.css`, breakpoints
`tab` 720 / `lg` 1024 / `desk` 1100 / `xl` 1280, the `wide` variant), the shadcn/Radix kit, next/font (Geist, Geist Mono,
Shrikhand), `node:test` + tsx source-reading tests in `apps/cafe/lib/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-20-pos-match-html-design.md` (decisions, mapping; "design §N") and
`docs/superpowers/specs/2026-10-20-pos-html-values.md` (the exact values; "values §N"). Shell and theme values:
`docs/superpowers/specs/2026-10-19-u0-html-values.md` ("U0 values §N"). What /pos has today, every word and every test
pin: `D:\kd\pos-dev-keep\ui-redesign\inventory\pos-features.md` ("inventory §N"); shots of today's page:
`D:\kd\pos-dev-keep\ui-redesign\current-pos\`.

## Global Constraints

- **The HTML's numbers are the spec.** Every element in a task's values sections takes the HTML's size, spacing, font
  family/size/weight/letter-spacing/line-height, colour, radius, border and shadow, per breakpoint, exactly. A visible
  difference that is not a mapped feature of design §6 is a defect, never a "minor"; a new one is shown to the controller
  (who asks the owner), never parked.
- **Breakpoints as the HTML** (values §0.2–0.3): phone `< 720` (`max-tab:`), tablet `720–1099`, `cmp < 1024` (`max-lg:`),
  desk `≥ 1100` (`desk:`), wide `≥ 1280` and nav not collapsed (the `wide` variant from U0). Body columns: wide
  `200px 1fr 360px`; desk not wide `220px 1fr 380px`; `1024–1099` `1fr 340px`; below 1024 `1fr` (the cart is a sheet).
- **Touch (ruling R1):** the HTML's sizes on touch screens too (no `pointer-coarse:` enlargement in rebuilt parts); 44 px
  only for our own controls the HTML has no element for. Inputs 16 px below 720 px (ruling R36).
- **Line height:** `leading-normal` where the HTML sets none (U0 values §0.3), in the rebuilt parts only.
- **Colours:** the U0 tokens (U0 values §1.1); no `light-dark()`, no runtime `color-mix()` (WebView 109; precomputed hex);
  kit files (`components/ui/*`) and anything `/m` reaches keep only preset-set tokens (`lib/kit-look-paths.test.ts`).
- **Words (owner Q1):** the HTML's words where the HTML has the same element (design §4 Q1 lists them); our words for our
  own features and data. Singular / plural ("1 item"), never the HTML's "1 items".
- **Behaviour stays:** every request and its timing, idempotent sends, the print bridge order, the wake lock, the unsaved
  guard, the Floor hand-off, self-order auto-print, the alert strip suppressed on /pos, lazy dialogs and memo boundaries,
  every validation and message (design §6.14). No new request of any kind. The only behaviour changes are the owner's:
  price buttons add directly (Q5), line selection actions (Q10), the footer links and Bill options panel (Q11), the
  Details toggle (Q12), "/" F8 F9 (Q13), Open orders search and tabs (Q16), KOT reprint in Open orders (Q17), the bar
  always shown below 1024 (Q18), category find and counts (Q15).
- **The paper never changes:** no file of the S1 43-file pin (`lib/printer/kot-text/text-kot-print.test.ts:323`), not
  `KOTReceipt`, `OrderReceipt`, `PrintSources`, `PrintBanner`, `components/print/slip/*`; `print-budget.test.ts` green.
- **Line budgets (never loosened):** `app/(dashboard)/pos/page.tsx` stays exactly 299 lines (`pos-tile-paths:69`,
  `menu-freshness-paths:123`): move code into components/hooks to make room; `PaymentModal`, `PosModals`, `PosHeader`,
  `PosPrompts` ≤ 300; `use-pos-tab.ts` ≤ 546; `PaymentPoints`, `PaymentModeGrid` as pinned.
- **Tests:** a test that pins a class string, a word or a structure this work changes is changed in the same commit, with
  the reason in the commit body (inventory §4 labels each pin L = look, G = geometry, B = behaviour, BUD = budget: L and G
  pins move with the look; B pins stay or keep their meaning; BUD pins never loosen). New test files go into
  `apps/cafe/package.json` `testChain`; every assertion carries a message. TDD for behaviour and structure (RED seen
  first). Each task ends with the cafe chain (`npm run test:chain` in apps/cafe or the package's chain script), typecheck
  and lint green.
- **The measured match (every task):** probes in `D:\kd\pos-dev-keep\ui-redesign\match\pos\probes\task-N.json` (template
  `match\probes\_template.json`; the mock's entry to Order: after sign-in click `nav button[title='Order']`, on the phone
  the tab bar's button with text exactly "Order"; `mockClock` `2026-10-19T21:30:00+05:30`; ours: `signin`, `goto /pos`).
  Cover every element of the task's values sections (props the HTML fixes; not widths that depend on text or data); add
  `data-ui="…"` in our markup where a text locator is not stable. Our data is put in the HTML's states with the local
  `patch` / `rewrite` actions where needed (e.g. `posLayout: "byCategory"` in the settings response, an open tab at a
  table). Run `COMPARE_BASE=http://localhost:3120 node D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs
  D:\kd\pos-dev-keep\ui-redesign\e2e\e2e4g-uimatch.env <probes> D:\kd\pos-dev-keep\ui-redesign\match\pos\task-N\run-<k>`
  at the five viewports. Done = `compare.md` lists no difference, or only rows the task names as mapped features. A task
  that touches the header, nav or tab bar also re-runs U0's `match\probes\task-3.json` and `task-4.json`.
- **Environment:** the dev server on `http://localhost:3120` (scratch DB `pos_scratch_e2e_4g_uimatch`, admin `e2eadmin`,
  the password from the env file, typed, never printed). Never touch :3110 (the owner's preview); never run `next build`
  in the repo; never restart the dev server (ask the controller). Read-only on data in probes and shots: never press Send,
  Pay/Place Order/Settle, Void, Move, Free table, Add customer or anything that prints (block non-GET requests in tools
  except the sign-in; answer `POST /api/print-jobs/lease` locally, as `tools\pos-current-shots.mjs` does). Local only: no
  network, no connectors, no push.
- **Commits:** on `feat/ui-pos`, one per green step, `git commit -F <file>` (message files written with the Write tool in
  the scratch space), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge.

## Review Focus

1. **Busy and frozen states across the new controls:** while an order write or print is in flight (`pos.isBusy`) or a
   send is unconfirmed (frozen cart), the price buttons, the name buttons, the cart cells, line selection and its
   actions, the footer links, the Bill options panel, the Note panel, the switch button and Open orders rows, and the F8 /
   F9 keys do nothing, exactly as today's grid is `inert` and today's controls are disabled. Owned by Tasks 3, 4, 5, 6
   (each adds a pin that the new controls carry the busy flag).
2. **Direct add from a price button (Q5):** a price button adds exactly the line today's modal would add for that product
   and variation with no option changed: no modifiers (normal), every modifier kept (reverse mode, no
   `removedModifiers`), qty 1, no instructions, the effective price after the product % discount; it merges into an equal
   unsent line; it is disabled when out of stock; more than 3 variations give one "Choose" button that opens the modal.
   Owned by Task 3 (unit tests on the pure helpers).
3. **New order vs resumed tab in the new places:** the Table cell opens the table picker for a new order and the
   move/assign dialog for a tab; Clear vs Close; Note link only for new orders; Pay disabled while a tab has unsent items
   (with today's hint); the void action only on sent lines of a tab; the promo control still offered on a tab but never
   sent (today's rule). Owned by Tasks 4 and 5.
4. **F8 / F9 never double-send:** a key does nothing while typing in a field, while any dialog / sheet / panel is open,
   while busy, or when its button is disabled; holding the key (auto-repeat) sends once. Owned by Task 5 (a pure guard
   function with tests).
5. **The shared dialogs from the Orders page and the dashboard:** settling from `OrderDetailSheet` (with and without a
   customer on the tab: the read-only pill), moving a table from it, at 1280 and 390, look as on /pos and behave as
   today. Owned by Tasks 10 and 11 (a render/pin test plus shots from `/orders`).

---

### Task 1: The /pos frame and its header

**Files:**
- Modify: `apps/cafe/lib/pos-layout.ts` (new body grid, page height and padding constants; the old two-pane and mobile
  stack constants that no longer apply are replaced, not left dead), `apps/cafe/app/(dashboard)/pos/page.tsx` (root and
  body classes; keep 299 lines), `apps/cafe/components/layout/Header.tsx` (the /pos variant),
  `apps/cafe/components/layout/HeaderQuickTabs.tsx` (hidden on /pos), `apps/cafe/components/pos/PosHeader.tsx` (the title
  becomes sr-only via the header slot; its row stays in the body until Tasks 4 and 6 empty it)
- Create: `apps/cafe/components/layout/PosHeaderBrand.tsx` (brand text + clock block), `apps/cafe/lib/pos-clock.ts`
  (`posClockLabel(now: Date): string` → "Mon, 19 Oct 9:30 PM")
- Test: `lib/pos-layout.test.ts`, `lib/pos-layout-paths.test.ts`, `lib/pos-layout-compile*.test.ts`,
  `lib/printer-dot-ui-paths.test.ts`, `lib/header-quick-tabs.test.ts`, `lib/token-sheet-paths.test.ts`,
  `lib/sidebar-order-paths.test.ts`, `lib/pos-header-paths.test.ts`; new `lib/pos-frame.test.ts`

**Interfaces:**
- Produces: `POS_BODY_GRID_CLASS` (the body grid per width, values §2.0), `POS_PAGE_CLASS` (the page fills the screen
  under the shell header: height `100dvh − 56px` with the 100vh fallback, bleeding `<main>`'s padding with
  `MAIN_PADDING_BLEED_CLASS`), `posClockLabel(now)`, `isPosPath(pathname: string): boolean` (exported from
  `lib/pos-layout.ts`), `data-ui` names `pos-header-brand`, `pos-clock`, `pos-body`, `pos-aside`, `pos-main`, `pos-cart`.
- Rules: on /pos the shell header is the HTML's Order header (values §1.2–1.4): `gap:16px`, height 56; phone: the mini
  logo; 720 px and up and not wide: the brand text (cafe name Shrikhand 20/1.1 `--brand`, line 2 = the nav's
  "{product} · {device}" line, 12/1.3 `--text-2`); no title block (the `<h1>` "POS Terminal" stays, `sr-only`); the
  actions box `flex:1; justify-content:flex-end; gap:6px; overflow-x:auto`; the clock block from 720 px (`padding-left
  16; border-left; height 28; gap 14`; "● Printer" 12 px `--text-2` with a 6 px dot coloured like the printer button's
  dot; the time 13/500 from `posClockLabel`, re-read every 60 s with `useNow(60_000)`); then Refresh, Tokens, the
  printer button. Tables / New order quick links not rendered on /pos. Room rule (design §6.1): when the actions box
  would go below the switch button's minimum, hide the brand text, then the clock block (measured with the existing
  slot measuring pattern, ruling R6).

- [ ] **Step 1: tests first.** `pos-frame.test.ts`: `posClockLabel(new Date("2026-10-19T21:30:00+05:30"))` (in IST) is
  "Mon, 19 Oct 9:30 PM", midnight "12:00 AM", noon "12:00 PM"; `isPosPath("/pos")` true, `"/pos/x"` true, `"/posx"` false;
  `Header.tsx` renders the brand/clock variant and no `HeaderQuickTabs` when `isPosPath`; the body grid literal holds
  the four column sets of values §2.0. Update the geometry pins in `pos-layout.test.ts` / `-paths` for the new grid
  (reason: design §5). RED.
- [ ] **Step 2: implement** the frame (values §1.1, §2.0, §6.2 `mainPadB` 150 / 100 / 16) and the header variant.
- [ ] **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-1.json`: values §1.4 (header, brand, clock block, printer button; actions box from its
  left edge) and §15.1 regions (aside / main / cart boxes) at the five viewports; re-run U0 `task-3.json` and
  `task-4.json`; fix until clean. Mapped: the switch button is not there yet (Task 6).
- [ ] **Step 5: commit.**

### Task 2: Categories (column and sheet) and the toolbar

**Files:**
- Modify: `apps/cafe/components/pos/CategorySidebar.tsx` (the HTML aside, values §2.1–2.4; `CategoryChips` replaced by the
  "Category" button + sheet, values §2.5–2.6, §3.1), `apps/cafe/components/pos/ProductGrid.tsx` (the sticky toolbar,
  values §3.1 and §3.3: the search box, the "/" chip, "Couldn't refresh · Try again" at the right),
  `apps/cafe/app/(dashboard)/pos/page.tsx` (keep 299 lines)
- Create: `apps/cafe/lib/pos-categories.ts` (`categoryRows(categories, products, query): CategoryRow[]`, the dot hue
  `POS_CATEGORY_HUES = ["#E8590C","#C92A2A","#D19A00","#1C7ED6","#AE3EC9"]` by position)
- Test: `lib/pos-layout-paths.test.ts`, `lib/category-readers-pins.test.ts`, `lib/menu-freshness-paths.test.ts`; new
  `lib/pos-categories.test.ts`

**Interfaces:**
- Produces: `CategoryRow = { key: string; name: string; count: number; hue: string | null }` (`key` "All" or the category
  `_id`); `categoryRows` puts "All items" (count = all products shown on /pos, no hue) first when the query is empty, then
  every category whose name contains the query (case-insensitive), in the categories' order, with its product count and
  `POS_CATEGORY_HUES[i % 5]` by its position among all categories (so a filter does not recolour rows).
- Rules: "Categories" + "{n} total" (n = number of categories); "Find category" (13 px; 16 px below 720 px) shared by the
  column and the sheet (one state in the page or the component); rows 34 px (44 on the phone), selected `--accent-t` /
  `--accent-i` 600, count `--accent-i` / `--text-3`, hover `--surface-2` (design §8); picking a row closes the sheet; the
  sheet: values §2.6 (bottom, 82dvh max, "Categories" 16/600 + "Done" 15/500 `--link`). Keep `<nav aria-label="Product
  categories">`, `aria-current` on the selected row, `title` on names, `value={c._id}` ×2 (B pins). The search input keeps
  `type="search"`; placeholder "Search items" (Q1); `data-ui="pos-search"` for the "/" key (Task 5).

- [ ] **Step 1: tests first.** `pos-categories.test.ts`: rows for 3 categories and 5 products (counts, "All items" first,
  hues by position, a query keeps the matched rows' hues, an empty match gives []); paths: the chips and `w-44` pins
  replaced by the aside's `200px`/`220px` column (reason: design §6.3); RED.
- [ ] **Step 2: implement.** **Step 3:** pins green; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-2.json`: values §2.4, §2.6 (sheet at t1024 / t820 / p390), §3.3 (toolbar, search box,
  "/" chip, Category button), the find-box typed state; mapped: no diet filter (design §6.3, owner Q7), no "Popular"
  row and no section headings (design §6.3), counts on every row (owner Q15).
- [ ] **Step 5: commit.**

### Task 3: Item cards, groups and direct add

**Files:**
- Modify: `apps/cafe/components/pos/ProductCard.tsx` (the HTML card, values §4.1–4.6), `ProductGrid.tsx` (the grid, the
  Normal / By category layouts, skeletons, empty and no-results states), `apps/cafe/app/(dashboard)/pos/page.tsx`
  (`handleProductClick` → the price-button add; `handleProductOptions` stays for the name; keep 299 lines)
- Create: `apps/cafe/lib/pos-price-buttons.ts`
- Test: `lib/pos-tile-paths.test.ts`, `lib/pos-layout-paths.test.ts`, `lib/variation-paths.test.ts`,
  `lib/removed-modifiers-paths.test.ts`, `lib/menu-freshness-paths.test.ts`; new `lib/pos-price-buttons.test.ts`

**Interfaces:**
- Produces: `priceButtonsFor(product: Product): PriceButton[]` with `PriceButton = { label: string; price: number;
  variation?: string; opensOptions: boolean }`: no variations → `[{label:"Add", price: effective}]`; 1–3 variations →
  one per variation, `label = shortSize(name)` (`Regular`→`Reg`, `Medium`→`Med`, `Large`→`Lrg`, `Standard`→`Add`, else
  the name), price = the variation's effective price; > 3 → `[{label:"Choose", price: min, priceMax: max, opensOptions:
  true}]` (shown "₹a–₹b"). `defaultAddOptions(product, variation?): AddToCartOptions` = exactly what `ModifierModal`
  would pass on "Add" with nothing changed (normal: `modifiers: []`; reverse mode: all modifiers, no
  `removedModifiers`; `qty: 1`; `instructions: ""`; the variation). `cardTag(product, opts): { text: string; tone:
  "bad" | "plain" }` (design §6.4 order: "Unavailable" bad / "{n}% off" / "Customisable" / category name / "\u00a0").
- Rules: the card per values §4.1 (radius 14, padding 12, gap 10, hover lift −2 + `0 10px 26px rgba(0,0,0,.08)`, in cart
  accent border + `0 0 0 1px` ring + the 20 px qty badge with `pop`; out of stock opacity .45, the photo `grayscale(1)`,
  both buttons disabled); photo area (values §4.1, §4.6: 112 / 96 px, radius 10, `--surface-2`, cover) only when the
  product has an image (`productImageUrl`), via `next/image` sized to the box; name 14.5/500 −.005em one line ellipsis
  with `title`; tag 12 px; the price strip `--surface-2`, radius 8, padding 2, gap 2, buttons `priceH` 40 (desk) / 46,
  label 10.5 `--text-2`, price 13.5/600, line-height 1.15, hover `--surface` + `0 1px 2px rgba(0,0,0,.1)`, active
  `--accent-t`; title "Add {label}". Groups (By category): heading values §4.1 ("● name count", 13.5/600, dot = the
  category's hue from Task 2), 24 px apart, "Other" last; Normal: one grid, no heading. Grid
  `repeat(auto-fill,minmax(min(200px,100%),1fr))` gap 8. Busy: the grid stays `inert` (as today). The tile's corner
  options button goes (the name opens the modal): the name button's `aria-label` is "{name}: Add with note or quantity"
  (the pinned literal kept after the visible name), the qty badge keeps "{qty} in cart".
  Skeletons: 117 / 123 px HTML-shaped; "No results for “{q}”" for a search with no hit, our "No products found" for an
  empty category, the load error line in the same style.

- [ ] **Step 1: tests first.** `pos-price-buttons.test.ts`: plain, discounted (effective price), 2 and 3 variations
  (labels Reg/Lrg, "Half"), 4 variations ("Choose", min, max), out of stock (still built; disabled is the card's job),
  reverse-mode defaults (all modifiers, no removed), normal defaults (none); `cardTag` order; paths: no `NotebookPen`
  corner button, the price buttons call the add with `defaultAddOptions` (reason: owner Q5); RED.
- [ ] **Step 2: implement.** **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-3.json`: values §4.3–4.5 with ours in "By category" (`patch` the settings response) and in
  Normal (cards only), an in-cart card (click a price), an out-of-stock card, a 2- and 3-variation card, the phone single
  column, a hovered card and price button; mapped: no veg mark (Q7; the name starts at the mark's x), photo area only
  with a photo (Q6; our scratch data has none), tag words (design §6.4).
- [ ] **Step 5: commit.**

### Task 4: Cart head, cells and lines

**Files:**
- Modify: `apps/cafe/components/pos/Cart.tsx` (split: the head and the lines move to new files; keep the root `cn()` look
  pin updated on purpose), `CartLine.tsx`, `CartSentSection.tsx`, `PosHeader.tsx` (the Table and Customer chips leave the
  header row: they live in the cells; `disabled={isBusy}` counts change on purpose), `TableSelector.tsx` and
  `CustomerSearch.tsx` (their triggers become the cells; the dialogs restyle in Task 11), `VoidItemDialog.tsx`
  (`initialLine?: { index: number; lineKey: string }` preselects a line; nothing else), `apps/cafe/lib/pos-cart-props.ts`
  (only if the cells need a prop it does not pass today)
- Create: `apps/cafe/components/pos/CartHead.tsx`, `apps/cafe/components/pos/CartLines.tsx`,
  `apps/cafe/lib/pos-cart-view.ts`
- Test: `lib/pos-layout-paths.test.ts`, `lib/pos-header-paths.test.ts`, `lib/pos-send-paths.test.ts`,
  `lib/variation-paths.test.ts`, `lib/removed-modifiers-paths.test.ts`, `lib/reward-void-trail.test.ts`; new
  `lib/pos-cart-view.test.ts`

**Interfaces:**
- Produces: `lineMeta(item: OrderItem): string` (variation, "+ add-ons", "NO removed", instructions, joined ", "),
  `lineNumber(i: number): string` ("01"), `cartTitle(view): string` ("Table T-4" / "Walk-In" / "New order"),
  `tabMeta(order: Order, now: Date): string | null` ("#012 · 32 min": the last segment of `orderId`, minutes since
  `createdAt`, `Math.max(1, round)`), `tableCellValue(table, areaName): string` ("T-4 · Indoor" / "Walk-In").
- Rules: values §5.1–5.4, §5.6, §5.7. Head: title 20/600 −.015em; meta Geist Mono 12 `--text-2`; Clear (new order with
  items) / Close (a tab) 26 px `--bad-i`, hover `--bad-t`. Two cells (grid `repeat(2,minmax(0,1fr))`, the HTML's 3-cell
  borders): Table (new order → `TableSelector`'s dialog; a tab → the move/assign dialog), Customer (name / "Add" →
  `CustomerSearch`'s dialog); disabled while busy; titles / aria as today's chips (`Table {n}`, `Select table
  (Walk-In)`, `Customer: {name}`, `Select customer`, `Move {id} to another table`, `Assign a table to {id}`). Lines: the
  HTML grid line; sent lines first, locked, "×{qty}" (13/600 `--text-2`) in the stepper place; new lines with the
  stepper (desk 30/28, else 36/34; − "Remove one" / + "Add one" titles, today's aria-labels "Decrease quantity" /
  "Increase quantity" kept); status "Sent to kitchen" (`--ok` dot, `--text-2`) / "New · not sent" (`--warn` dot,
  `--warn-i`). Selection: tap a line (not its stepper) → `--accent-t` + `inset 0 0 0 1px var(--accent-b)`; an action row
  under it (12.5/500 `--link`): "Remove" (new line → today's remove) / "Void" (a sent line on a tab → the void dialog with
  `initialLine`); one selected at a time; none while busy or frozen. "Add items to fire another round." under the lines.
  Empty: "No items" 15/600 + "Tap a price on the menu to add an item." 13 `--text-2`.

- [ ] **Step 1: tests first.** `pos-cart-view.test.ts` for the helpers (a variation + 2 add-ons + instructions; reverse
  mode NO lines; a walk-in tab title; meta at 0 / 31.6 / 68 minutes; area-less table); paths: no trash button in
  `CartLine`, the action row's Remove calls `onRemove(lineId)`, Void opens the dialog with the line (reason: owner Q10);
  `PosHeader` without the chips (reason: owner Q9); RED.
- [ ] **Step 2: implement.** **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-4.json`: values §5.2, §5.4, §5.6 (head, cells, three lines, stepper, status), §5.7 empty,
  selected, at d1280 / c1280 / t1024 (t820 / p390 with Task 7); ours: add three products (one variation) and (state 2)
  a resumed tab (`rewrite`/click an open tab) for sent lines; mapped: two cells (Q9), "×qty" on sent lines, the action
  row (Q10), our titles and meta.
- [ ] **Step 5: commit.**

### Task 5: Cart footer: links, Bill options, Note, bill, notices, buttons, keys

**Files:**
- Modify: `apps/cafe/components/pos/Cart.tsx` (the footer; `CartActions` keeps `className={POS_CART_CTA_CLASS}` on every
  Button or the pin changes on purpose), `CartMoreMenu.tsx` → becomes the Bill options panel, `CartReward.tsx`,
  `CartRewardCards.tsx`, `CartPromo.tsx`, `CartExtraCharges.tsx`, `CartAppliedRows.tsx`, `CartNotes.tsx` (the Note panel),
  `CartUnavailableNotice.tsx`, `WriteNotice.tsx` (look only; the tone literals stay), `SendDiscard.tsx` (slot only),
  `apps/cafe/app/(dashboard)/pos/page.tsx` (the keys component; keep 299 lines)
- Create: `apps/cafe/components/pos/CartFooterLinks.tsx`, `apps/cafe/components/pos/BillOptionsPanel.tsx`,
  `apps/cafe/components/pos/CartBill.tsx`, `apps/cafe/components/pos/PosKeys.tsx`, `apps/cafe/lib/pos-keys.ts`,
  `apps/cafe/hooks/use-window-height.ts`
- Test: `lib/pos-layout-paths.test.ts`, `lib/gst-discount.test.ts`, `lib/charge-ui-paths.test.ts`,
  `lib/staff-reward-cards-paths.test.ts`, `lib/order-reward-fence.test.ts`, `lib/reward-wiring.test.ts`,
  `lib/menu-freshness-paths.test.ts`, `lib/pos-send-paths.test.ts`, `lib/settings-branding.test.ts`; new
  `lib/pos-keys.test.ts`, `lib/pos-footer.test.ts`

**Interfaces:**
- Produces: `BillSection = "reward" | "promo" | "discount" | "charges"`; `footerLinks(view): FooterLink[]` with
  `FooterLink = { key: BillSection | "note"; label: string; applied: string | null }` (labels "Discount", "Promo code",
  "Reward" (only with a customer having stamps, rungs or cards), "Extra charge", "Note" (new orders only); applied text
  "Discount · ₹50" / "Discount · 10%" / "GST Discount", "Promo · {code}", "Reward · {worth}", "Extra charge · {n}", "Note ·
  {first 24 chars…}"); `posKeyAction(e: { key: string; repeat: boolean; target: EventTarget | null }, s: { dialogOpen:
  boolean; busy: boolean; sendEnabled: boolean; payEnabled: boolean }): "search" | "send" | "pay" | null`;
  `useWindowHeight(): number`.
- Rules: values §5.5. Links row 12.5/500 `--link`, gap 4×16, an applied link `--accent-i` 600. `BillOptionsPanel`: the
  HTML popover (values §5.3 frame: white, 1px border, radius 12, `--pop`, padding 14, gap 12; "Bill options" 13/600 +
  "Done" 13.5/600 `--link`), opening upward over the lines, its sections in today's order with 12/600 `--text-2`
  captions (Reward, Promo code, Discount, Extra charges), the tapped section scrolled into view and its first field
  focused; every control inside keeps today's words, rules, aria-labels and disabled rules (the More menu's pinned order
  becomes the panel's; `aria-label="Discount value"`, `"₹"`/`"%"`, `GST_DISCOUNT_LABEL`); the ₹/% toggle in the HTML's
  segmented look; fields 34 px radius 8 13.5 px (16 below 720). Note panel: same frame, "Order note", the 200-char field,
  "Done". Bill (`CartBill`): `billOpen = toggled ?? useWindowHeight() >= 820`; "Total" 15/600 + "Details" / "Hide details"
  12/500 `--link`; total 26/600 −.02em; rows per design §6.8 with "Remove" links (12 px `--link`) and the table charge's
  small 13 px amount field + "Undo". Notices: the HTML note box (radius 10, padding 14, 13.5 px, line-height 1.5) in
  warn / bad / neutral tones. Buttons: grid `1fr 1.4fr` gap 8, 50 px, radius 10; "Send KOT · {newQty}" 14.5/600 with
  `1px solid var(--ink)` | "Pay ₹{total}" 15/600 accent; "All sent" opacity .5 disabled; empty Pay opacity .4; key chips
  Geist Mono 11 from 720 px; a tab: Pay disabled while new items exist + the hint; "Sending…", "Send again" | "Discard".
  `PosKeys` (rendered once by the page): window keydown → `posKeyAction` → focus `[data-ui='pos-search']` / click the
  enabled Send / Pay button (`data-ui="pos-send"`, `data-ui="pos-pay"` on the visible cart); `dialogOpen` = any open
  `[role=dialog]`, the cart sheet below 1024 excepted when it is the only one.

- [ ] **Step 1: tests first.** `pos-keys.test.ts`: "/" from the body → search, "/" in an input → null; F8 with
  `sendEnabled` → send, repeat → null, typing in an input → null, dialog open → null, busy → null, disabled → null; same
  for F9; other keys null. `pos-footer.test.ts`: `footerLinks` for a new order, a tab (no Note), a customer with / without
  rewards, each applied text. Paths: the More menu's contents now inside `BillOptionsPanel` (reason: owner Q11); RED.
- [ ] **Step 2: implement.** **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-5.json`: values §5.5–5.6 footer (links, closed / open details, the total row, buttons and
  chips, hover), §5.7 empty (All sent, Pay ₹0) at d1280 / c1280 / t1024; ours with a discount applied (open the panel,
  type 10 %) for the details rows; mapped: our link set (Q11), the Bill options panel, our bill rows' words, the
  table-charge field.
- [ ] **Step 5: commit.**

### Task 6: Switch order button and the Open orders panel

**Files:**
- Modify: `apps/cafe/components/pos/PosHeader.tsx` (becomes the switch button, portaled into the header's actions box at
  every width through `PageHeader phoneActions`; `PosTableHandoff` stays), `apps/cafe/components/pos/OpenTabsButton.tsx`
  (the HTML panel instead of today's dialog; KOT reprint at its foot), `apps/cafe/app/(dashboard)/pos/page.tsx` (props;
  keep 299 lines)
- Create: `apps/cafe/lib/pos-open-orders.ts`
- Test: `lib/pos-header-paths.test.ts`, `lib/pos-send-paths.test.ts` (the `disabled={isBusy}` counts), `lib/print-*`
  pins that name the KOT reprint (`print-agent-paths`, `print-token-lanes-paths`); new `lib/pos-open-orders.test.ts`

**Interfaces:**
- Produces: `switchView(pos view, openTabs: Order[]): { code: string; title: string; sub: string; count: string; dot:
  "empty" | "unsent" | "sent" }`; `codeOf(tableNo?: string, walkIn: boolean, isNew: boolean): string` ("T" + digits of
  the table name, else its first two letters upper-case; "WI"; "+"); `openOrderRows(tabs: Order[], current: string |
  undefined, q: string, tab: "All" | "Tables" | "Walk-In", now: Date): OpenOrderRow[]` (filter by table, customer name,
  order id; current first, then newest `createdAt` first); `openOrderCounts(tabs)` → `{ All, Tables, "Walk-In" }`.
- Rules: values §1.2 (switch button: 42 px, radius 12, padding 0 10 0 6, gap 10, max-width 340 / phone flex 1; code tile
  30 `--ink`, dot 9 with the 2 px ring: `--text-3` / `--warn` / `--ok`; title 14/600/1.2; sub 11.5 `--text-2`/1.3; count
  pill 22 `--surface-3`; chevron 16 `--text-3`; hover `--text-3` border + `0 4px 14px rgba(0,0,0,.06)`) and values §7
  (scrim `rgba(0,0,0,.06)` / phone `--scrim`; panel 420 top right under the header with padding 62/16/16, max-height
  `min(640px, calc(100dvh − 80px))`, phone bottom sheet 86dvh radius 18 18 0 0; head: "Open orders" 16/600 + "{N} open ·
  ₹{sum}"; search 40 px radius 10 `--surface-2`, 15 px (16 below 720), placeholder "Table, customer, phone or order #",
  focused on open from 1100 px only; tabs All / Tables / Walk-In with grey counts (SEG_ON / SEG_OFF); rows 54 px: tile
  36 radius 10 (current `--accent` / `--on-accent`, others `--surface-3`), id 14/600 ("{Table T-4 | Walk-In}" + " ·
  current"), sub 12 `--text-2`, total 14/600, status "In kitchen" 11.5/500 `--ok-i`; current row `--accent-t`; rows
  hover `--surface-2`; `rise` stagger; "No open orders match “{q}”"; our empty state words). Tapping a row =
  `onResume(tab)` (today's prompt rules), closes. Foot (only when `lastOrder`): one 40 px outline button "Print kitchen
  ticket · {orderId}", title / aria "Print kitchen ticket for {orderId}", `disabled={isBusy}`, → `onReprintKot`. Escape /
  scrim close. Busy: the switch button stays openable, rows and the reprint are disabled.

- [ ] **Step 1: tests first.** `pos-open-orders.test.ts`: codes ("T-4" → "T4", "Rooftop" → "RO", walk-in "WI", new
  "+"), sub with 0 / 1 / 5 items ("No items yet", "1 item", "5 items"), dots, rows filter (table, customer, order id,
  no match), tab counts and filter, order (current first, newest next); paths: the KOT reprint lives in OpenTabsButton
  with today's title (reason: owner Q17); RED.
- [ ] **Step 2: implement.** **Step 3:** pins green with reasons; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-6.json`: values §1.4 (switch button and its parts at the five viewports), §7.3 (panel,
  head, search, tabs, rows, the empty search); ours with the 3 open tabs of the scratch data; re-run U0 `task-3.json` and
  `task-4.json`; mapped: our tabs (Q16), no footer buttons, the reprint foot (Q17), "In kitchen" for every tab (we have no
  billed state).
- [ ] **Step 5: commit.**

### Task 7: Order bar and the cart sheet (below 1024 px)

**Files:**
- Modify: `apps/cafe/components/pos/MobileCartBar.tsx` (the HTML glass bar, always shown below 1024; the sheet frame),
  `apps/cafe/lib/pos-layout.ts` (bar and sheet constants), `apps/cafe/app/(dashboard)/pos/page.tsx` (keep 299 lines),
  `apps/cafe/components/pos/CartHead.tsx` ("‹ Menu")
- Test: `lib/pos-layout-paths.test.ts`, `lib/pos-layout.test.ts`, `lib/tab-bar-paths.test.ts`, `lib/unsaved-guard-paths
  .test.ts`

**Interfaces:**
- Consumes: Task 4's `cartTitle`.
- Rules: values §6.1–6.3. Bar: fixed, left 76 px from 720 px (0 on the phone; the rail width, `wide`/collapsed as the
  nav), bottom 59 px on the phone (on the tab bar, design §8), 0 at 820; `--glass` + `saturate(180%) blur(20px)`, top
  border, padding 10 14, gap 12; line 1 12 px `--text-2` ("{n} item(s) · {title}", or "No items · New order", "Adjustment
  still applied", "Couldn't confirm"); line 2 ₹total 18/600 −.015em; "Review order" 44 px radius 10 15/600 padding 0 20.
  Always shown below 1024 (owner Q18). Sheet: phone full screen over the header and the tab bar (z above 12), no shadow;
  720–1023 440 px (`min(440px,100%)`) from the right, `--pop`, over a `--scrim` that covers the rail; no entrance
  animation; "‹ Menu" (30 px, 15 px `--link`, chevron 18 stroke 2.2) closes it; Escape closes; focus stays trapped
  (Radix). `main` bottom padding 150 (phone) / 100 (720–1023). The sheet closes on its own when the cart is truly empty
  (today's rule).

- [ ] **Step 1: tests first.** Paths: the bar has no `xl:` gate (`max-lg:` instead), the empty-cart branch renders the
  bar (reason: owner Q18), the sheet keeps the sr-only title "Your cart"; geometry pins for 150 / 100; RED.
- [ ] **Step 2: implement.** **Step 3:** pins green; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-7.json`: values §6.1 bar (t820, p390), §6.3 sheets with the cart parts of Tasks 4–5 at
  t820 / p390 (head, cells, lines, footer, details open by default at these heights); re-run U0 `task-4.json` (tab bar);
  mapped: the bar on an empty order (Q18), the bar on the tab bar (design §8).
- [ ] **Step 5: commit.**

### Task 8: Item options modal

**Files:**
- Modify: `apps/cafe/components/pos/ModifierModal.tsx` (look only; its state, reset and add call unchanged)
- Test: `lib/variation-paths.test.ts`, `lib/removed-modifiers-paths.test.ts`, `lib/pos-modals-paths.test.ts`

**Interfaces:**
- Consumes: Task 3's `defaultAddOptions` is not used here (the modal builds its own options as today).
- Rules: values §10. Panel 440 (phone bottom sheet), no border, radius per `sheetRadius`; head 16/18 padding, the name
  17/600 −.01em, "✕" 28 px `--surface-3`; body padding 16/18 gap 18; "Size" (our variations, required, none selected,
  label = full name 12 `--text-2`, price 14/600; segments 44 px SEG_ON / SEG_OFF) only for variation products;
  "Add-ons" rows 42 px with the 18 px check box (accent when on), no prices; reverse-mode hint 12 px `--text-2`; "Kitchen
  note" = our instructions field (48 px, radius 12, 1.5 px `--border`, 15 px; 16 below 720; placeholder "e.g. less spicy,
  no onions"); footer: stepper 46 (− / + 42×44, qty 15/600) + "Add to order · ₹{unit × qty}" 46 px accent (disabled
  "Pick a variation"). Keep the Dialog's title / description semantics (sr-only description where the HTML shows none).

- [ ] **Step 1:** pins for the words that change ("Variation (required)" → "Size", "Instructions (optional)" →
  "Kitchen note", "Add {n} — ₹x" → "Add to order · ₹x"; reason: owner Q1); RED. **Step 2: implement.** **Step 3:** green;
  chain, typecheck, lint.
- [ ] **Step 4: probes** `task-8.json`: values §10.3 for a variation + add-on product (ours: a shake), a plain product
  (no Size block: mapped), the selected state, the phone sheet.
- [ ] **Step 5: commit.**

### Task 9: Payment sheet (shared)

**Files:**
- Modify: `apps/cafe/components/pos/PaymentModal.tsx` (≤ 300 lines), `PaymentSummary.tsx`, `PaymentModeGrid.tsx`,
  `PaymentSplitFields.tsx`, `PaymentPoints.tsx`, `WriteNotice.tsx` (look), `CustomerSearch.tsx` (the pill trigger only;
  the dialog in Task 10)
- Test: `lib/payment-result.test.ts`, `lib/settle-points-paths.test.ts`, `lib/settle-points-view.test.ts`,
  `lib/settle-flow-paths.test.ts`, `lib/gst-discount.test.ts`, `lib/customer-privacy-paths.test.ts`

**Interfaces:**
- Rules: values §11 frame (420, no border, padding 18 18 `cartFootB`, gap 16; phone bottom sheet). Title "Payment ·
  {Table T-4 | Walk-In | New order}" 16/600 (the tab's / sale's table; `OrderDetailSheet` passes what it has) + "✕" 30
  px; "Amount to collect" 13 `--text-2`, the total 36/600 −.025em; the pill (28 px, radius 999, `--surface-2`, 12.5/500):
  "+ Add customer" `--link` / "Customer: {name} · change" `--text` where the picker is offered, read-only "Customer:
  {name}" on a tab that has one (design §6.11), nothing when neither; our summary rows (13 px `--text-2` / values
  `--text`); the bill-changed warning; the points row; methods: the 5-column track `--surface-3` radius 10 padding 3 gap
  3, buttons 40 px 13.5/600 SEG_ON / SEG_OFF with our five modes (the per-mode colours go: the selected look is the
  HTML's); Cash / Online: "Amount received" caption + one 44 px field ("₹" prefix 13 `--text-2`, value 15/600 right), Cash
  "Change to return" 14 `--text-2` + 22/600 `--ok-i` with the top border; the partial line 12.5 `--warn-i`; Split: two
  boxes (Cash with the 1 px `--accent` border, Online), our "must equal" line; Due / Credit: the note box (warn colours
  without a customer); validation lines 12.5 `--bad-i`; "Served by {name}" 12 `--text-3` centred; main button 50 px
  radius 10 15/600 with today's labels and states. No quick amounts (owner Q14). Behaviour, reset rules, lock rules,
  counts (`disabled={locked}` ×4, `disabled={isSubmitting}` ×1) unchanged.

- [ ] **Step 1:** pins for the look that changes (PAY_STYLES colours on the mode grid; reason: the HTML's segmented
  look) and a test that the read-only pill shows a tab's customer when `onSelectCustomer` is absent; RED. **Step 2:
  implement.** **Step 3:** green; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-9.json`: values §11.3 (Cash; Split; Due without / with a customer; Online against the
  HTML's UPI frame, mapped: ours is an amount field, the HTML's a note) at the five viewports, opened by Pay with 3 items
  (never confirm); shots of the
  same sheet from `/orders` (settle a tab) at 1280 and 390 (Review Focus 5).
- [ ] **Step 5: commit.**

### Task 10: Customer sheet (shared)

**Files:**
- Modify: `apps/cafe/components/pos/CustomerSearch.tsx` (the dialog and the add form; trigger variants from Tasks 4 / 9)
- Test: `lib/pos-header-paths.test.ts`, `lib/customer-privacy-paths.test.ts`, `lib/reward-wiring.test.ts`

**Interfaces:**
- Rules: values §8 (sheet 460, height 600 / phone 88dvh, radius `sheetRadius`; head 16 16 12: title 17/600 "Customer",
  sub 12.5 `--text-2` = today's description; ✕ 32 round `--surface-3`; the search field 48 px radius 12 1.5 px
  `--accent` + `0 0 0 4px var(--accent-t)`, 15 px (16 below 720), placeholder "Phone number or name"; before a search
  today's line "Search by name or mobile, or add a new customer." in the list area; caption 11.5/600 uppercase
  `--text-3` when results show; rows 9/10 padding radius 10: avatar 38 initials (U0 avatar tints by name), name 14/600,
  mobile 12.5 Geist Mono `--text-2` (masked for staff by the server, as today), right "{n} visits" + "Due ₹x" `--bad-i`,
  a check on the current one; our searching / offline / failed / no-match lines; foot: 46 px "+ New customer" accent and
  our "Walk-In" as the 36 px link button. Add form: "Mobile number" (+91 prefix Geist Mono, 48 px) then "Name" (48 px),
  12.5/600 captions, our rules and messages, "Add customer" 48 px; the back button 32 px. Behaviour, debounce,
  min-chars, the stale-row guard unchanged.

- [ ] **Step 1:** pins for the words that change (placeholder; "New" → "+ New customer"; reason: owner Q1); RED.
  **Step 2–3:** implement; green; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-10.json`: values §8.6 (search, results for a typed name, no match, the new form) at the
  five viewports; mapped: no frequent list (design §4), our row content.
- [ ] **Step 5: commit.**

### Task 11: Table picker and Move / Assign (shared)

**Files:**
- Modify: `apps/cafe/components/pos/TableSelector.tsx` (the dialog), `apps/cafe/components/orders/MoveTableDialog.tsx`,
  `apps/cafe/components/orders/MoveTablePicker.tsx`
- Test: `lib/table-areas-picker-paths.test.ts`, `lib/table-areas-gate.test.ts`, `lib/charge-ui-paths.test.ts`,
  `lib/print-routing*.test.ts` (MoveTableDialog stays lazily imported), `lib/table-flow-paths.test.ts`

**Interfaces:**
- Rules: values §9 (sheet 600, max-height `calc(100dvh − 32px)` / 88dvh; head "Choose a table" 17/600 + sub 12.5
  `--text-2` = today's description for the selector, "Move {id} to another table" / "Seat {id} at a table" style subs are
  NOT ours: our move/assign descriptions stay; legend Free / Has an order · tap to open / Reserved; areas 12/600 uppercase
  + "{n} FREE"; tiles `repeat(auto-fill,minmax(92px,1fr))` 78 px radius 12 1.5 px border: Free (`--surface` / `--border`
  / `--ok` / "Free" `--ok-i`), an occupied table with an open tab ("₹x open", `--info-t` / `--info-b` / `--info` /
  `--info-i`; tap = resume), occupied without a tab ("Occupied", disabled, `--surface-2` / `--text-3`), Reserved
  (`--res-t` / `--res-b` / `--res` / "Reserved" `--res-i`, disabled), the chosen / current table ("Current", accent +
  `0 0 0 3px var(--accent-t)`); "{capacity} seats" 11 px; `rise` stagger; "Walk-In (no table)" 46 px full width at the
  foot (selector only). Move: the same grid, our confirm step in the HTML note box, "Remove from table" red link,
  "Cancel". The `grid grid-cols-4` / `grid-cols-3` pins change on purpose (reason: the HTML's auto-fill grid).

- [ ] **Step 1:** pins updated with reasons; a test that occupied-with-tab tiles still resume and others stay disabled;
  RED. **Step 2–3:** implement; green; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-11.json`: values §9.3 at the five viewports with our 10 tables / 3 areas; shots of the
  move dialog from a resumed tab and from `/orders` (never confirm); mapped: our statuses and words.
- [ ] **Step 5: commit.**

### Task 12: Void dialog and the confirms

**Files:**
- Modify: `apps/cafe/components/pos/VoidItemDialog.tsx` (look), `apps/cafe/components/shared/ConfirmDialog.tsx` (an
  optional `look?: "default" | "sheet"`, default unchanged), `apps/cafe/components/pos/PosPrompts.tsx`,
  `apps/cafe/components/pos/SendDiscard.tsx` (pass `look="sheet"`)
- Test: `lib/pos-modals-paths.test.ts` (`<ConfirmDialog` ×3, memo), `lib/pos-send-paths.test.ts` (S12),
  `lib/variation-paths.test.ts`, `lib/reward-void-trail.test.ts`; new `lib/confirm-dialog-look.test.ts`

**Interfaces:**
- Rules: `look="sheet"` = values §12.1 (panel 420, 1 px border, `sheetRadius`, `--pop`, padding 20, gap 16; title 18/600
  −.01em; body 14 `--text-2` line-height 1.5; buttons stacked 46 px radius 10 14.5/600: the action `--accent` (or
  `--bad` / white when `destructive`), then cancel `--surface-3` / `--text`; phone bottom sheet); the default look is
  byte-for-byte today's for every other caller. Void: the same frame; the sent lines as 42 px rows with a round check
  (one choice); the 46 px stepper; "Reason (required)" 48 px field; the `--bad` "Void item" button; "Cancel" link; words
  unchanged; preselected line from Task 4.

- [ ] **Step 1:** `confirm-dialog-look.test.ts`: the default branch's classes equal today's (reason: 30 other callers),
  the sheet branch's per values §12.1; RED. **Step 2–3:** implement; green; chain, typecheck, lint.
- [ ] **Step 4: probes** `task-12.json`: the HTML confirm (values §12.1 `confirm-unsent`) against our "Discard unsent
  items?" (resume a tab with a new item, then tap another tab) at the five viewports; the void dialog (shots only).
- [ ] **Step 5: commit.**

### Task 13: Whole verification (controller)

- [ ] All `match\pos\probes` files together at the five viewports (+ U0 `all-probes.json` + `task-10.json` for the
  shell): no difference except named mapped features; side-by-side shots of every state and size for the owner in
  `D:\kd\pos-dev-keep\ui-redesign\match\pos\final\shots\` (an `index.html` as U0's).
- [ ] Every suite (cafe chain, typecheck, lint; shared; mobile and desktop if touched; print-tools; release-native), the
  live legs (dashboard, print, staff-pin), a production build in `D:\kd\uib` (stop :3110 first; serve again after), every
  page's first screen (`baseline.mjs` FOLD=1), the local a11y check on /pos, the idle request count on /pos (240 s,
  equal to main's), the S1 pin, the print budget, the emulator on WebView 109 (/pos at the tablet and phone sizes, the
  cart sheet, payment, the 99 % sheet opacity check of ruling R41; WebView 154 put back after).
- [ ] A fresh Claude Fable 5.1 whole-branch review; one fix wave; its scoped re-review; the plan's Results; memory; the
  next page's prompt; ask the owner for the merge OK and, separately, the push.

## Results

(2026-10-20 → 22, branch `feat/ui-pos`, base main `d73dafb`; 26 commits, 121 files, +12424 / −4490. Not merged, not
pushed. Ledger with every ruling and review: `.superpowers/sdd/2026-10-21-pos-match-html/progress.md`, copied to
`D:\kd\pos-dev-keep\ui-redesign\reviews\u1\`.)

### Commits
- Docs: `8a5fd99` (values + design), `d67d682` (this plan).
- Tasks: T1 `8069278` frame + header · T2 `47a466d` categories + toolbar · T3 `4c3ce2d` + `03cc701` cards + direct add ·
  T4 `86dff1b` cart head + lines · T5 `e557fb4` footer, Bill options, keys · T6 `dd41069` + `ee4bd8e` switch order +
  Open orders · T7 `518a05c` order bar + sheet · T8 `117ab39` options modal · T9 `041aebb` + `0a2400f` payment sheet ·
  T10 `76e32a1` + `bf6113f` + `d42e587` customer sheet · T11 `3931417` table picker + move · T12 `f3522e5` void + confirms.
- Final fix wave (after the Fable review): `19a8c81` (P38 nested dialogs), `3fdfbf2`, `bc5d1f0`, `195e1db`, `fe186c6`.
- Verification fixes: `3a6d978` (P44 safe-area order bar), `08dd6f9` (P46 no number spinners).

### Tests and checks (HEAD `fe186c6`, the two verification fixes re-checked on top)
- Cafe chain 6617 / 6616 pass / 0 fail / 1 skip (main: 6451); typecheck clean; lint 0 errors, the 2 old warnings; shared
  1015; print-tools 11; release-native 12. Mobile, desktop, hub, packages untouched.
- Live legs: 20 legs, 1226 checks, 0 failed (staff-pin, bootstrap, dashboard, print, appearance, tables, orders, idem,
  table-move, tables-floor, menu-orders, nine reward legs).
- The paper: S1 43/43 hashes unchanged, `print-budget.test.ts` unchanged, no slip / printer / worker / model / API file
  in the diff (`PrinterStatusButton.tsx` gained a screen-only tone callback).
- Requests: idle 240 s on /pos = main's build exactly (34 requests, 9 kinds); the dashboard = U0 (66). No new request.
- The write paths on the scratch DB (V-D, 1280 and 390): send KOT, reprint, round 2, settle, Pay Now + free table, void,
  move, new customer + duplicate, partial as due, discount / promo refused / extra charge / GST discount: all pass, 0
  requests different from main.
- Measured match (V-B, :3130 production build): U1 probes 317 differences in 35,969 checks, every one a mapped row with
  its ruling; U0 shell probes 164 in 17,663 all classed (U0's own rows + today's data); 556 side-by-side pairs:
  `D:\kd\pos-dev-keep\ui-redesign\match\pos\final\shots\index.html`. First screens: 76 routes 200, console identical to
  U0. A11y: 0 axe violations (12 screens + 20 open-dialog audits). /m unchanged.
- Laptop fit 1366×768, 1280×800, 1100×800, 1024×768: no page scroll; the cart's buttons on screen.
- Emulator, WebView 109 (V-C): portrait and landscape /pos, every dialog, the nested-dialog fix on device: pass.
- Production build of `08dd6f9` in `D:\kd\uib`: the owner's preview on :3110 (uibase reseeded 2026-10-22).

### Reviews
- Twelve task reviews (fix rounds: Task 9 ×1, Task 10 ×1; Tasks 3, 6, 10 had small controller rulings applied before
  review); final Claude Fable 5.1 whole-branch review: With fixes, 0 C / 1 I / 6 m, every ruling P1–P42 sound; one fix
  wave (21 items) re-reviewed: all addressed; the two verification fixes reviewed: Approved.

### What the owner will see differently from the HTML (mapped, each with its ruling)
Two cart cells (Q9); no veg marks, "Popular", order types, guests, pickup, delivery, quick amounts (Q7, §7); our words
for our data (Online, Due, Credit, "Continue without customer" which also removes an attached customer P37, the HTML's
"No customer found … it takes 5 seconds" P34); our own options drawn in the HTML's style (Bill options panel, Note,
line Remove / Void, KOT reprint in Open orders, Walk-In button in the table picker, the move confirm step); disabled
cursors not-allowed (P8/P13); the payment and move layers at z 50 over the Orders sheet (P26); 16 px phone inputs (R36);
two-line subs in the table sheets (P39); grey "Occupied" in the move dialog (P40).

### Owner notes (decisions or pre-existing items, nothing changed for them)
- The card grid follows the HTML (5 columns at 1920 px, 1 column at 1100–1123 px), replacing the 2026-09-29 "at most 3
  columns" rule (P7). The order bar's count "pop" animation is gone (P21).
- WebView 154 (newer phones) in the app: the bottom safe-area inset; fixed for /pos (P44); the shell's
  `ABOVE_TAB_BAR_STICKY_CLASS` (Settings save bar, menu bulk bar) has the same gap: a one-line fix when the owner says.
- WebView 109: phone bottom sheets ~0.85 % see-through (R41, cause unconfirmed); one device-pixel row between the order
  bar and the tab bar at DPR 2.625.
- Pre-existing (main's behaviour): the keyboard never resizes the WebView (fields hide under it); Android Back from /pos
  drops unsent items (no in-app guard); the duplicate-customer path leaves an uncaught page error; a counter promo
  refusal uses the diner wording; the cart clears after every send; the reprint foot still offers a just-settled order;
  no toast after a successful reprint or move; the nav list scrolls on laptops (U0).

### Left for later
The next page session (prompt `D:\kd\pos-dev-keep\ui-redesign\prompt-u2.md`); the owner's merge OK and, separately,
the push.
