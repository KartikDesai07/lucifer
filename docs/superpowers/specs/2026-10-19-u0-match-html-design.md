# U0, rebuilt to the owner's HTML: the shell, the dashboard, sign-in and lock (design)

Status: draft for the owner's approval, 2026-10-19. Branch `feat/ui-redesign` (U0 at `77ef4c0`, not merged).

## 1. Why, and the rule

The owner saw the U0 preview and wrote (2026-10-19): "Ye kesi UI hai??? mene proper HTML bhi diya kaha kitni size honi
chhiaye sab hai proper same view nahi bana sakte ho??". U0 took the HTML mock-up as a loose reference: it restyled our
components and parked real differences as "minor" (the hero figure 40/32 px instead of 60/42 px Geist Mono, sidebar rows
32 px instead of 38 px, no 76 px tablet rail, no phone tab bar, a separate top bar plus big page headings instead of the
HTML's 56 px page header, no bar chart, no tables summary, no chip actions, no receipt edge). Measured on the current
build: 113 of 230 checked properties differ from the HTML.

**The rule for this work:** the HTML's numbers are the spec. Every visible element of the screens in scope takes the
HTML's size, spacing, font, weight, colour, radius, border, shadow and per-breakpoint behaviour exactly. Where our app has
something the HTML does not (a feature, a page, a word that comes from our data), it is drawn in the HTML's own visual
language, as section 5 says. A visible difference from the HTML is never parked as "minor": it is fixed, or shown to the
owner and decided by the owner.

## 2. Sources

- The mock-up: `C:\Users\Kartik.desai\Downloads\Olivea POS (latest).html` (sha256 `a31378a947d8…`), copy
  `D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html`, unpacked markup and script in `design\unpacked\`.
- **The exact values:** `docs/superpowers/specs/2026-10-19-u0-html-values.md` (extracted from the markup and script, with
  measured boxes where a value only exists at run time). Every number an implementer needs comes from there; this
  document only adds the decisions and the mapping of our features.
- Reference shots of every state at 1280×800, 1024×768, 820×1180, 390×844:
  `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots\` (77 files, listed in section 6 of the values document).

## 3. The owner's decisions

Made on 2026-10-19:
1. **Sales are masked, as in the HTML.** The Net sales hero, Average order, Collected (its note becomes "still due
   hidden") and the bill-breakdown values show "₹ • • • •" / "• • • •". "Show" asks for the signed-in person's own PIN and
   then shows them for 1 hour on this device ("Sales visible for the next hour · tap the eye to hide"). Section 7.
2. **The HTML's shell, now, on every page:** a 232 px sidebar at 1280 px and wider (collapsible to the rail), a 76 px icon
   rail from 720 to 1279 px, and on a phone (below 720 px) no sidebar but a bottom tab bar (Home, Floor, Order, Orders,
   More). Every page gets the HTML's 56 px header (title and subtitle on the left, actions and the printer button on the
   right); the separate top bar goes. Our header buttons (Tables, Refresh in the apps, Tokens when on, the printer) stay,
   drawn as the HTML's header buttons.
3. **The order-request band stays** as a slim strip under the header, in the HTML's warn colours, with the same words;
   on the dashboard the requests are also a "Needs attention" chip.

Kept from the U0 decisions (behaviour, not look): the PIN sign-in rules (tiles plus a 4-digit PIN, the first sign-in on a
device by password, the PIN stored as a plain string for the admin, rate limits per selected person: 5 wrong in 10
minutes, 20 wrong in a cafe-day blocks), the 90-day session, the 1-hour auto-lock, light only, the paper never changes,
the diner menu keeps the cafe's own Appearance colours.

## 4. Scope

In: the theme tokens and fonts; the app shell on every page (sidebar, rail, tab bar, More/profile sheet, page header,
request strip, toast); `components/shared/PageHeader.tsx` (it now fills the shell header); the dashboard, every section;
the sales mask and its PIN dialog; the login page, the lock cover and the PIN pad.

Out (each in its own later page session): the bodies of the other pages. They get the new shell and header in this work
and keep their own content until their session. The diner menu (`/m`) keeps its Appearance colours; kit changes reach
it only through shapes, as before.

## 5. Our features in the HTML's design

### 5.1 Theme and fonts
- Tokens: every `:root` value of values-doc 1.1 (light), with our existing names where they exist and new staff-only names
  for the rest (`--surface-2 #FAFAFA`, `--border-2 #ECECEF`, `--surface-3 #E9E9EC`, `--seg`, `--seg-sh`, `--link`,
  `--accent-b`, `--glass`, `--toast`, `--toast-t`, `--toast-a`, `--pop`, `--scrim`, `--brand #C8381F`,
  `--brand-nav #FF6B4A`, the status set ok/warn/bad/info/bill/res with `-i`, `-t`, `-b` exactly as the HTML). Where U0
  changed an HTML value for contrast (for example `--status-ok-ink #16733a` instead of the HTML's `#198038`), the HTML
  value comes back; the contrast notes are listed in section 9 for the owner.
- Fonts through `next/font` only (built in, nothing fetched at run time): Geist (400/500/600/700), **Geist Mono**
  (400/500/600) for every figure the HTML sets in Geist Mono, **Shrikhand** (400) for the cafe's name and initial.
- Line height `normal` where the HTML sets none (values-doc 0.3), not Tailwind's 1.5.
- The HTML's `color-mix()` colours (avatar tints, the chart's 60 % bars) are written as precomputed hex (WebView 109).

