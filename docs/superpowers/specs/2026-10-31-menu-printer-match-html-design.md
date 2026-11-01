# U5: the Menu (/products, /categories, the item and category editors) and the Printer panel rebuilt to the owner's HTML (design)

Status: APPROVED by the owner on 2026-11-01 ("Han, approve hai", with my calls listed in the hand-over). Branch
`feat/ui-menu-printer` from main `fe6cff9` (U0–U4 merged). The owner's answers (2026-10-31) are in section 4; "my call" marks a
decision of mine the owner can still change.

## 1. Why, and the rule

The owner picked two screens for U5 (2026-10-31, on the fast path): the HTML's **Menu** (Items, Categories, the Item
editor, the category editor) → our `/products` and `/categories` and their editing, and the HTML's **Printer panel** →
our header printer panel, **look only** (printing never changes). The standing rules apply: the HTML's numbers are the
spec, measured to the pixel; a visible difference is fixed or shown to the owner, never parked as minor; **every option
we have today stays** and, where the HTML has no place for it, gets one designed in the HTML's own visual language;
nothing is invented on the data side (what the HTML shows that we have no data for is left out and listed, section 9);
an HTML slip is never copied (section 10). The owner's rule of 2026-10-22 applies to two right-side panels here: the
item editor and the printer panel open at the side only from 1280 px; below 1280 they open full screen, sliding up from
the bottom.

## 2. Sources

