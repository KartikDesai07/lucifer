# P1 Smooth + fast — measurements (2026-11-02)

Local only. Scripts and raw JSON: `D:\kd\pos-dev-keep\perf\` (`out\` holds every run). Builds: **A** = main `a0a4355`
(the last build before any UI work), **B** = `e877f7a` (U0–U5 + the owner's KOT / bill commits; the clients' U3 build is
a subset of it), **C** = `feat/perf-smooth` (section 10). Production builds (`next build`, webpack cache off) served by
`next start` in detached worktrees (`D:\kd\pa`, `D:\kd\pb`, `D:\kd\pc`), each on its own scratch DB
(`pos_scratch_perf_a|b|c`).

## 1. Method

- **Data:** the ui-baseline demo seed (31 days, 875 orders, 105 items in 11 categories, 10 tables, 40 customers), then a
  RUSH scenario through each build's own API (`rush-setup.mjs`, the POS's own request bodies): 25 open tabs with 1 + 1–3
  KOT rounds, 200 orders today. For the realtime and photo runs: 100 of 105 items carry a photo (600 px WebP q 0.82,
  made like the POS upload, `gen-images.mjs`), served by a local stand-in for R2 (`img-server.mjs`), and the realtime room
  runs as a local stand-in for the Cloudflare Durable Object (`fake-realtime.mjs`: same join / publish / ping protocol).
- **Browser:** headless desktop Chrome (playwright-core from the npx cache, CDP), every host but this PC unreachable
  (host-resolver rules; no request interception, so the HTTP cache behaves). Laptop 1280×800, phone 390×844 (DPR 3,
  touch). CPU throttling 1×/4×/6× (CDP), networks none / Fast 4G (150 ms, 9 Mbps) / Slow 4G (562 ms, 1.6 Mbps).
- **"Data shown":** the first moment a text only the screen's data draws is visible in the viewport (`markers.mjs`),
  from navigation start (loads) or from the click (screen changes). **cold** = new profile with only the session
  cookie; **warm** = second full load; **nav** = a link click after 8 s on the previous screen (as staff do).
- **Main thread:** Chrome trace per action (`trace-probe.mjs`): busy = top-level tasks; style / layout / paint summed;
  hypothesis switches drop `:has()` rules, backdrop filters, or ask for reduced motion at run time (the build is
  untouched). JS attribution: CDP sampling profile mapped through the builds' source maps (`prof-probe.mjs`).
- **Server:** per endpoint wall time, payload and MongoDB operations (the shared mongod's `top`, this DB only;
  `api-bench.mjs`), query plans (the profiler on this DB only, `db-profile.mjs`), sequential DB round trips per write
  (a 5 ms one-way TCP latency proxy in front of mongod, `latency-proxy.mjs` + `write-bench.mjs`).
- **Rush:** 8 signed-in devices at once for 10 minutes (`rush-run.mjs`): 3 counter laptops + 1 waiter phone (CPU 4×) on
  /pos adding items and sending KOTs / Pay Now sales (~120 orders/hour), Kitchen, Floor (phone, CPU 4×), Orders and the
  Dashboard open, a waiter adding KOT rounds and a cashier settling the oldest tabs through the API.
- **Live demo:** read-only TTFB samples of `https://posdemo.sandbee.in/login`, `/pos` (redirect) and `/api/health`.

## 2. Page loads and screen changes, A vs B (median ms to "data shown")

`compare-nav.py m2 A,B` (no photos, no realtime; the photos run is section 3).

