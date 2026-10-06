# Printing Phase 3: hardening (failover, health, Android and Windows hardening, alerts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Printing keeps working when a device or a printer fails: another device takes a network printer over, a device printer's slips move to its backup, every device shows paper out, cover open and a device that went offline, the Android app restarts its printing service by itself and says so after a reboot, the Windows app prints network printers itself, and the owner can get Telegram alerts. No new paid service, no Cron, and no new recurring request.

**Architecture:** The server decides who writes each printer *now* from the heartbeat that already rides the writers' wake poll (`PrintDevice.lastSeenAt`, 90 s). A network printer's primary keeps it while online. Otherwise the first online device that can write network printers (`capabilities.lanFailover`) takes it, by device id. A writer that cannot reach the printer is skipped for 5 minutes. A printer whose device is offline sends its untried slips to its backup printer, labelled BACKUP PRINTER, on the existing sweep. Printer health (link, paper, cover, error) rides the same wake and is written only when it changes. Every device sees a printer's problem beside the slips that wait for it, through the existing 20 s pulse's waiting-slips feed. The apps add DLE EOT status, a sticky foreground service, a boot notice and (Windows) raw TCP. Everything is session by session, as in Phase 2: **3A** is the dormant server core (exact code, below); **3B–3G** are specs, each made exact at the review gate before it.

**Tech Stack:** Next.js 15 (apps/cafe API routes + React page), Mongoose 8 on Atlas M0, `@pos/shared` (pure TypeScript), React Native + Kotlin (apps/mobile, JUnit 4), Electron (apps/desktop), node:test + tsx, the live-Mongo legs (`npm run verify:print:live`), the fake ESC/POS printer (`scripts/fake-escpos-printer.mjs`), the Pixel_7_API_33 emulator (WebView 109).

**Spec:** `docs/superpowers/specs/2026-10-02-printing-reliability-design.md`: §9.3 (who may lease which job), §9.4 (failover), §9.5 (Android hardening), §9.6 (Windows hardening), §10 (health, status and alerts), §13 (testing), §14 (the Phase 3 row), §17 (the free-tier budget). Read it beside this plan; the plan argues from it.

## Global Constraints

- Branch `feat/printing-phase-3` only. Never merge into `main`, never push `main`, never deploy (the owner's go-live run deploys, in the runbook's order).
- Push only with `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-3`, which uses the repo-local token store. Never the main account, never print the token.
- Free tier, ₹0, on each cafe's own free accounts (Vercel Hobby, Atlas M0, Cloudflare free): no paid service, **no Vercel Cron**, no new recurring request. New server work rides an existing request (the wake, the pulse, the lease, the ack, the order). `packages/shared/src/print-budget.test.ts` pins every figure (spec §17.3 item 4); never loosen a pin without the owner's ruling.
- Spec §17.3 item 5's measured limits on the busy day: printing ≤ **20 %** of Vercel invocations and ≤ **15 %** of Active CPU, Atlas under **10 ops/s** at peak. Since the owner's token ruling (2026-10-06, option A), Phase 3's exit measures both modes **with tokens on** against these limits. A token cafe's *pinned* heavy day (6,642 a day) would be about 20 % of Active CPU at Session 2G's measured 14.6 ms a request, which is over 15 %. That estimate counts every slip at its own lease and ack (2G's measured printers-mode day was 8.9 %), so the measurement, not the pin, is the gate.
- No connectors and no uploads of repo content anywhere (Artifacts, Docs, anything). Reports go in chat (Hinglish) or English repo docs on this branch.
- No temp files in the repo: the session scratchpad only, never `/tmp`. Don't delete files you didn't create. Write any script containing backslashes with the Write tool, never a heredoc.
- Before any write on the emulator, check which POS the app shows: it may be signed in to the live demo `https://posdemo.sandbee.in` (read-only; never sign in, order or change settings there). Never kill another session's servers (serve on 3110 and `adb reverse tcp:3100 tcp:3110`, then put it back).
- Run `df -h /d /c` before every build and before starting the emulator: a Next build needs ~1.5 GB free on D:, and the emulator needs ~4 GB free on C: at `-memory 4096` (2048 below that; record it). Run `adb shell sync` before `adb emu kill`.
- Old and new mix in the field until every screen is reloaded: a page from before Phase 3 (no `lanFailover`, no `tokenSlips` on the ack, pulse or wake, no `printers` in its beat) must print exactly as today. The release APK (bridge v1), the Phase 2 APK (bridge v2, `b10feedb…`/`86b7ff13…`) and the Windows app 1.11.0 (`348aebe1…`) keep working against every Phase 3 server.
- Copy rule: staff-facing words are plain, with no jargon. The words every device shows for a printer's problem are `printerProblemText` (`@pos/shared/print-failover`), one source.

## Review Focus

The five inputs most likely to bite a cafe that no task's tests alone exercise; each has its test in the task that owns the code.
1. **Deploy skew.** A page from before Phase 3 on a Phase 3 server (no `lanFailover`, says nothing about tokens on the ack, pulse or wake, sends no health) prints exactly as today: it is never chosen to take a printer over, never reports health, and a page from before print-customization S7 no longer pays an empty lease per pulse for a token it cannot print. → Task A0 (leg az: "a page from before S7…", "the lib's default still counts every kind"), Task A2 (leg ba: "a page from before Phase 3 never takes a printer over").
2. **The primary comes back mid-failover.** One lease per printer line means the returning primary and the device that took over can never write the same printer at once. A slip the second device is printing stays its own until its ack; waiting slips go home on the next sweep. → Task A2 (leg ba: "the tablet back online: the kitchen's waiting slip goes home", "and the counter no longer leases it").
3. **A writer whose heartbeat is late.** A WebView whose timers were throttled can look offline for a moment. Failover is harmless (the same network printer, one lease per line), and a backup move takes only slips that never reached paper. → Task A3 (leg bb: "a slip that may already have printed stays…"), Task A1 (`printerActiveWriter`: deterministic pick, primary preferred).
4. **Health that is not the writer's.** A report from a device that no longer writes the printer, or one older than 10 minutes, never paints a problem; a device printer whose device is offline always says so. → Task A1 (`printerProblemOf` tests), Task A4 (leg bc: "a device that no longer writes a printer cannot report for it").
5. **A dead network printer nobody can reach.** Each writer is skipped for 5 minutes in turn, then the slip waits for its primary, visibly, at a bounded cost (at most a lease and an ack per writer per 5 minutes). → Task A2 (leg ba: "the counter cannot reach it either…"; the budget pin "Phase 3 failover…").

---

## Step 0: the owner's answers (2026-10-06, the Phase 3 planning session)

**(a) The client's real printers** (`apps/mobile/TEST-CHECKLIST.md` "Stations and printers checks", and Part C on the Windows app 1.11.0): **not checked yet**. The plan is written now (a plan ships nothing). When the owner runs them, any real-printer failure is fixed first, on its own hotfix branch from `main`, before Session 3A starts (or, if 3A has started, before its review gate).

**(b) The two OPEN budget days** (printers mode with a token per order; pinned OPEN since S7 and not moved by the token fix). The planning session put them next to the real limits:

| Day | Requests a day | Share of the free 33,333 invocations a day | Active CPU at 10 ms / at 2G's measured 14.6 ms a request |
|---|---|---|---|
| The 2C counter day, with every printer-list read | 6,192 | 18.6 % | 12.9 % / 18.8 % |
| The heavy setup, normal day, with reads | 6,642 | 19.9 % | 13.8 % / 20.2 % |
| The heavy setup, worst case (socket down all day), with reads | 18,480 | 55.4 % | 38.5 % / 56 % |

The pins count every slip at its own lease and ack. Session 2G measured 1.63 requests a job in printers mode, and P4's measured busy day was 2,940 requests (8.9 % CPU) against the pinned 5,790. The options were: A, accept and measure; B, a capability header that makes a token direct again (code reading showed it moves neither day: on the counter day the token waits behind the full copy, and on the heavy day another device prints it); C, the slips one request puts on one printer line ride one lease or one direct answer (the counter day drops to 5,892 with reads, the heavy day stays over at 6,342); D, shrink the writers' wake cap on a token cafe (fixes the worst case only).

**Ruling: option A (accept and measure).** Recorded in commit `aae162c`. Spec §17.2 ("Token slips in printers mode") and §17.3 item 4 hold the ruling. The pins: `PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY` (6,700) and `PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY` (18,500) hold a token cafe, each day is pinned exactly, and a cafe without tokens is still held to 6,000 / 18,000. Session 3G measures a token cafe in both modes. If the measured busy day goes over §17.3 item 5's limits, option C becomes a Phase 3 task before release.

## Baseline

At `7f8ed31` (re-verified on main 2026-10-06), then the ruling commit `aae162c` on this branch:
- shared 804/804 (803 + the ruling's pin);
- cafe 4981 / 4980 pass / 0 fail / 1 skipped (go-live-dl);
- tsc 0 and lint 0 errors (+2 old warnings in `lib/masters-blob.test.ts`) for cafe, hub, mobile and desktop;
- mobile 125 + Jest 3; desktop 192; `npm run test:print-tools` 8;
- live legs 362/0; Next build 132 routes;
- JUnit 21 (`:app:testDebugUnitTest --rerun`, `GRADLE_USER_HOME=D:\gradle-home`; `apps/mobile` unchanged since the Phase 2 final gate).

Client builds unchanged since Phase 2: APK arm64 `b10feedb…`, armv7 `86b7ff13…` (x86_64 `3736540b…` for the emulator), `POS-Software-Setup-1.11.0.exe` `348aebe1…`.

## Phase 3 decisions (the planning session, 2026-10-06)

Each decision says what it costs if wrong.

**P3-1. Who writes a printer now** (spec §9.3; `printerActiveWriter` in `@pos/shared/print-failover`).
- A device printer is always its own device's.
- A network printer is its primary's while the primary is online (a heartbeat within 90 s) and has not failed to reach it in the last 5 minutes.
- Otherwise it goes to the first online device, by device id, that says `capabilities.lanFailover` (the POS app on bridge v2 from Session 3B; the Windows app from 1.12.0, Session 3E) and has not failed to reach it. With none, it stays the primary's: its slips wait for it, visibly.
- The pick is by id, so every server instance and every request agrees. The primary is preferred the moment it is back.
- *Cost if wrong:* a printer moves between writers. That is harmless for a network printer (the same paper comes out of the same printer, and one lease per line means one writer at a time). Each move costs one write and one realtime request (P3-4).

**P3-2. Who can take a printer over.** "Online" is the heartbeat on the wake. In printers mode only the setup's writers poll the wake (Phase 2), so the devices that can take a network printer over are the cafe's writer devices that say `lanFailover`. A waiter phone that writes nothing never takes one over, and never starts polling to become able to. No new recurring request. *Cost if wrong:* a cafe with only one writer device has no failover. Its slips wait, visibly, as in Phase 2. The setup page says so (3B).

**P3-3. The 5-minute skip** (spec §9.3). The page acks a refusal made before any byte with `reason: "unreachable"`; on Android TCP that is NOT_CONNECTED from a failed connect. That writer is then skipped for that network printer for 5 minutes. The waiting slips move at once to the device that takes it over, and that device is told of the head (one realtime request). Only the printer's writer *now* can be skipped: a late ack from another device changes nothing. When every candidate is skipped, the primary keeps the printer. *Cost if wrong:* a writer that could reach the printer sits out 5 minutes while another prints, which is harmless. Each move that changes a printer's writer (on a skip, or on the sweep) tells the new writer of the line's head: one Worker request, at most once a minute per printer per instance, and at most 144 a day per skipped writer (the planning review, M-7: within the Worker's 5 % pin). After a skip, the head's `nextAttemptAt` is its 2 s refusal backoff, so the new writer's first lease can come back "not due" and it leases again 2 s later (one extra lease per skip).

**P3-4. Failover timing (the exit's "within 90 s").** The primary is seen offline 30–90 s after it stops: it beats every 60 s on a healthy socket, and the online window is 90 s. From that moment every new slip is made for the second device: job creation reads who is online, one small read beside the stations, only when a network printer is set up. The second device prints it at once, by direct print or its `print-status`. A slip that already waited for the primary moves on the next sweep (at most 60 s later), and its new writer is told of it. A slip the primary was printing expires with its 90 s lease into one labelled REPRINT (Phase 1). Exit item 1 is therefore measured as: **every slip made 90 s or more after the primary stops prints on the second device; one already waiting prints within 60 s more.** Detecting a dead device faster would need a faster heartbeat, which means new requests, so it was rejected under §17. *Cost if wrong:* up to 150 s for a slip that was already waiting at the moment of the stop.

**P3-5. The backup printer** (spec §9.4).
- What moves: a printer whose writer is offline sends its queued slips that never reached paper (no uncertain attempt) to its backup, while the backup's writer is online. A network printer moves only when no device is left to take it over.
- On the sweep, at most once per 60 s: each slip that moves gets BACKUP PRINTER first among its labels, and a `retargeted` log naming both printers. The backup's writer is told of the head.
- What stays: a slip that may have printed, a bill waiting for the cashier, and a slip being printed. A printer with no backup keeps its slips, and every device says its device is offline (P3-7).
- Rules for the setting: a backup is another printer that exists, never the printer itself. Deleting a printer clears it from every printer that named it. A save that does not mention the backup keeps it, and `null` clears it (the planning review, I-1: a page from before 3B re-saves whole printers without the field).
- Edge cases, ruled as designed (the planning review, M-6):
  - (a) a moved slip never moves back: it prints at the backup even if its own device returns first;
  - (b) a stale queued slip (older than 30 min) moves too, and Print now later prints it at the backup;
  - (c) if the backup printer is then deleted, the moved slip fails as "removed or switched off" (staff print it again from its order);
  - (d) a network printer that every writer is skipped for, while its primary is online, keeps its slips (spec §9.4 moves slips only when a *device* is offline; the 5-minute skips run out and the writers try again);
  - (e) with mutual backups (A↔B), A's slips that went to B carry BACKUP PRINTER. *Cost if wrong:* while the bar phone is offline, its slips print at the counter with the BACKUP PRINTER banner. That is exactly the intent, and labelled.

**P3-6. Health rides the heartbeat** (spec §10).
- The writer's wake carries `printers: [{ printerId, link, paper?, cover?, error? }]` for the printers it writes now.
- The server keeps it on the printer only when it changed, or to refresh a steady state every 5 minutes (at most 144 writes a printer a day). It never keeps a report for a printer the device does not write now.
- A report says nothing once it is older than 10 minutes, or comes from another device.
- Paper, cover and error come from DLE EOT: the POS app in Session 3C, the Windows app's network printers in Session 3E. BLE and the Windows spooler report the link only.
- *Cost if wrong:* a stale problem shows for at most 10 minutes after a writer stops reporting.

**P3-7. "Shows on every device" with no new poll.**
- A slip waiting on a printer carries that printer's problem in the existing 20 s pulse's waiting-slips feed: "The device that prints Bar is offline.", "Bar is out of paper.", "Bar has its cover open.", "Bar reports an error…", "Bar is not connected.", "Bar is low on paper." Every device's panel, its count and its 20 s alarm already carry that feed.
- The two reads behind it (the printers, who is online) run only when such a slip waits.
- The printers read every device already makes carries the health too, for the setup page and each writer's dot (3B).
- A printer that is out of paper while nothing waits shows on its writer's dot and the setup page; every other device learns of it with the first slip that waits for it (the alarm rings at 20 s).
- *Cost if wrong:* an ordering device learns of an empty printer when its slip waits, not before. That is when it matters.

**P3-8. The token fix's M-2 (the kind fence on `more` and on jobs-for-me).**
- A page that prints token slips says so: `tokenSlips: true` on the ack and the wake, `?tokens=1` on the pulse, as its lease already does.
- A page that does not say (any page from before Phase 3) is answered from what its device's last lease said, kept on `PrintDevice.tokenSlips` by the lease's own touch: one write, made only when the value changed. Only such an older page pays the one small read.
- So a page from before S7 is never told `more` for a token, nor counted one by the pulse or the wake. A page from after S7 counts tokens exactly as before.
- *Cost if wrong:* an older page could again pay an empty lease per pulse while a token waits. That is today's cost, until it reloads.

**P3-9. A writer whose wake cap is spent.** On a day with the socket down from start to finish, a writer can spend its share of the wake cap and stop polling. It then looks offline although it still prints. A lease refreshes `lastSeenAt` (at most every 30 s), but a slip made leased at creation (direct print) and its ack do not (the planning review, M-3). So a counter that prints everything directly looks offline 90 s after its last real lease. A network printer then fails over, which is harmless. A device printer with a backup sends its untried slips there, labelled. *Ruled acceptable:* this needs a whole day with the socket down and a backup set. Nothing is lost or doubled, and every moved slip says BACKUP PRINTER. A touch on the ack route would close the gap, but would cost every cafe one Atlas operation per ack; the 3A gate may revisit it with the 3B page's cap behaviour.

**P3-10. The emulator in Session 3A's pre-validation.** Session 3A changes no app code, no page behaviour and no Worker. Its server code stays dormant until a Phase 3 page sends `lanFailover`, `tokenSlips` or `printers`, or a backup is saved through the API. So the planning session pre-validated it on a scratch clone with every suite, plus the live legs that drive the new paths. The planning session ran no emulator check: 3A touches no app code, and C: had 3.3 GB free after the scratch clones and their Next build (which ran with webpack's cache off, in a build copy only). Session 3A's own verification (Task A5) runs a dormant emulator spot-check on the real repo.

## The sessions

Phase 3 is split like Phase 2: one session each, then a review gate in its own session, which makes the next session exact. Each session ends with its exit, a fresh review on **Claude Fable 5.1**, and its Results.

| Session | What | Touches | Exit |
|---|---|---|---|
| **3A** | Dormant server core: the token M-2 fence; who writes a printer now, and the 5-minute skip; the backup printer; health on the heartbeat; each printer's problem in the waiting-slips feed | cafe server, shared | every suite + live legs az–bc + build; a dormant emulator check (a Phase 2 page prints as before) |
| **3B** | The page: takes network printers over, acks "unreachable", reports health, shows problems, backup printer in the setup, removal deferred while writing, says `tokenSlips` | cafe page (web only; APKs unchanged) | headless Chrome with a fake POS app (two devices): the primary stopped → the second prints; problems in words |
| **3C** | The POS app's printer layer: DLE EOT after each job and idle, G5, bridge v2 `paper`/`cover`/`error`, m-3, the PrinterPool publish-chain JVM test | apps/mobile (APK changes), fake printer flags | JUnit; emulator: paper out reported; a mid-slip cut is "maybe" (REPRINT) |
| **3D** | The POS app's service: `connectedDevice` foreground service, `START_STICKY`, WebView remount on page death, the boot notification, the battery checklist | apps/mobile (APK) | emulator: a killed service restarts; after a reboot the notification shows; a dead page remounts |
| **3E** | The Windows app 1.12.0: raw TCP for network printers from the main process (with DLE EOT), printer presence every 60 s, `lanFailover` | apps/desktop (installer) | desktop tests with a fake TCP printer; headless Chrome with a fake `posDesktop` 1.12.0 |
| **3F** | Telegram alerts (§10), optional per cafe, on the sweep | cafe server + a setting | live leg against a fake Telegram endpoint; at most one alert per printer per 10 minutes |
| **3G** | The Phase 3 exit: the soak's m-5/m-6, the four exit items on the emulator and a second device, the measured free-tier check of both modes with tokens on, TEST-CHECKLIST and GO-LIVE-CHECKLIST Phase 3 sections | tools, docs | spec §14's Phase 3 row, end to end; measurement `pass: true` |

Order: 3A → 3B → 3C → 3D → 3E → 3F → 3G. 3B comes before 3C (the page reads the app's new status fields when present, and the bridge v2 contract gains them in 3B's header), as 2F1 came before 2F2. 3D and 3E are independent of each other and may swap at a gate.

### Session 3B (spec; made exact at the 3A review gate): the page

