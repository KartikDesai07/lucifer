# U2: the Orders page (/orders) rebuilt to the owner's HTML (design)

Status: for the owner's approval, 2026-10-23. Branch `feat/ui-orders` from main `3d72d4d` (U0 and U1 merged). Nothing is
coded before the owner approves this document. The owner's answers (2026-10-22/23) are in section 4; "my call" marks a
decision of mine the owner can still change.

## 1. Why, and the rule

The owner picked the Orders screen as U2 (2026-10-22). The standing rules since 2026-10-19 / 2026-10-20 apply: the HTML's
numbers are the spec, measured to the pixel; a visible difference is fixed or shown to the owner, never parked as minor;
and, in the owner's words for /pos, "aesa nahi ki same aesa hi bana dena hai … current ye option hai UI me nahi hai to wo
option rakhna hai uski fir UI think karke proper manage karni hai": **every option /orders has today stays**, and where the
HTML has no place for it, it gets one designed in the HTML's own visual language (section 6). Nothing is invented on the
data side: what the HTML shows that we have no data for is left out and listed (section 7).

The owner's rule of 2026-10-22 for every page: below 1280 px (tablets and phones, by width) a right-side panel is never a
side column or side sheet; it opens like the phone's, full screen, sliding up from the bottom; side panels only at
1280 px and wider.

## 2. Sources

