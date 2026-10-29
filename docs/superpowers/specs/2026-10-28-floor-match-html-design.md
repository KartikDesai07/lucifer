# U3: the Floor (/tables) rebuilt to the owner's HTML (design)

Status: for the owner's approval, 2026-10-28. Branch `feat/ui-floor` from main `445ed96` (U0, U1 and U2 merged). Nothing
is coded before the owner approves this document. The owner's answers (2026-10-28) are in section 4; "my call" marks a
decision of mine the owner can still change.

## 1. Why, and the rule

The owner picked the Floor screen as U3 (2026-10-28). The standing rules since 2026-10-19 / 2026-10-20 apply: the HTML's
numbers are the spec, measured to the pixel; a visible difference is fixed or shown to the owner, never parked as minor;
and, in the owner's words for /pos, "aesa nahi ki same aesa hi bana dena hai … current ye option hai UI me nahi hai to wo
option rakhna hai uski fir UI think karke proper manage karni hai": **every option /tables has today stays** (every tap,
Reserve, Free, Seat now, Try again, Show all tables, Open Setup), and where the HTML has no place for it, it gets one
designed in the HTML's own visual language (section 6). Nothing is invented on the data side: what the HTML shows that
we have no data for is left out and listed (section 7). An HTML slip (clipped text, a hidden pill, an invisible focus
ring) is never copied: it is ruled and listed (section 8).

The owner's rule of 2026-10-22 (below 1280 px a right-side panel opens full screen from the bottom) does not come into
play: the Floor has no side panel, and this design adds none.

## 2. Sources