**Scope** (web only: `apps/cafe` page code; no APK, no desktop, no Worker change):
- **Capabilities.** The page's wake says `lanFailover: true` when the POS app speaks bridge v2 (`nativeProtocol` ≥ 2), or the Windows app reports raw TCP (from 1.12.0, Session 3E; until then false). A Chrome tab says false.
- **Network printers as a candidate writer.** A device that says `lanFailover` names every routable network printer in its lease, as well as the ones it writes. The server grants only the writer now, and jobs-for-me (aimed at it) tells it when.
  - On bridge v2, such a printer is added to the app's pool when its first job arrives (`printer.select { tcp }`, recorded in `pos.app-lan-added.v1` exactly as 2G's page-added printers) and removed by 2G's rule once the setup stops naming it.
  - The top-bar dot counts a candidate printer only while this device writes it.
  - *Decide at the gate:* add on demand, or ahead of time when `lanFailover` (ahead of time costs the app a 30 s probe per printer; on demand costs the first slip's connect).
- **What a takeover changes in the page** (the planning review, M-8):
  - (a) A taken-over printer enters the agent's `ready` list once it is pooled. Otherwise `printerListLooksStale` (`lib/print-agent-printers.ts`) and the wake's `writesPrinters` (which reason over the *setup's* writers) re-read the printers every minute for the whole takeover.
  - (b) A `lanFailover` device names every routable network printer in every lease, so the server's who-is-online read runs on each of its leases: one small read; the A2 pin's "only when" holds for every other device.
  - (c) The direct-print ready header for a taken-over printer stays a gate decision.
  - (d) Phase 1's "a printer the device knows is down is never leased" needs a per-printer link state for taken-over printers.
- **"Unreachable".** On a network printer, a print refused before any byte (NOT_CONNECTED) is acked `failed, sent:"no", reason:"unreachable"`.
- **Health in the beat.** The wake carries `printers: [{ printerId, link, paper?, cover?, error? }]` for the printers this device writes now: the link from the bridge (v2 status) or the Windows app; paper, cover and error when the app reports them (3C, 3E). Sent on every wake; the server writes only on a change.
- **The token fence's half.** `tokenSlips: true` on the ack and the wake, `&tokens=1` on the pulse (A0's contract).
- **Words.**
  - The waiting-slips panel shows `printerProblemText(name, row.problem)` on a row with a problem; the alarm's notice says it too.
  - The top-bar dot of a writer whose own printer reports a problem is red, with those words.
  - The setup page's printer rows show the problem and "Backup: ‹name›". The devices list shows "Can take over network printers" for a `lanFailover` device, and the setup says "No device can take over this network printer" when the cafe has one writer.
- **Backup printer in the setup.** The printer form gets "Backup printer" (none, or another routable printer; never itself), saved whole (`backupPrinterId`). It sends `null` for "none": an absent field keeps the saved backup (A3, the planning review's I-1). A saved backup id the form cannot find among the printers (deleted in the instant before a save) shows as "none", never an error (the review's re-check). The BACKUP PRINTER banner already prints (`printBannerText`).
- **The 2G final gate's (a) item 4: a removal deferred while writing.** The page's removal of a network printer it added waits while this device holds a lease on that printer, then runs. This needs the agent's set of printer ids being written, and a re-run when it empties.
- **Runbook and checklist.** GO-LIVE-CHECKLIST's Phase 3 page notes (reload every screen; a device that can take over printers needs the Phase 2 APK or Windows 1.12.0).

**Exit (3B):**
- Headless Chrome with two fake POS apps (pw script; bridge v2, real TCP to fake printers): device A is the primary of LAN printer 9100, and device B writes 9101 and says `lanFailover`.
  1. Stop A (close its page). Every slip made from 90 s on prints on 9100 through B; one already waiting prints within 60 s more.
  2. A's printer refuses its connect: the ack says "unreachable", and B prints the slip within seconds.
  3. Fake printer status (`paper`: out, through the fake app's v2 status): the other device's panel row says "‹Printer› is out of paper."
  4. A backup printer saved in the form, its device's page closed: the slip prints at the backup with the BACKUP PRINTER banner.
  5. A page from before Phase 3 (the release page build) on the 3B server still prints as before.
- Then on the emulator with the Phase 2 APK (bridge v2): steps 1 and 3 with the emulator app as device B.
- Every suite, the build, a fresh Fable review, Results.

### Session 3C (spec; made exact at the 3B review gate): the POS app's printer layer

**Scope** (`apps/mobile` Kotlin + RN bridge; the APKs change):
- **DLE EOT status** (spec §10). After each job, and every 60 s while the printer is idle and the host service runs, query `DLE EOT n` (n = 1 printer, 2 offline cause, 3 error cause, 4 roll paper sensor) and read one byte each with a short timeout:
  - TCP: the job's connection before close; when idle, one connect and close every 60 s, only while the printer has no queued job;
  - USB: the bulk IN endpoint;
  - Bluetooth Classic: the input stream;
  - BLE: link only.
  - Parse into `paper: ok|low|out`, `cover: closed|open`, `error: true`. A printer that does not answer reports nothing more (no false problem).
- **G5** (Phase 1's open item: Android TCP read a mid-slip cut as printed). After writing, a TCP job asks DLE EOT before it reports printed. A connection closed by the printer, or no status answer within the timeout after a write, reports WRITE_FAILED: "maybe", so the server labels the retry REPRINT. Proven with `scripts/fake-escpos-printer.mjs --drop-after`.
- **Bridge v2 contract.** Each printer in `printer.status` gains `paper?`, `cover?`, `error?`. The `apps/cafe/lib/printer/native-bridge-v2.ts` header (3B) and its parity pin (`native-bridge-v2-parity.test.ts`) follow. The notification says "out of paper" as its worst state.
- **m-3** (Session 2G): Change printer to a new Bluetooth or USB printer connects it once. `putDefault` of a listed id only moves the default (no new `PrinterManager`); a JUnit test pins it.
- **The PrinterPool publish-chain JVM test** (the 2F2 gate): seams in `PrinterPool` (an injectable publisher and saver) and a JUnit test of change → halt → save → publish (v1 and v2, once each, in order).
- **The 2F2 gold review's M-5** (the watchdog cancel race, identical to v1): fixed with its own JUnit test, or ruled at the gate.
- **The fake printer.** `--paper-out`, `--cover-open` and `--paper-low` answer DLE EOT, if not there yet (spec §13 lists them), with `test:print-tools` tests.

**Exit (3C):**
- JUnit, with every new test seen RED first.
- On the emulator with the new x86_64 APK: the fake printer `--paper-out` → the panel on a second device says "‹Printer› is out of paper."; `--drop-after` → one REPRINT copy, never a silent "printed".
- The new APK over the Phase 2 one keeps its printers (the Prefs list).
- The release page (bridge v1) still prints.
- New arm64 and armv7 hashes recorded (not released).

### Session 3D (spec; made exact at the 3C review gate): the POS app's service

**Scope** (`apps/mobile`; the APKs change):
- **Foreground service type `connectedDevice`** (spec §9.5). This needs `FOREGROUND_SERVICE_CONNECTED_DEVICE` plus one of its runtime prerequisites; `CHANGE_NETWORK_STATE`, a normal permission, covers a network-printer-only device. Android 14's rules are checked on the emulator (API 33) and written for 34+.
- **`START_STICKY`.** On a restart with a null intent the service comes back in the "printing" state it had (Prefs), and the activity re-creates the WebView on the next open.
- **Page death.** `onRenderProcessGone`, or the existing page-dead watchdog, remounts the WebView by itself (the WebView remount fix of `7edf7aa` stays), instead of only posting a notification.
- **After a reboot.** A `BOOT_COMPLETED` receiver (`RECEIVE_BOOT_COMPLETED`) posts "POS printing is off. Tap to start." when this device was printing before. It never launches the activity: Android blocks that from the background, and a native agent is out of scope.
- **The battery checklist.** A screen in the app (More options) lists the battery restrictions for Xiaomi, Oppo, Vivo and Samsung (from dontkillmyapp.com), with direct links into the settings where Android allows them (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`; the OEM autostart screens best-effort).
- **mobile-paths pins** for each of these.

**Exit (3D):**
- On the emulator: printing on, then `adb shell am kill com.possoftware.pos` with the app in the background → the service is back within a minute and prints the next slip.
- `adb reboot` → the notification is in `dumpsys notification`, and tapping it opens the app, which prints.
- A forced page death (`chrome://crash` in a debug build, or the watchdog's test hook) → the WebView remounts and the page drains again.
- The release and the 3C APK: the update in place keeps everything.

### Session 3E (spec; made exact at the 3D review gate): the Windows app 1.12.0

**Scope** (`apps/desktop`; a new installer):
- **Raw TCP for network printers from the main process** (spec §9.6). `printRaw({ host, port, data })` over IPC: one `net.Socket` per job, write, then DLE EOT 1/2/4 with a short timeout, close. It answers `sent: "no"` on a failed connect (the page acks "unreachable") and `maybe` after any byte.
- **The page.** On 1.12.0 a network printer is written with the page's ESC/POS raster through `printRaw` (the same bytes as Android), so `capabilities.lan` and `lanFailover` are true.
- **Windows printers stay on the spooler**, and the readback says only that the bytes were sent.
- **Printer presence every 60 s.** The app checks that each chosen Windows printer is still reported; a missing one reports `link: "disconnected"` in the beat.
- **The installer.** `POS-Software-Setup-1.12.0.exe` (`npm run dist`, Electron cached, offline); TEST-CHECKLIST's Windows part gains network printers and presence.

**Exit (3E):** desktop tests (raw TCP against a fake printer in node; presence); headless Chrome with a fake `window.posDesktop` 1.12.0 (pw script) printing to fake printers; the installer built and hashed; 1.11.0 keeps working against the 3E page.

### Session 3F (spec; made exact at the 3E review gate): Telegram alerts

**Scope** (`apps/cafe` server + a setting; uses `models/TelegramChat.ts` and the existing Telegram integration, `npm run verify:telegram:live`):
- **The alerts** (spec §10), all optional per cafe:
  - a slip waited more than 60 s because its printer is offline (problem `device-offline` or `offline`);
  - a slip `failed`;
  - a printer's device offline more than 2 minutes while slips wait for it.
- **Rate.** At most one alert per printer per 10 minutes (`Printer.alertedAt`, one write).
- **When it runs.** On the sweep (at most once per 60 s; after the answer), never Cron. Outbound HTTPS to Telegram is free; each alert is one fetch inside the sweep's `after()`.
- **Owner decision at the gate:** where the switch lives (Settings → Notifications is hidden on `main` since `a27614e`), and the default (off).

**Exit (3F):** a live leg against a local fake Telegram endpoint (each alert once, the 10-minute bound, nothing with the switch off); the budget pin (bounded fetches, no request); a fresh review.

### Session 3G (spec; made exact at the 3F review gate): the Phase 3 exit

**Scope:**
- **The soak's tool fixes** (Session 2G's m-5 and m-6, accepted at the final Phase 2 gate):
  - a malformed `--printer`/`--agent` value is refused at the start;
  - the drain's cadence during a backoff follows the page's one timer;
  - printers mode checks every job, not only those the answers named;
  - after a refused ack it waits for its backoff.
  - Plus a `--failover` mode (a second soak agent that says `lanFailover`).
- **Spec §14's Phase 3 exit, end to end** (the emulator app and a second device: a soak agent or a headless-Chrome fake app):
  1. Stopping the primary network-printer writer moves printing to the second device (P3-4's measure).
  2. Paper out (fake printer `--paper-out`) shows on every device.
  3. A killed service restarts.
  4. The boot notification appears.
- **The measured free-tier check of both modes with tokens on** (the owner's ruling): the counting proxy, process CPU and opcounters, exactly as in Session 2G (P1–P4 with a token per order, plus a failover run). Each must stay within §17.3 item 5's limits. If one fails, the token ruling's fallback (option C: the slips one request puts on one printer line ride one lease or one direct answer) becomes a task before release.
- **Docs.** TEST-CHECKLIST's Phase 3 real-printer checks (paper out, cover open, two tablets failing over, a backup printer, the reboot notice, the battery steps on a Xiaomi/Oppo/Vivo/Samsung). GO-LIVE-CHECKLIST's "Existing cafes: the printing Phase 3 release" (the web, every screen reloaded, the new APK, Windows 1.12.0; no Worker change unless 3F adds one).
- **Review and Results.** A fresh Fable review and Results.

**Exit (3G):** spec §14's Phase 3 row met; the measurement `pass: true` in both modes with tokens on; the owner's real-printer checklist and the merge decision stay the owner's.

## Carried items, where they land

| Item | From | Session |
|---|---|---|
| m-3: a new BT/USB printer connects twice on Change printer | 2G | 3C |
| The PrinterPool publish-chain JVM test (seams) | the 2F2 gate | 3C |
| M-5: the watchdog cancel race (v1-identical) | the 2F2 gold review | 3C |
| A removal deferred while that printer writes | the final Phase 2 gate, (a) item 4 | 3B |
| The soak's m-5, m-6 and reviewer (a)'s two soak items | 2G, the final Phase 2 gate | 3G |
| Token M-2: the kind fence on `more` and jobs-for-me | the token fix's review | **3A (A0)** |
| Token M-2: the runbook's "within 30 minutes; after that, Print now in the panel" | the token fix's review | **3A (A0)** |
| Token M-3: the TokenSettingsFields comment "(no new request)" | the token fix's review | **3A (A0)** |
| m-2: two network printers on one host share a name in the notification | 2F2 | Phase 4 |
| The not-routed toast's wording | the final Phase 2 gate, (b) m-5 | Phase 4 |

## Planning review (Fable 5.1)

**How it ran.** A fresh reviewer on **Claude Fable 5.1** reviewed this plan and Session 3A's exact code. It was read-only, with its probes in the planning session's scratchpad (`review3a/`), never in the repo.
- The first dispatch stopped at once on HTTP 429 (a session limit, resetting at 7 pm IST). The planning session waited for the reset and ran the same review on Fable again, with no model switch.
- The reviewer verified on its own:
  - every suite on the golden copy (shared 815, cafe 4988/4987/0/1);
  - the live legs on its own database (414/0, each new leg counted);
  - `git diff --stat` empty for `apps/mobile`, `apps/desktop` and `workers`;
  - every plan block re-applied by its own applier onto a clone of `aae162c`: 145 operations, the tree identical to the gold.

**Verdict: "ship after fixes".** No Critical finding. One Important finding and nine minors, each ruled below.

| # | Finding | Ruling |
|---|---|---|
| I-1 (Important) | A page from before 3B builds a printer's body from its form draft, which has no backup field, and re-saves the whole printer to switch it on or off. Since an absent `backupPrinterId` removed the backup, such a save silently dropped a backup it cannot see. | **Fixed in A3.** The field is `objectIdString.nullable().optional()`: absent keeps the backup (as `order` does), `null` clears it, a string sets it. Leg bb proves the keep and the clear. 3B's form sends `null` for "none" (the 3B spec). *Cost if wrong:* none; a backup survives an older page. |
| M-1 | Three finds that reach the end of a file showed an empty line before the closing fence: the file's last newline, which a reader copying by hand would take as one newline too many. | **Fixed in the generator.** A trailing newline shared by a find and its replace is dropped. The section now has 148 operations (the fixes add three). It was validated again on a fresh clone: every find matched once, and the tree is identical to the gold `g3a-v2`. |
| M-2 | The wake made one filtered `updateOne` per reported printer even when nothing changed: an Atlas operation each. At the 3 s cadence of a socket that is down, 12 printers would cost 4 operations a second. | **Fixed in A4.** `printerHealthNeedsWrite` compares in memory with the health the wake's own printers read holds. A wake that changes nothing costs no operation, and the writes go together (`Promise.all`). New unit test: `lib/print-health.test.ts`. |
| M-3 | P3-9's premise was incomplete: a direct print (a slip made leased at creation) and its ack never refresh `lastSeenAt`. | **Text fixed (P3-9); code not taken.** A touch on the ack route would cost every cafe one Atlas operation per ack, to cover a writer whose wake cap is spent with the socket down for hours. The 3A gate may revisit it with the 3B page's cap behaviour. |
| M-4 | The waiting-slips feed's enrichment read the printers and who is online on every pulse of every device for up to 3 h while a failed or needs-confirm printer row stayed in the feed. | **Fixed in A4.** Only a slip still waiting for its printer (queued) says the printer's problem, and only such a slip triggers the two reads. A failed slip keeps its own words. |
| M-5 | Spec §9.3's table still said `capabilities.lan` and `error:"unreachable"`. | **Fixed in the spec** (§9.3 notes `lanFailover` and `reason`, pointing to §9.8). |
| M-6 | The backup move's edge cases: a moved slip never moves back; a stale slip moves too; a deleted backup fails the moved slip; a network printer that every writer is skipped for keeps its slips while its primary is online; mutual backups label A's slips BACKUP PRINTER. | **Written into P3-5, as designed** (each is spec-consistent and visible). |
| M-7 | The new head announcements (`announcePrinterHead`) were not in the Worker budget, and the 2 s refusal backoff makes the new writer's first lease after a skip "not due". | **Written into P3-3:** at most once a minute per printer per instance, and at most 144 a day per skipped writer, well inside the 5 % Worker pin; one extra lease per skip. |
| M-8 | 3B gaps: a taken-over printer must enter the page's `ready` list (or the printers read repeats every minute); a `lanFailover` device's leases always pay the who-is-online read; the direct-print ready header; the per-printer link state for "known down". | **Written into the 3B spec** ("What a takeover changes in the page"). |
| M-9 | The Global Constraints did not say that a token cafe's *pinned* heavy day exceeds 15 % CPU at Session 2G's measured rate. | **Written into Global Constraints:** the pin overcounts (2G's measured day was 8.9 %), so the measurement is the gate (the owner's ruling). |

**The reviewer's sound list.** It checked and found sound:
- **Writer now, everywhere.** `printerActiveWriter` is used at every writer choice: routing and direct print, the lease, the "unreachable" ack, the sweep, Retry and Print again, Test print, health. The remaining `printerWriterDeviceId` uses are page-side, plus the wake's cap and `writesPrinters`, which are correct for 3A.
- **One writer per printer at a time.** A live lease holds the line; a retarget changes only the target; the backup move changes `printerId` under `status: "queued"`, so the original's lease CAS fails.
- **The skip.** Its schema refine, the pipeline write, and the rule that only the writer now is skipped.
- **The backup move.** The `$in: [0, null]` filter, the label order, keys that include the printer (no collision), the backup's paper width, no doubling in a cycle.
- **Health.** `$ne: null` on absent fields, the writer-only rule, the stale window, fail-soft, and print-attention.ts still writing nothing.
- **The token fence.** Correct for every page generation: pre-S7, S7 to Phase 2, Phase 3.
- **The budget.** No new recurring request.
- **Deploy skew.** Phase 2 bodies still validate, and the new wire fields are ignored by old pages.
- **The plan.** Every item of spec §14's Phase 3 row and every carried item has a session, and Task A5's numbers are right.

**The re-check** (the same reviewer, on the folded fixes: branch `g3a-v2`, A3 `72e4e12`, A4 `d8fe877`).
- Its own runs: cafe 4990 / 4989 / 0 / 1 skipped; `tsc --incremental false` 0; live legs 415/0 (bb now 13 checks); `section-3a-v3.md` applied with an exact matcher, 148 operations, tree byte-identical to `g3a-v2`.
- **I-1, M-2, M-4 and the generator's M-1: sound.** It agreed with not taking M-3.
- Its two text items were folded in: Task A5's expected numbers (148 operations, cafe 4990 / 4989, live 415 with bb 13), and the 3B form's `null` for "none" (plus showing "none" for a saved backup it cannot find).
- **Verdict: "ship as written".**

---
## Session 3A (exact code, written and pre-validated in the Phase 3 planning session)

**Pre-validation (the Phase 3 planning session, 2026-10-06).**
- **Verbatim apply.** Every block of Tasks A0–A4 (148 operations) went verbatim, task by task, onto a fresh clone of `feat/printing-phase-3` at `aae162c`. Every find matched exactly once.
- **RED, then GREEN.** Each task's RED was seen before its code went in, and each GREEN gave the Expected lines below.
- **Same tree.** The clone's tree came out IDENTICAL to the golden copy's (branch `g3a-v2`, tree `35204f2`).
- **Every suite on the golden copy:**
  - shared 815/815; cafe 4990 / 4989 pass / 0 fail / 1 skipped;
  - tsc 0 and lint 0 errors (+2 old warnings) for cafe, hub, mobile and desktop;
  - mobile 125 + Jest 3; desktop 192; print tools 8; live legs 415/0;
  - the Next build: 132 routes. It ran in a separate build copy with webpack's persistent cache off, a config line in that copy only, because C: was short of space.
- **No emulator run** (decision P3-10).

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 3A delivers.** Session 3A is Phase 3's dormant server core (spec §9.3, §9.4, §10, §17):
- the token fix's M-2 kind fence (Task A0);
- the shared rules of failover, the backup printer and printer health (A1);
- failover on the server: who writes a printer now, everywhere a slip is aimed, and the 5-minute skip (A2);
- the backup printer (A3);
- printer health on the heartbeat, and each printer's problem in every device's waiting-slips feed (A4);
- then the verification, the fresh review and Results (A5).

**Dormant.** No page sends `lanFailover`, `tokenSlips` on the ack, pulse or wake, or `printers` in its beat before Session 3B, and no setup form saves a backup before 3B. Until then every printer's writer now is its setup writer, and every slip prints exactly as in Phase 2. The exceptions:
- a page from before print-customization S7 stops paying an empty lease for a token it cannot print;
- a slip waiting on a printer whose device is offline says so in every device's feed (a field a Phase 2 page ignores);
- the sweep tells a printer's new writer of its line's head when it moves slips (one realtime request; Phase 2 left it to the next pulse).

**No app code, no desktop code, no Worker change, no new request.** The APKs and the Windows installer stay byte-identical to Phase 2's. `git diff --stat aae162c..HEAD -- apps/mobile apps/desktop workers` stays empty.

**Decisions this section implements:** P3-1 to P3-9 (above) and the carried token items (M-2, M-3, the runbook line).

**Not in 3A:** the page (3B), the apps (3C–3E), Telegram (3F), the exit and the measurement (3G).

### Review Focus (Session 3A)

The inputs most likely to bite a cafe that the unit tests alone would not exercise; each has a live leg, a test or a pin.
1. **A Phase 2 page on the 3A server** prints exactly as before: it never takes a printer over, it never reports health, and its tokens still count for it (it leases with `tokenSlips`). → leg az ("the lib's default still counts every kind"; "a page that prints tokens is told more:true…"), leg ba ("a page from before Phase 3 never takes a printer over"), the full live run (every Phase 1 and 2 leg unchanged).
2. **The primary back mid-failover**: the second device's lease is its own until its ack, and waiting slips go home on the next sweep. → leg ba ("the tablet back online…", "…the counter no longer leases it").
3. **A slip that may have printed is never moved to a backup**, and a bill waiting for the cashier or a slip being printed stays. → leg bb ("a slip that may already have printed stays…"), the backup PIN.
4. **A report that is not the writer's** (another device, a stale one, a printer taken over) never paints a problem. → `print-failover.test.ts` (`printerProblemOf`), leg bc.
5. **A dead network printer** costs each writer at most a lease and an ack per 5 minutes and then waits for its primary, visibly. → leg ba ("the counter cannot reach it either…"), the budget pin.

### File map (Session 3A)

| File | Change | Task |
|---|---|---|
| `apps/cafe/lib/print-device.ts`, `print-lease.ts`, `print-agent-server.ts`, `print-lifecycle-schemas.ts`, `models/PrintDevice.ts`, the lease, wake and pulse routes, `docs/GO-LIVE-CHECKLIST.md`, `components/settings/TokenSettingsFields.tsx`, `scripts/print-host-live/token-fence.ts` (create) | the token fix's M-2 and M-3, the runbook line | A0 |
| `packages/shared/src/print-failover.ts` (create), `print-printers.ts`, `print-agent-wire.ts` | the shared rules | A1 |
| `apps/cafe/lib/print-failover.ts` (create), `print-lease.ts`, `print-routing-context.ts`, `print-printer-routing.ts`, `print-order-jobs.ts`, `print-printer-jobs.ts`, `print-sweep.ts`, `print-job-actions.ts`, `print-printer-test.ts`, `print-device.ts`, `print-printers.ts`, `models/Printer.ts`, `models/PrintDevice.ts`, `packages/shared/src/print-budget.ts`, `scripts/print-host-live/failover.ts` (create) | failover on the server | A2 |
| `apps/cafe/models/Printer.ts`, `lib/print-printer-schemas.ts`, `lib/print-printers.ts`, `lib/print-failover.ts`, `lib/print-sweep.ts`, `scripts/print-host-live/backup.ts` (create) | the backup printer | A3 |
| `apps/cafe/lib/print-health.ts` (create), `models/Printer.ts`, `lib/print-printers.ts`, `lib/print-lifecycle-schemas.ts`, the wake route, `lib/print-attention.ts`, `packages/shared/src/print-budget.ts`, `scripts/print-host-live/health.ts` (create) | health on the heartbeat; the problem on every device | A4 |
| this plan | Session 3A Results | A5 |

Each task is one commit, in this order: A0 → A4. Then A5 (verification, the dormant emulator check, the fresh review, Results).

---

### Task A0: the token fix's M-2: the kind fence on the ack's `more` and on jobs-for-me; its M-3 comment; the runbook's 30 minutes

**Files:**
- Modify: `packages/shared/src/print-agent-wire.ts` (`PRINT_PULSE_TOKENS_PARAM`)
- Modify: `apps/cafe/models/PrintDevice.ts` (`tokenSlips`), `apps/cafe/lib/print-device.ts` (`touchPrintDevice(deviceId, nowMs, tokenSlips?)`, `printDeviceDrawsTokens`)
- Modify: `apps/cafe/lib/print-lease.ts` (`printLineHasMore`/`printerLineHasMore`/`printJobsForMeFilter`/`readJobsForDevice` take `tokens`; `ackPrintJob` takes `tokenSlips`), `apps/cafe/lib/print-lifecycle-schemas.ts` (`tokenSlips` on the wake and the ack), `apps/cafe/lib/print-agent-server.ts` (`printPulseTokensOf`, `readPulseJobsForDevice`)
- Modify: `apps/cafe/app/api/print-jobs/lease/route.ts`, `app/api/print-jobs/wake/route.ts`, `app/api/order-requests/pulse/route.ts`
- Modify: `docs/GO-LIVE-CHECKLIST.md` ("Existing cafes: turning token slips on": within 30 minutes; after that, Print now), `apps/cafe/components/settings/TokenSettingsFields.tsx` (a comment)
- Create: `apps/cafe/scripts/print-host-live/token-fence.ts` (leg az); modify `apps/cafe/scripts/verify-print-host-live.ts`
- Tests: `apps/cafe/lib/print-lease.test.ts` (one test, new), `lib/print-lifecycle-paths.test.ts` (one pin new; asserts added; three pins' lines changed), `lib/print-order-jobs.test.ts` (one test new; one pin's line changed), `lib/print-attention.test.ts` (one pin's line changed)

**Interfaces produced:** `PRINT_PULSE_TOKENS_PARAM` (`@pos/shared/print-agent-wire`); `touchPrintDevice(deviceId, nowMs, tokenSlips?: boolean)` and `printDeviceDrawsTokens(deviceId): Promise<boolean>` (`lib/print-device.ts`); `printJobsForMeFilter(deviceId, nowMs, tokens = true)`, `readJobsForDevice(deviceId, nowMs, tokens = true)`, `printLineHasMore(deviceId, nowMs, tokens = true)`, `printerLineHasMore(printerId, nowMs, tokens = true)`, `ackPrintJob(input & { tokenSlips?: true })` (`lib/print-lease.ts`); `printPulseTokensOf(url): boolean`, `readPulseJobsForDevice(deviceId, saysTokens, nowMs)` (`lib/print-agent-server.ts`).

**The token fix's review, M-2.** A page from before print-customization S7 cannot print a token job, so its lease steps over one (`leaseKindFence`). But the ack's `more` and the jobs-for-me count of the pulse and the wake still counted tokens, so while a token waited on its line, that page paid an empty lease after every ack and on every pulse, until the token went stale (30 min). Now both leave token jobs out for such a page, exactly like its lease.

**How the server knows.** A Phase 3 page says so itself (3B sends `tokenSlips: true` on the ack and the wake, and `?tokens=1` on the pulse). A page that does not say (any page from before Phase 3) is answered from what its device's last lease said. The lease's own touch keeps that on `PrintDevice.tokenSlips`, in the write it already makes, written only when it changed. Unknown (no row, no lease yet) counts tokens, as before. The one extra read is paid only by an older page, by its unique `deviceId`.

**Why not fence on the request alone:** pages from after S7 but before Phase 3 (live on the demo and lucifer007) say nothing on the ack or pulse but do print tokens. Fencing every request that says nothing would strand their tokens until the next lease.

**The runbook** (`docs/GO-LIVE-CHECKLIST.md`, "Existing cafes: turning token slips on"): "until a reloaded page prints it within 30 minutes (once, with no DUPLICATE); after that, Print now in the panel prints it".

**M-3:** `TokenSettingsFields.tsx`'s comment now says what the read costs: at most one `GET /api/printers` when a tab opens the page without the cached list, never recurring.

**Changed existing pins** (each follows this deliberate change):

- `print-lifecycle-paths.test.ts`:

  - "PIN: each route calls its one lib…" (the lease route's touch says `tokenSlips`);

  - "PIN: POST /api/print-jobs/wake beats…" (the tokens line, `readJobsForDevice(…, tokens)`);

  - "PIN: the lease route's heartbeat is best-effort…";

  - "PIN (2B): an ack that takes a job off the line answers `more`…" (the tokens line, the fenced reads).

- `print-order-jobs.test.ts` and `print-attention.test.ts`: the pulse's `readPulseJobsForDevice(device, saysTokens, nowMs)`.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-attention.test.ts`, find:

```ts
test("PIN: the pulse reads the waiting-slips feed for every tab, fail-soft; printJobsForMe stays the named agent's", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /readPrintAttention\(nowMs\)\.catch\(\(\) => null\)/, "every device shows the panel and its count");
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, nowMs\)\.catch\(\(\) => null\)/, "1C's printJobsForMe is kept");
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "printJobsForMe is omitted on a failed read");
  assert.ok(
    s.includes("...(attention === null ? {} : { printAttention: attention.rows, printAttentionTruncated: attention.truncated }),"),
```

Replace it with:

```ts
test("PIN: the pulse reads the waiting-slips feed for every tab, fail-soft; printJobsForMe stays the named agent's", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /readPrintAttention\(nowMs\)\.catch\(\(\) => null\)/, "every device shows the panel and its count");
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readPulseJobsForDevice\(device, saysTokens, nowMs\)\.catch\(\(\) => null\)/, "1C's printJobsForMe is kept (Phase 3: token-fenced)");
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "printJobsForMe is omitted on a failed read");
  assert.ok(
    s.includes("...(attention === null ? {} : { printAttention: attention.rows, printAttentionTruncated: attention.truncated }),"),
```

In `apps/cafe/lib/print-lease.test.ts`, find:

```ts
  assert.deepEqual(jobsForMeOf([{ createdAt: at(1), printerId: b }, { createdAt: at(2) }]), { count: 2, oldestCreatedAt: at(1).toISOString(), printerIds: [b], ownLine: true }, "a printer job beside its own line's job");
});

test("printJobCasFilter: fences on the status and epoch the plan read; epoch 0 also matches a row with no epoch", () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(printJobCasFilter(id, { status: "queued", epoch: 0 }), { _id: id, status: "queued", epoch: { $in: [0, null] } });
```

Replace it with:

```ts
  assert.deepEqual(jobsForMeOf([{ createdAt: at(1), printerId: b }, { createdAt: at(2) }]), { count: 2, oldestCreatedAt: at(1).toISOString(), printerIds: [b], ownLine: true }, "a printer job beside its own line's job");
});

// Phase 3 (the token fix's review, M-2): a page that cannot print token slips (one from before print-customization S7)
// leases with the kind fence, so its jobs-for-me count leaves token jobs out too; every other page counts them, as before.
test("printJobsForMeFilter: tokens false leaves token jobs out (the lease's own kind fence); the default counts every kind", () => {
  assert.deepEqual(printJobsForMeFilter("dev-a", T0, false), { ...printJobsForMeFilter("dev-a", T0), kind: { $ne: "token" } }, "fenced like the lease");
  assert.deepEqual(printJobsForMeFilter("dev-a", T0, true), printJobsForMeFilter("dev-a", T0), "a page that prints tokens: unchanged");
  assert.deepEqual(Object.keys(printJobsForMeFilter("dev-a", T0, false)).sort(), ["$nor", "$or", "kind", "status", "targetDeviceId"], "one more term, nothing else");
});

test("printJobCasFilter: fences on the status and epoch the plan read; epoch 0 also matches a row with no epoch", () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(printJobCasFilter(id, { status: "queued", epoch: 0 }), { _id: id, status: "queued", epoch: { $in: [0, null] } });
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", extra: 1 }), false, "strict");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", error: "x".repeat(201) }), false);
  assert.equal(ok({ deviceId: "", epoch: 1, outcome: "printed" }), false);
});

test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
```

Replace it with:

```ts
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", extra: 1 }), false, "strict");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", error: "x".repeat(201) }), false);
  assert.equal(ok({ deviceId: "", epoch: 1, outcome: "printed" }), false);
  // Phase 3 (the token fix's M-2): a page that prints token slips says so; only true is a word.
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: false }), false, "absent, never false");
});

test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, appVersion: "1.2.0", nativeProtocol: 1 }).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, shell: "ios" }).success, false);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, fax: true } }).success, false, "strict capabilities");
});

const ROUTES = {
```

Replace it with:

```ts
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, appVersion: "1.2.0", nativeProtocol: 1 }).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, shell: "ios" }).success, false);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, fax: true } }).success, false, "strict capabilities");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: true }).success, true, "Phase 3 (M-2): a page that prints token slips");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: false }).success, false, "absent, never false");
});

const ROUTES = {
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts

test("PIN: each route calls its one lib, and a staff decision is stamped with the SESSION name, never a body field", () => {
  assert.match(src(ROUTES.lease), /leasePrintJobs\(\{/);
  assert.match(src(ROUTES.lease), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)/);
  assert.match(src(ROUTES.ack), /ackPrintJob\(\{ id, \.\.\.parsed\.data, nowMs: Date\.now\(\) \}\)/);
  assert.match(src(ROUTES.confirm), /staff: authed\.session\.user\.name \?\? UNNAMED_STAFF/);
  assert.match(src(ROUTES.retry), /retryPrintJob\(\{ id, nowMs: Date\.now\(\) \}\)/);
```

Replace it with:

```ts

test("PIN: each route calls its one lib, and a staff decision is stamped with the SESSION name, never a body field", () => {
  assert.match(src(ROUTES.lease), /leasePrintJobs\(\{/);
  assert.match(src(ROUTES.lease), /touchPrintDevice\(parsed\.data\.deviceId, nowMs, parsed\.data\.tokenSlips === true\)/);
  assert.match(src(ROUTES.ack), /ackPrintJob\(\{ id, \.\.\.parsed\.data, nowMs: Date\.now\(\) \}\)/);
  assert.match(src(ROUTES.confirm), /staff: authed\.session\.user\.name \?\? UNNAMED_STAFF/);
  assert.match(src(ROUTES.retry), /retryPrintJob\(\{ id, nowMs: Date\.now\(\) \}\)/);
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
      "validateBody(req, wakeBeatBodySchema)",
      "await connectDB();",
      "await beatPrintDevice(parsed.data, nowMs);",
      "readJobsForDevice(parsed.data.deviceId, nowMs)",
      "countOnlineAgents(nowMs)",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
```

Replace it with:

```ts
      "validateBody(req, wakeBeatBodySchema)",
      "await connectDB();",
      "await beatPrintDevice(parsed.data, nowMs);",
      "const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));",
      "readJobsForDevice(parsed.data.deviceId, nowMs, tokens)",
      "countOnlineAgents(nowMs)",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
// ── Session 1B: the 1A review's lease rulings and the print-status publishes ───────────────────────

test("PIN: the lease route's heartbeat is best-effort (M1), and a lease call that cleared four bad heads says when to look again (M2)", () => {
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)\.catch\(\(\) => undefined\),/);
  // Session 2C: per line now (leaseLineHead), so a line that cleared four bad heads gives no job and a retry time.
  assert.match(src(LEASE), /return \{ job: null, retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});
```

Replace it with:

```ts
// ── Session 1B: the 1A review's lease rulings and the print-status publishes ───────────────────────

test("PIN: the lease route's heartbeat is best-effort (M1), and a lease call that cleared four bad heads says when to look again (M2)", () => {
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs, parsed\.data\.tokenSlips === true\)\.catch\(\(\) => undefined\),/);
  // Session 2C: per line now (leaseLineHead), so a line that cleared four bad heads gives no job and a retry time.
  assert.match(src(LEASE), /return \{ job: null, retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

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
```

Replace it with:

```ts
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };',
      "const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));",
      "const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(",
      "() => undefined,",
      "...(more !== undefined ? { more } : {})",
    ],
    "the ack",
  );
  // Phase 3 (the token fix's M-2) deliberately added the lease's kind fence to both reads.
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printJobLineFilter\(deviceId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "one read on the line index");
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Phase 3 (the token fix's review, M-2): a page from before print-customization S7 cannot print a token job and its lease
// steps over one, so neither the ack's `more` nor the jobs-for-me count of the pulse and the wake may count one for it,
// or it pays an empty lease per ack and per pulse until the token goes stale. A page says so itself (Phase 3's page);
// one that does not say is answered from its device's last lease, kept on the device row by the lease's own touch.
test("PIN (Phase 3, M-2): the ack, the pulse and the wake count a token job only for a page that prints them, by its word or its device's last lease", () => {
  const device = src(DEVICE);
  assert.match(device, /tokenSlips === undefined \? \{ deviceId, \.\.\.due \} : \{ deviceId, \$or: \[due, \{ tokenSlips: \{ \$ne: tokenSlips \} \}\] \}/, "the touch writes the word only when it changed, in the one write it already makes");
  assert.match(device, /return row\?\.tokenSlips !== false;/, "unknown counts tokens, as before");
  const lease = src(LEASE);
  assert.match(lease, /\.\.\.lineJobs\(nowMs\),\s*\.\.\.leaseKindFence\(tokens\),/, "jobs-for-me: the lease's own kind fence");
  const server = src("apps/cafe/lib/print-agent-server.ts");
  assert.match(server, /return readJobsForDevice\(deviceId, nowMs, saysTokens \|\| \(await printDeviceDrawsTokens\(deviceId\)\)\);/, "the pulse reads the device row only when the page did not say");
  assert.match(src("apps/cafe/app/api/order-requests/pulse/route.ts"), /device === null \? Promise\.resolve\(null\) : readPulseJobsForDevice\(device, saysTokens, nowMs\)\.catch\(\(\) => null\)/);
});

// Session 2C (spec §7.6, §9.3; plan decision 1): a device leases its simple line and the line of each printer it
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";
import { printPulseDeviceOf } from "@/lib/print-agent-server";

// Printing redesign Phase 1, Session 1B (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md):
// server-side job creation. DB behaviour is proven live (npm run verify:print:live, legs y–ab); these
```

Replace it with:

```ts
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";
import { printPulseDeviceOf, printPulseTokensOf } from "@/lib/print-agent-server";

// Printing redesign Phase 1, Session 1B (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md):
// server-side job creation. DB behaviour is proven live (npm run verify:print:live, legs y–ab); these
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse?device=%20dev-1%20"), "dev-1");
});

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-job-insert.ts");
  // Session 2B deliberately changed the first two: a new job is queued, or leased to the asking tab and
```

Replace it with:

```ts
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse?device=%20dev-1%20"), "dev-1");
});

// Phase 3 (the token fix's review, M-2): a page that prints token slips says so on the pulse.
test("printPulseTokensOf: only ?tokens=1 says the page prints token slips; anything else, or nothing, does not", () => {
  assert.equal(printPulseTokensOf("http://localhost/api/order-requests/pulse?device=d&tokens=1"), true);
  assert.equal(printPulseTokensOf("http://localhost/api/order-requests/pulse?device=d"), false, "a page from before Phase 3 says nothing");
  assert.equal(printPulseTokensOf("http://localhost/api/order-requests/pulse?device=d&tokens=true"), false, "only the one value");
});

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-job-insert.ts");
  // Session 2B deliberately changed the first two: a new job is queued, or leased to the asking tab and
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
test("PIN: the pulse adds printJobsForMe only for a tab that named itself, fail-soft, and the route itself writes nothing", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /const device = printPulseDeviceOf\(req\.url\);/);
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, nowMs\)\.catch\(\(\) => null\)/);
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "omitted on a failed read");
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate("]) {
    assert.ok(!s.includes(write), `the pulse route itself writes nothing: no ${write}`);
```

Replace it with:

```ts
test("PIN: the pulse adds printJobsForMe only for a tab that named itself, fail-soft, and the route itself writes nothing", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /const device = printPulseDeviceOf\(req\.url\);/);
  // Phase 3 (the token fix's M-2) deliberately changed the read: a token job counts only for a page that prints them.
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readPulseJobsForDevice\(device, saysTokens, nowMs\)\.catch\(\(\) => null\)/);
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "omitted on a failed read");
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate("]) {
    assert.ok(!s.includes(write), `the pulse route itself writes nothing: no ${write}`);
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lease.test.ts lib/print-lifecycle-paths.test.ts lib/print-order-jobs.test.ts lib/print-attention.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 56`; `# pass 45`; `# fail 11`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts
import { after } from "next/server";
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { printPulseDeviceOf } from "@/lib/print-agent-server";
import { readPrintAttention } from "@/lib/print-attention";
import { readJobsForDevice } from "@/lib/print-lease";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

Replace it with:

```ts
import { after } from "next/server";
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { printPulseDeviceOf, printPulseTokensOf, readPulseJobsForDevice } from "@/lib/print-agent-server";
import { readPrintAttention } from "@/lib/print-attention";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const device = printPulseDeviceOf(req.url);

  try {
    await connectDB();
    const nowMs = Date.now();
    const [data, printJobsForMe, attention] = await Promise.all([
      readPosPulse(),
      device === null ? Promise.resolve(null) : readJobsForDevice(device, nowMs).catch(() => null),
      readPrintAttention(nowMs).catch(() => null),
    ]);
    try {
```

Replace it with:

```ts
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const device = printPulseDeviceOf(req.url);
  // Phase 3 (the token fix's M-2): a token job counts for this tab only if it prints token slips.
  const saysTokens = printPulseTokensOf(req.url);

  try {
    await connectDB();
    const nowMs = Date.now();
    const [data, printJobsForMe, attention] = await Promise.all([
      readPosPulse(),
      device === null ? Promise.resolve(null) : readPulseJobsForDevice(device, saysTokens, nowMs).catch(() => null),
      readPrintAttention(nowMs).catch(() => null),
    ]);
    try {
```

In `apps/cafe/app/api/print-jobs/lease/route.ts`, find:

```ts
      }),
      // Best-effort (1A review M1): the lease CAS may already have committed, and a 500 now would
      // strand the job for 90 s and then reprint it. A missed touch only ages lastSeenAt.
      touchPrintDevice(parsed.data.deviceId, nowMs).catch(() => undefined),
    ]);
    return noStore(success(result));
  } catch (error) {
```

Replace it with:

```ts
      }),
      // Best-effort (1A review M1): the lease CAS may already have committed, and a 500 now would
      // strand the job for 90 s and then reprint it. A missed touch only ages lastSeenAt.
      // Phase 3 (the token fix's M-2): the device row keeps what this lease said about token slips.
      touchPrintDevice(parsed.data.deviceId, nowMs, parsed.data.tokenSlips === true).catch(() => undefined),
    ]);
    return noStore(success(result));
  } catch (error) {
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
```

Replace it with:

```ts
import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents, printDeviceDrawsTokens } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
  try {
    await connectDB();
    await beatPrintDevice(parsed.data, nowMs);
    const [jobsForMe, agents, printers] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs), countOnlineAgents(nowMs), listPrinters()]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
```

Replace it with:

```ts
  try {
    await connectDB();
    await beatPrintDevice(parsed.data, nowMs);
    // Phase 3 (the token fix's M-2): token jobs count only for a page that prints them; one that says nothing (a page
    // from before Phase 3) is answered from what its device's last lease said.
    const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));
    const [jobsForMe, agents, printers] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs, tokens), countOnlineAgents(nowMs), listPrinters()]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
```

In `apps/cafe/components/settings/TokenSettingsFields.tsx`, find:

```tsx
  // off-step time (say 25 minutes) must stay pickable after the owner tries another (auto-memory
  // options-from-live-value-strand-stored-value).
  const { defaultValues: saved } = useFormState({ control });
  // The token fix (T3): tokens print at the bill printer; the same cached printers read as the agent's (no new request).
  const noBillPrinter = tokensHaveNoBillPrinter(usePrintersRead(true).printers);

  return (
```

Replace it with:

```tsx
  // off-step time (say 25 minutes) must stay pickable after the owner tries another (auto-memory
  // options-from-live-value-strand-stored-value).
  const { defaultValues: saved } = useFormState({ control });
  // The token fix (T3): tokens print at the bill printer; the same cached printers read as the agent's (at most one
  // GET /api/printers when a tab opens this page without the cached list; never a recurring request).
  const noBillPrinter = tokensHaveNoBillPrinter(usePrintersRead(true).printers);

  return (
```

In `apps/cafe/lib/print-agent-server.ts`, find:

```ts
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { claimKotPrint } from "@/lib/pos-pulse";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { createOrderPrintJobs, openingSlipsOf, wireOrderOf, type PrintIntent } from "@/lib/print-order-jobs";
import type { Order } from "@/types";
```

Replace it with:

```ts
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import { PRINT_HEADER_ON, PRINT_PULSE_TOKENS_PARAM, type PrintJobRef, type PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { claimKotPrint } from "@/lib/pos-pulse";
import { printDeviceDrawsTokens } from "@/lib/print-device";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { readJobsForDevice } from "@/lib/print-lease";
import { createOrderPrintJobs, openingSlipsOf, wireOrderOf, type PrintIntent } from "@/lib/print-order-jobs";
import type { Order } from "@/types";
```

In `apps/cafe/lib/print-agent-server.ts`, find:

```ts
  return raw !== "" && raw.length <= PRINT_HOST_DEVICE_ID_MAX_CHARS ? raw : null;
}
```

Replace it with:

```ts
  return raw !== "" && raw.length <= PRINT_HOST_DEVICE_ID_MAX_CHARS ? raw : null;
}

/** Phase 3 (the token fix's M-2): the pulse's `?tokens=1`, said by a page that prints token slips. */
export function printPulseTokensOf(url: string): boolean {
  return new URL(url).searchParams.get(PRINT_PULSE_TOKENS_PARAM) === PRINT_HEADER_ON;
}

/** The pulse's jobs-for-me (spec §9.1): a token job counts only for a page that can print it; a page that does not say
 *  (one from before Phase 3) is answered from what its device's last lease said (one more read, for that page only). */
export async function readPulseJobsForDevice(deviceId: string, saysTokens: boolean, nowMs: number): Promise<PrintJobsForMe> {
  return readJobsForDevice(deviceId, nowMs, saysTokens || (await printDeviceDrawsTokens(deviceId)));
}
```

In `apps/cafe/lib/print-device.ts`, find:

```ts
}

/** A lease counts as a heartbeat (spec §7.3) for a device the wake already knows. It never creates
 *  a row: label, shell and capabilities come only from the wake. */
export async function touchPrintDevice(deviceId: string, nowMs: number): Promise<void> {
  await PrintDevice.updateOne(
    { deviceId, lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } },
    { $set: { lastSeenAt: new Date(nowMs) } },
  );
}

/** Devices seen in the last 90 s. Never 0: it divides the cafe's one daily wake cap (spec §9.1). */
```

Replace it with:

```ts
}

/** A lease counts as a heartbeat (spec §7.3) for a device the wake already knows. It never creates
 *  a row: label, shell and capabilities come only from the wake. Phase 3 (the token fix's M-2): it also keeps what the
 *  lease said about token slips, in the same write, made only when that changed (or the heartbeat is due). */
export async function touchPrintDevice(deviceId: string, nowMs: number, tokenSlips?: boolean): Promise<void> {
  const due = { lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } };
  await PrintDevice.updateOne(
    tokenSlips === undefined ? { deviceId, ...due } : { deviceId, $or: [due, { tokenSlips: { $ne: tokenSlips } }] },
    { $set: { lastSeenAt: new Date(nowMs), ...(tokenSlips === undefined ? {} : { tokenSlips }) } },
  );
}

/** Phase 3 (the token fix's M-2): whether this device's page can print a "token" job, for a pulse, a wake or an ack that
 *  did not say (a page from before Phase 3). false only when its last lease said it cannot (a page from before
 *  print-customization S7); with no row, or no such lease yet, true: the count as before. One read by the unique deviceId. */
export async function printDeviceDrawsTokens(deviceId: string): Promise<boolean> {
  const row = await PrintDevice.findOne({ deviceId }).select("tokenSlips").lean<{ tokenSlips?: boolean } | null>();
  return row?.tokenSlips !== false;
}

/** Devices seen in the last 90 s. Never 0: it divides the cafe's one daily wake cap (spec §9.1). */
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { listPrinters } from "./print-printers";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";
```

Replace it with:

```ts
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { printDeviceDrawsTokens } from "./print-device";
import { listPrinters } from "./print-printers";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts

/** Session 2B (plan decision 9): this device's line still holds a queued job (due now, or after its backoff),
 *  so its agent leases again after an ack; otherwise it waits for a nudge, its timer or a new slip, and a
 *  burst ends with no empty lease. One read on the line index. */
export async function printLineHasMore(deviceId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

/** Session 2C: the same, for a printer job's own printer line (the 2B gate's ruling R3). */
export async function printerLineHasMore(printerId: string, nowMs: number): Promise<boolean> {
  return (await PrintJob.findOne({ ...printerLineFilter(printerId, nowMs), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number; printerId?: string; copies?: number };
```

Replace it with:

```ts

/** Session 2B (plan decision 9): this device's line still holds a queued job (due now, or after its backoff),
 *  so its agent leases again after an ack; otherwise it waits for a nudge, its timer or a new slip, and a
 *  burst ends with no empty lease. One read on the line index. Phase 3 (the token fix's M-2): `tokens` false (a page
 *  that cannot print a token job, whose lease steps over it) leaves token jobs out, like its lease's kind fence. */
export async function printLineHasMore(deviceId: string, nowMs: number, tokens = true): Promise<boolean> {
  return (await PrintJob.findOne({ ...printJobLineFilter(deviceId, nowMs), ...leaseKindFence(tokens), status: "queued" }).select("_id").lean()) !== null;
}

/** Session 2C: the same, for a printer job's own printer line (the 2B gate's ruling R3). */
export async function printerLineHasMore(printerId: string, nowMs: number, tokens = true): Promise<boolean> {
  return (await PrintJob.findOne({ ...printerLineFilter(printerId, nowMs), ...leaseKindFence(tokens), status: "queued" }).select("_id").lean()) !== null;
}

type LeasedHead = { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number; printerId?: string; copies?: number };
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(`${PRINT_LIFECYCLE_SELECT} printerId`).lean<PrintLifecycleRow & { printerId?: string }>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
```

Replace it with:

```ts
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". Phase 3 (the token fix's M-2):
 *  `tokenSlips` is the page's word that it prints token jobs (absent: what the device's last lease said). */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number; tokenSlips?: true }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(`${PRINT_LIFECYCLE_SELECT} printerId`).lean<PrintLifecycleRow & { printerId?: string }>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed. Session 2C: a printer job
      // asks its own printer's line (the 2B gate's ruling R3).
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs) : printLineHasMore(input.deviceId, input.nowMs)).catch(
        () => undefined,
      );
      return { applied: true, status: plan.patch.status, nextAttemptAt, ...(more !== undefined ? { more } : {}) };
```

Replace it with:

```ts
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed. Session 2C: a printer job
      // asks its own printer's line (the 2B gate's ruling R3).
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      // Phase 3 (the token fix's M-2): a page that cannot print a token job is never told `more` for one.
      const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));
      const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(
        () => undefined,
      );
      return { applied: true, status: plan.patch.status, nextAttemptAt, ...(more !== undefined ? { more } : {}) };
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
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
```

Replace it with:

```ts
 *  2C the lines of the printers it writes), less any lease still running. A running lease is being printed (often
 *  by this very tab, Session 2B's direct print), so counting it only kicked the agent into an empty lease after its
 *  ack; a lease that ran out still counts, so the lease call that expires it comes (spec §7.2). Printer jobs are
 *  counted whether or not the device's printer list knows them yet (the 2C gate's review, I-2). Phase 3 (the token
 *  fix's M-2): `tokens` false (a page that cannot print a token job) leaves token jobs out, as its lease does, so a
 *  waiting token no longer kicks it into an empty lease on every pulse. */
export function printJobsForMeFilter(deviceId: string, nowMs: number, tokens = true): FilterQuery<IPrintJob> {
  return {
    targetDeviceId: deviceId,
    ...lineJobs(nowMs),
    ...leaseKindFence(tokens),
    $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(nowMs) } }],
  } as FilterQuery<IPrintJob>;
}

/** The wake's "jobs for me" (spec §7.3), and the pulse's: how many jobs wait for this device, the oldest, and
 *  the printers of the printer jobs among them (Session 2C: an agent whose list lacks one reads its printers). */
export async function readJobsForDevice(deviceId: string, nowMs: number, tokens = true): Promise<PrintJobsForMe> {
  const rows = await PrintJob.find(printJobsForMeFilter(deviceId, nowMs, tokens))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt printerId")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
    nativeProtocol: z.number().int().min(1).max(99).optional(),
  })
  .strict();
```

Replace it with:

```ts
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
    nativeProtocol: z.number().int().min(1).max(99).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs (PRINT_PULSE_TOKENS_PARAM). */
    tokenSlips: z.literal(true).optional(),
  })
  .strict();
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
    sent: z.enum(["no", "maybe"]).optional(),
    permanent: z.literal(true).optional(),
    error: z.string().trim().max(PRINT_ACK_ERROR_MAX_CHARS).optional(),
  })
  .strict()
  .refine(
```

Replace it with:

```ts
    sent: z.enum(["no", "maybe"]).optional(),
    permanent: z.literal(true).optional(),
    error: z.string().trim().max(PRINT_ACK_ERROR_MAX_CHARS).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs, so the answer's `more` counts them. */
    tokenSlips: z.literal(true).optional(),
  })
  .strict()
  .refine(
```

In `apps/cafe/models/PrintDevice.ts`, find:

```ts
  lastSeenAt: Date;
  appVersion?: string;
  nativeProtocol?: number; // the Android bridge version; 1 = one printer only
  createdAt: Date;
  updatedAt: Date;
}
```

Replace it with:

```ts
  lastSeenAt: Date;
  appVersion?: string;
  nativeProtocol?: number; // the Android bridge version; 1 = one printer only
  tokenSlips?: boolean; // Phase 3 (the token fix's M-2): what its last lease said: its page prints "token" jobs
  createdAt: Date;
  updatedAt: Date;
}
```

In `apps/cafe/models/PrintDevice.ts`, find:

```ts
    // Omit-empty: absent until a shell reports it.
    appVersion: { type: String },
    nativeProtocol: { type: Number },
  },
  { timestamps: true },
);
```

Replace it with:

```ts
    // Omit-empty: absent until a shell reports it.
    appVersion: { type: String },
    nativeProtocol: { type: Number },
    // Phase 3 (the token fix's M-2): written by the lease's touch, and only when it changes.
    tokenSlips: { type: Boolean },
  },
  { timestamps: true },
);
```

Create `apps/cafe/scripts/print-host-live/token-fence.ts`:

```ts
/**
 * Phase 3 Session 3A live leg (az) — the token fix's review, M-2, against a REAL MongoDB: a page that cannot print a
 * token job (one from before print-customization S7, whose lease steps over it) is never told `more` for one by an
 * ack, nor counted one by the pulse or the wake, so it no longer pays an empty lease per ack and per pulse while a
 * token waits; a page that prints them is, by its own word or by what its device's last lease said. Run by
 * scripts/verify-print-host-live.ts after leg ay.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { PrintDevice } from "@/models/PrintDevice";
import { readPulseJobsForDevice } from "@/lib/print-agent-server";
import { beatPrintDevice, printDeviceDrawsTokens, touchPrintDevice } from "@/lib/print-device";
import { ackPrintJob, leasePrintJobs, readJobsForDevice } from "@/lib/print-lease";
import { createOrderPrintJobs, openingSlipsOf } from "@/lib/print-order-jobs";
import type { Order as OrderShape } from "@/types";
import { check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost } from "./lifecycle";

const PHONE = "live-fence-phone";
const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };

/** A token order's opening slips (its KOT, then its token), queued for the host. */
async function kotAndToken(nowMs: number): Promise<void> {
  const id = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { tokenNumber: 9 } });
  const order = JSON.parse(JSON.stringify(await Order.findById(id).lean())) as OrderShape;
  await createOrderPrintJobs({ order, slips: openingSlipsOf(order, 1), originDeviceId: PHONE, queuedBy: STAFF, nowMs });
}

/** What the lease route does: the lease, then the device's touch with what the lease said. */
async function routeLease(nowMs: number, tokenSlips: boolean) {
  const got = await leasePrintJobs({ deviceId: HOST, tabId: tokenSlips ? "new-tab" : "old-tab", dismissedBy: STAFF, nowMs, tokenSlips });
  await touchPrintDevice(HOST, nowMs, tokenSlips);
  return got;
}

export async function legAZ(nowMs: number): Promise<void> {
  console.log("\n(az) the token fix's M-2: a page that cannot print a token is never told `more` for one, nor counted one on the pulse or the wake");
  await freshHost(nowMs);
  await beatPrintDevice({ deviceId: HOST, label: "Counter PC", shell: "android", capabilities: CAPS }, nowMs);
  check("(az) a device no lease has spoken for yet counts token jobs, as before", await printDeviceDrawsTokens(HOST));
  check("(az) ... and so does a device with no row at all", await printDeviceDrawsTokens("live-no-such-device"));

  await kotAndToken(nowMs);
  const old = await routeLease(nowMs + 1_000, false);
  const row = await PrintDevice.findOne({ deviceId: HOST }).select("tokenSlips").lean();
  check("(az) a page from before S7 leases the KOT (its lease steps over the token) and its device row keeps what it said", old.jobs[0]?.kind === "kot" && row?.tokenSlips === false);
  const job = old.jobs[0];
  const acked = await ackPrintJob({ id: job?.id ?? "", deviceId: HOST, epoch: job?.epoch ?? 0, outcome: "printed", nowMs: nowMs + 2_000 });
  check("(az) its ack (it says nothing) answers more:false: the waiting token is not for it", acked.status === "printed" && acked.more === false);
  check("(az) its pulse (it says nothing) counts nothing for it", (await readPulseJobsForDevice(HOST, false, nowMs + 3_000)).count === 0);
  check("(az) a page that says ?tokens=1 is counted the token", (await readPulseJobsForDevice(HOST, true, nowMs + 3_000)).count === 1);
  check("(az) the lib's default still counts every kind (the wake of a page that prints tokens)", (await readJobsForDevice(HOST, nowMs + 3_000)).count === 1);
  const empty = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab", dismissedBy: STAFF, nowMs: nowMs + 3_500, tokenSlips: false });
  check("(az) (why it matters: that page's lease would be empty)", empty.jobs.length === 0);

  const reloaded = await routeLease(nowMs + 4_000, true);
  check("(az) the reloaded page leases the token and its device row now says it prints tokens", reloaded.jobs[0]?.kind === "token" && (await printDeviceDrawsTokens(HOST)));
  const before = (await PrintDevice.findOne({ deviceId: HOST }).select("lastSeenAt").lean())?.lastSeenAt.getTime();
  await touchPrintDevice(HOST, nowMs + 5_000, true);
  const after = (await PrintDevice.findOne({ deviceId: HOST }).select("lastSeenAt").lean())?.lastSeenAt.getTime();
  check("(az) the touch writes nothing when the word is unchanged and the heartbeat is not due", before !== undefined && before === after);
  const token = reloaded.jobs[0];
  await ackPrintJob({ id: token?.id ?? "", deviceId: HOST, epoch: token?.epoch ?? 0, outcome: "printed", tokenSlips: true, nowMs: nowMs + 5_000 });

  await kotAndToken(nowMs + 6_000);
  const kot = (await routeLease(nowMs + 7_000, true)).jobs[0];
  const told = await ackPrintJob({ id: kot?.id ?? "", deviceId: HOST, epoch: kot?.epoch ?? 0, outcome: "printed", tokenSlips: true, nowMs: nowMs + 8_000 });
  check("(az) a page that prints tokens is told more:true for the token behind its KOT", told.status === "printed" && told.more === true);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { legAY } from "./print-host-live/token-jobs";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { legAY } from "./print-host-live/token-jobs";
import { legAZ } from "./print-host-live/token-fence";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAX(Date.now());
    // Print customization S7 leg (the customer's token slip: jobs, keys, lease order, eligibility, skew fence).
    await legAY(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAX(Date.now());
    // Print customization S7 leg (the customer's token slip: jobs, keys, lease order, eligibility, skew fence).
    await legAY(Date.now());
    // Phase 3 Session 3A legs (the token fix's M-2 fence; failover, the backup printer, printer health).
    await legAZ(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
print a token slip with its first kitchen ticket. Only a POS page from the
release that added tokens can print that slip. An older page still open never
prints one: the slip waits, visibly, in the waiting-slips panel until a
reloaded page prints it (once, with no DUPLICATE). Nothing is lost, but the
customer gets no slip until then.

- [ ] **Reload first.** The hint under the tokens switch says it: "Before
      turning tokens on, reload every POS screen and restart the Windows app on
```

Replace it with:

```markdown
print a token slip with its first kitchen ticket. Only a POS page from the
release that added tokens can print that slip. An older page still open never
prints one: the slip waits, visibly, in the waiting-slips panel until a
reloaded page prints it within 30 minutes (once, with no DUPLICATE); after
that, Print now in the panel prints it. Nothing is lost, but the customer gets
no slip until then.

- [ ] **Reload first.** The hint under the tokens switch says it: "Before
      turning tokens on, reload every POS screen and restart the Windows app on
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
/** Session 2C (plan decision 7): this device's own bill printer (an id), chosen on the device (Session 2D). An
 *  unknown, switched-off or unusable one means the default bill printer; it never refuses the order write. */
export const PRINT_BILL_PRINTER_HEADER = "x-pos-bill-printer";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
```

Replace it with:

```ts
/** Session 2C (plan decision 7): this device's own bill printer (an id), chosen on the device (Session 2D). An
 *  unknown, switched-off or unusable one means the default bill printer; it never refuses the order write. */
export const PRINT_BILL_PRINTER_HEADER = "x-pos-bill-printer";
/** Phase 3 (the token fix's review, M-2): a page that can print a "token" job says so on the pulse (`?tokens=1`), and as
 *  `tokenSlips: true` on the wake and the ack, as its lease already does. The jobs-for-me count and the ack's `more`
 *  then skip token jobs only for a page that cannot print them (one from before print-customization S7, whose lease
 *  steps over them), so it no longer pays an empty lease per ack and per pulse while a token waits. A request that does
 *  not say (any page from before Phase 3) is answered by what the device's last lease said (PrintDevice.tokenSlips). */
export const PRINT_PULSE_TOKENS_PARAM = "tokens";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lease.test.ts lib/print-lifecycle-paths.test.ts lib/print-order-jobs.test.ts lib/print-attention.test.ts lib/tokens-settings-paths.test.ts lib/go-live-runbook.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 163`; `# pass 163`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-lease.ts lib/print-device.ts lib/print-agent-server.ts lib/print-lifecycle-schemas.ts app/api/order-requests/pulse/route.ts app/api/print-jobs/wake/route.ts app/api/print-jobs/lease/route.ts models/PrintDevice.ts components/settings/TokenSettingsFields.tsx scripts/print-host-live/token-fence.ts scripts/verify-print-host-live.ts lib/print-lease.test.ts lib/print-lifecycle-paths.test.ts lib/print-order-jobs.test.ts lib/print-attention.test.ts && echo LINT_OK`
Expected: `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3a npm run verify:print:live 2>&1 | grep -E "passed,|FAIL"`
Expected: `373 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/order-requests/pulse/route.ts apps/cafe/app/api/print-jobs/lease/route.ts apps/cafe/app/api/print-jobs/wake/route.ts apps/cafe/components/settings/TokenSettingsFields.tsx apps/cafe/lib/print-agent-server.ts apps/cafe/lib/print-attention.test.ts apps/cafe/lib/print-device.ts apps/cafe/lib/print-lease.test.ts apps/cafe/lib/print-lease.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-lifecycle-schemas.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/models/PrintDevice.ts apps/cafe/scripts/print-host-live/token-fence.ts apps/cafe/scripts/verify-print-host-live.ts docs/GO-LIVE-CHECKLIST.md packages/shared/src/print-agent-wire.ts
git commit -m "fix(print): the token kind fence on the ack's more and on jobs-for-me; the runbook's 30 minutes; the Tokens page comment (Phase 3 Session 3A, A0)"
```

---

### Task A1: the shared rules: who writes a printer now, the 5-minute skip, the backup printer, health and a printer's problem

**Files:**
- Create: `packages/shared/src/print-failover.ts`
- Modify: `packages/shared/src/print-printers.ts` (`PrinterConfig` gains `backupPrinterId`, `unreachable`, `health`), `packages/shared/src/print-agent-wire.ts` (`PrintDeviceCapabilities.lanFailover`, `PrintAttentionRow.problem`, `PRINT_ACK_UNREACHABLE`)
- Tests: `packages/shared/src/print-failover.test.ts` (create; `packages/shared/package.json` `test` gains it)

**Interfaces produced:** `PRINTER_UNREACHABLE_SKIP_MS`, `PrinterUnreachable`, `PRINTER_LINK_STATES`/`PrinterLinkState`, `PRINTER_PAPER_STATES`/`PrinterPaperState`, `PRINTER_COVER_STATES`/`PrinterCoverState`, `PrinterHealthReport`, `PrinterHealth`, `PRINTER_HEALTH_REFRESH_MS`, `PRINTER_HEALTH_STALE_MS`, `PrinterFailover { online: ReadonlyArray<{ deviceId; lanFailover }>; nowMs }`, `printerSkippedWriters(printer, nowMs): string[]`, `printerActiveWriter(printer, failover | null): string | null`, `printerWriterOnline(printer, failover): boolean`, `PRINTER_BACKUP_SELF_MESSAGE`, `PRINTER_BACKUP_UNKNOWN_MESSAGE`, `printerBackupOf(printers, printer): PrinterConfig | null`, `PRINTER_PROBLEMS`/`PrinterProblem`, `printerProblemOf(printer, failover): PrinterProblem | null`, `printerProblemText(name, problem): string` (`@pos/shared/print-failover`); `PRINT_ACK_UNREACHABLE` (`@pos/shared/print-agent-wire`).

**Pure and client-safe**, one module for Phase 3's rules (decisions P3-1, P3-3, P3-5, P3-6, P3-7). The server uses it in A2–A4, and the page in 3B (the words, the problem).

**`printerActiveWriter`** is spec §9.3:

- a device printer is its own device's;

- a network printer is its primary's while the primary is online and not skipped;

- otherwise it goes to the first online device that says `lanFailover` and is not skipped, by device id;

- otherwise it stays the primary's;

- without a failover read (null), it is Phase 2's setup writer.

**`printerProblemOf`**:

- the writer now offline gives `device-offline`;

- otherwise it reads the worst of a fresh report made by that writer (paper out, cover open, error, not connected, paper low).

- [ ] **Step 1: The failing tests first**

In `packages/shared/package.json`, find:

```json
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/codec.test.ts src/api-client.test.ts src/ttl-guard.test.ts src/schemas/table.schema.test.ts src/schemas/order.schema.test.ts src/order-idem.test.ts src/schemas/order-charge.schema.test.ts src/schemas/settings.schema.test.ts src/schemas/settings-templates.schema.test.ts src/schemas/due-payment.schema.test.ts src/schemas/product.schema.test.ts src/schemas/public-order.schema.test.ts src/schemas/object-id.schema.test.ts src/product-import.test.ts src/utils.test.ts src/slip-day.test.ts src/public.test.ts src/self-order-alert.test.ts src/telegram-alert.test.ts src/appearance-contrast.test.ts src/appearance.test.ts src/print-job.test.ts src/public-diner.test.ts src/cache.test.ts src/loyalty-rules.test.ts src/schemas/settings-loyalty.schema.test.ts src/appearance-theme-override.test.ts src/reward-redemption.test.ts src/promo-ttl.test.ts src/modifiers.test.ts src/product-icons.test.ts src/schemas/product-bulk.schema.test.ts src/schemas/category.schema.test.ts src/schemas/area.schema.test.ts src/print-host-printer.test.ts src/print-lifecycle.test.ts src/print-budget.test.ts src/print-template.test.ts src/print-template-qr.test.ts src/print-template-locks.test.ts src/print-qr.test.ts src/print-template-read.test.ts src/print-printers.test.ts"
  },
  "dependencies": {
    "clsx": "^2.1.1",
```

Replace it with:

```json
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/codec.test.ts src/api-client.test.ts src/ttl-guard.test.ts src/schemas/table.schema.test.ts src/schemas/order.schema.test.ts src/order-idem.test.ts src/schemas/order-charge.schema.test.ts src/schemas/settings.schema.test.ts src/schemas/settings-templates.schema.test.ts src/schemas/due-payment.schema.test.ts src/schemas/product.schema.test.ts src/schemas/public-order.schema.test.ts src/schemas/object-id.schema.test.ts src/product-import.test.ts src/utils.test.ts src/slip-day.test.ts src/public.test.ts src/self-order-alert.test.ts src/telegram-alert.test.ts src/appearance-contrast.test.ts src/appearance.test.ts src/print-job.test.ts src/public-diner.test.ts src/cache.test.ts src/loyalty-rules.test.ts src/schemas/settings-loyalty.schema.test.ts src/appearance-theme-override.test.ts src/reward-redemption.test.ts src/promo-ttl.test.ts src/modifiers.test.ts src/product-icons.test.ts src/schemas/product-bulk.schema.test.ts src/schemas/category.schema.test.ts src/schemas/area.schema.test.ts src/print-host-printer.test.ts src/print-lifecycle.test.ts src/print-budget.test.ts src/print-template.test.ts src/print-template-qr.test.ts src/print-template-locks.test.ts src/print-qr.test.ts src/print-template-read.test.ts src/print-printers.test.ts src/print-failover.test.ts"
  },
  "dependencies": {
    "clsx": "^2.1.1",
```

Create `packages/shared/src/print-failover.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRINTER_BACKUP_SELF_MESSAGE,
  PRINTER_HEALTH_REFRESH_MS,
  PRINTER_HEALTH_STALE_MS,
  PRINTER_PROBLEMS,
  PRINTER_UNREACHABLE_SKIP_MS,
  printerActiveWriter,
  printerBackupOf,
  printerProblemOf,
  printerProblemText,
  printerSkippedWriters,
  printerWriterOnline,
  type PrinterFailover,
} from "./print-failover";
import type { PrinterConfig } from "./print-printers";

// Printing Phase 3 Session 3A (spec §9.3, §9.4, §10): the shared rules of failover, the backup printer and printer
// health. The server's use of them is proven live (npm run verify:print:live, legs ba–bc).

const T0 = Date.parse("2026-10-07T12:00:00.000Z");
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
const at = (ms: number): string => new Date(T0 + ms).toISOString();

function lan(id: string, primary: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name: `Printer ${id}`, connection: { kind: "lan", host: "10.0.0.9", port: 9100 }, primaryDeviceId: primary, order: 0, paper: 80, slips: { ...NO_SLIPS, kotAll: true }, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

function bt(id: string, device: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { ...lan(id, "", over), connection: { kind: "device", deviceId: device, transport: "bt-classic", address: "AA:BB" }, primaryDeviceId: undefined, ...over };
}

function failover(online: Array<[string, boolean]>, nowMs = T0): PrinterFailover {
  return { online: online.map(([deviceId, lanFailover]) => ({ deviceId, lanFailover })), nowMs };
}

test("constants: a skip lasts 5 minutes; health is refreshed every 5 minutes and stale after 10", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 300_000);
  assert.equal(PRINTER_HEALTH_REFRESH_MS, 300_000);
  assert.equal(PRINTER_HEALTH_STALE_MS, 600_000);
  assert.deepEqual([...PRINTER_PROBLEMS], ["device-offline", "paper-out", "cover-open", "error", "offline", "paper-low"], "worst first");
});

test("printerActiveWriter: a device printer is its own device's, whoever is online", () => {
  assert.equal(printerActiveWriter(bt("b", "bar"), null), "bar");
  assert.equal(printerActiveWriter(bt("b", "bar"), failover([["counter", true]])), "bar", "never failed over");
});

test("printerActiveWriter: a network printer's primary while it is online; with no failover read, the primary as in Phase 2", () => {
  const kitchen = lan("k", "kitchen");
  assert.equal(printerActiveWriter(kitchen, null), "kitchen");
  assert.equal(printerActiveWriter(kitchen, failover([["kitchen", true], ["counter", true]])), "kitchen");
});

test("printerActiveWriter: with its primary offline, the first online device that can write network printers, by id; never one that cannot", () => {
  const kitchen = lan("k", "kitchen");
  assert.equal(printerActiveWriter(kitchen, failover([["zz-counter", true], ["aa-bar", true]])), "aa-bar", "the same pick on every instance");
  assert.equal(printerActiveWriter(kitchen, failover([["old-page", false]])), "kitchen", "a page from before Phase 3 never takes it over: the slips wait for the primary");
  assert.equal(printerActiveWriter(kitchen, failover([])), "kitchen", "nobody online: the primary still");
});

test("printerActiveWriter: a writer that could not reach it is skipped for 5 minutes, primary or not", () => {
  const skipKitchen = lan("k", "kitchen", { unreachable: [{ deviceId: "kitchen", until: at(PRINTER_UNREACHABLE_SKIP_MS) }] });
  const both = failover([["kitchen", true], ["counter", true]]);
  assert.equal(printerActiveWriter(skipKitchen, both), "counter", "the primary skipped, the counter takes it");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_SKIP_MS)), "kitchen", "back to the primary when its 5 minutes are up");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true]])), "kitchen", "no one else: the primary keeps it");
  const skipCounter = lan("k", "kitchen", { unreachable: [{ deviceId: "counter", until: at(60_000) }] });
  assert.equal(printerActiveWriter(skipCounter, failover([["counter", true], ["bar", true]])), "bar", "the skipped candidate is passed over");
  assert.equal(printerActiveWriter(skipCounter, failover([["counter", true]])), "kitchen", "every candidate skipped: the primary keeps it");
});

