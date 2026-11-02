# P1 Smooth + fast: the root causes of the slow app, and their fixes (design)

Status: APPROVED by the owner on 2026-11-02 (F1–F9; proposal P1 not taken). Branch `feat/perf-smooth` from local main `e877f7a`. The owner's
answers of 2026-11-02 are in section 4; "my ruling" marks a call of mine the owner can still change. The numbers are in
`docs/perf/2026-11-02-p1-measurements.md` ("report §N"); the scripts in `D:\kd\pos-dev-keep\perf\`.

## 1. Why, and the rule

Clients report (owner, 2026-11-02): every screen is slow since the new UI — moving between screens and the main flow
(add items → Send KOT → billing) — on the Android app, the Windows app and browsers, worst in a rush (6–10 devices,
60–120 orders/hour); they run the U3 build (deployed 2026-10-29). The goal: fast on every device, accurate everywhere
(never old data on open tabs, KOT, kitchen, bills, payments, dues, stock), caching that LOWERS server and database
work, ₹0 on the free tiers, a clean project. Printing, the paper and the approved look never change, except where the
owner chose so in section 4.

## 2. What the measurements say (report §2–§7)

A = main `a0a4355` (before any UI work), B = `e877f7a` (now). Same data (31-day seed + a rush: 25 open tabs with KOT
rounds, 200 orders today, 105 items, 100 with photos), production builds side by side, headless Chrome with CPU and
network throttling, an 8-device rush with a local stand-in for the realtime room, a DB-latency proxy.

1. **Most of the wait is older than the UI work.** A and B open and move between screens within a few % of each
   other on every profile: low-end phone (CPU 6×) on slow 4G — first open 8–10 s, a screen change 1.0–2.8 s, in both.
2. **The start screen is never warm** (older): every return to `/pos` (the cashier's start page) waits for one server
   round trip (`/pos?_rsc`) before it draws — the warm prefetch cannot cover the page the app opened on while
   `staleTimes.dynamic` is 0. ~0.6 s on slow 4G, and one function invocation each time.
3. **The new UI's CSS cost on low-end devices** (since U0): two `html:has([data-html-rules])` rules (and 18 smaller
   `:has()` utilities) multiply style recalculation 2–6× (phone CPU 6×, B vs A: `/orders` 240 vs 76 ms, `/tables`
   180 vs 28 ms); with photos on, B's `/pos` screen change is 1193 ms of main thread vs A's 808 (style 330 vs 85 ms).
   Dropping only the two `html:has` rules cuts B's style time ~70%.
4. **Motion on every screen change** (since U0): the page fade-in runs 0.4 s after the data is there (A had none);
   reduced motion cut an item tap's paint 156 → 47 ms.
5. **Requests per device** (older): safety-net polls run at full rate even while the realtime room delivers every
   write in ~1 s; every write then refetches every device's lists and tables, and once more 6 s later; the tab icon is
   fetched 1–2× per screen change when no product logo is saved (a function call + a DB read each). The 8-device
   rush made 134 requests / minute (tables 33%, lists 28%, pulse 19%); a busy cafe projects to **≈ 1.95 M function
   invocations and ≈ 4.7 h Active CPU a month — over Vercel Hobby's 1 M and 4 h** (report §6). After F4–F7 the
   estimate is ≈ 1.0 M and ≈ 2.5 h; the pulse (20 s, printing) is then the largest single part (≈ 0.5 M), section 9.
6. **Not the cause** (measured): bundle size (+5–10% since A), the database (every busy query uses an index; 5–10 ms
   locally; ~7–28 sequential DB trips per write, already in parallel waves), the menu payload, the test files (0 bytes
   in any bundle).

## 3. Scope

In: the shell's CSS mechanism, the page fade, the phone bars' background, the router cache's reuse window, the tab
icon's URL, the live lists' safety-net polls and the realtime nudge's tables read, the build's type-check scope and the
deploy upload, unused files and packages. Out: printing and the paper (the S1 pin, `print-budget.test.ts`), the pulse
(20 s, unchanged), every API's meaning and every model, the HTML look outside section 4, the write paths' logic, the
service worker (none), the realtime Worker.

## 4. The owner's answers (2026-11-02)

| # | Question | Answer |
|---|---|---|
| D1 | The 0.4 s page fade on every screen change | **Off** (sheets, dialogs and the cart's own motion stay) |
| D2 | The phone tab bar's and the POS order bar's glass blur | **Solid background**, the same colour, no blur |
| D3 | Safety-net polls while the realtime room is proven healthy | **120 s**; back to today's 30 s / 10 s the moment it is not, with one catch-up refetch |
| D4 | The test files | **Kept in the repo**, out of the Vercel upload and out of the deploy build's type-check and lint; every local suite unchanged |
| D5 | Unused files and packages | **Removed**, only what nothing uses (proved by grep, the build and every suite) |

## 5. The fixes

### F1 — the staff rules without `:has()` (my ruling: no look change)
`<html>` carries `data-html-rules` itself: the dashboard layout's pre-paint script sets it (as it does
`data-nav-collapsed`), the sign-in screen's too, and `HtmlRulesScope` keeps it in step on the client (set on mount,
removed on unmount, so the /m diner flow and print iframes never get it). `globals.css` reads `html[data-html-rules]`
instead of `html:has([data-html-rules])` — same specificity (0,1,1), same layer, same values. The 18 small `has-[…]`
utilities stay unless F1's measurement shows they still cost more than A (then a follow-up, my ruling per utility).

### F2 — the page fade off (D1)
`PageFade` no longer animates `<main>` on a path change. `PAGE_IN_*` stays only if something else uses it.

### F3 — solid phone bars (D2)
`bg-glass` + `backdrop-filter` on `TabBar` and the POS order bar (`lib/pos-layout.ts`) become the same `--glass`
colour with no backdrop filter. The /m diner bars keep theirs (not staff; untouched).

### F4 — visited screens reuse the router cache (my ruling)
`staleTimes.dynamic` = `PREFETCH_REUSE_SECONDS` (30 min), the window prefetched screens already have. Every staff page
is a client page whose data comes from its own queries, so the reused payload is only the page shell: data freshness is
unchanged (every query keeps its own rules). Same accepted trade-off as today's prefetch: another device's tab title /
icon can lag a rename by up to the window; after a deploy the next fresh fetch switches the tab to the new build. Data
access stays checked by every API call.

### F5 — the tab icon without a function call per screen (my ruling)
With no product logo saved, the layouts' icon points at a version-stamped URL of the built-in mark, which the branding
route answers `immutable` (the same rule a saved logo already gets). A saved logo keeps its own versioned URL.

### F6 — safety-net polls step back while the room is proven up (D3)
The live lists (open tabs, today's orders, the Orders list's first page), tables, the dashboard (range, live, summary)
and the kitchen board use `refetchInterval: () => isRealtimeHealthy() ? 120 s : today's interval`, the print host's
existing idiom (`use-print-host-wake.ts`). When the socket drops (close or missed pong), the live queries refetch once
at once (catch-up), then poll at today's rate. The pulse stays 20 s (printing and alerts). Known bound (the print
host's too): a half-open socket reads healthy until its next missed pong (≤ 210 s, `REALTIME_HEALTH_TTL_MS`).

