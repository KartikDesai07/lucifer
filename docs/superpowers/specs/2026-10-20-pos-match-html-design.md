# U1: the POS terminal (/pos) rebuilt to the owner's HTML (design)

Status: for the owner's approval, 2026-10-21. Branch `feat/ui-pos` from main `d73dafb` (U0 merged). Nothing is coded
before the owner approves this document. The owner's answers (2026-10-20/21) are in section 4; "my call" marks a
decision of mine the owner can still change.

## 1. Why, and the rule

The owner chose the Order screen as the first page after the dashboard (2026-10-20) and wrote: "Ye main hai so very very
very carefull … proper all thing proper deep understand karo, review karo, kaha ekse kya hai dekho, aesa nahi ki same
aesa hi bana dena hai, aesa hi karna hai but thoda soch ke ki current ye option hai UI me nahi hai to wo option rakhna
hai uski fir UI think karke proper manage karni hai."

So: the HTML's Order screen is the look, measured to the pixel (the rule since 2026-10-19: the HTML's numbers are the
spec; a visible difference is fixed or shown to the owner, never parked). **Every option /pos has today stays**, and
where the HTML has no place for it, it gets a place designed in the HTML's own visual language (section 6). Nothing new
is invented on the data side: what the HTML shows that we have no data for is left out and listed (section 7).

## 2. Sources