test("printerSkippedWriters / printerWriterOnline", () => {
  const printer = lan("k", "kitchen", { unreachable: [{ deviceId: "a", until: at(1) }, { deviceId: "b", until: at(0) }] });
  assert.deepEqual(printerSkippedWriters(printer, T0), ["a"], "a skip that ran out is gone");
  assert.equal(printerWriterOnline(lan("k", "kitchen"), failover([["kitchen", true]])), true);
  assert.equal(printerWriterOnline(lan("k", "kitchen"), failover([["old-page", false]])), false, "its writer now is the offline primary");
  assert.equal(printerWriterOnline(bt("b", "bar"), failover([["counter", true]])), false);
});

test("printerBackupOf: a routable other printer, or null", () => {
  const counter = lan("c", "counter", { slips: { ...NO_SLIPS, bill: true } });
  const off = lan("o", "counter", { enabled: false });
  const printers = [counter, off];
  assert.equal(printerBackupOf(printers, bt("b", "bar", { backupPrinterId: "c" }))?.id, "c");
  assert.equal(printerBackupOf(printers, bt("b", "bar")), null, "none set");
  assert.equal(printerBackupOf(printers, { id: "c", backupPrinterId: "c" }), null, "never itself");
  assert.equal(printerBackupOf(printers, bt("b", "bar", { backupPrinterId: "o" })), null, "switched off");
  assert.equal(printerBackupOf(printers, bt("b", "bar", { backupPrinterId: "gone" })), null, "deleted");
  assert.match(PRINTER_BACKUP_SELF_MESSAGE, /own backup/);
});

