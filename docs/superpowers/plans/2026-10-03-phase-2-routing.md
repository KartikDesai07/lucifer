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
15. **Direct print on the asking device** (the owner, 2026-10-04: "if the host itself makes the order, print there directly"). When the device that makes a request is the one that prints a slip (simple mode: the host's own order, or any device's own slip with no host; printers mode: the writer of the slip's printer), the server makes that slip's job already leased to the asking tab, in the same write, and the request's answer carries the leased job: the tab prints at once and acks. No lease request, no realtime message, no poll: one request per slip (its ack) instead of two, and one database write fewer. It applies only when the tab says it can print now (it drains this device's slips and its printer is ready: header `x-pos-print-lease: <tabId>`, in printers mode with its ready printers) and the slip is the head of its line (§7.6), and only to the first slip of each line in one request (a Pay Now's bill follows its KOT through the ack's `more`). Every other slip is made `queued` exactly as today. Failures stay inside Phase 1's rules: a tab that dies before printing lets the lease expire in 90 s (KOT: REPRINT; bill: the cashier's question); an answer that never arrived is delivered again to the same tab when the client re-sends the slip (the enqueue finds the job leased to that tab), and the agent ignores a job it already holds (at-least-once delivery, an idempotent consumer).
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