- The mock-up: `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked `design\unpacked\`), route
  `floor`, markup lines 905–947, view-model app.js 778–790 and 912–915.
- **The exact values:** `docs/superpowers/specs/2026-10-28-floor-html-values.md` ("values §N": 60 states, 187 runs at
  the five viewports, 208 reference shots in `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-floor\`; mock clock Mon
  19 Oct 2026 9:30 PM IST; 26 HTML slips in values §12). Theme, shell, toast: `docs/superpowers/specs/2026-10-19-u0-html-values.md`
  ("U0 values"); the confirm sheet and the table picker tiles: `docs/superpowers/specs/2026-10-20-pos-html-values.md`
  ("U1 values"); U2's Orders design for the shared patterns (`2026-10-23-orders-match-html-design.md`).
- **What we have today:** `D:\kd\pos-dev-keep\ui-redesign\inventory\floor-features.md` ("inventory": 59 elements E1–E59,
  11 tile kinds K1–K11, dialogs / menu / hand-off D1–D4, 85 test pins P1–P84 + P64b labelled L / G / B / BUD, 15 options
  with no HTML counterpart, the requests and their timing) and 264 shots of today's page in every reachable state,
  `D:\kd\pos-dev-keep\ui-redesign\current-floor\` (index.md; `tools\floor-current-shots.mjs`).

## 3. Scope

**In:** the /tables page and everything it opens: the page header's contents on /tables, the refresh-failure strip, the
controls row (area tabs, status pills), the area sections, the tiles (every kind), the tile menu, the Seat now and Free
table confirms, the loading / first-load error / no-tables / filtered-empty states, the page's foot and its toasts' place.

**Out:** /tables/setup and /tables/qr (separate admin pages, not in the HTML), the dashboard's Live tables (U0; it shares
`TABLE_STATUS_META` and the floor libs, and must not move), /pos's receiving side of the hand-off (U1), the shell outside
the header's contents on /tables, the printer panel (a later page), every other page, `/m`, the paper (the Floor prints
nothing; the S1 43-file pin and `print-budget.test.ts` stay untouched).

## 4. The owner's decisions (2026-10-28)

| # | Point | Decision |
|---|---|---|
| Q1 | Header button | **"New order" in the HTML Floor button's look**: outline (white, `--border`), the plus icon, 36 px, its label at every width (also on the phone); it opens /pos with no table, as today (our POS has no staff takeaway type, so the HTML's "+ Takeaway" is not ours). The "Tables" quick link is hidden on /tables (it is this page; as /pos hides both). |
| Q2 | Tile content | **The HTML tile, our data folded in**: 112 px (100 on the phone), name + seats on top, dot + status word, one detail line. Bill "₹955 · 27 min", booking "8:00 PM · Pooja Nair" / "Held", "No open bill" (the preview's "· tap to free" does not fit the line: it moved into the tile's accessible name, builder check), the table charge. Long stay = the time in red, bold, plus a clock mark (not on the phone grid, where it does not fit beside the status word: the red time alone). The ⋯ menu at the right end of the status line. "{n} items · {customer}" and the action words ("Open ›", "New order ›", "Seat now ›", "Free table ›") leave the tile; every tap does exactly what it does today. |
| Q3 | Header's second line, freshness | **The HTML's words plus ours on the same line**: "3 of 10 occupied · 1 reserved · ₹1,787 running · Updated just now" (cut with an ellipsis when narrow). A failed refresh shows a slim warn strip under the header, "Couldn't refresh the floor. Showing the last update." with "Try again" (the alert strip's look). The controls row stays the HTML's. |
| Q4 | Pills on the phone | **Sideways scroll with a cue**: the HTML's scrolling row, plus a soft fade at the right edge while more pills are hidden, and the chosen pill scrolled into view on its own. The area tabs do the same. |
| Q5 | The stay on the phone (asked during the build, 2026-10-28) | **Short minutes below 720 px**: "0m", "8m", "72m", "125m", so "₹1,063 · 72m" fits the 88 px phone line for every ₹1,000–9,999 bill, also in the long stay's red bold (measured 74.77 px; "₹1,063 · 1h 12m" was 91.88 px and "₹1,063 · Just now" 100.89 px, both cut). From 720 px the words stay "Just now" / "{m} min" / "{h}h {m}m". A 5-digit bill past 99 minutes still cuts (accepted with the option). |
| Q6 | A long name on a narrow tile (asked after the final review, 2026-10-29) | **The name first**: on a 3-column phone grid (390–430) the name had ~48–55 px beside "4 seats", so "Patio 1" / "Patio 2" both read "Pat…" (and "Garden 2" read "Garde…" at 1024); today's 2-column phone showed them whole. When the name and the seats do not both fit, that tile's seats give way (hidden there, still read by screen readers) and the name shows whole (~88 px on the phone, ~117 px at 1024); a 24-character name still truncates. The 3-column grid and the tile size stay the HTML's; "T-1" … "T-99" tiles are unchanged. |
| – | Words (standing, U0 / U1 / U2) | The HTML's words where the HTML has the same element; our words for our own features and data (section 11 lists every visible word that changes). |
| – | "Bill printed" (U2 Q11, standing) | Shown only when the server knows of the print (`billPrintedNow`, `lib/dashboard/live-tables.ts`: print host / agent / settle prints), as the dashboard and Orders. A device that prints straight from the browser keeps its tables "Occupied". |

## 5. Layout per width

The page fills the screen under the shell header like the HTML's screen and like /orders (today's paper frame
`MenuPageShell` with the 1440 px cap goes): it bleeds `<main>`'s padding and takes the height left under the header and
the U0 alert strip (`POS_PAGE_CLASS`'s rule, as U2's `ORDERS_PAGE_CLASS`). **The page is its own scroller** (as the
HTML's screen, values §1.1): [the refresh strip, 6.2] then the scrolling body, which has the HTML's padding (values §0.3):
`20px 24px 28px` from 720 px, `16px 14px 92px` on the phone, each bottom value plus `env(safe-area-inset-bottom)` (U1 P49:
at every width), and is a flex column with a 16 px gap: controls row → one section per area (or the flat grid) → the
empty / error states. The scroller wears the HTML's thin scrollbar (values §9.1: 8 px, `--border` thumb, radius 8, scoped
to this element), so with a classic desktop scrollbar (the Windows app, desktop Chrome) the grid narrows by 8 px exactly
as the HTML's (6 × 157 at 1280) and the shell header never moves (the HTML's header shifts 8 px, values §12 #25: not
copied); my call. (A document scroll would narrow the whole layout by the system bar's ~15–17 px, header included.)

The grid is the HTML's `repeat(auto-fill, minmax(140px, 1fr))` with a 10 px gap (values §0.2). On the phone the HTML's
minimum is 104 px; ours is **114 px** (my call): identical at 390 (3 × 114, the HTML's tracks), but below 390 (375, 360
phones) the grid drops to two columns instead of squeezing three tiles whose 78–83 px lines cannot hold a status word and
the ⋯ (the HTML was never drawn there). With the U0 shell this gives:

| Width | Nav | Body inner width | Columns × track | Tile height | Controls row (seed: 3 areas) |
|---|---|---|---|---|---|
| 1280, nav open (`d1280`) | 232 sidebar | 1000 | 6 × 158.33 | 112 | one line |
| 1280, nav collapsed (`c1280`) | 76 rail | 1156 | 7 × 156.57 | 112 | one line |
| 1024 (`t1024`) | 76 rail | 900 | 6 × 141.67 | 112 | one line |
| 820 (`t820`) | 76 rail | 696 | 4 × 166.5 | 112 | two lines (pills under the tabs) |
| 390 (`p390`) | tab bar | 362 | 3 × 114 | 100 | two lines, both rows scroll sideways |

(Today: 6 / 7 / 5 / 4 / 2 columns of 152 px minimum, tiles 122–140 px.) The U0 order-requests strip keeps its place under
the header when it shows (shell, unchanged).

## 6. Our features in the HTML's design

### 6.1 Header on /tables
The shell header (U0) as the HTML's Floor header (values §1): mini logo on the phone; title "Floor" (with today's
sr-only eyebrow "Service"); the second line (Q3, 6.2); gap 12 px between the header's items on /tables (the HTML's Floor
header, as /orders; my call); **"New order"** (Q1): `HeaderQuickTabs` draws it on /tables in the HTML Takeaway button's
look (values §1.2: outline, 1 px `--border`, `--surface`, radius 8, 36 px, padding 0 12, 13.5 px 500, the 14 px plus
with stroke 2.4, gap 6, hover `--surface-2`) with its label at every width, the same link to /pos; "Tables" is not drawn
on /tables; the printer button (U0). Refresh (apps) and Tokens (when on) stay where U0 put them.

### 6.2 The second line and the refresh strip (Q3)
- Second line (`PageHeader` description, 12 px `--text-2`, one line, ellipsis): `"{o} of {n} occupied · {r} reserved"`
  (the HTML's words; `o` = tables whose status is Occupied, Bill printed included, as the HTML's header; `r` = Reserved;
  over the whole floor whatever the area tab or pill), then `" · {₹x} running"` (ours: the sum of the open bills on
  Occupied tables, only once the bills have loaded and the sum is above ₹0 — today it can read "₹0 running", inventory
  11.13; my call), then `" · {freshness}"` with today's freshness rule and words, the first one shortened to fit the
  line: "Updated just now" (was "Live · updated just now"), "Updated {m} min ago", "Updated over an hour ago". Before the
  list loads: "Loading tables…" (today's). The error branch keeps today's behaviour (no description).
- Refresh strip (only while `tables.isError || openTabs.isError` with data on screen, today's rule): a full-width strip,
  the page's first child above the scrolling body, so it sits flush under the shell header (or right under the U0
  order-requests strip when that shows, the two touching with the U0 strip's bottom hairline between them; my call), and
  does not scroll away. It wears the U0 alert strip's look exactly (`RequestAlertBar`: `min-h-10`, `py-1`, the warn
  tint, the bottom hairline, its padding and type) with a warn mark, "Couldn't refresh the floor. Showing the last
  update." and "Try again" (today's `retryAll`: tables and open bills) drawn as the U0 strip's 30 px button, its hit area
  grown to 44 px on touch without growing the strip (my call). It is a `role="status"` region as today. The body below
  keeps its 20 / 16 px top padding; the tiles keep their last data (today's R17).

### 6.3 Controls row
The HTML's row (values §2.2: flex, wrap, gap 10, `space-between`): the area tabs left, the status pills right; on the
second line when they do not fit (820 and the phone with the seed).
- **Area tabs** (values §2.3; the HTML's segmented control: `--surface-3` track, radius 8, padding 2, gap 2; tabs 32 px,
  radius 6, padding 0 14, 13.5 px 500; the chosen tab `--seg` + `--seg-sh`): "All" + one tab per group of today's
  `groupByArea` over every table (before the status pill: only areas that hold a table, in the server's order, and
  "Other tables" last when a table has no area or an unknown one). A client-side filter (no request). Shown only when
  there are two or more groups; a cafe with one area or none has no tabs (my call). The chosen area is kept as a choice,
  but the page uses it only while it is still a group: when a refresh, the area heal or another device empties or
  removes it, or the tabs hide, the page shows "All" (worked out on every render, nothing stored; my call). Our kit
  `SegmentedControl` is reused only if it can wear exactly these values; else a Floor control in `lib/` + component.
- **Status pills** (values §2.4): "All {n}" (no dot), "Available {n}", "Occupied {n}", "Bill printed {n}", "Reserved
  {n}" in the HTML's order, 32 px, radius 999, padding 0 12, 13 px 500, gap 7, the 8 px dots (`--ok`, `--info`, `--bill`,
  `--res`), the count in `--text-3`; the chosen pill `--ink` with white text and its count in a light grey that reads on
  ink (the HTML's grey on black is 3.36:1, values §12 #7; my call: ≥ 4.5:1 from a token). "Occupied" counts Occupied
  tables without a printed bill; "Bill printed" those with one (Q11 rule); "Available" and "Reserved" by table status.
  **The counts follow the chosen area** (the HTML counts the whole floor, so "Rooftop" + "Occupied 5" can show nothing,
  values §12 #6; my call). The group keeps `role="group"` and "Filter tables by status"; each pill keeps `aria-pressed`.
- **Phone (Q4) and narrow rows:** both rows scroll sideways (`overflow-x:auto`, no visible bar) as the HTML's, with a
  24 px fade at each edge that hides something (right at rest, left too once scrolled; my calls): the pills row fades
  into the page's `--bg`, the area track into its own `--surface-3` inside its 2 px padding (so its rounded ends stay
  grey). The fades are overlay gradients with plain stops (no `mask-image`, no `color-mix()`: WebView 109). The chosen
  tab / pill is scrolled into view on a change and on first paint. The rows get enough padding that a focus ring is not
  clipped (values §12 #9).
- Touch sizes: the HTML's 32 px on touch too (ruling R1: the HTML has these elements).

### 6.4 Area sections
The HTML's (values §3): no divider; head row (baseline, gap 8) with the area name 15 px 600 and the count 12 px
`--text-2` "{n} tables" / "1 table" = the tiles shown (the HTML's words; today's "{n} tables · {o} occupied" and
"{shown} of {n} tables" go, the per-area numbers being in the pills once an area is chosen); a long name truncates with
its full name in `title` (today's); 10 px to the grid. An area with no tile after the filters is dropped (today's and the
HTML's). "Other tables" last. With no area in use, one flat grid with no head (today's).

### 6.5 Tiles (Q2)
**Anatomy** (values §4.1, §4.4): 1.5 px border, radius 14, padding 12, min-height 112 (100 on the phone), flex column,
space-between, gap 8. Top row: the table's **full name** (`tableNo`, 20 px 600, −0.01em, `--text`; our names
are free text, so the HTML's "T{n}" short code could collide — "Patio 2" / "Garden 2"; my call) and "{n} seats" (12 px
`--text-2`, right, never wraps; "1 seat" for one: the HTML's and today's "1 seats" slip, my call). **The name comes first
(the owner's Q6):** when the name and the seats do not both fit the row, that tile's seats give way (hidden on that tile,
still in its accessible name) and the name shows whole; only a name wider than the whole row truncates. Bottom block (gap 2):
the status line (7 px dot, gap 6, 12.5 px 500 in the state's ink) with a right-end slot, and the detail line (12.5 px
`--text-2`, one line, ellipsis).

**Kinds** (today's K1–K11 rules unchanged, `lib/floor-tiles.ts`; the looks of values §4.2; free is plain white, the
others tinted; the per-state classes live in `lib/` as a Floor tone map, never in `TABLE_STATUS_META`, which the dashboard
and Setup read):

| Today | Status line (dot, word) | Detail line | Right slot | Tap (unchanged) |
|---|---|---|---|---|
| K1 Occupied + bill | `--info` "Occupied" | "₹955 · 27 min" | Long stay mark | /pos, the bill resumed |
| K1 + bill printed (Q11) | `--bill` "Bill printed" (bill tint) | "₹955 · 27 min" | Long stay mark | as K1 |
| K2 Occupied, no bill | "Occupied" | "No open bill" (the confirm explains; "tap to free" in its accessible name) | — | Free table confirm (D2) |
| K3 Occupied, bills loading | "Occupied" | a short skeleton bar | — | /pos (as today) |
| K4 Occupied, bills failed | "Occupied" | "Bill not loaded" | — | /pos (as today) |
| K5 Available | `--ok` "Available" | the table charge "{label} ₹x" if set, else "Tap to seat guests" (phone: "Tap to seat", see 8) | ⋯ (Reserve table) | /pos, the table picked |
| K6 Available, bills unknown | "Available" | as K5 | — | as K5 |
| K7 Available + a bill (R18) | "Available" | "₹x · 12 min" (as K1, so the money fits the phone line) | Long stay mark | /pos, the bill resumed |
| K8 Reserved | `--res` "Reserved" | "{h:mm AM} · {booking name}" (the HTML's note) or "Held" | ⋯ (Free table) | Seat now confirm (D1) |
| K9 / K10 Reserved, display only | "Reserved" | as K8 | K10: Long stay mark (today's) | nothing |
| K11 busy | unchanged, 70 % opacity | unchanged | a spinner (the ⋯ hidden) | nothing |

- **Time words** (my call): today's minutes (floored), "Just now" under a minute, "{m} min" under an hour (the HTML's),
  "{h}h {m}m" from an hour ("1h 0m", "1h 8m": the shape of U2's Orders age; the HTML's floor writes "68 min", values §12
  #11). Below 720 px the stay reads whole minutes + "m" ("0m", "72m": the owner's Q5, section 4; the hour form did not
  fit the phone line once the minutes had two digits). The tile's accessible name keeps the long words at every width.
  The stay-word pins move on purpose.
- **Long stay** (today's setting rule): the detail's time part in `--bad-i` 600 and, where the status line has room for
  it (tiles of the ≥ 720 px grid), a 14 px clock mark in the right slot, `--bad-i`, with "Long stay" as its accessible
  name and `title`; on the phone grid only the red time (the status word is never cut: "Bill printed" + a clock does not
  fit 88 px; today's P13 meaning). The tile's accessible name says "Long stay" at every width.
- **⋯ menu**: today's `FloorTileMenu` (Reserve table / Free table, same handlers) beside the tile surface (today's
  sibling structure, P11), its trigger a 16 px glyph at the status line's right end, `aria-label="More actions for {t}"`
  (today's); the menu keeps the kit look. Hit area 44 × 44 on touch, 32 × 32 with a fine pointer, placed so it never
  covers the detail line or the name: its bottom edge on the detail line's top, so on a 100 px phone tile it may reach
  3 px into the seats' text box, never into the detail (my call). The status word's room reserves the glyph's width
  (`Reserved` + ⋯ = 88 px on the phone). The rise and the hover lift move to the wrapper that holds both, so the glyph
  moves with its tile.
- The tile keeps today's elements (`Link` for /pos tiles with the plain-click hand-off, `button` for confirms, `div` for
  display-only and busy). Each tile's accessible name says what a tap does now that the action word is gone ("T-3,
  Occupied, ₹955, 27 min — open the bill"; my call).
- **Motion** (my calls): the HTML's rise on the first paint of the grid only, with U1's capped stagger (`tileDelay`,
  20 ms steps capped at 0.3 s, ruling P52) instead of the HTML's 30 ms to 0.45 s; no replay on a tab / pill change (the
  HTML's half-replays, values §12 #19); none with reduced motion (values §12 #23). Hover lift (−3 px, the HTML's shadow)
  only where a pointer can hover (R14) and only on tappable tiles; press `scale(.98)`.
- **Focus**: today's 2 px accent focus ring on tiles, tabs and pills (the HTML has no designed one, values §12 #9).

### 6.6 Seat now and Free table confirms
Today's two confirms (words, rules, the busy state, Escape ignored while running) in the HTML confirm sheet (U1's
`ConfirmDialog look="sheet"`, `lib/sheet-frame.ts` `CONFIRM_SHEET_*`: 420 px, 18 px title, 14 px body, stacked 46 px
buttons, a bottom sheet below 720 px with the bottom inset, U2 P14); "Free table" in `--bad`, "Seat now" in the accent,
"Cancel" in `--surface-3`. The pin that allows only the POS prompts and the send-discard confirm to wear the sheet
(`confirm-dialog-look.test.ts`) moves on purpose to include `FloorDialogs` (my call, as U2's cancel sheet).

### 6.7 Loading, error, no tables, filtered empty
- Loading: today's skeleton tiles in the new tile shape (112 / 100 px, radius 14) in the new grid.
- First-load error: today's `ErrorState` words and Try again, placed where the grid sits.
- No tables: today's admin ("No tables yet" / "Add your tables on the Setup page to see them here." / "Open Setup") and
  staff ("Floor plan not set up" / "Ask an admin to add tables on the Setup page.") words in the HTML's empty style (centred,
  14 px `--text-2`, padding 48 0; the title 14 px 600 as U2's empty states), "Open Setup" as a 40 px accent button; the
  only role read stays in `FloorEmptyState`.
- Filtered empty: the HTML's line "No tables match this filter." (values §5.2) plus our "Show all tables" (outline, 40
  px, our option, as U2 kept "Clear filters"); it resets both the area and the status filter.

### 6.8 Toasts and the foot
Today's toasts (sonner, U0 look) and words. The page's foot adds `env(safe-area-inset-bottom)` at every width (5). The
toasts too (owner rule: everything at the window's foot, at every width): today the /tables toaster sits at the staff
offsets 140 / 92 / 24 px with no inset, and no existing set adds it at every width (/orders uses the staff set; /pos's
set adds it only below 1280). So `AppToaster`'s route switch gets a third props set for /tables only, the staff offsets
each plus the inset (`calc(140px + env(…))`, `calc(92px + …)`, `calc(24px + …)` at the same breakpoints); the
app-toaster pin "/pos only" moves on purpose to "/pos and /tables" (my call). The staff set of every other page is not
touched (an app-wide fix is the owner's open shell item).

### 6.9 Behaviours that stay exactly
Every request and its timing (`useTables`, the open bills `OPEN_TABS_FILTERS` with `OPEN_TABS_QUERY_OPTIONS`, today's
reservations, settings from masters; the 30 s polls, focus refetch, realtime, the area heal; the shared
`FLOOR_CLOCK_TICK_MS` clock, one `useNow`), the open-bill check before every write, the CAS echo, per-table busy, the
confirms and their guards, commit-before-navigate on Seat now, the plain-click-only hand-off with its 15 s TTL, the table
never in the URL, the grid never blanking on a failed poll, the area / status filters reset on every visit (as today; the
HTML keeps them across visits, values §0.4; my call), roles (staff and admin see the same floor; only the empty state
differs). No new request of any kind; the area tabs, Bill printed, the counts and the second line all come from data the
page already loads (the open-bill list rows carry `billFirstPrintedAt` and `billFirstPrintedTotal`, `lib/order-list.ts`).

**Test pins** (as U2): pins on look (L / G) move on purpose with the reason in the commit; pins on behaviour (B) keep
their meaning, and when code moves the pin moves with the same meaning; budget pins (BUD) never loosen. Two behaviour
meanings are retired by the owner's answers and move on purpose: "the status chips never hide a state off-screen" (P11;
Q4 chose the scrolling row with a cue) and "every dashboard screen gets both header quick links" (header-quick-tabs; Q1
hides Tables on /tables). The tile's "the status word is never clipped" (P13) keeps its meaning.

### 6.10 Keyboard
No new shortcuts. Tab order: header → [refresh strip's Try again] → area tabs → pills → tiles (each tile then its ⋯).

## 7. What the HTML has that we do not (left out; never added without the owner)
"KOT pending" (unsent lines live only in a POS cart on one device; a stored order's lines are all sent); "+ Takeaway"
(no staff takeaway type, Q1); a tap that creates a Dine-in order with 2 guests at once (ours opens /pos with the table
picked; the order is made on Send; we have no guests field); a Reserved state derived from bookings (ours is a manual
hold; a booking's name and time show on a held table, as today); a tap on a reserved table opening an order directly
(ours asks "Seat guests at {t}?" first); seating a booking from the Floor; filters kept across visits and users; dark
mode (the staff app is light only).

## 8. The HTML's own slips (values §12; my calls)
Copied: the plain white free tile, the scrolling pill and tab rows (with the Q4 cue), the area dropping out when it has
no tile, the whole-floor header counts. Not copied: "Tap to seat gu…" on the phone (#1: the phone reads "Tap to seat";
names in a reservation note still truncate, as data); the pill counts ignoring the chosen area (#6); the chosen pill's
3.36:1 count (#7); pills and tabs hidden with no cue (#8, #22: Q4); the clipped / missing focus ring (#9); "68 min" with
no hour rollover (#11); no hover on tabs and pills (#12: they take the kit's hover `--hover` where a pointer can hover;
my call); the phone subtitle cut by 2 px (#13: ours is our own line, ellipsis by design); the half-replaying animations
and the cascade under reduced motion (#19, #23); 3-digit names wrapping the seats onto two lines and growing the row
(#21: seats never wrap; the owner's Q6: the seats give way on that tile and the name shows whole, truncating only past
the whole row); the header's 8 px shift beside a classic scrollbar (#25: our page scroller
sits under the shell header, section 5). Out of our reach or not ours: #2–#5, #10, #15–#18, #20, #24, #26 (no Geist
Mono: the tile money stays Geist with tabular figures, the HTML's own Floor value).

## 9. Must not change
Data, requests (no new request; no faster poll; the same endpoints and keys), routes, roles, the hand-off contract,
printing and the paper, the S1 pin, the print budget, WebView 109 CSS (no `light-dark()`, no runtime `color-mix()`; the
postcss fallbacks; the fade gradient as plain stops), the preset-token rule in kit files, `TABLE_STATUS_META` values and
the dashboard's Live tables, the line budgets reached from here, test-used names unless section 11 changes them. Every
new Floor file joins `FLOOR_FILES` (`tables-floor-paths.test.ts`) so the role / clock / no-URL-table scans cover it.

## 10. Verification
As U1 / U2: `compare-ui.mjs` probes per task at the five viewports against the HTML (boxes ±1 px, sizes ±0.5 px, fonts
and colours exact; our data put in the HTML's states with the local `patch` / `rewrite` actions where needed: a bill
printed, a long stay, a reservation, a charge line); every remaining difference is a mapped item of sections 4–8 with a
ruling (our names "T-3" vs "T3", our areas and counts, the second line's words, the strip, the ⋯, the Long stay mark,
"Tap to seat" on the phone, two columns below 390). U0's shell probes again (the header changes on /tables). Also 360
and 375 px phones (no clipped status word, no sideways page scroll) and a classic-scrollbar run at 1280 (the grid at
6 × 157, the header still). Side-by-side shots of every state and size for the owner; every suite; the live legs
(`verify:tables-floor:live`, `verify:tables:live`; the hand-off has node pins only, so it is checked by hand in the
browser: a tile into a bill, a tile into a new order, Seat now); a production build; every page's first screen; the
local a11y check with the menu and both confirms open; the idle request count on /tables equal to main's; the paper
untouched; the bottom inset at every width (the page foot, the strip, the toasts, the confirm sheet); the emulator on
WebView 109 and 154; the write paths for real on the scratch DB (Reserve, Free from Reserved and from Occupied, Seat now
into /pos, a tap into a bill and into a new order); then a fresh Claude Fable 5.1 review of the whole branch, one fix
wave, its re-review.

## 11. Visible words that change
The HTML's words where the HTML has the element: second line "{n} tables · {o} occupied · ₹x running" → "{o} of {n}
occupied · {r} reserved · ₹x running · Updated …" ("Live · updated just now" → "Updated just now"); "Couldn't refresh"
→ "Couldn't refresh the floor. Showing the last update." (strip; "Try again" stays); chips "All · Occupied · Available ·
Reserved" → pills "All · Available · Occupied · Bill printed · Reserved"; area summary "{n} tables · {o} occupied" /
"{shown} of {n} tables" → "{n} tables" / "1 table"; "No {occupied | available | reserved} tables right now." → "No tables
match this filter." ("Show all tables" stays); tile "{n} seats" moves to the top row ("1 seat" for one); Occupied "{n}
items · {customer}" and the action words "Open", "New order", "Seat now", "Free table" leave the tile (the dialogs and the
menu keep "Seat now" and "Free table"; the tile's accessible name says what a tap does); "No open bill" + "Tap to free
this table" → "No open bill"; Available with a bill "Open bill · ₹x" → "₹x · {stay}"; Reserved "{name}" + "{time} · {n}
seats" → "{time} · {name}" (or "Held"); stay "1 h 12 min" → "1h 12m" ("72m" below 720 px, the owner's Q5); the "Long stay" word → the red time and (≥ 720 px)
the clock mark named "Long stay"; Available gains "Tap to seat guests" ("Tap to seat" on the phone) when the table has no
charge; header "Tables" link not on /tables, "New order" label on the phone on /tables.
Kept true elsewhere (my call, as U2 kept its hint lines true): Settings → Business details hint "An occupied table shows
a Long stay label once its bill has been open this long. 15 to 600 minutes." → "An occupied table's time turns red, with
a Long stay clock, once its bill has been open this long. 15 to 600 minutes."; `docs/GO-LIVE-CHECKLIST.md` §4 "A
running table shows **Long stay** once its bill has been open…" → the same meaning in the new words. Neither is pinned.
Words that stay — test-pinned today: "Service", "Floor", "Filter tables by status", "Other tables", the status words
"Occupied" / "Available" / "Reserved", the /pos refusals naming the "Tables floor", Settings' "Tables screen" card
title; not pinned today but kept (the plan adds pins where a task touches them): "Bill not loaded", "Held", "Loading
tables…", every toast, every dialog word, the empty and error words, "Show all tables", "Open Setup", "Try again".

## 12. Changes during the build (2026-10-28)
Decided while building, recorded so the design stays the reference (the SDD ledger keeps every ruling):
- The owner's Q5 (section 4): the stay below 720 px reads whole minutes + "m".
- The tile's top row has no gap: the HTML's value (values §4.1, computed `normal`). An 8 px gap cut every two-digit name
  ("T-10" … "T-99") to "T-…" on the 390 phone; a long name that is cut now meets the seats, the HTML's own geometry
  (values §4.7).
- The tile's accessible name carries the seats after the name: "T-5, 4 seats, Available, Tap to seat guests — start a new
  order" (today's tile announced its capacity; U1's table picker does). With no known stay it leaves the dash out.
- K10 (a Reserved table holding a long-open bill, display only) keeps its long-stay signal: an sr-only "Long stay" on
  its surface and the clock mark in its free right slot at every width ("Reserved" + the clock fits 88 px; K10's detail
  has no time to turn red).
- A busy or display-only money tile below 720 px gives screen readers the long stay words, never "72m".
- The owner's Q6 (section 4, 2026-10-29, after the final review): the name comes first; a tile whose name and seats do
  not both fit hides its seats and shows the name whole.
- The confirm sheet's body keeps a hyphenated table name whole (a word joiner after each hyphen, invisible, in the body
  only): the 420 px sheet split "T-" / "3" from 720 px up.