test("printerProblemOf: the device offline first; then what its writer reported, while fresh and from that writer", () => {
  const health = (over: Partial<NonNullable<PrinterConfig["health"]>>) => ({ link: "connected" as const, deviceId: "bar", at: at(0), ...over });
  const online = failover([["bar", true]]);
  assert.equal(printerProblemOf(bt("b", "bar"), failover([["counter", true]])), "device-offline");
  assert.equal(printerProblemOf(bt("b", "bar"), online), null, "online, nothing reported");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ paper: "out", cover: "open" }) }), online), "paper-out", "worst first");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ cover: "open", link: "disconnected" }) }), online), "cover-open");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ error: true }) }), online), "error");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ link: "disconnected" }) }), online), "offline");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ paper: "low" }) }), online), "paper-low");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ link: "connecting" }) }), online), null, "connecting is not a problem yet");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ paper: "out", at: at(-PRINTER_HEALTH_STALE_MS - 1) }) }), online), null, "a stale report says nothing");
  assert.equal(printerProblemOf(bt("b", "bar", { health: health({ paper: "out", deviceId: "old-writer" }) }), online), null, "a report from another device says nothing");
  const kitchen = lan("k", "kitchen", { health: { link: "connected", paper: "out", deviceId: "kitchen", at: at(0) } });
  assert.equal(printerProblemOf(kitchen, failover([["counter", true]])), null, "a network printer the counter took over: the primary's old report says nothing");
});

test("printerProblemText: the words every device shows", () => {
  assert.deepEqual(
    PRINTER_PROBLEMS.map((problem) => printerProblemText("Kitchen", problem)),
    [
      "The device that prints Kitchen is offline.",
      "Kitchen is out of paper.",
      "Kitchen has its cover open.",
      "Kitchen reports an error. Check it, then switch it off and on.",
      "Kitchen is not connected.",
      "Kitchen is low on paper.",
    ],
  );
});
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  type PrintJobKind,
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobLabel, PrintJobRefusal } from "./print-lifecycle";
import { printerWriterDevices, printersModeOn, type PrinterConfig } from "./print-printers";
import type { PrintJobPayload } from "./schemas/print-job.schema";
```

Replace it with:

```ts
  type PrintJobKind,
  type PrintJobStatus,
} from "./print-job";
import type { PrinterProblem } from "./print-failover";
import type { PrintJobLabel, PrintJobRefusal } from "./print-lifecycle";
import { printerWriterDevices, printersModeOn, type PrinterConfig } from "./print-printers";
import type { PrintJobPayload } from "./schemas/print-job.schema";
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  approved?: true;
  /** Session 2C (printers mode): the job's printer, so the panel can name it. */
  printerId?: string;
}

/** The feed is one bounded read on the hottest poll, within the queued retention (§7.8): the NEWEST rows
```

Replace it with:

```ts
  approved?: true;
  /** Session 2C (printers mode): the job's printer, so the panel can name it. */
  printerId?: string;
  /** Phase 3 (spec §9.4, §10): why that printer cannot print now (its device is offline, it is out of paper, ...), so
   *  every device's panel says it beside the slip; absent when none is known. */
  problem?: PrinterProblem;
}

/** The feed is one bounded read on the hottest poll, within the queued retention (§7.8): the NEWEST rows
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  windowsPrinters: boolean;
  webSerial: boolean;
  webBluetooth: boolean;
}

/** Without a healthy socket an agent polls fast only this long after it last saw a job (spec §9.1). */
```

Replace it with:

```ts
  windowsPrinters: boolean;
  webSerial: boolean;
  webBluetooth: boolean;
  /** Phase 3 (spec §9.3): this page can write any network printer the setup names, not only its own (the POS app on
   *  bridge v2; the Windows app from 1.12.0), so it may take one over while its primary is offline. A page from before
   *  Phase 3 never says it, and is never chosen. */
  lanFailover?: boolean;
}

/** Without a healthy socket an agent polls fast only this long after it last saw a job (spec §9.1). */
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
 *  never guessed onto another printer (staff print the slip again from its order). */
export type PrintJobActionRefusal = PrintJobRefusal | "not-found" | "raced" | "printer-gone";

export interface PrintAckData {
  applied: boolean;
  status: PrintJobStatus | null;
```

Replace it with:

```ts
 *  never guessed onto another printer (staff print the slip again from its order). */
export type PrintJobActionRefusal = PrintJobRefusal | "not-found" | "raced" | "printer-gone";

/** Phase 3 (spec §9.3): the ack's `reason` when a writer could not reach a network printer before any byte (a failed
 *  connect): the server skips that writer for that printer for 5 minutes, so another writer gets the next lease. */
export const PRINT_ACK_UNREACHABLE = "unreachable";

export interface PrintAckData {
  applied: boolean;
  status: PrintJobStatus | null;
```

Create `packages/shared/src/print-failover.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Printing redesign, Phase 3 (docs/superpowers/specs/2026-10-02-printing-
// reliability-design.md §9.3, §9.4, §10): failover, the backup printer and
// printer health, the shared rules. The server decides which device writes a
// printer now (apps/cafe/lib/print-failover.ts: the lease, job creation, the
// sweep), moves a printer's waiting slips to its backup (the sweep), keeps the
// health its writer reports (the wake), and every device shows a printer's
// problem beside the slips that wait for it (the pulse's waiting-slips feed).
// Pure and client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import { printerWriterDeviceId, routablePrinterOf, type PrinterConfig } from "./print-printers";

/** §9.3: a writer that could not reach a network printer is skipped for it this long, so another writer gets its next
 *  lease (and the skipped one tries again after it, the same 5 minutes Phase 1's refusal rules allow a dead printer). */
export const PRINTER_UNREACHABLE_SKIP_MS = 5 * 60 * 1000;

/** §9.3: one writer that could not reach a network printer, and until when (ISO, server time) it is skipped for it. */
export interface PrinterUnreachable {
  deviceId: string;
  until: string;
}

export const PRINTER_LINK_STATES = ["connected", "connecting", "disconnected"] as const;
export type PrinterLinkState = (typeof PRINTER_LINK_STATES)[number];
export const PRINTER_PAPER_STATES = ["ok", "low", "out"] as const;
export type PrinterPaperState = (typeof PRINTER_PAPER_STATES)[number];
export const PRINTER_COVER_STATES = ["closed", "open"] as const;
export type PrinterCoverState = (typeof PRINTER_COVER_STATES)[number];

/** §10: one printer's health as its writer reports it on the wake (the heartbeat: no request of its own). `paper`,
 *  `cover` and `error` come from DLE EOT where the printer answers it (the POS app from Session 3C, the Windows app's
 *  network printers from Session 3E); they are absent where it cannot (BLE, the Windows spooler, an older app). */
export interface PrinterHealthReport {
  printerId: string;
  link: PrinterLinkState;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
}

/** §10: what the server keeps of a printer's last report: the report, the device that sent it, and when. */
export interface PrinterHealth {
  link: PrinterLinkState;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
  deviceId: string;
  at: string;
}

/** §10, §17: a printer's health is written when it changes, and a steady one again at most this often, so it stays fresh
 *  while its writer keeps reporting (a few writes a printer an hour). A report older than PRINTER_HEALTH_STALE_MS, or
 *  from a device that no longer writes the printer, says nothing. */
export const PRINTER_HEALTH_REFRESH_MS = 5 * 60 * 1000;
export const PRINTER_HEALTH_STALE_MS = 2 * PRINTER_HEALTH_REFRESH_MS;

/** §9.3: the devices online now (a heartbeat within PRINT_DEVICE_ONLINE_MS) and whether each can write any network
 *  printer the setup names (PrintDeviceCapabilities.lanFailover: the POS app on bridge v2, the Windows app from 1.12.0),
 *  at server time `nowMs`. */
export interface PrinterFailover {
  online: ReadonlyArray<{ deviceId: string; lanFailover: boolean }>;
  nowMs: number;
}

type WriterOf = Pick<PrinterConfig, "connection" | "primaryDeviceId" | "unreachable">;

/** The writers a network printer skips now (§9.3): those whose 5 minutes have not run out. */
export function printerSkippedWriters(printer: Pick<PrinterConfig, "unreachable">, nowMs: number): string[] {
  return (printer.unreachable ?? []).filter((skip) => Date.parse(skip.until) > nowMs).map((skip) => skip.deviceId);
}

/** The device that writes this printer NOW (§9.3). A device printer: its own device, always. A network printer: its
 *  primary while that device is online and has reached it; otherwise the first online device that can write network
 *  printers and has not failed to reach this one in the last 5 minutes (by device id, so every server instance and
 *  every request picks the same one); with none, its primary still (its slips wait for it, visibly). Without a
 *  failover read (null), the setup's writer, exactly as in Phase 2. */
export function printerActiveWriter(printer: WriterOf, failover: PrinterFailover | null): string | null {
  const configured = printerWriterDeviceId(printer);
  if (failover === null || printer.connection.kind !== "lan") return configured;
  const skipped = printerSkippedWriters(printer, failover.nowMs);
  const online = (deviceId: string): boolean => failover.online.some((device) => device.deviceId === deviceId);
  if (configured !== null && online(configured) && !skipped.includes(configured)) return configured;
  const others = failover.online
    .filter((device) => device.lanFailover && device.deviceId !== configured && !skipped.includes(device.deviceId))
    .map((device) => device.deviceId)
    .sort();
  return others[0] ?? configured;
}

/** §9.4: whether the device that writes this printer now is online (a heartbeat within 90 s). */
export function printerWriterOnline(printer: WriterOf, failover: PrinterFailover): boolean {
  const writer = printerActiveWriter(printer, failover);
  return writer !== null && failover.online.some((device) => device.deviceId === writer);
}

export const PRINTER_BACKUP_SELF_MESSAGE = "A printer cannot be its own backup. Choose another printer.";
export const PRINTER_BACKUP_UNKNOWN_MESSAGE = "The backup printer no longer exists. Reload and choose again.";

/** §9.4: this printer's backup, while routing may still send it slips (enabled, with a writer, taking a slip); null
 *  with none, with itself, or with one deleted or switched off. */
export function printerBackupOf(printers: readonly PrinterConfig[], printer: Pick<PrinterConfig, "id" | "backupPrinterId">): PrinterConfig | null {
  if (printer.backupPrinterId === undefined || printer.backupPrinterId === printer.id) return null;
  return routablePrinterOf(printers, printer.backupPrinterId);
}

/** §9.4, §10: why a printer cannot print now, worst first: its device is offline; it is out of paper; its cover is open;
 *  it reports an error; it is not connected; and, a warning only, it is low on paper. */
export const PRINTER_PROBLEMS = ["device-offline", "paper-out", "cover-open", "error", "offline", "paper-low"] as const;
export type PrinterProblem = (typeof PRINTER_PROBLEMS)[number];

/** The printer's problem now, or null when none is known: the device that writes it now is offline (§9.4: the
 *  "device is offline" alert); else the worst thing that device last reported, while that report is fresh. */
export function printerProblemOf(printer: WriterOf & Pick<PrinterConfig, "health">, failover: PrinterFailover): PrinterProblem | null {
  const writer = printerActiveWriter(printer, failover);
  if (writer === null) return null;
  if (!failover.online.some((device) => device.deviceId === writer)) return "device-offline";
  const health = printer.health;
  if (health === undefined || health.deviceId !== writer || failover.nowMs - Date.parse(health.at) > PRINTER_HEALTH_STALE_MS) return null;
  if (health.paper === "out") return "paper-out";
  if (health.cover === "open") return "cover-open";
  if (health.error === true) return "error";
  if (health.link === "disconnected") return "offline";
  if (health.paper === "low") return "paper-low";
  return null;
}

/** The words every device shows for a printer's problem, beside the slips that wait for it (no jargon). */
export function printerProblemText(name: string, problem: PrinterProblem): string {
  switch (problem) {
    case "device-offline":
      return `The device that prints ${name} is offline.`;
    case "paper-out":
      return `${name} is out of paper.`;
    case "cover-open":
      return `${name} has its cover open.`;
    case "error":
      return `${name} reports an error. Check it, then switch it off and on.`;
    case "offline":
      return `${name} is not connected.`;
    case "paper-low":
      return `${name} is low on paper.`;
  }
}
```

In `packages/shared/src/print-printers.ts`, find:

```ts
// setup screens and the agent read these same shapes and rules. Pure and
// client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

/** A station's name prints on every KOT it gets (§8, D7), so it stays short. */
export const STATION_NAME_MAX_CHARS = 32;
```

Replace it with:

```ts
// setup screens and the agent read these same shapes and rules. Pure and
// client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrinterHealth, PrinterUnreachable } from "./print-failover";

/** A station's name prints on every KOT it gets (§8, D7), so it stays short. */
export const STATION_NAME_MAX_CHARS = 32;
```

In `packages/shared/src/print-printers.ts`, find:

```ts
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
}

/** The one device that writes to this printer (§9.3): a device printer's own device, or a LAN printer's
 *  primary. null: a LAN printer nobody writes to yet, so nothing is routed to it. */
export function printerWriterDeviceId(printer: Pick<PrinterConfig, "connection" | "primaryDeviceId">): string | null {
  if (printer.connection.kind === "device") return printer.connection.deviceId;
  return printer.primaryDeviceId ?? null;
```

Replace it with:

```ts
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  /** Phase 3 (§9.4): the printer that takes this one's waiting slips while its device is offline (BACKUP PRINTER). */
  backupPrinterId?: string;
  /** Phase 3 (§9.3), kept by the server: the writers that could not reach this network printer lately (print-failover.ts). */
  unreachable?: PrinterUnreachable[];
  /** Phase 3 (§10), kept by the server: the health its writer last reported on the wake. */
  health?: PrinterHealth;
}

/** The one device that writes to this printer (§9.3): a device printer's own device, or a LAN printer's
 *  primary. null: a LAN printer nobody writes to yet, so nothing is routed to it. Phase 3: the setup's writer; who
 *  writes it NOW (a network printer taken over while its primary is offline) is print-failover.ts's printerActiveWriter. */
export function printerWriterDeviceId(printer: Pick<PrinterConfig, "connection" | "primaryDeviceId">): string | null {
  if (printer.connection.kind === "device") return printer.connection.deviceId;
  return printer.primaryDeviceId ?? null;
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts src/print-printers.test.ts src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && cd /d/kd/lucifer/packages/shared && npx tsc --noEmit && echo SHARED_TSC_OK`
Expected: `# tests 63`; `# pass 63`; `# fail 0`; `SHARED_TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 813`; `# pass 813`; `# fail 0`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/package.json packages/shared/src/print-agent-wire.ts packages/shared/src/print-failover.test.ts packages/shared/src/print-failover.ts packages/shared/src/print-printers.ts
git commit -m "feat(print): the shared rules of failover, the backup printer and printer health (Phase 3 Session 3A, A1)"
```

---

### Task A2: failover on the server: the device that writes a printer now, everywhere; the 5-minute skip

**Files:**
- Create: `apps/cafe/lib/print-failover.ts` (`readPrinterFailover`, `retargetPrinterJobs`, `recordPrinterUnreachable`)
- Modify: `apps/cafe/models/Printer.ts` (`unreachable`), `models/PrintDevice.ts` (`capabilities.lanFailover`), `lib/print-device.ts` (`readOnlinePrintDevices`), `lib/print-printers.ts` (the wire's `unreachable`), `lib/print-lifecycle-schemas.ts` (`lanFailover`; the ack's `reason`)
- Modify: `apps/cafe/lib/print-lease.ts` (the lease: the writer now; the ack: "unreachable"), `lib/print-routing-context.ts` + `lib/print-printer-routing.ts` (creation: the writer now), `lib/print-order-jobs.ts` + `lib/print-printer-jobs.ts` (`nowMs` to the routing read), `lib/print-sweep.ts`, `lib/print-job-actions.ts` (a staff Retry), `lib/print-printer-test.ts` (a Test print)
- Modify: `packages/shared/src/print-budget.ts` (`printUnreachableRequestsPerWriterPerDay`)
- Create: `apps/cafe/scripts/print-host-live/failover.ts` (leg ba, and the outlet helpers legs bb and bc share); modify `scripts/verify-print-host-live.ts`
- Tests: `packages/shared/src/print-budget.test.ts` (a pin, new); `apps/cafe/lib/print-printer-routing.test.ts` (a test, new); `lib/print-lifecycle-paths.test.ts` (schema asserts; four pins' lines changed); `lib/print-printer-test.test.ts` (one pin's line changed); `lib/self-order-alert-paths.test.ts` (the PrintJob writers' list gains `print-failover.ts`)

**Interfaces produced:** `readPrinterFailover(printers, nowMs, backups = false): Promise<PrinterFailover | null>`, `retargetPrinterJobs(printerId, writer, nowMs): Promise<number>`, `recordPrinterUnreachable({ printerId, deviceId, nowMs }): Promise<string | null>` (`lib/print-failover.ts`); `readOnlinePrintDevices(nowMs): Promise<PrinterFailover["online"]>` (`lib/print-device.ts`); `PrintRouting.failover?`; `readPrintRouting({ productIds, billPrinterId?, nowMs? })`; `printUnreachableRequestsPerWriterPerDay()` (`@pos/shared/print-budget`); live helpers `online`, `offline`, `failoverOutlet`, `kotOf`, `KITCHEN`, `COUNTER`, `BAR` (`scripts/print-host-live/failover.ts`).

**One question, asked the same way everywhere: who writes this printer now?** (P3-1.)

- **Job creation.** The routing read adds who is online, one small read beside the stations, only when a network printer is set up. Each job is aimed at the writer now, and direct print to the asking tab follows it.

- **The lease.** A device leases a printer's line when it is that printer's writer now. The who-is-online read is made only when the device names a network printer it is not the primary of, or one a writer could not reach lately, so a Phase 2 page costs nothing more.

- **A staff Retry and a Test print** go to the writer now.

- **The sweep** moves each printer's waiting slips to its writer now, and tells that writer of its line's head when any moved (one realtime request, so it leases at once instead of at its next pulse).

**The 5-minute skip** (P3-3). An ack `failed, sent:"no", reason:"unreachable"` from the printer's writer now records `{ deviceId, until }` on the printer, in one pipeline write that also drops expired skips. When another device takes the printer over, its waiting slips move at once.

**Dormant** until a page says `lanFailover` (3B) or acks "unreachable": with no such device, every printer's writer now is its setup writer, exactly as in Phase 2.

**Changed existing pins** (each follows this deliberate change):

- `print-lifecycle-paths.test.ts`:

  - "PIN (2C): the sweep moves a waiting printer job only with its printer…" (the writer now, through `retargetPrinterJobs`);

  - "PIN (2C ruling R2): Retry or Print again…" (the printers read once; the writer now);

  - "PIN (2C): a lease takes the head…" (the writer now; the conditional read);

  - "PIN (2B): an ack that takes a job off the line…" (the queued branch records "unreachable").

- `print-printer-test.test.ts` "PIN (2D): a test slip goes on its printer's line…" (the writer now).

- `self-order-alert-paths.test.ts` "PIN: the exact set of apps/cafe production files that write PrintJob…" (it gains `apps/cafe/lib/print-failover.ts`, re-audited: it moves only waiting printer jobs, never a leased or claimed one).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
      'status: { $in: ["queued", "needs-confirm"] } })',
      "if (waiting === null) return { retargeted: 0, failed: 0 };",
      "const printers = routablePrinters(await listPrinters());",
      "{ printerId: printer.id, status: { $in: WAITING }, targetDeviceId: { $ne: writer } }",
      "{ printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: \"queued\" }",
      "$set: { status: \"failed\", lastError: PRINTER_GONE_MESSAGE }",
    ],
```

Replace it with:

```ts
      'status: { $in: ["queued", "needs-confirm"] } })',
      "if (waiting === null) return { retargeted: 0, failed: 0 };",
      "const printers = routablePrinters(await listPrinters());",
      // Phase 3 (§9.3) deliberately changed the move: the writer now (failover), through print-failover.ts's one write.
      "const failover = await readPrinterFailover(printers, nowMs);",
      'retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);',
      "{ printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: \"queued\" }",
      "$set: { status: \"failed\", lastError: PRINTER_GONE_MESSAGE }",
    ],
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
    s,
    [
      'if (plan.patch.status === "queued" && row.printerId !== undefined) {',
      "const printer = routablePrinterOf(await listPrinters(), row.printerId);",
      'if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };',
      "target = printerWriterDeviceId(printer) ?? target;",
      "patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };",
      "if (await applyPrintJobPlan(row._id, job, patch)) {",
    ],
```

Replace it with:

```ts
    s,
    [
      'if (plan.patch.status === "queued" && row.printerId !== undefined) {',
      "const printers = await listPrinters();",
      "const printer = routablePrinterOf(printers, row.printerId);",
      'if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };',
      // Phase 3 (§9.3) deliberately changed it: the printer's writer now (a network printer taken over).
      "target = printerActiveWriter(printer, await readPrinterFailover([printer], nowMs)) ?? target;",
      "patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };",
      "if (await applyPrintJobPlan(row._id, job, patch)) {",
    ],
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: false }), false, "absent, never false");
});

test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
```

Replace it with:

```ts
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: false }), false, "absent, never false");
  // Phase 3 (§9.3): "unreachable" is only a refusal before any byte (a failed connect).
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", reason: "unreachable" }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", reason: "unreachable" }), false, "a byte may have gone: not unreachable");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", permanent: true, reason: "unreachable" }), false, "a permanent failure is not about reaching it");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", reason: "unreachable" }), false);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", reason: "offline" }), false, "the one reason only");
});

test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, fax: true } }).success, false, "strict capabilities");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: true }).success, true, "Phase 3 (M-2): a page that prints token slips");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: false }).success, false, "absent, never false");
});

const ROUTES = {
```

Replace it with:

```ts
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, fax: true } }).success, false, "strict capabilities");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: true }).success, true, "Phase 3 (M-2): a page that prints token slips");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: false }).success, false, "absent, never false");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, lanFailover: true } }).success, true, "Phase 3 (§9.3): it may take a network printer over");
});

const ROUTES = {
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
    ack,
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };',
      "const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));",
      "const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(",
      "() => undefined,",
```

Replace it with:

```ts
    ack,
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") {',
      "if (input.reason === PRINT_ACK_UNREACHABLE && input.sent === \"no\" && row.printerId !== undefined) {",
      "await recordPrinterUnreachable({ printerId: row.printerId, deviceId: input.deviceId, nowMs: input.nowMs }).catch(() => null);",
      "return { applied: true, status: plan.patch.status, nextAttemptAt };",
      "const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));",
      "const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(",
      "() => undefined,",
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
    lease,
    [
      "[{ line: { ...printJobLineFilter(input.deviceId, input.nowMs), ...kindFence }, fence: { targetDeviceId: input.deviceId } }];",
      "for (const printer of routablePrinters(await listPrinters())) {",
      "if (input.printerIds.includes(printer.id) && printerWriterDeviceId(printer) === input.deviceId) {",
      "lines.push({ line: { ...printerLineFilter(printer.id, input.nowMs), ...kindFence }, fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });",
      "const result = await leaseLineHead(line, fence, input, claim);",
    ],
```

Replace it with:

```ts
    lease,
    [
      "[{ line: { ...printJobLineFilter(input.deviceId, input.nowMs), ...kindFence }, fence: { targetDeviceId: input.deviceId } }];",
      // Phase 3 (§9.3) deliberately changed the writer check: the device that writes it now, with one read of who is
      // online only when this device names a network printer it is not the primary of, or one a writer could not reach.
      "const printers = routablePrinters(await listPrinters());",
      "const asked = printers.filter((printer) => named.includes(printer.id));",
      'printer.connection.kind === "lan" && (printer.primaryDeviceId !== input.deviceId || printerSkippedWriters(printer, input.nowMs).length > 0),',
      "? await readPrinterFailover(printers, input.nowMs)",
      ": null;",
      "if (printerActiveWriter(printer, failover) === input.deviceId) {",
      "lines.push({ line: { ...printerLineFilter(printer.id, input.nowMs), ...kindFence }, fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });",
      "const result = await leaseLineHead(line, fence, input, claim);",
    ],
```

In `apps/cafe/lib/print-printer-routing.test.ts`, find:

```ts
  assert.deepEqual(cancel.map((j) => [j.printerId, j.copies]), [["counter", 1], ["bar", 1]]);
});

test("job keys: the slip's key, then the printer and the part; no key stays no key", () => {
  const request = kotPrintJob(order(), 1);
  const base = printJobKeyOf(request.payload);
```

Replace it with:

```ts
  assert.deepEqual(cancel.map((j) => [j.printerId, j.copies]), [["counter", 1], ["bar", 1]]);
});

// Phase 3 Session 3A (spec §9.3): with who-is-online read, each job goes to the device that writes its printer now.
test("Phase 3 failover: a network printer whose primary is offline routes to the online device that may take it over; device printers never move", () => {
  const lanKitchen = printer("kitchen", { kotStations: [KITCHEN.id], notices: true }, { order: 1, connection: { kind: "lan", host: "10.0.0.5", port: 9100 }, primaryDeviceId: "kitchen-tablet" });
  const routing: PrintRouting = { printers: [COUNTER_P, lanKitchen, BAR_P], stations: STATIONS, itemStations: ITEM_STATIONS };
  const writers = (r: PrintRouting) => routePrintRequest(kotPrintJob(order(), 1), r).map((job) => `${job.printerId}@${job.writerDeviceId}`).sort().join();
  assert.equal(writers(routing), "bar@bar-device,counter@counter-device,kitchen@kitchen-tablet", "no failover read: the setup's writers, as in Phase 2");
  const away = { online: [{ deviceId: "counter-device", lanFailover: true }, { deviceId: "bar-device", lanFailover: false }], nowMs: Date.parse("2026-10-07T12:00:00Z") };
  assert.equal(writers({ ...routing, failover: away }), "bar@bar-device,counter@counter-device,kitchen@counter-device", "the kitchen tablet offline: the counter writes the kitchen's network printer; the bar's own printer stays the bar phone's");
  const back = { ...away, online: [...away.online, { deviceId: "kitchen-tablet", lanFailover: true }] };
  assert.equal(writers({ ...routing, failover: back }), "bar@bar-device,counter@counter-device,kitchen@kitchen-tablet", "the primary back online: its own again");
});

test("job keys: the slip's key, then the printer and the part; no key stays no key", () => {
  const request = kotPrintJob(order(), 1);
  const base = printJobKeyOf(request.payload);
```

In `apps/cafe/lib/print-printer-test.test.ts`, find:

```ts
  const lib = src("lib/print-printer-test.ts");
  assert.match(lib, /line: \{ printerId: printer\.id, copies: 1 \}/, "on the printer's own line, one copy");
  assert.match(lib, /targetDeviceId: writer,/, "aimed at the printer's one writer");
  assert.match(lib, /const writer = routable === null \? null : printerWriterDeviceId\(routable\);/, "only a printer routing may send slips to: its lease takes only those");
  assert.match(lib, /publishPrintStatus\(\{ id: made\.ref\.id, status: "queued", target: writer \}\)/, "the writer hears of it as of any slip");
  assert.ok(!/connectDB\(|console\./.test(lib), "never connects, never logs");
  const routing = src("lib/print-printer-routing.ts");
```

Replace it with:

```ts
  const lib = src("lib/print-printer-test.ts");
  assert.match(lib, /line: \{ printerId: printer\.id, copies: 1 \}/, "on the printer's own line, one copy");
  assert.match(lib, /targetDeviceId: writer,/, "aimed at the printer's one writer");
  // Phase 3 (§9.3) deliberately changed the writer: the device that writes it now (a network printer taken over).
  assert.match(lib, /const writer = routable === null \? null : printerActiveWriter\(routable, await readPrinterFailover\(\[routable\], input\.nowMs\)\);/, "only a printer routing may send slips to: its lease takes only those");
  assert.match(lib, /publishPrintStatus\(\{ id: made\.ref\.id, status: "queued", target: writer \}\)/, "the writer hears of it as of any slip");
  assert.ok(!/connectDB\(|console\./.test(lib), "never connects, never logs");
  const routing = src("lib/print-printer-routing.ts");
```

In `apps/cafe/lib/self-order-alert-paths.test.ts`, find:

```ts
  // from under its writer; the host-cleared one keeps the claimedAt guard).
  // Session 1B adds print-order-jobs.ts: server-side creation, one PrintJob.create per slip under
  // today's unique jobKey, so it races the legacy enqueue and the claim exactly as a second enqueue would.
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-job-insert.ts",
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-queue-claim.ts",
```

Replace it with:

```ts
  // from under its writer; the host-cleared one keeps the claimedAt guard).
  // Session 1B adds print-order-jobs.ts: server-side creation, one PrintJob.create per slip under
  // today's unique jobKey, so it races the legacy enqueue and the claim exactly as a second enqueue would.
  // Phase 3 Session 3A adds print-failover.ts (spec §9.3, §9.4): updateManys that move WAITING printer jobs to the device
  // that writes their printer now, or (status "queued" and no uncertain attempt only) to the backup printer. Neither
  // touches a leased job or claimedAt (printers-mode jobs are never claimed), so no writer loses a job mid-print.
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-failover.ts",
    "apps/cafe/lib/print-job-insert.ts",
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-queue-claim.ts",
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY,
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
// and the agents' REAL cadence function. A cadence or cap change that could outgrow a cafe's free
```

Replace it with:

```ts
  PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY,
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
  printUnreachableRequestsPerWriterPerDay,
} from "./print-budget";
import { PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
// and the agents' REAL cadence function. A cadence or cap change that could outgrow a cafe's free
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(worst + printSetupReadsWorstPerDay() <= PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY, `${worst + printSetupReadsWorstPerDay()}/day within a token cafe's ${PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY}`);
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
```

Replace it with:

```ts
  assert.ok(worst + printSetupReadsWorstPerDay() <= PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY, `${worst + printSetupReadsWorstPerDay()}/day within a token cafe's ${PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY}`);
});

// Phase 3 Session 3A (spec §9.3): failover adds no request. The skip is ten refusal rechecks long, so a writer that
// cannot reach a network printer another device can print costs at most a lease and an ack per 5 minutes.
test("Phase 3 failover: a writer that could not reach a network printer is passed over for 5 minutes (ten 30 s rechecks): at most 288 requests a day", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 5 * 60 * 1000);
  assert.ok(PRINTER_UNREACHABLE_SKIP_MS >= 10 * PRINT_AGENT_REFUSED_RECHECK_MS, "never shorter than ten of Phase 1's refusal rechecks");
  assert.equal(printUnreachableRequestsPerWriterPerDay(), 288, "144 skips over the busy day's 12 h, a lease and an ack each");
  assert.ok(printUnreachableRequestsPerWriterPerDay() <= 2 * Math.ceil(OPEN_MS / PRINT_AGENT_REFUSED_RECHECK_MS) / 10, "a tenth of a refusing printer's cost");
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-printer-test.test.ts lib/print-printer-routing.test.ts lib/self-order-alert-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 62`; `# pass 53`; `# fail 9`

- [ ] **Step 3: The code**

In `apps/cafe/lib/print-device.ts`, find:

```ts
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINT_DEVICES_LIST_MAX, type PrintDeviceCapabilities, type PrintDeviceShell, type PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { PRINT_DEVICE_HEARTBEAT_WRITE_MS, PRINT_DEVICE_ONLINE_MS, PRINT_DEVICE_PRUNE_MS } from "@pos/shared/print-lifecycle";
import { PrintDevice } from "@/models/PrintDevice";

// Printing redesign, Phase 1 (spec §6.4, §10): the device heartbeat. It rides the agent's existing
```

Replace it with:

```ts
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINT_DEVICES_LIST_MAX, type PrintDeviceCapabilities, type PrintDeviceShell, type PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { PRINT_DEVICE_HEARTBEAT_WRITE_MS, PRINT_DEVICE_ONLINE_MS, PRINT_DEVICE_PRUNE_MS } from "@pos/shared/print-lifecycle";
import type { PrinterFailover } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";

// Printing redesign, Phase 1 (spec §6.4, §10): the device heartbeat. It rides the agent's existing
```

In `apps/cafe/lib/print-device.ts`, find:

```ts
  return Math.max(1, online);
}

/** Session 2D (spec §11 Devices): the devices that print or lease, the most recently seen first (so the online ones
 *  lead), for the Printer setup page and a network printer's printing device. One bounded read; no write. */
export async function listPrintDevices(nowMs: number): Promise<PrintDeviceSummary[]> {
```

Replace it with:

```ts
  return Math.max(1, online);
}

/** Phase 3 (spec §9.3): the devices seen in the last 90 s, and whether each may write any network printer the setup names
 *  (its wake said `lanFailover`). One bounded read of a collection of a few rows (the wake's heartbeat keeps it). */
export async function readOnlinePrintDevices(nowMs: number): Promise<PrinterFailover["online"]> {
  const rows = await PrintDevice.find({ lastSeenAt: { $gte: new Date(nowMs - PRINT_DEVICE_ONLINE_MS) } })
    .select("deviceId capabilities.lanFailover")
    .limit(PRINT_DEVICES_LIST_MAX)
    .lean<Array<{ deviceId: string; capabilities?: { lanFailover?: boolean } }>>();
  return rows.map((row) => ({ deviceId: row.deviceId, lanFailover: row.capabilities?.lanFailover === true }));
}

/** Session 2D (spec §11 Devices): the devices that print or lease, the most recently seen first (so the online ones
 *  lead), for the Printer setup page and a network printer's printing device. One bounded read; no write. */
export async function listPrintDevices(nowMs: number): Promise<PrintDeviceSummary[]> {
```

Create `apps/cafe/lib/print-failover.ts`:

```ts
import { PRINT_JOB_LOG_MAX } from "@pos/shared/print-lifecycle";
import { PRINTER_UNREACHABLE_SKIP_MS, printerActiveWriter, type PrinterFailover } from "@pos/shared/print-failover";
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
import { PrintJob } from "@/models/PrintJob";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { publishPrintStatus } from "@/lib/realtime-publish";

// Printing redesign, Phase 3 (spec §9.3): the server half of failover. A network printer is written by its primary
// while that device is online and reaches it; otherwise by an online device that can write network printers (the
// shared rule: @pos/shared/print-failover printerActiveWriter). Job creation (the routing read), the lease, a staff
// retry, a Test print and the sweep all ask who writes a printer now through readPrinterFailover; an ack that says its
// writer could not reach the printer skips that writer for it for 5 minutes and moves the waiting slips to the next.
// No new request: who is online comes from the heartbeat that already rides the wake. Never calls connectDB(). No
// console.*.

const WAITING = ["queued", "needs-confirm", "failed"];

/** Whether who-is-online matters to these printers: a routable network printer (§9.3) or, with `backups`, a routable
 *  printer with a backup (§9.4, the sweep). */
function needsFailover(printers: readonly PrinterConfig[], backups: boolean): boolean {
  return routablePrinters(printers).some((printer) => printer.connection.kind === "lan" || (backups && printer.backupPrinterId !== undefined));
}

/** Who is online now (one bounded read), or null with no read when no printer needs it: the setup's writers, as in
 *  Phase 2. */
export async function readPrinterFailover(printers: readonly PrinterConfig[], nowMs: number, backups = false): Promise<PrinterFailover | null> {
  if (!needsFailover(printers, backups)) return null;
  return { online: await readOnlinePrintDevices(nowMs), nowMs };
}

/** One printer's waiting slips follow the device that writes it now (one write; a leased slip is left to its lease).
 *  When any moved, that device is told of the line's head at once (one realtime request), instead of at its next pulse. */
export async function retargetPrinterJobs(printerId: string, writer: string, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  const moved = await PrintJob.updateMany(
    { printerId, status: { $in: WAITING }, targetDeviceId: { $ne: writer } },
    { $set: { targetDeviceId: writer }, $push: { log: { $each: [{ at, event: "retargeted", deviceId: writer }], $slice: -PRINT_JOB_LOG_MAX } } },
  );
  const count = moved.modifiedCount ?? 0;
  if (count > 0 && writer !== "") {
    const head = await PrintJob.findOne({ printerId, status: "queued" }).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
    if (head !== null) publishPrintStatus({ id: String(head._id), status: "queued", target: writer, printerId });
  }
  return count;
}

/** §9.3: a writer that could not reach a network printer (its ack: failed, sent "no", reason "unreachable") is skipped
 *  for it for 5 minutes, so another device that can write network printers takes it over. Only the printer's writer
 *  now is skipped: an ack from a device that no longer writes it changes nothing. One write to the printer (the skips
 *  that still run, this device's renewed); when the writer changes, the waiting slips move to the new one at once.
 *  Returns who writes it now. */
export async function recordPrinterUnreachable(input: { printerId: string; deviceId: string; nowMs: number }): Promise<string | null> {
  const printer = routablePrinterOf(await listPrinters(), input.printerId);
  if (printer === null || printer.connection.kind !== "lan") return null;
  const failover = { online: await readOnlinePrintDevices(input.nowMs), nowMs: input.nowMs };
  const before = printerActiveWriter(printer, failover);
  if (before !== input.deviceId) return before;
  const now = new Date(input.nowMs);
  const until = new Date(input.nowMs + PRINTER_UNREACHABLE_SKIP_MS);
  await Printer.updateOne({ _id: printer.id }, [
    {
      $set: {
        unreachable: {
          $concatArrays: [
            { $filter: { input: { $ifNull: ["$unreachable", []] }, cond: { $and: [{ $gt: ["$$this.until", now] }, { $ne: ["$$this.deviceId", input.deviceId] }] } } },
            [{ deviceId: input.deviceId, until }],
          ],
        },
      },
    },
  ]);
  const skips = [...(printer.unreachable ?? []).filter((skip) => skip.deviceId !== input.deviceId), { deviceId: input.deviceId, until: until.toISOString() }];
  const writer = printerActiveWriter({ ...printer, unreachable: skips }, failover);
  if (writer !== null && writer !== input.deviceId) await retargetPrinterJobs(printer.id, writer, input.nowMs);
  return writer;
}
```

Replace the whole of `apps/cafe/lib/print-job-actions.ts` with:

```ts
import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { lifecycleOf, planConfirm, planRetry, type PrintJobDecision, type PrintJobLifecycle, type PrintJobPlan } from "@pos/shared/print-lifecycle";
import { printerActiveWriter } from "@pos/shared/print-failover";
import { routablePrinterOf } from "@pos/shared/print-printers";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { readPrinterFailover } from "./print-failover";
import { listPrinters } from "./print-printers";

// Printing redesign, Phase 1 (spec §7.2, §7.3): the staff decisions. "Print again?" on a bill that
// may already be on paper (confirm), and Print again on a failed job or Print now on a stale one
// (retry). Allowed from any device that can see the job. Every write is one CAS through
// print-lease.ts. Never calls connectDB(). No console.*.

const ACTION_MAX_STEPS = 2;

async function act(id: string, nowMs: number, decide: (job: PrintJobLifecycle) => PrintJobPlan): Promise<PrintActionData> {
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
    // takes slips gets the job on its current writer's line, in the same write (the 2C gate's review, I-3). Phase 3
    // (§9.3): its writer now, a network printer's primary or the device that took it over.
    let patch = plan.patch;
    let target = row.targetDeviceId;
    if (plan.patch.status === "queued" && row.printerId !== undefined) {
      const printers = await listPrinters();
      const printer = routablePrinterOf(printers, row.printerId);
      if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };
      target = printerActiveWriter(printer, await readPrinterFailover([printer], nowMs)) ?? target;
      patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };
    }
    if (await applyPrintJobPlan(row._id, job, patch)) {
      // Back in the queue: nudge the printing device, so it leases now rather than on its next poll.
      // Fire-and-forget; the poll still finds it if the nudge is lost.
      if (plan.patch.status === "queued") publishCafeEvent("print-job");
      // Session 1D (D7): also aimed at the device whose line holds it. With no host, agents never lease on
      // the broadcast above (1B M-c), so without this a tap would wait for that device's next pulse.
      if (plan.patch.status === "queued") publishPrintStatus({ id, status: "queued", ...(target ? { target } : {}), ...(row.printerId !== undefined ? { printerId: row.printerId } : {}) });
      return { applied: true, status: plan.patch.status };
    }
  }
  return { applied: false, status: null, reason: "raced" };
}

export function confirmPrintJob(input: { id: string; decision: PrintJobDecision; staff: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, input.nowMs, (job) => planConfirm(job, input.decision, input.staff, input.nowMs));
}

export function retryPrintJob(input: { id: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, input.nowMs, (job) => planRetry(job, input.nowMs));
}
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
  type PrintJobPatch,
  type PrintJobSet,
} from "@pos/shared/print-lifecycle";
import { PRINT_JOB_NO_PRINTER, printerWriterDeviceId, routablePrinters } from "@pos/shared/print-printers";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { printDeviceDrawsTokens } from "./print-device";
import { listPrinters } from "./print-printers";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";
```

Replace it with:

```ts
  type PrintJobPatch,
  type PrintJobSet,
} from "@pos/shared/print-lifecycle";
import { PRINT_ACK_UNREACHABLE } from "@pos/shared/print-agent-wire";
import { printerActiveWriter, printerSkippedWriters } from "@pos/shared/print-failover";
import { PRINT_JOB_NO_PRINTER, routablePrinters } from "@pos/shared/print-printers";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { printDeviceDrawsTokens } from "./print-device";
import { readPrinterFailover, recordPrinterUnreachable } from "./print-failover";
import { listPrinters } from "./print-printers";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
/** Leases the head of this device's line, and (Session 2C, printers mode) the head of each printer line it names
 *  that it really writes: routable (as the sweep sees it), with this device as its writer, read fresh (§9.3,
 *  decision 1: one writer per printer). At most one job per line, so a stuck bar job never blocks the kitchen.
 *  retryAt: the soonest moment a line that gave no job can be leased again. */
export async function leasePrintJobs(input: LeaseInput & { printerIds?: readonly string[] }): Promise<PrintLeaseData> {
  type Line = { line: FilterQuery<IPrintJob>; fence: FilterQuery<IPrintJob>; claim?: PrintJobSet };
  const kindFence = leaseKindFence(input.tokenSlips);
  const lines: Line[] = [{ line: { ...printJobLineFilter(input.deviceId, input.nowMs), ...kindFence }, fence: { targetDeviceId: input.deviceId } }];
  if (input.printerIds !== undefined && input.printerIds.length > 0) {
    for (const printer of routablePrinters(await listPrinters())) {
      if (input.printerIds.includes(printer.id) && printerWriterDeviceId(printer) === input.deviceId) {
        lines.push({ line: { ...printerLineFilter(printer.id, input.nowMs), ...kindFence }, fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });
      }
    }
```

Replace it with:

```ts
/** Leases the head of this device's line, and (Session 2C, printers mode) the head of each printer line it names
 *  that it really writes: routable (as the sweep sees it), with this device as its writer, read fresh (§9.3,
 *  decision 1: one writer per printer). At most one job per line, so a stuck bar job never blocks the kitchen.
 *  Phase 3 (§9.3): "its writer" is the device that writes it NOW: a network printer's primary, or the device that took
 *  it over while the primary is offline or cannot reach it (one read of who is online, only when this device names a
 *  network printer it is not the primary of, or one a writer could not reach lately).
 *  retryAt: the soonest moment a line that gave no job can be leased again. */
export async function leasePrintJobs(input: LeaseInput & { printerIds?: readonly string[] }): Promise<PrintLeaseData> {
  type Line = { line: FilterQuery<IPrintJob>; fence: FilterQuery<IPrintJob>; claim?: PrintJobSet };
  const kindFence = leaseKindFence(input.tokenSlips);
  const lines: Line[] = [{ line: { ...printJobLineFilter(input.deviceId, input.nowMs), ...kindFence }, fence: { targetDeviceId: input.deviceId } }];
  if (input.printerIds !== undefined && input.printerIds.length > 0) {
    const named = input.printerIds;
    const printers = routablePrinters(await listPrinters());
    const asked = printers.filter((printer) => named.includes(printer.id));
    const failover = asked.some(
      (printer) => printer.connection.kind === "lan" && (printer.primaryDeviceId !== input.deviceId || printerSkippedWriters(printer, input.nowMs).length > 0),
    )
      ? await readPrinterFailover(printers, input.nowMs)
      : null;
    for (const printer of asked) {
      if (printerActiveWriter(printer, failover) === input.deviceId) {
        lines.push({ line: { ...printerLineFilter(printer.id, input.nowMs), ...kindFence }, fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });
      }
    }
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". Phase 3 (the token fix's M-2):
 *  `tokenSlips` is the page's word that it prints token jobs (absent: what the device's last lease said). */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number; tokenSlips?: true }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(`${PRINT_LIFECYCLE_SELECT} printerId`).lean<PrintLifecycleRow & { printerId?: string }>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
```

Replace it with:

```ts

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". Phase 3 (the token fix's M-2):
 *  `tokenSlips` is the page's word that it prints token jobs (absent: what the device's last lease said). Phase 3
 *  (§9.3): `reason` "unreachable" on a refusal (sent "no") skips that writer for the job's network printer. */
export async function ackPrintJob(
  input: PrintJobAck & { id: string; nowMs: number; tokenSlips?: true; reason?: typeof PRINT_ACK_UNREACHABLE },
): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(`${PRINT_LIFECYCLE_SELECT} printerId`).lean<PrintLifecycleRow & { printerId?: string }>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
      // job back in the queue is that line's head, and its nextAttemptAt says when. A failed read only drops
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed. Session 2C: a printer job
      // asks its own printer's line (the 2B gate's ruling R3).
      if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };
      // Phase 3 (the token fix's M-2): a page that cannot print a token job is never told `more` for one.
      const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));
      const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(
```

Replace it with:

```ts
      // job back in the queue is that line's head, and its nextAttemptAt says when. A failed read only drops
      // the hint (the agent then leases, as in Phase 1): the ack itself has landed. Session 2C: a printer job
      // asks its own printer's line (the 2B gate's ruling R3).
      if (plan.patch.status === "queued") {
        // Phase 3 (§9.3): its writer could not reach this network printer: skipped for it for 5 minutes, and the slip
        // moves to the device that takes the printer over. Best-effort: the refusal itself has landed.
        if (input.reason === PRINT_ACK_UNREACHABLE && input.sent === "no" && row.printerId !== undefined) {
          await recordPrinterUnreachable({ printerId: row.printerId, deviceId: input.deviceId, nowMs: input.nowMs }).catch(() => null);
        }
        return { applied: true, status: plan.patch.status, nextAttemptAt };
      }
      // Phase 3 (the token fix's M-2): a page that cannot print a token job is never told `more` for one.
      const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));
      const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
import { z } from "zod";
import { PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINTERS_MAX, PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
```

Replace it with:

```ts
import { z } from "zod";
import { PRINT_ACK_UNREACHABLE, PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINTERS_MAX, PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
        windowsPrinters: z.boolean(),
        webSerial: z.boolean(),
        webBluetooth: z.boolean(),
      })
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
```

Replace it with:

```ts
        windowsPrinters: z.boolean(),
        webSerial: z.boolean(),
        webBluetooth: z.boolean(),
        /** Phase 3 (spec §9.3): this page may write any network printer the setup names. */
        lanFailover: z.boolean().optional(),
      })
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
    error: z.string().trim().max(PRINT_ACK_ERROR_MAX_CHARS).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs, so the answer's `more` counts them. */
    tokenSlips: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (body) => (body.outcome === "printed" ? body.sent === undefined && body.permanent === undefined : body.sent !== undefined),
    { message: "A failed ack must say whether anything was sent; a printed ack carries no failure fields." },
  );

/** POST /api/print-jobs/[id]/confirm: the cashier's answer to "Print the bill again?". */
export const confirmBodySchema = z.object({ decision: z.enum(["reprint", "printed", "dismiss"]) }).strict();
```

Replace it with:

```ts
    error: z.string().trim().max(PRINT_ACK_ERROR_MAX_CHARS).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs, so the answer's `more` counts them. */
    tokenSlips: z.literal(true).optional(),
    /** Phase 3 (spec §9.3): the writer could not reach this network printer (a failed connect, before any byte). */
    reason: z.literal(PRINT_ACK_UNREACHABLE).optional(),
  })
  .strict()
  .refine(
    (body) => (body.outcome === "printed" ? body.sent === undefined && body.permanent === undefined : body.sent !== undefined),
    { message: "A failed ack must say whether anything was sent; a printed ack carries no failure fields." },
  )
  .refine((body) => body.reason === undefined || (body.outcome === "failed" && body.sent === "no" && body.permanent === undefined), {
    message: "Only a printer that could not be reached before any byte was sent is unreachable.",
  });

/** POST /api/print-jobs/[id]/confirm: the cashier's answer to "Print the bill again?". */
export const confirmBodySchema = z.object({ decision: z.enum(["reprint", "printed", "dismiss"]) }).strict();
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
    const routing = await readPrintRouting({
      productIds: requests.flatMap((request) => printPayloadProductIds(request.payload)),
      ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
    });
    if (routing !== null) {
      const { jobs } = await createRoutedPrintJobs({
```

Replace it with:

```ts
    const routing = await readPrintRouting({
      productIds: requests.flatMap((request) => printPayloadProductIds(request.payload)),
      ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
      nowMs: input.nowMs,
    });
    if (routing !== null) {
      const { jobs } = await createRoutedPrintJobs({
```

In `apps/cafe/lib/print-printer-jobs.ts`, find:

```ts
  const routing = await readPrintRouting({
    productIds: printPayloadProductIds(input.payload),
    ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
  });
  if (routing === null) return null;
  const baseKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
```

Replace it with:

```ts
  const routing = await readPrintRouting({
    productIds: printPayloadProductIds(input.payload),
    ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
    nowMs: input.nowMs,
  });
  if (routing === null) return null;
  const baseKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
```

In `apps/cafe/lib/print-printer-routing.ts`, find:

```ts
  type PrinterConfig,
  type StationConfig,
} from "@pos/shared/print-printers";
import type { KotPrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { printJobLabel, type PrintJobRequest } from "@/lib/print-routing";
```

Replace it with:

```ts
  type PrinterConfig,
  type StationConfig,
} from "@pos/shared/print-printers";
import { printerActiveWriter, type PrinterFailover } from "@pos/shared/print-failover";
import type { KotPrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { printJobLabel, type PrintJobRequest } from "@/lib/print-routing";
```

In `apps/cafe/lib/print-printer-routing.ts`, find:

```ts
  itemStations: ReadonlyMap<string, string>;
  /** The asking device's own bill printer (Session 2D); unknown, disabled or with no writer means none. */
  billPrinterId?: string;
}

export interface RoutedPrintJob {
```

Replace it with:

```ts
  itemStations: ReadonlyMap<string, string>;
  /** The asking device's own bill printer (Session 2D); unknown, disabled or with no writer means none. */
  billPrinterId?: string;
  /** Phase 3 (§9.3): who is online, read when a network printer is set up, so each job goes to the device that writes
   *  its printer now (absent: the setup's writers, as in Phase 2). */
  failover?: PrinterFailover;
}

export interface RoutedPrintJob {
```

In `apps/cafe/lib/print-printer-routing.ts`, find:

```ts
}

/** The jobs one slip becomes in printers mode (spec §8). Empty only for a KOT with no lines, and for a
 *  notice no printer reached takes notices for (staff switched notices off there). */
export function routePrintRequest(request: PrintJobRequest, routing: PrintRouting): RoutedPrintJob[] {
  const setup = setupOf(routing);
  const payload = request.payload;
  switch (payload.kind) {
```

Replace it with:

```ts
}

/** The jobs one slip becomes in printers mode (spec §8). Empty only for a KOT with no lines, and for a
 *  notice no printer reached takes notices for (staff switched notices off there). Phase 3 (§9.3): each job is aimed at
 *  the device that writes its printer now (a network printer taken over while its primary is offline). */
export function routePrintRequest(request: PrintJobRequest, routing: PrintRouting): RoutedPrintJob[] {
  const jobs = routeSlip(request, routing);
  const failover = routing.failover;
  if (failover === undefined) return jobs;
  return jobs.map((routed) => {
    const printer = routed.printerId === null ? null : routablePrinterOf(routing.printers, routed.printerId);
    return printer === null ? routed : { ...routed, writerDeviceId: printerActiveWriter(printer, failover) };
  });
}

/** The jobs one slip becomes (spec §8), each aimed at its printer's setup writer. */
function routeSlip(request: PrintJobRequest, routing: PrintRouting): RoutedPrintJob[] {
  const setup = setupOf(routing);
  const payload = request.payload;
  switch (payload.kind) {
```

In `apps/cafe/lib/print-printer-test.ts`, find:

```ts
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import {
  PRINT_TEST_LINE_MAX_CHARS,
  printerWriterDeviceId,
  routablePrinterOf,
  type PrinterConfig,
  type PrinterDeviceTransport,
```

Replace it with:

```ts
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { printerActiveWriter } from "@pos/shared/print-failover";
import {
  PRINT_TEST_LINE_MAX_CHARS,
  routablePrinterOf,
  type PrinterConfig,
  type PrinterDeviceTransport,
```

In `apps/cafe/lib/print-printer-test.ts`, find:

```ts
} from "@pos/shared/print-printers";
import type { TestPrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { announcesQueuedJob, printerLineIsFree } from "@/lib/print-direct";
import { insertPrintJob } from "@/lib/print-job-insert";
import { PRINTER_NOT_FOUND, listPrinters } from "@/lib/print-printers";
import { listStations, type PrintSetupResult } from "@/lib/print-stations";
```

Replace it with:

```ts
} from "@pos/shared/print-printers";
import type { TestPrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { announcesQueuedJob, printerLineIsFree } from "@/lib/print-direct";
import { readPrinterFailover } from "@/lib/print-failover";
import { insertPrintJob } from "@/lib/print-job-insert";
import { PRINTER_NOT_FOUND, listPrinters } from "@/lib/print-printers";
import { listStations, type PrintSetupResult } from "@/lib/print-stations";
```

In `apps/cafe/lib/print-printer-test.ts`, find:

```ts
  const printer = printers.find((p) => p.id === input.printerId);
  if (printer === undefined) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  const routable = routablePrinterOf(printers, printer.id);
  const writer = routable === null ? null : printerWriterDeviceId(routable);
  if (writer === null) return { ok: false, status: 409, error: PRINTER_TEST_NOT_ROUTABLE_MESSAGE };
  const payload = printerTestPayload(printer, await listStations(), input.queuedBy, input.nowMs);
  const asksHere = input.leaseTabId !== undefined && writer === input.originDeviceId && (input.readyPrinterIds ?? []).includes(printer.id);
```

Replace it with:

```ts
  const printer = printers.find((p) => p.id === input.printerId);
  if (printer === undefined) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  const routable = routablePrinterOf(printers, printer.id);
  // Phase 3 (§9.3): the device that writes it now (a network printer taken over while its primary is offline).
  const writer = routable === null ? null : printerActiveWriter(routable, await readPrinterFailover([routable], input.nowMs));
  if (writer === null) return { ok: false, status: 409, error: PRINTER_TEST_NOT_ROUTABLE_MESSAGE };
  const payload = printerTestPayload(printer, await listStations(), input.queuedBy, input.nowMs);
  const asksHere = input.leaseTabId !== undefined && writer === input.originDeviceId && (input.readyPrinterIds ?? []).includes(printer.id);
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled"> & {
  _id: Types.ObjectId;
};
```

Replace it with:

```ts
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled" | "unreachable"> & {
  _id: Types.ObjectId;
};
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
    },
    copies: { kot: row.copies.kot, bill: row.copies.bill },
    enabled: row.enabled,
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
```

Replace it with:

```ts
    },
    copies: { kot: row.copies.kot, bill: row.copies.bill },
    enabled: row.enabled,
    // Phase 3 (spec §9.3): the writers skipped for this network printer, as the server keeps them.
    ...(row.unreachable !== undefined && row.unreachable.length > 0
      ? { unreachable: row.unreachable.map((skip) => ({ deviceId: skip.deviceId, until: skip.until.toISOString() })) }
      : {}),
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled unreachable";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
```

In `apps/cafe/lib/print-routing-context.ts`, find:

```ts
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
```

Replace it with:

```ts
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrintRouting } from "@/lib/print-printer-routing";
import { readPrinterFailover } from "@/lib/print-failover";
import { listPrinters } from "@/lib/print-printers";
import { stationWireOf } from "@/lib/print-stations";

// Printing redesign, Phase 2 (spec §6.2, §8): what one order request routes its slips with, read fresh
// (never cached: a printer switched off must stop getting slips at once). Simple mode costs ONE small read
// (the printers) and answers null; printers mode adds the stations and the stations of this request's items
// (two reads by id: the items, then their categories). Session 2C calls it from job creation. Phase 3 (§9.3): with a
// network printer in the setup, also who is online (one small read, beside the stations), so a slip goes to the device
// that writes its printer now. Never calls connectDB(). No console.*.

interface ProductStationRow {
  _id: Types.ObjectId;
```

In `apps/cafe/lib/print-routing-context.ts`, find:

```ts
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
```

Replace it with:

```ts
}

/** null in simple mode (spec §6.6): no enabled printer takes a slip, so routing is today's. */
export async function readPrintRouting(input: { productIds: readonly string[]; billPrinterId?: string; nowMs?: number }): Promise<PrintRouting | null> {
  const printers = await listPrinters();
  if (!printersModeOn(printers)) return null;
  const ids = [...new Set(input.productIds)].filter((id) => mongoose.isValidObjectId(id));
  const [stationRows, products, failover] = await Promise.all([
    Station.find().select("name order isDefault").lean<Array<{ _id: Types.ObjectId; name: string; order: number; isDefault: boolean }>>(),
    ids.length === 0 ? Promise.resolve([]) : Product.find({ _id: { $in: ids } }).select("categoryId stationId").lean<ProductStationRow[]>(),
    readPrinterFailover(printers, input.nowMs ?? Date.now()),
  ]);
  const stations = stationRows.map(stationWireOf);
  const categoryIds = [...new Set(products.map((product) => String(product.categoryId)))];
```

In `apps/cafe/lib/print-routing-context.ts`, find:

```ts
    );
    if (resolved !== null) itemStations.set(String(product._id), resolved);
  }
  return { printers, stations, itemStations, ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}) };
}
```

Replace it with:

```ts
    );
    if (resolved !== null) itemStations.set(String(product._id), resolved);
  }
  return {
    printers,
    stations,
    itemStations,
    ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
    ...(failover !== null ? { failover } : {}),
  };
}
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER, printerWriterDeviceId, routablePrinters } from "@pos/shared/print-printers";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_PAPER_ATTEMPTS,
```

Replace it with:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import { printerActiveWriter } from "@pos/shared/print-failover";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER, routablePrinters } from "@pos/shared/print-printers";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_PAPER_ATTEMPTS,
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";
import { prunePrintJobsThrottled } from "./print-queue";
```

Replace it with:

```ts
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { readPrinterFailover, retargetPrinterJobs } from "./print-failover";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";
import { prunePrintJobsThrottled } from "./print-queue";
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
 *  review, I-1: "It printed" and Clear still work; Print again is refused while the printer is gone). A leased job
 *  is left to its lease. One read when no queued or needs-confirm printer job waits (every simple-mode cafe, and
 *  every outlet whose waiting rows are only failed ones); otherwise the printers, one write per printer and one for
 *  the gone ones. */