| Profile | Mode | / | /pos | /orders | /tables | /kitchen | /products | /categories | /reservations |
|---|---|---|---|---|---|---|---|---|---|
| laptop, CPU 1×, local | cold A / B | 349 / — | 343 / 375 | 369 / 375 | 291 / 309 | 361 / 328 | 435 / 436 | 302 / 307 | 338 / 336 |
| | nav A / B | 49 / — | 53 / 55 | 104 / 110 | 43 / 59 | 79 / 48 | 376 / 166 | 57 / 73 | 42 / 46 |
| laptop, CPU 4×, Fast 4G | cold A / B | 2768 / 3015 | 2727 / 2801 | 2822 / 3130 | 2618 / 2471 | 2962 / 2870 | 3081 / 3108 | 2526 / 2752 | 2780 / 2810 |
| | warm A / B | 662 / 1119 | 849 / 992 | 901 / 849 | 590 / 577 | 938 / 858 | 1642 / 1190 | 682 / 606 | 772 / 785 |
| | nav A / B | 251 / 473 | 501 / 406 | 923 / 952 | 608 / 675 | 991 / 691 | 1082 / 1011 | 564 / 638 | 309 / 352 |
| phone, CPU 4×, Fast 4G | cold A / B | 2759 / 3199 | 2614 / 2660 | 2726 / 2787 | — / 2430 | 2763 / 2670 | 2913 / 2777 | 2447 / 2477 | 2689 / 2720 |
| | nav A / B | 508 / 482 | 473 / 411 | 1018 / 937 | — / 620 | 528 / 389 | 872 / 716 | 582 / 626 | 383 / 332 |
| phone, CPU 6×, Slow 4G | cold A / B | 9425 / 10111 | 8753 / 9085 | 9477 / 9859 | 7830 / 8175 | 9534 / 9260 | 9229 / 9360 | 8272 / 8408 | 9230 / 9364 |
| | nav A / B | 1532 / 1413 | 1132 / 990 | 2845 / 2730 | 1498 / 1568 | 1806 / 1188 | 2178 / 2036 | 1561 / 1584 | 869 / 1060 |

(— = a marker timeout in that run, re-checked afterwards.) JS downloaded on a cold load: A 422–547 KB, B 454–543 KB
(+5–10%). First Load JS per route (build output): A `/` 322 kB → B 356, `/pos` 318 → 327, `/orders` 319 → 343,
`/kitchen` 204 → 230; shared 105 kB both; middleware 88 kB both.

**Reading:** the UI work did not make loading or moving between screens measurably slower on these profiles; the
big numbers (8–10 s first open, 1–2.8 s per screen change on a low-end phone on slow 4G) are there in A too.

## 3. Main thread per action (phone, CPU 6×; ms: busy / style / paint)

| Build | add ×3 | → /orders | → /tables | → /kitchen | → /pos |
|---|---|---|---|---|---|
| A, no photos | 593 / 66 / 165 | 878 / 76 / 41 | 400 / 28 / 18 | 730 / 66 / 51 | 878 / 97 / 66 |
| B, no photos | 632 / 79 / 177 | 929 / 212 / 55 | 671 / 211 / 52 | 529 / 126 / 55 | 876 / 244 / 69 |
| B without the two `html:has` rules | 561 / 28 / 165 | 660 / 51 / 50 | 523 / 93 / 53 | 439 / 68 / 48 | 593 / 68 / 57 |
| B without any `:has()` rule (20) | 538 / 27 / 166 | 634 / 37 / 43 | 516 / 103 / 46 | 364 / 54 / 48 | 586 / 80 / 49 |
| B, reduced motion | 388 / 39 / 47 | 737 / 170 / 35 | 457 / 97 / 16 | 344 / 67 / 17 | 793 / 198 / 33 |
| B without `:has` + blur + motion | 275 / 5 / 44 | 580 / 34 / 32 | 363 / 16 / 14 | 300 / 31 / 17 | 549 / 50 / 29 |
| A, 100 photos | 841 / 69 / 209 | 714 / 62 / 30 | 481 / 36 / 26 | 905 / 77 / 75 | 808 / 85 / 58 |
| B, 100 photos | 633 / 68 / 163 | 932 / 221 / 70 | 915 / 287 / 59 | 625 / 141 / 67 | 1193 / 330 / 82 |

