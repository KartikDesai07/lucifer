# U6: Reservations (/reservations, the booking detail, the reservation form, the seat flow) rebuilt to the owner's HTML (design)

Status: APPROVED by the owner on 2026-11-03 ("Han, approve hai"), every open point answered with the recommended option
(section 4: Q1–Q7). Branch `feat/ui-reservations` from main `e44723b` (U0–U5 + P1 merged). "My call" marks a decision of
mine the owner can still change; section 13's rulings B1–B28 are binding for the build. The last page of the owner's HTML.

## 1. Why, and the rule

The owner's HTML has one page left: **Reservations** (the list, the booking detail, the reservation form, the seat /
assign dialog) → our `/reservations`. The standing rules apply: the HTML's numbers are the spec, measured to the pixel; a
visible difference is fixed or shown to the owner, never parked; **every option we have today stays** and, where the HTML
has no place for it, gets one in the HTML's language; nothing is invented on the data side (what the HTML shows that we
have no data for is left out and listed, section 9); an HTML slip is never copied (section 10). The owner's rule of
2026-10-22 applies to two right-side panels here: the booking detail and the form are side panels only from 1280 px; below
1280 they open full screen, sliding up from the bottom. TURBO (owner 2026-11-02): one session, the fewest waits, the same
quality bar.

## 2. Sources