export async function routePrinterJobs(nowMs: number): Promise<{ retargeted: number; failed: number }> {
  const waiting = await PrintJob.findOne({ printerId: { $exists: true, $ne: PRINT_JOB_NO_PRINTER }, status: { $in: ["queued", "needs-confirm"] } })
    .select("_id")
```

Replace it with:

```ts
 *  review, I-1: "It printed" and Clear still work; Print again is refused while the printer is gone). A leased job
 *  is left to its lease. One read when no queued or needs-confirm printer job waits (every simple-mode cafe, and
 *  every outlet whose waiting rows are only failed ones); otherwise the printers, one write per printer and one for
 *  the gone ones. Phase 3 (§9.3): "its writer" is the device that writes it now (a network printer's primary, or the
 *  device that took it over: one read of who is online), and a writer that changed is told of its line's head. */
export async function routePrinterJobs(nowMs: number): Promise<{ retargeted: number; failed: number }> {
  const waiting = await PrintJob.findOne({ printerId: { $exists: true, $ne: PRINT_JOB_NO_PRINTER }, status: { $in: ["queued", "needs-confirm"] } })
    .select("_id")
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
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
```

Replace it with:

```ts
  if (waiting === null) return { retargeted: 0, failed: 0 };
  const at = new Date(nowMs);
  const printers = routablePrinters(await listPrinters());
  const failover = await readPrinterFailover(printers, nowMs);
  let retargeted = 0;
  for (const printer of printers) {
    retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);
  }
  const gone = await PrintJob.updateMany(
    { printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: "queued" },
```

In `apps/cafe/models/PrintDevice.ts`, find:

```ts
    windowsPrinters: { type: Boolean, required: true },
    webSerial: { type: Boolean, required: true },
    webBluetooth: { type: Boolean, required: true },
  },
  { _id: false },
);
```

Replace it with:

```ts
    windowsPrinters: { type: Boolean, required: true },
    webSerial: { type: Boolean, required: true },
    webBluetooth: { type: Boolean, required: true },
    // Phase 3 (spec §9.3): it may write any network printer the setup names; absent from a page before Phase 3.
    lanFailover: { type: Boolean },
  },
  { _id: false },
);
```

In `apps/cafe/models/Printer.ts`, find:

```ts
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
```

Replace it with:

```ts
} from "@pos/shared/print-printers";

// Printing redesign, Phase 2 (spec §6.3): one printer of the outlet and the slips it takes. A LAN printer
// is reached over the network by its primary device, and from Phase 3 (§9.3) by another device that can write
// network printers while its primary is offline or cannot reach it; a device printer (Bluetooth, USB, a Windows
// printer, Web Serial or Web Bluetooth) only by the one device that owns it. The request bodies are checked whole by lib/print-printer-schemas.ts; this schema keeps
// the stored shape honest on its own.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. Phase 3 adds what the server keeps beside the setup: `unreachable` (§9.3, the
// writers skipped for 5 minutes).

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
```

In `apps/cafe/models/Printer.ts`, find:

```ts
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Replace it with:

```ts
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  unreachable?: Array<{ deviceId: string; until: Date }>; // Phase 3 (§9.3): server-kept, never saved by the setup
  createdAt: Date;
  updatedAt: Date;
}
```

In `apps/cafe/models/Printer.ts`, find:

```ts
  { _id: false },
);

const copiesSchema = new Schema<PrinterCopies>(
  {
    kot: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
```

Replace it with:

```ts
  { _id: false },
);

// Phase 3 (spec §9.3): a writer that could not reach this network printer, skipped for it until `until`.
const unreachableSchema = new Schema<{ deviceId: string; until: Date }>(
  {
    deviceId: { type: String, required: true, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    until: { type: Date, required: true },
  },
  { _id: false },
);

const copiesSchema = new Schema<PrinterCopies>(
  {
    kot: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
```

In `apps/cafe/models/Printer.ts`, find:

```ts
    slips: { type: slipsSchema, required: true },
    copies: { type: copiesSchema, required: true },
    enabled: { type: Boolean, required: true },
  },
  { timestamps: true },
);
```

Replace it with:

```ts
    slips: { type: slipsSchema, required: true },
    copies: { type: copiesSchema, required: true },
    enabled: { type: Boolean, required: true },
    // Omit-empty (no [] default): written only by an ack that could not reach the printer (lib/print-failover.ts).
    unreachable: { type: [unreachableSchema], default: undefined },
  },
  { timestamps: true },
);
```

Create `apps/cafe/scripts/print-host-live/failover.ts`:

