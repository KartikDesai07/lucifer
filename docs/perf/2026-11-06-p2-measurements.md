# P2 Smooth + fast: why a new screen is slow (or never comes) the first time — measurements (2026-11-06)

Local only. Scripts and raw JSON: `D:\kd\pos-dev-keep\perf\p2\` (`out\` holds every run). Build **A** = main `64379d2`
(production build, `next build`, webpack cache off) in the detached worktree `D:\kd\p2a`, on a fresh
`pos_scratch_perf_p2a` (the ui-baseline demo seed, 31 days, then the P1 rush scenario: 25 open tabs with KOT rounds,
200 orders today; 100 of 105 items with photos from a local image host; a local stand-in for the realtime room).

## 1. Method

- **The live demo (read-only, no sign-in):** `https://posdemo.sandbee.in` public routes only (`/login`, `/m`,
  `/api/health`, `/api/branding/productLogo`, a static JS chunk), `curl` timings and response headers.
- **A local stand-in for Vercel's edge** (`edge-sim.mjs`, between the browser and `next start`): static files
  (`/_next/static`, public files) answer after 15 ms (the CDN); every dynamic request (HTML, RSC, `/api`) after `fn` ms
  (the trip from the edge to the function's region and back); optionally + `cold` ms the first time a function group is
  hit (a cold start); it can also stall, drop or 504 the next requests, and switch the build it forwards to (a deploy).
- **Two server profiles, calibrated on the live demo** (section 2):
  - **Mumbai** (what `vercel.json` asks for): `fn` 40 ms, the database direct (≈ 1 ms).
  - **Virginia** (what the live demo runs today): `fn` 260 ms, the database through a TCP latency proxy (+90 ms each
    way, 180 ms a round trip, `latency-proxy.mjs`). Locally this gives `/api/health` 0.46–0.47 s and `/login`
    0.28–0.30 s; the live demo answered 0.44–0.50 s and 0.29–0.36 s.
- **Browser:** headless Chrome 156 (playwright-core, CDP), every host but this PC unreachable (host-resolver rules, no
  request interception, so the HTTP cache works). Phone 390×844, touch, CPU 4×; laptop 1280×800, CPU 1×; the device's
  own line "Wi-Fi" (40 ms, 30 Mbps).
- **A tap** (`tap-probe.mjs`): one app session per run. Open `/pos`, wait 45 s (the warm pass, section 4), then tap each
  screen in turn (its first visit), 6 s on each, then the same list again (the return visits). On a phone a screen that
  is not a tab is opened from the More sheet, as staff do (a group row's page by the router, `how = router`). Per tap,
  from the click: **change** = the router committed the new screen (the loading skeleton or the screen replaced the old
  one), **data** = the screen's own data is visible; and the requests in between (RSC, JS chunks, API).
- **When something goes wrong** (`event-probe.mjs`): a deploy while the app is open (the edge switches from build A to
  build B: the same code with one class name changed on the Kitchen page, built separately, so a new build id and one
  changed chunk); the server holding answers 25 s; a dropped connection; the device offline; a platform 504 page.

## 2. The live demo (read-only, 2026-11-06 13:04–13:30 IST)

Every dynamic answer carries `X-Vercel-Id: bom1::iad1::…`: the request enters Vercel's edge in Mumbai (`bom1`) and the
**function runs in Washington, D.C. (`iad1`)**, although `apps/cafe/vercel.json` asks for `"regions": ["bom1"]` and
`docs/GO-LIVE-CHECKLIST.md` requires it. Static files are served by the Mumbai edge alone (`X-Vercel-Id: bom1::…`).

| Request | TTFB | Notes |
|---|---|---|
| `/login`, the first after a quiet spell | **6.20 s** (13:04), **5.89 s** (15:02, 1.5 h after the last request) | a cold function (+ its first DB connect and Settings read); the next one 0.35 s |
| `/login`, then 5 times | 0.29–0.36 s | warm, Settings cached in the instance: no DB trip |
| `/m`, `/api/branding/productLogo` first hit | 0.78 / 0.89 s | another function group's first hit |
| `/api/health` first hit | 2.25 s | |
| `/api/health` warm (one DB `ping`), 6 samples | 0.44–0.50 s | one DB round trip ≈ 0.15–0.20 s more than `/login` |
| any warm function (`/m`, `/login`, branding) | ≥ 0.27 s | the floor: the edge in Mumbai to the function in Virginia and back |
| a JS chunk (`/_next/static/…`) | 0.06–0.08 s | `X-Vercel-Cache: HIT`, `public,max-age=31536000,immutable` |
| a JS chunk name that does not exist | 0.31 s, **404** | answered by a function (the app's not-found), not the CDN |

The TCP connect to the edge took 10–25 ms, so the 0.27 s floor is the edge ↔ function trip. The chunks' `Age: 6880`
dates this deployment to ≈ 11:30 IST today. P1 measured the same demo on 2026-11-02: `/api/health` (the same DB
ping) **0.06–0.20 s** and `/login` warm 0.11–0.17 s — only possible with the function next to the database. So the
functions moved to Virginia with a deploy between 2026-11-02 and today; Atlas stays far from them (each DB round
trip ≈ 0.18 s), so every query of every API pays it, sequentially (P1: Send KOT ≈ 16 trips, Pay Now ≈ 28).
The current chunk list and build id are kept in `out\demo-chunks-2026-11-06.txt` / `demo-buildid-2026-11-06.txt`
(to check, after the next deploy, whether the old chunks still answer).

## 3. A tap on a nav row (phone CPU 4×, Wi-Fi; laptop CPU 1×; ms from the click, medians)

"Cold rows" = screens the app does not keep warm (Menu, Customers, Expenses, Staff, Reports, Business details, Printer
setup, Events, Tables setup), each tapped once (first visit); "warm rows" = Orders, Kitchen, Order Requests (kept
prefetched, section 4); "return" = the second visit of every screen. **change** = the first visible change after the
tap (the router committed: the loading skeleton or the screen replaced the old one); **data** = the screen's data shown.

| Profile | cold rows: change / data (worst) | warm rows: change / data | return: change / data | RSC / API per first visit |
|---|---|---|---|---|
| phone, Mumbai, warm functions | 133 / 578 (707) | 98 / 351 | 171 / 188 | 1 / 2 |
| phone, Virginia, warm functions | **366** / 750 (1243) | 93 / 813 | 166 / 167 | 1 / 2 |
| phone, Mumbai, every function cold (+1.5 s) | **1650** / 2031 (3626) | 134 / 1764 | 162 / 163 | 1 / 2 |
| phone, Virginia, every function cold (+1.5 s) | **1886** / 2531 (4273) | 111 / 2502 | 190 / 193 | 1 / 2 |
| phone, Virginia, a second tap 400 ms later | 351 / 736 (1258) | 115 / 831 | 170 / 183 | 1 / 2 |
| laptop, Mumbai | 86 / 435 (522) | 29 / 153 | 29 / 29 | 1 / 2 |
| laptop, Virginia | 310 / 657 (1154) | 30 / 742 | 34 / 34 | 1 / 2 |

Reading:
- **Nothing on the screen changes until the page's own server answer (its RSC) arrives** — on a cold row the "change"
  is that answer's time plus a frame: 0.1 s next to the database, 0.35–0.4 s from Virginia, **1.6–1.9 s with a cold
  function** (the live demo's real cold start was 6.2 s). The tapped row gets no pressed / busy sign; on a phone the
  More sheet closes at once and the old screen comes back, unchanged, for that whole time.
- Warm rows and return visits change at once (the router cache: 0 server trips), but their **data** still waits for
  the screen's API calls: 0.35 s next to the database, 0.8 s from Virginia, 1.8–2.5 s with cold functions.
- The skeleton (`app/(dashboard)/loading.tsx`) appears with the RSC's first bytes; the screen then cannot replace it
  for at least 300 ms (React 19.1's Suspense reveal throttle, `react-dom-client.production.js`
  `globalMostRecentFallbackTime + 300`): on a fast line the skeleton itself adds up to 0.3 s.
- A second tap neither helps nor hurts (no duplicate request, the same times).
- Each cold-row first visit is 1 RSC function call + its API calls; some screens also prefetch other routes on sight
  (an in-page `<Link>` with the default prefetch: Customers → Festival cards, Business details → Bill print, Orders →
  Order Requests; 39 such links in the app), each one more function call.

## 4. Right after the app opens: the warm rows are not warm yet (`rsc-timeline.mjs`, phone CPU 4×, Mumbai)

A fresh open of `/pos`, every RSC and API request in the first 70 s (ms from the start):

| ms | request |
|---|---|
| 5 | the document `/pos` |
| 874–875 | `/api/bootstrap`, `/api/settings`, **the first pulse** |
| 1351–1414 | the screen's own reads (printers, areas, products, categories, tables, orders, the print lease) |
| 28254 | the second pulse |
| 28326 → 38749 | **the warm pass**: `/`, `/tables`, `/orders`, `/requests`, `/kitchen`, `/reservations` |

`hooks/use-warm-routes.ts` starts a pass on the first pulse answer it SEES, but it lives in the sidebar, which mounts
only after the masters load (`MasterDataProvider`); the first pulse answer (≈ 0.9 s) comes before that and is missed.
So for the first 30–40 s after every app open (and after every reload, including the one a deploy causes) even the
Operate rows open like cold rows. The dashboard's server-rendered HTML is only `MasterDataProvider`'s placeholder: the
real shell is drawn on the device after mount, so the server's render of a staff page carries no screen and no data.

## 5. A deploy while the app is open (`event-probe.mjs`, phone CPU 4×, Mumbai profile)

Build B = A with one attribute added on the Kitchen page (a new build id; the Kitchen chunk renamed, every other chunk
the same). The app is open on A (warm pass done, Orders and Customers visited), then the edge switches to B.

| After the deploy, a tap on… | What happens | change / data (ms) | requests |
|---|---|---|---|
| a screen already visited (Orders, Customers) | drawn from the router cache, still build A | 74 / 74, 262 / 262 | 0 |
| a warm row never visited (Kitchen, its chunk renamed in B) | drawn from the warm prefetch, still build A: its chunk was already loaded with the prefetch, so no 404 | 68 / 198 | 0 RSC |
| a screen never opened (Staff, Events) | its RSC answers with B's build id → **Next reloads the whole page** (`fetch-server-response.js`: `getAppBuildId() !== response.b` → `doMpaNavigation`) | 317 / 1060, 232 / 935 | 1 RSC + the document + 61 JS files |

Locally the reload re-used A's cached chunks (only ~15 KB moved); after a real deploy most chunk names change, so
that reload downloads the app again (P1: 450–540 KB of JS, 8–10 s on a low-end phone on slow 4G) and then waits for
the masters. It happens at a random moment: the first tap on any screen the router does not hold, and within 30 min
for every warm row too (each warm prefetch refreshed after the deploy carries the new build id, so its next click
reloads). Everything held only in the page is lost with it (an open sheet, a filter, a cart not yet sent).

Also measured (build C = A with the payment dialog's lazy chunk renamed): a cashier builds a cart, the deploy lands,
Pay — **the dialog opened in 97 ms, cart kept, no reload**: `PosModals` mounts its four lazy dialogs with `/pos`, so
their chunks are loaded before any deploy. A chunk error after a deploy needs code first loaded after it (a lazy part
not yet mounted, e.g. a report chart or the end-of-day print source); `lib/chunk-reload.ts` + `error.tsx` then show
"The app was updated" and reload once.

## 6. When the line or the server misbehaves (same setup)

| Case | What the staff see | ms |
|---|---|---|
| the server holds the answer 25 s (a stalled line / a slow cold start) | **nothing changes for 25.1 s**: no sign, the old screen stays; a second tap at +4 s sends nothing new and changes nothing | change 25109, data 25307 |
| the page's request is dropped once | Next falls back to a full page load ("Failed to fetch RSC payload … Falling back to browser navigation"): the whole app reloads (64 JS files) | change 225, data 922 |
| the device is offline, tap a screen it does not hold | the same fallback: **the browser's own "No internet" page replaces the POS at 77 ms**; back online at +10 s, the error page stays until 36 s (Chrome's own retry) | — |
| the platform answers 504 (a function timeout) | the fallback loads the page again, gets the 504 again, and **the platform's error page replaces the app** and stays (no retry, no nav) | 207 |

Vendor facts behind these (Next 15.5.19, `client/components/router-reducer/fetch-server-response.js`): the RSC fetch
has no timeout (its AbortController fires only on `pagehide`); any non-200 or non-RSC answer, any network error and a
build-id mismatch all end in `doMpaNavigation` (a full page load of the target).

In the native apps the full page load is a top-frame load of the WebView: the Android app answers a failed one
(`onError`) with its full-screen "could not open the POS" screen (`LoadErrorScreen`, a retry every 15 s), and an HTTP
error page on any page but the start page stays on screen (`onHttpError` → `isStartPageFailure`); the Windows app
logs `did-fail-load` and retries the URL later. So one dropped request, one platform error or one tap while offline
takes the cashier out of the POS — offline KOTs (Printing Phase 5) included, until the line is back.

## 7. The first open (`nav-probe.mjs` cold / warm, phone CPU 4×, Wi-Fi; medians of 3)

| Profile | Open | document TTFB | first paint | data shown | JS downloaded |
|---|---|---|---|---|---|
| Mumbai | `/pos`, new device (no cache) | 64 | 1832 | 1840 | 542 KB |
| Mumbai | `/pos`, app restarted (HTTP cache) | 71 | 972 | 988 | 0 |
| Virginia | `/pos`, new device | 290 | 2220 | 2234 | 623 KB |
| Virginia | `/pos`, app restarted | 282 | 1124 | 1141 | 0 |
| Mumbai / Virginia | `/` (Home), app restarted | 71 / 291 | 728 / 860 | 1197 / 1239 | 0 |

The first paint comes with the data: the server's HTML paints nothing (section 4), so a first open is the document's
function trip + the JS's run on the device + the masters (from the device's copy when it has one) + the screen's reads.
A cold function adds its start and its first DB connect to the document's trip (next section; the live demo's first
`/login` was 6.2 s).

## 8. What one page request costs the server (`cold-rsc.mjs`, Virginia DB profile: +180 ms a DB round trip)

| Request | fresh instance | the same, again |
|---|---|---|
| `/customers` RSC (the page's frame) | **1625 ms**, 11 DB connections opened | 26 ms, no DB trip |
| `/staff` RSC | 31 ms (the instance already warm) | 24 ms |
| `/api/customers` | 234 ms | 12 ms |
| `/api/order-requests/pulse` | 426 ms | 610 ms (its 7 reads, in sequential waves) |

The page frame's server work is the root layout's `auth()` (a Staff read at most once a minute per instance) and the
metadata's Settings read (cached per instance): nothing when warm, but on a fresh instance it opens the database pool
first. Locally that is plain TCP; Atlas adds TLS and SCRAM round trips, and Vercel its own start.

Per device-hour (estimate from the code and P1's rush, report §6): the warm pass refreshes 7 Operate rows every 30 min
(≈ 14 RSC calls), the rush measured ≈ 30 RSC calls per device-hour (prefetches + first visits), and 39 in-page links
prefetch their route on sight (one more each, per 30 min, on the screens that show them). Each is a Vercel function
invocation today (every page is dynamic) — about 4–8 % of the ≈ 354 invocations a device makes per hour
(Phase 5's ≈ 1.02 M a month for 8 devices, 12 h).

## 9. The root causes (each proven above; ✔ proven, ✘ rejected)

| # | Root cause | Evidence | What staff feel |
|---|---|---|---|
| **R0** ✔ (new, the largest) | **The live functions run in Virginia (`iad1`), not Mumbai**, since a deploy after 2026-11-02; the database is in Mumbai | §2: `X-Vercel-Id bom1::iad1`; every function ≥ 0.27 s; one DB round trip ≈ 0.18 s; the same health check was 0.06–0.20 s on 11-02 | every tap's server part ×3 (§3: change 133 → 366 ms, warm-row data 351 → 813 ms); every write pays 16–28 DB trips × 0.18 s; longer function wall time also spends Hobby's provisioned-memory allowance faster |
| **R1** ✔ | **The dead tap**: no sign of any kind until the page's own server answer arrives; on a phone the More sheet closes back to the old screen | §3: change = the RSC's time (0.13–0.37 s warm, 1.65–1.89 s cold); §6: 25.1 s of nothing on a stalled answer; a second tap does nothing | "the click does not work", "first tap does nothing" |
| **R1b** ✔ (new) | After every app open or reload, the warm pass waits for the 2nd pulse: Operate rows are cold for 30–40 s | §4: pass at 28–39 s | the busiest screens slow right after opening the app, after every reload and after every deploy |
| **R2** ✔ | **Every first visit runs a function** for a frame that carries no data (41 dynamic pages: `app/layout.tsx` awaits `auth()` + Settings; the dashboard's server HTML is a placeholder) | §3: 1 RSC per first visit (+ the 39 on-sight links); §8: 1.6 s on a fresh instance; live cold start 6.2 s | the first open of a screen in the morning or after a quiet spell takes seconds; 4–8 % of all invocations |
| **R3** ✔ (partly) | The screen's data waits behind its frame and its chunks; then React keeps the skeleton ≥ 300 ms | §3: data − change ≈ 0.3–0.45 s (Mumbai), 0.4–0.8 s (Virginia); React 19.1's reveal throttle | a skeleton that lingers |
| **R4** ✔ | **Deploy skew**: the first tap on any screen the router does not hold after a deploy reloads the whole app (and every warm row within 30 min) | §5: 1 RSC + the document + 61 JS; a real deploy re-downloads ~0.5 MB | "glitch", a white flash and a slow screen at a random moment, page state lost |
| **R5** ✔ | **No timeout and a full-page fallback on every failure**: a stalled answer hangs forever; a dropped request reloads the app; offline or a 504 replaces the POS with an error page (the Android app's "could not open" screen) | §6 | "sometimes it never comes", "glitches", thrown out of the POS (offline KOTs too) |
| **R6** ✔ | The first open: the document's function trip + 0.5–0.6 MB of JS on the device before anything paints | §7: 1.8–2.2 s new device, 1.0–1.1 s restarted (CPU 4×); P1: 8–10 s on a low-end phone, slow 4G | a slow start each morning / after a deploy |
| ✘ | A deploy breaking Pay mid-cart | §5: the POS dialogs load with `/pos`; Pay opened in 97 ms, cart kept | — |
| ✘ | A double tap opening a screen twice | §3: no second request, same times | — |
| ✘ | Bundle size / the database's own speed as the cause of the first-visit wait | P1 §2, §5; §8 here: warm requests 12–26 ms | — |

Not measured in this session (planned for the build session, before / after on the same day so the numbers compare):
the Android emulator (WebView 109 and 154 engines) and the Windows app. P1's emulator numbers (report §7, §11) show the
same server-trip pattern; these root causes sit in the server, the network and the router, not in the engine.