- The mock-up `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked `design\unpacked\`): page
  markup 414–538, form 1072–1145, seat dialog 1147–1160; app.js `rsVals()` 217–338, `rfVals()` 339–376, `rspVals()`
  377–381, `rsSeatNow` 197–202.
- **The exact values:** `docs/superpowers/specs/2026-11-02-reservations-html-values.md` ("values §N"; shots
  `design\spec-shots-reservations\`). It records that the HTML **renders only part of its view-model** (values §5): no
  7-day strip, no status pills, no Up next card, no stats, no pacing chart, no List / Timeline switch, no timeline, no
  floor-at-time, no group heads. Those are not in the owner's screen and are not built.
- **What we have today:** `D:\kd\pos-dev-keep\ui-redesign\inventory\reservations-features.md` ("inv": E1–E46, F1–F7,
  D1–D9, S1–S11, pins P1–P54, data §5, long words §9, the header line §10) and today's shots `current-reservations\`
  (`tools\reservations-current-shots.mjs`).
- Patterns reused: U2's order detail (a 400 px column at ≥ 1280 / the full-screen bottom sheet below,
  `lib/orders-layout.ts`), U5's item editor frame (`lib/menu-editor-layout.ts`: one Radix dialog whose classes follow the
  1280 query), U5's `MenuSelect` (the kit dropdown in the HTML's 38 px look), U3's floor scroller and focus ring
  (`lib/floor-layout.ts`), U1's confirm sheet (`ConfirmDialog look="sheet"`), `lib/nested-dialog.ts`,
  `lib/pos-table-handoff.ts` (`offerPosTable`).

## 3. Scope

**In:** `/reservations` (page frame, header contents, toolbar, list rows and cards, states, toasts), the booking detail
(new), the reservation form (`ReservationFormSheet` and its fields), the seat / assign dialog (new), the cancel and delete
confirms (look only).

**Out:** the API routes, models, `packages/*` (except where the owner answers Q6 "fix it"), every request and its timing;
the dashboard's Today's reservations card, the Floor's Reserved tiles and Seat now (they keep their look and their
`useReservations({ date: today })`); `/events` (shares FormSheet / DatePicker / TimePicker: they stay as they are for it);
the shell outside this route's header contents; the paper (the S1 43-file pin, `print-budget.test.ts`).

## 4. The owner's decisions (2026-11-03; each the recommended option)

| # | Point | Decision (the owner's answer) | The other options offered |
|---|---|---|---|
| Q1 | **Seating a booking that has no table** | **The HTML's table picker**: Seat on a booking with no table opens "Seat {name}" with our tables (free ones ready, occupied ones greyed); a pick seats the guest there in ONE save (`PUT { status: "Seated", tableNo }`). A quiet "Seat without a table" keeps today's way. "+ Assign a table" in the detail sets a table without seating (`PUT { tableNo }`). A booking that has a table seats at once, as today (`PUT { status: "Seated" }`). | As today: Seat only marks Seated; tables only through Edit; no picker, no Assign. |
| Q2 | **The time in the form** | **The HTML's half-hour chips** ("Lunch · 12 – 4 pm", "Dinner · 6 – 11 pm", with the busy dots) **plus an "Other time" chip** that opens today's time picker for any other time (a breakfast or a 7:15 booking still works). | The HTML's chips only / today's time picker only. |
| Q3 | **Two bookings on the same table within 90 minutes** | **A red warning under the tables** ("T-3 is already booked at 9:45 PM for Rahul Mehta. Pick another table or leave it unassigned."), **Save still allowed** (as today: nothing is blocked). | The HTML's: Save blocked until another table or no table. |
| Q4 | **The HTML's extra buttons we can build from our data** (multi-select) | **Book again** (a Completed / Cancelled booking opens a new form with the name, mobile and guests filled), **Restore** (a Cancelled booking goes back to Booked), **Open order** (a Seated booking with a table opens New Order on that table, as the Floor does). | Any subset. Left out either way (no data or no free way): Confirm, No-show, Remind / Late msg / WhatsApp confirmation, Call, tags, Booked via. |
| Q5 | **A long guest or table name** (measured, inv §9: names have no length limit; tables up to 24 characters) | **Never cut: the name wraps** (cards, rows, the detail's head), as the Menu (U5 Q2) and the Floor (U3 Q6). | The HTML's one line with "…". |
| Q6 | **Removing a table from a booking** (a bug today, inv §3.3: "Unassigned" snaps back and the server keeps the table) | **Fix it in U6**: the form's "Unassigned" sends `tableNo: null` and the server clears it — two small server lines (the update schema accepts `null` for `tableNo`; the item route lists `tableNo` in `nullClearsFields`, the pattern products already use) + tests. | Leave it: in Edit the "Unassigned" chip is disabled while the booking has a table. |
| Q7 | **Every booking across all dates** (today the page opens on all dates, the status filter works across them; the HTML shows one day; found by the builder check) | **Keep the HTML's day view (opening on today, Upcoming) and add "All dates" in its language**: the day box's calendar popover gets an "All dates" choice (U2 Orders' precedent); the label reads "All dates", each row carries its day ("Wed 4 · …"), rows in date + time order, the select counts and the header line cover every date ("{n} upcoming bookings · all dates"); "Today" returns. No new request (the same single list). | An "All dates" chip beside "Today" (one tap) / the HTML's day view only (search is the only cross-date view). |
| Q8 | Design approve (with the answers above) | — | — |

Settled as my calls (no question; the owner can still change any): sections 5–8 and the words in section 12.

## 5. Layout per width (values §0.2, §1)

| | ≥ 1280 (nav open or collapsed) | 904-px list column (B1) … 1279 (1024 landscape) | below (820, phones) |
|---|---|---|---|
| Page | header 56 + body; the body = grid `minmax(0,1fr) 400px` (list column + the detail column) | one column | one column |
| List rows | cards (d1280 list 600 px, c1280 756 px: as the HTML) | **table** (as the HTML's own 944–1023 band: no detail column, `list ≥ 820`) | cards |
| Detail | the 400 px column, the first listed booking shown at once; "No booking selected" only with an empty list | full screen, sliding up from the bottom, on a row press | same |
| Form | right aside 480 px (scrim z 45, aside z 46) | full screen from the bottom | same |
| Seat dialog | centred 560 px dialog | centred (≥ 720) | bottom sheet (< 720) |

- **The detail column from 1280, not 1024** (the owner's rule; the HTML docks from 1024). The table / cards switch keeps
  the HTML's own rule on the list's width: a container query on a list-column wrapper, **table when the column is ≥ 904
  px** (B1: the HTML's `cw − 48 ≥ 820` ignores its own 34 px of border and padding, so its grid clips the Actions column
  at 868–895; one threshold, my call). So 1024 shows the table (the HTML at 1024 shows cards beside its dock: mapped by the owner's rule), 1280 shows
  cards beside the column (as the HTML).
- Page frame: `/reservations` leaves `MenuPageShell` (as /orders, /kitchen, the Menu pages): `RESERVATIONS_PAGE_CLASS` =
  `POS_PAGE_CLASS flex flex-col overflow-hidden` with `@container/res` on the page (U5 M4). The page never scrolls; the list
  column scrolls (padding `20px 24px 28px` from 720, `16px 14px 92px` below, each bottom + `env(safe-area-inset-bottom)`,
  U3's 8 px scrollbar); the detail column scrolls its own body.
- `useTables()` moves from the form to the page (always mounted, as today's hidden form): the same `GET /api/tables`
  every 30 s (BASE idle count unchanged), now also feeding the rows, the detail and the seat dialog.

## 6. The page in the HTML's design

### 6.1 Header (values §2)
Title "Reservations" (15 / 600), the eyebrow "Service" for screen readers (P3), second line the HTML's: "{n} upcoming
bookings · {g} guests · {Tuesday, 3 November}" for the shown day ("1 upcoming booking"; n = Booked bookings of that day,
late ones included), while searching "{n} matches across all dates" ("1 match …", the HTML's "1 matches" not copied);
ellipsis when narrow. The action: **"New reservation"** (accent, 36 px, plus 14 px stroke 2.4, 13.5 / 600; "New" below
720) in the header at every width (`phoneTitleMinPx: 64` as U5: with Tokens on, when the title would keep < 64 px it drops
to the body row). The shell's "Tables" / "New order" quick links show on /reservations only from 1280 px (the Kitchen and
Menu rule, U4 Q8 / U5 Q8: the HTML's header has only its add button; my call). The printer button stays (ours).

### 6.2 Toolbar (values §3, §4, §9.2)
One wrapping row, gap 8, scrolling with the list (not sticky):
- **Day box** 38 px, radius 9: ‹ (36, title "Previous day") | the day label (calendar 15 + "Today · Tue, 3 Nov" /
  "Tomorrow · Wed, 4 Nov" / "Yesterday · Mon, 2 Nov" / "Fri, 6 Nov"; phone "Today" / "Tomorrow" / "6 Nov") | › ("Next day").
  The label opens **our kit calendar popover** (DatePicker's calendar, never a native input: P20) to jump to any day.
  **"Today"** (38 px, 13 / 600) shows when another day is shown. No limit either way (past days reachable, as today's
  filter).
- **Status select**: U5's `MenuSelect` (the kit dropdown, 38 px, 13.5 / 500, 190 px; phone flex), options **"Upcoming
  ({n})", "Seated ({n})", "Completed ({n})", "Cancelled ({n})", "All statuses ({n})"** with the shown day's counts; default
  Upcoming (= Booked). (No-show: no data.)
- **Search** "Search name, phone or table" (38 px box, `flex 1 1 220px`, min 180, max 340; ✕ 22 px "Clear search" while
  typed); on the phone a 38 px "Search" toggle opens the box on its own row (pressing it again closes and clears). Matches
  every date: the name, the table (also with "-" / spaces ignored: "T5" finds "T-5"; my call), or ≥ 3 digits in the
  mobile; nearest to now first. The day, the select and ✕ clear it (values §9.3).
- The day, the tab and the search live in the page's state (they reset on a visit, as today's filters).

### 6.3 Rows and cards (values §8)
One list card (white, 1 px border, radius 12, `overflow: clip`), rows in time order, no group heads (the HTML renders
none). Every row and card is one button-like target that opens the detail (keyboard: Enter / Space; `aria-label` "{name},
{time}, {status}").
- **Card** (values §8.3): time column 56 px (Geist Mono 15 / 600 "7:00" + "PM" 10.5 / 600 `--text-3`); middle: name
  14.5 / 600 (**wraps, Q5**), sub "{g} guests · {T-3 | No table}" 12.5 `--text-2` (another day while searching: "Wed 4 ·
  …" in front, my call: the HTML's card shows no date, a slip), the relative line 12 (§6.4); right: the pill (22 px) and
  the primary (32 px, 12.5 / 600). No icon buttons on cards (the HTML).
- **Table row** (values §8.2, columns `104px minmax(200px,2fr) 60px 100px 120px minmax(150px,auto)`, gap 16, padding
  12 16; head 38 px "Time · Guest · Party · Table · Status · Actions", sticky at the scroller's top edge with the
  negative-top fix (U5 M8)): time 14 / 600 + relative; name 14 / 600 + sub-line "{+91 98670 04512} · {notes}" 12.5
  `--text-3`; party; table "T-3" or the dashed "Assign" (28 px, Q1); the pill (24 px); up to two 32 px icon buttons
  (title = the action) + the primary (32 px, 13 / 600, hover opacity .88).
- **Per status** (values §19.3 mapped to our four statuses):

| Ours | Pill (label · dot · ink · tint) | Row icons (≤ 2) | Primary on the card / row |
|---|---|---|---|
| Booked | "Booked" · reserved tokens | Cancel booking | **Seat** (ink) — today's bookings only, as the HTML; other days none (Seat stays in the detail for every date: today's option, my call) |
| Booked, 15 min past its time | **"Late"** · warn tokens | Cancel booking | Seat |
| Seated | "Seated" · ok tokens | Mark completed, Cancel booking | **Open order** (accent tint, Q4) |
| Completed | "Completed" · neutral | — | **Book again** (surface-3, Q4) |
| Cancelled | "Cancelled" · neutral; the time struck through | Restore booking (Q4) | Book again (Q4) |

  Dimmed rows (Completed / Cancelled; the HTML's `opacity:.72` fails 4.5:1, values §8.4) dim with token colours instead
  (`--text-2` / `--text-3`, U4 K5 / U5 M9). A selected row / card: `--accent-t` (the `status-info-tint` token); on it the
  Open order button gets a white fill so it does not vanish (the HTML's same-colour slip).
- Time words: "7:00 PM" (our own formatter: "00:30" → "12:30 AM"; the shared `formatTime` keeps its "0:30 AM" for its
  other users). Phone shown as "+91 98670 04512" when it is 10 digits, else as stored.

### 6.4 Relative time and Late (values §19.2; derived on the client, a minute tick, no request)
Seated → "Seated {7:00 PM}" (`--ok-i` 500; we have no seated-at time, so the booking time, the HTML's own fallback);
Booked: more than 15 min past → "Late · {25 min | 1h 05m}" (`--bad-i` 600) and the pill "Late"; up to its time → "Due
now" (`--warn-i` 600); within 60 min → "in {m} min" (`--accent-i` 600); later today → "in {2h 10m}" (`--text-3` 400);
other days / Completed / Cancelled → none.

### 6.5 States
Loading: the list card with five 60 px skeleton rows (our S1 in the HTML card). First-load error: today's ErrorState and
words (P4) in the list column. Offline with no data: today's line (P5). Empty (values §9.1, the HTML's dashed box, 46 px
reserved-tint tile, "+ New reservation" 38 px): "No upcoming bookings · {Tuesday, 3 November}" / "Nothing in this list
for {…}" / "No bookings match “{q}”" with "Bookings made from here, phone calls or WhatsApp show up in this list." / "Try a
name, phone number or table like T5." (the HTML's words replace "No reservations" / "No reservations match"; the Today
button, the select and ✕ replace "Clear filters"). A failed refresh with data: nothing (as today; the list has no poll).

## 7. The booking detail (values §10)

- **≥ 1280:** the 400 px column (border-left, full height), the first listed booking shown at once, no close; "No
  booking selected" + "Pick a booking from the list to see details and seat the guest." when the list is empty. **Below
  1280:** U2's full-screen bottom sheet on a row press, ✕ (30 px) and Escape close it (B6), focus returns to the row
  (`useOpenerFocus`). One frame across a resize (no remount of the open booking); selection per B5.
- Head: name 18 / 600 (wraps, Q5), sub "{g} guests · Tue, 3 Nov · 7:00 PM", the pill 26 px; the time banner (Geist Mono
  26 / 600 "7:00 PM" + the relative words, or "Booked for 7:00 PM" (another day) / "Completed" / "Cancelled");
  **three steps** (≥ 720) Booked ("2 Nov" from `createdAt`) → Seated → Completed (the HTML's Confirmed step dropped: no
  data; Cancelled: every dot grey).
- Body: facts Table "T-3 · 4 seats" (warn ink when the seats are fewer than the guests; "Not assigned yet" in `--text-3`),
  Phone, Guest history "{n} past visits" (Completed bookings on the same mobile, from the list we already hold) / "First
  booking"; the phone (< 720) shows Table and Phone (B19: the HTML's Table-only would leave the mobile nowhere on a phone). "+ Assign a table" (dashed 38 px, Q1) when there is no table.
  The note in the bill-tint box. The action grid (60 px buttons, short labels): Booked → Cancel; Seated → Completed,
  Cancel; Cancelled → Restore (Q4); Completed → none (the grid is not drawn).
- Footer: **Edit** (flex 1, 46 px) + the primary (flex 2, 46 px, accent): Seat (Booked, any date) / Open order (Seated
  with a table, Q4) / Book again (Completed, Cancelled, Q4); with no primary Edit fills the row.
- No area names (pin P22: areas stay off reservations; the HTML's "Indoor · 4 seats" → "4 seats"; my call). No "Booked
  via", no tags, no Call (section 9).

## 8. The form, the seat dialog, the confirms

### 8.1 The reservation form (values §13)
Frame: U5's editor frame at 480 px (head 18 / 600 "New reservation" / "Edit reservation", sub "Book a table for a guest" /
"{name} · booking" / "{name} · seated", ✕ 34 px; the body scrolls; the footer: the summary line "Tue, 3 Nov · 7:00 PM · 2
guests · T-3" (clock 15; after a failed Save "Fix the highlighted fields to continue" in `--bad-i`) and Save 48 px "Book
table" / "Save changes"). Fields in the HTML's order:
1. **Mobile number** ("+91" prefix cell, placeholder "10-digit mobile", `inputMode` numeric; our rule and words stay: at
   least 10 characters, "Enter a valid mobile number") — the first field, so it gets today's autoFocus (my call, U5 M6).
   At 10 digits an earlier booking with that mobile fills an EMPTY name, and "Returning guest · {n} past visits" shows
   under it (from the list we hold; nothing for a new number: we create no customer profile, the HTML's words would be
   wrong).
2. **Guest name** (placeholder "Who is the booking for?"; "Name is required").
3. **Guests**: − n + stepper (44 px; the count typeable; minimum 1, no maximum as today) + quick 2 4 6 8 10; "Large
   party · consider joining tables" from 8; our three guests messages.
4. **Date**: the 7-day strip (Today / Tmrw / weekday + the day number) + "More" (our calendar popover; past days allowed
   as today). The 8 chips share the row (`flex 1`, at most 58 px) so "More" is always visible (the HTML hides it past
   the edge: a slip). "Pick a date".
5. **Time** (Q2): "Dots show how busy each slot is", Lunch 12:00–3:30 and Dinner 6:00–10:30 half-hour chips (46 px, the
   three load dots from the day's other active bookings within 45 min: 1 / 8 / 16 guests), today's passed slots struck
   and disabled; **"Other time"** opens today's TimePicker (a saved time off the half hours shows there, picked).
   "Pick a time".
6. **Table**: "Best fits for {g} guests" / "All tables"; the "Unassigned · Choose at arrival" chip (Q6) + up to 7
   best-fit chips (free at that time, not occupied now, seats ≥ guests; ranked by spare seats) "T-2" + "2 seats" / "Booked
   8:30 PM" / "Seated · Neha" / "Occupied now" / "Seats 4 only"; "Show all tables" / "Show best fits only"; a table no
   longer on the floor plan keeps today's chip "(no longer on the floor plan)". Messages (values §13.5): the conflict
   sentence (Q3), "T-7 is occupied right now. It may not be free by 10:00 PM.", "T-3 seats 4. For 8 guests you may need
   to join a table.". Tables without a seat count rank after the known fits, no seats line.
7. **Occasion & requests**: the note (placeholder "Notes for the team · e.g. cake at 9:30, allergic to peanuts"); no tag
   chips (no data).
8. **Delete reservation** (edit only) → today's delete confirm over the form (nested dialog); on success both close.
Inputs 16 px below 720 (our rule; the HTML's 15). The create / edit bodies are today's (`status: "Booked"` on create;
the edit PUT without `status`), plus `tableNo: null` when Q6 says fix it.

### 8.2 The seat / assign dialog (values §14; Q1)
U1's sheet frame: centred 560 px ≥ 720 (radius 14), bottom sheet below (radius 14 14 0 0, 88dvh, the inset). Head "Seat
{name}" / "Assign a table · {name}", sub "{g} guests · booked for 7:00 PM", ✕ 32 px. One grid of our tables (no area
heads: P22), tiles 56 px: dot + "T-2" + "2 seats" (ok) / "Occupied" (a table with an open bill: our tables' status, no
amount — we load no bills here) / "Seated · Neha" / "Booked 8:30 PM" / "Seats 4 only"; occupied tiles disabled when
seating, pickable when assigning (the HTML). A pick seats (`PUT { status: "Seated", tableNo }`) or assigns
(`PUT { tableNo }`), closes, toasts. "Seat without a table" (our option, quiet text button under the grid, seat mode only).

### 8.3 The confirms
Cancel (P16: still asks first; the HTML cancels in one tap with Undo, we have no undo) and Delete keep their words and
logic, in U1's confirm-sheet look (`look="sheet"`, P33 moves on purpose).

### 8.4 Toasts (the HTML's words, no Undo; my call per the standing rule)
"Booked · Tue, 3 Nov, 7:00 PM · 2 guests"; "Booking updated · Tue, 3 Nov, 7:00 PM"; "{first} seated at T-3 · 4 guests"
("{first} seated · 4 guests" with no table); "T-3 marked completed" ("{first}’s booking completed" with no table);
"{first}’s booking cancelled"; "Booking restored"; "T-2 assigned to {first}"; "Reservation deleted". Error toasts keep the
factory's words ("Could not book reservation" …). The /reservations hooks are written in the cafe with the factory's exact
requests and invalidation (`["reservations"]`), as U5 Task 4; the dashboard keeps the factory hook.

## 9. What the HTML has that we do not (left out; never added without the owner)
Confirmed and No-show (statuses), the no-show chip and "No-shows" fact, Remind / Late msg / WhatsApp confirmation (no
paid API), Call (the HTML's is a fake toast; a `tel:` link on the Android app is untested), tags, Booked via, customer
visits ("12 visits · last 2 Oct"), the bill amount on an occupied table, Undo on toasts, seating that opens an order
(ours seats only the booking, as today), the 7-day strip / pills / Up next / stats / pacing / timeline / floor-at-time
(not rendered by the HTML), area names (P22).

## 10. The HTML's own slips (values §20; my calls)
Not copied: the native `<select>` and the two native date inputs (P20); the dock from 1024 (owner rule); the 15 px
inputs (16 below 720); the booked toast 539 px wide on a 390 phone (ours wraps, B10); Edit refusing to save a booking
whose time has passed ("This time has already passed": ours keeps today's rules); rows unreachable by keyboard (B7);
inputs with no focus style (ours keep the focus ring); the `.72` opacity rows (tokens); Open order invisible on a selected card; "More" hidden past the
strip's edge; a search result's card without its date; a search row opening Edit (ours opens the detail, like every row);
"1 matches"; Escape closing nothing (ours closes the top layer); the "Confirmed" step lit for a never-confirmed seated
booking (no Confirmed step); history following a customer link instead of the mobile; the 1.5 px dashed border computing
1 px (we draw what it computes); `color-mix(in oklab …)` (precomputed rgba).

## 11. Must not change
Data and every request (today's endpoints, bodies, invalidation; the list is read once through today's default
unfiltered key — the filters no longer send their own GETs, so the page asks less, never more), the tables poll (moved to
the page, same timing), routes and roles (staff = admin here, as today), printing and the paper, WebView 109 CSS (no
`light-dark()`, runtime `color-mix()`, `in oklab` gradients, `mask-image`; 109's button rule), the preset-token rule in kit
files, line budgets (files ≤ 300), test-used names unless section 12 changes them, the dashboard and the Floor (their
reservation reads and Seat buttons), the other users of FormSheet / DatePicker / TimePicker / ConfirmDialog / MenuPageShell.

## 12. Visible words that change
Header: "Manage table bookings and seating." → "{n} upcoming bookings · {g} guests · {Tuesday, 3 November}" /
"{n} matches across all dates"; "New reservation" → "New" below 720. Filters: "Filter by status" select "All statuses /
Booked / Seated / Completed / Cancelled" → "Upcoming (n) / Seated (n) / Completed (n) / Cancelled (n) / All statuses (n)";
"Pick a date" / "Clear date" → the day box + "Today"; new "Search name, phone or table". List: heads "When / Guest /
Guests / Table / Status / Actions" → "Time / Guest / Party / Table / Status / Actions"; "Guests {n}" / "Table {t}" → "{n}
guests · {t | No table}"; "—" → "Assign" / nothing; new pill "Late", the relative words, "Seat" / "Open order" / "Book
again", the icon titles "Cancel booking" / "Mark completed · guests left" / "Restore booking" (today "Cancel reservation"
/ "Complete reservation" / "Seat guest" aria-labels go with their buttons). Empty: section 6.5. Detail: all new (section
7). Form: "Guest name" stays; "Mobile" → "Mobile number"; "Date" / "Time" / "Guests" / "Table" stay; "Notes" →
"Occasion & requests"; "Any special requests…" → "Notes for the team · e.g. cake at 9:30, allergic to peanuts";
"Unassigned" → "Unassigned · Choose at arrival"; "Book a table for a guest." → "Book a table for a guest"; "Update this
booking's details." → "{name} · booking"; "Book reservation" → "Book table"; new "Fix the highlighted fields to continue",
"Large party · consider joining tables", "Dots show how busy each slot is", "Lunch · 12 – 4 pm", "Dinner · 6 – 11 pm",
"Other time", "Best fits for {g} guests", "Show all tables", the table messages, "Delete reservation". Toasts: section
8.4. Words that stay: every validation message, the error / offline words, both confirms, "Try again".

## 13. The builder check (2026-11-03) and the rulings it produced
A fresh builder read this document, the values, the inventory and the code
(`D:\kd\pos-dev-keep\ui-redesign\reviews\u6\builder-check-report.md`). Its one "theirs" point is Q7. Its 28 minor points
are settled as my calls, binding for the build (B-n = the report's M-n):
- **B1** table from a **904 px** list column (the grid's 814 px + border / padding 34 + list padding 48 + the 8 px
  scrollbar; at 868 the Actions column clipped), cards below; **B2** the container is a list-column wrapper OUTSIDE the
  scroller (U2's `ORDERS_LIST_COLUMN_CLASS` pattern), not the page.
- **B3** phone toolbar: the status select keeps a 116.81 px floor; when the day group + select + search toggle do not
  fit, the select and the toggle wrap to a second row. **B4** the form's day strip: the seven 58 px day chips scroll
  sideways, "More" sits outside the scroller at the row's end (always visible, 58 px) — replaces section 8.1 item 4's
  shared-row idea (it fell under 44 px on phones).
- **B5** selection = U2's model (`lib/orders-choice.ts`, rulings P9 / P11, `frameInUse`): ≥ 1280 auto-picks the first
  listed row once; a press is the operator's choice; the day, Today, a calendar pick, the select and each search
  keystroke drop it; below 1280 an auto-pick gives way (a rotation never pops the sheet open), a pressed booking stays
  open across 1280; the detail's frame holds while a dialog opened from it is up; the detail reads the live booking
  from the whole list (it stays on a booking that leaves the tab); nothing while the list is pending / failed; after a
  delete the sheet closes / the column takes the new first row; a pressed search row shows the selected tint.
- **B6** below 1280 the detail closes with ✕ and Escape (U2's sheet has no scrim; Back is not a sheet close in this app).
- **B7** rows: U2's pattern — the name / time is a real button stretched over the row (`::after`), aria-label "{name},
  {time}, {status}"; the icons and the primary sit above it.
- **B8** insets: the detail footer = U2's `ORDER_DETAIL_FOOT_CLASS` bottom (14 px + inset; 12 px + inset below 720);
  /reservations joins the inset toaster set (`FLOOR_TOASTER_PROPS`, P35 moved on purpose).
- **B9** header: `phoneTitleMinPx` = the measured width of "Reservations" (the title never cuts); the body row is
  U5's place (top of the list scroller); the second line is undefined until the list answers; the quick-links rule adds
  `isReservationsPath` to `wideOnly` (`lib/header-quick-tabs.test.ts:81` moved on purpose).
- **B10** long words (with Q5 "wrap"): `[overflow-wrap:anywhere]` on every name and table name; the card sub, the seat
  title and the form sub wrap; the table row's sub-line keeps one line with "…" (the note is whole in the detail); a
  chip's / tile's table label wraps and the tile grows; toasts wrap inside their max width.
- **B11** "Late" (pill + relative line) only on today's bookings; a Booked booking on a past day shows "Booked", no
  relative line, no card primary. **B12** "today" is held as unset and follows the minute tick; today =
  `cafeDateString()` (the Floor's and the dashboard's clock).
- **B13** one page-wide busy flag over every status write (Seat from a row / the detail / a seat tile / "Seat without a
  table", Mark completed, Cancel, Restore, Assign); the seat dialog closes on success and stays open on a failure (the
  hook's error toast); Open order, Book again and Edit are never disabled.
- **B14** pins moved on purpose (listed in the plan): P1, P5's anchor, P6, P7 / P8, P9, P10–P13, P14 / P15, P16's needles
  (Cancel still asks first; Complete one tap; Seat follows Q1), P18 (new files), P21 (the day box and "More" render
  through DatePicker), P33, P35, the quick-links pin; kept: P3, P4, P17, P20, P22, P24; the file name
  `ReservationFormSheet.tsx` stays (P20 / P21 / P22 name it). **B15** pills: a new `RESERVATION_PILL_KIND` (with Late) in
  `lib/ui/status.ts` read through `STATUS_CLASSES`; `RESERVATION_KIND` (the dashboard's) untouched.
- **B16** dimmed rows name their tokens per part (name `--text-2`, sub / AM-PM `--text-3`, the neutral pill as is); a
  selected row's Open order uses `bg-card`; the picked slot's empty dots the HTML's literal rgba.
- **B17** Open order = `offerPosTable` + the warm `/pos` link; /pos answers a Reserved or removed table with its own
  words (no table write from this page). **B18** tables: a Reserved (held) table reads "Reserved" in reserved ink, pickable
  in both modes; tables still loading → a short skeleton grid ("Seat without a table" stays live); a booking on another
  day: no Occupied state; "Occupied" = the table's status Occupied.
- **B19** the detail keeps the Phone fact on the phone too (the cards show no mobile); a table no longer on the floor
  plan reads "T-9 · no longer on the floor plan" in warn ink; no Seated-step time; "1 past visit", "1 guest".
- **B20** form: a new booking presets the shown day if it is today or later, else today (Book again the same); "Other
  time" = a 46 px chip after the Dinner grid reading the picked time; TimePicker gains an optional `label` prop as
  DatePicker has (/events unchanged); editing today's booking whose slot has passed: picked wins, Save keeps the time;
  passed slots only today; the "+91" cell shows a stored mobile as it is, the returning-guest match on digits only; the
  guests count a text input `inputMode="numeric"` 17 px; failed-Save looks = U5's `aria-invalid` red rule; after a
  create the page shows that day, Upcoming, search cleared; a failed save keeps the form; names and phones are sent as
  typed (the HTML's title-casing is not copied).
- **B21** words: section 12 lists them all (the seat dialog's, the titles, the slot titles, the summary's "time not set"
  / "no table"; the select keeps aria "Filter by status").
- **B22** freshness: the day and the tab never fetch; a booking from another device shows after a write here, a revisit
  past 60 s or a reload (as today's default list). **B23** the search input 16 px below 720. **B24** "Seat without a
  table" 44 px tall, the link look of "Show all tables". **B25** files ≤ 300 (the plan names them); the day list,
  counts, search and per-mobile history memoised on the list's identity. **B26** Assign for Booked and Seated bookings with
  no table; a Seated booking with no table has no primary. **B27** `useOpenerFocus` on the seat dialog; the confirm sheet
  keeps its own focus. **B28** Q6's exact change: `updateReservationSchema = createReservationSchema.partial().extend({
  tableNo: tableNoSchema.nullable().optional() })`, `nullClearsFields: ["tableNo"]` on the item route; only the edit
  payload maps Unassigned to `null`; a schema + route + form test.