```ts
/**
 * Phase 3 Session 3A live leg (ba) — failover (spec §9.3) against a REAL MongoDB: a network printer whose primary is
 * offline is written by an online device that may take it over, and job creation, the lease, a staff Retry, a Test
 * print and the sweep all agree on who; a page from before Phase 3 never takes one over; a device printer never moves;
 * a writer that could not reach the printer is skipped for it for 5 minutes and the waiting slip moves to the next
 * writer at once. The outlet helpers are shared with legs bb and bc. Run by scripts/verify-print-host-live.ts after
 * leg az.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINTER_UNREACHABLE_SKIP_MS } from "@pos/shared/print-failover";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { Category } from "@/models/Category";
import { Order } from "@/models/Order";
import { PrintDevice } from "@/models/PrintDevice";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { beatPrintDevice } from "@/lib/print-device";
import { recordPrinterUnreachable } from "@/lib/print-failover";
import { retryPrintJob } from "@/lib/print-job-actions";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { createOrderPrintJobs } from "@/lib/print-order-jobs";
import { createPrinterTestJob } from "@/lib/print-printer-test";
import { createPrinter, listPrinters } from "@/lib/print-printers";
import { createStation, listStations } from "@/lib/print-stations";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check, resetCollections } from "./harness";
import { STAFF, rowOf, setRaw } from "./lifecycle";

export const KITCHEN = "live-fo-kitchen";
export const COUNTER = "live-fo-counter";
export const BAR = "live-fo-bar";
const OLD = "live-fo-old-page";
const PHONE = "live-fo-phone";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };

export interface FailoverOutlet {
  kitchen: string;
  bar: string;
  counter: string;
  paneer: string;
  mojito: string;
}

/** A device whose wake was just seen (a fresh heartbeat); `lanFailover` false is a page from before Phase 3. */
export async function online(deviceId: string, nowMs: number, lanFailover = true): Promise<void> {
  await PrintDevice.deleteOne({ deviceId });
  await beatPrintDevice({ deviceId, label: deviceId, shell: "android", capabilities: { ...CAPS, lanFailover } }, nowMs);
}

/** A device last seen two minutes before `nowMs` (no heartbeat for 90 s: offline). */
export async function offline(deviceId: string, nowMs: number): Promise<void> {
  await PrintDevice.updateOne({ deviceId }, { $set: { lastSeenAt: new Date(nowMs - 120_000) } });
}

function body(name: string, over: Partial<PrinterBody>): PrinterBody {
  return { name, connection: { kind: "lan", host: "10.0.0.70", port: 9100 }, paper: 80, slips: NO_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

async function idOf(made: Promise<{ ok: boolean; data?: { id: string } }>): Promise<string> {
  const result = await made;
  return result.ok && result.data !== undefined ? result.data.id : "";
}

/** The kitchen's network printer (written by the kitchen tablet), the bar's own Bluetooth printer (the bar phone), and
 *  the counter's network printer (bills, End of day; written by the counter). Paneer cooks in the kitchen, the Mojito
 *  at the bar. */
export async function failoverOutlet(over: { bar?: Partial<PrinterBody> } = {}): Promise<FailoverOutlet> {
  await Promise.all([
    resetCollections(),
    Order.deleteMany({}),
    Station.deleteMany({}),
    Printer.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    PrintDevice.deleteMany({}),
  ]);
  const [kitchenStation] = await listStations();
  const barStation = await idOf(createStation({ name: "Bar" }));
  const food = await Category.create({ name: "Food" });
  const drinks = await Category.create({ name: "Drinks", stationId: barStation });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const kitchen = await idOf(createPrinter(body("Kitchen", { connection: { kind: "lan", host: "10.0.0.71", port: 9100 }, primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, kotStations: [kitchenStation?.id ?? ""], notices: true } })));
  const counter = await idOf(createPrinter(body("Counter", { connection: { kind: "lan", host: "10.0.0.72", port: 9100 }, primaryDeviceId: COUNTER, slips: { ...NO_SLIPS, bill: true, eod: true } })));
  const bar = await idOf(
    createPrinter(body("Bar", { connection: { kind: "device", deviceId: BAR, transport: "bt-classic", address: "AA:BB:CC" }, slips: { ...NO_SLIPS, kotStations: [barStation], notices: true }, ...over.bar })),
  );
  return { kitchen, bar, counter, paneer: String(paneer._id), mojito: String(mojito._id) };
}

/** A fresh order's round-1 KOT (Paneer and a Mojito), asked for by a waiter phone: each station's job, by printer. */
export async function kotOf(o: FailoverOutlet, nowMs: number): Promise<{ kitchen?: PrintJobRef; bar?: PrintJobRef }> {
  const doc = await Order.create({
    orderId: `ORD-3A-${new mongoose.Types.ObjectId().toHexString()}`,
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
  });
  const refs = await createOrderPrintJobs({ order: await Order.findById(doc._id).lean(), slips: [{ kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  return { kitchen: refs.find((ref) => ref.printerId === o.kitchen), bar: refs.find((ref) => ref.printerId === o.bar) };
}

const lease = (deviceId: string, printerIds: string[], nowMs: number) => leasePrintJobs({ deviceId, tabId: `${deviceId}-tab`, tokenSlips: true, printerIds, dismissedBy: STAFF, nowMs });
const skipsOf = async (printerId: string) => (await listPrinters()).find((printer) => printer.id === printerId)?.unreachable ?? [];

export async function legBA(nowMs: number): Promise<void> {
  console.log("\n(ba) failover (§9.3): a network printer whose primary is offline is written by a device that may take it over; one that cannot reach it is skipped for 5 minutes");
  const o = await failoverOutlet();
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  const first = await kotOf(o, nowMs);
  check("(ba) every device online: the kitchen's slip is the kitchen tablet's, the bar's the bar phone's", first.kitchen?.targetDeviceId === KITCHEN && first.bar?.targetDeviceId === BAR);

  await Promise.all([offline(KITCHEN, nowMs), offline(BAR, nowMs)]);
  const away = await kotOf(o, nowMs);
  check("(ba) the kitchen tablet offline: a new kitchen slip goes to the counter, which may write network printers; the bar's own printer never moves", away.kitchen?.targetDeviceId === COUNTER && away.bar?.targetDeviceId === BAR);
  const swept = await routePrinterJobs(nowMs + 1_000);
  const moved = await rowOf(first.kitchen?.id ?? "");
  check("(ba) the sweep moves the kitchen slip that waited for the tablet to the counter, logged 'retargeted'", moved?.targetDeviceId === COUNTER && moved.log?.at(-1)?.event === "retargeted" && swept.retargeted >= 1);
  const taken = await lease(COUNTER, [o.kitchen, o.counter], nowMs + 2_000);
  check("(ba) the counter leases the kitchen printer's line, its oldest slip first, and claims it", taken.jobs.length === 1 && taken.jobs[0]?.id === first.kitchen?.id && (await rowOf(first.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);
  await ackPrintJob({ id: taken.jobs[0]?.id ?? "", deviceId: COUNTER, epoch: taken.jobs[0]?.epoch ?? 0, outcome: "printed", tokenSlips: true, nowMs: nowMs + 3_000 });
  check("(ba) ... never the bar's own printer, whatever it names", (await lease(COUNTER, [o.bar], nowMs + 3_000)).jobs.length === 0);
  const test = await createPrinterTestJob({ printerId: o.kitchen, queuedBy: STAFF, nowMs: nowMs + 3_000 });
  check("(ba) a Test print of the kitchen printer goes to the counter too", test.ok && test.data.targetDeviceId === COUNTER);

  await online(KITCHEN, nowMs + 4_000);
  await routePrinterJobs(nowMs + 4_000);
  check("(ba) the tablet back online: the kitchen's waiting slip goes home", (await rowOf(away.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN);
  check("(ba) ... and the counter no longer leases it", (await lease(COUNTER, [o.kitchen], nowMs + 4_000)).jobs.length === 0);

  await Promise.all([offline(KITCHEN, nowMs + 5_000), offline(COUNTER, nowMs + 5_000), online(OLD, nowMs + 5_000, false)]);
  const old = await kotOf(o, nowMs + 5_000);
  check("(ba) a page from before Phase 3 never takes a printer over: with no other writer the slip waits for the tablet", old.kitchen?.targetDeviceId === KITCHEN);
  check("(ba) ... and its lease gets nothing from it", (await lease(OLD, [o.kitchen], nowMs + 5_000)).jobs.length === 0);
  await online(COUNTER, nowMs + 6_000);
  await setRaw(old.kitchen?.id ?? "", { status: "failed" });
  const retried = await retryPrintJob({ id: old.kitchen?.id ?? "", nowMs: nowMs + 6_000 });
  check("(ba) a staff Retry puts it on the line of the device that writes the printer now: the counter", retried.applied && (await rowOf(old.kitchen?.id ?? ""))?.targetDeviceId === COUNTER);

  await PrintJob.deleteMany({});
  await online(KITCHEN, nowMs + 7_000);
  const u = await kotOf(o, nowMs + 7_000);
  const mine = await lease(KITCHEN, [o.kitchen], nowMs + 7_500);
  const refused = await ackPrintJob({ id: mine.jobs[0]?.id ?? "", deviceId: KITCHEN, epoch: mine.jobs[0]?.epoch ?? 0, outcome: "failed", sent: "no", reason: "unreachable", error: "NOT_CONNECTED", nowMs: nowMs + 8_000 });
  const skips = await skipsOf(o.kitchen);
  check(
    "(ba) the tablet cannot reach its printer: the refusal lands (queued, no attempt counted) and the tablet is skipped for it for 5 minutes",
    refused.status === "queued" && skips.length === 1 && skips[0]?.deviceId === KITCHEN && Date.parse(skips[0]?.until ?? "") === nowMs + 8_000 + PRINTER_UNREACHABLE_SKIP_MS,
  );
  const movedNow = await rowOf(u.kitchen?.id ?? "");
  check("(ba) ... and its slip moves to the counter at once, with no sweep, logged 'retargeted'", movedNow?.targetDeviceId === COUNTER && movedNow.log?.at(-1)?.event === "retargeted" && movedNow.uncertainAttempts === 0);
  const counterTakes = await lease(COUNTER, [o.kitchen], nowMs + 11_000);
  check("(ba) the counter leases it", counterTakes.jobs[0]?.id === u.kitchen?.id);
  check("(ba) while skipped, the tablet gets nothing from its own printer", (await lease(KITCHEN, [o.kitchen], nowMs + 11_000)).jobs.length === 0);
  await ackPrintJob({ id: counterTakes.jobs[0]?.id ?? "", deviceId: COUNTER, epoch: counterTakes.jobs[0]?.epoch ?? 0, outcome: "failed", sent: "no", reason: "unreachable", nowMs: nowMs + 12_000 });
  check("(ba) the counter cannot reach it either: both are skipped, and the slip goes back to its primary (it waits, visibly)", (await rowOf(u.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN && (await skipsOf(o.kitchen)).length === 2);
  const late = await recordPrinterUnreachable({ printerId: o.kitchen, deviceId: BAR, nowMs: nowMs + 13_000 });
  check("(ba) a device that does not write it now changes nothing", late === KITCHEN && (await skipsOf(o.kitchen)).length === 2);
  check("(ba) a device printer is never skipped (only network printers fail over)", (await recordPrinterUnreachable({ printerId: o.bar, deviceId: BAR, nowMs: nowMs + 13_000 })) === null && (await skipsOf(o.bar)).length === 0);

  const later = nowMs + 12_000 + PRINTER_UNREACHABLE_SKIP_MS + 1_000;
  await Promise.all([online(KITCHEN, later), online(COUNTER, later)]);
  check("(ba) five minutes on, the skips have run out: a new kitchen slip is the tablet's again", (await kotOf(o, later)).kitchen?.targetDeviceId === KITCHEN);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { Product } from "@/models/Product";
import { legAY } from "./print-host-live/token-jobs";
import { legAZ } from "./print-host-live/token-fence";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { Product } from "@/models/Product";
import { legAY } from "./print-host-live/token-jobs";
import { legAZ } from "./print-host-live/token-fence";
import { legBA } from "./print-host-live/failover";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAY(Date.now());
    // Phase 3 Session 3A legs (the token fix's M-2 fence; failover, the backup printer, printer health).
    await legAZ(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAY(Date.now());
    // Phase 3 Session 3A legs (the token fix's M-2 fence; failover, the backup printer, printer health).
    await legAZ(Date.now());
    await legBA(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

In `packages/shared/src/print-budget.ts`, find:

```ts
// Printing redesign, spec §17.2: the busy day the printing budget is sized for. print-budget.test.ts
// recomputes the "Vercel invocations" totals from these and from the agents' real cadence function
// (print-agent-wire.ts), and fails when printing could outgrow a cafe's free Vercel Hobby allowance.
```

Replace it with:

```ts
import { PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";

// Printing redesign, spec §17.2: the busy day the printing budget is sized for. print-budget.test.ts
// recomputes the "Vercel invocations" totals from these and from the agents' real cadence function
// (print-agent-wire.ts), and fails when printing could outgrow a cafe's free Vercel Hobby allowance.
```

In `packages/shared/src/print-budget.ts`, find:

```ts
 *  Active CPU on the busy day). */
export const PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY = 6_700;
export const PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY = 18_500;
/** Vercel Hobby's monthly function invocations (spec §17.1), as a day's share over 30 days: 33,333. */
export const VERCEL_HOBBY_INVOCATIONS_PER_DAY = Math.floor(1_000_000 / 30);
```

Replace it with:

```ts
 *  Active CPU on the busy day). */
export const PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY = 6_700;
export const PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY = 18_500;
/** Phase 3 (spec §9.3, §17): failover adds no request; who is online rides the wake's heartbeat. A writer that could not
 *  reach a network printer is passed over for it for PRINTER_UNREACHABLE_SKIP_MS while another device can take it, so
 *  such a printer costs that writer at most one lease and one ack per 5 minutes (a device that knows its printer is
 *  down never leases for it at all: Phase 1's rule). */
export function printUnreachableRequestsPerWriterPerDay(): number {
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS) * PRINT_REQUESTS_PER_SLIP;
}

/** Vercel Hobby's monthly function invocations (spec §17.1), as a day's share over 30 days: 33,333. */
export const VERCEL_HOBBY_INVOCATIONS_PER_DAY = Math.floor(1_000_000 / 30);
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && cd /d/kd/lucifer/packages/shared && npx tsc --noEmit && echo SHARED_TSC_OK`
Expected: `# tests 38`; `# pass 38`; `# fail 0`; `SHARED_TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-printer-test.test.ts lib/print-printer-routing.test.ts lib/self-order-alert-paths.test.ts lib/print-lease.test.ts lib/print-printer-jobs.test.ts lib/print-order-jobs.test.ts lib/print-token-jobs.test.ts lib/print-setup-paths.test.ts lib/print-setup-ui-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 141`; `# pass 141`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-failover.ts lib/print-lease.ts lib/print-device.ts lib/print-printers.ts lib/print-lifecycle-schemas.ts lib/print-routing-context.ts lib/print-printer-routing.ts lib/print-order-jobs.ts lib/print-printer-jobs.ts lib/print-sweep.ts lib/print-job-actions.ts lib/print-printer-test.ts models/Printer.ts models/PrintDevice.ts scripts/print-host-live/failover.ts scripts/verify-print-host-live.ts lib/print-lifecycle-paths.test.ts lib/print-printer-test.test.ts lib/print-printer-routing.test.ts lib/self-order-alert-paths.test.ts && echo LINT_OK`
Expected: `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3a npm run verify:print:live 2>&1 | grep -E "passed,|FAIL"`
Expected: `392 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-device.ts apps/cafe/lib/print-failover.ts apps/cafe/lib/print-job-actions.ts apps/cafe/lib/print-lease.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-lifecycle-schemas.ts apps/cafe/lib/print-order-jobs.ts apps/cafe/lib/print-printer-jobs.ts apps/cafe/lib/print-printer-routing.test.ts apps/cafe/lib/print-printer-routing.ts apps/cafe/lib/print-printer-test.test.ts apps/cafe/lib/print-printer-test.ts apps/cafe/lib/print-printers.ts apps/cafe/lib/print-routing-context.ts apps/cafe/lib/print-sweep.ts apps/cafe/lib/self-order-alert-paths.test.ts apps/cafe/models/PrintDevice.ts apps/cafe/models/Printer.ts apps/cafe/scripts/print-host-live/failover.ts apps/cafe/scripts/verify-print-host-live.ts packages/shared/src/print-budget.test.ts packages/shared/src/print-budget.ts
git commit -m "feat(print): failover on the server: a network printer is written by the device that writes it now, and a writer that cannot reach it is skipped for 5 minutes (Phase 3 Session 3A, A2)"
```

---

### Task A3: the backup printer: saved with a printer; the sweep moves a printer's untried slips to it while its device is offline

**Files:**
- Modify: `apps/cafe/models/Printer.ts` (`backupPrinterId`), `lib/print-printer-schemas.ts` (`backupPrinterId`), `lib/print-printers.ts` (the wire; never itself, one that exists; a deleted printer is nobody's backup)
- Modify: `apps/cafe/lib/print-failover.ts` (`moveToBackupPrinters`; `announcePrinterHead`), `lib/print-sweep.ts` (the backup move first)
- Create: `apps/cafe/scripts/print-host-live/backup.ts` (leg bb); modify `scripts/verify-print-host-live.ts`
- Tests: `apps/cafe/lib/print-lifecycle-paths.test.ts` (a pin, new; the sweep pin's lines changed), `lib/print-setup-paths.test.ts` (schema and wire asserts), `lib/print-setup-form.test.ts` (two lines: a body's `null` backup is never a config's)

**Interfaces produced:** `moveToBackupPrinters(printers, failover, nowMs): Promise<number>` (`lib/print-failover.ts`); `PrinterBody.backupPrinterId?`.

**Spec §9.4 (P3-5).** On the sweep, a printer whose writer now is offline sends its queued slips that never reached paper (no uncertain attempt) to its backup, while the backup's writer is online.

- Each slip that moves gets BACKUP PRINTER first among its labels, a `retargeted` log ("backup printer: Bar -> Counter"), the backup's printer id and writer. The backup's writer is told of the head.

- A network printer moves only when no device is left to take it over (A2 first).

- What never moves: a slip that may have printed, a bill waiting for the cashier, and a slip being printed. A printer with no backup keeps its slips, and its device's offline problem shows on every device (A4).

- The device back: its slips that did not move print there, in order. A slip's key never changes, so a replay still collides.

**Setup rules:** a backup must exist and is never the printer itself (400, in words). A deleted printer is cleared from every printer that named it (one write). The setup form gains the field in 3B; until then only the API sets it, so the move is dormant.

**A save that does not mention the backup keeps it; `null` clears it** (the planning review, I-1). A page from before 3B builds the whole printer from its form draft, which has no backup field, and re-saves the printer to switch it on or off. With "absent removes it" that page would drop a backup it cannot see, with no message. So `backupPrinterId` is `objectIdString.nullable().optional()`: absent keeps it (as `order` does), `null` clears it, and a string sets it.

**Changed existing pin and test:**

- `print-lifecycle-paths.test.ts` "PIN (2C): the sweep moves a waiting printer job only with its printer…" (the read says `backups`; the backup move comes first);

- `print-setup-form.test.ts` "2D: Set up printers makes Printer 1…" (a body's `backupPrinterId` may be `null`, which a `PrinterConfig` never holds, so the two configs the test builds map it to `undefined`).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
      "if (waiting === null) return { retargeted: 0, failed: 0 };",
      "const printers = routablePrinters(await listPrinters());",
      // Phase 3 (§9.3) deliberately changed the move: the writer now (failover), through print-failover.ts's one write.
      "const failover = await readPrinterFailover(printers, nowMs);",
      'retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);',
      "{ printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: \"queued\" }",
      "$set: { status: \"failed\", lastError: PRINTER_GONE_MESSAGE }",
```

Replace it with:

```ts
      "if (waiting === null) return { retargeted: 0, failed: 0 };",
      "const printers = routablePrinters(await listPrinters());",
      // Phase 3 (§9.3) deliberately changed the move: the writer now (failover), through print-failover.ts's one write.
      "const failover = await readPrinterFailover(printers, nowMs, true);",
      // Phase 3 (§9.4): first the slips of a printer whose device is offline go to its backup.
      "let retargeted = failover === null ? 0 : await moveToBackupPrinters(printers, failover, nowMs);",
      'retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);',
      "{ printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: \"queued\" }",
      "$set: { status: \"failed\", lastError: PRINTER_GONE_MESSAGE }",
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Phase 3 (the token fix's review, M-2): a page from before print-customization S7 cannot print a token job and its lease
// steps over one, so neither the ack's `more` nor the jobs-for-me count of the pulse and the wake may count one for it,
// or it pays an empty lease per ack and per pulse until the token goes stale. A page says so itself (Phase 3's page);
```

Replace it with:

```ts
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Phase 3 Session 3A (spec §9.4): only a slip that never reached paper moves to the backup printer, labelled; a slip that
// may have printed, a bill waiting for the cashier and a slip being printed stay with their own printer.
test("PIN (Phase 3, §9.4): the backup move takes only queued slips with no uncertain attempt, puts BACKUP PRINTER first, logs it, and tells the backup's writer", () => {
  const s = src("apps/cafe/lib/print-failover.ts");
  const move = s.slice(s.indexOf("export async function moveToBackupPrinters("));
  inOrder(
    move,
    [
      "const backup = printerBackupOf(printers, printer);",
      "if (backup === null || printerWriterOnline(printer, failover) || !printerWriterOnline(backup, failover)) continue;",
      '{ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }',
      "printerId: backup.id,",
      "labels: { $concatArrays: [[BACKUP_LABEL], { $filter:",
      'event: "retargeted"',
      "if (count > 0) await announcePrinterHead(backup.id, writer);",
    ],
    "the backup move",
  );
  assert.ok(!move.includes('"needs-confirm"') && !move.includes('"leased"'), "a bill waiting for the cashier and a slip being printed never move");
  assert.match(src("apps/cafe/lib/print-printers.ts"), /await Printer\.updateMany\(\{ backupPrinterId: id \}, \{ \$unset: \{ backupPrinterId: 1 \} \}\);/, "a deleted printer is nobody's backup");
});

// Phase 3 (the token fix's review, M-2): a page from before print-customization S7 cannot print a token job and its lease
// steps over one, so neither the ack's `more` nor the jobs-for-me count of the pulse and the wake may count one for it,
// or it pays an empty lease per ack and per pulse until the token goes stale. A page says so itself (Phase 3's page);
```

In `apps/cafe/lib/print-setup-form.test.ts`, find:

```ts
    assert.equal(body.name, SETUP_PRINTER_NAME);
    assert.deepEqual(body.slips, { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, "nothing changes on paper (decision 5)");
    assert.deepEqual(body.copies, { kot: 1, bill: 1 });
    const config: PrinterConfig = { id: "p1", order: 0, ...body };
    assert.equal(printerIsLocal(config, local ?? null, null), true, `the agent recognises it as this device's printer (${local?.kind})`);
  }
  const windows = localPrinterConnectionOf({ local: null, deviceId: "dev-a", desktop: { printerName: "EPSON" }, defaultPaper: 58 });
  assert.ok(windows !== null && printerIsLocal({ id: "w", order: 0, ...setUpPrintersBody(windows) }, null, { selected: "EPSON", names: ["EPSON"], named: false }), "the Windows app's printer");
});

test("2D: a new printer's form starts with Notices on (the 2B gate's M-7); an edit drops a station that is gone (the 2A gate's M4)", () => {
```

Replace it with:

```ts
    assert.equal(body.name, SETUP_PRINTER_NAME);
    assert.deepEqual(body.slips, { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, "nothing changes on paper (decision 5)");
    assert.deepEqual(body.copies, { kot: 1, bill: 1 });
    // Phase 3 (the planning review, I-1): a body may say `backupPrinterId: null` (clear it); a config never holds null.
    const config: PrinterConfig = { id: "p1", order: 0, ...body, backupPrinterId: body.backupPrinterId ?? undefined };
    assert.equal(printerIsLocal(config, local ?? null, null), true, `the agent recognises it as this device's printer (${local?.kind})`);
  }
  const windows = localPrinterConnectionOf({ local: null, deviceId: "dev-a", desktop: { printerName: "EPSON" }, defaultPaper: 58 });
  const windowsBody = windows === null ? null : setUpPrintersBody(windows);
  assert.ok(
    windowsBody !== null && printerIsLocal({ id: "w", order: 0, ...windowsBody, backupPrinterId: windowsBody.backupPrinterId ?? undefined }, null, { selected: "EPSON", names: ["EPSON"], named: false }),
    "the Windows app's printer",
  );
});

test("2D: a new printer's form starts with Notices on (the 2B gate's M-7); an edit drops a station that is gone (the 2A gate's M4)", () => {
```

In `apps/cafe/lib/print-setup-paths.test.ts`, find:

```ts
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [STATION, STATION], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: ["bar"], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [], kotAll: false, notices: true } })).success, false, "eod must be stated");
  assert.equal(printerBodySchema.safeParse(lanBody({ health: { state: "online" } })).success, false, "strict: Phase 3 fields are refused");
  assert.equal(printerBodySchema.safeParse(lanBody({ name: "x".repeat(41) })).success, false);
});
```

Replace it with:

```ts
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [STATION, STATION], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: ["bar"], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [], kotAll: false, notices: true } })).success, false, "eod must be stated");
  assert.equal(printerBodySchema.safeParse(lanBody({ health: { state: "online" } })).success, false, "strict: what the server keeps is never saved by the form");
  // Phase 3 (spec §9.4): a backup printer by id; anything else is refused.
  assert.equal(printerBodySchema.safeParse(lanBody({ backupPrinterId: STATION })).success, true, "a printer id");
  assert.equal(printerBodySchema.safeParse(lanBody({ backupPrinterId: "counter" })).success, false, "an id only");
  assert.equal(printerBodySchema.safeParse(lanBody({ backupPrinterId: null })).success, true, "null clears it (absent keeps it: the planning review, I-1)");
  assert.equal(printerBodySchema.safeParse(lanBody({ unreachable: [] })).success, false, "the skips are the server's");
  assert.equal(printerBodySchema.safeParse(lanBody({ name: "x".repeat(41) })).success, false);
});
```

In `apps/cafe/lib/print-setup-paths.test.ts`, find:

```ts
  });
  assert.equal(wire.id, String(id));
  assert.ok(!("primaryDeviceId" in wire), "omit-empty on the wire too");
  assert.deepEqual(wire.connection, { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" });
});
```

Replace it with:

```ts
  });
  assert.equal(wire.id, String(id));
  assert.ok(!("primaryDeviceId" in wire), "omit-empty on the wire too");
  assert.ok(!("backupPrinterId" in wire) && !("unreachable" in wire), "Phase 3: omit-empty, the backup and the skips");
  assert.deepEqual(wire.connection, { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" });
});
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-setup-paths.test.ts lib/print-setup-form.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 54`; `# pass 51`; `# fail 3`

- [ ] **Step 3: The code**

In `apps/cafe/lib/print-failover.ts`, find:

```ts
import { PRINT_JOB_LOG_MAX } from "@pos/shared/print-lifecycle";
import { PRINTER_UNREACHABLE_SKIP_MS, printerActiveWriter, type PrinterFailover } from "@pos/shared/print-failover";
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
import { PrintJob } from "@/models/PrintJob";
```

Replace it with:

```ts
import { PRINT_JOB_LOG_MAX, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { PRINTER_UNREACHABLE_SKIP_MS, printerActiveWriter, printerBackupOf, printerWriterOnline, type PrinterFailover } from "@pos/shared/print-failover";
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
import { PrintJob } from "@/models/PrintJob";
```

In `apps/cafe/lib/print-failover.ts`, find:

```ts
// shared rule: @pos/shared/print-failover printerActiveWriter). Job creation (the routing read), the lease, a staff
// retry, a Test print and the sweep all ask who writes a printer now through readPrinterFailover; an ack that says its
// writer could not reach the printer skips that writer for it for 5 minutes and moves the waiting slips to the next.
// No new request: who is online comes from the heartbeat that already rides the wake. Never calls connectDB(). No
// console.*.

const WAITING = ["queued", "needs-confirm", "failed"];

/** Whether who-is-online matters to these printers: a routable network printer (§9.3) or, with `backups`, a routable
 *  printer with a backup (§9.4, the sweep). */
```

Replace it with:

```ts
// shared rule: @pos/shared/print-failover printerActiveWriter). Job creation (the routing read), the lease, a staff
// retry, a Test print and the sweep all ask who writes a printer now through readPrinterFailover; an ack that says its
// writer could not reach the printer skips that writer for it for 5 minutes and moves the waiting slips to the next.
// Spec §9.4: the sweep moves the waiting slips of a printer whose device is offline to its backup printer.
// No new request: who is online comes from the heartbeat that already rides the wake. Never calls connectDB(). No
// console.*.

const WAITING = ["queued", "needs-confirm", "failed"];
const BACKUP_LABEL: PrintJobLabel = "BACKUP PRINTER";

/** Whether who-is-online matters to these printers: a routable network printer (§9.3) or, with `backups`, a routable
 *  printer with a backup (§9.4, the sweep). */
```

In `apps/cafe/lib/print-failover.ts`, find:

```ts
    { $set: { targetDeviceId: writer }, $push: { log: { $each: [{ at, event: "retargeted", deviceId: writer }], $slice: -PRINT_JOB_LOG_MAX } } },
  );
  const count = moved.modifiedCount ?? 0;
  if (count > 0 && writer !== "") {
    const head = await PrintJob.findOne({ printerId, status: "queued" }).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
    if (head !== null) publishPrintStatus({ id: String(head._id), status: "queued", target: writer, printerId });
  }
  return count;
}

/** §9.3: a writer that could not reach a network printer (its ack: failed, sent "no", reason "unreachable") is skipped
```

Replace it with:

```ts
    { $set: { targetDeviceId: writer }, $push: { log: { $each: [{ at, event: "retargeted", deviceId: writer }], $slice: -PRINT_JOB_LOG_MAX } } },
  );
  const count = moved.modifiedCount ?? 0;
  if (count > 0) await announcePrinterHead(printerId, writer);
  return count;
}

/** Tells a printer's writer of the oldest slip queued on its line (one read, one realtime request), so it leases now. */
async function announcePrinterHead(printerId: string, writer: string): Promise<void> {
  if (writer === "") return;
  const head = await PrintJob.findOne({ printerId, status: "queued" }).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
  if (head !== null) publishPrintStatus({ id: String(head._id), status: "queued", target: writer, printerId });
}

/** §9.4: a printer whose device is offline (no heartbeat for 90 s; a network printer with no online device left to take
 *  it over) sends its waiting slips to its backup printer, when the backup's device is online: each queued slip that was
 *  never tried, or only refused before any byte (no uncertain attempt), moves with BACKUP PRINTER first among its
 *  labels and a 'retargeted' log, and the backup's writer is told of its head. A slip that may have printed, a bill
 *  waiting for the cashier and a slip being printed stay; so does every slip of a printer with no backup (every device's
 *  panel says its device is offline, print-attention.ts). The device back, the slips not moved print there, in order.
 *  One write per such printer (a pipeline update), none when its device is online. */
export async function moveToBackupPrinters(printers: readonly PrinterConfig[], failover: PrinterFailover, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  let moved = 0;
  for (const printer of printers) {
    const backup = printerBackupOf(printers, printer);
    if (backup === null || printerWriterOnline(printer, failover) || !printerWriterOnline(backup, failover)) continue;
    const writer = printerActiveWriter(backup, failover) ?? "";
    const res = await PrintJob.updateMany({ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }, [
      {
        $set: {
          printerId: backup.id,
          targetDeviceId: writer,
          labels: { $concatArrays: [[BACKUP_LABEL], { $filter: { input: { $ifNull: ["$labels", []] }, cond: { $ne: ["$$this", BACKUP_LABEL] } } }] },
          log: {
            $slice: [
              { $concatArrays: [{ $ifNull: ["$log", []] }, [{ at, event: "retargeted", deviceId: writer, detail: `backup printer: ${printer.name} -> ${backup.name}` }]] },
              -PRINT_JOB_LOG_MAX,
            ],
          },
        },
      },
    ]);
    const count = res.modifiedCount ?? 0;
    if (count > 0) await announcePrinterHead(backup.id, writer);
    moved += count;
  }
  return moved;
}

/** §9.3: a writer that could not reach a network printer (its ack: failed, sent "no", reason "unreachable") is skipped
```

In `apps/cafe/lib/print-printer-schemas.ts`, find:

```ts
    name: z.string().trim().min(1, "Name the printer").max(PRINTER_NAME_MAX_CHARS, `Keep it to ${PRINTER_NAME_MAX_CHARS} characters or fewer`),
    connection: z.discriminatedUnion("kind", [lanConnection, deviceConnection]),
    primaryDeviceId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS).optional(),
    /** Display order; absent on create puts it last, absent on save keeps it. */
    order: z.number().int().min(0).max(10_000).optional(),
    paper: z.union([z.literal(58), z.literal(80)]),
```

Replace it with:

```ts
    name: z.string().trim().min(1, "Name the printer").max(PRINTER_NAME_MAX_CHARS, `Keep it to ${PRINTER_NAME_MAX_CHARS} characters or fewer`),
    connection: z.discriminatedUnion("kind", [lanConnection, deviceConnection]),
    primaryDeviceId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS).optional(),
    /** Phase 3 (spec §9.4): the printer that takes this one's waiting slips while its device is offline. It must exist,
     *  and never be the printer itself. `null` clears it; absent keeps it on a save (the planning review, I-1: a page from
     *  before Session 3B saves the whole printer without this field, and must never drop a backup it cannot see). */
    backupPrinterId: objectIdString.nullable().optional(),
    /** Display order; absent on create puts it last, absent on save keeps it. */
    order: z.number().int().min(0).max(10_000).optional(),
    paper: z.union([z.literal(58), z.literal(80)]),
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINTERS_MAX, printerClashMessage, printerWriterClash, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import { Printer, type IPrinter, type IPrinterConnection } from "@/models/Printer";
import { Station } from "@/models/Station";
```