- The mock-up: `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked `design\unpacked\`), route
  `orders`, view-model `ordersVals()`.
- **The exact values:** `docs/superpowers/specs/2026-10-22-orders-html-values.md` (76 states, 270 runs at the five
  viewports plus 1600×900 for the Items column; 270 reference shots in
  `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-orders\`; mock clock Mon 19 Oct 2026 9:30 PM IST). Every number an
  implementer needs is there ("values §N"); this document adds only decisions and the mapping of our features. Theme,
  shell, toast: `docs/superpowers/specs/2026-10-19-u0-html-values.md` ("U0 values"); the payment, customer, table and
  confirm sheets: `docs/superpowers/specs/2026-10-20-pos-html-values.md` ("U1 values") and U1's design.
- **What we have today:** `D:\kd\pos-dev-keep\ui-redesign\inventory\orders-features.md` ("inventory": 82 elements, every
  word, state, dialog, request, role difference and 76 test pins labelled L / G / B / BUD; 14 options with no HTML
  counterpart) and 310 shots of the current page in every reachable state, `D:\kd\pos-dev-keep\ui-redesign\current-orders\`
  (index.md).

## 3. Scope

**In:** the /orders page and everything it opens: the page header's contents on /orders, the lanes (cards and phone
strip), the toolbar (search, date, Filters), the Filters panel, the chips row, the list head, the list as a table and as
cards, the loading / error / offline / empty / load-more states, the order detail (column, side sheet, bottom sheet) with
its head, steps, customer, items, sums, void trail, cancel note, quick actions, danger link and foot, and the cancel
dialog.

**Shared, restyled everywhere it opens (owner, Q8):** the order detail (`OrderDetailSheet`) is also opened by the
dashboard (Live tables, Recent orders): it takes the new look there too, with the same behaviour (6.11).

**Already in the new look (U1), reached from here, unchanged:** the payment sheet (`PaymentModal`), the customer sheet
(`CustomerSearch`), the move / assign table sheet (`MoveTableDialog`). Only how they sit over the new detail is checked
(z-order: they stay above it, U1 rulings P26 / P38).

**Out:** the paper (bill, KOT, cancel notice, token, moved slips: the S1 43-file pin and `print-budget.test.ts` stay
untouched), the printer panel's insides, the shell outside the header's contents on /orders, every other page's body,
`/m`. Three settings pages name this page's buttons in a hint line; only the quoted button word follows the rename (11).

## 4. The owner's decisions (2026-10-22/23)

| # | Point | Decision |
|---|---|---|
| Q1 | Lane numbers | **Numbers on the chosen lane only.** The cards look like the HTML's; the chosen lane shows its count and ₹ total from the orders loaded for it (exact when everything is loaded; "50+" and "₹x+" while more can be loaded); the other cards show their name, dot and a short line. No new request (numbers for every lane would need 3-4 more requests every 30 s). |
| Q2 | Lanes and first view | **Five lanes "All · Open · Paid · Due · Cancelled"**, the page **opens on Open** (the HTML's). All = today's whole list, newest first. |
| Q3 | Due lane | **Every bill with money still owed** (Due mode, Credit mode, a short payment): the server sends the settled orders, the device keeps those with money owed; Paid = settled with nothing owed. |
| Q4 | Search | **Phone only, and the box says so:** "Search by customer phone" (as U1 Q22). The server's phone search as today; while a phone is typed the lane is set aside and every lane is searched (the HTML's), the date and filters still apply. |
| Q5 | Date | **The HTML's dropdown, opening on Today:** Today / Yesterday / All dates / "Pick a day…" (our calendar; the chosen day shows in the box). The Open lane ignores the date (the HTML's: an open tab shows whatever day it was opened). "Last 7 days" left out (no server range). The header's "Today" button moves into this box. |
| Q6 | Row Settle | **As today:** the table row's "Settle" opens the order's detail (payment from there), not the payment sheet directly. |
| Q7 | Edit items | **Added for tabs at a table:** opens that tab on the POS terminal through the Floor's existing hand-off (`offerPosTable`, `lib/pos-table-handoff.ts`; no new request). Not shown for a walk-in tab (Settle & pay takes the full width). |
| Q8 | Dashboard | **The new detail look everywhere** it opens. On /orders from 1280 px the HTML's fixed 400 px column with the first order chosen; on the dashboard from 1280 px a 400 px side sheet; below 1280 px full screen from the bottom on both. |
| Q9 | Due words (builder check) | A due paid later on the Customers page goes to the customer's account, never back to the bill (`DuePayment`, `app/api/customers/[id]/reconcile/route.ts`), so a bill's due never goes down. **The words say so:** the lane keeps the HTML's name "Due" and the pill "Due"; the Due card's line reads "Unpaid at billing"; the detail's sums row reads "Due at billing ₹x" (not "Still due"); the Due lane's list shows one small line under its head: "Dues paid later are on the Customers page." |
| Q10 | Paid / Due paging (builder check) | **Say it and offer Load more:** while more settled orders can be loaded, the chosen card's count reads "{n}+"; an empty Paid or Due list then reads "No {due | paid} bills in the latest {50} settled orders" / "Load more to check older ones." with the Load more button (one request per tap, as today; never on its own). |
| Q11 | "Bill printed" (builder check) | **As the dashboard:** "Bill printed" (pill, "Reprint bill", the Open card's "bills waiting" line, the sort, the strip's "Settle T1", the step) shows only when the server knows of the print (`billPrintedNow`: print host / agent / settle prints); a device that prints straight from the browser keeps its open tabs "In kitchen". |
| – | Words (standing, U0 / U1 Q1) | The HTML's words where the HTML has the same element; our words for our own features and data (section 11 lists every visible word that changes). |
| – | Right panels (standing, 2026-10-22) | Below 1280 px the detail is never a side column or side sheet (overrides the HTML's 1024-1279 column and 820 px side sheet). |

## 5. Layout per width

The page fills the screen under the shell header as the HTML's does (it does not scroll; the list scroller and the detail
body scroll on their own), bleeding `<main>`'s padding like /pos (`MAIN_PADDING_BLEED_CLASS`); the alert strip and the
bottom safe-area inset are respected at every width. Today's paper frame with the 1440 px cap (`MenuPageShell`) goes.

The HTML decides the list's form from the list column's own width (values §0.2): **table** when it is ≥ 700 px, the
**Items** column when ≥ 900 px, **lane cards** when ≥ 560 px (else the phone strip). We keep those thresholds, measured
on our list column (a container query), so they follow our layout:

| Width | Nav | List column | Lanes | List | Detail |
|---|---|---|---|---|---|
| ≥ 1280, nav open (`d1280`) | 232 sidebar | 648 (608 inside) | 5 cards | cards | 400 px column, first order chosen |
| 1280, nav collapsed (`c1280`) | 76 rail | 804 (764) | 5 cards | table | 400 px column |
| 1024 (`t1024`) | 76 rail | 948 (908) | 5 cards | table **with Items** | full screen from the bottom, on a tap |
| 820 (`t820`) | 76 rail | 744 (704) | 5 cards | table | full screen from the bottom |
| 390 (`p390`) | tab bar | 390 (366) | strip (5 tabs) | cards | full screen from the bottom, over the header and tab bar |

At 1024 and 820 this differs from the HTML because of the owner's right-panel rule (the HTML has a column at 1024 and a
440 px side sheet at 820, so its list there is 508 / 704 wide); those rows are mapped to that rule in every compare.
Five lanes instead of four make every card narrower (Q2): 115 px at d1280, 146 at c1280, 175 at t1024, 134 at t820; the
phone strip's tabs 72.8 px.

## 6. Our features in the HTML's design

### 6.1 Header on /orders
The shell header (U0) as the HTML's Orders header (values §1): mini logo on the phone; title "Orders"; second line our
description "View, filter and manage orders." (the HTML's "8 open · ₹5,740 · 5 paid · ₹3,931" needs counts we do not
have, Q1); the gap between items 12 px on /orders (the HTML's Orders header; other pages keep U0's 10, my call); the
accent "New order" (our header quick link, → /pos) **with its label on the phone too** (the HTML's Orders header keeps it;
U0's other pages show only the plus there), my call; the printer button. Our header buttons stay where U0 put them:
"Tables" (outline, from 720 px), Refresh (apps), Tokens (when on). The "Today" button goes into the date box (Q5). On a
phone in the apps with Tokens on, the title and its line are cut with an ellipsis first (as the HTML's phone subtitle).

### 6.2 Lanes
- **Five lanes** (Q2): **All** (`--text-3` dot; today's "All statuses"), **Open** (`--info`), **Paid** (`--ok`), **Due**
  (`--bill`), **Cancelled** (`--bad`). The page opens on Open.
- **What each lane asks the server** (the same `GET /api/orders` with filters it already takes; no new request, the same
  30 s refresh of the first page): All → no status; Open → `status=Pending` and **no date** (Q5); Paid and Due →
  `status=Completed` (one query, shared), the device then keeps the rows with nothing owed (Paid) or with money owed
  (Due: `total − paidAmount > 0`, as today's Due column); Cancelled → `status=Cancelled`. The date, payment and table
  filters are added as today. A page of 50 settled orders can show fewer rows in Paid or Due; "Load more" fetches the
  next 50 as today.
- **Cards** (values §3.2; 5 columns, gap 8): the chosen card has the 2 px dark outline, its count (22 px 600) and ₹ total
  (Geist Mono 13 px), and its line: Open "{n} bill(s) waiting to be paid" (orders whose bill was printed,
  `billPrintedNow`) else "{n} open 30+ min" (`--warn-i` for both) else "All in service"; Paid "Avg ₹x per bill" or "No
  payments {today | yesterday | on 22 Oct}"; Due "Unpaid at billing" (`--bill-i`, Q9) or "Nothing to collect";
  Cancelled "Not charged" or "None {today | …}"; All "{n} orders". While more can be loaded the count reads "{n}+" and
  the total "₹x+" (Q1, Q10). **The other cards** keep the number row's height empty and show a fixed line in `--text-3`: All "Every
  order", Open "Tabs at the tables now", Paid "Settled bills", Due "Money still owed", Cancelled "Not charged". With "All
  dates" the HTML's trailing-space slip ("None ") is not copied: "None yet" (my call).
- **Phone strip** (values §3.3; below a 560 px list): five tabs; the chosen one shows its dot and count, the others the
  dot alone; the current-lane row shows the chosen lane's ₹ total and line, and on Open with a printed bill the HTML's
  action "Settle T1" (`--ink` button) which **opens that order's detail** (Q6).
- Tapping a lane: that lane, the search cleared, the chosen order back to the first row (≥ 1280) or none (the HTML's).

### 6.3 Toolbar, date, Filters panel, chips
- **Search box** (values §4: 40 px, radius 9, the 15 px icon, 14 px text, 16 px below 720 px per ruling R36): placeholder
  **"Search by customer phone"** (Q4), `inputMode="tel"`, the 350 ms wait, the round ✕ "Clear search" when typed. While a
  phone is typed no lane is lit (the HTML's) and the list head reads "{n} matches in all orders" / "1 match in all orders";
  the date, payment and table filters still apply.
- **Date box** (values §4: 160 px, 40 px, radius 9, 13.5 px 500, the chevron; hidden on the phone, where a "Date" group
  leads the Filters panel as the HTML's): a kit dropdown (no native `<select>`, pin P13) with **Today** (default),
  **Yesterday**, **All dates**, **Pick a day…** (opens our calendar, `DatePicker`'s calendar in a popover; the chosen day
  reads "22 Oct 2026" in the box). The Open lane ignores it.
- **Filters button and panel** (values §4-5: in the page flow under the toolbar, radius 12, 14 px padding): groups
  **Payment**: Any · Cash · Online · Split · Due · Credit (our five settled modes; today's "Open" payment choice is the
  Open lane, mapped) and **Table**: a kit select "All tables" + our tables (260 px, 38 px). Phone: **Date** first (the
  same four choices as pills). Footer "Reset" and "Done". Escape also closes the panel (the HTML has none; my call).
  The count badge on the button = the chips shown.
- **Chips** (values §6): "Paid by Cash" / "Paid by Online" / "Paid by Split" / "Due bills" / "Credit bills", the table
  ("T-4"), and on the phone the date when it is not Today ("Yesterday", "All dates", "22 Oct 2026"); each chip clears its
  own filter; "Clear all" clears payment, table and the phone search (the date stays, the HTML's). The chip's ✕ circle
  uses a token tint, not the HTML's literal blue (my call, so the accent presets and dark mode follow).
- Today's "Filters" word, "{n} active" badge and "Clear all" button are these elements now (mapped).

### 6.4 List head, table, cards, rows
- **List head** (values §7): "{n} {lane} orders" (`{n}+` while more can be loaded) left; right "Bills printed first, then
  oldest" (Open: the loaded tabs re-sorted on the device, the HTML's) or "Newest first" (as the server sends them). On
  the Due lane one line under it (12.5 px `--text-3`): "Dues paid later are on the Customers page." (Q9).
- **Table** (values §8; list ≥ 700 px): head "Order · Customer · [Items] · Time · Status · Amount · (action)"; rows 58 /
  59 px, the selection bar and `--accent-t` when chosen, and the HTML's intended hover `--hover` (its runtime drops it;
  my call, as U1). Whole row tap = choose / open the order (today's "View order" eye goes; mapped).
  - Order cell: the code tile (`T4` / `TA` takeaway / `QR` self-order / `WI` walk-in, the dashboard's `recentOrderCode`;
    billed open tab in the bill tint), title "Table T-4" / "Takeaway" / "QR order" / "Walk-In" (our words, as U1's
    tabs), sub (Geist Mono 11.5) "#014 · Dine-in" (`#` + the order id's day number; our channel words Dine-in /
    Takeaway / QR self-order / Counter) and " · Token 12" when it has one (today's token label stays). The sub does not
    wrap (the HTML's 820 px slip, values §20 #6, not copied).
  - Customer cell: the name; a walk-in reads "Walk-in" with "No customer added" under it (the HTML's words); a named
    customer has no second line (we have no phone or visits in a row), my call.
  - Items cell (list ≥ 900 px): "{qty}× {first item} +{n} more" (now with the quantity, the HTML's).
  - Time cell: the time; under it "Open {m} min" / "Open {h}h {m}m" for an open tab (`--warn-i` from 30 min, `--bad-i`
    from 60, 600), else "Today" or "22 Oct" for older orders.
  - Status pill: "In kitchen" (`--info`; an open tab), "Bill printed" (`--bill`; open, its bill printed), "Paid · Cash" /
    "Paid · Online" / "Paid · Split" (`--ok`), "Due" (`--bill`; any settled bill with money owed, also Credit and short
    payments), "Cancelled" (`--bad`). Today's separate payment and status badges fold into this pill (the HTML's), mapped.
  - Amount cell: Geist Mono 14 / 600, struck in `--text-3` when cancelled (the HTML's); "₹x due" under it (`--bill-i`).
  - Action cell: "Settle" (32 px outline, hover `--ink`) on open tabs: **opens the detail** (Q6). No "Collect" (we
    collect dues per customer on the Customers page).
- **Cards** (values §9; list < 700 px): tile 38, line 1 title + "#014", line 2 "{customer} · {items}", right the amount
  and the age (open) or the time (settled), bottom line the status pill and "₹x due". No action button (the HTML's).
- Today's row icons go: View (whole row), Settle (row "Settle", table form) and Cancel (into the detail's danger link,
  admins only, 6.9). Every one of today's actions is still reachable.

### 6.5 Loading, error, offline, empty, more
- Loading: skeleton rows in the list box in the HTML row shape (table 58 px rows / cards 90 px), my call.
- First-load error: today's `ErrorState` "Couldn't load orders" / "Check the internet connection, then try again." /
  "Try again" (pinned), placed where the list box sits.
- Offline: today's line "You appear to be offline. Orders will load when the connection is back." in the HTML's empty
  style inside the list box (14 px 600 is the HTML's title size; ours is one line, 13 px `--text-2`), my call.
- Empty (values §13, the HTML's words): searching → "No orders match “{phone}”" / "Try another phone number." (our search
  is phone only); filters on → "No orders match these filters" / "Remove a filter to see more." with our "Clear filters"
  button kept (40 px outline, our option); Paid or Due with more settled orders to load → "No {paid | due} bills in the
  latest {n} settled orders" / "Load more to check older ones." with Load more (Q10); else "No {lane} orders {today |
  yesterday | on 22 Oct}" / "They will show up here as they happen." ("No orders today" on All). Load more shows whenever
  more can be loaded, also under an empty list. Today's "No orders yet" and its "New order" button go (the header has
  New order).
- **Load more** (our option): under the list box, centred, a 40 px button in the HTML's Filters-button look (radius 9,
  1 px `--border`, 13.5 px 500): "Load more" / "Loading…" / "Retry"; the error line "Couldn't load more orders. Check the
  connection, then tap Retry." above it (12.5 px `--bad-i`). Same request and paging as today.

### 6.6 The detail: frames and choosing
- **/orders from 1280 px:** the HTML's 400 px column (values §11.1), always there. With nothing chosen it shows the first
  row's order (the HTML's); changing the lane, the date, a filter or the search goes back to the first row. When the list
  is empty: "Select an order to see its details." No ✕ there.
- **Below 1280 px (both pages):** nothing is chosen until a row is tapped; the detail then opens full screen, sliding up
  from the window's foot (the /pos cart sheet's slide, U1 Task 14), over the header and the tab bar; the HTML's ✕
  (34 px round) closes it, Escape too; the list stays under it.
- **Dashboard from 1280 px:** a 400 px side sheet on the right (the HTML column's look, its ✕ shown), over a scrim.
- One detail is mounted at a time (its print sources, settle latch and payment preload exist once); the frame follows the
  width. After a settle the detail keeps showing the now-settled order (today's), even when it leaves the lane; after a
  move it shows the moved order (today's `onSettled` channel); after a cancel it shows the cancelled order the server
  returns (so "Notify kitchen" is at hand), my call.
- The first row shown at ≥ 1280 is taken as the chosen order when it is shown (my call): a list refresh or a new order
  arriving never swaps the detail under the operator; it changes only when the operator taps a row or changes the lane,
  date, a filter or the search. A chosen order is today's snapshot (`liveOrderOf(detail, list)` unchanged; the list rows
  carry no `updatedAt`, inventory 8.1, a pre-existing owner note). A press inside the payment / move / customer sheets never
  closes a detail sheet beneath (ruling P38); those sheets stay above the detail at every width.

### 6.7 Detail head and steps
- Head (values §11.2): the ink code tile (46 px), the title ("Table T-4" / "Takeaway" / "QR order" / "Walk-In") and
  "#014"; the meta row with the HTML's icons: the channel word, the staff name (our `receiver`, the person who took the
  order; the HTML's creator), "Token 12" when it has one (our option, in the meta row with a ticket icon), and the clock:
  an open tab "8:22 PM · 1h 8m" (coloured as the HTML's), a settled one "8:16 PM", an older one "22 Oct · 8:16 PM".
- Steps (values §11.2): open tab: **Opened** (its time) → **Kitchen** ("Sent" once a round was fired; an order whose every
  line skips the kitchen reads "Not needed" and counts as done, my call) → **Bill printed** ("Printed" when the bill was
  printed, `billPrintedNow`) → **Paid**; the first step not done is the HTML's "current" one with "Next". Settled with
  nothing owed: all four done (the HTML's; "Paid" has no time: we store no paid-at time). Settled with money owed: last
  step "Due" in the bill look. Cancelled: **Opened** → **Cancelled** (its time).

### 6.8 Customer, items, sums, void trail, cancel note
- Customer row (values §11.4): avatar with the initials (`--accent-t` / `--accent-i`) and the name; a walk-in: "?" avatar,
  "Walk-in customer" / "No customer added" (our data has no phone, so the HTML's "No phone · bill can’t be sent" is not
  used). No "+ Add customer" (a customer is attached at payment, in the payment sheet, as today).
- Items box (values §11.5): "{n} items" (Σ qty) and "Amount"; each line "{qty}×", the name with its variation
  (`orderItemLabel`), the meta line (our removed / added modifiers and the instructions, joined ", "), the line total; a
  reward line keeps its struck price and "FREE" with the note "Reward — free" as its meta (today's).
- Sums, **all from the order's stored figures so they always add up** (the HTML's settled sums skip charges and tax,
  values §20 #15, not copied): "Subtotal"; the discount (`discountLineLabel`: "Discount" / "GST Discount" / "Reward")
  "−₹x" in `--bad-i`; each charge (table charge, extra charges, from the order's snapshot); "GST @{rate}%" when the order
  has GST (today's sheet leaves it out, inventory 8.2; shown now, display only); settled: "Paid by Cash" / "Paid online" /
  split "Paid in cash" + "Paid online" (our split amounts) / "Paid ₹x" for a short payment, and "Due at billing"
  (`--bill-i`, Q9). GST as our bill shows it (exclusive: a row; inclusive: an "incl." row), builder's call.
  Total: "To pay" (open), "Bill total" (settled), "Not charged" struck in `--text-3` (cancelled).
- Void trail (our option): under the sums, inside the items box after a dashed rule, the caption "Voided after the kitchen
  was notified" (11.5 px uppercase `--text-3`, as the box head) and each void as a line: "{qty}×", the name struck in
  `--text-3`, under it "round {n} · {reason} — {who}, {date}", its amount struck (reward voids "FREE"), my call.
- Cancel note (values §11.6, our words): "Cancelled at {time} by {who}." and "Reason: {reason}" in the HTML's red note.

### 6.9 Quick actions, danger link, foot
- **Quick actions grid** (values §11.7: 62 px buttons, 18 px icons, 12 px 600 labels). Ours, in this order:
  "Print bill" (an open tab whose bill was not printed) / "Reprint bill" (otherwise) = today's Print (always a duplicate,
  `reprint: true`); "Reprint KOT" = today's KOT, on open and settled orders as today, and **"Notify kitchen"** on a
  cancelled order (today's cancel notice); "Share bill" = today's WhatsApp link; **"Reprint token"** when the order has a
  token (our option); "Move table" / "Assign table" on an open tab (a walk-in tab: Assign, our option). Up to four in one
  row; five (open tab with a token) in two rows of 3 + 2 (my call: five 72 px cells cut the labels). The grid never
  shrinks: the body scrolls (the HTML's squeezed, clipped grid at 1280 / 1024 lets a tap fall on "Cancel this order",
  values §20 #2-#3: not copied).
- **Danger link** "Cancel this order" (values §11.8) for **admins only**, on open and settled orders (today's row Cancel
  moves here), opens the cancel dialog (6.10). No "Refund this bill" (we have no refund; our cancel of a settled order
  reverses its dues and takes it out of sales, as today's dialog says). Staff never see it (today's).
- **Foot** (values §11.9) on an open tab: "Edit items" (Q7; tabs at a table only) + "Settle & pay · ₹x" (today's Settle &
  Pay, the same latch and payment sheet); a walk-in tab: "Settle & pay · ₹x" full width. Settled and cancelled orders: no
  foot. Bottom padding adds the safe-area inset at every width.

### 6.10 Cancel dialog
Today's dialog in the HTML confirm sheet (U1's `ConfirmDialog look="sheet"` frame, `lib/sheet-frame.ts`: 420 px, 18 px
title, 14 px body, stacked 46 px buttons): title "Cancel {orderId}?", today's sentence ("Total ₹x. The order stays on
record, …This cannot be undone."), "Reason (required)" with the 48 px field (placeholder "e.g. duplicate order, guest
walked out", 200 characters), "At least 3 characters." (`--bad-i`), then "Cancel order" (`--bad`, disabled until 3
characters, spinner while sending) and "Keep order" (`--surface-3`; new word for the HTML confirm's second button, my
call). Same request, same rules, admins only.

### 6.11 Dashboard
The dashboard opens the same detail (Live tables, Recent orders): from 1280 px a 400 px side sheet, below 1280 full
screen from the bottom (6.6), the same content and actions (no Cancel there today: the dashboard mounts no cancel dialog;
the danger link shows only where the page provides the cancel, i.e. /orders), "Edit items" as on /orders. Nothing else on
the dashboard changes.

### 6.12 Behaviours that stay exactly
Every request and its timing (the first page refreshed every 30 s only while one page is loaded, paused while an order
write runs; focus refetch; the realtime nudge; Load more by cursor; the first page kept when leaving; the 30-minute
cache), the phone search wait, the URL seeding (`?status=Pending` → Open, `?status=Cancelled` → Cancelled,
`?status=Completed` → Paid, `?payment=Unpaid` → Open, another `?payment=` → that payment filter, `?date=YYYY-MM-DD` → that
day; a date with no status opens All, so a report's day drill-down shows that day; a link that carries a status or a payment
but no date opens on "All dates" as today (plain `/orders` opens on Today, Q5), so the dashboard's "{n} cancelled orders" over a week still lists them all; my calls), every print path and its
guards (`routePrint`, `enqueuePending`, `localPrintOf`, skip-KOT info toast, the off-screen print sources), the settle
latch and its notices, the move flow and its slip, the cancel request and its rules, roles (cancel admin-only), every
validation and message. Test pins on look move on purpose with the reason; pins on behaviour keep their meaning.

### 6.13 Keyboard
Escape closes the open Filters panel, then a detail sheet (dialogs as today). No new shortcuts on this page (the HTML has
none here).

## 7. What the HTML has that we do not (left out; never added without the owner)
Lane counts and totals for lanes not chosen and the header's day totals (Q1); order types as a filter (Dine-in /
Takeaway / Delivery) and Delivery itself; guests; the customer's phone and visit count; search by order number, table or
name (Q4); "Last 7 days"; per-order "Collect" / "Collect due"; "Refund this bill" and "Refunded"; "KOT pending" (unsent
lines live only in a POS cart); "+ Add customer" on an open order; manager approval for cancel / refund; UPI vs Card as
two modes; "e-bill sent" and the share toasts (our Share opens WhatsApp); the "Order" nav badge count.

## 8. The HTML's own slips (my calls)
Copied: the list form by list width (cards at 1280 with the nav open, table when collapsed), the Open lane ignoring the
date, "Clear all" keeping the date, the filters panel in the page flow. Not copied: the squeezed and clipped quick actions
(a tap can cancel an order); text at the top of the Settle and strip buttons (centred); no hover on rows (the intended
`--hover`); the 820 px sub wrapping; the trailing space with "All dates"; "1 guests"-style plurals (ours "1 item" /
"1 order"); the literal blue chip ✕ circle; settled sums that do not add up; a payment filter never matching an open tab
is kept (an open tab has no payment yet).

## 9. Must not change
Data, requests (no new request of any kind; no recurring one; the same endpoint, filters and paging), routes, roles,
printing and the paper, the S1 pin, the print budget, WebView 109 CSS (no `light-dark()`, no runtime `color-mix()`; the
postcss fallbacks; container queries are supported from Chrome 105), the preset-token rule in kit files, `PaymentModal`
≤ 300 lines and the other line budgets reached from here, test-used names unless section 11 changes them.

## 10. Verification
As U1: `compare-ui.mjs` probes per task at the five viewports against the HTML (boxes ±1 px, sizes ±0.5 px, fonts and
colours exact; our data put in the HTML's states with the local `patch` / `rewrite` actions where needed, e.g. an open tab
with a printed bill, a due bill, a cancelled order); every remaining difference is a mapped item of sections 4-6 with a
ruling (the five lanes, the 1024 / 820 rows of the right-panel rule, our words for our data). Side-by-side shots of every
state and size for the owner; every suite; the live legs; a production build; every page's first screen; the a11y check
with the detail and dialogs open; the idle request count on /orders equal to main's (same endpoint, the first view now
`status=Pending`); the paper; the emulator on WebView 109 (and a look at 154 for the safe area); the write paths for real
on the scratch DB (settle, move, cancel, reprints); then a fresh Claude Fable 5.1 review of the whole branch, one fix wave,
its re-review.

## 11. Visible words that change
The HTML's words where the HTML has the element (Q-words rule): "Search orders by customer phone…" → "Search by customer
phone" (Q4); "All statuses / Pending / Completed / Cancelled" select → the lanes "All · Open · Paid · Due · Cancelled";
"All dates" picker + "Today" button → the date box "Today · Yesterday · All dates · Pick a day…"; "Filters" label +
"{n} active" → the Filters button and its count; payment choice "Open" → the Open lane; table heads "Order · Customer ·
Items · Total · Due · Payment · Status · Actions" → "Order · Customer · Items · Time · Status · Amount"; badges "Pending"
/ "Completed" + payment badges → the status pill ("In kitchen", "Bill printed", "Paid · Cash", "Due", "Cancelled"); "No
matching orders" / "Try clearing or changing the filters." → "No orders match these filters" / "Remove a filter to see
more." (pinned: the pin moves on purpose); "No orders yet" / "Orders placed from New Order will appear here." → "No open
orders today" etc. / "They will show up here as they happen." (pinned: moves); sheet "Customer" / "Served by" rows → the
customer row and the meta row; "Total" → "To pay" / "Bill total" / "Not charged"; "Paid" → "Paid by {mode}"; "Due" →
"Due at billing" (Q9); "Print" → "Print bill" / "Reprint bill"; "KOT" → "Reprint KOT"; "Notify Kitchen" → "Notify kitchen";
"Share" → "Share bill"; "Token" → "Reprint token"; "Settle & Pay" → "Settle & pay · ₹x"; "Voided after the kitchen was
notified" stays. Pinned words that stay: "Service" (sr-only eyebrow), "Orders", the error and offline words, "Clear
filters", "Settle" (the payment's button).
Hint lines on other pages that quote these buttons, kept true: Settings → Kitchen ticket "…press KOT on any order in
Orders." → "…press Reprint KOT on any order in Orders."; Settings → Tokens "…press Token on any order in Orders." →
"…press Reprint token on any order in Orders."; Settings → Bill print "…reprint any bill from Orders." stays.