B's CSS has 20 `:has()` selectors (A 10); the two `html:has([data-html-rules])` rules (U0, the HTML's font stack and
tabular figures) are most of the extra style time. The JS profile (source-mapped) puts most of each screen change in
the engine's own work ("(program)": style, layout, paint) — app JavaScript is 200–400 ms of it at 6×, in A and B alike.
Headless scrolling stays at 60 fps in A and B (`scroll-probe.mjs`; the compositor scrolls, and headless Chrome does not
model a phone GPU, so the blur's cost is read on the emulator, section 7).

## 4. Waterfall of a screen change (B, phone, CPU 6×, Slow 4G; `waterfall.mjs`)

- `/orders`, first visit: `/orders?_rsc` 583 ms → the page's 5 JS chunks (~0.9 s) → `/api/orders` 785 ms → shown at
  2721 ms. The tab icon `/api/branding/productLogo` is fetched on the way (609 ms).
- `/pos`, EVERY return: `/pos?_rsc` 590 ms before it draws (shown at 929–1040 ms), then `/api/tables`,
  `/api/orders?…Unpaid`, `/api/products?fresh=1`, `/api/categories?fresh=1`, and the tab icon twice.
- `/tables`, second visit: no server round trip before it draws (shown at 282 ms; the lists refetch behind it).

The start screen's router-cache entry (the page the app opened on) is the initial-load entry; with
`staleTimes.dynamic: 0` it is never reusable, and the warm prefetch does not replace it, so every return to `/pos`
waits for the server. A has the same.

The tab icon: with no product logo saved, the layouts point the tab icon at the unversioned
`/api/branding/productLogo`, answered `public, max-age=0, must-revalidate` (the live demo answers the same headers), and
the route reads Settings to resolve it: 1–2 function calls and a DB read per screen change in a browser.

## 5. Server per request (`api-bench.mjs`, `db-profile.mjs`, `write-bench.mjs`; B = A for the server)

| Endpoint | local p50 ms | payload (gzip) | DB ops | plan |
|---|---|---|---|---|
| `/api/order-requests/pulse` | 7 | 1 KB | 7 | IXSCAN |
| `/api/orders?Unpaid&Pending` (open tabs) | 7 | 32 KB (4) | 1 | IXSCAN status |
| `/api/orders?date=today` | 6 | 40 KB (4) | 1 | IXSCAN createdAt |
| `/api/kitchen` | 8 | 56 KB (4) | 2 | IXSCAN status |
| `/api/dashboard` (today) | 9 | 3 KB | 9 | IXSCAN createdAt (≤ 979 keys) |
| `/api/dashboard/live` | 7 | <1 KB | 6 | COUNT_SCAN / IXSCAN |
| `/api/bootstrap` | 6 | 41 KB (4) | 0 (cached) | — |
| `/api/tables` | 6 | 3 KB | 0 (cached 5 s) | IXSCAN |

Sequential DB round trips (wall with a 10 ms DB round trip − wall without, ÷ 10): Send KOT (new tab) ≈ 16, a KOT round
≈ 13, settle ≈ 19, Pay Now sale ≈ 28, pulse ≈ 7, kitchen ≈ 7. The follow-up writes already run in one parallel wave; on
Atlas M0 from bom1 this chain is ~150–400 ms of a write's time. A = B.

Live demo (read-only): `/login` first request 2.77 s (a cold function), then 0.11–0.17 s; `/pos` redirect 0.06–0.22 s;
`/api/health` 0.06–0.20 s.

## 6. The rush (8 devices, 10 min, realtime on; `rush-r2-A|B.json`)

~100 orders/hour pace: 17 POS sales / KOTs + 16 KOT rounds and settles in 10 min → 32 realtime publishes → 256
deliveries (8 sockets).

| | A | B |
|---|---|---|
| device requests / min (8 devices) | 134.4 | 133.4 |
| request p50 / p95 / p99 (local) | 11 / 45 / 61 ms | 10 / 45 / 56 ms |
| server CPU per 10 min (incl. its idle background ~1.3 s) | 13.0 s | 12.4 s |
| MongoDB ops / s (this DB) | 5.9 | 5.9 |
| Send KOT tap → answer p50 / Pay Now p50 | 63 / 404 ms | 61 / 521 ms |
| errors | 0 | 0 |

Per route (B, per minute): `GET /api/tables` 43.7 (33%), `GET /api/orders` (lists) 37.1 (28%), pulse 24.8 (19%),
`/api/kitchen` 8.0, `/api/dashboard/live` 4.1, `/api/orders/summary` 2.1, `/api/dashboard` 2.1, print acks 2.2,
`POST /api/orders` 1.7, menu reads 2.6, RSC prefetches ~4. Per device: Dashboard 29.8 / min, each POS 14.6–17.4, Orders
14.0, Floor 12.5, Kitchen 11.8.

The tables reads come mostly from realtime: every write makes every visible device refetch its lists and tables at
once and the tables again 6 s later (`TABLES_LATE_REFETCH_MS`); the sending device refetches its lists and tables twice
(its own `onSettled` and the room's echo of its own write). The safety-net polls (30 s lists / tables / dashboard, 10 s
kitchen, 20 s pulse) run at full rate throughout.

**Free-tier projection (B, a busy 8-device cafe, 12 h a day, 4 of them like this run):** rush ≈ 8,240 requests / hour,
the other hours ≈ 4,000 / hour (polls alone) → **≈ 1.95 M function invocations a month** (Vercel Hobby: 1,000,000) and,
at ~8.7 ms CPU per request, **≈ 4.7 h Active CPU** (Hobby: 4 h). MongoDB stays far under M0's 100 ops / s (≈ 6 / s in
the rush).