- The mock-up `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked `design\unpacked\`): Menu markup
  582–667, Item editor 1162–1192, category editor 1194–1205, Printer panel 1471–1558; app.js `menuVals()` 541–606,
  `prVals()` 714–737.
- **The exact values:** `docs/superpowers/specs/2026-10-31-menu-printer-html-values.md` ("values §N": 218 Menu states /
  469 runs, 88 Printer states / 187 runs; shots `design\spec-shots-menu\`, `design\spec-shots-printer\`; 20 HTML slips in
  values §23). Theme, shell, toast: `2026-10-19-u0-html-values.md` ("U0 values"). Shared patterns: U2's order detail
  sheet (side ≥ 1280 / bottom sheet below), U3's floor page frame and refresh strip, U4's kitchen page frame,
  `components/shared/RefreshStrip.tsx`, the POS's category hues (`lib/pos-categories.ts` `categoryHueMap`).
- **What we have today:** `D:\kd\pos-dev-keep\ui-redesign\inventory\menu-features.md` ("menu inv": E1–E74, E101–E144,
  E201–E213, states S1–S38, pins P1–P140, data D1–D9, long words §7, the header line §8) and
  `inventory\printer-panel-features.md` ("printer inv": E/S/T/BR ids, pins P1–P167, lanes §3.4, states §3.5); shots of
  today's screens `current-menu\` (223) and `current-printer\` (176) (`tools\menu-current-shots.mjs`,
  `tools\printer-current-shots.mjs`).

## 3. Scope

**In:** `/products` (page, header contents, toolbar, rail, list, bulk bar, states, toasts), the item editor
(`ProductFormSheet` and its fields, the icon picker's frame), the import wizard's and the move dialog's frames,
`/categories` (page, rows, the add / edit dialog, the delete check), the header printer sheet and everything
`PrinterPanel` draws (both in the sheet and inline on `/printers`).

**Out:** the API routes, models, `packages/*` logic, every request and its timing; the POS menu, the diner QR menu,
Reports, Settings; `/printers`' own setup sections below the panel (Printers, Stations, Devices, apps), which keep
today's look; the shell outside the header's contents on these two routes; the paper (the S1 43-file pin and
`print-budget.test.ts` untouched); every printing hook, lib, bridge and printer call (section 7.9); Reservations (U6).

## 4. The owner's decisions (2026-10-31)

| # | Point | Decision |
|---|---|---|
| Q1 | Item order in the list | **The categories' arranged order** (the order set on Categories: the same as New Order and the QR menu), as the HTML; inside a category by name. The Category column's sort still flips it. Today's default (category NAME A→Z) goes. |
| Q2 | Long names with badges in the table | **The name is never cut**: a long name wraps (two lines or more); the badges move to the second line, before the sizes text. A normal row stays 55 px. |
| Q3 | Photo / icon in the list | **A 34 px tile where the HTML's veg mark sits** (photo → icon → first letter, today's `ItemArt` order), radius 8; the row stays 55 px; the phone card too. |
| Q4 | Tablet portrait (820) | **The HTML's table from 816 px; below 862 px the Category column is left out** and the category shows in the item's second line, so nothing is clipped (the HTML's own table at 820 clips the Edit button, values §23.1). |
| Q5 | Phone header | **The HTML's: the Items / Categories switch (icons) and "Add" in the header**, the shell's "New order" link not drawn on the Menu pages below 720 px (as /kitchen); Import CSV a 38 px icon in the toolbar. With Tokens on, when the title would get too narrow, the switch and Add drop to a row under the header. |
| Q6 | Bulk bar | **The HTML's ink bar, kept at the foot of the screen** while items are selected (today's place: always reachable while scrolling; on the phone above the tab bar). |
| Q7 | Words | **The HTML's words** on the Menu where the HTML has the same element: "Sold out" / "In stock", "Mark sold out" / "Back in stock", the HTML's toasts ("{name} marked sold out", "{name} is back in stock", "{name} archived · hidden everywhere", …), "Hidden on QR menu", "Sizes" / "Add size", "Show on QR menu". The dashboard's "N items out of stock" chip (another page) stays. Section 12 lists every word. |
| Q8 | Tablet header 720–1279 (after the builder check) | **On the Menu pages the shell's "Tables" / "New order" quick links show only from 1280 px** (the Kitchen rule, U4 Q8): on tablets the Menu header is the HTML's (title, the switch with its labels, Add, printer). |
| Q9 | The base price in Sizes mode (after the builder check) | **The HTML's: hidden in Sizes mode.** An existing item keeps the base price it has (the form keeps the value and sends it as today); a new item made in Sizes mode saves a base price of ₹0 (for a sized item the base price is only read by the rewards cost, the larger of the base and the sizes). |
| – | Standing (U0–U4) | The HTML's words where the HTML has the same element; our words for our own features and data. |

## 5. Menu layout per width

Both Menu routes fill the screen under the shell header like the HTML's screen and like /orders, /tables and /kitchen:
today's paper frame (`MenuPageShell`) leaves these two pages (it stays for the other 13 pages); a `MENU_PAGE_CLASS`
built as `KITCHEN_PAGE_CLASS` (`POS_PAGE_CLASS`'s height under the header and the U0 alert strip, `flex flex-col
overflow-hidden`). Items: a body grid `240px minmax(0,1fr)` when the page box is at least 1000 px wide (values §0.2
`rail`; a container query on the page box, so the collapsed nav at 1280 also gets it), else one column. The **list
column is the page's only scroller** (values §12), padding `20px 24px 28px` from 720 px and `16px 14px 92px` below
(values §0.3 `pagePad` / `screenPadB`), each bottom value plus `env(safe-area-inset-bottom)` (U1 P49), with U3's 8 px
scrollbar. The rail scrolls on its own.

| Width | Page | Rail | List box | Rows (values §0.2; Q4) |
|---|---|---|---|---|
| 1280, nav open | 1048 | 240 | 760 | table with the Category column |
| 1280, nav collapsed | 1204 | 240 | 916 | table with the Category column |
| 1024 | 948 | – (category select in the toolbar) | 900 | table with the Category column |
| 820 | 744 | – (category select) | 696 | table **without** the Category column (Q4) |
| 390 (and every width < 720) | 390 | – (category chips) | 362 | cards |

Rules: the table from 816 px (the HTML's `listW >= 700`, i.e. a list box ≥ 692 px; one list mounted, as today's pinned
perf rule, through `useMediaQuery("(min-width: 816px)")`); the Category column when the list's inner grid has its 708 px
(a container query on the list box ≥ 738 px); cards below 816. /categories: one scroller (the body), the same paddings.

## 6. The Menu in the HTML's design

### 6.1 Header (values §2)
Title **"Menu"** on both routes (the HTML's; today "Items" / "Categories"; the sr-only eyebrow "Menu" goes, as the
title says it; `pageTitleFor` for both paths "Menu"). Second line (12 px `--text-2`, one line, ellipsis):
`"{n} items · {m} categories[ · {k} sold out]"` — n = active items, m = categories, k = active sold-out items, counted
from data already loaded, the same on both routes and in every filter (the HTML's; today's line counted the loaded list:
"0 items" in the Archived view, menu inv §12.2). In the Archived view the counts still read the active list from the
cache (no request; if it is not loaded, the line leaves the counts it lacks out). Loading: "Loading items…"; first-load
error: the shell's default line (U4 K6).
Actions (admin only; staff get none, as today):
- **The view switch** (values §2): the HTML's 36 px segmented track (`--surface-3`, radius 9, padding 3, gap 2), two
  buttons Items / Categories (icon 15 px + label, the label hidden below 720), on = `--seg` + `--seg-sh` + 600. They are
  **links** to `/products` and `/categories` (the routes stay; `prefetch={false}` as the nav's, P69/P70), the current
  one lit with `aria-current="page"`. Staff see no switch (Categories is admin-only, middleware + AdminGuard unchanged).
- **Add** (values §2): 36 px accent, radius 8, 13.5 px 600, the 14 px plus; "Add item" on /products, "Add category" on
  /categories, "Add" below 720.
- The shell's quick links, Tokens and the printer button keep their order after the page's actions (U0).
- Phone (Q5): below 720 the switch (icons only, 86 px) and Add stay in the header beside the title while the title block
  keeps at least 64 px (the word "Menu" whole; the second line may end in an ellipsis), else they drop to the body row
  (R6's mechanism with this page's own floor; other pages keep R6's 140 px). The shell's "New order" link is not drawn
  on these two routes below 720 (`HeaderQuickTabs` gets a Menu rule beside its /pos, /tables, /kitchen rules). Measured
  room at 390: 100 px for the title with Tokens off.
- **720–1279 (Q8):** the shell's "Tables" and "New order" quick links are not drawn on these two routes below 1280 px
  (`HeaderQuickTabs`' Menu rule: none below 720, from 1280 only between), so the switch (with labels) and Add stay in
  the header beside the title (820: title block ~331 px, ~280 with Tokens on); R6's 140 px floor still guards it.

### 6.2 Category rail (≥ 1000 px page; values §3)
The HTML's aside (240 incl. its 1 px border, `--surface`, padding `12px 10px`, own scroller). Rows: "All items" (the
16 px grid icon) and then **our categories in their arranged order**, each a 36 px row (radius 8, padding `0 10px`, gap
9, 13.5 px; chosen = `--accent-t` / `--accent-i` / 600; hover `--hover` on hover devices): the 8 px dot in the
category's hue (the POS's `categoryHueMap`, the HTML's five section hues by position, so the dots match New Order's
column; my call), the name (ellipsis), the sold-out chip (18 px, `--bad-t` / `--bad-i`, 10.5 px 700, the number,
`title="{n} sold out"`) and the count (12 px `--text-3`, min-width 22). No section heads (we have no sections, section
9). Rows stay 36 px and the rail scrolls (the HTML's shrink to 22.4 px is a slip, values §23.2). A pick sets today's
category filter (and clears the selection, as today).

### 6.3 Toolbar, filters, phone (values §4)
- **Search** (values §4.2): the HTML's 38 px box (radius 9, the 15 px magnifier, 14 px input, `--text-3` placeholder)
  with the HTML's clear ✕ (22 px round, `title="Clear search"`). Words "Search items". Matching stays today's (the item
  name; my call: the HTML also matches the category name, a behaviour change I did not take). Inputs 16 px below 720
  (standing rule).
- **Category select** (page < 1000 and ≥ 720; values §4.3): the HTML's 38 px select with the folder icon and chevron,
  "All categories ({n})", then "{name} ({n})" in arranged order; today's category state. **Every select on these screens
  is the kit dropdown, never a native `<select>`** (the owner's standing rule, pin `lib/no-native-pickers-paths.test.ts`;
  U2's choice): its trigger takes the HTML's 38 px select look (radius 9, 1 px `--border`, 13.5 px 500, the left icon
  where the HTML has one, the right chevron); its open list is the kit's (the HTML's is the browser's popup).
- **Filter select** (values §4.4): the HTML's 200 px select with the funnel icon: "All items ({n})", "In stock ({n})"
  (new: the HTML's, from data already loaded), "Sold out ({n})", "Hidden on QR menu ({n})", "Archived" (admin only, as
  today; no count: the archived list loads only in the Archived view, and a count that comes and goes with the cache
  would mislead; my call). Counts as today's (scoped by search and category, menu inv E8; the HTML counts the whole menu: my
  call to keep ours). Today's deep links keep working (`?status=out-of-stock|hidden|archived`, P76/P87); "Popular" is
  not drawn (no data). The status control becomes this select (today's segmented `role="group"` control, P24: its pin
  moves with the same meaning, a filter, never tabs).
- **Import CSV** (admin; no HTML counterpart; Q5): in the toolbar after the filter select, where the HTML's Veg control
  sits (no data for veg): a 38 px outline button "Import CSV" (radius 9, `--surface`, 1 px `--border`, 13.5 px 500, the
  upload icon) from 720 px, a 38×38 icon button (`aria-label="Import CSV"`) below 720.
- **Title row** (≥ 720; values §4.6): "All items" or the picked category (15 px 600) and "{n} item(s)[ · {filter}]"
  (12.5 px `--text-2`), as the HTML.
- **Phone** (values §4.5): the search, then the HTML's 38 px Filters button (badge = the number of active filters: the
  filter select ≠ All) that opens the wrap holding the filter select; then a 38 px **Select** button (ours: today's
  Select / Done, an icon button in the Filters look, lit while selecting, `aria-pressed`); then Import CSV (admin). The
  category chips row (32 px pills, "All {n}" + categories with their 7 px hue dots, chosen = `--ink`) **is always
  visible** (the HTML's chips collapse to 0 px behind a long list, values §23.3: not copied).

### 6.4 The table (from 816 px; values §5)
The HTML's white list (radius 12, 1 px `--border`, `overflow: clip`), the sticky 37 px head (`--surface-2`, 12.5 px 500
`--text-2`) and the grid `18px minmax(200px,2fr) [minmax(120px,1fr)] 110px 72px 72px 32px`, gap 14, padding `10px 14px`
(head `9px 14px`), rows divided by `--border-2`, selected row `--accent-t`, archived row at .6 opacity, hover `--hover`
on hover devices. Cells:
- **Check** (18 px, radius 5, the HTML's box; ticked `--accent` with the white ✓). The head's **select all** (the HTML's:
  ✓ all / – some / empty), bounded by today's 500-item cap note. Present for every role (today's selection).
- **Item** (Q2, Q3): the 34 px art tile (radius 8; today's photo → icon → initial), gap 10, then the text block: the
  name (14 px 600, wraps, unbreakable words break anywhere, never cut) and the second line: the badges (section 6.6)
  then the sizes text (12 px `--text-3`): "Single price", the size names joined by " · ", or one size's name (the
  HTML's), then today's " · {n} modifiers" when any. Below 862 px the second line starts with the category (Q4). The
  name and the art are one button that opens the editor (admin), as the HTML's name button; staff: plain text.
- **Category** (≥ 738 px list; values §5.2): the 7 px hue dot + the name, 13 px `--text-2`, ellipsis; hidden while a
  category is picked (the HTML's).
- **Price** (Geist Mono 13.5 px 600, right): "₹{n}" or the HTML's range "₹{lo}–{hi}" (one ₹, en dash), Indian grouping;
  a discounted item shows today's struck original under it (12 px `--text-3`, line-through; ours, no counterpart).
- **Stock** and **QR** (72 px each): the HTML's 40×24 switches (stock on = in stock, `--ok`; QR on = `--accent`; off
  `--surface-3`; knob 18). Staff: the stock switch, and in the QR column today's words "Shown" / "Hidden" (12.5 px
  `--text-2`; the server lets staff change stock only, menu inv P106).
- **Edit** (32 px, the pencil, hover `--surface-3`; admin): opens the editor. Today's ⋯ menu (Edit, Archive / Restore)
  goes: Archive and Restore move into the editor (6.9), as the HTML.
- **Sorting** (ours, no counterpart): the head's "Item", "Category", "Price" and "Stock" cells are the sort buttons
  (today's four keys; the active one in `--text` with a 12 px arrow, `aria-sort` on its column). Default: Category
  ascending = the arranged order (Q1).
- Head words: "Item", "Category", "Price", "Stock" (box icon), "QR" (QR icon) (the HTML's).

### 6.5 Cards (below 816 px; values §6)
The HTML's card rows inside the same white list: padding `12px 14px`, gap 12, divided rows. Left: in select mode the
18 px check; the 34 px art (Q3); the name block (a button opening the editor for an admin, as today; in select mode it
ticks): the name (14.5 px 600, wraps, never cut: my call following Q2), the second line (12.5 px `--text-2`): the price
(Geist Mono 600 `--text`, with today's struck original when discounted) · the category · "{n} sizes", then the badges
row. Right: the HTML's stock cell ("In stock" / "Sold out" 10.5 px `--text-3` over the 40×24 switch), every role. No QR
switch on a card (as today; the table has it from 816 px).

### 6.6 Badges, switches, toasts (values §7)
Badges (the HTML's look: table 20 px, card 19 px, the icons): **Sold out** (`--bad-t` / `--bad-i`), **Hidden on QR**
(`--surface-3` / `--text-2`), **Archived** (Archived view), and ours **No KOT** (today's `itemSkipsKitchen` rule) in the
HTML's "No KOT" chip colours (`--warn-t` / `--warn-i`, printer icon). Popular and New: not drawn (no data). Switch taps
send today's requests; their toasts take the HTML's words (Q7): "{name} marked sold out" / "{name} is back in stock" /
"{name} hidden from QR menu" / "{name} shown on QR menu"; errors keep today's words. No Undo (we have none). The toaster
keeps the staff place; on these two routes it takes U3's inset set (140 / 92 / 24 px, each plus the bottom inset), as
/tables and /kitchen.

### 6.7 Bulk bar (values §8; Q6)
The HTML's ink bar (radius 10, `--ink` / `--on-ink`, padding `8px 10px 8px 14px`, gap 8, 13.5 px 600 "{n} item(s)
selected"), **sticky at the foot of the list scroller** while anything is selected (on the phone above the tab bar and
its inset). Buttons in the HTML's look (32 px, 1 px `rgba(255,255,255,.22)`, radius 8, 12.5 px 600, 14 px icons, hover
`rgba(255,255,255,.1)`), labels hidden when the list is narrower than 520 px (icon-only 38×32 with `aria-label`):
"Mark sold out", "Back in stock" (every role), "Move to category" and "Archive" (admin, active view), "Restore"
(Archived view), and the ✕ "Clear selection". Today's 500 cap ("Select up to 500 items at a time.", buttons off) shows in
the bar. Bulk toasts in the HTML's words with today's counts, singular right ("1 item marked sold out", the HTML's "1
items" slip not copied). Hide / Show on QR in bulk: not drawn (no bulk QR action on the server, section 9). Today's "More"
menu below 1024 goes (every button fits as an icon).

### 6.8 Loading, error, empty
Loading: skeleton rows in the list's shape. First-load error: today's `ErrorState` where the list sits. A failed refresh
with data: U4's `RefreshStrip` at the page's top (only on a failed or paused read, U4 I1) in place of today's inline
"Couldn't refresh · Try again" line: "Couldn't refresh the menu. Showing the last update." + "Try again" (today's
`refetch()`; my call, U3/U4's pattern). Filtered empty: the HTML's dashed box (values §4.7): "No items match “{q}”" / "No items here" +
"Try another search or filter." Our guided empties (no categories yet with "Add a category", an empty menu, an empty
Archived view) keep their words in the same box.

### 6.9 The item editor (values §9)
**Frame:** from 1280 px the HTML's right aside (500 px, `--surface`, 1 px left `--border`, `--pop`, scrim z 45/46,
`sheetIn .3s`); below 1280 full screen sliding up from the bottom (owner rule; U2's detail sheet frame). Head (padding
`16px 18px 14px`): "Add item" / "Edit item" (18 px 600) and "Add a new item to the menu" / "{name} · {category}" (13 px
`--text-2`), the 34 px round ✕. Body scrolls (padding `16px 18px 22px`, gap 20). **Fixed footer** (padding `12px 18px`
+ bottom inset): **Cancel** (flex 1, 46 px, outline: closes, as ✕) and **Save** (flex 2, 46 px accent): "Add to menu" /
"Save changes". The save sends today's exact request and shapes (menu inv risk 6); today's validation and messages.
Escape, ✕, Cancel and a scrim tap close without saving (today's sheet has no dirty guard; none added).
**Fields, in order** (labels 13 px 600, 6 px above the control; inputs the HTML's 42 px, radius 10, 14.5 px; selects
38 px):
1. **Item name** (the HTML's label; today "Name").
2. **Category** (select, full width: the HTML's Food type beside it has no data).
3. **Price** with the HTML's **Single price / Sizes** switch (today's "Has variations"): Single = the ₹ box (max-width
   220, today's number input, decimals allowed as today); Sizes = the HTML's rows (name input "Size name · e.g. Small",
   the 130 px ₹ box, the 36 px remove) and the dashed **Add size** (today's ≤ 20, names ≤ 24, today's row rules and
   messages). In Sizes mode the base-price box is hidden (Q9): the form keeps its value (an edit sends the stored base
   price as today; a new sized item sends 0), and its validation can never block a Save it does not show.
4. **Discount %** (ours): a 42 px box with a "%" cell (the ₹ box's look), max-width 160.
5. **Photo and icon** (ours): today's picker in the HTML's language (a 72 px preview tile radius 12, "Upload image" and
   "Choose icon" as 36 px outline buttons); without storage keys it shows today's words.
6. **Modifiers** (ours): today's chip input in the 42 px input look; "Modifiers come ticked" as a switch row (6.9.7's look).
7. **The switches card** (the HTML's card, radius 12): **In stock** (box tile `--ok-t`), **Show on QR menu** (today's
   "Show on public menu"; QR tile `--accent-t`), each a 34 px tile + 13.5 px 600 label + 12 px `--text-3` sub + the
   40×24 switch; the subs are the HTML's where true for us ("Off = hidden from guests’ QR menu. Staff can still order
   it."), else ours. Popular: not drawn (no data).
8. **Kitchen** (ours): "Kitchen station" (today's `StationSelect`, 38 px) and "Kitchen ticket (KOT)" (today's three
   choices), with today's help words, in the HTML's select look.
9. **Archive item / Restore item** (edit only; the HTML's red link, 13 px 600, hover `--bad-t`): Archive opens today's
   "Archive item?" confirm (we keep the confirm); Restore restores at once (today's ⋯ Restore). Toasts in the HTML's
   words: "{name} archived · hidden everywhere" / "{name} restored".
Save toasts stay today's "Item added" / "Item updated" (ruling: they come from the shared package's CRUD factory,
`packages/shared/src/create-crud-hooks.ts`, whose messages are fixed strings; the HTML's "{name} added to {category}"
would need a packages change, which this UI phase may not make). The manager-PIN note: not drawn (no such gate: staff
cannot open the editor at all).
The icon picker and the move dialog: the HTML's centred box (440 px, radius 14, padding 20, gap 16; the phone's bottom
sheet with the inset, values §10) around today's contents. The import wizard: the same look at today's width (its
five-column preview needs it; my call). Their words stay (no counterpart).

### 6.10 /categories (values §11)
The page as 5 (one scroller). Header as 6.1 (Categories lit, "Add category"). Body: our note (13 px `--text-2`; today's
description sentence moves here, the HTML's place for it: "Drag a row or use the arrows…", our words for our drag), then
the HTML's white card with **one** group (no sections: no head row). Each row (padding `10px 12px 10px 10px`, gap 12,
66 px, divided, hover `--hover`):
- our **drag handle** (today's grip, 16 px icon; 28 px box on a mouse, 44 px hit area on touch; no counterpart),
- the HTML's **arrows** (28×22 stacked, chevrons, "Move {name} up / down", the first / last at .3 with today's
  `aria-disabled`),
- the 10 px **hue dot** (the POS hue by position),
- the **name** (14.5 px 600) + **meta** (12.5 px `--text-3`): "{n} items[ · {o} sold out][ · {a} archived]" (+ " · No
  KOT" below 720); the name block is a link to the category's items (today's count link destination
  `/products?category={id}`; the HTML opens the category in Items),
- the **station chip** (≥ 720; 26 px pill, `--surface-3`, 12 px 500, the station's name from the stations list the page
  already loads; absent = the default station's name),
- the **No KOT chip** (≥ 720, when the category skips the kitchen; `--warn-t` / `--warn-i`),
- **Edit** (34 px pencil, `title="Edit category"`) and **Delete** (34 px trash; `--text-3` with `title="Move or archive
  its items first"` while it holds items, else `--bad-i` "Delete category"). Delete opens today's check dialog (its four
  branches and "View them", pinned) in the confirm-sheet look (`CONFIRM_SHEET_*`).
Reordering stays today's (drag or arrows, the optimistic order, the `?fresh=1` recovery).

### 6.11 The category editor (values §10)
The HTML's centred box (440, radius 14, padding 20, gap 16, `sheetIn`; below 720 the bottom sheet with radius `14px 14px
0 0` and the bottom inset): head "Add category" / "Edit category" + "Categories group items in New Order and the QR
menu." + the 32 px round ✕; **Name** (42 px; today's error words); **Kitchen station** (38 px select, today's options)
+ "Where this category’s KOTs print."; the **KOT card** (today's "Send to the kitchen (KOT)" switch in the HTML's card,
sub "Turn off for ready items like bottled drinks." if true for us, else today's hint); **Save** 46 px accent "Add
category" / "Save changes". Colour group: not drawn (no data). Toasts in the HTML's words: "{name} added · add items to
it from Items", "{name} saved", "{name} deleted"; today's error toasts.

### 6.12 Behaviours that stay exactly
Every request and its timing (the master path for products and categories, `GET /api/products?archived=true` only in
the Archived view, stations only where today, every PUT / POST / DELETE / PATCH body), the optimistic writes and their
restore, every invalidate, staff powers (stock only), the 500 bulk cap, the deep links, the import wizard, the drag
arrange, the delete check. No new request of any kind: the filters, counts, the In stock filter, the select-all and the
rail come from data already loaded. Q1 changes only the client-side default sort.

### 6.13 Keyboard
No new shortcuts. Escape closes the editor, the category editor and every dialog (Radix; the HTML closes only its item
editor, values §23.8: not copied). Tab order: header (switch, Add) → toolbar → rail → title row → the list row by row.

## 7. The Printer panel in the HTML's design (LOOK ONLY)

### 7.1 Frame (values §16)
From 1280 px: the HTML's scrim (z 60, `--scrim`, fadeIn) and right aside (`min(420px,100%)`, `--bg`, 1 px left
`--border`, `--pop`, the HTML's `lineIn .3s`); below 1280: full screen, sliding up from the bottom (owner rule; today the
sheet slides from the right at every width). **Head** (`--surface`, padding `18px 20px 14px`, bottom `--border`):
"Printer" (17 px 600) + "Printer status and setup for this device" (12.5 px `--text-2`; the HTML's, without today's
full stop) + the 34 px ✕ (radius 8, hover `--hover`). **Body** scrolls (padding `16px 20px`, gap 12). **Fixed footer**
(`--surface`, top `--border`, padding `14px 20px` + the bottom inset): **Done** (44 px, accent, radius 10, 14.5 px 600).
On `/printers` the panel draws inline with no frame and no Done (today's).

### 7.2 Sections (values §18–§20)
Every section of today's panel becomes the HTML's section card (`--surface`, 1 px `--border`, radius 12, clip): a head
row (padding `14px 16px`, gap 12: the 34 px icon tile `--surface-3` / `--text-2` radius 9, title 14 px 600, sub 12.5 px
`--text-3`) and a body (padding `0 16px 16px`, gap 12). Today's sections and their words: "Where slips print", "Printer
on this device", "Fast text KOTs (English only)", "Test print", "Bill printer for this device", "More options". Their
contents keep every control and every word; only the look changes (7.4). `/printers`' own setup sections keep today's
look (the panel gets its own section frame; `PrinterSection` stays for them).

### 7.3 The status card (values §17)
Today's banner (`PrinterStatusBanner`: its ~20 headlines, details and its one fix button) in the HTML's status card:
padding `14px 16px`, radius 12, gap 12; **ok** = `--ok-t` with a `rgba(36,161,72,.3)` border (the HTML's `color-mix`,
precomputed: WebView 109), the 34 px `--ok` circle with the white check, the headline 14.5 px 600 `--ok-i`; **bad** =
`--warn-t`, `rgba(255,131,43,.35)` border, the `--warn` circle with "!" in `--text` (the HTML's white "!" is 2.46:1,
values §23.16: not copied), the headline in `--warn-i`; **checking** = `--surface`, 1 px `--border`, a `--surface-3`
circle with today's neutral look. The detail 12.5 px `--text-2`. The fix button ("Set up printing", "Reconnect", "Print
on this device") sits where the HTML's Test print sits: 32 px outline, 12.5 px 500, radius 8; on a narrow card it wraps
under the words. Words stay ours (they say more than "Printing is on / off").

### 7.4 Controls in the HTML's look
- Primary actions (Connect printer, Find printers, Use this network printer, Print all slips on this device): the HTML's
  **Connect printer** (40 px, accent, radius 9, 14 px 600, the spinner while busy).
- Secondary actions (Search nearby printers, Reconnect, Change printer, Refresh USB / paired printers, Stop printing
  here, Print on this device instead, Print test slip, Add another printer, Change POS address, Battery settings for
  printing, the waiting slips' buttons): the HTML's **Search nearby printers** button (36 px outline, radius 8, 13.5 px
  500); "Remove" and "Remove the printing device" in the HTML's Remove look (`--bad-i` text, `rgba(218,30,40,.4)`
  border, hover `--bad-t`).
- "How to connect": the HTML's numbered steps (20 px `--accent-t` circles, 13 px at 1.45); "Printer not in the list?"
  block with its top rule (values §19).
- A saved printer's row: the HTML's connected row (padding `12px 14px`, radius 10, `--ok-t` with the 8 px pulsing dot
  when connected; `--surface-2` with a `--text-3` dot when not), name 13.5 px 600, meta 12 px `--text-2` ("Bluetooth ·
  80 mm"); today's buttons under it.
- Paper size: the HTML's 32 px segmented control (58 mm / 80 mm), label "Paper width" (the HTML's word).
- Choices that are radio buttons today (Windows "Print method") take the HTML's mode-button rows (1 px border, radius
  10, the 18 px radio, `--accent-t` when chosen).
- Switches (Fast text KOTs): the HTML's 38×22 switch row; selects (Windows printer, Characters per line, Bill printer):
  the 38 px select look; inputs (device name, network address, port): 42 px.
- "More options": the HTML's collapsible section (sliders tile, the chevron turning 180°).
- Touch sizes: the HTML's where the HTML has the element (ruling R1: 40 / 36 / 32 px); our own controls with no HTML
  element keep 44 px hit areas on touch.

### 7.5 Waiting slips (ours, no counterpart)
Today's "Slips waiting" card in the HTML's warn card (`--warn-t`, `rgba(255,131,43,.35)` border, radius 12, padding
`14px 16px`), title 14 px 600 `--warn-i`, groups 12.5 px 600, each slip a white row (radius 10, 1 px `--border`,
padding `10px 12px`: label 13.5 px 500, "{m} min · {reason}" 12 px `--text-3`, its buttons 36 px). First in the body,
as today.

### 7.6 The header button
Unchanged (U0: 36 px, the 10 px dot, today's names and the waiting badge; the "red" tone keeps the shell's warn dot).

### 7.7 Words
Ours everywhere (they describe our printing), except where the HTML has the same element and the same meaning: the
sheet's sub (no full stop), "Paper width", the Remove note's dash ("…remove it from any device — even a phone. …"). The
HTML's step and help sentences are taken only where true for the lane (e.g. our browser lane's "Finds printers that do
not need pairing." stays: the HTML's "Wi-Fi and network printers" is not what it does).

### 7.8 What the HTML has that we do not (left out: it would change printing)
The Counter PC / This device mode buttons (our model is one printing device or each prints its own, chosen with a name
and "Print all slips on this device"); "Printing is on / off" as the only two states; "Disconnect"; the paper width in
More options; the three switches "Print kitchen slip on send", "Print bill after payment", "Logo on bills" (no such
per-device settings); Test print inside the status card (ours is its own card with its follow-up question).

### 7.9 Must stay byte-identical
Every hook, lib, API, bridge and printer call the panel and the button use (printer inv §0, B0/B0b): `printer-dot.ts`
(300/300), `use-device-printer`, `use-agent-printers`, the providers, `device-printer-link`, the bridges, the pulse
reader count (P118: the panel calls `usePosPulseContext(` once), the focus targets (`data-printer-panel`,
`data-printer-target="device"`, `data-action="designate"`, `id="printer-where"`), the click-to-chooser rule (no await
before `connectNew(` / `.reconnect()`), the banner's single `<Button` and `role="status"`, no print trigger in panel
files, no request of its own. Markup and classes may change; the panel order pins (Waiting < Banner < Setup < Bill)
keep their meaning.

## 8. Shared mechanics (my calls)
- **Pins** (as U2–U4): look (L / G) pins move on purpose with the reason in the commit; behaviour (B) pins keep their
  meaning; budget (BUD) pins never loosen. Moving on purpose: the products page header JSX (P7, P62: title "Menu"),
  ItemsTable's kit `<Table>` strings (P8: the HTML's grid list), the status control (P24: a select), BulkBar's row class
  and sticky offset (P11/P74: the ink bar, still sticky at the foot), CategoryRow's arrow classes (P41: 28×22), the
  printer panel's 44 px constants (P19/P39 → R1 sizes from `printer-classes.ts`; the hygiene pin's ban of `h-8/9/10` and
  `size="sm"` in panel files keeps its meaning: the sizes come from constants), the sheet JSX (P8: the frame). The
  products page (298), `ProductFormSheet` (295), `/categories` (327) and `ImportProductsDialog` (312) split as they
  grow (files ≤ 300).
- `MenuPageShell` stays for its other 13 pages; `FormSheet` stays for the other five forms (the item editor gets its own
  frame); `PrinterSection` stays for `/printers`' setup sections.
- WebView 109: no `light-dark()`, runtime `color-mix()`, `in oklab` gradients or `mask-image`; every flex `<button>`
  whose children rely on stretch gets `w-full` / `items-stretch` (the rail rows, the name buttons, the switch rows, the
  mode rows, More options); `overflow: clip` for pure clipping; container queries are fine (Chrome 105+).
- Filtered lists keep a permanent wrapper (U3 VC-3: the list, the rail, the category rows).

## 9. What the HTML has that we do not (left out; never added without the owner)
Veg / Non-veg (row mark, filter, Food type); Popular (badge, filter, switch, "shown first with a star"); the New badge;
category sections and colour groups (the rail heads, the Categories heads, the editor's chips); bulk Hide / Show on QR;
a manager's PIN to save; Undo on deletes, archives and saves; the HTML's fixed station names (ours are the cafe's
stations); dark mode (light only).

## 10. The HTML's own slips (values §23; my calls)
Not copied: the table at 820 clipping the Edit button (#1, Q4); rail rows squeezed to 22.4 px (#2); phone chips at 0 px
(#3); names vanishing behind badges (#4, Q2); phone cards with no selection (#5: ours keep Select); no printer button on
the Menu header (#6: ours stays); "1 items" (#7); Escape (#8); the Cashier's free edits (#9: ours are server rules);
selection kept on hidden rows (#11: ours keeps today's intersection with the visible rows); the head sticking 20 px
low (#12: ours sticks at the scroller's top); the duplicate style keys (#13: the later values are the HTML's); the
`oklab` borders (#14: precomputed rgba); the 2.46:1 "!" (#16); the printer's fake timers and states (#17: ours are
real). Out of reach (no data / no such element): #10, #15, #18, #19, #20.

## 11. Must not change
Data, requests (none new; same endpoints, bodies, keys, timing), routes and roles (`/categories` admin-only), the API
routes, models and `packages/*` logic, printing and the paper (S1 pin, print budget), every printing hook / lib / bridge
(7.9), WebView 109 CSS, the preset-token rule in kit files, line budgets, test-used names unless section 12 changes
them, the other pages using the shared files.

## 12. Visible words that change
Menu: title "Items" / "Categories" → "Menu" (eyebrow gone); second line → "{n} items · {m} categories[ · {k} sold
out]"; "Search items…" → "Search items" (+ "Clear search"); the status buttons "All {n}" / "Out of stock {n}" / "Hidden
from QR {n}" / "Archived" → select "All items ({n})" / "In stock ({n})" (new) / "Sold out ({n})" / "Hidden on QR menu
({n})" / "Archived"; the category Select's "All categories" → "All categories ({n})", "{name} ({n})"; new title row
"All items" / "{category}" + "{n} items[ · sold out]"; table heads "Name" / "In stock" / "QR menu" → "Item" / "Stock" /
"QR"; badges "Out of stock" → "Sold out", "Hidden from QR" → "Hidden on QR"; the sub-line "{n} sizes · {m} modifiers" →
the size names or "Single price" (+ " · {m} modifiers"); card "In stock" / "Sold out" labels (new); ⋯ menu → the Edit
pencil (`title="Edit item"`); bulk "Out of stock" / "In stock" → "Mark sold out" / "Back in stock", "{n} selected" →
"{n} item(s) selected"; toasts "Marked out of stock" / "Marked in stock" / "Hidden from QR menu" / "Shown on QR menu" →
"{name} marked sold out" / "{name} is back in stock" / "{name} hidden from QR menu" / "{name} shown on QR menu"; bulk
toasts → "{n} item(s) marked sold out" / "… back in stock"; "Item archived" / "Item restored" → "{name} archived ·
hidden everywhere" / "{name} restored"; the editor: "Name" → "Item name", "Price (₹)" → "Price" + "Single price" / "Sizes", "Has variations" → gone,
"Add variation" → "Add size", the variation name placeholder → "Size name · e.g. Small", "Show on public menu" → "Show
on QR menu", new "Cancel", "Save" → "Add to menu" / "Save changes", new "Archive item" / "Restore item"; the empty
results "No items match “{q}”" / "No items here" + "Try another search or filter."; Categories: the description sentence
moves into the body; "Rename" → "Edit category"; the count link "{n} items" → the meta line; category toasts "Category
added" / "Category updated" / "Category removed" → "{name} added · add items to it from Items" / "{name} saved" /
"{name} deleted"; the dialog sub "Categories group items in New Order and the QR menu." (new).
Printer: the sheet's sub loses its full stop; "Paper size" → "Paper width"; the Remove note's ", even a phone." → " —
even a phone.".
Words that stay: every error and validation message, the save toasts "Item added" / "Item updated", the import wizard, the move dialog, the archive confirm, the delete
check, every printer headline, detail, button and toast (but the three above), "Done", "More options".

## 13. The builder check (2026-10-31)
A fresh builder read this document, the values, the inventories and the code. Two of its five questions were the
owner's and are answered in section 4 (Q8 the tablet header, Q9 the base price in Sizes mode). Answered by the project:
every select is the kit dropdown (the owner's no-native-picker rule, 6.3). Settled as my calls: "Archived" without a
count (6.3); the import wizard keeps its width in the new look (6.9).
