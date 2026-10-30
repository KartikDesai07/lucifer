# U4: the Kitchen (/kitchen) rebuilt to the owner's HTML (design)

Status: APPROVED by the owner on 2026-10-30 ("proper easy to use, easy to understand and proper smooth working backend frontend ho so ye design approve hai"). Branch `feat/ui-kitchen` from main `736566b` (U0–U3 merged). Nothing is
coded before the owner approves this document. The owner's answers (2026-10-29/30) are in section 4; "my call" marks a
decision of mine the owner can still change.

## 1. Why, and the rule

The owner picked the Kitchen screen as U4 (2026-10-29). The standing rules apply: the HTML's numbers are the spec,
measured to the pixel; a visible difference is fixed or shown to the owner, never parked as minor; **every option
/kitchen has today stays** (tick / un-tick a line, Mark ready on any card, Undo on both toasts, Try again, Now Serving),
and where the HTML has no place for it, it gets one designed in the HTML's own visual language (section 6). Nothing is
invented on the data side: what the HTML shows that we have no data for is left out and listed (section 7). An HTML slip
is never copied: it is ruled and listed (section 8).

The owner's rule of 2026-10-22 (below 1280 px a right-side panel opens full screen from the bottom) does not come into
play: the Kitchen has no side panel, and this design adds none.

## 2. Sources

