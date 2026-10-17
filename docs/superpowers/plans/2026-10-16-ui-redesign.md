# Cafe app UI redesign, page by page (plan)

> **For agentic workers:** one page per session. Read this whole file, the owner's design for that page, and the page's
> row below before touching code. Steps use checkbox (`- [ ]`) syntax for tracking.

**The owner's decision (2026-10-16):** the next work is a redesign of the whole cafe app's **UI only**. The owner gives
the new UI of one page at a time; each page is its own phase and its own session ("one session me multiple page karenge
to, wo bigad sakta hai"), so every page is implemented exactly and nothing else moves. After the redesign come **offline
printing** and **multiple-printer printing**, each with its own spec and phases (see "After the redesign").

**Goal:** every page looks like the owner's new design, while everything it does stays exactly as today: the same data,
the same requests, the same words where the design keeps them, the same printing, the same paper.

**Base:** `main` `4388752` (printing Phase 4 merged). Branch `feat/ui-redesign`; each page lands on it test first, is
reviewed, and is merged into `main` only with the owner's OK, one phase (U0, or one page) per merge (the owner's decision,
below): each then ships, or waits, on its own.

## The owner's decisions (2026-10-16, later)

- **The common look comes first (U0):** "poore app ka common look base karna hai, proper new theme so proper reusable":
  a proper new theme, and every reusable piece (components, patterns, styles, UI constants) managed in one common place,
  so the code base stays clean and clear. The owner gives U0's design (what changes where) in U0's own session prompt.