Replace it with:

```ts
import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINTER_BACKUP_SELF_MESSAGE, PRINTER_BACKUP_UNKNOWN_MESSAGE } from "@pos/shared/print-failover";
import { PRINTERS_MAX, printerClashMessage, printerWriterClash, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import { Printer, type IPrinter, type IPrinterConnection } from "@/models/Printer";
import { Station } from "@/models/Station";
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled" | "unreachable"> & {
  _id: Types.ObjectId;
};
```

Replace it with:

```ts
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled" | "backupPrinterId" | "unreachable"> & {
  _id: Types.ObjectId;
};
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
    },
    copies: { kot: row.copies.kot, bill: row.copies.bill },
    enabled: row.enabled,
    // Phase 3 (spec §9.3): the writers skipped for this network printer, as the server keeps them.
    ...(row.unreachable !== undefined && row.unreachable.length > 0
      ? { unreachable: row.unreachable.map((skip) => ({ deviceId: skip.deviceId, until: skip.until.toISOString() })) }
```

Replace it with:

```ts
    },
    copies: { kot: row.copies.kot, bill: row.copies.bill },
    enabled: row.enabled,
    ...(row.backupPrinterId !== undefined ? { backupPrinterId: row.backupPrinterId } : {}),
    // Phase 3 (spec §9.3): the writers skipped for this network printer, as the server keeps them.
    ...(row.unreachable !== undefined && row.unreachable.length > 0
      ? { unreachable: row.unreachable.map((skip) => ({ deviceId: skip.deviceId, until: skip.until.toISOString() })) }
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled unreachable";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
```

Replace it with:

```ts
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled backupPrinterId unreachable";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
}

export async function createPrinter(body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, ...stored } = body;
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  const existing = await listPrinters();
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  if (await nameTaken(stored.name)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  // Session 2D (the 2C review gate, F-3): one routable printer per printing device; Session 2E: a Windows PC may
  // print several Windows printers, each a different one.
  const clash = printerWriterClash(existing, stored);
```

Replace it with:

```ts
}

export async function createPrinter(body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, backupPrinterId, ...rest } = body;
  const stored = { ...rest, ...(typeof backupPrinterId === "string" ? { backupPrinterId } : {}) };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  const existing = await listPrinters();
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  if (await nameTaken(stored.name)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  // Phase 3 (spec §9.4): a backup is another printer that exists now (a stale form never saves a dead id).
  if (stored.backupPrinterId !== undefined && !existing.some((row) => row.id === stored.backupPrinterId)) {
    return { ok: false, status: 400, error: PRINTER_BACKUP_UNKNOWN_MESSAGE };
  }
  // Session 2D (the 2C review gate, F-3): one routable printer per printing device; Session 2E: a Windows PC may
  // print several Windows printers, each a different one.
  const clash = printerWriterClash(existing, stored);
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts

/** Saves a printer whole (the setup form's one unit). The connection is replaced, never merged (a LAN
 *  printer moved to a device keeps no host); an absent order keeps its place; an absent primaryDeviceId is
 *  removed (a device printer never has one). */
export async function replacePrinter(id: string, body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, ...stored } = body;
  const printer = await Printer.findById(id);
  if (printer === null) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  if (await nameTaken(stored.name, id)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  const clash = printerWriterClash(await listPrinters(), stored, id);
  if (clash !== null) return { ok: false, status: 409, error: printerClashMessage(clash, stored) };
  printer.set("connection", stored.connection);
  printer.set("primaryDeviceId", stored.primaryDeviceId);
  printer.set({ name: stored.name, paper: stored.paper, slips: stored.slips, copies: stored.copies, enabled: stored.enabled });
  if (order !== undefined) printer.order = order;
  try {
```

Replace it with:

```ts

/** Saves a printer whole (the setup form's one unit). The connection is replaced, never merged (a LAN
 *  printer moved to a device keeps no host); an absent order keeps its place; an absent primaryDeviceId is
 *  removed (a device printer never has one). Phase 3: an absent backup keeps its backup, `null` clears it. */
export async function replacePrinter(id: string, body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, backupPrinterId, ...stored } = body;
  const printer = await Printer.findById(id);
  if (printer === null) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  if (await nameTaken(stored.name, id)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  const printers = await listPrinters();
  // Phase 3 (spec §9.4): never itself, and one that exists now.
  if (backupPrinterId === id) return { ok: false, status: 400, error: PRINTER_BACKUP_SELF_MESSAGE };
  if (typeof backupPrinterId === "string" && !printers.some((row) => row.id === backupPrinterId)) {
    return { ok: false, status: 400, error: PRINTER_BACKUP_UNKNOWN_MESSAGE };
  }
  const clash = printerWriterClash(printers, stored, id);
  if (clash !== null) return { ok: false, status: 409, error: printerClashMessage(clash, stored) };
  printer.set("connection", stored.connection);
  printer.set("primaryDeviceId", stored.primaryDeviceId);
  // The planning review (I-1): a save that does not mention the backup keeps it; `null` clears it.
  if (backupPrinterId !== undefined) printer.set("backupPrinterId", backupPrinterId ?? undefined);
  printer.set({ name: stored.name, paper: stored.paper, slips: stored.slips, copies: stored.copies, enabled: stored.enabled });
  if (order !== undefined) printer.order = order;
  try {
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
export async function deletePrinter(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const res = await Printer.deleteOne({ _id: id });
  if (res.deletedCount !== 1) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  publishCafeEvent("print-setup");
  return { ok: true, data: { deleted: true } };
}
```

Replace it with:

```ts
export async function deletePrinter(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const res = await Printer.deleteOne({ _id: id });
  if (res.deletedCount !== 1) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  // Phase 3 (spec §9.4): a deleted printer is nobody's backup any more (one write; none when no printer named it).
  await Printer.updateMany({ backupPrinterId: id }, { $unset: { backupPrinterId: 1 } });
  publishCafeEvent("print-setup");
  return { ok: true, data: { deleted: true } };
}
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { readPrinterFailover, retargetPrinterJobs } from "./print-failover";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";
import { prunePrintJobsThrottled } from "./print-queue";
```

Replace it with:

```ts
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { moveToBackupPrinters, readPrinterFailover, retargetPrinterJobs } from "./print-failover";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { listPrinters } from "./print-printers";
import { prunePrintJobsThrottled } from "./print-queue";
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
 *  is left to its lease. One read when no queued or needs-confirm printer job waits (every simple-mode cafe, and
 *  every outlet whose waiting rows are only failed ones); otherwise the printers, one write per printer and one for
 *  the gone ones. Phase 3 (§9.3): "its writer" is the device that writes it now (a network printer's primary, or the
 *  device that took it over: one read of who is online), and a writer that changed is told of its line's head. */
export async function routePrinterJobs(nowMs: number): Promise<{ retargeted: number; failed: number }> {
  const waiting = await PrintJob.findOne({ printerId: { $exists: true, $ne: PRINT_JOB_NO_PRINTER }, status: { $in: ["queued", "needs-confirm"] } })
    .select("_id")
```

Replace it with:

```ts
 *  is left to its lease. One read when no queued or needs-confirm printer job waits (every simple-mode cafe, and
 *  every outlet whose waiting rows are only failed ones); otherwise the printers, one write per printer and one for
 *  the gone ones. Phase 3 (§9.3): "its writer" is the device that writes it now (a network printer's primary, or the
 *  device that took it over: one read of who is online), and a writer that changed is told of its line's head. Spec
 *  §9.4 first: a printer whose device is offline sends its waiting slips to its backup printer (moveToBackupPrinters). */
export async function routePrinterJobs(nowMs: number): Promise<{ retargeted: number; failed: number }> {
  const waiting = await PrintJob.findOne({ printerId: { $exists: true, $ne: PRINT_JOB_NO_PRINTER }, status: { $in: ["queued", "needs-confirm"] } })
    .select("_id")
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
  if (waiting === null) return { retargeted: 0, failed: 0 };
  const at = new Date(nowMs);
  const printers = routablePrinters(await listPrinters());
  const failover = await readPrinterFailover(printers, nowMs);
  let retargeted = 0;
  for (const printer of printers) {
    retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);
  }
```

Replace it with:

```ts
  if (waiting === null) return { retargeted: 0, failed: 0 };
  const at = new Date(nowMs);
  const printers = routablePrinters(await listPrinters());
  const failover = await readPrinterFailover(printers, nowMs, true);
  let retargeted = failover === null ? 0 : await moveToBackupPrinters(printers, failover, nowMs);
  for (const printer of printers) {
    retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);
  }
```

In `apps/cafe/models/Printer.ts`, find:

```ts
// the stored shape honest on its own.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. Phase 3 adds what the server keeps beside the setup: `unreachable` (§9.3, the
// writers skipped for 5 minutes).

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
```

Replace it with:

```ts
// the stored shape honest on its own.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. Phase 3 adds the backup printer (`backupPrinterId`, §9.4: saved with the setup) and
// what the server keeps beside the setup: `unreachable` (§9.3, the writers skipped for 5 minutes).

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
```

In `apps/cafe/models/Printer.ts`, find:

```ts
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  unreachable?: Array<{ deviceId: string; until: Date }>; // Phase 3 (§9.3): server-kept, never saved by the setup
  createdAt: Date;
  updatedAt: Date;
```

Replace it with:

```ts
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  backupPrinterId?: string; // Phase 3 (§9.4): another printer's id; omit-empty
  unreachable?: Array<{ deviceId: string; until: Date }>; // Phase 3 (§9.3): server-kept, never saved by the setup
  createdAt: Date;
  updatedAt: Date;
```

In `apps/cafe/models/Printer.ts`, find:

```ts
    slips: { type: slipsSchema, required: true },
    copies: { type: copiesSchema, required: true },
    enabled: { type: Boolean, required: true },
    // Omit-empty (no [] default): written only by an ack that could not reach the printer (lib/print-failover.ts).
    unreachable: { type: [unreachableSchema], default: undefined },
  },
```

Replace it with:

```ts
    slips: { type: slipsSchema, required: true },
    copies: { type: copiesSchema, required: true },
    enabled: { type: Boolean, required: true },
    // Phase 3 (spec §9.4): where this printer's waiting slips go while its device is offline. A printer deleted is
    // cleared from every printer that named it (lib/print-printers.ts deletePrinter).
    backupPrinterId: { type: String, maxlength: 24 },
    // Omit-empty (no [] default): written only by an ack that could not reach the printer (lib/print-failover.ts).
    unreachable: { type: [unreachableSchema], default: undefined },
  },
```

Create `apps/cafe/scripts/print-host-live/backup.ts`:

```ts
/**
 * Phase 3 Session 3A live leg (bb) — the backup printer (spec §9.4) against a REAL MongoDB: saved with a printer (never
 * itself, never a printer that does not exist, cleared when that printer is deleted); the sweep moves the waiting slips
 * of a printer whose device is offline to it, labelled BACKUP PRINTER, while a slip that may have printed stays; a
 * network printer with no device left to take it over moves too; nothing moves with no backup, with the backup's own
 * device offline, or once the device is back. Run by scripts/verify-print-host-live.ts after leg ba.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_BACKUP_SELF_MESSAGE, PRINTER_BACKUP_UNKNOWN_MESSAGE } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { leasePrintJobs } from "@/lib/print-lease";
import { deletePrinter, listPrinters, replacePrinter } from "@/lib/print-printers";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check } from "./harness";
import { STAFF, rowOf, setRaw } from "./lifecycle";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

export async function legBB(nowMs: number): Promise<void> {
  console.log("\n(bb) the backup printer (§9.4): a printer whose device is offline sends its waiting slips there, labelled BACKUP PRINTER");
  const o = await failoverOutlet();
  const barStation = String((await Station.findOne({ name: "Bar" }).select("_id").lean())?._id ?? "");
  const bar = (over: Partial<PrinterBody>): PrinterBody => ({
    name: "Bar",
    connection: { kind: "device", deviceId: BAR, transport: "bt-classic", address: "AA:BB:CC" },
    paper: 80,
    slips: { ...NO_SLIPS, kotStations: [barStation], notices: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  });
  const self = await replacePrinter(o.bar, bar({ backupPrinterId: o.bar }));
  const unknown = await replacePrinter(o.bar, bar({ backupPrinterId: "aaaaaaaaaaaaaaaaaaaaaaaa" }));
  check("(bb) a printer is never its own backup, and a backup must exist (400s, in words)", !self.ok && self.error === PRINTER_BACKUP_SELF_MESSAGE && !unknown.ok && unknown.error === PRINTER_BACKUP_UNKNOWN_MESSAGE);
  const saved = await replacePrinter(o.bar, bar({ backupPrinterId: o.counter }));
  check("(bb) the bar printer saved with the counter printer as its backup", saved.ok && saved.data.backupPrinterId === o.counter);

  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  const fresh = await kotOf(o, nowMs);
  const maybe = await kotOf(o, nowMs);
  await setRaw(maybe.bar?.id ?? "", { uncertainAttempts: 1, labels: ["REPRINT"] });
  await routePrinterJobs(nowMs + 500);
  check("(bb) the bar phone online: nothing moves", (await rowOf(fresh.bar?.id ?? ""))?.printerId === o.bar);

  await offline(BAR, nowMs + 1_000);
  await routePrinterJobs(nowMs + 1_000);
  const moved = await rowOf(fresh.bar?.id ?? "");
  check(
    "(bb) the bar phone offline: its waiting slip moves to the counter printer, for the counter, labelled BACKUP PRINTER",
    moved?.printerId === o.counter && moved.targetDeviceId === COUNTER && (moved.labels ?? []).join() === "BACKUP PRINTER",
  );
  check("(bb) ... logged 'retargeted' with both printers' names", moved?.log?.at(-1)?.event === "retargeted" && moved.log?.at(-1)?.detail === "backup printer: Bar -> Counter");
  const stayed = await rowOf(maybe.bar?.id ?? "");
  check("(bb) a slip that may already have printed stays with the bar printer (REPRINT kept, never doubled elsewhere)", stayed?.printerId === o.bar && (stayed.labels ?? []).join() === "REPRINT");
  const taken = await leasePrintJobs({ deviceId: COUNTER, tabId: "counter-tab", tokenSlips: true, printerIds: [o.counter], dismissedBy: STAFF, nowMs: nowMs + 2_000 });
  check("(bb) the counter leases it and prints the banner BACKUP PRINTER", taken.jobs[0]?.id === fresh.bar?.id && taken.jobs[0]?.labels.join() === "BACKUP PRINTER");

  await online(BAR, nowMs + 3_000);
  const back = await kotOf(o, nowMs + 3_000);
  await routePrinterJobs(nowMs + 3_000);
  check("(bb) the bar phone back: a new slip prints there, and the one that stayed is still its own", (await rowOf(back.bar?.id ?? ""))?.printerId === o.bar && (await rowOf(maybe.bar?.id ?? ""))?.printerId === o.bar);

  await Promise.all([offline(BAR, nowMs + 4_000), offline(COUNTER, nowMs + 4_000), offline(KITCHEN, nowMs + 4_000)]);
  await routePrinterJobs(nowMs + 4_000);
  check("(bb) no device online for the backup either (its primary offline, nobody left to take it over): nothing moves", (await rowOf(back.bar?.id ?? ""))?.printerId === o.bar);
  const kept = await replacePrinter(o.bar, bar({}));
  check("(bb) a save that does not mention the backup keeps it (a page from before 3B saves the whole printer without it)", kept.ok && kept.data.backupPrinterId === o.counter);
  await replacePrinter(o.bar, bar({ backupPrinterId: null }));
  await online(COUNTER, nowMs + 5_000);
  await routePrinterJobs(nowMs + 5_000);
  check("(bb) a printer whose backup was cleared (null) keeps its slips while its device is offline (they wait, visibly)", (await rowOf(back.bar?.id ?? ""))?.printerId === o.bar && !("backupPrinterId" in ((await listPrinters()).find((p) => p.id === o.bar) ?? {})));

  await Printer.updateOne({ _id: o.kitchen }, { $set: { backupPrinterId: o.counter } });
  await Promise.all([offline(KITCHEN, nowMs + 6_000), online(COUNTER, nowMs + 6_000, false)]);
  const lost = await kotOf(o, nowMs + 6_000);
  await routePrinterJobs(nowMs + 6_000);
  const kitchenMoved = await rowOf(lost.kitchen?.id ?? "");
  check("(bb) a network printer with no device left to take it over (only a page from before Phase 3 online) moves to its backup too", kitchenMoved?.printerId === o.counter && (kitchenMoved.labels ?? []).join() === "BACKUP PRINTER");

  await deletePrinter(o.counter);
  check("(bb) deleting the backup printer clears it from every printer that named it", (await listPrinters()).every((printer) => printer.backupPrinterId === undefined) && (await Printer.countDocuments({ backupPrinterId: { $exists: true } })) === 0);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legAY } from "./print-host-live/token-jobs";
import { legAZ } from "./print-host-live/token-fence";
import { legBA } from "./print-host-live/failover";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { legAY } from "./print-host-live/token-jobs";
import { legAZ } from "./print-host-live/token-fence";
import { legBA } from "./print-host-live/failover";
import { legBB } from "./print-host-live/backup";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    // Phase 3 Session 3A legs (the token fix's M-2 fence; failover, the backup printer, printer health).
    await legAZ(Date.now());
    await legBA(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    // Phase 3 Session 3A legs (the token fix's M-2 fence; failover, the backup printer, printer health).
    await legAZ(Date.now());
    await legBA(Date.now());
    await legBB(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-setup-paths.test.ts lib/print-setup-form.test.ts lib/self-order-alert-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 64`; `# pass 64`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-failover.ts lib/print-printers.ts lib/print-printer-schemas.ts lib/print-sweep.ts models/Printer.ts scripts/print-host-live/backup.ts scripts/verify-print-host-live.ts lib/print-lifecycle-paths.test.ts lib/print-setup-paths.test.ts lib/print-setup-form.test.ts && echo LINT_OK`
Expected: `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3a npm run verify:print:live 2>&1 | grep -E "passed,|FAIL"`
Expected: `405 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-failover.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-printer-schemas.ts apps/cafe/lib/print-printers.ts apps/cafe/lib/print-setup-form.test.ts apps/cafe/lib/print-setup-paths.test.ts apps/cafe/lib/print-sweep.ts apps/cafe/models/Printer.ts apps/cafe/scripts/print-host-live/backup.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "feat(print): the backup printer: saved with a printer, and the sweep moves the waiting slips of a printer whose device is offline to it, labelled BACKUP PRINTER (Phase 3 Session 3A, A3)"
```

---

### Task A4: printer health rides the heartbeat; every device's waiting-slips feed says each printer's problem

**Files:**
- Create: `apps/cafe/lib/print-health.ts` (`printerHealthNeedsWrite`, `printerHealthChangedFilter`, `recordPrinterHealth`)
- Modify: `apps/cafe/models/Printer.ts` (`health`), `lib/print-printers.ts` (the wire's `health`), `lib/print-lifecycle-schemas.ts` (the wake's `printers`), `app/api/print-jobs/wake/route.ts` (who is online, read once; the health), `lib/print-attention.ts` (`printAttentionProblemsOf`; the problem on each row)
- Modify: `packages/shared/src/print-budget.ts` (`printHealthRefreshWritesPerPrinterPerDay`)
- Create: `apps/cafe/scripts/print-host-live/health.ts` (leg bc); modify `scripts/verify-print-host-live.ts`
- Tests: `packages/shared/src/print-budget.test.ts` (a pin, new); `apps/cafe/lib/print-health.test.ts` (create; `apps/cafe/package.json` `testChain` gains it as its own entry); `apps/cafe/lib/print-lifecycle-paths.test.ts` (a pin new; schema asserts; the wake pin's lines changed), `lib/print-attention.test.ts` (a test, new), `lib/print-setup-paths.test.ts` (a wire assert)

**Interfaces produced:** `printerHealthNeedsWrite(kept, deviceId, report, nowMs): boolean`, `printerHealthChangedFilter(printerId, deviceId, report, nowMs)`, `recordPrinterHealth({ deviceId, reports, printers, failover, nowMs }): Promise<number>` (`lib/print-health.ts`); `printAttentionProblemsOf(rows, printers, failover): PrintAttentionRow[]` (`lib/print-attention.ts`); `IPrinterHealth` (`models/Printer.ts`); `printHealthRefreshWritesPerPrinterPerDay()` (`@pos/shared/print-budget`).

**Spec §10 (P3-6).** The wake's body may carry `printers: [{ printerId, link, paper?, cover?, error? }]`. The server keeps each report on its printer only when it comes from the device that writes that printer now, and only when it changed or a steady one is due its 5-minute refresh. The wake reads who is online once, for the agent count and the health (it was a count).

**No operation when nothing changed** (the planning review, M-2). A report is compared in memory with the health the wake's own printers read already holds (`printerHealthNeedsWrite`). A wake that changes nothing costs no Atlas operation, even at the 3 s cadence of a socket that is down (12 printers would otherwise be 4 operations a second). The filtered `updateOne` stays the race guard, and the writes go together (`Promise.all`).

**"Shows on every device"** (P3-7). The waiting-slips feed the pulse already carries gives each slip still waiting for its printer (queued) that printer's problem (`printerProblemOf`), from two small reads made only while such a slip waits. A failed slip or a bill to check keeps its own words, and costs no read for the 3 hours it stays in the feed (the planning review, M-4). A failed read leaves the rows as they were. The printers read every device already makes carries the health too.

**Dormant** until a page reports health (3B): rows on a printer whose device is offline already say `device-offline`, and a Phase 2 page ignores the field.

**Changed existing pin:** `print-lifecycle-paths.test.ts` "PIN: POST /api/print-jobs/wake beats…" (who is online, read once; the health write; the agent count from it).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-attention.test.ts`, find:

```ts
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { PRINT_JOB_ACTED_GRACE_MS, PRINT_JOB_QUEUED_RETENTION_MS } from "@pos/shared/print-job";
import { stripComments } from "@/lib/source-pin-utils";
import { printAttentionFilter, printAttentionRowOf } from "@/lib/print-attention";

// Printing Phase 1 Session 1D (spec §10): the waiting-slips feed on the existing 20 s pulse (one bounded
// read), the pulse sweep (D2), and staff Retry / Print again aimed at the printing device (D7). DB
```

Replace it with:

```ts
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { PRINT_JOB_ACTED_GRACE_MS, PRINT_JOB_QUEUED_RETENTION_MS } from "@pos/shared/print-job";
import { stripComments } from "@/lib/source-pin-utils";
import { printAttentionFilter, printAttentionProblemsOf, printAttentionRowOf } from "@/lib/print-attention";
import type { PrinterConfig } from "@pos/shared/print-printers";

// Printing Phase 1 Session 1D (spec §10): the waiting-slips feed on the existing 20 s pulse (one bounded
// read), the pulse sweep (D2), and staff Retry / Print again aimed at the printing device (D7). DB
```

In `apps/cafe/lib/print-attention.test.ts`, find:

```ts
  // prune, so the panel shows it until then.
  assert.equal(PRINT_ATTENTION_WINDOW_MS, PRINT_JOB_QUEUED_RETENTION_MS + PRINT_JOB_ACTED_GRACE_MS, "the queued retention (§7.8, 3 h) plus the acted grace (15 min): the panel shows every waiting slip the prune keeps");
  assert.equal(PRINT_ATTENTION_LIMIT, 20, "a bounded read on the hottest poll");
});

test("PIN (owner, after Session 1D: I-1 option A): the feed reads the NEWEST rows on the same index and shows them oldest first", () => {
```

Replace it with:

```ts
  // prune, so the panel shows it until then.
  assert.equal(PRINT_ATTENTION_WINDOW_MS, PRINT_JOB_QUEUED_RETENTION_MS + PRINT_JOB_ACTED_GRACE_MS, "the queued retention (§7.8, 3 h) plus the acted grace (15 min): the panel shows every waiting slip the prune keeps");
  assert.equal(PRINT_ATTENTION_LIMIT, 20, "a bounded read on the hottest poll");
});

// Phase 3 Session 3A (spec §9.4, §10): a row on a printer says why that printer cannot print now, so every device
// shows "The device that prints Bar is offline." or "Bar is out of paper." beside the slip.
test("printAttentionProblemsOf: a row on a printer with a problem says it; a row with none, or on no printer, or on a gone one, is as it was", () => {
  const bar: PrinterConfig = {
    id: "b".repeat(24),
    name: "Bar",
    connection: { kind: "device", deviceId: "bar-phone", transport: "bt-classic", address: "AA:BB" },
    order: 0,
    paper: 80,
    slips: { bill: false, kotStations: ["s"], kotAll: false, notices: false, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
  };
  const row = (printerId?: string) => ({ id: "j", kind: "kot" as const, label: "KOT", status: "queued" as const, labels: [], createdAt: at(T0).toISOString(), ...(printerId !== undefined ? { printerId } : {}) });
  const rows = [row(bar.id), row(), row("c".repeat(24)), { ...row(bar.id), status: "failed" as const }];
  const offline = printAttentionProblemsOf(rows, [bar], { online: [], nowMs: T0 });
  assert.deepEqual(offline.map((r) => r.problem ?? "-"), ["device-offline", "-", "-", "-"], "only a slip still waiting on a known printer (the planning review, M-4: not a failed one)");
  const out = printAttentionProblemsOf(rows, [{ ...bar, health: { link: "connected", paper: "out", deviceId: "bar-phone", at: at(T0).toISOString() } }], { online: [{ deviceId: "bar-phone", lanFailover: true }], nowMs: T0 });
  assert.equal(out[0]?.problem, "paper-out");
  const fine = printAttentionProblemsOf(rows, [bar], { online: [{ deviceId: "bar-phone", lanFailover: true }], nowMs: T0 });
  assert.ok(fine.every((r) => !("problem" in r)), "nothing known: no field");
});

test("PIN (owner, after Session 1D: I-1 option A): the feed reads the NEWEST rows on the same index and shows them oldest first", () => {
```

Create `apps/cafe/lib/print-health.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINTER_HEALTH_REFRESH_MS, type PrinterHealth, type PrinterHealthReport } from "@pos/shared/print-failover";
import { printerHealthChangedFilter, printerHealthNeedsWrite } from "@/lib/print-health";

// Printing Phase 3 Session 3A (spec §10): health rides the wake. The planning review (M-2): a report is compared with the
// kept health in memory first, so a wake that changes nothing costs no Atlas operation (the filter stays the race guard).
// The writes themselves are proven live (leg bc).

const T0 = Date.parse("2026-10-07T12:00:00.000Z");
const kept: PrinterHealth = { link: "connected", paper: "ok", deviceId: "bar-phone", at: new Date(T0).toISOString() };
const same: PrinterHealthReport = { printerId: "p", link: "connected", paper: "ok" };

test("printerHealthNeedsWrite: nothing kept, or something new, or a refresh due; never the same report again", () => {
  assert.equal(printerHealthNeedsWrite(undefined, "bar-phone", same, T0), true, "nothing kept yet");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", same, T0 + 60_000), false, "the same report a minute later: no write, no operation");
  assert.equal(printerHealthNeedsWrite(kept, "other-phone", same, T0), true, "another writer");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, link: "disconnected" }, T0), true, "the link");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, paper: "out" }, T0), true, "the paper");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { printerId: "p", link: "connected" }, T0), true, "a paper state no longer said");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, cover: "open" }, T0), true, "the cover");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, error: true }, T0), true, "an error");
  assert.equal(printerHealthNeedsWrite({ ...kept, error: true }, "bar-phone", same, T0), true, "an error gone");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", same, T0 + PRINTER_HEALTH_REFRESH_MS), false, "not due at exactly 5 minutes");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", same, T0 + PRINTER_HEALTH_REFRESH_MS + 1), true, "a steady state refreshed after 5 minutes");
});

test("printerHealthChangedFilter: the same test, as the write's race guard", () => {
  const filter = printerHealthChangedFilter("p", "bar-phone", same, T0) as { _id: string; $or: Array<Record<string, unknown>> };
  assert.equal(filter._id, "p", "one printer");
  assert.deepEqual(filter.$or.map((term) => Object.keys(term)[0]), ["health.deviceId", "health.link", "health.paper", "health.cover", "health.error", "health.at"], "every field the in-memory test reads");
  assert.deepEqual(filter.$or[4], { "health.error": { $ne: null } }, "an absent error matches a kept one that has none");
});
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: true }).success, true, "Phase 3 (M-2): a page that prints token slips");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: false }).success, false, "absent, never false");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, lanFailover: true } }).success, true, "Phase 3 (§9.3): it may take a network printer over");
});

const ROUTES = {
```

Replace it with:

```ts
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: true }).success, true, "Phase 3 (M-2): a page that prints token slips");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: false }).success, false, "absent, never false");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, lanFailover: true } }).success, true, "Phase 3 (§9.3): it may take a network printer over");
  // Phase 3 (§10): the health of the printers it writes rides the heartbeat.
  const health = { printerId: "a".repeat(24), link: "connected", paper: "out", cover: "open", error: true };
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: [health] }).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: [{ ...health, paper: "empty" }] }).success, false, "known paper states only");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: [{ ...health, error: false }] }).success, false, "an error is said, never denied");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: Array.from({ length: 13 }, () => health) }).success, false, "never more than a cafe can have");
});

const ROUTES = {
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
      "await beatPrintDevice(parsed.data, nowMs);",
      "const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));",
      "readJobsForDevice(parsed.data.deviceId, nowMs, tokens)",
      "countOnlineAgents(nowMs)",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
    ],
```

Replace it with:

```ts
      "await beatPrintDevice(parsed.data, nowMs);",
      "const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));",
      "readJobsForDevice(parsed.data.deviceId, nowMs, tokens)",
      // Phase 3 (§9.3, §10) deliberately changed the count: who is online, read once, counts the agents and says who
      // writes each printer now for the health this device reports (kept only on a change).
      "readOnlinePrintDevices(nowMs)",
      "await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);",
      "const agents = Math.max(1, online.length);",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
    ],
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Phase 3 Session 3A (spec §9.4): only a slip that never reached paper moves to the backup printer, labelled; a slip that
// may have printed, a bill waiting for the cashier and a slip being printed stay with their own printer.
test("PIN (Phase 3, §9.4): the backup move takes only queued slips with no uncertain attempt, puts BACKUP PRINTER first, logs it, and tells the backup's writer", () => {
```

Replace it with:

```ts
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Phase 3 Session 3A (spec §10): a printer's health is kept only from the device that writes it now, and written only
// when it says something new (or a steady one is due its 5-minute refresh): no request of its own, few writes.
test("PIN (Phase 3, §10): health is kept only from the printer's writer now, and only on a change or a due refresh", () => {
  const s = src("apps/cafe/lib/print-health.ts");
  inOrder(
    s,
    [
      "const printer = routablePrinterOf(input.printers, report.printerId);",
      "if (printer === null || printerActiveWriter(printer, input.failover) !== input.deviceId) return [];",
      "if (!printerHealthNeedsWrite(printer.health, input.deviceId, report, input.nowMs)) return [];",
      "return [Printer.updateOne(printerHealthChangedFilter(printer.id, input.deviceId, report, input.nowMs), { $set: { health } })];",
      "const results = await Promise.all(writes);",
    ],
    "the health write",
  );
  assert.match(s, /\{ "health\.at": \{ \$lt: new Date\(nowMs - PRINTER_HEALTH_REFRESH_MS\) \} \},/, "a steady state is refreshed every 5 minutes, never more often");
  assert.ok(!s.includes("connectDB(") && !s.includes("console."), "never connects, never logs");
});

// Phase 3 Session 3A (spec §9.4): only a slip that never reached paper moves to the backup printer, labelled; a slip that
// may have printed, a bill waiting for the cashier and a slip being printed stay with their own printer.
test("PIN (Phase 3, §9.4): the backup move takes only queued slips with no uncertain attempt, puts BACKUP PRINTER first, logs it, and tells the backup's writer", () => {
```

In `apps/cafe/lib/print-setup-paths.test.ts`, find:

