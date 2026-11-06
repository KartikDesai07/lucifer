# P2 Smooth + fast: every tap answers at once, a new screen opens fast the first time (design)

Status: **APPROVED by the owner on 2026-11-06** (D1–D8 in section 4, all taken as recommended, and the builder check's
four calls marked "my call", which the owner can still change). Branch `feat/perf-nav` from main `64379d2`. Numbers: `docs/perf/2026-11-06-p2-
measurements.md` ("report §N"); scripts and raw runs in `D:\kd\pos-dev-keep\perf\p2\`.

## 1. Why

Clients report (owner, 2026-11-06): a new screen takes very long the first time, the first tap often seems to do
nothing, sometimes the screen never comes, "glitches" — on the Android app, the Windows app and browsers. The owner's
rule: find the root causes with numbers, then fix them so every tap answers at once and a new screen opens fast, with
proper caching, never old or wrong data where it matters (open tabs, KOT, kitchen, bills, payments, dues, stock), and
**no more server load** than today (client-owned free accounts, ₹0; Vercel Hobby: 1 M function invocations, 1 M edge
requests, 4 h Active CPU, 360 GB-h provisioned memory a month).

## 2. The root causes (report §9)

| # | Cause | Proof |
|---|---|---|
| R0 | The live functions run in Virginia (`iad1`) since a deploy after 2026-11-02; the database is in Mumbai | `X-Vercel-Id bom1::iad1`; every function ≥ 0.27 s; a DB round trip ≈ 0.18 s (11-02: 0.06–0.20 s for the same check) |
| R1 | A tap shows nothing until the page's server answer arrives | change = that answer: 0.13 s (Mumbai) / 0.37 s (Virginia) warm, 1.65–1.89 s with a cold function, 25 s when stalled |
| R1b | After every app open / reload the warm pass waits for the 2nd pulse (30–40 s) | report §4 |
| R2 | Every first visit runs a function for a frame with no data in it (41 dynamic pages) | 1.6 s on a fresh instance (report §8); live cold start 6.2 s |
| R3 | Data waits behind the frame and its chunks; React keeps a shown skeleton ≥ 300 ms | report §3 |
| R4 | After a deploy, the first tap on a screen the router does not hold reloads the whole app, at a random moment | report §5 |
| R5 | No timeout; any failure falls back to a full page load: a drop reloads the app, offline / a 504 put an error page in place of the POS | report §6 |
| R6 | First open: the document's function trip + 0.5–0.6 MB JS before anything paints | report §7 |

Not causes (measured): a deploy breaking Pay mid-cart (the POS dialogs load with `/pos`), a double tap, bundle size,
the database's own speed.

## 3. Goals, non-goals, anti-goals

Goals: a visible answer to every nav tap within one frame; a new screen's frame with no function call and no cold
start; the busiest screens warm from the first seconds; no silent hang and no error page in place of the POS from a
single failed navigation; deploy updates at a quiet moment instead of a random reload; functions in Mumbai on every
deploy; the first open no slower (faster where the document was a function).

Non-goals: the screens' data rules (every query keeps its own freshness), the write paths, printing and the paper,
offline KOTs, the realtime room, the native apps' code (no new app release in this work), the public diner pages
(`/m`, they stay dynamic), `/login` (stays dynamic, it reads its branding on the server), a service worker.

Anti-goals (failure even if faster): old data on open tabs / KOT / kitchen / bills / payments / dues / stock; a
reload during a sale, a payment, a typed form or an unsent order; any new recurring request; a person's shell shown to
another person; a deploy that silently lands in Virginia again; anything WebView 109 cannot draw.

## 4. The owner's decisions (2026-11-06)

| # | Question | Answer |
|---|---|---|
| D1 | Make every deploy land in Mumbai | **The owner's admin panel manages it** (owner, 2026-11-06): his deploys run from his own admin panel on an AWS server (outside this repo), which has a one-region select; the repo's old local deploy script (`scripts/deploy.mjs`) and the local go-live console are no longer used, so nothing in this repo deploys or sets a region |
| D2 | Check the clients' regions | **The owner checks each client project himself** (Vercel → Settings → Functions → Function Region); nothing online is touched by Claude |
| D3 | What a tap shows | **The skeleton at once**: the row lights / shows it is opening, a thin progress line under the header, and the new screen's skeleton in place of the old screen in the same frame; after 8 s "Still opening… Try again"; a second tap does nothing extra |
| D4 | Static page frames | **Yes**: every staff screen's frame is built once per deploy and served by the CDN; the session is read on the device; the tab title and icon come from the device's settings |
| D5 | Deploy updates | **A quiet reload**: the pulse answer carries the server's build; on a new build the app reloads itself at a quiet moment with a 2 s "Updated" note; before that, a tap on a screen it does not hold is a clean full page load of that screen; never during a sale or a payment |
| D6 | Prefetch after D4 | **Operate rows + on touch**: the Operate rows warm from the first seconds (the R1b fix); any nav row starts loading when a finger touches it or a mouse rests on it; nothing else |
| D7 | A service worker / offline app shell | **Not now**; measure after this work and decide again |
| D9 | How the region is proven | `/api/health` names the region its function runs in (`region`), so one GET (by the owner, his admin panel or a check) proves Mumbai; nothing else in the repo changes for N0 (my call) |
| D8 | Ship N0 apart? | **The region fix ships from the admin panel, no code needed**; the repo's one N0 part (`region` in `/api/health`) rides Part B's first task, so the next session is Part B; N1–N4 follow in their own sessions |

## 5. The design

### N0 — Functions in Mumbai on every deploy (D1, D2, D9; R0)
- The owner sets the region in his admin panel (AWS, outside this repo; its one-region select) for the demo and every
  client, and redeploys from there (D1, D2). This repo neither deploys nor sets a region.
- `/api/health` adds `region: process.env.VERCEL_REGION ?? null` to its plain answer (the contract's other fields
  unchanged; the failover Worker reads only `ok`/`db`), so one read-only GET proves it: `"region":"bom1"` and the
  header `X-Vercel-Id: bom1::bom1::…` = Mumbai; `bom1::iad1` = Virginia (report §2). Built as Part B's first task.

### N1 — The tap answers in the same frame (D3; R1, R5)
- One client store of the **navigation in progress** (`{ href, label, startedAt }`, one at a time), set by every staff
  navigation: the sidebar and rail rows, the tab bar, the More sheet (it closes at once), the header's links, in-page
  links, and code navigations. One `AppLink` (wrapping `next/link`, using its `onNavigate`) and one `navigateTo()`
  helper (wrapping `router.push` / `replace`) are the only ways staff code navigates; a source pin forbids a raw
  `next/link` import or `router.push` in staff code outside them (the diner pages under `/m` keep theirs).
  `AppLink` never prefetches on sight (my call, builder check Q4, D6 "nothing else"): it prefetches on touch / mouse
  rest like the nav rows (N3), on a proven line only, so the 39 in-page links stop prefetching on sight and a failed
  on-sight prefetch can no longer turn the next click into a full page load.
- While a navigation is in progress and the path has not changed: the tapped row shows "opening" (its active colour
  and a small spinner; WebView 109-safe: no `:has()`, transform / opacity only), a 2 px progress line under the header,
  and `<main>`'s content is replaced (hidden, not unmounted) by the skeleton of the target screen's kind (my call: three
  kinds — list, board, form — chosen per route in one table; the current generic list skeleton is the default). The
  page underneath keeps running (its queries, the pulse, printing).
- It ends when the path becomes the target (the new screen draws), when another navigation starts (that one wins), or
  when the person cancels (below). A second tap on the same row while it is in progress does nothing.
- **After 8 s** (my call, `NAV_STILL_OPENING_MS`): the skeleton gains "Still opening…" with **Try again** (a full page
  load of the target) and **Back** (the old screen shows again; if the navigation lands later it still switches).
- **Offline** (the Phase 5 offline state, `serverReach.isOffline()`, or the browser's flag) and the target is not held
  on this device (visited or warmed in this page within the router-cache window, `PREFETCH_REUSE_SECONDS`): no
  navigation; a toast "Offline: <screen> opens once the internet is back" (the POS and its offline KOTs stay usable).
  A held screen opens as today (from the router cache).
- `app/(dashboard)/loading.tsx` goes (my call): the tap's skeleton covers every instrumented navigation from its first
  frame, and keeping the route boundary would hold the finished screen behind React's 300 ms reveal throttle (report
  §3). An un-instrumented navigation then keeps the old screen until the new one is ready (never blank).

### N2 — Static page frames (D4; R2, R5, R6)
- `app/layout.tsx` no longer awaits `auth()` or reads Settings: `<SessionProvider>` gets no server session and reads
  it on the device (`/api/auth/session`, one call per full page load — the same count as today's dynamic document,
  which is now served by the CDN). The root metadata is static (the product name and the versioned default icon); the
  Settings-based title / icon move to `/login`'s and `/m`'s own layouts (both stay dynamic).
- `app/(dashboard)/layout.tsx`'s metadata is static (product name, manifest, default icons); a small client part sets
  `document.title` and the tab icon from the device's settings (the masters it already has), and keeps them in step
  when the settings change (P1's accepted lag of another device's tab title is now "until its next masters refresh").
- **The session on the device** (my call, builder check Q1). next-auth's own client fetch turns a failed request into
  "unauthenticated" (`components/layout/SessionKeepalive.tsx` already notes it), which would bounce an admin off
  `/settings` (`AdminGuard`) or flash the staff rows. So the page fetches `/api/auth/session` itself and tells three
  answers apart: a session (handed to `<SessionProvider session=…>`), a real "signed out" (a 200 with no user: a full
  page load of `/login`, as the middleware would do), and no answer (a network error, a 5xx, a timeout: retry with a
  short backoff, never treated as signed out). Until the first session is known, `MasterDataProvider` keeps its
  placeholder (the shell, the nav and every guard wait), whether or not the device has a stored masters copy; after
  `MASTERS_HOLD_MAX_MS` without an answer the placeholder says "Connecting to the server…" with **Retry** and keeps
  trying. No session is stored on the device (a stored copy could show one person's shell to the next after a
  sign-out or a PIN switch). Cost and time: one request per full page load, which replaces the dynamic document's
  function call; a cold start now delays the shell behind a CDN document instead of a blank page.
- `SessionProvider` moves from the root layout to the staff layouts (`(dashboard)` and `/login`'s needs as they are
  today), so the diner pages under `/m` never fetch a session (my call).
- Every route under `app/(dashboard)` builds as static (`○`): `/orders` wraps its `useSearchParams` reader in
  `<Suspense>`; `/printers` keeps its 10-minute app list (its fetch's `revalidate` makes the page regenerate at most
  every 10 minutes when visited, the same freshness as today); no server component reads cookies, headers or the DB.
  A build check (a script over `.next/prerender-manifest.json` / the route list, run in the plan's verification and
  pinned by a source test of the layouts) fails if any staff route is dynamic again.
- Unchanged: the middleware (sign-in guard, admin routes, tenant) runs before every page as today; every API checks the
  session; the PIN switch still calls `router.refresh()` (now it refreshes the device's session too). The router cache
  is keyed by URL: a static frame carries no person's data, so another person after a switch sees the same frame with
  their own session's data.

### N3 — Warm from the first seconds, and on touch (D6; R1b)
- `useWarmRoutes` starts its pass at mount when the pulse has already answered recently (it reads the pulse query's
  last success from the cache instead of waiting for the next answer), so the Operate rows are warm seconds after an
  open or a reload. The line-proof rule (never prefetch on an unproven line) stays.
- Every nav row prefetches its route on `pointerdown` (touch or mouse) and after a 120 ms mouse rest (my call), once
  per row per router-cache window, only on a proven line. With N2 a prefetch is a CDN answer (an edge request, no
  function).

### N4 — Deploy updates at a quiet moment (D5; R4)
- A build stamp, made once at build time (Vercel's deployment id when present, else the commit, else a time stamp;
  my call), is baked into the client and the server. The pulse's JSON answer gains `build` (no new request).
- When the pulse's `build` differs from the page's own, the update is **pending**:
  - The next instrumented navigation to a screen the router does not hold is a full page load of that screen (no
    wasted RSC trip, no chunk error flash).
  - The page reloads itself at the first **quiet moment**: the screen lock is on, or for 60 s (my call) there was no
    pointer / key input AND no dialog or sheet is open AND no text field has focus AND the POS cart is empty AND no
    order waits to be sent (the offline outbox is empty) AND no write is in flight (TanStack `isMutating() === 0`) AND
    this device's print host holds no leased job. A 2 s "Updated" note shows after the reload.
  - Never while any of those is true: a sale, a payment, a typed form, an unsent order, a print job.
  - **Sound** (my call, builder check Q2): in a plain browser a reload locks the order-request / print alarm sound and
    the Now Serving voice until someone taps (`lib/alert-sound.ts`); the native apps unlock it on their own. So a
    browser device with alerts on never reloads by itself: it shows a small **"Update ready · Reload"** chip in the
    header instead (the tap reloads, and staff are there to tap "Enable sound"), and it still takes the clean full load
    on its next tap on a screen it does not hold. The Android and Windows apps (and browsers with alerts off) take the
    quiet reload.
- `lib/chunk-reload.ts` + `error.tsx` stay as the net for a lazy chunk first needed after a deploy.

### N5 — The first open (D7; R6)
Nothing beyond N2 (the document from the CDN) and N3 (warm rows from the first seconds); no service worker. The build
session measures the first open again (new device, app restarted) and reports whether D7 should be reopened.

## 6. Caching rules (after this work; what changes is in bold)

| Data | Where | Fresh when | Never |
|---|---|---|---|
| **Page frames (HTML + RSC)** | **the CDN, per deploy; the router cache 30 min** | **a deploy (N4)** | **carry data or a person's session** |
| Session (who, role) | **the device (`/api/auth/session`), per full load + on focus** | a full load, focus, a PIN switch | trusted by an API (every API checks the cookie) |
| Masters, tables, live lists, money, stock | unchanged (P1 design §6) | unchanged | unchanged |
| Static JS / CSS / fonts | the browser HTTP cache (immutable) | a deploy (new names) | — |

## 7. Server load budget (8 devices × 12 h × 30 days; Hobby limits)

| Item | Today | After | Why |
|---|---|---|---|
| Page RSC (first visits, warm prefetches) | ≈ 15–30 function calls / device-hour | **0** function calls; the same number of CDN answers | N2 |
| On-sight prefetches of the 39 in-page links | 1 function call each per 30 min on the screens that show them | **0** (on touch only, N1) | N1 |
| Full page load | 1 function (the document) | 1 function (`/api/auth/session`); the document from the CDN | N2 |
| `/printers` | 1 function per first visit | ≤ 1 regeneration per 10 min while visited | N2 |
| The pulse | unchanged | unchanged (one more JSON field) | N4 |
| Touch prefetch | — | ≈ 0 extra: it is the request the tap would make, sent ~0.1 s earlier; a touch without a tap costs one CDN answer | N3 |
| Active CPU | — | down (no page renders) | N2 |
| Provisioned memory (wall time) | Virginia: every request waits 0.27 s + 0.18 s per DB trip | down sharply once in Mumbai | N0 |
| DB reads | page renders read Staff (≤ 1/min/instance) and Settings | those reads gone | N2 |

Nothing goes up; the build session measures every row (the P1 / P2 tools: idle counts per page, the 8-device rush) and
a budget test pins "no new recurring request".

## 8. Risks

- **A stale frame after a deploy:** frames are per deploy and carry no data; N4 brings every open app to the new build
  at a quiet moment; the router cache's 30-min window is unchanged.
- **The session on the device:** the UI's role comes from `/api/auth/session` (as `useSession` does today after the
  first render); the server never trusts it (middleware + every API). The hold in `MasterDataProvider` prevents an
  admin row flashing for a staff member.
- **Static build failures:** a client hook that needs the request (e.g. `useSearchParams`) without `<Suspense>`
  fails the build — caught by the build itself and the static-route check.
- **WebView 109:** the new parts use no `:has()`, no `dvh`-only layouts, no new CSS features; checked on the emulator
  with the factory WebView 109 and the updated 154.
- **A quiet reload that is not quiet:** every condition in N4 is a pure function with unit tests; the reload never runs
  while any is false; a device that is never quiet stays on the old build until its next tap on a screen it does not
  hold (as today).
- **Residual (Next's own):** a dropped RSC request still falls back to a full page load (now of a CDN document); the
  native apps' error screens are unchanged (no app release here; a follow-up option).

## 9. Verification (the build session)

The same probes before (A = main) and after (C = the branch), same data, same day: `tap-probe.mjs` (Mumbai and
Virginia, warm and cold), `event-probe.mjs` (deploy, stall, drop, offline, 504), the first open, `rsc-timeline.mjs`,
the idle request counts per page and the 8-device rush with the free-tier projection; the Android emulator (WebView
109 and 154) and the Windows app smoke; a11y (local axe); every suite (cafe, shared, live), the paper pin unchanged.
Then a Claude Fable 5.1 whole-branch review, one fix wave, the plan's Results.
