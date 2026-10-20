# The new look, staff PIN sign-in and screen lock, sidebar and dashboard (design)

**Date:** 2026-10-16. **Branch:** `feat/ui-redesign` (from `main` `4388752`; its head before this spec is the redesign plan,
`325dac0`). **Owner's design source:** the mock-up "Olivea POS (latest).html" the owner gave on 2026-10-16, kept locally at
`D:\kd\pos-dev-keep\ui-redesign\design\olivea-pos-latest.html` (unpacked: `design\unpacked\markup.html`, `app.js`; renders
at phone 390, tablet 820/1024 and desktop 1280 in `design\shots\`; re-render with `design\shoot.mjs`, network blocked).
The mock-up is the visual reference, not a blueprint: the owner's words were "iska ref lena hai, same aesa nahi kar dena,
hamare pass features hai, jesa hai wo wesa hi rahega, only proper UI change karni hai" (take its reference, do not copy it;
our features stay exactly as they are; only the UI changes). The one new feature is the staff PIN sign-in and screen lock,
which the owner asked for by name.

## 1. Intent

- **PIN sign-in and lock (first):** staff must not type a username and password again and again ("multiple time usko id
  pass add na karna pade"), and a panel must not stay open on a PC with nobody at it ("panel aese hi pc me open na rahe").
  The mock-up's way: pick your name, enter a 4-digit PIN.
- **The new look:** the mock-up's calm neutral palette with one blue action colour, a dark sidebar, and its dashboard
  arrangement, applied to our app without changing what any page does. It must work properly on a phone, a tablet and a PC.
- **Then the owner checks it** on a local server and gives the merge OK.

## 2. Scope of this piece of work, and what is not in it

In scope, in this build order:

1. **Theme and kit (app-wide, light only):** new token values in `apps/cafe/app/globals.css`, the font tokens, the shared
   kit `components/ui/*` restyled with the same exports, props and variant names, the shared class constants
   (`components/brand/brand-classes.ts`), the chart palette. The sidebar turns dark in step 3, with its row classes and
   its pinned contrast pairs together, so step 1 keeps a light sidebar value.
2. **Staff PIN sign-in and screen lock** (section 5): a feature, with data, API and auth changes the owner asked for.
3. **The app shell's look:** the sidebar (dark), the top bar, the request alert bar, the account menu (section 6).
4. **The dashboard page** (`/`): its layout re-arranged after the mock-up, every card and figure it has today kept
   (section 7).

**One branch, one check, one merge** (owner: "one Ui change ho me check karunga uske bad main me merge"): the four parts
land on `feat/ui-redesign` as separate test-first commits, the owner checks the whole on the local server, and the branch
is merged once with the owner's OK. A part does not have to be shippable on its own (for example the dark sidebar token
lands with step 1 while the sidebar's row classes change in step 3), but every commit keeps every suite green.

Not in scope (owner's decisions of 2026-10-16 unless marked "my call"):

- **Dark mode switch:** light only for now (owner). Dark token values are written in `.dark` so a later phase can turn it
  on, but nothing adds the `dark` class and no Theme option is shown.
- **Phone bottom tab bar:** later, together with the `/pos` page's own session (owner), because `/pos` already has a
  bottom cart bar on phones.
- **Sidebar widths stay** 16rem expanded / 3rem collapsed / 18rem phone sheet: the POS product grid's columns are computed
  from them (`lib/pos-layout.ts` `SIDEBAR_WIDTH_REM`, parity-pinned by `lib/pos-layout-paths.test.ts`). The mock-up's
  232 px sidebar and 76 px labelled rail come with the `/pos` session (my call, accepted by the owner).
- **Page titles stay inside each page;** the top bar keeps its own contents (owner, option A).
- **Not added from the mock-up** (owner: our features stay as they are): its roles (Manager / Cashier / Captain /
  Kitchen; we have Admin / Staff), clock-in / break / shift, hiding sales figures behind a PIN, manager PIN approval for
  discounts, "lock after every sale", the "terminal sign-in", a "counter device" button (the device memory of 5.2 does its
  job without one), the Shrikhand wordmark (my call: each cafe's own logo and name stay).
- **Other pages' layouts** do not change; they only take the new colours, type and controls through the tokens and the
  kit (owner, option A). Pages still using raw palette classes (38 files, for example `bg-green-50`) keep them until their
  own session.

## 3. Constraints (from the redesign plan's Global constraints, with this work's exceptions)

1. **UI only, except the PIN feature.** The PIN feature may change, and only as section 5 says: `apps/cafe/models/Staff.ts`,
   `models/Settings.ts` (+ `settings.types.ts`), `lib/auth.ts`, `auth.config.ts`, `types/next-auth.d.ts`, the staff API
   routes, two new sign-in routes (5.3), `lib` helpers for the PIN and the device memory, and in `packages/shared`: the
   staff schema (`src/schemas/staff.schema.ts`), the settings schema, the client `Staff`/`Settings` types (`src/types.ts`),
   `SESSION_MAX_AGE_SECONDS` in `src/constants.ts` (90 days, 5.1) and a new `src/staff-pin.ts`. Nothing else in `api`,
   `models`, `workers` or `packages` changes; no route, role or admin rule changes.
2. **Free tier, ₹0 forever:** no recurring request is added. New requests are user-driven only: one GET of the device's
   remembered people when the login page or the lock screen opens, one POST after a username/password sign-in (the device
   remembers the person), one PIN sign-in per unlock (plus Auth.js's own session read after it), one GET when an admin
   taps "Show PIN". `packages/shared/src/print-budget.test.ts` stays unchanged.
3. **The paper never changes.** The 43 files of the S1 pin stay byte for byte. Because the print iframe copies the page's
   stylesheets, a global token change could still reach a slip through inherited CSS (for example `body { color }`).
   Verification compares the printed bytes of every slip kind before and after (section 8); if any differ, a rule in
   `globals.css` (never in a slip file) holds the slip root to its old values.
4. **Printing behaves exactly as today,** including while the screen is locked and when the user is switched (section 5.6).
5. **WebView 109:** no CSS Chromium 109 cannot paint (no `light-dark()`, `@starting-style`, `subgrid`, `@scope`, anchor
   positioning, popover API, `field-sizing`, view transitions); OKLCH and `color-mix()` only through the existing postcss
   fallbacks (`postcss.config.mjs`, `postcss-tint-fallback.cjs`, `lib/css-compat.test.ts`). `inert`, `:has()`, `dvh`,
   `backdrop-filter` are fine in 109.
6. **The cafe's own themes** (Settings → Appearance, 6 presets + accent) colour only the diner's QR menu (`/m`) and the
   admin preview, and `packages/shared/src/appearance*.ts` is not touched. The diner menu uses the same kit, and the owner
   decided (2026-10-16, option B) that it **takes the kit's new shapes while its colours stay the cafe's own**. So the kit
   files (`components/ui/*`) use only the colour tokens the presets set at run time (`--background`, `--foreground`,
   `--card`, `--muted`, `--border`, `--accent`, `--primary`, `--input`, `--ring`, `--secondary`, `--popover`,
   `--destructive` and their `-foreground` pairs, `--radius`) or tints derived from them (`bg-primary/90` and the like,
   which the postcss fallback paints through the presets' `-rgb` twins on WebView 109). Staff-only tokens (the status set,
   `--ink`, `--primary-hover`, `--subtle-foreground`, the sidebar set) appear only in staff-only components, never in a
   kit file, so a cafe with a maroon theme never gets a blue hover on its menu. A pin test holds this rule.
7. **Touch and sizes:** 44 px controls on touch pages (`pointer-coarse:` variants as today, `PRINTER_ACTION_CLASS` `h-11`),
   the PIN pad keys 54–56 px; phone 390 px with no sideways scroll; tablet 820/1024; desktop 1280.
8. **Names tests and device scripts use** keep their text: "Refresh", "Toggle Sidebar", "Printer …", "Open tabs (…)",
   "New Order", every form label and aria-label, unless this spec changes it (only the login page's words change, 5.3).
9. **Fonts through `next/font`** only (build time); no font or icon fetched at run time.
10. Local only, branch, the owner's merge OK, push only on the owner's word with the token store; every new cafe test file
    in `apps/cafe/package.json` `testChain`; every new assertion carries a message; a class-name pin that changes is changed
    in the same commit with the reason.

## 4. The theme

### 4.1 Colour tokens (light, `:root`)

The mock-up's palette, mapped onto our existing token names so every page moves at once. Hex values are taken from the
mock-up; contrast was measured (WCAG relative luminance) and the text pairs below all pass AA.

| Our token | New value | Mock-up name | Notes |
|---|---|---|---|
| `--background` | `#F4F4F5` | `--bg` | the page behind cards |
| `--foreground`, `--card-foreground`, `--popover-foreground` | `#18181B` | `--text` | 17.7:1 on white, 16.1:1 on the page |
| `--card`, `--popover` | `#FFFFFF` | `--surface` | |
| `--muted`, `--secondary` | `#F2F2F4` | `--hover` | quiet fills, hover |
| `--muted-foreground`, `--secondary-foreground` | `#52525B` | `--text-2` | 7.7:1 on white, 7.0:1 on the page |
| (new) `--subtle-foreground` | `#6B6B74` | `--text-3` | captions only; 5.3:1 on white, 4.8:1 on the page |
| `--border` | `#E2E2E6` | `--border` | dividers and card edges (decorative) |
| `--input` | `#8B8B93` | (darker than the mock-up) | **my call:** a field's edge needs 3:1 (WCAG 1.4.11); the mock-up's `#E2E2E6` is 1.3:1. 3.4:1 on white |
| `--primary`, `--ring` | `#0F62FE` | `--accent` | white on it 5.0:1 |
| (new) `--primary-hover` | `#0043CE` | `--accent-h` | |
| `--primary-foreground` | `#FFFFFF` | `--on-accent` | |
| `--accent`, `--primary-soft` | `#EDF5FF` | `--accent-t` | selected tint |
| `--accent-foreground` | `#0043CE` | `--accent-i` | 7.1:1 on the tint |
| `--destructive` | `#DA1E28` | `--bad` | white on it 5.0:1 |
| `--success` | `#24A148` | `--ok` | fills, dots, bars only (3.35:1 on white) |
| `--warning` | `#FF832B` | `--warn` | dots and bars only; never text |
| (new) status set | see 4.2 | `--ok/-i/-t`, `--warn…`, `--bad…`, `--info…`, `--bill…`, `--res…` | |
| (new) `--ink`, `--on-ink` | `#18181B`, `#FFFFFF` | `--ink` | the black "selected chip" and the dark hero card |
| `--sidebar` | `#111113` | `--nav` | the dark sidebar |
| `--sidebar-foreground` | `#C8C8CC` | `--nav-t` | 11.3:1 on the sidebar |
| (new) `--sidebar-muted` | `#8B8B93` | `--nav-t2` | headings, captions; 5.6:1 |
| `--sidebar-accent` | `#1F1F23` | `--nav-on` (white 9 % over `#111113`, flattened) | hover and active row fill; white text 16.4:1 |
| `--sidebar-accent-foreground` | `#FFFFFF` | | |
| `--sidebar-border` | `#27272A` | `--nav-2` | |
| `--sidebar-primary` | `#0F62FE` | `--accent` | the active row's 3 px bar |
| `--sidebar-ring` | `#78A9FF` | | a focus ring visible on the dark surface |

The legacy `--brand-*` tokens (about 850 uses in pages) are re-pointed, not renamed, so pages already on the brand classes
move with everything else:

| `--brand-…` | New value |
|---|---|
| `paper` | `#F4F4F5` |
| `wash` | `#F2F2F4` |
| `slip` | `#FFFFFF` |
| `ink` / `ink-hover` | `#18181B` / `#27272A` |
| `muted` | `#52525B` |
| `rule` | `#E2E2E6` |
| `field` | `#8B8B93` |
| `accent` / `primary` | `#0F62FE` |
| `primary-hover` | `#0043CE` |
| `primary-soft` | `#EDF5FF` |
| `danger` | `#A2191F` (text: 7.8:1) |
| `up` | `#198038` (text: 5.0:1) |
| `sidebar` | `#111113` |

`lib/brand-contrast.test.ts` keeps measuring every pairing it measures today, with the new values, and gains the new pairs
above (sidebar text, status inks on their tints, captions).

### 4.2 Status colours (one vocabulary)

Each status has a fill (dots, bars, the left mark of a tile), an ink (its text, ≥ 4.5:1 on its tint) and a tint
(background). Words always sit beside the colour.

| Status | Means | Fill | Ink | Tint | Border |
|---|---|---|---|---|---|
| ok | done, paid, free table, connected | `#24A148` | `#198038` | `#DEFBE6` | – |
| warn | pending, KOT pending, waiting | `#FF832B` | `#BA4E00` | `#FFF2E8` | – |
| bad | cancelled, error, out of stock, due | `#DA1E28` | `#A2191F` | `#FFF1F1` | – |
| info | eating, open, in progress | `#0F62FE` | `#0043CE` | `#EDF5FF` | `#A6C8FF` |
| bill | bill printed, not paid | `#B28600` | `#8E6A00` | `#FCF4D6` | `#F1C21B` |
| reserved | reserved, booked | `#8A3FFC` | `#6929C4` | `#F6F2FF` | `#D4BBFF` |

They are tokens (`--status-ok`, `--status-ok-ink`, `--status-ok-tint`, …) with Tailwind colour names in `@theme inline`,
so a page writes `bg-status-bill-tint text-status-bill-ink`. Raw palette classes are left in pages until their session.

### 4.3 Chart palette

One exported palette (in the UI constants module, 4.6). How it reaches each chart today: `SalesChart.tsx` and
`ReportChart.tsx` (Chart.js) read the `--brand-*` variables at run time (`--brand-accent`, `--brand-primary`,
`--brand-primary-hover`, `--brand-ink`, `--brand-field`, `--brand-rule`, `--brand-wash`, `--brand-muted`,
`--brand-slip`), not `--chart-1…5`; Payment mix, Channels and Busy hours are plain bar rows and a heat map, not Chart.js.
So: both Chart.js charts take the new blue and greys through the re-pointed `--brand-*` tokens with no code change; the
dashboard's own cards (`components/dashboard/*`, the dashboard's own files) take the per-method, per-channel and heat-map
colours below in code; the reports pages' charts and rows get only the token look now and their category colours in
their own session (my call). The palette:

- the current period's bars: `#0F62FE` (the current hour / the peak: full; earlier hours: `#78A9FF`);
- the comparison line: `#8B8B93`, dashed;
- payment methods (our modes, `SETTLEMENT_PAY_MODES`): Online `#0F62FE`, Cash `#24A148`, Split `#8A3FFC`, Due `#B28600`,
  Credit `#FF832B` (the mock-up's UPI / Cash / Card / Due idea on our five modes);
- channels (our four, `lib/dashboard/fold.ts`): Dine-in `#0F62FE`, Takeaway `#FF832B`, QR self-order `#8A3FFC`,
  Counter `#24A148`;
- the table states on the dashboard's Live tables and the Floor page (`lib/table-status.ts` `TABLE_STATUS_META`, the one
  shared table-state vocabulary): Available = ok (green), Occupied = info (blue, the mock-up's "Eating"), Reserved =
  reserved (purple); our app has only these three states, so the mock-up's "bill printed" and "KOT pending" tiles are not
  added;
- the busy-hours heat map: five steps from `#EDF5FF` to `#0F62FE`.

Checked with the dataviz skill's method (distinct in hue and lightness, readable for the common colour-vision
deficiencies, never colour alone: every series has a legend word).

### 4.4 Type

- **Geist** (already loaded by `lib/fonts.ts` through `next/font`) for everything in the staff app, including the sidebar,
  the dashboard and the login page, which use the Schibsted Grotesk "brand" font today: `--font-brand-sans` points at
  Geist. Fraunces (`--font-brand-display`) is no longer used by the new screens. The build must confirm Geist's `tnum` is
  present (prices line up); `font-variant-numeric: tabular-nums` on numbers, as the mock-up does.
- Sizes (px): page title 24 / 600; section title 17 / 600; card title 15 / 600; body 13.5–14; secondary 12.5–13; captions
  12; uppercase section labels 11 / 600 / 0.06em; big figures 32 (phone) – 40 (desktop) / 600. Inputs stay 16 px below
  `md` (iOS zoom).
- Weights 500 and 600 mostly; 700 rare.

### 4.5 Shape, depth, density

- Radius: controls (buttons, inputs, selects) 8 px; small chips 6 px; cards 12 px; large cards and the lock card 16–20 px;
  dialogs and sheets 16 px; pills 999 px. `--radius` becomes 0.5rem with the derived steps adjusted so `rounded-xl` is
  12 px; the checkbox keeps its small square corner.
- Depth: cards are flat (white, 1 px `--border`, no shadow); popovers, dialogs and sheets use one "pop" shadow
  (`0 24px 60px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.04)`); the selected segment uses a small lift
  (`0 1px 2px rgb(0 0 0 / 0.12)`).
- Heights: desktop controls 36 px (default) / 32 px (small) / 40 px (large); touch pages keep 44 px through the existing
  `pointer-coarse:` classes and the shared constants.
- Motion: as today, only under `motion-safe:` (the mock-up's press-in `scale(.97)` on buttons is kept).

### 4.6 One place for UI constants

A new `apps/cafe/lib/ui/` module holds the new shared constants: the status class map (4.2), the chart and category
palette (4.3), the avatar colours and the PIN pad's key size. `brand-classes.ts` and `printer-classes.ts` stay the homes
of their existing constants (tests pin their literal strings, so they cannot be re-derived from another module), and no
new file redefines one of them; a test holds that the new palette and status classes are defined only in `lib/ui/`.
`printer-classes.ts` is not changed (its colours are pinned and already read the brand tokens).

### 4.7 The kit's look (same exports, props and variant names; new variants only added)

Every colour below is a preset-set token or a tint of one (constraint 6), so on the diner menu the same shapes appear in
the cafe's own colours; "blue", "grey" and "ink" are what those tokens are in the staff app.

- **Button:** `default` solid blue (`--primary`), white text, hover `bg-primary/90`; `outline` white with a 1 px `--border`,
  ink text;
  `secondary` `--muted` fill; `ghost` transparent, hover `--muted`; `destructive` red; `link` blue. Sizes `sm` 32,
  `default` 36, `lg` 40, `icon` 36 square. Focus: 2 px ring in `--ring` with a 2 px offset.
- **Input, Textarea, Select trigger:** white, 1 px `--input` border, 8 px radius, focus border blue plus a soft blue halo.
- **Checkbox, Radio, Switch:** blue when on; the switch's track grey when off.
- **Badge:** a pill. `default` blue tint with blue ink; `secondary` grey; `destructive` red tint with red ink; `outline`.
  The status colours are not badge variants (they are staff-only tokens): they live in the new `StatusPill` (4.8).
- **Card:** white, 1 px border, 12 px radius, no shadow; a header row (title 15/600, a caption line, an optional link
  action on the right such as "All orders →").
- **Tabs:** the mock-up's segmented control: a grey track (`--muted`), the selected segment white with the small lift.
  New `underline` variant for page tabs (the lock screen's "All staff / Admin / Staff").
- **Dialog, AlertDialog, Sheet, Drawer:** 16 px radius (sheets: the inner edge), the pop shadow, a scrim of
  `rgb(17 17 19 / 0.42)`.
- **Dropdown, Popover, Tooltip:** white, 12 px radius, the pop shadow; the tooltip dark (`bg-foreground text-background`: `#18181B` with white-ish text in the staff app).
- **Toast (sonner):** dark as the mock-up (`bg-foreground text-background`); success/error keep their icon colours.
- **Table:** header row 12 px uppercase-free muted labels, 1 px row rules, hover `--muted`.
- **Skeleton:** `--muted` with the existing pulse.
- **Shared states** (`components/shared/EmptyState.tsx`, `ErrorState.tsx`, `PageHeader.tsx`): restyled in place, same props.

### 4.8 New common components

Built once for the screens in this work and documented for later pages (each with a contract test):

- `PinPad` (components/ui): four dots, keys 1–9, Clear, 0, backspace; keyboard digits and Backspace on a PC; an error line
  with a short shake (`motion-safe`); disabled while a check runs.
- `StaffAvatar`: initials on a soft colour chosen from the name (a fixed list of six hues), an optional status dot.
- `StatusDot` and `StatusPill`: the 4.2 vocabulary.
- `SegmentedControl`: the 4.7 tabs look for choices that are not tabs (the dashboard range).

## 5. Staff PIN sign-in and screen lock

### 5.1 How it works, in the owner's words and decisions

- **The first time on a device, a person signs in with their username and password** (owner: "first time id password
  add karo uske bad pin set kiya ho to pin aana chahiye other wise nahi aana chahiye"). The device then remembers that
  person. From then on, on that device, the login page and the lock screen show that person as a name tile, and a tap
  opens their 4-digit PIN pad, but only if an admin has set them a PIN; a person without a PIN is not shown a PIN pad and
  keeps using the username and password. Any device works this way ("PIN wala kahi bhi chal sakta hai"): a counter
  tablet that five staff have each signed in on once shows all five.
- A signed-in device locks itself after a time with no activity (default 1 hour, owner: "10 min me close nahi hona
  chahiye, traffic me issue kar sakta hai"), or when someone taps "Lock screen" / "Switch user". The lock screen shows the
  same remembered people and PIN pad; whoever enters their PIN continues, as themselves.
- **The sign-in lasts at least 90 days** (owner: "session lamba rakhna hai minimum 90 din tak khatam nahi hona chahiye,
  proper smooth user experience"): `SESSION_MAX_AGE_SECONDS` becomes 90 days, and it keeps rolling as today (the
  30-minute keepalive re-issues the session), so a device in use never signs out by itself; only 90 days without opening
  the app ends it.
- The PIN is stored as a plain string so the owner or an admin can read it to a staff member who forgot it (owner's
  explicit decision; the risk was explained: anyone with the database or a backup can read every PIN).
- Wrong PINs are limited per selected person only (owner: "user select kare uske base rate limit"; and no network-based
  rule of any kind: "network aesa khuch nahi rakhna hai, wo kabhi bandh ho gaya to issue karega"). A device that has
  never had that person sign in with a password cannot try their PIN at all, so nobody outside the cafe's own devices can
  guess a PIN or run up a person's wrong-PIN count.

### 5.2 Data

`Staff` gains:

- `pin: string` (optional; `select: false`; exactly 4 digits when present);
- `pinFailDay: string` and `pinFailCount: number` (the cafe-day of the last wrong PIN and how many that day);
- `pinBlocked: boolean` (default false).

Staff created before this release have no PIN until an admin sets one; they keep signing in with their username and
password. `Settings` gains `screenLockMinutes` with the values 0 (off), 30, 60, 120; absent means 60. The client `Staff`
type gains `hasPin: boolean` and `pinBlocked: boolean` (never the PIN itself).

**The device's memory** of who signed in on it: an httpOnly, `Secure` (except on `http://localhost`), `SameSite=Lax`
cookie `pos-pin-device`, signed (HMAC-SHA256) with the app's `AUTH_SECRET`, holding the staff ids that signed in on this
device with a username and password (at most 30, newest first) and when. It lives 400 days (the browser's cap) and is
re-issued on every sign-in, so it never runs out on a device in use. The page cannot read or forge it; the server
checks its signature on every use. Clearing the browser's or the app's data forgets it (the next sign-in there is
username and password again). A person is dropped from it when the server finds them inactive or deleted.

### 5.3 The login page (`/login`, every device)

- **A device that remembers nobody with a PIN** (a new device, a cleared app, or nobody it knows has a PIN yet) opens
  straight on the username and password form, in the new look.
- **A device that remembers people with a PIN** shows the mock-up's picker: the cafe's logo and name top-left and the time
  top-right on a soft background; a white card with "Good evening/morning/afternoon", "Select your name to sign in ·
  Friday, 16 October", and name tiles of the remembered people who have a PIN (avatar initials, "Priya S." = first name
  and the last name's initial, the role underneath). The search field and the underline tabs "All staff N / Admin N /
  Staff N" appear only when there are more than 8 tiles (my call: a counter usually knows a handful). Tiles: 142 × 168 px
  desktop, 132 × 160 tablet, 120 × 150 phone (3 per row at 390 px).
- Tapping a tile opens the PIN pad for that person ("← All staff", the avatar, the full name, "Admin · Enter your 4-digit
  PIN", the dots, the keys, "Forgot PIN?"). The fourth digit submits. "Forgot PIN?" shows "Ask an admin to tell you or
  reset your PIN."
- Errors: "Incorrect PIN · 3 tries left" (the dots turn red, a short shake); "Too many wrong PINs. Try again in 9 min."
  (the pad disabled with the time counting down); "This PIN is blocked after too many wrong tries. Ask an admin to unblock
  it."
- Below the tiles: "Sign in with username and password" (someone new on this device) opens today's form (the same
  fields, labels, ids, reveal button, `method="post"` form and `signIn("credentials")` call, restyled into the new card);
  from the form, "Sign in with PIN" goes back to the tiles when there are any. "Powered by Sandbee POS" stays.
- After a successful username and password sign-in the page calls `POST /api/sign-in/remember` once (it needs the new
  session; it adds the session's person to the device's cookie) before it navigates on, exactly as today.
- The painting, postmark and stamp frame of today's login (`components/brand/PointillistScene.tsx`, `Postmark.tsx`,
  `StampFrame.tsx`, `BrandCard.tsx`, `VendorMark.tsx`, and `AuthShell.tsx`'s current look) are replaced by this look; files
  no longer imported are removed.
- The tiles come from a new route `GET /api/sign-in/known` (outside `/api/auth`, which Auth.js owns): it needs no
  session but does the tenant check the middleware does not do for `/api` (as `app/api/public/diner/login/route.ts`
  does), verifies the device cookie, and returns `{ id, short name, role, initials, hue }` only for the people in that
  cookie who are active and have a PIN (no cookie or a bad signature: an empty list). Nobody can list the cafe's staff
  without having signed in on that device. One Mongo read by ids, no cache needed.

### 5.4 PIN sign-in on the server

- A second Auth.js Credentials provider, `id: "pin"`, credentials `{ staffId, pin }`, in `lib/auth.ts` (with its edge
  stub in `auth.config.ts`). `authorize(credentials, request)`:
  1. shape check (`staffId` a valid id, `pin` 4 digits), else "wrong";
  2. **the device check:** the request's `pos-pin-device` cookie must carry a valid signature and `staffId`; otherwise
     the answer is "device" ("Sign in with your username and password on this device first.") and nothing is counted;
  3. the per-person bucket is **peeked** (`lib/public-rate-limit.ts` `peekRateLimit`); a full bucket answers "wait" with
     the seconds left;
  4. the staff document (active, `+pin +pinBlocked`); inactive, missing or without a PIN answers "nopin" ("Sign in with
     your username and password."); `pinBlocked` answers "blocked";
  5. a constant-time comparison (`crypto.timingSafeEqual`);
  6. wrong: the bucket is **hit** (`hitRateLimit`), `pinFailCount` for the cafe-day is incremented atomically, and at 20
     that day `pinBlocked` is set; the answer is "wrong" with the tries left in the person's window;
  7. right: returns `{ id, name, role }` exactly as the password provider does; the session and its 60 s re-validation
     work as today, and the device cookie is re-issued (its time refreshed).
- Rate limits, per selected person only (no network rule of any kind, owner): the existing 10-minute fixed windows, 5
  wrong per window (`staffpin:<id>`); 20 wrong in a cafe-day blocks the PIN until an admin unblocks it or sets a new one.
  Only wrong PINs count, so a busy hour of switching people is never slowed. Because step 2 refuses any device the person
  has not signed in on with a password, only the cafe's own devices can add to these counts.
- The answers reach the page as Auth.js `CredentialsSignin` codes: `wrong:<tries left>`, `wait:<seconds>`, `blocked`,
  `device`, `nopin`.
- PIN rules (`packages/shared/src/staff-pin.ts`): exactly 4 digits; the diner list of easy PINs is refused when an admin
  sets one (0000, 1111 … 9999, 1234, 4321, 0123, 1122, 2580, 1212): "Too easy to guess. Pick another PIN." Two staff may
  share a PIN (the name is chosen first).

### 5.5 Staff page and API (admin only)

- Add staff: a "PIN (4 digits)" field, required. Edit staff: "PIN" shows `••••` with a "Show" button (one request,
  `GET /api/staff/[id]/pin`, admin only, never cached) and a field to set a new one. A blocked PIN shows a "PIN blocked"
  badge on the row and an "Unblock PIN" action; setting a new PIN also unblocks it.
- The list, create, update and every other staff response never include `pin`; they include `hasPin` and `pinBlocked`.
- Username and password stay required for new staff (they are the fallback sign-in and "Change password" keeps working).
- Copy and labels already pinned ("Edit staff", "Reset password", "Deactivate staff", "Reactivate staff", the column
  names) stay; new ones are added.

### 5.6 The screen lock (signed in, inside the dashboard layout)

- **A cover, not a sign-out.** Signing out unmounts the dashboard layout, and with it the print host, the pulse, the
  alarm and the order-request alerts. So the lock is a full-screen cover rendered by the dashboard layout above
  everything (portals included). The page under it keeps running: printing, the alarm sound, new order requests and the
  realtime updates go on. Everything else on the page is made `inert` while locked, so no tap or key reaches it.
- **The lock screen** is the login page's picker in the same look (the device's remembered people with a PIN), with the
  person who locked it first in the list and marked "Locked · 3 min ago". Whoever enters a correct PIN continues:
  - the same person: the cover closes, the page is exactly as it was;
  - someone else: `signIn("pin", { redirect: false })` switches the session without a reload (Auth.js updates
    `useSession` everywhere), the cover closes, the page stays; if the page is admin-only and the new person is not an
    admin, the app goes to the Dashboard; admin-only cached data is dropped from the query cache (the staff list, report
    and multi-day dashboard queries) so the next person never sees it; a toast says "Signed in as Rohan".
  - The POS cart is not tied to a person today and stays as it is; orders are stamped with whoever sends them.
- **People without a PIN, and release day:** the lock screen carries the same "Sign in with username and password" link
  as the login page and a "Sign out" link. The password sign-in there runs in place (`signIn("credentials",
  { redirect: false })`, then `POST /api/sign-in/remember`), so it switches or confirms the person exactly like a PIN
  does and printing goes on. If the person who locked has no PIN, or is not yet remembered by this device (a session
  from before this release), the lock screen opens on the password form under the line "Signed in as <name>" (the
  session carries no username, so the field is not pre-filled; planning finding); if the device
  remembers nobody with a PIN, it opens on the password form. So the 1-hour default is safe on the day this ships,
  before any admin has set a PIN.
- **No internet at unlock:** the PIN can only be checked by the server. If it cannot be reached, the pad says "No
  internet. The PIN can't be checked right now. Printing goes on." and the person tries again; nothing is cached on the
  device to allow an offline unlock (a copy of a 4-digit PIN on the device can be guessed by anyone who has the device's
  developer tools, and then used on any other device). Offline billing, which comes after the redesign, revisits this.
- **Locking:**
  - "Lock screen" and "Switch user" in the account menu (sidebar bottom). "Switch user" opens the list without marking a
    person as the locker.
  - Automatically after `screenLockMinutes` with no tap, click or key on the device (measured by the clock, so a hidden
    Android or Windows app that comes back after the time opens locked). Any activity restarts the time.
  - Never automatically on `/kitchen` and `/now-serving` (wall displays nobody touches; their code already treats them so).
- **Survives a reload:** the lock state (locked, by whom, since when) is kept in `localStorage` (`pos.lock.v1`) and a tiny
  constant inline script (the `DINER_THEME_SCRIPT` pattern: a plain `<script>` child, no `dangerouslySetInnerHTML`) sets a
  `data-pos-locked` attribute on `<html>` before the first paint, so a locked page never flashes its content.
- **Its limit (told to the owner):** someone who knows a browser's developer tools could remove the cover on a PC; the
  real record is that every order carries the name of the person signed in. This lock stops casual use of an unattended
  screen, which is what was asked.
- **Settings → Business details** gains a "Screen lock" group: "Lock the screen after no activity for" Off / 30 minutes /
  1 hour / 2 hours (admin only, the existing settings save).
- **Sign out** stays in the account menu and works as today.

### 5.7 Docs, seeds and the go-live note

- `docs/GO-LIVE-CHECKLIST.md` §6 "Staff accounts" and a new release note: after this release, an admin sets a PIN for
  each staff member on the Staff page; each person signs in once on each device with their username and password, and
  from then on by tapping their name and entering the PIN there; the sign-in lasts 90 days of not using the app (it
  rolls while in use). Every doc line that says the sign-in lasts 30 days is updated, with its runbook pins.
- `scripts/seed-admin.ts` accepts an optional `SEED_ADMIN_PIN`; the demo seeder gives its demo staff PINs.

## 6. The app shell's look (sidebar, top bar, alert bar)

- **Sidebar (desktop and the phone sheet):** dark (`--sidebar`), the widths unchanged. Top: the cafe's logo tile and name
  (white, 15/600) with "POS Software" below in `--sidebar-muted` (today's words). Section headings in small uppercase
  (`SERVICE`, `MANAGE`, `ADMIN`: today's words, uppercase by CSS). Rows 38 px on a mouse, 44 px on touch: icon 20 px,
  label 13.5/500 in `--sidebar-foreground`; hover `--sidebar-accent` with white text; the active row `--sidebar-accent`,
  white text, 600, and a 3 px blue bar on its left edge. The expanding groups (Menu, Tables, Reports, Settings) keep their
  behaviour with the same look one step indented. The Order Requests count stays a red pill (it is an alert). In the
  collapsed 3rem rail: icons only, as today, with the dark tooltip.
- **Account (sidebar bottom):** the avatar (initials, a green dot) with the name and "Admin" / "Staff"; its menu (the
  mock-up's): the name and "Administrator · signed in at 8:00 PM", then "Lock screen" ("Your open orders stay as they
  are"), "Switch user" ("Lock and let a teammate sign in"), "Change password", "Sign out", and a last line "Locks after
  1 hour without activity" (or "Screen lock is off").
- **Top bar:** white, 1 px bottom border, 56 px (today's 3.5rem). The same contents and labels: the sidebar toggle, the
  "New Order" / "Tables" quick tabs (the active one on the blue tint), the Refresh button, the printer button (an outline
  square button with its dot). The printer panel and every printing control keep their behaviour; only the kit and
  token look reaches them.
- **Request alert bar:** the warn tint and ink instead of today's yellow; the same words and buttons.

## 7. The dashboard (`/`)

The page keeps every card, figure, word, request and link it has today; the arrangement follows the mock-up:

1. **Head:** "Dashboard" (24/600) and "Cafe name · Friday, 16 October 2026"; the End of day button on the right.
2. **Needs attention:** a row of chips (today's items and words), each a white pill with its status dot and, where the item
   has an action today, a small grey action pill; wraps on a tablet; on a phone it folds into one summary row ("4 · Needs
   attention") that opens the list (the mock-up's phone look).
3. **Period:** the period name and caption on the left, the range as a `SegmentedControl` on the right (Today, Yesterday,
   7 days, 30 days, Custom; multi-day for admins only, as today).
4. **Hero row:** a dark card (`--ink`, white text) with Net sales big, its change pill, and Orders / Average order /
   Collected with their changes below a thin rule (today's KPI row, merged); beside it the **Bill breakdown** card (today's
   `MoneyBreakdownCard` figures) drawn as a receipt: dotted leaders, a zig-zag lower edge. On a phone they stack.
5. **Sales by hour** (today's chart, the 4.3 palette) beside **Live tables** (today's live floor panel: the use bar, the
   legend, the tiles per area with the 4.2 status colours).
6. **Recent orders** beside **Today's reservations**.
7. **Payment mix** ("How guests paid") beside **Channels** ("Where orders came from"): today's titles stay; the mock-up's
   titles are not adopted unless the owner says so.
8. **Best sellers**, **Slow items**, **Categories**, **Money leaks**, **Busy hours** (the heat map in the 4.3 blue steps).

Columns: desktop 1280 two columns (2/3 + 1/3 where the mock-up does it), tablet 1024 and 820 one or two columns as the
mock-up's tablet renders, phone one column. The shared `MoneyBreakdownCard` and `EndOfDayButton` are also used by the
reports pages: the dashboard's receipt look is a dashboard-only wrapper or variant, so the reports pages only take the
token look.

## 8. Verification

- Every suite: shared; the cafe chain, typecheck and lint; mobile and desktop untouched (their suites still run once).
- Tests first for every new rule: the PIN shape and easy list, the rate-limit decisions, the device cookie (signs,
  verifies, refuses a forged or tampered one, caps at 30, newest first), the pin provider's answers including "device"
  for a device that never signed in that person (a live leg against a `pos_scratch_*` database), the staff API never
  returning `pin`, the known-people route's fields and its empty answer without a cookie, the 90-day session, the lock
  state, the idle clock, the display-page exemption, the settings value, the kit's new variants and the rule that kit files
  use only preset-set colour tokens, the common components.
- A production build in a build worktree (webpack cache off).
- Before/after first-screen shots of every page (`tools\baseline.mjs`, `FOLD=1`, the demo database
  `pos_scratch_e2e_4g_uibase`): each page keeps its content, layout and words; only the look changes (except `/login`
  and `/`, which change on purpose).
- The paper: the printed bytes of each slip kind (bill, KOT, token, test slip) from the base and from the new build are
  identical; the S1 43-file pin and `print-budget.test.ts` unchanged.
- The Android emulator (WebView 109): the login PIN pad, the lock screen and unlock, a user switch while a slip prints,
  `/pos`, `/orders`, the printer panel, the dashboard.
- Accessibility on the local page (a11y skill): contrast, focus rings, 44 px targets, the lock cover's focus.
- No new recurring request (a request log of an idle signed-in page, before and after).
- The owner's check: the new build served at `http://localhost:3110` on the demo database, with demo PINs set, left
  running for the owner; then the fresh review and the owner's merge OK.

## 9. Left to the builder

- Exact pixel values the mock-up shows but this spec does not list (take them from `design\unpacked\markup.html`).
- File names of new modules, the query keys dropped on a user switch (all admin-only ones), test file names.
- Tile, pad and card sizes between the listed breakpoints.

## 10. Calls I made (the owner may change them)

- The input border is darker than the mock-up (`#8B8B93`) for the 3:1 field-edge rule.
- The cafe's own logo and name instead of the mock-up's Shrikhand wordmark.
- The Order Requests count stays red.
- The login list shows "Priya S." and the role; people without a PIN are not shown as tiles; search and role tabs only
  above 8 tiles; a device remembers at most 30 people.
- The device's memory is a signed httpOnly cookie (400 days, re-issued at each sign-in), not page storage, so the page
  cannot be made to try someone else's PIN.
- Username and password stay required for new staff; staff cannot change their own PIN (admins set it).
- "Switch user" and "Lock screen" both exist, as in the mock-up; no keyboard shortcut (Ctrl+L is the browser's address bar).
- The dashboard keeps its own card titles (for example "Payment mix"), not the mock-up's.
- The screen-lock option lives under Settings → Business details.
- The lock screen offers the username/password sign-in and Sign out; it opens on the password form when the locker or
  the whole cafe has no PIN.
- No offline unlock (the PIN is never kept on the device); a clear "No internet" line instead.
- The dashboard's own cards get the category colours now; the reports pages only the token look until their session.