## 7. Android emulator (Pixel 7 AVD, its Chrome over CDP, CPU 4×; `emu-c156|c109-A|B.json`)

The app's release WebView cannot be debugged (`webviewDebuggingEnabled={__DEV__}`), so the AVD's own Chrome stands in
for the engine: the updated Chrome 156 (≈ the AVD's WebView 154) and, after `pm uninstall-system-updates`, the factory
Chrome 109.0.5414.123 (= the factory WebView 109). The page is the local build through `adb reverse`.

| Engine | Build | load /pos | load /orders | load /tables | → /orders | → /tables | → /kitchen | → /pos | → /products | → / |
|---|---|---|---|---|---|---|---|---|---|---|
| Chrome 156 | A | 1809 | 1681 | 1203 | 650 | 217 | 401 | 1012 | 1721 | 787 |
| | B | 2070 | 1577 | 1360 | 434 | 249 | 233 | 862 | 1441 | 753 |
| Chrome 109 | A | 2666 | 2368 | 1389 | 1271 | 364 | 640 | 1123 | 2265 | 1081 |
| | B | 2040 | 1965 | 1643 | 634 | 422 | 367 | 900 | 2199 | 1259 |

Same reading as section 2: the return to `/pos` (~0.9–1.1 s) and a first visit's round trips are the cost, in A and B.
The emulator's GPU is the PC's, so it cannot price the glass blur on a low-end phone GPU (the owner's earlier note
stands; decided D2).

## 8. The test files

- 656 tracked test / fixture files, 9.65 MB (533 in `apps/cafe`, 7.96 MB) of 32.4 MB tracked.
- **Client bundles: 0** test modules (webpack stats of A and B: 1885 / 1988 client modules, none a test, fixture or
  script). **Server bundles: 0** (`.next/server` and every `.nft.json` trace: no test file).
- **Android / Windows app packages:** neither contains the cafe web app (both load the POS address).
- **Vercel upload:** the repo minus `.vercelignore` = 2,390 files / 29.6 MB, of which 643 test files / 9.4 MB and
  docs 8.5 MB.
- **`next build`:** type-checks and lints every file `apps/cafe/tsconfig.json` includes (`**/*.ts`, tests and
  `scripts/` too). Measured on B's tree: `tsc --noEmit` 25 s over 2,114 files with them, 17 s over 1,411 without;
  `eslint .` 29 s with them, 11 s without (the build lints `app components lib …`: 17 s, most of `lib`'s 503 tests
  included). So the deploy build spends ~16 s of its ~65 s (local) on the tests, and the upload carries 9.4 MB of
  them; the local suites need them all.

## 9. Unused files and packages (knip 5 + grep)

- `apps/cafe/components/ui/`: accordion, alert, aspect-ratio, avatar, breadcrumb, carousel, command, context-menu, form,
  hover-card, input-otp, menubar, navigation-menu, pagination, progress, radio-group, resizable, scroll-area, slider,
  toggle, toggle-group — 21 files no file imports (`toggle` only by `toggle-group`; `radio-group` only named by a
  test that asserts it is NOT used).
- `apps/cafe/package.json` dependencies no file imports outside those files: `@radix-ui/react-accordion`,
  `-aspect-ratio`, `-avatar`, `-context-menu`, `-hover-card`, `-menubar`, `-navigation-menu`, `-progress`,
  `-scroll-area`, `-slider`, `-toggle`, `-toggle-group`, `axios`, `cmdk`, `embla-carousel-react`, `input-otp`,
  `react-resizable-panels` (17).
- Kept on purpose: `hooks/use-print-host-drain.ts` (printing pins read it), `components/settings/LoyaltyTemplateCard.tsx`
  + `lib/loyalty-presets.ts` ("deliberately KEPT" by the loyalty page), `clsx` / `tailwind-merge` (used by
  `packages/shared`), `@radix-ui/react-radio-group` (the void dialog). knip's mobile / desktop / worker entries are false
  positives (their own entry points).

## 10. Before / after (C)

(filled at the end)
