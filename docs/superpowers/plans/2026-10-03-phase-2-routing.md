# Phase 2: stations, printers and routing, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner's choice) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An outlet can have many printers and kitchen stations. A KOT round splits by station (category → station, with a per-item override) and each station's slip prints at that station's printer; a printer can also take a full copy of every KOT, the bills, the notices and End of day; one device can drive several printers. Existing outlets keep printing exactly as today until they set printers up (spec §6.6, simple mode).

**Architecture:** Routing is a pure function (`apps/cafe/lib/print-printer-routing.ts`) from one slip a request asks for (built by today's builders, so the paper is today's) to the jobs of printers mode: which printer, how many copies, and for a KOT which station's lines. The server reads the setup fresh per request (one small read in simple mode), makes one job per printer per slip on the Phase 1 lifecycle (lease → write → ack, REPRINT/DUPLICATE, the waiting-slips panel), and each printer is a line of its own, leased only by the one device that writes to it (§9.3). The setup screens edit Stations, Printers and the station of each category and item.

**Tech stack:**
- `packages/shared` (TS, node:test via `tsx`);
- `apps/cafe` (Next.js 15.5, Mongoose 8, Zod 3, node:test via `tsx`, live-Mongo legs);
- `apps/desktop` (Electron) from Session 2E;
- `apps/mobile` (React Native 0.87 + Kotlin) from Session 2F.

**Spec:** [docs/superpowers/specs/2026-10-02-printing-reliability-design.md](../specs/2026-10-02-printing-reliability-design.md). Read these sections before starting: §5, §6.1–6.3 and §6.6, §8, §9.1–9.3 and §9.7, §10, §11, §14, §17; and §7 (with §7.10, every gate ruling) for the lifecycle every printers-mode job rides.

**Phase 1:** done, reviewed and merged to `main` (`5f73b36`, then the 2026-10-03 release `6ee2b1d`). Its plan, every gate record and ruling: [2026-10-02-phase-1-lifecycle.md](2026-10-02-phase-1-lifecycle.md). Phase 2 builds on that `main`.

---

## How Phase 2 is split

Phase 2 runs as **seven sessions, 2A → 2G**, each on `feat/printing-phase-2` (branched from `main` at `6ee2b1d`). Each session ends with:
- all suites green;
- the Next build;
- both APK builds;
- an emulator check;
- a filled-in Results section for that session.

| Session | Delivers | Behaviour change for a cafe |
|---|---|---|
| **2A (this prompt)** | The dormant server core: the shared stations/printers contract; the `Station` and `Printer` models, a station on categories and items, a printer line on print jobs; routing (§8) as a pure function; the stations and printers API (admin writes); the routing read; the budget recount; live legs ah–aj | **None.** No screen calls the new routes and no request routes through printers yet: a cafe prints exactly as today, even with printers saved through the API. |
| 2B | **Direct print on the asking device** (decision 15, the owner's ask of 2026-10-04) and **no realtime message to yourself** (decision 16), in simple mode first: the job of a slip the asking tab prints itself is made already leased to it, its answer carries it, the tab prints at once; the replay delivers a lost answer again; the ack answers `more` (decision 9) | A host, or a device with no host, prints its own slips with no lease request and no realtime message: faster, and one request per slip instead of two |
| 2C | Printers mode goes live on the server: job creation routes through printers (direct print per printer line); a lease per printer line, only by its writer; the sweep and the repair in printers mode; the writers' wake allowance; the station line on the KOT; copies; the agent prints the printers it writes on its one local printer; a `print-setup` realtime kind | A cafe with printers set up prints by station (one printer per device) |
| 2D | The setup screens (spec §11) on the admin Printer setup page: Printers (add, edit, test print, enable), Stations (and the station of each category, an item's own station), Devices; "Set up printers" (simple mode → Printer 1, no change on paper); this device's bill printer | Staff set printers and stations up themselves |
| 2E | Several printers per device, web and Windows: the device-printer store per printer, the agent drives each printer in parallel, the Windows app's printer list; a Chrome tab keeps one printer | A counter PC or a browser device drives its printers |
| 2F | Android bridge v2 beside v1 (an old page on the new APK prints exactly as today) and the Kotlin printer pool, with pure-JVM unit tests | One phone or tablet drives several Bluetooth, USB and LAN printers |
| 2G | The Phase 2 exit (spec §14) on the harness and the emulator, TEST-CHECKLIST for real printers, the free-tier measurement in both modes | Release candidate |

**Gate rule** ([[phase-per-session-workflow]]):
- After each session, the orchestrating review session deep-reviews it.
- It then writes the next session's exact code into this plan, against the code that actually landed, pre-validates it on a scratch clone, and commits it before handing over that session's prompt.
- Sessions 2B–2G below are therefore task specifications with their interfaces, tests and exit checks. Their code is written at their gate.
- Session 2A is complete, exact code, pre-validated.

**Nothing is deployed by a session.** Phase 1 reaches cafes only through the owner's go-live run of `main`; Phase 2 reaches `main` only on the owner's explicit merge OK after its exit, and cafes only through a later go-live run (Worker first, then the app, then reload every POS screen).

---

## Global Constraints

- **Branch:** `feat/printing-phase-2` only. Check with `git branch --show-current`. Never commit to `main` and never merge; the owner decides merges. Push the feature branch only at a session's end and only with the repo's token credential (`GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-2`; never Git Credential Manager or the owner's main account; never print the token). `origin/main` can move while you work (the owner works on it): pull it into the branch only when the plan says so (`--no-ff`, then every suite again).
- **Free tier forever** (spec §2, §17):
  - Each cafe runs on its own Vercel Hobby + Atlas M0 + Cloudflare free accounts.
  - No paid service, no Vercel Cron, no new recurring request on ordering devices.
  - Every new recurring request must fit §17, and `packages/shared/src/print-budget.test.ts` pins it (Session 2A's recount: stations 4,800 / heavy 5,790 a normal day, 17,628 worst; 2 realtime requests per slip in printers mode).
  - Mongo writes stay at ≤ 3 per slip, plus ≤ 1 device upsert per 30 s. Printers mode adds at most three small reads to an order request (the routing read), simple mode one.
- **No connectors and no uploads.** No claude.ai connector, ever. Nothing from this repo (code, diffs, plans, reports, screenshots, test pages, logs) goes to Artifacts, Claude Docs or any other external service, even if a tool or skill suggests it. Reports go in the chat (Hinglish) and in English repo docs on the branch.
- **House rules for models** (spec §6):
  - plain default-bound models, not in the federated registry (Category and Product already are; their new `stationId` is a plain optional field);
  - no TTL index (ttl-guard);
  - omit-empty optional fields, with no `default:` (arrays say `default: undefined`).
- **Server libs:**
  - never call `connectDB()` (routes do);
  - no `console.*`;
  - strict TS, no `any`;
  - a file stays under ~300 lines.
- **Routes:**
  - Use `requireAuth()` or `requireAdmin()` (setup writes are admin-only).
  - Validate with Zod schemas kept in a lib file (a route file cannot export extra names). Validate `[id]` with `mongoose.isValidObjectId`.
  - Wrap every response after the guards in `noStore(...)`; every 500 is `noStore(serverError(...))`.
  - Staff names fall back to `"Staff"` (a Mongoose `required` string refuses `""`).
- **Simple mode and old clients keep working** (spec §6.6, §15):
  - Until an enabled printer takes a slip, every request routes exactly as in Phase 1.
  - Phase 1's `/claim`, `/kot-claim`, the read-only `GET /api/print-jobs/wake` and the optional headers stay.
  - An APK with bridge v1 keeps printing: simple mode as today, and in printers mode one printer per device (Session 2F).
- **Tests:**
  - cafe: a new test file is appended to `testChain` in `apps/cafe/package.json`.
  - shared: a new test file is added to the `test` script in `packages/shared/package.json`.
  - DB-touching code is tested three ways: pure helpers (unit), source pins (`readFileSync` + `stripComments`), and live legs (`npm run verify:print:live`, local mongod, `pos_scratch_*` databases only).
  - Changing an existing pin is allowed only to follow a deliberate change in this plan. Keep the pin's intent and name each changed pin in Results.
  - A failing `assert.ok(x)` with no message hangs a big test file under tsx: give every new `assert.ok` a message.
- **Windows + Git Bash:**
  - Set `GRADLE_USER_HOME='D:\gradle-home'` for every Gradle command.
  - Set `MSYS_NO_PATHCONV=1` and use Windows-style paths for adb (only for adb and Python calls).
  - Run npm for the mobile app only inside `apps/mobile`.
  - Heredocs in the Bash tool collapse `\\` to `\`. Write code with backslashes using the Write/Edit tools.
  - Docker holds `127.0.0.1:8080`, `8090`, `8094–8096`, `8098` and `8099`. Check `netstat -ano | grep LISTEN` before serving. Free ports were 8097, 8110–8114, 3100, 3200 and 9100–9102.
  - D: had about 5 GB free and C: about 14 GB on 2026-10-03. With C: under ~2 GB the emulator exits with code 21 at `-memory 4096`; boot it at `-memory 2048` then.
  - Start the emulator and any long-lived server as a background command with `timeout: 7200000`; the default timeout kills them.
- **No temp files inside the repo.** Use the session scratchpad. Never delete files you did not create. Do not revert or "clean up" changes you did not make. Leave the git-ignored `.superpowers/sdd/` and `.playwright-mcp/` alone.
- **Demo POS** `https://posdemo.sandbee.in` ("Olivea Pizza") runs a deployed `main`. Use it only for read-only load checks; never sign in. **The emulator's app may already be signed in to it** (it was on 2026-10-03, the owner's own test): before any tap that writes (a printer, "Print all slips on this device", an order), check the cafe name and menu on screen. The local POS shows the seeded menu (Masala Chai, Margherita Pizza…) and "POS Software". To use the local POS, change the app's address with More options → Change POS address, and put the owner's address back at the end.
- **Known skip:** cafe `npm test` has exactly one skipped test, the `go-live-dl` pin whose planning file is absent on this PC (Phase 1 Task C5b). Anything else skipped or failing is real.
- **Language:** talk to the owner in Hinglish. Repo docs and code comments stay in English, and comments say *why*.

---

## Decisions this plan makes (spec deviations, each deliberate)

1. **One writer per printer in Phase 2.** A device printer is written only by its own device; a LAN printer only by the device chosen as its printing device (`primaryDeviceId`, required for LAN). Spec §9.3's "otherwise any online device with LAN capability" and the backup printer of §9.4 are Phase 3's failover (spec §14 puts §9.3–9.4 there). Until then a printer whose writer is off waits, visibly, in the waiting-slips panel.
2. **All copies of a slip are one job** (`PrintJob.copies`, 1–3), not one job per copy (spec §6.5's `copyIndex`). A copy then never costs another lease and ack (§17), and the copies print back to back. A retry that may repeat paper repeats every copy, labelled REPRINT/DUPLICATE.
3. **A printers-mode job key adds the station:** `<slip key>:<printerId | none>:<stationId | all | ->`. Spec §6.5's key has no station part, but a printer that takes two stations gets one slip per station. Simple mode keeps today's keys (Phase 1 ruling R2).
4. **A station no printer takes rides the full copy.** Spec §8 says to send it "to the kotAll printers, labelled with the station name"; as a separate slip, every KOT of a cafe with one full-copy printer and the default station would print twice. The full copy already holds those lines. With no full-copy printer it goes to the default bill printer as "BAR (NO PRINTER SET)" (spec §8), and with neither it fails at once, visibly ("No printer is set up for Bar."): a KOT is never dropped.
5. **A full copy that is its round's only slip is today's KOT, unchanged.** Beside station slips it says "ALL STATIONS". A cafe converted from simple mode (Printer 1 takes bills, the full copy, notices and End of day) sees no change on paper.
6. **Notices follow the KOT.** A void, moved or cancel notice goes to every printer the station's KOT reaches (its own printers, the full copies, the fallback) that has Notices on; none, none printed (staff switched notices off there). The voided item's station is resolved from today's menu at the void (order lines store no station).
7. **The device's bill printer lives on the device** and rides the request as a header (`x-pos-bill-printer`, Session 2C; the picker in Session 2D), instead of spec §6.4's `PrintDevice.billPrinterId`: an ordering-only device has no `PrintDevice` row (only pollers beat, Phase 1 ruling R6), and rows go after 7 days unseen. A device that loses its storage falls back to the default bill printer.
8. **In printers mode only writers poll the wake**, sharing `PRINT_WAKE_PRINTERS_DAILY_CAP` (14,000) split by the writers the setup names, never by who is online. This is the "server-side split" spec §7.10 asked for, with no new write; a writer that starts late never raises the total.
9. **The ack answers `more`** (Session 2B), so an agent never leases to find an empty line; with copies as one job, a slip stays at one lease and one ack (A5's pins).
10. **No `backupPrinterId` and no `health` on `Printer` yet.** Both are Phase 3 (failover, `DLE EOT` paper status); nothing in Phase 2 would read them. Phase 2's printer dot is its writer's heartbeat and link state (Session 2D).
11. **The setup screens live on the admin Printer setup page (`/printers`), not in Settings.** Settings sections are bound to fields of the Settings document, and `settings-sections.test.ts` forbids a "Printer setup" section; `/printers` is already the admin home of printing.
12. **Bridge v2 keeps v1** (Session 2F). The new APK answers v1 messages exactly as today (one printer), so a page that is not deployed yet keeps printing with the new APK (today's web refuses any bridge whose version is not 1: `native-bridge.ts:117`); a v2 page opts in.
13. **A deleted station is cleared everywhere it was chosen** (categories, items, printers' KOT stations); the default station can't be deleted, only moved. The owner's rule: no stale print data.
14. **The routing read is never cached.** A printer switched off stops getting slips at once; simple mode pays one small read per order request.
15. **Direct print on the asking device** (the owner, 2026-10-04: "if the host itself makes the order, print there directly"). When the device that makes a request is the one that prints a slip (simple mode: the host's own order, or any device's own slip with no host; printers mode: the writer of the slip's printer), the server makes that slip's job already leased to the asking tab, in the same write, and the request's answer carries the leased job: the tab prints at once and acks. No lease request, no realtime message, no poll: one request per slip (its ack) instead of two, and one database write fewer. It applies only when the tab says it can print now (it drains this device's slips and its printer is ready: header `x-pos-print-lease: <tabId>`, in printers mode with its ready printers) and the slip is the head of its line (§7.6), and only to the first slip of each line in one request (a Pay Now's bill follows its KOT through the ack's `more`). Every other slip is made `queued` exactly as today. Failures stay inside Phase 1's rules: a tab that dies before printing lets the lease expire in 90 s (KOT: REPRINT; bill: the cashier's question); an answer that never arrived is delivered again to the same tab when the client re-sends the slip (the enqueue finds the job leased to that tab), and the agent ignores a job it already holds, is printing or has printed (at-least-once delivery, an idempotent consumer; one (id, epoch) prints once however it reached the tab: Session 2B's final review, C-1, worded at the 2B gate).
16. **No realtime message to yourself.** A job leased at creation publishes nothing: not its "queued" print-status, not the host's print-job nudge, and not its final state when the tab that made it acks it. Realtime (with the poll and the pulse as fallbacks) carries only the slips another device prints, or another tab of the same device. A cafe whose one device takes and prints its orders then spends almost no Cloudflare requests on printing. *(The 2A review gate, G-1: no job's final state is published any more, since no device listened for it; see "2A review gate: rulings".)*

The spec carries decisions 1–14 as §8.1 "Phase 2 decisions" and decisions 15–16 as §7.11 "Direct print on the asking device" (written with this plan), so it stays the source of truth.

---

## Review Focus

The five input classes most likely to bite a cafe in Session 2A's code that unit tests alone would not exercise. Each has a live leg or a routing test.

1. **Two devices open printer setup at once on a fresh cafe** (two first reads of the stations): exactly one default station, "Kitchen". → leg (ah).
2. **A station is deleted while categories, items and printers still point at it:** every pointer is cleared (the field is gone, never `null`), and a pointer that slipped through still falls back to the default. → leg (ah); routing test "an item whose station is unknown or deleted".
3. **A printer is re-saved from LAN to a device printer, or back:** no host, port or printing device is left behind, and its place in the order is kept unless changed. → leg (ai).
4. **A cafe converted to one printer** (Bill, Full KOT copy, Notices, End of day on Printer 1): its KOT is today's slip, the very same request. → routing test "a full copy that is the round's only slip".
5. **A KOT for a station nobody prints:** never dropped. The full copy covers it, else the default bill printer prints it as "(NO PRINTER SET)", else it fails at once and shows. → routing tests.

---

## File map (Session 2A)

| File | Change | Task |
|---|---|---|
| `packages/shared/src/print-printers.ts` (+ test), `packages/shared/package.json` | the shared contract; the KOT station header | A1, A3 |
| `apps/cafe/models/Station.ts`, `apps/cafe/models/Printer.ts` | the new models | A2 |
| `apps/cafe/models/Category.ts`, `Product.ts`, `PrintJob.ts`; `packages/shared/src/schemas/category.schema.ts`, `product.schema.ts`, `types.ts`; `apps/cafe/app/api/categories/[id]/route.ts`, `apps/cafe/app/api/products/[id]/route.ts` | `stationId`; `printerId`, `copies` and the printer line index | A2 |
| `apps/cafe/lib/print-printers-model.test.ts`, `print-job-model.test.ts`; `packages/shared/src/schemas/category.schema.test.ts`, `product.schema.test.ts` | model and schema tests | A2 |
| `packages/shared/src/schemas/print-job.schema.ts` | the KOT payload's optional `station` | A3 |
| `apps/cafe/lib/print-printer-routing.ts` (+ test) | routing, spec §8 | A3 |
| `apps/cafe/lib/print-printer-schemas.ts`, `print-stations.ts`, `print-printers.ts`, `print-routing-context.ts`, `print-setup-paths.test.ts` | the setup libs and the routing read | A4 |
| `apps/cafe/app/api/stations/route.ts`, `stations/[id]/route.ts`, `printers/route.ts`, `printers/[id]/route.ts` | the setup API | A4 |
| `packages/shared/src/print-budget.ts`, `print-agent-wire.ts`, `print-budget.test.ts` | the budget recount; who polls in printers mode | A5 |
| `apps/cafe/scripts/print-host-live/printers.ts`, `apps/cafe/scripts/verify-print-host-live.ts` | live legs ah–aj | A6 |
| `apps/cafe/package.json` | `testChain` gains three files | A2–A4 |
| this plan | Session 2A Results | A7 |

---

## Session 2A

**Pre-validated** by the orchestrating session on 2026-10-03/04, on scratchpad clones only (never in the repo):
- The code was developed on a golden copy of `6ee2b1d` (this branch's base, `main`), one commit per task, and this section was generated from those commits: every Create block is the golden file byte for byte, and every find is unique in its file at the moment it is applied.
- A fresh clone of `feat/printing-phase-2` then got every block of this section applied verbatim, task by task, with each task's own Run lines; each RED and GREEN below is the output seen there. Its code came out byte-identical to the golden copy (golden tree `0d24015…`; the clone differs only by this plan's own docs commit).
- Totals on that code: shared `npm test` **667/667** (+21), tsc 0; cafe `npm test` **4300 tests, 4299 pass, 0 fail, 1 skipped** (+37 over `main`'s 4263; the skip is Phase 1's `go-live-dl` pin), tsc 0, lint 0 errors and the 2 old warnings; Hub tsc 0; mobile 117/117 and Jest 3/3, desktop 191/191 (untouched); print tools 8/8; live legs **`248 passed, 0 failed`** (220 + 28); the Next build lists **127 routes** (`main`'s 123 plus the four setup routes).
- **Run on the emulator** (`Pixel_7_API_33`, WebView 109, the release APK) against the golden build and the fake printer, exactly as Task A7 Step 4: a KOT made by a second device printed once at the app as print host (44,454 B, no `printerId`); the setup API answered as Step 4 expects (stations 200 with the default Kitchen, Bar 201, three printers 201, a category on the Bar 200; both lists 200 and `no-store`; a bad id 404; a LAN printer with no printing device 400); with the three printers saved, the next KOT still printed exactly once and unchanged (44,454 B; the decoded slip has no station line; `withPrinterId: 0`, `withCopies: 0`); the teardown answered 200 four times and left no station on a category; Pay Now from the app printed the KOT, then the bill, once each.
- After the owner's ask of 2026-10-04 added Session 2B (direct print), eight comment lines in A3 and A4 were renumbered (2B → 2C, 2C → 2D); no code changed. The verbatim apply on a fresh clone and every suite above were run again after it (same results); the build and the emulator run are from just before it.

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 2A delivers.** Everything Phase 2's later sessions build on, with no change for a cafe: the shapes and rules every side shares, the models, routing as a pure function proven row by row against spec §8, the setup API that Session 2D's screens will call, the routing read that Session 2C's job creation will call, and the budget recount that holds Phase 2 inside the free tier.

**Not in 2A:** no direct print (2B), no request routes through printers (2C), no screen (2D), no client change at all, no Kotlin or Windows change. The APKs and the Windows app are unchanged.

The tasks run in this order: A1 → A6 (each one commit), then A7 (verification, the emulator check, Results).

---

### Task A1: the shared contract: stations and printers, the simple-mode switch, writers, the default station and bill printer

**Files:**
- Create: `packages/shared/src/print-printers.ts` (constants, `StationConfig`, `PrinterConfig`, `PrinterConnection`, `PrinterSlips`, `PrinterCopies`; `printerWriterDeviceId`, `printerTakesSlips`, `routablePrinters`, `printersModeOn`, `defaultBillPrinterOf`, `printerWriterDevices`, `defaultStationOf`, `resolveStationId`)
- Create: `packages/shared/src/print-printers.test.ts`
- Modify: `packages/shared/package.json` (the test script runs the new file)

**Interfaces produced:** `STATION_NAME_MAX_CHARS` 32, `STATIONS_MAX` 20, `DEFAULT_STATION_NAME` "Kitchen", `PRINTER_NAME_MAX_CHARS` 40, `PRINTERS_MAX` 12, `PRINTER_PAPER_WIDTHS` [58, 80], `PRINTER_COPIES_MIN` 1, `PRINTER_COPIES_MAX` 3, `PRINTER_LAN_DEFAULT_PORT` 9100, `PRINTER_ADDRESS_MAX_CHARS` 256, `PRINTER_DEVICE_ID_MAX_CHARS` 64, `PRINTER_DEVICE_TRANSPORTS`; `printerWriterDeviceId(printer): string | null`; `printerTakesSlips(slips): boolean`; `routablePrinters(printers): PrinterConfig[]`; `printersModeOn(printers): boolean`; `defaultBillPrinterOf(printers): PrinterConfig | null`; `printerWriterDevices(printers): string[]`; `defaultStationOf(stations): StationConfig | null`; `resolveStationId({ productStationId?, categoryStationId? }, stations): string | null`.

**Why a shared module.** The server's routing (A3), the setup routes (A4), the budget pins (A5), and from Sessions 2C and 2D the agent and the setup screens all read the same printer and station shapes and the same three rules: when a cafe leaves simple mode (spec §6.6: an enabled printer with a writer takes a slip), who writes to a printer (spec §9.3: a device printer's own device, a LAN printer's primary; Phase 3 adds failover), and where an item prints (spec §6.2: the item's station, else its category's, else the default; a deleted station falls back). Pure and client-safe, like `print-lifecycle.ts`.

- [ ] **Step 1: The failing tests first**

In `packages/shared/package.json`, find:

```json
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/codec.test.ts src/api-client.test.ts src/ttl-guard.test.ts src/schemas/table.schema.test.ts src/schemas/order.schema.test.ts src/order-idem.test.ts src/schemas/order-charge.schema.test.ts src/schemas/settings.schema.test.ts src/schemas/due-payment.schema.test.ts src/schemas/product.schema.test.ts src/schemas/public-order.schema.test.ts src/schemas/object-id.schema.test.ts src/product-import.test.ts src/utils.test.ts src/public.test.ts src/self-order-alert.test.ts src/telegram-alert.test.ts src/appearance-contrast.test.ts src/appearance.test.ts src/print-job.test.ts src/public-diner.test.ts src/cache.test.ts src/loyalty-rules.test.ts src/schemas/settings-loyalty.schema.test.ts src/appearance-theme-override.test.ts src/reward-redemption.test.ts src/promo-ttl.test.ts src/modifiers.test.ts src/product-icons.test.ts src/schemas/product-bulk.schema.test.ts src/schemas/category.schema.test.ts src/schemas/area.schema.test.ts src/print-host-printer.test.ts src/print-lifecycle.test.ts src/print-budget.test.ts"
  },
  "dependencies": {
    "clsx": "^2.1.1",
```

Replace it with:

```json
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/codec.test.ts src/api-client.test.ts src/ttl-guard.test.ts src/schemas/table.schema.test.ts src/schemas/order.schema.test.ts src/order-idem.test.ts src/schemas/order-charge.schema.test.ts src/schemas/settings.schema.test.ts src/schemas/due-payment.schema.test.ts src/schemas/product.schema.test.ts src/schemas/public-order.schema.test.ts src/schemas/object-id.schema.test.ts src/product-import.test.ts src/utils.test.ts src/public.test.ts src/self-order-alert.test.ts src/telegram-alert.test.ts src/appearance-contrast.test.ts src/appearance.test.ts src/print-job.test.ts src/public-diner.test.ts src/cache.test.ts src/loyalty-rules.test.ts src/schemas/settings-loyalty.schema.test.ts src/appearance-theme-override.test.ts src/reward-redemption.test.ts src/promo-ttl.test.ts src/modifiers.test.ts src/product-icons.test.ts src/schemas/product-bulk.schema.test.ts src/schemas/category.schema.test.ts src/schemas/area.schema.test.ts src/print-host-printer.test.ts src/print-lifecycle.test.ts src/print-budget.test.ts src/print-printers.test.ts"
  },
  "dependencies": {
    "clsx": "^2.1.1",
```

Create `packages/shared/src/print-printers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATION_NAME,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_PAPER_WIDTHS,
  defaultBillPrinterOf,
  defaultStationOf,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
  printersModeOn,
  resolveStationId,
  routablePrinters,
  type PrinterConfig,
  type StationConfig,
} from "./print-printers";

// Printing redesign, Phase 2 (spec §6.1–6.3, §8, §9.3): the pure rules every side reads.

const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name: `Printer ${id}`,
    connection: { kind: "device", deviceId: `dev-${id}`, transport: "bt-classic", address: "00:11:22:33:44:55" },
    order: 0,
    paper: 80,
    slips: { ...NO_SLIPS, bill: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

function station(id: string, order: number, isDefault = false): StationConfig {
  return { id, name: `Station ${id}`, order, isDefault };
}

test("the spec's constants: the seeded station, the paper widths, 1–3 copies, every device transport", () => {
  assert.equal(DEFAULT_STATION_NAME, "Kitchen", "spec §6.1");
  assert.deepEqual([...PRINTER_PAPER_WIDTHS], [58, 80]);
  assert.equal(PRINTER_COPIES_MIN, 1);
  assert.equal(PRINTER_COPIES_MAX, 3);
  assert.deepEqual([...PRINTER_DEVICE_TRANSPORTS], ["bt-classic", "ble", "usb", "windows", "web-serial", "web-bluetooth"]);
});

test("a device printer's writer is its own device; a LAN printer's is its primary, or nobody yet", () => {
  assert.equal(printerWriterDeviceId(printer("a")), "dev-a");
  const lan = printer("b", { connection: { kind: "lan", host: "192.168.1.50", port: 9100 } });
  assert.equal(printerWriterDeviceId(lan), null, "a LAN printer with no primary has no writer in Phase 2");
  assert.equal(printerWriterDeviceId({ ...lan, primaryDeviceId: "tablet-1" }), "tablet-1");
});

test("a printer takes slips when any slip type is on", () => {
  assert.equal(printerTakesSlips(NO_SLIPS), false);
  for (const on of [{ bill: true }, { kotAll: true }, { kotStations: ["s1"] }, { notices: true }, { eod: true }]) {
    assert.equal(printerTakesSlips({ ...NO_SLIPS, ...on }), true, JSON.stringify(on));
  }
});

test("spec §6.6: simple mode until an enabled printer with a writer takes a slip", () => {
  assert.equal(printersModeOn([]), false, "no printers: simple mode");
  assert.equal(printersModeOn([printer("a", { enabled: false })]), false, "a disabled printer never switches the mode");
  assert.equal(printersModeOn([printer("a", { slips: NO_SLIPS })]), false, "a printer that takes nothing never switches the mode");
  assert.equal(
    printersModeOn([printer("a", { connection: { kind: "lan", host: "10.0.0.9", port: 9100 } })]),
    false,
    "a LAN printer nobody writes to yet never switches the mode",
  );
  assert.equal(printersModeOn([printer("a", { enabled: false }), printer("b")]), true);
});

test("routable printers come in display order, ties by id, whatever order the read returned", () => {
  const list = [printer("c", { order: 2 }), printer("b", { order: 1 }), printer("a", { order: 1 }), printer("d", { order: 0, enabled: false })];
  assert.deepEqual(routablePrinters(list).map((p) => p.id), ["a", "b", "c"]);
});

test("the default bill printer is the first routable printer that takes bills (spec §8)", () => {
  const counter = printer("counter", { order: 2 });
  const kitchen = printer("kitchen", { order: 1, slips: { ...NO_SLIPS, kotStations: ["s1"] } });
  const bar = printer("bar", { order: 3 });
  assert.equal(defaultBillPrinterOf([bar, kitchen, counter])?.id, "counter");
  assert.equal(defaultBillPrinterOf([kitchen]), null, "no printer takes bills");
  assert.equal(defaultBillPrinterOf([printer("x", { enabled: false })]), null, "a disabled printer is never the default");
});

test("the writer devices share the cafe's wake allowance: each once, only for routable printers", () => {
  const list = [
    printer("a", { connection: { kind: "device", deviceId: "counter", transport: "usb", address: "usb:0483:5743" } }),
    printer("b", { connection: { kind: "device", deviceId: "counter", transport: "bt-classic", address: "AA:BB" } }),
    printer("c", { connection: { kind: "lan", host: "192.168.1.60", port: 9100 }, primaryDeviceId: "kitchen-tab" }),
    printer("d", { connection: { kind: "lan", host: "192.168.1.61", port: 9100 } }),
    printer("e", { enabled: false, connection: { kind: "device", deviceId: "old-phone", transport: "ble", address: "CC" } }),
  ];
  assert.deepEqual(printerWriterDevices(list), ["counter", "kitchen-tab"]);
});

test("the default station: the one marked default, else the first in order, else none (spec §6.1)", () => {
  assert.equal(defaultStationOf([station("bar", 1), station("kitchen", 0, true)])?.id, "kitchen");
  assert.equal(defaultStationOf([station("bar", 2), station("tandoor", 1)])?.id, "tandoor", "no default flag: the first in order");
  assert.equal(defaultStationOf([station("b", 0, true), station("a", 0, true)])?.id, "a", "two flagged: order, then id");
  assert.equal(defaultStationOf([]), null);
});

test("spec §6.2: product station ?? category station ?? the default; a deleted station falls back", () => {
  const stations = [station("kitchen", 0, true), station("bar", 1), station("tandoor", 2)];
  assert.equal(resolveStationId({ productStationId: "bar", categoryStationId: "tandoor" }, stations), "bar", "the item override wins");
  assert.equal(resolveStationId({ categoryStationId: "tandoor" }, stations), "tandoor", "else the category's");
  assert.equal(resolveStationId({}, stations), "kitchen", "else the default");
  assert.equal(resolveStationId({ productStationId: "gone", categoryStationId: "tandoor" }, stations), "tandoor", "a deleted item station falls back to the category's");
  assert.equal(resolveStationId({ productStationId: "gone", categoryStationId: "gone-too" }, stations), "kitchen", "and then to the default");
  assert.equal(resolveStationId({ productStationId: "bar" }, []), null, "no stations at all: none");
});
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

Create `packages/shared/src/print-printers.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Printing redesign, Phase 2 (docs/superpowers/specs/2026-10-02-printing-
// reliability-design.md §6.1–6.3, §8, §9.3): kitchen stations and printers, the
// shared contract. A cafe stays in simple mode (§6.6: today's one print host, or
// each device printing its own slips) until an enabled printer takes a slip;
// from then on every slip is routed to printers (§8). The server's routing, the
// setup screens and the agent read these same shapes and rules. Pure and
// client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

/** A station's name prints on every KOT it gets (§8, D7), so it stays short. */
export const STATION_NAME_MAX_CHARS = 32;
export const STATIONS_MAX = 20;
/** The station the first read seeds (§6.1); every category without a station uses the default one. */
export const DEFAULT_STATION_NAME = "Kitchen";

export const PRINTER_NAME_MAX_CHARS = 40;
export const PRINTERS_MAX = 12;
export const PRINTER_PAPER_WIDTHS = [58, 80] as const;
export type PrinterPaperWidth = (typeof PRINTER_PAPER_WIDTHS)[number];
export const PRINTER_COPIES_MIN = 1;
export const PRINTER_COPIES_MAX = 3;
export const PRINTER_LAN_DEFAULT_PORT = 9100;
/** A device printer's transport-specific id (a Bluetooth address, a USB id, a Windows printer name). */
export const PRINTER_ADDRESS_MAX_CHARS = 256;
/** Equal to the cafe's PRINT_HOST_DEVICE_ID_MAX_CHARS (pinned there): a device id is the same value everywhere. */
export const PRINTER_DEVICE_ID_MAX_CHARS = 64;

/** How the owning device reaches a device printer (§6.3). A Chrome tab drives at most one Web Serial or
 *  Web Bluetooth printer (§9.7). */
export const PRINTER_DEVICE_TRANSPORTS = ["bt-classic", "ble", "usb", "windows", "web-serial", "web-bluetooth"] as const;
export type PrinterDeviceTransport = (typeof PRINTER_DEVICE_TRANSPORTS)[number];

export interface StationConfig {
  id: string;
  name: string;
  order: number;
  isDefault: boolean;
}

export type PrinterConnection =
  | { kind: "lan"; host: string; port: number }
  | { kind: "device"; deviceId: string; transport: PrinterDeviceTransport; address: string };

/** Which slips a printer takes (§6.3). kotStations: the stations whose KOTs it prints; kotAll: a full copy
 *  of every KOT (a counter or expo printer); notices: void, moved and cancel notices for the stations it
 *  serves; eod: End of day. */
export interface PrinterSlips {
  bill: boolean;
  kotStations: string[];
  kotAll: boolean;
  notices: boolean;
  eod: boolean;
}

/** Copies of each KOT and each bill. All copies of one slip are ONE job (Phase 2 decision: a copy never
 *  costs another lease and ack, spec §17). */
export interface PrinterCopies {
  kot: number;
  bill: number;
}

/** A printer as the API sends it and the routing reads it. */
export interface PrinterConfig {
  id: string;
  name: string;
  connection: PrinterConnection;
  /** LAN only: the device that writes to it (Phase 2 requires one; failover to other devices is Phase 3, §9.4). */
  primaryDeviceId?: string;
  /** Display order on Settings → Printers; the first bill printer in this order is the default one. */
  order: number;
  paper: PrinterPaperWidth;
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
}

/** The one device that writes to this printer (§9.3): a device printer's own device, or a LAN printer's
 *  primary. null: a LAN printer nobody writes to yet, so nothing is routed to it. */
export function printerWriterDeviceId(printer: Pick<PrinterConfig, "connection" | "primaryDeviceId">): string | null {
  if (printer.connection.kind === "device") return printer.connection.deviceId;
  return printer.primaryDeviceId ?? null;
}

/** True when the printer takes at least one kind of slip. */
export function printerTakesSlips(slips: PrinterSlips): boolean {
  return slips.bill || slips.kotAll || slips.kotStations.length > 0 || slips.notices || slips.eod;
}

/** The printers routing may send slips to: enabled, with a writer, taking some slip, in display order
 *  (ties broken by id, so the default bill printer never depends on a read's order). */
export function routablePrinters(printers: readonly PrinterConfig[]): PrinterConfig[] {
  return printers
    .filter((printer) => printer.enabled && printerWriterDeviceId(printer) !== null && printerTakesSlips(printer.slips))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Spec §6.6: simple mode applies while no enabled printer takes a slip. One routable printer switches the
 *  whole cafe to printers mode. */
export function printersModeOn(printers: readonly PrinterConfig[]): boolean {
  return routablePrinters(printers).length > 0;
}

/** The default bill printer (§8): the first routable printer that takes bills. */
export function defaultBillPrinterOf(printers: readonly PrinterConfig[]): PrinterConfig | null {
  return routablePrinters(printers).find((printer) => printer.slips.bill) ?? null;
}

/** The devices that write to a routable printer, each once. In printers mode these are the agents that
 *  share the cafe's one daily wake allowance (§9.1): a fixed set from the setup, so a device that joins
 *  late never raises the total. */
export function printerWriterDevices(printers: readonly PrinterConfig[]): string[] {
  const out: string[] = [];
  for (const printer of routablePrinters(printers)) {
    const writer = printerWriterDeviceId(printer);
    if (writer !== null && !out.includes(writer)) out.push(writer);
  }
  return out;
}

function byOrder(a: StationConfig, b: StationConfig): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The default station (§6.1): the one marked default, else the first in display order (a moment between
 *  "make default" writes, or a database edited by hand, never leaves routing without one). null only when
 *  there are no stations at all. */
export function defaultStationOf(stations: readonly StationConfig[]): StationConfig | null {
  const sorted = [...stations].sort(byOrder);
  return sorted.find((station) => station.isDefault) ?? sorted[0] ?? null;
}

/** Spec §6.2: product.stationId ?? category.stationId ?? the default station. A station that no longer
 *  exists is skipped, so a deleted station falls back the same way. null only when there are no stations. */
export function resolveStationId(
  ids: { productStationId?: string; categoryStationId?: string },
  stations: readonly StationConfig[],
): string | null {
  const known = new Set(stations.map((station) => station.id));
  if (ids.productStationId !== undefined && known.has(ids.productStationId)) return ids.productStationId;
  if (ids.categoryStationId !== undefined && known.has(ids.categoryStationId)) return ids.categoryStationId;
  return defaultStationOf(stations)?.id ?? null;
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 9`; `# pass 9`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/package.json packages/shared/src/print-printers.test.ts packages/shared/src/print-printers.ts
git commit -m "feat(print): Phase 2 stations and printers: the shared contract (types, the simple-mode switch, writers, the default station and bill printer)"
```

---

### Task A2: the models: Station and Printer, a station on categories and items, a printer line on print jobs (dormant)

**Files:**
- Create: `apps/cafe/models/Station.ts`, `apps/cafe/models/Printer.ts` (plain default-bound models, no TTL, unique names; `printerConnectionComplete`)
- Modify: `apps/cafe/models/Category.ts`, `apps/cafe/models/Product.ts` (`stationId?: ObjectId`, omit-empty, no default)
- Modify: `apps/cafe/models/PrintJob.ts` (`printerId?`, `copies?` 1–3; the printer line index `{printerId, status, createdAt, _id}`, partial on `printerId`)
- Modify: `packages/shared/src/schemas/category.schema.ts`, `packages/shared/src/schemas/product.schema.ts` (`stationId` optional on create; `null` clears it on update), `packages/shared/src/types.ts` (`stationId?` on `Category` and `Product`)
- Modify: `apps/cafe/app/api/categories/[id]/route.ts` (`stationId: null` removes the field), `apps/cafe/app/api/products/[id]/route.ts` (`stationId` joins `nullClearsFields`)
- Tests: `apps/cafe/lib/print-printers-model.test.ts` (create); `apps/cafe/lib/print-job-model.test.ts` (the index count 3 → 4, deliberately; two new tests); `packages/shared/src/schemas/category.schema.test.ts`, `product.schema.test.ts` (new tests); `apps/cafe/package.json` (testChain)

**Interfaces produced:** `Station`, `stationSchema`, `IStation`; `Printer`, `printerSchema`, `IPrinter`, `IPrinterConnection`, `printerConnectionComplete(c): boolean`; `ICategory.stationId?`, `IProduct.stationId?` (ObjectId); `IPrintJob.printerId?: string`, `IPrintJob.copies?: number`; `createCategorySchema`/`createProductSchema` accept `stationId?`, `updateCategorySchema`/`updateProductSchema` accept `stationId: string | null`.

**Dormant.** Nothing writes `printerId` or `copies` yet, and no request reads a station: the models, the index and the station fields exist so Session 2C's job creation and 2D's setup screens have them. A category or item saved with no station stores no `stationId` key (omit-empty), so every existing row keeps meaning "the default station" and the CSV import (which has no station column) can never clear one.

**The printer line index is partial** (`partialFilterExpression: { printerId: { $exists: true } }`): simple-mode rows never enter it, so it costs a simple-mode cafe nothing on M0, and every printer-line query names its `printerId`, which satisfies the filter. The Phase 1 pin "exactly three PrintJob indexes" becomes four (deliberate change, named in Results).

**No `backupPrinterId` and no `health` on Printer.** Spec §6.3 lists them; they belong to Phase 3 (failover, paper status), and nothing in Phase 2 would read them.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-job-model.test.ts`, find:

```ts
  // The Phase 1 final gate (m-1, deliberate change): the readback index served myRecentJobs, which the 1C gate
  // dropped; no query reads it, and on M0 it cost a write per insert and storage. Never deployed, so never built.
  assert.ok(!keys.some((k) => k.includes('"originDeviceId"')), "no originDeviceId index");
  assert.equal(keys.length, 3, "exactly three PrintJob indexes: the feed/prune one, the job-key fence and the line");
  assert.ok(keys.includes(JSON.stringify({ status: 1, createdAt: 1, _id: 1 })), "landmark: the prune/feed index stays");
});

test("PrintJob: every Phase 1 lifecycle field is absent on a minimal doc (omit-empty, the arrays included)", () => {
```

Replace it with:

```ts
  // The Phase 1 final gate (m-1, deliberate change): the readback index served myRecentJobs, which the 1C gate
  // dropped; no query reads it, and on M0 it cost a write per insert and storage. Never deployed, so never built.
  assert.ok(!keys.some((k) => k.includes('"originDeviceId"')), "no originDeviceId index");
  // Phase 2 Session 2A (deliberate change): a fourth index, one printer's line (the next test).
  assert.equal(keys.length, 4, "exactly four PrintJob indexes: the feed/prune one, the job-key fence, the device line and the printer line");
  assert.ok(keys.includes(JSON.stringify({ status: 1, createdAt: 1, _id: 1 })), "landmark: the prune/feed index stays");
});

// ── Phase 2 (plan 2026-10-03-phase-2-routing.md, Task A2) ──────────────────

test("PrintJob: Phase 2's printer line index, in exactly that key order, partial on printerId", () => {
  const match = printJobSchema.indexes().find(([fields]) => fields.printerId === 1);
  assert.ok(match, "expected a printer line index");
  const [fields, options] = match as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual(Object.keys(fields), ["printerId", "status", "createdAt", "_id"], "the head-of-line read: equality on printerId and status, then oldest first");
  // Partial: a simple-mode row (no printerId) never enters it, so it costs simple mode nothing on M0.
  assert.deepEqual(options.partialFilterExpression, { printerId: { $exists: true } });
  assert.equal(options.unique, undefined, "not unique: a printer's line holds many jobs");
});

test("PrintJob: printerId and copies stay absent on a simple-mode row; copies is 1–3", () => {
  const doc = new PrintJob({ ...MIN_JOB });
  assert.equal(doc.get("printerId"), undefined, "omit-empty: simple mode never writes it");
  assert.equal(doc.get("copies"), undefined, "omit-empty: absent means one copy");
  assert.equal(new PrintJob({ ...MIN_JOB, printerId: "64f000000000000000000001", copies: 3 }).validateSync(), undefined);
  assert.ok(new PrintJob({ ...MIN_JOB, copies: 0 }).validateSync()?.errors.copies, "no zero copies");
  assert.ok(new PrintJob({ ...MIN_JOB, copies: 4 }).validateSync()?.errors.copies, "at most three");
});

test("PrintJob: every Phase 1 lifecycle field is absent on a minimal doc (omit-empty, the arrays included)", () => {
```

Create `apps/cafe/lib/print-printers-model.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { stationSchema, Station } from "../models/Station";
import { printerSchema, Printer, printerConnectionComplete } from "../models/Printer";
import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { assertSchemaTtlAllowed } from "./ttl-guard";

// Printing redesign, Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A2): DB-free shape tests
// for the station and printer models and the station fields on Category and Product. Every assertion reads
// the compiled schema or validates an unsaved document (the print-job-model.test.ts idiom).

const KITCHEN_ID = "64f000000000000000000001";

function lanPrinter(over: Record<string, unknown> = {}) {
  return {
    name: "Kitchen printer",
    connection: { kind: "lan", host: "192.168.1.60", port: 9100 },
    primaryDeviceId: "kitchen-tab",
    order: 0,
    paper: 80,
    slips: { bill: false, kotStations: [KITCHEN_ID], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

test("Station: name is required, unique and trimmed; order and isDefault are required; timestamps on", () => {
  assert.equal(stationSchema.path("name").options.unique, true, "two stations with one name could never be told apart on paper");
  const err = new Station({}).validateSync();
  for (const p of ["name", "order", "isDefault"]) assert.ok(err?.errors[p], `${p} is required`);
  assert.equal(new Station({ name: "  Bar  ", order: 1, isDefault: false }).name, "Bar");
  assert.ok(new Station({ name: "x".repeat(33), order: 1, isDefault: false }).validateSync()?.errors.name, "a name prints on the slip: 32 characters at most");
  assert.equal(stationSchema.get("timestamps"), true);
});

test("Printer: a LAN printer and a device printer validate; name is unique; timestamps on", () => {
  assert.equal(new Printer(lanPrinter()).validateSync(), undefined);
  const device = lanPrinter({
    name: "Counter printer",
    connection: { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON TM-T82" },
    primaryDeviceId: undefined,
  });
  assert.equal(new Printer(device).validateSync(), undefined);
  assert.equal(printerSchema.path("name").options.unique, true);
  assert.equal(printerSchema.get("timestamps"), true);
});

test("Printer: a connection is either a LAN address or one device's printer, never a mix", () => {
  assert.equal(printerConnectionComplete({ kind: "lan", host: "10.0.0.5", port: 9100 }), true);
  assert.equal(printerConnectionComplete({ kind: "lan", host: "10.0.0.5" }), false, "a LAN printer needs its port");
  assert.equal(printerConnectionComplete({ kind: "lan", host: "10.0.0.5", port: 9100, deviceId: "x" }), false);
  assert.equal(printerConnectionComplete({ kind: "device", deviceId: "d", transport: "usb", address: "usb:0483:5743" }), true);
  assert.equal(printerConnectionComplete({ kind: "device", deviceId: "d", transport: "usb" }), false, "a device printer needs its address");
  assert.equal(printerConnectionComplete({ kind: "device", deviceId: "d", transport: "usb", address: "a", port: 9100 }), false);
  assert.equal(printerConnectionComplete(undefined), false);
  const mixed = new Printer(lanPrinter({ connection: { kind: "lan", host: "10.0.0.5", port: 9100, address: "x" } })).validateSync();
  assert.ok(mixed?.errors.connection, "the model refuses a mixed connection on its own");
});

test("Printer: paper, transport, copies and the slips are checked by the model too", () => {
  assert.ok(new Printer(lanPrinter({ paper: 76 })).validateSync()?.errors.paper, "58 or 80 only");
  const badTransport = new Printer(lanPrinter({ connection: { kind: "device", deviceId: "d", transport: "serial", address: "a" } })).validateSync();
  assert.ok(Object.keys(badTransport?.errors ?? {}).some((k) => k.startsWith("connection")), "an unknown transport is refused");
  assert.ok(new Printer(lanPrinter({ copies: { kot: 4, bill: 1 } })).validateSync()?.errors["copies.kot"], "at most three copies");
  assert.ok(new Printer(lanPrinter({ copies: { kot: 1, bill: 0 } })).validateSync()?.errors["copies.bill"], "at least one copy");
  const noSlips = new Printer(lanPrinter({ slips: undefined })).validateSync();
  assert.ok(noSlips?.errors.slips, "the slips are always stated");
});

test("Station and Printer: no TTL index (ttl-guard default-deny)", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Station", stationSchema));
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Printer", printerSchema));
  for (const schema of [stationSchema, printerSchema]) {
    assert.ok(schema.indexes().every(([, options]) => options?.expireAfterSeconds === undefined));
  }
});

test("a device id is the same value everywhere: the shared bound equals the print host's", () => {
  assert.equal(PRINTER_DEVICE_ID_MAX_CHARS, PRINT_HOST_DEVICE_ID_MAX_CHARS);
});

test("Category and Product: stationId is absent unless chosen (omit-empty: existing rows keep their meaning)", () => {
  const category = new Category({ name: "Drinks" });
  assert.equal(category.get("stationId"), undefined);
  const product = new Product({ name: "Tea", categoryId: KITCHEN_ID, price: 20 });
  assert.equal(product.get("stationId"), undefined);
  assert.equal(new Category({ name: "Drinks", stationId: KITCHEN_ID }).validateSync(), undefined);
  assert.equal(String(new Product({ name: "Tea", categoryId: KITCHEN_ID, price: 20, stationId: KITCHEN_ID }).get("stationId")), KITCHEN_ID);
});

function cafeSrc(rel: string): string {
  return stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
}

test("PIN: PUT /api/categories/[id] turns stationId:null into a removed field, never a stored null", () => {
  const src = cafeSrc("app/api/categories/[id]/route.ts");
  assert.match(src, /const \{ stationId, \.\.\.rest \} = parsed\.data;/);
  assert.match(src, /if \(stationId === null\) existing\.set\("stationId", undefined\);/);
  assert.ok(!/existing\.set\(parsed\.data\)/.test(src), "the whole body is never set as it came");
});

test("PIN: PUT /api/products/[id] clears stationId on null like icon and publicVisible", () => {
  const src = cafeSrc("app/api/products/[id]/route.ts");
  assert.match(src, /nullClearsFields: \["variations", "publicVisible", "icon", "stationId"\]/);
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/device-printer-teardown.test.ts",
    "lib/css-compat.test.ts",
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

Replace it with:

```json
    "lib/printer/device-printer-teardown.test.ts",
    "lib/css-compat.test.ts",
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

In `packages/shared/src/schemas/category.schema.test.ts`, find:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { reorderCategoriesSchema } from "./category.schema";
import { CATEGORY_REORDER_MAX } from "../constants";
import { MAX_IMPORT_ROWS } from "../product-import";

```

Replace it with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCategorySchema, reorderCategoriesSchema, updateCategorySchema } from "./category.schema";
import { CATEGORY_REORDER_MAX } from "../constants";
import { MAX_IMPORT_ROWS } from "../product-import";

```

In `packages/shared/src/schemas/category.schema.test.ts`, find:

```ts
  );
});

```

Replace it with:

```ts
  );
});

// ── Printing Phase 2 (spec §6.2): the category's kitchen station ────────────

test("createCategorySchema: stationId is optional with no default (absent = the default station)", () => {
  const r = createCategorySchema.safeParse({ name: "Drinks" });
  assert.equal(r.success, true);
  assert.ok(r.success && !("stationId" in r.data), "no stationId key unless one is chosen");
  assert.equal(createCategorySchema.safeParse({ name: "Drinks", stationId: ID1 }).success, true);
  assert.equal(createCategorySchema.safeParse({ name: "Drinks", stationId: "Bar" }).success, false, "only a station id");
});

test("updateCategorySchema: stationId:null means back to the default station; absent leaves it alone", () => {
  const cleared = updateCategorySchema.safeParse({ stationId: null });
  assert.equal(cleared.success && cleared.data.stationId, null);
  const renamed = updateCategorySchema.safeParse({ name: "Hot drinks" });
  assert.ok(renamed.success && !("stationId" in renamed.data), "a rename never touches the station");
});

```

In `packages/shared/src/schemas/product.schema.test.ts`, find:

```ts
  assert.equal(updateProductSchema.safeParse({ icon: "not-a-real-icon" }).success, false);
});

```

Replace it with:

```ts
  assert.equal(updateProductSchema.safeParse({ icon: "not-a-real-icon" }).success, false);
});

// ── Printing Phase 2 (spec §6.2): the item's own kitchen station ────────────

const STATION = "64f000000000000000000001";

test("createProductSchema: stationId is optional with no default (absent = the category's station)", () => {
  const r = createProductSchema.safeParse(BASE);
  assert.equal(r.success, true);
  assert.ok(r.success && !("stationId" in r.data), "an item made without a station has no stationId key");
  assert.equal(createProductSchema.safeParse({ ...BASE, stationId: STATION }).success, true);
  assert.equal(createProductSchema.safeParse({ ...BASE, stationId: "bar" }).success, false, "only a station id");
  assert.equal(createProductSchema.safeParse({ ...BASE, stationId: null }).success, false, "null is an update sentinel only");
});

test("updateProductSchema: stationId:null is the sentinel the route turns into an $unset; absent leaves it alone", () => {
  const cleared = updateProductSchema.safeParse({ stationId: null });
  assert.equal(cleared.success && cleared.data.stationId, null);
  const untouched = updateProductSchema.safeParse({ price: 130 });
  assert.ok(untouched.success && !("stationId" in untouched.data));
  assert.equal(updateProductSchema.safeParse({ stationId: STATION }).success, true);
});

test("the CSV import never sets a station: coerceProductRow has no station column", () => {
  const row = coerceProductRow({ name: "Tea", category: "Drinks", price: "20", stationId: STATION });
  assert.ok(!("stationId" in row), "an extra CSV column never reaches the product");
  const parsed = importProductRowSchema.safeParse({ name: "Tea", category: "Drinks", price: "20", stationId: STATION });
  assert.ok(parsed.success && !("stationId" in parsed.data), "the import row schema never carries one");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printers-model.test.ts lib/print-job-model.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 27`; `# pass 23`; `# fail 4`

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/schemas/category.schema.test.ts src/schemas/product.schema.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 37`; `# pass 33`; `# fail 4`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/categories/[id]/route.ts`, find:

```ts
    const existing = await Category.findById(id);
    if (!existing) return notFound("Category not found");

    existing.set(parsed.data);
    await existing.save();

    cache.del("categories");
```

Replace it with:

```ts
    const existing = await Category.findById(id);
    if (!existing) return notFound("Category not found");

    // Printing Phase 2 (spec §6.2): stationId null sends the category back to the default station by
    // removing the field (omit-empty); a plain set would STORE null.
    const { stationId, ...rest } = parsed.data;
    existing.set(rest);
    if (stationId === null) existing.set("stationId", undefined);
    else if (stationId !== undefined) existing.set("stationId", stationId);
    await existing.save();

    cache.del("categories");
```

In `apps/cafe/app/api/products/[id]/route.ts`, find:

```ts
  // icon works the same way: "Remove icon" sends null so the field goes back
  // to ABSENT — a stored explicit value here would defeat the catalogue's
  // append-only, omit-empty discipline (product-icons.ts).
  nullClearsFields: ["variations", "publicVisible", "icon"],
  softDelete: true,
});

```

Replace it with:

```ts
  // icon works the same way: "Remove icon" sends null so the field goes back
  // to ABSENT — a stored explicit value here would defeat the catalogue's
  // append-only, omit-empty discipline (product-icons.ts).
  // Printing Phase 2: "Use the category's station" sends stationId: null, back to ABSENT the same way.
  nullClearsFields: ["variations", "publicVisible", "icon", "stationId"],
  softDelete: true,
});

```

In `apps/cafe/models/Category.ts`, find:

```ts
import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface ICategory extends Document {
  name: string;
  order: number; // display order in POS
  createdAt: Date;
  updatedAt: Date;
}
```

Replace it with:

```ts
import mongoose, { Schema, Types, type Document, type Model } from "mongoose";

export interface ICategory extends Document {
  name: string;
  order: number; // display order in POS
  // Printing Phase 2 (spec §6.2): the kitchen station this category's items print at. ABSENT means the
  // default station (omit-empty, no default below: every category made before Phase 2 keeps meaning that).
  stationId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
```

In `apps/cafe/models/Category.ts`, find:

```ts
    // unique:true creates the index — no separate index() needed for name.
    name: { type: String, required: true, unique: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
```

Replace it with:

```ts
    // unique:true creates the index — no separate index() needed for name.
    name: { type: String, required: true, unique: true, trim: true },
    order: { type: Number, default: 0 },
    stationId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
```

In `apps/cafe/models/PrintJob.ts`, find:

```ts
  type PrintJobLease,
  type PrintJobLogEntry,
} from "@pos/shared/print-lifecycle";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B1) — a durable queued
// print job for the browser print host: any dashboard screen enqueues one of
```

Replace it with:

```ts
  type PrintJobLease,
  type PrintJobLogEntry,
} from "@pos/shared/print-lifecycle";
import { PRINTER_COPIES_MAX, PRINTER_COPIES_MIN } from "@pos/shared/print-printers";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B1) — a durable queued
// print job for the browser print host: any dashboard screen enqueues one of
```

In `apps/cafe/models/PrintJob.ts`, find:

```ts
  printedBy?: string; // the writing device's id, or the staff name
  lastError?: string;
  log?: PrintJobLogEntry[]; // the newest PRINT_JOB_LOG_MAX entries
  createdAt: Date;
  updatedAt: Date;
}
```

Replace it with:

```ts
  printedBy?: string; // the writing device's id, or the staff name
  lastError?: string;
  log?: PrintJobLogEntry[]; // the newest PRINT_JOB_LOG_MAX entries
  // Phase 2 (spec §6.5, §8): the printer this slip prints on, in printers mode. Absent in simple mode,
  // where targetDeviceId alone names the line. copies: how many times the writer prints it (1–3), ONE job
  // so a copy never costs another lease and ack (spec §17); absent means 1.
  printerId?: string;
  copies?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

In `apps/cafe/models/PrintJob.ts`, find:

```ts
    printedBy: { type: String },
    lastError: { type: String },
    log: { type: [printJobLogSchema], default: undefined },
  },
  { timestamps: true },
);
```

Replace it with:

```ts
    printedBy: { type: String },
    lastError: { type: String },
    log: { type: [printJobLogSchema], default: undefined },
    // Phase 2. Omit-empty: a simple-mode row carries neither.
    printerId: { type: String },
    copies: { type: Number, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
  },
  { timestamps: true },
);
```

In `apps/cafe/models/PrintJob.ts`, find:

```ts
printJobSchema.index({ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 });
// No {originDeviceId, createdAt} index (the Phase 1 final gate, m-1): it served myRecentJobs, which the
// 1C gate dropped for the one attention feed; nothing reads by it.

// NO TTL index: ttl-guard's default-deny (packages/shared/src/ttl-guard.ts)
// allows exactly one registry TTL index platform-wide (Heartbeat) —
```

Replace it with:

```ts
printJobSchema.index({ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 });
// No {originDeviceId, createdAt} index (the Phase 1 final gate, m-1): it served myRecentJobs, which the
// 1C gate dropped for the one attention feed; nothing reads by it.
// Phase 2 (spec §6.5, §7.6): one printer's line, oldest first. PARTIAL on printerId, so the simple-mode
// rows (no printerId) cost it nothing on M0; every query of a printer's line names its printerId, which
// satisfies the filter, so the planner can use it.
printJobSchema.index(
  { printerId: 1, status: 1, createdAt: 1, _id: 1 },
  { partialFilterExpression: { printerId: { $exists: true } } },
);

// NO TTL index: ttl-guard's default-deny (packages/shared/src/ttl-guard.ts)
// allows exactly one registry TTL index platform-wide (Heartbeat) —
```

Create `apps/cafe/models/Printer.ts`:

```ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  PRINTER_ADDRESS_MAX_CHARS,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_ID_MAX_CHARS,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_NAME_MAX_CHARS,
  PRINTER_PAPER_WIDTHS,
  type PrinterCopies,
  type PrinterDeviceTransport,
  type PrinterPaperWidth,
  type PrinterSlips,
} from "@pos/shared/print-printers";

// Printing redesign, Phase 2 (spec §6.3): one printer of the outlet and the slips it takes. A LAN printer
// is reached over the network by its primary device (Phase 2; failover to other devices is Phase 3); a
// device printer (Bluetooth, USB, a Windows printer, Web Serial or Web Bluetooth) only by the one device
// that owns it. The request bodies are checked whole by lib/print-printer-schemas.ts; this schema keeps
// the stored shape honest on its own.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. backupPrinterId and health (spec §6.3) arrive with Phase 3's failover and
// paper status, not before: nothing would read them.

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
  kind: "lan" | "device";
  host?: string;
  port?: number;
  deviceId?: string;
  transport?: PrinterDeviceTransport;
  address?: string;
}

export interface IPrinter extends Document {
  name: string;
  connection: IPrinterConnection;
  primaryDeviceId?: string; // LAN only: the device that writes to it
  order: number;
  paper: PrinterPaperWidth;
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A LAN connection has a host and a port and nothing else; a device connection has a device, a transport
 *  and an address and nothing else. */
export function printerConnectionComplete(c: IPrinterConnection | undefined): boolean {
  if (c === undefined) return false;
  const lan = c.host !== undefined || c.port !== undefined;
  const device = c.deviceId !== undefined || c.transport !== undefined || c.address !== undefined;
  if (c.kind === "lan") return c.host !== undefined && c.port !== undefined && !device;
  return c.deviceId !== undefined && c.transport !== undefined && c.address !== undefined && !lan;
}

const connectionSchema = new Schema<IPrinterConnection>(
  {
    kind: { type: String, enum: ["lan", "device"], required: true },
    // Omit-empty: each kind stores only its own fields.
    host: { type: String, trim: true },
    port: { type: Number, min: 1, max: 65535 },
    deviceId: { type: String, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    transport: { type: String, enum: [...PRINTER_DEVICE_TRANSPORTS] },
    address: { type: String, maxlength: PRINTER_ADDRESS_MAX_CHARS },
  },
  { _id: false },
);

const slipsSchema = new Schema<PrinterSlips>(
  {
    bill: { type: Boolean, required: true },
    // Station ids (lib/print-printers.ts checks they exist); a deleted station is pulled from every printer.
    kotStations: { type: [String], required: true },
    kotAll: { type: Boolean, required: true },
    notices: { type: Boolean, required: true },
    eod: { type: Boolean, required: true },
  },
  { _id: false },
);

const copiesSchema = new Schema<PrinterCopies>(
  {
    kot: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
    bill: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
  },
  { _id: false },
);

export const printerSchema = new Schema<IPrinter>(
  {
    // unique:true creates the index: staff pick printers by name.
    name: { type: String, required: true, unique: true, trim: true, maxlength: PRINTER_NAME_MAX_CHARS },
    connection: {
      type: connectionSchema,
      required: true,
      validate: { validator: printerConnectionComplete, message: "A printer connection is either a LAN address or one device's printer." },
    },
    primaryDeviceId: { type: String, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    order: { type: Number, required: true },
    paper: { type: Number, enum: [...PRINTER_PAPER_WIDTHS], required: true },
    slips: { type: slipsSchema, required: true },
    copies: { type: copiesSchema, required: true },
    enabled: { type: Boolean, required: true },
  },
  { timestamps: true },
);

// NO TTL index (ttl-guard default-deny): a printer lives until staff delete it.

export const Printer: Model<IPrinter> =
  (mongoose.models.Printer as Model<IPrinter>) ?? mongoose.model<IPrinter>("Printer", printerSchema);
```

In `apps/cafe/models/Product.ts`, find:

```ts
  // chosen icon. A stored key may predate a catalogue change — every renderer
  // narrows with isProductIconKey and treats anything else as "no icon".
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Replace it with:

```ts
  // chosen icon. A stored key may predate a catalogue change — every renderer
  // narrows with isProductIconKey and treats anything else as "no icon".
  icon?: string;
  // Printing Phase 2 (spec §6.2): this item's own kitchen station, overriding its category's. ABSENT means
  // "use the category's station" — no `default:` below, the publicVisible precedent: the CSV import has
  // no column for it, so a re-import can never clear a chosen station.
  stationId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
```

In `apps/cafe/models/Product.ts`, find:

```ts
    publicVisible: { type: Boolean },
    // No `default:` — see the IProduct comment above: absent means no icon.
    icon: { type: String },
  },
  { timestamps: true },
);
```

Replace it with:

```ts
    publicVisible: { type: Boolean },
    // No `default:` — see the IProduct comment above: absent means no icon.
    icon: { type: String },
    // No `default:` — see the IProduct comment above: absent means the category's station.
    stationId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
```

Create `apps/cafe/models/Station.ts`:

```ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import { STATION_NAME_MAX_CHARS } from "@pos/shared/print-printers";

// Printing redesign, Phase 2 (spec §6.1): a kitchen station ("Kitchen", "Bar", "Tandoor"). A KOT round
// splits by the station of each item (§8), and each station's slip prints its name (D7). The first read
// seeds one default station, "Kitchen" (lib/print-stations.ts); a category with no station, and every
// station that no longer exists, falls back to the default.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts and models/PrintDevice.ts: a plain
// default-bound model of a few rows of print setup, never money or tenant data.

export interface IStation extends Document {
  name: string; // unique, trimmed; printed on the slip
  order: number; // display order
  isDefault: boolean; // exactly one is the default (defaultStationOf picks one if a write was cut short)
  createdAt: Date;
  updatedAt: Date;
}

export const stationSchema = new Schema<IStation>(
  {
    // unique:true creates the index: two stations with one name could never be told apart on paper.
    name: { type: String, required: true, unique: true, trim: true, maxlength: STATION_NAME_MAX_CHARS },
    order: { type: Number, required: true },
    isDefault: { type: Boolean, required: true },
  },
  { timestamps: true },
);

// NO TTL index (ttl-guard default-deny): a station lives until staff delete it.

export const Station: Model<IStation> =
  (mongoose.models.Station as Model<IStation>) ?? mongoose.model<IStation>("Station", stationSchema);
```

In `packages/shared/src/schemas/category.schema.ts`, find:

```ts
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  order: z.number().int().min(0).default(0), // display order in POS
});

export const updateCategorySchema = createCategorySchema.partial();

// PATCH /api/categories (admin) — the drag-and-drop arrangement. The WHOLE
// ordered id list is sent (the Tables reorderTablesSchema precedent): positions
```

Replace it with:

```ts
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  order: z.number().int().min(0).default(0), // display order in POS
  // Printing Phase 2 (spec §6.2): the kitchen station its items print at. Optional with NO default:
  // absent means the default station, so every existing category keeps printing where it does.
  stationId: objectIdString.optional(),
});

// `stationId: null` is the explicit "back to the default station" (the product icon precedent): JSON
// cannot carry undefined, and an absent key means "leave it alone".
export const updateCategorySchema = createCategorySchema.partial().extend({
  stationId: objectIdString.nullable().optional(),
});

// PATCH /api/categories (admin) — the drag-and-drop arrangement. The WHOLE
// ordered id list is sent (the Tables reorderTablesSchema precedent): positions
```

In `packages/shared/src/schemas/product.schema.ts`, find:

```ts
  // (omit-empty, the publicVisible precedent): the CSV import has no column
  // for it, so a re-import can never clear a chosen icon.
  icon: productIconSchema.optional(),
});

// PUT /api/products/[id]. Everything optional, PLUS one sentinel the create
```

Replace it with:

```ts
  // (omit-empty, the publicVisible precedent): the CSV import has no column
  // for it, so a re-import can never clear a chosen icon.
  icon: productIconSchema.optional(),
  // Printing Phase 2 (spec §6.2): this item's own kitchen station, overriding its category's. Optional
  // with NO default (the publicVisible precedent): the CSV import has no column for it.
  stationId: z.string().regex(OBJECT_ID_HEX_PATTERN, "Pick a station").optional(),
});

// PUT /api/products/[id]. Everything optional, PLUS one sentinel the create
```

In `packages/shared/src/schemas/product.schema.ts`, find:

```ts
  // Same sentinel again: "Remove icon" must restore ABSENT, and JSON cannot
  // carry undefined — `null` is the explicit clear the route turns into $unset.
  icon: productIconSchema.nullable().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
```

Replace it with:

```ts
  // Same sentinel again: "Remove icon" must restore ABSENT, and JSON cannot
  // carry undefined — `null` is the explicit clear the route turns into $unset.
  icon: productIconSchema.nullable().optional(),
  // Same sentinel once more: "Use the category's station" restores ABSENT.
  stationId: z.string().regex(OBJECT_ID_HEX_PATTERN, "Pick a station").nullable().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
```

In `packages/shared/src/types.ts`, find:

```ts
  // stored key may predate a catalogue change, so every renderer narrows it
  // with isProductIconKey and treats anything else as "no icon".
  icon?: string;
  createdAt: string;
  updatedAt: string;
}
```

Replace it with:

```ts
  // stored key may predate a catalogue change, so every renderer narrows it
  // with isProductIconKey and treats anything else as "no icon".
  icon?: string;
  // Printing Phase 2: this item's own kitchen station; ABSENT = its category's.
  stationId?: string;
  createdAt: string;
  updatedAt: string;
}
```

In `packages/shared/src/types.ts`, find:

```ts
  _id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}
```

Replace it with:

```ts
  _id: string;
  name: string;
  order: number;
  // Printing Phase 2: the kitchen station; ABSENT = the default station.
  stationId?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/schemas/category.schema.test.ts src/schemas/product.schema.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 37`; `# pass 37`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printers-model.test.ts lib/print-job-model.test.ts lib/menu-access-pins.test.ts lib/public-surface-paths.test.ts lib/crud-update.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 79`; `# pass 79`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add "apps/cafe/app/api/categories/[id]/route.ts" "apps/cafe/app/api/products/[id]/route.ts" apps/cafe/lib/print-job-model.test.ts apps/cafe/lib/print-printers-model.test.ts apps/cafe/models/Category.ts apps/cafe/models/PrintJob.ts apps/cafe/models/Printer.ts apps/cafe/models/Product.ts apps/cafe/models/Station.ts apps/cafe/package.json packages/shared/src/schemas/category.schema.test.ts packages/shared/src/schemas/category.schema.ts packages/shared/src/schemas/product.schema.test.ts packages/shared/src/schemas/product.schema.ts packages/shared/src/types.ts
git commit -m "feat(print): Phase 2 models: Station and Printer, a station on categories and items, a printer line on print jobs (dormant)"
```

---

### Task A3: routing (spec §8), a pure function: KOTs split by station with a full copy and a visible fallback; bills, notices and End of day to their printers

**Files:**
- Create: `apps/cafe/lib/print-printer-routing.ts` (`routePrintRequest`, `routedJobKey`, `PrintRouting`, `RoutedPrintJob`)
- Create: `apps/cafe/lib/print-printer-routing.test.ts`
- Modify: `packages/shared/src/print-printers.ts` (`PRINT_KOT_STATION_MODES`, `PRINT_FULL_KOT_NAME`, `printKotStationHeader`, `printNoPrinterMessage`), `packages/shared/src/schemas/print-job.schema.ts` (the KOT payload's optional `station`)
- Tests: `packages/shared/src/print-printers.test.ts` (two new tests); `apps/cafe/package.json` (testChain)

**Interfaces produced:** `routePrintRequest(request: PrintJobRequest, routing: PrintRouting): RoutedPrintJob[]`; `routedJobKey(baseKey: string | undefined, job: { printerId, part }): string | undefined`; `PrintRouting { printers; stations; itemStations: ReadonlyMap<productId, stationId>; billPrinterId? }`; `RoutedPrintJob { printerId: string | null; writerDeviceId: string | null; request: PrintJobRequest; copies: number; part: string; error?: string }`; the KOT payload's `station?: { name: string; mode: "station" | "all" | "no-printer" }`; `printKotStationHeader(station): string`; `printNoPrinterMessage(what): string`.

**The rules (spec §8, with this plan's decisions 3–6).** A KOT's lines (the round's; a whole-tab reprint: every line) are grouped by station. Each station's lines go to every printer that takes that station; the whole round goes to every full-copy printer. A station no printer takes is covered by the full copy; with no full-copy printer it goes to the default bill printer as "BAR (NO PRINTER SET)"; with neither it fails at once with "No printer is set up for Bar." (a KOT is never dropped). A full copy that is its round's only slip is today's KOT unchanged, so a cafe converted to one printer sees no change on paper. Bills go to the asking device's bill printer, else the default one; End of day to the asking device's bill printer, else the first End of day printer, else the default bill printer. Notices follow the KOT: a void goes to the printers its item's station KOT reaches that take notices; a moved or cancel notice to those of every station that got a KOT of the order.

**A station slip is the KOT for some of its lines:** the snapshot keeps only that station's lines of the round and the payload names the station, so the renderer (Session 2C) prints the lines it gets plus one header line. The round number and the KOT number stay the round's (D7). Copies are one job (decision 2). Keys: the slip's own key, then `:<printerId|none>:<stationId|all|->`, so every job of one slip has its own unique key and a replay or a repair collides instead of printing twice.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-printer-routing.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { billPrintJob, cancelNoticePrintJob, eodPrintJob, kotPrintJob, movedPrintJob, voidPrintJob } from "@/lib/print-routing";
import { printJobKeyOf } from "@/lib/print-queue";
import { routePrintRequest, routedJobKey, type PrintRouting } from "@/lib/print-printer-routing";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import type { Order, OrderItem } from "@/types";

// Printing redesign, Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A3): spec §8, row by row.
// The requests come from today's builders, so every routed slip is today's paper plus, for a KOT, its
// station.

const KITCHEN: StationConfig = { id: "st-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "st-bar", name: "Bar", order: 1, isDefault: false };
const TANDOOR: StationConfig = { id: "st-tandoor", name: "Tandoor", order: 2, isDefault: false };
const STATIONS = [KITCHEN, BAR, TANDOOR];

const NONE = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };

function printer(id: string, slips: Partial<PrinterConfig["slips"]>, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name: `${id} printer`,
    connection: { kind: "device", deviceId: `${id}-device`, transport: "bt-classic", address: "00:11:22:33:44:55" },
    order: 0,
    paper: 80,
    slips: { ...NONE, ...slips },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

const KITCHEN_P = printer("kitchen", { kotStations: [KITCHEN.id], notices: true }, { order: 1 });
const BAR_P = printer("bar", { kotStations: [BAR.id], notices: true }, { order: 2 });
const COUNTER_P = printer("counter", { bill: true, kotAll: true, notices: true, eod: true }, { order: 0 });

function item(productId: string, name: string, kotRound: number): OrderItem {
  return { productId, name, price: 100, qty: 1, modifiers: [], instructions: "", kotRound };
}

// Round 1: paneer (kitchen) and a mojito (bar); round 2: naan (tandoor) and a second mojito... a soup (kitchen).
const ITEMS = [item("p-paneer", "Paneer Tikka", 1), item("p-mojito", "Mojito", 1), item("p-naan", "Butter Naan", 2), item("p-soup", "Soup", 2)];
const ITEM_STATIONS = new Map([
  ["p-paneer", KITCHEN.id],
  ["p-mojito", BAR.id],
  ["p-naan", TANDOOR.id],
  ["p-soup", KITCHEN.id],
]);

function order(overrides: Partial<Order> = {}): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: ITEMS,
    subtotal: 400,
    discount: 0,
    total: 400,
    paidAmount: 0,
    payment: "Cash",
    status: "Pending",
    receiver: "Staff",
    tableNo: "4",
    kotRounds: 2,
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
    ...overrides,
  };
}

function routing(printers: PrinterConfig[], over: Partial<PrintRouting> = {}): PrintRouting {
  return { printers, stations: STATIONS, itemStations: ITEM_STATIONS, ...over };
}

function names(payload: PrintJobPayload): string[] {
  assert.equal(payload.kind, "kot", "a KOT payload");
  return payload.kind === "kot" ? payload.snapshot.items.map((line) => line.name) : [];
}

test("spec §14's Phase 2 exit: kitchen and bar items print two station KOTs plus the full copy", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, BAR_P]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bar", "counter"], "stations in station order, then the full copy");
  const [kitchen, bar, counter] = jobs;
  assert.deepEqual(names(kitchen.request.payload), ["Paneer Tikka"], "the kitchen gets only its items");
  assert.deepEqual(names(bar.request.payload), ["Mojito"], "the bar gets only its items");
  assert.deepEqual(names(counter.request.payload), ["Paneer Tikka", "Mojito"], "the full copy: the whole round");
  assert.deepEqual(kitchen.request.payload.kind === "kot" && kitchen.request.payload.station, { name: "Kitchen", mode: "station" });
  assert.deepEqual(counter.request.payload.kind === "kot" && counter.request.payload.station, { name: "All stations", mode: "all" });
  assert.equal(kitchen.request.label, "KOT round 1 · T-4 · Kitchen");
  assert.equal(counter.request.label, "KOT round 1 · T-4 · All stations");
  assert.deepEqual(jobs.map((j) => j.writerDeviceId), ["kitchen-device", "bar-device", "counter-device"]);
  assert.deepEqual(jobs.map((j) => j.part), [KITCHEN.id, BAR.id, "all"]);
  for (const j of jobs) assert.equal(printJobPayloadSchema.safeParse(j.request.payload).success, true, `${j.printerId}: the payload parses`);
});

test("one KOT number per round (D7): every station slip keeps the round and its ticket number", () => {
  const request = kotPrintJob(order({ kotNumbers: [41, 42] }), 2);
  const jobs = routePrintRequest(request, routing([KITCHEN_P, BAR_P, printer("tandoor", { kotStations: [TANDOOR.id] })]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "tandoor"], "round 2 has kitchen and tandoor lines, no bar line");
  for (const j of jobs) {
    assert.equal(j.request.payload.kind === "kot" && j.request.payload.round, 2);
    assert.deepEqual(j.request.payload.kind === "kot" && j.request.payload.snapshot.kotNumbers, [41, 42]);
  }
  assert.deepEqual(names(jobs[0].request.payload), ["Soup"], "only round 2's kitchen line");
});

test("a full copy that is the round's only slip is today's KOT, unchanged (a converted single-printer cafe)", () => {
  const request = kotPrintJob(order(), 1);
  const jobs = routePrintRequest(request, routing([COUNTER_P]));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].request, request, "the very same request: same payload, same label");
  assert.equal(jobs[0].part, "all");
});

test("a station with no printer is covered by the full copy: no extra slip", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "counter"], "the bar's mojito rides the full copy");
  assert.deepEqual(names(jobs[1].request.payload), ["Paneer Tikka", "Mojito"]);
});

test("with no full-copy printer, a station with no printer goes to the default bill printer, saying so", () => {
  const bill = printer("bill", { bill: true }, { order: 5 });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, bill]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bill"]);
  const fallback = jobs[1];
  assert.deepEqual(fallback.request.payload.kind === "kot" && fallback.request.payload.station, { name: "Bar", mode: "no-printer" });
  assert.deepEqual(names(fallback.request.payload), ["Mojito"]);
  assert.equal(fallback.request.label, "KOT round 1 · T-4 · Bar");
});

test("a KOT is never dropped: with nowhere to print, it fails at once and says why", () => {
  const eodOnly = printer("office", { eod: true });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, eodOnly]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", null]);
  assert.equal(jobs[1].error, "No printer is set up for Bar.");
  assert.equal(jobs[1].writerDeviceId, null);
  assert.equal(jobs[1].part, BAR.id);
  assert.deepEqual(names(jobs[1].request.payload), ["Mojito"], "the failed slip still holds the bar's lines, for Retry after setup");
});

test("two printers that take one station both get its slip; copies stay one job", () => {
  const second = printer("kitchen-2", { kotStations: [KITCHEN.id] }, { order: 3, copies: { kot: 2, bill: 1 } });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, second, BAR_P]));
  const kitchenJobs = jobs.filter((j) => j.part === KITCHEN.id);
  assert.deepEqual(kitchenJobs.map((j) => [j.printerId, j.copies]), [["kitchen", 1], ["kitchen-2", 2]]);
});

test("disabled printers and LAN printers nobody writes to never get a slip", () => {
  const off = printer("bar", { kotStations: [BAR.id] }, { enabled: false });
  const lan = printer("lan-bar", { kotStations: [BAR.id] }, { connection: { kind: "lan", host: "192.168.1.70", port: 9100 } });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, off, lan]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "counter"], "the bar rides the full copy instead");
  const primary = { ...lan, primaryDeviceId: "bar-tablet" };
  const withPrimary = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, primary]));
  assert.deepEqual(withPrimary.map((j) => [j.printerId, j.writerDeviceId]), [["kitchen", "kitchen-device"], ["lan-bar", "bar-tablet"], ["counter", "counter-device"]]);
});

test("an item whose station is unknown or deleted prints at the default station (spec §6.2)", () => {
  const stray = item("p-new", "Special", 1);
  const request = kotPrintJob(order({ items: [stray], kotRounds: 1 }), 1);
  assert.deepEqual(names(routePrintRequest(request, routing([KITCHEN_P, BAR_P]))[0].request.payload), ["Special"]);
  const gone = new Map([["p-new", "st-deleted"]]);
  const jobs = routePrintRequest(request, routing([KITCHEN_P, BAR_P], { itemStations: gone }));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen"], "a deleted station falls back to the default");
});

test("a whole-tab reprint (round null) splits every line by station", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), null), routing([KITCHEN_P, BAR_P]));
  assert.deepEqual(names(jobs[0].request.payload), ["Paneer Tikka", "Soup"]);
  assert.equal(jobs.length, 3, "kitchen, bar, and the tandoor's naan, which no printer takes: it fails visibly");
  assert.equal(jobs[2].error, "No printer is set up for Tandoor.");
});

test("a round with no lines makes no job; a cafe with no stored station still routes", () => {
  assert.deepEqual(routePrintRequest(kotPrintJob(order({ items: [item("p-paneer", "Paneer Tikka", 1)] }), 3), routing([KITCHEN_P])), []);
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P], { stations: [], itemStations: new Map() }));
  assert.deepEqual(jobs.map((j) => j.printerId), ["counter"], "no stations yet: no station printer can match, the full copy prints it all");
});

test("bill: the asking device's bill printer, else the default; copies; nowhere fails visibly", () => {
  const second = printer("counter-2", { bill: true }, { order: 4, copies: { kot: 1, bill: 2 } });
  const request = billPrintJob(order({ status: "Completed" }), { reprint: false });
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, second])).map((j) => [j.printerId, j.copies]), [["counter", 1]]);
  const chosen = routePrintRequest(request, routing([COUNTER_P, second], { billPrinterId: "counter-2" }));
  assert.deepEqual(chosen.map((j) => [j.printerId, j.copies, j.part]), [["counter-2", 2, "-"]]);
  const disabled = routePrintRequest(request, routing([COUNTER_P, { ...second, enabled: false }], { billPrinterId: "counter-2" }));
  assert.deepEqual(disabled.map((j) => j.printerId), ["counter"], "a disabled choice falls back to the default");
  const kitchenAsBill = routePrintRequest(request, routing([COUNTER_P, KITCHEN_P], { billPrinterId: "kitchen" }));
  assert.deepEqual(kitchenAsBill.map((j) => j.printerId), ["kitchen"], "the device's own choice need not be a default bill printer");
  const nowhere = routePrintRequest(request, routing([KITCHEN_P]));
  assert.deepEqual(nowhere.map((j) => [j.printerId, j.error]), [[null, "No printer is set up for bills."]]);
});

test("End of day: the asking device's bill printer, else the first End of day printer, else the default bill printer", () => {
  const request = eodPrintJob({ dateKey: "2026-10-03", dateLabel: "3 Oct 2026" });
  const office = printer("office", { eod: true }, { order: 9 });
  const bill = printer("bill", { bill: true }, { order: 1 });
  assert.deepEqual(routePrintRequest(request, routing([bill, office])).map((j) => j.printerId), ["office"]);
  assert.deepEqual(routePrintRequest(request, routing([bill, office], { billPrinterId: "bill" })).map((j) => j.printerId), ["bill"]);
  assert.deepEqual(routePrintRequest(request, routing([bill])).map((j) => j.printerId), ["bill"]);
  assert.deepEqual(routePrintRequest(request, routing([KITCHEN_P])).map((j) => j.error), ["No printer is set up for End of day."]);
});

test("void: to the printers the voided item's station KOT reaches, that take notices", () => {
  const entry = { productId: "p-mojito", name: "Mojito", price: 100, qty: 1, kotRound: 1, reason: "Wrong", voidedBy: "Asha", at: "2026-10-03T10:05:00.000Z" };
  const request = voidPrintJob(order({ voids: [entry] }), entry, { reprint: false });
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, KITCHEN_P, BAR_P])).map((j) => j.printerId), ["counter", "bar"], "the bar and the full copy, never the kitchen");
  const quietBar = { ...BAR_P, slips: { ...BAR_P.slips, notices: false } };
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, KITCHEN_P, quietBar])).map((j) => j.printerId), ["counter"]);
  const quietAll = { ...COUNTER_P, slips: { ...COUNTER_P.slips, notices: false } };
  assert.deepEqual(routePrintRequest(request, routing([quietAll, KITCHEN_P, quietBar])), [], "notices switched off everywhere it reaches: no notice");
  const fallbackOnly = printer("bill", { bill: true, notices: true });
  assert.deepEqual(routePrintRequest(request, routing([KITCHEN_P, fallbackOnly])).map((j) => j.printerId), ["bill"], "the bar's KOT went to the bill printer, so its void does too");
});

test("moved and cancel notices: the notice printers of every station that got a KOT, each once", () => {
  const moved = movedPrintJob(order(), { from: "3", movedBy: "Asha", movedAt: "2026-10-03T10:06:00.000Z" }, { reprint: false });
  const all = [COUNTER_P, KITCHEN_P, BAR_P, printer("tandoor", { kotStations: [TANDOOR.id], notices: true }, { order: 3 })];
  assert.deepEqual(routePrintRequest(moved, routing(all)).map((j) => j.printerId), ["counter", "kitchen", "bar", "tandoor"]);
  const unsent = order({ items: [item("p-mojito", "Mojito", 0)], kotRounds: 0 });
  const early = routePrintRequest(movedPrintJob(unsent, { movedBy: "Asha", movedAt: "2026-10-03T10:06:00.000Z" }, { reprint: false }), routing(all));
  assert.deepEqual(early.map((j) => j.printerId), ["counter", "kitchen"], "nothing fired yet: the default station's printers");
  const cancel = routePrintRequest(cancelNoticePrintJob(order({ items: [ITEMS[1]] }), "Customer left"), routing(all));
  assert.deepEqual(cancel.map((j) => [j.printerId, j.copies]), [["counter", 1], ["bar", 1]]);
});

test("job keys: the slip's key, then the printer and the part; no key stays no key", () => {
  const request = kotPrintJob(order(), 1);
  const base = printJobKeyOf(request.payload);
  const jobs = routePrintRequest(request, routing([COUNTER_P, KITCHEN_P]));
  assert.deepEqual(jobs.map((j) => routedJobKey(base, j)), [
    `kot:665f0a0000000000000000a1:1:kitchen:${KITCHEN.id}`,
    "kot:665f0a0000000000000000a1:1:counter:all",
  ]);
  assert.equal(routedJobKey(base, { printerId: null, part: BAR.id }), `kot:665f0a0000000000000000a1:1:none:${BAR.id}`);
  assert.equal(routedJobKey(undefined, jobs[0]), undefined, "End of day and the like stay keyless");
  const keys = routePrintRequest(request, routing([COUNTER_P, KITCHEN_P, BAR_P])).map((j) => routedJobKey(base, j));
  assert.equal(new Set(keys).size, keys.length, "every job of one slip has its own key");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/css-compat.test.ts",
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

Replace it with:

```json
    "lib/css-compat.test.ts",
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
  PRINTER_PAPER_WIDTHS,
  defaultBillPrinterOf,
  defaultStationOf,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
```

Replace it with:

```ts
  PRINTER_PAPER_WIDTHS,
  defaultBillPrinterOf,
  defaultStationOf,
  printKotStationHeader,
  printNoPrinterMessage,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
  type PrinterConfig,
  type StationConfig,
} from "./print-printers";

// Printing redesign, Phase 2 (spec §6.1–6.3, §8, §9.3): the pure rules every side reads.

```

Replace it with:

```ts
  type PrinterConfig,
  type StationConfig,
} from "./print-printers";
import { printJobPayloadSchema } from "./schemas/print-job.schema";

// Printing redesign, Phase 2 (spec §6.1–6.3, §8, §9.3): the pure rules every side reads.

```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
  assert.equal(resolveStationId({ productStationId: "bar" }, []), null, "no stations at all: none");
});

```

Replace it with:

```ts
  assert.equal(resolveStationId({ productStationId: "bar" }, []), null, "no stations at all: none");
});

test("a station KOT's header line (spec §8): the name, the full copy, the station with no printer", () => {
  assert.equal(printKotStationHeader({ name: "Bar", mode: "station" }), "BAR");
  assert.equal(printKotStationHeader({ name: "All stations", mode: "all" }), "ALL STATIONS");
  assert.equal(printKotStationHeader({ name: "Tandoor", mode: "no-printer" }), "TANDOOR (NO PRINTER SET)");
  assert.equal(printNoPrinterMessage("Bar"), "No printer is set up for Bar.");
});

const SNAPSHOT = {
  _id: "665f0a0000000000000000a1",
  orderId: "ORD-0001",
  customerName: "Walk-in",
  items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [], instructions: "", kotRound: 1 }],
  subtotal: 20,
  discount: 0,
  total: 20,
  paidAmount: 0,
  payment: "Cash",
  status: "Pending",
  receiver: "Staff",
  kotRounds: 1,
  createdAt: "2026-10-03T10:00:00.000Z",
};

test("a KOT payload may name its station; today's KOT (no station) still parses; the station is checked", () => {
  const kot = { kind: "kot", snapshot: SNAPSHOT, round: 1 };
  assert.equal(printJobPayloadSchema.safeParse(kot).success, true, "a simple-mode KOT is unchanged");
  for (const mode of ["station", "all", "no-printer"]) {
    assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "Bar", mode } }).success, true, mode);
  }
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "Bar", mode: "kitchen" } }).success, false, "an unknown mode");
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "", mode: "station" } }).success, false, "a blank name");
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "x".repeat(33), mode: "station" } }).success, false, "a name longer than a station's");
  assert.equal(printJobPayloadSchema.safeParse({ ...kot, station: { name: "Bar", mode: "station", id: "x" } }).success, false, "strict");
  const bill = { kind: "bill", snapshot: SNAPSHOT, station: { name: "Bar", mode: "station" } };
  assert.equal(printJobPayloadSchema.safeParse(bill).success, false, "only a KOT names a station");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printer-routing.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

Create `apps/cafe/lib/print-printer-routing.ts`:

```ts
import {
  DEFAULT_STATION_NAME,
  PRINT_FULL_KOT_NAME,
  defaultBillPrinterOf,
  defaultStationOf,
  printNoPrinterMessage,
  printerWriterDeviceId,
  routablePrinters,
  type PrintKotStationMode,
  type PrinterConfig,
  type StationConfig,
} from "@pos/shared/print-printers";
import type { KotPrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { printJobLabel, type PrintJobRequest } from "@/lib/print-routing";

// Printing redesign, Phase 2 (spec §8): routing, a PURE function. One slip a request asks for (built by the
// existing builders in lib/print-routing.ts, so its paper is today's) becomes the jobs of printers mode:
// which printer prints it, how many copies, and for a KOT, which station's items. No DB, no clock: the
// server reads the setup (lib/print-routing-context.ts) and makes the jobs (Session 2C).
//
//   KOT     the items of the round (a whole-tab reprint: every line) grouped by station. Each station's
//           items go to every printer that takes that station; the whole round goes to every full-copy
//           printer. A station no printer takes is covered by the full copy; with no full-copy printer it
//           goes to the default bill printer as "<STATION> (NO PRINTER SET)"; with none of those it fails
//           at once, visibly. A KOT is never dropped.
//   bill    the asking device's bill printer, else the default bill printer.
//   void    the printers the voided item's station KOT reaches, that take notices.
//   moved,  the notice printers of every station that got a KOT of this order (the default station when
//   cancel  none did).
//   eod     the asking device's bill printer, else the first End of day printer, else the default bill one.
//
// All copies of a slip are ONE job (printer.copies), so a copy never costs another lease and ack (§17).

export interface PrintRouting {
  printers: readonly PrinterConfig[];
  stations: readonly StationConfig[];
  /** Each item's resolved station (resolveStationId, spec §6.2), by productId. A product missing here
   *  prints at the default station. */
  itemStations: ReadonlyMap<string, string>;
  /** The asking device's own bill printer (Session 2D); unknown, disabled or with no writer means none. */
  billPrinterId?: string;
}

export interface RoutedPrintJob {
  /** null: no printer takes this slip; the job is made failed at once with `error`, so staff see it. */
  printerId: string | null;
  writerDeviceId: string | null;
  request: PrintJobRequest;
  copies: number;
  /** Tells this job apart from the slip's other jobs: a station id, "all" (a full copy) or "-". */
  part: string;
  error?: string;
}

/** A cafe with no stored station yet (spec §6.1 seeds one on the first read, so only for a moment): no
 *  printer can take it, so its items ride the full copy or the fallback. */
const VIRTUAL_DEFAULT: StationConfig = { id: "default", name: DEFAULT_STATION_NAME, order: -1, isDefault: true };
const NO_PART = "-";
const ALL_PART = "all";
const LABEL_SEPARATOR = " · ";

interface Setup {
  printers: PrinterConfig[];
  stations: StationConfig[];
  stationOf: (productId: string) => StationConfig;
}

function setupOf(routing: PrintRouting): Setup {
  const fallback = defaultStationOf(routing.stations) ?? VIRTUAL_DEFAULT;
  const byId = new Map(routing.stations.map((station) => [station.id, station]));
  const sorted = [...routing.stations].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    printers: routablePrinters(routing.printers),
    stations: sorted.length > 0 ? sorted : [VIRTUAL_DEFAULT],
    stationOf: (productId) => byId.get(routing.itemStations.get(productId) ?? "") ?? fallback,
  };
}

function job(printer: PrinterConfig, request: PrintJobRequest, copies: number, part: string): RoutedPrintJob {
  return { printerId: printer.id, writerDeviceId: printerWriterDeviceId(printer), request, copies, part };
}

function failed(request: PrintJobRequest, part: string, what: string): RoutedPrintJob {
  return { printerId: null, writerDeviceId: null, request, copies: 1, part, error: printNoPrinterMessage(what) };
}

function fullCopyPrinters(setup: Setup): PrinterConfig[] {
  return setup.printers.filter((printer) => printer.slips.kotAll);
}

/** Where a station's own KOT prints (§8): the printers that take the station; else, with no full-copy
 *  printer, the default bill printer (fallback). Empty with a full-copy printer: the full copy covers it. */
function stationTargets(setup: Setup, stationId: string): { printers: PrinterConfig[]; fallback: boolean } {
  const own = setup.printers.filter((printer) => printer.slips.kotStations.includes(stationId));
  if (own.length > 0) return { printers: own, fallback: false };
  if (fullCopyPrinters(setup).length > 0) return { printers: [], fallback: false };
  const bill = defaultBillPrinterOf(setup.printers);
  return { printers: bill === null ? [] : [bill], fallback: true };
}

/** Notices follow the KOT: every printer a station's KOT reaches (its own, the full copies, the fallback)
 *  that takes notices, each once, in display order. */
function noticeTargets(setup: Setup, stationIds: readonly string[]): PrinterConfig[] {
  const reached = new Set<PrinterConfig>(fullCopyPrinters(setup));
  for (const stationId of stationIds) for (const printer of stationTargets(setup, stationId).printers) reached.add(printer);
  return setup.printers.filter((printer) => reached.has(printer) && printer.slips.notices);
}

/** The KOT for some of its lines: the snapshot keeps only those lines, and the slip names the station. */
function partialKot(
  request: PrintJobRequest,
  payload: KotPrintJobPayload,
  lines: readonly KotPrintJobPayload["snapshot"]["items"][number][],
  station: { name: string; mode: PrintKotStationMode },
): PrintJobRequest {
  const snapshot = { ...payload.snapshot, items: payload.snapshot.items.filter((item) => lines.includes(item)) };
  return {
    payload: { ...payload, snapshot, station },
    label: printJobLabel(`${request.label}${LABEL_SEPARATOR}${station.name}`, request.label),
  };
}

function routeKot(request: PrintJobRequest, payload: KotPrintJobPayload, setup: Setup): RoutedPrintJob[] {
  const inScope = payload.snapshot.items.filter((item) => payload.round === null || item.kotRound === payload.round);
  if (inScope.length === 0) return [];
  const out: RoutedPrintJob[] = [];
  for (const station of setup.stations) {
    const lines = inScope.filter((item) => setup.stationOf(item.productId).id === station.id);
    if (lines.length === 0) continue;
    const targets = stationTargets(setup, station.id);
    if (targets.printers.length === 0 && !targets.fallback) continue; // the full copy covers it
    const slip = partialKot(request, payload, lines, { name: station.name, mode: targets.fallback ? "no-printer" : "station" });
    if (targets.printers.length === 0) out.push(failed(slip, station.id, station.name));
    for (const printer of targets.printers) out.push(job(printer, slip, printer.copies.kot, station.id));
  }
  // A full copy that is the round's only slip is today's KOT, unchanged; beside station slips it says so.
  const alone = out.length === 0;
  for (const printer of fullCopyPrinters(setup)) {
    const slip = alone ? request : partialKot(request, payload, inScope, { name: PRINT_FULL_KOT_NAME, mode: "all" });
    out.push(job(printer, slip, printer.copies.kot, ALL_PART));
  }
  return out;
}

/** The asking device's own bill printer, when it can print: enabled and with a writer (it need not take
 *  bills by default; the device chose it). */
function chosenBillPrinter(routing: PrintRouting): PrinterConfig | null {
  if (routing.billPrinterId === undefined) return null;
  const chosen = routing.printers.find((printer) => printer.id === routing.billPrinterId);
  return chosen !== undefined && chosen.enabled && printerWriterDeviceId(chosen) !== null ? chosen : null;
}

/** The jobs one slip becomes in printers mode (spec §8). Empty only for a KOT with no lines, and for a
 *  notice no printer reached takes notices for (staff switched notices off there). */
export function routePrintRequest(request: PrintJobRequest, routing: PrintRouting): RoutedPrintJob[] {
  const setup = setupOf(routing);
  const payload = request.payload;
  switch (payload.kind) {
    case "kot":
      return routeKot(request, payload, setup);
    case "bill": {
      const printer = chosenBillPrinter(routing) ?? defaultBillPrinterOf(setup.printers);
      return printer === null ? [failed(request, NO_PART, "bills")] : [job(printer, request, printer.copies.bill, NO_PART)];
    }
    case "eod": {
      const printer = chosenBillPrinter(routing) ?? setup.printers.find((p) => p.slips.eod) ?? defaultBillPrinterOf(setup.printers);
      return printer === null ? [failed(request, NO_PART, "End of day")] : [job(printer, request, 1, NO_PART)];
    }
    case "void":
      return noticeTargets(setup, [setup.stationOf(payload.line.productId).id]).map((printer) => job(printer, request, 1, NO_PART));
    case "moved":
    case "cancel-notice": {
      const fired = payload.snapshot.items.filter((item) => item.kotRound >= 1);
      const stationIds = [...new Set(fired.map((item) => setup.stationOf(item.productId).id))];
      return noticeTargets(setup, stationIds.length > 0 ? stationIds : [setup.stationOf("").id]).map((printer) => job(printer, request, 1, NO_PART));
    }
  }
}

/** A routed job's key (spec §6.5): the slip's own key, then its printer and part, so a replay or a repair
 *  of the same slip collides on the unique jobKey instead of printing twice. A slip with no key (End of day,
 *  a cancel notice, a reprint without an Idempotency-Key) makes jobs with none. */
export function routedJobKey(baseKey: string | undefined, routed: Pick<RoutedPrintJob, "printerId" | "part">): string | undefined {
  return baseKey === undefined ? undefined : `${baseKey}:${routed.printerId ?? "none"}:${routed.part}`;
}
```

In `packages/shared/src/print-printers.ts`, find:

```ts
export const STATIONS_MAX = 20;
/** The station the first read seeds (§6.1); every category without a station uses the default one. */
export const DEFAULT_STATION_NAME = "Kitchen";

export const PRINTER_NAME_MAX_CHARS = 40;
export const PRINTERS_MAX = 12;
```

Replace it with:

```ts
export const STATIONS_MAX = 20;
/** The station the first read seeds (§6.1); every category without a station uses the default one. */
export const DEFAULT_STATION_NAME = "Kitchen";

/** A KOT routed to printers says which station it is for (§8, D7), under its title. "station": only that
 *  station's items; "all": the round's full copy while other printers got station slips; "no-printer": the
 *  station has no printer and no printer takes a full copy, so it went to the default bill printer. */
export const PRINT_KOT_STATION_MODES = ["station", "all", "no-printer"] as const;
export type PrintKotStationMode = (typeof PRINT_KOT_STATION_MODES)[number];
/** The name a full copy carries (its label and its header). */
export const PRINT_FULL_KOT_NAME = "All stations";

/** The line a station KOT prints under its title (§8): "BAR", "ALL STATIONS", "BAR (NO PRINTER SET)". */
export function printKotStationHeader(station: { name: string; mode: PrintKotStationMode }): string {
  const name = station.name.toUpperCase();
  return station.mode === "no-printer" ? `${name} (NO PRINTER SET)` : name;
}

/** Why a slip has no printer (§8: a KOT is never dropped; it fails at once, visibly, instead). */
export function printNoPrinterMessage(what: string): string {
  return `No printer is set up for ${what}.`;
}

export const PRINTER_NAME_MAX_CHARS = 40;
export const PRINTERS_MAX = 12;
```

In `packages/shared/src/schemas/print-job.schema.ts`, find:

```ts
import { z } from "zod";
import { PAYMENT_MODES, ORDER_STATUSES, GST_MODES, DISCOUNT_KINDS } from "../constants";
import { ORDER_CHARGE_TYPES } from "../order-charges";

// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan, PH-1 — the payload contract. `printOrderSnapshotSchema`
```

Replace it with:

```ts
import { z } from "zod";
import { PAYMENT_MODES, ORDER_STATUSES, GST_MODES, DISCOUNT_KINDS } from "../constants";
import { ORDER_CHARGE_TYPES } from "../order-charges";
import { PRINT_KOT_STATION_MODES, STATION_NAME_MAX_CHARS } from "../print-printers";

// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan, PH-1 — the payload contract. `printOrderSnapshotSchema`
```

In `packages/shared/src/schemas/print-job.schema.ts`, find:

```ts
// roundItems/roundLabel/roundNumber unset, mirroring `reprintKot`'s three
// resets); a number filters the snapshot's items to that round (MERGED-04).
// NULLABLE, not optional — the discriminator must always be stated.
const kotPayloadSchema = z
  .object({ kind: z.literal("kot"), snapshot: printOrderSnapshotSchema, round: z.number().int().nullable() })
  .strict();

// `reprint: true` marks a staff-requested duplicate (mirrors `kot`'s
```

Replace it with:

```ts
// roundItems/roundLabel/roundNumber unset, mirroring `reprintKot`'s three
// resets); a number filters the snapshot's items to that round (MERGED-04).
// NULLABLE, not optional — the discriminator must always be stated.
//
// Printing Phase 2 (spec §8, D7): `station` names the station a printers-mode KOT is for, and its snapshot
// then holds only that station's items. ABSENT on every simple-mode KOT, and on a printers-mode KOT that
// is its round's only slip: today's slip, unchanged.
const kotPayloadSchema = z
  .object({
    kind: z.literal("kot"),
    snapshot: printOrderSnapshotSchema,
    round: z.number().int().nullable(),
    station: z
      .object({ name: z.string().trim().min(1).max(STATION_NAME_MAX_CHARS), mode: z.enum(PRINT_KOT_STATION_MODES) })
      .strict()
      .optional(),
  })
  .strict();

// `reprint: true` marks a staff-requested duplicate (mirrors `kot`'s
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts src/print-job.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 40`; `# pass 40`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printer-routing.test.ts lib/print-routing.test.ts lib/print-job-payload-parity.test.ts lib/print-host-slips.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 99`; `# pass 99`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-printer-routing.test.ts apps/cafe/lib/print-printer-routing.ts apps/cafe/package.json packages/shared/src/print-printers.test.ts packages/shared/src/print-printers.ts packages/shared/src/schemas/print-job.schema.ts
git commit -m "feat(print): Phase 2 routing (spec §8), a pure function: KOTs split by station with a full copy and a visible fallback, bills, notices and End of day to their printers"
```

---

### Task A4: the setup API: stations and printers (admin writes, signed-in reads), and the routing setup read fresh per request (dormant)

**Files:**
- Create: `apps/cafe/lib/print-printer-schemas.ts` (`createStationBodySchema`, `updateStationBodySchema`, `printerBodySchema`)
- Create: `apps/cafe/lib/print-stations.ts` (`listStations` seeds the default, `createStation`, `updateStation`, `deleteStation`, `stationWireOf`, `PrintSetupResult`)
- Create: `apps/cafe/lib/print-printers.ts` (`listPrinters`, `createPrinter`, `replacePrinter`, `deletePrinter`, `printerWireOf`)
- Create: `apps/cafe/lib/print-routing-context.ts` (`readPrintRouting`)
- Create: `apps/cafe/app/api/stations/route.ts`, `apps/cafe/app/api/stations/[id]/route.ts`, `apps/cafe/app/api/printers/route.ts`, `apps/cafe/app/api/printers/[id]/route.ts`
- Create: `apps/cafe/lib/print-setup-paths.test.ts`; Modify: `apps/cafe/package.json` (testChain)

**Interfaces produced:** `GET/POST /api/stations`, `PUT/DELETE /api/stations/[id]`, `GET/POST /api/printers`, `PUT/DELETE /api/printers/[id]` (GET: any signed-in device; writes: admin; every answer no-store). `listStations(): Promise<StationConfig[]>`; `createStation(body)`, `updateStation(id, body)`, `deleteStation(id)`: `Promise<PrintSetupResult<…>>` where `PrintSetupResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string }`; `listPrinters(): Promise<PrinterConfig[]>`; `createPrinter(body)`, `replacePrinter(id, body)`, `deletePrinter(id)`; `readPrintRouting({ productIds, billPrinterId? }): Promise<PrintRouting | null>`.

**Stations (spec §6.1).** The first read seeds the default "Kitchen" (five first reads racing seed exactly one: the unique name index, leg ah). There is always exactly one default: "make default" clears the old flag first, and `defaultStationOf` covers the moment between. The default can't be deleted; deleting another station clears it from every category, item and printer that chose it (they fall back to the default, as a lookup of a deleted station would; owner: no stale print data).

**Printers (spec §6.3).** Saved whole by the setup form, checked by `printerBodySchema`: a LAN printer's address follows the POS app's own host rule (`lib/printer/network-address.ts`) and needs its printing device (decision 1); a device printer never names another. Its stations must exist. A re-save replaces the connection, never merges it (leg ai). At most 12 printers and 20 stations.

**The routing read (`readPrintRouting`).** Read fresh per request, never cached: a printer switched off must stop getting slips at once. Simple mode costs one small read (the printers) and answers null; printers mode adds the stations and the stations of this request's items (by id: the items, then their categories). Session 2C calls it from job creation.

**Dormant.** No screen calls these routes yet (Session 2D), and no request routes through printers yet (Session 2C): a cafe that adds printers through the API still prints exactly as today.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-setup-paths.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Types } from "mongoose";

import { stripComments } from "@/lib/source-pin-utils";
import { createStationBodySchema, printerBodySchema, updateStationBodySchema } from "@/lib/print-printer-schemas";
import { printerWireOf } from "@/lib/print-printers";
import { stationWireOf } from "@/lib/print-stations";

// Printing redesign, Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A4): the setup routes'
// bodies, the wire shapes, and source pins for the routes and libs (auth, ids, no-store, no connectDB in
// libs). Their database behaviour is proven by the live legs ah–aj.

const STATION = "64f000000000000000000001";

function lanBody(over: Record<string, unknown> = {}) {
  return {
    name: "Kitchen printer",
    connection: { kind: "lan", host: "192.168.1.60" },
    primaryDeviceId: "kitchen-tab",
    paper: 80,
    slips: { bill: false, kotStations: [STATION], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

const DEVICE = { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON TM-T82" };

test("station bodies: a trimmed name of 1–32 characters; an update renames or makes it the default", () => {
  assert.deepEqual(createStationBodySchema.parse({ name: "  Bar " }), { name: "Bar" });
  assert.equal(createStationBodySchema.safeParse({ name: "   " }).success, false);
  assert.equal(createStationBodySchema.safeParse({ name: "x".repeat(33) }).success, false);
  assert.equal(createStationBodySchema.safeParse({ name: "Bar", isDefault: true }).success, false, "a new station is never the default by its body");
  assert.equal(updateStationBodySchema.safeParse({ isDefault: true }).success, true);
  assert.equal(updateStationBodySchema.safeParse({ isDefault: false }).success, false, "the default is moved, never unset");
  assert.equal(updateStationBodySchema.safeParse({}).success, false, "nothing to change");
});

test("printer body: a LAN printer needs its printing device; its port defaults to 9100; the host is the app's rule", () => {
  const parsed = printerBodySchema.parse(lanBody({ connection: { kind: "lan", host: "  192.168.1.60 " } }));
  assert.deepEqual(parsed.connection, { kind: "lan", host: "192.168.1.60", port: 9100 });
  assert.equal(printerBodySchema.parse(lanBody({ connection: { kind: "lan", host: "PRINTER.LOCAL", port: 9101 } })).connection.kind, "lan");
  const noPrimary = printerBodySchema.safeParse(lanBody({ primaryDeviceId: undefined }));
  assert.ok(!noPrimary.success && noPrimary.error.issues.some((i) => i.path[0] === "primaryDeviceId"), "a LAN printer without a printing device");
  for (const host of ["192.168.1.256", "printer:9100", "http://10.0.0.1", "", "a b"]) {
    assert.equal(printerBodySchema.safeParse(lanBody({ connection: { kind: "lan", host } })).success, false, host);
  }
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { kind: "lan", host: "10.0.0.5", port: 70000 } })).success, false);
});

test("printer body: a device printer is its own device's, so it never names another printing device", () => {
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: DEVICE, primaryDeviceId: undefined })).success, true);
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: DEVICE })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { ...DEVICE, transport: "serial" }, primaryDeviceId: undefined })).success, false, "a known transport only");
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { ...DEVICE, address: "" }, primaryDeviceId: undefined })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { ...DEVICE, host: "10.0.0.1" }, primaryDeviceId: undefined })).success, false, "strict: no mixed connection");
});

test("printer body: paper 58/80, 1–3 copies, station ids once each, every slip type stated, nothing else", () => {
  assert.equal(printerBodySchema.safeParse(lanBody({ paper: 76 })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ copies: { kot: 4, bill: 1 } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ copies: { kot: 1, bill: 0 } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [STATION, STATION], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: ["bar"], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [], kotAll: false, notices: true } })).success, false, "eod must be stated");
  assert.equal(printerBodySchema.safeParse(lanBody({ health: { state: "online" } })).success, false, "strict: Phase 3 fields are refused");
  assert.equal(printerBodySchema.safeParse(lanBody({ name: "x".repeat(41) })).success, false);
});

test("wire shapes: ids are strings; a device printer carries no primaryDeviceId key", () => {
  const id = new Types.ObjectId();
  assert.deepEqual(stationWireOf({ _id: id, name: "Bar", order: 1, isDefault: false }), { id: String(id), name: "Bar", order: 1, isDefault: false });
  const wire = printerWireOf({
    _id: id,
    name: "Counter",
    connection: { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" },
    order: 0,
    paper: 80,
    slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true },
    copies: { kot: 1, bill: 2 },
    enabled: true,
  });
  assert.equal(wire.id, String(id));
  assert.ok(!("primaryDeviceId" in wire), "omit-empty on the wire too");
  assert.deepEqual(wire.connection, { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" });
});

function src(rel: string): string {
  return stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
}

const ROUTES = ["app/api/stations/route.ts", "app/api/stations/[id]/route.ts", "app/api/printers/route.ts", "app/api/printers/[id]/route.ts"];
const LIBS = ["lib/print-stations.ts", "lib/print-printers.ts", "lib/print-routing-context.ts", "lib/print-printer-routing.ts"];

test("PIN: reads need a signed-in device, every write needs an admin", () => {
  for (const rel of ROUTES) {
    const file = src(rel);
    for (const [, verb, body] of file.matchAll(/export async function (GET|POST|PUT|DELETE)\([^)]*\) \{([\s\S]*?)\n\}/g)) {
      const guard = verb === "GET" ? "requireAuth()" : "requireAdmin()";
      assert.ok(body.trimStart().startsWith(`const authed = await ${guard};`), `${rel} ${verb} starts with ${guard}`);
    }
  }
});

test("PIN: every [id] is checked before the database; every answer after the guard is no-store", () => {
  for (const rel of ROUTES.filter((r) => r.includes("[id]"))) {
    const file = src(rel);
    assert.equal((file.match(/if \(!mongoose\.isValidObjectId\(id\)\) return noStore\(notFound\(/g) ?? []).length, 2, `${rel}: PUT and DELETE`);
  }
  for (const rel of ROUTES) {
    for (const line of src(rel).split("\n").filter((l) => /\breturn\b/.test(l))) {
      if (/return (authed|parsed)\.error;/.test(line)) continue;
      assert.match(line, /return noStore\(/, `${rel}: ${line.trim()}`);
    }
  }
});

test("PIN: the setup libs never connect, never log; the station delete clears the cached category and item lists", () => {
  for (const rel of LIBS) {
    const file = src(rel);
    assert.ok(!/connectDB\(/.test(file), `${rel} never calls connectDB()`);
    assert.ok(!/console\./.test(file), `${rel} never logs`);
  }
  const del = src("app/api/stations/[id]/route.ts");
  assert.match(del, /cache\.del\(CATEGORY_LIST\.cacheKey\);\s*cache\.del\(PRODUCT_LIST\.cacheKey\);/);
});

test("PIN: simple mode costs one read: the printers first, and null before anything else is read", () => {
  const file = src("lib/print-routing-context.ts");
  const first = file.indexOf("await listPrinters()");
  const bail = file.indexOf("if (!printersModeOn(printers)) return null;");
  const stations = file.indexOf("Station.find(");
  assert.ok(first > 0 && bail > first && stations > bail, "listPrinters, then the simple-mode answer, then the rest");
  assert.ok(!/cache\./.test(file), "read fresh: a printer switched off stops getting slips at once");
});

test("PIN: the routing is pure: no model, no database, no clock", () => {
  const file = src("lib/print-printer-routing.ts");
  assert.ok(!/@\/models\//.test(file), "no model import");
  assert.ok(!/Date\.now\(|new Date\(/.test(file), "no clock");
  assert.ok(!/from "mongoose"/.test(file), "no mongoose");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

Replace it with:

```json
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-setup-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

Create `apps/cafe/app/api/printers/[id]/route.ts`:

```ts
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { PRINTER_NOT_FOUND, deletePrinter, replacePrinter } from "@/lib/print-printers";
import { printerBodySchema } from "@/lib/print-printer-schemas";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Printing redesign, Phase 2 (spec §6.3, §11). Admin only.
// PUT /api/printers/[id] — save a printer whole (the setup form's one unit).
// DELETE /api/printers/[id] — remove a printer. (Session 2C decides what happens to slips still waiting for
//   it; until then nothing makes a job for a printer.)
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(PRINTER_NOT_FOUND));

  const parsed = await validateBody(req, printerBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await replacePrinter(id, parsed.data);
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to save the printer", error));
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(PRINTER_NOT_FOUND));

  try {
    await connectDB();
    const result = await deletePrinter(id);
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to delete the printer", error));
  }
}
```

Create `apps/cafe/app/api/printers/route.ts`:

```ts
import { connectDB } from "@/lib/db";
import { createPrinter, listPrinters } from "@/lib/print-printers";
import { printerBodySchema } from "@/lib/print-printer-schemas";
import { created, failure, requireAdmin, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Printing redesign, Phase 2 (spec §6.3, §11).
// GET /api/printers — every printer in display order, disabled ones too. Any signed-in device reads it (the
//   setup screens; from Session 2C, each device's agent finds the printers it writes to).
// POST /api/printers — add a printer, saved whole (admin).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    return noStore(success(await listPrinters()));
  } catch (error) {
    return noStore(serverError("Failed to load the printers", error));
  }
}

export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, printerBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await createPrinter(parsed.data);
    return noStore(result.ok ? created(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to add the printer", error));
  }
}
```

Create `apps/cafe/app/api/stations/[id]/route.ts`:

```ts
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { CATEGORY_LIST, PRODUCT_LIST } from "@/lib/masters";
import { STATION_NOT_FOUND, deleteStation, updateStation } from "@/lib/print-stations";
import { updateStationBodySchema } from "@/lib/print-printer-schemas";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Printing redesign, Phase 2 (spec §6.1, §11). Admin only.
// PUT /api/stations/[id] — rename, and/or make it the default station.
// DELETE /api/stations/[id] — delete a station that is not the default; every category, item and printer that
//   chose it goes back to the default (lib/print-stations.ts).
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(STATION_NOT_FOUND));

  const parsed = await validateBody(req, updateStationBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await updateStation(id, parsed.data);
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to save the station", error));
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(STATION_NOT_FOUND));

  try {
    await connectDB();
    const result = await deleteStation(id);
    if (!result.ok) return noStore(failure(result.error, result.status));
    // Categories and items that chose it lost their stationId: the cached lists must not show it.
    cache.del(CATEGORY_LIST.cacheKey);
    cache.del(PRODUCT_LIST.cacheKey);
    return noStore(success(result.data));
  } catch (error) {
    return noStore(serverError("Failed to delete the station", error));
  }
}
```

Create `apps/cafe/app/api/stations/route.ts`:

```ts
import { connectDB } from "@/lib/db";
import { createStation, listStations } from "@/lib/print-stations";
import { createStationBodySchema } from "@/lib/print-printer-schemas";
import { created, failure, requireAdmin, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Printing redesign, Phase 2 (spec §6.1, §11).
// GET /api/stations — every kitchen station in display order; the first read seeds the default "Kitchen".
//   Any signed-in device reads it (the setup screens; the category and item forms).
// POST /api/stations — add a station (admin).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    return noStore(success(await listStations()));
  } catch (error) {
    return noStore(serverError("Failed to load the stations", error));
  }
}

export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createStationBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await createStation(parsed.data);
    return noStore(result.ok ? created(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to add the station", error));
  }
}
```

Create `apps/cafe/lib/print-printer-schemas.ts`:

```ts
import { z } from "zod";
import { objectIdString } from "@pos/shared/schemas";
import {
  PRINTER_ADDRESS_MAX_CHARS,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_ID_MAX_CHARS,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_LAN_DEFAULT_PORT,
  PRINTER_NAME_MAX_CHARS,
  STATIONS_MAX,
  STATION_NAME_MAX_CHARS,
} from "@pos/shared/print-printers";
import { ADDRESS_MESSAGE, isValidPrinterHost } from "@/lib/printer/network-address";

// Printing redesign, Phase 2 (spec §6.1, §6.3, §11): the request bodies of the stations and printers routes.
// They live in a lib file because a Next route file cannot export extra names, and the tests need them.
// Messages are the words staff read on the setup screens (Session 2D).

const stationName = z
  .string()
  .trim()
  .min(1, "Name the station")
  .max(STATION_NAME_MAX_CHARS, `Keep it to ${STATION_NAME_MAX_CHARS} characters or fewer`);

/** POST /api/stations. */
export const createStationBodySchema = z.object({ name: stationName }).strict();

/** PUT /api/stations/[id]: a new name, and/or "make this the default". The default is moved, never unset. */
export const updateStationBodySchema = z
  .object({ name: stationName.optional(), isDefault: z.literal(true).optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.isDefault !== undefined, { message: "Nothing to change", path: ["name"] });

const copies = z
  .number()
  .int("Use a whole number")
  .min(PRINTER_COPIES_MIN, `At least ${PRINTER_COPIES_MIN} copy`)
  .max(PRINTER_COPIES_MAX, `At most ${PRINTER_COPIES_MAX} copies`);

// A LAN printer's address is checked the way the POS app checks it before it connects (network-address.ts,
// pinned to the app's own rule), so a typo is caught on the form, never as a refusal from the printer.
const lanConnection = z
  .object({
    kind: z.literal("lan"),
    host: z.string().trim().toLowerCase().refine(isValidPrinterHost, ADDRESS_MESSAGE),
    port: z.number().int().min(1).max(65535).default(PRINTER_LAN_DEFAULT_PORT),
  })
  .strict();

const deviceConnection = z
  .object({
    kind: z.literal("device"),
    deviceId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS),
    transport: z.enum(PRINTER_DEVICE_TRANSPORTS),
    address: z.string().trim().min(1).max(PRINTER_ADDRESS_MAX_CHARS),
  })
  .strict();

/** POST /api/printers and PUT /api/printers/[id]: the WHOLE printer, as the setup form saves it (one unit,
 *  so the LAN-needs-a-printing-device rule is checked against the connection it is saved with). */
export const printerBodySchema = z
  .object({
    name: z.string().trim().min(1, "Name the printer").max(PRINTER_NAME_MAX_CHARS, `Keep it to ${PRINTER_NAME_MAX_CHARS} characters or fewer`),
    connection: z.discriminatedUnion("kind", [lanConnection, deviceConnection]),
    primaryDeviceId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS).optional(),
    /** Display order; absent on create puts it last, absent on save keeps it. */
    order: z.number().int().min(0).max(10_000).optional(),
    paper: z.union([z.literal(58), z.literal(80)]),
    slips: z
      .object({
        bill: z.boolean(),
        kotStations: z
          .array(objectIdString)
          .max(STATIONS_MAX)
          .refine((ids) => new Set(ids).size === ids.length, "The same station appears twice"),
        kotAll: z.boolean(),
        notices: z.boolean(),
        eod: z.boolean(),
      })
      .strict(),
    copies: z.object({ kot: copies, bill: copies }).strict(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((body, ctx) => {
    // Phase 2: one writer per printer (spec §9.3). A network printer is written by the device chosen here;
    // a device printer only ever by its own device. Failover to other devices is Phase 3 (§9.4).
    if (body.connection.kind === "lan" && body.primaryDeviceId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryDeviceId"], message: "Choose the device that prints to this network printer" });
    }
    if (body.connection.kind === "device" && body.primaryDeviceId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryDeviceId"], message: "Only a network printer is printed by another device" });
    }
  });

export type CreateStationBody = z.infer<typeof createStationBodySchema>;
export type UpdateStationBody = z.infer<typeof updateStationBodySchema>;
export type PrinterBody = z.infer<typeof printerBodySchema>;
```

Create `apps/cafe/lib/print-printers.ts`:

```ts
import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINTERS_MAX, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import { Printer, type IPrinter, type IPrinterConnection } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import type { PrintSetupResult } from "@/lib/print-stations";

// Printing redesign, Phase 2 (spec §6.3, §11): the outlet's printers. The setup screens (Session 2D) save a
// printer whole; the routing (lib/print-printer-routing.ts) and, from Session 2C, the agent read them as
// PrinterConfig. Never calls connectDB() (the routes do). No console.*.

export const PRINTER_NOT_FOUND = "Printer not found";
export const PRINTER_EXISTS_MESSAGE = "A printer with this name already exists.";
export const PRINTERS_FULL_MESSAGE = `A cafe can have at most ${PRINTERS_MAX} printers.`;
export const PRINTER_UNKNOWN_STATION_MESSAGE = "A chosen station no longer exists. Reload and choose again.";

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled"> & {
  _id: Types.ObjectId;
};

function connectionWireOf(c: IPrinterConnection): PrinterConnection {
  return c.kind === "lan"
    ? { kind: "lan", host: c.host ?? "", port: c.port ?? 0 }
    : { kind: "device", deviceId: c.deviceId ?? "", transport: c.transport ?? "bt-classic", address: c.address ?? "" };
}

/** A stored printer as the API sends it (the model's validator keeps each connection complete, so the
 *  fallbacks above never show). */
export function printerWireOf(row: PrinterRow): PrinterConfig {
  return {
    id: String(row._id),
    name: row.name,
    connection: connectionWireOf(row.connection),
    ...(row.primaryDeviceId !== undefined ? { primaryDeviceId: row.primaryDeviceId } : {}),
    order: row.order,
    paper: row.paper,
    slips: {
      bill: row.slips.bill,
      kotStations: [...(row.slips.kotStations ?? [])],
      kotAll: row.slips.kotAll,
      notices: row.slips.notices,
      eod: row.slips.eod,
    },
    copies: { kot: row.copies.kot, bill: row.copies.bill },
    enabled: row.enabled,
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
  const rows = await Printer.find().select(PRINTER_SELECT).sort({ order: 1, _id: 1 }).lean<PrinterRow[]>();
  return rows.map(printerWireOf);
}

/** Every station a printer takes KOTs for must exist now (a stale form never saves a dead id). */
async function stationsExist(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  return (await Station.countDocuments({ _id: { $in: ids } })) === ids.length;
}

export async function createPrinter(body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, ...stored } = body;
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  const existing = await Printer.find().select("order").lean<Array<{ order: number }>>();
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  // The unique name index must exist before the first insert (house rule: crud-route.ts).
  await Printer.init();
  try {
    const created = await Printer.create({ ...stored, order: order ?? last + 1 });
    return { ok: true, data: printerWireOf(created) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
    throw error;
  }
}

/** Saves a printer whole (the setup form's one unit). The connection is replaced, never merged (a LAN
 *  printer moved to a device keeps no host); an absent order keeps its place; an absent primaryDeviceId is
 *  removed (a device printer never has one). */
export async function replacePrinter(id: string, body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, ...stored } = body;
  const printer = await Printer.findById(id);
  if (printer === null) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  printer.set("connection", stored.connection);
  printer.set("primaryDeviceId", stored.primaryDeviceId);
  printer.set({ name: stored.name, paper: stored.paper, slips: stored.slips, copies: stored.copies, enabled: stored.enabled });
  if (order !== undefined) printer.order = order;
  try {
    await printer.save();
    return { ok: true, data: printerWireOf(printer) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
    throw error;
  }
}

export async function deletePrinter(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const res = await Printer.deleteOne({ _id: id });
  return res.deletedCount === 1 ? { ok: true, data: { deleted: true } } : { ok: false, status: 404, error: PRINTER_NOT_FOUND };
}
```

Create `apps/cafe/lib/print-routing-context.ts`:

```ts
import mongoose, { type Types } from "mongoose";
import { printersModeOn, resolveStationId } from "@pos/shared/print-printers";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrintRouting } from "@/lib/print-printer-routing";
import { listPrinters } from "@/lib/print-printers";
import { stationWireOf } from "@/lib/print-stations";

// Printing redesign, Phase 2 (spec §6.2, §8): what one order request routes its slips with, read fresh
// (never cached: a printer switched off must stop getting slips at once). Simple mode costs ONE small read
// (the printers) and answers null; printers mode adds the stations and the stations of this request's items
// (two reads by id: the items, then their categories). Session 2C calls it from job creation. Never calls
// connectDB(). No console.*.

interface ProductStationRow {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;
  stationId?: Types.ObjectId;
}

interface CategoryStationRow {
  _id: Types.ObjectId;
  stationId?: Types.ObjectId;
}

/** null in simple mode (spec §6.6): no enabled printer takes a slip, so routing is today's. */
export async function readPrintRouting(input: { productIds: readonly string[]; billPrinterId?: string }): Promise<PrintRouting | null> {
  const printers = await listPrinters();
  if (!printersModeOn(printers)) return null;
  const ids = [...new Set(input.productIds)].filter((id) => mongoose.isValidObjectId(id));
  const [stationRows, products] = await Promise.all([
    Station.find().select("name order isDefault").lean<Array<{ _id: Types.ObjectId; name: string; order: number; isDefault: boolean }>>(),
    ids.length === 0 ? Promise.resolve([]) : Product.find({ _id: { $in: ids } }).select("categoryId stationId").lean<ProductStationRow[]>(),
  ]);
  const stations = stationRows.map(stationWireOf);
  const categoryIds = [...new Set(products.map((product) => String(product.categoryId)))];
  const categories =
    categoryIds.length === 0 ? [] : await Category.find({ _id: { $in: categoryIds } }).select("stationId").lean<CategoryStationRow[]>();
  const categoryStation = new Map(categories.map((category) => [String(category._id), category.stationId]));
  const itemStations = new Map<string, string>();
  for (const product of products) {
    const categoryStationId = categoryStation.get(String(product.categoryId));
    const resolved = resolveStationId(
      {
        ...(product.stationId !== undefined ? { productStationId: String(product.stationId) } : {}),
        ...(categoryStationId !== undefined ? { categoryStationId: String(categoryStationId) } : {}),
      },
      stations,
    );
    if (resolved !== null) itemStations.set(String(product._id), resolved);
  }
  return { printers, stations, itemStations, ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}) };
}
```

Create `apps/cafe/lib/print-stations.ts`:

```ts
import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { DEFAULT_STATION_NAME, STATIONS_MAX, defaultStationOf, type StationConfig } from "@pos/shared/print-printers";
import { Category } from "@/models/Category";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { CreateStationBody, UpdateStationBody } from "@/lib/print-printer-schemas";

// Printing redesign, Phase 2 (spec §6.1, §11): kitchen stations. The first read seeds the default
// "Kitchen"; there is always exactly one default, which can be moved but never deleted. Deleting a station
// clears it everywhere it was chosen (categories, items, printers), so no row points at a station that is
// gone (owner: no stale print data). Never calls connectDB() (the routes do). No console.*.

/** A setup write's answer: the routes turn a refusal into its status and message. */
export type PrintSetupResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string };

export const STATION_NOT_FOUND = "Station not found";
export const STATION_EXISTS_MESSAGE = "A station with this name already exists.";
export const STATIONS_FULL_MESSAGE = `A cafe can have at most ${STATIONS_MAX} stations.`;
export const STATION_DEFAULT_DELETE_MESSAGE = "The default station can't be deleted. Make another station the default first.";

interface StationRow {
  _id: Types.ObjectId;
  name: string;
  order: number;
  isDefault: boolean;
}

export function stationWireOf(row: StationRow): StationConfig {
  return { id: String(row._id), name: row.name, order: row.order, isDefault: row.isDefault };
}

async function readStations(): Promise<StationConfig[]> {
  const rows = await Station.find().select("name order isDefault").sort({ order: 1, _id: 1 }).lean<StationRow[]>();
  return rows.map(stationWireOf);
}

/** Seeds the default "Kitchen" (spec §6.1). Two first reads racing both upsert the same name: the unique
 *  name index lets one insert and the other match or collide (a no-op). */
export async function seedDefaultStation(): Promise<void> {
  // The unique name index is what makes the race safe, and connectDB()'s autoIndex build is not awaited
  // (house rule: print-device.ts, crud-route.ts). .init() is memoized per process.
  await Station.init();
  try {
    await Station.updateOne({ name: DEFAULT_STATION_NAME }, { $setOnInsert: { order: 0, isDefault: true } }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/** Every station in display order. The first read seeds the default one. */
export async function listStations(): Promise<StationConfig[]> {
  const stations = await readStations();
  if (stations.length > 0) return stations;
  await seedDefaultStation();
  return readStations();
}

export async function createStation(body: CreateStationBody): Promise<PrintSetupResult<StationConfig>> {
  const stations = await listStations();
  if (stations.length >= STATIONS_MAX) return { ok: false, status: 400, error: STATIONS_FULL_MESSAGE };
  const order = Math.max(...stations.map((station) => station.order)) + 1;
  try {
    const created = await Station.create({ name: body.name, order, isDefault: false });
    return { ok: true, data: stationWireOf(created) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
    throw error;
  }
}

/** A rename and/or "make this the default". The old default is cleared FIRST, so two defaults never
 *  coexist; a request cut between the two writes leaves none for a moment, and defaultStationOf then
 *  picks the first in order. */
export async function updateStation(id: string, body: UpdateStationBody): Promise<PrintSetupResult<StationConfig>> {
  const station = await Station.findById(id);
  if (station === null) return { ok: false, status: 404, error: STATION_NOT_FOUND };
  if (body.isDefault === true && !station.isDefault) {
    await Station.updateMany({ _id: { $ne: station._id }, isDefault: true }, { $set: { isDefault: false } });
    station.isDefault = true;
  }
  if (body.name !== undefined) station.name = body.name;
  try {
    await station.save();
    return { ok: true, data: stationWireOf(station) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
    throw error;
  }
}

/** Deletes a station that is not the default, then clears it from every category, item and printer that
 *  chose it: they fall back to the default (spec §6.2), as a lookup of a deleted station would. */
export async function deleteStation(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const stations = await readStations();
  const station = stations.find((s) => s.id === id);
  if (station === undefined) return { ok: false, status: 404, error: STATION_NOT_FOUND };
  if (defaultStationOf(stations)?.id === id) return { ok: false, status: 400, error: STATION_DEFAULT_DELETE_MESSAGE };
  await Station.deleteOne({ _id: id });
  await Promise.all([
    Category.updateMany({ stationId: id }, { $unset: { stationId: "" } }),
    Product.updateMany({ stationId: id }, { $unset: { stationId: "" } }),
    Printer.updateMany({ "slips.kotStations": id }, { $pull: { "slips.kotStations": id } }),
  ]);
  return { ok: true, data: { deleted: true } };
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-setup-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && npx eslint lib/print-stations.ts lib/print-printers.ts lib/print-routing-context.ts lib/print-printer-schemas.ts lib/print-setup-paths.test.ts "app/api/stations/route.ts" "app/api/stations/[id]/route.ts" "app/api/printers/route.ts" "app/api/printers/[id]/route.ts" && echo LINT_OK`
Expected: `# tests 10`; `# pass 10`; `# fail 0`; `TSC_OK`; `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add "apps/cafe/app/api/printers/[id]/route.ts" apps/cafe/app/api/printers/route.ts "apps/cafe/app/api/stations/[id]/route.ts" apps/cafe/app/api/stations/route.ts apps/cafe/lib/print-printer-schemas.ts apps/cafe/lib/print-printers.ts apps/cafe/lib/print-routing-context.ts apps/cafe/lib/print-setup-paths.test.ts apps/cafe/lib/print-stations.ts apps/cafe/package.json
git commit -m "feat(print): Phase 2 setup API: stations and printers (admin writes, signed-in reads), and the routing setup read fresh per request (dormant)"
```

---

### Task A5: the budget recount (spec §17): stations and the heavy full-copy day under the free-tier ceilings; in printers mode only writers poll, sharing one allowance

**Files:**
- Modify: `packages/shared/src/print-budget.ts` (`printRequestsForSlips`, `PRINT_BUDGET_STATIONS_DAY`, `printStationSlipsPerDay`, `PRINT_REALTIME_PER_PRINTER_SLIP`)
- Modify: `packages/shared/src/print-agent-wire.ts` (`printAgentPollsWake` takes `printersMode?`/`isWriter?`; `PRINT_WAKE_PRINTERS_DAILY_CAP` 14,000; `printWakeWriterCap`)
- Tests: `packages/shared/src/print-budget.test.ts` (five new tests)

**Interfaces produced:** `printRequestsForSlips(slips): number`; `PRINT_BUDGET_STATIONS_DAY`; `printStationSlipsPerDay({ fullCopy }): number`; `PRINT_REALTIME_PER_PRINTER_SLIP` 2; `printAgentPollsWake({ hostConfigured, isHost, printersMode?, isWriter? }): boolean`; `PRINT_WAKE_PRINTERS_DAILY_CAP` 14,000; `printWakeWriterCap(writers): number`.

**The recount the 1C gate asked for** ("Phase 2's stations must recount, one lease per round per station"). Spec §17.2's busy day already assumed two stations (1,200 slips); the heavy setup adds a full copy per round (1,650). Each slip is one job (its copies ride along, decision 2) and costs one lease and one ack: Session 2B's ack answers whether its printer's line holds more, so no lease is ever made to find an empty line. Normal day: 4,800 (stations) and 5,790 (heavy), both under 6,000. Worst case (socket down all day, every writer always busy): the writers share `PRINT_WAKE_PRINTERS_DAILY_CAP` (14,000, a little under the host's 14,400), split by the writers the setup names, so the heavy day stays at 17,628 under 18,000 for any number of writers. Realtime: 2 Worker requests per slip in printers mode (no host nudge), 3,635 a day on the heavy day (3.6 %).

**`printAgentPollsWake` in printers mode** (decision 8): the devices that write to a printer poll, and no other device does, a leftover host included. Simple mode is unchanged (the Phase 1 pin still runs). Nobody passes `printersMode` until Session 2C.

- [ ] **Step 1: The failing tests first**

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  printAgentTimerDelayMs,
  printAgentWakeIntervalMs,
  printWakeAgentCap,
} from "./print-agent-wire";
import {
  PRINT_ACK_PENDING_MAX_MS,
```

Replace it with:

```ts
  printAgentTimerDelayMs,
  printAgentWakeIntervalMs,
  printWakeAgentCap,
  printWakeWriterCap,
  PRINT_WAKE_PRINTERS_DAILY_CAP,
} from "./print-agent-wire";
import {
  PRINT_ACK_PENDING_MAX_MS,
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  PRINT_REALTIME_BASE_PER_DAY,
  PRINT_REALTIME_PER_SLIP,
  REALTIME_FREE_REQUESTS_PER_DAY,
  printSlipRequestsPerDay,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
```

Replace it with:

```ts
  PRINT_REALTIME_BASE_PER_DAY,
  PRINT_REALTIME_PER_SLIP,
  REALTIME_FREE_REQUESTS_PER_DAY,
  PRINT_BUDGET_STATIONS_DAY,
  PRINT_REALTIME_PER_PRINTER_SLIP,
  printRequestsForSlips,
  printSlipRequestsPerDay,
  printStationSlipsPerDay,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(PRINT_DEVICE_PRUNE_MS > 1000 * PRINT_DEVICE_ONLINE_MS, "only a device gone for days, never one that is merely offline");
});

```

Replace it with:

```ts
  assert.ok(PRINT_DEVICE_PRUNE_MS > 1000 * PRINT_DEVICE_ONLINE_MS, "only a device gone for days, never one that is merely offline");
});

// Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A5): the stations recount the 1C gate asked
// for. Printers mode routes each KOT round to its stations' printers (spec §8), and each printer's writer
// leases its own line. These pins hold the cafe under the same ceilings with stations, with the heavy setup
// (a full copy per round too), and with any number of writers.
test("Phase 2 busy day with stations: spec §17.2's 1,200 slips; a full copy per round makes 1,650", () => {
  assert.equal(printStationSlipsPerDay({ fullCopy: false }), 1_200, "1.5 rounds x 2 stations + 1 bill, 300 orders");
  assert.equal(printStationSlipsPerDay({ fullCopy: true }), 1_650, "and a full copy of each round");
  assert.equal(printRequestsForSlips(1_200), printSlipRequestsPerDay(), "the same lease-and-ack price per slip as Phase 1");
});

test("Phase 2 normal day (socket healthy): stations stay at 4,800; the heavy setup at 5,790, under 6,000", () => {
  const wakePerWriter = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  const writers = PRINT_BUDGET_STATIONS_DAY.writers;
  const stations = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: false })) + writers * wakePerWriter;
  const heavy = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + writers * wakePerWriter;
  assert.equal(stations, 4_800);
  assert.equal(heavy, 5_790);
  assert.ok(heavy <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${heavy}/day`);
});

test("Phase 2 worst case (socket down all day, every writer always busy): the writers' shared cap holds even the heavy setup under 18,000", () => {
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  const heavySlips = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true }));
  for (const writers of [1, 2, 3, 5, 8, 12]) {
    const wake = writers * Math.min(OPEN_MS / fastest, printWakeWriterCap(writers));
    assert.ok(wake <= PRINT_WAKE_PRINTERS_DAILY_CAP, `${writers} writers: ${wake} wake hits`);
    assert.ok(heavySlips + wake <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${writers} writers: ${heavySlips + wake}/day`);
  }
  assert.equal(heavySlips + 3 * Math.min(OPEN_MS / fastest, printWakeWriterCap(3)), 17_628, "the heavy day's worst case");
});

test("Phase 2: in printers mode only writers poll; ordering devices and a leftover host never do", () => {
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: true, printersMode: true, isWriter: false }), false, "a host that writes to no printer stops polling");
  assert.equal(printAgentPollsWake({ hostConfigured: false, isHost: false, printersMode: true, isWriter: true }), true, "a writer polls");
  assert.equal(printAgentPollsWake({ hostConfigured: false, isHost: false, printersMode: true }), false, "an ordering device never polls");
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: true }), true, "simple mode is unchanged");
  assert.ok(PRINT_WAKE_PRINTERS_DAILY_CAP <= PRINT_WAKE_DAILY_CAP, "printers mode never polls more than a host did");
});

test("Phase 2 realtime: two Worker requests per slip in printers mode, the heavy day under 5 %", () => {
  const perDay = printStationSlipsPerDay({ fullCopy: true }) * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(perDay, 3_635);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
/** Whether this device polls the wake at all (spec §9.1, §17.3 rule 1; 1A review gate, I3). In simple
 *  mode only the host polls. With no host every device prints its own slips from its own order
 *  responses, targeted print-status events, local retry timers and the pulse, so no ordering device
 *  adds a recurring request, and one poller keeps the shared daily cap exact. */
export function printAgentPollsWake(input: { hostConfigured: boolean; isHost: boolean }): boolean {
  return input.hostConfigured && input.isHost;
}

/** Each agent's share of the cafe's one daily wake cap (spec §9.1): more agents never mean more hits. */
export function printWakeAgentCap(agents: number): number {
  return Math.floor(PRINT_WAKE_DAILY_CAP / Math.max(1, Math.floor(agents)));
}

/** The agent's wake cadence (spec §9.1). false: the daily share is spent, so stop polling until the
```

Replace it with:

```ts
/** Whether this device polls the wake at all (spec §9.1, §17.3 rule 1; 1A review gate, I3). In simple
 *  mode only the host polls. With no host every device prints its own slips from its own order
 *  responses, targeted print-status events, local retry timers and the pulse, so no ordering device
 *  adds a recurring request, and one poller keeps the shared daily cap exact.
 *  Phase 2, printers mode: the devices that write to a printer poll (each is its printers' only writer,
 *  spec §9.3), and no other device does, host or not. They share PRINT_WAKE_PRINTERS_DAILY_CAP. */
export function printAgentPollsWake(input: { hostConfigured: boolean; isHost: boolean; printersMode?: boolean; isWriter?: boolean }): boolean {
  if (input.printersMode === true) return input.isWriter === true;
  return input.hostConfigured && input.isHost;
}

/** Each agent's share of the cafe's one daily wake cap (spec §9.1): more agents never mean more hits. */
export function printWakeAgentCap(agents: number): number {
  return Math.floor(PRINT_WAKE_DAILY_CAP / Math.max(1, Math.floor(agents)));
}

/** Phase 2: the wake hits a day all printer writers share in printers mode. A little under the host's
 *  14,400, so the heavy setup's worst case (a full copy per round, the socket down all day) still fits the
 *  18,000 ceiling (print-budget.test.ts). The split is by the writers the SETUP names
 *  (printerWriterDevices), never by who is online, so a writer that starts late never raises the total. */
export const PRINT_WAKE_PRINTERS_DAILY_CAP = 14_000;

export function printWakeWriterCap(writers: number): number {
  return Math.floor(PRINT_WAKE_PRINTERS_DAILY_CAP / Math.max(1, Math.floor(writers)));
}

/** The agent's wake cadence (spec §9.1). false: the daily share is spent, so stop polling until the
```

In `packages/shared/src/print-budget.ts`, find:

```ts

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return Math.round(day.slips * PRINT_REQUESTS_PER_SLIP * (1 + day.retryShare));
}

```

Replace it with:

```ts

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return printRequestsForSlips(day.slips);
}

/** A lease and an ack per slip, plus the retried share, for any number of slips a day. */
export function printRequestsForSlips(slips: number): number {
  return Math.round(slips * PRINT_REQUESTS_PER_SLIP * (1 + PRINT_BUDGET_BUSY_DAY.retryShare));
}

/** Phase 2, the recount the 1C gate asked for (spec §8, §17.2): the busy day with stations. Each KOT round
 *  splits over two stations (spec §17.2's 1,200 slips), and the heavy setup adds a full copy per round
 *  (1,650). Every slip is ONE job whatever its copies, and costs one lease and one ack: the ack answers
 *  whether its printer's line holds more, so no lease is made to find an empty line (Session 2B). */
export const PRINT_BUDGET_STATIONS_DAY = {
  roundsPerOrder: 1.5,
  stationsPerRound: 2,
  fullCopyPerRound: 1,
  billsPerOrder: 1,
  /** Devices that write to a printer: a kitchen, a bar and a counter device (spec §17.2's 3 agents). */
  writers: 3,
} as const;

export function printStationSlipsPerDay(input: { fullCopy: boolean }): number {
  const d = PRINT_BUDGET_STATIONS_DAY;
  const perRound = d.stationsPerRound + (input.fullCopy ? d.fullCopyPerRound : 0);
  return Math.round(PRINT_BUDGET_BUSY_DAY.orders * (d.roundsPerOrder * perRound + d.billsPerOrder));
}

/** Printers mode publishes 2 realtime requests per slip: its "queued" print-status aimed at its writer, and
 *  its final state. No print-job nudge: that is for a host, and printers mode has none. */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 2;

```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 23`; `# pass 23`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-agent-wire.ts packages/shared/src/print-budget.test.ts packages/shared/src/print-budget.ts
git commit -m "feat(print): Phase 2 budget recount: stations and the heavy full-copy day under the free-tier ceilings; in printers mode only writers poll, sharing one allowance"
```

---

### Task A6: live legs ah–aj: stations, printers, and the routing read over a real catalog

**Files:**
- Create: `apps/cafe/scripts/print-host-live/printers.ts` (legs ah, ai, aj)
- Modify: `apps/cafe/scripts/verify-print-host-live.ts` (Station, Printer, Category and Product indexes; the three legs after ag)

**Interfaces produced:** `legAH()`, `legAI()`, `legAJ()`.

**What they prove against a real mongod** (the Review Focus): five first reads seed one default; a duplicate name is 409; the default moves and can't be deleted; a deleted station is cleared from a category, an item (the field is gone, never null) and a printer; at most 20 stations (ah). Printers in order; a duplicate name or an unknown station is refused; a LAN printer re-saved as a device printer keeps no host, port or printing device, and back again with a new place; delete, then 404 (ai). Simple mode reads null (no printer, or a disabled one); in printers mode an item's own station wins over its category's, a category's over the default, a deleted item station falls back to the category's; and end to end, one round of Hot Coffee (a Drinks item moved to the Kitchen), Paneer (Food, the default) and a Mojito (Drinks, the Bar) routes the kitchen two lines, the bar one and the counter's full copy all three (aj).

- [ ] **Step 1: The change**

Create `apps/cafe/scripts/print-host-live/printers.ts`:

```ts
/**
 * Printing Phase 2 Session 2A live legs (plan 2026-10-03-phase-2-routing.md, Task A6), against a REAL
 * MongoDB: the stations (ah) and printers (ai) setup, and the routing read over a real catalog (aj). Run by
 * scripts/verify-print-host-live.ts after leg ag.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { STATIONS_MAX } from "@pos/shared/print-printers";
import { Category } from "@/models/Category";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { createPrinter, deletePrinter, listPrinters, replacePrinter } from "@/lib/print-printers";
import { createStation, deleteStation, listStations, updateStation } from "@/lib/print-stations";
import { readPrintRouting } from "@/lib/print-routing-context";
import { routePrintRequest } from "@/lib/print-printer-routing";
import { kotPrintJob } from "@/lib/print-routing";
import { baseOrderFields, check } from "./harness";

async function resetSetup(): Promise<void> {
  await Promise.all([Station.deleteMany({}), Printer.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
}

function printerBody(name: string, over: Partial<PrinterBody> = {}): PrinterBody {
  return {
    name,
    connection: { kind: "device", deviceId: `${name}-device`, transport: "bt-classic", address: "00:11:22:33:44:55" },
    paper: 80,
    slips: { bill: false, kotStations: [], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

function idOf(result: { ok: boolean; data?: { id: string } }): string {
  return result.ok && result.data !== undefined ? result.data.id : "";
}

export async function legAH(): Promise<void> {
  console.log("\n(ah) stations: the default seeded once, moved never deleted, a deleted station cleared everywhere");
  await resetSetup();
  const reads = await Promise.all(Array.from({ length: 5 }, () => listStations()));
  const rows = await Station.find().lean();
  check("(ah) five first reads at once seed exactly one station, the default Kitchen", rows.length === 1 && rows[0]?.name === "Kitchen" && rows[0]?.isDefault === true);
  check("(ah) every racing read answers the same one station", reads.every((r) => r.length === 1 && r[0]?.id === String(rows[0]?._id)));

  const bar = await createStation({ name: "Bar" });
  const tandoor = await createStation({ name: "Tandoor" });
  check("(ah) new stations go last, never the default", bar.ok && tandoor.ok && bar.data.order === 1 && tandoor.data.order === 2 && !bar.data.isDefault);
  const twin = await createStation({ name: "Bar" });
  check("(ah) a second station with the same name is refused (409)", !twin.ok && twin.status === 409);

  const moved = await updateStation(idOf(bar), { isDefault: true });
  const defaults = await Station.find({ isDefault: true }).lean();
  check("(ah) making Bar the default moves the flag: exactly one default", moved.ok && defaults.length === 1 && String(defaults[0]?._id) === idOf(bar));
  const delDefault = await deleteStation(idOf(bar));
  check("(ah) the default station can't be deleted (400)", !delDefault.ok && delDefault.status === 400);
  const renameClash = await updateStation(idOf(tandoor), { name: "Kitchen" });
  check("(ah) a rename onto another station's name is refused (409)", !renameClash.ok && renameClash.status === 409);
  const missing = await updateStation(new mongoose.Types.ObjectId().toHexString(), { name: "Grill" });
  check("(ah) a station that does not exist answers 404", !missing.ok && missing.status === 404);

  const tId = idOf(tandoor);
  const category = await Category.create({ name: "Breads", stationId: tId });
  const product = await Product.create({ name: "Naan", categoryId: category._id, price: 40, stationId: tId });
  const printer = await createPrinter(printerBody("Tandoor printer", { slips: { bill: false, kotStations: [tId, idOf(bar)], kotAll: false, notices: true, eod: false } }));
  const deleted = await deleteStation(tId);
  const rawCategory = await Category.collection.findOne({ _id: category._id });
  const rawProduct = await Product.collection.findOne({ _id: product._id });
  const rawPrinter = await Printer.findById(idOf(printer)).lean();
  check("(ah) deleting Tandoor removes it", deleted.ok && (await Station.countDocuments({ _id: tId })) === 0);
  check("(ah) ... and clears it from the category and the item: the field is gone, never null", rawCategory !== null && !("stationId" in rawCategory) && rawProduct !== null && !("stationId" in rawProduct));
  check("(ah) ... and from the printer, keeping its other stations", JSON.stringify(rawPrinter?.slips.kotStations) === JSON.stringify([idOf(bar)]));

  for (let i = (await Station.countDocuments()); i < STATIONS_MAX; i++) await createStation({ name: `Station ${i}` });
  const over = await createStation({ name: "One too many" });
  check(`(ah) at most ${STATIONS_MAX} stations`, !over.ok && over.status === 400 && (await Station.countDocuments()) === STATIONS_MAX);
}

export async function legAI(): Promise<void> {
  console.log("\n(ai) printers: saved whole, in order, a connection replaced never merged");
  await resetSetup();
  const [kitchen] = await listStations();
  const kId = kitchen?.id ?? "";
  const lan = await createPrinter(printerBody("Kitchen printer", {
    connection: { kind: "lan", host: "192.168.1.60", port: 9100 },
    primaryDeviceId: "kitchen-tab",
    slips: { bill: false, kotStations: [kId], kotAll: false, notices: true, eod: false },
  }));
  const counter = await createPrinter(printerBody("Counter printer", { slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, copies: { kot: 1, bill: 2 } }));
  const list = await listPrinters();
  check("(ai) two printers listed in the order they were added", lan.ok && counter.ok && list.map((p) => p.name).join() === "Kitchen printer,Counter printer" && list[1]?.order === 1);
  check("(ai) a LAN printer keeps its printing device; a device printer has none", list[0]?.primaryDeviceId === "kitchen-tab" && !("primaryDeviceId" in (list[1] ?? {})));
  const twin = await createPrinter(printerBody("Counter printer"));
  check("(ai) a second printer with the same name is refused (409)", !twin.ok && twin.status === 409);
  const ghost = await createPrinter(printerBody("Bar printer", { slips: { bill: false, kotStations: [new mongoose.Types.ObjectId().toHexString()], kotAll: false, notices: true, eod: false } }));
  check("(ai) a printer for a station that does not exist is refused (400)", !ghost.ok && ghost.status === 400);

  const lanId = idOf(lan);
  const toDevice = await replacePrinter(lanId, printerBody("Kitchen printer", { slips: { bill: false, kotStations: [kId], kotAll: false, notices: true, eod: false } }));
  const raw = await Printer.collection.findOne({ _id: new mongoose.Types.ObjectId(lanId) });
  check("(ai) a LAN printer saved as a device printer keeps no host, port or printing device", toDevice.ok && raw !== null && raw.connection.kind === "device" && !("host" in raw.connection) && !("port" in raw.connection) && !("primaryDeviceId" in raw));
  check("(ai) a save without an order keeps the printer's place", toDevice.ok && toDevice.data.order === 0);
  const back = await replacePrinter(lanId, printerBody("Kitchen printer", { connection: { kind: "lan", host: "192.168.1.61", port: 9101 }, primaryDeviceId: "kitchen-tab-2", order: 5 }));
  check("(ai) ... and back to LAN with a new printing device and a new place", back.ok && back.data.connection.kind === "lan" && back.data.primaryDeviceId === "kitchen-tab-2" && back.data.order === 5);
  const gone = await deletePrinter(lanId);
  const again = await deletePrinter(lanId);
  check("(ai) a deleted printer is gone; deleting it again answers 404", gone.ok && !again.ok && again.status === 404 && (await Printer.countDocuments()) === 1);
}

export async function legAJ(): Promise<void> {
  console.log("\n(aj) routing over a real catalog: item override, category station, the default; simple mode is one read");
  await resetSetup();
  check("(aj) no printers: simple mode, no routing", (await readPrintRouting({ productIds: [] })) === null);
  const [kitchen] = await listStations();
  const bar = await createStation({ name: "Bar" });
  const kId = kitchen?.id ?? "";
  const bId = idOf(bar);
  const off = await createPrinter(printerBody("Spare", { enabled: false, slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true } }));
  check("(aj) a disabled printer keeps simple mode", off.ok && (await readPrintRouting({ productIds: [] })) === null);

  await createPrinter(printerBody("Kitchen printer", { slips: { bill: false, kotStations: [kId], kotAll: false, notices: true, eod: false } }));
  await createPrinter(printerBody("Bar printer", { slips: { bill: false, kotStations: [bId], kotAll: false, notices: true, eod: false } }));
  await createPrinter(printerBody("Counter printer", { slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true } }));
  const drinks = await Category.create({ name: "Drinks", stationId: bId });
  const food = await Category.create({ name: "Food" });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const coffee = await Product.create({ name: "Hot Coffee", categoryId: drinks._id, price: 90, stationId: kId });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const stray = await Product.create({ name: "Special", categoryId: drinks._id, price: 99, stationId: new mongoose.Types.ObjectId() });
  const ids = [mojito, coffee, paneer, stray].map((p) => String(p._id));

  const routing = await readPrintRouting({ productIds: [...ids, "not-an-id"], billPrinterId: "chosen" });
  const at = (id: string) => routing?.itemStations.get(id);
  check("(aj) printers mode reads the setup", routing !== null && routing.printers.length === 4 && routing.stations.length === 2 && routing.billPrinterId === "chosen");
  check("(aj) the category's station: Mojito prints at the Bar", at(ids[0] ?? "") === bId);
  check("(aj) the item's own station wins: Hot Coffee (Drinks) prints in the Kitchen", at(ids[1] ?? "") === kId);
  check("(aj) no station anywhere: Paneer prints at the default (Kitchen)", at(ids[2] ?? "") === kId);
  check("(aj) an item station that no longer exists falls back to its category's (Bar)", at(ids[3] ?? "") === bId);

  const lines = [mojito, coffee, paneer].map((p) => ({ productId: String(p._id), name: p.name, price: p.price, qty: 1, modifiers: [], instructions: "", kotRound: 1 }));
  const order = baseOrderFields({ _id: new mongoose.Types.ObjectId().toHexString(), items: lines, status: "Pending" });
  const jobs = routing === null ? [] : routePrintRequest(kotPrintJob(order, 1), routing);
  const itemsOf = (i: number) => {
    const payload = jobs[i]?.request.payload;
    return payload?.kind === "kot" ? payload.snapshot.items.map((line) => line.name).join("+") : "";
  };
  check("(aj) end to end: the kitchen gets Hot Coffee and Paneer, the bar the Mojito, the counter all three", jobs.length === 3 && itemsOf(0) === "Hot Coffee+Paneer Tikka" && itemsOf(1) === "Mojito" && itemsOf(2) === "Mojito+Hot Coffee+Paneer Tikka");
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";
import { legAD, legAE } from "./print-host-live/agent";
import { legAF, legAG } from "./print-host-live/attention";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";
import { legAD, legAE } from "./print-host-live/agent";
import { legAF, legAG } from "./print-host-live/attention";
import { legAH, legAI, legAJ } from "./print-host-live/printers";
import { Station } from "@/models/Station";
import { Printer } from "@/models/Printer";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([PrintJob.createIndexes(), PrintHost.createIndexes(), Order.createIndexes(), PrintDevice.createIndexes()]);

  console.log(`\nPH-10 print-host live legs — live against ${dbName}\n`);

```

Replace it with:

```ts
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([PrintJob.createIndexes(), PrintHost.createIndexes(), Order.createIndexes(), PrintDevice.createIndexes()]);
  // Phase 2: the unique station and printer names are what the setup legs (ah, ai) lean on.
  await Promise.all([Station.createIndexes(), Printer.createIndexes(), Category.createIndexes(), Product.createIndexes()]);

  console.log(`\nPH-10 print-host live legs — live against ${dbName}\n`);

```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAF(Date.now());
    // Phase 1 Session 1E leg (the owner's retention after Session 1D).
    await legAG(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAF(Date.now());
    // Phase 1 Session 1E leg (the owner's retention after Session 1D).
    await legAG(Date.now());
    // Phase 2 Session 2A legs (stations, printers, the routing read over a real catalog).
    await legAH();
    await legAI();
    await legAJ();
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

- [ ] **Step 2: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK && npx eslint scripts/print-host-live/printers.ts scripts/verify-print-host-live.ts && echo LINT_OK`
Expected: `TSC_OK`; `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | grep -E "passed, [0-9]+ failed"`
Expected: `248 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/printers.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): Phase 2 live legs ah–aj: stations, printers, and the routing read over a real catalog"
```

---

### Task A7: full verification, builds, the emulator check, Results

**Files:** this plan (Session 2A Results). The tool below goes in this session's scratchpad, never in the repo.

- [ ] **Step 1: Every suite**

Run each from the repo (they are the totals the pre-validation saw on a fresh clone):

| Run | Expected |
|---|---|
| `cd /d/kd/lucifer/packages/shared && npm test && npx tsc --noEmit -p .` | `# tests 667`, `# pass 667`; tsc 0 |
| `cd /d/kd/lucifer/apps/cafe && npm test` | `# tests 4300`, `# pass 4299`, `# fail 0`, `# skipped 1` (the `go-live-dl` pin) |
| `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npm run lint` | tsc 0; lint 0 errors and the 2 old warnings |
| `cd /d/kd/lucifer/apps/hub && npx tsc --noEmit` | 0 |
| `cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test && npm run test:app` | 117/117; Jest 3/3 (untouched) |
| `cd /d/kd/lucifer/apps/desktop && npm test` | 191/191 (untouched) |
| `cd /d/kd/lucifer && npm run test:print-tools` | 8/8 |
| `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live` | `248 passed, 0 failed` (220 + 28: ah 12, ai 8, aj 8) |

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build`
Expected: the build succeeds and its route list has 127 routes (`main` has 123; 2A adds `/api/stations`, `/api/stations/[id]`, `/api/printers`, `/api/printers/[id]`).

- [ ] **Step 3: APKs (no mobile change: byte-identical to the release)**

Build the x86_64 APK, then the ARM pair, with `GRADLE_USER_HOME='D:\gradle-home'` (the README's commands). Expected: byte-identical to the 2026-10-03 release (`D:\kd\pos-apk-release\Sandbee-POS-final\`): arm64 `0e0ec314…`, armv7 `e618900a…`, x86_64 `29115bdf…`. A different hash means something outside the plan changed: stop and find out what.

- [ ] **Step 4: The emulator check (2A changes nothing for a cafe)**

**First check which POS the emulator's app shows** (Global Constraints, Demo POS): never act on the live demo. The harness is Phase 1's: the local POS (`next start -p 3100` with an env file in the scratchpad), the emulator app (`Pixel_7_API_33`, WebView 109) at `http://localhost:3100` through `adb reverse tcp:3100 tcp:3100`, as the print host with the fake printer at `10.0.2.2:9100` (`node scripts/fake-escpos-printer.mjs --port 9100 --out <scratchpad>/fake-jobs-2a`). Use a fresh `pos_scratch_e2e_2a` database (Phase 1's `make-env.py` writes its env file; seed the admin, tables and menu with `scripts/seed-admin.ts`, `seed-tables.ts`, `seed-menu.ts`), or the env file of an earlier session if you have it. Save this tool as `<scratchpad>/p2a-tool.ts` (the Write tool; it prints statuses, counts and ids only, never a secret) and run it from `apps/cafe` with `node --env-file=<scratchpad>/e2e.env --import tsx <scratchpad>/p2a-tool.ts <mode>`:

```ts
// Session 2A emulator check (scratchpad only; never in the repo). It drives the new setup API as the e2e admin
// (a session minted from the env file's AUTH_SECRET, never printed) and prints statuses, counts and ids only:
// never a secret, a token or a payload. Run from apps/cafe:
//   node --env-file=<scratchpad>/e2e.env --import tsx <scratchpad>/p2a-tool.ts <mode>
// modes: setup     a Bar station, three printers (a counter full copy + bills, a kitchen, a LAN bar), the
//                  second product's category on the Bar
//        api       the answers a device sees: lists, no-store, a bad id, a LAN printer with no printing device
//        kot       a KOT of two items (one per category) as e2e-script-device, with the agent headers
//        jobs      the newest jobs: kind, status, target, and whether any carries a printerId or copies
//        teardown  the printers and the Bar station removed again through the API
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const mongoose = require("mongoose") as typeof import("mongoose");
const { encode } = require("next-auth/jwt") as typeof import("next-auth/jwt");

// The local POS; P2A_BASE points it elsewhere (the gate's pre-run served the golden build on 3110).
const BASE = process.env.P2A_BASE ?? "http://localhost:3100";
const COOKIE = "authjs.session-token";
const DEVICE = "e2e-script-device";
type Db = NonNullable<typeof mongoose.connection.db>;
type Json = { data?: unknown; error?: string };

async function cookieFor(db: Db): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET missing from the env file");
  const staff = await db.collection("staffs").findOne({ username: "e2eadmin" }, { projection: { name: 1, role: 1 } });
  if (staff === null) throw new Error("e2eadmin not found");
  const token = await encode({ token: { name: staff.name, id: String(staff._id), role: staff.role, lastValidated: Date.now() }, secret, salt: COOKIE });
  return `${COOKIE}=${token}`;
}

async function call(cookie: string, method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json; cache: string | null }> {
  const res = await fetch(`${BASE}${url}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = { error: `non-JSON answer (${text.length} chars)` };
  }
  return { status: res.status, json, cache: res.headers.get("cache-control") };
}

function printer(name: string, connection: Record<string, unknown>, slips: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { name, connection, paper: 80, slips: { bill: false, kotStations: [], kotAll: false, notices: true, eod: false, ...slips }, copies: { kot: 1, bill: 1 }, enabled: true, ...extra };
}

async function twoProducts(db: Db) {
  const products = await db.collection("products").find({ isActive: true }).project({ name: 1, price: 1, categoryId: 1 }).toArray();
  const first = products[0];
  const second = products.find((p) => String(p.categoryId) !== String(first?.categoryId));
  if (first === undefined || second === undefined) throw new Error("the menu needs two categories");
  return [first, second];
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const uri = process.env.MONGODB_URI ?? "";
  if (!/\/pos_scratch_e2e_[a-z0-9_]+$/.test(uri)) throw new Error("refusing: not a pos_scratch_e2e_* database");
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("no db");
    const out = (v: unknown) => console.log(JSON.stringify(v, null, 1));
    if (mode === "jobs") {
      const rows = await db.collection("printjobs").find({}, { projection: { payload: 0, log: 0 } }).sort({ createdAt: -1, _id: -1 }).limit(6).toArray();
      return out({
        withPrinterId: await db.collection("printjobs").countDocuments({ printerId: { $exists: true } }),
        withCopies: await db.collection("printjobs").countDocuments({ copies: { $exists: true } }),
        newest: rows.map((j) => ({ id: String(j._id), kind: j.kind, status: j.status, label: j.label, target: typeof j.targetDeviceId === "string" ? `${j.targetDeviceId.slice(0, 8)}…` : null, printedAt: j.printedAt ?? null })),
      });
    }
    const cookie = await cookieFor(db);
    if (mode === "setup") {
      const stations = await call(cookie, "GET", "/api/stations", null);
      const list = (stations.json.data as Array<{ id: string; name: string; isDefault: boolean }> | undefined) ?? [];
      const kitchen = list.find((s) => s.isDefault);
      const bar = await call(cookie, "POST", "/api/stations", { name: "Bar" });
      const barId = (bar.json.data as { id?: string } | undefined)?.id ?? list.find((s) => s.name === "Bar")?.id ?? "";
      const made = [
        await call(cookie, "POST", "/api/printers", printer("Counter printer", { kind: "device", deviceId: "p2a-counter-device", transport: "usb", address: "usb:0483:5743" }, { bill: true, kotAll: true, eod: true })),
        await call(cookie, "POST", "/api/printers", printer("Kitchen printer", { kind: "device", deviceId: "p2a-kitchen-device", transport: "bt-classic", address: "00:11:22:33:44:55" }, { kotStations: [kitchen?.id ?? ""] })),
        await call(cookie, "POST", "/api/printers", printer("Bar printer", { kind: "lan", host: "10.0.2.2", port: 9101 }, { kotStations: [barId] }, { primaryDeviceId: "p2a-bar-device" })),
      ];
      const [, second] = await twoProducts(db);
      const moved = await call(cookie, "PUT", `/api/categories/${String(second?.categoryId)}`, { stationId: barId });
      return out({ stationsRead: stations.status, defaultStation: kitchen?.name ?? null, barStatus: bar.status, printers: made.map((m) => [m.status, m.json.error ?? null]), categoryOnBar: moved.status });
    }
    if (mode === "api") {
      const printers = await call(cookie, "GET", "/api/printers", null);
      const stations = await call(cookie, "GET", "/api/stations", null);
      const badId = await call(cookie, "PUT", "/api/printers/not-an-id", {});
      const noPrimary = await call(cookie, "POST", "/api/printers", printer("No device", { kind: "lan", host: "10.0.2.2", port: 9102 }, { bill: true }));
      return out({
        printers: [printers.status, (printers.json.data as unknown[] | undefined)?.length ?? null, printers.cache],
        stations: [stations.status, (stations.json.data as unknown[] | undefined)?.length ?? null, stations.cache],
        badId: [badId.status, badId.cache],
        lanWithoutPrintingDevice: [noPrimary.status, noPrimary.json.error ?? null],
      });
    }
    if (mode === "kot") {
      const [first, second] = await twoProducts(db);
      const items = [first, second].map((p) => ({ productId: String(p?._id), name: p?.name, price: Number(p?.price), qty: 1, modifiers: [], instructions: "" }));
      const total = items.reduce((sum, item) => sum + item.price, 0);
      const body = { customerName: "Walk-in", items, subtotal: total, discount: 0, total, payment: "Unpaid", status: "Pending", receiver: "E2E script", idemKey: randomUUID() };
      const res = await call(cookie, "POST", "/api/orders", body, { "x-pos-print-agent": "1", "x-pos-device-id": DEVICE });
      const data = (res.json.data ?? {}) as { orderId?: string; printJobs?: Array<{ id: string; kind: string; status: string; targetDeviceId: string; printerId?: string }> };
      return out({ status: res.status, error: res.json.error ?? null, orderId: data.orderId ?? null, printJobs: (data.printJobs ?? []).map((j) => ({ id: j.id, kind: j.kind, status: j.status, printerId: j.printerId ?? null })) });
    }
    if (mode === "clear-host") {
      // A print host left from an earlier run (a reinstalled app has a new device id): each device prints its own.
      const res = await call(cookie, "DELETE", "/api/print-host", null);
      const waiting = await db.collection("printjobs").find({ status: { $in: ["queued", "needs-confirm", "failed"] } }).project({ _id: 1 }).toArray();
      const dismissed = [];
      for (const job of waiting) dismissed.push((await call(cookie, "POST", `/api/print-jobs/${String(job._id)}/dismiss`, { reason: "staff" })).status);
      return out({ hostCleared: res.status, dismissed });
    }
    if (mode === "teardown") {
      const printers = ((await call(cookie, "GET", "/api/printers", null)).json.data as Array<{ id: string }> | undefined) ?? [];
      const removed = [];
      for (const p of printers) removed.push((await call(cookie, "DELETE", `/api/printers/${p.id}`, null)).status);
      const stations = ((await call(cookie, "GET", "/api/stations", null)).json.data as Array<{ id: string; isDefault: boolean }> | undefined) ?? [];
      for (const s of stations.filter((x) => !x.isDefault)) removed.push((await call(cookie, "DELETE", `/api/stations/${s.id}`, null)).status);
      const leftOnCategories = await db.collection("categories").countDocuments({ stationId: { $exists: true } });
      return out({ removed, leftOnCategories });
    }
    throw new Error("unknown mode (see the header)");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exitCode = 1;
});
```

1. `kot`, then `jobs`: one KOT job (`printJobs` has one ref, no `printerId`); the fake printer logs one job of bytes > 0; the slip is today's (the decoded raster has no station line).
2. `setup`, then `api`: the stations read 200 with the default Kitchen; Bar 201; three printers 201; the category on the Bar 200. `api`: printers 200 with 3, stations 200 with 2, both `no-store`; a bad id 404; a LAN printer with no printing device 400.
3. `kot` again, then `jobs`: **still exactly one KOT job, printed once at the host, unchanged**; `withPrinterId: 0`, `withCopies: 0`. This is the dormant proof: printers saved through the API change nothing until Session 2C.
4. `teardown`: every printer and the Bar station removed (200s), `leftOnCategories: 0` (the deleted Bar was cleared from its category).
5. The app's own screens still load and print: Send to Kitchen and Pay Now from the emulator print the KOT, then the bill, once each.

Record every answer and the fake printer's counts in Results.

- [ ] **Step 5: The fresh review**

A fresh reviewer subagent (most capable model, read-only) reads `6ee2b1d..HEAD` against this plan and spec §6.1–6.3, §8 and §8.1, and reports Critical / Important / Minor findings. Fix Critical and Important ones by TDD on the branch (each RED seen before its GREEN) and re-run Step 1; list the rest in Results for the gate.

- [ ] **Step 6: Results, then push**

Fill in "Session 2A Results" below (every number from Steps 1–5, the APK hashes, the emulator answers, each changed pin, any deviation with its reason), commit it, and push the branch with the token: `GIT_TERMINAL_PROMPT=0 git push -u origin feat/printing-phase-2`.

---

## Sessions 2B–2G (task specifications; exact code is written at each gate)

Each session below lists what it delivers, its interfaces, its tests and its exit check. Its exact code is written at its gate, against the code that landed, and pre-validated like Session 2A.

### Session 2B: direct print on the asking device, and no realtime message to yourself (decisions 15, 16, 9)

The owner's ask of 2026-10-04: when the device that takes an order is the one that prints it, print there at once, with no realtime round trip and the fewest server requests. Simple mode first (every live cafe today); Session 2C extends the same path to printer lines.

**Written as exact code at the 2A review gate:** see "## Session 2B" at the end of this plan. Where it differs from the items below (G-1: no final state is published at all; G-2: "jobs for me" leaves out a running lease, and a change of the agent's own state is a nudge; `more` counts a job in backoff; the readback needs nothing new), "2A review gate: rulings" says why.

1. **The asking tab says it can print now.** The agent hook keeps a module seam `directPrintTab(): string | null` in `lib/print-agent.ts`: this tab's id while it drains this device's slips (it holds the drain lock), its printer can print now (`canPrintNow()`) and no refusal holds it; null otherwise. Every order request that opts in (Phase 1 ruling R1), the job-aware `/kot-claim` and the client-started enqueue add `x-pos-print-lease: <tabId>` (`PRINT_LEASE_HEADER` in the shared wire) while the seam is not null. A bad header never refuses an order write (as R1).
2. **The server makes the job leased at creation** (`lib/print-order-jobs.ts` `insertPrintJob`, used by the order routes, `/kot-claim` and the enqueue). When the request names a tab, the slip's printing device (simple mode: the host, or the asking device when there is no host) IS the asking device, it is the first slip of this request on that line, and the line holds no older `queued` or `leased` job (one read on the line index), the job is inserted `leased` to `{ deviceId, tabId }`: epoch 1, `attempts: 1`, `lease.expiresAt = now + 90 s`, log `created` then `leased` with `detail: "direct"`, in ONE write. A pure helper `directLeaseOf(...)` in `@pos/shared/print-lifecycle` builds those fields and is unit-tested against §7.2's lease row (the same fields `planLease` sets). Any other slip is made `queued` exactly as in Phase 1.
3. **The answer carries it.** `PrintJobRef` gains `leased?: LeasedPrintJob` (payload, labels, epoch, copies) for a job leased at creation. The call site hands it to the agent through a module seam beside `kickPrintAgent` (`deliverLeasedJob(job)`), never through a lease request.
4. **The agent takes it** (`lib/print-agent.ts`): `take(job)` prints it now when idle, or holds it (first in, first out) behind the job it is printing; it ignores a job whose `(id, epoch)` it already holds or has in its pending-ack store, so an answer delivered twice prints once. It acks like any leased job.
5. **A lost answer is delivered again.** A replayed order creates nothing (ruling R3) and the client re-sends every slip its answer did not name (Session 1C). The enqueue now answers a job still `leased` to the asking device AND tab with a live lease with that same leased job (`outcome: "queued"`, `duplicate: true`, `leased`), where Phase 1 answered `already-resolved`; any other tab or device gets Phase 1's answer. A tab reloaded in between has a new id: its lease expires in 90 s and the KOT prints REPRINT (the Phase 1 rule for a lost lease, like a refresh mid-print, M7).
6. **No realtime message to yourself:** a job leased at creation publishes no "queued" print-status and no print-job nudge, and its final state is not published when the ack comes from its creation lease (epoch 1, `direct`). A pure helper (`printStatusAudience`) decides and is pinned. The asking tab's readback (its "Sent ✓" chip) takes the final state from its own ack, so it stays instant without the message. Jobs made `queued` keep Phase 1's publishes (another tab of the same device may be the one that drains).
7. **The ack answers `more`** (decision 9): `PrintAckData.more` is true when the acked job's line has a job due now (one bounded read on the line index); the agent leases again only then, or on a nudge or its timer. Phase 1's trailing empty lease per burst (the 1C gate's count) goes.
8. **Budget pins** (`print-budget.test.ts`): a slip printed by the device that asked for it costs one request (its ack) and no realtime request; a Pay Now on one printer costs the order request plus ack, lease, ack; a slip another device prints keeps one lease, one ack and two realtime requests; the busy day of a one-device cafe is recounted.
9. **Live legs ak–am:** a job leased at creation (its fields and log; one write), the second slip of the same request on that line made `queued`; a line with an older job gives a `queued` job; a re-sent slip from the same tab gets the same lease back, from another tab or another device it does not; a creation lease that expires gives REPRINT (KOT) and the cashier's question (bill); `more` true and false.
- **Exit (2B):** on the harness, with the emulator app as host: Send to Kitchen and Pay Now print once each with no lease request before the KOT and no realtime publish (the counting proxy's log: the order, then the KOT's ack, the bill's lease and ack); a KOT from a second device still prints through realtime or the wake, as in Phase 1; the proxy drops one order answer: the client's re-send gets the lease back and the KOT prints once, unlabelled; the app killed right after its order answer: the KOT prints once, with REPRINT, after 90 s.

### Session 2C: printers mode goes live (the server, the KOT's station line, and each device's one printer)

**Written as exact code at the 2B review gate:** see "## Session 2C" at the end of this plan. Where it differs from the items below, "2B review gate: rulings" says why: the enqueue's answer for several jobs (R1); a retry on a gone printer is refused, never routed again (R2); `print-setup` is published by printer writes only (R6); M7 by a pre-check (R5); the dead wake hook stays pinned (R7); jobs-for-me counts every job aimed at the device and a stale printer list is read again (I-2, E-1), instead of the pulse and the wake naming printers; every device is an agent in printers mode (R13); the focus read is at most every 30 min, not 5 (the budget); a printer line's lease claims the job for its writer (I-3).

1. **Job creation routes through printers** (`lib/print-order-jobs.ts`). `createOrderPrintJobs` reads `readPrintRouting({ productIds, billPrinterId })` once per request (the order's lines, plus a void's line); null keeps simple mode exactly (with 2B's direct print). Otherwise every slip goes through `routePrintRequest`, and each routed job is inserted with `printerId`, `targetDeviceId` = the printer's writer (so the pulse's jobs-for-me, the attention rows and the aimed `print-status` keep working on device ids), `copies` (absent when 1), `jobKey = routedJobKey(printJobKeyOf(payload), job)` and `originDeviceId`. A routed job with no printer is inserted `failed` with its `error` as `lastError` and a `failed` log entry, so it shows under "Couldn't print" at once. Kind order is kept (KOT before bill, §7.6). **Direct print per printer line** (decision 15): a request from the writer of a slip's printer that lists that printer as ready (`x-pos-print-ready: <printerIds>` beside 2B's `x-pos-print-lease`) gets the first slip of that printer's line leased at creation; the publishing rules of 2B apply. `PrintJobRef` gains `printerId?`.
   - **The device's bill printer** rides the new header `x-pos-bill-printer` (an ObjectId; a bad one is ignored and never refuses the order write).
   - **Client-started slips** (`POST /api/print-jobs` with the agent header: reprints, End of day, a cancel notice) and the job-aware self-order `/kot-claim` lane route the same way; a reprint's keys are `reprint:<Idempotency-Key>:<printer>:<part>`. The enqueue answer for a slip that became several jobs: decided at the gate (recommended: `queued` with the first id plus `jobs: PrintJobRef[]`).
2. **A lease per printer line, only by its writer** (`lib/print-lease.ts`, `leaseBodySchema`). The lease body gains `printerIds?: string[]` (unique ObjectIds, at most `PRINTERS_MAX`). The server keeps the printers this device writes (one `Printer.find` by id: enabled, `printerWriterDeviceId(p) === deviceId`) and leases the head of each one's line (`{ printerId, status: queued | leased }`, not stale unless approved, on the partial index; the CAS fenced on `printerId` and `targetDeviceId`), at most one job per printer, plus the head of the device's simple line (`printerId: { $exists: false }`) as today. `LeasedPrintJob` gains `printerId?` and `copies`. `retryAt` is the soonest of the lines'. 2B's `more` answers for the acked job's own line.
3. **The sweep in printers mode** (`lib/print-sweep.ts`): a waiting job whose printer's writer changed (the printer was re-saved with another device or printing device) moves to the new writer (`retargeted`); a waiting job whose printer was deleted or disabled is failed with "This printer was removed or switched off." (never guessed onto another printer); `routeWaitingPrintJobs` (the host and origin retarget of simple mode) never touches a job with a `printerId`. A staff Retry or Print again on a job whose printer is gone routes it again with today's setup (decided at the gate).
4. **The repair in printers mode** (`lib/print-repair.ts`): a server-owned KOT round with no job at all (neither `kot:<order>:<round>` nor any key starting `kot:<order>:<round>:`; one read on the jobKey index with exact keys and anchored prefixes) is routed again with today's setup; a round that has some of its jobs is left alone (one request inserts them together).
5. **The writers' wake** (`POST /api/print-jobs/wake`): in printers mode `agentDailyCap = printWakeWriterCap(printerWriterDevices(printers).length)`, and the agent polls by `printAgentPollsWake({ hostConfigured, isHost, printersMode, isWriter })` (A5). **2A's Important 1 (confirmed at the 2A gate):** the agent's wake effect must also spend against `min(PRINT_WAKE_DAILY_CAP, the last answer's agentDailyCap)` and stop being `isHost`-gated, with a hook pin that the constant is no longer the only cap; the dead `hooks/use-print-host-wake.ts` (no call site) is deleted or pinned to stay unused. **M9:** count the writers of the printers devices chose as their bill printer, or refuse a non-routable choice.
   - **M7 (2A gate):** station and printer names unique case-insensitively (collation strength 2 on the unique indexes, before any production collection exists, or a pre-check in create and update).
6. **The agent prints the printers it writes, on its one local printer** (until Session 2E). It reads `GET /api/printers` on mount, on a new `print-setup` realtime kind (cafe + Worker parity, published by every stations and printers write; 2 Worker requests per admin save, never per slip) and on focus at most every 5 min; `myPrinters` = the enabled printers this device writes. It leases with their ids. A printer prints only when it is this device's own local printer: a device printer whose transport and address match the device's saved printer, or a LAN printer whose `host:port` is the app's selected `tcp:host:port`; any other is refused `sent:"no"` (never counted) with "This printer is not connected to this device." Copies: one render, written `copies` times inside one lease; a failure after the first byte is "maybe" (the REPRINT repeats every copy, labelled).
7. **The KOT's station line on paper:** `KOTReceipt` gains `stationLine?: string`, printed under the title (`printKotStationHeader`), fed by `hostPrintSlipOf` from `payload.station`. The payload-parity and print-host-slips pins follow. A station slip's item count and round total count its own lines (the gate checks the paper). A local print (a device with no identity) never carries a station.
8. **Attention rows carry `printerId?`**; the panel names the printer from the device's printer list.
9. **Live legs an–aq:** creation in printers mode (two station KOTs plus the full copy; failed-at-creation; replays collide; direct print on the writer's own line); a lease only by the writer (another device gets nothing), two printers of one device in one call, a stuck bar job never blocks the kitchen (head of line per printer); the sweep (a writer change, a removed printer); the repair (a round with no job is routed again, a round with some jobs is left).
- **Exit (2C):** on the harness, the emulator app (one printer: the fake printer on 9100) writes the counter printer (bills and the full copy), and two scripted agents (scratchpad) write a kitchen printer (fake printer on 9101) and a bar printer (9102): one round with kitchen and bar items, ordered on the emulator, prints the full copy there with no lease request (direct print), and the kitchen and bar slips once each through their writers, with their station lines; a bill prints at the counter; removing every printer returns the cafe to simple mode (the KOT prints once at the host). The counting proxy shows one ack per slip, one lease per slip another device asked for, and no empty lease.

### Session 2D: the setup screens (spec §11)

1. **The admin Printer setup page (`/printers`)** gets three sections (decision 11):
   - **Printers:** each printer with its dot (its writer's heartbeat, and the writer's own link state when this device is the writer), its slips, stations, paper and copies; add, edit, enable/disable, delete; **Test print** (a new keyless job kind `test` printed on that printer, with its name, connection, address, slips, stations, paper and the time; decided at the gate).
   - **Add printer** (spec §11): 1. the connection: LAN (address and port, with the static IP / DHCP reservation tip, and its printing device, chosen from the online Android app devices: only they print to LAN printers in Phase 2, the Windows app's raw TCP is Phase 3, §9.6); This device (today's Bluetooth / USB / Windows / browser pickers, then "Save as a printer"); 2. the slips: Bill, KOT stations, Full KOT copy, Notices, End of day; 3. paper width and copies.
   - **Stations:** add, rename, make default, delete (with the default's refusal shown in words); the category dialog gets "Kitchen station" (default: the default station); the item form gets "Kitchen station" with "Use the category's station" (sends `null`).
   - **Devices:** each `PrintDevice` (label, online, shell, the printers it writes).
2. **"Set up printers"** (spec §6.6), on the device that prints today (the host, or each no-host device): one tap makes "Printer 1" from this device's printer with Bill, Full KOT copy, Notices and End of day on, so nothing changes on paper (decision 5); then the owner adds stations and printers.
3. **This device's bill printer** in the printer panel ("Bill printer for this device: Default (‹name›) / ‹each printer›"), kept in this device's prefs and sent as `x-pos-bill-printer` on Pay Now, settle, End of day and a bill reprint.
4. **The top-bar dot** (spec §10): the worst state among the printers this device writes and the device's own simple-mode printer.
- Every new screen part gets its source pins; the Settings pins stay as they are.
- **2A gate minors for 2D:** M3 (a rename onto an existing name with "make default" must not leave no default: check the name first, or save the rename, then move the default); M4 (`deleteStation` clears the pointers first, then deletes; the printer form drops unknown station ids); M5 (deleting a station names any printer that would then take nothing); while Full KOT copy is on, the station boxes of that printer are disabled or cleared (a station on a full-copy printer is a no-op on paper since `b112538`); the bill-printer picker lists routable printers only (M9).
- **Exit (2D):** on the emulator and the harness, the owner's whole flow: Set up printers (one KOT prints exactly as before), add a Bar station, put Drinks on it, add a bar printer, a round with food and drinks prints by station; a test print; a station deleted while chosen; the item override.

### Session 2E: several printers per device, web and Windows

1. **The device-printer store per printer:** `pos.device-printer.v2` keeps one local printer record per printer id, plus the v1 record as this device's simple-mode printer until it is saved as a printer (migration; the v1 key stays readable for one release).
2. **`devicePrinter()` becomes a registry of runtimes**, one per printer (its own link, write queue and reconnect; the tab-ownership lock stays per device); a lane and `canPrintNow(printerId)` per printer; the agent leases for every ready printer at once and prints different printers in parallel, one job at a time per printer (§9.1); the refusal hold is per printer; direct print names every ready printer.
3. **A Chrome tab drives at most one Web Serial or Web Bluetooth printer** (§9.7), with "Keep this tab open, or use the POS app".
4. **The Windows app keeps a list of printers** (`printers: [{ printerId, deviceName, printMode }]`, migrated from `deviceName`), `printHtml(html, printerName?)` with one queue per printer; the desktop tests and the parity pins with `lib/desktop-shell.ts` follow. LAN printing from Windows stays Phase 3 (§9.6).
5. Android stays on bridge v1 in 2E: one printer per Android device.
- **Exit (2E):** a browser device and the emulator each write their printers; the Windows app's list is proven by its tests and, on the owner's PC, by TEST-CHECKLIST (two Windows printers, one KOT station each).

### Session 2F: Android bridge v2 and the Kotlin printer pool

1. **Protocol v2 beside v1** (decision 12): `PosNative.version` stays 1 for pages that know only v1, and the new APK adds `PosNative.versions = [1, 2]`. A v2 page sends `v: 2` envelopes whose `printer.*` methods take a `printerId` (`printer.select`, `printer.print`, `printer.reconnect`, `printer.forget`; `printer.status` answers every printer), and status events carry `printerId`. A v1 message acts on the default slot exactly as today. The web accepts v1 or v2; on v1 a device writes one printer.
2. **The Kotlin pool:** a `PrinterManager` per printer (its own transport, reconnect backoff, pause flags and publish) with its own io executor (a blocked Classic connect or a USB permission wait never stalls another printer); `BUSY` per printer instead of the device-wide `printing` flag; `Prefs` keeps a list (migrated from the one printer); USB attach and detach reach the matching printer; two identical USB models stay refused (ids are VID:PID).
3. **Pure-JVM unit tests** (spec §13): JUnit 4 as `testImplementation` (the Gradle cache on D:), for the state machine: backoff, pause flags, publish de-duplication, per-printer busy. The `mobile-paths.test.ts` pins that read exact Kotlin text (pins 0, 2, 11, 14 and 16) are rewritten deliberately and named in Results.
4. The print-host service's notification shows the worst state across printers.
- **Exit (2F):** one emulator drives two TCP printers (fake printers on 9100 and 9101) in parallel; an old page (v1) on the new APK prints exactly as today; the new page on the release APK (v1) prints with one printer.

### Session 2G: the Phase 2 exit

1. **Spec §14 on the harness and the emulator:** one round with kitchen and bar items prints two station KOTs plus the full copy; a bill goes to the device's bill printer; the release APK (bridge v1) still prints in simple mode; a slip the asking device prints itself goes out with no lease request and no realtime message.
2. **TEST-CHECKLIST:** "Stations and printers checks" for real printers (two Bluetooth printers on one phone, a LAN kitchen printer, a Windows counter, a station with no printer, copies, a deleted station, a printer switched off, an order lost in the network on the device that prints it).
3. **The free-tier measurement in both modes** (the counting proxy, process CPU and opcounters, as in Session 1E) against A5's and 2B's pins.
4. Results, the fresh review, and the final Phase 2 gate.

---

## Phase 2 exit criteria (spec §14)

| Criterion | Proven in |
|---|---|
| One round with kitchen and bar items prints two station KOTs plus the full copy | routing tests (A3), live leg (aj); end to end at 2C's exit and 2G |
| Bills go to the device's bill printer | routing tests (A3); 2D's bill printer picker; 2G |
| An old APK (bridge v1) still prints in simple mode | 2F (an old page on the new APK, the new page on the release APK); 2G |
| Existing outlets keep working with no new setup (G6) | A7's emulator check (dormant); every session's simple-mode legs and exit |
| A slip the asking device prints itself costs one request and no realtime message (the owner, 2026-10-04) | 2B's pins, legs and exit; 2G's measurement |
| The free-tier budget holds with stations (§17) | A5's and 2B's pins; 2G's measurement |

---

## Session 2A Results (filled in by the implementer)

Executed on 2026-10-04 with superpowers:executing-plans, task by task, A1 → A7.

### Commits (`e73dd59..HEAD`)

| Commit | Task |
|---|---|
| `51c2191` | A1: the shared contract (stations and printers, the simple-mode switch, writers, the default station and bill printer) |
| `aa3935c` | A2: the models: Station and Printer, a station on categories and items, a printer line on print jobs (dormant) |
| `376e25c` | A3: routing (spec §8), a pure function |
| `ee09b76` | A4: the setup API and the routing read (dormant) |
| `c990b55` | A5: the budget recount; in printers mode only writers poll |
| `1181442` | A6: live legs ah–aj |
| `b112538` | Final review Important 2 (beyond the plan): a full-copy printer that also takes a station prints the round once |
| (this commit) | Results |

### Start

- `git branch --show-current`: `feat/printing-phase-2`; HEAD `e73dd59` (pushed); working tree clean.
- `GIT_TERMINAL_PROMPT=0 git fetch origin` with the token credential: `origin/main` is still `6ee2b1d`, so there was nothing to note or merge.
- Before A1, every block of A1–A6 (54 blocks) was dry-run in document order against `e73dd59`, in memory: every find matched exactly once. No drift.

### How the code was applied

Every block was applied verbatim by a scratchpad script (the orchestrator's applier): find text is the fenced lines joined with `\n`; Create adds one final newline; every find must match exactly once; a step's blocks are staged in memory and written only if all of them apply. Each task ran Step 1 (tests), Step 2 (RED), Step 3 (code), Step 4 (GREEN), Step 5 (commit), with the plan's own commands. After A6, **all 35 files the six commits touch are blob-identical to the orchestrator's golden branch** (`v2` in its scratchpad `gold/`).

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED | GREEN |
|---|---|---|
| A1 | `print-printers.test.ts`: tests 1, pass 0, **fail 1** (module missing) | **9/9**; shared tsc 0 |
| A2 | cafe model tests: tests 27, pass 23, **fail 4**; shared schema tests: tests 37, pass 33, **fail 4** | shared schema tests **37/37**, tsc 0; cafe 5 files **79/79**, tsc 0 |
| A3 | `print-printer-routing.test.ts`: 1/0/**1**; shared `print-printers.test.ts`: 1/0/**1** | shared 2 files **40/40**, tsc 0; cafe 4 files **99/99**, tsc 0 |
| A4 | `print-setup-paths.test.ts`: 1/0/**1** | **10/10**; cafe tsc 0; eslint clean on the 9 files (`LINT_OK`) |
| A5 | `print-budget.test.ts`: 1/0/**1** | **23/23**; shared tsc 0; cafe tsc 0 |
| A6 | (legs: apply and run) | cafe tsc 0, eslint clean (`LINT_OK`); `verify:print:live` **`248 passed, 0 failed`** |
| Important 2 fix | `print-printer-routing.test.ts` "a full-copy printer that also takes a station prints the round once, as its full copy" **fails** (the counter got a `st-kitchen` slip beside its full copy) | routing + 4 related files **110/110**; cafe tsc 0; eslint clean |

New files stay small: `print-printer-routing.ts` 185 lines, `print-printers.ts` (shared) 162, `models/Printer.ts` 114, `print-stations.ts` 107, `print-printers.ts` (cafe) 105, `print-printer-schemas.ts` 99, `print-routing-context.ts` 54, `models/Station.ts` 33; the legs file 152. The six commits: 35 files, +2,097 / −12.

### Task A7 Step 1: every suite (at `1181442`)

| Suite | Result |
|---|---|
| shared `npm test`; `tsc` | **667/667**; 0 |
| cafe `npm test` | **4300 tests, 4299 pass, 0 fail, 1 skipped** (the skip is Phase 1's `go-live-dl` pin: the git-ignored planning file is not on this PC) |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings (`lib/masters-blob.test.ts:331`) |
| Hub `tsc` | 0 |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; **117/117**; Jest **3/3** (untouched) |
| desktop `npm test` | **191/191** (untouched) |
| `npm run test:print-tools` | **8/8** |
| live legs (local mongod, `pos_scratch_print_host`) | **`248 passed, 0 failed`** (220 + 28) |

Every row equals the plan's Expected.

**After the Important 2 fix (`b112538`), Step 1 again:** shared **667/667**; cafe **4301 tests, 4300 pass, 0 fail, 1 skipped** (+1: the new routing test); cafe tsc 0, lint 0 errors and the 2 old warnings; Hub 0; mobile **117/117** and Jest **3/3**; desktop **191/191**; print tools **8/8**; live legs **`248 passed, 0 failed`**.

### Changed existing pins (each follows a deliberate change in this plan)

- **A2, `apps/cafe/lib/print-job-model.test.ts`:** the Phase 1 final gate's pin "exactly three PrintJob indexes" now reads **four** (the feed/prune one, the job-key fence, the device line and the new printer line); its "no originDeviceId index" and prune/feed-index landmarks are unchanged. Two new tests pin the printer-line index (key order, partial on `printerId`, not unique) and `printerId`/`copies` (absent on a simple-mode row, copies 1–3).
- **`apps/cafe/package.json` `testChain`:** `lib/print-printers-model.test.ts` (A2), `lib/print-printer-routing.test.ts` (A3), `lib/print-setup-paths.test.ts` (A4) appended.
- **`packages/shared/package.json` `test`:** `src/print-printers.test.ts` (A1) appended.
- Only additions elsewhere: `category.schema.test.ts` (2 tests, the import widened), `product.schema.test.ts` (3 tests), `print-budget.test.ts` (5 tests, imports widened), `verify-print-host-live.ts` (Station, Printer, Category and Product indexes built before the legs; legs ah–aj after ag). No existing assertion there changed.

### Step 2: the Next production build

`npm run build` at `1181442`: success (compiled in 20.9 s), **127 routes** (`main`'s 123 plus `/api/printers`, `/api/printers/[id]`, `/api/stations`, `/api/stations/[id]`); only the 2 old lint warnings. Again at `b112538` after the fix: success, **127 routes**.

### Step 3: APKs (x86_64 first, then ARM; `GRADLE_USER_HOME='D:\gradle-home'`)

Both builds reported `BUILD SUCCESSFUL` (1 m 36 s, then 43 s). Each APK holds only its own ABI. **All three are byte-identical to the 2026-10-03 release** (`D:\kd\pos-apk-release\Sandbee-POS-final\`; 2A changes no app code).

| APK | Size | SHA-256 |
|---|---|---|
| Emulator only (x86_64) | 7,425,177 B | `29115bdfbee901dfd4e6b7905885e057ccf5aeb81ba2702409f9ec57ac51dcbd` |
| Client, arm64-v8a (`Sandbee POS.apk`) | 7,293,454 B | `0e0ec3148a89bad228b58d92f318da5ea2d6c9a515760eb10f25b619f69bd5e2` |
| Client, armeabi-v7a (`Sandbee POS (old 32-bit phones).apk`) | 6,701,288 B | `e618900ac1799fb9f8355dc058b04c6f6e59261aed88e82c8d0110e5ef049279` |

### Step 4: the emulator check (2A changes nothing for a cafe). Passed.

**Harness.** This session booted its own `Pixel_7_API_33` (WebView 109; `-memory 4096`, C: had 13 GB free; the crash buffer stayed empty). The installed app is the release x86_64 APK (`sha256sum` of its `base.apk` on the device: `29115bdf…`). The local POS (`next start` of the `1181442` build) was served on **3110** with `adb reverse tcp:3100 tcp:3110`, so the app's address stayed `http://localhost:3100`; the fake printer ran on **9101** (`--out <scratchpad>/fake-jobs-2a`), and the app's network printer was `10.0.2.2:9101`. Ports 3100 and 9100 were free this time, but the session prompt's ports were kept. Database: `pos_scratch_e2e_p1final` (the Phase 1 final gate's env file, copied into this session's scratchpad; e2eadmin, tables and menu already seeded; no print host at the start). `p2a-tool.ts` is the plan's tool, byte for byte, run with `P2A_BASE=http://localhost:3110`.

**The live demo first.** The app opened on the owner's live demo (`posdemo.sandbee.in`, "Olivea Pizza", signed in, "No printer set up", "Each device prints its own slips", "No printing device is set"). Nothing was tapped there except opening the printer panel and More options → **Change POS address** → `http://localhost:3100`. The local POS showed "POS Software" and the seeded menu before any write. The app was then made the print host (`35bd9663…`) with the network printer.

| Item | Result |
|---|---|
| 1. `kot`, then `jobs` | `201`, `printJobs`: one `kot` ref, `queued`, `printerId: null`; it printed at the host; the fake printer logged **one job of 44,454 B** (plus the 0-byte probe of "Use"); the decoded slip is today's KOT ("KITCHEN ORDER #1 Round 1", Margherita Pizza and White Sauce Pasta), **no station line** |
| 2. `setup`, then `api` | stations read **200**, default **Kitchen**; Bar **201**; three printers **201, 201, 201**; the category on the Bar **200**. `api`: printers **200, 3, `no-store`**; stations **200, 2, `no-store`**; a bad id **404, `no-store`**; a LAN printer with no printing device **400** ("Validation failed") |
| 3. `kot` again, then `jobs` | **still exactly one KOT job**, printed once at the host, **44,454 B**, the decoded slip unchanged (no station line); `withPrinterId: 0`, `withCopies: 0`. The dormant proof: printers saved through the API change nothing |
| 4. `teardown` | `removed: [200, 200, 200, 200]`, `leftOnCategories: 0`; `api` afterwards: printers 0, stations 1 (the default Kitchen stays) |
| 5. The app's own screens | Masala Chai → **Send to Kitchen**: one KOT (40,494 B, `ORD-20261004-003`). Cheesecake → **Pay Now** (Cash, Place Order): the **KOT (40,494 B), then the bill (36,966 B)**, once each (`ORD-20261004-004`; the decoded bill reads "Bill No. 1 … Cheesecake ₹220 … TOTAL ₹220"). Every job: `printerId`/`copies` absent |

The fake printer's log: 6 lines in all, the probe and the five slips above, each `bytes > 0` exactly once; nothing reached the saved "Bar printer" (`10.0.2.2:9101`, the same address, dormant).

**Put back as found.** On the local POS: "Stop printing here" (`hosts: []`) and the network printer removed ("No printer set up"). Then More options → Change POS address → `https://posdemo.sandbee.in`: "Olivea Pizza" loads, and its printer panel (opened read-only) shows "No printer set up" and "Each device prints its own slips". `adb reverse tcp:3100 tcp:3100` was restored. Screenshots and the decoded slips are in the session scratchpad only (`shots/`).

### Step 5: the fresh review

A fresh read-only reviewer (Claude Fable 5.1) read `e73dd59..1181442` against this plan and spec §6.1–6.3, §6.6, §7.11, §8, §8.1, §9.3 and §17. It also re-ran the three new cafe test files (35/35), the two shared ones (34/34) and the live legs (248/0), and recomputed the budget arithmetic by hand (4,800 / 5,790 / 17,628 / 3,635). Verdict: **0 Critical, 2 Important, 8 Minor**; "Yes" for the 2A gate. Every Review Focus item is proven by a test or a live leg (legs ah/ai assert on the raw collections, so a stored `null` or a leftover host could not hide behind the wire shapes).

- **Important 2: fixed (`b112538`).** A printer with "Full KOT copy" and a station both ticked got that station's slip AND the full copy, so the station's lines printed twice on it. Nothing forbids the combination, and 2D's form will be checkboxes. The fix is in routing: `stationTargets` leaves full-copy printers out, because the full copy already holds those lines (decision 4's reasoning). It holds however the data was saved, and a converted one-printer cafe that also ticks its station still gets today's KOT (the new test checks both).
- **Important 1: for the 2C gate, not a 2A change.** The client's wake poll (`hooks/use-print-agent.ts`, the "host" effect) starts only `if (… !isHost)` and spends against the constant `PRINT_WAKE_DAILY_CAP` (14,400). The wake answer's `agentDailyCap` has no client consumer, and no production code calls `printAgentPollsWake` or `printWakeWriterCap` yet (checked by grep). That is exact in Phase 1 and 2A, where one device polls. But if 2C only sets the server's `agentDailyCap`, each writer still spends 14,400 on a socket-down day: 3 writers make 43,200 + 3,630 = 46,830 a day, over the 18,000 that A5's pin describes. 2A makes no client change, so this goes to **Session 2C item 5**:
  - the agent spends against `min(PRINT_WAKE_DAILY_CAP, the last answer's agentDailyCap)`;
  - it polls by `printAgentPollsWake({ hostConfigured, isHost, printersMode, isWriter })`;
  - a hook pin proves the constant is no longer the only cap.
- **Minors, for the gate (not fixed):**
  - M3: `updateStation` clears the old default before `save()`. A rename onto an existing name (409) together with `isDefault: true` leaves no flagged default; routing then falls back to the first station by order.
  - M4: `deleteStation` deletes before it clears the pointers. A failure between the two leaves a dead id in a printer's `kotStations`, and `stationsExist` then refuses every re-save of that printer. Fix: clear first, then delete, or have 2D drop unknown ids.
  - M5: deleting a station can leave a printer that takes nothing, which can silently return the cafe to simple mode. 2D should warn.
  - M6: the plan's "printers mode adds at most three small reads" means three more than simple mode's one: four reads in all (printers, stations, products, categories).
  - M7: station and printer names are unique case-sensitively, so "Bar" and "bar" both print "BAR".
  - M8: two admins racing at the 20-station or 12-printer cap can land one over.
  - M9: a device's chosen bill printer need not be routable, so its writer is not in `printerWriterDevices`. The 2D picker should list routable printers only, or 2C should count chosen printers' writers.
  - M10: these Results (done here).
- **Set aside by the reviewer, each ruled "stands" in the ledger with its reason:**
  - the validation 400s not wrapped in `noStore` (Phase 1's house style, excluded by the pin);
  - device ids not checked against `PrintDevice` (decision 1, 2D's picker);
  - item and category station ids not checked for existence (spec §6.2 fallback);
  - `GET /api/printers` readable by any signed-in device;
  - a whole-tab reprint includes unfired lines (today's behaviour);
  - the seeding first read;
  - End of day at 1 copy, with no health and no backup printer (decisions 2, 10);
  - `VIRTUAL_DEFAULT` in a key;
  - the realtime pin as an upper bound (2B recounts);
  - the 120-character label.
- Checked and fine, per the reviewer:
  - no client parses payloads strictly, and a stored payload that fails the strict parse is dismissed as `invalid-payload` (`print-lease.ts`);
  - `kotStations: []` passes `required`;
  - string ids and ObjectIds compare correctly everywhere;
  - Mongoose `set()` replaces the connection sub-document (no merge);
  - `routedJobKey` is unique per slip.

### Deviations and rulings

- **No code deviation.** Every block went in verbatim; no plan text was wrong.
- The skill's `task-start`/`task-brief` helpers match numeric task headings only, so the briefs (A1–A7) were read straight from the plan; the ledger lives in the git-ignored `.superpowers/sdd/2026-10-03-phase-2-routing/`.
- Ruling: the fresh reviewer ran on **Claude Fable 5.1** (`fable`), Anthropic's most capable widely released model, as the prompt asks for the most capable model (the Phase 1 gates' reviewers were Opus).
- The emulator check used port 3110 and fake printer 9101 as the session prompt says (3100 and 9100 were in fact free).
- Ruling (Important 2): fixed in routing rather than by refusing the combination in `printerBodySchema`. Routing decides the paper, so the fix holds whatever is stored. Cost if wrong: an owner who wanted a separate station slip on a full-copy printer gets only the full copy (a one-line revert).
- Ruling (Important 1): not fixed in 2A, because 2A makes no client change and nothing passes `printersMode` until 2C. It is carried to the 2C gate as above. Cost if wrong: if 2C misses it, N writers on a socket-down day spend N × 14,400 wake hits.

### Pushed

The branch was pushed with the token credential only (`GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-2`): `e73dd59..` this commit. `main` is untouched and nothing is deployed. The E2E database `pos_scratch_e2e_p1final` ends with no print host, no printers and one station (the default Kitchen), plus 4 test orders `ORD-20261004-001…004`). The session's emulator, POS server and fake printer were stopped.

---

## Session 2A review (gate, 2026-10-04)

**Verdict: PASS.** Session 2A (`e73dd59..4271848`: A1–A6 applied verbatim as `51c2191..1181442`, the final-review fix `b112538`, and the Results commit `4271848`) is complete and correct for its scope, and it changes nothing for a cafe today. A fresh reviewer at the gate found no Critical and no new Important defect. 2A's Important 1 is confirmed and stays with Session 2C; the minors are ruled below.

**How this gate stayed independent.** Nothing below was taken from the Results section. Every suite and build was re-run on the repo at `4271848`; every one of the 35 files A1–A6 touched was compared with the 2A gate's golden branch (`v2`): **35 of 35 blob-identical**, so the only code the gate had not already validated was `b112538`. A fresh reviewer subagent (Claude Fable 5.1, read-only, which had not written any of it) re-read `e73dd59..b112538` against the spec and re-checked the Results' review findings in the code.

| Check | Re-run at the gate (`4271848`) | Session 2A Results |
|---|---|---|
| shared `npm test`; `tsc` | 667/667; 0 | same |
| cafe `npm test` | 4301 tests, 4300 pass, 0 fail, 1 skipped (the `go-live-dl` pin) | same |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings | same |
| Hub `tsc` | 0 | same |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; 117/117; Jest 3/3 | same |
| desktop `npm test` | 191/191 | same |
| `npm run test:print-tools` | 8/8 | same |
| live legs (local mongod) | `248 passed, 0 failed` | same |
| Next build | success, 127 routes | same |
| APKs (rebuilt, `GRADLE_USER_HOME='D:\gradle-home'`) | x86_64 `29115bdf…`, arm64-v8a `0e0ec314…`, armeabi-v7a `e618900a…`: byte-identical to the release | same |
| Secrets in `e73dd59..4271848` | none (no token, key or connection string in the diff) | — |

**`origin/main`** was fetched at the gate (token credential): still `6ee2b1d`, so nothing to merge.

**Code read (the fresh reviewer, Fable 5.1).**
- **`b112538` (2A's Important 2 fix) is sound** for every combination: a full-copy printer that is a station's only taker prints the round once, as its full copy; two full-copy printers each print one full copy; notices still reach each full-copy printer once (`noticeTargets` seeds them and dedupes with a Set); with no full-copy printer the fallback is unchanged ("BAR (NO PRINTER SET)", else failed); a converted one-printer cafe still gets today's KOT, the very same request object. `print-printer-routing.test.ts`: 17/17.
- **2A's Important 1 is exact.** `hooks/use-print-agent.ts`'s wake effect is `isHost`-gated and spends against the constant `PRINT_WAKE_DAILY_CAP`; the wake answer's `agentDailyCap` has no reader; `printAgentPollsWake` and `printWakeWriterCap` have no production caller. Also found: `hooks/use-print-host-wake.ts` (`usePrintHostWake`) spends the same cap but has no call site (Phase 1 left it one release for its own tests), so 2C's fix must cover only the agent's effect, and should delete the dead hook or keep it out of any count.
- **Dormancy holds.** `stationId` on Category and Product is optional with no default, the create schemas are not strict, a PUT touches it only when the key is present, and staff cannot set it; `printerId` and `copies` on PrintJob have no default and the new index is partial on `printerId`, so it holds no existing row; the KOT payload's `station` is optional, so no stored payload can newly fail its parse; `readPrintRouting` and `routePrintRequest` have no production caller.
- **M3–M9 are all real**; none affects a cafe before 2C or 2D. **Two new minors:** `printSlipRequestsPerDay(day)` forwarded only `day.slips`, ignoring the day's `retryShare` (no number changed); and since `b112538`, ticking a station on a full-copy printer is a no-op on paper, so 2D's form should say so.

**Pre-validating 2B on the emulator.** The gate wrote 2B on a golden copy and ran it end to end on the emulator (`Pixel_7_API_33`, WebView 109, the release APK `29115bdf…`, which 2B does not change) against the golden build of the POS on 3110, a counting proxy on 3200 (`adb reverse tcp:3100 tcp:3200`) and the fake printer on 9101. The app opened on the owner's live demo ("Olivea Pizza"); nothing was tapped there except the printer panel's More options → Change POS address → `http://localhost:3100`. Two defects of the first golden build were found there and fixed in Tasks B3 and B4 before this section was generated (G-2 below): a lease followed every direct KOT's ack. With the final build (screenshots `b-01…b-04` and the proxy log in the gate's scratchpad):
1. **Send to Kitchen (the host's own KOT):** the proxy saw `POST /api/orders` (with the lease header), then `POST /api/print-jobs/:id/ack` 0.87 s later, and nothing else: no lease, no realtime. One slip of 40,494 B. The job's log: `created`, `leased(direct)`, `printed`; epoch 1, one attempt.
2. **Pay Now:** `POST /api/orders`, the KOT's ack, `POST /api/print-jobs/lease` (the bill), the bill's ack, and nothing after: KOT (40,494 B) then bill (36,966 B).
3. **A KOT from a second device** (a script as `e2e-script-device`, no lease header): made `queued` for the host, leased 8 s later through the host's wake (no realtime Worker runs locally) and printed once: Phase 1's path, unchanged.
4. **A lost answer:** the proxy forwarded the order and cut the answer; the POS re-sent it at once (the same idempotent create: the replay answered 200 and named no job), then re-sent the KOT through `POST /api/print-jobs` with the lease header, which answered the same lease. It printed once, unlabelled, at epoch 1.
5. **A tab that dies before printing** (a script made a KOT as the host device with a lease header naming a tab that never prints): no request at all for it for 90 s (the wake no longer counts a running lease); then the host expired it (`expired(lease expired: may have printed)`), leased it at epoch 2 and printed it once as **REPRINT** (46,110 B).
6. **No host** ("Stop printing here"): Send to Kitchen made the device's own KOT leased to its tab: `POST /api/orders`, then its ack, nothing else.
7. **The final build** (after the fresh review's I-1 and M-1 fixes, below) was run again: no host, Send to Kitchen (order, ack) and Pay Now (order, ack, lease, ack; 40,494 B then 36,966 B); the host again, a lost answer for which the POS this time showed "Couldn't confirm" with Send again: tapped 31 s later, the replay (200), `POST /api/print-jobs` with the lease header and the ack followed, and the KOT printed once, unlabelled, at epoch 1.
8. `adb logcat -b crash` stayed empty. Put back as found: on the local POS "Stop printing here" ("0 waiting slips cancelled") and the network printer removed; the address back to `https://posdemo.sandbee.in` ("Olivea Pizza"; its printer panel, opened read-only: "No printer set up", "Each device prints its own slips"); `adb reverse tcp:3100 tcp:3100`; the gate's POS, proxy and fake printer stopped by PID; the emulator stopped.

## 2A review gate: rulings (2026-10-04)

Every ruling that changes the spec is written into spec §7.11 ("As built at the 2A review gate") and §17.2.

| # | Finding | Ruling |
|---|---|---|
| I2 | A full-copy printer that also takes a station printed it twice; fixed in `b112538` | Re-read at the gate: **sound.** |
| I1 | The client's wake poll is host-gated and spends the constant 14,400; the server's split has no consumer | **2C item 5** (unchanged): the agent spends against `min(PRINT_WAKE_DAILY_CAP, the last answer's agentDailyCap)` and polls by `printAgentPollsWake(...)`; a hook pin proves the constant is no longer the only cap. 2C also deletes the dead `usePrintHostWake` hook (or pins that it has no call site). |
| M3 | `updateStation` clears the old default before a save that can fail (409), leaving no default | **2D:** check the name first (or save the rename, then move the default). Routing still falls back to the first station. |
| M4 | `deleteStation` deletes before it clears the pointers | **2D:** clear first, then delete; 2D's printer form drops unknown station ids. |
| M5 | Deleting a station can leave a printer that takes nothing (the cafe may silently fall back to simple mode) | **2D:** the delete confirmation names such printers. |
| M6 | "Printers mode adds at most three small reads" means three over simple mode's one (four in all) | **Wording; no change.** |
| M7 | Station and printer names are unique only case-sensitively ("Bar" and "bar" both print "BAR") | **2C:** a case-insensitive check (collation strength 2 on the unique index, before any production collection exists, or a pre-check). |
| M8 | Two admins racing at the 20-station or 12-printer cap can land one over | **Accepted:** a soft cap; no effect on routing. |
| M9 | A device's chosen bill printer need not be routable, so its writer may not poll | **2C** (count chosen printers' writers, or require a routable choice) and **2D** (the picker lists routable printers only). |
| New minor | `printSlipRequestsPerDay(day)` ignored the day's `retryShare` | **Fixed in Task B5** (passed through; no number changes). |
| New minor | A station ticked on a full-copy printer is a no-op on paper since `b112538` | **2D:** the form disables or clears the station boxes while Full KOT copy is on. |
| **G-1** (gate) | Phase 1 publishes every job's final state (`printed`, `needs-confirm`, `failed`, `dismissed`) as a `print-status` frame, but no device listens for it: the readback chip and the waiting-slips panel read the pulse's feeds, and the agent leases only on a `queued` frame aimed at its own device (the only `print-status` reader in the app; the Worker only relays) | **Dropped in Task B3.** One Cloudflare Worker request fewer per slip for every cafe: a slip another device prints costs 2 Worker requests (was 3), a printers-mode slip 1 (was 2). Plan decision 16's "its final state is not published when its creation lease acks it" becomes "no final state is published". |
| **G-2** (gate, emulator) | The pulse's and the wake's "jobs for me" counted this device's own running lease, and the bridge freeing up from the agent's own slip and its printer's status change were kicks: each queued a lease behind the direct KOT's print, after its `more: false` ack | **Fixed in Tasks B3 and B4:** "jobs for me" counts only what a lease call can act on (a lease that ran out still counts); a change of the agent's own state is a `nudge()`, which never queues a lease behind a running cycle. Proven on the emulator (items 1 and 5 above). |
| 2B spec item 6, the readback | "The asking tab's readback takes the final state from its own ack" | **No change needed:** the readback has always read the pulse's feeds, never `print-status`, so dropping the frame changes nothing for the "Sent ✓" chip. |
| 2B spec item 7, `more` | "true when the acked job's line has a job due now" | **As built:** true when the ACKING device's line holds a queued job (due now or in backoff). A job in backoff is then leased once, and the lease's `retryAt` sets the agent's timer; with "due now only", a job in backoff would wait for a nudge. |

**The fresh review of 2B's golden code** (Claude Fable 5.1, read-only, `4271848..g2b` against the spec and this plan; it re-ran the six cafe and two shared test files: all pass). Verdict "ship with fixes": no Critical; the server side sound; G-1 and G-2 verified in the code (the only `subscribeRealtime` readers; an expired lease still counted; a job's kick never lost to a nudge). Its findings, each fixed or ruled before this section was generated:

| # | Finding | Ruling |
|---|---|---|
| I-1 | A job held while its tab could not print (the printer went off, the drain lock moved on) printed whenever the gate reopened, even after its lease had run out and another writer had printed it as REPRINT: two KOTs | **Fixed in Task B4**, by a time bound rather than a drop when the gate closes (the reviewer's first suggestion): a held job prints only within `PRINT_DIRECT_HOLD_MS` (60 s: the 90 s lease less 30 s; its lease began at most one request timeout, 15 s, before it arrived), so its print always starts inside its lease and no other writer can have leased it; older ones are dropped unprinted. A short printer flap still prints the held KOT unlabelled, which a drop would have turned into a REPRINT. With no held job left, the cycle checks the lease gate before it leases. A new agent test proves both sides. **The reviewer re-checked the fix: sound, "ship as written"**; the time bound is strictly better than a drop for a flap. Residuals it accepted: a backward wall-clock step of over 30 s inside the window, or a suspended WebView that delivers its answer minutes late, can print a held job after its lease ran out, but in simple mode that device is still its line's only writer, so the outcome is one print (a late ack), never two. |
| M-1 | Every slip of a request got the asking tab, so a collision on the bill read its payload for a re-delivery that cannot apply there | **Fixed in Task B2:** only the request's first slip on the line gets the tab. |
| M-2 | `more` reads the ACKING device's line, not the job's target | **No change:** that is the agent's question ("does my line hold more?"); a wrong device id in the body only yields a wrong hint. Commented in `ackPrintJob`. |
| M-3 | `more` counts a queued job in backoff, so one lease answers "not due" and sets the timer | **Accepted** (the gate's own ruling above): it is how the agent learns that job's time; never a loop. |
| M-4 | An enqueue from a non-host device with the header reads the host twice | **Accepted:** rare (the header is sent only by a draining tab), and a small read. |
| M-5 | No test for I-1 | **Added with the fix.** |

**Gate decisions that shape 2B** (each in spec §7.11):
- **One header, one meaning.** `x-pos-print-lease: <tabId>` is sent only while the tab drains this device's slips, its printer can print now and no refusal holds it; it both asks for direct print and lets the enqueue hand a lost lease back. A tab that is not ready gets Phase 1 throughout (a lost answer then expires into REPRINT, as for a refresh mid-print).
- **The enqueue reads the host once.** `enqueueDirectPrintJob` makes the slip the asking device's own when there is no host or the asking device is the host; for any other host it answers null and Phase 1's `enqueuePrintJob` runs unchanged (`print-queue.ts` is not touched).
- **No new field on PrintJob.** A job made leased is an ordinary leased job (`directLeaseOf` = `planLease`'s fields); its log says `leased(direct)`.
- **A held job prints past the printer gate, but only well inside its lease.** Its attempt was made while the printer was ready; if the printer went off since, the bridge refuses it (`sent:"no"`, never counted) and it goes back in line, rather than expiring into a REPRINT. A job held longer than 60 s is dropped unprinted (I-1).

---

## Session 2B (exact code, written and pre-validated at the 2A review gate)

**Pre-validated** by the 2A review gate on 2026-10-04, on scratchpad clones only (never in the repo):
- The code was developed on a golden copy of `4271848` (this branch's head at the gate; `origin/main` still `6ee2b1d`, nothing to merge), one commit per task, and this section was generated from those commits: every Create block is the golden file byte for byte, and every find is unique in its file at the moment it is applied.
- A fresh clone of `feat/printing-phase-2` at `4271848` then got every block of this section applied verbatim, task by task, with each task's own Run lines; each RED and GREEN below is the output seen there. Its tree came out **identical** to the golden copy's (`c22b72a…`). Every suite below was run on that tree.
- Totals on that code: shared `npm test` **672/672** (+5), tsc 0; cafe `npm test` **4320 tests, 4319 pass, 0 fail, 1 skipped** (+19 over `4271848`'s 4301; the skip is Phase 1's `go-live-dl` pin), tsc 0, lint 0 errors and the 2 old warnings; Hub tsc 0; mobile 117/117 and Jest 3/3, desktop 191/191 (untouched); print tools 8/8; live legs **`272 passed, 0 failed`** (248 + 24); the Next build lists **127 routes** (2B adds none).
- **Run on the emulator** (`Pixel_7_API_33`, WebView 109, the release APK) against the golden build of the POS through a counting proxy, exactly as Task B7 Step 4: see "Session 2A review (gate)" → "Pre-validating 2B on the emulator". It found two defects of the first golden build (G-2), both fixed in Tasks B3 and B4 before this section was generated, then passed every item.

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 2B delivers** (the owner's ask of 2026-10-04: "when the device that takes the order prints it, print there directly, no realtime round trip, the least server use"). When the tab that drains a device's slips asks for slips that print on that same device (the host's own order; with no host, any device's own slip), the first slip is made already leased to that tab in the one write that creates it, and the answer carries the lease: the tab prints at once and acks. No lease request, no realtime message, no poll: **one request per slip** (its ack) instead of two, and one database write fewer. A Pay Now's bill follows its KOT through the ack's `more` (KOT before bill holds by construction). An answer that is lost is handed back to the same tab when the client re-sends the slip. Every ack that takes a job off the line answers `more`, so no burst ends with an empty lease, on any device. No final `print-status` frame is published any more (G-1). **Slips another device prints keep Phase 1's path exactly.** Nothing changes on paper.

**Gate rulings this section implements:** G-1 (B3, B5), G-2 (B3, B4), the 2A gate's `retryShare` minor (B5), the readback and `more` rulings above (B3, B4).

**Not in 2B:** printers mode (2C: routing goes live, a lease per printer line, the writers' wake allowance, I1, M7, M9), the setup screens (2D: M3, M4, M5, the full-copy station boxes), several printers per device (2E), Android bridge v2 (2F). No Kotlin, Windows or mobile change: **the APKs stay byte-identical to the release.** Old tabs (from before 2B) send no lease header and get Phase 1 exactly; a new tab facing an older server gets no `leased` and no `more`, and falls back to Phase 1 too.

### Review Focus (Session 2B)

The five inputs most likely to bite a cafe that the unit tests alone would not exercise; each has a live leg, a test or an emulator item.
1. **The order's answer is lost on the device that prints it:** the slip prints once, unlabelled (the replay names no job; the re-send gets the same lease back). → leg (al); emulator item 4.
2. **The tab dies between its order and its print** (the app killed, a reload): the slip prints once, as REPRINT (a bill: the cashier's question), within about 90 s, and nothing polls meanwhile. → legs (am); emulator item 5.
3. **Pay Now on the host:** the KOT before the bill, each once, three print requests in all. → leg (ak) (the line waits for the KOT's lease), leg (am) (`more`); agent test "Pay Now"; emulator item 2.
4. **The printer goes off between the order and the print:** the job made leased is refused (`sent:"no"`, never counted) and waits in line, unlabelled, for the printer. → agent test "a taken job prints even if the printer went off since"; leg (am) "a creation lease its printer refused".
5. **A slip another device prints, or the same device's other tab:** Phase 1 exactly (`queued`, its `print-status`, the host's lease). → leg (ak) ("never for a slip another device prints", "a line with an older job", "no lease header"); emulator item 3.

### File map (Session 2B)

| File | Change | Task |
|---|---|---|
| `packages/shared/src/print-agent-wire.ts`, `print-lifecycle.ts`, `print-job.ts` (+ `print-lifecycle.test.ts`) | the lease header; `PrintJobRef.leased`; `PrintAckData.more`; `directLeaseOf` | B1 |
| `apps/cafe/lib/print-direct.ts` (create, + test), `lib/print-order-jobs.ts`, `lib/print-lease.ts` (`leasedJobOf`), the six order routes, `lib/print-agent-server.ts`, `app/api/print-jobs/route.ts` (+ `print-order-jobs.test.ts`, `package.json`) | direct creation, re-delivery, no announcement to yourself | B2 |
| `apps/cafe/lib/print-lease.ts`, `lib/print-queue.ts` (+ `print-lifecycle-paths.test.ts`, `print-lease.test.ts`) | the ack's `more`; G-1; G-2's jobs-for-me | B3 |
| `apps/cafe/lib/print-agent.ts`, `lib/print-agent-seams.ts` (create), `lib/print-agent-slip.ts` (create), `lib/print-agent-calls.ts`, `hooks/use-print-agent.ts`, `hooks/use-host-routing.ts` (+ `print-agent.test.ts`, `print-agent-paths.test.ts`) | the agent takes leased jobs, nudges, `more`; the header | B4 |
| `packages/shared/src/print-budget.ts` (+ test) | the recount | B5 |
| `apps/cafe/scripts/print-host-live/direct.ts` (create), `scripts/verify-print-host-live.ts` | live legs ak–am | B6 |
| this plan | Session 2B Results | B7 |

The tasks run in this order: B1 → B6 (each one commit), then B7 (verification, the emulator exit check, the fresh review, Results).

---

### Task B1: the shared contract: the lease header, a ref that carries its lease, the ack's `more`, and a job made leased at creation

**Files:**
- Modify: `packages/shared/src/print-agent-wire.ts` (`PRINT_LEASE_HEADER`; `PrintJobRef.leased?`; `PrintAckData.more?`)
- Modify: `packages/shared/src/print-lifecycle.ts` (`PRINT_DIRECT_LEASE_DETAIL`, `PrintJobDirectLease`, `directLeaseOf`)
- Modify: `packages/shared/src/print-job.ts` (`PrintJobEnqueueResult`'s queued answer may carry `leased`)
- Test: `packages/shared/src/print-lifecycle.test.ts` (two new tests)

**Interfaces produced:** `PRINT_LEASE_HEADER = "x-pos-print-lease"`; `PrintJobRef.leased?: LeasedPrintJob`; `PrintAckData.more?: boolean`; `PRINT_DIRECT_LEASE_DETAIL = "direct"`; `directLeaseOf({ labels, who: { deviceId, tabId }, originDeviceId?, nowMs }): PrintJobDirectLease` (`status: "leased"`, `epoch`, `attempts`, `uncertainAttempts`, `nextAttemptAt`, `labels`, `lease`, `log`); `PrintJobEnqueueResult` `{ outcome: "queued"; id; duplicate; leased?: LeasedPrintJob }`.

**A job made leased is a leased job.** `directLeaseOf` builds exactly the fields `planLease` would set on a job created at the same moment (spec §7.2's lease row: epoch 1, one attempt, a 90 s lease for the asking device and tab), plus the create row's own fields and two log entries (`created`, then `leased` with the detail `direct`). The test proves it field by field against `planLease`, and runs the job through the ack, an expiry (KOT: REPRINT; bill: needs-confirm) and a late ack, so nothing downstream needs to know how a job was leased.

**Everything new is optional on the wire.** An older client never sends the header and never reads `leased` or `more`; an older server never answers them. Each side falls back to Phase 1.

- [ ] **Step 1: The failing tests first**

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
import { PRINT_HOST_MAX_AGE_MS, PRINT_JOB_KINDS } from "./print-job";
import {
  PRINT_BACKOFF_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_PAPER_ATTEMPTS,
  addPrintLabel,
  lifecycleOf,
  planAck,
  planConfirm,
```

Replace it with:

```ts
import { PRINT_HOST_MAX_AGE_MS, PRINT_JOB_KINDS } from "./print-job";
import {
  PRINT_BACKOFF_MS,
  PRINT_DIRECT_LEASE_DETAIL,
  PRINT_LEASE_MS,
  PRINT_MAX_PAPER_ATTEMPTS,
  addPrintLabel,
  directLeaseOf,
  lifecycleOf,
  planAck,
  planConfirm,
```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  assert.ok(planLease(legacy, WHO, T0).ok);
});

```

Replace it with:

```ts
  assert.ok(planLease(legacy, WHO, T0).ok);
});

// Phase 2 Session 2B (spec §7.11, plan decision 15): a slip the asking tab prints itself is made already
// leased to it, in the one write that creates it.
function directRow(kind: PrintJobLifecycle["kind"], labels: PrintJobLifecycle["labels"] = []): PrintJobLifecycle {
  const direct = directLeaseOf({ labels, who: WHO, originDeviceId: "dev-a", nowMs: T0 });
  return lifecycleOf({
    kind,
    status: direct.status,
    createdAt: new Date(T0),
    epoch: direct.epoch,
    attempts: direct.attempts,
    uncertainAttempts: direct.uncertainAttempts,
    nextAttemptAt: direct.nextAttemptAt,
    labels: direct.labels,
    lease: direct.lease,
  });
}

test("direct lease: a job made leased to the asking tab is exactly what a lease request would make of it", () => {
  const direct = directLeaseOf({ labels: ["DUPLICATE"], who: WHO, originDeviceId: "dev-a", nowMs: T0 });
  const viaLease = patchOf(planLease(job({ labels: ["DUPLICATE"] }), WHO, T0));
  assert.equal(direct.status, viaLease.status, "leased");
  assert.equal(direct.epoch, viaLease.set.epoch, "epoch 1");
  assert.equal(direct.attempts, viaLease.set.attempts, "one attempt");
  assert.deepEqual(direct.lease, viaLease.set.lease, "the same 90 s lease, for the same tab");
  assert.deepEqual(
    { uncertainAttempts: direct.uncertainAttempts, nextAttemptAt: direct.nextAttemptAt, labels: direct.labels },
    { uncertainAttempts: 0, nextAttemptAt: new Date(T0), labels: ["DUPLICATE"] },
    "the create row's own fields, and its first label",
  );
  assert.deepEqual(
    direct.log.map((entry) => [entry.event, entry.deviceId, entry.detail]),
    [["created", "dev-a", undefined], ["leased", "dev-a", PRINT_DIRECT_LEASE_DETAIL]],
    "its history says it was leased when it was made",
  );
  assert.deepEqual(directLeaseOf({ labels: [], who: WHO, nowMs: T0 }).log[0], { at: new Date(T0), event: "created" }, "no asking device: the created entry names none");
});

test("direct lease: its tab's ack prints it; a tab that dies lets it expire into REPRINT, or the cashier's question for a bill", () => {
  assert.equal(patchOf(planAck(directRow("kot"), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0 + 5_000)).status, "printed");
  assert.equal(refusalOf(planExpiry(directRow("kot"), T0 + PRINT_LEASE_MS)).reason, "lease-held", "a live lease is never expired");
  const kot = patchOf(planExpiry(directRow("kot"), T0 + PRINT_LEASE_MS + 1));
  assert.deepEqual([kot.status, kot.set.labels, kot.set.uncertainAttempts], ["queued", ["REPRINT"], 1], "the KOT prints again, labelled");
  assert.equal(patchOf(planExpiry(directRow("bill"), T0 + PRINT_LEASE_MS + 1)).status, "needs-confirm", "a bill that may have printed asks the cashier");
  const late = patchOf(planAck({ ...directRow("kot"), status: "queued" }, { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0 + PRINT_LEASE_MS + 5_000));
  assert.equal(late.log.event, "late-ack", "a late ack from its tab still resolves it (spec §7.9)");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-lifecycle.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
export const PRINT_BILL_HEADER = "x-pos-print-bill";
/** The one value that switches either header on. */
export const PRINT_HEADER_ON = "1";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
```

Replace it with:

```ts
export const PRINT_BILL_HEADER = "x-pos-print-bill";
/** The one value that switches either header on. */
export const PRINT_HEADER_ON = "1";
/** Phase 2 Session 2B (spec §7.11, plan decision 15): the tab that drains this device's slips and can print
 *  right now names itself (its tab id) on every request that makes slips. When a slip prints on the asking
 *  device, the server may then make it already leased to that tab, and the answer carries the lease
 *  (PrintJobRef.leased): the tab prints at once, with no lease request and no realtime message. Optional like
 *  every print header: an absent or unusable one only means the slip is made queued, as in Phase 1. */
export const PRINT_LEASE_HEADER = "x-pos-print-lease";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  /** The job's state when the answer was built (1B final review M-d): a deduped ref to a job that
   *  already printed (or was dismissed) is followed, never leased or re-sent as if it were fresh. */
  status: PrintJobStatus;
}

/** Session 1D (spec §10): one row of the one waiting-slips panel. Every device reads the same feed on the
```

Replace it with:

```ts
  /** The job's state when the answer was built (1B final review M-d): a deduped ref to a job that
   *  already printed (or was dismissed) is followed, never leased or re-sent as if it were fresh. */
  status: PrintJobStatus;
  /** Session 2B (spec §7.11): the job is leased to the asking tab (made so now, or still so from a request
   *  whose answer was lost). The tab prints it at once and acks it; no lease request. */
  leased?: LeasedPrintJob;
}

/** Session 1D (spec §10): one row of the one waiting-slips panel. Every device reads the same feed on the
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  /** Set when the job went back to the queue: the agent's local retry timer. */
  nextAttemptAt: string | null;
  reason?: PrintJobActionRefusal;
}

export interface PrintActionData {
```

Replace it with:

```ts
  /** Set when the job went back to the queue: the agent's local retry timer. */
  nextAttemptAt: string | null;
  reason?: PrintJobActionRefusal;
  /** Session 2B (plan decision 9): set when the acked job left the line. true: the acking device's line still
   *  holds a queued job, so the agent leases again; false: it waits for a nudge, its timer or a new slip, so a
   *  burst no longer ends with an empty lease. Absent (an older server, an ack that changed nothing, a job
   *  back in the queue): the agent leases again, as in Phase 1. */
  more?: boolean;
}

export interface PrintActionData {
```

In `packages/shared/src/print-job.ts`, find:

```ts
import type { printOrderSnapshotSchema } from "./schemas/print-job.schema";
import type { Order } from "./types";
import type { PrintHostPrinterState } from "./print-host-printer";

/** The five thermal documents + reprint/notice paths a `PrintJob` can carry.
 *  `"cancel-notice"` is the "Notify Kitchen" stop for an already-cancelled
```

Replace it with:

```ts
import type { printOrderSnapshotSchema } from "./schemas/print-job.schema";
import type { Order } from "./types";
import type { PrintHostPrinterState } from "./print-host-printer";
import type { LeasedPrintJob } from "./print-agent-wire";

/** The five thermal documents + reprint/notice paths a `PrintJob` can carry.
 *  `"cancel-notice"` is the "Notify Kitchen" stop for an already-cancelled
```

In `packages/shared/src/print-job.ts`, find:

```ts
 *  "natural wrong branch" left (repo memories `enum-reuse-across-opposite-
 *  semantics`, `helper-null-verdict-discarded-at-call-site`).
 *  `"already-resolved"` carries the EXISTING row's `id` so PH-8's readback
 *  can still track the job the tap referred to. */
export type PrintJobEnqueueResult =
  | { outcome: "queued"; id: string; duplicate: boolean }
  | { outcome: "no-host" }
  | { outcome: "already-resolved"; id: string }
  | { outcome: "too-large" };
```

Replace it with:

```ts
 *  "natural wrong branch" left (repo memories `enum-reuse-across-opposite-
 *  semantics`, `helper-null-verdict-discarded-at-call-site`).
 *  `"already-resolved"` carries the EXISTING row's `id` so PH-8's readback
 *  can still track the job the tap referred to.
 *  Phase 2 Session 2B (spec §7.11): `leased` is a job leased to the asking tab (made so now, or still so
 *  from a send whose answer was lost); that tab prints it at once, with no lease request. */
export type PrintJobEnqueueResult =
  | { outcome: "queued"; id: string; duplicate: boolean; leased?: LeasedPrintJob }
  | { outcome: "no-host" }
  | { outcome: "already-resolved"; id: string }
  | { outcome: "too-large" };
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
  });
}

/** leased → (lease ran out) the same as a "maybe sent" failure (§7.2). */
export function planExpiry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "leased" || job.lease === undefined) return { ok: false, reason: "wrong-status" };
```

Replace it with:

```ts
  });
}

/** The log detail of a lease made at creation (spec §7.11), so a job's history says how it was leased. */
export const PRINT_DIRECT_LEASE_DETAIL = "direct";

/** The fields of a job created already leased (spec §7.11): the create row's own fields, the lease, and its
 *  two log entries. */
export interface PrintJobDirectLease {
  status: "leased";
  epoch: number;
  attempts: number;
  uncertainAttempts: number;
  nextAttemptAt: Date;
  labels: PrintJobLabel[];
  lease: PrintJobLease;
  log: PrintJobLogEntry[];
}

/** Phase 2 Session 2B (spec §7.11, plan decision 15): a job created already leased to the asking tab, so the
 *  create and the lease are ONE write. It is exactly the job planLease would make of a job created at the same
 *  moment (§7.2: epoch 1, one attempt, a 90 s lease), so every later transition (the ack, an expiry, a late
 *  ack) treats it as any leased job: a tab that dies before printing lets it expire into REPRINT (a KOT) or
 *  the cashier's question (a bill). The caller decides that the asking tab may lease it (§7.6, §9.3). */
export function directLeaseOf(input: {
  labels: readonly PrintJobLabel[];
  who: { deviceId: string; tabId: string };
  originDeviceId?: string;
  nowMs: number;
}): PrintJobDirectLease {
  const init = printJobLifecycleInit(input.nowMs, input.labels);
  const epoch = init.epoch + 1;
  return {
    ...init,
    status: "leased",
    epoch,
    attempts: init.attempts + 1,
    lease: { deviceId: input.who.deviceId, tabId: input.who.tabId, epoch, expiresAt: new Date(input.nowMs + PRINT_LEASE_MS) },
    log: [printJobCreatedLog(input.nowMs, input.originDeviceId), logEntry(input.nowMs, "leased", input.who.deviceId, PRINT_DIRECT_LEASE_DETAIL)],
  };
}

/** leased → (lease ran out) the same as a "maybe sent" failure (§7.2). */
export function planExpiry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "leased" || job.lease === undefined) return { ok: false, reason: "wrong-status" };
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-lifecycle.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 26`; `# pass 26`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-agent-wire.ts packages/shared/src/print-job.ts packages/shared/src/print-lifecycle.test.ts packages/shared/src/print-lifecycle.ts
git commit -m "feat(print): Phase 2 direct print, the shared contract: the lease header, a ref that carries its lease, the ack's more, and a job made leased at creation"
```

---

### Task B2: the server: the asking tab's first slip on its own free line is made leased to it, a lost answer is handed back to that tab only, and nothing is announced to the device printing it

**Files:**
- Create: `apps/cafe/lib/print-direct.ts` (`PrintJobAskingTab`, `printLineIsFree`, `PRINT_REDELIVERY_SELECT`, `PrintRedeliveryRow`, `redeliveryOf`, `announcesQueuedJob`)
- Modify: `apps/cafe/lib/print-order-jobs.ts` (`PrintIntent.leaseTabId`; `insertPrintJob`'s `tab`; `createOrderPrintJobs`'s `leaseTabId`; `enqueueOwnPrintJob`'s `tab`; `enqueueDirectPrintJob`)
- Modify: `apps/cafe/lib/print-lease.ts` (`leasedJobOf`, which `leasedPrintJobOf` now calls)
- Modify: `apps/cafe/app/api/orders/route.ts`, `apps/cafe/app/api/orders/[id]/items/route.ts`, `apps/cafe/app/api/orders/[id]/items/void/route.ts`, `apps/cafe/app/api/orders/[id]/settle/route.ts`, `apps/cafe/app/api/orders/[id]/table/route.ts`, `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, `apps/cafe/lib/print-agent-server.ts` (each passes `leaseTabId: intent.leaseTabId`)
- Modify: `apps/cafe/app/api/print-jobs/route.ts` (`enqueueDirectPrintJob` first, then Phase 1's enqueue)
- Tests: `apps/cafe/lib/print-direct.test.ts` (create); `apps/cafe/lib/print-order-jobs.test.ts` (two new tests, two new pins, the M-d pin changed deliberately); `apps/cafe/package.json` (testChain)

**Interfaces produced:** `printIntentOf(req)` → `{ deviceId, bill, leaseTabId? }`; `insertPrintJob({ …, tab?: { tabId, direct } })`; `createOrderPrintJobs({ …, leaseTabId? })`; `enqueueOwnPrintJob({ …, tab? })`; `enqueueDirectPrintJob({ payload, label, queuedBy, idempotencyKey?, originDeviceId, leaseTabId, nowMs }): Promise<PrintJobEnqueueResult | null>`; `printLineIsFree(deviceId, nowMs): Promise<boolean>`; `redeliveryOf(row, { deviceId, tabId }, nowMs): LeasedPrintJob | null`; `announcesQueuedJob({ created, status }, directOnLine): boolean`; `leasedJobOf(head, { epoch, attempts, labels }, payload): LeasedPrintJob`.

**When a slip is made leased (spec §7.11, decision 15).** Only when all of these hold: the request names its tab (`x-pos-print-lease`, sent only by the tab that drains this device's slips while its printer can print now, Task B4); the slip prints on the asking device (simple mode: the host's own order, or any device's own slip when there is no host; a slip for another device never is); its line is free (`printLineIsFree`: no job leased, and no queued job that is fresh or approved, the lease's own line filter, one read); and it is the request's first slip on that line (`refs.length === 0`; only that slip gets the tab at all, so a collision on a later slip never reads a payload: the fresh review's M-1). Then the job is inserted already leased to `{ device, tab }` in the ONE write that creates it, and its ref carries the `LeasedPrintJob`. Every other slip is made queued exactly as in Phase 1. A Pay Now's bill therefore waits queued behind its KOT, and the KOT's ack (`more`, Task B3) brings it: KOT before bill (§7.6) holds by construction.

**A lost answer (spec §7.11).** The order's replay creates nothing (ruling R3), so the client re-sends the slip through the enqueue (Session 1C), with the header. `enqueueDirectPrintJob` reads the host once: another device's host → null, and Phase 1's `enqueuePrintJob` runs as before; otherwise the slip goes through `enqueueOwnPrintJob` with the tab. On the key collision `insertPrintJob` reads the found job with its payload, and `redeliveryOf` hands back its lease only if it is still leased, to this very device AND tab, at the same epoch, with the lease running, on this device's line, and its payload still parses; any other case answers as Phase 1 did (`already-resolved` for a leased job). A tab reloaded since has a new id: its lease expires (REPRINT), like a refresh mid-print (M7).

**No realtime message to yourself (decision 16).** A job made leased publishes nothing, and neither does a queued job made in the same request on that line (`announcesQueuedJob`): the asking tab is printing already and its ack's `more` brings it. The host's `print-job` nudge counts only announced jobs, so a host's own order nudges nobody. Every other new queued job keeps Phase 1's `queued` print-status aimed at its device.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-direct.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mongoose from "mongoose";
import { PRINT_LEASE_MS, directLeaseOf } from "@pos/shared/print-lifecycle";
import { stripComments } from "@/lib/source-pin-utils";
import { announcesQueuedJob, redeliveryOf, type PrintRedeliveryRow } from "@/lib/print-direct";

// Phase 2 Session 2B (spec §7.11, plan decisions 15 and 16): direct print on the asking device. The rules are
// pure here; the creation itself is proven live (npm run verify:print:live, legs ak–am).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const T0 = Date.parse("2026-10-04T12:00:00.000Z");
const WHO = { deviceId: "dev-a", tabId: "tab-1" };
const PAYLOAD = { kind: "eod", dateKey: "2026-10-04", dateLabel: "4 Oct" };

function row(over: Partial<PrintRedeliveryRow> = {}): PrintRedeliveryRow {
  const direct = directLeaseOf({ labels: [], who: WHO, originDeviceId: "dev-a", nowMs: T0 });
  return {
    _id: new mongoose.Types.ObjectId(),
    kind: "eod",
    status: direct.status,
    label: "End of day",
    createdAt: new Date(T0),
    targetDeviceId: "dev-a",
    epoch: direct.epoch,
    attempts: direct.attempts,
    uncertainAttempts: direct.uncertainAttempts,
    nextAttemptAt: direct.nextAttemptAt,
    labels: direct.labels,
    lease: direct.lease,
    payload: JSON.stringify(PAYLOAD),
    copyIndex: 0,
    ...over,
  };
}

test("redeliveryOf: a job still leased to the asking tab, its lease running, is handed over again exactly as first sent", () => {
  const leased = row();
  const again = redeliveryOf(leased, WHO, T0 + 10_000);
  assert.ok(again !== null, "the same tab asks again while its lease runs");
  assert.deepEqual(again, {
    id: String(leased._id),
    epoch: 1,
    kind: "eod",
    label: "End of day",
    createdAt: new Date(T0).toISOString(),
    payload: PAYLOAD,
    labels: [],
    copyIndex: 0,
    attempt: 1,
  });
});

test("redeliveryOf: anything but that very lease answers as Phase 1 did (null)", () => {
  const cases: Array<[string, PrintRedeliveryRow, { deviceId: string; tabId: string }, number]> = [
    ["another tab of the device (a reload has a new id; its lease expires)", row(), { deviceId: "dev-a", tabId: "tab-2" }, T0],
    ["another device", row(), { deviceId: "dev-b", tabId: "tab-1" }, T0],
    ["a lease that ran out", row(), WHO, T0 + PRINT_LEASE_MS],
    ["a job already printed", row({ status: "printed" }), WHO, T0],
    ["a queued job (a lease expired into the queue)", row({ status: "queued" }), WHO, T0],
    ["a job sent to another device since", row({ targetDeviceId: "dev-b" }), WHO, T0],
    ["a lease from an older epoch", row({ epoch: 2 }), WHO, T0],
    ["a payload that no longer parses", row({ payload: "{" }), WHO, T0],
    ["a payload that fails the schema", row({ payload: JSON.stringify({ kind: "nope" }) }), WHO, T0],
    ["a row read without its payload", row({ payload: undefined }), WHO, T0],
  ];
  for (const [label, r, who, nowMs] of cases) assert.equal(redeliveryOf(r, who, nowMs), null, label);
});

test("announcesQueuedJob: a new queued job is announced; never a job made leased, a job found under its key, or one its line's tab is printing past", () => {
  assert.equal(announcesQueuedJob({ created: true, status: "queued" }, false), true, "Phase 1: another device or tab prints it");
  assert.equal(announcesQueuedJob({ created: true, status: "leased" }, true), false, "made leased: the asking tab is printing it now");
  assert.equal(announcesQueuedJob({ created: true, status: "queued" }, true), false, "Pay Now's bill behind its direct KOT: the ack's more brings it");
  assert.equal(announcesQueuedJob({ created: false, status: "queued" }, false), false, "a job found under its key is not new");
});

test("PIN: the line is free only when nothing is leased or waiting on it (the lease's own line filter, one read)", () => {
  const s = src("apps/cafe/lib/print-direct.ts");
  assert.match(s, /return \(await PrintJob\.findOne\(printJobLineFilter\(deviceId, nowMs\)\)\.select\("_id"\)\.lean\(\)\) === null;/);
  assert.ok(!/PrintJob\.(create|updateOne|updateMany|deleteMany|findOneAndUpdate)\(/.test(s), "the rules write nothing");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.deepEqual(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": "dev-1", "x-pos-print-bill": "1" })), { deviceId: "dev-1", bill: true });
});

test("buildKotPrintDevices: positional like kotIdemKeys; a round its tab printed stays empty; no device writes nothing", () => {
  assert.equal(buildKotPrintDevices(undefined, 1, undefined), undefined);
  assert.deepEqual(buildKotPrintDevices(undefined, 1, "dev-1"), ["dev-1"]);
```

Replace it with:

```ts
  assert.deepEqual(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": "dev-1", "x-pos-print-bill": "1" })), { deviceId: "dev-1", bill: true });
});

// Phase 2 Session 2B (spec §7.11): the draining tab that can print now names itself; an unusable name only
// means no direct print (the slips are made queued, as in Phase 1), never a refused order.
test("printIntentOf: the asking tab's lease header joins the intent only with an agent opt-in and a usable tab id", () => {
  const agent = { "x-pos-print-agent": "1", "x-pos-device-id": "dev-1" };
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-lease": " tab-1 " })), { deviceId: "dev-1", bill: false, leaseTabId: "tab-1" });
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-lease": "  " })), { deviceId: "dev-1", bill: false }, "a blank tab id is no tab");
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-lease": "t".repeat(65) })), { deviceId: "dev-1", bill: false }, "an over-long tab id is ignored, not a 400");
  assert.equal(printIntentOf(reqWith({ "x-pos-device-id": "dev-1", "x-pos-print-lease": "tab-1" })), null, "the lease header alone is not an opt-in");
});

test("buildKotPrintDevices: positional like kotIdemKeys; a round its tab printed stays empty; no device writes nothing", () => {
  assert.equal(buildKotPrintDevices(undefined, 1, undefined), undefined);
  assert.deepEqual(buildKotPrintDevices(undefined, 1, "dev-1"), ["dev-1"]);
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.match(fn, /if \(made > 0 && host !== null\) publishCafeEvent\("print-job"\);/);
  assert.match(s, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(s, "PrintJob.create("), 1, "one write point");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

```

Replace it with:

```ts
  assert.match(fn, /if \(made > 0 && host !== null\) publishCafeEvent\("print-job"\);/);
  assert.match(s, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(s, "PrintJob.create("), 1, "one write point");
  // Session 2B (spec §7.11): a job is made leased only on the asking device's own line, only the request's
  // first slip there, only when the line is free; and a job printed by the asking tab is never announced.
  assert.match(fn, /const leaseTabId = target === input\.originDeviceId \? input\.leaseTabId : undefined;/, "never for a slip another device prints");
  assert.match(fn, /const lineFree = leaseTabId !== undefined && \(await printLineIsFree\(target, input\.nowMs\)\);/, "one read of the line, only when it can matter");
  assert.match(fn, /const tab = leaseTabId === undefined \|\| refs\.length > 0 \? \{\} : \{ tab: \{ tabId: leaseTabId, direct: lineFree \} \};/, "only the first slip of the request on the line");
  assert.match(fn, /if \(announcesQueuedJob\(job, directOnLine\)\) \{/, "no realtime message to yourself");
  assert.match(s, /\.\.\.\(direct \?\? \{ \.\.\.printJobLifecycleInit\(input\.nowMs, labels\), log: \[printJobCreatedLog\(input\.nowMs, input\.originDeviceId\)\] \}\),/, "made leased in the same write that creates it");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});

// ── Session 1C, the server half (the 1B gate rulings: M-a, M-d, M-e, M-f, R4 job-aware lane, the pulse) ──

test("printPulseDeviceOf: only a usable ?device= names the agent; anything else is ignored, never a 400", () => {
```

Replace it with:

```ts
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});

// Session 2B (spec §7.11): every request that makes slips carries the asking tab to job creation.
test("PIN (2B): every order route and the self-order claim pass the asking tab; the enqueue tries direct print first", () => {
  for (const rel of [...ROUTES.map(([r]) => r), "apps/cafe/lib/print-agent-server.ts"]) {
    const s = src(rel);
    assert.equal(count(s, "leaseTabId: intent.leaseTabId,"), 1, `${rel}: the asking tab reaches createOrderPrintJobs`);
    assert.ok(s.indexOf("originDeviceId: intent.deviceId,") < s.indexOf("leaseTabId: intent.leaseTabId,"), `${rel}: beside the asking device`);
  }
  const route = src("apps/cafe/app/api/print-jobs/route.ts");
  inOrder(route, ["const intent = printIntentOf(req);", "intent?.leaseTabId !== undefined", "await enqueueDirectPrintJob({", "direct ??", "(await enqueuePrintJob({"], "the enqueue");
  const lib = src("apps/cafe/lib/print-order-jobs.ts");
  const direct = lib.slice(lib.indexOf("export async function enqueueDirectPrintJob("), lib.indexOf("export function withPrintJobs<T>("));
  assert.match(direct, /if \(host !== null && host\.deviceId !== input\.originDeviceId\) return null;/, "another device's host: Phase 1's enqueue");
  assert.match(direct, /tab: \{ tabId: leaseTabId, direct: await printLineIsFree\(input\.originDeviceId, input\.nowMs\) \}/, "made leased only on a free line");
  const own = lib.slice(lib.indexOf("export async function enqueueOwnPrintJob("), lib.indexOf("export async function enqueueDirectPrintJob("));
  inOrder(own, ["if (job.ref.leased !== undefined) return {", "leased: job.ref.leased };", "if (!job.created && job.status !== \"queued\")", "if (job.created) publishPrintStatus("], "a leased job is answered with its lease before any announcement");
});

// ── Session 1C, the server half (the 1B gate rulings: M-a, M-d, M-e, M-f, R4 job-aware lane, the pulse) ──

test("printPulseDeviceOf: only a usable ?device= names the agent; anything else is ignored, never a 400", () => {
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  assert.match(s, /label: input\.request\.label,\s*status: "queued",\s*\};\s*return \{ ref, created: true, status: "queued" \};/, "a new job is queued");
  assert.match(s, /label: existing\.label,\s*status: existing\.status,\s*\};/, "a found job keeps its own state");
  assert.match(src("packages/shared/src/print-agent-wire.ts"), /export interface PrintJobRef \{[^}]*status: PrintJobStatus;/, "the wire type carries it");
});

```

Replace it with:

```ts

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  // Session 2B deliberately changed the first two: a new job is queued, or leased to the asking tab and
  // carrying its lease; a found job keeps its own state, plus its lease when it is still the asking tab's.
  assert.match(
    s,
    /label: input\.request\.label,\s*status: direct === null \? "queued" : "leased",\s*\.\.\.\(direct !== null \? \{ leased: leasedJobOf\(created, direct, payload\) \} : \{\}\),\s*\};\s*return \{ ref, created: true, status: ref\.status \};/,
    "a new job is queued, or made leased to the asking tab",
  );
  assert.match(s, /label: existing\.label,\s*status: existing\.status,\s*\.\.\.\(again !== null \? \{ leased: again \} : \{\}\),\s*\};/, "a found job keeps its own state");
  assert.match(src("packages/shared/src/print-agent-wire.ts"), /export interface PrintJobRef \{[^}]*status: PrintJobStatus;/, "the wire type carries it");
});

```

In `apps/cafe/package.json`, find:

```json
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

Replace it with:

```json
    "lib/appearance-settings-paths-2.test.ts",
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts",
    "lib/print-direct.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-direct.test.ts lib/print-order-jobs.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 17`; `# pass 12`; `# fail 5`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
            order: result.order,
            slips: [{ kind: "kot", round: result.order.kotRounds }],
            originDeviceId: intent.deviceId,
            queuedBy: authed.session.user.name ?? "",
            nowMs: Date.now(),
          })
```

Replace it with:

```ts
            order: result.order,
            slips: [{ kind: "kot", round: result.order.kotRounds }],
            originDeviceId: intent.deviceId,
            leaseTabId: intent.leaseTabId,
            queuedBy: authed.session.user.name ?? "",
            nowMs: Date.now(),
          })
```

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
          order: updated,
          slips: [{ kind: "kot", round }],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          order: updated,
          slips: [{ kind: "kot", round }],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/[id]/items/void/route.ts`, find:

```ts
          order: updated,
          slips: [{ kind: "void" }],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          order: updated,
          slips: [{ kind: "void" }],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/[id]/settle/route.ts`, find:

```ts
          order: numbered.value ?? updated,
          slips: intent.bill ? [{ kind: "bill" }] : [],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          order: numbered.value ?? updated,
          slips: intent.bill ? [{ kind: "bill" }] : [],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/[id]/table/route.ts`, find:

```ts
            },
          ],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
            },
          ],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/route.ts`, find:

```ts
          order: numbered.value ?? landed,
          slips: [{ kind: "kot", round: 1 }, ...(intent.bill && data.status === "Completed" ? [{ kind: "bill" as const }] : [])],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          order: numbered.value ?? landed,
          slips: [{ kind: "kot", round: 1 }, ...(intent.bill && data.status === "Completed" ? [{ kind: "bill" as const }] : [])],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts
import { PRINT_JOB_LABEL_MAX_CHARS, printJobPayloadWithinCap } from "@pos/shared/print-job";
import { PRINT_DEVICE_ID_HEADER, PRINT_IDEMPOTENCY_HEADER, PRINT_IDEMPOTENCY_KEY_PATTERN } from "@pos/shared/print-agent-wire";
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { enqueueOwnPrintJob, printIntentOf } from "@/lib/print-order-jobs";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

Replace it with:

```ts
import { PRINT_JOB_LABEL_MAX_CHARS, printJobPayloadWithinCap } from "@pos/shared/print-job";
import { PRINT_DEVICE_ID_HEADER, PRINT_IDEMPOTENCY_HEADER, PRINT_IDEMPOTENCY_KEY_PATTERN } from "@pos/shared/print-agent-wire";
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { enqueueDirectPrintJob, enqueueOwnPrintJob, printIntentOf } from "@/lib/print-order-jobs";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts

  try {
    await connectDB();
    let result = await enqueuePrintJob({
      payload: parsed.data.payload,
      label: parsed.data.label,
      queuedBy,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      ...(originDeviceId !== undefined ? { originDeviceId } : {}),
      nowMs,
    });
    // Phase 1 (spec §6.6): with no host, an agent tab prints its own client-started slip through the
    // lifecycle. A tab from before Phase 1 sends no agent header and still gets "no-host" (print here).
    const intent = printIntentOf(req);
    if (result.outcome === "no-host" && intent !== null) {
      result = await enqueueOwnPrintJob({
        payload: parsed.data.payload,
```

Replace it with:

```ts

  try {
    await connectDB();
    const intent = printIntentOf(req);
    // Session 2B (spec §7.11): the tab that drains the asking device's slips and can print now prints its
    // own slip at once (made leased to it), and gets back a slip still leased to it whose first answer was
    // lost. null: another device is the host, and the enqueue below makes the slip for it.
    const direct =
      intent?.leaseTabId !== undefined
        ? await enqueueDirectPrintJob({
            payload: parsed.data.payload,
            label: parsed.data.label,
            queuedBy,
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
            originDeviceId: intent.deviceId,
            leaseTabId: intent.leaseTabId,
            nowMs,
          })
        : null;
    let result =
      direct ??
      (await enqueuePrintJob({
        payload: parsed.data.payload,
        label: parsed.data.label,
        queuedBy,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        ...(originDeviceId !== undefined ? { originDeviceId } : {}),
        nowMs,
      }));
    // Phase 1 (spec §6.6): with no host, an agent tab prints its own client-started slip through the
    // lifecycle. A tab from before Phase 1 sends no agent header and still gets "no-host" (print here).
    if (result.outcome === "no-host" && intent !== null) {
      result = await enqueueOwnPrintJob({
        payload: parsed.data.payload,
```

In `apps/cafe/lib/print-agent-server.ts`, find:

```ts
    order: result.order,
    slips: [{ kind: "kot", round: result.kotRound }],
    originDeviceId: intent.deviceId,
    queuedBy: SELF_ORDER_RECEIVER,
    nowMs,
  });
```

Replace it with:

```ts
    order: result.order,
    slips: [{ kind: "kot", round: result.kotRound }],
    originDeviceId: intent.deviceId,
    leaseTabId: intent.leaseTabId,
    queuedBy: SELF_ORDER_RECEIVER,
    nowMs,
  });
```

Create `apps/cafe/lib/print-direct.ts`:

```ts
import type { Types } from "mongoose";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { lifecycleOf, type PrintJobLease } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { leasedJobOf, printJobLineFilter } from "@/lib/print-lease";

// Phase 2 Session 2B (spec §7.11, plan decisions 15 and 16): direct print on the asking device. When the tab
// that drains a device's slips, and can print right now, asks for slips that print on that same device, the
// first one is made already leased to it and the answer carries the lease: the tab prints at once, with no
// lease request and no realtime message. These are the server's rules for it; print-order-jobs.ts applies
// them. Never calls connectDB(). No console.*.

/** The asking tab, for a job whose line is the asking device's own (the caller's rule). `direct`: make the job
 *  already leased to it. */
export interface PrintJobAskingTab {
  tabId: string;
  direct: boolean;
}

/** Nothing waits on this device's line ahead of a slip made now (§7.6): no job leased, and no queued job that
 *  is fresh or approved (a parked one never blocks the line). One read on the line index. */
export async function printLineIsFree(deviceId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne(printJobLineFilter(deviceId, nowMs)).select("_id").lean()) === null;
}

/** What a job found under its key is read with when the asking tab may be handed it again. */
export const PRINT_REDELIVERY_SELECT =
  "kind status label orderId createdAt targetDeviceId epoch attempts uncertainAttempts nextAttemptAt labels lease payload copyIndex";

export interface PrintRedeliveryRow {
  _id: Types.ObjectId;
  kind: PrintJobKind;
  status: PrintJobStatus;
  label: string;
  orderId?: string;
  createdAt: Date;
  targetDeviceId?: string;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
  nextAttemptAt?: Date;
  labels?: string[];
  lease?: PrintJobLease;
  payload?: string;
  copyIndex?: number;
}

/** A job its key already names that is still leased to the asking device's very tab, its lease still running:
 *  the answer that carried it was lost (spec §7.11), so the same lease is handed over again. The agent ignores a
 *  job it already holds (its id and epoch), so a delivery that did arrive still prints once. Anything else:
 *  null, and the caller answers as in Phase 1 (a tab reloaded since has a new id; its lease expires). */
export function redeliveryOf(row: PrintRedeliveryRow, who: { deviceId: string; tabId: string }, nowMs: number): LeasedPrintJob | null {
  const job = lifecycleOf(row);
  const lease = job.lease;
  if (job.status !== "leased" || lease === undefined || row.payload === undefined || row.targetDeviceId !== who.deviceId) return null;
  if (lease.deviceId !== who.deviceId || lease.tabId !== who.tabId || lease.epoch !== job.epoch || lease.expiresAt.getTime() <= nowMs) return null;
  let payload: PrintJobPayload;
  try {
    const parsed = printJobPayloadSchema.safeParse(JSON.parse(row.payload) as unknown);
    if (!parsed.success) return null;
    payload = parsed.data;
  } catch {
    return null;
  }
  return leasedJobOf(row, { epoch: job.epoch, attempts: job.attempts, labels: job.labels }, payload);
}

/** Decision 16, no realtime message to yourself: a new queued job is announced to the device that prints it
 *  (its "queued" print-status, and the host's print-job nudge) unless the same request made a job leased to
 *  the asking tab on that line. That tab is printing already, and its ack's `more` brings it to the rest. A
 *  job made leased is never announced, and a job found under its key is not new. */
export function announcesQueuedJob(job: { created: boolean; status: PrintJobStatus }, directOnLine: boolean): boolean {
  return job.created && job.status === "queued" && !directOnLine;
}
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  return applied;
}

export function leasedPrintJobOf(
  head: { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number },
  patch: PrintJobPatch,
  payload: PrintJobPayload,
  labels: PrintJobLabel[],
): LeasedPrintJob {
  return {
    id: String(head._id),
    epoch: patch.set.epoch ?? 0,
    kind: head.kind,
    label: head.label,
    ...(head.orderId !== undefined ? { orderId: head.orderId } : {}),
    createdAt: head.createdAt.toISOString(),
    payload,
    labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: patch.set.attempts ?? 1,
  };
}

/** The claim path's gates, unchanged (print-queue-claim.ts): a payload that no longer parses, or a
```

Replace it with:

```ts
  return applied;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number };

/** The wire job for one lease (spec §7.3), from its row: leased by a lease request, made leased at creation,
 *  or delivered again to the tab that holds it (Session 2B, spec §7.11). */
export function leasedJobOf(head: LeasedHead, lease: { epoch: number; attempts: number; labels: PrintJobLabel[] }, payload: PrintJobPayload): LeasedPrintJob {
  return {
    id: String(head._id),
    epoch: lease.epoch,
    kind: head.kind,
    label: head.label,
    ...(head.orderId !== undefined ? { orderId: head.orderId } : {}),
    createdAt: head.createdAt.toISOString(),
    payload,
    labels: lease.labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: lease.attempts,
  };
}

export function leasedPrintJobOf(head: LeasedHead, patch: PrintJobPatch, payload: PrintJobPayload, labels: PrintJobLabel[]): LeasedPrintJob {
  return leasedJobOf(head, { epoch: patch.set.epoch ?? 0, attempts: patch.set.attempts ?? 1, labels }, payload);
}

/** The claim path's gates, unchanged (print-queue-claim.ts): a payload that no longer parses, or a
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";
```

Replace it with:

```ts
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_LEASE_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { directLeaseOf, printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import {
  PRINT_REDELIVERY_SELECT,
  announcesQueuedJob,
  printLineIsFree,
  redeliveryOf,
  type PrintJobAskingTab,
  type PrintRedeliveryRow,
} from "@/lib/print-direct";
import { leasedJobOf } from "@/lib/print-lease";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  deviceId: string;
  /** PRINT_BILL_HEADER: this call site also prints the bill (Pay Now, the POS settle). */
  bill: boolean;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
```

Replace it with:

```ts
  deviceId: string;
  /** PRINT_BILL_HEADER: this call site also prints the bill (Pay Now, the POS settle). */
  bill: boolean;
  /** Session 2B (PRINT_LEASE_HEADER, spec §7.11): the asking tab drains this device's slips and can print
   *  now, so a slip that prints on this device may be made already leased to it. */
  leaseTabId?: string;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  if (req.headers.get(PRINT_AGENT_HEADER)?.trim() !== PRINT_HEADER_ON) return null;
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  return { deviceId, bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON };
}

/** The tab's kotPrintDevices after firing `round` for `deviceId`. Positional, the kotIdemKeys idiom:
```

Replace it with:

```ts
  if (req.headers.get(PRINT_AGENT_HEADER)?.trim() !== PRINT_HEADER_ON) return null;
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  const leaseTabId = req.headers.get(PRINT_LEASE_HEADER)?.trim() ?? "";
  return {
    deviceId,
    bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON,
    // An unusable tab id only means no direct print: the slips are made queued, as in Phase 1.
    ...(leaseTabId !== "" && leaseTabId.length <= PRINT_HOST_TAB_ID_MAX_CHARS ? { leaseTabId } : {}),
  };
}

/** The tab's kotPrintDevices after firing `round` for `deviceId`. Positional, the kotIdemKeys idiom:
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws. */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  targetDeviceId: string;
```

Replace it with:

```ts
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws.
 *  Session 2B (spec §7.11): `tab` is the asking tab, passed only when this job's line is the asking device's
 *  own. With `direct` the job is made already leased to it, in this one write; and a job its key already
 *  names that is still leased to that very tab is handed back with its lease (an answer lost on the way). */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  targetDeviceId: string;
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`. */
  jobKey?: string;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
```

Replace it with:

```ts
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`. */
  jobKey?: string;
  tab?: PrintJobAskingTab;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
```

Replace it with:

```ts
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  const labels = printJobInitialLabels(payload);
  const who = input.tab === undefined ? null : { deviceId: input.targetDeviceId, tabId: input.tab.tabId };
  const direct = who !== null && input.tab?.direct === true ? directLeaseOf({ labels, who, originDeviceId: input.originDeviceId, nowMs: input.nowMs }) : null;
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
      targetDeviceId: input.targetDeviceId,
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      ...printJobLifecycleInit(input.nowMs, printJobInitialLabels(payload)),
      log: [printJobCreatedLog(input.nowMs, input.originDeviceId)],
    });
    const ref: PrintJobRef = {
      id: String(created._id),
      kind: payload.kind,
      targetDeviceId: input.targetDeviceId,
      label: input.request.label,
      status: "queued",
    };
    return { ref, created: true, status: "queued" };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey }).select("kind status label targetDeviceId").lean();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
      status: existing.status,
    };
    return { ref, created: false, status: existing.status };
  }
```

Replace it with:

```ts
      targetDeviceId: input.targetDeviceId,
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      // Made leased to the asking tab (its log says "direct"), or queued as in Phase 1.
      ...(direct ?? { ...printJobLifecycleInit(input.nowMs, labels), log: [printJobCreatedLog(input.nowMs, input.originDeviceId)] }),
    });
    const ref: PrintJobRef = {
      id: String(created._id),
      kind: payload.kind,
      targetDeviceId: input.targetDeviceId,
      label: input.request.label,
      status: direct === null ? "queued" : "leased",
      ...(direct !== null ? { leased: leasedJobOf(created, direct, payload) } : {}),
    };
    return { ref, created: true, status: ref.status };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey })
      .select(who === null ? "kind status label targetDeviceId" : PRINT_REDELIVERY_SELECT)
      .lean<PrintRedeliveryRow>();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const again = who === null ? null : redeliveryOf(existing, who, input.nowMs);
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
      status: existing.status,
      ...(again !== null ? { leased: again } : {}),
    };
    return { ref, created: false, status: existing.status };
  }
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1. */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only when no device asked (the public auto-accept, from Session 1C: final review C1). */
  originDeviceId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
```

Replace it with:

```ts

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1.
 *  Session 2B (spec §7.11, decisions 15 and 16): when the slips print on the asking device and its draining
 *  tab can print now (`leaseTabId`), the first one is made leased to that tab if nothing older waits on its
 *  line; the rest follow it through the ack's `more`, so none of them is announced to the device printing. */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only when no device asked (the public auto-accept, from Session 1C: final review C1). */
  originDeviceId?: string;
  leaseTabId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
    if (target === undefined) return refs;
    const order = wireOrderOf(input.order);
    const slips = [...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    let made = 0;
    for (const slip of slips) {
      const request = requestOf(order, slip);
      if (request === null) continue;
      const job = await insertPrintJob({ request, targetDeviceId: target, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, nowMs: input.nowMs });
      if (job === null) continue;
      refs.push(job.ref);
      if (job.created) {
        made += 1;
        publishPrintStatus({ id: job.ref.id, status: "queued", target });
      }
```

Replace it with:

```ts
    if (target === undefined) return refs;
    const order = wireOrderOf(input.order);
    const slips = [...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    // The asking tab counts only when the slips print on its own device (the host's own order, or no host).
    const leaseTabId = target === input.originDeviceId ? input.leaseTabId : undefined;
    const lineFree = leaseTabId !== undefined && (await printLineIsFree(target, input.nowMs));
    let directOnLine = false;
    let made = 0;
    for (const slip of slips) {
      const request = requestOf(order, slip);
      if (request === null) continue;
      // Only the first slip of this request on the line may be leased now (§7.6: one writer, oldest first);
      // the rest are made as in Phase 1, so a collision on them never reads a payload (the 2B review, M-1).
      const tab = leaseTabId === undefined || refs.length > 0 ? {} : { tab: { tabId: leaseTabId, direct: lineFree } };
      const job = await insertPrintJob({ request, targetDeviceId: target, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, ...tab, nowMs: input.nowMs });
      if (job === null) continue;
      refs.push(job.ref);
      if (job.ref.leased !== undefined) directOnLine = true;
      if (announcesQueuedJob(job, directOnLine)) {
        made += 1;
        publishPrintStatus({ id: job.ref.id, status: "queued", target });
      }
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts

/** POST /api/print-jobs with no host, from an agent tab (spec §6.6): the asking device prints its own
 *  client-started slip (a reprint, End of day, a cancel notice) through the lifecycle, under the same
 *  key rules as enqueuePrintJob, so a retried POST is one job. */
export async function enqueueOwnPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId: string;
  nowMs: number;
}): Promise<PrintJobEnqueueResult> {
  const jobKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
```

Replace it with:

```ts

/** POST /api/print-jobs with no host, from an agent tab (spec §6.6): the asking device prints its own
 *  client-started slip (a reprint, End of day, a cancel notice) through the lifecycle, under the same
 *  key rules as enqueuePrintJob, so a retried POST is one job. Session 2B: `tab` as in insertPrintJob. */
export async function enqueueOwnPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId: string;
  tab?: PrintJobAskingTab;
  nowMs: number;
}): Promise<PrintJobEnqueueResult> {
  const jobKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
    originDeviceId: input.originDeviceId,
    queuedBy: input.queuedBy,
    ...(jobKey !== undefined ? { jobKey } : {}),
    nowMs: input.nowMs,
  });
  if (job === null) return { outcome: "too-large" };
  // A resolved job under this key already printed (or was dismissed): never report it as fresh.
  if (!job.created && job.status !== "queued") return { outcome: "already-resolved", id: job.ref.id };
  if (job.created) publishPrintStatus({ id: job.ref.id, status: "queued", target: input.originDeviceId });
  return { outcome: "queued", id: job.ref.id, duplicate: !job.created };
}

/** A route's answer: the order exactly as before, plus `printJobs` when the request opted in. */
```

Replace it with:

```ts
    originDeviceId: input.originDeviceId,
    queuedBy: input.queuedBy,
    ...(jobKey !== undefined ? { jobKey } : {}),
    ...(input.tab !== undefined ? { tab: input.tab } : {}),
    nowMs: input.nowMs,
  });
  if (job === null) return { outcome: "too-large" };
  // Session 2B: leased to the asking tab (made so now, or still so from a send whose answer was lost): it
  // prints there at once, and nothing is announced to the device that is printing it.
  if (job.ref.leased !== undefined) return { outcome: "queued", id: job.ref.id, duplicate: !job.created, leased: job.ref.leased };
  // A resolved job under this key already printed (or was dismissed): never report it as fresh.
  if (!job.created && job.status !== "queued") return { outcome: "already-resolved", id: job.ref.id };
  if (job.created) publishPrintStatus({ id: job.ref.id, status: "queued", target: input.originDeviceId });
  return { outcome: "queued", id: job.ref.id, duplicate: !job.created };
}

/** POST /api/print-jobs from the tab that drains the asking device's slips and can print now (Session 2B,
 *  spec §7.11). When the slip prints on the asking device (no host, or the asking device is the host), it is
 *  made leased to that tab if nothing older waits on its line, and a slip still leased to that tab (its first
 *  answer was lost) is handed back. null: another device is the host, so Phase 1's enqueue makes it for it. */
export async function enqueueDirectPrintJob(
  input: Omit<Parameters<typeof enqueueOwnPrintJob>[0], "tab"> & { leaseTabId: string },
): Promise<PrintJobEnqueueResult | null> {
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  if (host !== null && host.deviceId !== input.originDeviceId) return null;
  const { leaseTabId, ...own } = input;
  return enqueueOwnPrintJob({ ...own, tab: { tabId: leaseTabId, direct: await printLineIsFree(input.originDeviceId, input.nowMs) } });
}

/** A route's answer: the order exactly as before, plus `printJobs` when the request opted in. */
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-direct.test.ts lib/print-order-jobs.test.ts lib/print-lease.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 24`; `# pass 24`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-direct.ts lib/print-direct.test.ts lib/print-order-jobs.ts lib/print-lease.ts lib/print-agent-server.ts app/api/print-jobs/route.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add "apps/cafe/app/api/order-requests/[id]/accept/route.ts" "apps/cafe/app/api/orders/[id]/items/route.ts" "apps/cafe/app/api/orders/[id]/items/void/route.ts" "apps/cafe/app/api/orders/[id]/settle/route.ts" "apps/cafe/app/api/orders/[id]/table/route.ts" apps/cafe/app/api/orders/route.ts apps/cafe/app/api/print-jobs/route.ts apps/cafe/lib/print-agent-server.ts apps/cafe/lib/print-direct.test.ts apps/cafe/lib/print-direct.ts apps/cafe/lib/print-lease.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/lib/print-order-jobs.ts apps/cafe/package.json
git commit -m "feat(print): Phase 2 direct print on the server: the asking tab's first slip on its own free line is made leased to it, a lost answer is handed back, and nothing is announced to the device printing it"
```

---

### Task B3: the ack answers `more`, and the pulse and the wake stop counting a running lease, so a burst ends with no empty lease; no final print-status is published (gate finding G-1)

**Files:**
- Modify: `apps/cafe/lib/print-lease.ts` (`applyPrintJobPlan` publishes nothing; `printLineHasMore`; `ackPrintJob` answers `more`; `printJobsForMeFilter`, which `readJobsForDevice` reads)
- Modify: `apps/cafe/lib/print-queue.ts` (`dismissPrintJob` publishes nothing)
- Tests: `apps/cafe/lib/print-lifecycle-paths.test.ts` (two pins changed deliberately for G-1, one new pin); `apps/cafe/lib/print-lease.test.ts` (one new test)

**Interfaces produced:** `printLineHasMore(deviceId, nowMs): Promise<boolean>`; `ackPrintJob(...)` answers `{ applied, status, nextAttemptAt, more? }` (`more` only when the acked job left the line: printed, needs-confirm or failed); `printJobsForMeFilter(deviceId, nowMs): FilterQuery<IPrintJob>`.

**`more` (decision 9).** After an ack that takes its job off the line, one read on the line index (`printJobLineFilter` of the ACKING device, status queued) says whether that device's line holds more. The agent (Task B4) leases again only then, so Phase 1's trailing empty lease after every burst goes. A job back in the queue (a refusal, a maybe) is its line's head, and its `nextAttemptAt` already says when, so no hint is read. A failed read only drops the hint (`.catch(() => undefined)`): the ack itself has landed and is answered.

**G-1 (this gate): no final print-status.** Phase 1 published a job's final state (printed, needs-confirm, failed, dismissed) for "the ordering device's readback", but no device listens for it: the readback chip and the waiting-slips panel read the pulse's feeds, and the agent leases only on a `queued` frame aimed at its own device (`hooks/use-print-agent.ts`; checked by grep at the gate: the only `print-status` reader). Each one cost a Cloudflare Worker request per slip for nothing. Only `queued` aimed at the printing device stays: the one frame an agent acts on.

**G-2 (this gate, seen on the emulator): the pulse and the wake count only what a lease can act on.** Their "jobs for me" counted this device's own running lease, so a pulse or a wake that landed while the tab printed its direct KOT kicked the agent, and a lease followed its `more: false` ack. `printJobsForMeFilter` is the line less a lease that is still running; a lease that ran out still counts, so the lease call that expires it still comes (§7.2).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-lease.test.ts`, find:

```ts
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, PRINT_LEASE_MS, lifecycleOf, planExpiry, planLease, type PrintJobPlan, type PrintJobPatch } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { leasedPrintJobOf, printJobCasFilter, printJobLineFilter, printJobUpdateOf } from "./print-lease";

// Phase 1 Session 1A — DB-free tests of print-lease.ts's pure exports. The DB paths are proven live
// (npm run verify:print:live, legs q–x) and pinned in print-lifecycle-paths.test.ts.
```

Replace it with:

```ts
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, PRINT_LEASE_MS, lifecycleOf, planExpiry, planLease, type PrintJobPlan, type PrintJobPatch } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { leasedPrintJobOf, printJobCasFilter, printJobLineFilter, printJobsForMeFilter, printJobUpdateOf } from "./print-lease";

// Phase 1 Session 1A — DB-free tests of print-lease.ts's pure exports. The DB paths are proven live
// (npm run verify:print:live, legs q–x) and pinned in print-lifecycle-paths.test.ts.
```

In `apps/cafe/lib/print-lease.test.ts`, find:

```ts
    targetDeviceId: "dev-a",
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
});

```

Replace it with:

```ts
    targetDeviceId: "dev-a",
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
});

// Session 2B (found on the emulator at the 2A gate): the pulse and the wake counted this device's own running
// lease, so one landing mid-print kicked the agent into an empty lease after its ack.
test("printJobsForMeFilter: the line, less a lease still running; a lease that ran out still counts (its lease call expires it)", () => {
  assert.deepEqual(printJobsForMeFilter("dev-a", T0), {
    ...printJobLineFilter("dev-a", T0),
    $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(T0) } }],
  });
});

```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts

test("PIN: every lifecycle transition is ONE compare-and-set on {_id, status, epoch}, and a lease call is bounded", () => {
  const s = src(LEASE);
  // Session 1B: the CAS may carry an extra fence (a lease: still this device's job, 1A review M5),
  // and a landed final transition publishes its print-status (spec §10).
  assert.match(s, /PrintJob\.updateOne\(\{ \.\.\.printJobCasFilter\(id, job\), \.\.\.fence \}, printJobUpdateOf\(patch\)/);
  assert.match(s, /const applied = res\.modifiedCount === 1;/);
  assert.match(s, /if \(applied && PRINT_STATUS_PUBLISHED\.has\(patch\.status\)\) publishPrintStatus\(\{ id: String\(id\), status: patch\.status \}\);/);
  assert.match(s, /applyPrintJobPlan\(head\._id, job, plan\.patch, \{ targetDeviceId: input\.deviceId \}\)/, "the lease CAS is fenced on the device");
  assert.match(s, /for \(let step = 0; step < LEASE_MAX_STEPS; step\+\+\)/);
  assert.match(s, /printJobEligibility\(payload, order\)/, "the claim path's live-order gate still applies to a lease");
```

Replace it with:

```ts

test("PIN: every lifecycle transition is ONE compare-and-set on {_id, status, epoch}, and a lease call is bounded", () => {
  const s = src(LEASE);
  // Session 1B: the CAS may carry an extra fence (a lease: still this device's job, 1A review M5).
  // The Phase 2B gate (G-1) deliberately changed the rest: a landed transition publishes nothing, since no
  // device listened for a final state.
  assert.match(s, /PrintJob\.updateOne\(\{ \.\.\.printJobCasFilter\(id, job\), \.\.\.fence \}, printJobUpdateOf\(patch\)/);
  assert.match(s, /return res\.modifiedCount === 1;/);
  assert.ok(!s.includes("publishPrintStatus") && !s.includes("realtime-publish"), "the lifecycle's transitions publish nothing");
  assert.match(s, /applyPrintJobPlan\(head\._id, job, plan\.patch, \{ targetDeviceId: input\.deviceId \}\)/, "the lease CAS is fenced on the device");
  assert.match(s, /for \(let step = 0; step < LEASE_MAX_STEPS; step\+\+\)/);
  assert.match(s, /printJobEligibility\(payload, order\)/, "the claim path's live-order gate still applies to a lease");
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.match(src(LEASE), /return \{ jobs: \[\], retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});

test("PIN: the lifecycle publishes exactly the final statuses, and a dismissed job announces itself", () => {
  assert.match(src(LEASE), /new Set<PrintJobStatus>\(\["printed", "needs-confirm", "failed", "dismissed"\]\)/);
  const queue = src("apps/cafe/lib/print-queue.ts");
  const single = queue.slice(queue.indexOf("export async function dismissPrintJob("), queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("));
  assert.match(single, /if \(dismissed\) \{\s*publishPrintStatus\(\{ id: input\.id, status: "dismissed" \}\);\s*return \{ dismissed: true \};\s*\}/);
});

test("PIN (the Phase 1 final gate, M8): the soak drives only a local POS on a local scratch database, and stops after its first order unless that order is in its own database", () => {
```

Replace it with:

```ts
  assert.match(src(LEASE), /return \{ jobs: \[\], retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});

// The Phase 2B gate (G-1, deliberate change): a final state ("printed", "needs-confirm", "failed",
// "dismissed") had no listener on any device, so it is no longer published. Only "queued", aimed at the
// device that prints, is: the one frame an agent leases on.
test("PIN (G-1): no final state is published, from the lifecycle or a dismiss; only a queued job is announced to its printer", () => {
  assert.ok(!src(LEASE).includes("PRINT_STATUS_PUBLISHED"), "no final-status set");
  const queue = src("apps/cafe/lib/print-queue.ts");
  const single = queue.slice(queue.indexOf("export async function dismissPrintJob("), queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("));
  assert.match(single, /if \(dismissed\) \{\s*return \{ dismissed: true \};\s*\}/);
  for (const rel of ["apps/cafe/lib/print-queue.ts", "apps/cafe/lib/print-order-jobs.ts", "apps/cafe/lib/print-job-actions.ts"]) {
    for (const call of src(rel).match(/publishPrintStatus\(\{[^}]*\}\)/g) ?? []) {
      assert.match(call, /status: "queued"/, `${rel}: ${call} announces a queued job only`);
    }
  }
});

// Session 2B (plan decision 9): the ack answers whether the acking device's line holds more, so a burst ends
// with no empty lease. The hint never costs the ack itself.
test("PIN (2B): an ack that takes a job off the line answers `more` from one read of the acking device's line", () => {
  const s = src(LEASE);
  const ack = s.slice(s.indexOf("export async function ackPrintJob("), s.indexOf("export async function readJobsForDevice("));
  inOrder(
    ack,
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };',
      "const more = await printLineHasMore(input.deviceId, input.nowMs).catch(() => undefined);",
      "...(more !== undefined ? { more } : {})",
    ],
    "the ack",
  );
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printJobLineFilter\(deviceId, nowMs\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "one read on the line index");
});

test("PIN (the Phase 1 final gate, M8): the soak drives only a local POS on a local scratch database, and stops after its first order unless that order is in its own database", () => {
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-lease.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 24`; `# pass 20`; `# fail 4`

- [ ] **Step 3: The code**

In `apps/cafe/lib/print-lease.ts`, find:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_BACKOFF_MS,
```

Replace it with:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_BACKOFF_MS,
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { publishPrintStatus } from "@/lib/realtime-publish";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

```

Replace it with:

```ts
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  return update;
}

/** The statuses an ordering device's readback hears about at once (spec §10, §17.2: a job's creation
 *  and its final state); the pulse stays the fallback. */
const PRINT_STATUS_PUBLISHED: ReadonlySet<PrintJobStatus> = new Set<PrintJobStatus>(["printed", "needs-confirm", "failed", "dismissed"]);

/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. `fence` adds
 *  terms the plan depends on but the epoch does not cover (a lease: still this device's job). */
export async function applyPrintJobPlan(
  id: Types.ObjectId,
  job: PrintJobLifecycle,
```

Replace it with:

```ts
  return update;
}

/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. `fence` adds
 *  terms the plan depends on but the epoch does not cover (a lease: still this device's job).
 *  It publishes nothing (the Phase 2B gate, G-1): a job's final state had no listener on any device (the
 *  readback and the waiting-slips panel read the pulse; an agent leases only on "queued" aimed at it), so its
 *  Worker request bought nothing. */
export async function applyPrintJobPlan(
  id: Types.ObjectId,
  job: PrintJobLifecycle,
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  fence: FilterQuery<IPrintJob> = {},
): Promise<boolean> {
  const res = await PrintJob.updateOne({ ...printJobCasFilter(id, job), ...fence }, printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  const applied = res.modifiedCount === 1;
  // Fire-and-forget, after the write: a lost frame costs the readback one pulse, never the transition.
  if (applied && PRINT_STATUS_PUBLISHED.has(patch.status)) publishPrintStatus({ id: String(id), status: patch.status });
  return applied;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number };
```

Replace it with:

```ts
  fence: FilterQuery<IPrintJob> = {},
): Promise<boolean> {
  const res = await PrintJob.updateOne({ ...printJobCasFilter(id, job), ...fence }, printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  return res.modifiedCount === 1;
}

/** Session 2B (plan decision 9): this device's line still holds a queued job (due now, or after its backoff),
 *  so its agent leases again after an ack; otherwise it waits for a nudge, its timer or a new slip, and a
 *  burst ends with no empty lease. One read on the line index. */
export async function printLineHasMore(deviceId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number };
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
      return { applied: false, status: job.status, nextAttemptAt: null, reason: plan.reason };
    }
    if (await applyPrintJobPlan(row._id, job, plan.patch)) {
      return { applied: true, status: plan.patch.status, nextAttemptAt: plan.patch.set.nextAttemptAt?.toISOString() ?? null };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The wake's "jobs for me" (spec §7.3): how many jobs wait in this device's line, and the oldest. */
export async function readJobsForDevice(deviceId: string, nowMs: number): Promise<{ count: number; oldestCreatedAt: string | null }> {
  const rows = await PrintJob.find(printJobLineFilter(deviceId, nowMs))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
```

Replace it with:

```ts
      return { applied: false, status: job.status, nextAttemptAt: null, reason: plan.reason };
    }
    if (await applyPrintJobPlan(row._id, job, plan.patch)) {
      const nextAttemptAt = plan.patch.set.nextAttemptAt?.toISOString() ?? null;
      // Session 2B (decision 9): a job that left the line says whether the acking device's line holds more. A
      // job back in the queue is that line's head, and its nextAttemptAt says when. A failed read only drops
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed.
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      const more = await printLineHasMore(input.deviceId, input.nowMs).catch(() => undefined);
      return { applied: true, status: plan.patch.status, nextAttemptAt, ...(more !== undefined ? { more } : {}) };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The jobs a lease call could act on now: this device's line, less any lease still running. A running
 *  lease is being printed (often by this very tab, Session 2B's direct print), so counting it only kicked
 *  the agent into an empty lease after its ack; a lease that ran out still counts, so the lease call that
 *  expires it comes (spec §7.2). */
export function printJobsForMeFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { ...printJobLineFilter(deviceId, nowMs), $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(nowMs) } }] } as FilterQuery<IPrintJob>;
}

/** The wake's "jobs for me" (spec §7.3), and the pulse's: how many jobs wait in this device's line for a
 *  lease, and the oldest. */
export async function readJobsForDevice(deviceId: string, nowMs: number): Promise<{ count: number; oldestCreatedAt: string | null }> {
  const rows = await PrintJob.find(printJobsForMeFilter(deviceId, nowMs))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
```

In `apps/cafe/lib/print-queue.ts`, find:

```ts
    { new: true },
  );
  if (dismissed) {
    // Phase 1 (spec §10): the ordering device's readback hears it at once; the pulse is the fallback.
    publishPrintStatus({ id: input.id, status: "dismissed" });
    return { dismissed: true };
  }

```

Replace it with:

```ts
    { new: true },
  );
  if (dismissed) {
    // No print-status (the Phase 2B gate, G-1): no device listens for a final state; the pulse carries it.
    return { dismissed: true };
  }

```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-lease.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && npx eslint lib/print-lease.ts lib/print-queue.ts lib/print-lifecycle-paths.test.ts && echo LINT_OK`
Expected: `# tests 24`; `# pass 24`; `# fail 0`; `TSC_OK`; `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-lease.test.ts apps/cafe/lib/print-lease.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-queue.ts
git commit -m "feat(print): Phase 2 the ack answers more, so a burst ends with no empty lease; no final print-status is published (no device listened for one)"
```

---

### Task B4: the page: the draining tab names itself while it can print, prints a job an answer carried leased to it before any lease, at most once, and leases again only when the ack says `more` (a change of its own state is a nudge)

**Files:**
- Create: `apps/cafe/lib/print-agent-seams.ts` (the module seams, moved from `print-agent.ts`, plus `setDirectPrintSource`, `directPrintTab`, `deliverLeasedJob`, `onLeasedJob`)
- Create: `apps/cafe/lib/print-agent-slip.ts` (`PRINT_AGENT_SLIP_DEADLINE_MS`, `failedAckBody`, `printAgentSlipOf`, moved from `print-agent.ts` unchanged)
- Create: `apps/cafe/lib/print-agent-types.ts` (the agent's shapes, moved from `print-agent.ts`; `PrintAgent` gains `take`, `directReady`, `nudge`)
- Modify: `apps/cafe/lib/print-agent.ts` (`take`, `directReady`, `nudge`, the held jobs and `PRINT_DIRECT_HOLD_MS`, `more`; re-exports the three new files)
- Modify: `apps/cafe/hooks/use-print-agent.ts` (registers the direct-print source and the leased-job listener; a printer change is a nudge)
- Modify: `apps/cafe/lib/print-agent-calls.ts` (`printAgentHeaders` adds the lease header from the seam)
- Modify: `apps/cafe/hooks/use-host-routing.ts` (a leased ref or enqueue answer is delivered to the agent)
- Tests: `apps/cafe/lib/print-agent.test.ts` (ten new tests), `apps/cafe/lib/print-agent-paths.test.ts` (one new pin)

**Interfaces produced:** `PrintAgent.take(job: LeasedPrintJob): void`; `PrintAgent.directReady(): boolean`; `PrintAgent.nudge(): void`; `PRINT_DIRECT_HOLD_MS` (60 s); `setDirectPrintSource(source: () => string | null): () => void`; `directPrintTab(): string | null`; `deliverLeasedJob(job: LeasedPrintJob): void`; `onLeasedJob(listener): () => void`; `printAgentHeaders(deviceId, bill = false, leaseTab = directPrintTab())`. Every name `@/lib/print-agent` exported before is still exported from it.

**Who sends the header.** `directReady()` is true while this tab drains this device's slips (the agent's gate is open: it holds the drain lock), its printer can print now (`canPrintNow()`), and no refusal holds it. The hook registers `() => (agent.directReady() ? tabId : null)` as the seam, and `printAgentHeaders` (every order request, the kot-claim and every client-started enqueue use it) adds `x-pos-print-lease: <tabId>` from it. With a host, only the host's tab drains, so only it can ever name itself; any other device gets Phase 1.

**How a leased job prints.** `followPrintJob` (an order answer's ref) and the enqueue's answer hand a `leased` job to `deliverLeasedJob`; the agent's `take` ignores a job whose `id:epoch` it already took or whose printed ack is still pending (at-least-once delivery, an idempotent consumer), else holds it (first in, first out) and kicks. A cycle prints held jobs before it ever leases. A held job prints whenever the tab drains and the bridge is free, even if the printer went off since: its attempt was made while the printer was ready, so the bridge refuses it (`sent:"no"`, never counted) and it goes back in line, instead of expiring into a REPRINT. A tab that stops (unmount) drops what it held; those leases expire (KOT: REPRINT; bill: the cashier), the Phase 1 rule for a tab that dies.

**A held job prints only well inside its lease (the fresh review's I-1).** A job held while the tab could not print (its printer went off and the drain lock moved on) used to print whenever the gate reopened, even after its lease had run out and another writer had printed it as REPRINT: two KOTs. Each held job now carries the time it arrived, and it prints only within `PRINT_DIRECT_HOLD_MS` (the 90 s lease less 30 s: its lease began at most one request timeout, 15 s, before it arrived), so its print always starts inside its lease and no other writer can have leased it. Older ones are dropped unprinted and never acked; their lease expires into REPRINT (a bill: the cashier). A short printer flap (a Bluetooth reconnect) still prints the held KOT unlabelled. With no held job left, the cycle checks the lease gate before it leases.

**`more`.** After a printed ack (and after a failed one that took the job off the line) the agent leases again only when the answer says `more: true`, or says nothing (an older server, no answer, an ack that changed nothing). So a host's own KOT costs exactly one request (its ack), and Pay Now costs ack, lease, ack. A kick that lands while a cycle runs (the bill's ref, a realtime frame, the pulse, the wake) still leases once after it, as in Phase 1.

**A change of state is a nudge (G-2, seen on the emulator).** The bridge freeing up from the agent's own slip (`setGate`) and its printer's status changing (the hook's printer effect) used to be kicks, so they queued a lease behind every print, defeating `more`. They are `nudge()` now: they look at the line when the agent is idle, and never queue a lease behind a running cycle (that cycle's ack says whether the line holds more). Every job signal stays a kick.

**File size.** `print-agent.ts` would have grown past its ~300-line budget, so its module seams, its slip helpers and its shapes move, unchanged, to three small files it re-exports (278 lines after); no import elsewhere changes.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent-paths.test.ts`, find:

```ts
  assert.ok(agent.includes("PRINT_AGENT_SLIP_DEADLINE_MS"), "its wait on one slip is bounded");
});

test("PIN (spec §7.7): both receipts print the banner first, and every surface forwards it", () => {
  for (const file of ["apps/cafe/components/pos/KOTReceipt.tsx", "apps/cafe/components/pos/OrderReceipt.tsx"]) {
    const s = src(file);
```

Replace it with:

```ts
  assert.ok(agent.includes("PRINT_AGENT_SLIP_DEADLINE_MS"), "its wait on one slip is bounded");
});

// Phase 2 Session 2B (spec §7.11): direct print on the asking device, wired end to end on the page.
test("PIN (2B): the draining tab offers itself for direct print, every answer that carries a lease reaches its agent, and only it", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes("const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));"), "the tab id only while this agent can print now");
  assert.ok(agent.includes("const offLeased = onLeasedJob((job) => agent.take(job));"), "a leased job is printed by this page's agent");
  const seam = src("apps/cafe/hooks/use-host-routing.ts");
  assert.ok(seam.includes("if (ref.leased !== undefined) deliverLeasedJob(ref.leased);\n      else if (ref.status === \"queued\") kickPrintAgent();"), "an order answer's leased job prints with no lease request");
  assert.ok(
    seam.includes('if (result.outcome === "queued" && result.leased !== undefined) deliverLeasedJob(result.leased);\n      else if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();'),
    "an enqueue's leased job too (a re-sent slip whose first answer was lost)",
  );
  const calls = src("apps/cafe/lib/print-agent-calls.ts");
  assert.ok(calls.includes("leaseTab: string | null = directPrintTab()"), "every opt-in reads the seam: orders, rounds, settle, moves, voids, accepts, claims and enqueues");
  assert.ok(calls.includes("...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),"));
  const core = src("apps/cafe/lib/print-agent.ts");
  assert.ok(core.includes("if (held.length > 0 && enabled && !busy) return void cycle(true);"), "a held job prints before any lease, past the printer gate (its attempt was made while ready)");
  assert.ok(core.includes("if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;"), "but only well inside its lease (the fresh review, I-1)");
  assert.ok(core.includes("again = answers.get(key)?.more !== false;"), "the ack's more decides the next lease");
  assert.ok(agent.includes("useEffect(() => {\n    agent?.nudge();\n  }, [agent, printer, canPrint]);"), "a printer state change is a nudge, never a lease queued behind a print");
  assert.ok(core.includes("if (opened) nudge();"), "so is the gate opening or the bridge freeing up");
});

test("PIN (spec §7.7): both receipts print the banner first, and every surface forwards it", () => {
  for (const file of ["apps/cafe/components/pos/KOTReceipt.tsx", "apps/cafe/components/pos/OrderReceipt.tsx"]) {
    const s = src(file);
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
import { printAgentEnqueueHeaders, printAgentHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import { createHostSlipOutcomes } from "@/lib/print-host-outcomes";
import {
  ackAnswered,
  createPrintAgent,
  failedAckBody,
  printAgentSlipOf,
  readPendingAcks,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
```

Replace it with:

```ts
import { printAgentEnqueueHeaders, printAgentHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import { createHostSlipOutcomes } from "@/lib/print-host-outcomes";
import {
  PRINT_DIRECT_HOLD_MS,
  ackAnswered,
  createPrintAgent,
  deliverLeasedJob,
  directPrintTab,
  failedAckBody,
  onLeasedJob,
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  assert.deepEqual(readPendingAcks(), [], "cleared");
});

```

Replace it with:

```ts
  assert.deepEqual(readPendingAcks(), [], "cleared");
});

// ── Phase 2 Session 2B (spec §7.11, plan decisions 15, 16 and 9): direct print on the asking device ──

const done = (more: boolean): PrintAckData => ({ applied: true, status: "printed", nextAttemptAt: null, more });

test("2B: a job an answer carried leased to this tab prints at once with no lease, and its ack's more:false ends the burst", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "the gate's own look at the line");
  agent.take(job("d1"));
  await settle();
  assert.deepEqual(w.prints, ["d1"], "printed from the answer");
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.outcome]), [["d1", "printed"]]);
  assert.equal(w.leaseCalls, 1, "no lease for it, and none after it: the ack said the line is empty");
  assert.deepEqual(w.pending, [], "its ack was answered");
  agent.stop();
});

// Seen on the emulator at the 2A gate: the bridge freeing up from the agent's own slip, and its printer's
// status changing, kicked the agent while it printed, so a lease followed every more:false ack.
test("2B: its own print's state changes queue no lease after a more:false ack; a job's kick during the print still does", async () => {
  const { w, deps } = world();
  let during: "state" | "job" = "state";
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...deps,
    print: (j: LeasedPrintJob) => {
      if (during === "state") {
        agentRef?.setGate({ enabled: true, busy: true });
        agentRef?.setGate({ enabled: true, busy: false }); // the bridge prints this very slip, then frees up
        agentRef?.nudge(); // its printer's status changes while it prints
      } else agentRef?.kick(); // a new job is announced while it prints
      return deps.print(j);
    },
  });
  agentRef = agent;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  w.ackAnswers.push(done(false), done(false));
  agent.take(job("d1"));
  await settle();
  assert.deepEqual([w.prints, w.leaseCalls], [["d1"], 1], "printed, and no lease after it: only the gate's first look");
  during = "job";
  agent.take(job("d2"));
  await settle();
  assert.deepEqual([w.prints, w.leaseCalls], [["d1", "d2"], 2], "a job's kick during the print leases once after it");
  agent.nudge();
  await settle();
  assert.equal(w.leaseCalls, 3, "an idle agent nudged looks at the line");
  agent.stop();
});

test("2B: Pay Now: the KOT made leased prints first, its ack's more:true leases the bill, and the bill's more:false stops", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [{ ...job("bill"), kind: "bill" }], retryAt: null });
  w.ackAnswers.push(done(true), done(false));
  const agent = createPrintAgent(deps);
  agent.take(job("kot"));
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["kot", "bill"], "KOT before bill (§7.6)");
  assert.equal(w.leaseCalls, 1, "one lease, for the bill: order + ack + lease + ack, no empty lease after");
  agent.stop();
});

test("2B: an answer delivered twice prints once; a job printed and waiting for its ack's answer is never printed again", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  agent.take(job("d1"));
  agent.take(job("d1"));
  await settle();
  agent.take(job("d1"));
  await settle();
  assert.deepEqual(w.prints, ["d1"], "at-least-once delivery, an idempotent consumer");
  w.pending = [{ id: "d2", epoch: 1, at: T0 }];
  agent.take(job("d2"));
  await settle();
  assert.deepEqual(w.prints, ["d1"], "a job whose printed ack is still pending is already on paper");
  agent.take(job("d1", 2));
  await settle();
  assert.deepEqual(w.prints, ["d1", "d1"], "a new epoch of a job is a new lease (a REPRINT) and prints");
  agent.stop();
});

// Session 2B's fresh review (I-1): a job held while the tab could not print (its drain lock lost to a printer
// that went off) printed when the gate reopened, even after its lease had run out and another writer had
// printed it as REPRINT: two KOTs.
test("2B: a held job prints only well inside its lease; one held longer is dropped unprinted, and leases nothing past the gate", async () => {
  const late = world();
  late.w.ready = false;
  const lateAgent = createPrintAgent(late.deps);
  lateAgent.take(job("late"));
  await advance(late.w, PRINT_DIRECT_HOLD_MS);
  lateAgent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual([late.w.prints, late.w.acks.length], [[], 0], "dropped and never acked: another attempt may be on paper");
  assert.equal(late.w.leaseCalls, 0, "with nothing left to print, the lease gate decides: the printer is off, so no lease");
  late.w.ready = true;
  lateAgent.kick();
  await settle();
  assert.equal(late.w.leaseCalls, 1, "the line is leased as usual once the printer is back");
  lateAgent.stop();

  const inTime = world();
  inTime.w.ackAnswers.push(done(false));
  const agent = createPrintAgent(inTime.deps);
  agent.take(job("in-time"));
  await advance(inTime.w, PRINT_DIRECT_HOLD_MS - 1);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(inTime.w.prints, ["in-time"], "a printer back within the hold window prints it, unlabelled");
  agent.stop();
});

test("2B: taken jobs wait their turn (first in, first out) and for an open gate; stop drops them (their lease expires)", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false), done(false));
  const agent = createPrintAgent(deps);
  agent.take(job("a"));
  agent.take(job("b"));
  await settle();
  assert.deepEqual(w.prints, [], "a tab that does not drain (yet) prints nothing");
  agent.setGate({ enabled: true, busy: true });
  await settle();
  assert.deepEqual(w.prints, [], "nor while the bridge prints something else");
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["a", "b"], "in the order they came");
  assert.equal(w.leaseCalls, 0, "no lease at all");
  const second = world();
  const stopped = createPrintAgent(second.deps);
  stopped.take(job("c"));
  stopped.stop();
  stopped.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(second.w.prints, [], "a stopped agent prints nothing it held");
  agent.stop();
});

test("2B: a taken job prints even if the printer went off since: the bridge refuses it (sent:'no', never counted)", async () => {
  const { w, deps } = world();
  w.ready = false;
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  agent.take(job("d1"));
  await settle();
  assert.deepEqual(w.acks[0]?.body, { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", error: PRINTER_NOT_CONNECTED_MESSAGE }, "refused at once, never left to expire into a REPRINT");
  assert.equal(w.leaseCalls, 0, "and the line is not leased while the printer is off");
  agent.stop();
});

test("2B: a failed ack's more:false ends the burst too; with no more field (an older server) the agent leases as in Phase 1", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [{ ...job("b1"), kind: "bill" }], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "needs-confirm", nextAttemptAt: null, more: false });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "a bill that may have printed waits for the cashier; nothing else waits, so no lease");
  agent.kick();
  await settle();
  assert.deepEqual(w.prints, ["b1", "j2"]);
  assert.equal(w.leaseCalls, 3, "the default answer has no more field: lease again, then find the line empty");
  agent.stop();
});

test("2B: directReady is true only while this tab drains, its printer can print, and no refusal holds it", async () => {
  const { w, deps } = world();
  const agent = createPrintAgent(deps);
  assert.equal(agent.directReady(), false, "not draining yet");
  agent.setGate({ enabled: true, busy: true });
  assert.equal(agent.directReady(), true, "a busy bridge only delays the print: the job waits its turn");
  w.ready = false;
  assert.equal(agent.directReady(), false, "a printer that can not print now");
  w.ready = true;
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(agent.directReady(), false, "a refusal holds it, like a lease");
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.equal(agent.directReady(), true, "until the recheck window has passed");
  agent.stop();
  assert.equal(agent.directReady(), false, "a stopped agent");
});

test("2B: the seams: the lease header names the draining tab only while its agent says so; a leased job reaches the agent that listens", () => {
  assert.deepEqual(printAgentHeaders("dev-a", false, "tab-1"), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-lease": "tab-1" });
  assert.deepEqual(printAgentHeaders("dev-a", true, null), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-bill": "1" });
  assert.equal(directPrintTab(), null, "no agent registered: no header");
  let ready = true;
  const off = setDirectPrintSource(() => (ready ? "tab-1" : null));
  assert.equal(printAgentHeaders("dev-a")["x-pos-print-lease"], "tab-1", "the default reads the seam");
  ready = false;
  assert.equal(printAgentHeaders("dev-a")["x-pos-print-lease"], undefined, "not ready: no header");
  const offNewer = setDirectPrintSource(() => "tab-2");
  off();
  assert.equal(directPrintTab(), "tab-2", "an old agent's unregister leaves the newer agent's source in place");
  offNewer();
  assert.equal(directPrintTab(), null, "unregistered");
  const offThrowing = setDirectPrintSource(() => {
    throw new Error("boom");
  });
  assert.equal(directPrintTab(), null, "a throwing source is no tab, never a thrown order request");
  offThrowing();
  const got: string[] = [];
  const offLeased = onLeasedJob((j) => got.push(j.id));
  deliverLeasedJob(job("d9"));
  offLeased();
  deliverLeasedJob(job("d10"));
  assert.deepEqual(got, ["d9"], "delivered to the agent that listens, never after it stopped listening");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts lib/print-agent-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 43`; `# pass 32`; `# fail 11`

- [ ] **Step 3: The code**

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
} from "@/lib/print-routing";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { readDeviceId } from "@/lib/pos-device-id";
import { kickPrintAgent } from "@/lib/print-agent";
import { printAgentEnqueueHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import type { Order } from "@/types";

```

Replace it with:

```ts
} from "@/lib/print-routing";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { readDeviceId } from "@/lib/pos-device-id";
import { deliverLeasedJob, kickPrintAgent } from "@/lib/print-agent";
import { printAgentEnqueueHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import type { Order } from "@/types";

```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
      if (result.outcome === "queued" || result.outcome === "already-resolved") {
        recordReadback(printReadbackRecordOf(result.id, job.payload));
      }
      // Session 1C: a queued job is this device's own line (no host), or this host's: lease it now.
      if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();
      // PH-5 (OPS-7): a job the HOST itself queued should drain on the next
      // microtask, not the next 20s tick — refetch the pulse so the drain's
      // feed sees it now. A handler-time pref read (never during render); a
```

Replace it with:

```ts
      if (result.outcome === "queued" || result.outcome === "already-resolved") {
        recordReadback(printReadbackRecordOf(result.id, job.payload));
      }
      // Session 2B (spec §7.11): a job leased to this tab (made so now, or handed back after a lost
      // answer) prints here at once. Session 1C: any other queued job is this device's own line (no host),
      // or this host's: lease it now.
      if (result.outcome === "queued" && result.leased !== undefined) deliverLeasedJob(result.leased);
      else if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();
      // PH-5 (OPS-7): a job the HOST itself queued should drain on the next
      // microtask, not the next 20s tick — refetch the pulse so the drain's
      // feed sees it now. A handler-time pref read (never during render); a
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts

  // Session 1C: the order's own answer already made this slip a job (spec §7.4): follow it for the
  // readback and, unless it is already resolved (M-d), wake the agent. No request at all.
  const followPrintJob = useCallback(
    (ref: PrintJobRef, buildJob: () => PrintJobRequest) => {
      try {
```

Replace it with:

```ts

  // Session 1C: the order's own answer already made this slip a job (spec §7.4): follow it for the
  // readback and, unless it is already resolved (M-d), wake the agent. No request at all.
  // Session 2B (spec §7.11): a job the answer made leased to this tab is handed to the agent, which prints
  // it now: no lease request either.
  const followPrintJob = useCallback(
    (ref: PrintJobRef, buildJob: () => PrintJobRequest) => {
      try {
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
      } catch {
        // A builder throw changes nothing: the job exists and prints; only its chip is missing.
      }
      if (ref.status === "queued") kickPrintAgent();
    },
    [recordReadback],
  );
```

Replace it with:

```ts
      } catch {
        // A builder throw changes nothing: the job exists and prints; only its chip is missing.
      }
      if (ref.leased !== undefined) deliverLeasedJob(ref.leased);
      else if (ref.status === "queued") kickPrintAgent();
    },
    [recordReadback],
  );
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
  onPrintAgentKick,
  printAgentSlipOf,
  readPendingAcks,
  setPulsePrintDevice,
  writePendingAcks,
  type PrintAgent,
```

Replace it with:

```ts
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
  onLeasedJob,
  onPrintAgentKick,
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  writePendingAcks,
  type PrintAgent,
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
    agent?.setGate({ enabled, busy });
  }, [agent, enabled, busy]);

  // The printer reconnected or changed: look at the line (the gate decides).
  useEffect(() => {
    agent?.kick();
  }, [agent, printer, canPrint]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  useEffect(() => {
    if (agent === null || !enabled) return;
```

Replace it with:

```ts
    agent?.setGate({ enabled, busy });
  }, [agent, enabled, busy]);

  // The printer reconnected or changed: look at the line (the gate decides). Session 2B: a nudge, so the
  // printer's own status changes during the agent's print never queue an empty lease after it.
  useEffect(() => {
    agent?.nudge();
  }, [agent, printer, canPrint]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
  // that make slips name it (directPrintTab → x-pos-print-lease), and a job an answer carries already leased
  // to it is printed here at once: no lease request, no realtime message.
  useEffect(() => {
    if (agent === null) return;
    const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));
    const offLeased = onLeasedJob((job) => agent.take(job));
    return () => {
      offSource();
      offLeased();
    };
  }, [agent, tabId]);

  useEffect(() => {
    if (agent === null || !enabled) return;
```

In `apps/cafe/lib/print-agent-calls.ts`, find:

```ts
  PRINT_HEADER_ON,
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 1 Session 1C (spec §7.4, §9.1; rulings R1 and M-d): the call sites' half of
```

Replace it with:

```ts
  PRINT_HEADER_ON,
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  PRINT_LEASE_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
import { directPrintTab } from "@/lib/print-agent-seams";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 1 Session 1C (spec §7.4, §9.1; rulings R1 and M-d): the call sites' half of
```

In `apps/cafe/lib/print-agent-calls.ts`, find:

```ts
// failed create) is enqueued by the call site under today's job key, so it is still one job.

/** R1's opt-in. {} for a device with no identity: the server then prints nothing for this request,
 *  and the call site prints exactly as before Phase 1. */
export function printAgentHeaders(deviceId: string, bill = false): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
  };
}

```

Replace it with:

```ts
// failed create) is enqueued by the call site under today's job key, so it is still one job.

/** R1's opt-in. {} for a device with no identity: the server then prints nothing for this request,
 *  and the call site prints exactly as before Phase 1. Session 2B (spec §7.11): `leaseTab`, this tab while
 *  it drains this device's slips and can print now, lets a slip this device prints be made leased to it. */
export function printAgentHeaders(deviceId: string, bill = false, leaseTab: string | null = directPrintTab()): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
    ...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),
  };
}

```

Create `apps/cafe/lib/print-agent-seams.ts`:

```ts
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";

// Printing redesign: the in-page print agent's module seams (client-only, never throw). The call sites and the
// pulse reach this page's one agent through them, with no React context: an order answer that named a job (a
// kick), the agent naming itself on the pulse, and since Phase 2 Session 2B (spec §7.11) the tab that can print
// its own slips at once and the leased jobs its answers carry. Split out of print-agent.ts at the 2A review gate
// to keep that file near its ~300-line budget; print-agent.ts re-exports every name.

const kickListeners = new Set<() => void>();

/** An order answer named a job this device prints: lease it now, no poll (spec §9.1). */
export function kickPrintAgent(): void {
  for (const listener of [...kickListeners]) listener();
}

export function onPrintAgentKick(listener: () => void): () => void {
  kickListeners.add(listener);
  return () => void kickListeners.delete(listener);
}

let pulseDevice: string | null = null;

/** The agent with no host names itself on the existing 20 s pulse (?device=), so a job the server
 *  re-queued or sent home reaches it within one tick even with the socket down. Not the host: it polls
 *  the wake, which answers the same. */
export function setPulsePrintDevice(deviceId: string | null): void {
  pulseDevice = deviceId;
}

export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}`;
}

let directSource: (() => string | null) | null = null;

/** Session 2B: the agent of the tab that drains this device's slips registers how it answers directPrintTab().
 *  The returned function unregisters it, unless another agent registered since. */
export function setDirectPrintSource(source: () => string | null): () => void {
  directSource = source;
  return () => {
    if (directSource === source) directSource = null;
  };
}

/** This tab's id while it drains this device's slips and its printer can print right now; null otherwise.
 *  The requests that make slips then name it (PRINT_LEASE_HEADER), so a slip this device prints can be made
 *  already leased to this tab (spec §7.11). */
export function directPrintTab(): string | null {
  try {
    return directSource?.() ?? null;
  } catch {
    return null;
  }
}

const leasedListeners = new Set<(job: LeasedPrintJob) => void>();

/** An answer carried a job already leased to this tab (Session 2B): the agent prints it now, with no lease
 *  request. With no agent listening it is dropped, and its lease expires (KOT: REPRINT; bill: the cashier). */
export function deliverLeasedJob(job: LeasedPrintJob): void {
  for (const listener of [...leasedListeners]) listener(job);
}

export function onLeasedJob(listener: (job: LeasedPrintJob) => void): () => void {
  leasedListeners.add(listener);
  return () => void leasedListeners.delete(listener);
}
```

Create `apps/cafe/lib/print-agent-slip.ts`:

```ts
import { PRINT_ACK_ERROR_MAX_CHARS, printBannerText } from "@pos/shared/print-lifecycle";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_EOD_READY_TIMEOUT_MS, hostPrintSlipOf, type HostPrintSlip } from "@/lib/print-host-slips";
import type { PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §7.5, §7.7): what the in-page agent prints for one leased job,
// and what it reports when that fails. Split out of print-agent.ts at the 2A review gate to keep that file
// near its ~300-line budget; print-agent.ts re-exports every name.

/** How long the agent waits for the bridge to settle one slip: past the bridge's own bounds (the end-of-day
 *  figures' wait, then the dispatch watchdog), so only a slip the watchdog gave up on reaches it. Such a
 *  slip may have printed, so it is acked "maybe". */
export const PRINT_AGENT_SLIP_DEADLINE_MS = PRINT_HOST_EOD_READY_TIMEOUT_MS + PRINT_HOST_DISPATCH_TIMEOUT_MS + 5_000;

export function failedAckBody(deviceId: string, epoch: number, outcome: PrintWriteOutcome): PrintAgentAckBody {
  const error = outcome.message.trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS).trim();
  return {
    deviceId,
    epoch,
    outcome: "failed",
    sent: outcome.sent,
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}

/** The slip the host bridge prints for one leased job: today's renderer props (print-host-slips.ts),
 *  plus the job's labels as the one banner on top (spec §7.7). An end-of-day summary takes none. */
export function printAgentSlipOf(job: LeasedPrintJob, todayKey: string): HostPrintSlip {
  const slip = hostPrintSlipOf(job.payload, todayKey);
  const banner = printBannerText(job.labels);
  return banner === "" || slip.surface === "eod" ? slip : { ...slip, banner };
}
```

Create `apps/cafe/lib/print-agent-types.ts`:

```ts
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's shapes. Split out of
// print-agent.ts in Session 2B to keep that file near its ~300-line budget; print-agent.ts re-exports them.

export type PrintAgentResult = { ok: true } | { ok: false; error: unknown };

export interface PrintAgentAckBody {
  deviceId: string;
  epoch: number;
  outcome: "printed" | "failed";
  sent?: "no" | "maybe";
  permanent?: true;
  error?: string;
}

export interface PendingPrintAck {
  id: string;
  epoch: number;
  at: number;
  /** A failed ack that got no answer (M4); absent: a "printed" ack. */
  fail?: PrintAgentAckBody;
}

export interface PrintAgentDeps {
  deviceId: string;
  lease(): Promise<PrintLeaseData>;
  ack(id: string, body: PrintAgentAckBody): Promise<PrintAckData>;
  /** Prints one leased job through the host bridge. Never rejects. */
  print(job: LeasedPrintJob): Promise<PrintAgentResult>;
  /** canPrintNow(): a printer here that can print right now. */
  printerReady(): boolean;
  /** Any value whose identity changes when this device's printer changes (its snapshot). */
  printerState(): unknown;
  readPending(): PendingPrintAck[];
  writePending(entries: PendingPrintAck[]): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface PrintAgent {
  setGate(gate: { enabled: boolean; busy: boolean }): void;
  /** A job may wait for this device (an answer, a frame, the pulse, the wake, a timer): lease now, or once
   *  the running cycle ends. */
  kick(): void;
  /** Session 2B: this device's state changed (its printer): lease now if idle, never queued behind a cycle. */
  nudge(): void;
  flushAcks(): Promise<void>;
  stop(): void;
  /** Session 2B: a job already leased to this tab (an answer carried it). Printed before any lease. */
  take(job: LeasedPrintJob): void;
  /** Session 2B: this tab drains, its printer can print now and no refusal holds it, so its requests may
   *  ask for their slips leased to it (directPrintTab). */
  directReady(): boolean;
}
```

Replace the whole of `apps/cafe/lib/print-agent.ts` with:

```ts
import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS, PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
  printAgentTimerDelayMs,
  type LeasedPrintJob,
  type PrintAckData,
} from "@pos/shared/print-agent-wire";
import { ackAnswered } from "@/lib/print-ack-store";
import { failedAckBody } from "@/lib/print-agent-slip";
import type { PendingPrintAck, PrintAgent, PrintAgentDeps } from "@/lib/print-agent-types";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
// no globals except the pending-ack store, so every rule below is unit-tested with fakes
// (lib/print-agent.test.ts). hooks/use-print-agent.ts wires it to the page.
//
// One cycle at a time: lease the head of this device's line → print it through the host bridge → ack.
// It never leases while the printer can not print here (the owner's rule: no automatic attempts while
// a printer is off), and after a refusal (sent:"no") it waits for the printer's state to change, or
// PRINT_AGENT_REFUSED_RECHECK_MS. Its only timer is local, set from the server's retryAt/nextAttemptAt.
// A "printed" ack that got no answer is kept in localStorage and re-sent every 5 s for 10 min, and
// cleared on ANY answer from the server (spec §7.9; 1A review M3).
//
// Phase 2 Session 2B (spec §7.11): a job an answer carried already leased to this tab is taken (take) and
// printed before any lease, first in first out; a job it already holds or acked is ignored, so an answer
// delivered twice prints once. After a job leaves the line, the ack's `more` decides whether to lease again.

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

/** Session 2B (its fresh review, I-1): a job an answer carried leased to this tab prints only this long after
 *  it arrived. Its 90 s lease began at most one request timeout (15 s) earlier, so the print stays inside the
 *  lease with a margin. Later the lease may have run out and another attempt (a REPRINT) be on paper, so the
 *  held job is dropped unprinted. */
export const PRINT_DIRECT_HOLD_MS = PRINT_LEASE_MS - 30_000;

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
  let busy = false;
  let running = false;
  let kickedWhileRunning = false;
  let stopped = false;
  let refused: { state: unknown; at: number } | null = null;
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;
  const slipRefusals = new Map<string, number>();
  // Session 2B: jobs already leased to this tab, waiting their turn; every (id:epoch) taken; each ack's answer.
  const held: Array<{ job: LeasedPrintJob; at: number }> = [];
  const taken = new Set<string>();
  const answers = new Map<string, PrintAckData>();

  /** A bounded insert: the oldest key goes once the store holds as many as the pending-ack store. */
  function remember<T>(store: Set<string> | Map<string, T>, key: string, value?: T): void {
    if (store instanceof Map) store.set(key, value as T);
    else store.add(key);
    if (store.size > PRINT_ACK_PENDING_LIMIT) store.delete(store.keys().next().value as string);
  }

  /** The oldest held job still well inside its lease; one held longer is dropped unprinted (I-1). */
  function nextHeld(): LeasedPrintJob | undefined {
    for (let next = held.shift(); next !== undefined; next = held.shift()) {
      if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;
    }
    return undefined;
  }

  function refusalHolds(): boolean {
    if (refused === null) return false;
    if (deps.printerState() !== refused.state || deps.now() - refused.at >= PRINT_AGENT_REFUSED_RECHECK_MS) {
      refused = null;
      return false;
    }
    return true;
  }

  function wakeAt(atMs: number): void {
    if (stopped) return;
    const delay = printAgentTimerDelayMs(atMs, deps.now());
    const at = deps.now() + delay;
    if (timer !== null && timerAt <= at) return;
    if (timer !== null) deps.clearTimer(timer);
    timerAt = at;
    timer = deps.setTimer(() => {
      timer = null;
      timerAt = Number.POSITIVE_INFINITY;
      kick();
    }, delay);
  }

  function keep(entry: PendingPrintAck): void {
    deps.writePending([...deps.readPending().filter((e) => e.id !== entry.id), entry].slice(-PRINT_ACK_PENDING_LIMIT));
  }

  function forget(entry: PendingPrintAck): void {
    deps.writePending(deps.readPending().filter((e) => !(e.id === entry.id && e.epoch === entry.epoch)));
  }

  function scheduleAckRetry(): void {
    if (stopped || ackTimer !== null || deps.readPending().length === 0) return;
    ackTimer = deps.setTimer(() => {
      ackTimer = null;
      void flushAcks();
    }, PRINT_ACK_RETRY_MS);
  }

  async function sendPending(): Promise<void> {
    // Re-read after each send, so an ack kept while this flush was on the wire goes out with it too.
    const tried = new Set<string>();
    for (;;) {
      const entry = deps.readPending().find((e) => !tried.has(`${e.id}:${e.epoch}`));
      if (entry === undefined) return;
      tried.add(`${entry.id}:${entry.epoch}`);
      if (deps.now() - entry.at > PRINT_ACK_PENDING_MAX_MS) {
        forget(entry);
        continue;
      }
      try {
        remember(answers, `${entry.id}:${entry.epoch}`, await deps.ack(entry.id, entry.fail ?? { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" }));
        forget(entry);
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
      }
    }
  }

  function flushAcks(): Promise<void> {
    // One flush at a time. The reset is chained AFTER the assignment: with nothing pending, an async
    // body would finish before `flushing` was even set, and every later flush would return that stale,
    // resolved promise without sending its ack.
    if (flushing === null) {
      flushing = sendPending().finally(() => {
        flushing = null;
        scheduleAckRetry();
      });
    }
    return flushing;
  }

  async function cycle(forHeld = false): Promise<void> {
    running = true;
    kickedWhileRunning = false;
    let again = false;
    try {
      // An ack the last page (or a dropped answer) left goes first: a lease could expire our own job (M6).
      // A stop() that landed meanwhile leases nothing (the 1D gate M-4).
      await flushAcks();
      if (stopped) return;
      // Session 2B: a job already leased to this tab goes first; only then is the line leased.
      let job = nextHeld();
      if (job === undefined) {
        // Only a held job prints past the lease gate; with none left (I-1), the gate decides as always.
        if (forHeld && !printAgentMayLease({ enabled, busy, running: false, printerReady: deps.printerReady(), refusalHolds: refusalHolds() })) return;
        const data = await deps.lease();
        job = data.jobs[0];
        if (job === undefined) {
          if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
          return;
        }
      }
      const result = await deps.print(job);
      if (result.ok) {
        // A printed slip's refusal count is done with (1D gate M-3). A failed one keeps it, so a staff
        // Retry stays one tap, one try.
        slipRefusals.delete(job.id);
        // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so
        // the next lease does not find this job still leased at the head of the line.
        keep({ id: job.id, epoch: job.epoch, at: deps.now() });
        await flushAcks();
        // Session 2B (decision 9): lease again only when the ack says the line holds more. No answer, or
        // an older server that does not say: lease again, as in Phase 1.
        const key = `${job.id}:${job.epoch}`;
        again = answers.get(key)?.more !== false;
        answers.delete(key);
        return;
      }
      let outcome = printWriteOutcomeOf(result.error);
      if (isSlipRefusal(outcome) && deps.printerReady()) {
        // The slip itself was refused (owner, 1C gate I3): its second refusal fails the job, freeing the line.
        const count = (slipRefusals.get(job.id) ?? 0) + 1;
        slipRefusals.set(job.id, count);
        if (count >= PRINT_SLIP_REFUSALS_MAX) outcome = { ...outcome, permanent: true };
      } else if (outcome.sent === "no" && !outcome.permanent) {
        // Nothing reached the printer: it is off or unreachable. No automatic attempt until it changes.
        refused = { state: deps.printerState(), at: deps.now() };
      }
      const body = failedAckBody(deps.deviceId, job.epoch, outcome);
      const answer = await deps.ack(job.id, body).catch((error: unknown) => {
        // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
        if (!ackAnswered(error)) keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
        return null;
      });
      if (answer === null) {
        scheduleAckRetry();
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line holds the line until its own nextAttemptAt (the timer leases it then), so a
      // kick that landed meanwhile (the bridge freeing up from this very slip) would only find it not due.
      if (answer.nextAttemptAt !== null) {
        kickedWhileRunning = false;
        wakeAt(Date.parse(answer.nextAttemptAt));
      } else again = refused === null && answer.more !== false;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } finally {
      running = false;
      if (again || kickedWhileRunning || held.length > 0) kick();
    }
  }

  function kick(): void {
    if (stopped) return;
    // Remembered, not dropped: the running cycle's lease may have read the line before this job was in it.
    if (running) return void (kickedWhileRunning = true);
    // Session 2B: a job already leased to this tab prints now, whatever the lease gate says. Its attempt was
    // made while the printer was ready, so a printer that went off since refuses it (sent:"no", never
    // counted) instead of leaving it to expire into a REPRINT.
    if (held.length > 0 && enabled && !busy) return void cycle(true);
    const holds = refusalHolds();
    if (!printAgentMayLease({ enabled, busy, running, printerReady: deps.printerReady(), refusalHolds: holds })) {
      if (holds && refused !== null) wakeAt(refused.at + PRINT_AGENT_REFUSED_RECHECK_MS);
      return;
    }
    void cycle();
  }

  /** Session 2B (seen on the emulator at the 2A gate): a change of state (the gate, the bridge freeing up, the
   *  printer's status) looks at the line when idle, but is no reason to lease after a running cycle: its own
   *  print causes them, and its ack's `more` already says whether the line holds more. */
  function nudge(): void {
    if (!running) kick();
  }

  return {
    setGate(gate) {
      const opened = (gate.enabled && !enabled) || (!gate.busy && busy);
      enabled = gate.enabled;
      busy = gate.busy;
      if (opened) nudge();
    },
    kick,
    nudge,
    flushAcks,
    stop() {
      stopped = true;
      // A job still held is dropped: its lease expires (KOT: REPRINT; bill: the cashier), as for a tab that died.
      held.length = 0;
      if (timer !== null) deps.clearTimer(timer);
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      timer = null;
      ackTimer = null;
    },
    take(job) {
      if (stopped || typeof job.id !== "string" || !Number.isInteger(job.epoch)) return;
      const key = `${job.id}:${job.epoch}`;
      // At-least-once delivery, an idempotent consumer: a job already taken, or printed and waiting for its
      // ack's answer, is never printed again.
      if (taken.has(key) || deps.readPending().some((e) => e.id === job.id && e.epoch === job.epoch)) return;
      remember(taken, key);
      held.push({ job, at: deps.now() });
      kick();
    },
    directReady() {
      return enabled && !stopped && deps.printerReady() && !refusalHolds();
    },
  };
}

// ── Split out, re-exported: the shapes, the module seams, the slip and failure helpers, the pending-ack store ──

export type { PendingPrintAck, PrintAgent, PrintAgentAckBody, PrintAgentDeps, PrintAgentResult } from "@/lib/print-agent-types";
export * from "@/lib/print-agent-seams";
export { PRINT_AGENT_SLIP_DEADLINE_MS, failedAckBody, printAgentSlipOf } from "@/lib/print-agent-slip";
export { ackAnswered, readPendingAcks, writePendingAcks } from "@/lib/print-ack-store";
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts lib/print-agent-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 43`; `# pass 43`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-agent.ts lib/print-agent-seams.ts lib/print-agent-slip.ts lib/print-agent-calls.ts hooks/use-print-agent.ts hooks/use-host-routing.ts lib/print-agent.test.ts lib/print-agent-paths.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/hooks/use-host-routing.ts apps/cafe/hooks/use-print-agent.ts apps/cafe/lib/print-agent-calls.ts apps/cafe/lib/print-agent-paths.test.ts apps/cafe/lib/print-agent-seams.ts apps/cafe/lib/print-agent-slip.ts apps/cafe/lib/print-agent-types.ts apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts
git commit -m "feat(print): Phase 2 direct print on the page: the draining tab names itself while it can print, prints a job an answer carried leased to it before any lease, at most once, and leases again only when the ack says more"
```

---

### Task B5: the budget recount: one request and no realtime per slip the asking device prints; no final print-status; no empty lease

**Files:**
- Modify: `packages/shared/src/print-budget.ts` (`PRINT_REALTIME_PER_SLIP` 3 → 2 and `PRINT_REALTIME_PER_PRINTER_SLIP` 2 → 1 for G-1; `PRINT_REQUESTS_PER_DIRECT_SLIP`, `PRINT_REALTIME_PER_DIRECT_SLIP`, `printOneDeviceRequestsPerDay`; `printRequestsForSlips` takes the day's retry share)
- Test: `packages/shared/src/print-budget.test.ts` (two pins changed deliberately for G-1, three new tests)

**Interfaces produced:** `PRINT_REQUESTS_PER_DIRECT_SLIP = 1`; `PRINT_REALTIME_PER_DIRECT_SLIP = 0`; `printOneDeviceRequestsPerDay(): number` (1,200); `printRequestsForSlips(slips, retryShare = PRINT_BUDGET_BUSY_DAY.retryShare)`.

**The numbers (spec §17.2).** A slip the asking device prints itself: 1 request (its ack), 0 Worker requests. A slip another device prints: a lease and an ack, and 2 Worker requests (its `queued` print-status and the host's nudge; was 3 with the final state). Printers mode: at most 1 Worker request per slip (was 2). Pay Now on one printer: 3 requests (Phase 1: 5 with its trailing empty lease). Phase 1's busy day of 750 slips: 1,650 requests (was 2,400 with a trailing lease per burst). A cafe whose one device takes and prints its orders: 1,200 requests at worst (every bill riding with its KOT), 1,920 with the host's wake on a healthy socket, and no Worker request for printing at all.

**The 2A gate's new minor:** `printSlipRequestsPerDay(day)` forwarded only `day.slips`, so a day's own `retryShare` was ignored; it is passed through now (no number changes).

- [ ] **Step 1: The failing tests first**

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  REALTIME_FREE_REQUESTS_PER_DAY,
  PRINT_BUDGET_STATIONS_DAY,
  PRINT_REALTIME_PER_PRINTER_SLIP,
  printRequestsForSlips,
  printSlipRequestsPerDay,
  printStationSlipsPerDay,
```

Replace it with:

```ts
  REALTIME_FREE_REQUESTS_PER_DAY,
  PRINT_BUDGET_STATIONS_DAY,
  PRINT_REALTIME_PER_PRINTER_SLIP,
  PRINT_REALTIME_PER_DIRECT_SLIP,
  PRINT_REQUESTS_PER_DIRECT_SLIP,
  PRINT_REQUESTS_PER_SLIP,
  printOneDeviceRequestsPerDay,
  printRequestsForSlips,
  printSlipRequestsPerDay,
  printStationSlipsPerDay,
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(printSlipRequestsPerDay() <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "inside the normal-day ceiling");
});

test("realtime: three Worker requests per slip stay under 5 % of the free 100,000 a day", () => {
  const perDay = PRINT_BUDGET_BUSY_DAY.slips * PRINT_REALTIME_PER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(perDay, 3_935);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

```

Replace it with:

```ts
  assert.ok(printSlipRequestsPerDay() <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "inside the normal-day ceiling");
});

// The Phase 2B gate (G-1) deliberately changed this pin: a slip's final state is no longer published (no
// device listened for it), so a slip another device prints costs 2 Worker requests, not 3 (was 3,935/day).
test("realtime: two Worker requests per slip another device prints stay under 5 % of the free 100,000 a day", () => {
  const perDay = PRINT_BUDGET_BUSY_DAY.slips * PRINT_REALTIME_PER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(PRINT_REALTIME_PER_SLIP, 2, "its queued print-status and the host's nudge");
  assert.equal(perDay, 2_735);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(PRINT_WAKE_PRINTERS_DAILY_CAP <= PRINT_WAKE_DAILY_CAP, "printers mode never polls more than a host did");
});

test("Phase 2 realtime: two Worker requests per slip in printers mode, the heavy day under 5 %", () => {
  const perDay = printStationSlipsPerDay({ fullCopy: true }) * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(perDay, 3_635);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

```

Replace it with:

```ts
  assert.ok(PRINT_WAKE_PRINTERS_DAILY_CAP <= PRINT_WAKE_DAILY_CAP, "printers mode never polls more than a host did");
});

// The Phase 2B gate (G-1) deliberately changed this pin: no final state, so one Worker request per slip in
// printers mode, at most (a slip its writer asked for publishes none; was 2 per slip, 3,635/day).
test("Phase 2 realtime: at most one Worker request per slip in printers mode, the heavy day under 5 %", () => {
  const perDay = printStationSlipsPerDay({ fullCopy: true }) * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(PRINT_REALTIME_PER_PRINTER_SLIP, 1, "its queued print-status aimed at its writer");
  assert.equal(perDay, 1_985);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

// Phase 2 Session 2B (spec §7.11, plan decisions 15, 16 and 9; the owner's ask of 2026-10-04): a slip the
// asking device prints itself, with the fewest requests and no realtime message.
test("2B: a slip the asking device prints itself costs one request (its ack) and no realtime request; another device's slip keeps a lease and an ack", () => {
  assert.equal(PRINT_REQUESTS_PER_DIRECT_SLIP, 1, "made leased with the order request: only its ack");
  assert.equal(PRINT_REALTIME_PER_DIRECT_SLIP, 0, "nothing is published to the device printing it");
  assert.equal(PRINT_REQUESTS_PER_SLIP, 2, "a slip another device prints: one lease and one ack");
  assert.equal(PRINT_REALTIME_PER_SLIP, 2, "its queued print-status and the host's nudge");
  const payNow = PRINT_REQUESTS_PER_DIRECT_SLIP + PRINT_REQUESTS_PER_SLIP;
  assert.equal(payNow, 3, "Pay Now on one printer: the KOT's ack, then the bill's lease and ack (Phase 1: 5, with its empty lease)");
});

test("2B: the ack's more ends a burst with no empty lease: Phase 1's busy day (2,400 with a trailing lease) costs 1,650", () => {
  const slips = PRINT_BUDGET_BUSY_DAY.orders * (PRINT_BUDGET_STATIONS_DAY.roundsPerOrder + PRINT_BUDGET_STATIONS_DAY.billsPerOrder);
  assert.equal(printRequestsForSlips(slips), 1_650, "a lease and an ack per slip, plus the retried share, nothing more");
});

test("2B: the busy day of a cafe whose one device takes and prints its orders: 1,200 requests and no realtime request for printing", () => {
  const requests = printOneDeviceRequestsPerDay();
  assert.equal(requests, 1_200, "every round's KOT made leased; every bill behind its KOT (Pay Now), the worst case");
  assert.ok(requests < printRequestsForSlips(750), "less than the same day's slips leased one by one (1,650)");
  const wakePerHost = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  assert.equal(requests + wakePerHost, 1_920, "the device as the host also polls the wake on a healthy socket");
  assert.ok(requests + wakePerHost <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "well inside the normal-day ceiling");
  const realtime = 750 * PRINT_REALTIME_PER_DIRECT_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(realtime, PRINT_REALTIME_BASE_PER_DAY, "printing adds no Worker request at all");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `packages/shared/src/print-budget.ts`, find:

```ts
export const PRINT_BUDGET_WORST_MAX_PER_DAY = 18_000;
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;
/** Realtime Worker requests one slip costs (spec §17.2): its "queued" print-status, its final
 *  print-status, and in host mode the print-job nudge a host from before Phase 1 drains on. */
export const PRINT_REALTIME_PER_SLIP = 3;
/** Today's realtime traffic without printing (spec §17.2). */
export const PRINT_REALTIME_BASE_PER_DAY = 335;
/** Cloudflare Workers Free (spec §17.1); printing may use at most 5 % of it. */
```

Replace it with:

```ts
export const PRINT_BUDGET_WORST_MAX_PER_DAY = 18_000;
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;
/** Realtime Worker requests one slip another device prints costs (spec §17.2): its "queued" print-status
 *  aimed at that device, and in host mode the print-job nudge a host from before Phase 1 drains on. Its
 *  final state is not published (the Phase 2B gate, G-1: no device listened for it; it was 3). */
export const PRINT_REALTIME_PER_SLIP = 2;
/** Today's realtime traffic without printing (spec §17.2). */
export const PRINT_REALTIME_BASE_PER_DAY = 335;
/** Cloudflare Workers Free (spec §17.1); printing may use at most 5 % of it. */
```

In `packages/shared/src/print-budget.ts`, find:

```ts

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return printRequestsForSlips(day.slips);
}

/** A lease and an ack per slip, plus the retried share, for any number of slips a day. */
export function printRequestsForSlips(slips: number): number {
  return Math.round(slips * PRINT_REQUESTS_PER_SLIP * (1 + PRINT_BUDGET_BUSY_DAY.retryShare));
}

/** Phase 2, the recount the 1C gate asked for (spec §8, §17.2): the busy day with stations. Each KOT round
```

Replace it with:

```ts

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return printRequestsForSlips(day.slips, day.retryShare);
}

/** A lease and an ack per slip, plus the retried share, for any number of slips a day. */
export function printRequestsForSlips(slips: number, retryShare: number = PRINT_BUDGET_BUSY_DAY.retryShare): number {
  return Math.round(slips * PRINT_REQUESTS_PER_SLIP * (1 + retryShare));
}

/** Phase 2 Session 2B (spec §7.11, plan decisions 15, 16 and 9): a slip the asking device prints itself is
 *  made leased to its tab, so its one request is its ack, and nothing is published for it. A slip made with
 *  it on the same line (Pay Now's bill) follows through the ack's `more`: one lease and one ack. */
export const PRINT_REQUESTS_PER_DIRECT_SLIP = 1;
export const PRINT_REALTIME_PER_DIRECT_SLIP = 0;

/** The busy day (spec §17.2's 300 orders) of a cafe whose one device takes and prints every order, at its
 *  worst: every bill rides with its KOT (Pay Now), so each bill costs a lease and an ack; every other KOT
 *  round is made leased. A retried slip costs a lease and an ack. The ack's `more` leaves no empty lease. */
export function printOneDeviceRequestsPerDay(): number {
  const d = PRINT_BUDGET_STATIONS_DAY;
  const orders = PRINT_BUDGET_BUSY_DAY.orders;
  const slips = orders * (d.roundsPerOrder + d.billsPerOrder);
  const firstTries = orders * (d.roundsPerOrder * PRINT_REQUESTS_PER_DIRECT_SLIP + d.billsPerOrder * PRINT_REQUESTS_PER_SLIP);
  return Math.round(firstTries + slips * PRINT_BUDGET_BUSY_DAY.retryShare * PRINT_REQUESTS_PER_SLIP);
}

/** Phase 2, the recount the 1C gate asked for (spec §8, §17.2): the busy day with stations. Each KOT round
```

In `packages/shared/src/print-budget.ts`, find:

```ts
  return Math.round(PRINT_BUDGET_BUSY_DAY.orders * (d.roundsPerOrder * perRound + d.billsPerOrder));
}

/** Printers mode publishes 2 realtime requests per slip: its "queued" print-status aimed at its writer, and
 *  its final state. No print-job nudge: that is for a host, and printers mode has none. */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 2;

```

Replace it with:

```ts
  return Math.round(PRINT_BUDGET_BUSY_DAY.orders * (d.roundsPerOrder * perRound + d.billsPerOrder));
}

/** Printers mode publishes 1 realtime request per slip its writer did not ask for: its "queued" print-status
 *  aimed at that writer. No final state (the Phase 2B gate, G-1; it was 2), and no print-job nudge: that is
 *  for a host, and printers mode has none. A slip its writer asked for publishes nothing (Session 2B). */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 1;

```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 26`; `# pass 26`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-budget.test.ts packages/shared/src/print-budget.ts
git commit -m "feat(print): Phase 2 budget recount for direct print: one request and no realtime per slip the asking device prints, no final print-status, no empty lease"
```

---

### Task B6: live legs ak–am: a slip made leased in one write, a lost answer handed back to that tab only, a creation lease that runs out, and the ack's `more`

**Files:**
- Create: `apps/cafe/scripts/print-host-live/direct.ts` (legs ak, al, am)
- Modify: `apps/cafe/scripts/verify-print-host-live.ts` (the three legs after aj)

**Interfaces produced:** `legAK(nowMs)`, `legAL(nowMs)`, `legAM(nowMs)`.

**What they prove against a real mongod.** (ak) The host's own Pay Now: the KOT is made leased to its tab (epoch 1, one attempt, a 90 s lease, today's key, the log `created` then `leased(direct)`, and ONE write: its `updatedAt` is its `createdAt`), the bill queued behind it, and a lease call meanwhile gets nothing (the line waits for that lease: KOT before bill); never for a slip another device prints, never on a line with an older job, never without the header; with no host, a device's own slip. (al) A lost answer: the same tab re-sending gets the same job and lease back and nothing new; another tab, another device, or a lease that ran out gets Phase 1's answer; another device's host means no direct print at all; the host's own re-sent KOT gets its lease back. (am) The ack's `more` (true with the bill waiting, false after it, absent on a repeat); the pulse's and the wake's count leaves out a running lease and counts one that ran out (G-2); a creation lease whose tab died expires into REPRINT (KOT) or needs-confirm (bill); a refusal sends it back in line, never counted.

- [ ] **Step 1: The change**

Create `apps/cafe/scripts/print-host-live/direct.ts`:

```ts
/**
 * Phase 2 Session 2B live legs — direct print on the asking device (spec §7.11, plan decisions 15, 16 and 9)
 * against a REAL MongoDB: a slip made already leased to the asking tab, in one write (ak); a lost answer handed
 * back to the same tab, and to no other (al); a creation lease that runs out, and the ack's `more` (am). Run by
 * scripts/verify-print-host-live.ts after legs ah–aj.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINT_LEASE_MS, PRINT_DIRECT_LEASE_DETAIL } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { createOrderPrintJobs, enqueueDirectPrintJob } from "@/lib/print-order-jobs";
import { ackPrintJob, leasePrintJobs, readJobsForDevice } from "@/lib/print-lease";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { check, seedPrintHost, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, queueKot, rowOf } from "./lifecycle";

const PHONE = "live-direct-phone";
const TAB = "live-direct-tab-1";

async function wireOrder(id: string) {
  const order = await Order.findById(id).lean();
  if (order === null) throw new Error("seeded order missing");
  return JSON.parse(JSON.stringify(order)) as Parameters<typeof kotPrintJob>[0];
}

/** A Pay Now on a fresh order, made by `device` (its tab `tab`, if any). */
async function payNow(device: string, nowMs: number, tab?: string) {
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const refs = await createOrderPrintJobs({
    order: await Order.findById(orderId).lean(),
    slips: [{ kind: "kot", round: 1 }, { kind: "bill" }],
    originDeviceId: device,
    ...(tab !== undefined ? { leaseTabId: tab } : {}),
    queuedBy: STAFF,
    nowMs,
  });
  return { orderId, refs };
}

export async function legAK(nowMs: number): Promise<void> {
  console.log("\n(ak) direct print: the asking tab's first slip on its own free line is made leased to it, in one write");
  await freshHost(nowMs);
  const { orderId, refs } = await payNow(HOST, nowMs, TAB);
  const [kotRef, billRef] = refs;
  const kot = await rowOf(kotRef?.id ?? "");
  const bill = await rowOf(billRef?.id ?? "");
  check("(ak) the host's own Pay Now: the KOT's ref carries its lease; the bill's ref is queued, with none", kotRef?.status === "leased" && kotRef.leased?.epoch === 1 && kotRef.leased.attempt === 1 && kotRef.leased.payload.kind === "kot" && billRef?.status === "queued" && billRef.leased === undefined);
  check(
    "(ak) the KOT row is leased to that tab: epoch 1, one attempt, a 90 s lease, today's key",
    kot?.status === "leased" && kot.epoch === 1 && kot.attempts === 1 && kot.uncertainAttempts === 0 && kot.lease?.deviceId === HOST && kot.lease.tabId === TAB && kot.lease.epoch === 1 && kot.lease.expiresAt.getTime() === nowMs + PRINT_LEASE_MS && kot.jobKey === `kot:${orderId}:1`,
  );
  check("(ak) its log says created, then leased directly; it was ONE write (updatedAt is its createdAt)", JSON.stringify(kot?.log?.map((e) => [e.event, e.detail ?? null])) === JSON.stringify([["created", null], ["leased", PRINT_DIRECT_LEASE_DETAIL]]) && kot?.updatedAt.getTime() === kot?.createdAt.getTime());
  check("(ak) the bill waits queued behind it (epoch 0)", bill?.status === "queued" && bill.epoch === 0 && bill.lease === undefined);
  const blocked = await leasePrintJobs({ deviceId: HOST, tabId: TAB, dismissedBy: STAFF, nowMs: nowMs + 1_000 });
  check("(ak) the line waits for that lease: a lease call gets nothing, and when to look again (KOT before bill, §7.6)", blocked.jobs.length === 0 && blocked.retryAt === new Date(nowMs + PRINT_LEASE_MS).toISOString());

  await freshHost(nowMs);
  const phone = await payNow(PHONE, nowMs, TAB);
  check("(ak) a slip another device prints is never made leased to the asking tab", phone.refs.every((r) => r.status === "queued" && r.leased === undefined && r.targetDeviceId === HOST));
  await queueKot(nowMs - 5_000);
  const busy = await payNow(HOST, nowMs, TAB);
  check("(ak) a line with an older job waiting: made queued, as in Phase 1", busy.refs.length === 2 && busy.refs.every((r) => r.status === "queued" && r.leased === undefined));
  const noTab = await payNow(HOST, nowMs);
  check("(ak) no lease header: made queued, as in Phase 1", noTab.refs.every((r) => r.status === "queued" && r.leased === undefined));

  await PrintHost.deleteMany({});
  const own = await payNow(PHONE, nowMs, TAB);
  check("(ak) no host: the asking device's own first slip is made leased to its tab", own.refs[0]?.status === "leased" && own.refs[0]?.leased !== undefined && own.refs[0]?.targetDeviceId === PHONE && own.refs[1]?.status === "queued");
}

export async function legAL(nowMs: number): Promise<void> {
  console.log("\n(al) a lost answer: the same tab gets the same lease back from the enqueue; any other gets Phase 1's answer");
  await freshHost(nowMs);
  await PrintHost.deleteMany({});
  const reprint = billPrintJob(await wireOrder(await seedRealOrder({ status: "Completed", kotRound: 1 })), { reprint: true });
  const send = (tab: string, device = PHONE, at = nowMs) =>
    enqueueDirectPrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0002-direct", originDeviceId: device, leaseTabId: tab, nowMs: at });
  const first = await send(TAB);
  const firstLeased = first?.outcome === "queued" ? first.leased : undefined;
  check("(al) no host: an agent's own reprint is made leased to its tab and answered with the lease", first?.outcome === "queued" && !first.duplicate && firstLeased?.epoch === 1 && JSON.stringify(firstLeased.labels) === '["DUPLICATE"]');
  const again = await send(TAB, PHONE, nowMs + 5_000);
  check("(al) the same tab re-sends it (its answer was lost): the same job, the same lease, nothing new", again?.outcome === "queued" && again.duplicate && again.id === firstLeased?.id && again.leased?.epoch === 1 && (await PrintJob.countDocuments({})) === 1);
  const otherTab = await send("live-direct-tab-2");
  check("(al) another tab of the device (a reload): Phase 1's answer, no lease (its lease expires: REPRINT)", otherTab?.outcome === "already-resolved");
  const otherDevice = await send(TAB, "live-direct-phone-2");
  check("(al) another device: Phase 1's answer, no lease", otherDevice?.outcome === "already-resolved");
  const late = await send(TAB, PHONE, nowMs + PRINT_LEASE_MS + 1);
  check("(al) a lease that ran out is never handed back", late?.outcome === "already-resolved");

  await seedPrintHost({ deviceId: HOST, label: "Counter PC", setBy: STAFF, nowMs });
  const hostElsewhere = await enqueueDirectPrintJob({ ...billPrintJob(await wireOrder(await seedRealOrder({ status: "Completed", kotRound: 1 })), { reprint: true }), queuedBy: STAFF, idempotencyKey: "live-key-0003-direct", originDeviceId: PHONE, leaseTabId: TAB, nowMs });
  check("(al) another device is the host: not direct (null), Phase 1's enqueue makes it for the host", hostElsewhere === null);

  await freshHost(nowMs);
  const { orderId, refs } = await payNow(HOST, nowMs, TAB);
  const resend = await enqueueDirectPrintJob({ ...kotPrintJob(await wireOrder(orderId), 1), queuedBy: STAFF, originDeviceId: HOST, leaseTabId: TAB, nowMs: nowMs + 3_000 });
  check("(al) the host's own order answer lost: its re-sent KOT gets the KOT's lease back, and no second job", resend?.outcome === "queued" && resend.duplicate && resend.id === refs[0]?.id && resend.leased?.epoch === 1 && (await PrintJob.countDocuments({ orderId })) === 2);
}

export async function legAM(nowMs: number): Promise<void> {
  console.log("\n(am) a creation lease that runs out follows §7's rules; the ack answers whether the line holds more");
  await freshHost(nowMs);
  const { refs } = await payNow(HOST, nowMs, TAB);
  const [kotRef, billRef] = refs;
  const kotAck = await ackPrintJob({ id: kotRef?.id ?? "", deviceId: HOST, epoch: 1, outcome: "printed", nowMs: nowMs + 3_000 });
  check("(am) the KOT's ack: printed, and more:true (the bill waits on the line)", kotAck.applied && kotAck.status === "printed" && kotAck.more === true);
  const billLease = await leasePrintJobs({ deviceId: HOST, tabId: TAB, dismissedBy: STAFF, nowMs: nowMs + 3_100 });
  check("(am) the bill is leased next", billLease.jobs[0]?.id === billRef?.id);
  const billAck = await ackPrintJob({ id: billRef?.id ?? "", deviceId: HOST, epoch: 1, outcome: "printed", nowMs: nowMs + 6_000 });
  check("(am) the bill's ack: more:false, so the agent leases nothing more", billAck.applied && billAck.status === "printed" && billAck.more === false);
  const repeat = await ackPrintJob({ id: billRef?.id ?? "", deviceId: HOST, epoch: 1, outcome: "printed", nowMs: nowMs + 7_000 });
  check("(am) a repeated ack changes nothing and says nothing about more", !repeat.applied && repeat.reason === "resolved" && repeat.more === undefined);

  await freshHost(nowMs);
  const dead = await payNow(HOST, nowMs, TAB);
  const later = nowMs + PRINT_LEASE_MS + 1_000;
  const [running, ranOut] = [await readJobsForDevice(HOST, nowMs + 1_000), await readJobsForDevice(HOST, later)];
  check("(am) the pulse and the wake count what a lease can act on: never a running lease (the bill only), but one that ran out", running.count === 1 && ranOut.count === 2);
  await leasePrintJobs({ deviceId: HOST, tabId: "live-direct-tab-new", dismissedBy: STAFF, nowMs: later });
  const kot = await rowOf(dead.refs[0]?.id ?? "");
  check("(am) the tab died before printing: its KOT's lease expires into REPRINT, counted once", kot?.status === "queued" && JSON.stringify(kot.labels) === '["REPRINT"]' && kot.uncertainAttempts === 1);
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const billOnly = await createOrderPrintJobs({ order: await Order.findById(orderId).lean(), slips: [{ kind: "bill" }], originDeviceId: HOST, leaseTabId: TAB, queuedBy: STAFF, nowMs });
  await leasePrintJobs({ deviceId: HOST, tabId: "live-direct-tab-new", dismissedBy: STAFF, nowMs: later });
  check("(am) a bill made leased whose tab died asks the cashier (needs-confirm)", billOnly[0]?.status === "leased" && (await rowOf(billOnly[0].id))?.status === "needs-confirm");
  const refused = await payNow(HOST, nowMs, TAB);
  const no = await ackPrintJob({ id: refused.refs[0]?.id ?? "", deviceId: HOST, epoch: 1, outcome: "failed", sent: "no", error: "Printer not connected", nowMs: nowMs + 2_000 });
  check("(am) a creation lease its printer refused goes back in line, never counted, with no more hint", no.applied && no.status === "queued" && no.nextAttemptAt !== null && no.more === undefined && (await rowOf(refused.refs[0]?.id ?? ""))?.uncertainAttempts === 0);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legAD, legAE } from "./print-host-live/agent";
import { legAF, legAG } from "./print-host-live/attention";
import { legAH, legAI, legAJ } from "./print-host-live/printers";
import { Station } from "@/models/Station";
import { Printer } from "@/models/Printer";
import { Category } from "@/models/Category";
```

Replace it with:

```ts
import { legAD, legAE } from "./print-host-live/agent";
import { legAF, legAG } from "./print-host-live/attention";
import { legAH, legAI, legAJ } from "./print-host-live/printers";
import { legAK, legAL, legAM } from "./print-host-live/direct";
import { Station } from "@/models/Station";
import { Printer } from "@/models/Printer";
import { Category } from "@/models/Category";
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAH();
    await legAI();
    await legAJ();
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAH();
    await legAI();
    await legAJ();
    // Phase 2 Session 2B legs (direct print on the asking device; the ack's more).
    await legAK(Date.now());
    await legAL(Date.now());
    await legAM(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

- [ ] **Step 2: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK && npx eslint scripts/print-host-live/direct.ts scripts/verify-print-host-live.ts && echo LINT_OK`
Expected: `TSC_OK`; `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | grep -E "passed, [0-9]+ failed"`
Expected: `272 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/direct.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): Phase 2 live legs ak–am: a slip made leased to the asking tab in one write, a lost answer handed back to that tab only, a creation lease that runs out, and the ack's more"
```

---

### Task B7: full verification, builds, the emulator exit check, the fresh review, Results

**Files:** this plan (a new "Session 2B Results" section at its end). The two tools below go in this session's scratchpad, never in the repo.

- [ ] **Step 1: Every suite**

Run each from the repo (the totals the pre-validation saw on a fresh clone):

| Run | Expected |
|---|---|
| `cd /d/kd/lucifer/packages/shared && npm test && npx tsc --noEmit -p .` | `# tests 672`, `# pass 672`; tsc 0 |
| `cd /d/kd/lucifer/apps/cafe && npm test` | `# tests 4320`, `# pass 4319`, `# fail 0`, `# skipped 1` (the skip is the `go-live-dl` pin) |
| `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npm run lint` | tsc 0; lint 0 errors and the 2 old warnings |
| `cd /d/kd/lucifer/apps/hub && npx tsc --noEmit` | 0 |
| `cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test && npm run test:app` | 117/117; Jest 3/3 (untouched) |
| `cd /d/kd/lucifer/apps/desktop && npm test` | 191/191 (untouched) |
| `cd /d/kd/lucifer && npm run test:print-tools` | 8/8 |
| `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live` | `272 passed, 0 failed` (248 + 24: ak 9, al 7, am 8) |

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build`
Expected: the build succeeds with 127 routes (2B adds none).

- [ ] **Step 3: APKs (no mobile change: byte-identical to the release)**

First `git diff 4271848..HEAD --stat -- apps/mobile apps/desktop` must print nothing. Then build the x86_64 APK and the ARM pair with `GRADLE_USER_HOME='D:\gradle-home'` (the README's commands). Expected: byte-identical to the 2026-10-03 release (`D:\kd\pos-apk-release\Sandbee-POS-final\`): x86_64 `29115bdf…`, arm64-v8a `0e0ec314…`, armeabi-v7a `e618900a…`. A different hash means something outside the plan changed: stop and find out what.

- [ ] **Step 4: The emulator exit check (spec §7.11, the owner's ask)**

**First check which POS the emulator's app shows** (Global Constraints, Demo POS): it was on the owner's live demo ("Olivea Pizza") at the 2A gate. Never act on the demo: open the printer panel, swipe to the bottom, More options → Change POS address → `http://localhost:3100`, and check that "POS Software" and the seeded menu (Masala Chai, Cheesecake…) show before any tap that writes.

**The harness** (as the gate ran it; all ports were free on 2026-10-04: check `netstat -ano | grep LISTEN` first):
- the local POS from this branch's build: `cd /d/kd/lucifer/apps/cafe && node --env-file=<scratchpad>/e2e.env ../../node_modules/next/dist/bin/next start -p 3110` (a background command with `timeout: 7200000`); `e2e.env` is the 2A session's env file (database `pos_scratch_e2e_p1final`, e2eadmin, tables and menu seeded), copied from its scratchpad (`88248c57…/scratchpad/e2e.env`, or the 2A gate's copy `88b72024…/scratchpad/e2e.env`; the gate left a few more test orders in it, `ORD-20261004-005…012`), or a fresh `pos_scratch_e2e_2b` made with Phase 1's `make-env.py` and the seed scripts;
- the counting proxy in front of it: `node <scratchpad>/gate-proxy-2b.mjs --listen 3200 --target 3110 --log <scratchpad>/proxy-2b.jsonl --drop-once "POST /api/orders" --rearm <scratchpad>/rearm-drop`, and `adb reverse tcp:3100 tcp:3200`, so the app's address stays `http://localhost:3100`;
- the fake printer: `node scripts/fake-escpos-printer.mjs --port 9101 --out <dir>`; give `--out` a long Windows path (`C:\Users\Kartik.desai\…`, not the `KARTIK~1.DES` short form: at the gate an output folder under the short path vanished and the printer crashed on its first job);
- the app (`Pixel_7_API_33`, WebView 109, the release APK `29115bdf…`): its network printer `10.0.2.2` port `9101` (Use this network printer), then "Print all slips on this device" (the host);
- **if a scratch clone's or the scratchpad's folders vanish mid-session** (the gate's clone lost its `node_modules` junctions once): re-run the link script and re-check before trusting a run.

Save these two tools in the scratchpad (the Write tool), exactly as below. The proxy logs methods, routes (ids folded), statuses and whether a request named a lease tab; never a header value, a cookie or a body. The tool prints statuses, ids and job states; never a secret.

`<scratchpad>/gate-proxy-2b.mjs`:

```js
// The Phase 2B gate: a proxy in front of the local POS, scratchpad only, no dependencies. It forwards every
// request unchanged and logs one JSON line per request (time, method, route with ids folded, whether the
// request named a lease tab (x-pos-print-lease), whether a pulse named a device, status, ms). Never a header
// value, a body or a cookie.
// With --drop-once "POST /api/orders" it forwards the FIRST matching request to the POS (the write lands), then
// cuts the client's connection instead of answering: the device's answer is lost (spec §7.11's lost answer).
// The armed drop can be re-armed by touching the file named by --rearm (its existence is checked per request).
//   node gate-proxy-2b.mjs --listen 3200 --target 3110 --log <file.jsonl> [--drop-once "POST /api/orders"] [--rearm <file>]
import http from "node:http";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
const listen = Number(arg("--listen", "3200"));
const target = Number(arg("--target", "3110"));
const log = arg("--log", "");
const dropSpec = arg("--drop-once", "");
const rearm = arg("--rearm", "");
// With --rearm the drop starts disarmed: touching that file arms it for the next matching request.
let armed = dropSpec !== "" && rearm === "";
if (log === "") throw new Error("--log <file.jsonl> is required");

function routeOf(url) {
  const pathOnly = (url ?? "/").split("?")[0];
  return pathOnly.replace(/[0-9a-f]{24}/g, ":id").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":uuid");
}
function deviceOf(url) {
  const q = new URL(url ?? "/", "http://x").searchParams.get("device");
  return q === null ? null : q.slice(0, 8);
}

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  const route = routeOf(req.url);
  if (!armed && rearm !== "" && existsSync(rearm)) {
    armed = dropSpec !== "";
    try {
      unlinkSync(rearm);
    } catch {
      // the file is the operator's; a failed unlink only means it re-arms again
    }
  }
  const drop = armed && `${req.method} ${route}` === dropSpec;
  if (drop) armed = false;
  const write = (status, extra = {}) => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    appendFileSync(
      log,
      `${JSON.stringify({
        t: Date.now(),
        m: req.method,
        r: route,
        lease: req.headers["x-pos-print-lease"] !== undefined ? true : undefined,
        agent: req.headers["x-pos-print-agent"] !== undefined ? true : undefined,
        device: route === "/api/order-requests/pulse" ? deviceOf(req.url) : undefined,
        s: status,
        ms: Math.round(ms),
        ...extra,
      })}\n`,
    );
  };
  let logged = false;
  const done = (status, extra) => {
    if (logged) return;
    logged = true;
    write(status, extra);
  };
  const upstream = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: req.headers }, (up) => {
    if (drop) {
      // The write landed upstream; the device never hears the answer.
      up.resume();
      up.on("end", () => {
        done(up.statusCode ?? 502, { dropped: true });
        res.socket?.destroy();
      });
      return;
    }
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
    up.on("end", () => done(up.statusCode ?? 502));
    up.on("error", () => done(up.statusCode ?? 502));
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
    done(502);
  });
  req.pipe(upstream);
});
// No realtime socket runs locally; refuse upgrades plainly so a client falls back to its polls.
server.on("upgrade", (_req, socket) => socket.destroy());
server.listen(listen, "127.0.0.1", () => console.log(`gate proxy 127.0.0.1:${listen} -> 127.0.0.1:${target}${dropSpec ? ` (drop once: ${dropSpec})` : ""}, log ${log}`));
```

`<scratchpad>/p2b-tool.ts` (run from `apps/cafe`: `node --env-file=<scratchpad>/e2e.env --import tsx <scratchpad>/p2b-tool.ts <mode>`):

```ts
// Session 2B emulator check (scratchpad only; never in the repo). It drives the local POS as the e2e admin (a
// session minted from the env file's AUTH_SECRET, never printed) and prints statuses, counts, ids and job states
// only: never a secret, a token or a payload. Run from apps/cafe:
//   node --env-file=<scratchpad>/e2e.env --import tsx <scratchpad>/p2b-tool.ts <mode>
// modes: host        the print host's device id (an opaque id, not a secret) and the device rows
//        kot-second  a KOT of one item made by a SECOND device (e2e-script-device): the host prints it, through
//                    its wake or lease, exactly as in Phase 1 (no lease header)
//        dead-tab    a KOT made AS the print host device with a lease header naming a tab that never prints
//                    (e2e-dead-tab): the job is made leased to that tab; its lease must run out (90 s) and the
//                    host's real tab print it once, as REPRINT
//        jobs        the newest jobs: kind, status, labels, epoch, attempts, the lease's tab, the log
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const mongoose = require("mongoose") as typeof import("mongoose");
const { encode } = require("next-auth/jwt") as typeof import("next-auth/jwt");

const BASE = process.env.P2B_BASE ?? "http://localhost:3110";
const COOKIE = "authjs.session-token";
type Db = NonNullable<typeof mongoose.connection.db>;
type Json = { data?: unknown; error?: string };

async function cookieFor(db: Db): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET missing from the env file");
  const staff = await db.collection("staffs").findOne({ username: "e2eadmin" }, { projection: { name: 1, role: 1 } });
  if (staff === null) throw new Error("e2eadmin not found");
  const token = await encode({ token: { name: staff.name, id: String(staff._id), role: staff.role, lastValidated: Date.now() }, secret, salt: COOKIE });
  return `${COOKIE}=${token}`;
}

async function call(cookie: string, method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${BASE}${url}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Json };
  } catch {
    return { status: res.status, json: { error: `non-JSON answer (${text.length} chars)` } };
  }
}

async function oneItemOrder(db: Db) {
  const product = await db.collection("products").findOne({ isActive: true }, { projection: { name: 1, price: 1 } });
  if (product === null) throw new Error("the menu is empty");
  const items = [{ productId: String(product._id), name: product.name, price: Number(product.price), qty: 1, modifiers: [], instructions: "" }];
  return { customerName: "Walk-in", items, subtotal: items[0]?.price ?? 0, discount: 0, total: items[0]?.price ?? 0, payment: "Unpaid", status: "Pending", receiver: "E2E script", idemKey: randomUUID() };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const uri = process.env.MONGODB_URI ?? "";
  if (!/\/pos_scratch_e2e_[a-z0-9_]+$/.test(uri)) throw new Error("refusing: not a pos_scratch_e2e_* database");
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("no db");
    const out = (v: unknown) => console.log(JSON.stringify(v, null, 1));
    const host = await db.collection("printhosts").findOne({}, { projection: { deviceId: 1 } });
    if (mode === "host") {
      const devices = await db.collection("printdevices").find({}).project({ deviceId: 1, lastSeenAt: 1 }).toArray();
      return out({ host: host?.deviceId ?? null, devices: devices.map((d) => [String(d.deviceId).slice(0, 8), d.lastSeenAt]) });
    }
    if (mode === "jobs") {
      const rows = await db.collection("printjobs").find({}, { projection: { payload: 0 } }).sort({ createdAt: -1, _id: -1 }).limit(8).toArray();
      return out(
        rows.map((j) => ({
          id: String(j._id).slice(-6),
          kind: j.kind,
          label: j.label,
          status: j.status,
          labels: j.labels ?? [],
          epoch: j.epoch,
          attempts: j.attempts,
          uncertain: j.uncertainAttempts,
          leaseTab: typeof j.lease?.tabId === "string" ? j.lease.tabId.slice(0, 12) : null,
          target: typeof j.targetDeviceId === "string" ? j.targetDeviceId.slice(0, 8) : null,
          origin: typeof j.originDeviceId === "string" ? j.originDeviceId.slice(0, 8) : null,
          createdAt: j.createdAt,
          printedAt: j.printedAt ?? null,
          log: (j.log ?? []).map((e: { event: string; detail?: string; at: Date }) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.event}${e.detail ? `(${e.detail})` : ""}`),
        })),
      );
    }
    const cookie = await cookieFor(db);
    if (mode === "kot-second") {
      const res = await call(cookie, "POST", "/api/orders", await oneItemOrder(db), { "x-pos-print-agent": "1", "x-pos-device-id": "e2e-script-device" });
      const data = (res.json.data ?? {}) as { orderId?: string; printJobs?: Array<{ id: string; kind: string; status: string; leased?: unknown }> };
      return out({ status: res.status, orderId: data.orderId ?? null, printJobs: (data.printJobs ?? []).map((j) => [j.id.slice(-6), j.kind, j.status, j.leased !== undefined]) });
    }
    if (mode === "dead-tab") {
      if (typeof host?.deviceId !== "string") throw new Error("no print host: make the app the host first");
      const res = await call(cookie, "POST", "/api/orders", await oneItemOrder(db), { "x-pos-print-agent": "1", "x-pos-device-id": host.deviceId, "x-pos-print-lease": "e2e-dead-tab" });
      const data = (res.json.data ?? {}) as { orderId?: string; printJobs?: Array<{ id: string; kind: string; status: string; leased?: { epoch: number } }> };
      return out({ status: res.status, orderId: data.orderId ?? null, at: new Date().toISOString(), printJobs: (data.printJobs ?? []).map((j) => [j.id.slice(-6), j.kind, j.status, j.leased?.epoch ?? null]) });
    }
    throw new Error("unknown mode (see the header)");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exitCode = 1;
});
```

Then, reading the proxy's log (`"m":"POST"` lines, leaving out `/api/print-host/beat`) and the fake printer's `jobs.log` (`bytes > 0`) after each item:
1. **Send to Kitchen** (one Masala Chai, a walk-in): the proxy shows `POST /api/orders` with `"lease":true`, then `POST /api/print-jobs/:id/ack`, and **no** `POST /api/print-jobs/lease` for it; one slip (40,494 B); `jobs`: the KOT `printed`, epoch 1, attempts 1, log `created`, `leased(direct)`, `printed`.
2. **Pay Now** (one Cheesecake, Cash, Place Order): `POST /api/orders`, the KOT's ack, one `POST /api/print-jobs/lease` (the bill), the bill's ack, and no lease after it; the KOT (40,494 B) prints before the bill (36,966 B).
3. **`kot-second`**: its ref is `queued` with no lease; the host leases it (through its wake: no realtime Worker runs locally) and prints it once; its log `created`, `leased`, `printed`.
4. **A lost answer:** `touch <scratchpad>/rearm-drop`, then Send to Kitchen. The proxy logs the first `POST /api/orders` with `"dropped":true`; the POS re-sends it (a replay: 200, no job named), then `POST /api/print-jobs` with `"lease":true`, then the ack. One slip, unlabelled; the KOT's log `created`, `leased(direct)`, `printed`, epoch 1. (At the gate the POS once re-sent by itself and once showed "Couldn't confirm" with Send again: tap it within about a minute, while the lease runs; the same requests follow.)
5. **`dead-tab`**: its ref is `leased` (epoch 1, to `e2e-dead-tab`). For the next 90 s the proxy shows **no lease request** (the wake polls only). Then the host expires and prints it once: **REPRINT** (46,110 B), epoch 2; its log `created`, `leased(direct)`, `expired(lease expired: may have printed)`, `leased`, `printed`.
6. **No host:** the printer panel → Stop printing here → Yes, remove ("0 waiting slips cancelled"), then Send to Kitchen: `POST /api/orders` (`"lease":true`) and its ack only.
7. `adb logcat -b crash -d` is empty for the app.
8. **Put back as found:** on the local POS, Remove the network printer ("No printer set up"); More options → Change POS address → `https://posdemo.sandbee.in` ("Olivea Pizza" loads; its printer panel, opened read-only, shows "No printer set up" and "Each device prints its own slips"); `adb reverse --remove-all` then `adb reverse tcp:3100 tcp:3100`; stop the POS, the proxy and the fake printer by PID after checking each one's command line (`Get-CimInstance Win32_Process`); `adb emu kill` if this session booted the emulator.

Record every answer, the request counts per item and the fake printer's counts in Results.

- [ ] **Step 5: The fresh review**

A fresh reviewer subagent (the most capable model, read-only) reads `4271848..HEAD` against this plan (decisions 9, 15, 16; "2A review gate: rulings"; Session 2B) and spec §7.2, §7.6, §7.9 and §7.11, and reports Critical / Important / Minor findings, each with a concrete failure scenario. Fix Critical and Important ones by TDD on the branch (each RED seen before its GREEN) and re-run Step 1; list the rest in Results for the 2B gate.

- [ ] **Step 6: Results, then push**

Add "## Session 2B Results (filled in by the implementer)" at the end of this plan: every number from Steps 1–5, the APK hashes, the emulator answers, each changed pin, any deviation with its reason. Commit it, and push the branch with the token only: `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-2`.

**Changed existing pins in 2B** (each follows a deliberate change; name them in Results):
- `apps/cafe/lib/print-order-jobs.test.ts` "PIN (M-d)": a new job is queued, or made leased and carrying its lease; a found job keeps its state, plus its lease when it is still the asking tab's (B2).
- `apps/cafe/lib/print-lifecycle-paths.test.ts`: the CAS pin no longer expects the final-status publish, and "the lifecycle publishes exactly the final statuses" becomes "no final state is published" (G-1, B3).
- `packages/shared/src/print-budget.test.ts`: "three Worker requests per slip" (3,935) becomes two (2,735), and "two per slip in printers mode" (3,635) becomes one (1,985) (G-1, B5).
- `apps/cafe/package.json` `testChain`: `lib/print-direct.test.ts` appended (B2).

---

## Session 2B Results (filled in by the implementer)

Executed on 2026-10-04 with superpowers:executing-plans, task by task, B1 → B7.

### Commits (`d605dc4..HEAD`)

| Commit | Task |
|---|---|
| `617fcff` | B1: the shared contract: the lease header, a ref that carries its lease, the ack's `more`, a job made leased at creation |
| `7c4641c` | B2: the server: the asking tab's first slip on its own free line is made leased to it, a lost answer is handed back, nothing announced to yourself |
| `d126f03` | B3: the ack answers `more`; no final print-status (G-1); jobs-for-me leaves out a running lease (G-2) |
| `65538ba` | B4: the page: the draining tab names itself, takes leased jobs, nudges, leases again only on `more` |
| `83610a4` | B5: the budget recount |
| `e435601` | B6: live legs ak–am |
| `8869e63` | Final review C-1 and I-1 (beyond the plan): one (id, epoch) prints once however it reached the tab; a held job dropped unprinted is handed back as a refusal |
| (this commit) | Results; spec §7.11 "Changed by Session 2B's final review" |

### Start

- `git branch --show-current`: `feat/printing-phase-2`; HEAD `d605dc4` (= origin); working tree clean.
- `GIT_TERMINAL_PROMPT=0 git fetch origin` (token credential): `origin/main` still `6ee2b1d`: nothing to note or merge.
- Before B1, the whole B1–B6 range (plan lines 3972–7326) was dry-run with the gate's applier against `d605dc4`: **70 ops OK** (as the gate saw).

### How the code was applied

Every block was applied verbatim to the real repo by the gate's applier (`apply_blocks_clone.py`, copied to this session's scratchpad), one step range at a time, so each RED was seen before its code went in. After B6, **all 34 files the six commits touch are blob-identical to the gate's golden branch `g2b`** (gold tree `c22b72a`; `4271848..d605dc4` touches only the plan and the spec).

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED | GREEN |
|---|---|---|
| B1 | `print-lifecycle.test.ts`: tests 1, pass 0, **fail 1** | **26/26**; shared tsc 0; cafe tsc 0 |
| B2 | `print-direct.test.ts` + `print-order-jobs.test.ts`: tests 17, pass 12, **fail 5** | 3 files **24/24**; cafe tsc 0; eslint `LINT_OK` |
| B3 | `print-lifecycle-paths.test.ts` + `print-lease.test.ts`: tests 24, pass 20, **fail 4** | **24/24**; tsc 0; `LINT_OK` |
| B4 | `print-agent.test.ts` + `print-agent-paths.test.ts`: tests 43, pass 32, **fail 11** | **43/43**; tsc 0; `LINT_OK`; `print-agent.ts` 278 lines |
| B5 | `print-budget.test.ts`: tests 1, pass 0, **fail 1** | **26/26**; shared tsc 0 |
| B6 | (legs: apply and run) | tsc 0, `LINT_OK`; `verify:print:live` **`272 passed, 0 failed`** |
| C-1 fix | "2B: a job leased through the lease call prints once when the enqueue hands it back, while it prints or before" **fails** (prints `b1, b1`); the "before" order proven on the old agent by a scratchpad test (prints `b2, b2`) | agent + paths **45/45**; tsc 0; `LINT_OK` |
| I-1 fix | "2B: a held job dropped by the hold bound or by stop() is handed back as a refusal (sent:'no') before any lease" **fails** (no ack); the changed pin below fails the same way | (same run) |

The six commits: 34 files, +1,238 / −193. New files: `print-direct.ts` 76 lines, `print-agent-seams.ts` 67, `print-agent-types.ts` 56, `print-agent-slip.ts` 34, legs `direct.ts` 132; `print-order-jobs.ts` 299, `print-lease.ts` 231, `print-agent.ts` 278 (307 after the fix).

### Task B7 Step 1: every suite (at `e435601`)

| Suite | Result |
|---|---|
| shared `npm test`; `tsc` | **672/672**; 0 |
| cafe `npm test` | **4320 tests, 4319 pass, 0 fail, 1 skipped** (the `go-live-dl` pin) |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings (`lib/masters-blob.test.ts:331`) |
| Hub `tsc` | 0 |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; **117/117**; Jest **3/3** (untouched) |
| desktop `npm test` | **191/191** (untouched) |
| `npm run test:print-tools` | **8/8** |
| live legs (local mongod, `pos_scratch_print_host`) | **`272 passed, 0 failed`** (248 + 24) |

Every row equals the plan's Expected.

**After the fix (`8869e63`), Step 1 again:** shared **672/672**, tsc 0; cafe **4322 tests, 4321 pass, 0 fail, 1 skipped** (+2: the two new agent tests); cafe tsc 0, lint 0 errors and the 2 old warnings; Hub 0; mobile **117/117** and Jest **3/3**; desktop **191/191**; print tools **8/8**; live legs **`272 passed, 0 failed`**.

### Changed existing pins (each follows a deliberate change)

The four the plan names (B2, B3, B5): `print-order-jobs.test.ts` "PIN (M-d)"; `print-lifecycle-paths.test.ts` (the CAS pin without the final-status publish; "no final state is published"); `print-budget.test.ts` (3,935 → 2,735 and 3,635 → 1,985 Worker requests); `apps/cafe/package.json` `testChain` (+ `lib/print-direct.test.ts`). Beyond the plan, for the I-1 fix: `print-agent.test.ts` "2B: a held job prints only well inside its lease…" now expects the dropped job's refusal ack (`failed`, `sent:"no"`, epoch 1) where it expected no ack; the title of "2B: taken jobs wait their turn…" now ends "stop drops them unprinted" (was "(their lease expires)"; its assertions are unchanged).

### Step 2: the Next production build

Success, **127 routes** (2B adds none), at `e435601` and again at `8869e63`.

### Step 3: APKs (no mobile change: byte-identical to the release)

`git diff 4271848..HEAD --stat -- apps/mobile apps/desktop` printed nothing. Built with `GRADLE_USER_HOME='D:\gradle-home'` (BUILD SUCCESSFUL 1m 15s and 39s): x86_64 **`29115bdf…`**, arm64-v8a **`0e0ec314…`**, armeabi-v7a **`e618900a…`**: byte-identical to `D:\kd\pos-apk-release\Sandbee-POS-final\`. The fix (`8869e63`) is web-only.

### Step 4: the emulator exit check. Passed.

`Pixel_7_API_33` (own boot at `-memory 4096 -no-audio -no-snapshot-save`, C: 12 GB free), WebView 109; the installed APK pulled and hashed: the release `29115bdf…`. **The app opened on the owner's live demo "Olivea Pizza"** (signed in; its printer panel: "No printer set up", "Each device prints its own slips"); nothing was tapped there except the printer panel's More options → Change POS address → `http://localhost:3100`, and "POS Software" with the seeded menu showed before any write. The harness as the plan says: this branch's build on 3110 (env: the 2A gate's `e2e.env`, database `pos_scratch_e2e_p1final`), the plan's counting proxy on 3200 (`adb reverse tcp:3100 tcp:3200`), the fake printer on 9101 (long `--out` path; nothing vanished), the network printer `10.0.2.2:9101`, then "Print all slips on this device" (host = the app's device `35bd9663…`). The two tools were saved from the plan into the scratchpad (byte-identical to the gate's copies). Requests are the proxy's POSTs less the beats; the host's own wake polls (every 3 s for 2 min after a job, then 15 s: no realtime Worker locally) are left out below.

| # | Item | Requests | Paper (fake printer, bytes > 0) | Job |
|---|---|---|---|---|
| 1 | Send to Kitchen (Masala Chai) | `POST /api/orders` (`lease:true`), its ack 0.92 s later; **no lease** | one slip, 40,494 B | `created`, `leased(direct)`, `printed`; epoch 1, attempts 1 |
| 2 | Pay Now (Cheesecake, Cash, Place Order) | order, the KOT's ack, **one** `POST /api/print-jobs/lease` (the bill), the bill's ack; nothing after in 20 s+ | KOT 40,494 B, then bill 36,966 B | KOT `leased(direct)`; bill `leased` |
| 3 | `kot-second` | its ref `queued`, no lease; the host's wake 5 s later → lease → ack | one slip, 40,494 B | `created`, `leased`, `printed` |
| 4 | Lost answer (`rearm-drop`, then Send to Kitchen) | `POST /api/orders` `"dropped":true` (upstream 201); the POS re-sent it by itself 13 ms later (replay 200, no job named); `POST /api/print-jobs` (`lease:true`) 200 handed the lease back; its ack | one slip, 40,494 B, unlabelled | `created`, `leased(direct)`, `printed`; epoch 1 |
| 5 | `dead-tab` | its ref `leased` (epoch 1); **no lease request for 94 s** (26 wake polls and the pulses only); then a lease (it expired the job) and 3.3 s later a lease at epoch 2, then its ack | once, **REPRINT**, 46,110 B | `created`, `leased(direct)`, `expired(lease expired: may have printed)`, `leased`, `printed` |
| 6 | No host (Stop printing here → "Printing device removed — 0 waiting slips cancelled."), Send to Kitchen | `POST /api/orders` (`lease:true`) and its ack only | one slip, 40,494 B | `leased(direct)`, `printed` |
| 7 | `adb logcat -b crash` | empty (at boot and after) | | |

Fake printer total: 7 slips with bytes > 0. **After the fix**, the build of `8869e63` was run again on the same harness (the app switched from the demo the same way): Send to Kitchen = order + ack (40,494 B); Pay Now = order, ack, lease, ack, nothing after in 25 s (40,494 B then 36,966 B); a lost answer = dropped order, replay 200, the enqueue's lease, ack, one slip unlabelled at epoch 1. Crash buffer empty.

**Item 8, put back as found (twice):** on the local POS "Stop printing here" ("0 waiting slips cancelled") and the network printer removed ("No printer set up"); the address back to `https://posdemo.sandbee.in` ("Olivea Pizza" loads; its printer panel, opened read-only: "No printer set up", "Each device prints its own slips"); `adb reverse --remove-all` then `adb reverse tcp:3100 tcp:3100`; the POS, the proxy and the fake printer stopped by PID after checking each command line; `adb emu kill`.

### Step 5: the fresh review

Claude Fable 5.1 (as at the 2A session and gate: the most capable widely released model), read-only, on `d605dc4..e435601` against the plan (decisions 9, 15, 16; the 2A gate rulings; Session 2B, its Review Focus) and spec §7.2, §7.6, §7.9, §7.11, §17.2; it re-ran the six cafe and two shared test files (87/87, 52/52) and proved its Critical finding with a scratchpad test. Verdict "with fixes": the server side, G-1, G-2, `more` and the budget sound; backward compatibility holds; nothing new is trusted from the header.

| # | Finding | Outcome |
|---|---|---|
| **C-1** (Critical) | The enqueue hands back any running lease of the asking device and tab, including one the agent took through the lease call. `take` ignored only jobs it had taken or whose ack was pending, so a Send again that landed while that job printed (after a timed-out order answer in a rush) printed it twice, unlabelled; also a bill, a notice, and a REPRINT re-delivered while it printed. The same happens when the enqueue's answer arrives before the lease's. | **Fixed (`8869e63`)**: the cycle remembers every (id, epoch) it prints, whatever the path, and drops a held twin. Agent test RED → GREEN for both orders. Server unchanged: handing a lease-call lease back is useful (a lost lease answer then prints unlabelled instead of REPRINT); the agent is the idempotent consumer the spec names. |
| **I-1** (Important) | A held job dropped by the 60 s bound, or by `stop()`, was never acked, so a slip the tab knew it never sent (the printer off for over a minute right after the order) ended as a REPRINT KOT (a kitchen may skip it as a copy) or the cashier's "Did the bill print?". Phase 1 printed the same case clean. | **Fixed (`8869e63`)**: it is acked `failed`, `sent:"no"` (never counted) before any lease. `planAck` applies that only while the job is leased at that epoch; a lease that ran out (`not-leased`), a new epoch (`stale-epoch`) or a resolved job ignore it, so it can never cause a second paper. This changes the 2A gate's "dropped unprinted and never acked": the gate's reason (another writer may have printed it) concerns printing, not acking. Spec §7.11 now says so ("Changed by Session 2B's final review"). |
| M-1 | The 60 s hold bound assumes the lease began ≤ 15 s before arrival; a re-delivered lease may have little left | For the 2B gate. No double print: this tab is the line's only leaser; the ack lands as a late ack (§7.9). |
| M-2 | `printLineIsFree` → insert is not atomic: two concurrent own requests from one tab can both be made leased on one line | For the 2B gate (same writer; both print once, in arrival order). |
| M-3 | Leg (al) asserts only creation leases | For the 2B gate (the lease-call re-delivery is covered by the new agent test). |
| M-4 | "holds or has acked-pending" → "holds, is printing, or has acked-pending" | The code comment and spec §7.11 are updated; the plan's decision 15 text is left for the gate. |
| M-5 | `PRINT_REDELIVERY_SELECT` reads the payload on every keyed collision with the header, even when the answer is `already-resolved` | For the 2B gate (budget only; a two-step read). |
| M-6 | `directReady()` calls `refusalHolds()`, which can clear a stale refusal while building a header | For the 2B gate (no behaviour change). |

The reviewer's "declined to judge" list (10 items: the Orders-sheet bill reprint key, the gate-accepted M-2/M-4 and clock residuals, the doubled payload in the answer, no host nudge for the host's own enqueue, `directReady` ignoring a busy bridge, a host change while a job is held, the 50-entry stores, printers mode, `more`'s device) was ruled item by item in the ledger: each stands as built or as the gate ruled, and #6/#7 are softened by the I-1 fix.

### Deviations and rulings

- **Beyond the plan:** the fix commit `8869e63` (C-1, I-1) and its two changed pins; spec §7.11 gained "Changed by Session 2B's final review". `print-agent.ts` is 307 lines after the fix (the ~300 budget).
- **The fresh review ran in parallel with Steps 3–4** (it is read-only and reads only the code); the fix was then smoke-checked on the emulator with its own build.
- The two tools were extracted from the plan's fences into the scratchpad (byte-identical to the gate's copies) rather than retyped.
- Every decision is in the ledger (`.superpowers/sdd/2026-10-03-phase-2-routing/progress.md`, git-ignored, kept for the gate).

### Open for the 2B gate

M-1, M-2, M-3, M-5, M-6 above; M-4's plan wording; re-check C-1/I-1 and the §7.11 amendment; the reviewer's recommendation of an emulator item "Send again tapped while the re-sent KOT is already printing on the host → one KOT" (hard to time by hand; the agent test covers it). Unchanged from 2A: I1 (2C item 5), M7, M9 (2C), M3, M4, M5 (2D).

### Pushed

With the token only: `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-2`. `origin/main` was still `6ee2b1d` at the end (no merge). `main` untouched; nothing deployed.

## Session 2B review (gate, 2026-10-04)

**Verdict: PASS, with fixes folded into Session 2C (Task C0).** Session 2B (`d605dc4..475b986`: B1–B6 applied verbatim as `617fcff..e435601`, the final-review fix `8869e63`, the Results `475b986`) is complete and correct for its scope: a slip the asking device prints itself costs one request (its ack), and every other slip keeps Phase 1's path. A fresh reviewer at the gate found no Critical defect. One Important (I-A: 2B's open M-1 is a real two-paper path) and two minors (M-A, M-B) are fixed in Task C0; the rest are ruled below.

**How this gate stayed independent.** The owner asked for the gate in the session that had executed 2B ("continue in this session, then give the next session's prompt"), so that session's memory was not trusted. Every suite was re-run on the repo at `475b986`; a fresh reviewer subagent (Claude Fable 5.1, read-only, which wrote none of the code) re-read `8869e63` and `475b986` and checked every number the Results cite against git; and 2C's pre-validation re-ran all of 2B's tests again under 2C's code.

| Check | Re-run at the gate (`475b986`) | Session 2B Results |
|---|---|---|
| shared `npm test`; `tsc` | 672/672; 0 | same |
| cafe `npm test` | 4322 tests, 4321 pass, 0 fail, 1 skipped (the `go-live-dl` pin) | same (after `8869e63`) |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings | same |
| Hub `tsc` | 0 | same |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; 117/117; Jest 3/3 | same |
| desktop `npm test` | 191/191 | same |
| `npm run test:print-tools` | 8/8 | same |
| live legs (local mongod) | `272 passed, 0 failed` | same |
| Next build | 127 routes (the gate's golden builds, which hold 2B's code unchanged) | same |
| APKs | `git diff d605dc4..475b986 -- apps/mobile apps/desktop` is empty: byte-identical, as the Results' rebuild showed | same |
| Secrets in `d605dc4..475b986` | none (no token, key or connection string in the diff) | — |

**`origin/main`** was fetched at the gate (token credential): still `6ee2b1d`, so nothing to merge.

**Code read (the fresh reviewer; it re-ran `print-agent.test.ts` and `print-agent-paths.test.ts`, 45/45, and proved M-A with a scratchpad test against HEAD).**
- **C-1 is closed for both orders by construction.** The agent remembers `id:epoch` and splices a held twin synchronously, between the lease answer and the print (no await in between; `take()` is synchronous), so a re-delivery lands either before (held, then spliced as the twin) or during and after (dropped). The pre-fix agent printed twice in both orders. **It cannot suppress a legitimate print:** a REPRINT, a `sent:"no"` re-queue, a Retry and a cashier reprint all re-lease at a new epoch.
- **I-1 is wired through the pending-ack store**: it survives a reload, is retried, and is sent before the lease. **The server applies the `sent:"no"` hand-back safely in every state**: still leased at that epoch (running, or run out but not yet swept) → queued, unlabelled, uncounted; expired and swept → `not-leased`; re-leased → `stale-epoch`; resolved → `resolved`; pruned → 404, forgotten. No path makes a second paper or a wrong count.
- **The Results' numbers all match git** (the commit table, 34 files +1,238 / −193, each file's line count, 43 → 45 agent tests, the two changed pins).
- **I-A, M-A and M-B** below; **M-C** (wording) and **M-D** (a note) too.

**Pre-validating 2C on the emulator.** The gate wrote 2C on a golden copy and ran it on the emulator (`Pixel_7_API_33`, WebView 109, the release APK, its installed copy hashed `29115bdf…`) against the golden build of the POS on 3110, the counting proxy on 3200 (`adb reverse tcp:3100 tcp:3200`), three fake printers (9100 the counter, 9101 the kitchen, 9102 the bar), and two scripted writers (`p2c-tool.ts agent`, Task C10). Each time the app opened on the owner's live demo ("Olivea Pizza"); nothing was tapped there except the printer panel's More options → Change POS address → `http://localhost:3100`, and it was put back as found after each run.
1. **The first golden build** (before the fresh review): Send to Kitchen, Pay Now, removing every printer (with a Refresh), and a writer that is off all behaved as Task C10 says.
2. **The build after the fresh review's fixes** (I-1, I-2, I-3): Send to Kitchen and Pay Now again; then **Kitchen re-saved onto the app with no Refresh** (the I-2 case): the app read its printers again at its next wake, 2.5 s after the order, and printed the KITCHEN slip on its own printer 5.4 s after the order. Then **every printer removed with no Refresh**: the next KOT printed in simple mode, but **the app kept polling the wake every 15 s** (its stale list still said it wrote a printer), all day while on screen. That is **E-1** below, fixed in Task C6; on its build, 10 s after the teardown the wake was followed by `GET /api/printers` and one lease, then no wake for 65 s.
3. **The final build** (this section's code, tree `d38dc5d…`), Task C10 Step 4's items in order. Requests are the app's, from the proxy, less the beats and its own wake polls; paper is each fake printer's `jobs.log` with bytes > 0.

| # | Item | Requests | Paper | Jobs |
|---|---|---|---|---|
| — | Setup + Refresh | `GET /api/printers`, the writer's first wake, one lease | | |
| 1 | Send to Kitchen (Cheesecake, Masala Chai) | `POST /api/orders` (`lease:true`), its ack 0.84 s later; **no lease** | counter: full copy 48,198 B; kitchen 69 B; bar 62 B; each `more:false` | full copy `created`, `leased(direct)`, `printed`; Kitchen and Bar `created`, `leased`, `printed` |
| 2 | Pay Now (the same, Cash, Place Order) | order, the full copy's ack, **one** lease (the bill), the bill's ack; nothing after | counter: full copy 48,198 B, then the bill 2 × 40,854 B; kitchen 69 B; bar 62 B | bill: copies 2, `leased`, `printed` |
| 3 | Bar writer stopped, Send to Kitchen | order, ack | full copy, kitchen; the bar slip `queued`; after a minute the panel: "Waiting for the printer (1)", "KOT round 1 · ORD-20261004-035 · Bar", "1 min · Not printed yet. · Bar"; the writer restarted printed it once (62 B) | Bar `created`, `leased`, `printed`, unlabelled |
| 4 | `assign Kitchen` onto the app, no Refresh, Send to Kitchen (Cheesecake) | order, ack; 8.6 s later `GET /api/printers`, two leases (the first left before the new list and came back empty), the Kitchen slip's ack | counter: full copy and the KITCHEN slip, 44,238 B each | Kitchen `created`, `leased`, `printed`, target the app |
| 5 | `teardown`, no Refresh; then Send to Kitchen | three wakes inside the 60 s refresh bound (the item-4 read), then a wake, `GET /api/printers`, one lease, **no wake for 80 s**; the KOT: order + ack only | 40,494 B | printer none, `leased(direct)`, `printed` |
| 6 | `adb logcat -b crash -d` | empty | | |
| 7 | Put back as found | the app's printer removed ("No printer set up"); the address back to `https://posdemo.sandbee.in` ("Olivea Pizza"; its panel, opened read-only: "No printer set up", "Each device prints its own slips"); `adb reverse --remove-all`, then `adb reverse tcp:3100 tcp:3100`; the POS, the proxy, the fake printers and the writers stopped; the emulator stopped | | |

## 2B review gate: rulings (2026-10-04)

Every ruling that changes the spec is written into spec §7.11 ("As built at the 2B review gate") and §8.1 ("As built at the 2B review gate (Session 2C)"), and the setup reads into §17.2.

**2B's findings and the gate review of `8869e63`:**

| # | Finding | Ruling |
|---|---|---|
| **I-A** (gate review; was 2B's M-1) | The Results said M-1 could not double print ("this tab is the line's only leaser"). It can, when the drain lock moves between two windows of one PC: window A's order answer is lost, its re-send arrives late (each of the order, the replay and the enqueue may take up to the 15 s request timeout), so the enqueue hands back a lease with about 45 s left; A's printer drops, the lock moves to window B, B expires the job and prints it as REPRINT at epoch 2; A's printer returns while A still holds the job (within 60 s of its arrival) and prints it again, unlabelled | **Fixed in Task C0:** `redeliveryOf` hands a lease back only while at least `PRINT_LEASE_MS − REQUEST_TIMEOUT_MS` (75 s) remain (`REQUEST_TIMEOUT_MS` is now exported from `@pos/shared/api-client`), so a held job always starts printing inside its lease; a later re-send gets Phase 1's answer, and the lease expires into one REPRINT. Leg (aq) proves both sides. The cleaner long-term form (`expiresAt` on the leased job, the hold bounded by it) is not needed while the bound holds. |
| **M-A** (new in `8869e63`) | `nextHeld()` hands back a stale job and returns a fresh one; a `stop()` landing while the cycle awaits that hand-back's ack dropped the fresh job with no ack (its lease expired into REPRINT) | **Fixed in Task C0:** it is handed back too ("printing stopped on this device"). Agent test RED → GREEN. |
| **M-B** | A hand-back whose first send failed, applied later by the 5 s retry, put its job back in line with nothing to lease it until the pulse | **Fixed in Task C0:** the answer's `nextAttemptAt` sets the agent's timer. Agent test RED → GREEN. |
| M-C | Spec §7.11 says the server ignores the hand-back for "a lease that ran out"; `planAck` checks the status and epoch, not `expiresAt`, so an unswept lease still takes it (rightly: nothing was sent). The "As built" bullet "A page that unmounts drops what it held" contradicts the I-1 amendment below it | **Fixed in the spec at this gate:** "once its expiry has been applied"; the old bullet is marked superseded. |
| M-D | `remember()` does not refresh a key's place in the 50-entry set | **Note only:** 50 `take()`s during one print are unrealistic (one line, one direct job at a time). |
| 2B M-2 | `printLineIsFree` then insert is not atomic: two concurrent requests of one tab can both be made leased on one line | **Accepted:** the same writer; both print once, in arrival order. |
| 2B M-3 | Leg (al) asserted only creation leases | **Done in Task C9:** leg (aq) asserts a lease-call lease handed back within one request timeout, and refused later. |
| 2B M-4 | Decision 15 said the agent ignores a job it "holds or has acked-pending" | **Fixed at this gate:** "holds, is printing or has printed" (decision 15 above; spec §7.11 already says so). |
| 2B M-5 | A keyed collision with the lease header reads the payload even when the answer is `already-resolved` | **Accepted:** one read per collision of a re-send that names a tab (a replay or a missing ref: rare); budget only. |
| 2B M-6 | `directReady()` may clear a stale refusal while building a header | **No change:** no behaviour change. |

**The 2C design rulings** (where the 2C items above left a choice; Session 2C implements them):

| # | Question | Ruling |
|---|---|---|
| R1 | The enqueue's answer for a slip that became several jobs | `queued` with the first id, `duplicate`, the one made leased, and every job (`jobs`); nothing routed (a notice where Notices are off, a KOT with no lines) answers `not-routed`, never a local print. |
| R2 | A staff Retry, Print again or Print now on a job whose printer is gone (deleted, switched off, no writer, or `none`) | **Refused** (`printer-gone`), never guessed onto another printer: "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order." A printer that still takes slips: back in line on its current writer (I-3 below). |
| R3 | Which line `more` asks | The acked job's own line: its printer's, or the device's simple line. |
| R4 | 2A's M9 | A device's chosen bill printer counts only when routable (enabled, with a writer, taking a slip); otherwise the default bill printer. |
| R5 | 2A's M7 | Names unique ignoring case by a pre-check (a collation strength 2 read) in create and update; the 2A indexes stay as they are on every database. |
| R6 | Who publishes `print-setup` | Printer writes only (two Worker requests per admin save): a station change moves no device's printers. |
| R7 | The dead `usePrintHostWake` hook | Stays, pinned with no call site (`print-wake.test.ts`, since Phase 1). |
| R8 | Jobs for me in printers mode | *(Replaced by I-2 below.)* Was: the device's line plus the printers it names as ready. |
| R9 | A lease that returns one job per line | The agent prints them one by one on its one printer; the rest are held (2B's held queue, its hold bound and hand-back). |
| R10 | Copies | Written `copies` times inside one lease, one after another; a failure after the first copy is "maybe" (the REPRINT repeats every copy, labelled). |
| R11 | A job failed at creation | `printerId: "none"`: simple mode's sweep never moves it; `targetDeviceId` is the asking device. |
| R12 | The host's `print-job` nudge in printers mode | None (the host plays no part); each queued job's `print-status` is aimed at its writer, unless the same request made a job leased on that printer line. |
| R13 | Who is an agent | The host; with no host every device (simple mode); in printers mode every device whose surfaces exist (widened by I-2). |

**The fresh review of 2C's golden code** (Claude Fable 5.1, read-only, `475b986..g2c` against the spec and this plan; it re-ran the ten touched cafe test files, 132/132, and the four shared ones, 98/98). Verdict "ship with fixes": no Critical; no path to two papers or a silently lost slip; one writer per printer enforced server-side wherever a device names printers; every header and id run through `printerIdsOf` and never a refused request. Each finding fixed or ruled before the 2C section was generated:

| # | Finding | Ruling |
|---|---|---|
| **I-1** | The sweep failed a bill waiting for the cashier's answer (`needs-confirm`) when its printer went, so "It printed" was lost and the row said "Couldn't print" for a bill that may be on the counter | **Fixed in Task C4:** only `queued` jobs fail; a `needs-confirm` bill keeps waiting ("It printed" and Clear still work; Print again is refused by R2). Pin and leg (ap). |
| **I-2** | A writer whose printer list is stale (a missed `print-setup` frame: the socket down, the page on screen) never learnt of its own printer's slips: the pulse and the wake counted only the printers it named, so a printer re-saved onto a phone mid-shift waited up to 30 min | **Fixed in Tasks C3, C6, C8:** jobs-for-me counts every job aimed at the device and names their printers; a device that sees a printer job on a printer it does not print on reads its list again, at most once a minute (`PRINT_SETUP_REFRESH_MIN_MS`); in printers mode every device is an agent and names itself on the pulse. No new request. Leg (ao); emulator item 4. |
| **I-3** | R2's "back on its current writer" was not implemented: a Retry kept the old target, and the new writer's lease, fenced on the target, lost its CAS every 2 s until the sweep moved the job (≈30 lease calls and ≈400 Atlas operations per such job) | **Fixed in Tasks C3 and C4:** a printer line's lease is fenced on the printer and claims the job for its (server-verified) writer in the same write; a Retry on a printer that still takes slips sets the current writer in the same write and aims the `print-status` at it. Leg (ap). |
| M-1 | A Retry on a failed-at-creation job said its printer "was removed or switched off" | **Fixed in Task C4:** the notice covers "none set up" too. |
| M-2 | `printerIsLocal` for a Windows printer ignores its name | **2E** (several printers per device needs the name; one printer per device until then). |
| M-3 | The lease took any enabled printer with a writer; the sweep fails the jobs of one that takes no slip | **Fixed in Task C3:** the lease takes only routable printers, as the sweep. |
| M-4 | The readback chip follows only a routed slip's first job | **Noted:** the waiting-slips panel shows every job (by exception); 2D or 2G may follow every job. |
| M-5 | In printers mode a host that writes no printer still kicks on every `print-job` broadcast | **Accepted:** events only (a sweep requeue, a staff Retry), bounded; 2D revisits with the setup screens. |
| M-6 | The sweep's probe counted failed rows, so it re-ran the per-printer writes every 60 s until they were pruned | **Fixed in Task C4:** the probe looks for `queued` or `needs-confirm` printer jobs only. |
| M-7 | With Notices off on every printer, void, moved and cancel notices are not routed, silently | **2D:** the printer form defaults Notices on for a printer that takes a KOT station or the full copy. |
| **E-1** (the gate's emulator run) | After every printer was removed with the frame missed, the former writer polled the wake every 15 s all day in simple mode (its stale list still said writer) | **Fixed in Task C6:** the wake answers `writesPrinters` (from the printers it already reads); a writer told false reads its list again (the same once-a-minute bound) and stops polling. Emulator item 5. |

**Gate decisions that shape 2C** (each in spec §7.11 or §8.1):
- **Printers mode routes every slip at creation, whoever asks**: the order routes, `/kot-claim` and the enqueue; the host plays no part.
- **A printer line is leased only by its writer**, fenced on the printer, claimed for that writer, one job per line; `more` asks the acked job's own line.
- **Every device is an agent in printers mode**, and a device's printer list heals both ways from the pulse and the wake (I-2, E-1), never on a timer.
- **The setup read** is `GET /api/printers` on mount, on a `print-setup` frame, on focus at most every 30 min (not 5: at 5 min a focus-happy day would take the heavy worst case past 18,000), and when a pulse or a wake shows the list stale (at most once a minute).
- **A printer job prints only on its own printer**: one that is not this device's printer is refused `sent:"no"` (never counted).

---

## Session 2C (exact code, written and pre-validated at the 2B review gate)

**Pre-validated** by the 2B review gate on 2026-10-04, on scratchpad clones only (never in the repo):
- The code was developed on a golden copy of `475b986` (this branch's head at the gate), one commit per task, and this section was generated from those commits: every Create block is the golden file byte for byte, and every find is unique in its file at the moment it is applied.
- A fresh clone of `feat/printing-phase-2` at `475b986` then got every block of this section applied verbatim, task by task, with each task's own Run lines; each RED and GREEN below is the output seen there. Its tree came out **identical** to the golden copy's (`d38dc5d…`). Every suite below was run on that tree (the golden copy).
- Totals on that code: shared `npm test` **679/679** (+7 over `475b986`'s 672), tsc 0; cafe `npm test` **4350 tests, 4349 pass, 0 fail, 1 skipped** (+28 over 4322; the skip is Phase 1's `go-live-dl` pin), tsc 0, lint 0 errors and the 2 old warnings; Hub tsc 0; mobile 117/117 and Jest 3/3, desktop 191/191 (untouched); print tools 8/8; live legs **`302 passed, 0 failed`** (272 + 30); the Next build lists **127 routes** (2C adds none). 70 files, +1,922 / −233.
- **Reviewed and run on the emulator before it was generated.** A fresh reviewer read the golden code (I-1, I-2, I-3 and minors), and the gate ran it on the emulator (`Pixel_7_API_33`, WebView 109, the release APK `29115bdf…`) against the golden build of the POS through the counting proxy (E-1). Every fix is in Tasks C3, C4, C6 and C8. The final build then passed Task C10 Step 4's items 1–7, in that order: see "Session 2B review (gate)" → "Pre-validating 2C on the emulator".

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 2C delivers** (spec §8, §9.1, §9.3; plan decisions 1–9, 15, 16). **Printers mode goes live.** Once an enabled printer takes a slip (spec §6.6), every slip an order request, the self-order claim or a client-started enqueue makes is routed to printers: one job per printer line, aimed at that printer's one writer, with its copies, under a key that adds the printer and the part; a slip no printer takes is made failed at once, visibly. Each device reads the outlet's printers, and in printers mode every device is an agent (no host plays a part): a writer leases its printers' lines (one job per line, only the printers it writes), prints them on its one local printer (only a printer that IS that printer), every copy inside one lease, and the KOT's station line prints under its title. The asking device's first slip on a printer it writes is made leased to it (2B's direct print, per printer line). The sweep moves a waiting printer job with its printer's writer, or fails it when its printer is gone; a staff Retry puts a job on its printer's current writer, or is refused when its printer is gone; the repair routes a server-owned round that has no job; the wake allowance is split by the setup's writers, and every writer polls against its share (2A's Important 1). A device whose printer list missed a `print-setup` frame reads it again from its next pulse or wake. Removing every printer returns the cafe to simple mode. **A cafe with no printer set up (every live cafe today) prints exactly as before:** one more small read per order request (the printers), and nothing else changes.

**Gate rulings this section implements** (see "2B review gate: rulings"): the 2B gate's fixes I-A, M-A, M-B (Task C0); R1 (the enqueue's answer for a slip that became several jobs), R2 (a retry on a gone printer is refused), R3 (`more` per line), R4 (2A's M9), R5 (2A's M7), R6 (`print-setup` on printer writes), R7 (the dead wake hook stays pinned), R9 (several jobs from one lease), R10 (copies), R11 (`printerId: "none"`), R12 (no host nudge in printers mode), R13 (who is an agent, widened by I-2); 2A's Important 1 (C5, C6); the fresh review of 2C's golden code: I-1 (C4), I-2 (C3, C6, C8; it replaces R8), I-3 (C3, C4), M-1 (C4), M-3 (C3), M-6 (C4); the gate's emulator run: E-1 (C6).

**Not in 2C:** the setup screens (2D: Printers, Stations, Devices, "Set up printers", the device's bill printer picker; 2A's M3, M4, M5 and the full-copy station boxes), several printers per device (2E), Android bridge v2 (2F). No Kotlin, Windows or mobile change: **the APKs stay byte-identical to the release.** The Worker's kind list gains `print-setup` (the go-live run deploys the Worker first; an older Worker refuses the unknown kind, which costs only the frame: devices still read their printers on mount, on focus, and when a pulse or a wake shows their list stale).

### Review Focus (Session 2C)

The inputs most likely to bite a cafe that the unit tests alone would not exercise; each has a live leg, a test or an emulator item.
1. **A round with kitchen and bar items, ordered at the counter:** the kitchen and bar slips print once each at their own printers, with their station lines; the counter's full copy prints at once with no lease request (direct print per printer line); Pay Now's bill follows it, with its copies. → leg (an); emulator items 1 and 2.
2. **A printer's writer is off:** its slips wait visibly (the panel names the printer), every other printer still prints, and nothing polls in a loop. → leg (ao) ("a stuck bar job never blocks the kitchen"); emulator item 3.
3. **A printer re-saved with another writer, switched off or deleted while slips wait:** the slips follow the new writer (a job still aimed at the old one is leased and claimed by the new one), or fail visibly with the reason; a bill waiting for the cashier's answer keeps waiting; a staff Retry on a gone printer is refused, never guessed onto another printer. → leg (ap).
4. **A printer list that missed its `print-setup` frame** (the Worker down, a socket dropped): a device just made a printer's writer prints its slips within about a minute, and a former writer stops polling the wake. → leg (ao) (jobs-for-me names the printers); `printerListLooksStale`; emulator items 4 and 5.
5. **The cafe goes back to simple mode** (every printer removed): new slips print at the host, or on each device, exactly as before. → emulator item 5; leg (aj)'s reset.
6. **A lost answer, a replay or a repair in printers mode:** the routed keys collide, never a second paper; a lease is handed back only within one request timeout (C0). → legs (an), (aq).

### File map (Session 2C)

| File | Change | Task |
|---|---|---|
| `packages/shared/src/api-client.ts`, `apps/cafe/lib/print-direct.ts`, `apps/cafe/lib/print-agent.ts` (+ tests) | the 2B gate's fixes | C0 |
| `packages/shared/src/print-agent-wire.ts`, `print-printers.ts`, `print-lifecycle.ts`, `print-job.ts` (+ tests) | the contract: headers, `printerId`/`copies` on the wire, failed at creation, `printerIdsOf` | C1 |
| `apps/cafe/lib/print-job-insert.ts` (create), `lib/print-printer-jobs.ts` (create), `lib/print-order-jobs.ts`, `lib/print-direct.ts`, `lib/print-lease.ts`, the six order routes, `lib/print-agent-server.ts`, `app/api/print-jobs/route.ts` (+ tests, `package.json`) | creation in printers mode | C2 |
| `apps/cafe/lib/print-lease.ts`, `lib/print-lifecycle-schemas.ts`, the lease route, `scripts/print-host-live/printers.ts`, `packages/shared/src/print-agent-wire.ts`, `self-order-alert.ts`, `print-lifecycle.ts` (+ tests) | a lease per printer line, claimed for its writer; `more` per line; jobs-for-me counts every job aimed at the device | C3 |
| `apps/cafe/lib/print-sweep.ts`, `lib/print-queue.ts`, `lib/print-repair.ts`, `lib/print-job-actions.ts`, `lib/print-waiting.ts` (+ tests) | the sweep, the repair, a retry | C4 |
| `packages/shared/src/print-agent-wire.ts`, the wake route, `lib/print-printer-routing.ts`, `lib/print-stations.ts`, `lib/print-printers.ts`, `lib/realtime-publish.ts`, `workers/realtime/src/index.ts` (+ tests) | the writers' wake allowance, M9, M7, `print-setup` | C5 |
| `apps/cafe/lib/print-agent-printers.ts` (create), `hooks/use-agent-printers.ts` (create), `lib/print-agent-seams.ts`, `lib/print-agent-calls.ts`, `lib/print-agent.ts`, `hooks/use-print-agent.ts`, `components/print/PrintHostDrain.tsx`, the wake route, `packages/shared/src/print-agent-wire.ts` (+ tests, `package.json`) | the page's agent in printers mode; a stale list read again | C6 |
| `apps/cafe/lib/print-agent-printers.ts`, `hooks/use-print-agent.ts`, `lib/print-host-slips.ts`, `components/pos/KOTReceipt.tsx`, `PrintSources.tsx`, `components/print/PrintHostPrintSources.tsx`, `lib/print-attention.ts`, `lib/print-waiting.ts`, `components/print/WaitingSlipsCard.tsx` (+ tests) | printing on the device, the station line, the panel | C7 |
| `packages/shared/src/print-budget.ts`, `apps/cafe/hooks/use-agent-printers.ts`, `hooks/use-print-agent.ts` (+ tests) | the recount | C8 |
| `apps/cafe/scripts/print-host-live/printers-mode.ts` (create), `scripts/verify-print-host-live.ts` | live legs an–aq | C9 |
| this plan | Session 2C Results | C10 |

The tasks run in this order: C0 → C9 (each one commit), then C10 (verification, the emulator exit check, the fresh review, Results).

---

### Task C0: the 2B review gate's fixes: a lease handed back only within one request timeout, a stop during a hand-back, and a refusal applied later

**Files:**
- Modify: `packages/shared/src/api-client.ts` (`REQUEST_TIMEOUT_MS` exported)
- Modify: `apps/cafe/lib/print-direct.ts` (`redeliveryOf`: the re-delivery bound)
- Modify: `apps/cafe/lib/print-agent.ts` (a stop() during the hand-back flush hands back the job the cycle took; a refusal applied by the retry sets the timer; the hand-back reasons as constants)
- Tests: `apps/cafe/lib/print-direct.test.ts` (one new test), `apps/cafe/lib/print-agent.test.ts` (two new tests)

**Interfaces produced:** `REQUEST_TIMEOUT_MS` (15 s) exported from `@pos/shared/api-client`; `redeliveryOf` answers null for a lease older than one request timeout.

**I-A (the 2B gate's fresh review, Important; the old M-1).** Window A's order answer is lost; its re-send arrives late (a slow link: the order times out at 15 s, the replay and the enqueue take up to 15 s each), so the enqueue hands back a lease with about 45 s left. A's printer drops, the drain lock moves to window B, B's lease call expires the job and prints it as REPRINT at epoch 2; A's printer returns while A still holds the job (60 s from its arrival) and prints it again, unlabelled. `redeliveryOf` now refuses a lease that began more than one request timeout ago (`PRINT_LEASE_MS − REQUEST_TIMEOUT_MS` left), so a job the agent holds always starts printing inside its lease; a later re-send gets Phase 1's answer and the lease expires into one REPRINT.

**M-A (minor, new in `8869e63`).** `nextHeld()` hands back a stale job and returns a fresh one; the cycle then awaits that hand-back's ack. A `stop()` landing in the wait used to drop the fresh job with no ack (its lease expired into a REPRINT); it is handed back too. **M-B (minor).** A refusal whose first send got no answer, applied later by the 5 s retry, put its job back in line with nothing to lease it until the pulse; its answer's `nextAttemptAt` now sets the agent's timer.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  assert.deepEqual(stopping.w.acks.map((a) => [a.id, a.body.outcome, a.body.sent]), [["held", "failed", "no"]], "and hands it back at once");
});

test("2B: taken jobs wait their turn (first in, first out) and for an open gate; stop drops them unprinted", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false), done(false));
```

Replace it with:

```ts
  assert.deepEqual(stopping.w.acks.map((a) => [a.id, a.body.outcome, a.body.sent]), [["held", "failed", "no"]], "and hands it back at once");
});

// The 2B review gate (M-A): the cycle took a fresh held job out of the queue, then waited for the ack of a stale
// one it had just handed back; a stop() landing in that wait dropped the fresh job with no ack at all.
test("2B gate: a stop() while a hand-back is on the wire hands back the job the cycle already took", async () => {
  const { w, deps } = world();
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      if (id === "stale") agentRef?.stop(); // the page goes away while the stale job's refusal is on the wire
      return deps.ack(id, body);
    },
  });
  agentRef = agent;
  agent.take(job("stale"));
  await advance(w, PRINT_DIRECT_HOLD_MS);
  agent.take(job("fresh"));
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, [], "nothing prints on a stopped page");
  assert.deepEqual(
    w.acks.map((a) => [a.id, a.body.sent]),
    [["stale", "no"], ["fresh", "no"]],
    "both handed back, so neither waits 90 s to expire into a REPRINT",
  );
});

// The 2B review gate (M-B): a refusal whose first send got no answer was applied later by the 5 s retry, but
// nothing then leased the job it put back in line: it waited for the pulse.
test("2B gate: a refusal applied by the retry sets the agent's timer from its answer", async () => {
  const { w, deps } = world();
  const agent = createPrintAgent(deps);
  agent.take(job("late"));
  await advance(w, PRINT_DIRECT_HOLD_MS);
  w.ackAnswers.push(new ApiError("offline", "network", null));
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "the cycle's lease after the hand-back (its ack got no answer)");
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(w.now + PRINT_ACK_RETRY_MS + 2_000).toISOString() });
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.deepEqual(w.acks.map((a) => a.body.sent), ["no", "no"], "re-sent at 5 s, and applied");
  await advance(w, 2_000);
  assert.equal(w.leaseCalls, 2, "the job back in line is leased when its backoff ends, not at the next pulse");
  agent.stop();
});

test("2B: taken jobs wait their turn (first in, first out) and for an open gate; stop drops them unprinted", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false), done(false));
```

In `apps/cafe/lib/print-direct.test.ts`, find:

```ts
import { fileURLToPath } from "node:url";
import path from "node:path";
import mongoose from "mongoose";
import { PRINT_LEASE_MS, directLeaseOf } from "@pos/shared/print-lifecycle";
import { stripComments } from "@/lib/source-pin-utils";
import { announcesQueuedJob, redeliveryOf, type PrintRedeliveryRow } from "@/lib/print-direct";
```

Replace it with:

```ts
import { fileURLToPath } from "node:url";
import path from "node:path";
import mongoose from "mongoose";
import { REQUEST_TIMEOUT_MS } from "@pos/shared/api-client";
import { PRINT_LEASE_MS, directLeaseOf } from "@pos/shared/print-lifecycle";
import { stripComments } from "@/lib/source-pin-utils";
import { announcesQueuedJob, redeliveryOf, type PrintRedeliveryRow } from "@/lib/print-direct";
```

In `apps/cafe/lib/print-direct.test.ts`, find:

```ts
  for (const [label, r, who, nowMs] of cases) assert.equal(redeliveryOf(r, who, nowMs), null, label);
});

test("announcesQueuedJob: a new queued job is announced; never a job made leased, a job found under its key, or one its line's tab is printing past", () => {
  assert.equal(announcesQueuedJob({ created: true, status: "queued" }, false), true, "Phase 1: another device or tab prints it");
  assert.equal(announcesQueuedJob({ created: true, status: "leased" }, true), false, "made leased: the asking tab is printing it now");
```

Replace it with:

```ts
  for (const [label, r, who, nowMs] of cases) assert.equal(redeliveryOf(r, who, nowMs), null, label);
});

// The 2B review gate (I-A): a re-send that arrived late could be held by a tab that then lost its drain lock,
// and print after its lease ran out, beside another window's REPRINT. A lease is handed back only within one
// request timeout of its start, so the agent's 60 s hold always starts its print inside the lease.
test("redeliveryOf: a lease is handed back only within one request timeout of its start; an older one is left to expire", () => {
  assert.ok(redeliveryOf(row(), WHO, T0 + REQUEST_TIMEOUT_MS) !== null, "a re-send within one request timeout gets the lease back");
  assert.equal(redeliveryOf(row(), WHO, T0 + REQUEST_TIMEOUT_MS + 1), null, "later: Phase 1's answer, and the lease expires into one REPRINT");
});

test("announcesQueuedJob: a new queued job is announced; never a job made leased, a job found under its key, or one its line's tab is printing past", () => {
  assert.equal(announcesQueuedJob({ created: true, status: "queued" }, false), true, "Phase 1: another device or tab prints it");
  assert.equal(announcesQueuedJob({ created: true, status: "leased" }, true), false, "made leased: the asking tab is printing it now");
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-direct.test.ts lib/print-agent.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 45`; `# pass 42`; `# fail 3`

- [ ] **Step 3: The code**

In `apps/cafe/lib/print-agent.ts`, find:

```ts
 *  lease with a margin. Later the lease may have run out and another attempt (a REPRINT) be on paper, so the
 *  held job is dropped unprinted. */
export const PRINT_DIRECT_HOLD_MS = PRINT_LEASE_MS - 30_000;

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
```

Replace it with:

```ts
 *  lease with a margin. Later the lease may have run out and another attempt (a REPRINT) be on paper, so the
 *  held job is dropped unprinted. */
export const PRINT_DIRECT_HOLD_MS = PRINT_LEASE_MS - 30_000;
/** Why a held job went back to its line unprinted: its refusal's error (the waiting-slips panel may show it). */
const HELD_TOO_LONG = "held too long on this device";
const PRINTING_STOPPED = "printing stopped on this device";

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  function nextHeld(): LeasedPrintJob | undefined {
    for (let next = held.shift(); next !== undefined; next = held.shift()) {
      if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;
      handBack(next.job, "held too long on this device");
    }
    return undefined;
  }
```

Replace it with:

```ts
  function nextHeld(): LeasedPrintJob | undefined {
    for (let next = held.shift(); next !== undefined; next = held.shift()) {
      if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;
      handBack(next.job, HELD_TOO_LONG);
    }
    return undefined;
  }
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  /** A held job dropped unprinted goes back to its line as a refusal (sent:"no", never counted), kept and sent
   *  like any ack: this tab knows nothing of it reached a printer, so it prints again unlabelled rather than
   *  expiring into a REPRINT (a bill: the cashier's question). The server takes it only while the job is still
   *  leased at that epoch; a lease that ran out, or a new one, ignores it (the final review, I-1). */
  function handBack(job: LeasedPrintJob, why: string): void {
    keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: { deviceId: deps.deviceId, epoch: job.epoch, outcome: "failed", sent: "no", error: why } });
    handedBack = true;
```

Replace it with:

```ts
  /** A held job dropped unprinted goes back to its line as a refusal (sent:"no", never counted), kept and sent
   *  like any ack: this tab knows nothing of it reached a printer, so it prints again unlabelled rather than
   *  expiring into a REPRINT (a bill: the cashier's question). The server takes it only while the job is still
   *  leased at that epoch; once its expiry is applied, or a new lease made, it is ignored (the final review, I-1). */
  function handBack(job: LeasedPrintJob, why: string): void {
    keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: { deviceId: deps.deviceId, epoch: job.epoch, outcome: "failed", sent: "no", error: why } });
    handedBack = true;
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
        continue;
      }
      try {
        remember(answers, `${entry.id}:${entry.epoch}`, await deps.ack(entry.id, entry.fail ?? { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" }));
        forget(entry);
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
      }
```

Replace it with:

```ts
        continue;
      }
      try {
        const answer = await deps.ack(entry.id, entry.fail ?? { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        remember(answers, `${entry.id}:${entry.epoch}`, answer);
        forget(entry);
        // A refusal sent again and applied put its job back in line: lease it when its backoff ends (the 2B gate, M-B).
        if (entry.fail !== undefined && answer.nextAttemptAt !== null) wakeAt(Date.parse(answer.nextAttemptAt));
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
      }
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
        // A held job dropped just now frees its lease first, so the lease below can reach it (I-1).
        handedBack = false;
        await flushAcks();
        if (stopped) return;
      }
      if (job === undefined) {
        // Only a held job prints past the lease gate; with none left (I-1), the gate decides as always.
```

Replace it with:

```ts
        // A held job dropped just now frees its lease first, so the lease below can reach it (I-1).
        handedBack = false;
        await flushAcks();
        if (stopped) {
          // A stop() during that ack: the job this cycle already took is handed back too (the 2B gate, M-A).
          if (job !== undefined) handBack(job, PRINTING_STOPPED);
          void flushAcks();
          return;
        }
      }
      if (job === undefined) {
        // Only a held job prints past the lease gate; with none left (I-1), the gate decides as always.
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
      stopped = true;
      // A job still held is dropped and handed back (I-1), sent now or by the next page's first flush; with
      // neither, its lease expires (KOT: REPRINT; bill: the cashier), as for a tab that died.
      for (const h of held.splice(0)) handBack(h.job, "printing stopped on this device");
      if (timer !== null) deps.clearTimer(timer);
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      timer = null;
```

Replace it with:

```ts
      stopped = true;
      // A job still held is dropped and handed back (I-1), sent now or by the next page's first flush; with
      // neither, its lease expires (KOT: REPRINT; bill: the cashier), as for a tab that died.
      for (const h of held.splice(0)) handBack(h.job, PRINTING_STOPPED);
      if (timer !== null) deps.clearTimer(timer);
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      timer = null;
```

In `apps/cafe/lib/print-direct.ts`, find:

```ts
import type { Types } from "mongoose";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { lifecycleOf, type PrintJobLease } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { leasedJobOf, printJobLineFilter } from "@/lib/print-lease";
```

Replace it with:

```ts
import type { Types } from "mongoose";
import { REQUEST_TIMEOUT_MS } from "@pos/shared/api-client";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { PRINT_LEASE_MS, lifecycleOf, type PrintJobLease } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { leasedJobOf, printJobLineFilter } from "@/lib/print-lease";
```

In `apps/cafe/lib/print-direct.ts`, find:

```ts
/** A job its key already names that is still leased to the asking device's very tab, its lease still running:
 *  the answer that carried it was lost (spec §7.11), so the same lease is handed over again. The agent ignores a
 *  job it already holds (its id and epoch), so a delivery that did arrive still prints once. Anything else:
 *  null, and the caller answers as in Phase 1 (a tab reloaded since has a new id; its lease expires). */
export function redeliveryOf(row: PrintRedeliveryRow, who: { deviceId: string; tabId: string }, nowMs: number): LeasedPrintJob | null {
  const job = lifecycleOf(row);
  const lease = job.lease;
  if (job.status !== "leased" || lease === undefined || row.payload === undefined || row.targetDeviceId !== who.deviceId) return null;
  if (lease.deviceId !== who.deviceId || lease.tabId !== who.tabId || lease.epoch !== job.epoch || lease.expiresAt.getTime() <= nowMs) return null;
  let payload: PrintJobPayload;
  try {
    const parsed = printJobPayloadSchema.safeParse(JSON.parse(row.payload) as unknown);
```

Replace it with:

```ts
/** A job its key already names that is still leased to the asking device's very tab, its lease still running:
 *  the answer that carried it was lost (spec §7.11), so the same lease is handed over again. The agent ignores a
 *  job it already holds (its id and epoch), so a delivery that did arrive still prints once. Anything else:
 *  null, and the caller answers as in Phase 1 (a tab reloaded since has a new id; its lease expires).
 *  The 2B review gate (I-A): only within one request timeout of the lease's start. The agent may hold a job 60 s
 *  (PRINT_DIRECT_HOLD_MS) while its drain lock is elsewhere; a later hand-back could print after the lease ran out,
 *  beside another window's REPRINT. An older lease is left to expire into one REPRINT (a bill: the cashier). */
export function redeliveryOf(row: PrintRedeliveryRow, who: { deviceId: string; tabId: string }, nowMs: number): LeasedPrintJob | null {
  const job = lifecycleOf(row);
  const lease = job.lease;
  if (job.status !== "leased" || lease === undefined || row.payload === undefined || row.targetDeviceId !== who.deviceId) return null;
  if (lease.deviceId !== who.deviceId || lease.tabId !== who.tabId || lease.epoch !== job.epoch || lease.expiresAt.getTime() <= nowMs) return null;
  if (lease.expiresAt.getTime() - nowMs < PRINT_LEASE_MS - REQUEST_TIMEOUT_MS) return null;
  let payload: PrintJobPayload;
  try {
    const parsed = printJobPayloadSchema.safeParse(JSON.parse(row.payload) as unknown);
```

In `packages/shared/src/api-client.ts`, find:

```ts

// A network blip mid-request must fail visibly, not hang the caller forever
// (e.g. a cashier staring at a spinner mid-settle with no idea whether the
// sale landed). Both read and write paths abort after this ceiling.
const REQUEST_TIMEOUT_MS = 15 * 1000;

type ApiEnvelope<T> =
  | { success: true; data: T }
```

Replace it with:

```ts

// A network blip mid-request must fail visibly, not hang the caller forever
// (e.g. a cashier staring at a spinner mid-settle with no idea whether the
// sale landed). Both read and write paths abort after this ceiling. Exported for the print server's
// re-delivery bound (Phase 2, the 2B review gate: a lease is handed back only within one request timeout).
export const REQUEST_TIMEOUT_MS = 15 * 1000;

type ApiEnvelope<T> =
  | { success: true; data: T }
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-direct.test.ts lib/print-agent.test.ts lib/print-agent-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 52`; `# pass 52`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-agent.ts lib/print-direct.ts lib/print-agent.test.ts lib/print-direct.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts apps/cafe/lib/print-direct.test.ts apps/cafe/lib/print-direct.ts packages/shared/src/api-client.ts
git commit -m "fix(print): the 2B review gate: a lease is handed back only within one request timeout of its start, a stop during a hand-back hands back the job the cycle took, and a refusal applied later sets the agent's timer"
```

---

### Task C1: the shared contract: the ready and bill-printer headers, a job's printer and copies on the wire, a slip made failed at creation, and the printers a device names

**Files:**
- Modify: `packages/shared/src/print-agent-wire.ts` (`PRINT_READY_HEADER`, `PRINT_BILL_PRINTER_HEADER`; `PrintJobRef.printerId?`; `LeasedPrintJob.printerId?`, `copies?`; `PrintAttentionRow.printerId?`; the refusal `printer-gone`)
- Modify: `packages/shared/src/print-printers.ts` (`PRINT_JOB_NO_PRINTER`, `PRINTER_GONE_MESSAGE`, `routablePrinterOf`, `printerIdsOf`)
- Modify: `packages/shared/src/print-lifecycle.ts` (`printJobFailedAtCreation`)
- Modify: `packages/shared/src/print-job.ts` (`PrintJobEnqueueResult`: `jobs?` on queued; `not-routed`)
- Tests: `packages/shared/src/print-printers.test.ts`, `print-lifecycle.test.ts`, `print-job.test.ts` (one new test each)

**Interfaces produced:** `PRINT_READY_HEADER = "x-pos-print-ready"`; `PRINT_BILL_PRINTER_HEADER = "x-pos-bill-printer"`; `PRINT_JOB_NO_PRINTER = "none"`; `PRINTER_GONE_MESSAGE`; `routablePrinterOf(printers, id): PrinterConfig | null`; `printerIdsOf(raw: string | string[] | null | undefined): string[]` (printer ids only, each once, at most `PRINTERS_MAX`); `printJobFailedAtCreation({ labels, error, originDeviceId?, nowMs })`; `PrintJobEnqueueResult` gains `{ outcome: "queued"; …; jobs? }` and `{ outcome: "not-routed" }`.

**Everything new is optional on the wire.** An older client sends no ready or bill-printer header and reads no `printerId`, `copies` or `jobs`; an older server answers none. Unusable printer ids are dropped (`printerIdsOf`), never a refused request.

**A slip no printer takes is never dropped** (spec §8): it is made failed in the write that creates it, never attempted (`printJobFailedAtCreation`: status `failed`, its reason as `lastError`, the log `created` then `failed`), and a staff Retry queues it unlabelled. It carries `printerId: "none"` so simple mode's sweep never moves it to a host (the 2B gate's ruling R11).

- [ ] **Step 1: The failing tests first**

In `packages/shared/src/print-job.test.ts`, find:

```ts
import {
  printHostOffline,
  printJobDrainCandidate,
  printJobPayloadWithinCap,
  printOrderSnapshot,
  PRINT_HOST_OFFLINE_MS,
```

Replace it with:

```ts
import {
  printHostOffline,
  printJobDrainCandidate,
  printJobEnqueueAllowsLocalPrint,
  printJobPayloadWithinCap,
  printOrderSnapshot,
  PRINT_HOST_OFFLINE_MS,
```

In `packages/shared/src/print-job.test.ts`, find:

```ts
  assert.ok("name" in itemShape, "item schema must expose name");
});

```

Replace it with:

```ts
  assert.ok("name" in itemShape, "item schema must expose name");
});

// Phase 2 Session 2C: a slip no printer takes for a reason staff chose (Notices off) is answered "not-routed".
test("2C: only no-host lets a caller print a slip itself; not-routed never does", () => {
  assert.equal(printJobEnqueueAllowsLocalPrint("no-host"), true, "simple mode with no host: today's local print");
  for (const outcome of ["queued", "already-resolved", "too-large", "not-routed"] as const) {
    assert.equal(printJobEnqueueAllowsLocalPrint(outcome), false, outcome);
  }
});

```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  planRetry,
  printBackoffMs,
  printBannerText,
  printJobInitialLabels,
  printJobLifecycleInit,
  printJobStale,
```

Replace it with:

```ts
  planRetry,
  printBackoffMs,
  printBannerText,
  printJobFailedAtCreation,
  printJobInitialLabels,
  printJobLifecycleInit,
  printJobStale,
```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  assert.equal(late.log.event, "late-ack", "a late ack from its tab still resolves it (spec §7.9)");
});

```

Replace it with:

```ts
  assert.equal(late.log.event, "late-ack", "a late ack from its tab still resolves it (spec §7.9)");
});

// Phase 2 Session 2C (spec §8: a KOT is never dropped): a slip no printer takes is made failed at once, in the
// write that creates it, so staff see it under "Couldn't print".
test("failed at creation: never attempted, its reason kept and logged, and a staff Retry queues it unlabelled", () => {
  const made = printJobFailedAtCreation({ labels: [], error: "No printer is set up for bills.", originDeviceId: "dev-a", nowMs: T0 });
  assert.deepEqual(
    [made.status, made.epoch, made.attempts, made.uncertainAttempts, made.lastError, made.labels],
    ["failed", 0, 0, 0, "No printer is set up for bills.", []],
    "nothing was attempted, so nothing can be on paper",
  );
  assert.deepEqual(
    made.log.map((entry) => [entry.event, entry.deviceId, entry.detail]),
    [["created", "dev-a", undefined], ["failed", undefined, "no printer: No printer is set up for bills."]],
    "its history says why",
  );
  const row = lifecycleOf({ kind: "bill", status: made.status, createdAt: new Date(T0), epoch: made.epoch, attempts: made.attempts, uncertainAttempts: made.uncertainAttempts, nextAttemptAt: made.nextAttemptAt, labels: made.labels });
  const retried = patchOf(planRetry(row, T0 + 1_000));
  assert.deepEqual([retried.status, retried.set.labels], ["queued", []], "a Retry queues it with no DUPLICATE: it never printed");
  assert.deepEqual(printJobFailedAtCreation({ labels: ["REPRINT"], error: "x", nowMs: T0 }).labels, ["REPRINT"], "a staff reprint keeps its label");
});

```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
import assert from "node:assert/strict";
import {
  DEFAULT_STATION_NAME,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_PAPER_WIDTHS,
  defaultBillPrinterOf,
  defaultStationOf,
  printKotStationHeader,
  printNoPrinterMessage,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
  printersModeOn,
  resolveStationId,
  routablePrinters,
  type PrinterConfig,
  type StationConfig,
```

Replace it with:

```ts
import assert from "node:assert/strict";
import {
  DEFAULT_STATION_NAME,
  PRINTERS_MAX,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_PAPER_WIDTHS,
  PRINT_JOB_NO_PRINTER,
  defaultBillPrinterOf,
  defaultStationOf,
  printKotStationHeader,
  printNoPrinterMessage,
  printerIdsOf,
  printerTakesSlips,
  printerWriterDeviceId,
  printerWriterDevices,
  printersModeOn,
  resolveStationId,
  routablePrinterOf,
  routablePrinters,
  type PrinterConfig,
  type StationConfig,
```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
  assert.equal(printJobPayloadSchema.safeParse(bill).success, false, "only a KOT names a station");
});

```

Replace it with:

```ts
  assert.equal(printJobPayloadSchema.safeParse(bill).success, false, "only a KOT names a station");
});

// Phase 2 Session 2C: the printers a device names in a request (the ready header, the lease body, the pulse),
// and the printer a waiting job still has.
test("2C: the printers a device names are printer ids only, each once, at most twelve; a gone printer is not routable", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printerIdsOf(`${a}, ${b},${a}`), [a, b], "a header: trimmed, each once, in order");
  assert.deepEqual(printerIdsOf([a, "nope", "", b]), [a, b], "a body: anything that is not a printer id is dropped");
  assert.deepEqual([printerIdsOf(null), printerIdsOf(undefined), printerIdsOf("")], [[], [], []], "none named");
  const many = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(24, "0"));
  assert.equal(printerIdsOf(many).length, PRINTERS_MAX, "never more than a cafe can have");
  const printers = [printer("p1"), printer("p2", { enabled: false }), printer("p3", { slips: NO_SLIPS })];
  assert.equal(routablePrinterOf(printers, "p1")?.id, "p1", "enabled, with a writer, taking a slip");
  assert.equal(routablePrinterOf(printers, "p2"), null, "switched off");
  assert.equal(routablePrinterOf(printers, "p3"), null, "takes no slip");
  assert.equal(routablePrinterOf(printers, "p9"), null, "removed");
  assert.equal(routablePrinterOf(printers, PRINT_JOB_NO_PRINTER), null, "the no-printer mark is never a printer");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts src/print-lifecycle.test.ts src/print-job.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 32`; `# pass 30`; `# fail 2`

- [ ] **Step 3: The code**

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
 *  (PrintJobRef.leased): the tab prints at once, with no lease request and no realtime message. Optional like
 *  every print header: an absent or unusable one only means the slip is made queued, as in Phase 1. */
export const PRINT_LEASE_HEADER = "x-pos-print-lease";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
```

Replace it with:

```ts
 *  (PrintJobRef.leased): the tab prints at once, with no lease request and no realtime message. Optional like
 *  every print header: an absent or unusable one only means the slip is made queued, as in Phase 1. */
export const PRINT_LEASE_HEADER = "x-pos-print-lease";
/** Phase 2 Session 2C (printers mode, spec §8, plan decision 15): beside PRINT_LEASE_HEADER, the printers this
 *  tab can print on right now ("id,id"). A slip routed to one of them, on a printer this device writes, may be
 *  made already leased to the tab. Unusable ids are dropped (printerIdsOf), never a refused request. */
export const PRINT_READY_HEADER = "x-pos-print-ready";
/** Session 2C (plan decision 7): this device's own bill printer (an id), chosen on the device (Session 2D). An
 *  unknown, switched-off or unusable one means the default bill printer; it never refuses the order write. */
export const PRINT_BILL_PRINTER_HEADER = "x-pos-bill-printer";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  /** Session 2B (spec §7.11): the job is leased to the asking tab (made so now, or still so from a request
   *  whose answer was lost). The tab prints it at once and acks it; no lease request. */
  leased?: LeasedPrintJob;
}

/** Session 1D (spec §10): one row of the one waiting-slips panel. Every device reads the same feed on the
```

Replace it with:

```ts
  /** Session 2B (spec §7.11): the job is leased to the asking tab (made so now, or still so from a request
   *  whose answer was lost). The tab prints it at once and acks it; no lease request. */
  leased?: LeasedPrintJob;
  /** Session 2C (printers mode): the printer the job prints on; PRINT_JOB_NO_PRINTER when none takes it (the
   *  job is failed at creation). Absent in simple mode. */
  printerId?: string;
}

/** Session 1D (spec §10): one row of the one waiting-slips panel. Every device reads the same feed on the
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  targetDeviceId?: string;
  /** Staff already tapped Print now / Retry / Print again on it (approvedAt): it waits for its printer. */
  approved?: true;
}

/** The feed is one bounded read on the hottest poll, within the queued retention (§7.8): the NEWEST rows
```

Replace it with:

```ts
  targetDeviceId?: string;
  /** Staff already tapped Print now / Retry / Print again on it (approvedAt): it waits for its printer. */
  approved?: true;
  /** Session 2C (printers mode): the job's printer, so the panel can name it. */
  printerId?: string;
}

/** The feed is one bounded read on the hottest poll, within the queued retention (§7.8): the NEWEST rows
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  copyIndex: number;
  /** 1 for the first lease of this job. */
  attempt: number;
}

/** retryAt: when the head of this device's line can next be leased (backoff, or another tab's live
```

Replace it with:

```ts
  copyIndex: number;
  /** 1 for the first lease of this job. */
  attempt: number;
  /** Session 2C (printers mode): the printer this job is for, and how many copies to write in this one lease
   *  (absent: 1). Absent printerId: the device's own simple-mode line. */
  printerId?: string;
  copies?: number;
}

/** retryAt: when the head of this device's line can next be leased (backoff, or another tab's live
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  retryAt: string | null;
}

export type PrintJobActionRefusal = PrintJobRefusal | "not-found" | "raced";

export interface PrintAckData {
  applied: boolean;
```

Replace it with:

```ts
  retryAt: string | null;
}

/** "printer-gone" (Session 2C): a Retry or Print again on a job whose printer was removed or switched off; it is
 *  never guessed onto another printer (staff print the slip again from its order). */
export type PrintJobActionRefusal = PrintJobRefusal | "not-found" | "raced" | "printer-gone";

export interface PrintAckData {
  applied: boolean;
```

In `packages/shared/src/print-job.ts`, find:

```ts
import type { printOrderSnapshotSchema } from "./schemas/print-job.schema";
import type { Order } from "./types";
import type { PrintHostPrinterState } from "./print-host-printer";
import type { LeasedPrintJob } from "./print-agent-wire";

/** The five thermal documents + reprint/notice paths a `PrintJob` can carry.
 *  `"cancel-notice"` is the "Notify Kitchen" stop for an already-cancelled
```

Replace it with:

```ts
import type { printOrderSnapshotSchema } from "./schemas/print-job.schema";
import type { Order } from "./types";
import type { PrintHostPrinterState } from "./print-host-printer";
import type { LeasedPrintJob, PrintJobRef } from "./print-agent-wire";

/** The five thermal documents + reprint/notice paths a `PrintJob` can carry.
 *  `"cancel-notice"` is the "Notify Kitchen" stop for an already-cancelled
```

In `packages/shared/src/print-job.ts`, find:

```ts
 *  can still track the job the tap referred to.
 *  Phase 2 Session 2B (spec §7.11): `leased` is a job leased to the asking tab (made so now, or still so
 *  from a send whose answer was lost); that tab prints it at once, with no lease request. */
export type PrintJobEnqueueResult =
  | { outcome: "queued"; id: string; duplicate: boolean; leased?: LeasedPrintJob }
  | { outcome: "no-host" }
  | { outcome: "already-resolved"; id: string }
  | { outcome: "too-large" };
```

Replace it with:

```ts
 *  can still track the job the tap referred to.
 *  Phase 2 Session 2B (spec §7.11): `leased` is a job leased to the asking tab (made so now, or still so
 *  from a send whose answer was lost); that tab prints it at once, with no lease request. */
/** Session 2C (printers mode): a slip routed to several printers answers "queued" with the first job's id and
 *  every job in `jobs`; `leased` is the one (if any) made leased to the asking tab. A slip no printer takes for
 *  a reason staff chose (a notice where Notices are off, a KOT with no lines) answers "not-routed": nothing to
 *  print, and never a local print. */
export type PrintJobEnqueueResult =
  | { outcome: "queued"; id: string; duplicate: boolean; leased?: LeasedPrintJob; jobs?: PrintJobRef[] }
  | { outcome: "not-routed" }
  | { outcome: "no-host" }
  | { outcome: "already-resolved"; id: string }
  | { outcome: "too-large" };
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
  };
}

/** leased → (lease ran out) the same as a "maybe sent" failure (§7.2). */
export function planExpiry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "leased" || job.lease === undefined) return { ok: false, reason: "wrong-status" };
```

Replace it with:

```ts
  };
}

/** Phase 2 Session 2C (spec §8, "a KOT is never dropped"): a slip no printer takes is made failed in the write
 *  that creates it, never attempted, with its reason, so staff see it under "Couldn't print" at once. A staff
 *  Retry then queues it unlabelled (planRetry: it never printed). */
export function printJobFailedAtCreation(input: {
  labels: readonly PrintJobLabel[];
  error: string;
  originDeviceId?: string;
  nowMs: number;
}): ReturnType<typeof printJobLifecycleInit> & { status: "failed"; lastError: string; log: PrintJobLogEntry[] } {
  return {
    ...printJobLifecycleInit(input.nowMs, input.labels),
    status: "failed",
    lastError: input.error,
    log: [printJobCreatedLog(input.nowMs, input.originDeviceId), logEntry(input.nowMs, "failed", undefined, `no printer: ${input.error}`)],
  };
}

/** leased → (lease ran out) the same as a "maybe sent" failure (§7.2). */
export function planExpiry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "leased" || job.lease === undefined) return { ok: false, reason: "wrong-status" };
```

In `packages/shared/src/print-printers.ts`, find:

```ts
export function printNoPrinterMessage(what: string): string {
  return `No printer is set up for ${what}.`;
}

export const PRINTER_NAME_MAX_CHARS = 40;
export const PRINTERS_MAX = 12;
```

Replace it with:

```ts
export function printNoPrinterMessage(what: string): string {
  return `No printer is set up for ${what}.`;
}

/** Session 2C: the printerId of a job made failed at creation (no printer takes its slip). It marks the job
 *  as a printers-mode job, so simple mode's sweep never moves it to a host, and it is never a printer's id. */
export const PRINT_JOB_NO_PRINTER = "none";
/** Session 2C (the sweep): why a waiting job failed when its printer was deleted, switched off or left with
 *  no printing device. It is never guessed onto another printer. */
export const PRINTER_GONE_MESSAGE = "This printer was removed or switched off.";

export const PRINTER_NAME_MAX_CHARS = 40;
export const PRINTERS_MAX = 12;
```

In `packages/shared/src/print-printers.ts`, find:

```ts
  return out;
}

function byOrder(a: StationConfig, b: StationConfig): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
```

Replace it with:

```ts
  return out;
}

/** Session 2C: a waiting job's printer, if routing may still send it slips (enabled, with a writer, taking a
 *  slip); null when it was deleted, switched off or left with no writer (and for PRINT_JOB_NO_PRINTER). */
export function routablePrinterOf(printers: readonly PrinterConfig[], printerId: string): PrinterConfig | null {
  return routablePrinters(printers).find((printer) => printer.id === printerId) ?? null;
}

const PRINTER_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** Session 2C: the printers a device names (the ready header "id,id", the lease body, the pulse): printer ids
 *  only, each once, in order, at most PRINTERS_MAX. Anything else is dropped, so a bad value only means fewer
 *  printers, never a refused request. */
export function printerIdsOf(raw: string | readonly string[] | null | undefined): string[] {
  const parts = typeof raw === "string" ? raw.split(",") : (raw ?? []);
  const out: string[] = [];
  for (const part of parts) {
    const id = part.trim();
    if (PRINTER_ID_PATTERN.test(id) && !out.includes(id)) out.push(id);
    if (out.length === PRINTERS_MAX) break;
  }
  return out;
}

function byOrder(a: StationConfig, b: StationConfig): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts src/print-lifecycle.test.ts src/print-job.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 69`; `# pass 69`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-agent-wire.ts packages/shared/src/print-job.test.ts packages/shared/src/print-job.ts packages/shared/src/print-lifecycle.test.ts packages/shared/src/print-lifecycle.ts packages/shared/src/print-printers.test.ts packages/shared/src/print-printers.ts
git commit -m "feat(print): Phase 2 printers mode, the shared contract: the ready and bill-printer headers, a job's printer and copies on the wire, a slip made failed at creation, and the printers a device names"
```

---

### Task C2: the server: every slip an order request makes is routed to its printers, one job per printer line with its copies; a slip no printer takes is failed at once; the asking tab's first job on a printer it writes is made leased to it

**Files:**
- Create: `apps/cafe/lib/print-job-insert.ts` (`insertPrintJob`, `InsertedPrintJob`, moved from `print-order-jobs.ts` to keep it under its ~300-line budget; gains `line` and `failed`)
- Create: `apps/cafe/lib/print-printer-jobs.ts` (`printPayloadProductIds`, `askingTabOf`, `createRoutedPrintJobs`, `routedEnqueueResultOf`, `enqueueRoutedPrintJob`)
- Modify: `apps/cafe/lib/print-order-jobs.ts` (`PrintIntent.readyPrinterIds?`, `billPrinterId?`; `createOrderPrintJobs` reads the routing first)
- Modify: `apps/cafe/lib/print-direct.ts` (`printerLineIsFree`; the re-delivery read carries `printerId`, `copies`), `apps/cafe/lib/print-lease.ts` (`printJobLineFilter` leaves printer jobs out; `printerLineFilter`; `leasedJobOf` carries `printerId`, `copies`)
- Modify: the six order routes and `apps/cafe/lib/print-agent-server.ts` (each passes `readyPrinterIds` and `billPrinterId`); `apps/cafe/app/api/print-jobs/route.ts` (the routed enqueue first)
- Tests: `apps/cafe/lib/print-printer-jobs.test.ts` (create), `print-order-jobs.test.ts` (one new test; the moved code's pins point at `print-job-insert.ts`), `print-lease.test.ts` (the line filter's pin, one new test), `self-order-alert-paths.test.ts` (the write points), `apps/cafe/package.json` (testChain)

**Interfaces produced:** `printIntentOf(req)` → `{ deviceId, bill, leaseTabId?, readyPrinterIds?, billPrinterId? }`; `insertPrintJob({ …, line?: { printerId, copies }, failed?: string })`; `createRoutedPrintJobs({ routing, requests, baseKeyOf, originDeviceId?, leaseTabId?, readyPrinterIds?, queuedBy, nowMs })` → `{ jobs, routed }`; `routedEnqueueResultOf(jobs, routed)`; `enqueueRoutedPrintJob(…)` → `PrintJobEnqueueResult | null` (null: simple mode); `printerLineFilter(printerId, nowMs)`; `printerLineIsFree(printerId, nowMs)`.

**Printers mode routes every slip** (spec §8): `createOrderPrintJobs` reads `readPrintRouting` once (the order's lines; simple mode's one read); null keeps simple mode exactly (with 2B's direct print). Otherwise each slip goes through `routePrintRequest`, in kind order (KOT before bill, §7.6), and each routed job is one job: on its printer's line (`printerId`), aimed at the printer's writer (`targetDeviceId`), with its copies (absent when 1), under `routedJobKey` (`<slip key>:<printer|none>:<part>`), so a replay or a repair collides instead of printing twice. A routed job with no printer is made failed at once (`printerId: "none"`). The host plays no part in printers mode, and makes no `print-job` nudge (ruling R12).

**Direct print per printer line** (decision 15): the request's first job on a printer its asking device writes and names as ready (`x-pos-print-ready`, with 2B's `x-pos-print-lease`) is made leased to the asking tab when that printer's line is free; every other new queued job is announced to its writer, and nothing to yourself (decision 16).

**The enqueue** (`POST /api/print-jobs`) in printers mode routes the slip the same way, whoever asks (the 2B gate's ruling R1): one job answers as in simple mode; several answer `queued` with the first id, every job (`jobs`) and the one made leased; nothing routed (a notice where Notices are off) answers `not-routed`, never a local print.

**The simple line leaves printer jobs out** (`printerId: { $exists: false }`): a printer job is aimed at its writer too, but waits on its printer's line. `insertPrintJob` moved to its own file (the pins that read it follow); its one write point stays.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-lease.test.ts`, find:

```ts
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, PRINT_LEASE_MS, lifecycleOf, planExpiry, planLease, type PrintJobPlan, type PrintJobPatch } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { leasedPrintJobOf, printJobCasFilter, printJobLineFilter, printJobsForMeFilter, printJobUpdateOf } from "./print-lease";

// Phase 1 Session 1A — DB-free tests of print-lease.ts's pure exports. The DB paths are proven live
// (npm run verify:print:live, legs q–x) and pinned in print-lifecycle-paths.test.ts.
```

Replace it with:

```ts
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, PRINT_LEASE_MS, lifecycleOf, planExpiry, planLease, type PrintJobPlan, type PrintJobPatch } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { leasedPrintJobOf, printJobCasFilter, printJobLineFilter, printJobsForMeFilter, printJobUpdateOf, printerLineFilter } from "./print-lease";

// Phase 1 Session 1A — DB-free tests of print-lease.ts's pure exports. The DB paths are proven live
// (npm run verify:print:live, legs q–x) and pinned in print-lifecycle-paths.test.ts.
```

In `apps/cafe/lib/print-lease.test.ts`, find:

```ts
  return plan.patch;
}

test("printJobLineFilter: this device's leased job, plus its queued jobs that are fresh or approved", () => {
  assert.deepEqual(printJobLineFilter("dev-a", T0), {
    targetDeviceId: "dev-a",
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
```

Replace it with:

```ts
  return plan.patch;
}

// Session 2C deliberately added printerId: { $exists: false }: a printers-mode job is aimed at its printer's
// writer too (targetDeviceId), but it waits on its printer's line, never on the device's simple line.
test("printJobLineFilter: this device's leased job, plus its queued jobs that are fresh or approved (simple mode only)", () => {
  assert.deepEqual(printJobLineFilter("dev-a", T0), {
    targetDeviceId: "dev-a",
    printerId: { $exists: false },
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
});

// Session 2C (spec §7.6, plan decision 1): in printers mode each printer is a line of its own, oldest first.
test("printerLineFilter: one printer's leased job, plus its queued jobs that are fresh or approved", () => {
  assert.deepEqual(printerLineFilter("p1", T0), {
    printerId: "p1",
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.equal(printIntentOf(reqWith({ "x-pos-device-id": "dev-1", "x-pos-print-lease": "tab-1" })), null, "the lease header alone is not an opt-in");
});

test("buildKotPrintDevices: positional like kotIdemKeys; a round its tab printed stays empty; no device writes nothing", () => {
  assert.equal(buildKotPrintDevices(undefined, 1, undefined), undefined);
  assert.deepEqual(buildKotPrintDevices(undefined, 1, "dev-1"), ["dev-1"]);
```

Replace it with:

```ts
  assert.equal(printIntentOf(reqWith({ "x-pos-device-id": "dev-1", "x-pos-print-lease": "tab-1" })), null, "the lease header alone is not an opt-in");
});

// Phase 2 Session 2C (printers mode): the printers the draining tab can print on now, and this device's bill
// printer. Unusable values only mean fewer printers or the default bill printer, never a refused order.
test("printIntentOf: the ready printers and the device's bill printer join the intent; anything unusable is dropped", () => {
  const agent = { "x-pos-print-agent": "1", "x-pos-device-id": "dev-1" };
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-ready": `${a}, nope,${b}` })), { deviceId: "dev-1", bill: false, readyPrinterIds: [a, b] });
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-ready": "nope" })), { deviceId: "dev-1", bill: false }, "no usable id: no ready printers");
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-bill-printer": ` ${a} ` })), { deviceId: "dev-1", bill: false, billPrinterId: a });
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-bill-printer": "Counter" })), { deviceId: "dev-1", bill: false }, "not a printer id: the default bill printer");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-ready": a, "x-pos-bill-printer": a })), null, "neither header is an opt-in");
});

test("buildKotPrintDevices: positional like kotIdemKeys; a round its tab printed stays empty; no device writes nothing", () => {
  assert.equal(buildKotPrintDevices(undefined, 1, undefined), undefined);
  assert.deepEqual(buildKotPrintDevices(undefined, 1, "dev-1"), ["dev-1"]);
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  inOrder(fn, ["try {", "const target = host?.deviceId ?? input.originDeviceId;", "await insertPrintJob({", "} catch {", "return refs;"], "createOrderPrintJobs");
  assert.match(fn, /publishPrintStatus\(\{ id: job\.ref\.id, status: "queued", target \}\);/);
  assert.match(fn, /if \(made > 0 && host !== null\) publishCafeEvent\("print-job"\);/);
  assert.match(s, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(s, "PrintJob.create("), 1, "one write point");
  // Session 2B (spec §7.11): a job is made leased only on the asking device's own line, only the request's
  // first slip there, only when the line is free; and a job printed by the asking tab is never announced.
  assert.match(fn, /const leaseTabId = target === input\.originDeviceId \? input\.leaseTabId : undefined;/, "never for a slip another device prints");
  assert.match(fn, /const lineFree = leaseTabId !== undefined && \(await printLineIsFree\(target, input\.nowMs\)\);/, "one read of the line, only when it can matter");
  assert.match(fn, /const tab = leaseTabId === undefined \|\| refs\.length > 0 \? \{\} : \{ tab: \{ tabId: leaseTabId, direct: lineFree \} \};/, "only the first slip of the request on the line");
  assert.match(fn, /if \(announcesQueuedJob\(job, directOnLine\)\) \{/, "no realtime message to yourself");
  assert.match(s, /\.\.\.\(direct \?\? \{ \.\.\.printJobLifecycleInit\(input\.nowMs, labels\), log: \[printJobCreatedLog\(input\.nowMs, input\.originDeviceId\)\] \}\),/, "made leased in the same write that creates it");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

```

Replace it with:

```ts
  inOrder(fn, ["try {", "const target = host?.deviceId ?? input.originDeviceId;", "await insertPrintJob({", "} catch {", "return refs;"], "createOrderPrintJobs");
  assert.match(fn, /publishPrintStatus\(\{ id: job\.ref\.id, status: "queued", target \}\);/);
  assert.match(fn, /if \(made > 0 && host !== null\) publishCafeEvent\("print-job"\);/);
  // Session 2C moved insertPrintJob to lib/print-job-insert.ts (this file stays under its ~300-line budget).
  const insert = src("apps/cafe/lib/print-job-insert.ts");
  assert.match(insert, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(insert, "PrintJob.create(") + count(s, "PrintJob.create("), 1, "one write point");
  // Session 2B (spec §7.11): a job is made leased only on the asking device's own line, only the request's
  // first slip there, only when the line is free; and a job printed by the asking tab is never announced.
  assert.match(fn, /const leaseTabId = target === input\.originDeviceId \? input\.leaseTabId : undefined;/, "never for a slip another device prints");
  assert.match(fn, /const lineFree = leaseTabId !== undefined && \(await printLineIsFree\(target, input\.nowMs\)\);/, "one read of the line, only when it can matter");
  assert.match(fn, /const tab = leaseTabId === undefined \|\| refs\.length > 0 \? \{\} : \{ tab: \{ tabId: leaseTabId, direct: lineFree \} \};/, "only the first slip of the request on the line");
  assert.match(fn, /if \(announcesQueuedJob\(job, directOnLine\)\) \{/, "no realtime message to yourself");
  assert.match(insert, /\.\.\.\(failed \?\? direct \?\? \{ \.\.\.printJobLifecycleInit\(input\.nowMs, labels\), log: \[printJobCreatedLog\(input\.nowMs, input\.originDeviceId\)\] \}\),/, "made leased (or failed, 2C) in the same write that creates it");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
});

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  // Session 2B deliberately changed the first two: a new job is queued, or leased to the asking tab and
  // carrying its lease; a found job keeps its own state, plus its lease when it is still the asking tab's.
  assert.match(
    s,
    /label: input\.request\.label,\s*status: direct === null \? "queued" : "leased",\s*\.\.\.\(direct !== null \? \{ leased: leasedJobOf\(created, direct, payload\) \} : \{\}\),\s*\};\s*return \{ ref, created: true, status: ref\.status \};/,
    "a new job is queued, or made leased to the asking tab",
  );
  assert.match(s, /label: existing\.label,\s*status: existing\.status,\s*\.\.\.\(again !== null \? \{ leased: again \} : \{\}\),\s*\};/, "a found job keeps its own state");
  assert.match(src("packages/shared/src/print-agent-wire.ts"), /export interface PrintJobRef \{[^}]*status: PrintJobStatus;/, "the wire type carries it");
});

```

Replace it with:

```ts
});

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-job-insert.ts");
  // Session 2B deliberately changed the first two: a new job is queued, or leased to the asking tab and
  // carrying its lease; a found job keeps its own state, plus its lease when it is still the asking tab's.
  assert.match(
    s,
    /label: input\.request\.label,\s*status: failed !== null \? "failed" : direct === null \? "queued" : "leased",\s*\.\.\.\(direct !== null \? \{ leased: leasedJobOf\(created, direct, payload\) \} : \{\}\),\s*\.\.\.\(input\.line !== undefined \? \{ printerId: input\.line\.printerId \} : \{\}\),\s*\};\s*return \{ ref, created: true, status: ref\.status \};/,
    "a new job is queued, or made leased to the asking tab",
  );
  assert.match(s, /label: existing\.label,\s*status: existing\.status,\s*\.\.\.\(again !== null \? \{ leased: again \} : \{\}\),\s*\.\.\.\(existing\.printerId !== undefined \? \{ printerId: existing\.printerId \} : \{\}\),\s*\};/, "a found job keeps its own state");
  assert.match(src("packages/shared/src/print-agent-wire.ts"), /export interface PrintJobRef \{[^}]*status: PrintJobStatus;/, "the wire type carries it");
});

```

Create `apps/cafe/lib/print-printer-jobs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import type { InsertedPrintJob } from "@/lib/print-job-insert";
import type { RoutedPrintJob } from "@/lib/print-printer-routing";
import { askingTabOf, printPayloadProductIds, routedEnqueueResultOf } from "@/lib/print-printer-jobs";

// Phase 2 Session 2C (spec §8, plan decisions 1–5, 15, 16): job creation in printers mode. The rules are pure
// here; the creation itself is proven live (npm run verify:print:live, legs an–aq).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const SNAPSHOT_ITEMS = [{ productId: "p-chai" }, { productId: "p-cake" }];

test("printPayloadProductIds: a slip's stations are resolved for its own lines; a void for its voided line; End of day for none", () => {
  const snapshot = { items: SNAPSHOT_ITEMS } as never;
  assert.deepEqual(printPayloadProductIds({ kind: "kot", snapshot, round: 1 } as never), ["p-chai", "p-cake"]);
  assert.deepEqual(printPayloadProductIds({ kind: "bill", snapshot } as never), ["p-chai", "p-cake"]);
  assert.deepEqual(printPayloadProductIds({ kind: "void", snapshot, line: { productId: "p-gone" } } as never), ["p-gone"], "the voided line may have left the order");
  assert.deepEqual(printPayloadProductIds({ kind: "eod", dateKey: "2026-10-04", dateLabel: "4 Oct" } as never), []);
});

function routed(printerId: string | null, writerDeviceId: string | null): RoutedPrintJob {
  return { printerId, writerDeviceId, request: { payload: {} as never, label: "KOT" }, copies: 1, part: "-" };
}

test("askingTabOf: only a printer this device writes and names as ready, and only the request's first job on it", () => {
  const input = { originDeviceId: "dev-a", leaseTabId: "tab-1", readyPrinterIds: ["p-counter"] };
  const seen = new Set<string>();
  assert.equal(askingTabOf(routed("p-counter", "dev-a"), input, seen), "tab-1", "the asking device writes it and can print it now");
  assert.equal(askingTabOf(routed("p-counter", "dev-a"), input, seen), undefined, "the second job on that line waits for the first one's ack (more)");
  assert.equal(askingTabOf(routed("p-kitchen", "dev-k"), input, new Set()), undefined, "another device writes it");
  assert.equal(askingTabOf(routed("p-bar", "dev-a"), input, new Set()), undefined, "this device writes it but did not say it can print it now");
  assert.equal(askingTabOf(routed("p-counter", "dev-a"), { ...input, leaseTabId: undefined }, new Set()), undefined, "no draining tab asked");
  assert.equal(askingTabOf(routed(null, null), input, new Set()), undefined, "no printer: made failed, never leased");
});

function inserted(over: Partial<PrintJobRef> & { created?: boolean } = {}): InsertedPrintJob {
  const { created = true, ...ref } = over;
  const full: PrintJobRef = { id: "j1", kind: "kot", targetDeviceId: "dev-a", label: "KOT", status: "queued", printerId: "p1", ...ref };
  return { ref: full, created, status: full.status };
}

test("routedEnqueueResultOf: one slip's jobs as the enqueue's answer (the 2B gate's ruling R1)", () => {
  assert.deepEqual(routedEnqueueResultOf([], 0), { outcome: "not-routed" }, "a notice no printer takes notices for: nothing to print, never a local print");
  assert.deepEqual(routedEnqueueResultOf([], 2), { outcome: "too-large" }, "routed, but no job could be stored");
  assert.deepEqual(routedEnqueueResultOf([inserted()], 1), { outcome: "queued", id: "j1", duplicate: false }, "one job: today's answer");
  assert.deepEqual(routedEnqueueResultOf([inserted({ created: false })], 1), { outcome: "queued", id: "j1", duplicate: true }, "a re-send of a waiting job");
  assert.deepEqual(routedEnqueueResultOf([inserted({ created: false, status: "printed" })], 1), { outcome: "already-resolved", id: "j1" }, "a re-send of a printed one");
  const leased = { id: "j2", epoch: 1 } as never;
  const two = routedEnqueueResultOf([inserted(), inserted({ id: "j2", printerId: "p2", status: "leased", leased })], 2);
  assert.equal(two.outcome, "queued");
  assert.deepEqual(two.outcome === "queued" ? [two.id, two.duplicate, two.leased, two.jobs?.map((j) => j.id)] : [], ["j1", false, leased, ["j1", "j2"]], "the first id, every job, and the one made leased to the asking tab");
  const failed = routedEnqueueResultOf([inserted({ status: "failed", printerId: PRINT_JOB_NO_PRINTER })], 1);
  assert.deepEqual(failed, { outcome: "queued", id: "j1", duplicate: false }, "a job failed at creation is new, and shows under Couldn't print");
});

test("PIN: printers mode routes every slip an order request makes; simple mode (no routing) is unchanged", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  const fn = s.slice(s.indexOf("export async function createOrderPrintJobs("), s.indexOf("export async function enqueueOwnPrintJob("));
  inOrder(
    fn,
    [
      "try {",
      "const routing = await readPrintRouting({",
      "if (routing !== null) {",
      "await createRoutedPrintJobs({",
      "return jobs.map((job) => job.ref);",
      "const host = await PrintHost.findOne(",
      "const target = host?.deviceId ?? input.originDeviceId;",
      "} catch {",
    ],
    "createOrderPrintJobs",
  );
  const lib = src("apps/cafe/lib/print-printer-jobs.ts");
  assert.match(lib, /const jobKey = routedJobKey\(baseKey, job\);/, "a routed job's key adds its printer and part (decision 3)");
  assert.match(lib, /line: \{ printerId: PRINT_JOB_NO_PRINTER, copies: 1 \},\s*failed: job\.error/, "a slip no printer takes is made failed at once");
  assert.match(lib, /if \(announcesQueuedJob\(made, directOn\.has\(job\.printerId\)\)\) publishPrintStatus\(\{ id: made\.ref\.id, status: "queued", target: made\.ref\.targetDeviceId \}\);/, "each new queued job to its writer, never to yourself");
  assert.ok(!lib.includes('publishCafeEvent("print-job")'), "printers mode nudges no host");
  assert.equal(count(lib, "PrintJob.create("), 0, "one write point stays insertPrintJob");
  assert.ok(!lib.includes("console."), "no console.* in a server lib");
});

test("PIN: every order route and the self-order claim pass the ready printers and the device's bill printer; the enqueue routes first", () => {
  const routes = [
    "apps/cafe/app/api/orders/route.ts",
    "apps/cafe/app/api/orders/[id]/items/route.ts",
    "apps/cafe/app/api/orders/[id]/settle/route.ts",
    "apps/cafe/app/api/orders/[id]/items/void/route.ts",
    "apps/cafe/app/api/orders/[id]/table/route.ts",
    "apps/cafe/app/api/order-requests/[id]/accept/route.ts",
    "apps/cafe/lib/print-agent-server.ts",
  ];
  for (const rel of routes) {
    const s = src(rel);
    inOrder(s, ["leaseTabId: intent.leaseTabId,", "readyPrinterIds: intent.readyPrinterIds,", "billPrinterId: intent.billPrinterId,"], rel);
  }
  const route = src("apps/cafe/app/api/print-jobs/route.ts");
  inOrder(route, ["const intent = printIntentOf(req);", "const routed = await enqueueRoutedPrintJob({", "routed ??", "(await enqueuePrintJob({"], "the enqueue");
});
```

In `apps/cafe/lib/self-order-alert-paths.test.ts`, find:

```ts
  // Session 1B adds print-order-jobs.ts: server-side creation, one PrintJob.create per slip under
  // today's unique jobKey, so it races the legacy enqueue and the claim exactly as a second enqueue would.
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-order-jobs.ts",
    "apps/cafe/lib/print-queue-claim.ts",
    "apps/cafe/lib/print-queue.ts",
    "apps/cafe/lib/print-sweep.ts",
```

Replace it with:

```ts
  // Session 1B adds print-order-jobs.ts: server-side creation, one PrintJob.create per slip under
  // today's unique jobKey, so it races the legacy enqueue and the claim exactly as a second enqueue would.
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-job-insert.ts",
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-queue-claim.ts",
    "apps/cafe/lib/print-queue.ts",
    "apps/cafe/lib/print-sweep.ts",
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts",
    "lib/print-direct.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

Replace it with:

```json
    "lib/print-printers-model.test.ts",
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts",
    "lib/print-direct.test.ts",
    "lib/print-printer-jobs.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printer-jobs.test.ts lib/print-order-jobs.test.ts lib/self-order-alert-paths.test.ts lib/print-lease.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 34`; `# pass 27`; `# fail 7`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
            slips: [{ kind: "kot", round: result.order.kotRounds }],
            originDeviceId: intent.deviceId,
            leaseTabId: intent.leaseTabId,
            queuedBy: authed.session.user.name ?? "",
            nowMs: Date.now(),
          })
```

Replace it with:

```ts
            slips: [{ kind: "kot", round: result.order.kotRounds }],
            originDeviceId: intent.deviceId,
            leaseTabId: intent.leaseTabId,
            readyPrinterIds: intent.readyPrinterIds,
            billPrinterId: intent.billPrinterId,
            queuedBy: authed.session.user.name ?? "",
            nowMs: Date.now(),
          })
```

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
          slips: [{ kind: "kot", round }],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          slips: [{ kind: "kot", round }],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/[id]/items/void/route.ts`, find:

```ts
          slips: [{ kind: "void" }],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          slips: [{ kind: "void" }],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/[id]/settle/route.ts`, find:

```ts
          slips: intent.bill ? [{ kind: "bill" }] : [],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          slips: intent.bill ? [{ kind: "bill" }] : [],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/[id]/table/route.ts`, find:

```ts
          ],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          ],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/orders/route.ts`, find:

```ts
          slips: [{ kind: "kot", round: 1 }, ...(intent.bill && data.status === "Completed" ? [{ kind: "bill" as const }] : [])],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

Replace it with:

```ts
          slips: [{ kind: "kot", round: 1 }, ...(intent.bill && data.status === "Completed" ? [{ kind: "bill" as const }] : [])],
          originDeviceId: intent.deviceId,
          leaseTabId: intent.leaseTabId,
          readyPrinterIds: intent.readyPrinterIds,
          billPrinterId: intent.billPrinterId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
```

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts
import { PRINT_DEVICE_ID_HEADER, PRINT_IDEMPOTENCY_HEADER, PRINT_IDEMPOTENCY_KEY_PATTERN } from "@pos/shared/print-agent-wire";
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { enqueueDirectPrintJob, enqueueOwnPrintJob, printIntentOf } from "@/lib/print-order-jobs";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

Replace it with:

```ts
import { PRINT_DEVICE_ID_HEADER, PRINT_IDEMPOTENCY_HEADER, PRINT_IDEMPOTENCY_KEY_PATTERN } from "@pos/shared/print-agent-wire";
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { enqueueDirectPrintJob, enqueueOwnPrintJob, printIntentOf } from "@/lib/print-order-jobs";
import { enqueueRoutedPrintJob } from "@/lib/print-printer-jobs";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts
  try {
    await connectDB();
    const intent = printIntentOf(req);
    // Session 2B (spec §7.11): the tab that drains the asking device's slips and can print now prints its
    // own slip at once (made leased to it), and gets back a slip still leased to it whose first answer was
    // lost. null: another device is the host, and the enqueue below makes the slip for it.
    const direct =
      intent?.leaseTabId !== undefined
        ? await enqueueDirectPrintJob({
            payload: parsed.data.payload,
            label: parsed.data.label,
```

Replace it with:

```ts
  try {
    await connectDB();
    const intent = printIntentOf(req);
    // Session 2C (spec §8): printers mode routes the slip to its printers, whoever asks. null: simple mode.
    const routed = await enqueueRoutedPrintJob({
      payload: parsed.data.payload,
      label: parsed.data.label,
      queuedBy,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      originDeviceId: intent?.deviceId ?? originDeviceId,
      leaseTabId: intent?.leaseTabId,
      readyPrinterIds: intent?.readyPrinterIds,
      ...(intent?.billPrinterId !== undefined ? { billPrinterId: intent.billPrinterId } : {}),
      nowMs,
    });
    // Session 2B (spec §7.11): the tab that drains the asking device's slips and can print now prints its
    // own slip at once (made leased to it), and gets back a slip still leased to it whose first answer was
    // lost. null: another device is the host, and the enqueue below makes the slip for it.
    const direct =
      routed === null && intent?.leaseTabId !== undefined
        ? await enqueueDirectPrintJob({
            payload: parsed.data.payload,
            label: parsed.data.label,
```

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts
          })
        : null;
    let result =
      direct ??
      (await enqueuePrintJob({
        payload: parsed.data.payload,
```

Replace it with:

```ts
          })
        : null;
    let result =
      routed ??
      direct ??
      (await enqueuePrintJob({
        payload: parsed.data.payload,
```

In `apps/cafe/lib/print-agent-server.ts`, find:

```ts
    slips: [{ kind: "kot", round: result.kotRound }],
    originDeviceId: intent.deviceId,
    leaseTabId: intent.leaseTabId,
    queuedBy: SELF_ORDER_RECEIVER,
    nowMs,
  });
```

Replace it with:

```ts
    slips: [{ kind: "kot", round: result.kotRound }],
    originDeviceId: intent.deviceId,
    leaseTabId: intent.leaseTabId,
    readyPrinterIds: intent.readyPrinterIds,
    billPrinterId: intent.billPrinterId,
    queuedBy: SELF_ORDER_RECEIVER,
    nowMs,
  });
```

In `apps/cafe/lib/print-direct.ts`, find:

```ts
import { PRINT_LEASE_MS, lifecycleOf, type PrintJobLease } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { leasedJobOf, printJobLineFilter } from "@/lib/print-lease";

// Phase 2 Session 2B (spec §7.11, plan decisions 15 and 16): direct print on the asking device. When the tab
// that drains a device's slips, and can print right now, asks for slips that print on that same device, the
```

Replace it with:

```ts
import { PRINT_LEASE_MS, lifecycleOf, type PrintJobLease } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { leasedJobOf, printJobLineFilter, printerLineFilter } from "@/lib/print-lease";

// Phase 2 Session 2B (spec §7.11, plan decisions 15 and 16): direct print on the asking device. When the tab
// that drains a device's slips, and can print right now, asks for slips that print on that same device, the
```

In `apps/cafe/lib/print-direct.ts`, find:

```ts
  return (await PrintJob.findOne(printJobLineFilter(deviceId, nowMs)).select("_id").lean()) === null;
}

/** What a job found under its key is read with when the asking tab may be handed it again. */
export const PRINT_REDELIVERY_SELECT =
  "kind status label orderId createdAt targetDeviceId epoch attempts uncertainAttempts nextAttemptAt labels lease payload copyIndex";

export interface PrintRedeliveryRow {
  _id: Types.ObjectId;
```

Replace it with:

```ts
  return (await PrintJob.findOne(printJobLineFilter(deviceId, nowMs)).select("_id").lean()) === null;
}

/** Session 2C (printers mode): the same, for one printer's line (decision 15 per printer line). */
export async function printerLineIsFree(printerId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne(printerLineFilter(printerId, nowMs)).select("_id").lean()) === null;
}

/** What a job found under its key is read with when the asking tab may be handed it again. */
export const PRINT_REDELIVERY_SELECT =
  "kind status label orderId createdAt targetDeviceId epoch attempts uncertainAttempts nextAttemptAt labels lease payload copyIndex printerId copies";

export interface PrintRedeliveryRow {
  _id: Types.ObjectId;
```

In `apps/cafe/lib/print-direct.ts`, find:

```ts
  lease?: PrintJobLease;
  payload?: string;
  copyIndex?: number;
}

/** A job its key already names that is still leased to the asking device's very tab, its lease still running:
```

Replace it with:

```ts
  lease?: PrintJobLease;
  payload?: string;
  copyIndex?: number;
  printerId?: string;
  copies?: number;
}

/** A job its key already names that is still leased to the asking device's very tab, its lease still running:
```

Create `apps/cafe/lib/print-job-insert.ts`:

```ts
import { isDuplicateKeyError } from "@pos/shared/api";
import { printJobPayloadWithinCap, type PrintJobStatus } from "@pos/shared/print-job";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { directLeaseOf, printJobCreatedLog, printJobFailedAtCreation, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_REDELIVERY_SELECT, redeliveryOf, type PrintJobAskingTab, type PrintRedeliveryRow } from "@/lib/print-direct";
import { leasedJobOf } from "@/lib/print-lease";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import type { PrintJobRequest } from "@/lib/print-routing";

// Printing redesign: the ONE place a server-made print job is written (spec §7.4). Phase 1 Session 1B wrote it
// for simple mode, Session 2B (spec §7.11) let it be made already leased to the asking tab, and Session 2C
// (printers mode, spec §8) gives it a printer line and copies, or makes it failed at once when no printer takes
// its slip. Moved out of print-order-jobs.ts at the 2B review gate to keep that file near its ~300-line budget.
// Never calls connectDB(). No console.*.

const UNNAMED_STAFF = "Staff";

/** One job made, or the one its key already names (a racing replay, an old tab's enqueue, a repair). */
export interface InsertedPrintJob {
  ref: PrintJobRef;
  created: boolean;
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws.
 *  Session 2B (spec §7.11): `tab` is the asking tab, passed only when this job's line is the asking device's
 *  own. With `direct` the job is made already leased to it, in this one write; and a job its key already
 *  names that is still leased to that very tab is handed back with its lease (an answer lost on the way).
 *  Session 2C: `line` is its printer and copies (printers mode); `failed` makes it failed at once (no printer
 *  takes the slip), never leased. */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  /** The device whose line holds it (simple mode: the host or the asking device; printers mode: the printer's
   *  writer). "" only for a job failed at creation that no device asked for. */
  targetDeviceId: string;
  originDeviceId?: string;
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`, a routed job its
   *  routedJobKey (Session 2C). */
  jobKey?: string;
  tab?: PrintJobAskingTab;
  line?: { printerId: string; copies: number };
  failed?: string;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
  if (!parsed.success) return null;
  const payload: PrintJobPayload = parsed.data;
  const json = JSON.stringify(payload);
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  const labels = printJobInitialLabels(payload);
  const failed = input.failed === undefined ? null : printJobFailedAtCreation({ labels, error: input.failed, originDeviceId: input.originDeviceId, nowMs: input.nowMs });
  const who = input.tab === undefined || failed !== null ? null : { deviceId: input.targetDeviceId, tabId: input.tab.tabId };
  const direct = who !== null && input.tab?.direct === true ? directLeaseOf({ labels, who, originDeviceId: input.originDeviceId, nowMs: input.nowMs }) : null;
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
      payload: json,
      label: input.request.label,
      // A Mongoose required string refuses "" (house rule: staff names fall back to "Staff").
      queuedBy: input.queuedBy.trim() || UNNAMED_STAFF,
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
      ...(input.targetDeviceId !== "" ? { targetDeviceId: input.targetDeviceId } : {}),
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      // Omit-empty: a simple-mode job carries neither; one copy is no copies field.
      ...(input.line !== undefined ? { printerId: input.line.printerId, ...(input.line.copies > 1 ? { copies: input.line.copies } : {}) } : {}),
      // Made failed (no printer takes it), leased to the asking tab (its log says "direct"), or queued as in Phase 1.
      ...(failed ?? direct ?? { ...printJobLifecycleInit(input.nowMs, labels), log: [printJobCreatedLog(input.nowMs, input.originDeviceId)] }),
    });
    const ref: PrintJobRef = {
      id: String(created._id),
      kind: payload.kind,
      targetDeviceId: input.targetDeviceId,
      label: input.request.label,
      status: failed !== null ? "failed" : direct === null ? "queued" : "leased",
      ...(direct !== null ? { leased: leasedJobOf(created, direct, payload) } : {}),
      ...(input.line !== undefined ? { printerId: input.line.printerId } : {}),
    };
    return { ref, created: true, status: ref.status };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey })
      .select(who === null ? "kind status label targetDeviceId printerId" : PRINT_REDELIVERY_SELECT)
      .lean<PrintRedeliveryRow>();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const again = who === null ? null : redeliveryOf(existing, who, input.nowMs);
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
      status: existing.status,
      ...(again !== null ? { leased: again } : {}),
      ...(existing.printerId !== undefined ? { printerId: existing.printerId } : {}),
    };
    return { ref, created: false, status: existing.status };
  }
}
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number };

/** One device's line (simple mode, spec §6.6/§7.6): its leased job, plus each queued job that is
 *  not parked as stale. needs-confirm and failed jobs are parked and never block the line. */
export function printJobLineFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return {
    targetDeviceId: deviceId,
    status: { $in: ["queued", "leased"] },
    // A leased job stays at the head whatever its age, so a line never has two writers.
    $or: [{ status: "leased" }, { createdAt: { $gte: drainAgeCutoff(nowMs) } }, { approvedAt: { $exists: true } }],
  };
}

/** The CAS fence: the status and epoch the plan was computed from. A row from before Phase 1 has no
```

Replace it with:

```ts
export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number };

/** A line's own jobs: its leased one, plus each queued job that is not parked as stale. needs-confirm and
 *  failed jobs are parked and never block the line. A leased job stays at the head whatever its age, so a line
 *  never has two writers. */
function lineJobs(nowMs: number): FilterQuery<IPrintJob> {
  return {
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: drainAgeCutoff(nowMs) } }, { approvedAt: { $exists: true } }],
  };
}

/** One device's line (simple mode, spec §6.6/§7.6). Session 2C: a printers-mode job is aimed at its printer's
 *  writer too, but it waits on its printer's line (printerLineFilter), never here. */
export function printJobLineFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { targetDeviceId: deviceId, printerId: { $exists: false }, ...lineJobs(nowMs) };
}

/** Session 2C (spec §7.6, plan decision 1): one printer's line, on the partial printer-line index. */
export function printerLineFilter(printerId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { printerId, ...lineJobs(nowMs) };
}

/** The CAS fence: the status and epoch the plan was computed from. A row from before Phase 1 has no
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number };

/** The wire job for one lease (spec §7.3), from its row: leased by a lease request, made leased at creation,
 *  or delivered again to the tab that holds it (Session 2B, spec §7.11). */
```

Replace it with:

```ts
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number; printerId?: string; copies?: number };

/** The wire job for one lease (spec §7.3), from its row: leased by a lease request, made leased at creation,
 *  or delivered again to the tab that holds it (Session 2B, spec §7.11). */
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
    labels: lease.labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: lease.attempts,
  };
}

```

Replace it with:

```ts
    labels: lease.labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: lease.attempts,
    // Session 2C (printers mode): the printer it is for, and its copies (absent: 1).
    ...(head.printerId !== undefined ? { printerId: head.printerId } : {}),
    ...(head.copies !== undefined && head.copies > 1 ? { copies: head.copies } : {}),
  };
}

```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
import { isDuplicateKeyError } from "@pos/shared/api";
import {
  PRINT_HOST_KEY,
  printJobPayloadWithinCap,
  type PrintJobEnqueueResult,
  type PrintJobStatus,
} from "@pos/shared/print-job";
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_LEASE_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { directLeaseOf, printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import {
  PRINT_REDELIVERY_SELECT,
  announcesQueuedJob,
  printLineIsFree,
  redeliveryOf,
  type PrintJobAskingTab,
  type PrintRedeliveryRow,
} from "@/lib/print-direct";
import { leasedJobOf } from "@/lib/print-lease";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";
```

Replace it with:

```ts
import { PRINT_HOST_KEY, type PrintJobEnqueueResult } from "@pos/shared/print-job";
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_BILL_PRINTER_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_LEASE_HEADER,
  PRINT_READY_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { printerIdsOf } from "@pos/shared/print-printers";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { announcesQueuedJob, printLineIsFree, type PrintJobAskingTab } from "@/lib/print-direct";
import { insertPrintJob } from "@/lib/print-job-insert";
import { createRoutedPrintJobs, printPayloadProductIds } from "@/lib/print-printer-jobs";
import { printJobKeyOf } from "@/lib/print-queue";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
import { readPrintRouting } from "@/lib/print-routing-context";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
// prints everything; with no host the asking device prints its own.
//
// Keys stay today's (printJobKeyOf): simple mode has one job per slip, so a server-made job and an old
// tab's enqueue of the same slip collide on the unique jobKey instead of printing twice. The printer
// and copy parts of spec §6.5's key arrive with Phase 2 printers.
//
// createOrderPrintJobs NEVER throws: an order that landed must still answer success. A job that did
// not get made is covered by the repair sweep (print-repair.ts) for KOT rounds, and by the client's own
```

Replace it with:

```ts
// prints everything; with no host the asking device prints its own.
//
// Keys stay today's (printJobKeyOf): simple mode has one job per slip, so a server-made job and an old
// tab's enqueue of the same slip collide on the unique jobKey instead of printing twice. Printers mode
// (Session 2C, lib/print-printer-jobs.ts) adds each job's printer and part to the slip's key.
//
// createOrderPrintJobs NEVER throws: an order that landed must still answer success. A job that did
// not get made is covered by the repair sweep (print-repair.ts) for KOT rounds, and by the client's own
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  /** Session 2B (PRINT_LEASE_HEADER, spec §7.11): the asking tab drains this device's slips and can print
   *  now, so a slip that prints on this device may be made already leased to it. */
  leaseTabId?: string;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
```

Replace it with:

```ts
  /** Session 2B (PRINT_LEASE_HEADER, spec §7.11): the asking tab drains this device's slips and can print
   *  now, so a slip that prints on this device may be made already leased to it. */
  leaseTabId?: string;
  /** Session 2C (PRINT_READY_HEADER): the printers that tab can print on now (printers mode, decision 15). */
  readyPrinterIds?: string[];
  /** Session 2C (PRINT_BILL_PRINTER_HEADER, decision 7): this device's own bill printer. */
  billPrinterId?: string;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  const leaseTabId = req.headers.get(PRINT_LEASE_HEADER)?.trim() ?? "";
  return {
    deviceId,
    bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON,
    // An unusable tab id only means no direct print: the slips are made queued, as in Phase 1.
    ...(leaseTabId !== "" && leaseTabId.length <= PRINT_HOST_TAB_ID_MAX_CHARS ? { leaseTabId } : {}),
  };
}

```

Replace it with:

```ts
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  const leaseTabId = req.headers.get(PRINT_LEASE_HEADER)?.trim() ?? "";
  const readyPrinterIds = printerIdsOf(req.headers.get(PRINT_READY_HEADER));
  const billPrinterId = printerIdsOf(req.headers.get(PRINT_BILL_PRINTER_HEADER))[0];
  return {
    deviceId,
    bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON,
    // An unusable tab id only means no direct print: the slips are made queued, as in Phase 1.
    ...(leaseTabId !== "" && leaseTabId.length <= PRINT_HOST_TAB_ID_MAX_CHARS ? { leaseTabId } : {}),
    // Unusable printer ids only mean fewer ready printers, or the default bill printer (Session 2C).
    ...(readyPrinterIds.length > 0 ? { readyPrinterIds } : {}),
    ...(billPrinterId !== undefined ? { billPrinterId } : {}),
  };
}

```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  | { kind: "bill" }
  | { kind: "void" }
  | { kind: "moved"; meta: { from?: string; movedBy: string; movedAt: string } };

const UNNAMED_STAFF = "Staff";

/** Kind order inside one request (§7.6 "KOT before bill"); creates run in this order, so createdAt does too. */
const SLIP_ORDER: Record<OrderPrintSlip["kind"], number> = { kot: 0, void: 1, moved: 2, bill: 3 };
```

Replace it with:

```ts
  | { kind: "bill" }
  | { kind: "void" }
  | { kind: "moved"; meta: { from?: string; movedBy: string; movedAt: string } };

/** Kind order inside one request (§7.6 "KOT before bill"); creates run in this order, so createdAt does too. */
const SLIP_ORDER: Record<OrderPrintSlip["kind"], number> = { kot: 0, void: 1, moved: 2, bill: 3 };
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
  }
}

/** One job made, or the one its key already names (a racing replay, an old tab's enqueue, a repair). */
export interface InsertedPrintJob {
  ref: PrintJobRef;
  created: boolean;
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws.
 *  Session 2B (spec §7.11): `tab` is the asking tab, passed only when this job's line is the asking device's
 *  own. With `direct` the job is made already leased to it, in this one write; and a job its key already
 *  names that is still leased to that very tab is handed back with its lease (an answer lost on the way). */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  targetDeviceId: string;
  originDeviceId?: string;
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`. */
  jobKey?: string;
  tab?: PrintJobAskingTab;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
  if (!parsed.success) return null;
  const payload: PrintJobPayload = parsed.data;
  const json = JSON.stringify(payload);
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  const labels = printJobInitialLabels(payload);
  const who = input.tab === undefined ? null : { deviceId: input.targetDeviceId, tabId: input.tab.tabId };
  const direct = who !== null && input.tab?.direct === true ? directLeaseOf({ labels, who, originDeviceId: input.originDeviceId, nowMs: input.nowMs }) : null;
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
      payload: json,
      label: input.request.label,
      // A Mongoose required string refuses "" (house rule: staff names fall back to "Staff").
      queuedBy: input.queuedBy.trim() || UNNAMED_STAFF,
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
      targetDeviceId: input.targetDeviceId,
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      // Made leased to the asking tab (its log says "direct"), or queued as in Phase 1.
      ...(direct ?? { ...printJobLifecycleInit(input.nowMs, labels), log: [printJobCreatedLog(input.nowMs, input.originDeviceId)] }),
    });
    const ref: PrintJobRef = {
      id: String(created._id),
      kind: payload.kind,
      targetDeviceId: input.targetDeviceId,
      label: input.request.label,
      status: direct === null ? "queued" : "leased",
      ...(direct !== null ? { leased: leasedJobOf(created, direct, payload) } : {}),
    };
    return { ref, created: true, status: ref.status };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey })
      .select(who === null ? "kind status label targetDeviceId" : PRINT_REDELIVERY_SELECT)
      .lean<PrintRedeliveryRow>();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const again = who === null ? null : redeliveryOf(existing, who, input.nowMs);
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
      status: existing.status,
      ...(again !== null ? { leased: again } : {}),
    };
    return { ref, created: false, status: existing.status };
  }
}

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1.
 *  Session 2B (spec §7.11, decisions 15 and 16): when the slips print on the asking device and its draining
 *  tab can print now (`leaseTabId`), the first one is made leased to that tab if nothing older waits on its
 *  line; the rest follow it through the ack's `more`, so none of them is announced to the device printing. */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only when no device asked (the public auto-accept, from Session 1C: final review C1). */
  originDeviceId?: string;
  leaseTabId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
  const refs: PrintJobRef[] = [];
  if (input.slips.length === 0) return refs;
  try {
    const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
    // With neither a host nor an asking device nothing is made: the self-order kot-claim lane prints it.
    const target = host?.deviceId ?? input.originDeviceId;
    if (target === undefined) return refs;
    const order = wireOrderOf(input.order);
    const slips = [...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    // The asking tab counts only when the slips print on its own device (the host's own order, or no host).
    const leaseTabId = target === input.originDeviceId ? input.leaseTabId : undefined;
    const lineFree = leaseTabId !== undefined && (await printLineIsFree(target, input.nowMs));
    let directOnLine = false;
    let made = 0;
    for (const slip of slips) {
      const request = requestOf(order, slip);
      if (request === null) continue;
      // Only the first slip of this request on the line may be leased now (§7.6: one writer, oldest first);
      // the rest are made as in Phase 1, so a collision on them never reads a payload (the 2B review, M-1).
      const tab = leaseTabId === undefined || refs.length > 0 ? {} : { tab: { tabId: leaseTabId, direct: lineFree } };
```

Replace it with:

```ts
  }
}

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1.
 *  Session 2B (spec §7.11, decisions 15 and 16): when the slips print on the asking device and its draining
 *  tab can print now (`leaseTabId`), the first one is made leased to that tab if nothing older waits on its
 *  line; the rest follow it through the ack's `more`, so none of them is announced to the device printing.
 *  Session 2C (spec §8): in printers mode every slip is routed to printers (lib/print-printer-jobs.ts), the
 *  host plays no part, and the same rules apply per printer line. */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only when no device asked (the public auto-accept, from Session 1C: final review C1). */
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: string[];
  billPrinterId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
  const refs: PrintJobRef[] = [];
  if (input.slips.length === 0) return refs;
  try {
    const order = wireOrderOf(input.order);
    const slips = [...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    const requests = slips.map((slip) => requestOf(order, slip)).filter((request): request is PrintJobRequest => request !== null);
    // One small read in simple mode (spec §6.6); printers mode adds the stations of these slips' lines.
    const routing = await readPrintRouting({
      productIds: requests.flatMap((request) => printPayloadProductIds(request.payload)),
      ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
    });
    if (routing !== null) {
      const { jobs } = await createRoutedPrintJobs({
        routing,
        requests,
        baseKeyOf: (request) => printJobKeyOf(request.payload),
        originDeviceId: input.originDeviceId,
        leaseTabId: input.leaseTabId,
        readyPrinterIds: input.readyPrinterIds,
        queuedBy: input.queuedBy,
        nowMs: input.nowMs,
      });
      return jobs.map((job) => job.ref);
    }
    const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
    // With neither a host nor an asking device nothing is made: the self-order kot-claim lane prints it.
    const target = host?.deviceId ?? input.originDeviceId;
    if (target === undefined) return refs;
    // The asking tab counts only when the slips print on its own device (the host's own order, or no host).
    const leaseTabId = target === input.originDeviceId ? input.leaseTabId : undefined;
    const lineFree = leaseTabId !== undefined && (await printLineIsFree(target, input.nowMs));
    let directOnLine = false;
    let made = 0;
    for (const request of requests) {
      // Only the first slip of this request on the line may be leased now (§7.6: one writer, oldest first);
      // the rest are made as in Phase 1, so a collision on them never reads a payload (the 2B review, M-1).
      const tab = leaseTabId === undefined || refs.length > 0 ? {} : { tab: { tabId: leaseTabId, direct: lineFree } };
```

Create `apps/cafe/lib/print-printer-jobs.ts`:

```ts
import { PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import type { PrintJobEnqueueResult } from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { announcesQueuedJob, printerLineIsFree } from "@/lib/print-direct";
import { insertPrintJob, type InsertedPrintJob } from "@/lib/print-job-insert";
import { routePrintRequest, routedJobKey, type PrintRouting, type RoutedPrintJob } from "@/lib/print-printer-routing";
import { printJobKeyOf } from "@/lib/print-queue";
import { readPrintRouting } from "@/lib/print-routing-context";
import type { PrintJobRequest } from "@/lib/print-routing";
import { publishPrintStatus } from "@/lib/realtime-publish";

// Printing redesign, Phase 2 Session 2C (spec §8; plan decisions 1–5, 15, 16): job creation in printers mode.
// Every slip a request makes is routed (lib/print-printer-routing.ts) into one job per printer: on that printer's
// line, aimed at its writer (targetDeviceId), with its copies, under routedJobKey (a replay or a repair collides
// instead of printing twice). A slip no printer takes is made failed at once, so it shows under "Couldn't print".
// The first job a request puts on a printer the asking tab writes and can print now is made already leased to it
// (decision 15); every other new queued job is announced to its writer, and nothing to yourself (decision 16).
// Printers mode makes no "print-job" nudge: no host plays a part. Never calls connectDB(). No console.*.

/** The products a slip's stations are resolved for (spec §6.2): its lines; a void, its voided line (which may
 *  have left the order); End of day, none. */
export function printPayloadProductIds(payload: PrintJobPayload): string[] {
  switch (payload.kind) {
    case "void":
      return [payload.line.productId];
    case "eod":
      return [];
    default:
      return payload.snapshot.items.map((item) => item.productId);
  }
}

/** The asking tab for one routed job (decision 15): only on a printer the asking device writes and names as
 *  ready, and only for the request's first job on that printer (§7.6: one writer, oldest first). `seen` holds
 *  the printers this request already put a job on. */
export function askingTabOf(
  job: Pick<RoutedPrintJob, "printerId" | "writerDeviceId">,
  input: { originDeviceId?: string; leaseTabId?: string; readyPrinterIds: readonly string[] },
  seen: Set<string>,
): string | undefined {
  if (job.printerId === null) return undefined;
  const first = !seen.has(job.printerId);
  seen.add(job.printerId);
  if (!first || input.leaseTabId === undefined || job.writerDeviceId !== input.originDeviceId) return undefined;
  return input.readyPrinterIds.includes(job.printerId) ? input.leaseTabId : undefined;
}

/** Makes every job the requests route to and announces each new queued one to its writer. The caller keeps kind
 *  order (KOT before bill, §7.6). `routed` counts the jobs routing asked for (0: nothing to print). A DB error
 *  throws. A routed job's key falls back to printJobKeyOf only when the slip has no key of its own, and then a
 *  station slip has none either (same kind, order and round), so two printers never share a key. */
export async function createRoutedPrintJobs(input: {
  routing: PrintRouting;
  requests: readonly PrintJobRequest[];
  /** The slip's own key: printJobKeyOf, or a client repeat's reprint:<Idempotency-Key>. */
  baseKeyOf: (request: PrintJobRequest) => string | undefined;
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: readonly string[];
  queuedBy: string;
  nowMs: number;
}): Promise<{ jobs: InsertedPrintJob[]; routed: number }> {
  const asking = { originDeviceId: input.originDeviceId, leaseTabId: input.leaseTabId, readyPrinterIds: input.readyPrinterIds ?? [] };
  const seen = new Set<string>();
  const directOn = new Set<string>();
  const jobs: InsertedPrintJob[] = [];
  let routed = 0;
  for (const request of input.requests) {
    const baseKey = input.baseKeyOf(request);
    for (const job of routePrintRequest(request, input.routing)) {
      routed += 1;
      const jobKey = routedJobKey(baseKey, job);
      const common = { request: job.request, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, ...(jobKey !== undefined ? { jobKey } : {}), nowMs: input.nowMs };
      if (job.printerId === null) {
        const made = await insertPrintJob({
          ...common,
          targetDeviceId: input.originDeviceId ?? "",
          line: { printerId: PRINT_JOB_NO_PRINTER, copies: 1 },
          failed: job.error ?? "",
        });
        if (made !== null) jobs.push(made);
        continue;
      }
      const tabId = askingTabOf(job, asking, seen);
      const tab = tabId === undefined ? {} : { tab: { tabId, direct: await printerLineIsFree(job.printerId, input.nowMs) } };
      const made = await insertPrintJob({ ...common, targetDeviceId: job.writerDeviceId ?? "", line: { printerId: job.printerId, copies: job.copies }, ...tab });
      if (made === null) continue;
      jobs.push(made);
      if (made.ref.leased !== undefined) directOn.add(job.printerId);
      if (announcesQueuedJob(made, directOn.has(job.printerId))) publishPrintStatus({ id: made.ref.id, status: "queued", target: made.ref.targetDeviceId });
    }
  }
  return { jobs, routed };
}

/** One client-started slip's jobs as the enqueue's answer (the 2B review gate's ruling R1): nothing routed is
 *  "not-routed" (never a local print); one job answers as in simple mode; several answer the first id and every
 *  job, plus the one made leased to the asking tab. All of them found already resolved: "already-resolved". */
export function routedEnqueueResultOf(jobs: readonly InsertedPrintJob[], routed: number): PrintJobEnqueueResult {
  if (routed === 0) return { outcome: "not-routed" };
  const first = jobs[0];
  if (first === undefined) return { outcome: "too-large" };
  const leased = jobs.find((job) => job.ref.leased !== undefined)?.ref.leased;
  const created = jobs.some((job) => job.created);
  if (!created && leased === undefined && jobs.every((job) => job.status !== "queued")) return { outcome: "already-resolved", id: first.ref.id };
  return {
    outcome: "queued",
    id: first.ref.id,
    duplicate: !created,
    ...(leased !== undefined ? { leased } : {}),
    ...(jobs.length > 1 ? { jobs: jobs.map((job) => job.ref) } : {}),
  };
}

/** POST /api/print-jobs in printers mode (spec §7.3): a client-started slip (a reprint, End of day, a cancel
 *  notice, a slip an order answer did not name) is routed like any other, under its own key or the request's
 *  Idempotency-Key. null: simple mode, so the caller's simple-mode enqueue runs unchanged. */
export async function enqueueRoutedPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: readonly string[];
  billPrinterId?: string;
  nowMs: number;
}): Promise<PrintJobEnqueueResult | null> {
  const routing = await readPrintRouting({
    productIds: printPayloadProductIds(input.payload),
    ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
  });
  if (routing === null) return null;
  const baseKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
  const made = await createRoutedPrintJobs({
    routing,
    requests: [{ payload: input.payload, label: input.label }],
    baseKeyOf: () => baseKey,
    originDeviceId: input.originDeviceId,
    leaseTabId: input.leaseTabId,
    readyPrinterIds: input.readyPrinterIds,
    queuedBy: input.queuedBy,
    nowMs: input.nowMs,
  });
  return routedEnqueueResultOf(made.jobs, made.routed);
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printer-jobs.test.ts lib/print-order-jobs.test.ts lib/self-order-alert-paths.test.ts lib/print-lease.test.ts lib/print-direct.test.ts lib/print-lifecycle-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 62`; `# pass 62`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-job-insert.ts lib/print-printer-jobs.ts lib/print-order-jobs.ts lib/print-direct.ts lib/print-lease.ts lib/print-agent-server.ts app/api/print-jobs/route.ts lib/print-printer-jobs.test.ts lib/print-order-jobs.test.ts lib/print-lease.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add "apps/cafe/app/api/order-requests/[id]/accept/route.ts" "apps/cafe/app/api/orders/[id]/items/route.ts" "apps/cafe/app/api/orders/[id]/items/void/route.ts" "apps/cafe/app/api/orders/[id]/settle/route.ts" "apps/cafe/app/api/orders/[id]/table/route.ts" apps/cafe/app/api/orders/route.ts apps/cafe/app/api/print-jobs/route.ts apps/cafe/lib/print-agent-server.ts apps/cafe/lib/print-direct.ts apps/cafe/lib/print-job-insert.ts apps/cafe/lib/print-lease.test.ts apps/cafe/lib/print-lease.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/lib/print-order-jobs.ts apps/cafe/lib/print-printer-jobs.test.ts apps/cafe/lib/print-printer-jobs.ts apps/cafe/lib/self-order-alert-paths.test.ts apps/cafe/package.json
git commit -m "feat(print): Phase 2 printers mode on the server: every slip an order request makes is routed to its printers, one job per printer line with its copies, a slip no printer takes is made failed at once, and the asking tab's first job on a printer it writes is made leased to it"
```

---

### Task C3: a lease per printer line, only by its writer, claimed for that writer; the ack's `more` asks the acked job's own line; the pulse and the wake count every job aimed at the device

**Files:**
- Modify: `apps/cafe/lib/print-lease.ts` (`leaseLineHead` with a claim; `leasePrintJobs` with `printerIds`; `printerLineHasMore`; `ackPrintJob`'s `more` per line; `printJobsForMeFilter` and `readJobsForDevice` count every job aimed at the device and name its printers)
- Modify: `apps/cafe/lib/print-lifecycle-schemas.ts` (`printerIds` on the lease body), `apps/cafe/app/api/print-jobs/lease/route.ts`
- Modify: `packages/shared/src/print-agent-wire.ts` (`PrintJobsForMe`, with `printerIds?`), `packages/shared/src/self-order-alert.ts` (the pulse's `printJobsForMe` uses it), `packages/shared/src/print-lifecycle.ts` (`PrintJobSet.targetDeviceId?`)
- Modify: `apps/cafe/scripts/print-host-live/printers.ts` (leg aj ends in simple mode: a saved printer now routes every slip, and the legs after it start in simple mode)
- Tests: `apps/cafe/lib/print-lease.test.ts` (the jobs-for-me test widened deliberately), `print-lifecycle-paths.test.ts` (one new pin; the lease CAS, the no-host lease and the ack's `more` pins changed deliberately)

**Interfaces produced:** `leasePrintJobs({ deviceId, tabId, printerIds?, dismissedBy, nowMs })` → at most one job per line; `printerLineHasMore(printerId, nowMs)`; `printJobsForMeFilter(deviceId, nowMs)`; `readJobsForDevice(deviceId, nowMs)` → `PrintJobsForMe` (`{ count, oldestCreatedAt, printerIds? }`); the lease body accepts `printerIds?: string[]` (at most `PRINTERS_MAX`).

**One writer per printer** (spec §9.3, decision 1): a lease call leases the device's own simple line and the line of each routable printer it names that it really writes (one read of the printers: enabled, taking a slip, its writer this device). A printer line is fenced on its printer alone and the lease claims the job for this writer (`targetDeviceId`) in the same write, so a job still aimed at the printer's old writer is leased by its new one at once (the 2C review's I-3), and a printer never has two writers. At most one job per line (§7.6): a stuck bar job never blocks the kitchen. `retryAt` is the soonest moment a line that gave no job can be leased again.

**`more` per line** (the 2B gate's ruling R3): a printer job asks its own printer's line, a simple-mode job the device's line.

**Jobs for me count every job aimed at the device** (the 2C review's I-2, replacing ruling R8's ready printers): the pulse and the wake take no printer list; the answer names the printers of the printer jobs it counted (`printerIds`), so a device whose printer list is stale (a missed `print-setup` frame) learns it from its next pulse or wake (Task C6 reads the list again).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-lease.test.ts`, find:

```ts

// Session 2B (found on the emulator at the 2A gate): the pulse and the wake counted this device's own running
// lease, so one landing mid-print kicked the agent into an empty lease after its ack.
test("printJobsForMeFilter: the line, less a lease still running; a lease that ran out still counts (its lease call expires it)", () => {
  assert.deepEqual(printJobsForMeFilter("dev-a", T0), {
    ...printJobLineFilter("dev-a", T0),
    $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(T0) } }],
  });
});
```

Replace it with:

```ts

// Session 2B (found on the emulator at the 2A gate): the pulse and the wake counted this device's own running
// lease, so one landing mid-print kicked the agent into an empty lease after its ack.
// Session 2C deliberately widened it to every line job aimed at the device: its own line AND the lines of the
// printers it writes (a printer job is aimed at its writer), whether or not its printer list knows them yet (the
// 2C gate's fresh review, I-2: a stale list must not hide a writer's own slips from its pulse and wake).
test("printJobsForMeFilter: every line job aimed at it, less a lease still running; a lease that ran out still counts (its lease call expires it)", () => {
  const { printerId: _simpleOnly, ...line } = printJobLineFilter("dev-a", T0);
  assert.deepEqual(printJobsForMeFilter("dev-a", T0), {
    ...line,
    $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(T0) } }],
  });
});
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.match(s, /PrintJob\.updateOne\(\{ \.\.\.printJobCasFilter\(id, job\), \.\.\.fence \}, printJobUpdateOf\(patch\)/);
  assert.match(s, /return res\.modifiedCount === 1;/);
  assert.ok(!s.includes("publishPrintStatus") && !s.includes("realtime-publish"), "the lifecycle's transitions publish nothing");
  assert.match(s, /applyPrintJobPlan\(head\._id, job, plan\.patch, \{ targetDeviceId: input\.deviceId \}\)/, "the lease CAS is fenced on the device");
  assert.match(s, /for \(let step = 0; step < LEASE_MAX_STEPS; step\+\+\)/);
  assert.match(s, /printJobEligibility\(payload, order\)/, "the claim path's live-order gate still applies to a lease");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
```

Replace it with:

```ts
  assert.match(s, /PrintJob\.updateOne\(\{ \.\.\.printJobCasFilter\(id, job\), \.\.\.fence \}, printJobUpdateOf\(patch\)/);
  assert.match(s, /return res\.modifiedCount === 1;/);
  assert.ok(!s.includes("publishPrintStatus") && !s.includes("realtime-publish"), "the lifecycle's transitions publish nothing");
  // Session 2C deliberately moved the fence into each line: the device's own line is fenced on the device; a
  // printer line on its printer, and the lease claims the job for its verified writer (the 2C lease pin below).
  assert.match(s, /applyPrintJobPlan\(head\._id, job, claimed, fence\)/, "the lease CAS is fenced on its line");
  assert.match(s, /for \(let step = 0; step < LEASE_MAX_STEPS; step\+\+\)/);
  assert.match(s, /printJobEligibility\(payload, order\)/, "the claim path's live-order gate still applies to a lease");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t" }).success, true);
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d" }).success, false, "a tab id makes two windows on one PC distinguishable");
  for (const decision of ["reprint", "printed", "dismiss"]) assert.equal(confirmBodySchema.safeParse({ decision }).success, true, decision);
  assert.equal(confirmBodySchema.safeParse({ decision: "maybe" }).success, false);
  const beat = {
```

Replace it with:

```ts
test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t" }).success, true);
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d" }).success, false, "a tab id makes two windows on one PC distinguishable");
  // Session 2C: the printers this tab can print on now; at most a cafe's twelve (the lib drops anything else).
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t", printerIds: ["a".repeat(24)] }).success, true);
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t", printerIds: Array.from({ length: 13 }, () => "a".repeat(24)) }).success, false, "never more than a cafe can have");
  for (const decision of ["reprint", "printed", "dismiss"]) assert.equal(confirmBodySchema.safeParse({ decision }).success, true, decision);
  assert.equal(confirmBodySchema.safeParse({ decision: "maybe" }).success, false);
  const beat = {
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts

test("PIN: the lease route's heartbeat is best-effort (M1), and a lease call that cleared four bad heads says when to look again (M2)", () => {
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)\.catch\(\(\) => undefined\),/);
  assert.match(src(LEASE), /return \{ jobs: \[\], retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});

// The Phase 2B gate (G-1, deliberate change): a final state ("printed", "needs-confirm", "failed",
```

Replace it with:

```ts

test("PIN: the lease route's heartbeat is best-effort (M1), and a lease call that cleared four bad heads says when to look again (M2)", () => {
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)\.catch\(\(\) => undefined\),/);
  // Session 2C: per line now (leaseLineHead), so a line that cleared four bad heads gives no job and a retry time.
  assert.match(src(LEASE), /return \{ job: null, retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});

// The Phase 2B gate (G-1, deliberate change): a final state ("printed", "needs-confirm", "failed",
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };',
      "const more = await printLineHasMore(input.deviceId, input.nowMs).catch(() => undefined);",
      "...(more !== undefined ? { more } : {})",
    ],
    "the ack",
  );
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printJobLineFilter\(deviceId, nowMs\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "one read on the line index");
});

test("PIN (the Phase 1 final gate, M8): the soak drives only a local POS on a local scratch database, and stops after its first order unless that order is in its own database", () => {
```

Replace it with:

```ts
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };',
      "const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs) : printLineHasMore(input.deviceId, input.nowMs)).catch(",
      "() => undefined,",
      "...(more !== undefined ? { more } : {})",
    ],
    "the ack",
  );
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printJobLineFilter\(deviceId, nowMs\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "one read on the line index");
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Session 2C (spec §7.6, §9.3; plan decision 1): a device leases its simple line and the line of each printer it
// names that it really writes (one read of the printers: routable, this device its writer), each fenced on its
// line, so a printer never has two writers and a stuck bar job never blocks the kitchen. A printer line's lease
// claims the job for its verified writer (the 2C gate's review, I-3: a re-saved printer's new writer takes its
// waiting job at once).
test("PIN (2C): a lease takes the head of the device's line and of each printer line it writes, one job per line", () => {
  const s = src(LEASE);
  const lease = s.slice(s.indexOf("export async function leasePrintJobs("), s.indexOf("export async function ackPrintJob("));
  inOrder(
    lease,
    [
      "[{ line: printJobLineFilter(input.deviceId, input.nowMs), fence: { targetDeviceId: input.deviceId } }];",
      "for (const printer of routablePrinters(await listPrinters())) {",
      "if (input.printerIds.includes(printer.id) && printerWriterDeviceId(printer) === input.deviceId) {",
      "lines.push({ line: printerLineFilter(printer.id, input.nowMs), fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });",
      "const result = await leaseLineHead(line, fence, input, claim);",
    ],
    "the lease",
  );
  assert.match(src(ROUTES.lease), /printerIds: printerIdsOf\(parsed\.data\.printerIds\),/, "the route passes only real printer ids");
});

test("PIN (the Phase 1 final gate, M8): the soak drives only a local POS on a local scratch database, and stops after its first order unless that order is in its own database", () => {
```

In `apps/cafe/scripts/print-host-live/printers.ts`, find:

```ts
    return payload?.kind === "kot" ? payload.snapshot.items.map((line) => line.name).join("+") : "";
  };
  check("(aj) end to end: the kitchen gets Hot Coffee and Paneer, the bar the Mojito, the counter all three", jobs.length === 3 && itemsOf(0) === "Hot Coffee+Paneer Tikka" && itemsOf(1) === "Mojito" && itemsOf(2) === "Mojito+Hot Coffee+Paneer Tikka");
}

```

Replace it with:

```ts
    return payload?.kind === "kot" ? payload.snapshot.items.map((line) => line.name).join("+") : "";
  };
  check("(aj) end to end: the kitchen gets Hot Coffee and Paneer, the bar the Mojito, the counter all three", jobs.length === 3 && itemsOf(0) === "Hot Coffee+Paneer Tikka" && itemsOf(1) === "Mojito" && itemsOf(2) === "Mojito+Hot Coffee+Paneer Tikka");
  // Session 2C: a saved printer now routes every slip, so the legs after this one start in simple mode again.
  await resetSetup();
}

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lease.test.ts lib/print-lifecycle-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 26`; `# pass 20`; `# fail 6`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/print-jobs/lease/route.ts`, find:

```ts
import { connectDB } from "@/lib/db";
import { leasePrintJobs } from "@/lib/print-lease";
import { touchPrintDevice } from "@/lib/print-device";
import { leaseBodySchema } from "@/lib/print-lifecycle-schemas";
```

Replace it with:

```ts
import { connectDB } from "@/lib/db";
import { printerIdsOf } from "@pos/shared/print-printers";
import { leasePrintJobs } from "@/lib/print-lease";
import { touchPrintDevice } from "@/lib/print-device";
import { leaseBodySchema } from "@/lib/print-lifecycle-schemas";
```

In `apps/cafe/app/api/print-jobs/lease/route.ts`, find:

```ts
      leasePrintJobs({
        deviceId: parsed.data.deviceId,
        tabId: parsed.data.tabId,
        dismissedBy: authed.session.user.name ?? UNNAMED_STAFF,
        nowMs,
      }),
```

Replace it with:

```ts
      leasePrintJobs({
        deviceId: parsed.data.deviceId,
        tabId: parsed.data.tabId,
        // Session 2C: the printers this tab can print on now; the lib keeps those this device really writes.
        printerIds: printerIdsOf(parsed.data.printerIds),
        dismissedBy: authed.session.user.name ?? UNNAMED_STAFF,
        nowMs,
      }),
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_BACKOFF_MS,
  PRINT_JOB_LOG_MAX,
```

Replace it with:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintJobsForMe, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_BACKOFF_MS,
  PRINT_JOB_LOG_MAX,
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  type PrintJobPatch,
  type PrintJobSet,
} from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

```

Replace it with:

```ts
  type PrintJobPatch,
  type PrintJobSet,
} from "@pos/shared/print-lifecycle";
import { PRINT_JOB_NO_PRINTER, printerWriterDeviceId, routablePrinters } from "@pos/shared/print-printers";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { listPrinters } from "./print-printers";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

```

In `apps/cafe/lib/print-lease.ts`, find:

```ts

/** The fields every lifecycle read selects; lifecycleOf reads exactly these. */
export const PRINT_LIFECYCLE_SELECT = "kind status createdAt epoch attempts uncertainAttempts nextAttemptAt labels approvedAt lease";
const LEASE_SELECT = `${PRINT_LIFECYCLE_SELECT} label orderId payload copyIndex`;
/** Bounds one lease call: each step expires, fails or dismisses one bad head, or loses one race. */
const LEASE_MAX_STEPS = 4;
const ACK_MAX_STEPS = 2;
```

Replace it with:

```ts

/** The fields every lifecycle read selects; lifecycleOf reads exactly these. */
export const PRINT_LIFECYCLE_SELECT = "kind status createdAt epoch attempts uncertainAttempts nextAttemptAt labels approvedAt lease";
const LEASE_SELECT = `${PRINT_LIFECYCLE_SELECT} label orderId payload copyIndex printerId copies`;
/** Bounds one lease call: each step expires, fails or dismisses one bad head, or loses one race. */
const LEASE_MAX_STEPS = 4;
const ACK_MAX_STEPS = 2;
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
export const PRINT_JOBS_FOR_ME_LIMIT = 20;

export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number };

/** A line's own jobs: its leased one, plus each queued job that is not parked as stale. needs-confirm and
 *  failed jobs are parked and never block the line. A leased job stays at the head whatever its age, so a line
```

Replace it with:

```ts
export const PRINT_JOBS_FOR_ME_LIMIT = 20;

export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number; printerId?: string; copies?: number };

/** A line's own jobs: its leased one, plus each queued job that is not parked as stale. needs-confirm and
 *  failed jobs are parked and never block the line. A leased job stays at the head whatever its age, so a line
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number; printerId?: string; copies?: number };

/** The wire job for one lease (spec §7.3), from its row: leased by a lease request, made leased at creation,
```

Replace it with:

```ts
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

/** Session 2C: the same, for a printer job's own printer line (the 2B gate's ruling R3). */
export async function printerLineHasMore(printerId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne({ ...printerLineFilter(printerId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number; printerId?: string; copies?: number };

/** The wire job for one lease (spec §7.3), from its row: leased by a lease request, made leased at creation,
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  return payload;
}

/** Leases the head of this device's line (spec §7.6: at most one job per printer). An expired lease
 *  at the head is applied lazily here, so a dead writer never blocks the line past 90 s. */
export async function leasePrintJobs(input: { deviceId: string; tabId: string; dismissedBy: string; nowMs: number }): Promise<PrintLeaseData> {
  for (let step = 0; step < LEASE_MAX_STEPS; step++) {
    const head = await PrintJob.findOne(printJobLineFilter(input.deviceId, input.nowMs))
      .sort({ createdAt: 1, _id: 1 })
      .select(LEASE_SELECT)
      .lean<LeaseHead>();
    if (head === null) return { jobs: [], retryAt: null };
    const job = lifecycleOf(head);
    if (job.status === "leased") {
      const expiry = planExpiry(job, input.nowMs);
      // A live lease (another tab of this device is writing it): the line waits for that ack.
      if (!expiry.ok) return { jobs: [], retryAt: job.lease?.expiresAt.toISOString() ?? null };
      await applyPrintJobPlan(head._id, job, expiry.patch);
      continue;
    }
```

Replace it with:

```ts
  return payload;
}

type LeaseInput = { deviceId: string; tabId: string; dismissedBy: string; nowMs: number };

/** Leases the head of one line (spec §7.6: at most one job per line). An expired lease at the head is
 *  applied lazily here, so a dead writer never blocks the line past 90 s. `claim`: fields the lease also sets
 *  (a printer line: its verified writer). */
async function leaseLineHead(
  line: FilterQuery<IPrintJob>,
  fence: FilterQuery<IPrintJob>,
  input: LeaseInput,
  claim?: PrintJobSet,
): Promise<{ job: LeasedPrintJob | null; retryAt: string | null }> {
  for (let step = 0; step < LEASE_MAX_STEPS; step++) {
    const head = await PrintJob.findOne(line).sort({ createdAt: 1, _id: 1 }).select(LEASE_SELECT).lean<LeaseHead>();
    if (head === null) return { job: null, retryAt: null };
    const job = lifecycleOf(head);
    if (job.status === "leased") {
      const expiry = planExpiry(job, input.nowMs);
      // A live lease (another tab of this device is writing it): the line waits for that ack.
      if (!expiry.ok) return { job: null, retryAt: job.lease?.expiresAt.toISOString() ?? null };
      await applyPrintJobPlan(head._id, job, expiry.patch);
      continue;
    }
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
    }
    const plan = planLease(job, input, input.nowMs);
    // In backoff, the head HOLDS the line (kitchen order is kept); the agent sets one timer.
    if (!plan.ok) return { jobs: [], retryAt: plan.reason === "not-due" ? job.nextAttemptAt.toISOString() : null };
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    // Fenced on the target too: a retarget (the sweep, a host change) between the read and this CAS
    // moves the job to another device's line, and this device must not win it then (1A review M5).
    if (!(await applyPrintJobPlan(head._id, job, plan.patch, { targetDeviceId: input.deviceId }))) continue;
    return { jobs: [leasedPrintJobOf(head, plan.patch, payload, job.labels)], retryAt: null };
  }
  // Every step cleared one bad head or lost one race, so the line may still hold a printable job:
  // look again after the shortest backoff instead of waiting for a nudge (1A review M2).
  return { jobs: [], retryAt: new Date(input.nowMs + PRINT_BACKOFF_MS[0]).toISOString() };
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = planAck(job, input, input.nowMs);
```

Replace it with:

```ts
    }
    const plan = planLease(job, input, input.nowMs);
    // In backoff, the head HOLDS the line (kitchen order is kept); the agent sets one timer.
    if (!plan.ok) return { job: null, retryAt: plan.reason === "not-due" ? job.nextAttemptAt.toISOString() : null };
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    // Fenced on the target too: a retarget (the sweep, a host change) between the read and this CAS moves the job
    // to another device's line, and this device must not win it then (1A review M5). A printer line is fenced on
    // its printer and claims the job for its writer, verified by the caller: a writer that changed since the job
    // was made (a re-saved printer) takes it at once, never spinning until the sweep (the 2C gate's review, I-3).
    const claimed = claim === undefined ? plan.patch : { ...plan.patch, set: { ...plan.patch.set, ...claim } };
    if (!(await applyPrintJobPlan(head._id, job, claimed, fence))) continue;
    return { job: leasedPrintJobOf(head, plan.patch, payload, job.labels), retryAt: null };
  }
  // Every step cleared one bad head or lost one race, so the line may still hold a printable job:
  // look again after the shortest backoff instead of waiting for a nudge (1A review M2).
  return { job: null, retryAt: new Date(input.nowMs + PRINT_BACKOFF_MS[0]).toISOString() };
}

/** Leases the head of this device's line, and (Session 2C, printers mode) the head of each printer line it names
 *  that it really writes: routable (as the sweep sees it), with this device as its writer, read fresh (§9.3,
 *  decision 1: one writer per printer). At most one job per line, so a stuck bar job never blocks the kitchen.
 *  retryAt: the soonest moment a line that gave no job can be leased again. */
export async function leasePrintJobs(input: LeaseInput & { printerIds?: readonly string[] }): Promise<PrintLeaseData> {
  type Line = { line: FilterQuery<IPrintJob>; fence: FilterQuery<IPrintJob>; claim?: PrintJobSet };
  const lines: Line[] = [{ line: printJobLineFilter(input.deviceId, input.nowMs), fence: { targetDeviceId: input.deviceId } }];
  if (input.printerIds !== undefined && input.printerIds.length > 0) {
    for (const printer of routablePrinters(await listPrinters())) {
      if (input.printerIds.includes(printer.id) && printerWriterDeviceId(printer) === input.deviceId) {
        lines.push({ line: printerLineFilter(printer.id, input.nowMs), fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });
      }
    }
  }
  const jobs: LeasedPrintJob[] = [];
  let retryAt: string | null = null;
  for (const { line, fence, claim } of lines) {
    const result = await leaseLineHead(line, fence, input, claim);
    if (result.job !== null) jobs.push(result.job);
    else if (result.retryAt !== null && (retryAt === null || result.retryAt < retryAt)) retryAt = result.retryAt;
  }
  return { jobs, retryAt };
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(`${PRINT_LIFECYCLE_SELECT} printerId`).lean<PrintLifecycleRow & { printerId?: string }>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = planAck(job, input, input.nowMs);
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
      const nextAttemptAt = plan.patch.set.nextAttemptAt?.toISOString() ?? null;
      // Session 2B (decision 9): a job that left the line says whether the acking device's line holds more. A
      // job back in the queue is that line's head, and its nextAttemptAt says when. A failed read only drops
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed.
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      const more = await printLineHasMore(input.deviceId, input.nowMs).catch(() => undefined);
      return { applied: true, status: plan.patch.status, nextAttemptAt, ...(more !== undefined ? { more } : {}) };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The jobs a lease call could act on now: this device's line, less any lease still running. A running
 *  lease is being printed (often by this very tab, Session 2B's direct print), so counting it only kicked
 *  the agent into an empty lease after its ack; a lease that ran out still counts, so the lease call that
 *  expires it comes (spec §7.2). */
export function printJobsForMeFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { ...printJobLineFilter(deviceId, nowMs), $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(nowMs) } }] } as FilterQuery<IPrintJob>;
}

/** The wake's "jobs for me" (spec §7.3), and the pulse's: how many jobs wait in this device's line for a
 *  lease, and the oldest. */
export async function readJobsForDevice(deviceId: string, nowMs: number): Promise<{ count: number; oldestCreatedAt: string | null }> {
  const rows = await PrintJob.find(printJobsForMeFilter(deviceId, nowMs))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
    .lean<{ createdAt: Date }[]>();
  return { count: rows.length, oldestCreatedAt: rows[0]?.createdAt.toISOString() ?? null };
}

```

Replace it with:

```ts
      const nextAttemptAt = plan.patch.set.nextAttemptAt?.toISOString() ?? null;
      // Session 2B (decision 9): a job that left the line says whether the acking device's line holds more. A
      // job back in the queue is that line's head, and its nextAttemptAt says when. A failed read only drops
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed. Session 2C: a printer job
      // asks its own printer's line (the 2B gate's ruling R3).
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs) : printLineHasMore(input.deviceId, input.nowMs)).catch(
        () => undefined,
      );
      return { applied: true, status: plan.patch.status, nextAttemptAt, ...(more !== undefined ? { more } : {}) };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The jobs a lease call could act on now: every line job aimed at this device (its own line, and since Session
 *  2C the lines of the printers it writes), less any lease still running. A running lease is being printed (often
 *  by this very tab, Session 2B's direct print), so counting it only kicked the agent into an empty lease after its
 *  ack; a lease that ran out still counts, so the lease call that expires it comes (spec §7.2). Printer jobs are
 *  counted whether or not the device's printer list knows them yet (the 2C gate's review, I-2). */
export function printJobsForMeFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return { targetDeviceId: deviceId, ...lineJobs(nowMs), $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(nowMs) } }] } as FilterQuery<IPrintJob>;
}

/** The wake's "jobs for me" (spec §7.3), and the pulse's: how many jobs wait for this device, the oldest, and
 *  the printers of the printer jobs among them (Session 2C: an agent whose list lacks one reads its printers). */
export async function readJobsForDevice(deviceId: string, nowMs: number): Promise<PrintJobsForMe> {
  const rows = await PrintJob.find(printJobsForMeFilter(deviceId, nowMs))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt printerId")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
    .lean<{ createdAt: Date; printerId?: string }[]>();
  const printerIds = [...new Set(rows.map((row) => row.printerId).filter((id): id is string => id !== undefined && id !== PRINT_JOB_NO_PRINTER))];
  return { count: rows.length, oldestCreatedAt: rows[0]?.createdAt.toISOString() ?? null, ...(printerIds.length > 0 ? { printerIds } : {}) };
}

```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
import { z } from "zod";
import { PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
```

Replace it with:

```ts
import { z } from "zod";
import { PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINTERS_MAX, PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts

const deviceId = z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS);
const tabId = z.string().trim().min(1).max(PRINT_HOST_TAB_ID_MAX_CHARS);

/** POST /api/print-jobs/wake: the heartbeat (spec §10). */
export const wakeBeatBodySchema = z
```

Replace it with:

```ts

const deviceId = z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS);
const tabId = z.string().trim().min(1).max(PRINT_HOST_TAB_ID_MAX_CHARS);
/** Session 2C (printers mode): the printers this tab can print on now (the lease body). The lib keeps only
 *  real printer ids (printerIdsOf), so an odd value only means fewer printers. */
const printerIds = z.array(z.string().trim().max(PRINTER_DEVICE_ID_MAX_CHARS)).max(PRINTERS_MAX).optional();

/** POST /api/print-jobs/wake: the heartbeat (spec §10). */
export const wakeBeatBodySchema = z
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
  .strict();

/** POST /api/print-jobs/lease. */
export const leaseBodySchema = z.object({ deviceId, tabId }).strict();

/** POST /api/print-jobs/[id]/ack. A printed ack says nothing else; a failed one must say whether
 *  any byte was sent (spec §7.5: "no" only when the writer KNOWS nothing reached the printer). */
```

Replace it with:

```ts
  .strict();

/** POST /api/print-jobs/lease. */
export const leaseBodySchema = z.object({ deviceId, tabId, printerIds }).strict();

/** POST /api/print-jobs/[id]/ack. A printed ack says nothing else; a failed one must say whether
 *  any byte was sent (spec §7.5: "no" only when the writer KNOWS nothing reached the printer). */
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  reason?: PrintJobActionRefusal;
}

/** POST /api/print-jobs/wake. serverNow lets an agent run timers on server time (spec §15 clock skew). */
export interface PrintWakeBeatData {
  jobsForMe: { count: number; oldestCreatedAt: string | null };
  agents: number;
  agentDailyCap: number;
  serverNow: string;
```

Replace it with:

```ts
  reason?: PrintJobActionRefusal;
}

/** The jobs waiting for this device (spec §7.3; the wake's and the pulse's): how many, the oldest, and since
 *  Session 2C the printers of the printer jobs among them, so an agent whose printer list is stale reads it again
 *  (the 2C gate's fresh review, I-2). */
export interface PrintJobsForMe {
  count: number;
  oldestCreatedAt: string | null;
  printerIds?: string[];
}

/** POST /api/print-jobs/wake. serverNow lets an agent run timers on server time (spec §15 clock skew). */
export interface PrintWakeBeatData {
  jobsForMe: PrintJobsForMe;
  agents: number;
  agentDailyCap: number;
  serverNow: string;
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
/** The fields a transition may $set. */
export interface PrintJobSet {
  status?: PrintJobStatus;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
```

Replace it with:

```ts
/** The fields a transition may $set. */
export interface PrintJobSet {
  status?: PrintJobStatus;
  /** Session 2C: a printer job claimed for its printer's current writer (a lease, a staff retry). */
  targetDeviceId?: string;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
```

In `packages/shared/src/self-order-alert.ts`, find:

```ts
// the same predicates run identically wherever the provider mounts.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrintAttentionRow } from "./print-agent-wire";
import type { PrintHostState, PrintJobFeedRow, PrintJobResolvedRow } from "./print-job";

/** Server-side scan bound when counting/paging OPEN self-order requests — a
```

Replace it with:

```ts
// the same predicates run identically wherever the provider mounts.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrintAttentionRow, PrintJobsForMe } from "./print-agent-wire";
import type { PrintHostState, PrintJobFeedRow, PrintJobResolvedRow } from "./print-job";

/** Server-side scan bound when counting/paging OPEN self-order requests — a
```

In `packages/shared/src/self-order-alert.ts`, find:

```ts
  resolvedPrintJobsTruncated: boolean;
  // Printing Phase 1 Session 1C (spec §9.1): present only when the tab named itself (?device=): how
  // many jobs wait in this device's own line, and the oldest. Absent on a failed read.
  printJobsForMe?: { count: number; oldestCreatedAt: string | null };
  // Printing Phase 1 Session 1D (spec §10): every slip that waits for people, cafe-wide: the one
  // waiting-slips panel, its count on the printer button, and the 20 s KOT alarm. Absent on a failed read.
  printAttention?: PrintAttentionRow[];
```

Replace it with:

```ts
  resolvedPrintJobsTruncated: boolean;
  // Printing Phase 1 Session 1C (spec §9.1): present only when the tab named itself (?device=): how
  // many jobs wait in this device's own line, and the oldest. Absent on a failed read.
  printJobsForMe?: PrintJobsForMe;
  // Printing Phase 1 Session 1D (spec §10): every slip that waits for people, cafe-wide: the one
  // waiting-slips panel, its count on the printer button, and the 20 s KOT alarm. Absent on a failed read.
  printAttention?: PrintAttentionRow[];
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lease.test.ts lib/print-lifecycle-paths.test.ts lib/print-order-jobs.test.ts lib/print-attention.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 50`; `# pass 50`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-lease.ts lib/print-lifecycle-schemas.ts app/api/print-jobs/lease/route.ts scripts/print-host-live/printers.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/print-jobs/lease/route.ts apps/cafe/lib/print-lease.test.ts apps/cafe/lib/print-lease.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-lifecycle-schemas.ts apps/cafe/scripts/print-host-live/printers.ts packages/shared/src/print-agent-wire.ts packages/shared/src/print-lifecycle.ts packages/shared/src/self-order-alert.ts
git commit -m "feat(print): Phase 2 a lease per printer line, only by its writer: the device's own line and each printer it names that it writes, one job per line, claimed for that writer; the ack's more asks the acked job's own line; the pulse and the wake count every job aimed at the device"
```

---

### Task C4: the sweep, the repair and a staff retry in printers mode

**Files:**
- Modify: `apps/cafe/lib/print-sweep.ts` (`routeWaitingPrintJobs` leaves printer jobs alone; `routePrinterJobs`; the sweep's step 2a)
- Modify: `apps/cafe/lib/print-queue.ts` (the host teardown's dismissal leaves printer jobs alone)
- Modify: `apps/cafe/lib/print-repair.ts` (`kotRoundKeyOf`, `presentKotRoundsFilter`)
- Modify: `apps/cafe/lib/print-job-actions.ts` (a Retry / Print again on a job whose printer is gone is refused), `apps/cafe/lib/print-waiting.ts` (its notice)
- Tests: `apps/cafe/lib/print-lifecycle-paths.test.ts` (two new pins), `print-attention.test.ts` (one pin changed deliberately), `print-waiting.test.ts`, `print-repair.test.ts`

**Interfaces produced:** `routePrinterJobs(nowMs)` → `{ retargeted, failed }`; `kotRoundKeyOf(jobKey)`; `presentKotRoundsFilter(keys)`; the action refusal `printer-gone`.

**A printer job follows its printer** (decision 1): a printer re-saved with another device or printing device takes its waiting jobs to that writer (`retargeted`, logged); a queued job whose printer was deleted, switched off or left with no writer fails with "This printer was removed or switched off.", never guessed onto another printer. A bill waiting for the cashier's answer keeps waiting for it (the 2C review's I-1: "It printed" and Clear still work). A leased job is left to its lease. One read when no queued or needs-confirm printer job waits (every simple-mode cafe). Simple mode's moves and the host teardown never touch a printer job.

**A staff Retry, Print again or Print now** on a job whose printer is gone (or `none`) is refused (`printer-gone`, the 2B gate's ruling R2; the notice: "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order."). On a printer that still takes slips, the job goes back in line on its printer's current writer, in the same write, and the queued print-status is aimed at that writer (the 2C review's I-3).

**The repair of a routed round** (spec §7.4): one read on the jobKey index with anchored prefixes (`^kot:<order>:<round>(:|$)`), so a round with no job at all is routed again with today's setup, and a round with some of its jobs is left alone (one request made them together).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-attention.test.ts`, find:

```ts

test("PIN (D7): a staff Retry or Print again announces its job to the device that prints it", () => {
  const s = src("apps/cafe/lib/print-job-actions.ts");
  assert.match(s, /\.select\(`\$\{PRINT_LIFECYCLE_SELECT\} targetDeviceId`\)/, "the row says where it prints");
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/, "the host still hears the broadcast nudge");
  assert.match(
    s,
    /if \(plan\.patch\.status === "queued"\) publishPrintStatus\(\{ id, status: "queued", \.\.\.\(row\.targetDeviceId \? \{ target: row\.targetDeviceId \} : \{\}\) \}\);/,
    "aimed: with no host only that device's agent leases on it (it ignores the broadcast)",
  );
});
```

Replace it with:

```ts

test("PIN (D7): a staff Retry or Print again announces its job to the device that prints it", () => {
  const s = src("apps/cafe/lib/print-job-actions.ts");
  // Session 2C deliberately added printerId to the read (the 2B gate's ruling R2: a gone printer is refused).
  assert.match(s, /\.select\(`\$\{PRINT_LIFECYCLE_SELECT\} targetDeviceId printerId`\)/, "the row says where it prints");
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/, "the host still hears the broadcast nudge");
  // Session 2C deliberately aims it at the job's current writer (a printer job retried on a re-saved printer).
  assert.match(
    s,
    /if \(plan\.patch\.status === "queued"\) publishPrintStatus\(\{ id, status: "queued", \.\.\.\(target \? \{ target \} : \{\}\) \}\);/,
    "aimed: with no host only that device's agent leases on it (it ignores the broadcast)",
  );
});
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  const s = src(ACTIONS);
  assert.match(s, /planConfirm\(job, input\.decision, input\.staff, input\.nowMs\)/);
  assert.match(s, /planRetry\(job, input\.nowMs\)/);
  assert.match(s, /await applyPrintJobPlan\(row\._id, job, plan\.patch\)/);
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 1);
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/);
  assert.ok(!/PrintJob\.(create|updateOne|findOneAndUpdate|updateMany|deleteMany)\(/.test(s), "no direct PrintJob write");
```

Replace it with:

```ts
  const s = src(ACTIONS);
  assert.match(s, /planConfirm\(job, input\.decision, input\.staff, input\.nowMs\)/);
  assert.match(s, /planRetry\(job, input\.nowMs\)/);
  // Session 2C: the plan, plus a printer job's current writer (the R2 pin below).
  assert.match(s, /await applyPrintJobPlan\(row\._id, job, patch\)/);
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 1);
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/);
  assert.ok(!/PrintJob\.(create|updateOne|findOneAndUpdate|updateMany|deleteMany)\(/.test(s), "no direct PrintJob write");
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.match(s, /if \(result\.requeued > 0 \|\| result\.retargeted > 0\) publishCafeEvent\("print-job"\);/);
  assert.equal(count(s, ".limit(PRINT_SWEEP_BATCH)"), 2, "both sweep reads are bounded");
  assert.ok(!s.includes("console."));
});

// ── Task 6: request bodies and routes ────────────────────────────────────────
```

Replace it with:

```ts
  assert.match(s, /if \(result\.requeued > 0 \|\| result\.retargeted > 0\) publishCafeEvent\("print-job"\);/);
  assert.equal(count(s, ".limit(PRINT_SWEEP_BATCH)"), 2, "both sweep reads are bounded");
  assert.ok(!s.includes("console."));
});

// Session 2C (printers mode): a printer job waits on its printer's line. Simple mode's moves (to the host, or
// back to the asking device) and the host teardown's dismissal never touch it; it follows its printer's writer,
// and fails visibly when its printer is gone (deleted, switched off, no writer), never guessed onto another.
test("PIN (2C): the sweep moves a waiting printer job only with its printer, and fails it when its printer is gone", () => {
  const s = src(SWEEP);
  inOrder(s, ["await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);", "routePrinterJobs(nowMs)", "await repairMissingKotJobs(nowMs);"], "sweep order");
  const simple = s.slice(s.indexOf("export async function routeWaitingPrintJobs("), s.indexOf("export async function returnPrintJobsToOrigins("));
  assert.equal(count(simple, "printerId: { $exists: false }"), 3, "neither move nor the dismissal reaches a printer job");
  const printers = s.slice(s.indexOf("export async function routePrinterJobs("), s.indexOf("export async function sweepPrintJobs("));
  inOrder(
    printers,
    [
      'status: { $in: ["queued", "needs-confirm"] } })',
      "if (waiting === null) return { retargeted: 0, failed: 0 };",
      "const printers = routablePrinters(await listPrinters());",
      "{ printerId: printer.id, status: { $in: WAITING }, targetDeviceId: { $ne: writer } }",
      "{ printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: \"queued\" }",
      "$set: { status: \"failed\", lastError: PRINTER_GONE_MESSAGE }",
    ],
    "routePrinterJobs",
  );
  const queue = src("apps/cafe/lib/print-queue.ts");
  const bulk = queue.slice(queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("), queue.indexOf("export async function prunePrintJobs("));
  assert.match(bulk, /printerId: \{ \$exists: false \},/, "Stop printing here never cancels a printer's slips");
});

test("PIN (2C ruling R2): Retry or Print again on a job whose printer is gone is refused; on a printer that still takes slips it goes to its current writer", () => {
  const s = src(ACTIONS);
  assert.match(s, /\.select\(`\$\{PRINT_LIFECYCLE_SELECT\} targetDeviceId printerId`\)/, "the row says which printer it is for");
  inOrder(
    s,
    [
      'if (plan.patch.status === "queued" && row.printerId !== undefined) {',
      "const printer = routablePrinterOf(await listPrinters(), row.printerId);",
      'if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };',
      "target = printerWriterDeviceId(printer) ?? target;",
      "patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };",
      "if (await applyPrintJobPlan(row._id, job, patch)) {",
    ],
    "the retry (the 2C gate's review, I-3: retargeted in the same write)",
  );
});

// ── Task 6: request bodies and routes ────────────────────────────────────────
```

In `apps/cafe/lib/print-repair.test.ts`, find:

```ts
import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_BUDGET_BUSY_DAY } from "@pos/shared/print-budget";
import { PRINT_REPAIR_WINDOW_MS } from "@pos/shared/print-lifecycle";
import { PRINT_REPAIR_BATCH, expectedKotJobs } from "@/lib/print-repair";
import { printJobKeyOf } from "@/lib/print-queue";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order } from "@/types";
```

Replace it with:

```ts
import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_BUDGET_BUSY_DAY } from "@pos/shared/print-budget";
import { PRINT_REPAIR_WINDOW_MS } from "@pos/shared/print-lifecycle";
import { PRINT_REPAIR_BATCH, expectedKotJobs, kotRoundKeyOf, presentKotRoundsFilter } from "@/lib/print-repair";
import { printJobKeyOf } from "@/lib/print-queue";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order } from "@/types";
```

In `apps/cafe/lib/print-repair.test.ts`, find:

```ts
  assert.ok(PRINT_REPAIR_BATCH <= 100, `batch ${PRINT_REPAIR_BATCH}: one small indexed read per sweep (spec §17)`);
});

```

Replace it with:

```ts
  assert.ok(PRINT_REPAIR_BATCH <= 100, `batch ${PRINT_REPAIR_BATCH}: one small indexed read per sweep (spec §17)`);
});

// Session 2C (printers mode): a routed round's jobs carry `kot:<order>:<round>:<printer>:<part>`. A round with
// none of them is routed again with today's setup; a round with some is left alone (one request made them).
test("2C: the repair sees a round's jobs under today's key or any routed key, and only that round's", () => {
  assert.equal(kotRoundKeyOf("kot:o1:2"), "kot:o1:2", "simple mode");
  assert.equal(kotRoundKeyOf("kot:o1:2:p1:st-kitchen"), "kot:o1:2", "a routed station slip");
  assert.equal(kotRoundKeyOf("kot:o1:2:none:all"), "kot:o1:2", "a routed job no printer took");
  assert.equal(kotRoundKeyOf(undefined), undefined);
  const filter = presentKotRoundsFilter(["kot:o1:1", "kot:o1:2"]);
  assert.deepEqual(filter, { $or: [{ jobKey: { $regex: "^kot:o1:1(:|$)" } }, { jobKey: { $regex: "^kot:o1:2(:|$)" } }] }, "anchored prefixes on the jobKey index");
  const re = new RegExp(filter.$or[0]?.jobKey.$regex ?? "");
  assert.equal(re.test("kot:o1:10"), false, "round 1 never finds round 10's jobs");
  assert.equal(re.test("kot:o1:1:p1:all"), true);
});

```

In `apps/cafe/lib/print-waiting.test.ts`, find:

```ts
  assert.equal(printRetryNotice({ applied: false, status: "queued", reason: "wrong-status" }), "It prints by itself as soon as the printer is ready.");
  assert.equal(printRetryNotice({ applied: false, status: "printed", reason: "wrong-status" }), "Already handled.");
  assert.equal(printRetryNotice({ applied: false, status: null, reason: "not-found" }), "Already handled.");
});

test("PIN: the panel shows the waiting slips, the button shows their count, and both stay within their budgets", () => {
```

Replace it with:

```ts
  assert.equal(printRetryNotice({ applied: false, status: "queued", reason: "wrong-status" }), "It prints by itself as soon as the printer is ready.");
  assert.equal(printRetryNotice({ applied: false, status: "printed", reason: "wrong-status" }), "Already handled.");
  assert.equal(printRetryNotice({ applied: false, status: null, reason: "not-found" }), "Already handled.");
  // Session 2C (the 2B gate's ruling R2): never guessed onto another printer.
  assert.equal(printRetryNotice({ applied: false, status: "failed", reason: "printer-gone" }), "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order.");
});

test("PIN: the panel shows the waiting slips, the button shows their count, and both stay within their budgets", () => {
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-attention.test.ts lib/print-waiting.test.ts lib/print-repair.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 53`; `# pass 47`; `# fail 6`

- [ ] **Step 3: The code**

Replace the whole of `apps/cafe/lib/print-job-actions.ts` with:

```ts
import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { lifecycleOf, planConfirm, planRetry, type PrintJobDecision, type PrintJobLifecycle, type PrintJobPlan } from "@pos/shared/print-lifecycle";
import { printerWriterDeviceId, routablePrinterOf } from "@pos/shared/print-printers";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";

// Printing redesign, Phase 1 (spec §7.2, §7.3): the staff decisions. "Print again?" on a bill that
// may already be on paper (confirm), and Print again on a failed job or Print now on a stale one
// (retry). Allowed from any device that can see the job. Every write is one CAS through
// print-lease.ts. Never calls connectDB(). No console.*.

const ACTION_MAX_STEPS = 2;

async function act(id: string, decide: (job: PrintJobLifecycle) => PrintJobPlan): Promise<PrintActionData> {
  for (let step = 0; step < ACTION_MAX_STEPS; step++) {
    const row = await PrintJob.findById(id)
      .select(`${PRINT_LIFECYCLE_SELECT} targetDeviceId printerId`)
      .lean<PrintLifecycleRow & { targetDeviceId?: string; printerId?: string }>();
    if (row === null) return { applied: false, status: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = decide(job);
    if (!plan.ok) return { applied: false, status: job.status, reason: plan.reason };
    // Session 2C (the 2B gate's ruling R2): back in line only on a printer that still takes slips; a gone one
    // (deleted, switched off, no writer, or none at all) is never guessed onto another printer. A printer that still
    // takes slips gets the job on its current writer's line, in the same write (the 2C gate's review, I-3).
    let patch = plan.patch;
    let target = row.targetDeviceId;
    if (plan.patch.status === "queued" && row.printerId !== undefined) {
      const printer = routablePrinterOf(await listPrinters(), row.printerId);
      if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };
      target = printerWriterDeviceId(printer) ?? target;
      patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };
    }
    if (await applyPrintJobPlan(row._id, job, patch)) {
      // Back in the queue: nudge the printing device, so it leases now rather than on its next poll.
      // Fire-and-forget; the poll still finds it if the nudge is lost.
      if (plan.patch.status === "queued") publishCafeEvent("print-job");
      // Session 1D (D7): also aimed at the device whose line holds it. With no host, agents never lease on
      // the broadcast above (1B M-c), so without this a tap would wait for that device's next pulse.
      if (plan.patch.status === "queued") publishPrintStatus({ id, status: "queued", ...(target ? { target } : {}) });
      return { applied: true, status: plan.patch.status };
    }
  }
  return { applied: false, status: null, reason: "raced" };
}

export function confirmPrintJob(input: { id: string; decision: PrintJobDecision; staff: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, (job) => planConfirm(job, input.decision, input.staff, input.nowMs));
}

export function retryPrintJob(input: { id: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, (job) => planRetry(job, input.nowMs));
}
```

In `apps/cafe/lib/print-queue.ts`, find:

```ts
 *  so routeWaitingPrintJobs (print-sweep.ts) sends it back there instead. */
export async function dismissQueuedPrintJobsForClearedHost(dismissedBy: string): Promise<number> {
  const res = await PrintJob.updateMany(
    { status: { $in: ["queued", "needs-confirm", "failed"] }, claimedAt: { $exists: false }, originDeviceId: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: new Date(), dismissReason: "host-cleared", dismissedBy } },
  );
  return res.modifiedCount ?? 0;
```

Replace it with:

```ts
 *  so routeWaitingPrintJobs (print-sweep.ts) sends it back there instead. */
export async function dismissQueuedPrintJobsForClearedHost(dismissedBy: string): Promise<number> {
  const res = await PrintJob.updateMany(
    // Session 2C: never a printer job; its printer, not the host, prints it.
    { printerId: { $exists: false }, status: { $in: ["queued", "needs-confirm", "failed"] }, claimedAt: { $exists: false }, originDeviceId: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: new Date(), dismissReason: "host-cleared", dismissedBy } },
  );
  return res.modifiedCount ?? 0;
```

In `apps/cafe/lib/print-repair.ts`, find:

```ts
  return out;
}

/** Re-creates the missing jobs of server-owned KOT rounds fired in the last 30 min. Returns how many it
 *  made. Indexed on createdAt: orders opened in the last 12 h (its own window since the 1D review gate,
 *  so the 3 h queued retention never stops a long-sitting table's new round from being repaired). */
export async function repairMissingKotJobs(nowMs: number): Promise<number> {
  const since = new Date(nowMs - PRINT_REPAIR_WINDOW_MS);
```

Replace it with:

```ts
  return out;
}

/** Session 2C (printers mode): the round a job's key names. A routed job's key adds its printer and part
 *  (`kot:<order>:<round>:<printer>:<part>`), so its first three parts name the round. */
export function kotRoundKeyOf(jobKey: string | undefined): string | undefined {
  return jobKey === undefined ? undefined : jobKey.split(":").slice(0, 3).join(":");
}

/** One read on the jobKey index: each expected round's job under today's key or any routed key (an anchored
 *  prefix, so round 1 never finds round 10). Order ids are hex and rounds digits: nothing to escape. */
export function presentKotRoundsFilter(keys: readonly string[]): { $or: Array<{ jobKey: { $regex: string } }> } {
  return { $or: keys.map((key) => ({ jobKey: { $regex: `^${key}(:|$)` } })) };
}

/** Re-creates the missing jobs of server-owned KOT rounds fired in the last 30 min. Returns how many it
 *  made. Session 2C: a round with no job at all is routed again with today's setup (createOrderPrintJobs); a
 *  round with some of its jobs is left alone (one request made them together). Indexed on createdAt: orders opened in the last 12 h (its own window since the 1D review gate,
 *  so the 3 h queued retention never stops a long-sitting table's new round from being repaired). */
export async function repairMissingKotJobs(nowMs: number): Promise<number> {
  const since = new Date(nowMs - PRINT_REPAIR_WINDOW_MS);
```

In `apps/cafe/lib/print-repair.ts`, find:

```ts
    .lean<RepairCandidate[]>();
  const expected = expectedKotJobs(candidates, nowMs);
  if (expected.length === 0) return 0;
  const present = await PrintJob.find({ jobKey: { $in: expected.map((job) => job.jobKey) } })
    .select("jobKey")
    .lean<Array<{ jobKey?: string }>>();
  const have = new Set(present.map((row) => row.jobKey));
  let repaired = 0;
  for (const missing of expected) {
    if (have.has(missing.jobKey)) continue;
```

Replace it with:

```ts
    .lean<RepairCandidate[]>();
  const expected = expectedKotJobs(candidates, nowMs);
  if (expected.length === 0) return 0;
  const present = await PrintJob.find(presentKotRoundsFilter(expected.map((job) => job.jobKey)))
    .select("jobKey")
    .lean<Array<{ jobKey?: string }>>();
  const have = new Set(present.map((row) => kotRoundKeyOf(row.jobKey)));
  let repaired = 0;
  for (const missing of expected) {
    if (have.has(missing.jobKey)) continue;
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_PAPER_ATTEMPTS,
```

Replace it with:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER, printerWriterDeviceId, routablePrinters } from "@pos/shared/print-printers";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_PAPER_ATTEMPTS,
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { prunePrintJobsThrottled } from "./print-queue";
import { repairMissingKotJobs } from "./print-repair";

```

Replace it with:

```ts
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";
import { prunePrintJobsThrottled } from "./print-queue";
import { repairMissingKotJobs } from "./print-repair";

```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
 *  host, it is the device that asked for the job (1A review I1 part 2: a slip aimed at a cleared or
 *  dead host goes back to its ordering device, labelled as it was); a job no device asked for (an old
 *  tab's enqueue, the public auto-accept) has no device left that may print it and is dismissed as
 *  host-cleared. Returns how many jobs moved. Pipeline updates: one write each, however many rows. */
export async function routeWaitingPrintJobs(hostDeviceId: string | null, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  if (hostDeviceId !== null) {
    const moved = await PrintJob.updateMany(
      { status: { $in: WAITING }, targetDeviceId: { $ne: hostDeviceId } },
      {
        $set: { targetDeviceId: hostDeviceId },
        $push: { log: { $each: [{ at, event: "retargeted", deviceId: hostDeviceId }], $slice: -PRINT_JOB_LOG_MAX } },
```

Replace it with:

```ts
 *  host, it is the device that asked for the job (1A review I1 part 2: a slip aimed at a cleared or
 *  dead host goes back to its ordering device, labelled as it was); a job no device asked for (an old
 *  tab's enqueue, the public auto-accept) has no device left that may print it and is dismissed as
 *  host-cleared. Returns how many jobs moved. Pipeline updates: one write each, however many rows.
 *  Session 2C: a printer job waits on its printer's line, so none of this ever reaches it
 *  (routePrinterJobs moves it). */
export async function routeWaitingPrintJobs(hostDeviceId: string | null, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  if (hostDeviceId !== null) {
    const moved = await PrintJob.updateMany(
      { status: { $in: WAITING }, printerId: { $exists: false }, targetDeviceId: { $ne: hostDeviceId } },
      {
        $set: { targetDeviceId: hostDeviceId },
        $push: { log: { $each: [{ at, event: "retargeted", deviceId: hostDeviceId }], $slice: -PRINT_JOB_LOG_MAX } },
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
    return moved.modifiedCount ?? 0;
  }
  const home = await PrintJob.updateMany(
    { status: { $in: WAITING }, originDeviceId: { $exists: true }, $expr: { $ne: ["$targetDeviceId", "$originDeviceId"] } },
    [
      {
        $set: {
```

Replace it with:

```ts
    return moved.modifiedCount ?? 0;
  }
  const home = await PrintJob.updateMany(
    { status: { $in: WAITING }, printerId: { $exists: false }, originDeviceId: { $exists: true }, $expr: { $ne: ["$targetDeviceId", "$originDeviceId"] } },
    [
      {
        $set: {
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
    ],
  );
  await PrintJob.updateMany(
    { status: { $in: WAITING }, originDeviceId: { $exists: false }, claimedAt: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: at, dismissReason: "host-cleared", dismissedBy: SWEEP_ACTOR } },
  );
  return home.modifiedCount ?? 0;
```

Replace it with:

```ts
    ],
  );
  await PrintJob.updateMany(
    { status: { $in: WAITING }, printerId: { $exists: false }, originDeviceId: { $exists: false }, claimedAt: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: at, dismissReason: "host-cleared", dismissedBy: SWEEP_ACTOR } },
  );
  return home.modifiedCount ?? 0;
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
  const moved = await routeWaitingPrintJobs(null, nowMs);
  if (moved > 0) publishCafeEvent("print-job");
  return moved;
}

export async function sweepPrintJobs(nowMs: number): Promise<PrintSweepResult> {
```

Replace it with:

```ts
  const moved = await routeWaitingPrintJobs(null, nowMs);
  if (moved > 0) publishCafeEvent("print-job");
  return moved;
}

/** Session 2C (printers mode, plan decision 1): every waiting job on a printer line follows its printer. A printer
 *  re-saved with another device (or printing device) takes its jobs to that writer; a queued job whose printer was
 *  deleted, switched off or left with no writer is failed with PRINTER_GONE_MESSAGE, shown under "Couldn't print",
 *  never guessed onto another printer. A bill waiting for the cashier's answer keeps waiting for it (the 2C gate's
 *  review, I-1: "It printed" and Clear still work; Print again is refused while the printer is gone). A leased job
 *  is left to its lease. One read when no queued or needs-confirm printer job waits (every simple-mode cafe, and
 *  every outlet whose waiting rows are only failed ones); otherwise the printers, one write per printer and one for
 *  the gone ones. */
export async function routePrinterJobs(nowMs: number): Promise<{ retargeted: number; failed: number }> {
  const waiting = await PrintJob.findOne({ printerId: { $exists: true, $ne: PRINT_JOB_NO_PRINTER }, status: { $in: ["queued", "needs-confirm"] } })
    .select("_id")
    .lean();
  if (waiting === null) return { retargeted: 0, failed: 0 };
  const at = new Date(nowMs);
  const printers = routablePrinters(await listPrinters());
  let retargeted = 0;
  for (const printer of printers) {
    const writer = printerWriterDeviceId(printer) ?? "";
    const moved = await PrintJob.updateMany(
      { printerId: printer.id, status: { $in: WAITING }, targetDeviceId: { $ne: writer } },
      { $set: { targetDeviceId: writer }, $push: { log: { $each: [{ at, event: "retargeted", deviceId: writer }], $slice: -PRINT_JOB_LOG_MAX } } },
    );
    retargeted += moved.modifiedCount ?? 0;
  }
  const gone = await PrintJob.updateMany(
    { printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: "queued" },
    {
      $set: { status: "failed", lastError: PRINTER_GONE_MESSAGE },
      $push: { log: { $each: [{ at, event: "failed", detail: PRINTER_GONE_MESSAGE }], $slice: -PRINT_JOB_LOG_MAX } },
    },
  );
  return { retargeted, failed: gone.modifiedCount ?? 0 };
}

export async function sweepPrintJobs(nowMs: number): Promise<PrintSweepResult> {
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
  // 2. Every waiting job to the device that should print it now (§6.6).
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  result.retargeted = await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);

  // 2b. Re-create the missing job of a server-owned KOT round (§7.4; print-repair.ts).
  result.repaired = await repairMissingKotJobs(nowMs);
```

Replace it with:

```ts
  // 2. Every waiting job to the device that should print it now (§6.6).
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  result.retargeted = await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);
  // 2a. Printers mode (Session 2C): a printer job follows its printer's writer, or fails when its printer is gone.
  const printerMoves = await routePrinterJobs(nowMs);
  result.retargeted += printerMoves.retargeted;
  result.failed += printerMoves.failed;

  // 2b. Re-create the missing job of a server-owned KOT round (§7.4; print-repair.ts).
  result.repaired = await repairMissingKotJobs(nowMs);
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
/** What a Retry / Print now tap says when the server did not apply it (null: done). */
export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.status === "queued" && answer.reason === "wrong-status") return "It prints by itself as soon as the printer is ready.";
  return "Already handled.";
}
```

Replace it with:

```ts
/** What a Retry / Print now tap says when the server did not apply it (null: done). */
export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.reason === "printer-gone") return "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order.";
  if (answer.status === "queued" && answer.reason === "wrong-status") return "It prints by itself as soon as the printer is ready.";
  return "Already handled.";
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-attention.test.ts lib/print-waiting.test.ts lib/print-repair.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 53`; `# pass 53`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-sweep.ts lib/print-queue.ts lib/print-repair.ts lib/print-job-actions.ts lib/print-waiting.ts lib/print-repair.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-attention.test.ts apps/cafe/lib/print-job-actions.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-queue.ts apps/cafe/lib/print-repair.test.ts apps/cafe/lib/print-repair.ts apps/cafe/lib/print-sweep.ts apps/cafe/lib/print-waiting.test.ts apps/cafe/lib/print-waiting.ts
git commit -m "feat(print): Phase 2 the sweep, the repair and a staff retry in printers mode: a printer job follows its printer's writer or fails when its printer is gone, a round with no job is routed again, and a retry is never guessed onto another printer"
```

---

### Task C5: the writers' wake allowance from the setup, a device's bill printer only when routable, names unique ignoring case, and a print-setup realtime kind

**Files:**
- Modify: `packages/shared/src/print-agent-wire.ts` (`printAgentDailyCap`)
- Modify: `apps/cafe/app/api/print-jobs/wake/route.ts` (the answer's `agentDailyCap` from the setup)
- Modify: `apps/cafe/lib/print-printer-routing.ts` (a chosen bill printer only when routable: the 2A gate's M9)
- Modify: `apps/cafe/lib/print-stations.ts`, `apps/cafe/lib/print-printers.ts` (names unique ignoring case: the 2A gate's M7; each printer write publishes `print-setup`)
- Modify: `apps/cafe/lib/realtime-publish.ts` and `workers/realtime/src/index.ts` (the `print-setup` kind on both sides)
- Tests: `packages/shared/src/print-printers.test.ts`, `apps/cafe/lib/print-printer-routing.test.ts`, `print-setup-paths.test.ts`

**Interfaces produced:** `printAgentDailyCap(printers, onlineAgents)`: printers mode `printWakeWriterCap(writers)`, simple mode `printWakeAgentCap(agents)`; the realtime kind `print-setup`.

**The writers' allowance** (the 2A gate's Important 1, the server half): in printers mode the wake answers each writer its share of `PRINT_WAKE_PRINTERS_DAILY_CAP` split by the writers the setup names, never by who is online. The client half is Task C6.

**M9:** a device's chosen bill printer counts only when routable (enabled, with a writer, taking a slip), so its writer always polls; any other choice falls back to the default bill printer (ruling R4). **M7:** "Bar" and "bar" are one name: a pre-check read with a case-insensitive collation in create and update (the 2A indexes stay as they are on every database; ruling R5).

**print-setup** (ruling R6): each printer write publishes it (two Worker requests per admin save, never per slip) and every device reads its printers again (Task C6). Stations change no device's printers, so a station write publishes nothing. The Worker's kind list changes: the Worker is redeployed with the go-live run (Worker first). The dead `usePrintHostWake` hook is already pinned with no call site (`print-wake.test.ts`): no change (ruling R7).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-printer-routing.test.ts`, find:

```ts
  assert.deepEqual(kitchenAsBill.map((j) => j.printerId), ["kitchen"], "the device's own choice need not be a default bill printer");
  const nowhere = routePrintRequest(request, routing([KITCHEN_P]));
  assert.deepEqual(nowhere.map((j) => [j.printerId, j.error]), [[null, "No printer is set up for bills."]]);
});

test("End of day: the asking device's bill printer, else the first End of day printer, else the default bill printer", () => {
```

Replace it with:

```ts
  assert.deepEqual(kitchenAsBill.map((j) => j.printerId), ["kitchen"], "the device's own choice need not be a default bill printer");
  const nowhere = routePrintRequest(request, routing([KITCHEN_P]));
  assert.deepEqual(nowhere.map((j) => [j.printerId, j.error]), [[null, "No printer is set up for bills."]]);
  // The 2A gate's M9 (ruled at the 2B gate, R4): a choice that takes no slip is not routable, so its writer would
  // not poll the wake; it falls back to the default bill printer.
  const idle = printer("idle", {}, { order: 7 });
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, idle], { billPrinterId: "idle" })).map((j) => j.printerId), ["counter"], "a choice that takes no slip");
});

test("End of day: the asking device's bill printer, else the first End of day printer, else the default bill printer", () => {
```

In `apps/cafe/lib/print-setup-paths.test.ts`, find:

```ts
  assert.ok(!/from "mongoose"/.test(file), "no mongoose");
});

```

Replace it with:

```ts
  assert.ok(!/from "mongoose"/.test(file), "no mongoose");
});

// Session 2C (the 2A gate's M7): "Bar" and "bar" would both print BAR, so names are unique ignoring case: a
// pre-check read with a case-insensitive collation (the 2A indexes stay as they are on every database).
test("PIN (2C, M7): a station or printer name is refused when another differs from it only in case", () => {
  for (const [rel, model] of [["lib/print-stations.ts", "Station"], ["lib/print-printers.ts", "Printer"]] as const) {
    const s = src(rel);
    assert.match(s, /const NAME_IGNORING_CASE = \{ locale: "en", strength: 2 \} as const;/, `${rel}: one collation`);
    assert.match(s, new RegExp(`${model}\\.findOne\\(\\{ name, \\.\\.\\.\\(exceptId !== undefined \\? \\{ _id: \\{ \\$ne: exceptId \\} \\} : \\{\\}\\) \\}\\)\\.collation\\(NAME_IGNORING_CASE\\)`), `${rel}: the pre-check`);
  }
});

// Session 2C (the 2B gate's ruling R6): every printer write tells each device to read its printers again (two
// Worker requests per admin save, never per slip). Stations change no device's printers.
test("PIN (2C): each printer write publishes print-setup; the kind is the room's, on both sides", () => {
  const s = src("lib/print-printers.ts");
  assert.equal(s.split('publishCafeEvent("print-setup")').length - 1, 3, "create, replace, delete");
  assert.ok(!src("lib/print-stations.ts").includes("print-setup"), "a station write publishes nothing");
  assert.match(src("lib/realtime-publish.ts"), /"print-setup",/);
  assert.match(src("../../workers/realtime/src/index.ts"), /"print-setup"/);
});

test("PIN (2C, the 2A gate's Important 1): the wake answers each agent's share from the setup", () => {
  const s = src("app/api/print-jobs/wake/route.ts");
  assert.match(s, /listPrinters\(\)/, "one read of the printers");
  assert.match(s, /agentDailyCap: printAgentDailyCap\(printers, agents\),/);
});

```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
  type StationConfig,
} from "./print-printers";
import { printJobPayloadSchema } from "./schemas/print-job.schema";

// Printing redesign, Phase 2 (spec §6.1–6.3, §8, §9.3): the pure rules every side reads.

```

Replace it with:

```ts
  type StationConfig,
} from "./print-printers";
import { printJobPayloadSchema } from "./schemas/print-job.schema";
import { PRINT_WAKE_PRINTERS_DAILY_CAP, printAgentDailyCap, printWakeAgentCap } from "./print-agent-wire";

// Printing redesign, Phase 2 (spec §6.1–6.3, §8, §9.3): the pure rules every side reads.

```

In `packages/shared/src/print-printers.test.ts`, find:

```ts
  assert.equal(routablePrinterOf(printers, PRINT_JOB_NO_PRINTER), null, "the no-printer mark is never a printer");
});

```

Replace it with:

```ts
  assert.equal(routablePrinterOf(printers, PRINT_JOB_NO_PRINTER), null, "the no-printer mark is never a printer");
});

// Session 2C (the 2A gate's Important 1, the server half): each agent's share of the wake. Printers mode splits
// the cafe's 14,000 by the writers the setup names, never by who is online; simple mode keeps 14,400 by agents.
test("2C: the wake allowance per agent: printers mode by the setup's writers, simple mode by the agents online", () => {
  const two = [printer("p1"), printer("p2"), printer("p3", { connection: { kind: "device", deviceId: "dev-p1", transport: "usb", address: "x" } })];
  assert.equal(printAgentDailyCap(two, 5), Math.floor(PRINT_WAKE_PRINTERS_DAILY_CAP / 2), "two writers (dev-p1 writes two printers), however many are online");
  assert.equal(printAgentDailyCap([], 3), printWakeAgentCap(3), "simple mode: today's split");
  assert.equal(printAgentDailyCap([printer("off", { enabled: false })], 1), printWakeAgentCap(1), "a disabled printer keeps simple mode");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printer-routing.test.ts lib/print-setup-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 30`; `# pass 26`; `# fail 4`

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents } from "@/lib/print-device";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printWakeAgentCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

Replace it with:

```ts
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printAgentDailyCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
  try {
    await connectDB();
    await beatPrintDevice(parsed.data, nowMs);
    const [jobsForMe, agents] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs), countOnlineAgents(nowMs)]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
```

Replace it with:

```ts
  try {
    await connectDB();
    await beatPrintDevice(parsed.data, nowMs);
    const [jobsForMe, agents, printers] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs), countOnlineAgents(nowMs), listPrinters()]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
    const data: PrintWakeBeatData = {
      jobsForMe,
      agents,
      agentDailyCap: printWakeAgentCap(agents),
      serverNow: new Date(nowMs).toISOString(),
    };
    return noStore(success(data));
```

Replace it with:

```ts
    const data: PrintWakeBeatData = {
      jobsForMe,
      agents,
      // Session 2C (the 2A gate's Important 1): printers mode shares the writers' allowance by the setup.
      agentDailyCap: printAgentDailyCap(printers, agents),
      serverNow: new Date(nowMs).toISOString(),
    };
    return noStore(success(data));
```

In `apps/cafe/lib/print-printer-routing.ts`, find:

```ts
  defaultStationOf,
  printNoPrinterMessage,
  printerWriterDeviceId,
  routablePrinters,
  type PrintKotStationMode,
  type PrinterConfig,
```

Replace it with:

```ts
  defaultStationOf,
  printNoPrinterMessage,
  printerWriterDeviceId,
  routablePrinterOf,
  routablePrinters,
  type PrintKotStationMode,
  type PrinterConfig,
```

In `apps/cafe/lib/print-printer-routing.ts`, find:

```ts
  return out;
}

/** The asking device's own bill printer, when it can print: enabled and with a writer (it need not take
 *  bills by default; the device chose it). */
function chosenBillPrinter(routing: PrintRouting): PrinterConfig | null {
  if (routing.billPrinterId === undefined) return null;
  const chosen = routing.printers.find((printer) => printer.id === routing.billPrinterId);
  return chosen !== undefined && chosen.enabled && printerWriterDeviceId(chosen) !== null ? chosen : null;
}

/** The jobs one slip becomes in printers mode (spec §8). Empty only for a KOT with no lines, and for a
```

Replace it with:

```ts
  return out;
}

/** The asking device's own bill printer, when routing may send it slips: enabled, with a writer, taking some
 *  slip (it need not take bills by default; the device chose it). The 2A gate's M9, ruled at the 2B gate: a
 *  printer that takes no slip is not routable, so its writer would not poll the wake; such a choice falls back
 *  to the default bill printer. */
function chosenBillPrinter(routing: PrintRouting): PrinterConfig | null {
  return routing.billPrinterId === undefined ? null : routablePrinterOf(routing.printers, routing.billPrinterId);
}

/** The jobs one slip becomes in printers mode (spec §8). Empty only for a KOT with no lines, and for a
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import type { PrintSetupResult } from "@/lib/print-stations";

// Printing redesign, Phase 2 (spec §6.3, §11): the outlet's printers. The setup screens (Session 2D) save a
// printer whole; the routing (lib/print-printer-routing.ts) and, from Session 2C, the agent read them as
```

Replace it with:

```ts
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import type { PrintSetupResult } from "@/lib/print-stations";
import { publishCafeEvent } from "@/lib/realtime-publish";

// Printing redesign, Phase 2 (spec §6.3, §11): the outlet's printers. The setup screens (Session 2D) save a
// printer whole; the routing (lib/print-printer-routing.ts) and, from Session 2C, the agent read them as
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
export const PRINTER_EXISTS_MESSAGE = "A printer with this name already exists.";
export const PRINTERS_FULL_MESSAGE = `A cafe can have at most ${PRINTERS_MAX} printers.`;
export const PRINTER_UNKNOWN_STATION_MESSAGE = "A chosen station no longer exists. Reload and choose again.";

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled"> & {
  _id: Types.ObjectId;
```

Replace it with:

```ts
export const PRINTER_EXISTS_MESSAGE = "A printer with this name already exists.";
export const PRINTERS_FULL_MESSAGE = `A cafe can have at most ${PRINTERS_MAX} printers.`;
export const PRINTER_UNKNOWN_STATION_MESSAGE = "A chosen station no longer exists. Reload and choose again.";

/** Session 2C (the 2A gate's M7): a printer name is unique ignoring case (a pre-check read; see print-stations.ts). */
const NAME_IGNORING_CASE = { locale: "en", strength: 2 } as const;

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled"> & {
  _id: Types.ObjectId;
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
  const existing = await Printer.find().select("order").lean<Array<{ order: number }>>();
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  // The unique name index must exist before the first insert (house rule: crud-route.ts).
  await Printer.init();
  try {
    const created = await Printer.create({ ...stored, order: order ?? last + 1 });
    return { ok: true, data: printerWireOf(created) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
```

Replace it with:

```ts
  const existing = await Printer.find().select("order").lean<Array<{ order: number }>>();
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  if (await nameTaken(stored.name)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  // The unique name index must exist before the first insert (house rule: crud-route.ts).
  await Printer.init();
  try {
    const created = await Printer.create({ ...stored, order: order ?? last + 1 });
    // Session 2C: every device reads its printers again (two Worker requests per admin save, never per slip).
    publishCafeEvent("print-setup");
    return { ok: true, data: printerWireOf(created) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
  const printer = await Printer.findById(id);
  if (printer === null) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  printer.set("connection", stored.connection);
  printer.set("primaryDeviceId", stored.primaryDeviceId);
  printer.set({ name: stored.name, paper: stored.paper, slips: stored.slips, copies: stored.copies, enabled: stored.enabled });
  if (order !== undefined) printer.order = order;
  try {
    await printer.save();
    return { ok: true, data: printerWireOf(printer) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
```

Replace it with:

```ts
  const printer = await Printer.findById(id);
  if (printer === null) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  if (await nameTaken(stored.name, id)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  printer.set("connection", stored.connection);
  printer.set("primaryDeviceId", stored.primaryDeviceId);
  printer.set({ name: stored.name, paper: stored.paper, slips: stored.slips, copies: stored.copies, enabled: stored.enabled });
  if (order !== undefined) printer.order = order;
  try {
    await printer.save();
    publishCafeEvent("print-setup");
    return { ok: true, data: printerWireOf(printer) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts

export async function deletePrinter(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const res = await Printer.deleteOne({ _id: id });
  return res.deletedCount === 1 ? { ok: true, data: { deleted: true } } : { ok: false, status: 404, error: PRINTER_NOT_FOUND };
}

```

Replace it with:

```ts

export async function deletePrinter(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const res = await Printer.deleteOne({ _id: id });
  if (res.deletedCount !== 1) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  publishCafeEvent("print-setup");
  return { ok: true, data: { deleted: true } };
}

```

In `apps/cafe/lib/print-stations.ts`, find:

```ts
export const STATION_EXISTS_MESSAGE = "A station with this name already exists.";
export const STATIONS_FULL_MESSAGE = `A cafe can have at most ${STATIONS_MAX} stations.`;
export const STATION_DEFAULT_DELETE_MESSAGE = "The default station can't be deleted. Make another station the default first.";

interface StationRow {
  _id: Types.ObjectId;
```

Replace it with:

```ts
export const STATION_EXISTS_MESSAGE = "A station with this name already exists.";
export const STATIONS_FULL_MESSAGE = `A cafe can have at most ${STATIONS_MAX} stations.`;
export const STATION_DEFAULT_DELETE_MESSAGE = "The default station can't be deleted. Make another station the default first.";

/** Session 2C (the 2A gate's M7): "Bar" and "bar" would both print BAR, so a name is unique ignoring case. A
 *  pre-check read (the 2A unique index stays as it is on every database); two admins racing can still land a
 *  pair, which the unique index stops when the case matches too (the 2A gate's M8: accepted). */
const NAME_IGNORING_CASE = { locale: "en", strength: 2 } as const;

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  return (await Station.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

interface StationRow {
  _id: Types.ObjectId;
```

In `apps/cafe/lib/print-stations.ts`, find:

```ts
  const stations = await listStations();
  if (stations.length >= STATIONS_MAX) return { ok: false, status: 400, error: STATIONS_FULL_MESSAGE };
  const order = Math.max(...stations.map((station) => station.order)) + 1;
  try {
    const created = await Station.create({ name: body.name, order, isDefault: false });
    return { ok: true, data: stationWireOf(created) };
```

Replace it with:

```ts
  const stations = await listStations();
  if (stations.length >= STATIONS_MAX) return { ok: false, status: 400, error: STATIONS_FULL_MESSAGE };
  const order = Math.max(...stations.map((station) => station.order)) + 1;
  if (await nameTaken(body.name)) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
  try {
    const created = await Station.create({ name: body.name, order, isDefault: false });
    return { ok: true, data: stationWireOf(created) };
```

In `apps/cafe/lib/print-stations.ts`, find:

```ts
export async function updateStation(id: string, body: UpdateStationBody): Promise<PrintSetupResult<StationConfig>> {
  const station = await Station.findById(id);
  if (station === null) return { ok: false, status: 404, error: STATION_NOT_FOUND };
  if (body.isDefault === true && !station.isDefault) {
    await Station.updateMany({ _id: { $ne: station._id }, isDefault: true }, { $set: { isDefault: false } });
    station.isDefault = true;
```

Replace it with:

```ts
export async function updateStation(id: string, body: UpdateStationBody): Promise<PrintSetupResult<StationConfig>> {
  const station = await Station.findById(id);
  if (station === null) return { ok: false, status: 404, error: STATION_NOT_FOUND };
  if (body.name !== undefined && (await nameTaken(body.name, id))) return { ok: false, status: 409, error: STATION_EXISTS_MESSAGE };
  if (body.isDefault === true && !station.isDefault) {
    await Station.updateMany({ _id: { $ne: station._id }, isDefault: true }, { $set: { isDefault: false } });
    station.isDefault = true;
```

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
  // ordering device's readback and the agent the job is aimed at. It names the job, its status and
  // its device; never order content. The readback's pulse fallback stays.
  "print-status",
] as const;
export type CafeEventKind = (typeof CAFE_EVENT_KINDS)[number];

```

Replace it with:

```ts
  // ordering device's readback and the agent the job is aimed at. It names the job, its status and
  // its device; never order content. The readback's pulse fallback stays.
  "print-status",
  // Phase 2 Session 2C: a printer was added, changed or removed, so every agent reads its printers again
  // (GET /api/printers). Carries nothing; the agent's focus read (every 5 min at most) is the fallback.
  "print-setup",
] as const;
export type CafeEventKind = (typeof CAFE_EVENT_KINDS)[number];

```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobLabel, PrintJobRefusal } from "./print-lifecycle";
import type { PrintJobPayload } from "./schemas/print-job.schema";

/** The header a device names itself with on print requests (spec §6.5 originDeviceId). */
```

Replace it with:

```ts
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobLabel, PrintJobRefusal } from "./print-lifecycle";
import { printerWriterDevices, printersModeOn, type PrinterConfig } from "./print-printers";
import type { PrintJobPayload } from "./schemas/print-job.schema";

/** The header a device names itself with on print requests (spec §6.5 originDeviceId). */
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  return Math.floor(PRINT_WAKE_PRINTERS_DAILY_CAP / Math.max(1, Math.floor(writers)));
}

/** The agent's wake cadence (spec §9.1). false: the daily share is spent, so stop polling until the
 *  next cafe-day; leasing then rides realtime nudges and the pulse, which already run. */
export function printAgentWakeIntervalMs(input: {
```

Replace it with:

```ts
  return Math.floor(PRINT_WAKE_PRINTERS_DAILY_CAP / Math.max(1, Math.floor(writers)));
}

/** Session 2C (the 2A gate's Important 1): the share of the wake allowance the wake answers each agent
 *  (agentDailyCap). Printers mode: PRINT_WAKE_PRINTERS_DAILY_CAP by the writers the setup names; simple mode:
 *  PRINT_WAKE_DAILY_CAP by the agents online, as in Phase 1. The agent spends against the smaller of this and
 *  its own constant, so the cafe's total never grows with its devices. */
export function printAgentDailyCap(printers: readonly PrinterConfig[], onlineAgents: number): number {
  return printersModeOn(printers) ? printWakeWriterCap(printerWriterDevices(printers).length) : printWakeAgentCap(onlineAgents);
}

/** The agent's wake cadence (spec §9.1). false: the daily share is spent, so stop polling until the
 *  next cafe-day; leasing then rides realtime nudges and the pulse, which already run. */
export function printAgentWakeIntervalMs(input: {
```

In `workers/realtime/src/index.ts`, find:

```ts

/** The event kinds slice 1 carries. A device subscribes to the whole room and
 *  ignores kinds it does not care about — adding a kind needs no room change. */
const EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed", "self-order", "print-job", "print-status"] as const;
type EventKind = (typeof EVENT_KINDS)[number];

function isEventKind(value: unknown): value is EventKind {
```

Replace it with:

```ts

/** The event kinds slice 1 carries. A device subscribes to the whole room and
 *  ignores kinds it does not care about — adding a kind needs no room change. */
const EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed", "self-order", "print-job", "print-status", "print-setup"] as const;
type EventKind = (typeof EVENT_KINDS)[number];

function isEventKind(value: unknown): value is EventKind {
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-printer-routing.test.ts lib/print-setup-paths.test.ts lib/realtime-paths.test.ts lib/print-lifecycle-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 100`; `# pass 100`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-printers.test.ts src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 39`; `# pass 39`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-stations.ts lib/print-printers.ts lib/print-printer-routing.ts lib/realtime-publish.ts app/api/print-jobs/wake/route.ts lib/print-setup-paths.test.ts lib/print-printer-routing.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/print-jobs/wake/route.ts apps/cafe/lib/print-printer-routing.test.ts apps/cafe/lib/print-printer-routing.ts apps/cafe/lib/print-printers.ts apps/cafe/lib/print-setup-paths.test.ts apps/cafe/lib/print-stations.ts apps/cafe/lib/realtime-publish.ts packages/shared/src/print-agent-wire.ts packages/shared/src/print-printers.test.ts workers/realtime/src/index.ts
git commit -m "feat(print): Phase 2 the writers' wake allowance from the setup, a device's bill printer only when routable, names unique ignoring case, and a print-setup realtime kind each printer write publishes"
```

---

### Task C6: the page in printers mode: each device reads the outlet's printers and every device is an agent, a writer leases and names its ready printers, a lease's several jobs print one by one, a printer list a job or the wake shows stale is read again, and the wake is polled by every writer against its share

**Files:**
- Create: `apps/cafe/lib/print-agent-printers.ts` (`PRINTER_NOT_LOCAL_MESSAGE`, `printerIsLocal`, `AgentPrinters`, `agentPrintersOf`, `printerListLooksStale`)
- Create: `apps/cafe/hooks/use-agent-printers.ts` (`PRINTERS_KEYS`, `usePrinters`, `useAgentPrinters`)
- Modify: `apps/cafe/lib/print-agent-seams.ts` (`setReadyPrintersSource`, `readyPrinterIds`), `apps/cafe/lib/print-agent-calls.ts` (the ready header; `printJobRefOf` prefers the leased ref)
- Modify: `apps/cafe/lib/print-agent.ts` (a lease's several jobs held and printed one by one; `retryAt` sets the timer even with a job)
- Modify: `apps/cafe/hooks/use-print-agent.ts` (the printers option; the lease names the ready printers; a stale list read again; the wake polled by `printAgentPollsWake` against the smaller cap), `apps/cafe/components/print/PrintHostDrain.tsx` (every device is an agent in printers mode)
- Modify: `packages/shared/src/print-agent-wire.ts` (`PrintWakeBeatData.writesPrinters?`), `apps/cafe/app/api/print-jobs/wake/route.ts` (answers it)
- Tests: `apps/cafe/lib/print-agent-printers.test.ts` (create), `print-agent.test.ts` (two new tests), `print-setup-paths.test.ts` (the wake's pin), `print-host-paths.test.ts` and `print-wake.test.ts` (pins changed deliberately), `apps/cafe/package.json` (testChain)

**Interfaces produced:** `printerIsLocal(printer, local, desktop)`; `agentPrintersOf(printers, deviceId, local, desktop)` → `{ printersMode, isWriter, localIds }`; `printerListLooksStale({ ready, isWriter, jobsForMe?, writesPrinters? })`; `usePrinters(enabled)`; `useAgentPrinters(deviceId, enabled)`; `setReadyPrintersSource(source)`; `readyPrinterIds()`; `printAgentHeaders(deviceId, bill?, leaseTab?, ready?)`; `usePrintAgent({ …, printers })`; the wake answers `writesPrinters`.

**Each device reads the outlet's printers** (spec §9.1): `GET /api/printers` on mount, again on a `print-setup` frame, and on focus at most every 30 min (Task C8 pins it). `isWriter`: this device writes a routable printer; `localIds`: the ones that ARE its one local printer (until Session 2E): a LAN printer whose `host:port` is the app's selected `tcp:host:port`, a device printer whose transport and address match the saved one, a Windows printer on the Windows app. The agent leases with `localIds` and names them in the ready header (direct print).

**Every device is an agent in printers mode** (ruling R13, widened by the 2C review's I-2): no host plays a part there, so, as with no host, every device whose surfaces exist drains its own line and names itself on the pulse (the pulse's query names only the device). A device made a printer's writer hears of that printer's jobs even before its list knows.

**A stale printer list is read again** (the 2C review's I-2, and the gate's emulator run): when the pulse or the wake names a printer job aimed at this device on a printer it does not print on, or the wake says the setup no longer names a writer it believes it is (`writesPrinters: false`: its printer removed or moved while the `print-setup` frame was missed), it reads `GET /api/printers` again, at most once a minute (`PRINT_SETUP_REFRESH_MIN_MS`, Task C8). Without the second rule a former writer polled the wake every 15 s all day in simple mode.

**Several jobs from one lease** (ruling R9): one per line; on its one local printer they print one by one, the rest held like a taken job (2B's held queue, with its hold bound and hand-back). A line that gave no job sets the timer even when another gave one.

**The wake** (the 2A gate's Important 1, the client half): polled by `printAgentPollsWake({ hostConfigured, isHost, printersMode, isWriter })` (simple mode: the host; printers mode: every writer), and spent against the smaller of `PRINT_WAKE_DAILY_CAP` and the wake's last `agentDailyCap`, so the cafe's total never grows with its devices.

**An order answer's refs**: a slip routed to several printers has a ref per printer; `printJobRefOf` prefers the one leased to this tab, which must reach its agent.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-agent-printers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { agentPrintersOf, printerIsLocal, printerListLooksStale } from "@/lib/print-agent-printers";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which of them it prints
// on its one local printer (until Session 2E). Pure; the agent hook reads it.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const SLIPS = { bill: true, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, connection: PrinterConfig["connection"], over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name: id, connection, order: 0, paper: 80, slips: SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

const NATIVE_TCP: DevicePrinter = { kind: "native", name: "LAN", paper: "80mm", printerId: "tcp:192.168.1.60:9100", transport: "tcp" };
const NATIVE_BT: DevicePrinter = { kind: "native", name: "BT", paper: "58mm", printerId: "00:11:22:33:44:55", transport: "bt-classic" };
const WEB_BLE: DevicePrinter = { kind: "ble", name: "BLE", paper: "58mm", deviceId: "ble-1", serviceUuid: "s", characteristicUuid: "c" };
const WEB_SERIAL: DevicePrinter = { kind: "serial", name: "USB", paper: "80mm" };

test("printerIsLocal: a printer is printed here only when it IS this device's printer", () => {
  const lan = printer("lan", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.equal(printerIsLocal(lan, NATIVE_TCP, false), true, "the app's selected network printer, same host and port");
  assert.equal(printerIsLocal({ ...lan, connection: { kind: "lan", host: "192.168.1.60", port: 9101 } }, NATIVE_TCP, false), false, "another port");
  assert.equal(printerIsLocal(lan, NATIVE_BT, false), false, "a Bluetooth printer is not that LAN printer");
  const bt = printer("bt", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.equal(printerIsLocal(bt, NATIVE_BT, false), true, "the paired printer by its address");
  assert.equal(printerIsLocal({ ...bt, connection: { ...bt.connection, address: "AA:BB" } as PrinterConfig["connection"] }, NATIVE_BT, false), false, "another paired printer");
  assert.equal(printerIsLocal(printer("ble", { kind: "device", deviceId: "dev-a", transport: "web-bluetooth", address: "ble-1" }), WEB_BLE, false), true);
  assert.equal(printerIsLocal(printer("ser", { kind: "device", deviceId: "dev-a", transport: "web-serial", address: "usb" }), WEB_SERIAL, false), true, "a tab drives one serial printer");
  const win = printer("win", { kind: "device", deviceId: "dev-a", transport: "windows", address: "EPSON TM-T82" });
  assert.equal(printerIsLocal(win, null, true), true, "the Windows app prints a Windows printer");
  assert.equal(printerIsLocal(win, null, false), false, "a browser does not");
  assert.equal(printerIsLocal(bt, null, false), false, "no printer saved here");
});

test("agentPrintersOf: printers mode, whether this device writes one, and the ones it prints here", () => {
  const counter = printer("counter", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, false), { printersMode: true, isWriter: true, localIds: ["counter"] }, "it writes the counter and the bar; only the counter is its printer");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, false), { printersMode: true, isWriter: false, localIds: [] }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, false), { printersMode: false, isWriter: false, localIds: [] }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, false), { printersMode: true, isWriter: false, localIds: [] }, "no device identity");
});

// The 2C gate's review (I-2) and its emulator run: a list goes stale both ways when a print-setup frame is missed.
// A device made a writer hears of its printer's jobs; a writer whose printer was removed or moved hears it from the
// wake, or it would poll the wake all day for nothing. A host in simple mode is never a writer: it never re-reads.
test("printerListLooksStale: a printer job it does not print on, or a writer the setup no longer names", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  const jobs = (printerIds?: string[]) => ({ count: 1, oldestCreatedAt: null, ...(printerIds === undefined ? {} : { printerIds }) });
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, jobsForMe: jobs([a]) }), false, "its own printer's job");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, jobsForMe: jobs([a, b]) }), true, "a printer it does not know of");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, jobsForMe: jobs([b]) }), true, "made a writer while the frame was missed");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, jobsForMe: jobs() }), false, "its own simple-mode line");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, writesPrinters: false }), true, "its printer removed or moved");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, writesPrinters: true }), false);
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true }), false, "an older server says nothing");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, writesPrinters: false }), false, "the host in simple mode");
});

test("PIN (2C): the page reads the printers on mount, on a print-setup frame and on focus at most every 5 min; every agent and the drain use it", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /queryFn: \(\) => apiGet<PrinterConfig\[\]>\("\/api\/printers"\),/);
  assert.match(hook, /staleTime: PRINTERS_STALE_MS,/);
  assert.match(hook, /refetchOnWindowFocus: true,/);
  assert.match(hook, /if \(kind === "print-setup"\) void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/);
  const drain = src("apps/cafe/components/print/PrintHostDrain.tsx");
  assert.match(drain, /const printers = useAgentPrinters\(deviceId, surfacesMounted && deviceId !== ""\);/);
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /lease: \(\) => apiSend<PrintLeaseData>\(LEASE_URL, "POST", \{ deviceId, tabId, \.\.\.printerIdsBody\(readyRef\.current\) \}\),/, "it leases its ready printers' lines too");
  assert.match(agent, /const offReady = setReadyPrintersSource\(\(\) => readyRef\.current\);/);
  // The 2C gate's review (I-2) and its emulator run: a list that looks stale is read again.
  assert.match(agent, /if \(!printerListLooksStale\(\{ ready: readyRef\.current, isWriter: writerRef\.current, jobsForMe: jobs, writesPrinters \}\)\) return;/);
  assert.match(agent, /void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/);
  assert.ok(agent.includes("noteJobsForMe(data?.printJobsForMe);") && agent.includes("noteJobsForMe(data.jobsForMe, data.writesPrinters);"), "from the pulse and the wake");
});

// The 2A gate's Important 1, the client half: the wake poll ran only on the host and spent against the constant
// 14,400 alone; in printers mode each writer polls, and every one spends against its share from the wake.
test("PIN (2C, the 2A gate's Important 1): the agent polls the wake by printAgentPollsWake and spends against its share", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /const pollsWake = printAgentPollsWake\(\{ hostConfigured: isHost, isHost, printersMode: printers\.printersMode, isWriter: printers\.isWriter \}\);/);
  assert.match(agent, /if \(agent === null \|\| !enabled \|\| !pollsWake\) return;/);
  assert.ok(!agent.includes("if (agent === null || !enabled || !isHost) return;"), "no longer the host alone");
  assert.match(agent, /capRef\.current = Math\.min\(PRINT_WAKE_DAILY_CAP, data\.agentDailyCap\);/, "the wake's answer lowers the cap");
  assert.match(agent, /bumpPrintWakeBudget\(mergePrintWakeBudget\(readPrintWakeBudget\(\), memory, dayKey\), dayKey, capRef\.current\)/, "the constant is no longer the only cap");
});
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  failedAckBody,
  onLeasedJob,
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
```

Replace it with:

```ts
  failedAckBody,
  onLeasedJob,
  printAgentSlipOf,
  pulsePrintDeviceQuery,
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  assert.deepEqual(got, ["d9"], "delivered to the agent that listens, never after it stopped listening");
});

```

Replace it with:

```ts
  assert.deepEqual(got, ["d9"], "delivered to the agent that listens, never after it stopped listening");
});

// Phase 2 Session 2C (the 2B gate's ruling R9): one lease may answer one job per line (the device's own line and
// each printer line it writes); on its one local printer they print one by one.
test("2C: a lease that answers several lines' jobs prints them one by one, and a line in backoff sets the timer", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("k1"), job("b1")], retryAt: null });
  w.ackAnswers.push(done(false), done(false));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["k1", "b1"], "both printed, in the order they came");
  assert.equal(w.leaseCalls, 1, "no lease between them, and none after: each ack said its line was empty");
  agent.stop();

  const timed = world();
  timed.w.leases.push({ jobs: [job("k2")], retryAt: new Date(T0 + 10_000).toISOString() });
  timed.w.ackAnswers.push(done(false));
  const second = createPrintAgent(timed.deps);
  second.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual([timed.w.prints, timed.w.leaseCalls], [["k2"], 1]);
  await advance(timed.w, 10_000);
  assert.equal(timed.w.leaseCalls, 2, "another line's backoff ends: it is leased then, with no poll");
  second.stop();
});

test("2C: the ready printers ride the direct-print header; the pulse names the device only; a slip routed to several printers is followed by its leased ref", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printAgentHeaders("dev-a", false, "tab-1", [a, b]), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-lease": "tab-1", "x-pos-print-ready": `${a},${b}` });
  assert.equal(printAgentHeaders("dev-a", false, null, [a])["x-pos-print-ready"], undefined, "no draining tab ready: no ready printers either");
  assert.equal(printAgentHeaders("dev-a", false, "tab-1", [])["x-pos-print-ready"], undefined, "simple mode: none");
  setPulsePrintDevice("dev-a");
  const off = setReadyPrintersSource(() => [a]);
  assert.equal(printAgentHeaders("dev-a", false, "tab-1")["x-pos-print-ready"], a, "the default reads the ready seam");
  assert.equal(pulsePrintDeviceQuery(), "?device=dev-a", "the pulse counts every job aimed at the device (the 2C gate's review, I-2): it names only the device");
  off();
  setPulsePrintDevice(null);
  assert.equal(pulsePrintDeviceQuery(), "");
  const leased = { id: "k3", epoch: 1 } as never;
  const order = {
    printJobs: [
      { id: "k1", kind: "kot", targetDeviceId: "dev-k", label: "KOT · Kitchen", status: "queued", printerId: "p-kitchen" },
      { id: "k3", kind: "kot", targetDeviceId: "dev-a", label: "KOT · All stations", status: "leased", printerId: "p-counter", leased },
    ],
  };
  assert.equal(printJobRefOf(order, "kot")?.id, "k3", "the one leased to this tab must reach its agent");
});

```

In `apps/cafe/lib/print-host-paths.test.ts`, find:

```ts
    assert.ok(src.includes(call), `PrintHostDrain.tsx must call ${call}`);
  }
  assert.ok(!src.includes("usePrintHostDrain(") && !src.includes("usePrintHostWake("), "the claim drain and the GET wake poll are no longer run here (Session 1C)");
  assert.match(
    src,
    /const isAgent = enabled \|\| \(surfacesMounted && deviceId !== "" && routing !== "host" && routing !== "unknown"\);/,
    "the agent: the host, or with no host every device whose surfaces exist; an unknown lane waits",
  );
  assert.match(src, /const drains = isAgent && holdsLock;/, "the agent drains only under the lock");
  assert.match(src, /const hostDrains = enabled && holdsLock;/, "the host's self-order lane keeps the host gate");
  assert.match(src, /usePrintAgent\(\{ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip \}\);/, "the agent prints through the provider's bridge");
  assert.match(src, /useSelfOrderAutoPrint\(\{ enabled: hostDrains, busy, queueKotRound, hostLane \}\);/, "the host lane hands a claimed KOT to the agent (job-aware lane)");
  assert.ok(src.includes("PRINT_HOST_MAX_AGE_MS"), "hostLane must reference PRINT_HOST_MAX_AGE_MS");
  assert.match(src, /return null;/, "PrintHostDrain must return null — a null-rendering child");
```

Replace it with:

```ts
    assert.ok(src.includes(call), `PrintHostDrain.tsx must call ${call}`);
  }
  assert.ok(!src.includes("usePrintHostDrain(") && !src.includes("usePrintHostWake("), "the claim drain and the GET wake poll are no longer run here (Session 1C)");
  // Session 2C deliberately added printers mode: no host plays a part there, so every device is an agent (a writer drains its printers).
  assert.match(
    src,
    /const isAgent = enabled \|\| \(surfacesMounted && deviceId !== "" && \(printers\.printersMode \|\| \(routing !== "host" && routing !== "unknown"\)\)\);/,
    "the agent: the host, every device in printers mode, or with no host every device whose surfaces exist; an unknown lane waits",
  );
  assert.match(src, /const drains = isAgent && holdsLock;/, "the agent drains only under the lock");
  assert.match(src, /const hostDrains = enabled && holdsLock;/, "the host's self-order lane keeps the host gate");
  assert.match(src, /usePrintAgent\(\{ enabled: drains, isHost: enabled, printers, deviceId, tabId, busy, queueSlip: onSlip \}\);/, "the agent prints through the provider's bridge");
  assert.match(src, /useSelfOrderAutoPrint\(\{ enabled: hostDrains, busy, queueKotRound, hostLane \}\);/, "the host lane hands a claimed KOT to the agent (job-aware lane)");
  assert.ok(src.includes("PRINT_HOST_MAX_AGE_MS"), "hostLane must reference PRINT_HOST_MAX_AGE_MS");
  assert.match(src, /return null;/, "PrintHostDrain must return null — a null-rendering child");
```

In `apps/cafe/lib/print-setup-paths.test.ts`, find:

```ts
  const s = src("app/api/print-jobs/wake/route.ts");
  assert.match(s, /listPrinters\(\)/, "one read of the printers");
  assert.match(s, /agentDailyCap: printAgentDailyCap\(printers, agents\),/);
});

```

Replace it with:

```ts
  const s = src("app/api/print-jobs/wake/route.ts");
  assert.match(s, /listPrinters\(\)/, "one read of the printers");
  assert.match(s, /agentDailyCap: printAgentDailyCap\(printers, agents\),/);
  // The 2C gate's emulator run: a writer whose printer list missed the frame hears from the same read that the
  // setup no longer names it, so it reads its list again and stops polling.
  assert.match(s, /writesPrinters: printerWriterDevices\(printers\)\.includes\(parsed\.data\.deviceId\),/);
});

```

In `apps/cafe/lib/print-wake.test.ts`, find:

```ts
  assert.deepEqual(hits, expected, `usePrintHostWake( must have no call site any more; found: ${hits.join(", ")}`);
});

test("PIN (Session 1C): only the host agent polls the wake, through the POST beside the unchanged GET, and PrintHostDrain arms it only for the host", () => {
  const drain = readSrc(PRINT_HOST_DRAIN);
  assert.ok(drain.includes("usePrintAgent({ enabled: drains, isHost: enabled,"), "the agent learns whether it is the host");
  const agent = stripComments(readSrc("apps/cafe/hooks/use-print-agent.ts"));
  assert.ok(agent.includes("if (agent === null || !enabled || !isHost) return;"), "the wake poll is armed for the host only (R6)");
  assert.ok(agent.includes('apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId))'), "the agent's wake is the POST heartbeat");
  assert.ok(agent.includes("bumpPrintWakeBudget("), "under the device's one daily cap");
  assert.ok(!agent.includes("apiGet"), "the agent never polls the read-only GET");
```

Replace it with:

```ts
  assert.deepEqual(hits, expected, `usePrintHostWake( must have no call site any more; found: ${hits.join(", ")}`);
});

// Session 2C deliberately changed who polls (the 2A gate's Important 1): in simple mode the host only (R6), in
// printers mode each printer's writer, host or not (printAgentPollsWake; pinned in print-agent-printers.test.ts).
test("PIN (Session 1C, 2C): the agent polls the wake by printAgentPollsWake, through the POST beside the unchanged GET", () => {
  const drain = readSrc(PRINT_HOST_DRAIN);
  assert.ok(drain.includes("usePrintAgent({ enabled: drains, isHost: enabled,"), "the agent learns whether it is the host");
  const agent = stripComments(readSrc("apps/cafe/hooks/use-print-agent.ts"));
  assert.ok(agent.includes("if (agent === null || !enabled || !pollsWake) return;"), "the wake poll is armed by printAgentPollsWake (simple mode: the host only, R6)");
  assert.ok(agent.includes('apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId))'), "the agent's wake is the POST heartbeat");
  assert.ok(agent.includes("bumpPrintWakeBudget("), "under the device's one daily cap");
  assert.ok(!agent.includes("apiGet"), "the agent never polls the read-only GET");
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts",
    "lib/print-direct.test.ts",
    "lib/print-printer-jobs.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

Replace it with:

```json
    "lib/print-printer-routing.test.ts",
    "lib/print-setup-paths.test.ts",
    "lib/print-direct.test.ts",
    "lib/print-printer-jobs.test.ts",
    "lib/print-agent-printers.test.ts"
  ],
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts lib/print-agent.test.ts lib/print-setup-paths.test.ts lib/print-host-paths.test.ts lib/print-agent-paths.test.ts lib/print-wake.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 109`; `# pass 103`; `# fail 6`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printAgentDailyCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

Replace it with:

```ts
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printAgentDailyCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { printerWriterDevices } from "@pos/shared/print-printers";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
      // Session 2C (the 2A gate's Important 1): printers mode shares the writers' allowance by the setup.
      agentDailyCap: printAgentDailyCap(printers, agents),
      serverNow: new Date(nowMs).toISOString(),
    };
    return noStore(success(data));
  } catch (error) {
```

Replace it with:

```ts
      // Session 2C (the 2A gate's Important 1): printers mode shares the writers' allowance by the setup.
      agentDailyCap: printAgentDailyCap(printers, agents),
      serverNow: new Date(nowMs).toISOString(),
      // The 2C gate's emulator run: a writer whose printer list missed a print-setup frame learns it here.
      writesPrinters: printerWriterDevices(printers).includes(parsed.data.deviceId),
    };
    return noStore(success(data));
  } catch (error) {
```

In `apps/cafe/components/print/PrintHostDrain.tsx`, find:

```tsx

import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { useCanPrintNow } from "@/hooks/use-device-printer";
import { useHostRouting } from "@/hooks/use-host-routing";
import { useNativeHostBackground } from "@/hooks/use-native-host";
```

Replace it with:

```tsx

import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { useAgentPrinters } from "@/hooks/use-agent-printers";
import { useCanPrintNow } from "@/hooks/use-device-printer";
import { useHostRouting } from "@/hooks/use-host-routing";
import { useNativeHostBackground } from "@/hooks/use-native-host";
```

In `apps/cafe/components/print/PrintHostDrain.tsx`, find:

```tsx
export function PrintHostDrain({ enabled, surfacesMounted, deviceId, tabId, busy, claimLockRef, onSlip, onDemoted }: PrintHostDrainProps) {
  // Written as host/unknown checks (D-11): an unknown lane waits for the pulse rather than guess.
  const routing = usePrintHostRouting();
  const isAgent = enabled || (surfacesMounted && deviceId !== "" && routing !== "host" && routing !== "unknown");
  // Exactly one draining window per device (MERGED-23), asked for only by a window that can print right
  // now: a printer that is off, or open in another tab, hands the lock on, so a line is never leased
  // for a printer that cannot print (the owner's rule after Session 1B).
```

Replace it with:

```tsx
export function PrintHostDrain({ enabled, surfacesMounted, deviceId, tabId, busy, claimLockRef, onSlip, onDemoted }: PrintHostDrainProps) {
  // Written as host/unknown checks (D-11): an unknown lane waits for the pulse rather than guess.
  const routing = usePrintHostRouting();
  // Session 2C (printers mode): no host plays a part, so every device whose surfaces exist is an agent, as with no
  // host (spec §9.3): a printer's writer drains it, and every device names itself on the pulse, so one that became a
  // writer hears of its slips even before its printer list knows (the 2C gate's review, I-2).
  const printers = useAgentPrinters(deviceId, surfacesMounted && deviceId !== "");
  const isAgent = enabled || (surfacesMounted && deviceId !== "" && (printers.printersMode || (routing !== "host" && routing !== "unknown")));
  // Exactly one draining window per device (MERGED-23), asked for only by a window that can print right
  // now: a printer that is off, or open in another tab, hands the lock on, so a line is never leased
  // for a printer that cannot print (the owner's rule after Session 1B).
```

In `apps/cafe/components/print/PrintHostDrain.tsx`, find:

```tsx
  const hostLane = useMemo(() => ({ claimLock: claimLockRef, maxAgeMs: PRINT_HOST_MAX_AGE_MS }), [claimLockRef]);
  useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });

  usePrintAgent({ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip });
  // Session 1D: the 20 s alarm on every device with an identity (the asking one and the printing one).
  usePrintSlipAlarm(deviceId);

```

Replace it with:

```tsx
  const hostLane = useMemo(() => ({ claimLock: claimLockRef, maxAgeMs: PRINT_HOST_MAX_AGE_MS }), [claimLockRef]);
  useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });

  usePrintAgent({ enabled: drains, isHost: enabled, printers, deviceId, tabId, busy, queueSlip: onSlip });
  // Session 1D: the 20 s alarm on every device with an identity (the asking one and the printing one).
  usePrintSlipAlarm(deviceId);

```

Create `apps/cafe/hooks/use-agent-printers.ts`:

```ts
"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { agentPrintersOf, type AgentPrinters } from "@/lib/print-agent-printers";
import { subscribeRealtime } from "@/lib/realtime-client";

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 5 min (the fallback when a frame was missed). Never a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = 5 * 60 * 1000;
const NO_PRINTERS: PrinterConfig[] = [];

export function usePrinters(enabled: boolean): PrinterConfig[] {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: PRINTERS_KEYS.all,
    queryFn: () => apiGet<PrinterConfig[]>("/api/printers"),
    enabled,
    staleTime: PRINTERS_STALE_MS,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeRealtime((kind) => {
      if (kind === "print-setup") void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    });
  }, [enabled, qc]);
  return query.data ?? NO_PRINTERS;
}

/** The printers this device writes, and which it prints on its one local printer (lib/print-agent-printers.ts). */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const local = useDevicePrinter().printer;
  return useMemo(() => agentPrintersOf(printers, deviceId, local, isDesktopShell()), [printers, deviceId, local]);
}
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData, PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useCanPrintNow, useDevicePrinter } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
```

Replace it with:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import {
  printAgentPollsWake,
  type LeasedPrintJob,
  type PrintAckData,
  type PrintJobsForMe,
  type PrintLeaseData,
  type PrintWakeBeatData,
} from "@pos/shared/print-agent-wire";
import { PRINTERS_KEYS } from "@/hooks/use-agent-printers";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useCanPrintNow, useDevicePrinter } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  writePendingAcks,
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
```

Replace it with:

```ts
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { printerListLooksStale, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  enabled: boolean;
  /** This device is the print host: it polls the wake and also leases on the broadcast nudge. */
  isHost: boolean;
  deviceId: string;
  tabId: string;
  /** The host bridge is printing something (a test slip, another slip). */
  busy: boolean;
  queueSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
}

/** The heartbeat the host's wake carries (spec §10). */
function wakeBody(deviceId: string) {
```

Replace it with:

```ts
  enabled: boolean;
  /** This device is the print host: it polls the wake and also leases on the broadcast nudge. */
  isHost: boolean;
  /** Session 2C: printers mode, whether this device writes a printer, and the ones it prints here. */
  printers: AgentPrinters;
  deviceId: string;
  tabId: string;
  /** The host bridge is printing something (a test slip, another slip). */
  busy: boolean;
  queueSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
}

/** Session 2C: the printers a lease names, omitted when there are none (simple mode, an old server). */
function printerIdsBody(ids: readonly string[]): { printerIds?: string[] } {
  return ids.length > 0 ? { printerIds: [...ids] } : {};
}

/** Session 2C (the 2C gate's review, I-2): a stale printer list is read again at most this often. */
const PRINTERS_STALE_REFRESH_MS = 60_000;

/** The heartbeat the host's wake carries (spec §10). */
function wakeBody(deviceId: string) {
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  };
}

export function usePrintAgent({ enabled, isHost, deviceId, tabId, busy, queueSlip }: UsePrintAgentOptions): void {
  const qc = useQueryClient();
  const printer = useDevicePrinter();
  const canPrint = useCanPrintNow();
```

Replace it with:

```ts
  };
}

export function usePrintAgent({ enabled, isHost, printers, deviceId, tabId, busy, queueSlip }: UsePrintAgentOptions): void {
  const qc = useQueryClient();
  const printer = useDevicePrinter();
  const canPrint = useCanPrintNow();
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  useEffect(() => {
    queueRef.current = queueSlip;
  }, [queueSlip]);
  const [agent, setAgent] = useState<PrintAgent | null>(null);

  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
```

Replace it with:

```ts
  useEffect(() => {
    queueRef.current = queueSlip;
  }, [queueSlip]);
  // Session 2C: the printers this tab prints on, read at call time by the lease, the wake and the headers.
  const readyRef = useRef<readonly string[]>(printers.localIds);
  const readyKey = printers.localIds.join(",");
  useEffect(() => {
    readyRef.current = readyKey === "" ? [] : readyKey.split(",");
  }, [readyKey]);
  const writerRef = useRef(printers.isWriter);
  useEffect(() => {
    writerRef.current = printers.isWriter;
  }, [printers.isWriter]);
  // Session 2C (the 2C gate's review, I-2): a printer job aimed at this device that it does not print on means its
  // printer list is stale (a missed print-setup frame, a printer just re-saved onto it): read it again, at most once
  // a minute, and the agent leases it as soon as it knows. A device that writes a printer which is not its local
  // printer reads it once a minute while that printer's slips wait (they go stale after 30 min). The other way (the
  // gate's emulator run): a writer the wake says the setup no longer names reads it once and stops polling.
  const setupReadAtRef = useRef(0);
  const noteJobsForMe = useCallback(
    (jobs: PrintJobsForMe | undefined, writesPrinters?: boolean): void => {
      if (!printerListLooksStale({ ready: readyRef.current, isWriter: writerRef.current, jobsForMe: jobs, writesPrinters })) return;
      if (Date.now() - setupReadAtRef.current < PRINTERS_STALE_REFRESH_MS) return;
      setupReadAtRef.current = Date.now();
      void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    },
    [qc],
  );
  const [agent, setAgent] = useState<PrintAgent | null>(null);

  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
      });
    const created = createPrintAgent({
      deviceId,
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId }),
      ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", body),
      print,
      printerReady: canPrintNow,
```

Replace it with:

```ts
      });
    const created = createPrintAgent({
      deviceId,
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, ...printerIdsBody(readyRef.current) }),
      ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", body),
      print,
      printerReady: canPrintNow,
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
    agent?.nudge();
  }, [agent, printer, canPrint]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
```

Replace it with:

```ts
    agent?.nudge();
  }, [agent, printer, canPrint]);

  // Session 2C: the printers it prints on changed (a setup save, its printer reconnected as another): look again.
  useEffect(() => {
    agent?.nudge();
  }, [agent, readyKey]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  useEffect(() => {
    if (agent === null) return;
    const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));
    const offLeased = onLeasedJob((job) => agent.take(job));
    return () => {
      offSource();
      offLeased();
    };
  }, [agent, tabId]);
```

Replace it with:

```ts
  useEffect(() => {
    if (agent === null) return;
    const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));
    const offReady = setReadyPrintersSource(() => readyRef.current);
    const offLeased = onLeasedJob((job) => agent.take(job));
    return () => {
      offSource();
      offReady();
      offLeased();
    };
  }, [agent, tabId]);
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
    const off = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      const data = event.query.state.data as PosPulseData | undefined;
      if ((data?.printJobsForMe?.count ?? 0) > 0) agent.kick();
    });
    return () => {
      off();
      setPulsePrintDevice(null);
    };
  }, [agent, enabled, deviceId, qc]);

  // The host: the wake poll (spec §9.1), under the device's one daily cap.
  useEffect(() => {
    if (agent === null || !enabled || !isHost) return;
    let memory: PrintWakeBudget | null = null;
    const wake = createPrintAgentWake({
      wake: () => apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId)),
      socketHealthy: isRealtimeHealthy,
      mayPoll: () => isDesktopShell() || document.visibilityState === "visible",
      spendOne: () => {
        const dayKey = cafeDateString();
        const { record, allowed } = bumpPrintWakeBudget(mergePrintWakeBudget(readPrintWakeBudget(), memory, dayKey), dayKey, PRINT_WAKE_DAILY_CAP);
        memory = record;
        writePrintWakeBudget(record);
        return allowed;
```

Replace it with:

```ts
    const off = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      const data = event.query.state.data as PosPulseData | undefined;
      if ((data?.printJobsForMe?.count ?? 0) > 0) {
        noteJobsForMe(data?.printJobsForMe);
        agent.kick();
      }
    });
    return () => {
      off();
      setPulsePrintDevice(null);
    };
  }, [agent, enabled, deviceId, qc, noteJobsForMe]);

  // The wake poll (spec §9.1): the host in simple mode; in printers mode each writer, host or not (Session 2C, the
  // 2A gate's Important 1). Each spends against its share: the smaller of the constant and the wake's answer.
  const pollsWake = printAgentPollsWake({ hostConfigured: isHost, isHost, printersMode: printers.printersMode, isWriter: printers.isWriter });
  const capRef = useRef(PRINT_WAKE_DAILY_CAP);
  useEffect(() => {
    if (agent === null || !enabled || !pollsWake) return;
    let memory: PrintWakeBudget | null = null;
    const wake = createPrintAgentWake({
      wake: async () => {
        const data = await apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId));
        capRef.current = Math.min(PRINT_WAKE_DAILY_CAP, data.agentDailyCap);
        noteJobsForMe(data.jobsForMe, data.writesPrinters);
        return data;
      },
      socketHealthy: isRealtimeHealthy,
      mayPoll: () => isDesktopShell() || document.visibilityState === "visible",
      spendOne: () => {
        const dayKey = cafeDateString();
        const { record, allowed } = bumpPrintWakeBudget(mergePrintWakeBudget(readPrintWakeBudget(), memory, dayKey), dayKey, capRef.current);
        memory = record;
        writePrintWakeBudget(record);
        return allowed;
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, isHost, deviceId]);

  // The POS app came back to the screen, or its network returned.
  useEffect(() => {
```

Replace it with:

```ts
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, pollsWake, deviceId, noteJobsForMe]);

  // The POS app came back to the screen, or its network returned.
  useEffect(() => {
```

In `apps/cafe/lib/print-agent-calls.ts`, find:

```ts
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  PRINT_LEASE_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
import { directPrintTab } from "@/lib/print-agent-seams";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 1 Session 1C (spec §7.4, §9.1; rulings R1 and M-d): the call sites' half of
```

Replace it with:

```ts
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  PRINT_LEASE_HEADER,
  PRINT_READY_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
import { directPrintTab, readyPrinterIds } from "@/lib/print-agent-seams";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 1 Session 1C (spec §7.4, §9.1; rulings R1 and M-d): the call sites' half of
```

In `apps/cafe/lib/print-agent-calls.ts`, find:

```ts

/** R1's opt-in. {} for a device with no identity: the server then prints nothing for this request,
 *  and the call site prints exactly as before Phase 1. Session 2B (spec §7.11): `leaseTab`, this tab while
 *  it drains this device's slips and can print now, lets a slip this device prints be made leased to it. */
export function printAgentHeaders(deviceId: string, bill = false, leaseTab: string | null = directPrintTab()): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
    ...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),
  };
}

```

Replace it with:

```ts

/** R1's opt-in. {} for a device with no identity: the server then prints nothing for this request,
 *  and the call site prints exactly as before Phase 1. Session 2B (spec §7.11): `leaseTab`, this tab while
 *  it drains this device's slips and can print now, lets a slip this device prints be made leased to it.
 *  Session 2C (printers mode): `ready`, the printers that tab prints on, so a slip routed to one of them can be. */
export function printAgentHeaders(
  deviceId: string,
  bill = false,
  leaseTab: string | null = directPrintTab(),
  ready: readonly string[] = readyPrinterIds(),
): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
    ...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),
    ...(leaseTab !== null && ready.length > 0 ? { [PRINT_READY_HEADER]: ready.join(",") } : {}),
  };
}

```

In `apps/cafe/lib/print-agent-calls.ts`, find:

```ts
  return typeof ref === "object" && ref !== null && typeof ref.id === "string" && typeof ref.kind === "string" && typeof ref.status === "string";
}

/** The job an order answer made for one kind of slip, or null: then the call site enqueues it. */
export function printJobRefOf(order: unknown, kind: PrintJobKind): PrintJobRef | null {
  const refs = (order as { printJobs?: unknown } | null | undefined)?.printJobs;
  if (!Array.isArray(refs)) return null;
  return refs.find((ref): ref is PrintJobRef => isPrintJobRef(ref) && ref.kind === kind) ?? null;
}

```

Replace it with:

```ts
  return typeof ref === "object" && ref !== null && typeof ref.id === "string" && typeof ref.kind === "string" && typeof ref.status === "string";
}

/** The job an order answer made for one kind of slip, or null: then the call site enqueues it. Session 2C: a slip
 *  routed to several printers has a ref per printer; the one leased to this tab (at most one) must reach its agent,
 *  and each other one is printed by its own printer's writer. */
export function printJobRefOf(order: unknown, kind: PrintJobKind): PrintJobRef | null {
  const refs = (order as { printJobs?: unknown } | null | undefined)?.printJobs;
  if (!Array.isArray(refs)) return null;
  const ofKind = refs.filter((ref): ref is PrintJobRef => isPrintJobRef(ref) && ref.kind === kind);
  return ofKind.find((ref) => ref.leased !== undefined) ?? ofKind[0] ?? null;
}

```

Create `apps/cafe/lib/print-agent-printers.ts`:

```ts
import type { PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which
// of them it prints on its one local printer (several printers per device arrive in Session 2E). Pure and
// client-safe; hooks/use-agent-printers.ts reads it on every printers read and every change of this device's
// printer.

/** The refusal a leased job gets when its printer is not this device's printer (sent:"no", never counted). */
export const PRINTER_NOT_LOCAL_MESSAGE = "This printer is not connected to this device.";

/** A printer this device writes is printed here only when it IS this device's one printer: a LAN printer whose
 *  host:port is the app's selected network printer, a device printer whose transport and address match the
 *  saved one, a Windows printer on the Windows app. Anything else would put a bar's slips on the kitchen's paper. */
export function printerIsLocal(printer: PrinterConfig, local: DevicePrinter | null, desktop: boolean): boolean {
  const connection = printer.connection;
  if (connection.kind === "lan") {
    return local?.kind === "native" && local.transport === "tcp" && local.printerId === `tcp:${connection.host}:${connection.port}`;
  }
  switch (connection.transport) {
    case "windows":
      return desktop;
    case "bt-classic":
    case "ble":
    case "usb":
      return local?.kind === "native" && local.transport === connection.transport && local.printerId === connection.address;
    case "web-bluetooth":
      return local?.kind === "ble" && local.deviceId === connection.address;
    case "web-serial":
      // A Chrome tab drives at most one serial printer (spec §9.7), which has no stable address.
      return local?.kind === "serial";
  }
}

export interface AgentPrinters {
  /** An enabled printer takes a slip (spec §6.6): every slip is routed to printers. */
  printersMode: boolean;
  /** This device writes a routable printer: it drains and polls the wake in printers mode, host or not. */
  isWriter: boolean;
  /** The routable printers this device writes that ARE its local printer: the lines it leases and prints. */
  localIds: string[];
}

export function agentPrintersOf(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, desktop: boolean): AgentPrinters {
  const mine = deviceId === "" ? [] : routablePrinters(printers).filter((printer) => printerWriterDeviceId(printer) === deviceId);
  return {
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: mine.filter((printer) => printerIsLocal(printer, local, desktop)).map((printer) => printer.id),
  };
}

/** Session 2C (the 2C gate's review, I-2, and its emulator run): the device's printer list is stale when a missed
 *  print-setup frame left it behind the setup. Either a printer job aimed at it is on a printer it does not print
 *  on (it was just made that printer's writer), or the wake says the setup no longer names a writer it believes
 *  it is (its printer removed or moved). A host in simple mode is not a writer, so the wake's false means nothing. */
export function printerListLooksStale(input: {
  ready: readonly string[];
  isWriter: boolean;
  jobsForMe?: PrintJobsForMe;
  writesPrinters?: boolean;
}): boolean {
  if (input.jobsForMe?.printerIds?.some((id) => !input.ready.includes(id)) === true) return true;
  return input.isWriter && input.writesPrinters === false;
}
```

In `apps/cafe/lib/print-agent-seams.ts`, find:

```ts

export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}`;
}

let directSource: (() => string | null) | null = null;
```

Replace it with:

```ts

export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}`;
}

let readySource: (() => readonly string[]) | null = null;

/** Session 2C: the agent of the tab that drains this device's slips registers the printers it prints on (the
 *  routable ones this device writes that are its local printer). Unregistered as setDirectPrintSource is. */
export function setReadyPrintersSource(source: () => readonly string[]): () => void {
  readySource = source;
  return () => {
    if (readySource === source) readySource = null;
  };
}

/** The printers this tab prints on (printers mode); [] in simple mode or with no agent. */
export function readyPrinterIds(): string[] {
  try {
    return [...(readySource?.() ?? [])];
  } catch {
    return [];
  }
}

let directSource: (() => string | null) | null = null;
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
        // Only a held job prints past the lease gate; with none left (I-1), the gate decides as always.
        if (forHeld && !printAgentMayLease({ enabled, busy, running: false, printerReady: deps.printerReady(), refusalHolds: refusalHolds() })) return;
        const data = await deps.lease();
        job = data.jobs[0];
        if (job === undefined) {
          if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
          return;
        }
      }
      // One (id, epoch) prints once however it reached this tab (the final review, C-1): the enqueue hands a
      // running lease back to its tab, even one this cycle leased itself, while it prints or before.
```

Replace it with:

```ts
        // Only a held job prints past the lease gate; with none left (I-1), the gate decides as always.
        if (forHeld && !printAgentMayLease({ enabled, busy, running: false, printerReady: deps.printerReady(), refusalHolds: refusalHolds() })) return;
        const data = await deps.lease();
        // Session 2C: one job per line (its own and each printer line it writes); on its one local printer they
        // print one by one, the rest held like a taken job. A line that gave none sets the timer even so.
        for (const extra of data.jobs.slice(1)) {
          remember(taken, `${extra.id}:${extra.epoch}`);
          held.push({ job: extra, at: deps.now() });
        }
        if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
        job = data.jobs[0];
        if (job === undefined) return;
      }
      // One (id, epoch) prints once however it reached this tab (the final review, C-1): the enqueue hands a
      // running lease back to its tab, even one this cycle leased itself, while it prints or before.
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  agents: number;
  agentDailyCap: number;
  serverNow: string;
}

```

Replace it with:

```ts
  agents: number;
  agentDailyCap: number;
  serverNow: string;
  /** Session 2C (the 2C gate's emulator run): whether the setup names this device a routable printer's writer. A
   *  writer told false has a stale printer list (its printer removed or moved while the print-setup frame was
   *  missed): it reads the list again and stops polling. Absent from an older server. */
  writesPrinters?: boolean;
}

```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts lib/print-agent.test.ts lib/print-setup-paths.test.ts lib/print-host-paths.test.ts lib/print-agent-paths.test.ts lib/print-wake.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 113`; `# pass 113`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-agent-printers.ts hooks/use-agent-printers.ts lib/print-agent-seams.ts lib/print-agent-calls.ts lib/print-agent.ts hooks/use-print-agent.ts components/print/PrintHostDrain.tsx app/api/print-jobs/wake/route.ts lib/print-agent-printers.test.ts lib/print-agent.test.ts lib/print-wake.test.ts lib/print-setup-paths.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/print-jobs/wake/route.ts apps/cafe/components/print/PrintHostDrain.tsx apps/cafe/hooks/use-agent-printers.ts apps/cafe/hooks/use-print-agent.ts apps/cafe/lib/print-agent-calls.ts apps/cafe/lib/print-agent-printers.test.ts apps/cafe/lib/print-agent-printers.ts apps/cafe/lib/print-agent-seams.ts apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts apps/cafe/lib/print-host-paths.test.ts apps/cafe/lib/print-setup-paths.test.ts apps/cafe/lib/print-wake.test.ts apps/cafe/package.json packages/shared/src/print-agent-wire.ts
git commit -m "feat(print): Phase 2 the page in printers mode: each device reads the outlet's printers and every device is an agent, a writer leases and names its ready printers, a lease's several jobs print one by one, a printer list a job or the wake shows stale is read again, and the wake is polled by every writer against its share"
```

---

### Task C7: printing a printer's slip on this device: only on its own printer, every copy in one lease; the KOT's station line on paper; the waiting slips name their printer

**Files:**
- Modify: `apps/cafe/lib/print-agent-printers.ts` (`printJobCopies`), `apps/cafe/hooks/use-print-agent.ts` (prints through it)
- Modify: `apps/cafe/lib/print-host-slips.ts` (`HostKotSlip.stationLine`), `apps/cafe/components/pos/KOTReceipt.tsx` (`stationLine` under the title), `apps/cafe/components/pos/PrintSources.tsx`, `apps/cafe/components/print/PrintHostPrintSources.tsx`
- Modify: `apps/cafe/lib/print-attention.ts` (rows carry `printerId`), `apps/cafe/lib/print-waiting.ts` (`printerNameOf`), `apps/cafe/components/print/WaitingSlipsCard.tsx` (names the printer)
- Tests: `apps/cafe/lib/print-agent-printers.test.ts`, `print-host-slips.test.ts`, `print-attention.test.ts`, `print-waiting.test.ts`

**Interfaces produced:** `printJobCopies(job, localIds, printOnce)`; `HostKotSlip.stationLine?`; `KOTReceipt` `stationLine?`; `PrintSources` `kotStationLine?`; `printerNameOf(printers, printerId)`.

**Only on this device's printer, every copy in one lease** (spec §6.3, decision 2; ruling R10): a printer job whose printer is not this device's is refused `sent:"no"` (never counted) with "This printer is not connected to this device."; otherwise the slip is queued `copies` times through the bridge, one after another (re-rendered per copy). A failure after the first copy may already have put paper out, so it is "maybe" (the REPRINT repeats every copy, labelled).

**The station line on paper** (spec §8, decision 5): a routed KOT prints its station under the title ("BAR", "ALL STATIONS", "BAR (NO PRINTER SET)"); today's KOT and every local print carry none. A station slip's item count and round total count its own lines (its snapshot holds only them).

**The waiting slips name their printer** (from this device's printer list; none in simple mode).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
import path from "node:path";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { agentPrintersOf, printerIsLocal, printerListLooksStale } from "@/lib/print-agent-printers";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which of them it prints
```

Replace it with:

```ts
import path from "node:path";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINTER_NOT_LOCAL_MESSAGE, agentPrintersOf, printJobCopies, printerIsLocal, printerListLooksStale } from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which of them it prints
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  assert.match(agent, /bumpPrintWakeBudget\(mergePrintWakeBudget\(readPrintWakeBudget\(\), memory, dayKey\), dayKey, capRef\.current\)/, "the constant is no longer the only cap");
});

```

Replace it with:

```ts
  assert.match(agent, /bumpPrintWakeBudget\(mergePrintWakeBudget\(readPrintWakeBudget\(\), memory, dayKey\), dayKey, capRef\.current\)/, "the constant is no longer the only cap");
});

function printsWith(results: PrintAgentResult[]) {
  const calls: number[] = [];
  const once = async (): Promise<PrintAgentResult> => {
    calls.push(calls.length + 1);
    return results.shift() ?? { ok: true };
  };
  return { calls, once };
}

// Session 2C (spec §6.3 copies, plan decision 2): all copies of a slip are one job, written in its one lease.
test("printJobCopies: only this device's printer; every copy in one lease; a failure after the first copy may be on paper", async () => {
  const away = printsWith([]);
  const refused = await printJobCopies({ printerId: "p-bar" }, ["p-counter"], away.once);
  assert.deepEqual([away.calls.length, refused.ok ? null : printWriteOutcomeOf(refused.error)], [0, { sent: "no", permanent: false, message: PRINTER_NOT_LOCAL_MESSAGE }], "not this device's printer: refused, nothing sent, never counted");
  const simple = printsWith([]);
  assert.deepEqual([await printJobCopies({}, [], simple.once), simple.calls.length], [{ ok: true }, 1], "the device's own simple-mode line: one copy, as today");
  const two = printsWith([]);
  assert.deepEqual([await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], two.once), two.calls.length], [{ ok: true }, 2], "both copies, back to back");
  const firstFails = printsWith([{ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) }]);
  const first = await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], firstFails.once);
  assert.deepEqual([firstFails.calls.length, first.ok ? null : printWriteOutcomeOf(first.error).sent], [1, "no"], "the first copy's refusal stands: nothing reached paper");
  const secondFails = printsWith([{ ok: true }, { ok: false, error: new PrintWriteError(PRINTER_WRITE_FAILED_MESSAGE, "no") }]);
  const second = await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], secondFails.once);
  assert.deepEqual(second.ok ? null : printWriteOutcomeOf(second.error), { sent: "maybe", permanent: false, message: PRINTER_WRITE_FAILED_MESSAGE }, "a copy is on paper already: maybe (its REPRINT repeats every copy)");
});

test("PIN (2C): the agent prints a leased job through printJobCopies on this device's printers; the station line reaches the paper", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /const print = \(job: LeasedPrintJob\): Promise<PrintAgentResult> => printJobCopies\(job, readyRef\.current, \(\) => printOnce\(job\)\);/);
  const kot = src("apps/cafe/components/pos/KOTReceipt.tsx");
  const title = kot.indexOf("KITCHEN ORDER");
  const line = kot.indexOf("{stationLine && (");
  const number = kot.indexOf("#{roundNumber}");
  assert.ok(title > 0 && line > title && number > line, "under the title, above the number a cook calls out");
  assert.ok(src("apps/cafe/components/pos/PrintSources.tsx").includes("stationLine={kotStationLine}"), "PrintSources forwards it");
  assert.ok(src("apps/cafe/components/print/PrintHostPrintSources.tsx").includes("kotStationLine={slip.stationLine}"), "the agent's slip carries it");
});

```

In `apps/cafe/lib/print-attention.test.ts`, find:

```ts
    originDeviceId: "dev-2",
    targetDeviceId: "dev-1",
  });
  const bare = printAttentionRowOf({ _id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", createdAt: at(T0) });
  assert.deepEqual(bare, { id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", labels: [], createdAt: "2026-10-03T12:00:00.000Z" }, "omit-empty");
  assert.equal(printAttentionRowOf({ _id: "j3", kind: "kot", label: "x", status: "printed", createdAt: at(T0) }), null, "a status the panel never shows is dropped, never thrown");
```

Replace it with:

```ts
    originDeviceId: "dev-2",
    targetDeviceId: "dev-1",
  });
  // Session 2C: a printers-mode row names its printer, so the panel can say which one waits.
  assert.equal(printAttentionRowOf({ _id: "j7", kind: "kot", label: "KOT", status: "queued", createdAt: at(T0), printerId: "p-bar" })?.printerId, "p-bar");
  const bare = printAttentionRowOf({ _id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", createdAt: at(T0) });
  assert.deepEqual(bare, { id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", labels: [], createdAt: "2026-10-03T12:00:00.000Z" }, "omit-empty");
  assert.equal(printAttentionRowOf({ _id: "j3", kind: "kot", label: "x", status: "printed", createdAt: at(T0) }), null, "a status the panel never shows is dropped, never thrown");
```

In `apps/cafe/lib/print-host-slips.test.ts`, find:

```ts
  assert.match(posPrintSrc, /`Round \$\{/, "use-pos-print.ts must build the label via a literal `Round ${...}` template");
});

```

Replace it with:

```ts
  assert.match(posPrintSrc, /`Round \$\{/, "use-pos-print.ts must build the label via a literal `Round ${...}` template");
});

// Phase 2 Session 2C (spec §8, plan decision 5): a station KOT names its station under its title; a full copy
// beside station slips says ALL STATIONS; today's KOT (no station on the payload) carries none.
test("2C: a routed KOT's station line; today's KOT carries none", () => {
  const kot = { kind: "kot", snapshot: SNAPSHOT, round: 1 } as PrintJobPayload;
  assert.equal((hostPrintSlipOf(kot, "2026-09-06") as HostKotSlip).stationLine, undefined, "simple mode: the slip is today's");
  const cases = [
    [{ name: "Bar", mode: "station" }, "BAR"],
    [{ name: "All stations", mode: "all" }, "ALL STATIONS"],
    [{ name: "Bar", mode: "no-printer" }, "BAR (NO PRINTER SET)"],
  ] as const;
  for (const [station, line] of cases) {
    assert.equal((hostPrintSlipOf({ ...kot, station } as PrintJobPayload, "2026-09-06") as HostKotSlip).stationLine, line, station.mode);
  }
});

```

In `apps/cafe/lib/print-waiting.test.ts`, find:

```ts
  printAlarmSummary,
  printAlarmWanted,
  printRetryNotice,
  printWaitingAge,
  printWaitingBadgeOf,
  printWaitingGroups,
```

Replace it with:

```ts
  printAlarmSummary,
  printAlarmWanted,
  printRetryNotice,
  printerNameOf,
  printWaitingAge,
  printWaitingBadgeOf,
  printWaitingGroups,
```

In `apps/cafe/lib/print-waiting.test.ts`, find:

```ts
  assert.match(src("apps/cafe/components/print/PrintHostDrain.tsx"), /usePrintSlipAlarm\(deviceId\);/, "every device with an identity");
});

```

Replace it with:

```ts
  assert.match(src("apps/cafe/components/print/PrintHostDrain.tsx"), /usePrintSlipAlarm\(deviceId\);/, "every device with an identity");
});

// Session 2C (printers mode): the panel names a waiting slip's printer from this device's printer list.
test("2C: a waiting slip's printer by name; none for simple mode, a printer no longer listed, or no printer at all", () => {
  const printers = [{ id: "p-bar", name: "Bar printer" }];
  assert.equal(printerNameOf(printers, "p-bar"), "Bar printer");
  assert.equal(printerNameOf(printers, undefined), null, "simple mode");
  assert.equal(printerNameOf(printers, "p-gone"), null, "removed since");
  assert.equal(printerNameOf(printers, "none"), null, "no printer took it (its reason says so)");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts lib/print-host-slips.test.ts lib/print-attention.test.ts lib/print-waiting.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 50`; `# pass 45`; `# fail 5`

- [ ] **Step 3: The code**

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
  // Session 1C (spec §7.7): the print job's labels as one inverted banner on top ("REPRINT"). Absent on
  // every first print, so every existing call site prints exactly as before.
  banner?: string;
  ref?: Ref<HTMLDivElement>;
}

```

Replace it with:

```tsx
  // Session 1C (spec §7.7): the print job's labels as one inverted banner on top ("REPRINT"). Absent on
  // every first print, so every existing call site prints exactly as before.
  banner?: string;
  // Phase 2 Session 2C (spec §8): the station a routed KOT is for ("BAR", "ALL STATIONS"), under the title.
  // Absent on today's KOT, so every existing call site prints exactly as before.
  stationLine?: string;
  ref?: Ref<HTMLDivElement>;
}

```

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
  movedBy,
  movedAt,
  banner,
  ref,
}: KOTReceiptProps) {
  const cfg = printConfigOf(settings).kot;
```

Replace it with:

```tsx
  movedBy,
  movedAt,
  banner,
  stationLine,
  ref,
}: KOTReceiptProps) {
  const cfg = printConfigOf(settings).kot;
```

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
            <div className="text-center text-[1.29em] font-bold tracking-widest">
              KITCHEN ORDER
            </div>
          )}
          {/* The number a cook calls out — large, directly under the title.
              A moved slip consumes no ticket number: it is not a round. */}
```

Replace it with:

```tsx
            <div className="text-center text-[1.29em] font-bold tracking-widest">
              KITCHEN ORDER
            </div>
          )}
          {/* Which station's slip this is: a cook at the bar knows it is theirs at a glance. */}
          {stationLine && (
            <div className="text-center text-[1.29em] font-bold tracking-widest">{stationLine}</div>
          )}
          {/* The number a cook calls out — large, directly under the title.
              A moved slip consumes no ticket number: it is not a round. */}
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
  receiptRef?: Ref<HTMLDivElement>;
  // Session 1C (spec §7.7): the print job's banner, set only by the print agent's slips.
  banner?: string;
}

// Off-screen print sources cloned by react-to-print — lifted out of
```

Replace it with:

```tsx
  receiptRef?: Ref<HTMLDivElement>;
  // Session 1C (spec §7.7): the print job's banner, set only by the print agent's slips.
  banner?: string;
  // Session 2C (spec §8): a routed KOT's station line, set only by the print agent's slips.
  kotStationLine?: string;
}

// Off-screen print sources cloned by react-to-print — lifted out of
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
  movedAt,
  receiptRef,
  banner,
}: PrintSourcesProps) {
  // "test" is the provider-owned test slip (PH-5), which renders its own
  // component — it never reaches KOTReceipt. Narrowed explicitly rather than
```

Replace it with:

```tsx
  movedAt,
  receiptRef,
  banner,
  kotStationLine,
}: PrintSourcesProps) {
  // "test" is the provider-owned test slip (PH-5), which renders its own
  // component — it never reaches KOTReceipt. Narrowed explicitly rather than
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
        movedFrom={movedFrom}
        movedBy={movedBy}
        movedAt={movedAt}
        banner={banner}
        ref={kotRef}
      />
```

Replace it with:

```tsx
        movedFrom={movedFrom}
        movedBy={movedBy}
        movedAt={movedAt}
        stationLine={kotStationLine}
        banner={banner}
        ref={kotRef}
      />
```

In `apps/cafe/components/print/PrintHostPrintSources.tsx`, find:

```tsx
      movedBy={slip.movedBy}
      movedAt={slip.movedAt}
      banner={slip.banner}
    />
  );
}
```

Replace it with:

```tsx
      movedBy={slip.movedBy}
      movedAt={slip.movedAt}
      banner={slip.banner}
      kotStationLine={slip.stationLine}
    />
  );
}
```

In `apps/cafe/components/print/WaitingSlipsCard.tsx`, find:

```tsx

import { Button } from "@/components/ui/button";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { usePrintJobActions } from "@/hooks/use-print-job-actions";
import { printWaitingGroups, type PrintWaitingGroup } from "@/lib/print-waiting";
import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";

```

Replace it with:

```tsx

import { Button } from "@/components/ui/button";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { usePrinters } from "@/hooks/use-agent-printers";
import { usePrintJobActions } from "@/hooks/use-print-job-actions";
import { printWaitingGroups, printerNameOf, type PrintWaitingGroup } from "@/lib/print-waiting";
import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";

```

In `apps/cafe/components/print/WaitingSlipsCard.tsx`, find:

```tsx
const SECTION_TITLE = "Slips waiting";

export function WaitingSlipsCard({ pulse }: { pulse: PosPulseData | undefined }) {
  const rows = pulse?.printAttention;
  const { retry, confirm, dismiss } = usePrintJobActions();
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
```

Replace it with:

```tsx
const SECTION_TITLE = "Slips waiting";

export function WaitingSlipsCard({ pulse }: { pulse: PosPulseData | undefined }) {
  // Session 2C: names each slip's printer (printers mode); the same cached read the agent makes.
  const printers = usePrinters(true);
  const rows = pulse?.printAttention;
  const { retry, confirm, dismiss } = usePrintJobActions();
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
```

In `apps/cafe/components/print/WaitingSlipsCard.tsx`, find:

```tsx
                <p className="text-base font-medium">{row.label}</p>
                <p className="text-sm text-muted-foreground">
                  {age} · {reason}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">{actions(section.group, row)}</div>
              </li>
```

Replace it with:

```tsx
                <p className="text-base font-medium">{row.label}</p>
                <p className="text-sm text-muted-foreground">
                  {age} · {reason}
                  {printerNameOf(printers, row.printerId) !== null ? ` · ${printerNameOf(printers, row.printerId)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">{actions(section.group, row)}</div>
              </li>
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { printerListLooksStale, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
```

Replace it with:

```ts
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { printJobCopies, printerListLooksStale, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
  useEffect(() => {
    if (deviceId === "") return;
    const print = (job: LeasedPrintJob): Promise<PrintAgentResult> =>
      new Promise((resolve) => {
        // The bridge settles every slip; one its watchdog gave up on settles late, so this wait is bounded.
        const deadline = window.setTimeout(
```

Replace it with:

```ts
  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
  useEffect(() => {
    if (deviceId === "") return;
    const printOnce = (job: LeasedPrintJob): Promise<PrintAgentResult> =>
      new Promise((resolve) => {
        // The bridge settles every slip; one its watchdog gave up on settles late, so this wait is bounded.
        const deadline = window.setTimeout(
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
          done({ ok: false, error: new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true) });
        }
      });
    const created = createPrintAgent({
      deviceId,
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, ...printerIdsBody(readyRef.current) }),
```

Replace it with:

```ts
          done({ ok: false, error: new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true) });
        }
      });
    // Session 2C: a printer job only on this device's own printer, every copy inside its one lease.
    const print = (job: LeasedPrintJob): Promise<PrintAgentResult> => printJobCopies(job, readyRef.current, () => printOnce(job));
    const created = createPrintAgent({
      deviceId,
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, ...printerIdsBody(readyRef.current) }),
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
import type { PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which
```

Replace it with:

```ts
import type { LeasedPrintJob, PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
  return input.isWriter && input.writesPrinters === false;
}

```

Replace it with:

```ts
  return input.isWriter && input.writesPrinters === false;
}

/** One leased job on this device (spec §6.3 copies, plan decision 2): a printer job is refused (sent:"no", never
 *  counted) when its printer is not this device's printer; otherwise every copy is written in its one lease, one
 *  after another. A failure after the first copy may already have put paper out, so it is "maybe" (the REPRINT
 *  repeats every copy, labelled). A job of the device's own simple-mode line prints once, as today. */
export async function printJobCopies(
  job: Pick<LeasedPrintJob, "printerId" | "copies">,
  localIds: readonly string[],
  printOnce: () => Promise<PrintAgentResult>,
): Promise<PrintAgentResult> {
  if (job.printerId !== undefined && !localIds.includes(job.printerId)) return { ok: false, error: new PrintWriteError(PRINTER_NOT_LOCAL_MESSAGE, "no") };
  const copies = job.copies ?? 1;
  for (let copy = 1; copy <= copies; copy++) {
    const result = await printOnce();
    if (!result.ok) return copy === 1 ? result : { ok: false, error: new PrintWriteError(printWriteOutcomeOf(result.error).message, "maybe") };
  }
  return { ok: true };
}

```

In `apps/cafe/lib/print-attention.ts`, find:

```ts
  originDeviceId?: string;
  targetDeviceId?: string;
  approvedAt?: Date;
}): PrintAttentionRow | null {
  // A status this panel never shows (deploy skew, a row that moved mid-read) degrades one row, never the pulse.
  if (!ATTENTION_STATUSES.has(doc.status)) return null;
```

Replace it with:

```ts
  originDeviceId?: string;
  targetDeviceId?: string;
  approvedAt?: Date;
  printerId?: string;
}): PrintAttentionRow | null {
  // A status this panel never shows (deploy skew, a row that moved mid-read) degrades one row, never the pulse.
  if (!ATTENTION_STATUSES.has(doc.status)) return null;
```

In `apps/cafe/lib/print-attention.ts`, find:

```ts
    ...(doc.originDeviceId ? { originDeviceId: doc.originDeviceId } : {}),
    ...(doc.targetDeviceId ? { targetDeviceId: doc.targetDeviceId } : {}),
    ...(doc.approvedAt ? { approved: true as const } : {}),
  };
}

export async function readPrintAttention(nowMs: number): Promise<{ rows: PrintAttentionRow[]; truncated: boolean }> {
  const docs = await PrintJob.find(printAttentionFilter(nowMs))
    .select("kind label status labels createdAt lastError originDeviceId targetDeviceId approvedAt")
    // The newest rows, on the same index (a merge of its scans, no in-memory sort: the 1D gate's explain()).
    .sort({ createdAt: -1, _id: -1 })
    // One row more than it shows, so a cut is a real cut: exactly 20 waiting reads "20", not "20+", and the
```

Replace it with:

```ts
    ...(doc.originDeviceId ? { originDeviceId: doc.originDeviceId } : {}),
    ...(doc.targetDeviceId ? { targetDeviceId: doc.targetDeviceId } : {}),
    ...(doc.approvedAt ? { approved: true as const } : {}),
    // Session 2C: printers mode names the printer the slip waits on.
    ...(doc.printerId ? { printerId: doc.printerId } : {}),
  };
}

export async function readPrintAttention(nowMs: number): Promise<{ rows: PrintAttentionRow[]; truncated: boolean }> {
  const docs = await PrintJob.find(printAttentionFilter(nowMs))
    .select("kind label status labels createdAt lastError originDeviceId targetDeviceId printerId approvedAt")
    // The newest rows, on the same index (a merge of its scans, no in-memory sort: the 1D gate's explain()).
    .sort({ createdAt: -1, _id: -1 })
    // One row more than it shows, so a cut is a real cut: exactly 20 waiting reads "20", not "20+", and the
```

In `apps/cafe/lib/print-host-slips.ts`, find:

```ts
// (kotRoundSlip ↔ queueKotRound/reprintKot, void ↔ queueVoidSlip), and the
// unit suite pins the pair.

import type {
  KotPrintJobPayload,
  PrintJobPayload,
```

Replace it with:

```ts
// (kotRoundSlip ↔ queueKotRound/reprintKot, void ↔ queueVoidSlip), and the
// unit suite pins the pair.

import { printKotStationHeader } from "@pos/shared/print-printers";
import type {
  KotPrintJobPayload,
  PrintJobPayload,
```

In `apps/cafe/lib/print-host-slips.ts`, find:

```ts
export interface HostKotSlip {
  surface: "kot";
  order: Order;
  kotRoundItems?: OrderItem[];
  kotRoundLabel?: string;
  kotRoundNumber?: number;
```

Replace it with:

```ts
export interface HostKotSlip {
  surface: "kot";
  order: Order;
  /** Phase 2 Session 2C (spec §8): the station a routed KOT is for, under its title ("BAR", "ALL STATIONS",
   *  "BAR (NO PRINTER SET)"); absent on today's KOT and every other slip. */
  stationLine?: string;
  kotRoundItems?: OrderItem[];
  kotRoundLabel?: string;
  kotRoundNumber?: number;
```

In `apps/cafe/lib/print-host-slips.ts`, find:

```ts
}

function kotSlipOf(payload: KotPrintJobPayload): HostKotSlip {
  return kotRoundSlip(orderFromSnapshot(payload.snapshot), payload.round);
}

/** `queueVoidSlip` verbatim: the synthesized single line (voided qty, the
```

Replace it with:

```ts
}

function kotSlipOf(payload: KotPrintJobPayload): HostKotSlip {
  const slip = kotRoundSlip(orderFromSnapshot(payload.snapshot), payload.round);
  return payload.station === undefined ? slip : { ...slip, stationLine: printKotStationHeader(payload.station) };
}

/** `queueVoidSlip` verbatim: the synthesized single line (voided qty, the
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
}

/** What a Retry / Print now tap says when the server did not apply it (null: done). */
export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.reason === "printer-gone") return "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order.";
```

Replace it with:

```ts
}

/** What a Retry / Print now tap says when the server did not apply it (null: done). */
/** Session 2C (printers mode): the name of the printer a waiting slip is for, from this device's printer list;
 *  null in simple mode, for a printer no longer listed, and for a slip no printer took (its reason says so). */
export function printerNameOf(printers: ReadonlyArray<{ id: string; name: string }>, printerId: string | undefined): string | null {
  return printerId === undefined ? null : (printers.find((printer) => printer.id === printerId)?.name ?? null);
}

export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.reason === "printer-gone") return "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order.";
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts lib/print-host-slips.test.ts lib/print-attention.test.ts lib/print-waiting.test.ts lib/print-agent-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 57`; `# pass 57`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-agent-printers.ts hooks/use-print-agent.ts lib/print-host-slips.ts components/pos/KOTReceipt.tsx components/pos/PrintSources.tsx components/print/PrintHostPrintSources.tsx lib/print-attention.ts lib/print-waiting.ts components/print/WaitingSlipsCard.tsx && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/components/pos/KOTReceipt.tsx apps/cafe/components/pos/PrintSources.tsx apps/cafe/components/print/PrintHostPrintSources.tsx apps/cafe/components/print/WaitingSlipsCard.tsx apps/cafe/hooks/use-print-agent.ts apps/cafe/lib/print-agent-printers.test.ts apps/cafe/lib/print-agent-printers.ts apps/cafe/lib/print-attention.test.ts apps/cafe/lib/print-attention.ts apps/cafe/lib/print-host-slips.test.ts apps/cafe/lib/print-host-slips.ts apps/cafe/lib/print-waiting.test.ts apps/cafe/lib/print-waiting.ts
git commit -m "feat(print): Phase 2 printing a printer's slip on this device: only on its own printer, every copy in one lease; the KOT's station line on paper; the waiting slips name their printer"
```

---

### Task C8: the budget recount for printers mode

**Files:**
- Modify: `packages/shared/src/print-budget.ts` (`PRINT_SETUP_STALE_MS`, `PRINT_SETUP_REFRESH_MIN_MS`, `printSetupReadsWorstPerDay`, `printHeavyCounterDayRequests`), `apps/cafe/hooks/use-agent-printers.ts` and `apps/cafe/hooks/use-print-agent.ts` (read the constants)
- Tests: `packages/shared/src/print-budget.test.ts` (three new tests), `apps/cafe/lib/print-agent-printers.test.ts` (a pin's title)

**Interfaces produced:** `PRINT_SETUP_STALE_MS` (30 min); `PRINT_SETUP_REFRESH_MIN_MS` (60 s); `printSetupReadsWorstPerDay()` (192); `printHeavyCounterDayRequests()` (3,180).

**Reading the printers** costs at most 192 requests a day (8 devices, a focus read at most twice an hour for 12 h); mount and `print-setup` reads come per page load and per admin save. 30 min, not the spec item's 5: at 5 min a focus-happy day would take the heavy setup's worst case past 18,000 (the 2B gate's budget ruling). With every read, the heavy day stays under both ceilings (5,982 normal; 17,820 worst).

**The counter's full copies** cost one request each when the counter device takes the orders (decision 15 per printer line): the heavy day is 5,340 with the wake (was 5,790).

**A stale list is read again at most once a minute** (Task C6): never more often than every third pulse, and at most 30 times for one waiting slip (it leaves the count when it goes stale after 30 min). A former writer reads once and stops polling.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, writesPrinters: false }), false, "the host in simple mode");
});

test("PIN (2C): the page reads the printers on mount, on a print-setup frame and on focus at most every 5 min; every agent and the drain use it", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /queryFn: \(\) => apiGet<PrinterConfig\[\]>\("\/api\/printers"\),/);
  assert.match(hook, /staleTime: PRINTERS_STALE_MS,/);
```

Replace it with:

```ts
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, writesPrinters: false }), false, "the host in simple mode");
});

test("PIN (2C): the page reads the printers on mount, on a print-setup frame and on focus at most every 30 min; every agent and the drain use it", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /queryFn: \(\) => apiGet<PrinterConfig\[\]>\("\/api\/printers"\),/);
  assert.match(hook, /staleTime: PRINTERS_STALE_MS,/);
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  printRequestsForSlips,
  printSlipRequestsPerDay,
  printStationSlipsPerDay,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
```

Replace it with:

```ts
  printRequestsForSlips,
  printSlipRequestsPerDay,
  printStationSlipsPerDay,
  PRINT_SETUP_REFRESH_MIN_MS,
  PRINT_SETUP_STALE_MS,
  printHeavyCounterDayRequests,
  printSetupReadsWorstPerDay,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.equal(realtime, PRINT_REALTIME_BASE_PER_DAY, "printing adds no Worker request at all");
});

```

Replace it with:

```ts
  assert.equal(realtime, PRINT_REALTIME_BASE_PER_DAY, "printing adds no Worker request at all");
});

// Phase 2 Session 2C: each device reads the outlet's printers on mount, on a print-setup frame (an admin save:
// two Worker requests, then one read per device) and on a focus at most every 30 min. Never per slip, never on a
// timer. 30 min, not 5: at 5 min a focus-happy day would push the heavy worst case past 18,000 (the 2B gate).
test("2C: reading the printers costs at most 192 requests a day, and the heavy setup still fits both ceilings", () => {
  assert.equal(PRINT_SETUP_STALE_MS, 30 * 60 * 1000);
  const reads = printSetupReadsWorstPerDay();
  assert.equal(reads, 192, "8 devices, a focus read at most twice an hour, 12 h");
  const wakePerWriter = Math.round(OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: null, capSpent: false }));
  const heavy = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + PRINT_BUDGET_STATIONS_DAY.writers * wakePerWriter;
  assert.ok(heavy + reads <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `normal heavy day ${heavy + reads}/day`);
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  const worst = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + 3 * Math.min(OPEN_MS / fastest, printWakeWriterCap(3));
  assert.equal(worst + reads, 17_820, "the heavy worst case with every focus read");
  assert.ok(worst + reads <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${worst + reads}/day`);
});

// Session 2C (decision 15 per printer line): the counter device writes the full copy and the bills; when it takes
// every order, each round's full copy is made leased to it (one request), its bill follows through the ack's
// more, and each station slip costs its writer a lease and an ack.
test("2C: the heavy day when the counter takes every order: its full copies cost one request each (5,340 with the wake)", () => {
  const wakePerWriter = Math.round(OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: null, capSpent: false }));
  assert.equal(printHeavyCounterDayRequests(), 3_180, "450 full copies at one request instead of two");
  assert.equal(printHeavyCounterDayRequests() + PRINT_BUDGET_STATIONS_DAY.writers * wakePerWriter, 5_340);
});

// The 2C gate's review (I-2): a stale printer list heals from the pulse or the wake within a minute, and the read
// is bounded: at most one a minute, only while a printer job aimed at the device is not among its ready printers,
// and such a job goes stale (out of the count) after 30 min.
test("2C: a stale printer list is read again at most once a minute, and at most 30 times for one waiting slip", () => {
  assert.equal(PRINT_SETUP_REFRESH_MIN_MS, 60_000);
  assert.ok(PRINT_SETUP_REFRESH_MIN_MS >= 3 * 20_000, "never more often than every third pulse");
  assert.equal(Math.ceil(PRINT_HOST_MAX_AGE_MS / PRINT_SETUP_REFRESH_MIN_MS), 30, "a slip leaves the count when it goes stale (30 min)");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
```

Replace it with:

```ts
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 5 min (the fallback when a frame was missed). Never a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = 5 * 60 * 1000;
const NO_PRINTERS: PrinterConfig[] = [];

export function usePrinters(enabled: boolean): PrinterConfig[] {
```

Replace it with:

```ts

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 30 min (the fallback when a frame was missed; print-budget.test.ts). Never
// a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = PRINT_SETUP_STALE_MS;
const NO_PRINTERS: PrinterConfig[] = [];

export function usePrinters(enabled: boolean): PrinterConfig[] {
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import {
  printAgentPollsWake,
```

Replace it with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_REFRESH_MIN_MS } from "@pos/shared/print-budget";
import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import {
  printAgentPollsWake,
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  return ids.length > 0 ? { printerIds: [...ids] } : {};
}

/** Session 2C (the 2C gate's review, I-2): a stale printer list is read again at most this often. */
const PRINTERS_STALE_REFRESH_MS = 60_000;

/** The heartbeat the host's wake carries (spec §10). */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
```

Replace it with:

```ts
  return ids.length > 0 ? { printerIds: [...ids] } : {};
}

/** The heartbeat the host's wake carries (spec §10). */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  const noteJobsForMe = useCallback(
    (jobs: PrintJobsForMe | undefined, writesPrinters?: boolean): void => {
      if (!printerListLooksStale({ ready: readyRef.current, isWriter: writerRef.current, jobsForMe: jobs, writesPrinters })) return;
      if (Date.now() - setupReadAtRef.current < PRINTERS_STALE_REFRESH_MS) return;
      setupReadAtRef.current = Date.now();
      void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    },
```

Replace it with:

```ts
  const noteJobsForMe = useCallback(
    (jobs: PrintJobsForMe | undefined, writesPrinters?: boolean): void => {
      if (!printerListLooksStale({ ready: readyRef.current, isWriter: writerRef.current, jobsForMe: jobs, writesPrinters })) return;
      if (Date.now() - setupReadAtRef.current < PRINT_SETUP_REFRESH_MIN_MS) return;
      setupReadAtRef.current = Date.now();
      void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    },
```

In `packages/shared/src/print-budget.ts`, find:

```ts
 *  for a host, and printers mode has none. A slip its writer asked for publishes nothing (Session 2B). */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 1;

```

Replace it with:

```ts
 *  for a host, and printers mode has none. A slip its writer asked for publishes nothing (Session 2B). */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 1;

/** Phase 2 Session 2C: how long a device keeps the outlet's printers list before a focus reads it again (the
 *  "print-setup" frame reads it at once; this is the fallback for a missed frame). */
export const PRINT_SETUP_STALE_MS = 30 * 60 * 1000;
/** Session 2C (the 2C gate's review, I-2): a list a printer job shows to be stale (the pulse or the wake names a
 *  printer job aimed at this device that it does not print on) is read again at most this often. */
export const PRINT_SETUP_REFRESH_MIN_MS = 60 * 1000;

/** Session 2C: the printers reads of a day at most, every device refocused all day (spec §17.2's 3 + 5
 *  devices): mount and print-setup reads come on top only per page load and per admin save. */
export function printSetupReadsWorstPerDay(): number {
  const devices = PRINT_BUDGET_BUSY_DAY.agents + PRINT_BUDGET_BUSY_DAY.orderingDevices;
  return devices * Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINT_SETUP_STALE_MS);
}

/** Session 2C (decision 15 per printer line): the heavy day when the counter device, the writer of the full copy
 *  and the bills, takes every order: each round's full copy is made leased to it (one request); its bill follows
 *  through the ack's more, and each station slip costs its writer a lease and an ack, as before. */
export function printHeavyCounterDayRequests(): number {
  const d = PRINT_BUDGET_STATIONS_DAY;
  const fullCopies = PRINT_BUDGET_BUSY_DAY.orders * d.roundsPerOrder * d.fullCopyPerRound;
  return printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) - Math.round(fullCopies * (PRINT_REQUESTS_PER_SLIP - PRINT_REQUESTS_PER_DIRECT_SLIP));
}

```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 29`; `# pass 29`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && npx eslint hooks/use-agent-printers.ts hooks/use-print-agent.ts && echo LINT_OK`
Expected: `# tests 7`; `# pass 7`; `# fail 0`; `TSC_OK`; `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/hooks/use-agent-printers.ts apps/cafe/hooks/use-print-agent.ts apps/cafe/lib/print-agent-printers.test.ts packages/shared/src/print-budget.test.ts packages/shared/src/print-budget.ts
git commit -m "feat(print): Phase 2 budget recount for printers mode: reading the printers costs at most 192 requests a day, a stale list is read again at most once a minute, and the counter's full copies cost one request each"
```

---

### Task C9: live legs an–aq: printers mode against a real database

**Files:**
- Create: `apps/cafe/scripts/print-host-live/printers-mode.ts` (legs an, ao, ap, aq)
- Modify: `apps/cafe/scripts/verify-print-host-live.ts` (the four legs after am)

**Interfaces produced:** `legAN(nowMs)`, `legAO(nowMs)`, `legAP(nowMs)`, `legAQ(nowMs)`.

**What they prove against a real mongod.** (an) A Pay Now from the counter device with kitchen, bar and counter printers: four jobs (the kitchen's and the bar's station slips aimed at their writers, the counter's full copy made leased to its tab in one write, the bill behind it with its two copies as one job), each slip holding its own lines, the routed keys, a replay making nothing new, a device that writes no printer getting nothing leased, a station name differing only in case refused, and with no bill printer the bill made failed at once (`none`, its reason, its log). (ao) A device naming a printer it does not write gets nothing; each writer leases only its own printer's slip; the ack's `more` asks its own line; a stuck bar job never blocks the kitchen; a device writing two printers counts and leases both lines in one call, and its jobs-for-me names both printers (I-2). (ap) Simple mode's move never touches a printer job; a printer re-saved with another printing device takes its waiting job along; a removed printer's job fails visibly; a staff Retry on it is refused; a Retry on a printer that still takes slips puts the job on its current writer's line, and a job still aimed at the old writer is leased and claimed by the new one, never the old (I-3); Stop printing here never cancels a printer's slip; a bill waiting for the cashier's answer keeps waiting when its printer goes (I-1). (aq) A server-owned round with no job is routed again by the repair; a round with some jobs is left alone; a lease taken through the lease call is handed back to its tab within one request timeout (the 2B gate's M-3), never later (I-A). 30 new checks (an 10, ao 8, ap 8, aq 4).

- [ ] **Step 1: The change**

Create `apps/cafe/scripts/print-host-live/printers-mode.ts`:

```ts
/**
 * Phase 2 Session 2C live legs — printers mode (spec §8, §9.3; plan decisions 1–5, 15) against a REAL MongoDB:
 * creation routed by station with a full copy, a bill with copies, and a slip no printer takes (an); a lease per
 * printer line, only by its writer (ao); the sweep and a staff retry when a printer's writer changes or the printer
 * goes (ap); the repair of a routed round, and the 2B gate's re-delivery bound (aq). Run by
 * scripts/verify-print-host-live.ts after legs ak–am. Each leg sets the outlet up itself and ends in simple mode.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import { PRINT_DIRECT_LEASE_DETAIL } from "@pos/shared/print-lifecycle";
import { Category } from "@/models/Category";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { createPrinter, deletePrinter, replacePrinter } from "@/lib/print-printers";
import { createStation, listStations } from "@/lib/print-stations";
import { createOrderPrintJobs, enqueueDirectPrintJob } from "@/lib/print-order-jobs";
import { ackPrintJob, leasePrintJobs, readJobsForDevice } from "@/lib/print-lease";
import { retryPrintJob } from "@/lib/print-job-actions";
import { dismissQueuedPrintJobsForClearedHost } from "@/lib/print-queue";
import { repairMissingKotJobs } from "@/lib/print-repair";
import { routePrinterJobs, routeWaitingPrintJobs } from "@/lib/print-sweep";
import { kotPrintJob } from "@/lib/print-routing";
import { check, resetCollections } from "./harness";
import { HOST, STAFF, rowOf, setRaw } from "./lifecycle";

const COUNTER = "live-counter-device";
const KITCHEN = "live-kitchen-device";
const BAR = "live-bar-device";
const TAB = "live-counter-tab";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

interface Outlet {
  kitchenStation: string;
  barStation: string;
  kitchen: string;
  bar: string;
  counter: string;
  paneer: string;
  mojito: string;
}

function body(name: string, over: Partial<PrinterBody>): PrinterBody {
  return { name, connection: { kind: "lan", host: "10.0.0.9", port: 9100 }, paper: 80, slips: NO_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

async function idOf(made: Promise<{ ok: boolean; data?: { id: string } }>): Promise<string> {
  const result = await made;
  return result.ok && result.data !== undefined ? result.data.id : "";
}

/** A kitchen (LAN, written by the kitchen tablet), a bar (the bar phone's own printer) and a counter (LAN, written
 *  by the counter device: bills in two copies, the full copy, notices, End of day). Paneer cooks in the kitchen
 *  (Food has no station: the default), the Mojito at the bar (Drinks). */
async function outlet(): Promise<Outlet> {
  // Orders too: the repair (aq) must see only this leg's rounds, never an earlier leg's server-owned ones.
  await Promise.all([resetCollections(), Order.deleteMany({}), Station.deleteMany({}), Printer.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
  const [kitchenStation] = await listStations();
  const barStation = await idOf(createStation({ name: "Bar" }));
  const kitchenId = kitchenStation?.id ?? "";
  const food = await Category.create({ name: "Food" });
  const drinks = await Category.create({ name: "Drinks", stationId: barStation });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const kitchen = await idOf(createPrinter(body("Kitchen", { connection: { kind: "lan", host: "10.0.0.61", port: 9100 }, primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, kotStations: [kitchenId], notices: true } })));
  const bar = await idOf(createPrinter(body("Bar", { connection: { kind: "device", deviceId: BAR, transport: "bt-classic", address: "AA:BB" }, slips: { ...NO_SLIPS, kotStations: [barStation], notices: true } })));
  const counter = await idOf(createPrinter(body("Counter", { primaryDeviceId: COUNTER, slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, copies: { kot: 1, bill: 2 } })));
  return { kitchenStation: kitchenId, barStation, kitchen, bar, counter, paneer: String(paneer._id), mojito: String(mojito._id) };
}

/** A paid order with Paneer and a Mojito in round 1 (a server-owned round when `printDevice` is given). */
async function order(o: Outlet, printDevice?: string): Promise<string> {
  const doc = await Order.create({
    orderId: `ORD-2C-${new mongoose.Types.ObjectId().toHexString()}`,
    customerName: "Walk-in",
    items: [
      { productId: o.paneer, name: "Paneer Tikka", price: 250, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
      { productId: o.mojito, name: "Mojito", price: 150, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: 400,
    discount: 0,
    total: 400,
    paidAmount: 400,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    kotRounds: 1,
    ...(printDevice !== undefined ? { kotPrintDevices: [printDevice] } : {}),
  });
  return String(doc._id);
}

async function payNow(orderId: string, device: string, nowMs: number, ready: string[] = [], tab?: string) {
  return createOrderPrintJobs({
    order: await Order.findById(orderId).lean(),
    slips: [{ kind: "kot", round: 1 }, { kind: "bill" }],
    originDeviceId: device,
    ...(tab !== undefined ? { leaseTabId: tab } : {}),
    readyPrinterIds: ready,
    queuedBy: STAFF,
    nowMs,
  });
}

const linesOf = async (id: string): Promise<string> => {
  const row = await PrintJob.findById(id).select("payload").lean();
  const payload = JSON.parse(row?.payload ?? "{}") as { snapshot?: { items?: Array<{ name: string }> }; station?: { mode: string } };
  return `${payload.station?.mode ?? "-"}:${(payload.snapshot?.items ?? []).map((item) => item.name).join("+")}`;
};

async function simpleModeAgain(): Promise<void> {
  await Printer.deleteMany({});
}

export async function legAN(nowMs: number): Promise<void> {
  console.log("\n(an) printers mode: one job per printer line, by station with the full copy; the counter's own slip leased to it");
  const o = await outlet();
  check("(an) a station name differing only in case is refused (409, the 2A gate's M7)", !(await createStation({ name: "bar" })).ok);
  const orderId = await order(o);
  const refs = await payNow(orderId, COUNTER, nowMs, [o.counter], TAB);
  const byPrinter = new Map(refs.map((ref) => [ref.printerId, ref]));
  const [kitchen, bar, full, bill] = [byPrinter.get(o.kitchen), byPrinter.get(o.bar), refs.find((r) => r.printerId === o.counter && r.kind === "kot"), refs.find((r) => r.kind === "bill")];
  check("(an) Pay Now makes four jobs: the kitchen's, the bar's, the counter's full copy, and the bill", refs.length === 4 && kitchen !== undefined && bar !== undefined && full !== undefined && bill !== undefined);
  check("(an) each station slip waits for its writer, queued: the kitchen tablet, the bar phone", kitchen?.status === "queued" && kitchen.targetDeviceId === KITCHEN && bar?.status === "queued" && bar.targetDeviceId === BAR);
  check("(an) the counter's full copy is made leased to its tab (decision 15 per printer line); the bill waits behind it", full?.status === "leased" && full.leased?.printerId === o.counter && bill?.status === "queued" && bill.targetDeviceId === COUNTER);
  check("(an) each slip holds its own lines: the kitchen Paneer, the bar the Mojito, the full copy both (ALL STATIONS)", (await linesOf(kitchen?.id ?? "")) === "station:Paneer Tikka" && (await linesOf(bar?.id ?? "")) === "station:Mojito" && (await linesOf(full?.id ?? "")) === "all:Paneer Tikka+Mojito");
  const fullRow = await rowOf(full?.id ?? "");
  const billRow = await PrintJob.findById(bill?.id ?? "").select("jobKey copies").lean();
  check("(an) keys add the printer and the part; the bill's two copies are one job", fullRow?.jobKey === `kot:${orderId}:1:${o.counter}:all` && billRow?.jobKey === `bill:${orderId}:${o.counter}:-` && billRow?.copies === 2);
  check("(an) the direct job was one write, its log 'leased(direct)'", fullRow?.updatedAt.getTime() === fullRow?.createdAt.getTime() && fullRow?.log?.[1]?.detail === PRINT_DIRECT_LEASE_DETAIL);
  const again = await payNow(orderId, COUNTER, nowMs, [o.counter], TAB);
  check("(an) a replay makes nothing new: the same four jobs", again.length === 4 && (await PrintJob.countDocuments({ orderId })) === 4);
  const phone = await payNow(await order(o), "live-phone", nowMs, [o.counter], TAB);
  check("(an) a device that writes no printer gets nothing leased, whatever it names", phone.length === 4 && phone.every((ref) => ref.leased === undefined));
  await deletePrinter(o.counter);
  const orphan = await payNow(await order(o), COUNTER, nowMs);
  const noBill = orphan.find((ref) => ref.kind === "bill");
  const failed = await PrintJob.findById(noBill?.id ?? "").select("status printerId lastError log targetDeviceId").lean();
  check("(an) with no bill printer the bill is made failed at once, visibly ('none', its reason, its log)", noBill?.status === "failed" && failed?.printerId === PRINT_JOB_NO_PRINTER && failed.lastError === "No printer is set up for bills." && failed.targetDeviceId === COUNTER && failed.log?.map((e) => e.event).join() === "created,failed");
  await simpleModeAgain();
}

export async function legAO(nowMs: number): Promise<void> {
  console.log("\n(ao) a lease per printer line, only by its writer; a stuck bar job never blocks the kitchen");
  const o = await outlet();
  await payNow(await order(o), COUNTER, nowMs);
  const wrong = await leasePrintJobs({ deviceId: BAR, tabId: "bar-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs });
  check("(ao) a device naming a printer it does not write gets nothing from it", wrong.jobs.length === 0);
  const kitchen = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [o.kitchen, o.bar], dismissedBy: STAFF, nowMs });
  check("(ao) the kitchen tablet leases its own printer's slip only", kitchen.jobs.length === 1 && kitchen.jobs[0]?.printerId === o.kitchen);
  const barJob = await leasePrintJobs({ deviceId: BAR, tabId: "bar-tab", printerIds: [o.bar], dismissedBy: STAFF, nowMs });
  check("(ao) the bar phone leases the bar's", barJob.jobs.length === 1 && barJob.jobs[0]?.printerId === o.bar);
  const acked = await ackPrintJob({ id: kitchen.jobs[0]?.id ?? "", deviceId: KITCHEN, epoch: 1, outcome: "printed", nowMs: nowMs + 1_000 });
  check("(ao) the kitchen's ack: printed, and more:false (its own line is empty, whatever waits elsewhere)", acked.status === "printed" && acked.more === false);
  await payNow(await order(o), COUNTER, nowMs + 2_000);
  const next = await leasePrintJobs({ deviceId: BAR, tabId: "bar-tab", printerIds: [o.bar], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ao) the bar's next slip waits behind its leased one (head of line per printer)", next.jobs.length === 0 && next.retryAt !== null);
  const kitchen2 = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ao) ... and never blocks the kitchen's", kitchen2.jobs.length === 1 && kitchen2.jobs[0]?.printerId === o.kitchen);
  // A fresh outlet where the kitchen tablet writes both the kitchen and the bar printer.
  const two = await outlet();
  await replacePrinter(two.bar, body("Bar", { connection: { kind: "device", deviceId: KITCHEN, transport: "bt-classic", address: "AA:BB" }, slips: { ...NO_SLIPS, kotStations: [two.barStation], notices: true } }));
  await payNow(await order(two), COUNTER, nowMs);
  const counted = await readJobsForDevice(KITCHEN, nowMs + 1_000);
  const both = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [two.kitchen, two.bar], dismissedBy: STAFF, nowMs: nowMs + 1_000 });
  const pair = [two.kitchen, two.bar].sort().join();
  check("(ao) a device writing two printers counts and leases both lines in one call, one job each", counted.count === 2 && both.jobs.map((job) => job.printerId).sort().join() === pair);
  check("(ao) its jobs-for-me names both printers, so a stale printer list reads itself again (the 2C review, I-2)", [...(counted.printerIds ?? [])].sort().join() === pair);
  await simpleModeAgain();
}

export async function legAP(nowMs: number): Promise<void> {
  console.log("\n(ap) the sweep: a printer job follows its printer's writer, or fails when its printer is gone; simple mode never moves it");
  const o = await outlet();
  const refs = await payNow(await order(o), COUNTER, nowMs);
  const kitchenRef = refs.find((ref) => ref.printerId === o.kitchen);
  const barRef = refs.find((ref) => ref.printerId === o.bar);
  await routeWaitingPrintJobs(HOST, nowMs);
  check("(ap) simple mode's move to a host never touches a printer job", (await rowOf(kitchenRef?.id ?? ""))?.targetDeviceId === KITCHEN);
  await replacePrinter(o.kitchen, body("Kitchen", { connection: { kind: "lan", host: "10.0.0.61", port: 9100 }, primaryDeviceId: "live-new-kitchen", slips: { ...NO_SLIPS, kotStations: [o.kitchenStation], notices: true } }));
  await deletePrinter(o.bar);
  const moved = await routePrinterJobs(nowMs + 1_000);
  const kitchenRow = await rowOf(kitchenRef?.id ?? "");
  const barRow = await rowOf(barRef?.id ?? "");
  check("(ap) a printer re-saved with another printing device takes its waiting job along", kitchenRow?.targetDeviceId === "live-new-kitchen" && kitchenRow.log?.at(-1)?.event === "retargeted" && moved.retargeted >= 1);
  check("(ap) a removed printer's waiting job fails visibly, never guessed onto another printer", barRow?.status === "failed" && barRow.lastError === PRINTER_GONE_MESSAGE && moved.failed === 1);
  const refused = await retryPrintJob({ id: barRef?.id ?? "", nowMs: nowMs + 2_000 });
  check("(ap) a staff Retry on it is refused: its printer is gone (ruling R2)", !refused.applied && refused.reason === "printer-gone");
  const kitchenId = kitchenRef?.id ?? "";
  await setRaw(kitchenId, { status: "failed", targetDeviceId: KITCHEN });
  const retried = await retryPrintJob({ id: kitchenId, nowMs: nowMs + 2_500 });
  const retriedRow = await rowOf(kitchenId);
  check("(ap) a Retry on a printer that still takes slips puts the job on its current writer's line, in the same write (the 2C review, I-3)", retried.applied && retriedRow?.status === "queued" && retriedRow.targetDeviceId === "live-new-kitchen");
  await setRaw(kitchenId, { targetDeviceId: KITCHEN });
  const old = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  const claimed = await leasePrintJobs({ deviceId: "live-new-kitchen", tabId: "new-tab", printerIds: [o.kitchen], dismissedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ap) a job still aimed at the old writer: the old one gets nothing, the printer's writer leases it and claims it (I-3)", old.jobs.length === 0 && claimed.jobs[0]?.id === kitchenId && (await rowOf(kitchenId))?.targetDeviceId === "live-new-kitchen");
  const orphanId = new mongoose.Types.ObjectId();
  await PrintJob.collection.insertOne({ _id: orphanId, kind: "eod", payload: JSON.stringify({ kind: "eod", dateKey: "2026-10-04", dateLabel: "4 Oct" }), label: "End of day", queuedBy: STAFF, status: "queued", targetDeviceId: COUNTER, printerId: o.counter, createdAt: new Date(nowMs), updatedAt: new Date(nowMs) });
  await dismissQueuedPrintJobsForClearedHost(STAFF);
  check("(ap) Stop printing here never cancels a printer's slip (one no device asked for included)", (await rowOf(String(orphanId)))?.status === "queued");
  const billId = refs.find((ref) => ref.kind === "bill")?.id ?? "";
  await setRaw(billId, { status: "needs-confirm" });
  await deletePrinter(o.counter);
  await routePrinterJobs(nowMs + 4_000);
  check("(ap) a bill waiting for the cashier's answer keeps waiting for it when its printer goes (the 2C review, I-1)", (await rowOf(billId))?.status === "needs-confirm" && (await rowOf(String(orphanId)))?.status === "failed");
  await simpleModeAgain();
}

export async function legAQ(nowMs: number): Promise<void> {
  console.log("\n(aq) the repair routes a server-owned round that has no job; the 2B gate's re-delivery bound");
  const o = await outlet();
  const orderId = await order(o, COUNTER);
  const repaired = await repairMissingKotJobs(nowMs);
  const keys = (await PrintJob.find({ orderId }).select("jobKey").lean()).map((row) => row.jobKey ?? "").sort();
  check("(aq) a round with no job at all is routed again with today's setup: the kitchen, the bar and the full copy", repaired === 3 && keys.join() === [`kot:${orderId}:1:${o.bar}:${o.barStation}`, `kot:${orderId}:1:${o.counter}:all`, `kot:${orderId}:1:${o.kitchen}:${o.kitchenStation}`].sort().join());
  await PrintJob.deleteOne({ jobKey: `kot:${orderId}:1:${o.bar}:${o.barStation}` });
  check("(aq) a round with some of its jobs is left alone (one request made them together)", (await repairMissingKotJobs(nowMs + 1_000)) === 0 && (await PrintJob.countDocuments({ orderId })) === 2);
  await simpleModeAgain();
  await resetCollections();
  const simple = await order(o);
  const wire = JSON.parse(JSON.stringify(await Order.findById(simple).lean())) as Parameters<typeof kotPrintJob>[0];
  await createOrderPrintJobs({ order: await Order.findById(simple).lean(), slips: [{ kind: "kot", round: 1 }], originDeviceId: HOST, queuedBy: STAFF, nowMs });
  const leased = await leasePrintJobs({ deviceId: HOST, tabId: TAB, dismissedBy: STAFF, nowMs });
  const kot = kotPrintJob(wire, 1);
  const resend = (at: number) => enqueueDirectPrintJob({ payload: kot.payload, label: kot.label, queuedBy: STAFF, originDeviceId: HOST, leaseTabId: TAB, nowMs: at });
  const soon = await resend(nowMs + 10_000);
  check("(aq) a lease the tab took through the lease call is handed back to it within one request timeout (the 2B gate's M-3)", leased.jobs.length === 1 && soon?.outcome === "queued" && soon.leased?.id === leased.jobs[0]?.id);
  const late = await resend(nowMs + 16_000);
  check("(aq) later, never (the 2B gate's I-A): the lease is left to expire into one REPRINT", late?.outcome === "already-resolved");
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legAF, legAG } from "./print-host-live/attention";
import { legAH, legAI, legAJ } from "./print-host-live/printers";
import { legAK, legAL, legAM } from "./print-host-live/direct";
import { Station } from "@/models/Station";
import { Printer } from "@/models/Printer";
import { Category } from "@/models/Category";
```

Replace it with:

```ts
import { legAF, legAG } from "./print-host-live/attention";
import { legAH, legAI, legAJ } from "./print-host-live/printers";
import { legAK, legAL, legAM } from "./print-host-live/direct";
import { legAN, legAO, legAP, legAQ } from "./print-host-live/printers-mode";
import { Station } from "@/models/Station";
import { Printer } from "@/models/Printer";
import { Category } from "@/models/Category";
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAK(Date.now());
    await legAL(Date.now());
    await legAM(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAK(Date.now());
    await legAL(Date.now());
    await legAM(Date.now());
    // Phase 2 Session 2C legs (printers mode: creation, a lease per printer line, the sweep, the repair).
    await legAN(Date.now());
    await legAO(Date.now());
    await legAP(Date.now());
    await legAQ(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

- [ ] **Step 2: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK && npx eslint scripts/print-host-live/printers-mode.ts scripts/verify-print-host-live.ts && echo LINT_OK`
Expected: `TSC_OK`; `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | grep -E "passed, [0-9]+ failed"`
Expected: `302 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/printers-mode.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): Phase 2 live legs an–aq: printers-mode creation by station with the full copy and a failed-at-creation bill, a lease per printer line only by its writer, the sweep and a refused retry when a printer goes, the repair of a routed round, and the re-delivery bound"
```

---

### Task C10: full verification, builds, the emulator exit check, the fresh review, Results

**Files:** this plan (a new "Session 2C Results" section at its end). The tools below go in this session's scratchpad, never in the repo.

- [ ] **Step 1: Every suite**

Run each from the repo (the totals the pre-validation saw on a fresh clone):

| Run | Expected |
|---|---|
| `cd /d/kd/lucifer/packages/shared && npm test && npx tsc --noEmit -p .` | `# tests 679`, `# pass 679`; tsc 0 |
| `cd /d/kd/lucifer/apps/cafe && npm test` | `# tests 4350`, `# pass 4349`, `# fail 0`, `# skipped 1` (the skip is the `go-live-dl` pin) |
| `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npm run lint` | tsc 0; lint 0 errors and the 2 old warnings |
| `cd /d/kd/lucifer/apps/hub && npx tsc --noEmit` | 0 |
| `cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test && npm run test:app` | 117/117; Jest 3/3 (untouched) |
| `cd /d/kd/lucifer/apps/desktop && npm test` | 191/191 (untouched) |
| `cd /d/kd/lucifer && npm run test:print-tools` | 8/8 |
| `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live` | `302 passed, 0 failed` (272 + 30: an 10, ao 8, ap 8, aq 4) |

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build`
Expected: the build succeeds with 127 routes (2C adds none).

- [ ] **Step 3: APKs (no mobile change: byte-identical to the release), and the Worker**

First `git diff <start>..HEAD --stat -- apps/mobile apps/desktop` (`<start>`: the commit this session started from, in Results' Start) must print nothing. Then build the x86_64 APK and the ARM pair with `GRADLE_USER_HOME='D:\gradle-home'` (the README's commands). Expected: byte-identical to the 2026-10-03 release (`D:\kd\pos-apk-release\Sandbee-POS-final\`): x86_64 `29115bdf…`, arm64-v8a `0e0ec314…`, armeabi-v7a `e618900a…`. A different hash means something outside the plan changed: stop and find out what.

`workers/realtime/src/index.ts` gains the `print-setup` kind (Task C5). Nothing is deployed in this session; Results notes that the go-live run deploys the Worker before the web (an older Worker refuses the frame, which costs only the frame).

- [ ] **Step 4: The emulator exit check (spec §8, §9.3; the 2C exit)**

**First check which POS the emulator's app shows** (Global Constraints, Demo POS): it was on the owner's live demo ("Olivea Pizza") at the 2B gate. Never act on the demo: open the printer panel, swipe to the bottom, More options → Change POS address → `http://localhost:3100`, and check that "POS Software" and the seeded menu (Masala Chai, Cheesecake…) show before any tap that writes.

**The harness** (as the gate ran it; check `netstat -ano | grep LISTEN` for 3110, 3200 and 9100–9102 first):
- the local POS from this branch's build: `cd /d/kd/lucifer/apps/cafe && node --env-file=<scratchpad>/e2e.env ../../node_modules/next/dist/bin/next start -p 3110` (a background command with `timeout: 7200000`); `e2e.env` is the 2A session's env file (database `pos_scratch_e2e_p1final`, e2eadmin, tables and menu seeded), copied as Session 2B did (Task B7 Step 4);
- the counting proxy in front of it: `gate-proxy-2b.mjs`, saved exactly as in Task B7 Step 4, run as `node <scratchpad>/gate-proxy-2b.mjs --listen 3200 --target 3110 --log <scratchpad>/proxy-2c.jsonl` (no drop), and `adb reverse tcp:3100 tcp:3200`, so the app's address stays `http://localhost:3100`;
- three fake printers: `node scripts/fake-escpos-printer.mjs --port 9100 --out <dir-counter>`, the same on `9101` (`<dir-kitchen>`) and `9102` (`<dir-bar>`); give each `--out` a long Windows path (`C:\Users\Kartik.desai\…`, never the `KARTIK~1.DES` short form);
- the app (`Pixel_7_API_33`, WebView 109, the release APK `29115bdf…`): its network printer `10.0.2.2` port `9100` (Use this network printer). **No print host** (the panel shows "Each device prints its own slips"): printers mode has none;
- `p2c-tool.ts` (below), from `apps/cafe`: `devices` lists the device rows: the app's is the newest (`35bd9663…` at the 2B and 2C gates); `setup <appDeviceId>` makes printers mode: stations Kitchen (default) and Bar, Beverages on the Bar; printer **Counter** (LAN `10.0.2.2:9100`, written by the app: bills ×2, the full copy, notices, End of day), **Kitchen** (LAN `127.0.0.1:9101`, written by `e2e-kitchen-agent`) and **Bar** (LAN `127.0.0.1:9102`, written by `e2e-bar-agent`); then two background scripted writers: `agent e2e-kitchen-agent Kitchen 9101` and `agent e2e-bar-agent Bar 9102` (each looks its printer up when it starts: restart them after every `setup`);
- then tap the top bar's **Refresh** on the app (close any open panel first): no realtime Worker runs locally, so this is how the app reads the new printers before the first order (the proxy shows `GET /api/printers`, the writer's first wake, one lease).

Save this tool in the scratchpad (the Write tool), exactly as below. It prints statuses, ids, names and job states; never a secret.

`<scratchpad>/p2c-tool.ts` (run from `apps/cafe`: `node --env-file=<scratchpad>/e2e.env --import tsx <scratchpad>/p2c-tool.ts <mode> [args]`):

```ts
// Session 2C emulator exit check (scratchpad only; never in the repo). It drives the local POS as the e2e admin (a
// session minted from the env file's AUTH_SECRET, never printed) and prints statuses, counts, ids, names and job
// states only: never a secret, a token or a payload. Run from apps/cafe:
//   node --env-file=<scratchpad>/e2e.env --import tsx <scratchpad>/p2c-tool.ts <mode> [args]
// modes: devices                 the print host and the device rows (opaque ids, not secrets)
//        setup <appDeviceId>      printers mode: stations Kitchen (default) and Bar, Beverages on the Bar; printers
//                                 Counter (LAN 10.0.2.2:9100, written by the app: bills x2, the full copy, notices,
//                                 End of day), Kitchen (LAN 127.0.0.1:9101, e2e-kitchen-agent), Bar (LAN
//                                 127.0.0.1:9102, e2e-bar-agent)
//        agent <deviceId> <printerName> <port>
//                                 a scripted writer: every 2 s it leases that printer's line (no poll budget is being
//                                 measured for it), writes a text slip (label, station line, items) to the fake
//                                 printer on <port>, and acks it. Runs until stopped.
//        assign <printerName> <deviceId> <host> <port>
//                                 that printer re-saved as a LAN printer written by <deviceId> (no realtime runs
//                                 locally, so the device's printer list does not hear of it)
//        teardown                 every printer removed, Beverages back to the default station: simple mode
//        jobs                     the newest jobs: kind, status, printer, target, labels, epoch, the log
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const mongoose = require("mongoose") as typeof import("mongoose");
const { encode } = require("next-auth/jwt") as typeof import("next-auth/jwt");

const BASE = process.env.P2C_BASE ?? "http://localhost:3110";
const COOKIE = "authjs.session-token";
type Db = NonNullable<typeof mongoose.connection.db>;
type Json = { data?: unknown; error?: string };

async function cookieFor(db: Db): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET missing from the env file");
  const staff = await db.collection("staffs").findOne({ username: "e2eadmin" }, { projection: { name: 1, role: 1 } });
  if (staff === null) throw new Error("e2eadmin not found");
  const token = await encode({ token: { name: staff.name, id: String(staff._id), role: staff.role, lastValidated: Date.now() }, secret, salt: COOKIE });
  return `${COOKIE}=${token}`;
}

async function call(cookie: string, method: string, url: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${BASE}${url}`, { method, headers: { "content-type": "application/json", cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Json };
  } catch {
    return { status: res.status, json: { error: `non-JSON answer (${text.length} chars)` } };
  }
}

type Printer = { id: string; name: string };
type LeasedJob = { id: string; epoch: number; label: string; copies?: number; payload: { kind: string; station?: { name: string; mode: string }; snapshot?: { items?: Array<{ name: string; qty: number }> } } };

function slipText(job: LeasedJob): string {
  const station = job.payload.station;
  const header = station === undefined ? "" : station.mode === "no-printer" ? `${station.name.toUpperCase()} (NO PRINTER SET)` : station.name.toUpperCase();
  const items = (job.payload.snapshot?.items ?? []).map((item) => `${item.qty} x ${item.name}`);
  return [`[${job.label}]`, header, ...items, "", ""].join("\n");
}

function writeTo(port: number, text: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      const bytes = Buffer.from(text, "utf8");
      socket.end(bytes, () => resolve(bytes.length));
    });
    socket.on("error", reject);
  });
}

async function agent(cookie: string, deviceId: string, printerName: string, port: number): Promise<void> {
  const list = await call(cookie, "GET", "/api/printers");
  const printer = ((list.json.data ?? []) as Printer[]).find((p) => p.name === printerName);
  if (printer === undefined) throw new Error(`no printer named ${printerName}`);
  console.log(`agent ${deviceId} writes ${printerName} (${printer.id.slice(-6)}) to 127.0.0.1:${port}`);
  for (;;) {
    const lease = await call(cookie, "POST", "/api/print-jobs/lease", { deviceId, tabId: `${deviceId}-tab`, printerIds: [printer.id] });
    const jobs = ((lease.json.data as { jobs?: LeasedJob[] } | undefined)?.jobs ?? []);
    for (const job of jobs) {
      let bytes = 0;
      for (let copy = 0; copy < (job.copies ?? 1); copy++) bytes += await writeTo(port, slipText(job));
      const ack = await call(cookie, "POST", `/api/print-jobs/${job.id}/ack`, { deviceId, epoch: job.epoch, outcome: "printed" });
      const station = job.payload.station === undefined ? "-" : job.payload.station.mode === "all" ? "ALL STATIONS" : job.payload.station.name.toUpperCase();
      console.log(JSON.stringify({ at: new Date().toISOString().slice(11, 19), job: job.id.slice(-6), label: job.label, station, bytes, ack: ack.status, more: (ack.json.data as { more?: boolean } | undefined)?.more }));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  const uri = process.env.MONGODB_URI ?? "";
  if (!/\/pos_scratch_e2e_[a-z0-9_]+$/.test(uri)) throw new Error("refusing: not a pos_scratch_e2e_* database");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 1));
  try {
    if (mode === "devices") {
      const host = await db.collection("printhosts").findOne({}, { projection: { deviceId: 1 } });
      const devices = await db.collection("printdevices").find({}).project({ deviceId: 1, lastSeenAt: 1 }).toArray();
      return out({ host: host?.deviceId ?? null, devices: devices.map((d) => [String(d.deviceId), d.lastSeenAt]) });
    }
    if (mode === "jobs") {
      const printers = new Map((await db.collection("printers").find({}).project({ name: 1 }).toArray()).map((p) => [String(p._id), String(p.name)]));
      const rows = await db.collection("printjobs").find({}, { projection: { payload: 0 } }).sort({ createdAt: -1, _id: -1 }).limit(10).toArray();
      return out(
        rows.map((j) => ({
          id: String(j._id).slice(-6),
          kind: j.kind,
          label: j.label,
          status: j.status,
          printer: typeof j.printerId === "string" ? (printers.get(j.printerId) ?? j.printerId) : null,
          copies: j.copies ?? 1,
          target: typeof j.targetDeviceId === "string" ? j.targetDeviceId.slice(0, 12) : null,
          labels: j.labels ?? [],
          epoch: j.epoch,
          log: (j.log ?? []).map((e: { event: string; detail?: string; at: Date }) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.event}${e.detail ? `(${e.detail})` : ""}`),
        })),
      );
    }
    const cookie = await cookieFor(db);
    if (mode === "setup") {
      const app = args[0] ?? "";
      if (app === "") throw new Error("setup <appDeviceId>");
      const stations = (await call(cookie, "GET", "/api/stations")).json.data as Array<{ id: string; name: string; isDefault: boolean }>;
      const kitchen = stations.find((s) => s.isDefault);
      const barMade = stations.find((s) => s.name === "Bar") ?? ((await call(cookie, "POST", "/api/stations", { name: "Bar" })).json.data as { id: string });
      const beverages = await db.collection("categories").findOne({ name: "Beverages" });
      if (beverages === null || kitchen === undefined) throw new Error("no Beverages category or no default station");
      const cat = await call(cookie, "PUT", `/api/categories/${String(beverages._id)}`, { name: beverages.name, stationId: barMade.id });
      const slips = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };
      const made = [
        await call(cookie, "POST", "/api/printers", { name: "Counter", connection: { kind: "lan", host: "10.0.2.2", port: 9100 }, primaryDeviceId: app, paper: 80, slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, copies: { kot: 1, bill: 2 }, enabled: true }),
        await call(cookie, "POST", "/api/printers", { name: "Kitchen", connection: { kind: "lan", host: "127.0.0.1", port: 9101 }, primaryDeviceId: "e2e-kitchen-agent", paper: 80, slips: { ...slips, kotStations: [kitchen.id], notices: true }, copies: { kot: 1, bill: 1 }, enabled: true }),
        await call(cookie, "POST", "/api/printers", { name: "Bar", connection: { kind: "lan", host: "127.0.0.1", port: 9102 }, primaryDeviceId: "e2e-bar-agent", paper: 80, slips: { ...slips, kotStations: [barMade.id], notices: true }, copies: { kot: 1, bill: 1 }, enabled: true }),
      ];
      return out({ category: cat.status, printers: made.map((r) => [r.status, (r.json.data as { name?: string } | undefined)?.name ?? r.json.error]) });
    }
    if (mode === "teardown") {
      const list = ((await call(cookie, "GET", "/api/printers")).json.data ?? []) as Printer[];
      const removed = [];
      for (const p of list) removed.push((await call(cookie, "DELETE", `/api/printers/${p.id}`)).status);
      const beverages = await db.collection("categories").findOne({ name: "Beverages" });
      const cat = beverages === null ? null : (await call(cookie, "PUT", `/api/categories/${String(beverages._id)}`, { name: beverages.name, stationId: null })).status;
      return out({ removed, category: cat, left: ((await call(cookie, "GET", "/api/printers")).json.data as unknown[]).length });
    }
    if (mode === "assign") {
      const [name, deviceId, hostName, port] = args;
      if (name === undefined || deviceId === undefined || hostName === undefined || port === undefined) throw new Error("assign <printerName> <deviceId> <host> <port>");
      const list = ((await call(cookie, "GET", "/api/printers")).json.data ?? []) as Array<Printer & { paper: number; slips: unknown; copies: unknown; enabled: boolean }>;
      const p = list.find((x) => x.name === name);
      if (p === undefined) throw new Error(`no printer named ${name}`);
      const res = await call(cookie, "PUT", `/api/printers/${p.id}`, { name: p.name, connection: { kind: "lan", host: hostName, port: Number(port) }, primaryDeviceId: deviceId, paper: p.paper, slips: p.slips, copies: p.copies, enabled: p.enabled });
      return out({ status: res.status, writer: deviceId.slice(0, 8) });
    }
    if (mode === "agent") {
      const [deviceId, name, port] = args;
      if (deviceId === undefined || name === undefined || port === undefined) throw new Error("agent <deviceId> <printerName> <port>");
      return await agent(cookie, deviceId, name, Number(port));
    }
    throw new Error("unknown mode (see the header)");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exitCode = 1;
});
```

Then, reading the proxy's log (`"m":"POST"` lines and `GET /api/printers`, leaving out `/api/print-host/beat` and the writer's own `POST /api/print-jobs/wake` polls, every 3 s for two minutes after a job, then 15 s), the fake printers' `jobs.log` (`bytes > 0`) and `p2c-tool jobs` after each item:
1. **Send to Kitchen** (one Cheesecake, a Kitchen item; one Masala Chai, a Beverage on the Bar; a walk-in): the app's requests are `POST /api/orders` (`"lease":true`) and one ack: **no lease**. The counter printer gets the full copy at once ("KITCHEN ORDER / ALL STATIONS", 48,198 B at the gate); the kitchen writer prints "KITCHEN" (69 B) and the bar writer "BAR" (62 B), once each, `more: false`. `jobs`: the full copy `created`, `leased(direct)`, `printed` (printer Counter, target the app); the Kitchen and Bar slips `created`, `leased`, `printed` (their writers).
2. **Pay Now** (the same two items, Cash, Place Order): `POST /api/orders`, the full copy's ack, **one** `POST /api/print-jobs/lease` (the bill, after the ack's `more`), the bill's ack, and no lease after it. The counter printer: the full copy (48,198 B), then the bill twice (copies 2 as one job: 2 × 40,854 B at the gate); the station slips once each at their writers.
3. **A printer's writer is off** (stop the bar writer by its task or PID), then Send to Kitchen (Cheesecake + Masala Chai): the order and the full copy's ack; the full copy and the kitchen slip print; the bar slip stays `queued`. After a minute the printer panel's waiting slips show it with its printer: "Waiting for the printer (1)", "KOT round 1 · ORD-… · Bar", "Bar". Start the bar writer again: it prints the slip once, unlabelled; its log `created`, `leased`, `printed`.
4. **A printer re-saved onto the app while its frame is missed** (the 2C review's I-2): stop the kitchen writer, run `assign Kitchen <appDeviceId> 10.0.2.2 9100` (Kitchen becomes a LAN printer at the app's own printer address, written by the app; no Refresh), then Send to Kitchen (one Cheesecake). The order and the full copy's ack; then, at the next wake or pulse (8.6 s at the gate), `GET /api/printers`, a lease or two (the first may leave before the new list arrives and come back empty), and the Kitchen slip's ack. The counter printer gets the full copy and the "KITCHEN" station slip (44,238 B each at the gate); `jobs`: the Kitchen job `created`, `leased`, `printed`, printer Kitchen, target the app.
5. **Every printer removed, no frame** (the gate's E-1): `teardown`, no Refresh. Within a minute (a list is read again at most once a minute: at the gate the item-4 read was 60.6 s old after the third wake) a wake is followed by `GET /api/printers` and one lease, then **no wake for over a minute** (the former writer stopped polling). Then Send to Kitchen (one Cheesecake): `POST /api/orders` (`"lease":true`) and its ack only; one slip (40,494 B); `jobs`: printer none, `leased(direct)`, `printed`: simple mode again.
6. `adb logcat -b crash -d` is empty for the app.
7. **Put back as found:** stop the scripted writers; on the local POS Remove the network printer ("No printer set up"); More options → Change POS address → `https://posdemo.sandbee.in` ("Olivea Pizza" loads; its printer panel, opened read-only, shows "No printer set up" and "Each device prints its own slips"); `adb reverse --remove-all` then `adb reverse tcp:3100 tcp:3100`; stop the POS, the proxy and the three fake printers by PID after checking each one's command line (`Get-CimInstance Win32_Process`); `adb emu kill` if this session booted the emulator.

Record every answer, the request counts per item and the fake printers' counts in Results.

- [ ] **Step 5: The fresh review**

A fresh reviewer subagent (the most capable model, read-only) reads `<start>..HEAD` against this plan (decisions 1–9, 15, 16; "2B review gate: rulings"; Session 2C and its Review Focus) and spec §6.6, §7.6, §7.11, §8, §8.1, §9.1, §9.3 and §17, and reports Critical / Important / Minor findings, each with a concrete failure scenario. Fix Critical and Important ones by TDD on the branch (each RED seen before its GREEN) and re-run Step 1; list the rest in Results for the 2C gate.

- [ ] **Step 6: Results, then push**

Add "## Session 2C Results (filled in by the implementer)" at the end of this plan: every number from Steps 1–5, the APK hashes, the emulator answers, each changed pin, any deviation with its reason. Commit it, and push the branch with the token only: `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-2`.

**Changed existing pins in 2C** (each follows a deliberate change; name them in Results):
- `apps/cafe/lib/print-order-jobs.test.ts` (C2): the pins that read `insertPrintJob` (today's keys, one write point, the lifecycle init, a new and a found ref) read `lib/print-job-insert.ts`, where it moved, and match its `failed` and `line` additions (a failed or routed job, the found job's `printerId`).
- `apps/cafe/lib/print-lease.test.ts` (C2, C3): "printJobLineFilter" leaves printer jobs out (`printerId: { $exists: false }`); "printJobsForMeFilter" counts every line job aimed at the device (the 2C review's I-2).
- `apps/cafe/lib/self-order-alert-paths.test.ts` (C2): the job write points name `lib/print-job-insert.ts` instead of `lib/print-order-jobs.ts`.
- `apps/cafe/lib/print-lifecycle-paths.test.ts` (C3, C4): the lease CAS is fenced on its line and claims the job for its writer (`applyPrintJobPlan(head._id, job, claimed, fence)`); the no-host lease's backoff answer is the line's (`return { job: null, retryAt: … }`); the ack's `more` asks the acked job's own line; a staff action's CAS writes its `patch` (the printer's current writer, I-3).
- `apps/cafe/lib/print-attention.test.ts` (C4): a staff action reads `targetDeviceId printerId`, and its queued print-status is aimed at the job's (new) target.
- `apps/cafe/lib/print-host-paths.test.ts` PIN (D) (C6): `isAgent` adds `printers.printersMode`, and the agent gets `printers`.
- `apps/cafe/lib/print-wake.test.ts` (C6): "only the host agent polls the wake" becomes "the agent polls the wake by printAgentPollsWake"; the wake's body is `wakeBody(deviceId)`.
- `apps/cafe/package.json` `testChain` (C2, C6): `lib/print-printer-jobs.test.ts`, then `lib/print-agent-printers.test.ts`, appended.

---

## Session 2C Results (filled in by the implementer)

Executed on 2026-10-04 with superpowers:executing-plans, task by task, C0 → C10.

### Commits (`0ce5def..HEAD`)

| Commit | Task |
|---|---|
| `8644f06` | C0: the 2B review gate's fixes (I-A re-delivery bound, M-A, M-B) |
| `69c91ce` | C1: the shared contract: the ready and bill-printer headers, a job's printer and copies on the wire, a slip made failed at creation, `printerIdsOf` |
| `189ca40` | C2: creation routed per printer line, one job per line with its copies; failed at creation; direct print per printer line |
| `cc2428c` | C3: a lease per printer line, only by its writer, claimed for it; `more` per line; jobs-for-me counts every job aimed at the device |
| `61f2c87` | C4: the sweep, the repair and a staff retry in printers mode |
| `70e6a96` | C5: the writers' wake allowance, M9, M7, the `print-setup` kind (Worker change) |
| `7216ed8` | C6: the page in printers mode: every device an agent, ready printers named, several jobs one by one, a stale list read again, the wake by every writer |
| `4cb1c6f` | C7: only on its own printer, every copy in one lease; the station line; the panel names the printer |
| `70a28d1` | C8: the budget recount |
| `41bf76d` | C9: live legs an–aq |
| `88946dc` | Final review I-1 and I-2 (beyond the plan): a device printer is this device's printer by the id the app reports; only jobs an agent can lease kick it |
| (this commit) | Results; spec §8.1 "Changed by Session 2C's final review" |

### Start

- `git branch --show-current`: `feat/printing-phase-2`; HEAD `0ce5def` (= origin); working tree clean.
- `GIT_TERMINAL_PROMPT=0 git fetch origin` (token credential): `origin/main` still `6ee2b1d`: nothing to note or merge.
- Before C0, the whole C0–C9 range (plan lines 7882–14908) was dry-run with the gate's applier against `0ce5def`: **191 ops OK** (as the gate saw).

### How the code was applied

Every block was applied verbatim to the real repo by the gate's applier (`apply_blocks_clone.py`, copied to this session's scratchpad), one step range at a time, so each RED was seen before its code went in. After C9, **every file outside `docs/` is blob-identical to the gate's golden branch `g2c-v3`** (`git ls-tree -r` of both, `docs/` left out: 1,727 entries, no difference; the root trees differ only by `0ce5def`'s plan and spec: `67b5468…` here, `d38dc5d…` the gold). C0–C9: 70 files, **+1,922 / −233**, as the gate counted.

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED | GREEN |
|---|---|---|
| C0 | `print-direct` + `print-agent`: tests 45, pass 42, **fail 3** | 3 files **52/52**; cafe and shared tsc 0; `LINT_OK` |
| C1 | `print-printers` + `print-lifecycle` + `print-job`: tests 32, pass 30, **fail 2** | **69/69**; shared and cafe tsc 0 |
| C2 | 4 files: tests 34, pass 27, **fail 7** | 6 files **62/62**; tsc 0; `LINT_OK` |
| C3 | `print-lease` + `print-lifecycle-paths`: tests 26, pass 20, **fail 6** | 4 files **50/50**; tsc 0 ×2; `LINT_OK` |
| C4 | 4 files: tests 53, pass 47, **fail 6** | **53/53**; tsc 0; `LINT_OK` |
| C5 | `print-printer-routing` + `print-setup-paths`: tests 30, pass 26, **fail 4**; shared `print-printers`: tests 1, pass 0, **fail 1** | 4 files **100/100**; shared 2 files **39/39**; tsc 0 ×2; `LINT_OK` |
| C6 | 6 files: tests 109, pass 103, **fail 6** | **113/113**; tsc 0 ×2; `LINT_OK` |
| C7 | 4 files: tests 50, pass 45, **fail 5** | 5 files **57/57**; tsc 0; `LINT_OK` |
| C8 | `print-budget`: tests 1, pass 0, **fail 1** | **29/29**; `print-agent-printers` **7/7**; tsc 0 ×2; `LINT_OK` |
| C9 | (legs: apply and run) | tsc 0, `LINT_OK`; `verify:print:live` **`302 passed, 0 failed`** |
| I-1 fix | `print-agent-printers.test.ts` "printerIsLocal…" with the app's real ids **fails** ("the paired printer by its address": false !== true) | 7 files **125/125**; tsc 0 ×2; `LINT_OK` |
| I-2 fix | "jobsForMeLeasable…" (not a function), "PIN (2C final review, I-2)…", `print-agent.test.ts` "2C: a wake whose jobs the agent cannot lease…" (**1 !== 0**: it kicked), `print-lease.test.ts` "jobsForMeOf…" (not a function) **fail** | (same run) |

Line counts at the end: new `print-job-insert.ts` 105, `print-printer-jobs.ts` 146, `print-agent-printers.ts` 104 (86 before the fix), `use-agent-printers.ts` 46, legs `printers-mode.ts` 236; `print-order-jobs.ts` 242, `print-lease.ts` 295 (288 before the fix), `print-sweep.ts` 189, `print-direct.ts` 88, `use-print-agent.ts` 288; `print-agent.ts` 322 (a client lib, over the ~300 budget as the gold has it).

### Task C10 Step 1: every suite (at `41bf76d`)

| Suite | Result |
|---|---|
| shared `npm test`; `tsc` | **679/679**; 0 |
| cafe `npm test` | **4350 tests, 4349 pass, 0 fail, 1 skipped** (the `go-live-dl` pin) |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings (`lib/masters-blob.test.ts:331`) |
| Hub `tsc` | 0 |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; **117/117**; Jest **3/3** (untouched) |
| desktop `npm test` | **191/191** (untouched) |
| `npm run test:print-tools` | **8/8** |
| live legs (local mongod, `pos_scratch_print_host`) | **`302 passed, 0 failed`** (272 + 30) |

Every row equals the plan's Expected.

**After the fix (`88946dc`), Step 1 again:** shared **679/679**, tsc 0; cafe **4354 tests, 4353 pass, 0 fail, 1 skipped** (+4: the fix's tests); cafe tsc 0, lint 0 errors and the 2 old warnings; Hub 0; mobile **117/117** and Jest **3/3**; desktop **191/191**; print tools **8/8**; live legs **`302 passed, 0 failed`**.

### Changed existing pins (each follows a deliberate change)

The eight the plan names (C2, C3, C4, C6): `print-order-jobs.test.ts` (the `insertPrintJob` pins read `lib/print-job-insert.ts`); `print-lease.test.ts` ("printJobLineFilter", "printJobsForMeFilter"); `self-order-alert-paths.test.ts` (the job write points); `print-lifecycle-paths.test.ts` (the lease CAS fenced on its line, the line's backoff answer, `more` per line, a staff action's `patch`); `print-attention.test.ts` (the action reads `targetDeviceId printerId`); `print-host-paths.test.ts` PIN (D) (`isAgent` adds `printers.printersMode`); `print-wake.test.ts` (the wake by `printAgentPollsWake`, `wakeBody(deviceId)`); `apps/cafe/package.json` `testChain` (+ `lib/print-printer-jobs.test.ts`, `lib/print-agent-printers.test.ts`). Beyond the plan, for the I-1 fix: `print-agent-printers.test.ts`'s fixture `NATIVE_BT` is now the id the app reports (`bt-classic:00:11:22:33:44:55`, was `00:11:22:33:44:55`, an id the app never produces); the pin's intent ("the paired printer by its address") is kept.

### Step 2: the Next production build

Success, **127 routes** (2C adds none), at `41bf76d` and again at `88946dc`.

### Step 3: APKs (no mobile change: byte-identical to the release), and the Worker

`git diff 0ce5def..HEAD --stat -- apps/mobile apps/desktop` printed nothing. Built with `GRADLE_USER_HOME='D:\gradle-home'` (BUILD SUCCESSFUL 1m 29s and 46s): x86_64 **`29115bdf…`**, arm64-v8a **`0e0ec314…`**, armeabi-v7a **`e618900a…`**: byte-identical to `D:\kd\pos-apk-release\Sandbee-POS-final\`. The fix (`88946dc`) is web-only.

**The Worker:** `workers/realtime/src/index.ts` gains the `print-setup` kind (C5). Nothing was deployed. **The go-live run must deploy the Worker before the web** (an older Worker refuses the unknown kind, which costs only the frame: devices still read their printers on mount, on focus, and when a pulse or a wake shows their list stale), then reload every POS screen (a tab older than 2C never leases a printer job until it reloads).

### Step 4: the emulator exit check. Passed.

`Pixel_7_API_33` (own boot at `-memory 4096 -no-audio -no-snapshot-save`, C: 11 GB free, booted in ~25 s), WebView 109; the installed APK hashed on the device: the release `29115bdf…`; crash buffer empty at boot. **The app opened on the owner's live demo "Olivea Pizza"** (signed in; its printer panel: "No printer set up", "Each device prints its own slips"); nothing was tapped there except the printer panel's More options → Change POS address → `http://localhost:3100`, and "POS Software" with the seeded menu (Pizza, Pasta, Beverages, Desserts; Masala Chai, Cheesecake) showed before any write. The harness as the plan says: this branch's build on 3110 (env: the gate's `e2e.env`, database `pos_scratch_e2e_p1final`; no print host), the plan's counting proxy on 3200 (`adb reverse tcp:3100 tcp:3200`), three fake printers on 9100 (counter), 9101 (kitchen), 9102 (bar), each with a long `--out` path (nothing vanished); the app's network printer `10.0.2.2:9100` ("Network printer 10.0.2.2 is connected."). `gate-proxy-2b.mjs` and `p2c-tool.ts` were extracted from the plan's fences (B7 Step 4, C10 Step 4) into the scratchpad, byte-identical to the gate's copies. The app's device is `35bd9663…` (the newest row, seen at the start). `setup 35bd9663…`: category 200, printers Counter/Kitchen/Bar 201; the writers `agent e2e-kitchen-agent Kitchen 9101` and `agent e2e-bar-agent Bar 9102`; then the app's Refresh: `GET /api/printers`, the writer's first wake, one lease.

Requests are the app's, from the proxy, less the beats and its own wake polls (no Worker runs locally: every 3 s for 2 min after a job it can lease, then 15 s). Paper is each fake printer's `jobs.log` with bytes > 0.

| # | Item | Requests | Paper | Jobs |
|---|---|---|---|---|
| 1 | Send to Kitchen (Cheesecake, Masala Chai; walk-in; `ORD-20261004-038`) | `POST /api/orders` (`lease:true`) 201, its ack 0.87 s later; **no lease** | counter: full copy ("All stations") **48,198 B**; kitchen **69 B**; bar **62 B**; each writer `more:false` | full copy Counter, target the app: `created`, `leased(direct)`, `printed`; Kitchen and Bar `created`, `leased`, `printed` at their writers; epoch 1, no labels |
| 2 | Pay Now (the same two, Cash, Place Order; `-039`) | order; the full copy's ack +0.77 s; **one** `POST /api/print-jobs/lease` +0.78 s (the bill, after `more`); the bill's ack +2.0 s; nothing after in 20 s | counter: full copy 48,198 B, then the bill **2 × 40,854 B**; kitchen 69 B; bar 62 B | bill: Counter, **copies 2** (one job), `created`, `leased`, `printed` |
| 3 | Bar writer stopped (by PID), Send to Kitchen (the same two; `-040`) | order, ack +0.78 s; no lease from the app while the bar slip waited (6 wakes, 5 pulses in 95 s) | full copy 48,198 B; kitchen 69 B; the bar slip `queued`. 67 s after the order the panel: "Slips waiting", "Waiting for the printer (1)", "KOT round 1 · ORD-20261004-040 · Bar", "1 min · Not printed yet. · Bar", Print now / Clear. The bar writer restarted: it printed it **once**, 62 B, `more:false` | Bar: `created`, `leased`, `printed`, unlabelled, epoch 1 |
| 4 | Kitchen writer stopped; `assign Kitchen 35bd9663… 10.0.2.2 9100` (200); no Refresh; Send to Kitchen (Cheesecake; `-041`) | order, ack +0.79 s; **+2.59 s** `GET /api/printers` and a lease, a second lease +2.67 s; the Kitchen slip's ack +3.35 s | counter: the full copy and the KITCHEN slip, **44,238 B each** | Kitchen: printer Kitchen, target the app, `created`, `leased`, `printed` |
| 5 | `teardown` (removed 200 × 3, category 200, left 0) at 08:00:35, no Refresh; then Send to Kitchen (Cheesecake; `-042`) | 08:00:36.165 a wake, 08:00:36.177 `GET /api/printers`, 08:00:36.241 one lease; then **no wake for 2 min 37 s** (to the order). The KOT: `POST /api/orders` (`lease:true`) and its ack +0.73 s only; 0 wakes after | one slip, **40,494 B** | printer none, `created`, `leased(direct)`, `printed`: simple mode again |
| 6 | `adb logcat -b crash -d` | **0 lines** (at boot, after item 5, and at the end) | | |
| 7 | Put back as found | after the fix smoke below: the bar writer stopped; `teardown`; on the local POS the app's printer removed ("Remove Network printer 10.0.2.2 from this device?" → Yes, remove → "No printer set up", "Each device prints its own slips."); More options → Change POS address → `https://posdemo.sandbee.in` ("Olivea Pizza" loads; its panel, opened read-only: "No printer set up", "Each device prints its own slips.", closed with its X); `adb reverse --remove-all`, then `adb reverse tcp:3100 tcp:3100`; the POS, the proxy and the three fake printers stopped by PID after checking each command line; `adb emu kill` | | |

In item 5 the item-4 list read was 109 s old, so the once-a-minute bound did not delay the re-read.

**The fix smoke (the build of `88946dc`, 127 routes; the same harness; the app Refreshed onto it: `GET /api/printers`, a wake, a lease).** `setup` again, then `assign Kitchen 35bd9663… 10.0.2.2 9101`: the app now writes Counter (its own printer) and Kitchen (not its printer: the I-2 case). Send to Kitchen (Cheesecake, Masala Chai; `-043`) at 08:11:21: order (`lease:true`) and its ack +0.81 s; the counter's full copy 48,198 B (`leased(direct)`), the bar slip 62 B at its writer; the Kitchen job stays `queued`, aimed at the app, and the panel shows it ("KOT round 1 · ORD-20261004-043 · Kitchen", "2 min · Not printed yet. · Kitchen"). In the next 2 min 29 s: **0 lease calls**, wakes every 15 s (10), pulses every 20 s, `GET /api/printers` once a minute (08:11:30, 08:12:30, 08:13:30). Before the fix each pulse and each wake (then every 3 s) kicked an empty lease. I-1 (Bluetooth, BLE, USB ids) cannot be exercised on the emulator (its printer is LAN only); its unit test covers it.

Fake printer totals (bytes > 0): counter 9 slips (plus the 0-byte connect probe of "Use this network printer"), kitchen 3, bar 4.

### Step 5: the fresh review

Claude Fable 5.1 (as at every Phase 2 session and gate: the most capable widely released model), read-only, on `0ce5def..41bf76d` against the plan (decisions 1–9, 15, 16; "2B review gate: rulings"; Session 2C and its Review Focus, passed verbatim) and spec §6.6, §7.6, §7.11, §8, §8.1, §9.1, §9.3, §17. It read the whole review package in four passes, re-ran the five touched cafe test files (65/65) and proved I-1 with a scratchpad test outside the repo. Verdict "with fixes": no path to two papers or a silently lost slip; one writer per printer enforced server-side; simple mode preserved but for the reads noted; every new wire field optional; every printer id through `printerIdsOf`; setup writes admin-only.

| # | Finding | Outcome |
|---|---|---|
| **I-1** (Important) | `printerIsLocal` compared the app's printer id with the bare `address` for `bt-classic`, `ble` and `usb`, but the app reports `"<transport>:<id>"` (Kotlin `PrinterIds`: `bt-classic:<MAC>`, `ble:<MAC>`, `usb:%04x:%04x`, stored verbatim by `nativeRecordOf`). Once 2D lets staff save a Bluetooth printer, its slips would be routed to the phone and wait forever (masked by a test fixture holding an id the app never produces) | **Fixed (`88946dc`)**: either form matches (`<transport>:<address>`, or an address that holds the app's whole id); the fixtures use the real ids, plus BLE and USB cases; the shared contract's comment says which form the app reports. RED → GREEN |
| **I-2** (Important) | Jobs-for-me counts every job aimed at the device (I-2 of the gate), including jobs on a printer it writes but does not print on (a second printer before 2E, which the API allows and leg (ao) builds; a printer whose address is not its own). The pulse and the wake kicked a lease on each, which named only its local printers and came back empty, and the wake kept its 3 s cadence: up to 20 wakes + 20 leases a minute with the socket down, for the whole service | **Fixed (`88946dc`)**: `jobsForMeLeasable`: the pulse and the wake kick, and the wake keeps its fast cadence, only for the device's own line's jobs or a printer it prints here; the answer gains an optional `ownLine` beside printer jobs (absent in simple mode, whose answer is unchanged), so an own-line job counted beside a foreign printer's still kicks. A printer it does not know yet is still read again at most once a minute, and the new list nudges the agent. RED → GREEN (agent, printers, lease tests); proven on the emulator (above) |
| M-3 | The wake reads `listPrinters()` on every poll: simple mode's host pays one more small Mongo read per wake (≤ ~14,400 a day on M0, ~0.3 ops/s at the 3 s cadence; no invocation added) | For the 2C gate (accept and pin, or skip) |
| M-4 | A replay or re-send after an admin changed the setup inside one request's retry window routes to another printer: its routed key differs, and both jobs print (inherent to decision 3; the repair is immune) | For the 2C gate (a sentence in §8.1) |
| M-5 | `not-routed` (a notice where Notices is off everywhere) is silent on the client | For the 2C gate / 2D (a toast) |
| M-6 | A non-host device made the very first printer's writer while its frame is missed (simple mode with a host before) learns it only on focus (≤ 30 min): it is not an agent, so it never names itself on the pulse; its slips wait visibly | For the 2C gate |
| M-7 | Stale comment `apps/cafe/lib/realtime-publish.ts:57` ("every 5 min"; `PRINT_SETUP_STALE_MS` is 30 min) | For the 2C gate |
| M-8 | Test fixture realism | Done inside the I-1 fix |

The reviewer's "declined to judge" list (12 items: two Windows printers on one PC (2E), notices off everywhere (2D), the client-supplied device id (Phase 1's trust model), a held direct job's lease left, the readback chip's first job, the host's broadcast kicks, the non-atomic free-line check, the name pre-check race, a reprint POST with no key, the per-instance sweep throttle, a pre-2C tab left open in printers mode (the go-live run reloads every screen), a former host's stale row) was ruled item by item in the ledger: each stands as built or as an earlier gate ruled. Its recommendation that 2D refuse or warn on a second printer for one writer until 2E is passed to the gate. One more observation while fixing I-2: a queued `print-status` frame aimed at a writer for a printer it does not print on still kicks one empty lease per slip (one per event, bounded; the frame names no printer): for the gate.

### Deviations and rulings

- **Beyond the plan:** the fix commit `88946dc` (I-1, I-2), its tests and one changed fixture; the optional `ownLine` on `PrintJobsForMe`; spec §8.1 gained "Changed by Session 2C's final review".
- **The fresh review ran in parallel with Steps 2–4** (it is read-only and reads only the code, told not to touch the database or the ports); the fix was then smoke-checked on the emulator with its own build before the put-back.
- The skill's `task-start` extracts only numeric "Task N" headings, so each C-task's brief was read from the plan by line range (ledgered; no plan text changed).
- Every decision is in the ledger (`.superpowers/sdd/2026-10-03-phase-2-routing/progress.md`, git-ignored, kept for the gate).

### Open for the 2C gate

M-3 to M-7 and the `print-status` observation above; the reviewer's recommendation for 2D (one printer per writer until 2E); re-check I-1, I-2 and the §8.1 amendment. Carried: M-2 (2E), M-4 / M-5 (noted), M-7 of the 2B gate (2D). The go-live run deploys the Worker first (the `print-setup` kind).

### Pushed

With the token only: `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-2`. `origin/main` was still `6ee2b1d` at the end (no merge). `main` untouched; nothing deployed.