- The mock-up: `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked `design\unpacked\`).
- **The exact values:** `docs/superpowers/specs/2026-10-20-pos-html-values.md` (98 measured states at the five
  viewports, 344 reference shots in `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-pos\`; mock clock Mon 19 Oct 2026
  9:30 PM IST). Every number an implementer needs is there; this document adds only decisions and the mapping of our
  features. Theme, shell, toast: `docs/superpowers/specs/2026-10-19-u0-html-values.md`.
- **What we have today:** `D:\kd\pos-dev-keep\ui-redesign\inventory\pos-features.md` (every element, word, state,
  dialog, setting, role difference and test pin of /pos; 47 options with no HTML counterpart) and 185 shots of the
  current page in every reachable state, `D:\kd\pos-dev-keep\ui-redesign\current-pos\` (index.md).

## 3. Scope

**In:** the /pos page and everything it opens: the header on /pos, the open-tabs switcher, categories, search, item
cards, the cart (lines, the note, the bill options, the bill, the buttons), the phone/tablet order bar and cart sheet,
the item options modal, the payment sheet, the customer sheet, the table picker, the move/assign table dialog, the void
dialog, the three POS prompts, the send-discard confirm, the notices (menu changed, write notices), loading/empty/error
states, the "/", F8, F9 keys.

**Shared, restyled everywhere they open (owner, Q4):** `PaymentModal` (with `CustomerSearch`, `PaymentPoints`,
`PaymentModeGrid`, `PaymentSplitFields`, `PaymentSummary`, `WriteNotice`) and `MoveTableDialog` / `MoveTablePicker` are
also opened from `OrderDetailSheet` (Orders page, dashboard): they take the new look there too, with the same
behaviour. `ConfirmDialog` (about 30 users) gets an optional `look="sheet"` prop, default unchanged; only the POS
prompts and the send-discard confirm pass it.

**Out:** the paper (KOT, bill, token, void and move slips: the S1 43-file pin and `print-budget.test.ts` stay untouched),
the printer panel's insides, the shell outside /pos, every other page's body, `/m`.

## 4. The owner's decisions (2026-10-20/21)

| # | Point | Decision |
|---|---|---|
| Q1 | Words | **The HTML's words** where the HTML has the same element (as U0): "Send KOT · 2", "Pay ₹954", "All sent", "No items" / "Tap a price on the menu to add an item.", "Search items", "Categories", "Find category", "All items", "Category", "Open orders", "Choose a table", "Review order", "‹ Menu", "Clear", "Size", "Add-ons", "Kitchen note", "Add to order · ₹x", "Unavailable", "Customisable", "Total", "Details" / "Hide details", "Amount to collect", "Change to return". Our words for our own features and data (section 6). |
| Q2 | Header on /pos | **The HTML's Order header** (6.1). |
| Q3 | New button | **No New button** in the header (a fresh order starts as today: Clear / Close in the cart). |
| Q4 | Shared dialogs | **The new look everywhere** they open; `ConfirmDialog look="sheet"` for the POS prompts only. |
| Q5 | Card buying | **As the HTML:** price buttons add directly (one per variation, up to 3; more → one "Choose" button that opens the options); the name opens the options modal. |
| Q6 | Photos | **The HTML's photo area** on cards whose product has a photo (none otherwise). |
| Q7 | Veg / non-veg | **Left out** (no data; a later data feature only if the owner asks). |
| Q8 | Layout setting | **Kept:** "Normal" = one grid of HTML cards, "By category" = the HTML's groups. |
| Q9 | Cart cells | **Two cells:** Table, Customer. |
| Q10 | Line actions | **Select a line** → its action row: "Remove" (a new line), "Void" (a sent line on a tab). |
| Q11 | Footer | Owner: "hamare current hai aesa but design new ke base proper easy to use and easy to understand UI think karo and proper manage karo" → then approved the proposal in 6.8: links "Discount · Promo code · Reward · Extra charge · Note"; the first four open one "Bill options" panel at the tapped section; Note its own panel; applied values shown on the links. |
| Q12 | Bill rows | **The HTML's "Details" toggle** (closed below 820 px window height). |
| Q13 | Keyboard | **Added:** "/", F8, F9 (not while typing or with a dialog open); chips from 720 px. |
| Q14 | Payment quick amounts | **Not added** (amount fields only, as today). |
| Q15 | Category list | **Counts on every row + dots** in the HTML's five hues in turn. |
| Q16 | Open orders | **Tabs "All · Tables · Walk-In"** with counts; **no footer buttons**. |
| – | Phone cards | **One card per row** on the phone, as the HTML (three at 820, two on laptops). |
| Q17 | KOT reprint | **Moves into the Open orders panel** at every width (6.2), so the phone header keeps the switch button's text; the header keeps only Refresh (apps) and Tokens (when on) before the printer. |
| Q18 | Empty order below 1024 px | **The order bar always shows** (as today's bar), also on an empty new order, so Table, Customer, Note and Bill options are reachable before the first item. |
| Q19 | Cart on tablets (owner, 2026-10-22, after the preview) | "muje wo mobile jesa kardo niche se open ho side se nahi, side me only pc ya laptop me hi" (the right cart panel): **below 1280 px the cart is never a side column or side sheet**: the order bar shows and the cart opens like the phone's, full screen, sliding up from the bottom (the phone gets the same slide-up); **1280 px and wider** (PC / laptop, nav open or collapsed) keep the right cart column. This overrides the HTML's 1024–1279 cart column and 820 px side sheet and Q18's "below 1024" (now below 1280). |
| Q20 | How tablets are told apart | **By width: below 1280 px = the mobile style** (most Android tablets are 800–1200 CSS px wide in landscape; laptops, PCs and touch POS terminals are 1280+). |
| Q21 | Other pages | Other pages' right-side panels (e.g. the Orders page's order detail sheet) follow the same rule **in their own page sessions**, not in U1. |

Builder-check answers (my calls): on a tab that already has a customer, the payment sheet shows a read-only pill
"Customer: {name}" (no "· change"), so the name never disappears (today it is in the description line); the customer
sheet shows today's line "Search by name or mobile, or add a new customer." in its list area until a search runs (no
"frequent customers" list: that would be a new request).

## 5. Layout per width (the HTML's, values doc §0.3 and §15)

| Width | Header | Categories | Menu | Cart |
|---|---|---|---|---|
| ≥ 1280, nav open (`d1280`) | switch order · Printer + clock · printer | 200 px column | middle, 2 card columns | 360 px column |
| 1280, nav collapsed (`c1280`) / 1100–1279 | brand text first | 220 px column | middle | 380 px column |
| 1024–1099 (`t1024`) | brand text first | "Category" button + sheet | 2 card columns | 340 px column |
| 720–1023 (`t820`) | brand text first | button + sheet | 3 card columns | 440 px sheet from the right over a scrim, opened from the order bar |
| < 720 (`p390`) | mini logo · switch (fills) · printer | button + sheet | 1 card column | full-screen sheet over the header and the tab bar, opened from the order bar (which sits on the tab bar) |

The page fills the screen under the shell (as the HTML's page, it does not scroll: the category list, the menu and the
cart scroll on their own). Today's two-pane switch at 1280 px moves to the HTML's breakpoints (cart column from 1024 px,
category column from 1100 px). The grid is `repeat(auto-fill,minmax(min(200px,100%),1fr))`.

## 6. Our features in the HTML's design

### 6.1 Header on /pos
The HTML's Order header (values §1), not U0's title header:
- Phone: the mini logo, the switch-order button (fills the row), the printer button.
- 720 px and up: the brand text (cafe name in Shrikhand 20 px `--brand`; second line "{product} · {this device's name}",
  as the nav's) where the HTML shows it (720–1279 px and the collapsed nav); the switch-order button right-aligned in the
  actions area; the clock block ("● Printer" and the time); the printer button.
- "POS Terminal" stays the page's `<h1>` for screen readers (pinned), not shown: the HTML has no title on this page.
- Our header buttons that the HTML's Order header does not have: **Refresh** (apps only, as today) and **Tokens** (when
  tokens are on, as today), before the printer button, in the U0 header-button look. **KOT reprint** moves into the Open
  orders panel (owner Q17, 6.2). The **Tables** and **New order** quick links are not shown on /pos (the Floor is in the
  nav and behind the cart's table cell).
- Room (my call): with no New button the 1024 px header has 84 px to spare beside the HTML's natural widths; when our
  extra buttons do not fit (tablet widths in the apps with tokens on), the brand text hides first, then the clock block;
  the switch button never shrinks below its code tile + count pill (on a phone in the app with tokens on, its title and
  sub are cut with an ellipsis first).
- The clock block's dot follows the printer button's dot (green = printing on, orange = off), my call (the HTML's text is
  static). The time ticks once a minute on the device (no request), "{Mon, 19 Oct} {9:30 PM}" as the HTML.

### 6.2 Switch order + Open orders (our Open tabs)
- The switch button shows **the order on screen**: code tile (a table: "T" + the table name's digits, else its first two
  letters; a walk-in tab "WI"; a new order "+"), title ("Table T-4" / "Walk-In" / "New order"), sub ("{customer or
  Walk-In} · {n} item(s) · ₹{total}" or "No items yet"), the "{N} open" pill (our open tabs), the chevron; dot grey = no
  items, orange = items not sent, green = all sent (my calls on the code and words).
- It opens the HTML's **Open orders** panel (top right under the header from 720 px; a bottom sheet on the phone): title,
  "{N} open · ₹{sum}", the search box "Table, customer, phone or order #" (filters the tabs already loaded by table,
  customer name and order number; phone only if the tab data carries it: no new request), the tabs **All · Tables ·
  Walk-In** with counts, the rows (code tile, "Table T-4 · current" / "Walk-In", "{customer} · {n} items · {m} min",
  ₹total, status "In kitchen" green; the current one lit), "No open orders match “…”", and the empty state with our words
  ("No open tabs" / "Orders you send to the kitchen appear here until settled."). Tapping a row = today's resume (with
  today's "Discard unsent items?" prompt when needed).
- No "+ New …" footer. Only after this device printed or sent something (today's rule for the header KOT button), the
  panel's foot holds one 40 px outline button "Print kitchen ticket · {order id}" (title and aria "Print kitchen ticket
  for {order id}", disabled while busy): today's KOT reprint, the same action (owner Q17).

### 6.3 Categories and search
- ≥ 1100 px: the HTML's category column: "Categories" + "{n} total", "Find category" (filters the list on the device),
  "All items" + the count of products, then our categories in their order, each with its product count and an 8 px dot
  in the HTML's five hues in turn (#E8590C, #C92A2A, #D19A00, #1C7ED6, #AE3EC9; decoration, not data). No "Popular" and
  no section headings (no data). Rows hover `--surface-2` (the HTML's intended hover; its runtime drops it). Below
  1100 px: the HTML's "Category  {name}" button and bottom sheet (Done, Find category, the same rows). Today's chips go.
- The toolbar: the search box (the HTML's 36 px box, "Search items", the "/" chip from 720 px; 16 px text below 720 px,
  ruling R36). No Veg / Non-veg filter. Our item count stays for screen readers (aria-live); the counts show in the
  category list and the group headings. "Couldn't refresh · Try again" sits at the toolbar's right as a 13 px `--bad-i`
  link button (where the HTML's filter is). Loading: HTML-shaped card skeletons; "Failed to load products. Refresh to
  retry." and our "No products found" in the HTML's no-results style (centred, 14 px `--text-2`, 64 px padding); a
  search with no hit reads the HTML's "No results for “{q}”".

### 6.4 Item cards
- The HTML card (radius 14, padding 12, the lift on hover, accent border + ring + qty badge when in the cart; opacity .45,
  photo greyscale and both buttons disabled when out of stock).
- Photo: the product's photo in the HTML's photo area (112 px, 96 px on the phone, radius 10, cover) when it has one;
  nothing otherwise (today's icon / initial square goes).
- Name: one line with an ellipsis, title = full name, as the HTML (today two lines). No veg mark: the name starts where
  the HTML's mark sits.
- Tag line (12 px, always present): "Unavailable" in `--bad-i` (out of stock), else "{n}% off" (`--text-2`), else
  "Customisable" (products with add-ons), else the category name (only in the Normal layout with All, as today), else
  blank. The struck original price goes (the tag says the discount), my call.
- Price strip: plain product → one button "Add" + ₹price. Variations (1–3) → one button per variation, labels shortened as
  the HTML (Regular → Reg, Medium → Med, Large → Lrg, Standard → Add; other names as they are, cut with an ellipsis),
  prices after the product's % discount. More than 3 variations → one button "Choose" + "₹a–₹b" that opens the options.
- Tapping the **name** opens the options modal (today's corner button "Add with note or quantity"; that button goes).
  Tapping a **price** adds that item / variation at once with its default options: none ticked, or all ticked for a
  "modifiers come ticked" product; it merges into an equal new line as today.
- Normal layout: one grid, no headings. By category: the HTML's groups ("● {category} {count}" heading, 24 px apart),
  "Other" last for products without a known category.

### 6.5 Cart head
- "‹ Menu" (sheet only), then the title row: title 20 px: "Table T-4" / "Walk-In" for a resumed tab, "New order" for a
  new one (my call); meta (Geist Mono 12 px) for a tab: "#{the order's day number} · {m} min" (from its order id and
  creation time; e.g. "#012 · 32 min"), nothing for a new order; "Clear" (a new order with items: items only, as today) or
  "Close" (a resumed tab, as today), in the HTML's red link style (26 px, `--bad-i`, hover `--bad-t`).
- Two cells (grid of 2): **Table** ("T-4 · {area}" / "Walk-In"; a new order → our table picker; a tab → our move/assign
  dialog; busy → disabled) and **Customer** (name or "Add"; opens the customer sheet with exactly today's header-chip
  behaviour; busy → disabled). No "Order details" popover (order type, guests and pickup time are not our data).

### 6.6 Lines
- The HTML line: "01" number, name (one line), meta (variation · + add-ons · NO removed · instructions, joined with ", "
  as the HTML's meta), the stepper and the line total, the status line: "Sent to kitchen" (green dot) / "New · not sent"
  (orange). Sent lines first, then new ones (as today). Sent lines stay locked: "×{qty}" (13 px 600 `--text-2`) where the
  stepper sits. Reward lines show their real price, as today.
- Tapping a line selects it (`--accent-t` + inset `--accent-b` ring; tap again to unselect) and opens one action row
  under it (12.5 px `--link` buttons): a new line → **"Remove"**; a sent line on a resumed tab → **"Void"** (opens
  today's void dialog with that line chosen). "−" at 1 still removes a new line. Busy → no actions.
- "Add items to fire another round." stays under the lines when a tab has nothing new (13 px `--text-2`), my call.
- Empty: the HTML's "No items" / "Tap a price on the menu to add an item."

### 6.7 Footer: links and bill options
- Links row (12.5 px 500 `--link`, gap 4 × 16, wraps): **Discount** · **Promo code** · **Reward** (only when the customer
  has stamps, rungs or cards) · **Extra charge** · **Note** (new orders only). An applied one reads in `--accent-i` 600
  with its value: "Discount · ₹50" / "Discount · 10%" / "GST Discount", "Promo · SAVE10", "Reward · {worth}", "Extra
  charge · 2", "Note · {first words…}".
- The first four open **one "Bill options" panel** in the HTML's popover style (white, 1 px border, radius 12, `--pop`,
  padding 14, title "Bill options" 13 px 600 + "Done" link), anchored over the lines above the footer, its tapped section
  scrolled into view and its first field focused. Sections in today's order, each with a caption (12 px 600 `--text-2`):
  **Reward** (today's rungs, cards, reasons, auto-pick), **Promo code** (field + Apply / applied + Remove), **Discount**
  (the value field + the ₹ / % segmented control in the HTML's segmented look + the GST Discount toggle and its blocked
  line), **Extra charges** (the list with Remove + "Add charge" and its form). Every rule, word inside the controls and
  validation stays as today. Fields 34 px, radius 8, 13.5 px (16 px below 720 px).
- **Note** opens its own small panel (same style): "Order note" + the 200-character field "Order note (prints on KOT)" +
  "Done" (never clears), as today.
- The HTML's "Split" and "Print bill" are left out (we split the payment, not the bill; the bill prints after payment).

### 6.8 Bill, notices, buttons
- The bill block as the HTML's (13 px `--text-2` rows, values `--text`), behind "Total · Details / Hide details" (closed
  below 820 px window height, as the HTML). Rows: "Subtotal · {n} items"; "Discount applied" / "GST Discount applied" with
  "−₹x" in `--ok-i` (the HTML's discount colour); "Promo {code} applied", "Reward: {worth}", "Scratch card: {label}", each
  with "Remove" (the HTML's charge-row link); "GST @{rate}%"; the table charge: "{label}" + "Remove" (= waive) + its amount
  in a small 13 px field (our editable amount, no HTML counterpart, my call), and when changed "{label} waived" /
  "{label} changed from ₹x" + "Undo" in the HTML's "removed · Add back" row style; extra charges with "Remove".
- Total 26 px 600.
- The menu-changed notice and the write notices above the buttons as boxes in the HTML's note style (radius 10, padding
  14, 13.5 px, line-height 1.5): `--warn-t` / `--warn` border for "check" tones, `--bad-t` for refused, `--surface-2` for
  neutral; their words and buttons ("Remove them", "Update them", "Check", …) unchanged.
- Buttons (50 px, grid 1 : 1.4, gap 8): "Send KOT · {new qty}" (F8 chip) | "Pay ₹{total}" (F9 chip). Nothing new to send →
  "All sent", disabled at opacity .5; empty cart → Pay disabled at .4. A tab with new items: Pay is disabled until they
  are sent (today's rule) with today's hint "Send the new items to the kitchen before settling." under the buttons. In
  flight: "Sending…" with the spinner. Unconfirmed send: "Send again" | "Discard" in the two slots.

### 6.9 Phone and 820: order bar and cart sheet
The HTML's glass order bar: first line "{n} items · {Table T-4 | Walk-In | New order}" (12 px `--text-2`), second line
₹total (18 px 600), "Review order" (44 px). It sits on the tab bar on the phone (bottom 59 px, not the HTML's 1 px gap)
and at the foot right of the rail at 820. It **always shows** below 1024 px (owner Q18; the HTML hides it on an empty
order): an empty new order reads "No items · New order" / "₹0"; an adjustment that survived Clear reads our "Adjustment
still applied"; a send that needs attention reads "Couldn't confirm" (our words); the button stays "Review order". The cart sheet: "‹ Menu" on top; full screen on the phone (over the header and tab bar), 440 px from the right
over a scrim at 820; no entrance animation (as the HTML).

### 6.10 Item options modal
The HTML modal (440 px; a bottom sheet on the phone): the name + "✕"; "Size" segments (our variations: required, none
chosen until tapped, as today; full variation names; a price under each); "Add-ons" rows with the HTML's check box (no
prices: ours have none; reverse mode keeps "Untick what the customer does not want."); "Kitchen note": our free-text
instructions in a 48 px field in the HTML's field style (placeholder "e.g. less spicy, no onions"; the HTML's quick chips
need data we do not have); the 46 px stepper; "Add to order · ₹x" ("Pick a variation" while none is chosen). Opened from
a card's name; a "Choose" price button opens it too. A plain product opens it with "Size" left out (the HTML shows
"Standard"; we have no size), my call.

### 6.11 Payment sheet
The HTML sheet (420 px; a bottom sheet on the phone): "Payment · {Table T-4 | Walk-In | New order}" + "✕"; "Amount to
collect" + the 36 px total; the customer pill: where today's picker shows, "+ Add customer" in `--link` / "Customer:
{name} · change" (opens the customer sheet over the payment); on a tab that already has a customer (no picker today), a
read-only "Customer: {name}"; our bill rows (subtotal, discount / reward, GST, charges)
as the HTML's 13 px rows (always shown here: payment is the final check, my call); "The bill changed …" warning; the
points row ("Use {n} points (−₹x)" + switch, reasons, "Customer asked to use points"); the methods segmented control (the
HTML's 5-column track) with **our five modes**: Cash, Online, Due, Split, Credit; Cash and Online: "Amount received" +
one 44 px field "₹ …" (right-aligned 15 px 600), Cash also "Change to return" (22 px `--ok-i`); our partial-payment line
"₹x unpaid — added to …'s dues." (12.5 px `--warn-i`) where the HTML's "Short by" line sits; Split: the HTML's two boxes
"Cash" and "Online" (both editable, as today; must add up, our line); Due / Credit: the HTML's note box with our
sentences and the "Select a customer …" check (warn colours when no customer, as the HTML's due box); "Served by {name}"
(12 px `--text-3`, centred); the 50 px main button with today's labels and states ("Place Order · ₹x", "Settle · ₹x",
"Check", "Close", "Send again") and the frozen "Discard". No quick amounts (owner Q14).

### 6.12 Customer sheet, table picker, move, void, prompts
- Customer: the HTML sheet (460 px, 600 tall; 88 % on the phone): "Customer" + our sub; the 48 px search field "Phone
  number or name" with the accent ring; before a search runs, today's line "Search by name or mobile, or add a new
  customer." (13.5 px `--text-2`, centred) in the list area; the list caption once results show; rows (initials avatar, name, mobile in Geist Mono masked for
  staff as today, "{n} visits" and "Due ₹x" (`--bad-i`) on the right, a check on the current one); our "Searching…",
  offline, failed and "No matches. Add a new customer below." lines; the 46 px "+ New customer" button; our "Walk-In"
  (removes the customer) as the link button at the foot. Add form: "Mobile number" (+91 prefix, Geist Mono) then "Name",
  48 px fields, our rules and messages, "Add customer".
- Table picker (a new order): the HTML sheet "Choose a table" + our sub, the legend (Free / Has an order · tap to open /
  Reserved), areas with "{n} FREE", 78 px tiles: Free ("Free" `--ok-i`), an occupied table with an open tab ("₹x open"
  `--info`, tap = resume, as today), occupied without a tab ("Occupied", disabled), reserved ("Reserved" `--res`,
  disabled), the chosen table "Current" (accent); "{capacity} seats"; "Walk-In (no table)" as a 46 px full-width button at
  the foot.
- Move / assign (a tab): the same picker look; today's confirm step (charge preview, "New total") in the HTML's note box;
  "Remove from table" as a red link; "Cancel".
- Void: the HTML sheet frame (420 px): the sent lines as the HTML's check rows (one choice), the 46 px stepper, "Reason
  (required)" in the 48 px field, a `--bad` "Void item" button, "Cancel" link.
- Prompts (discard unsent items, free table, discard a send): `ConfirmDialog look="sheet"` = the HTML confirm (420 px,
  18 px title, 14 px body, stacked 46 px buttons: the action in `--accent`, or `--bad` when destructive; then "Cancel" /
  "Keep Occupied" in `--surface-3`).

### 6.13 Keyboard
"/" focuses the search (not while typing in a field); F8 = the Send KOT button, F9 = the Pay button, each only when that
button is enabled, no dialog or sheet is open and the focus is not in a field. Escape closes the open panel (as the
dialogs do today). Chips "/" / "F8" / "F9" from 720 px.

### 6.14 Behaviours that stay exactly (unchanged code paths)
Every request and its timing (open tabs every 30 s, the customer search debounce, the rewards fetch, menu freshness),
idempotent sends, the print bridge order (KOT → token → bill), the wake lock, the unsaved-work guard, the table hand-off
from the Floor, the self-order auto-print, the alert strip suppressed on /pos, lazy dialogs and memo boundaries, roles
(none on /pos), every validation and message. Test pins on look are updated on purpose with the reason; pins on
behaviour stay.

## 7. What the HTML has that we do not (left out; never added without the owner)
Order types (Dine-in / Takeaway / Delivery), guests, pickup times, delivery address and fee, packing charge, veg / non-veg
marks and filter, "Popular", category sections and colours, add-on prices, kitchen-note quick chips, the "Order details"
popover, "Split" the bill, "Print bill" before payment, UPI vs Card as two modes, payment quick amounts, manager approval,
the Captain's "Request bill", the "+ Takeaway / + Delivery / + Table" buttons, a header "New", toasts "{item} added /
removed" with Undo, "e-bill sent".

## 8. The HTML's own slips (my calls)
Copied: the switch button shrinking when the header is full; no entrance animation on the cart sheet. Not copied: "1
items" (we say "1 item"), the missing category counts (owner Q15), hover looks that never apply (we use the intended
`--surface-2`), F8 / F9 while typing or with a sheet open, the phone order bar 1 px above the tab bar, the phone inputs at
14–15 px (ours 16 px below 720 px, ruling R36), the always-green "Printer" text, bill rows rounded one by one (our rows
come from our totals as today).

## 9. Must not change
Data, requests (no new request of any kind; no recurring one), routes, roles, printing and the paper, the S1 pin, the print
budget, WebView 109 CSS (no `light-dark()`, no runtime `color-mix()`; the postcss fallbacks), the preset-token rule in kit
files, test-used names, `page.tsx`'s line budget (its pins change only on purpose, with the reason).

## 10. Verification
As U0: `compare-ui.mjs` probes per task at the five viewports against the HTML (boxes ±1 px, sizes ±0.5 px, fonts and
colours exact; our data put in the HTML's states with the local `patch` / `rewrite` actions where needed, e.g. the "By
category" layout and an open tab at a table); every remaining difference is a mapped feature of section 6 with a ruling.
Side-by-side shots of every state and size for the owner; every suite; the live legs; a production build; every page's
first screen; the a11y check; the idle request count; the paper; the emulator on WebView 109 (tablets use this page);
then a fresh Claude Fable 5.1 review of the whole branch, one fix wave, its re-review.