### F7 — a nudge reads the floor fresh (my ruling)
The realtime nudge's tables refetch reads `/api/tables?fresh=1` (the route's existing cache bypass), so the second
"late" tables refetch 6 s later (`TABLES_LATE_REFETCH_MS`, there only to read past the 5 s per-instance cache) goes:
one request fewer per device per write, and the floor is never served from a stale instance cache after a nudge.

### F8 — tests out of the deploy (D4)
`.vercelignore` drops `**/*.test.ts`, `**/*.test.tsx`, `**/*.test.mjs`, `**/*.fixtures.ts` and `apps/cafe/scripts`'s
test files from the upload; `next build` type-checks and lints only the app (a build tsconfig excluding tests and
`scripts/`; ESLint during the build limited to the app folders). `npm test`, `tsc` and `npm run lint` locally still
cover every file. Measured gain: report §8.

### F9 — unused files and packages out (D5)
The files and packages in report §9, each proved unused (no import anywhere, including tests and scripts), removed;
`package-lock.json` changes only for them.

### Proposal P1 (needs the owner's OK — an API addition): the menu's freshness rides the pulse
Today New Order re-reads the menu (2 requests) each time it opens or regains focus after 30 s, and a POS left open
never learns of an 86'd item until a send is refused. The pulse would carry `menuAt` (the newest product/category
change, from the per-instance masters cache): New Order re-reads only when it moved (or after 10 min). Fewer requests
AND faster stock accuracy (≤ ~40 s on every device). Not done unless the owner says yes.