- **Then the pages, one per session, each merged once it is properly done** ("merge me one page jitna proper implement ho
  utna karte jana hai"). Nothing starts before the owner gives that phase's design.
- **Proposed U0 split** (the U0 session confirms it with the owner): **U0-A** the theme (tokens, fonts, the cafe's
  appearance presets on the new tokens, the chart palette), the UI kit and the common components; **U0-B** the app shell
  (sidebar, header, the printer button and panel), its own phase because it holds 28 own UI files, 13 pins and the
  printing controls.
- **The kit keeps its API in U0:** every `components/ui/*` and `components/shared/*` export, prop and variant name stays
  (new variants are added, none renamed or removed), so U0 changes no page file; each page adopts the new common
  components in its own session. A U0 merge alone changes the look of every page at once (colours, type, controls) while
  each page's layout stays until its own session.
- 31 test files pin class names (for example `h-11`, `bg-brand-…`, `rounded-…`): U0 changes such a pin only on purpose, in
  the same commit, with the reason.

## How this runs

- **U0, the foundation:** the design tokens (colours, radii,
  shadows, spacing) in `apps/cafe/app/globals.css`, the fonts (`apps/cafe/lib/fonts.ts`), the UI kit
  (`apps/cafe/components/ui/*`, shadcn), and the app shell (`app/(dashboard)/layout.tsx`: `components/layout/*`, the
  header, the sidebar, `components/shared/PageHeader.tsx`, `EmptyState`, `ErrorState`). These reach every page (see "UI
  files most pages share"), so a change to them is done once, on its own, before the pages; never inside a page's session.
- **U1 … Un, one page each, in the owner's order.** The owner gives the page's new UI as local files (screenshots, an
  HTML/CSS mock-up, or written notes; no design-tool connector is used). The session changes only that page's own UI
  files (its row's "own" list); a shared file it would need to change is either left alone (a page-local variant) or
  stopped and raised with the owner as a foundation change.
- **Each session:** read → baseline → tests first where words or structure are pinned → the UI → verify → a fresh review
  → the Results under "Results" below → the owner's OK → merge. The next page starts only after that.

## Global constraints (each one is held by a test or a check)

1. **UI only.** No change to `apps/cafe/app/api`, `apps/cafe/models`, `workers`, `packages` (in U0 only
   `packages/shared/src/appearance*.ts`, the cafe's theme presets, and only as the owner's design says), the data a page reads or
   writes, its requests, its route, who may open it (`ADMIN_ROUTES`, the staff/admin rules), or any `lib`/`hooks` logic.
   Words the design changes are changed where they are defined (the page's own constants), with their tests.
2. **Free tier, ₹0 forever:** no new request of any kind (no polling, no prefetch, no new query observer that refetches);
   `packages/shared/src/print-budget.test.ts` unchanged.
3. **The paper never changes.** The 43 files of the S1 pin ("PIN (S1): the picture's files are byte for byte as at the
   spec commit d21ee37" in `apps/cafe/lib/printer/kot-text/text-kot-print.test.ts`) stay byte for byte: the slips
   (`components/print/slip/*`, `components/pos/KOTReceipt.tsx`, `OrderReceipt.tsx`, `PrintSources.tsx`, `PrintBanner.tsx`),
   the raster and print code, and the apps' printing code. A slip preview inside a settings page is paper, not page UI.
4. **Printing behaves exactly as today.** The printer panel, the waiting slips, the alarm, the print-host band, Fast text
   KOTs, Find network printers and every print path are restyled at most: no state, word or button is removed or merged
   unless the owner's design says so, and then the pin that holds it changes in the same commit with the reason.
5. **WebView 109.** Older Android tablets run the POS in Chromium 109: the CSS pipeline (`apps/cafe/postcss.config.mjs`:
   RGB fallbacks for the OKLCH tokens, `color-mix()` and alpha tints) and `apps/cafe/lib/css-compat.test.ts` stay. No CSS
   that Chromium 109 cannot paint without a fallback (for example `light-dark()`, `@starting-style`, `subgrid`, `@scope`,
   anchor positioning, the popover API, `field-sizing`, view transitions); hand-written CSS nesting only through Tailwind.
   Tablet pages are checked on the emulator (WebView 109).
6. **The cafe's own theme.** The six appearance presets and the accent colour (Settings → Appearance,
   `packages/shared/src/appearance.ts`) keep working: colours come from the tokens (`:root` / `.dark` and `@theme inline`
   in `globals.css`, OKLCH with the RGB fallbacks), never a hard-coded colour that ignores the cafe's theme, unless the
   owner's design replaces the theme model (a U0 decision). The presets set the colour tokens at run time
   (`packages/shared/src/appearance.ts`: `--primary`, `--background` … and their `-rgb` twins for WebView 109), so a new
   theme keeps those names working (a new token is set by the presets too, or derived), and `appearance-contrast` keeps
   every preset readable.
7. **Touch and sizes.** Controls at least 44 px tall on touch pages (`PRINTER_ACTION_CLASS` is `h-11`); a phone at 390 px
   wide with no sideways scroll, a tablet, and a desktop at 1280 px.
8. **Names the tests and the device scripts use** (button labels, `aria-label`s such as "Refresh", "Toggle Sidebar",
   "Printer …", "Open tabs (…)", form labels) keep their text unless the design changes it on purpose.
9. **Fonts** come through `next/font` (built into the app at build time): no font, icon set or image fetched at run time
   from another site.
10. **As always:** local only (no connector, upload or deploy), branch and the owner's merge OK, a push only on the owner's
    word with the token store; every new cafe test file goes into `apps/cafe/package.json`'s `testChain`; every new
    assertion carries a message.

## One page's session (the checklist)

- [ ] `df -h /c /d`; the `.bin` check (`tsc eslint next tsx` = 4); the branch is `feat/ui-redesign` at the last merge.
- [ ] Read the owner's design for the page, this plan, and the page's row and inventory entry
      (`D:\kd\pos-dev-keep\ui-redesign\inventory\inventory.md`: own UI files, shared files, the tests that name them).
- [ ] Baseline: the page's screenshots from `D:\kd\pos-dev-keep\ui-redesign\baseline\` (phone and desktop, full page and
      first screen), or new ones of the current build with `tools\baseline.mjs` (the demo database
      `pos_scratch_e2e_4g_uibase`).
- [ ] Tests first: where a test pins a word, a label or a structure the design changes, change the test (RED), then the
      UI (GREEN); new structure the design adds that matters (a state, a label) gets its own test.
- [ ] Implement only the page's own UI files; stop and ask before touching a shared one.
- [ ] Verify: the cafe chain, typecheck and lint (and shared, mobile or desktop if a file of theirs moved); a production
      build in a build worktree (webpack cache off); the page's new screenshots (phone, desktop; each appearance preset
      and dark mode on the page); every other page's first-screen shot unchanged; the emulator (WebView 109) for a page
      used on tablets (`/pos`, `/orders`, `/kitchen`, `/tables`, `/now-serving`, the printer panel).
- [ ] A fresh review (Claude Fable 5.1, read-only); rulings; the page's Results below; then the owner's OK.

## The pages (41) and their layouts

From the inventory of `main` `4388752` (`D:\kd\pos-dev-keep\ui-redesign\tools\inventory.mjs`): "own" = UI files only this
page reaches; "shared" = UI files other pages reach too; "pins" = test files that name this page's own UI files (any = all
the UI files it reaches). Risk: **printing** (the page shows or drives printing, or its tests are print tests), **large**
(10 or more own files), **diner-facing** (the public menu a customer opens), **normal**.

| Page | Own | Shared | Pins (own) | Pins (any) | Risk |
|---|---|---|---|---|---|
| the app shell (`app/(dashboard)/layout.tsx`: header, sidebar, printer button and panel, token sheet, request bar) | 28 | 76 | 13 | 54 | printing |
| the root (`app/layout.tsx`, `globals.css`, providers, toasts) | 5 | 0 | 2 | 2 | normal (U0) |
| `/login` | 7 | 4 | 0 | 3 | normal |
| `/` (dashboard) | 12 | 63 | 4 | 47 | printing |
| `/pos` | 26 | 61 | 12 | 51 | printing |
| `/orders` | 4 | 64 | 1 | 45 | printing |
| `/kitchen` | 4 | 11 | 4 | 5 | printing |
| `/now-serving` | 4 | 8 | 1 | 2 | normal |
| `/requests` | 5 | 47 | 4 | 39 | printing |
| `/tables` | 7 | 9 | 0 | 2 | normal |
| `/tables/setup` | 8 | 16 | 1 | 6 | normal |
| `/tables/qr` | 2 | 9 | 1 | 5 | printing |
| `/products` | 21 | 23 | 2 | 5 | printing |
| `/categories` | 4 | 16 | 1 | 5 | printing |
| `/customers` | 11 | 20 | 1 | 5 | large |
| `/customers/festival-cards` | 6 | 31 | 1 | 10 | normal |
| `/events` | 4 | 22 | 0 | 6 | normal |
| `/reservations` | 4 | 22 | 0 | 6 | normal |
| `/expenses` | 11 | 20 | 2 | 6 | large |
| `/expenses/categories` | 3 | 11 | 0 | 5 | normal |
| `/staff` | 5 | 19 | 0 | 6 | normal |
| `/printers` (Printer setup) | 11 | 55 | 3 | 33 | printing |
| reports layout (`app/(dashboard)/reports/layout.tsx`) | 1 | 3 | 0 | 2 | normal |
| `/reports/sales` | 1 | 17 | 0 | 4 | normal |
| `/reports/items` | 3 | 17 | 0 | 4 | normal |
| `/reports/order-types` | 3 | 18 | 0 | 4 | normal |
| `/reports/payments` | 1 | 17 | 0 | 4 | normal |
| `/reports/gst` | 1 | 15 | 0 | 2 | normal |
| `/reports/dues` | 1 | 18 | 0 | 5 | normal |
| `/reports/expenses` | 3 | 13 | 0 | 2 | normal |
| `/reports/cancels` | 3 | 16 | 0 | 4 | normal |
| settings layout (`app/(dashboard)/settings/layout.tsx`) | 1 | 3 | 0 | 3 | normal |
| `/settings` | 2 | 2 | 1 | 3 | printing |
| `/settings/business` | 6 | 21 | 0 | 8 | normal |
| `/settings/taxes` | 4 | 17 | 2 | 8 | printing |
| `/settings/appearance` | 9 | 25 | 2 | 10 | normal (themes: constraint 6) |
| `/settings/bill-print` | 9 | 55 | 1 | 32 | printing (slip previews are paper) |
| `/settings/kitchen-ticket` | 8 | 55 | 2 | 33 | printing (slip previews are paper) |
| `/settings/tokens` | 5 | 54 | 4 | 27 | printing |
| `/settings/qr-ordering` | 4 | 19 | 0 | 8 | normal |
| `/settings/loyalty` | 12 | 28 | 4 | 9 | large |
| notifications layout and `/settings/notifications` | 1 + 4 | 0 + 20 | 0 | 6 | normal |
| public menu layout (`app/m/layout.tsx`) | 1 | 0 | 0 | 0 | diner-facing |
| `/m` and `/m/[token]` (the diner's menu) | 1 | 86 | 1 | 27 | diner-facing |
| `/m/o/[shortCode]` (the diner's order status) | 8 | 10 | 2 | 7 | diner-facing |

UI files most pages share (a change to one touches most pages; U0 only): `components/ui/button.tsx` (41 pages),
`components/ui/skeleton.tsx` (33), `components/ui/input.tsx`, `components/ui/label.tsx`, `components/brand/brand-classes.ts`,
`components/shared/EmptyState.tsx` (29 each), `components/shared/PageHeader.tsx` (26), `components/shared/ErrorState.tsx`
(25), `components/ui/alert-dialog.tsx` and `components/ui/sheet.tsx` (24 each).

Not in this plan unless the owner adds them: `apps/hub` (the owner's own control plane, not a cafe's app), the Android
app's native screens (the start screen, the update card, the battery checklist) and the Windows app's address window.

## Baseline (local, 2026-10-16)

Screenshots of every page of `main` `4388752`'s code (the build worktree `D:\kd\p4b-new`), signed in as the admin of a
demo database seeded by the repo's own demo seeder (`pos_scratch_e2e_4g_uibase`: 31 days, 869 orders, 105 products, 40
customers, no photos uploaded), at 390 × 844 and 1280 × 800, full page and first screen:
`D:\kd\pos-dev-keep\ui-redesign\baseline\` (and `baseline-fold\`), with `baseline-log.txt` (each page's status and console
errors). `/m/[token]` and `/m/o/[shortCode]` need a live table token or order code (mint a QR token on Tables → QR codes
in the demo database at that page's session); `/m` uses the same diner shell. Tools:
`D:\kd\pos-dev-keep\ui-redesign\tools\` (`inventory.mjs`, `baseline.mjs`).

## After the redesign

- **Offline printing** (the main spec's "Later: offline billing"): its own brainstorming with the owner, spec and phases.
- **Multiple-printer printing:** printing Phase 2 already prints by station on several printers (a device can drive
  several printers; a printer can take a full copy). What the owner needs beyond that is asked at its brainstorming first.

## Results

(Each page's session appends "### U<n>: <page>" here: commits, counts, RED/GREEN, screenshots, the review, the owner's OK.)

### U0: the theme, the kit, the staff PIN sign-in and screen lock, the sidebar, the top bar and the dashboard (2026-10-16 → 17)

**The owner's design and decisions.** The mock-up "Olivea POS (latest).html" (a copy and its unpacked markup:
`D:\kd\pos-dev-keep\ui-redesign\design\`), taken as a reference, not copied: every feature stays, only the UI changes, on
phone, tablet and PC. First the PIN lock, then the dashboard and the sidebar. Decided with the owner: the PIN sign-in is
name tiles plus a 4-digit PIN (option B), the PIN kept as a plain string so an admin can read it back to a client who
forgot it; rate limits per selected person only, no network rule; the PIN works on any device; the first sign-in on a
device is by password, then the tile shows if a PIN is set; the session lasts at least 90 days; the auto-lock is 1 hour;
the new colours app-wide (A), light only for now; the top bar keeps its contents (A); the diner menu takes the new shapes
in the cafe's own colours (B); the phone tab bar comes later with the /pos session. Spec
`docs/superpowers/specs/2026-10-16-ui-theme-pin-lock-design.md` (`5ee556e`, approved), plan
`docs/superpowers/plans/2026-10-16-ui-theme-pin-lock.md` (`fd31659`), executed subagent-driven (20 tasks, a task review
each, a whole-branch review, one final fix wave with its re-review).

**Commits** `4388752..8fa3f0b` on `feat/ui-redesign` (50 commits, 155 files, +9197/−1869): the tokens (`cb134d9`), Geist
fonts (`d95785b`), the `lib/ui` constants (`cf62ef8`), the kit's controls (`b7b62fa`) and surfaces (`d35f733`,
`8e4c63c`), PinPad / StaffAvatar / StatusPill / SegmentedControl (`7f56167`, `d1b7468`), the shared PIN rules and the
90-day session (`0862af4`), the Staff PIN fields and API (`2531ef9`), the device memory (`c4bb45c`), the PIN check with
its rate limit (`3ff8662`, `3bf977a`), the `pin` provider and the sign-in routes (`0a4d68f`, `4400ef0`, `4f45be5`), the
login page (`9d176a0`), the Staff page's PIN UI and the screen-lock setting (`8408c22`), the lock rules (`d5b8619`), the
lock cover (`743ecf2`, `342af44`, `91e88e0`, `0cb5c23`), the dark sidebar (`0d5a396`), the top bar (`fe37db5`,
`aae87ed`), the dashboard (`74b55a9`, `30b0840`, `70f257e`), docs and demo PINs (`d8b3a5c`), the verification fixes
(`b9ea814`: the sidebar fits a 768 px laptop, the hero stacks until xl; `a607e4d`: Badge contrast), the final fix wave
(`71b2b8c` the "Show" PIN guard; `01cc6b8` + `945120a` SegmentedControl 44 px on touch; `f3b0d98` cards 12 px and
dialogs 16 px; `783b047` + `945120a` red PIN dots after a wrong answer; `2e1292b` + `8fa3f0b` white dialogs and sheets;
`c9baff2` the hero's pill tokens; `64d6a95` the seed-admin note; `2cc4694` the 6 s known-people timeout; `ff1cadd`),
`83c4d69` reverted by `9ad2947` (below), and `78d644e` (comments).

**Tests.** The cafe chain 6229 pass, 0 fail, 1 skipped (base 6098 pass, 1 skipped at `fd31659`); shared 1015/1015;
mobile 173; desktop 224; print-tools 11; release-native 12 (those five at `d8b3a5c`; nothing of theirs changed after).
Live legs on local scratch databases: staff-pin 36/0, bootstrap 35/0, dashboard 171/0, print 473/0, appearance 14/0.
Typecheck clean; lint 0 errors (the 2 baseline warnings).

**Verification (local only).**
- Production build in the build worktree `D:\kd\uib` (webpack cache off) at `8fa3f0b`: 150 routes, `.next` 26 MB, the
  same pre-existing jose Edge-runtime warning as before.
- Before/after first-screen shots of every page: `D:\kd\pos-dev-keep\ui-redesign\baseline-fold\` (main) →
  `after-fold-ff1cadd\` (76 shots, all 200; the last three commits change no first screen), console errors identical to
  the base (the pre-existing 404 on `/m` and desktop `/settings/appearance`). Text dump base vs new: only the expected
  changes (times, "NEEDS ATTENTION" by CSS uppercase, "Net sales · Today", the Screen lock settings group, the Staff
  "No PIN" pills).
- The paper: the S1 43-file pin and `print-budget.test.ts` unchanged; no slip, printer, worker or appearance file
  touched; slip previews base vs new: 405 computed differences, all border colours on borders that are not drawn (the 31
  drawn borders unchanged). `models` changed only for the PIN fields and `screenLockMinutes` (spec 3.1);
  `packages/shared/src/public-diner.ts` only in a comment.
- Requests: an idle signed-in dashboard over 240 s sends exactly the base's requests, open and locked.
- Laptop fit: the sidebar fits 1366 × 768 and 1280 × 800 as the base does (rows back to 32 px on a mouse, R20).
- PIN and lock flows at 390 / 820 / 1024 / 1280 with 0 console errors (`pin-shots-final\`); Geist tabular figures equal
  widths. (The shots' wrong PIN "1111" is on the easy-PIN list, so it is refused before counting: "Incorrect PIN", no try
  used, by design; the counting is the live leg's.)
- Emulator: this AVD's WebView had auto-updated to 154 (2026-10-09); it was switched back to the factory 109 for the
  checks and put back to 154 afterwards. On WebView 109: new-device login = the password form; lock → wrong PIN →
  right PIN; "Switch user" while a (15 s delayed) test slip printed → it printed once; a cart built as Admin survived a
  switch and its Send was stamped with the new person (receiver and staffId), its KOT printed once; lock → force-stop →
  reopen showed the cover with no frame of the page; /pos, /orders, the printer panel and the dashboard render right.
  The app put back to its empty start screen (release 29115bdf), `adb shell sync`, `adb emu kill`.
- Accessibility (local axe-core 4.12.1, WCAG 2.2 AA, base vs new; the chrome-devtools plugin was not used because it
  sends usage statistics by default): every audited page 0 violations at `8fa3f0b` (login, PIN pad, lock cover and its
  PIN pad, dashboard, /pos, /orders, /staff, the phone dashboard and sidebar); focus stays in the lock cover (18/18 Tabs);
  phone PIN keys 93 × 56. Remaining, pre-existing in the base too: the 20 px "N new order requests" link, two H1s on the
  dashboard.
- The diner menu in two presets (Classic Bistro, Royal Maroon), phone and desktop, device light and dark: the cafe's
  colours unchanged, the new shapes; axe identical to the base (the faded sold-out tile, pre-existing).

**The review.** A fresh Claude Fable 5.1 whole-branch review (read-only, probes in a junction-linked worktree): **Ready
to merge: Yes**, 0 Critical, 0 Important, 12 Minor; every ruling judged sound; 130/130 probe tests and three mutation
probes each caught. The final fix wave took nine Minors; its scoped re-review (Claude Opus) found eight addressed and
one (the masters blob cleared on a switch) resting on a false premise (that blob never holds the staff list) and able to
add requests on the next launch: reverted (R23). Its three cosmetic points were fixed test first.

**Rulings made during the work** (each: what, why):
- R1 one BOOTSTRAP_VERSION bump (15 → 16) for the Staff PIN fields and the screen-lock setting.
- R2 the `.dark` set in opaque values (the mock-up's tints flattened) except three borders: the WebView 109 tint fallback
  twins only plain sRGB.
- R4 the no-flash lock script as a fragment before a bare `<SidebarProvider>` (every order pin holds).
- R5 the work done in place on the branch.
- R6 the channel colours keyed by the dashboard's channel keys, not by labels (R3 moot).
- R7 every PIN try takes its rate-limit slot atomically before the compare; a right PIN refunds it (closes a parallel
  burst).
- R8 `getProviders()` before every `signIn`, so an outage never navigates away (printing stays mounted).
- R9 a server error reads "The PIN couldn't be checked just now. Please try again." (never "no PIN").
- R10 inactive people filtered when read, not rewritten in the cookie.
- R11 `NOW_SERVING_PATH` exported for the lock rules.
- R12 the person-scoped query roots (staff, reports, dashboard, expenses, telegram, print devices) reset on a switch.
- R13 a 10 s CSS failsafe so a cover that never mounts can never blank the screen.
- R14 the lock cover's password form has its own password-neutral copy.
- R15 signing out from the cover clears the stored lock first.
- R16 the lock script in a dependency-free module for the server layout.
- R17/R20 the sidebar rows 32 px on a mouse (the mock-up's 38 px did not fit a 768 px laptop), the hero and the
  Sales/Live rows two-column from xl.
- R18 Refresh and Tokens stay ghost; only the printer button becomes the outline square.
- R19 one staff token `--track` for segmented tracks on the grey page.
- R21 the Badge's default variant is the accent pair (7.1:1) and its destructive variant solid white on red (5.0:1): the
  tinted versions measured 3.9–4.3:1 on the staff page. The owner may prefer a red tint with a darker staff-only red.
- R22 the final fix wave took review Minors 1, 2, 3, 4, 6, 7, 8, 9, 12 and left 5, 10, 11.
- R23 F1 reverted (the device's masters blob never holds staff: `MASTERS_PERSISTED_PART_KEYS`); the misleading comments
  corrected; the re-review's three cosmetic points taken.

**Left for later (the owner's call or a later phase):**
- The lock is per tab in a PC browser: a second tab of the app locks by its own idle clock (the Android and Windows apps
  are single-view).
- The device cookie's `Secure` follows NODE_ENV, not the request: a production build served over plain http on a LAN IP
  would lose the device memory (meets the offline-billing phase).
- One brittle source-order test pin in `lib/screen-lock-paths.test.ts` (the behaviour is also proved by two scenarios).
- Smaller deferred points from the task reviews: the ghost button's hover on a muted surface (check at the first page
  phase); the side sheets' rounded corners on a phone; `--sidebar-muted` unused; `KpiRow` kept only for its golden test;
  the reserved-purple time pill next to a status pill; the hero figure 32/40 px against the mock-up's 42/60.

**What a merge of U0 changes for a cafe:** every page's look at once (colours, type, controls, white dialogs; each page's
layout stays until its own session); the login page; the PIN sign-in and the screen lock (an admin sets each person's
PIN on the Staff page; until then everyone signs in by password as today); the session becomes 90 days, the auto-lock 1
hour. `docs/GO-LIVE-CHECKLIST.md` says what an existing cafe should do.

**The owner's OK:** asked 2026-10-17 (the local preview at http://localhost:3110 on the demo database); the merge and the
push each wait for the owner's word.