- The mock-up: `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked `design\unpacked\`), route
  `kitchen`, markup 540–579, view-model app.js `kitchenVals()` 527–540.
- **The exact values:** `docs/superpowers/specs/2026-10-29-kitchen-html-values.md` ("values §N": 68 states, 194 runs at
  the five viewports, 216 reference shots in `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-kitchen\`; mock clock Mon
  19 Oct 2026 9:30 PM IST; 24 HTML slips in values §10). Theme, shell, toast: `2026-10-19-u0-html-values.md` ("U0
  values"); U3's design `2026-10-28-floor-match-html-design.md` for the shared patterns (full-screen page, refresh strip,
  toaster set, rise clock, WebView 109 lessons).
- **What we have today:** `D:\kd\pos-dev-keep\ui-redesign\inventory\kitchen-features.md` ("inventory": 52 elements
  E1–E52, 24 states S1–S24, 86 test pins P1–P86 labelled L / G / B / BUD, 11 options with no HTML counterpart, the
  requests and their timing, the long words measured) and 140 shots of today's page in every reachable state,
  `D:\kd\pos-dev-keep\ui-redesign\current-kitchen\` (index.md; `tools\kitchen-current-shots.mjs`).

## 3. Scope

**In:** the /kitchen page: the page header's contents on /kitchen (second line, type filter, Now Serving), the
refresh-failure strip, the board and its cards (every part and state), the loading / first-load error / offline / empty /
filtered-empty states, the page's foot, its toasts' place and words.

**Out:** `/now-serving` (it shares `KitchenFreshnessChip`, which stays unchanged for it), `/settings/kitchen-ticket`,
the API route and every lib that builds the payload (`lib/kitchen-board.ts`, `lib/kitchen-cards.ts`,
`lib/kitchen-lines.ts`: read only), the shell outside the header's contents on /kitchen (sidebar, rail, tab bar, More
sheet, the order-requests strip), the printer panel (a later page), every other page, `/m`, the paper (the Kitchen prints
nothing; the S1 43-file pin and `print-budget.test.ts` stay untouched).

## 4. The owner's decisions (2026-10-29 / 30)

| # | Point | Decision |
|---|---|---|
| Q1 | Board layout | **One board in the HTML card look**: today's one board, oldest first, cards across the full width, every card the HTML ticket card. No status columns and no column tabs: we have no "Cooking" step (only line ticks and one Ready that clears the card), and in a rush nobody ticks, so status columns would hold every card in "To cook". |
| Q2 | Type filter | **"All · Tables · Walk-In"** (U1's Open orders words), in the HTML's segmented control in the header, hidden on the phone as in the HTML. A parcel order counts under Walk-In and keeps its Parcel code. Client-side only, no request. |
| Q3 | Header second line | **The HTML's words plus "Updated"**: "{n} active orders · average wait {m} min · Updated just now" (as U3's Floor line; the average from the cards' ages, client-side). A failed refresh shows U3's warn strip under the header: "Couldn't refresh the kitchen board. Showing the last update." + "Try again". Today's "open tabs" and "items" counts leave the page (the cards show the lines). |
| Q4 | Disk | (Session housekeeping, not the page: the dev server's regenerable cache on D: is cleared.) |
| Q5 | The card's button | **"Mark ready"** (the HTML's word, our Ready's exact meaning: the card leaves the board and, with tokens on, the token turns Ready). Lines still open: the ink button "Mark ready · {n} not ticked" (the nudge stays, the button never blocks). Every line ticked: a green "Mark ready", in a green dark enough for white text (the HTML's white on `--ok` is 3.35:1). The separate "Ready to serve" line goes (the green button and "{n} of {n} done" say it). Undo on its toast, as today. |
| Q6 | Our extra card details | **The where line + round dividers**: code = the table's name ("T-4"), "Walk-In" or "Parcel" (with a token: Q9); where line "Table · Order #012 · Token 12 · Self-order"; the instruction as "Note: …" in the HTML's warn ink; a card with two or more rounds gets a thin line before each later round, "Round 2 · KOT #12 · 9:41 PM"; the per-line "Round n · #n · Self-order · age" goes. Late = the red time pill + the red card border (the HTML), and "Late" read to screen readers. |
| Q7 | The stuck in-flight flag (a bug found while measuring, inventory 12.1) | **Fixed**, client-side only: each tap's in-flight flag clears when that tap's own write ends (today it clears only for the latest write, so a line ticked during another tick's write stays disabled until a reload; same for Mark ready + Undo). The requests are unchanged. |
| Q8 | The shell's quick links "Tables" / "New order" on /kitchen (after the builder check) | **As today, on the PC only**: "Hamare old UI me kesa tha aesa top me option tha so dikhao wo mobile me show nahi karna hai, proper pc me hi aana chahiye … quick turant easy to use". The two links keep today's look and place in the header from 1280 px (the owner's PC / laptop width, rule of 2026-10-22); below 1280 (tablets and phones) they are not drawn on /kitchen. |
| Q9 | The card's code in a token cafe (after the builder check) | **The token is the big code** when tokens are on and the order has a token and no table: code "Token 12", where line "Walk-In · Order #012" or "Parcel · Order #012". A table card keeps its table name as the code and the token in its where line. The Ready toast names the card by its code ("Token 12 marked ready"). |
| Q10 | Now Serving on the phone (after the builder check) | **Not in the header below 720 px** (the More sheet's "Now Serving" tile, today's, is the way there); from 720 px the header button "Now Serving". The phone's second line keeps the HTML's room. |
| – | Words (standing, U0–U3) | The HTML's words where the HTML has the same element; our words for our own features and data (section 11 lists every visible word that changes). |

## 5. Layout per width

The page fills the screen under the shell header like the HTML's screen and like /orders and /tables (today's paper frame
`MenuPageShell wide` goes): a `KITCHEN_PAGE_CLASS` built as `FLOOR_PAGE_CLASS` / `ORDERS_PAGE_CLASS` (`POS_PAGE_CLASS`'s
height under the header and the U0 alert strip, `flex flex-col overflow-hidden`). It holds [the refresh strip, 6.2] and
then **the board, the page's only scroller** (values §6.1: the HTML's header never moves; ours is the shell's sticky
header, which equally never moves). The board has the HTML's padding (values §0.3): `16px 20px 24px` from 720 px,
`12px 12px 84px` on the phone, each bottom value plus `env(safe-area-inset-bottom)` (U1 P49: at every width). It wears
the HTML's thin scrollbar (8 px, scoped to the board, as U3's scroller), so with a classic scrollbar the cards narrow and
the header never moves (values §6.3).

**The grid** (my call; the HTML's own tracks where the HTML draws them):

| Width | Board inner width | Grid | Cards per row × width (HTML) |
|---|---|---|---|
| 1280, nav open | 1008 | from 1024 px: `repeat(auto-fill, minmax(min(320px, calc((100% - 33px) / 3)), 1fr))`, column gap 16, row gap 10 | 3 × 325.33 (= the HTML's three columns) |
| 1280, nav collapsed | 1164 | same | 3 × 377.33 (= the HTML's) |
| 1024 | 908 | same | 3 × 292 (= the HTML's) |
| 820 | 704 | below 1024: the HTML's column grid `repeat(auto-fill, minmax(min(300px, 100%), 1fr))`, gap 10 | 2 × 347 (= the HTML's) |
| 390 | 366 | same | 1 × 366 (= the HTML's) |

At the HTML's widths the cards are exactly the HTML's widths; wider boards (a wall TV: 1920 px gives 4 × 400 with the
sidebar, 5 × 348 with the rail) add columns instead of stretching three cards (the HTML was never drawn there; today's
board shows 4 per row from 1536 px). The cards flow row by row, oldest first (today's order and reading order: the
oldest card is top-left, the next one to its right), each card **its own height** (`align-items: start`: the HTML's
stretched cards below 1024, values §4.8, are a slip, not copied). The HTML's column heads ("To cook 2") and column tabs
are not drawn (Q1), so the first card starts at the board's top padding.

The U0 order-requests strip keeps its place under the header when it shows (shell, unchanged).

## 6. Our features in the HTML's design

### 6.1 Header on /kitchen
The shell header (U0) as the HTML's Kitchen header (values §2): mini logo on the phone; title "Kitchen" (today's sr-only
eyebrow "Service" kept); the second line (Q3, 6.2); gap 12 between the header's items (values §2.1); then:
- **Type filter** (Q2; values §2.1): the HTML's segmented control, `--surface-3` track, radius 8, padding 2, gap 2,
  height 36; tabs radius 6, padding `0 12px`, 13 px 500, `--text`, `white-space: nowrap`; chosen tab `--seg` +
  `--seg-sh`. Tabs "All", "Tables", "Walk-In". Hidden below 720 px (the HTML's `kdTypes`), and below 720 the board shows
  All (the HTML keeps filtering with no control, values §10 #5: not copied; my call). Filter state resets on every visit
  (as U3; my call). `role="group"` "Filter orders by type", each tab `aria-pressed` (U3's pills; the HTML has none).
  Hover: the kit's `--hover` where a pointer can hover (U3's call for its tabs; the HTML has none, values §10 #17).
- **Now Serving** (tokens on only, today's rule and link; no HTML counterpart): U3's outline header button (the HTML
  Floor button's look: `--surface`, 1 px `--border`, radius 8, 36 px, `0 12px`, 13.5 px 500, the 14 px Tv icon, gap 6,
  hover `--surface-2`) with its label "Now Serving", from 720 px only (Q10: below 720 the More sheet's tile).
- **Quick links** (Q8): the shell's "Tables" (outline) and "New order" (filled) exactly as on the other staff pages, from
  1280 px only on /kitchen; below 1280 not drawn there (`HeaderQuickTabs` gets a /kitchen rule beside its /pos and
  /tables rules; the header-quick-tabs pin moves on purpose for /kitchen below 1280).
- The shell's Tokens (tokens on) and the printer button (U0), unchanged. Order in the header (U0's): the page's actions
  (filter, Now Serving), then the quick links, Tokens, the printer.
- Room (measured with the values' widths, my check): at 1280 with the nav open, tokens on and both quick links, the title
  block keeps ~288 px (the second line may end in an ellipsis there); below 1280 the filter and Now Serving fit beside a
  title block of at least ~170 px at 820. U0's rule that moves page actions into a body row when the title block gets too
  narrow (R6) stays as it is (only ~720–745 px in the native app with tokens on would reach it).

### 6.2 The second line and the refresh strip (Q3)
- Second line (`PageHeader` description, 12 px `--text-2`, one line, ellipsis): `"{n} active orders · average wait {m}
  min · {freshness}"`. `n` = the cards shown (after the type filter: the HTML counts the whole board whatever the filter,
  values §10 #6: not copied; my call). "1 active order" for one (the HTML's "1 active tickets", §10 #2: not copied).
  `m` = the mean age of the shown cards, from each card's `cardFiredAt` (the age its pill shows), exact milliseconds then
  rounded (the HTML's formula, values §9.3); from 60 minutes "{h}h {m}m" (6.4's time words). With no card shown the
  average part is left out ("0 active orders · Updated just now"; my call). Freshness = U3's words on the page's 30 s clock:
  "Updated just now" (under a minute since the last good answer), "Updated {m} min ago", "Updated over an hour ago".
  Before the first answer: "Loading orders…" (today's); the first-load error and offline branches show no second line
  (today's).
- Refresh strip: shows while the board has data and its last good answer is at least `KITCHEN_STALE_MS` (60 s) old on the
  page's 30 s clock (today's "Stale" rule, so a failed poll and an offline device both show it, 60–90 s after the last
  success as today). The page's first child above the board, flush under the shell header (or under the U0 strip when that
  shows), never scrolling away; U3's strip exactly (`RequestAlertBar`'s look: `min-h-10`, `py-1`, the warn tint, bottom
  hairline, warn mark), `role="status"`, words "Couldn't refresh the kitchen board. Showing the last update." and "Try
  again" (today's `board.refetch()`, the ErrorState's action), the U0 strip's 30 px button with a 44 px hit area on touch.
  The cards keep their last data (today's).
- `KitchenFreshnessChip` is no longer drawn on /kitchen; it stays unchanged for `/now-serving` (P52).

### 6.3 The card (values §4; Q5, Q6)
**Frame:** `--surface`, 1 px `--border` (late and not every line ticked: `--bad`, the HTML's rule with "Ready column" read
as "every line ticked"; my call), radius 12, `overflow: clip` (the HTML's `hidden`; U3 lesson: `hidden` makes a scroll
container), flex column. No hover, no shadow (the HTML's).

**Head row** (padding `12px 12px 10px`, gap 10, `align-items: flex-start`, bottom border `--border-2`):
- Code (20 px 700, −0.01em, line-height 1.1, `--text`): a table card shows the table's full name (`tableLabel`, "T-4");
  a card with no table shows **"Token {n}" when it has a token** (Q9; tokens on, today's `tokenNumber !== undefined`
  guard and `tokenLabelOf`), else "Parcel" for a parcel order and "Walk-In" for the rest. Wraps (the HTML's); an
  unbreakable name breaks anywhere (values §10 #13: never clipped; my call).
- Where line (12 px `--text-2`, margin-top 3, wraps): `"{type} · Order #{n}[ · Token {t}][ · Self-order]"`. Type: "Table"
  for a table card; for a card with no table, "Parcel" or "Walk-In" when the code is the token, and nothing when the
  code already says Parcel / Walk-In (my call). `Order #012` from `orderNumber()` (`lib/orders-row.ts`, U2). "Token {t}"
  only on a table card with a token (on the others it is the code). "Self-order" once per card (today it repeats on
  every line). Examples: "Table · Order #012 · Token 12", "Parcel · Order #013", "Order #014 · Self-order".
- Time pill (26 px, padding `0 9px`, radius 999, 12.5 px 700, `flex: none`): the card's age from `cardFiredAt`, today's
  bands (`kitchenAgeBand`: < 10 / 10–19 / ≥ 20 min, the HTML's thresholds) in the HTML's tints: `--ok-t`/`--ok-i`,
  `--warn-t`/`--warn-i`, `--bad-t`/`--bad-i` (our `--status-*` tokens). Words (6.4). An approximate age keeps today's "~"
  and its `title` "approximate — fired before age tracking". Late adds " Late" for screen readers only.

**Lines** (list padding `4px 0`): each line is **one button across the card** (the HTML's row: flex, `align-items:
flex-start`, gap 10, padding `9px 12px`, text-align left, `w-full`; hover `--hover` on hover devices only (R14)),
toggling the tick exactly as today's checkbox (same request, same toast + Undo, same in-flight guard with Q7's fix). It
keeps today's accessible name "Mark {name} done" and states its tick (`role="checkbox"`, `aria-checked`; my call). Parts:
- the box: 18 px, radius 5, 1.5 px border `--text-3` (draws 1 px, values §0.5); ticked: `--ok` fill and border with the
  11 px white tick. The tick is drawn only when ticked (the HTML draws it always, values §10 #1; my call).
- the quantity "{qty}×" (15 px 700, min-width 26);
- the text column (`flex: 1`, `min-w-0`): the name (15 px 500; today's name with its "(Variation)"), line-through when
  ticked; then today's modifier lines from the one shared formatter (`orderItemModifierLines`), each 12.5 px `--text-2`
  (the HTML's meta), a "NO …" removal in `--text` 600 (today's emphasis); then the instruction as "Note: {text}"
  (12.5 px 600 `--warn-i`, the HTML's note). Long words break anywhere (never clipped, never a sideways page scroll:
  inventory 7.2 found today's phone page scrolling sideways on a 42-character word).
- ticked line: the whole row at opacity .5 (the HTML's), the name struck through.
- a line whose write is in flight: disabled (today's per-line guard), no other look (the optimistic tick already shows).

**Round dividers** (Q6): when a card holds lines from two or more rounds, each later round's lines are preceded by a
row "Round {r} · KOT #{t} · {h:mm PM}" in the footer's type (11.5 px `--text-3`, padding `6px 12px 2px`; my call), the
time from that round's fire time (`~` when approximate), "KOT #{t}" left out when ticket numbers are off. Lines keep
today's order (round, then line).

**Footer** (padding `0 12px 4px`, 11.5 px `--text-3`, `space-between`, gap 8): left "KOT #{t1}[, #{t2}…] · {h:mm PM}"
(the card's ticket numbers, the first round's fire time); with ticket numbers off "Sent {h:mm PM}" (my call); right
"{d} of {n} done" (the HTML's words).

**Button** (Q5; margin `6px 12px 12px`, height 46, radius 10, 14.5 px 600, full width minus 24): lines still open: `--ink`
with `--on-ink`, "Mark ready · {n} not ticked"; all ticked: green with white text, "Mark ready" — the green is
`--status-ok-ink` (#198038, 5.0:1 with white; the HTML's `--ok` is 3.35:1, values §10 #18; my call). Always enabled but
while its own write runs (today's rule, P12). No hover look (the HTML's); press `scale(.97)` (the global rule); our 2 px
accent focus ring (the HTML's is invisible on ink, values §10 #17).

**Motion** (my calls): a card rises (the HTML's `rise .35s`) when it first appears — the first paint and a newly fired
order arriving — never on a filter change (U3's render-time rise clock, `lib/floor-rise.ts` pattern); none with reduced
motion; no exit animation (the HTML has none).

### 6.4 Time words
The card's minutes (floored, today's and the HTML's): "Now" under a minute (the HTML's; today "0m"), "{m} min" under an
hour, "{h}h {m}m" from an hour (U3's hour form; the HTML writes "135 min", values §10 #24 / U3 #11), each with "~" when
approximate. The average in the second line uses the same words.

### 6.5 Loading, error, offline, empty, filtered empty
- Loading: "Loading orders…" (second line) and today's six skeleton cards in the new card shape (radius 12, 195 px, the
  HTML's one-line card) in the new grid.
- First-load error: today's `ErrorState` ("Couldn't load the kitchen board" / "Check the internet connection, then try
  again." / "Try again") where the board sits. Offline never loaded: today's line. Today's branch order is kept (P44/P45).
- Empty board: today's words "All caught up" / "Fired orders appear here the moment a round is sent to the kitchen." in
  the HTML's empty box (dashed 1.5 px `--border`, radius 12, padding `28px 12px`, centred, 13 px `--text-3`; the title
  13 px 600 `--text-2`; my call), across the board.
- Filtered empty (Tables or Walk-In with none): the same box, "No orders here" (the HTML's "No tickets here" in our unit;
  my call); "All" is one tap away in the header.

### 6.6 Toasts and the foot
Today's toasts and words (tick "{qty} × {name} marked done" + Undo; Ready "{where} marked ready[ — {n} line(s) not
ticked]" + Undo; the error toasts). `{where}` becomes the card's code (Q9), so a parcel card reads "Parcel marked ready"
(today "Walk-In marked ready", inventory 12.4) and a token card "Token 12 marked ready". The toaster: U3's /tables set (the staff offsets 140 / 92 / 24 px, each
plus the bottom inset) is extended to /kitchen (owner rule: everything at the window's foot clears the inset at every
width); the app-toaster pin "/pos and /tables" moves on purpose to include /kitchen.

### 6.7 Behaviours that stay exactly
Every request and its timing (`GET /api/kitchen` on mount, every 10 s also in a background tab, on focus, on a realtime
nudge, after every write; the one retry; paused during an order write on this device; the realtime connection and its
hold-while-writing rule), the two POST bodies (`tick`, `ready` with `seenFiredAt = card.newestFiredAt`), optimistic tick
and Ready with the exact snapshot restore, the invalidate after every write, both Undo toasts, the lost-ticket rule, FIFO
by the oldest unfinished line, the 60-card cap, skip-KOT lines never shown, the board never blanking on a failed poll,
the wall display never auto-locking, staff and admin seeing the same board. No new request of any kind: the filter, the
counts, the average and the freshness all come from the payload the page already loads.

**Test pins** (as U2 / U3): look (L / G) pins move on purpose with the reason in the commit; behaviour (B) pins keep
their meaning and move with the code; budget (BUD) pins never loosen. Moving on purpose: `<MenuPageShell wide>` (P41),
the header actions JSX with the chip (P55), the checkbox in a 40 px label (P49: the whole row is the button now), the
Ready label wording (P12 keeps its meaning: never gated on ticks, the label still computes the open count), the token
label's place (P65 keeps its meaning: one `tokenLabelOf(card.tokenNumber)`, behind the `!== undefined` guard), the
header quick links on /kitchen below 1280 px (Q8). Every new
Kitchen file joins the kitchen-paths hygiene list (P6) and its line budget.

### 6.8 Keyboard
No new shortcuts. Tab order: header (filter tabs, Now Serving) → [strip's Try again] → each card's lines, then its
button, card by card in board order (the HTML's order). Enter / Space toggles a line (the HTML's).

## 7. What the HTML has that we do not (left out; never added without the owner)
The "Cooking" step and "Start cooking" (no data, Q1); the three status columns, their heads and the column tabs (Q1);
"Served" / "Picked up" / "Handed to rider" after Ready (our Mark ready clears the card); Delivery (no such order type);
the guest count ("· 4 guests": orders carry none); one card per KOT (ours is one card per order across its rounds: the
lost-ticket rule and the single Ready depend on it); "Order #1042"-style takeaway codes (ours: Parcel / Walk-In + the
order number); the Kitchen tab in the phone tab bar for Cashier / Captain (the tab bar is the shell's, U0); the
"Kitchen" role and its blank screen; dark mode (the staff app is light only).

## 8. The HTML's own slips (values §10; my calls)
Copied: the card anatomy and its numbers, the type control hidden on the phone, oldest first, the late border only while
lines are open. Not copied: the dark tick (#1, the tick only when ticked); "1 guests" / "1 active tickets" (#2); stretched
cards (#3, own heights); the rise replaying on a tab or filter change (#4, first appearance only); the hidden phone
filter still filtering (#5, All below 720); the header count ignoring the filter (#6, it follows the filter); no
confirmation or undo on the final action (#9: ours keeps its Undo); `short()` naming every other order "Delivery" (#11:
the toast says the card's code); long words clipped (#13: they break); the invisible focus ring and no hover anywhere
(#17: our focus ring, hover on the filter tabs and the lines only); white on `--ok` (#18: the darker green); the toast
centred on the window (#20: ours is the staff toaster's place, unchanged app-wide); "135 min" with no hour form (#24).
Out of reach or not ours (no columns, no tickets per KOT, no Kitchen role): #7, #8, #10, #12, #14 (the quantity's
26 px minimum is kept), #15, #16, #19, #21, #22, #23.

## 9. Must not change
Data, requests (no new request; no faster poll; the same endpoints, bodies and keys), the API route and the payload libs,
routes, roles, printing and the paper, the S1 pin, the print budget, `/now-serving` and its chip, WebView 109 CSS (no
`light-dark()`, no runtime `color-mix()`, no `mask-image`; the postcss fallbacks), WebView 109's `<button>` rule (every
flex button here gets `w-full` / `items-stretch` where its children rely on stretch: the line rows and the button), the
preset-token rule in kit files, the line budgets reached from here, test-used names unless section 11 changes them.

## 10. Verification
As U1–U3: `compare-ui.mjs` probes per task at the five viewports against the HTML (boxes ±1 px, sizes ±0.5 px, fonts and
colours exact; our data put into the HTML's states with `patch` / `rewrite`: a token, a parcel, two rounds, a late card,
long words); every remaining difference is a mapped item of sections 4–8 with a ruling (no columns, our codes and words,
the where line, the round dividers, "Mark ready", the strip, the filter words). U0's shell probes again (the header changes
on /kitchen). 360 / 375 / 430 phones (no sideways page scroll with the 42-character word, inventory 7.2) and a classic
scrollbar at 1280. Side-by-side shots of every state for the owner; every suite; the live legs; a production build; every
page's first screen; the local a11y check; the idle request count on /kitchen equal to main's; the paper untouched; the
bottom inset at every width (the board's foot, the strip, the toasts); the emulator on WebView 109 and 154 (109's button
rule; 109's accessibility tree after filter round trips and a poll adding a card: U3's VC-3 lesson, the board keeps one
permanent wrapper); the write paths for real on the scratch DB (tick, un-tick, Undo, Mark ready with lines open and all
ticked, its Undo, two quick ticks for Q7); then a fresh Claude Fable 5.1 review of the whole branch, one fix wave, its
re-review.

## 11. Visible words that change
Second line "Every fired order, oldest first. Tick a line off once it's cooked." + summary "{t} open tabs · {c} orders ·
{i} items" + chip "Updated {s}s ago" / "Stale — last synced {time}" → "{n} active orders · average wait {m} min · Updated
just now" (Q3) and the strip "Couldn't refresh the kitchen board. Showing the last update." + "Try again"; new filter
"All · Tables · Walk-In"; "PARCEL" → code "Parcel"; the token chip "Token {n}" → the code of a card with no table (Q9),
in the where line on a table card; "Walk-In" (code) → "Token {n}" when the order has a token; "ORD-20261029-012" →
"Order #012"; the card's "#9 #12" → footer "KOT #9, #12 · {time}"; "Self-order" on every line → once in the where line;
age "~42m Late" → pill "~42 min" (red, "Late" for screen readers), "0m" → "Now", "75m" → "1h 15m"; "{qty} × {name}" →
"{qty}×" + name; the instruction → "Note: {text}"; line meta "Round {r} · #{t} · Self-order · {age}" → round dividers
"Round {r} · KOT #{t} · {time}" (two or more rounds only); "{d}/{n} done" → "{d} of {n} done"; "Ready to serve" → gone;
"Ready — clear from board" → "Mark ready"; "Ready — clear {n} unticked" → "Mark ready · {n} not ticked"; the Ready
toast's `{where}` = the card's code ("Parcel marked ready…", "Token 12 marked ready…"; today "Walk-In marked ready…");
filtered empty "No orders here" (new); the header's "Tables" / "New order" not drawn on /kitchen below 1280 px (Q8) and
"Now Serving" not drawn there below 720 px (Q10).
Words that stay: "Kitchen", "Service", "Loading orders…", "All caught up" and its line, the error / offline words, "Try
again", "Now Serving", every toast's words (apart from the parcel's where), "Mark {name} done", "Undo".

## 12. Changes during the build (2026-10-30)
Decided while building, recorded so the design stays the reference (the SDD ledger keeps every ruling):
- The owner's Q11 (2026-10-30, after the final review measured the phone line cut at every phone width, the average cut
  mid-number with tokens on): below 720 px the second line is "{n} active order(s) · avg wait {m}" with no freshness
  part (the refresh strip is the failure signal there); from 720 px unchanged. Measured whole at 360–430 with tokens on
  and off ("2 active orders · avg wait 14 min" 175.9 px; "12 active orders · avg wait 1h 15m" 187.4 px in 193–316 px).
- The refresh strip (6.2) shows only when the last good answer is at least 60 s old AND the board's read has failed or
  is paused (offline): a return to /kitchen from the cache or a background tab's slowed polls showed it while nothing
  had failed (final review I1). A failed poll and an offline device still show it 60–90 s after the last success.
- The average under a minute reads "0 min" ("average wait 0 min", the HTML's own words for an average of 0); the time
  pill keeps "Now" (ruling K3).
- A parcel order is a Parcel card whatever its table (today's priority): code = its token when it has one, else
  "Parcel"; the where line "Parcel · Order #…" when the code is the token, else "Order #…"; the filter counts every
  parcel under Walk-In (ruling K4; our data can hold a parcel with a table).
- A fire time that does not parse leaves the time out of the footer / divider words instead of throwing (one bad stamp
  would have crashed the whole board).
- A ticked line dims its words to --text-3 (5.3:1) instead of the HTML's whole-row opacity .5 (~3.4:1, which fails the
  4.5:1 contrast); the box keeps its full green with the white tick (ruling K5).
- A line row keeps its accessible name "Mark {name} done" and gets its quantity, modifier lines and note as its
  accessible description (a checkbox's inner text is not read by screen readers).
- On a first-load error and offline before the first load the header shows the shell's default second line
  ("{cafe} · {date}"), never a kitchen count (ruling K6).

## 13. The builder check (2026-10-30)
A fresh builder read this document, the values, the inventory and the code. Its three questions were the owner's and are
answered in section 4 (Q8 quick links, Q9 the token as the code, Q10 Now Serving on the phone). Left to the builder (it
said it can decide them): where the filter state lives, keeping the filter out of the shell's `[data-header-actions]`
button rule, how Q7's fix is written, the rise for a card that comes back (the lost-ticket rule: it counts as newly
arriving), grouping lines by round.