## 6. Caching rules per kind of data (after this work)

| Data | Where it is cached | Fresh when | Never |
|---|---|---|---|
| Masters: menu, categories, settings, staff | the device's stored copy (24 h) + TanStack (24 h); server per-instance 20–45 s | every full load (bootstrap); New Order on open/focus after 30 s (or P1); an edit on this device at once | served to a write: the server re-checks every line (409) |
| Tables (+ occupancy) | TanStack; server per-instance 5 s | a write anywhere → nudge → fresh read (F7) ~1 s; poll 30 s (120 s with the room up) | trusted for a charge: the server re-derives it |
| Live: open tabs, KOT rounds, order lists, kitchen board, order requests | TanStack (staleTime 0) | a write anywhere → nudge ~1 s; poll 30 s / kitchen 10 s (120 s with the room up); every mount | cached on the server (no cache) |
| Money: payments, bills, dues, discounts | not cached anywhere | computed by the server on every write; re-read after every write | changed or served by a cache |
| Stock (86 / available) | with the menu | as the menu row above; the server refuses a stale line (409) | trusted from a cache on a write |
| Page shells (RSC) | the router cache, 30 min (F4) | a deploy (build id), `router.refresh()` | carry data (every staff page is a client page) |
| Static JS / CSS / fonts / photos | the browser HTTP cache (immutable / R2) | a deploy (new file names) | — |

## 7. Tasks (fast path; each with its before / after numbers on the report's scripts)

1. F1 + F2 + F3 — the CSS and motion (pins `html-global-rules`, page fade, tab bar).
2. F4 + F5 — the router cache window and the tab icon (pins `warm-routes`, branding).
3. F6 + F7 — the safety-net polls and the nudge's tables read (pins `realtime-*`, `warm-routes` line proof).
4. F8 + F9 — the deploy upload, the build's check scope, the unused files and packages.
5. (Only with the owner's OK) P1.

## 8. Verification

C = the branch's build next to A and B on the same data: the nav matrix (laptop / phone, CPU 1/4/6×, none / fast 4G /
slow 4G), the main flow, the trace with photos, the rush (8 devices), the Android emulator (WebView 109 and 154 engines),
the free-tier projection (measured on C's rush, not estimated); the idle request count per page (BASE main, NEW branch, each alone, `tools\net-count.mjs`):
never higher; the full suites; the paper unchanged (S1 43-file pin, `print-budget.test.ts`); the U0–U5 probes: no
difference except D1 and D2; the real write paths' requests equal main's. Then a Claude Fable 5.1 review, one fix wave,
two verifiers, the plan's Results.

## 9. Left for the owner (not in this work)

- **The pulse** (`/api/order-requests/pulse`, every 20 s on every device, background too): after F4–F7 it is the largest
  single source of function calls (≈ 0.5 M a month for 8 devices, 12 h a day). It feeds printing (the slip alarm, the
  print host) and order requests, so it stays exactly as it is here; stepping it back while the room is up belongs with
  the next printing work (offline + multiple-printer printing), decided there.
- **The write chain** (7–28 sequential DB trips per write, already in parallel waves): ~150–400 ms on Atlas M0; no
  safe cut without touching the money paths.
- **A first open on a low-end phone on slow 4G** (8–10 s, A and B alike): the JS (~450–540 KB) and the masters
  bootstrap before the shell draws. A service worker / offline shell would cut it, but only with the owner's explicit
  OK (a stale app after a deploy is a real risk).