### 5.2 Sidebar (≥ 1280 px wide; rail at 720–1279 px and when collapsed)
- Exactly values-doc 2.3: 232 px, padding 12px 10px, brand block, 11 px group labels, 38 px rows at 13.5 px, the 3 px
  blue active bar, grey count badges, the Collapse/Expand button (≥ 1280 px; the choice is remembered on this device),
  the divider and the user card. Rail: 76 px, 60×52 items with a 10.5 px label under the icon, separators between groups.
- Brand block: the tile shows the cafe's uploaded logo when there is one, else the first letter of the cafe's name in
  Shrikhand on `--brand`; the name in Shrikhand 18 px `--brand-nav`; line 2 "{product name} · {this device's print name}"
  (only the product name when the device has no name).
- Groups and items (HTML: two groups):
  - **Operate:** Home (`/`), Floor (`/tables`), Order (`/pos`), Orders, Order Requests (its count as the grey badge),
    Kitchen, Now Serving (when tokens are on), Reservations ("Bookings" in the rail, as the HTML).
  - **Manage:** Menu ›, Tables › (admin), Customers, Expenses ›, Events, Staff (admin), Reports › (admin), Printer setup
    (admin), Settings › (admin).
- Items with sub-pages (›): in the wide sidebar the row expands to sub-rows under it (34 px, 13 px, `--nav-t`, the active
  sub-row white on `--nav-on`, indented to the label's x); in the rail the item opens a flyout to its right (the profile
  sheet's panel style: `--surface`, radius 14, `--pop`) listing the sub-pages. My call: the HTML has no nested items.
- The user card opens the profile sheet (5.4).

### 5.3 Page header (every page) and the request strip
- Exactly values-doc 2.5: 56 px, white, bottom border, sticky; padding 0 20px (phone 0 12px); on a phone the 30 px mini
  logo first; title 15/600, subtitle 12 px `--text-2` ellipsised; 36 px buttons (outline: 1px `--border`, radius 8, 13.5/500;
  primary: `--accent`, 13.5/600); the 36×36 printer button with its 10 px status dot (green = printing on, orange = off,
  as today's dot rules).
- `PageHeader` keeps its props and fills this header: `title` → title, `description` → subtitle, `actions` → the buttons
  (on a phone they move to a row at the top of the page body, because the HTML's phone header holds icon buttons only).
  A page without a `PageHeader` shows its nav label as the title. No page body shows the title a second time.
- Global buttons after the page's own, in this order: Tables (outline, `/tables`; hidden on a phone, where the tab bar
  has Floor), New order (primary, `/pos`; "+" only on a phone), Refresh (outline icon, in the apps only, as today), Tokens
  (outline icon, when tokens are on, as today), the printer button. On the dashboard the page's own buttons are the
  HTML's End of day plus a date button (our past-day End of day) in the same outline style.
- The order-request strip (today's `RequestAlertBar`, same words, same behaviour): under the header, full width,
  `--warn-t` background, 1px `--border` bottom; "N new order requests" 13 px 600 `--warn-i`; "Enable sound" as a 30 px
  outline button; the "Alerts and auto-print only work while this panel is open…" note 12.5 px `--text-2`; one 40 px line
  on wide screens, wrapping on a phone. My call (the HTML has no such strip).

### 5.4 Phone tab bar, More sheet, profile sheet, toast
- Tab bar exactly values-doc 2.6 (glass, 56 px tabs, 22 px icons, 11 px labels): Home, Floor, Order, Orders, More, for
  both roles (each is allowed to both). The page gets 92 px bottom padding.
- More sheet (phone) / profile sheet (tablet, desktop) exactly values-doc 2.7, without the Theme block (light only for
  now). Rows: Lock screen (with the "⌘L" chip on a desk) and Switch user as the HTML, then ours in the same row style:
  Change password, Sign out. Footer "Auto-locks after 60 min without activity" (our setting; "Auto-lock is off" when off).
  The phone grid holds every allowed destination not in the tab bar; a tile with sub-pages opens a second view in the
  sheet listing them (with a back arrow). Ctrl/⌘+L locks the screen, as in the HTML.
- Toasts (sonner) take the HTML toast: `--toast` background, white 13.5 px, radius 10, padding 10px 14px, bottom centre,
  24 px from the bottom (92 px below 1024 px, 140 px on a phone).

### 5.5 Dashboard
Every section exactly as values-doc section 3 (containers, `db.L` per content width, card styles, figures in Geist Mono,
the order of sections), filled with our data:
- **Attention:** our items as HTML chips (bold part, rest, action pill): "2 QR orders" waiting · View (`/requests`,
  dot warn); "4 open tabs" · ₹1,670 · Open (unpaid orders, dot info); "N bookings" today · View (`/reservations`, dot res);
  "2 items" unavailable · View (out-of-stock items, dot bad); "₹7,769 due" from 22 customers · Collect (`/customers`, dot
  bill). The phone card as values-doc 3.1. Nothing to attend: our "All clear" line in the HTML's 13 px `--text-2`.
- **Period row:** title and "{range} · compared with {our comparison}" as the HTML; the segmented control exactly as the
  HTML with ours: Today, Yesterday, 7 days, 30 days, and Custom (our date range, admin only as today).
- **Net sales hero:** exactly the HTML (dark card, 60/42 px Geist Mono, the delta pill, the reveal button and hint, the
  three minis); our deltas and "vs …" labels; "No orders on …" when the comparison has none (a grey pill).
- **Bill breakdown:** the HTML receipt (dashed rules, Geist Mono values, the torn edge, the period tag); our rows keep our
  words (Gross bill, Discounts, Rewards given, GST added, Additional charges) because they are our data; masked as 3.17.
- **Sales by hour:** the HTML bar chart in CSS (no chart.js on this card): one bar per hour from the first to the last
  hour with sales in either series (at least 8 hours), the peak bar `--accent`, others the 60 % tint, future hours
  `--surface-3`, the dashed comparison line, y ticks and footer as the HTML formulas, the tooltip on hover/tap.
- **Live tables:** the HTML card: status bar and legend (Free, Eating, Bill printed, Reserved from our table states),
  zones = our areas, 92 px tiles with the HTML's five states mapped from ours, "Floor →".
- **Recent orders, Today's reservations, How guests paid, Where orders came from, Money leaks, Top items, Sales by
  category, Slow movers, Busy hours:** each exactly as its values-doc section, with our data and our row words; header
  links as the HTML ("All orders →", "View all →", "Menu →"); "Seat" opens our reservations page.

### 5.6 Sign-in and lock
- The lock cover and the login page take values-doc 4.2–4.5: the tint, the top bar (brand tile, the cafe name in
  Shrikhand 20 px `--brand`, "{product} · {device}", the Online chip from the browser's online state ("Offline · PINs still
  work"), the divider, the clock), the card per breakpoint, the footer "Powered by Sandbee POS" (no demo PIN line).
- Picker: greeting, sub, the search box (filters by name), the role tabs with counts (All staff / Admin / Staff, our
  roles), the tile grid (6/4/3 columns, 60/52 px avatars), tile states (Locked · {ago} as the HTML; "PIN blocked" in
  `--bad-i` for a blocked PIN; else the role), "No staff found for “{q}”.".
- PIN pad: the HTML's back link, 80 px avatar, name 20/600, the 13 px dots (ink when typed, red ring after a wrong PIN, no
  fill), the 60 px (phone 62 px) keys with radius 10 and 22 px digits, "Forgot PIN?". Our messages and limits stay.
- The password form (a new device, and the lock's "Sign in with username and password") sits in the same card: the HTML
  has no sign-in screen, so its fields take the HTML's form style (44 px fields, radius 10, 15 px text, 13/600 labels,
  48 px primary button, radius 10). My call.

## 6. What stays exactly as today
Every page's data and requests (no new recurring request; the one new request is the user-driven PIN check of 7), every
route and role rule, printing and the paper (the S1 43-file pin, `print-budget.test.ts`), the PIN and session behaviour,
WebView 109 safety (no `light-dark()`, no runtime `color-mix()` on the staff screens, the postcss fallbacks for tints),
the preset-token rule for kit files the diner menu reaches.

## 7. The sales mask
- Masked values as values-doc 3.17. The reveal button, hint and states as values-doc 3.3; the PIN dialog as values-doc
  3.16 (360 px panel, 50 px keys radius 14, 14 px dots with the `--bad-t` fill on error), titled "Show sales figures".
- The PIN is checked on the server: `POST /api/sign-in/verify-pin` with the signed-in person's own PIN, counted in the
  same per-person rate limit as the PIN sign-in (a wrong PIN here counts as a wrong PIN there). Right PIN: the device
  remembers "{person} may see sales until {now + 1 hour}" in session storage; leaving the dashboard or locking hides the
  figures again, and within the hour the same person shows them again without a PIN.
- A person with no PIN sees the dialog's message "Set a PIN on the Staff page to show sales." (admin) / "Ask an admin to
  set your PIN to show sales." (staff). My call, for the owner to confirm.

## 8. Verification (what "done" means)
- `D:\kd\pos-dev-keep\ui-redesign\tools\compare-ui.mjs` measures the HTML and our build at 1280×800, 1280×800 collapsed,
  1024×768, 820×1180 and 390×844 with a probe list per section (boxes ±1 px, fonts, weights, colours, radii, paddings
  exact). A task is done when its probes show no difference, or each remaining one is a mapped feature of section 5.
- Side-by-side shots of each screen and size for the owner after each part, before the next part starts.
- As U0: every suite, a production build, every other page's first screen, the emulator on WebView 109, the local a11y
  check, the S1 pin, the print budget, the idle request count.

## 9. Contrast notes for the owner
The HTML's own pairs are used as they are. Measured below 4.5:1 for small text: `--ok-i #198038` on `--ok-t #DEFBE6`
(4.38:1, the "↑ %" pills on light cards), `--text-3 #6B6B74` on `--bg #F4F4F5` (4.8:1, passes). The owner may keep them
(the HTML) or ask for darker inks later.