```ts
  });
  assert.equal(wire.id, String(id));
  assert.ok(!("primaryDeviceId" in wire), "omit-empty on the wire too");
  assert.ok(!("backupPrinterId" in wire) && !("unreachable" in wire), "Phase 3: omit-empty, the backup and the skips");
  assert.deepEqual(wire.connection, { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" });
});
```

Replace it with:

```ts
  });
  assert.equal(wire.id, String(id));
  assert.ok(!("primaryDeviceId" in wire), "omit-empty on the wire too");
  assert.ok(!("backupPrinterId" in wire) && !("unreachable" in wire) && !("health" in wire), "Phase 3: omit-empty, the backup, the skips and the health");
  assert.deepEqual(wire.connection, { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" });
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-waiting.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
```

Replace it with:

```json
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-health.test.ts",
    "lib/print-waiting.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY,
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
  printUnreachableRequestsPerWriterPerDay,
} from "./print-budget";
import { PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
// and the agents' REAL cadence function. A cadence or cap change that could outgrow a cafe's free
```

Replace it with:

```ts
  PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY,
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
  printUnreachableRequestsPerWriterPerDay,
  printHealthRefreshWritesPerPrinterPerDay,
} from "./print-budget";
import { PRINTER_HEALTH_REFRESH_MS, PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";
import { PRINTERS_MAX } from "./print-printers";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
// and the agents' REAL cadence function. A cadence or cap change that could outgrow a cafe's free
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(printUnreachableRequestsPerWriterPerDay() <= 2 * Math.ceil(OPEN_MS / PRINT_AGENT_REFUSED_RECHECK_MS) / 10, "a tenth of a refusing printer's cost");
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
```

Replace it with:

```ts
  assert.ok(printUnreachableRequestsPerWriterPerDay() <= 2 * Math.ceil(OPEN_MS / PRINT_AGENT_REFUSED_RECHECK_MS) / 10, "a tenth of a refusing printer's cost");
});

// Phase 3 Session 3A (spec §10): printer health rides the wake, so it adds no request; its Mongo writes are bounded.
test("Phase 3 health: no request of its own; at most 144 refresh writes a printer a day, 1,728 for a cafe's twelve printers (0.04 a second)", () => {
  assert.equal(PRINTER_HEALTH_REFRESH_MS, 5 * 60 * 1000);
  assert.equal(printHealthRefreshWritesPerPrinterPerDay(), 144);
  const cafe = printHealthRefreshWritesPerPrinterPerDay() * PRINTERS_MAX;
  assert.equal(cafe, 1_728);
  assert.ok(cafe / (OPEN_MS / 1000) < 0.05, "far under Atlas M0's 100 operations a second");
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-health.test.ts lib/print-lifecycle-paths.test.ts lib/print-attention.test.ts lib/print-setup-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 52`; `# pass 47`; `# fail 5`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents, printDeviceDrawsTokens } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
```

Replace it with:

```ts
import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, printDeviceDrawsTokens, readOnlinePrintDevices } from "@/lib/print-device";
import { recordPrinterHealth } from "@/lib/print-health";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
// POST (Phase 1, spec §9.1, §10) is the new agent's wake. It carries the device heartbeat (at most one
// PrintDevice write per 30 s), answers jobsForMe + the online agent count (each agent's share of the
// cafe's one daily wake cap), and runs the sweep AFTER the response at most once per 60 s. That is
// the "sweep rides wake/pulse, never Cron" rule of spec §17.3, so it adds no request.
//
// Body is exactly one query: printJobDrainHead's index-backed read (rides
// {status:1,createdAt:1,_id:1}), sharing printJobDrainFilter with the D1
```

Replace it with:

```ts
// POST (Phase 1, spec §9.1, §10) is the new agent's wake. It carries the device heartbeat (at most one
// PrintDevice write per 30 s), answers jobsForMe + the online agent count (each agent's share of the
// cafe's one daily wake cap), and runs the sweep AFTER the response at most once per 60 s. That is
// the "sweep rides wake/pulse, never Cron" rule of spec §17.3, so it adds no request. Phase 3 (§10): it also
// carries the health of the printers the device writes, kept on each printer only when it changed.
//
// Body is exactly one query: printJobDrainHead's index-backed read (rides
// {status:1,createdAt:1,_id:1}), sharing printJobDrainFilter with the D1
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
    // Phase 3 (the token fix's M-2): token jobs count only for a page that prints them; one that says nothing (a page
    // from before Phase 3) is answered from what its device's last lease said.
    const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));
    const [jobsForMe, agents, printers] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs, tokens), countOnlineAgents(nowMs), listPrinters()]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
```

Replace it with:

```ts
    // Phase 3 (the token fix's M-2): token jobs count only for a page that prints them; one that says nothing (a page
    // from before Phase 3) is answered from what its device's last lease said.
    const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));
    const [jobsForMe, online, printers] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs, tokens), readOnlinePrintDevices(nowMs), listPrinters()]);
    // Phase 3 (spec §10): the health of the printers this device writes now rides its heartbeat (best-effort: a failed
    // write only ages the kept health).
    if (parsed.data.printers !== undefined && parsed.data.printers.length > 0) {
      await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);
    }
    const agents = Math.max(1, online.length);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
```

In `apps/cafe/lib/print-attention.ts`, find:

```ts
import type { FilterQuery } from "mongoose";
import { PRINT_KOT_ALARM_MS, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS, type PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";

// Printing redesign, Phase 1 Session 1D (spec §10): the one waiting-slips panel's feed. Every device
// reads the same rows on the existing 20 s pulse (one bounded, index-backed read; no new request):
```

Replace it with:

```ts
import type { FilterQuery } from "mongoose";
import { PRINT_KOT_ALARM_MS, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { printerProblemOf, type PrinterFailover } from "@pos/shared/print-failover";
import { PRINT_JOB_NO_PRINTER, routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS, type PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { listPrinters } from "@/lib/print-printers";

// Printing redesign, Phase 1 Session 1D (spec §10): the one waiting-slips panel's feed. Every device
// reads the same rows on the existing 20 s pulse (one bounded, index-backed read; no new request):
```

In `apps/cafe/lib/print-attention.ts`, find:

```ts
// A slip being printed right now (leased) waits for nobody. The rows also carry the asking and the
// printing device, so both can sound the 20 s alarm without a per-device read. The read takes the
// NEWEST rows (owner, after Session 1D: a new problem always shows and rings, however long the backlog)
// and hands them over oldest first. Read-only; never calls connectDB() (the route does); no console.*.

const ATTENTION_STATUSES: ReadonlySet<PrintJobStatus> = new Set(["queued", "needs-confirm", "failed"]);
```

Replace it with:

```ts
// A slip being printed right now (leased) waits for nobody. The rows also carry the asking and the
// printing device, so both can sound the 20 s alarm without a per-device read. The read takes the
// NEWEST rows (owner, after Session 1D: a new problem always shows and rings, however long the backlog)
// and hands them over oldest first. Phase 3 (spec §9.4, §10): a row on a printer also says why that printer cannot
// print now (its device is offline, it is out of paper, ...), from two small reads made only when such a row waits.
// Read-only; never calls connectDB() (the route does); no console.*.

const ATTENTION_STATUSES: ReadonlySet<PrintJobStatus> = new Set(["queued", "needs-confirm", "failed"]);
```

In `apps/cafe/lib/print-attention.ts`, find:

```ts
    .reverse()
    .map(printAttentionRowOf)
    .filter((row): row is PrintAttentionRow => row !== null);
  return { rows, truncated: docs.length > PRINT_ATTENTION_LIMIT };
}
```

Replace it with:

```ts
    .reverse()
    .map(printAttentionRowOf)
    .filter((row): row is PrintAttentionRow => row !== null);
  return { rows: await withPrinterProblems(rows, nowMs), truncated: docs.length > PRINT_ATTENTION_LIMIT };
}

/** Phase 3 (spec §9.4, §10): each slip still waiting for its printer (queued) says that printer's problem; every other
 *  row is as it was (a failed slip or a bill to check says why it stopped in its own words: the planning review, M-4). */
export function printAttentionProblemsOf(rows: readonly PrintAttentionRow[], printers: readonly PrinterConfig[], failover: PrinterFailover): PrintAttentionRow[] {
  return rows.map((row) => {
    const printer = row.status !== "queued" || row.printerId === undefined ? null : routablePrinterOf(printers, row.printerId);
    const problem = printer === null ? null : printerProblemOf(printer, failover);
    return problem === null ? row : { ...row, problem };
  });
}

/** The printers and who is online, read only while a slip waits on a printer (queued: not for the 3 hours a failed row
 *  stays in the feed); a failed read leaves the rows as they are (the feed never fails for it). */
async function withPrinterProblems(rows: PrintAttentionRow[], nowMs: number): Promise<PrintAttentionRow[]> {
  if (!rows.some((row) => row.status === "queued" && row.printerId !== undefined && row.printerId !== PRINT_JOB_NO_PRINTER)) return rows;
  try {
    const [printers, online] = await Promise.all([listPrinters(), readOnlinePrintDevices(nowMs)]);
    return printAttentionProblemsOf(rows, printers, { online, nowMs });
  } catch {
    return rows;
  }
}
```

Create `apps/cafe/lib/print-health.ts`:

```ts
import type { FilterQuery } from "mongoose";
import { PRINTER_HEALTH_REFRESH_MS, printerActiveWriter, type PrinterFailover, type PrinterHealth, type PrinterHealthReport } from "@pos/shared/print-failover";
import { routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer, type IPrinter } from "@/models/Printer";

// Printing redesign, Phase 3 (spec §10): printer health rides the heartbeat. A writer's wake carries the state of each
// printer it writes (its link, and paper, cover and error where DLE EOT can say); the server keeps it on the printer
// when it changed, or to refresh a steady one every 5 minutes, and only from the device that writes that printer now.
// Every device reads it with the printers, and the waiting-slips feed names a printer's problem beside its slips
// (print-attention.ts). No request of its own. A report is compared with the kept health in memory first (the
// printers the wake already read), so a wake that changes nothing costs no Atlas operation, even at the 3 s cadence of
// a socket that is down (the planning review, M-2); a change is one small filtered write per printer, all at once.
// Never calls connectDB(). No console.*.

/** Lets a report through only when it says something new (another writer, link, paper, cover or error), or the kept one
 *  is due a refresh. An absent paper, cover or error matches a kept one that has none ($ne null). */
export function printerHealthChangedFilter(printerId: string, deviceId: string, report: PrinterHealthReport, nowMs: number): FilterQuery<IPrinter> {
  return {
    _id: printerId,
    $or: [
      { "health.deviceId": { $ne: deviceId } },
      { "health.link": { $ne: report.link } },
      { "health.paper": { $ne: report.paper ?? null } },
      { "health.cover": { $ne: report.cover ?? null } },
      { "health.error": { $ne: report.error ?? null } },
      { "health.at": { $lt: new Date(nowMs - PRINTER_HEALTH_REFRESH_MS) } },
    ],
  };
}

/** Whether a report says something new against the kept health (another writer, link, paper, cover or error), or the
 *  kept one is due its refresh: the same test as printerHealthChangedFilter, made in memory before any write. */
export function printerHealthNeedsWrite(kept: PrinterHealth | undefined, deviceId: string, report: PrinterHealthReport, nowMs: number): boolean {
  if (kept === undefined) return true;
  return (
    kept.deviceId !== deviceId ||
    kept.link !== report.link ||
    kept.paper !== report.paper ||
    kept.cover !== report.cover ||
    (kept.error === true) !== (report.error === true) ||
    Date.parse(kept.at) < nowMs - PRINTER_HEALTH_REFRESH_MS
  );
}

/** Keeps what a writer reported for each printer it writes now; a report for any other printer (one it does not write,
 *  one taken over by another device, one deleted or switched off) is dropped, and one that changes nothing costs nothing.
 *  Returns how many printers were written. */
export async function recordPrinterHealth(input: {
  deviceId: string;
  reports: readonly PrinterHealthReport[];
  printers: readonly PrinterConfig[];
  failover: PrinterFailover | null;
  nowMs: number;
}): Promise<number> {
  const writes = input.reports.flatMap((report) => {
    const printer = routablePrinterOf(input.printers, report.printerId);
    if (printer === null || printerActiveWriter(printer, input.failover) !== input.deviceId) return [];
    if (!printerHealthNeedsWrite(printer.health, input.deviceId, report, input.nowMs)) return [];
    const health = {
      link: report.link,
      ...(report.paper !== undefined ? { paper: report.paper } : {}),
      ...(report.cover !== undefined ? { cover: report.cover } : {}),
      ...(report.error === true ? { error: true } : {}),
      deviceId: input.deviceId,
      at: new Date(input.nowMs),
    };
    return [Printer.updateOne(printerHealthChangedFilter(printer.id, input.deviceId, report, input.nowMs), { $set: { health } })];
  });
  const results = await Promise.all(writes);
  return results.reduce((sum, res) => sum + res.modifiedCount, 0);
}
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
import { z } from "zod";
import { PRINT_ACK_UNREACHABLE, PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINTERS_MAX, PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
```

Replace it with:

```ts
import { z } from "zod";
import { PRINT_ACK_UNREACHABLE, PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINTERS_MAX, PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { PRINTER_COVER_STATES, PRINTER_LINK_STATES, PRINTER_PAPER_STATES } from "@pos/shared/print-failover";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
```

In `apps/cafe/lib/print-lifecycle-schemas.ts`, find:

```ts
    nativeProtocol: z.number().int().min(1).max(99).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs (PRINT_PULSE_TOKENS_PARAM). */
    tokenSlips: z.literal(true).optional(),
  })
  .strict();
```

Replace it with:

```ts
    nativeProtocol: z.number().int().min(1).max(99).optional(),
    /** Phase 3 (the token fix's M-2): this page prints "token" jobs (PRINT_PULSE_TOKENS_PARAM). */
    tokenSlips: z.literal(true).optional(),
    /** Phase 3 (spec §10): the health of each printer this device writes (the heartbeat carries it; no request of its
     *  own). The lib keeps only the reports for printers this device writes now. */
    printers: z
      .array(
        z
          .object({
            printerId: z.string().trim().min(1).max(PRINTER_DEVICE_ID_MAX_CHARS),
            link: z.enum(PRINTER_LINK_STATES),
            paper: z.enum(PRINTER_PAPER_STATES).optional(),
            cover: z.enum(PRINTER_COVER_STATES).optional(),
            error: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(PRINTERS_MAX)
      .optional(),
  })
  .strict();
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled" | "backupPrinterId" | "unreachable"> & {
  _id: Types.ObjectId;
};
```

Replace it with:

```ts
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled" | "backupPrinterId" | "unreachable" | "health"> & {
  _id: Types.ObjectId;
};
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
    ...(row.unreachable !== undefined && row.unreachable.length > 0
      ? { unreachable: row.unreachable.map((skip) => ({ deviceId: skip.deviceId, until: skip.until.toISOString() })) }
      : {}),
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled backupPrinterId unreachable";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
```

Replace it with:

```ts
    ...(row.unreachable !== undefined && row.unreachable.length > 0
      ? { unreachable: row.unreachable.map((skip) => ({ deviceId: skip.deviceId, until: skip.until.toISOString() })) }
      : {}),
    // Phase 3 (spec §10): what its writer last reported (every device reads it with the printers).
    ...(row.health !== undefined && row.health !== null
      ? {
          health: {
            link: row.health.link,
            ...(row.health.paper !== undefined ? { paper: row.health.paper } : {}),
            ...(row.health.cover !== undefined ? { cover: row.health.cover } : {}),
            ...(row.health.error === true ? { error: true as const } : {}),
            deviceId: row.health.deviceId,
            at: row.health.at.toISOString(),
          },
        }
      : {}),
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled backupPrinterId unreachable health";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
```

In `apps/cafe/models/Printer.ts`, find:

```ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  PRINTER_ADDRESS_MAX_CHARS,
  PRINTER_COPIES_MAX,
```

Replace it with:

```ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import { PRINTER_COVER_STATES, PRINTER_LINK_STATES, PRINTER_PAPER_STATES, type PrinterCoverState, type PrinterLinkState, type PrinterPaperState } from "@pos/shared/print-failover";
import {
  PRINTER_ADDRESS_MAX_CHARS,
  PRINTER_COPIES_MAX,
```

In `apps/cafe/models/Printer.ts`, find:

```ts
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. Phase 3 adds the backup printer (`backupPrinterId`, §9.4: saved with the setup) and
// what the server keeps beside the setup: `unreachable` (§9.3, the writers skipped for 5 minutes).

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
```

Replace it with:

```ts
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. Phase 3 adds the backup printer (`backupPrinterId`, §9.4: saved with the setup) and
// what the server keeps beside the setup: `unreachable` (§9.3, the writers skipped for 5 minutes) and `health` (§10,
// what its writer last reported on the wake).

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
```

In `apps/cafe/models/Printer.ts`, find:

```ts
  enabled: boolean;
  backupPrinterId?: string; // Phase 3 (§9.4): another printer's id; omit-empty
  unreachable?: Array<{ deviceId: string; until: Date }>; // Phase 3 (§9.3): server-kept, never saved by the setup
  createdAt: Date;
  updatedAt: Date;
}

/** A LAN connection has a host and a port and nothing else; a device connection has a device, a transport
```

Replace it with:

```ts
  enabled: boolean;
  backupPrinterId?: string; // Phase 3 (§9.4): another printer's id; omit-empty
  unreachable?: Array<{ deviceId: string; until: Date }>; // Phase 3 (§9.3): server-kept, never saved by the setup
  health?: IPrinterHealth; // Phase 3 (§10): server-kept, never saved by the setup
  createdAt: Date;
  updatedAt: Date;
}

/** Phase 3 (spec §10): a printer's health as its writer last reported it (lib/print-health.ts). */
export interface IPrinterHealth {
  link: PrinterLinkState;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: boolean;
  deviceId: string;
  at: Date;
}

/** A LAN connection has a host and a port and nothing else; a device connection has a device, a transport
```

In `apps/cafe/models/Printer.ts`, find:

```ts
  { _id: false },
);

const copiesSchema = new Schema<PrinterCopies>(
  {
    kot: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
```

Replace it with:

```ts
  { _id: false },
);

// Phase 3 (spec §10): replaced whole by each report that changed something; omit-empty inside.
const healthSchema = new Schema<IPrinterHealth>(
  {
    link: { type: String, enum: [...PRINTER_LINK_STATES], required: true },
    paper: { type: String, enum: [...PRINTER_PAPER_STATES] },
    cover: { type: String, enum: [...PRINTER_COVER_STATES] },
    error: { type: Boolean },
    deviceId: { type: String, required: true, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const copiesSchema = new Schema<PrinterCopies>(
  {
    kot: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
```

In `apps/cafe/models/Printer.ts`, find:

```ts
    backupPrinterId: { type: String, maxlength: 24 },
    // Omit-empty (no [] default): written only by an ack that could not reach the printer (lib/print-failover.ts).
    unreachable: { type: [unreachableSchema], default: undefined },
  },
  { timestamps: true },
);
```

Replace it with:

```ts
    backupPrinterId: { type: String, maxlength: 24 },
    // Omit-empty (no [] default): written only by an ack that could not reach the printer (lib/print-failover.ts).
    unreachable: { type: [unreachableSchema], default: undefined },
    health: { type: healthSchema },
  },
  { timestamps: true },
);
```

Create `apps/cafe/scripts/print-host-live/health.ts`:

```ts
/**
 * Phase 3 Session 3A live leg (bc) — printer health (spec §10) and the problem every device's waiting-slips feed shows
 * (spec §9.4) against a REAL MongoDB: a writer's report is kept for the printers it writes now and dropped for any other;
 * it is written only when it says something new, or a steady one is due its 5-minute refresh; every device reads it with
 * the printers; a slip waiting on a printer says the printer's problem (out of paper; its device offline), and says
 * nothing when none is known. Run by scripts/verify-print-host-live.ts after leg bb.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_HEALTH_REFRESH_MS } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { readPrintAttention } from "@/lib/print-attention";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { recordPrinterHealth } from "@/lib/print-health";
import { listPrinters } from "@/lib/print-printers";
import { check } from "./harness";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

/** What the wake does with a beat's printers: who is online, then the health the device reports. */
async function beat(deviceId: string, reports: Parameters<typeof recordPrinterHealth>[0]["reports"], nowMs: number): Promise<number> {
  return recordPrinterHealth({ deviceId, reports, printers: await listPrinters(), failover: { online: await readOnlinePrintDevices(nowMs), nowMs }, nowMs });
}

const healthOf = async (printerId: string) => (await listPrinters()).find((printer) => printer.id === printerId)?.health;

export async function legBC(nowMs: number): Promise<void> {
  console.log("\n(bc) printer health rides the heartbeat (§10); a waiting slip says its printer's problem on every device (§9.4)");
  const o = await failoverOutlet();
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  const first = await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "out" }, { printerId: o.kitchen, link: "connected" }], nowMs);
  const bar = await healthOf(o.bar);
  check("(bc) the bar phone's report is kept for its own printer only, never for the kitchen's", first === 1 && bar?.paper === "out" && bar.deviceId === BAR && (await healthOf(o.kitchen)) === undefined);
  check("(bc) the same report again writes nothing", (await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "out" }], nowMs + 60_000)) === 0 && (await healthOf(o.bar))?.at === new Date(nowMs).toISOString());
  check("(bc) a change is written at once (paper back in)", (await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "ok" }], nowMs + 61_000)) === 1 && (await healthOf(o.bar))?.paper === "ok");
  await online(BAR, nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS);
  check("(bc) a steady state is written again after 5 minutes, to stay fresh", (await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "ok" }], nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS + 1)) === 1);
  check("(bc) a report with no paper state clears the kept one", (await beat(BAR, [{ printerId: o.bar, link: "connected" }], nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS + 2)) === 1 && (await healthOf(o.bar))?.paper === undefined);

  const t = nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS + 10_000;
  await Promise.all([online(KITCHEN, t), online(COUNTER, t), online(BAR, t)]);
  await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "out" }], t);
  const waiting = await kotOf(o, t);
  const feed = await readPrintAttention(t + 25_000);
  const rowOn = (id: string | undefined) => feed.rows.find((row) => row.id === id);
  check("(bc) every device's feed: the bar slip waiting 20 s says its printer is out of paper", rowOn(waiting.bar?.id)?.problem === "paper-out");
  check("(bc) ... and the kitchen slip, whose printer reported nothing, says nothing more", rowOn(waiting.kitchen?.id) !== undefined && !("problem" in (rowOn(waiting.kitchen?.id) ?? {})));
  await offline(BAR, t + 25_000);
  check("(bc) the bar phone offline: its slip says the device that prints Bar is offline", rowOn(waiting.bar?.id) !== undefined && (await readPrintAttention(t + 25_000)).rows.find((row) => row.id === waiting.bar?.id)?.problem === "device-offline");
  await offline(KITCHEN, t + 25_000);
  const kitchenRow = (await readPrintAttention(t + 25_000)).rows.find((row) => row.id === waiting.kitchen?.id);
  check("(bc) the kitchen tablet offline but the counter took its network printer over: no device-offline for the kitchen slip", kitchenRow !== undefined && !("problem" in kitchenRow));
  check("(bc) a device that no longer writes a printer cannot report for it", (await beat(KITCHEN, [{ printerId: o.kitchen, link: "disconnected" }], t + 25_000)) === 0);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legAZ } from "./print-host-live/token-fence";
import { legBA } from "./print-host-live/failover";
import { legBB } from "./print-host-live/backup";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { legAZ } from "./print-host-live/token-fence";
import { legBA } from "./print-host-live/failover";
import { legBB } from "./print-host-live/backup";
import { legBC } from "./print-host-live/health";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAZ(Date.now());
    await legBA(Date.now());
    await legBB(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAZ(Date.now());
    await legBA(Date.now());
    await legBB(Date.now());
    await legBC(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

In `packages/shared/src/print-budget.ts`, find:

```ts
import { PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";

// Printing redesign, spec §17.2: the busy day the printing budget is sized for. print-budget.test.ts
// recomputes the "Vercel invocations" totals from these and from the agents' real cadence function
```

Replace it with:

```ts
import { PRINTER_HEALTH_REFRESH_MS, PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";

// Printing redesign, spec §17.2: the busy day the printing budget is sized for. print-budget.test.ts
// recomputes the "Vercel invocations" totals from these and from the agents' real cadence function
```

In `packages/shared/src/print-budget.ts`, find:

```ts
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS) * PRINT_REQUESTS_PER_SLIP;
}

/** Vercel Hobby's monthly function invocations (spec §17.1), as a day's share over 30 days: 33,333. */
export const VERCEL_HOBBY_INVOCATIONS_PER_DAY = Math.floor(1_000_000 / 30);
```

Replace it with:

```ts
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS) * PRINT_REQUESTS_PER_SLIP;
}

/** Phase 3 (spec §10, §17): printer health rides the wake (no request). A printer's health is written when it changes,
 *  and a steady one again every PRINTER_HEALTH_REFRESH_MS: at most this many refresh writes a printer over the busy
 *  day's 12 h (Mongo writes, not requests). */
export function printHealthRefreshWritesPerPrinterPerDay(): number {
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_HEALTH_REFRESH_MS);
}

/** Vercel Hobby's monthly function invocations (spec §17.1), as a day's share over 30 days: 33,333. */
export const VERCEL_HOBBY_INVOCATIONS_PER_DAY = Math.floor(1_000_000 / 30);
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && cd /d/kd/lucifer/packages/shared && npx tsc --noEmit && echo SHARED_TSC_OK`
Expected: `# tests 39`; `# pass 39`; `# fail 0`; `SHARED_TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-health.test.ts lib/print-lifecycle-paths.test.ts lib/print-attention.test.ts lib/print-setup-paths.test.ts lib/print-wake.test.ts lib/print-queue.test.ts lib/self-order-alert-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 147`; `# pass 147`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-health.ts lib/print-attention.ts lib/print-printers.ts lib/print-lifecycle-schemas.ts app/api/print-jobs/wake/route.ts models/Printer.ts scripts/print-host-live/health.ts scripts/verify-print-host-live.ts lib/print-health.test.ts lib/print-lifecycle-paths.test.ts lib/print-attention.test.ts lib/print-setup-paths.test.ts && echo LINT_OK`
Expected: `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3a npm run verify:print:live 2>&1 | grep -E "passed,|FAIL"`
Expected: `415 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/print-jobs/wake/route.ts apps/cafe/lib/print-attention.test.ts apps/cafe/lib/print-attention.ts apps/cafe/lib/print-health.test.ts apps/cafe/lib/print-health.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-lifecycle-schemas.ts apps/cafe/lib/print-printers.ts apps/cafe/lib/print-setup-paths.test.ts apps/cafe/models/Printer.ts apps/cafe/package.json apps/cafe/scripts/print-host-live/health.ts apps/cafe/scripts/verify-print-host-live.ts packages/shared/src/print-budget.test.ts packages/shared/src/print-budget.ts
git commit -m "feat(print): printer health rides the heartbeat, and every device's waiting-slips feed says each printer's problem (Phase 3 Session 3A, A4)"
```

---

### Task A5: full verification, the dormant emulator check, the fresh review, Results

**Files:** this plan (the "Session 3A Results" section below), nothing else.

- [ ] **Step 1: every suite, once each, in the background, one after another** (run `df -h /d /c` first).

Run, from `/d/kd/lucifer`:
- `cd packages/shared && npm test` → expect `# tests 815`, `# pass 815`, `# fail 0`; `npx tsc --noEmit` → 0.
- `cd apps/cafe && npm test` → expect `# tests 4990`, `# pass 4989`, `# fail 0`, `# skipped 1` (go-live-dl).
- `npx tsc --noEmit` → 0, and `npm run lint` → 0 errors and the 2 old warnings (`lib/masters-blob.test.ts:331`), in each of `apps/cafe`, `apps/hub`, `apps/mobile`, `apps/desktop` (desktop: `npm run typecheck`).
- `cd apps/mobile && npm test` → 125/125; `npm run test:app` → Jest 3/3.
- `cd apps/desktop && npm test` → 192/192.
- `npm run test:print-tools` → 8/8.
- `cd apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3a npm run verify:print:live` → `415 passed, 0 failed` (362 + az 11 + ba 19 + bb 13 + bc 10).

- [ ] **Step 2: the Next production build on the repo (D:)**

Run: `df -h /d` (a build needs ~1.5 GB free; see the memory note on webpack's `index.pack.old`), then `cd apps/cafe && npm run build`.
Expected: 132 routes (count the lines between "Route (app)" and "First Load JS shared" with awk), exit 0.

- [ ] **Step 3: no app, desktop or Worker change**

Run: `git diff --stat aae162c..HEAD -- apps/mobile apps/desktop workers`
Expected: empty. The APKs (arm64 `b10feedb…`, armv7 `86b7ff13…`, x86_64 `3736540b…`) and `POS-Software-Setup-1.11.0.exe` (`348aebe1…`) stay as Phase 2 built them; no rebuild.

- [ ] **Step 4: the dormant check on the emulator** (decision P3-10: 3A changes no app or page code, so this proves that a Phase 2 page on the 3A server prints exactly as before)

Set-up:
- `df -h /c /d`. Boot `Pixel_7_API_33` yourself with a 2 h background timeout (`-memory 4096 -no-audio -no-snapshot-save`; 2048 when C: has under ~4 GB free, recorded).
- `adb shell pm path com.possoftware.pos`. If it is empty, install the Phase 2 x86_64 APK (`…/980d3189-10f0-4165-bdad-ae814b95278b/scratchpad/apk-gate2/pos-emulator-x86_64-release.apk`, hashed `3736540b…` first).
- Check which POS the app shows before any tap that writes: never the demo.
- Serve the Step 2 build with `next start -p 3110` and a scratchpad env on a fresh `pos_scratch_e2e_3a` database (seed an admin, the tables and the menu; earlier sessions' tools: `p2d-tool.ts`, `p2g-tool.ts`, `gate-proxy-2b.mjs`, copied into your scratchpad). Put the counting proxy on 3200, then `adb reverse tcp:3100 tcp:3200`. Set the app's address to `http://localhost:3100`. Run fake printers on 9100 and 9101 with long `--out` paths.

| # | Step | Expected |
|---|---|---|
| 1 | Simple mode, the app's own network printer 10.0.2.2:9100: Send to Kitchen, then Pay Now | the KOT once, then the KOT and the bill once each, unlabelled; the proxy shows the orders and acks only (direct print), and the pulse has no `tokens=` (the page is Phase 2's) |
| 2 | Printers mode (API: Kitchen printer LAN 9100, the app's device id as its printing device; Bar printer LAN 9101, the same device): Send to Kitchen with a kitchen and a bar item | both station slips direct, no lease (Phase 2's item 6) |
| 3 | API: the Kitchen printer saved with the Bar printer as its backup (`PUT /api/printers/<id>`, `backupPrinterId`); Send to Kitchen | prints on 9100 as before; nothing moves while the app is online; `GET /api/printers` shows `backupPrinterId` and no `unreachable`/`health` |
| 4 | `adb logcat -b crash -d` | 0 lines |

Put back:
- the setup reset (`p2d-tool.ts reset2d`; simple mode, host null);
- the app's printers removed;
- the app's address as found (cleared to its start screen, or the demo, which the owner restores himself);
- the APK as found;
- `adb reverse --remove-all`, then `adb reverse tcp:3100 tcp:3100`;
- `adb shell sync`, then `adb emu kill`;
- your servers stopped by PID after checking each command line.

- [ ] **Step 5: the fresh review**

Dispatch a fresh reviewer subagent on **Claude Fable 5.1** (`model: fable`). It is read-only, with scratch tests only in this session's scratchpad (never in the repo). It reviews `aae162c..HEAD` against this plan (decisions P3-1 to P3-10, Session 3A and its Review Focus, passed verbatim) and spec §9.3, §9.4, §10, §17. If Fable is rate-limited (HTTP 429), wait for its reset and say so; never switch models silently. Fix every Critical and Important finding by TDD (RED seen first) in its own commit. List the minors in Results for the 3A review gate.

- [ ] **Step 6: Results, commit, push**

Fill "Session 3A Results" below: the commits; each task's RED and GREEN against the Expected lines; every suite's numbers; the build; the emulator table; the review and its fixes; deviations and rulings; what is open for the 3A gate.

Commit, then push with the token only: `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-3`. Do not merge, do not deploy.

## Session 3A Results (filled in by the implementer)

_Not run yet._
