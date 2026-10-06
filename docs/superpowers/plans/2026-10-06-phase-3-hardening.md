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

**P3-3. The 5-minute skip** (spec §9.3). The page acks a refusal made before any byte with `reason: "unreachable"`; on Android TCP that is NOT_CONNECTED from a failed connect. That writer is then skipped for that network printer for 5 minutes. The waiting slips move at once to the device that takes it over, and that device is told of the head (one realtime request). Only the printer's writer *now* can be skipped: a late ack from another device changes nothing. When every candidate is skipped, the primary keeps the printer. *Cost if wrong:* a writer that could reach the printer sits out 5 minutes while another prints, which is harmless. Each move that changes a printer's writer (on a skip, or on the sweep) tells the new writer of the line's head: one Worker request, at most once a minute per printer per instance, and at most 144 a day per skipped writer (the planning review, M-7: within the Worker's 5 % pin). After a skip, the head's `nextAttemptAt` is its 2 s refusal backoff, so the new writer's first lease can come back "not due" and it leases again 2 s later (one extra lease per skip). *Changed by Session 3A's final review (I-1):* the 5 minutes are the skip's floor. After them it holds until the skipped device's own lease names the printer again (a page names only a printer it can print to now), and at most 3 hours. A skip that ran out on time alone sent the printer back to a writer that still could not reach it, whose page never leased it to say so again. *Changed by the 3A review gate (I-A, I-B; built in 3B's B1):* the writer's beat is the second signal: its settled link `disconnected` for a network printer it writes now starts the skip (once), and its `connected` ends it past the first 5 minutes, like its lease naming the printer; and a skip holds as long as the device's record lives (7 days, `PRINT_DEVICE_PRUNE_MS`), not 3 hours.

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
  - (d) a network printer that every writer is skipped for, while its primary is online, keeps its slips (spec §9.4 moves slips only when a *device* is offline; the 5-minute skips run out and the writers try again); *changed by the 3A review gate (m-D; 3B's B1):* the skips no longer run out on time alone, so such a printer's untried slips now go to its backup, labelled, like those of a printer whose device is offline (`printerWriterCanPrint`);
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
- *The 3A review gate (m-4):* the fence reaches devices with a `PrintDevice` row; a page from before S7 on a simple-mode device with no print host keeps today's cost until it reloads (the runbook's "reload every screen" covers it).

**P3-9. A writer whose wake cap is spent.** On a day with the socket down from start to finish, a writer can spend its share of the wake cap and stop polling. It then looks offline although it still prints. A lease refreshes `lastSeenAt` (at most every 30 s), but a slip made leased at creation (direct print) and its ack do not (the planning review, M-3). So a counter that prints everything directly looks offline 90 s after its last real lease. A network printer then fails over, which is harmless. A device printer with a backup sends its untried slips there, labelled. *Ruled acceptable:* this needs a whole day with the socket down and a backup set. Nothing is lost or doubled, and every moved slip says BACKUP PRINTER. A touch on the ack route would close the gap, but would cost every cafe one Atlas operation per ack; the 3A gate may revisit it with the 3B page's cap behaviour. *The 3A review gate: kept as ruled* (3B changes no cap behaviour; every lease touches `lastSeenAt`; a takeover is the same paper).

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

### Session 3B (spec; made exact at the 3A review gate, below): the page

**Scope** (web only: `apps/cafe` page code; no APK, no desktop, no Worker change):
- **Capabilities.** The page's wake says `lanFailover: true` when the POS app speaks bridge v2 (`nativeProtocol` ≥ 2), or the Windows app reports raw TCP (from 1.12.0, Session 3E; until then false). A Chrome tab says false.
- **Network printers as a candidate writer.** A device that says `lanFailover` names every routable network printer in its lease, as well as the ones it writes. The server grants only the writer now, and jobs-for-me (aimed at it) tells it when. *The 3A review gate (its review's m-A):* every one its app **reaches now** (pooled and connected), never one it cannot: with cf4499e that is the signal that ends its skip; and only a device that writes a printer by the setup (the gate's emulator pre-run, E-1).
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

- **From the 3A review gate:** the idle DLE EOT probe also settles a TCP printer's link (an idle printer otherwise reads `connected` from its last job until a print fails: its review's m-B); the top-bar dot's printer problem (3B's `printer-problem`) in simple mode too, once the app reports paper, cover and error there (3B's review, m-7); and a small server task, **G-1**: `lanFailover` counts only from a wake seen within the online window (`PrintDevice.beatAt`, written in the wake's existing heartbeat write), so a former writer whose leases keep it online is never picked for a takeover its page cannot print (the gate's section "The fresh review of Session 3B's golden copy").

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

- **From the 3A review gate (its review's m-B):** the Windows app keeps a per-network-printer link and names a network printer in its lease only while it reaches it (the signal that ends a skip, Session 3A's I-1), and reports that link in its beat.

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

- **From the 3A review gate:** the measurement includes a page that does not say `tokenSlips` (one from before 3B) or says none was present (R-3, m-6: such a page costs one small read per ack, pulse and wake); the soak gains the beat/lease/ack interplay of a skip as checks (3B's review, m-8: its `probe-flap.ts` timeline, with each step's Printer writes counted).

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

Executed on 2026-10-06 with superpowers:executing-plans, task by task, A0 → A5.

### Commits (`f23d84c..HEAD`)

| Commit | Task |
|---|---|
| `ef6c658` | A0: the token fix's M-2 kind fence on the ack's `more` and on jobs-for-me (`PrintDevice.tokenSlips`, `printDeviceDrawsTokens`, `PRINT_PULSE_TOKENS_PARAM`); the runbook's "within 30 minutes; after that, Print now"; the TokenSettingsFields comment (leg az) |
| `4e83f19` | A1: `@pos/shared/print-failover` (who writes a printer now, the 5-minute skip, the backup printer's rules, health, a printer's problem and its words) |
| `8165a75` | A2: failover on the server: the writer now at creation, the lease, the "unreachable" ack, the sweep, a staff Retry and a Test print (leg ba) |
| `114c48c` | A3: the backup printer (absent keeps, `null` clears) and the sweep's backup move (leg bb) |
| `9341e24` | A4: printer health on the wake (no operation when nothing changed) and each printer's problem in the waiting-slips feed (leg bc) |
| `cf4499e` | The final review's I-1, by TDD: a writer skipped for a network printer stays skipped until its own lease names the printer again (at least 5 minutes, at most 3 hours); shared tests, leg ba's I-1 checks, the lease PIN; spec §9.3, §9.8 and P3-3 notes |
| (this commit) | Results |

### Start

- `GIT_TERMINAL_PROMPT=0 git fetch origin` (the repo-local token store): `feat/printing-phase-3` = `origin/feat/printing-phase-3` = `f23d84c`, working tree clean; `origin/main` still `7f8ed31` (nothing to merge or note).
- Disk at the start: D: 13 GB free, C: 2.9 GB free.
- The planning session's applier (`apply_blocks_clone.py`) was copied into this session's scratchpad. A dry run of the whole Session 3A range (plan lines 309–5544) against `f23d84c`: **148 ops OK** (no drift).

### How the code was applied

Every block went verbatim into the real repo through the applier, one step range at a time (each task's Step 1, then its Step 3), so each RED was seen before its code went in: A0 11 + 23 ops, A1 2 + 7, A2 11 + 38, A3 5 + 20, A4 10 + 21 (**148**). After A4, **every file outside `docs/` is blob-identical to the planning session's gold `g3a-v2`** (tree `35204f2`): `git ls-tree -r` of both differs only in the plan (added by `f23d84c`) and the spec (changed by `f23d84c`). `f23d84c..9341e24`: 46 files, **+1,482 / −94**. Every commit has the plan's message plus the repo's co-author line.

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED | GREEN |
|---|---|---|
| A0 | `print-lease` + `print-lifecycle-paths` + `print-order-jobs` + `print-attention` tests: tests 56, pass 45, **fail 11** | the six files **163/163**; `TSC_OK`; `LINT_OK`; live **373 passed, 0 failed** |
| A1 | `print-failover.test.ts`: tests 1, pass 0, **fail 1** (the module did not exist) | **63/63**; `SHARED_TSC_OK`; shared `npm test` **813/813** |
| A2 | shared `print-budget.test.ts`: 1 / 0 / **1**; cafe four files: tests 62, pass 53, **fail 9** | shared **38/38** + `SHARED_TSC_OK`; cafe ten files **141/141**; `TSC_OK`; `LINT_OK`; live **392 passed, 0 failed** |
| A3 | three files: tests 54, pass 51, **fail 3** | four files **64/64**; `TSC_OK`; `LINT_OK`; live **405 passed, 0 failed** |
| A4 | shared `print-budget.test.ts`: 1 / 0 / **1**; cafe four files: tests 52, pass 47, **fail 5** | shared **39/39** + `SHARED_TSC_OK`; cafe seven files **147/147**; `TSC_OK`; `LINT_OK`; live **415 passed, 0 failed** |

Line counts at the end: `packages/shared/src/print-failover.ts` 144 (new), `apps/cafe/lib/print-failover.ts` 120 (new), `lib/print-health.ts` 71 (new), `lib/print-lease.ts` 340, `lib/print-attention.ts` 106, `lib/print-sweep.ts` 189; the legs `scripts/print-host-live/token-fence.ts` 72, `failover.ts` 181, `backup.ts` 88, `health.ts` 55 (all new).

### Task A5 Step 1: every suite (at `9341e24`; once each, in the background, one after another)

| Suite | Result |
|---|---|
| shared `npm test`; `tsc` | **815/815**; 0 |
| cafe `npm test` | **4990 tests, 4989 pass, 0 fail, 1 skipped** (go-live-dl) |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings (`lib/masters-blob.test.ts:331`) |
| hub `tsc`; lint | 0; 0 |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; **125/125**; Jest **3/3** |
| desktop `npm test`; `typecheck`; lint | **192/192**; 0; 0 |
| `npm run test:print-tools` | **8/8** |
| live legs (local mongod, `pos_scratch_print_host_3a`) | **`415 passed, 0 failed`** = 362 + az 11 + ba 19 + bb 13 + bc 10 |

Every row equals the plan's Expected.

### Step 2: the Next production build (the repo, D:)

`npm run build`: exit 0, **132 routes** (D: 13 GB free before it).

### Step 3: no app, desktop or Worker change

`git diff --stat aae162c..HEAD -- apps/mobile apps/desktop workers`: **empty**. The APKs (arm64 `b10feedb…`, armv7 `86b7ff13…`, x86_64 `3736540b…`) and `POS-Software-Setup-1.11.0.exe` (`348aebe1…`) stay as Phase 2 built them; nothing rebuilt.

### Step 4: the dormant check on the emulator (items 1–4: passed)

**The harness:** this branch's build (`9341e24`) served by `next start -p 3110` with a scratchpad env on a fresh database `pos_scratch_e2e_3a` (the admin, 8 tables and the sample menu seeded with `scripts/seed-admin.ts`, `seed-tables.ts`, `seed-menu.ts`); the counting proxy on 3200 → 3110 (a copy of the Phase 2 gates' `gate-proxy-2b.mjs` that also logs the pulse's `tokens=` value, never a header, body or cookie); fake printers on 9100 and 9101 with long `--out` paths; `adb reverse tcp:3100 tcp:3200`. Ports 3110, 3200, 9100 and 9101 were free; no other session's server was touched.

**The emulator:** `Pixel_7_API_33` booted by this session at **`-memory 2048`** (C: had 3.0 GB free, under ~4 GB: recorded), `-no-audio -no-snapshot-save`, `timeout: 7200000`. **As found:** the app installed, the **release APK** (hashed on the device `29115bdf…`), on its start screen with no address (not the demo). Because item 2 (two network printers written by one device) needs bridge v2, the **Phase 2 x86_64 APK** (`3736540b…`, hashed before the install) went over it with `adb install -r` for the check (ruling below), and the release APK went back at the end. `http://localhost:3100` typed on the start screen showed the local POS's sign-in page ("POS Software", not the demo); signed in as the scratch admin (the password typed by `type-secret.py` from the env file into a field checked to be a password field, never printed). Every tap was on the app's own screens. The app's device id is `80cfb12d…`.

| # | Step | Result |
|---|---|---|
| 1 | Simple mode; the app's own network printer `10.0.2.2:9100` (the panel → Use this network printer → "Printing is on · Network printer 10.0.2.2 is connected."); New Order: Cheesecake, Masala Chai → Send to Kitchen, then Pay Now → Cash → Place Order | Send to Kitchen: one KOT **44,454 B** on 9100; `POST /api/orders` (`lease`, `agent`) 201 and one ack (direct print). Pay Now: KOT **44,454 B** + bill **40,854 B**, once each; order, ack, lease, ack (Phase 2's Pay Now, spec §17.2). Every job unlabelled, epoch 1, printed. **Every pulse said `tokens` = null (17/17)**: the page is Phase 2's. **PASS** |
| 2 | Printers mode through the API (`p2g-tool.ts`): station Bar, Beverages → Bar; Kitchen printer LAN 9100 (Kitchen station, bill, notices, end of day) and Bar printer LAN 9101 (Bar station), both printed by the app's device; top-bar Refresh → the panel says "Printers are set up", and the app lists 9101 under "Other printers on this device" (Connected); Send to Kitchen | KITCHEN slip (Cheesecake) **44,238 B** on 9100 and BAR slip (Masala Chai) **44,238 B** on 9101 (both 80 mm); order + two acks, **no lease** (direct, Phase 2's item 6); both unlabelled, epoch 1. **PASS** |
| 3 | `PUT /api/printers/<Kitchen>` with `backupPrinterId` = Bar (the whole printer, `p3a-tool.ts backup`): 200; Send to Kitchen; then 75 s (one sweep at least) | the KITCHEN slip on 9100 and the BAR slip on 9101 as before (order + two acks, no lease); after 75 s no new paper, **0 `retargeted` / backup log entries**, no job moved; `GET /api/printers` shows Kitchen's backup (Bar) and **no `unreachable` and no `health`** on either printer. **PASS** |
| 4 | `adb logcat -b crash -d` | **0 lines** (at the start, after the run, and after the put-back). **PASS** |

The whole run's leases (3): one after Use this network printer, the Pay Now bill's, and a fresh page's mount lease after Refresh (all Phase 2's known ones); none after a direct print.

**Put back:** the setup reset (`p2d-tool.ts reset2d`: simple mode, only the default station, no printer, host null); the app's printers removed (9101 by the page after a Refresh, as Session 2G's rule does; 9100 by Remove → "No printer set up"); More options → Change POS address → the field cleared (start screen, no address); the **release APK** reinstalled (`29115bdf…` on the device; start screen empty; crash 0); `adb reverse --remove-all`, then `adb reverse tcp:3100 tcp:3100`; `adb shell sync`, then `adb emu kill`; this session's four servers stopped by PID after checking each command line. The scratch database `pos_scratch_e2e_3a` is left (its env file is in this session's scratchpad).

### Step 5: the fresh review (Claude Fable 5.1)

**How it ran.** A fresh reviewer on **Claude Fable 5.1** (no 429 this time), read-only, its probes only in this session's scratchpad (`review3a/`), reviewed `f23d84c..9341e24` against this plan (P3-1 to P3-10, Session 3A and both Review Focus lists, verbatim) and spec §9.3, §9.4, §9.8, §10, §14, §17. Its own runs on the landed tree: shared 65/65 (the three failover, printers and budget files), cafe 400/400 (21 suites), `tsc --incremental false` 0, eslint 0 on the 25 changed files, the live legs on its own database 415/0, and live probes P1–P9 on a scratch database (one lease per printer line across the primary's return; a network printer with a backup and a takeover candidate; mutual backups' label; the ack's `more` for a page between S7 and Phase 3; and more).

**Verdict: "With fixes (or I-1 ruled to the 3A gate)".** No Critical finding, one Important, eight minors. The sound list: one writer question everywhere; one lease per printer line through a failover flip; the backup move cannot double paper; fail-soft after every committed write; deploy skew (every new field optional in and ignored out; a Phase 2 page is never a candidate); the token fence for every page generation; the budget; tests that assert database state.

| # | Finding | Ruling |
|---|---|---|
| I-1 (Important) | A network printer the primary cannot reach but another device can: failover lasted exactly 5 minutes. Then the skip ran out, the primary (online, not skipped) became the writer again, new slips and the sweep went back to it, and its page, which never leases a printer it cannot reach, never acked "unreachable" again to renew the skip. The slips waited while a device that could print sat idle; staff's only remedy was re-saving the printer. Dormant until 3B. | **Fixed by TDD in `cf4499e`.** The 5 minutes are now the skip's floor. After them the skip holds until the skipped device's own lease names the printer again (`endPrinterSkipOf`, called by the lease: one write, only then; a page names only a printer it can print to now, `holds.open(ready())`), and at most 3 hours (`PRINTER_UNREACHABLE_HOLD_MS` = `PRINT_JOB_QUEUED_RETENTION_MS`; `printerSkipHolds`). `recordPrinterUnreachable` keeps the skips that still hold. A writer that cannot reach the printer still costs at most a lease and an ack per 5 minutes (the budget pin is unchanged). RED → GREEN below. Spec §9.3 and §9.8 and P3-3 carry the change. |
| m-1 | A backup that is not routable (no slip box ticked, or switched off) is accepted at save and is silently inert. | **3A gate / 3B form.** API only until 3B; 3B's form offers routable printers only. Recommended at the gate: refuse it at save in words, and show "(not in use)" when a backup stops being routable. |
| m-2 | The Worker budget pins do not count `announcePrinterHead` (P3-3 ruled it inside 5 %). | **3A gate:** add the term to the realtime pins. |
| m-3 | The 288-a-day pin is the skip's floor; on a flaky link (probe succeeds, print connect fails) the ceiling is Phase 1's 2 requests per 30 s. Not a new cost. | **3A gate:** the pin's title and comment wording. |
| m-4 | The token fence reaches devices with a `PrintDevice` row (wake pollers). A no-host simple-mode page from before S7 keeps today's cost (at most an empty lease per pulse while a token waits). | **3A gate:** P3-8's text; the runbook's "reload every device first" already covers it. |
| m-5 | `printerProblemOf` treats `connecting` as no problem: a dead TCP printer's 30 s probe could flicker the words and re-write health. | **3B/3C:** report the settled link, never a transient probe. |
| m-6 | Until 3B ships and every screen reloads, each ack, pulse and wake of a page that does not say `tokenSlips` pays one small read (bounded, by design, not pinned). | **3G:** the runbook's "reload every screen" and the measurement's note. |
| m-7 | The wire's `unreachable` carries skips that no longer hold (every reader filters by time). | **3B:** the setup page filters, or `printerWireOf` does. |
| m-8 | Spec §10's heartbeat shape still says `state`; §9.8 and the code say `link`. | **3A gate:** spec text. |

**Declined to judge (each ruled):**
- The by-id pick can choose a Bluetooth bar phone over the counter PC for a network takeover: P3-1 rules "by device id"; the reviewer's R-1 (prefer devices that are the primary of some network printer) goes to the 3A gate with 3B. *Cost if wrong:* a takeover by a device on a worse link, with the same paper.
- Direct print at creation follows a takeover only when the asking page sends the ready header for a taken-over printer: deferred to the 3B gate by the plan (M-8 c); dormant in 3A.
- The instant race between a lease and a direct-print creation on one printer line: pre-existing since Phase 2; it widens to two devices only with 3B's header (M-8 c), so the 3B gate.
- P3-9 (a writer whose wake cap is spent looks offline): already ruled; the 3A gate may revisit it with 3B's cap behaviour.
- A retarget log entry per sweep for failed or needs-confirm rows: pre-existing 2C behaviour, unchanged.
- `Printer.health` holds one report: by design (P3-6); the I-1 fix does not need per-device health.
- A network printer made by "Set up printers" from the app's own TCP printer: the reviewer checked it maps to `kind: "lan"` with a primary, so failover applies (no gap).

**Recommendations for the gates:** R-1 above; R-2 (3B: a taken-over printer enters the page's `ready` list and lease body, the page reports the settled link, and **a page must keep leaving a printer it cannot reach out of its lease: with I-1's fix that is the recovery signal, so 3B should pin it**); R-3 (3G: measure with at least one page that does not say `tokenSlips`, or say none was present); R-4 (done: leg ba pins the behaviour after the 5 minutes).

**The I-1 fix, RED → GREEN (`cf4499e`).**
- Shared `print-failover.test.ts`: the missing exports first (1 / 0 / 1), then with a stub (the constant, `printerSkipEndsFor` returning false, the old time rule) **10 tests, 7 pass, 3 fail**, exactly the three new assertions ("still the counter's when the 5 minutes are up", "a skip holds past its 5 minutes, and is gone after 3 hours", "after them, naming the printer ends it"). GREEN: the three shared files **66/66**, `SHARED_TSC_OK`.
- The lease PIN (`print-lifecycle-paths.test.ts`, "PIN (2C): a lease takes the head…", the `asked` line): RED 25 / 24 / **1** → GREEN.
- Leg ba: its last check ("five minutes on, the skips have run out: a new kitchen slip is the tablet's again") pinned the old behaviour, and is replaced by five checks: the counter's lease naming the printer past its 5 minutes ends its skip and takes the waiting slip while the blind tablet stays skipped; a new kitchen slip is the counter's; the counter's next refusal keeps the tablet's held skip, and the slip waits for the primary; within the counter's new 5 minutes its lease does not end its skip; the tablet's lease naming its printer ends its skip and takes its line back. RED: **416 passed, 3 failed** (the first, second and fifth; the third passed vacuously, as the counter never got the slip). GREEN: **419 passed, 0 failed** (ba 23). One test-timing slip on the way: the tablet's lease first ran 5 s after the slip's third refusal, inside its 10 s backoff; it runs at +12 s now (code unchanged).
- A mutation check of the third check: with `recordPrinterUnreachable`'s filter put back to the old "until > now", the live run read **418 passed, 1 failed** (exactly that check); restored.
- Cafe `print-lifecycle-paths`, `print-lease`, `print-printer-routing`, `self-order-alert-paths`: **67/67**; `TSC_OK`; `LINT_OK`.

### After the fix: every suite again (at `cf4499e`; once each, in the background, one after another, then the build)

| Suite | Result |
|---|---|
| shared `npm test`; `tsc` | **816/816** (+1: the `printerSkipEndsFor` test); 0 |
| cafe `npm test` | **4990 tests, 4989 pass, 0 fail, 1 skipped** (go-live-dl) |
| cafe, hub, mobile, desktop `tsc` / typecheck and lint | 0, and 0 errors (the 2 old warnings, `lib/masters-blob.test.ts:331`) |
| mobile `npm test`; `test:app` | **125/125**; Jest **3/3** |
| desktop `npm test` | **192/192** |
| `npm run test:print-tools` | **8/8** |
| live legs (`pos_scratch_print_host_3a`) | **`419 passed, 0 failed`** = 362 + az 11 + ba 23 + bb 13 + bc 10 |
| the Next build (the repo, D:) | exit 0, **132 routes** |

`git diff --stat aae162c..HEAD -- apps/mobile apps/desktop workers` is still **empty**: no APK or installer change. `f23d84c..cf4499e`: 48 files, +1,583 / −97 (the fix: 9 files, +134 / −36, docs included).

The dormant emulator check was not run again after `cf4499e` (ruling below): the fix acts only on a lease from a device that holds a skip, and only an "unreachable" ack, which no Phase 2 page sends, makes one.

### Deviations and rulings

- **Commit messages:** the plan's message for each task, plus the repo's `Co-Authored-By` trailer, as every earlier commit has.
- **The skill's `task-done` helper:** its first form (`bash -c '<test command>'`) was refused by the harness's safety check, so each task's test command ran through a small wrapper script in the scratchpad (`cafe-tests.sh`, `shared-tests.sh`). Nothing in the repo changed for it.
- **The emulator ran at `-memory 2048`:** C: had 3.0 GB free when it booted, which is under the ~4 GB the plan asks for (as the plan allows; recorded).
- **The APK for the check (ruling):** the app on the emulator was the release APK (`29115bdf…`, bridge v1), not empty and not the Phase 2 APK. Item 2 (two network printers written by one device) needs bridge v2, so the Phase 2 APK (`3736540b…`) went over it with `install -r` for the check. The release APK went back at the end, as found. *Cost if wrong:* none (put back, hash checked).
- **The proxy:** a copy of `gate-proxy-2b.mjs` that also logs the pulse's `tokens=` value (the plan's item 1 asks for it). It never logs a header, a body or a cookie. It was restarted once, before the first order.
- **Item 1's wording (ruling):** the plan's Expected says "the orders and acks only". On Pay Now the bill takes one lease (order, ack, lease, ack), exactly as in Phase 2 (spec §17.2: "Pay Now on one printer costs 3 print requests"), so the item was judged equal to Phase 2: **PASS**. *Cost if wrong:* none (3A changes no page code).
- **The harness's env (ruling):** the final Phase 2 gate's env file was copied with only the database name changed to the fresh `pos_scratch_e2e_3a`. The secrets were never printed.
- **The emulator was not run again after the I-1 fix (ruling):** see above. *Cost if wrong:* none for a Phase 2 page; the path does nothing without a skip.
- **I-1 fixed in this session, not ruled to the gate:** the plan and the prompt both say to fix every Important finding by TDD. The fix is server-only and dormant, and the 3A gate re-reviews it (below).

### Open for the 3A review gate

- **Re-review `cf4499e`:** it is new code outside the pre-validated gold, and a design change to P3-3, now written into the spec (§9.3, §9.8) and P3-3. **3B must pin that a page leaves a printer it cannot reach out of its lease** (`holds.open(ready())`), including a printer it takes over (M-8 d). With this fix, that is the signal that ends a skip.
- **The minors as ruled above:** m-1, m-2, m-3, m-4 and m-8 at the gate; m-5 and m-7 in 3B/3C; m-6 in 3G. Plus the reviewer's R-1 (which device to prefer) and R-3 (the measurement note).
- **P3-9** (a writer whose wake cap is spent) with 3B's cap behaviour; M-8 (a)–(d) for 3B, as the plan says.
- **The owner's real-printer checks** (Step 0 (a)) are still not run.
- **Leftovers:**
  - the scratch database `pos_scratch_e2e_3a` (its env and tools are in this session's scratchpad);
  - the live-leg databases dropped by their own runs;
  - the emulator app as found (the release APK, start screen, no address), with `adb reverse tcp:3100 tcp:3100`.

**Totals at `cf4499e`:**
- shared 816;
- cafe 4990 / 4989 / 0 / 1;
- live 419/0;
- mobile 125 + Jest 3, desktop 192, print tools 8;
- tsc and lint clean;
- the build: 132 routes;
- the APKs and the Windows installer unchanged since Phase 2.

## Session 3A review (gate)

Run on 2026-10-07 in its own session (the 3A review gate), on `feat/printing-phase-3` at `c08abfc`.

**Start.**
- `GIT_TERMINAL_PROMPT=0 git fetch origin` (the repo-local token store): `feat/printing-phase-3` = `origin/feat/printing-phase-3` = `c08abfc`, working tree clean; `origin/main` still `7f8ed31` (nothing to merge or note).
- Disk: D: 13 GB free, C: 4.7 GB free.
- The owner was asked once whether the real-printer checks are done (`apps/mobile/TEST-CHECKLIST.md` "Stations and printers checks", and Part C on the Windows app 1.11.0); no answer during the gate, which did not block on it. They are still open (Step 0 (a)): a real-printer failure is fixed first, on its own hotfix branch from `main`.

**The commits, read one by one** (`f23d84c..c08abfc`: A0 `ef6c658`, A1 `4e83f19`, A2 `8165a75`, A3 `114c48c`, A4 `9341e24`, the review fix `cf4499e`, Results `c08abfc`; 48 files, +1,743 / −98).
- **Same code as the gold.** `git ls-tree -r` of `9341e24` against the planning session's gold `g3a-v2` (tree `35204f2`) differs only in the plan and the spec (both changed by `f23d84c`): every file outside `docs/` is blob-identical. So only `cf4499e` is new code, and it was reviewed line by line.
- **No secret** in the range (a search of `git log -p f23d84c..c08abfc` for token, URI-with-password and secret patterns: none).
- **No app, desktop or Worker change:** `git diff --stat aae162c..HEAD -- apps/mobile apps/desktop workers` is empty.

**Every suite at `c08abfc`** (once each, in the background, one after another; the gate's scratchpad `suites-c08/`):

| Suite | Result |
|---|---|
| shared `npm test`; `tsc` | **816/816**; 0 |
| cafe `npm test` | **4990 tests, 4989 pass, 0 fail, 1 skipped** (go-live-dl) |
| cafe, hub, mobile, desktop `tsc` / typecheck and lint | 0, and 0 errors (the 2 old warnings, `lib/masters-blob.test.ts:331`) |
| mobile `npm test`; `test:app` | **125/125**; Jest **3/3** |
| desktop `npm test` | **192/192** |
| `npm run test:print-tools` | **8/8** |
| live legs (`pos_scratch_print_host_gate3a`) | **`419 passed, 0 failed`** = 362 + az 11 + ba 23 + bb 13 + bc 10 |
| the Next build (the repo, D:) | exit 0, **132 routes** |

Every row equals Session 3A's Results.

**`cf4499e` (I-1) proved again, RED then GREEN.** On a scratch clone at `c08abfc`, `git reset --soft 9341e24`, then `git stash push -m i1-red -- packages/shared/src/print-failover.ts packages/shared/src/print-budget.ts apps/cafe/lib/print-failover.ts apps/cafe/lib/print-lease.ts` (the fix's lib files back to `9341e24`; its tests and leg stay):
- RED: shared `print-failover.test.ts` **1 / 0 / 1** (the file cannot import `PRINTER_UNREACHABLE_HOLD_MS` and `printerSkipEndsFor`); leg ba alone **20 passed, 3 failed**, exactly the three checks Session 3A named ("five minutes on, the counter's lease names the kitchen printer again…", "… and a new kitchen slip is the counter's…", "the tablet's lease names its printer again…").
- GREEN (`git stash pop`): shared failover, printers and budget **66/66**; leg ba **23 passed, 0 failed**. The clone was put back to `c08abfc` (`git reset --soft c08abfc`, clean).

**The fresh review (Claude Fable 5.1; no HTTP 429).** Read-only, its probes only in the gate's scratchpad (`review-gate3a/`). It reviewed `cf4499e` and the whole 3A design against the plan's two Review Focus lists (passed verbatim) and spec §9.3, §9.4, §9.8, §10, §17. Its own runs: shared 49/49 (failover, budget), cafe 108/108 (the eight touched files), `tsc --incremental false` 0, live **419/0** on its own database, and live probes A–G (21 checks) on a scratch database.

**Verdict: "ship after fixes".** No Critical finding. Two Important design gaps, five minors, and opinions on the gate's open items. Its sound list: the pipeline write in `recordPrinterUnreachable`; one writer per printer line through a skip's end; `printerActiveWriter` at every point a slip is aimed; the backup move; health; the token fence; every new field optional in and ignored out.

| # | Finding | Ruling |
|---|---|---|
| I-A (Important) | A skip has one trigger, an "unreachable" ack, which needs a leased job; but a page never leases a printer it knows is down. So a primary whose app learned the printer is down before a slip (probe B: and a device that took a printer over but cannot reach it) is never skipped, and its slips wait while another device could print them. | **Fixed in 3B (B1):** a beat's settled `link: "disconnected"` from the writer now starts the skip (once), and `link: "connected"` past the first 5 minutes ends it, exactly as the lease does. Pinned by leg bd. |
| I-B (Important) | The 3-hour bound ends a hold on time alone (probe A): after 3 hours the printer and its new slips go back to the primary that still cannot reach it. | **Fixed in 3B (B1):** `PRINTER_UNREACHABLE_HOLD_MS` is `PRINT_DEVICE_PRUNE_MS` (7 days); with I-A the primary is re-skipped within a beat anyway. |
| m-A | 3B's spec said a `lanFailover` device "names every routable network printer in its lease": that would end its own skip 5 minutes after it began, reachable or not. | **Text fixed** in the 3B spec ("every one its app reaches"); B3 pins it. |
| m-B | The premise does not hold on the Windows app (no per-printer link), and only approximately on the Phase 2 APK (an idle TCP printer stays `connected` until a print fails): a bounded flip-flop, never stuck. | **To 3C and 3E:** 3C's idle probe; 3E's per-printer link in the Windows app's ready list (written into their specs). |
| m-C | "The primary is preferred the moment it is back" is not prompt after a skip: nothing makes the primary lease at the 5-minute mark. | **Fixed by I-A's ender:** the primary's next beat after the 5 minutes ends its skip. |
| m-D | A dead network printer with a backup never uses it while its primary is online (every writer skipped). | **Ruled in (B1):** the backup move asks `printerWriterCanPrint` (online and not skipped). P3-5 (d) changed. |
| m-E | `endPrinterSkipOf` treats a `$pull` that matched nothing as ended (only when the device's own ack renewed it in the same instant). | Note only: harmless (one lease's in-memory copy). |

**The rulings on every open item** are the next section.

**Recommended next:** Session 3B as exact code, below, pre-validated at this gate (plan lines 5866–11011, Tasks B0–B5: **154 operations**; a dry run of that range on the repo at `c08abfc` with this gate's applier matched every find once).

## 3A review gate: rulings

| Item | Ruling | Where |
|---|---|---|
| m-1 (3A's review) a non-routable backup | Refused at save in words when it is set or changed; one already saved is kept (an older page re-saves whole printers) and the row says "(not in use)". | B0, B5 |
| m-2 `announcePrinterHead` in the Worker pins | Pinned: a moved slip costs at most one more Worker request; the heavy token day with every slip moved once and every writer skipped all day is 4,667 a day, under 5 %. | B0 |
| m-3 the 288-a-day pin | Re-worded as the skip's floor; Phase 1's 2 requests per 30 s stays the ceiling on a flaky link. | B0 |
| m-4 P3-8's reach | Text: the fence reaches devices with a `PrintDevice` row; a page from before S7 on a simple-mode device with no host keeps today's cost until it reloads (the runbook's reload covers it). | P3-8 note, spec §9.8 |
| m-5 the settled link | Built: a page reports connected or disconnected, a probe in between keeps the last one; load-bearing for I-A. | B2 |
| m-6 reload every screen; the measurement | The runbook says it (B5's notes: one small extra read per ack, pulse and wake until a page reloads); 3G's measurement notes whether such a page was present. | B5, 3G spec |
| m-7 expired skips on the wire | Not taken: every reader filters by time, nothing shows the raw list, and the next skip's write prunes them. | — |
| m-8 spec §10's `state` | Fixed: `link`. | spec §10 |
| R-1 prefer a primary of some network printer | Declined, by device id as P3-1 says: the preference would have to be computed identically at every call site (the lease, routing, the sweep, the wake, the feed) or two of them would disagree on the writer; the same paper if wrong. 3G may revisit with measured data. | — |
| R-3 a page that does not say `tokenSlips` in 3G's measurement | Yes: 3G measures with one, or says none was present. | 3G spec |
| P3-9 a writer whose wake cap is spent | Kept as ruled: 3B adds no cap behaviour; every lease touches `lastSeenAt`; a takeover is the same paper. | — |
| 3B: candidate printers ahead of time or on demand | **Ahead of time** (the reviewer preferred on demand): the link of every candidate is known before a takeover, the lease names one only while the app reaches it (I-1's premise), I-A's beat can skip a candidate that cannot reach it from the first moment, and a takeover prints at once. Cost: the app probes a down network printer every 30 s on the cafe's network (no request); each writer's app lists every network printer, with why under Other printers. Only a device that writes a printer takes any over, and an app with no printer is never seeded with one (the gate's emulator pre-run, E-1). | B3 |
| 3B: the direct-print ready header for a taken-over printer | Yes: the server's `askingTabOf` gates it on the writer now and the printer line being free. | B3 |
| 3B: a per-printer link state for "known down" (M-8 d) | The POS app's own per-printer state (`readyPrinterIdsOf`) and I-A's beat. | B2, B3 |

**Carried into the later sessions' specs** (written there): 3C's idle DLE EOT probe also settles a TCP printer's `connected` (m-B), and the dot's printer-problem in simple mode (3B's review m-7); 3E's Windows app reports a per-printer link and names a network printer in its lease only while it reaches it (m-B); 3G measures with a page that does not say `tokenSlips` (R-3, m-6) and turns 3B's review probe of the beat/lease/ack interplay into soak checks (3B's review m-8).

### The fresh review of Session 3B's golden copy (Claude Fable 5.1)

A second fresh reviewer on **Claude Fable 5.1** (no HTTP 429), read-only, its probes only in the gate's scratchpad (`review-g3b/`), reviewed the golden copy (`c08abfc..g3b`) against the 3B spec, these rulings and 3B's Review Focus (passed verbatim). Its own runs: shared failover, budget and printers 71/71; cafe's changed and neighbouring suites 375/375, then the full cafe suite 5010 / 5009 / 0 / 1 at both golden heads; `tsc --incremental false` 0; eslint 0 errors; live legs **435/0** on its own database at both heads; and live probes on scratch databases (`probe-flap.ts`: the beat, lease and ack signals of a skip in every order, with each step's Printer writes counted; `probe-nonwriter.ts`).

**Verdict: "ship"** with the emulator pre-run's fix folded into B3. No Critical finding. Its one Important finding was the gate's own **E-1** (a POS app that writes no printer added every network printer to its app; on an empty app the first became its default, this device's own printer, so an ordering phone would have printed its own slips at the kitchen in simple mode, shown a false takeover note, and leased empty lines): fixed in B3 (writers only; an app with no printer is never seeded with another device's), and verified by the reviewer. Its sound list: one writer per printer line through every flip; no double print and no lost slip; no new recurring request; the settled link; the token fence's page half; the 7-day hold has a recovery signal on the release APK (its reconnect loop's probe) and on bridge v2.

| # | Finding | Ruling |
|---|---|---|
| m-1 | `takenOver` is computed before the beat's skip, so the beat that skips a device still names the printer it lost: its dot shows that printer one wake longer (≤ 60 s). | Not taken: bounded, and the dot then says what is true (the device cannot reach it). |
| m-2 | The row's on/off switch re-sends a saved backup id; if another device deleted that backup and this page missed the print-setup frame, the save fails "The backup printer no longer exists. Reload and choose again." | Not taken: rare, and the words say what to do. |
| m-3 | A takeover printer that staff made the app's default shows the in-setup words instead of the takeover words. | Not taken: rare, and both say to change it in Printer setup. |
| m-4 | The writing mark ends at the slip's deadline, while a hung bridge might still be writing. | Not taken: the corner needs a print hung past the deadline and the setup to drop that printer meanwhile. |
| m-5 | The setup page's lines compare server times with the tablet's clock. | Not taken: the skip's hold is 7 days and the online state is the server's; only a health report's 10-minute staleness can shift on a skewed clock (admin page). |
| m-6 | A Web Bluetooth printer waiting for a tap is reported "not connected". | Kept: it cannot print until tapped. |
| m-7 | The dot's printer problem exists only in printers mode. | Carried to 3C (the app reports paper, cover and error there). |
| m-8 | The beat, lease and ack interplay of a skip has no leg (each path has its own). | Carried to 3G: its `probe-flap.ts` timeline becomes soak checks. |
| m-9 | A candidate's probe of a down printer can collide with the primary's connect on a printer that takes one connection at a time: a 5-minute flip to the candidate. | Accepted: the same paper, bounded by the skip's floor (B0's m-3 pin names this ceiling). |

**One more, from the gate's own exit pre-run (G-1, carried to 3C's server task):** a device's lease refreshes `lastSeenAt` while only its wake says `lanFailover`. A former writer that no longer polls the wake (its printer moved to another device) but still leases from time to time keeps its last `lanFailover: true` and can be picked for a takeover in the 90 s after such a lease; its page names no takeover printer (E-1's fix), so those slips wait until it goes offline and the sweep moves them (≤ about 150 s). Nothing is lost or doubled. The fix: count `lanFailover` only from a wake seen within the online window (a `beatAt` written in the wake's existing heartbeat write).

---
## Session 3B (exact code, written and pre-validated at the 3A review gate)

**Pre-validation (the 3A review gate, 2026-10-07).**
- **Verbatim apply.** Every block of Tasks B0–B5 (**154 operations**) went verbatim, task by task, onto a fresh clone of `feat/printing-phase-3` at `c08abfc`. Every find matched exactly once.
- **RED, then GREEN.** Each task's RED was seen before its code went in, and each GREEN gave the Expected lines below.
- **Same tree.** The clone's tree came out IDENTICAL to the golden copy's (branch `g3b-v2`, tree `e297f0f`).
- **Every suite on the golden copy:**
  - shared 821/821; cafe 5010 / 5009 pass / 0 fail / 1 skipped;
  - tsc 0 and lint 0 errors (+2 old warnings) for cafe, hub, mobile and desktop;
  - mobile 125 + Jest 3; desktop 192; print tools 8; live legs 435/0 (az 11, ba 23, bb 15, bc 10, bd 14);
  - the Next build: 132 routes, in a separate build copy with webpack's persistent cache off (a config line in that copy only; C: had about 4.4 GB free).
- **The exit, pre-run** on the golden build (Step 4's harness, exactly as below): headless Chrome items 1–5 **PASS**; then the emulator (the Phase 2 APK `3736540b…`, booted at `-memory 2048` with C: at 4.4 GB) steps 1 and 3 **PASS**. The pre-run found one bug in the first golden copy, **E-1** (a POS app that writes no printer added every network printer to its app, and the first became its own printer); the fix is in B3, the fresh review found the same (its I-1), and items 1–5 ran again on the final golden build (PASS), with the emulator confirming that a device that writes nothing now gets no takeover printer. The emulator's steps 1 and 3 ran before the fix: the emulator was a writer there, which the fix does not change.
- **A fresh review on Claude Fable 5.1** (no HTTP 429): "ship" with E-1's fix folded in; nine minors, ruled in "The fresh review of Session 3B's golden copy" above.

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 3B delivers.** Session 3B is the page half of Phase 3's failover, health and backup printer (spec §9.3, §9.4, §10, §11, §17), plus the 3A review gate's server fixes:
- the gate's small server fixes: a backup must take slips when it is set, the Worker pin counts failover's head announcements, the 288-a-day pin's words (Task B0);
- failover follows each writer's reach: a beat's settled link starts or ends a skip, a skip holds while the device's record lives, a network printer nobody can reach uses its backup, the wake names what a device took over, the devices read says `lanFailover` (B1);
- the page's half of the wire: `lanFailover`, `tokenSlips` and the printers' settled health on the wake, tokens on every ack and the pulse, "unreachable" on a network printer's refusal, the app's paper, cover and error (B2);
- the POS app on bridge v2 takes network printers over: added ahead of time, named in a lease only while the app reaches it, the dot, a removal that waits for a print (B3);
- a printer's problem in its own words: the waiting-slips row and the alarm's notice on every device, the top-bar dot (B4);
- the Printer setup page's failover words and the backup printer in the form; GO-LIVE-CHECKLIST's Phase 3 page notes (B5);
- then the verification, the exit (headless Chrome with two fake POS apps, then the emulator), the fresh review and Results (B6).

**No longer dormant.** From 3B a page on the POS app with bridge v2 (the Phase 2 APK) says `lanFailover`, so Phase 3's failover acts for real: a network printer whose primary is offline, or cannot reach it, prints through another such device. A page from before 3B prints exactly as before (it never takes a printer over, never reports health; until it reloads, each of its acks, pulses and wakes costs one small extra read). The release APK (bridge v1) never takes a printer over; its page still reports its one printer's link and acks "unreachable". The Windows app takes printers over only from 1.12.0 (Session 3E).

**No app code, no desktop code, no Worker change, no new request.** The APKs and the Windows installer stay byte-identical to Phase 2's: `git diff --stat c08abfc..HEAD -- apps/mobile apps/desktop workers` stays empty. Every new field rides an existing request (the wake, the ack, the pulse, the lease), and `print-budget.test.ts` pins the one new cost (failover's head announcements, B0).

**Decisions this section implements:** P3-1 to P3-9 (above), as changed by the 3A review gate's rulings (the section "3A review gate: rulings" below), and the 3B spec above.

**Not in 3B:** the apps' printer layer and DLE EOT (3C), the app's service (3D), the Windows app 1.12.0 (3E), Telegram (3F), the Phase 3 exit and the measurement (3G).

### Review Focus (Session 3B)

The inputs most likely to bite a cafe that the unit tests alone would not exercise; each has a live leg, a test, a pin or an exit item.
1. **Deploy skew.** A page from before 3B (a Phase 2 page) on the 3B server prints exactly as before, and is never chosen to take a printer over; the release APK's page (bridge v1) reports its one printer and acks "unreachable", but never says `lanFailover`. → exit item 5, leg ba ("a page from before Phase 3 never takes a printer over"), `print-agent-paths.test.ts` (3B's pin).
2. **A device that cannot reach a printer it writes now, and says so only by its beat.** Its page never leases the printer (Phase 1's rule), so the beat is the only signal: it must skip that device once, move the slips, write nothing more while the skip holds, and end the skip when the device reaches the printer again. → leg bd, the 3B pin in `print-lifecycle-paths.test.ts`, `print-agent-health.test.ts` (the settled link).
3. **A takeover printer on every bridge v2 tablet.** Each tablet adds every network printer to its app ahead of time: it must never print one it does not write now (the server grants the line), never turn its own dot red for one (only while the wake says it took it over), never fight staff (no Remove; the words say why), and never be removed mid-print. → `print-agent-printers.test.ts` (3B's tests and pins), exit item 1.
4. **The backup printer** saved in the form: none sends `null`, a saved one that stopped taking slips is kept, one the form cannot find is none; a network printer nobody can reach uses it. → `print-setup-form.test.ts` (3B), leg bb (m-1), leg bd (m-D), exit item 4.
5. **A printer's problem in words** reaches every device without a request, and a stale or unknown printer name never produces a wrong sentence. → `print-waiting.test.ts` (3B), `printer-dot.test.ts` (3B), exit item 3.

### File map (Session 3B)

| File | Change | Task |
|---|---|---|
| `packages/shared/src/print-failover.ts`, `print-budget.ts`, `apps/cafe/lib/print-printers.ts`, `scripts/print-host-live/backup.ts` | the backup's refusal, the Worker pin, the 288's words | B0 |
| `packages/shared/src/print-failover.ts`, `print-agent-wire.ts`, `apps/cafe/lib/print-failover.ts`, `lib/print-device.ts`, the wake route, `scripts/print-host-live/takeover.ts` (create), `scripts/verify-print-host-live.ts` | the beat's skips, the hold, the backup when nobody can reach, `takenOver`, the devices' `lanFailover` | B1 |
| `apps/cafe/hooks/use-print-agent-wake.ts`, `hooks/use-print-agent.ts`, `lib/print-agent.ts`, `lib/print-agent-slip.ts`, `lib/print-agent-types.ts`, `lib/print-agent-seams.ts`, `lib/print-agent-health.ts` (create), `lib/print-agent-printers.ts`, `lib/printer/native-bridge-v2.ts`, `lib/printer/native-pool.ts` | the page's wire | B2 |
| `apps/cafe/lib/print-agent-printers.ts`, `lib/print-agent-seams.ts`, `hooks/use-print-agent.ts`, `hooks/use-agent-printers.ts`, `components/print/OtherDevicePrinters.tsx` | takeover printers in the app | B3 |
| `packages/shared/src/print-failover.ts`, `apps/cafe/lib/print-waiting.ts`, `components/print/WaitingSlipsCard.tsx`, `hooks/use-print-slip-alarm.ts`, `lib/printer/printer-dot.ts`, `lib/print-agent-printers.ts` | a printer's problem in words | B4 |
| `apps/cafe/lib/print-setup-text.ts`, `lib/print-setup-form.ts`, `components/print/setup/BackupPrinterSelect.tsx` (create), `PrinterFormDialog.tsx`, `PrintersSetupSection.tsx`, `DevicesSetupSection.tsx`, `docs/GO-LIVE-CHECKLIST.md` | the setup page, the backup printer, the runbook | B5 |
| this plan | Session 3B Results | B6 |

Each task is one commit, in this order: B0 → B5. Then B6 (verification, the exit, the fresh review, Results).

---

### Task B0: the 3A review gate's small server fixes: a backup printer must take slips when it is set (m-1); the Worker pin counts failover's head announcements (m-2); the 288-a-day pin is the skip's floor (m-3)

**Files:**
- Modify: `packages/shared/src/print-failover.ts` (`PRINTER_BACKUP_UNUSABLE_MESSAGE`, `printerBackupRefusal`)
- Modify: `packages/shared/src/print-budget.ts` (`PRINT_REALTIME_PER_MOVED_SLIP`, `printUnreachableAnnouncesPerWriterPerDay`; the 288's comment)
- Modify: `apps/cafe/lib/print-printers.ts` (create and save ask `printerBackupRefusal`)
- Modify: `apps/cafe/scripts/print-host-live/backup.ts` (leg bb: two checks)
- Tests: `packages/shared/src/print-failover.test.ts` (a test, new), `packages/shared/src/print-budget.test.ts` (a pin, new; the 288 pin's title re-worded)

**Interfaces produced:** `PRINTER_BACKUP_UNUSABLE_MESSAGE`, `printerBackupRefusal(printers, { id?, backupPrinterId, saved? }): string | null` (`@pos/shared/print-failover`); `PRINT_REALTIME_PER_MOVED_SLIP`, `printUnreachableAnnouncesPerWriterPerDay()` (`@pos/shared/print-budget`).

**m-1 (the 3A review gate).** A backup that routing never sends a slip to (switched off, no printing device, or no slip ticked) was saved silently and was inert. Now a backup that is set or changed must take slips, refused at save in words (400). The one already saved never fails a save that keeps it, even after it stopped taking slips, because a page from before 3B re-saves whole printers (to switch one on or off) and must never fail for a field it cannot see. The setup row says "(not in use)" for it (B5). The three rules (never itself, one that exists, one that takes slips) are one pure function, so the form and the server say the same words.

**m-2.** The head announcements failover adds (`announcePrinterHead`: a printer's waiting slips moved to the device that took it over, or to its backup) were inside P3-3's 5 % ruling but not pinned. A moved slip costs at most one more Worker request. The pin: the heavy token day (2,285) with every printer slip and token moved once (+1,950) and each of the three writers skipped all day (+3 × 144) is 4,667, under 5 % of the free 100,000.

**m-3.** The 288-a-day pin is the cost at the skip's floor. On a flaky link (the app's probe answers, its print's connect does not) the ceiling stays Phase 1's refusal recheck, 2 requests per 30 s: not new. The pin's title and the function's comment say so.

- [ ] **Step 1: The failing tests first**

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
  printUnreachableRequestsPerWriterPerDay,
  printHealthRefreshWritesPerPrinterPerDay,
} from "./print-budget";
import { PRINTER_HEALTH_REFRESH_MS, PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";
import { PRINTERS_MAX } from "./print-printers";
```

Replace it with:

```ts
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
  printUnreachableRequestsPerWriterPerDay,
  printHealthRefreshWritesPerPrinterPerDay,
  PRINT_REALTIME_PER_MOVED_SLIP,
  printUnreachableAnnouncesPerWriterPerDay,
} from "./print-budget";
import { PRINTER_HEALTH_REFRESH_MS, PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";
import { PRINTERS_MAX } from "./print-printers";
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
});

// Phase 3 Session 3A (spec §9.3): failover adds no request. The skip is ten refusal rechecks long, so a writer that
// cannot reach a network printer another device can print costs at most a lease and an ack per 5 minutes.
test("Phase 3 failover: a writer that could not reach a network printer is passed over for 5 minutes (ten 30 s rechecks): at most 288 requests a day", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 5 * 60 * 1000);
  assert.ok(PRINTER_UNREACHABLE_SKIP_MS >= 10 * PRINT_AGENT_REFUSED_RECHECK_MS, "never shorter than ten of Phase 1's refusal rechecks");
  assert.equal(printUnreachableRequestsPerWriterPerDay(), 288, "144 skips over the busy day's 12 h, a lease and an ack each");
```

Replace it with:

```ts
});

// Phase 3 Session 3A (spec §9.3): failover adds no request. The skip is ten refusal rechecks long, so a writer that
// cannot reach a network printer another device can print costs at most a lease and an ack per 5 minutes. The 3A review
// gate (m-3) deliberately re-worded this pin: 288 is the cost at the skip's floor; on a flaky link (the app's probe
// answers, its print's connect does not) the ceiling stays Phase 1's refusal recheck, 2 requests per 30 s, not new.
test("Phase 3 failover: a writer that could not reach a network printer costs at most 288 requests a day at the skip's 5-minute floor (ten 30 s rechecks); Phase 1's 2 requests per 30 s stays the ceiling", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 5 * 60 * 1000);
  assert.ok(PRINTER_UNREACHABLE_SKIP_MS >= 10 * PRINT_AGENT_REFUSED_RECHECK_MS, "never shorter than ten of Phase 1's refusal rechecks");
  assert.equal(printUnreachableRequestsPerWriterPerDay(), 288, "144 skips over the busy day's 12 h, a lease and an ack each");
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(cafe / (OPEN_MS / 1000) < 0.05, "far under Atlas M0's 100 operations a second");
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
```

Replace it with:

```ts
  assert.ok(cafe / (OPEN_MS / 1000) < 0.05, "far under Atlas M0's 100 operations a second");
});

// The 3A review gate (m-2): the head announcements failover adds (announcePrinterHead: a printer's waiting slips moved
// to the device that took it over, or to its backup printer) were inside P3-3's 5 % ruling but not pinned. A moved slip
// costs at most one more Worker request; at the heavy token day's figure with EVERY printer slip and token moved once,
// plus a head announced per 5-minute skip for each of the three writers, realtime printing stays under 5 %.
test("Phase 3 realtime: a slip moved by failover or to its backup costs at most one more Worker request; the heavy token day with every slip moved once and every writer skipped all day stays under 5 %", () => {
  assert.equal(PRINT_REALTIME_PER_MOVED_SLIP, 1, "its line's head announced to its new writer");
  assert.equal(printUnreachableAnnouncesPerWriterPerDay(), 144, "one head announced per 5-minute skip over the busy day's 12 h");
  const slips = printStationSlipsPerDay({ fullCopy: true }) + PRINT_BUDGET_BUSY_DAY.orders;
  const heavy = slips * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(heavy, 2_285, "the S7 heavy token day (one Worker request a slip or token)");
  const perDay = heavy + slips * PRINT_REALTIME_PER_MOVED_SLIP + PRINT_BUDGET_STATIONS_DAY.writers * printUnreachableAnnouncesPerWriterPerDay();
  assert.equal(perDay, 4_667, "plus every slip moved once and each writer skipped all day");
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  PRINTER_PROBLEMS,
  PRINTER_UNREACHABLE_HOLD_MS,
  PRINTER_UNREACHABLE_SKIP_MS,
  printerActiveWriter,
  printerBackupOf,
  printerProblemOf,
  printerProblemText,
  printerSkipEndsFor,
```

Replace it with:

```ts
  PRINTER_PROBLEMS,
  PRINTER_UNREACHABLE_HOLD_MS,
  PRINTER_UNREACHABLE_SKIP_MS,
  PRINTER_BACKUP_UNKNOWN_MESSAGE,
  PRINTER_BACKUP_UNUSABLE_MESSAGE,
  printerActiveWriter,
  printerBackupOf,
  printerBackupRefusal,
  printerProblemOf,
  printerProblemText,
  printerSkipEndsFor,
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  assert.match(PRINTER_BACKUP_SELF_MESSAGE, /own backup/);
});

test("printerProblemOf: the device offline first; then what its writer reported, while fresh and from that writer", () => {
  const health = (over: Partial<NonNullable<PrinterConfig["health"]>>) => ({ link: "connected" as const, deviceId: "bar", at: at(0), ...over });
  const online = failover([["bar", true]]);
```

Replace it with:

```ts
  assert.match(PRINTER_BACKUP_SELF_MESSAGE, /own backup/);
});

test("printerBackupRefusal: never itself, one that exists, and one routing still sends slips to, unless it is the one already saved (the 3A review gate, m-1)", () => {
  const counter = lan("c", "counter", { slips: { ...NO_SLIPS, bill: true } });
  const off = lan("o", "spare", { enabled: false });
  const idle = lan("i", "spare2", { slips: NO_SLIPS });
  const printers = [counter, off, idle];
  assert.equal(printerBackupRefusal(printers, { id: "b", backupPrinterId: "c" }), null, "a printer that takes slips");
  assert.equal(printerBackupRefusal(printers, { backupPrinterId: "c" }), null, "a new printer (no id yet)");
  assert.equal(printerBackupRefusal(printers, { id: "c", backupPrinterId: "c" }), PRINTER_BACKUP_SELF_MESSAGE);
  assert.equal(printerBackupRefusal(printers, { id: "b", backupPrinterId: "gone" }), PRINTER_BACKUP_UNKNOWN_MESSAGE);
  assert.equal(printerBackupRefusal(printers, { id: "b", backupPrinterId: "o" }), PRINTER_BACKUP_UNUSABLE_MESSAGE, "switched off: it would never print a slip");
  assert.equal(printerBackupRefusal(printers, { id: "b", backupPrinterId: "i" }), PRINTER_BACKUP_UNUSABLE_MESSAGE, "takes no slips");
  assert.equal(printerBackupRefusal(printers, { id: "b", backupPrinterId: "o", saved: "o" }), null, "the backup already saved stays saved when it stops taking slips (the row says it is not in use)");
  assert.match(PRINTER_BACKUP_UNUSABLE_MESSAGE, /switched on/, "in words");
});

test("printerProblemOf: the device offline first; then what its writer reported, while fresh and from that writer", () => {
  const health = (over: Partial<NonNullable<PrinterConfig["health"]>>) => ({ link: "connected" as const, deviceId: "bar", at: at(0), ...over });
  const online = failover([["bar", true]]);
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 2`; `# pass 0`; `# fail 2`

- [ ] **Step 3: The code**

In `apps/cafe/lib/print-printers.ts`, find:

```ts
import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINTER_BACKUP_SELF_MESSAGE, PRINTER_BACKUP_UNKNOWN_MESSAGE } from "@pos/shared/print-failover";
import { PRINTERS_MAX, printerClashMessage, printerWriterClash, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import { Printer, type IPrinter, type IPrinterConnection } from "@/models/Printer";
import { Station } from "@/models/Station";
```

Replace it with:

```ts
import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { printerBackupRefusal } from "@pos/shared/print-failover";
import { PRINTERS_MAX, printerClashMessage, printerWriterClash, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import { Printer, type IPrinter, type IPrinterConnection } from "@/models/Printer";
import { Station } from "@/models/Station";
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
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

Replace it with:

```ts
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  if (await nameTaken(stored.name)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  // Phase 3 (spec §9.4): a backup is another printer that exists now (a stale form never saves a dead id), and one
  // routing sends slips to (the 3A review gate, m-1).
  const backupRefused = stored.backupPrinterId === undefined ? null : printerBackupRefusal(existing, { backupPrinterId: stored.backupPrinterId });
  if (backupRefused !== null) return { ok: false, status: 400, error: backupRefused };
  // Session 2D (the 2C review gate, F-3): one routable printer per printing device; Session 2E: a Windows PC may
  // print several Windows printers, each a different one.
  const clash = printerWriterClash(existing, stored);
```

In `apps/cafe/lib/print-printers.ts`, find:

```ts
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
```

Replace it with:

```ts
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  if (await nameTaken(stored.name, id)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  const printers = await listPrinters();
  // Phase 3 (spec §9.4): never itself, one that exists now, and one routing sends slips to unless it is the one already
  // saved (the 3A review gate, m-1).
  const backupRefused = typeof backupPrinterId === "string" ? printerBackupRefusal(printers, { id, backupPrinterId, saved: printer.backupPrinterId }) : null;
  if (backupRefused !== null) return { ok: false, status: 400, error: backupRefused };
  const clash = printerWriterClash(printers, stored, id);
  if (clash !== null) return { ok: false, status: 409, error: printerClashMessage(clash, stored) };
  printer.set("connection", stored.connection);
```

In `apps/cafe/scripts/print-host-live/backup.ts`, find:

```ts
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
```

Replace it with:

```ts
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_BACKUP_SELF_MESSAGE, PRINTER_BACKUP_UNKNOWN_MESSAGE, PRINTER_BACKUP_UNUSABLE_MESSAGE } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { leasePrintJobs } from "@/lib/print-lease";
import { createPrinter, deletePrinter, listPrinters, replacePrinter } from "@/lib/print-printers";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check } from "./harness";
import { STAFF, rowOf, setRaw } from "./lifecycle";
```

In `apps/cafe/scripts/print-host-live/backup.ts`, find:

```ts
  const self = await replacePrinter(o.bar, bar({ backupPrinterId: o.bar }));
  const unknown = await replacePrinter(o.bar, bar({ backupPrinterId: "aaaaaaaaaaaaaaaaaaaaaaaa" }));
  check("(bb) a printer is never its own backup, and a backup must exist (400s, in words)", !self.ok && self.error === PRINTER_BACKUP_SELF_MESSAGE && !unknown.ok && unknown.error === PRINTER_BACKUP_UNKNOWN_MESSAGE);
  const saved = await replacePrinter(o.bar, bar({ backupPrinterId: o.counter }));
  check("(bb) the bar printer saved with the counter printer as its backup", saved.ok && saved.data.backupPrinterId === o.counter);
```

Replace it with:

```ts
  const self = await replacePrinter(o.bar, bar({ backupPrinterId: o.bar }));
  const unknown = await replacePrinter(o.bar, bar({ backupPrinterId: "aaaaaaaaaaaaaaaaaaaaaaaa" }));
  check("(bb) a printer is never its own backup, and a backup must exist (400s, in words)", !self.ok && self.error === PRINTER_BACKUP_SELF_MESSAGE && !unknown.ok && unknown.error === PRINTER_BACKUP_UNKNOWN_MESSAGE);
  // The 3A review gate (m-1): a printer that takes no slip would be an inert backup.
  const spareMade = await createPrinter({ ...bar({}), name: "Spare", connection: { kind: "lan", host: "10.0.0.73", port: 9100 }, primaryDeviceId: COUNTER, slips: NO_SLIPS });
  const spare = spareMade.ok ? spareMade.data.id : "";
  const inert = await replacePrinter(o.bar, bar({ backupPrinterId: spare }));
  const inertNew = await createPrinter({ ...bar({ backupPrinterId: spare }), name: "Bar 2", connection: { kind: "device", deviceId: "live-fo-bar2", transport: "bt-classic", address: "AA:BB:DD" } });
  check("(bb) a backup that takes no slips is refused at save, on an edit and on a new printer (400, in words)", !inert.ok && inert.error === PRINTER_BACKUP_UNUSABLE_MESSAGE && !inertNew.ok && inertNew.error === PRINTER_BACKUP_UNUSABLE_MESSAGE);
  await Printer.updateOne({ _id: o.bar }, { $set: { backupPrinterId: spare } });
  const keptInert = await replacePrinter(o.bar, bar({ backupPrinterId: spare }));
  check("(bb) ... but a backup already saved that stopped taking slips never fails a save that keeps it", keptInert.ok && keptInert.data.backupPrinterId === spare);
  const saved = await replacePrinter(o.bar, bar({ backupPrinterId: o.counter }));
  check("(bb) the bar printer saved with the counter printer as its backup", saved.ok && saved.data.backupPrinterId === o.counter);
```

In `packages/shared/src/print-budget.ts`, find:

```ts
 *  reach a network printer is passed over for it for at least PRINTER_UNREACHABLE_SKIP_MS while another device can take
 *  it (then until its own lease names the printer again: Session 3A's final review, I-1), so such a printer costs that
 *  writer at most one lease and one ack per 5 minutes (a device that knows its printer is down never leases for it at
 *  all: Phase 1's rule). */
export function printUnreachableRequestsPerWriterPerDay(): number {
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS) * PRINT_REQUESTS_PER_SLIP;
}

/** Phase 3 (spec §10, §17): printer health rides the wake (no request). A printer's health is written when it changes,
```

Replace it with:

```ts
 *  reach a network printer is passed over for it for at least PRINTER_UNREACHABLE_SKIP_MS while another device can take
 *  it (then until its own lease names the printer again: Session 3A's final review, I-1), so such a printer costs that
 *  writer at most one lease and one ack per 5 minutes (a device that knows its printer is down never leases for it at
 *  all: Phase 1's rule). That is the cost at the skip's floor; on a flaky link (the app's probe answers, its print's
 *  connect does not) the ceiling stays Phase 1's refusal recheck, 2 requests per 30 s (the 3A review gate, m-3). */
export function printUnreachableRequestsPerWriterPerDay(): number {
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS) * PRINT_REQUESTS_PER_SLIP;
}

/** Phase 3 (spec §9.3, §9.4; the 3A review gate, m-2): a slip moved to the device that took its printer over, or to
 *  its backup printer, costs at most one more Worker request: its line's head announced to the new writer
 *  (announcePrinterHead, at most once per move). */
export const PRINT_REALTIME_PER_MOVED_SLIP = 1;

/** The head announcements one writer's 5-minute skips cause over the busy day: at most one per skip. */
export function printUnreachableAnnouncesPerWriterPerDay(): number {
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS);
}

/** Phase 3 (spec §10, §17): printer health rides the wake (no request). A printer's health is written when it changes,
```

In `packages/shared/src/print-failover.ts`, find:

```ts

export const PRINTER_BACKUP_SELF_MESSAGE = "A printer cannot be its own backup. Choose another printer.";
export const PRINTER_BACKUP_UNKNOWN_MESSAGE = "The backup printer no longer exists. Reload and choose again.";

/** §9.4: this printer's backup, while routing may still send it slips (enabled, with a writer, taking a slip); null
 *  with none, with itself, or with one deleted or switched off. */
```

Replace it with:

```ts

export const PRINTER_BACKUP_SELF_MESSAGE = "A printer cannot be its own backup. Choose another printer.";
export const PRINTER_BACKUP_UNKNOWN_MESSAGE = "The backup printer no longer exists. Reload and choose again.";
/** The 3A review gate (m-1): a backup that routing never sends a slip to would be saved silently inert. */
export const PRINTER_BACKUP_UNUSABLE_MESSAGE = "The backup printer must be switched on, with its printing device and its slips chosen. Choose another printer.";

/** §9.4 (the 3A review gate, m-1): why a printer cannot take `backupPrinterId` as its backup, in words, or null. Never
 *  itself; one that exists; and one routing still sends slips to (switched on, with a writer, taking a slip), unless it
 *  is the backup already `saved`: a save that keeps a backup which has since stopped taking slips never fails for it
 *  (an older page re-saves whole printers; the setup row says the backup is not in use). */
export function printerBackupRefusal(printers: readonly PrinterConfig[], input: { id?: string; backupPrinterId: string; saved?: string }): string | null {
  if (input.backupPrinterId === input.id) return PRINTER_BACKUP_SELF_MESSAGE;
  if (!printers.some((printer) => printer.id === input.backupPrinterId)) return PRINTER_BACKUP_UNKNOWN_MESSAGE;
  if (input.backupPrinterId !== input.saved && routablePrinterOf(printers, input.backupPrinterId) === null) return PRINTER_BACKUP_UNUSABLE_MESSAGE;
  return null;
}

/** §9.4: this printer's backup, while routing may still send it slips (enabled, with a writer, taking a slip); null
 *  with none, with itself, or with one deleted or switched off. */
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts src/print-budget.test.ts src/print-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && cd /d/kd/lucifer/packages/shared && npx tsc --noEmit && echo SHARED_TSC_OK`
Expected: `# tests 68`; `# pass 68`; `# fail 0`; `SHARED_TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-printers.ts scripts/print-host-live/backup.ts && echo LINT_OK`
Expected: `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3b npm run verify:print:live 2>&1 | grep -E "passed,|FAIL"`
Expected: `421 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-printers.ts apps/cafe/scripts/print-host-live/backup.ts packages/shared/src/print-budget.test.ts packages/shared/src/print-budget.ts packages/shared/src/print-failover.test.ts packages/shared/src/print-failover.ts
git commit -m "fix(print): a backup printer must take slips when it is set; the Worker pin counts the head announcements failover adds; the 288-a-day pin says it is the skip's floor (Phase 3 Session 3B, B0: the 3A review gate's m-1, m-2, m-3)"
```

---

### Task B1: failover follows each writer's reach: a beat's settled link starts or ends a skip; a skip holds while the device's record lives; a network printer nobody can reach uses its backup; the wake names what a device took over; the devices read says lanFailover

**Files:**
- Modify: `packages/shared/src/print-failover.ts` (`PRINTER_UNREACHABLE_HOLD_MS` = `PRINT_DEVICE_PRUNE_MS`; `printerWriterCanPrint`; `printersTakenOverBy`)
- Modify: `packages/shared/src/print-agent-wire.ts` (`PrintDeviceSummary.lanFailover`, `PrintWakeBeatData.takenOver`)
- Modify: `apps/cafe/lib/print-failover.ts` (`skipUnreachableFromBeat`; the backup move asks `printerWriterCanPrint`), `apps/cafe/lib/print-device.ts` (the devices read's `lanFailover`), `apps/cafe/app/api/print-jobs/wake/route.ts` (the beat's skips; `takenOver`)
- Create: `apps/cafe/scripts/print-host-live/takeover.ts` (leg bd); modify `scripts/verify-print-host-live.ts`, `scripts/print-host-live/failover.ts` (a comment)
- Tests: `packages/shared/src/print-failover.test.ts` (two tests new; the hold's lines changed), `apps/cafe/lib/print-lifecycle-paths.test.ts` (a pin new; the wake pin's and the backup pin's lines changed)

**Interfaces produced:** `printerWriterCanPrint(printer, failover): boolean`, `printersTakenOverBy(printers, deviceId, failover): string[]` (`@pos/shared/print-failover`); `skipUnreachableFromBeat({ deviceId, reports, printers, failover, nowMs }): Promise<number>` (`lib/print-failover.ts`); `PrintWakeBeatData.takenOver?: string[]`, `PrintDeviceSummary.lanFailover?: true`.

**The 3A review gate's I-A (its fresh review, Important).** A skip began only with an "unreachable" ack, which needs a leased job; but a page never leases a printer it knows is down (Phase 1's rule, and the premise cf4499e rests on). So a writer that learned it cannot reach its printer without a print (the app's probe after a restart, or a device that took a printer over and found it unreachable) was never skipped, and its slips waited while another device could print them. The wake's beat already carries each printer's settled link (B2). Now a beat's `link: "disconnected"` for a network printer from its writer now skips that writer, exactly as the ack does (`recordPrinterUnreachable`: the slips move to the next writer at once), once: a skip that already holds writes nothing. A beat's `link: "connected"` from a device skipped for it ends its skip once the first 5 minutes are up, exactly as its lease naming the printer does (`endPrinterSkipOf`), so the primary gets its printer back at its next beat (the review's m-C: P3-1's "preferred the moment it is back" no longer waits for a lease). Cost: one write per skip started or ended; no request.

**I-B (Important).** cf4499e bounded a hold at 3 hours (the waiting slips' retention). After 3 hours the printer went back to a writer that still could not reach it, and new slips with it: I-1 again, for any outage longer than 3 hours. A skip now holds as long as the device's own record lives (`PRINT_DEVICE_PRUNE_MS`, 7 days): one entry per device; it ends when the device says it reaches the printer (its lease names it, or its beat says connected); a device that never comes back is never online, so never a writer.

**m-D (ruled in).** A network printer that every writer is skipped for falls back to its primary, skipped too. P3-5 (d) kept its slips there ("the 5-minute skips run out and the writers try again"), which no longer happens on time alone. Now the backup move asks whether the writer now can print the printer (`printerWriterCanPrint`: online, and not skipped for it), so such a printer's untried slips go to its backup, labelled BACKUP PRINTER, exactly like those of a printer whose device is offline. A cafe whose one kitchen tablet cannot reach the kitchen printer gets its slips at the backup.

**The wake names the printers a device took over** (`takenOver`, omitted when none): the network printers it writes now that the setup names another device for (`printersTakenOverBy`, in memory: the wake already reads the printers and who is online). The page's top-bar dot counts such a printer only while the wake says so (B3).

**The devices read says `lanFailover`**, for the setup page's "Can take over network printers" (B5).

**Changed existing pins:** `print-lifecycle-paths.test.ts` "PIN: POST /api/print-jobs/wake beats…" (the beat's skips after the health; `takenOver`) and "PIN (Phase 3, §9.4): the backup move…" (`printerWriterCanPrint`); `print-failover.test.ts`'s constants and hold tests (7 days, not 3 hours).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
      // writes each printer now for the health this device reports (kept only on a change).
      "readOnlinePrintDevices(nowMs)",
      "await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);",
      "const agents = Math.max(1, online.length);",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
    ],
    "wake POST",
  );
  assert.ok(!/PrintJob\.|PrintDevice\./.test(s), "the route writes only through the libs");
});

// Session 1A final-review fixes (plan "Session 1A Results", findings I1 and I4).
```

Replace it with:

```ts
      // writes each printer now for the health this device reports (kept only on a change).
      "readOnlinePrintDevices(nowMs)",
      "await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);",
      // Session 3B (the 3A review gate, M-8 d) deliberately added: a beat that says this device cannot reach a network
      // printer it writes now skips it, as an "unreachable" ack does; and the answer says which printers it took over.
      "await skipUnreachableFromBeat({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);",
      "const agents = Math.max(1, online.length);",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "const takenOver = printersTakenOverBy(printers, parsed.data.deviceId, { online, nowMs });",
      "...(takenOver.length > 0 ? { takenOver } : {}),",
      "return noStore(success(data));",
    ],
    "wake POST",
  );
  assert.ok(!/PrintJob\.|PrintDevice\./.test(s), "the route writes only through the libs");
});

// Session 3B (the 3A review gate, M-8 d): the beat's link is the signal for a printer a device cannot reach without a
// print; only the writer now, only a network printer, and once per skip.
test("PIN (3B): a beat's settled link starts its device's skip for a network printer it writes now and cannot reach, once, and ends it once it reaches it again", () => {
  const s = src("apps/cafe/lib/print-failover.ts");
  const start = s.indexOf("export async function skipUnreachableFromBeat(");
  assert.ok(start >= 0, "declared in lib/print-failover.ts");
  inOrder(
    s.slice(start),
    [
      "const printer = routablePrinterOf(input.printers, report.printerId);",
      'if (printer === null || printer.connection.kind !== "lan") continue;',
      'if (report.link === "connected") {',
      "if (!printerSkipEndsFor(printer, input.deviceId, input.nowMs)) continue;",
      "await endPrinterSkipOf(printer, input.deviceId, input.nowMs);",
      'if (report.link !== "disconnected" || printerActiveWriter(printer, input.failover) !== input.deviceId) continue;',
      "if (printerSkippedWriters(printer, input.nowMs).includes(input.deviceId)) continue;",
      "await recordPrinterUnreachable({ printerId: printer.id, deviceId: input.deviceId, nowMs: input.nowMs });",
    ],
    "skipUnreachableFromBeat",
  );
  // The 3A review gate (m-D): a network printer every writer is skipped for moves its slips to its backup.
  assert.ok(s.includes("if (backup === null || printerWriterCanPrint(printer, failover) || !printerWriterCanPrint(backup, failover)) continue;"), "the backup move asks who can print, not only who is online");
  // The devices read says which device can take a network printer over (the setup page's words).
  assert.ok(src(DEVICE).includes('...(row.capabilities?.lanFailover === true ? { lanFailover: true as const } : {}),'), "the devices read carries lanFailover");
});

// Session 1A final-review fixes (plan "Session 1A Results", findings I1 and I4).
```

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
    move,
    [
      "const backup = printerBackupOf(printers, printer);",
      "if (backup === null || printerWriterOnline(printer, failover) || !printerWriterOnline(backup, failover)) continue;",
      '{ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }',
      "printerId: backup.id,",
      "labels: { $concatArrays: [[BACKUP_LABEL], { $filter:",
```

Replace it with:

```ts
    move,
    [
      "const backup = printerBackupOf(printers, printer);",
      // The 3A review gate (m-D) deliberately changed the test: who can print it (online, and not skipped for it).
      "if (backup === null || printerWriterCanPrint(printer, failover) || !printerWriterCanPrint(backup, failover)) continue;",
      '{ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }',
      "printerId: backup.id,",
      "labels: { $concatArrays: [[BACKUP_LABEL], { $filter:",
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  printerProblemText,
  printerSkipEndsFor,
  printerSkippedWriters,
  printerWriterOnline,
  type PrinterFailover,
} from "./print-failover";
import { PRINT_JOB_QUEUED_RETENTION_MS } from "./print-job";
import type { PrinterConfig } from "./print-printers";

// Printing Phase 3 Session 3A (spec §9.3, §9.4, §10): the shared rules of failover, the backup printer and printer
```

Replace it with:

```ts
  printerProblemText,
  printerSkipEndsFor,
  printerSkippedWriters,
  printerWriterCanPrint,
  printerWriterOnline,
  printersTakenOverBy,
  type PrinterFailover,
} from "./print-failover";
import { PRINT_DEVICE_PRUNE_MS } from "./print-lifecycle";
import type { PrinterConfig } from "./print-printers";

// Printing Phase 3 Session 3A (spec §9.3, §9.4, §10): the shared rules of failover, the backup printer and printer
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  return { online: online.map(([deviceId, lanFailover]) => ({ deviceId, lanFailover })), nowMs };
}

test("constants: a skip lasts at least 5 minutes and at most 3 hours; health is refreshed every 5 minutes and stale after 10", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 300_000);
  // Session 3A's final review (I-1): beyond 3 hours a waiting slip is pruned anyway (PRINT_JOB_QUEUED_RETENTION_MS).
  assert.equal(PRINTER_UNREACHABLE_HOLD_MS, PRINT_JOB_QUEUED_RETENTION_MS, "a skip holds at most as long as a waiting slip is kept");
  assert.equal(PRINTER_HEALTH_REFRESH_MS, 300_000);
  assert.equal(PRINTER_HEALTH_STALE_MS, 600_000);
  assert.deepEqual([...PRINTER_PROBLEMS], ["device-offline", "paper-out", "cover-open", "error", "offline", "paper-low"], "worst first");
```

Replace it with:

```ts
  return { online: online.map(([deviceId, lanFailover]) => ({ deviceId, lanFailover })), nowMs };
}

test("constants: a skip lasts at least 5 minutes and holds while the device's record lives; health is refreshed every 5 minutes and stale after 10", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 300_000);
  // The 3A review gate (I-B, deliberate change): a 3-hour bound sent the printer back to a writer that still could not
  // reach it after a long outage; a skip now ends only when the device says it reaches the printer, or with its record.
  assert.equal(PRINTER_UNREACHABLE_HOLD_MS, PRINT_DEVICE_PRUNE_MS, "a skip holds as long as the device's own record lives (7 days)");
  assert.equal(PRINTER_HEALTH_REFRESH_MS, 300_000);
  assert.equal(PRINTER_HEALTH_STALE_MS, 600_000);
  assert.deepEqual([...PRINTER_PROBLEMS], ["device-offline", "paper-out", "cover-open", "error", "offline", "paper-low"], "worst first");
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  const both = failover([["kitchen", true], ["counter", true]]);
  assert.equal(printerActiveWriter(skipKitchen, both), "counter", "the primary skipped, the counter takes it");
  // Session 3A's final review (I-1): a page never leases a printer it cannot reach, so the skip cannot run out on time
  // alone: the counter keeps the printer until the tablet's own lease names it again (lib/print-failover.ts), or 3 hours.
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_SKIP_MS)), "counter", "still the counter's when the 5 minutes are up");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_HOLD_MS)), "kitchen", "back to the primary after 3 hours at most");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true]])), "kitchen", "no one else: the primary keeps it");
  const skipCounter = lan("k", "kitchen", { unreachable: [{ deviceId: "counter", until: at(60_000) }] });
  assert.equal(printerActiveWriter(skipCounter, failover([["counter", true], ["bar", true]])), "bar", "the skipped candidate is passed over");
```

Replace it with:

```ts
  const both = failover([["kitchen", true], ["counter", true]]);
  assert.equal(printerActiveWriter(skipKitchen, both), "counter", "the primary skipped, the counter takes it");
  // Session 3A's final review (I-1): a page never leases a printer it cannot reach, so the skip cannot run out on time
  // alone: the counter keeps the printer until the tablet says it reaches it again (lib/print-failover.ts), or 7 days.
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_SKIP_MS)), "counter", "still the counter's when the 5 minutes are up");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_HOLD_MS)), "kitchen", "back to the primary once the device's record would be pruned");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true]])), "kitchen", "no one else: the primary keeps it");
  const skipCounter = lan("k", "kitchen", { unreachable: [{ deviceId: "counter", until: at(60_000) }] });
  assert.equal(printerActiveWriter(skipCounter, failover([["counter", true], ["bar", true]])), "bar", "the skipped candidate is passed over");
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
});

test("printerSkippedWriters / printerWriterOnline", () => {
  // `until` is the end of a skip's first 5 minutes: a recorded at T0 - 1 min, b at T0 - 10 min, c 3 hours ago.
  const skips = [
    { deviceId: "a", until: at(PRINTER_UNREACHABLE_SKIP_MS - 60_000) },
    { deviceId: "b", until: at(PRINTER_UNREACHABLE_SKIP_MS - 600_000) },
    { deviceId: "c", until: at(PRINTER_UNREACHABLE_SKIP_MS - PRINTER_UNREACHABLE_HOLD_MS) },
  ];
  assert.deepEqual(printerSkippedWriters(lan("k", "kitchen", { unreachable: skips }), T0), ["a", "b"], "a skip holds past its 5 minutes, and is gone after 3 hours");
  assert.equal(printerWriterOnline(lan("k", "kitchen"), failover([["kitchen", true]])), true);
  assert.equal(printerWriterOnline(lan("k", "kitchen"), failover([["old-page", false]])), false, "its writer now is the offline primary");
  assert.equal(printerWriterOnline(bt("b", "bar"), failover([["counter", true]])), false);
```

Replace it with:

```ts
});

test("printerSkippedWriters / printerWriterOnline", () => {
  // `until` is the end of a skip's first 5 minutes: a recorded at T0 - 1 min, b at T0 - 10 min, c 7 days ago.
  const skips = [
    { deviceId: "a", until: at(PRINTER_UNREACHABLE_SKIP_MS - 60_000) },
    { deviceId: "b", until: at(PRINTER_UNREACHABLE_SKIP_MS - 600_000) },
    { deviceId: "c", until: at(PRINTER_UNREACHABLE_SKIP_MS - PRINTER_UNREACHABLE_HOLD_MS) },
  ];
  assert.deepEqual(printerSkippedWriters(lan("k", "kitchen", { unreachable: skips }), T0), ["a", "b"], "a skip holds past its 5 minutes, and is gone with the device's record");
  assert.equal(printerWriterOnline(lan("k", "kitchen"), failover([["kitchen", true]])), true);
  assert.equal(printerWriterOnline(lan("k", "kitchen"), failover([["old-page", false]])), false, "its writer now is the offline primary");
  assert.equal(printerWriterOnline(bt("b", "bar"), failover([["counter", true]])), false);
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  assert.equal(printerSkipEndsFor(printer, "kitchen", T0), false, "within its 5 minutes the skip stands (at most a lease and an ack per 5 minutes)");
  assert.equal(printerSkipEndsFor(printer, "kitchen", T0 + PRINTER_UNREACHABLE_SKIP_MS), true, "after them, naming the printer ends it");
  assert.equal(printerSkipEndsFor(printer, "counter", T0 + PRINTER_UNREACHABLE_SKIP_MS), false, "only the skipped device's own skip");
  assert.equal(printerSkipEndsFor(printer, "kitchen", T0 + PRINTER_UNREACHABLE_HOLD_MS), false, "after 3 hours it is gone already: nothing to end");
  assert.equal(printerSkipEndsFor(lan("k", "kitchen"), "kitchen", T0), false, "no skip: nothing to end");
});

test("printerBackupOf: a routable other printer, or null", () => {
```

Replace it with:

```ts
  assert.equal(printerSkipEndsFor(printer, "kitchen", T0), false, "within its 5 minutes the skip stands (at most a lease and an ack per 5 minutes)");
  assert.equal(printerSkipEndsFor(printer, "kitchen", T0 + PRINTER_UNREACHABLE_SKIP_MS), true, "after them, naming the printer ends it");
  assert.equal(printerSkipEndsFor(printer, "counter", T0 + PRINTER_UNREACHABLE_SKIP_MS), false, "only the skipped device's own skip");
  assert.equal(printerSkipEndsFor(printer, "kitchen", T0 + PRINTER_UNREACHABLE_HOLD_MS), false, "after 7 days it is gone already: nothing to end");
  assert.equal(printerSkipEndsFor(lan("k", "kitchen"), "kitchen", T0), false, "no skip: nothing to end");
});

test("printerWriterCanPrint: online and not skipped; a network printer every writer is skipped for cannot print (its slips go to its backup: the 3A gate, m-D)", () => {
  const skipAll = lan("k", "kitchen", { unreachable: [{ deviceId: "kitchen", until: at(PRINTER_UNREACHABLE_SKIP_MS) }, { deviceId: "counter", until: at(PRINTER_UNREACHABLE_SKIP_MS) }] });
  assert.equal(printerWriterCanPrint(lan("k", "kitchen"), failover([["kitchen", true]])), true);
  assert.equal(printerWriterCanPrint(lan("k", "kitchen"), failover([["counter", false]])), false, "its device offline");
  assert.equal(printerWriterCanPrint(skipAll, failover([["kitchen", true], ["counter", true]])), false, "every writer skipped: the primary, skipped too, cannot");
  assert.equal(printerWriterCanPrint(skipAll, failover([["kitchen", true], ["counter", true], ["bar", true]])), true, "the bar phone, not skipped, takes it over");
  assert.equal(printerWriterCanPrint(bt("b", "bar"), failover([["bar", true]])), true, "a device printer: its device online");
});

test("printersTakenOverBy: the printers a device writes now that the setup names another device for (Session 3B: the wake says so)", () => {
  const kitchen = lan("k", "kitchen");
  const counter = lan("c", "counter");
  const bar = bt("b", "bar");
  const printers = [kitchen, counter, bar];
  assert.deepEqual(printersTakenOverBy(printers, "counter", failover([["kitchen", true], ["counter", true], ["bar", true]])), [], "every primary online: nothing taken over");
  assert.deepEqual(printersTakenOverBy(printers, "counter", failover([["counter", true], ["bar", true]])), [], "the kitchen offline: the bar phone takes it (first by id), not the counter");
  assert.deepEqual(printersTakenOverBy(printers, "bar", failover([["counter", true], ["bar", true]])), ["k"], "... so the bar phone is told");
  assert.deepEqual(printersTakenOverBy(printers, "kitchen", failover([["counter", true], ["bar", true]])), [], "a device's own printer is never 'taken over' by it");
  assert.deepEqual(printersTakenOverBy([lan("k", "kitchen", { enabled: false }), counter], "bar", failover([["bar", true], ["counter", true]])), [], "only printers routing sends slips to");
});

test("printerBackupOf: a routable other printer, or null", () => {
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 26`; `# pass 23`; `# fail 3`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, printDeviceDrawsTokens, readOnlinePrintDevices } from "@/lib/print-device";
import { recordPrinterHealth } from "@/lib/print-health";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printAgentDailyCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { printerWriterDevices } from "@pos/shared/print-printers";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

Replace it with:

```ts
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, printDeviceDrawsTokens, readOnlinePrintDevices } from "@/lib/print-device";
import { skipUnreachableFromBeat } from "@/lib/print-failover";
import { recordPrinterHealth } from "@/lib/print-health";
import { listPrinters } from "@/lib/print-printers";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printAgentDailyCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { printersTakenOverBy } from "@pos/shared/print-failover";
import { printerWriterDevices } from "@pos/shared/print-printers";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
    // write only ages the kept health).
    if (parsed.data.printers !== undefined && parsed.data.printers.length > 0) {
      await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);
    }
    const agents = Math.max(1, online.length);
    try {
```

Replace it with:

```ts
    // write only ages the kept health).
    if (parsed.data.printers !== undefined && parsed.data.printers.length > 0) {
      await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);
      // Session 3B (the 3A review gate, M-8 d): a network printer it writes now and says it cannot reach skips it, as an
      // "unreachable" ack does (one write per skip; best-effort).
      await skipUnreachableFromBeat({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);
    }
    const agents = Math.max(1, online.length);
    try {
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
    } catch {
      // no after() in this runtime — skip the sweep, keep the wake
    }
    const data: PrintWakeBeatData = {
      jobsForMe,
      agents,
```

Replace it with:

```ts
    } catch {
      // no after() in this runtime — skip the sweep, keep the wake
    }
    // Session 3B: the network printers it took over (its top-bar dot counts them while it writes them).
    const takenOver = printersTakenOverBy(printers, parsed.data.deviceId, { online, nowMs });
    const data: PrintWakeBeatData = {
      jobsForMe,
      agents,
```

In `apps/cafe/app/api/print-jobs/wake/route.ts`, find:

```ts
      serverNow: new Date(nowMs).toISOString(),
      // The 2C gate's emulator run: a writer whose printer list missed a print-setup frame learns it here.
      writesPrinters: printerWriterDevices(printers).includes(parsed.data.deviceId),
    };
    return noStore(success(data));
  } catch (error) {
```

Replace it with:

```ts
      serverNow: new Date(nowMs).toISOString(),
      // The 2C gate's emulator run: a writer whose printer list missed a print-setup frame learns it here.
      writesPrinters: printerWriterDevices(printers).includes(parsed.data.deviceId),
      ...(takenOver.length > 0 ? { takenOver } : {}),
    };
    return noStore(success(data));
  } catch (error) {
```

In `apps/cafe/lib/print-device.ts`, find:

```ts
 *  lead), for the Printer setup page and a network printer's printing device. One bounded read; no write. */
export async function listPrintDevices(nowMs: number): Promise<PrintDeviceSummary[]> {
  const rows = await PrintDevice.find()
    .select("deviceId label shell lastSeenAt nativeProtocol")
    .sort({ lastSeenAt: -1 })
    .limit(PRINT_DEVICES_LIST_MAX)
    .lean<Array<{ deviceId: string; label: string; shell: PrintDeviceShell; lastSeenAt: Date; nativeProtocol?: number }>>();
  return rows.map((row) => ({
    deviceId: row.deviceId,
    label: row.label,
```

Replace it with:

```ts
 *  lead), for the Printer setup page and a network printer's printing device. One bounded read; no write. */
export async function listPrintDevices(nowMs: number): Promise<PrintDeviceSummary[]> {
  const rows = await PrintDevice.find()
    .select("deviceId label shell lastSeenAt nativeProtocol capabilities.lanFailover")
    .sort({ lastSeenAt: -1 })
    .limit(PRINT_DEVICES_LIST_MAX)
    .lean<Array<{ deviceId: string; label: string; shell: PrintDeviceShell; lastSeenAt: Date; nativeProtocol?: number; capabilities?: { lanFailover?: boolean } }>>();
  return rows.map((row) => ({
    deviceId: row.deviceId,
    label: row.label,
```

In `apps/cafe/lib/print-device.ts`, find:

```ts
    lastSeenAt: row.lastSeenAt.toISOString(),
    // Session 2F1 (spec §9.2): the POS app's bridge version (2: it prints several printers), for the printer form.
    ...(row.nativeProtocol !== undefined ? { nativeProtocol: row.nativeProtocol } : {}),
  }));
}
```

Replace it with:

```ts
    lastSeenAt: row.lastSeenAt.toISOString(),
    // Session 2F1 (spec §9.2): the POS app's bridge version (2: it prints several printers), for the printer form.
    ...(row.nativeProtocol !== undefined ? { nativeProtocol: row.nativeProtocol } : {}),
    // Session 3B (spec §9.3): it can take a network printer over, for the setup page's words.
    ...(row.capabilities?.lanFailover === true ? { lanFailover: true as const } : {}),
  }));
}
```

In `apps/cafe/lib/print-failover.ts`, find:

```ts
  printerActiveWriter,
  printerBackupOf,
  printerSkipEndsFor,
  printerWriterOnline,
  type PrinterFailover,
} from "@pos/shared/print-failover";
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
```

Replace it with:

```ts
  printerActiveWriter,
  printerBackupOf,
  printerSkipEndsFor,
  printerSkippedWriters,
  printerWriterCanPrint,
  type PrinterFailover,
  type PrinterHealthReport,
} from "@pos/shared/print-failover";
import { routablePrinterOf, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { Printer } from "@/models/Printer";
```

In `apps/cafe/lib/print-failover.ts`, find:

```ts
}

/** §9.4: a printer whose device is offline (no heartbeat for 90 s; a network printer with no online device left to take
 *  it over) sends its waiting slips to its backup printer, when the backup's device is online: each queued slip that was
 *  never tried, or only refused before any byte (no uncertain attempt), moves with BACKUP PRINTER first among its
 *  labels and a 'retargeted' log, and the backup's writer is told of its head. A slip that may have printed, a bill
 *  waiting for the cashier and a slip being printed stay; so does every slip of a printer with no backup (every device's
```

Replace it with:

```ts
}

/** §9.4: a printer whose device is offline (no heartbeat for 90 s; a network printer with no online device left to take
 *  it over), or, since the 3A review gate (m-D), a network printer that every writer could not reach (printerWriterCanPrint),
 *  sends its waiting slips to its backup printer, when the backup's device can print it: each queued slip that was
 *  never tried, or only refused before any byte (no uncertain attempt), moves with BACKUP PRINTER first among its
 *  labels and a 'retargeted' log, and the backup's writer is told of its head. A slip that may have printed, a bill
 *  waiting for the cashier and a slip being printed stay; so does every slip of a printer with no backup (every device's
```

In `apps/cafe/lib/print-failover.ts`, find:

```ts
  let moved = 0;
  for (const printer of printers) {
    const backup = printerBackupOf(printers, printer);
    if (backup === null || printerWriterOnline(printer, failover) || !printerWriterOnline(backup, failover)) continue;
    const writer = printerActiveWriter(backup, failover) ?? "";
    const res = await PrintJob.updateMany({ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }, [
      {
```

Replace it with:

```ts
  let moved = 0;
  for (const printer of printers) {
    const backup = printerBackupOf(printers, printer);
    if (backup === null || printerWriterCanPrint(printer, failover) || !printerWriterCanPrint(backup, failover)) continue;
    const writer = printerActiveWriter(backup, failover) ?? "";
    const res = await PrintJob.updateMany({ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }, [
      {
```

In `apps/cafe/lib/print-failover.ts`, find:

```ts
  return writer;
}

/** §9.3 (Session 3A's final review, I-1): a device's lease that names a network printer it is skipped for ends that skip
 *  once its first 5 minutes are up (printerSkipEndsFor): a page names only a printer it can print to now, so its app
 *  reaches the printer again. Without this a skip would run out on time alone and send the printer back to a writer
```

Replace it with:

```ts
  return writer;
}

/** Session 3B (the 3A review gate, I-A and M-8 d): a beat's settled link for a network printer starts or ends this
 *  device's skip for it. "disconnected" from its writer now skips it, exactly as an "unreachable" ack does: a page never
 *  leases a printer it knows is down (Phase 1's rule), so without this a writer that learned it cannot reach a printer
 *  without a print (its app's probe), or a device that took one over but cannot reach it, would hold its slips, never
 *  leased and never acked, while another device could print them. "connected" from a device skipped for it ends its skip
 *  once the first 5 minutes are up, exactly as its lease naming the printer does, so the primary gets its printer back
 *  at its next beat. Only a network printer; a skip already held, or one not yet past its 5 minutes, writes nothing.
 *  Returns how many skips it started or ended (one write each). */
export async function skipUnreachableFromBeat(input: {
  deviceId: string;
  reports: readonly PrinterHealthReport[];
  printers: readonly PrinterConfig[];
  failover: PrinterFailover;
  nowMs: number;
}): Promise<number> {
  let writes = 0;
  for (const report of input.reports) {
    const printer = routablePrinterOf(input.printers, report.printerId);
    if (printer === null || printer.connection.kind !== "lan") continue;
    if (report.link === "connected") {
      if (!printerSkipEndsFor(printer, input.deviceId, input.nowMs)) continue;
      await endPrinterSkipOf(printer, input.deviceId, input.nowMs);
      writes += 1;
      continue;
    }
    if (report.link !== "disconnected" || printerActiveWriter(printer, input.failover) !== input.deviceId) continue;
    if (printerSkippedWriters(printer, input.nowMs).includes(input.deviceId)) continue;
    await recordPrinterUnreachable({ printerId: printer.id, deviceId: input.deviceId, nowMs: input.nowMs });
    writes += 1;
  }
  return writes;
}

/** §9.3 (Session 3A's final review, I-1): a device's lease that names a network printer it is skipped for ends that skip
 *  once its first 5 minutes are up (printerSkipEndsFor): a page names only a printer it can print to now, so its app
 *  reaches the printer again. Without this a skip would run out on time alone and send the printer back to a writer
```

In `apps/cafe/scripts/print-host-live/failover.ts`, find:

```ts

  // Session 3A's final review (I-1): a page never leases a printer it cannot reach, so a skip cannot run out on time
  // alone (the slips would go back to a tablet that never again says it cannot reach the printer). It holds past its
  // 5 minutes until the skipped device's own lease names the printer again (its app reaches it), at most 3 hours.
  const later = nowMs + 12_000 + PRINTER_UNREACHABLE_SKIP_MS + 1_000;
  await Promise.all([online(KITCHEN, later), online(COUNTER, later)]);
  const back = await lease(COUNTER, [o.kitchen], later);
```

Replace it with:

```ts

  // Session 3A's final review (I-1): a page never leases a printer it cannot reach, so a skip cannot run out on time
  // alone (the slips would go back to a tablet that never again says it cannot reach the printer). It holds past its
  // 5 minutes until the skipped device's own lease names the printer again (its app reaches it), or its record is pruned.
  const later = nowMs + 12_000 + PRINTER_UNREACHABLE_SKIP_MS + 1_000;
  await Promise.all([online(KITCHEN, later), online(COUNTER, later)]);
  const back = await lease(COUNTER, [o.kitchen], later);
```

Create `apps/cafe/scripts/print-host-live/takeover.ts`:

```ts
/**
 * Phase 3 Session 3B live leg (bd) — the server half of the page's takeover (spec §9.3; the 3A review gate, M-8 d)
 * against a REAL MongoDB: a beat that says a device cannot reach a network printer it writes now skips it, as an
 * "unreachable" ack does, and the waiting slip moves to the next device that can take the printer over; the beats after
 * it write nothing; a device that does not write the printer now, a device printer, or a "connected" beat never skip; the
 * wake's answer names the printers a device took over; the devices read says which device can take one over. Run by
 * scripts/verify-print-host-live.ts after leg bc.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_UNREACHABLE_SKIP_MS, printersTakenOverBy, type PrinterHealthReport } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { listPrintDevices, readOnlinePrintDevices } from "@/lib/print-device";
import { skipUnreachableFromBeat } from "@/lib/print-failover";
import { listPrinters } from "@/lib/print-printers";
import { routePrinterJobs } from "@/lib/print-sweep";
import { check } from "./harness";
import { rowOf } from "./lifecycle";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

/** What the wake does with a beat's printers after the health: who is online, then the skips its links ask for. */
async function beat(deviceId: string, reports: PrinterHealthReport[], nowMs: number): Promise<number> {
  return skipUnreachableFromBeat({ deviceId, reports, printers: await listPrinters(), failover: { online: await readOnlinePrintDevices(nowMs), nowMs }, nowMs });
}

const skipsOf = async (printerId: string) => ((await listPrinters()).find((printer) => printer.id === printerId)?.unreachable ?? []).map((skip) => skip.deviceId).sort().join();
const takenOverBy = async (deviceId: string, nowMs: number) => printersTakenOverBy(await listPrinters(), deviceId, { online: await readOnlinePrintDevices(nowMs), nowMs });

export async function legBD(nowMs: number): Promise<void> {
  console.log("\n(bd) the page's takeover, server half (§9.3): a beat that cannot reach a network printer it writes now skips it; the wake names what a device took over");
  const o = await failoverOutlet();
  // The bar phone also says lanFailover (the outlet's helpers make every device a Phase 3 page), and its id sorts before
  // the counter's, so it is the first to take the kitchen's network printer over.
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  check("(bd) every primary online: no device has taken anything over", (await takenOverBy(BAR, nowMs)).length === 0);
  check("(bd) a device that does not write the printer now, reporting it down, skips nothing", (await beat(COUNTER, [{ printerId: o.kitchen, link: "disconnected" }], nowMs)) === 0 && (await skipsOf(o.kitchen)) === "");
  check("(bd) a device printer reported down never skips (only network printers fail over)", (await beat(BAR, [{ printerId: o.bar, link: "disconnected" }], nowMs)) === 0 && (await skipsOf(o.bar)) === "");

  await offline(KITCHEN, nowMs + 1_000);
  const waiting = await kotOf(o, nowMs + 1_000);
  check("(bd) the kitchen tablet offline: the bar phone takes the kitchen printer over, and the wake tells it so", (await takenOverBy(BAR, nowMs + 1_000)).join() === o.kitchen && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === BAR);
  check("(bd) a 'connected' beat never skips", (await beat(BAR, [{ printerId: o.kitchen, link: "connected" }], nowMs + 1_500)) === 0 && (await skipsOf(o.kitchen)) === "");
  const skipped = await beat(BAR, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 2_000);
  check(
    "(bd) the bar phone's beat says it cannot reach the kitchen printer: it is skipped, and the waiting slip moves to the counter at once",
    skipped === 1 && (await skipsOf(o.kitchen)) === BAR && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === COUNTER,
  );
  check("(bd) ... and the wake now tells the counter, not the bar phone", (await takenOverBy(COUNTER, nowMs + 2_000)).join() === o.kitchen && (await takenOverBy(BAR, nowMs + 2_000)).length === 0);
  const before = await Printer.findById(o.kitchen).select("updatedAt").lean<{ updatedAt: Date }>();
  check(
    "(bd) the bar phone's next beats, still down, write nothing (its skip holds)",
    (await beat(BAR, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 3_000)) === 0 &&
      (await Printer.findById(o.kitchen).select("updatedAt").lean<{ updatedAt: Date }>())?.updatedAt.getTime() === before?.updatedAt.getTime(),
  );
  await beat(COUNTER, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 4_000);
  check(
    "(bd) the counter cannot reach it either: both skipped, the slip waits for its primary (visibly: its device is offline)",
    (await skipsOf(o.kitchen)) === [BAR, COUNTER].sort().join() && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN,
  );
  // The 3A review gate (I-A): the primary back, its beat says it reaches the printer; past its 5 minutes that ends its
  // skip, as its lease naming the printer would, and the sweep sends the waiting slip home.
  await online(KITCHEN, nowMs + 4_500);
  await beat(KITCHEN, [{ printerId: o.kitchen, link: "disconnected" }], nowMs + 4_500);
  const early = await beat(KITCHEN, [{ printerId: o.kitchen, link: "connected" }], nowMs + 5_000);
  check("(bd) the kitchen tablet back but unable to reach it is skipped too; its 'connected' beat inside its 5 minutes ends nothing", early === 0 && (await skipsOf(o.kitchen)).includes(KITCHEN));
  const later = nowMs + 4_500 + PRINTER_UNREACHABLE_SKIP_MS + 1_000;
  await Promise.all([online(KITCHEN, later), online(COUNTER, later), online(BAR, later)]);
  const ended = await beat(KITCHEN, [{ printerId: o.kitchen, link: "connected" }], later);
  await routePrinterJobs(later);
  check(
    "(bd) past them, its 'connected' beat ends its skip: the kitchen printer is its own again and the sweep sends the slip home",
    ended === 1 && !(await skipsOf(o.kitchen)).includes(KITCHEN) && (await rowOf(waiting.kitchen?.id ?? ""))?.targetDeviceId === KITCHEN,
  );

  // The 3A review gate (m-D): a network printer that every writer is skipped for, with a backup, moves its waiting slips
  // there (labelled), as a printer whose device is offline does.
  await Printer.updateOne({ _id: o.kitchen }, { $set: { backupPrinterId: o.counter } });
  await beat(KITCHEN, [{ printerId: o.kitchen, link: "disconnected" }], later + 1_000);
  const stuck = await kotOf(o, later + 1_000);
  await routePrinterJobs(later + 1_000);
  const toBackup = await rowOf(stuck.kitchen?.id ?? "");
  check(
    "(bd) every writer skipped for the kitchen printer, its primary online: its waiting slip goes to its backup, labelled BACKUP PRINTER",
    (await skipsOf(o.kitchen)) === [BAR, COUNTER, KITCHEN].sort().join() && toBackup?.printerId === o.counter && (toBackup.labels ?? []).join() === "BACKUP PRINTER",
  );
  const devices = await listPrintDevices(later + 1_000);
  check("(bd) the devices read says which devices can take a network printer over", devices.length === 3 && devices.every((device) => device.lanFailover === true));
  await online(COUNTER, later + 2_000, false);
  check("(bd) ... and says nothing for a page from before Phase 3", (await listPrintDevices(later + 2_000)).find((device) => device.deviceId === COUNTER)?.lanFailover === undefined);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legBA } from "./print-host-live/failover";
import { legBB } from "./print-host-live/backup";
import { legBC } from "./print-host-live/health";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { legBA } from "./print-host-live/failover";
import { legBB } from "./print-host-live/backup";
import { legBC } from "./print-host-live/health";
import { legBD } from "./print-host-live/takeover";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legBA(Date.now());
    await legBB(Date.now());
    await legBC(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legBA(Date.now());
    await legBB(Date.now());
    await legBC(Date.now());
    await legBD(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  /** Session 2F1 (spec §9.2): the POS app's bridge version from its wake (2: it prints several printers); absent for
   *  any other device, and for an app whose page has not said yet. */
  nativeProtocol?: number;
}
/** The devices list's one page: far above any cafe's devices (rows unseen for 7 days are pruned). */
export const PRINT_DEVICES_LIST_MAX = 50;
```

Replace it with:

```ts
  /** Session 2F1 (spec §9.2): the POS app's bridge version from its wake (2: it prints several printers); absent for
   *  any other device, and for an app whose page has not said yet. */
  nativeProtocol?: number;
  /** Session 3B (spec §9.3): its wake said it can take a network printer over (PrintDeviceCapabilities.lanFailover). */
  lanFailover?: true;
}
/** The devices list's one page: far above any cafe's devices (rows unseen for 7 days are pruned). */
export const PRINT_DEVICES_LIST_MAX = 50;
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
   *  writer told false has a stale printer list (its printer removed or moved while the print-setup frame was
   *  missed): it reads the list again and stops polling. Absent from an older server. */
  writesPrinters?: boolean;
}
```

Replace it with:

```ts
   *  writer told false has a stale printer list (its printer removed or moved while the print-setup frame was
   *  missed): it reads the list again and stops polling. Absent from an older server. */
  writesPrinters?: boolean;
  /** Session 3B (spec §9.3): the network printers this device writes now that the setup names another device for (taken
   *  over while their primary is offline or cannot reach them); absent when none, and from an older server. */
  takenOver?: string[];
}
```

In `packages/shared/src/print-failover.ts`, find:

```ts
// Pure and client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import { PRINT_JOB_QUEUED_RETENTION_MS } from "./print-job";
import { printerWriterDeviceId, routablePrinterOf, type PrinterConfig } from "./print-printers";

/** §9.3: a writer that could not reach a network printer is skipped for it at least this long, so another writer gets
 *  its next lease (and the skipped one tries again after it, the same 5 minutes Phase 1's refusal rules allow a dead
 *  printer). */
export const PRINTER_UNREACHABLE_SKIP_MS = 5 * 60 * 1000;
/** §9.3 (Session 3A's final review, I-1): after its first 5 minutes a skip holds until the skipped device's own lease
 *  names the printer again, and at most this long after it began. A page never leases a printer it cannot reach
 *  (holds.open(ready())), so a skip that ran out on time alone would send the printer back to a writer that still
 *  cannot reach it and never says so again, while another device that can sits idle. Beyond 3 hours a waiting slip
 *  is pruned anyway (PRINT_JOB_QUEUED_RETENTION_MS). */
export const PRINTER_UNREACHABLE_HOLD_MS = PRINT_JOB_QUEUED_RETENTION_MS;

/** §9.3: one writer that could not reach a network printer, and when (ISO, server time) its first 5 minutes end: from
 *  then on its own lease that names the printer ends the skip (printerSkipEndsFor), which holds at most
```

Replace it with:

```ts
// Pure and client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import { PRINT_DEVICE_PRUNE_MS } from "./print-lifecycle";
import { printerWriterDeviceId, routablePrinterOf, routablePrinters, type PrinterConfig } from "./print-printers";

/** §9.3: a writer that could not reach a network printer is skipped for it at least this long, so another writer gets
 *  its next lease (and the skipped one tries again after it, the same 5 minutes Phase 1's refusal rules allow a dead
 *  printer). */
export const PRINTER_UNREACHABLE_SKIP_MS = 5 * 60 * 1000;
/** §9.3 (Session 3A's final review, I-1): after its first 5 minutes a skip holds until the skipped device itself says
 *  it reaches the printer again (its lease names the printer, or, from Session 3B, its beat says "connected"). A page
 *  never leases a printer it cannot reach (holds.open(ready())), so a skip that ran out on time alone would send the
 *  printer back to a writer that still cannot reach it, while another device that can sits idle. The 3A review gate
 *  (I-B): a 3-hour bound did exactly that for an outage longer than 3 hours, so a skip now holds as long as the
 *  device's own record lives (PRINT_DEVICE_PRUNE_MS, 7 days): one entry per device, and a device that never comes back
 *  is never online, so never a writer. */
export const PRINTER_UNREACHABLE_HOLD_MS = PRINT_DEVICE_PRUNE_MS;

/** §9.3: one writer that could not reach a network printer, and when (ISO, server time) its first 5 minutes end: from
 *  then on its own lease that names the printer ends the skip (printerSkipEndsFor), which holds at most
```

In `packages/shared/src/print-failover.ts`, find:

```ts
  return others[0] ?? configured;
}

/** §9.4: whether the device that writes this printer now is online (a heartbeat within 90 s). */
export function printerWriterOnline(printer: WriterOf, failover: PrinterFailover): boolean {
  const writer = printerActiveWriter(printer, failover);
  return writer !== null && failover.online.some((device) => device.deviceId === writer);
}

export const PRINTER_BACKUP_SELF_MESSAGE = "A printer cannot be its own backup. Choose another printer.";
```

Replace it with:

```ts
  return others[0] ?? configured;
}

/** Session 3B: the printers `deviceId` writes now that the setup names another device for (a network printer taken over
 *  while its primary is offline or cannot reach it), by id. The wake tells the device, so its top-bar dot counts them. */
export function printersTakenOverBy(printers: readonly PrinterConfig[], deviceId: string, failover: PrinterFailover): string[] {
  return routablePrinters(printers)
    .filter((printer) => printerWriterDeviceId(printer) !== deviceId && printerActiveWriter(printer, failover) === deviceId)
    .map((printer) => printer.id);
}

/** §9.4: whether the device that writes this printer now is online (a heartbeat within 90 s). */
export function printerWriterOnline(printer: WriterOf, failover: PrinterFailover): boolean {
  const writer = printerActiveWriter(printer, failover);
  return writer !== null && failover.online.some((device) => device.deviceId === writer);
}

/** §9.4 (the 3A review gate, m-D): whether the device that writes this printer now can print it: it is online, and it is
 *  not skipped for it. A network printer that every writer could not reach falls back to its primary, skipped too, so
 *  its slips go to its backup printer exactly like those of a printer whose device is offline. */
export function printerWriterCanPrint(printer: WriterOf, failover: PrinterFailover): boolean {
  const writer = printerActiveWriter(printer, failover);
  return writer !== null && printerWriterOnline(printer, failover) && !printerSkippedWriters(printer, failover.nowMs).includes(writer);
}

export const PRINTER_BACKUP_SELF_MESSAGE = "A printer cannot be its own backup. Choose another printer.";
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts src/print-budget.test.ts src/print-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && cd /d/kd/lucifer/packages/shared && npx tsc --noEmit && echo SHARED_TSC_OK`
Expected: `# tests 70`; `# pass 70`; `# fail 0`; `SHARED_TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-setup-paths.test.ts lib/print-setup-ui-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 55`; `# pass 55`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-failover.ts lib/print-device.ts app/api/print-jobs/wake/route.ts scripts/print-host-live/takeover.ts scripts/print-host-live/failover.ts scripts/verify-print-host-live.ts lib/print-lifecycle-paths.test.ts && echo LINT_OK`
Expected: `LINT_OK`

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3b npm run verify:print:live 2>&1 | grep -E "passed,|FAIL"`
Expected: `435 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/print-jobs/wake/route.ts apps/cafe/lib/print-device.ts apps/cafe/lib/print-failover.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/scripts/print-host-live/failover.ts apps/cafe/scripts/print-host-live/takeover.ts apps/cafe/scripts/verify-print-host-live.ts packages/shared/src/print-agent-wire.ts packages/shared/src/print-failover.test.ts packages/shared/src/print-failover.ts
git commit -m "feat(print): failover follows each writer's reach: a beat's settled link starts or ends its skip, a skip holds while the device's record lives, a network printer nobody can reach sends its slips to its backup, the wake names the printers a device took over, and the devices read says which device can take one over (Phase 3 Session 3B, B1)"
```

---

### Task B2: the page's half of Phase 3's wire: `lanFailover`, `tokenSlips` and the printers' settled health on the wake; tokens on every ack and the pulse; "unreachable" on a network printer's refusal; the app's paper, cover and error

**Files:**
- Modify: `apps/cafe/hooks/use-print-agent-wake.ts` (the wake body; `takenOver` kept), `apps/cafe/hooks/use-print-agent.ts` (the ack's `tokenSlips`; `networkPrinter`; the health source)
- Modify: `apps/cafe/lib/print-agent.ts` (one line), `lib/print-agent-slip.ts` (`failedAckBody(…, network)`), `lib/print-agent-types.ts`, `lib/print-agent-seams.ts` (the pulse's `&tokens=1`; the health and taken-over seams), `lib/print-agent-printers.ts` (`AgentPrinters.lanIds`)
- Create: `apps/cafe/lib/print-agent-health.ts` (`settledLinkOf`, `printerHealthReportsOf`)
- Modify: `apps/cafe/lib/printer/native-bridge-v2.ts` (the v2 list's `paper`, `cover`, `error`; the contract), `lib/printer/native-pool.ts` (`PoolPrinter.paper`/`cover`/`error`)
- Tests: `apps/cafe/lib/print-agent-health.test.ts` (create; `apps/cafe/package.json` `testChain` gains it as its own entry), `lib/print-agent.test.ts` (a test new; the pulse assert changed), `lib/printer/native-pool.test.ts` (a test new), `lib/print-agent-paths.test.ts` (a pin new), `lib/print-agent-printers.test.ts` (four deepEquals gain `lanIds`)

**Interfaces produced:** `failedAckBody(deviceId, epoch, outcome, network = false)`; `PrintAgentDeps.networkPrinter?(job)`; `setPrinterHealthSource`, `printerHealthReports`, `setTakenOverPrinters`, `takenOverPrinterIds`, `onTakenOverChange` (`lib/print-agent-seams.ts`); `settledLinkOf`, `printerHealthReportsOf` (`lib/print-agent-health.ts`); `AgentPrinters.lanIds`; `PoolPrinter.paper?/cover?/error?`.

**The wake** (`wakeBody`, its call unchanged): `capabilities.lanFailover` is true only on the POS app with bridge v2 (`caps.native && nativeV2Bridge() !== null`; the Windows app says it from 1.12.0, Session 3E; a Chrome tab never); `tokenSlips: true`; and `printers`, the health of the printers it prints here, when there is any. The answer's `takenOver` is kept for the dot (B3), cleared when the poll stops.

**The health** (`lib/print-agent-health.ts`): each of the POS app's printers by its own state, with the paper, cover and error the app says (Session 3C's DLE EOT; absent before it); on every other device its one printer by the device printer's state; the Windows app nothing until 1.12.0. **The settled link (the 3A review gate, m-5):** connected and disconnected settle; a printer still connecting (the app's probe of a down printer) keeps the last settled link, so a dead printer's words never flicker, its health is never re-written for a probe, and B1's skip never starts or ends on a probe; with none settled it says nothing. The server keeps only its writer's report, so a report for a printer this device may take over but does not write costs nothing.

**"Unreachable"** (spec §9.3, P3-3): a network printer this device prints (`lanIds`) whose print was refused before any byte because it did not answer (`PRINTER_NOT_CONNECTED_MESSAGE`, after the write queue's one reconnect) is acked `reason: "unreachable"`. Never a busy printer, Bluetooth off, a printer that is not this device's, a permanent refusal or anything that may be on paper.

**Tokens (the token fix's M-2, A0's contract):** every ack says `tokenSlips: true` (at send time, so a kept ack re-sent after a reload says it too), and the pulse's query gains `&tokens=1`.

**Bridge v2's list** may now carry `paper`, `cover` and `error` per printer (the contract's header says so). The page keeps them (`PoolPrinter`), and a change of them is a change (the pool's key), so the dot and the beat see it. An app that says nothing (2F2's) changes nothing. The parity pin (`native-bridge-v2-parity.test.ts`) is unchanged: it pins the keys both halves already share; Session 3C adds the app half.

**Changed existing tests:** `print-agent.test.ts` (the pulse query now ends `&tokens=1`), `print-agent-printers.test.ts` (four `agentPrintersOf` deepEquals gain `lanIds`).

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-agent-health.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterLinkState } from "@pos/shared/print-failover";
import { printerHealthReportsOf, settledLinkOf } from "@/lib/print-agent-health";
import type { PoolPrinter } from "@/lib/printer/native-pool";

// Phase 3 Session 3B (spec §10, P3-6): the health this page reports on its wake, for the printers it prints here. The
// server keeps a report only from the device that writes the printer now, and only when it changed.

const TCP = { kind: "native" as const, transport: "tcp" as const, printerId: "tcp:10.0.2.2:9100", name: "Network printer 10.0.2.2", paper: "80mm" as const };

function poolPrinter(id: string, status: PoolPrinter["status"], over: Partial<PoolPrinter> = {}): PoolPrinter {
  return { id, printer: { ...TCP, printerId: id }, status, message: null, ...over };
}

test("settledLinkOf: connected and disconnected settle; a probe in between keeps the last settled link; nothing settled says nothing (the 3A gate, m-5)", () => {
  const memory = new Map<string, PrinterLinkState>();
  assert.equal(settledLinkOf(memory, "a", "connecting"), null, "nothing settled yet");
  assert.equal(settledLinkOf(memory, "a", "disconnected"), "disconnected");
  assert.equal(settledLinkOf(memory, "a", "connecting"), "disconnected", "the app's 30 s probe of a down printer never flickers it");
  assert.equal(settledLinkOf(memory, "a", "connected"), "connected");
  assert.equal(settledLinkOf(memory, "a", "needs-tap"), "disconnected", "a Bluetooth printer waiting for a tap cannot print");
  assert.equal(settledLinkOf(memory, "b", "elsewhere"), null, "another tab owns it: this tab says nothing");
  assert.equal(settledLinkOf(memory, "b", "none"), null);
});

test("printerHealthReportsOf: each of the app's printers by its own state and status; the device's one printer; nothing from the Windows spooler", () => {
  const memory = new Map<string, PrinterLinkState>();
  const pool = [
    poolPrinter("tcp:10.0.2.2:9100", "connected", { paper: "out" }),
    poolPrinter("tcp:10.0.2.2:9101", "disconnected", { cover: "open", error: true }),
    poolPrinter("tcp:10.0.2.2:9102", "connecting"),
  ];
  const targets = {
    "p-kitchen": { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" as const },
    "p-bar": { nativeId: "tcp:10.0.2.2:9101", paper: "80mm" as const },
    "p-new": { nativeId: "tcp:10.0.2.2:9102", paper: "80mm" as const },
    "p-gone": { nativeId: "tcp:10.0.2.2:9199", paper: "80mm" as const },
  };
  assert.deepEqual(
    printerHealthReportsOf({ localIds: ["p-kitchen", "p-bar", "p-new", "p-gone"], targets, pool, device: "none", windows: false }, memory),
    [
      { printerId: "p-kitchen", link: "connected", paper: "out" },
      { printerId: "p-bar", link: "disconnected", cover: "open", error: true },
    ],
    "a printer still connecting, or one the app does not list, says nothing",
  );
  assert.deepEqual(printerHealthReportsOf({ localIds: ["p-own"], targets: {}, pool: null, device: "connected", windows: false }, memory), [{ printerId: "p-own", link: "connected" }], "the release APK or a browser: its one printer");
  assert.deepEqual(printerHealthReportsOf({ localIds: ["p-win"], targets: { "p-win": { printerName: "EPSON", paper: "80mm" } }, pool: null, device: "connected", windows: true }, memory), [], "the Windows app reports nothing until 1.12.0 (Session 3E)");
});
```

In `apps/cafe/lib/print-agent-paths.test.ts`, find:

```ts
  assert.ok(banner.includes('printColorAdjust: "exact"'), "a browser print keeps the black");
});
```

Replace it with:

```ts
  assert.ok(banner.includes('printColorAdjust: "exact"'), "a browser print keeps the black");
});

// Session 3B (spec §9.3, §10; the token fix's M-2): the page's half of Phase 3's wire. Its wake says it can take a
// network printer over (bridge v2), that it prints token slips, and the health of the printers it prints here; its acks
// and its pulse say tokens; a network printer it cannot reach is acked "unreachable"; the printers the wake says it took
// over are kept for its top-bar dot.
test("PIN (3B): the wake says lanFailover on bridge v2, tokenSlips and the printers' health; the ack and the pulse say tokens; the agent knows its network printers", () => {
  const wake = src("apps/cafe/hooks/use-print-agent-wake.ts");
  assert.ok(wake.includes("lanFailover: caps.native && nativeV2Bridge() !== null,"), "only the POS app on bridge v2 takes a network printer over (the Windows app from 1.12.0, Session 3E)");
  assert.ok(wake.includes("tokenSlips: true,"), "the wake says this page prints token slips");
  assert.ok(wake.includes("...(health.length > 0 ? { printers: health } : {}),"), "the health of the printers it prints here rides the beat");
  assert.ok(wake.includes("setTakenOverPrinters(data.takenOver ?? []);"), "the printers it took over, kept for its dot");
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes('ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", { ...body, tokenSlips: true }),'), "every ack says tokens");
  assert.ok(agent.includes("networkPrinter: (job) => job.printerId !== undefined && lanRef.current.includes(job.printerId),"), "a network printer it prints here");
  assert.ok(agent.includes("setPrinterHealthSource(() =>"), "the beat reads its printers' health from the agent's own lists");
  assert.ok(src("apps/cafe/lib/print-agent-seams.ts").includes("`?device=${encodeURIComponent(pulseDevice)}&${PRINT_PULSE_TOKENS_PARAM}=${PRINT_HEADER_ON}`"), "the pulse says tokens");
  assert.ok(src("apps/cafe/lib/print-agent.ts").includes("const body = failedAckBody(deps.deviceId, job.epoch, outcome, deps.networkPrinter?.(job) === true);"), "the agent's refusal says unreachable for a network printer");
});
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, localIds: ["counter"], targets: {} }, "it writes the counter and the bar; only the counter is its printer");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], targets: {} }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, null), { printersMode: false, isWriter: false, localIds: [], targets: {} }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], targets: {} }, "no device identity");
});

// Phase 2 Session 2E (spec §9.2): one Windows PC prints several printers, each by its own Windows name. An older app
```

Replace it with:

```ts
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, localIds: ["counter"], lanIds: ["counter"], targets: {} }, "it writes the counter and the bar; only the counter is its printer (a network printer: Session 3B's lanIds)");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], targets: {} }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, null), { printersMode: false, isWriter: false, localIds: [], lanIds: [], targets: {} }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], targets: {} }, "no device identity");
});

// Phase 2 Session 2E (spec §9.2): one Windows PC prints several printers, each by its own Windows name. An older app
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
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
```

Replace it with:

```ts
  assert.equal(timed.w.leaseCalls, 2, "another line's backoff ends: it is leased then, with no poll");
  second.stop();
});

test("2C: the ready printers ride the direct-print header; the pulse names the device (3B: and says tokens); a slip routed to several printers is followed by its leased ref", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printAgentHeaders("dev-a", false, "tab-1", [a, b]), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-lease": "tab-1", "x-pos-print-ready": `${a},${b}` });
  assert.equal(printAgentHeaders("dev-a", false, null, [a])["x-pos-print-ready"], undefined, "no draining tab ready: no ready printers either");
  assert.equal(printAgentHeaders("dev-a", false, "tab-1", [])["x-pos-print-ready"], undefined, "simple mode: none");
  setPulsePrintDevice("dev-a");
  const off = setReadyPrintersSource(() => [a]);
  assert.equal(printAgentHeaders("dev-a", false, "tab-1")["x-pos-print-ready"], a, "the default reads the ready seam");
  // Session 3B (the token fence's half, deliberate change): the pulse also says this page prints token slips.
  assert.equal(pulsePrintDeviceQuery(), "?device=dev-a&tokens=1", "the pulse counts every job aimed at the device (the 2C gate's review, I-2): it names the device, and says it prints tokens");
  off();
  setPulsePrintDevice(null);
  assert.equal(pulsePrintDeviceQuery(), "");
  const leased = { id: "k3", epoch: 1 } as never;
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  assert.deepEqual(asked.slice(1), [["p-kitchen"]], "a kitchen slip's kick leases the kitchen line");
  agent.stop();
});
```

Replace it with:

```ts
  assert.deepEqual(asked.slice(1), [["p-kitchen"]], "a kitchen slip's kick leases the kitchen line");
  agent.stop();
});

// Session 3B (spec §9.3, P3-3): a network printer this device could not reach before any byte (not connected) is acked
// "unreachable", so the server skips this device for it and another device takes it over. Anything else is acked as
// before: a device printer, a refusal that may have printed, the printer busy, a slip that cannot print.
test("3B: a network printer refused before any byte acks 'unreachable'; a device printer, a busy printer or a 'maybe' never does", async () => {
  const { w, deps } = printersWorld(["p-kitchen", "p-bar"], (j) => j.printerId ?? PRINT_DEVICE_LINE);
  const agent = createPrintAgent({ ...deps, networkPrinter: (j: LeasedPrintJob) => j.printerId === "p-kitchen" });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  const queued = { applied: true, status: "queued" as const, nextAttemptAt: new Date(T0 + 2_000).toISOString() };
  w.results.push(
    { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) },
    { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) },
    { ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) },
  );
  w.ackAnswers.push(queued, queued, queued);
  agent.take({ ...job("k1"), printerId: "p-kitchen" });
  await settle();
  agent.take({ ...job("b1"), printerId: "p-bar" });
  await settle();
  agent.take({ ...job("k2"), printerId: "p-kitchen" });
  await settle();
  assert.deepEqual(
    w.acks.map((a) => [a.id, a.body.sent, a.body.reason ?? null]),
    [
      ["k1", "no", "unreachable"],
      ["b1", "no", null],
      ["k2", "maybe", null],
    ],
    "only the network printer's 'not connected' says unreachable",
  );
  agent.stop();
  assert.equal(failedAckBody("d", 1, { sent: "no", permanent: false, message: PRINTER_NOT_CONNECTED_MESSAGE }, true).reason, "unreachable");
  assert.equal(failedAckBody("d", 1, { sent: "no", permanent: true, message: PRINTER_NOT_CONNECTED_MESSAGE }, true).reason, undefined, "a permanent refusal is never 'unreachable'");
  assert.equal(failedAckBody("d", 1, { sent: "maybe", permanent: false, message: PRINTER_NOT_CONNECTED_MESSAGE }, true).reason, undefined, "nor anything that may be on paper");
  assert.equal(failedAckBody("d", 1, { sent: "no", permanent: false, message: PRINTER_NOT_LOCAL_MESSAGE }, true).reason, undefined, "nor a printer that is not this device's");
});
```

In `apps/cafe/lib/printer/native-pool.test.ts`, find:

```ts
  }
});
```

Replace it with:

```ts
  }
});

test("3B: the app's v2 list may say each printer's paper, cover and error (Session 3C's app); the page keeps them, and a change of them is a change", () => {
  const plain = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN }], defaultId: KITCHEN.id, bluetooth: "on" });
  assert.equal(plain.printers[0]?.paper, undefined, "an app that says nothing (2F2's): nothing");
  const out = poolSnapshotOf({ printers: [{ state: "connected", printer: KITCHEN, paper: "out", cover: "open", error: true }], defaultId: KITCHEN.id, bluetooth: "on" } as NativePoolStatus);
  assert.deepEqual([out.printers[0]?.paper, out.printers[0]?.cover, out.printers[0]?.error], ["out", "open", true]);
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-health.test.ts",
    "lib/print-waiting.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
```

Replace it with:

```json
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-health.test.ts",
    "lib/print-agent-health.test.ts",
    "lib/print-waiting.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts lib/print-agent-health.test.ts lib/printer/native-pool.test.ts lib/print-agent-paths.test.ts lib/print-agent-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 106`; `# pass 100`; `# fail 6`

- [ ] **Step 3: The code**

In `apps/cafe/hooks/use-print-agent-wake.ts`, find:

```ts
import type { PrintAgent } from "@/lib/print-agent";
import { jobsForMeLeasable, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { NATIVE_BRIDGE_V2, nativeV2Bridge } from "@/lib/printer/native-bridge-v2";
import { bumpPrintWakeBudget, mergePrintWakeBudget, readPrintWakeBudget, writePrintWakeBudget, type PrintWakeBudget } from "@/lib/print-wake-budget";
import { currentLane, defaultDeviceLabel, printCapabilities } from "@/lib/printer/print-lane";
```

Replace it with:

```ts
import type { PrintAgent } from "@/lib/print-agent";
import { jobsForMeLeasable, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { printerHealthReports, setTakenOverPrinters } from "@/lib/print-agent-seams";
import { NATIVE_BRIDGE_V2, nativeV2Bridge } from "@/lib/printer/native-bridge-v2";
import { bumpPrintWakeBudget, mergePrintWakeBudget, readPrintWakeBudget, writePrintWakeBudget, type PrintWakeBudget } from "@/lib/print-wake-budget";
import { currentLane, defaultDeviceLabel, printCapabilities } from "@/lib/printer/print-lane";
```

In `apps/cafe/hooks/use-print-agent-wake.ts`, find:

```ts
const WAKE_URL = "/api/print-jobs/wake";

/** The heartbeat the host's wake carries (spec §10). Session 2F1: the POS app's bridge version (2: it prints several
 *  printers), so the setup knows which tablet prints one printer. */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
  const desktop = isDesktopShell();
  return {
    deviceId,
    label: defaultDeviceLabel(currentLane()),
```

Replace it with:

```ts
const WAKE_URL = "/api/print-jobs/wake";

/** The heartbeat the host's wake carries (spec §10). Session 2F1: the POS app's bridge version (2: it prints several
 *  printers), so the setup knows which tablet prints one printer. Session 3B: whether it can take a network printer
 *  over, that it prints token slips, and the health of the printers it prints here. */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
  const desktop = isDesktopShell();
  const health = printerHealthReports();
  return {
    deviceId,
    label: defaultDeviceLabel(currentLane()),
```

In `apps/cafe/hooks/use-print-agent-wake.ts`, find:

```ts
      windowsPrinters: desktop,
      webSerial: caps.serial,
      webBluetooth: caps.bluetooth,
    },
  };
}
```

Replace it with:

```ts
      windowsPrinters: desktop,
      webSerial: caps.serial,
      webBluetooth: caps.bluetooth,
      // Session 3B (spec §9.3): it can write any network printer the setup names: the POS app on bridge v2 (the Windows app
      // from 1.12.0, Session 3E). A page that cannot never takes a printer over.
      lanFailover: caps.native && nativeV2Bridge() !== null,
    },
    // Session 3B (the token fix's M-2): this page prints token slips, so the wake's count includes them.
    tokenSlips: true,
    // Session 3B (spec §10): kept by the server only from the device that writes each printer now, and only on a change.
    ...(health.length > 0 ? { printers: health } : {}),
  };
}
```

In `apps/cafe/hooks/use-print-agent-wake.ts`, find:

```ts
        const data = await apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId));
        capRef.current = Math.min(PRINT_WAKE_DAILY_CAP, data.agentDailyCap);
        noteJobsForMe(data.jobsForMe, data.writesPrinters);
        return data;
      },
      socketHealthy: isRealtimeHealthy,
```

Replace it with:

```ts
        const data = await apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId));
        capRef.current = Math.min(PRINT_WAKE_DAILY_CAP, data.agentDailyCap);
        noteJobsForMe(data.jobsForMe, data.writesPrinters);
        setTakenOverPrinters(data.takenOver ?? []);
        return data;
      },
      socketHealthy: isRealtimeHealthy,
```

In `apps/cafe/hooks/use-print-agent-wake.ts`, find:

```ts
      clearTimer: (handle: unknown): void => window.clearTimeout(handle as number),
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, pollsWake, deviceId, noteJobsForMe]);
}
```

Replace it with:

```ts
      clearTimer: (handle: unknown): void => window.clearTimeout(handle as number),
    });
    wake.start();
    return () => {
      wake.stop();
      setTakenOverPrinters([]);
    };
  }, [agent, enabled, pollsWake, deviceId, noteJobsForMe]);
}
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
```

Replace it with:

```ts
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import type { PrinterLinkState } from "@pos/shared/print-failover";
import { printerHealthReportsOf } from "@/lib/print-agent-health";
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
```

Replace it with:

```ts
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  setPrinterHealthSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
import { PrintWriteError } from "@/lib/print-write-outcome";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import { desktopPrinterSnapshot, refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { nativeBridge, nativeOn } from "@/lib/printer/native-bridge";
import { connectedPoolKey } from "@/lib/printer/native-pool";
import { printerStatusOf, printersState } from "@/lib/printer/printer-registry";
import { canPrintNow } from "@/lib/printer/print-lane";
import { subscribeRealtime } from "@/lib/realtime-client";
```

Replace it with:

```ts
import { PrintWriteError } from "@/lib/print-write-outcome";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import { desktopPrinterSnapshot, refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { devicePrinter } from "@/lib/printer/device-printer";
import { nativeBridge, nativeOn } from "@/lib/printer/native-bridge";
import { connectedPoolKey, nativePool } from "@/lib/printer/native-pool";
import { printerStatusOf, printersState } from "@/lib/printer/printer-registry";
import { canPrintNow } from "@/lib/printer/print-lane";
import { subscribeRealtime } from "@/lib/realtime-client";
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  useEffect(() => {
    readyRef.current = readyKey === "" ? [] : readyKey.split(",");
  }, [readyKey]);
  const writerRef = useRef(printers.isWriter);
  useEffect(() => {
    writerRef.current = printers.isWriter;
```

Replace it with:

```ts
  useEffect(() => {
    readyRef.current = readyKey === "" ? [] : readyKey.split(",");
  }, [readyKey]);
  // Session 3B (spec §9.3): the network printers among them (a refusal before any byte is acked "unreachable").
  const lanRef = useRef<readonly string[]>(printers.lanIds);
  const lanKey = printers.lanIds.join(",");
  useEffect(() => {
    lanRef.current = lanKey === "" ? [] : lanKey.split(",");
  }, [lanKey]);
  const writerRef = useRef(printers.isWriter);
  useEffect(() => {
    writerRef.current = printers.isWriter;
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
      deviceId,
      // tokenSlips: this page prints "token" jobs (S7); a page from before S7 leases none, on any line (print-lease.ts).
      lease: (printerIds) => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, tokenSlips: true, ...printerIdsBody(printerIds) }),
      ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", body),
      print,
      printerReady: () => canPrintNow() || readyNow().length > 0,
      // Session 2E: the Windows app's printer list read again (a printer added or removed) releases a refusal's hold;
```

Replace it with:

```ts
      deviceId,
      // tokenSlips: this page prints "token" jobs (S7); a page from before S7 leases none, on any line (print-lease.ts).
      lease: (printerIds) => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, tokenSlips: true, ...printerIdsBody(printerIds) }),
      // Session 3B (the token fix's M-2): every ack says this page prints token slips, so its `more` counts them.
      ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", { ...body, tokenSlips: true }),
      print,
      printerReady: () => canPrintNow() || readyNow().length > 0,
      // Session 2E: the Windows app's printer list read again (a printer added or removed) releases a refusal's hold;
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
      // or not this device still prints it (one that left the app's list between the request and the print), never the
      // device line, which would pause every other printer. A job with no printer (simple mode) holds the device line.
      lineOf: (job) => job.printerId ?? PRINT_DEVICE_LINE,
      readPending: readPendingAcks,
      writePending: writePendingAcks,
      ...timers(),
```

Replace it with:

```ts
      // or not this device still prints it (one that left the app's list between the request and the print), never the
      // device line, which would pause every other printer. A job with no printer (simple mode) holds the device line.
      lineOf: (job) => job.printerId ?? PRINT_DEVICE_LINE,
      networkPrinter: (job) => job.printerId !== undefined && lanRef.current.includes(job.printerId),
      readPending: readPendingAcks,
      writePending: writePendingAcks,
      ...timers(),
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  }, [agent, readyKey]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick((printerId) => agent.kick(printerId))), [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
  // that make slips name it (directPrintTab → x-pos-print-lease), and a job an answer carries already leased
```

Replace it with:

```ts
  }, [agent, readyKey]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick((printerId) => agent.kick(printerId))), [agent]);

  // Session 3B (spec §10): the health of the printers it prints here rides the wake's beat (hooks/use-print-agent-wake.ts):
  // each of the POS app's printers by its own settled state, any other by this device's printer.
  useEffect(() => {
    if (agent === null) return;
    const memory = new Map<string, PrinterLinkState>();
    return setPrinterHealthSource(() => {
      const pool = nativePool().getSnapshot();
      return printerHealthReportsOf(
        { localIds: readyRef.current, targets: targetsRef.current, pool: pool.active ? pool.printers : null, device: devicePrinter().getSnapshot().status, windows: isDesktopShell() },
        memory,
      );
    });
  }, [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
  // that make slips name it (directPrintTab → x-pos-print-lease), and a job an answer carries already leased
```

Create `apps/cafe/lib/print-agent-health.ts`:

```ts
import type { PrinterHealthReport, PrinterLinkState } from "@pos/shared/print-failover";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
import type { PoolPrinter } from "@/lib/printer/native-pool";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 3 Session 3B (spec §10, P3-6): the health this page reports on its wake (the heartbeat; no
// request of its own) for the printers it prints here. The server keeps a report only from the device that writes that
// printer now, and only when it changed (lib/print-health.ts); a writer's "disconnected" for a network printer also skips
// it there, and its "connected" ends that skip (lib/print-failover.ts). Pure and client-safe.

/** The link a printer settled on. A printer still connecting (the POS app's probe of a down network printer, every 30 s)
 *  keeps the last settled link, so a dead printer's words never flicker and its health is never re-written for a probe
 *  (the 3A review gate, m-5); with none settled yet it says nothing. A printer another tab owns, or none, says nothing. */
export function settledLinkOf(memory: Map<string, PrinterLinkState>, key: string, status: PrinterStatus): PrinterLinkState | null {
  if (status === "connected" || status === "disconnected" || status === "needs-tap") {
    const link: PrinterLinkState = status === "connected" ? "connected" : "disconnected";
    memory.set(key, link);
    return link;
  }
  return status === "connecting" ? (memory.get(key) ?? null) : null;
}

/** One report per printer this device prints here: one of the POS app's printers (bridge v2) by its own state, with the
 *  paper, cover and error the app says (Session 3C's DLE EOT; absent before it); on every other device its one printer
 *  by the device printer's state. The Windows app reports nothing until it can tell (1.12.0, Session 3E). */
export function printerHealthReportsOf(
  input: {
    localIds: readonly string[];
    targets: Readonly<Record<string, SlipPrintTarget>>;
    pool: readonly PoolPrinter[] | null;
    device: PrinterStatus;
    windows: boolean;
  },
  memory: Map<string, PrinterLinkState>,
): PrinterHealthReport[] {
  const out: PrinterHealthReport[] = [];
  for (const printerId of input.localIds) {
    const target = input.targets[printerId];
    if (target?.nativeId !== undefined) {
      const entry = input.pool?.find((printer) => printer.id === target.nativeId);
      const link = entry === undefined ? null : settledLinkOf(memory, entry.id, entry.status);
      if (entry === undefined || link === null) continue;
      out.push({
        printerId,
        link,
        ...(entry.paper !== undefined ? { paper: entry.paper } : {}),
        ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
        ...(entry.error === true ? { error: true as const } : {}),
      });
    } else if (target === undefined && !input.windows) {
      const link = settledLinkOf(memory, `device:${printerId}`, input.device);
      if (link !== null) out.push({ printerId, link });
    }
  }
  return out;
}
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
  isWriter: boolean;
  /** The routable printers this device writes that ARE its local printers: the lines it leases and prints. */
  localIds: string[];
  /** Session 2E: each of them that prints on a named Windows printer, by id: its name and its paper. Session 2F1: each
   *  that is one of the POS app's printers on bridge v2: the app's id and its paper. */
  targets: Record<string, SlipPrintTarget>;
```

Replace it with:

```ts
  isWriter: boolean;
  /** The routable printers this device writes that ARE its local printers: the lines it leases and prints. */
  localIds: string[];
  /** Session 3B (spec §9.3): those of them that are network printers (a refusal before any byte is "unreachable"). */
  lanIds: string[];
  /** Session 2E: each of them that prints on a named Windows printer, by id: its name and its paper. Session 2F1: each
   *  that is one of the POS app's printers on bridge v2: the app's id and its paper. */
  targets: Record<string, SlipPrintTarget>;
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: here.map((printer) => printer.id),
    targets: targetsOf(here, desktop, pool),
  };
}
```

Replace it with:

```ts
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: here.map((printer) => printer.id),
    lanIds: here.filter((printer) => printer.connection.kind === "lan").map((printer) => printer.id),
    targets: targetsOf(here, desktop, pool),
  };
}
```

In `apps/cafe/lib/print-agent-seams.ts`, find:

```ts
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";

// Printing redesign: the in-page print agent's module seams (client-only, never throw). The call sites and the
// pulse reach this page's one agent through them, with no React context: an order answer that named a job (a
```

Replace it with:

```ts
import { PRINT_HEADER_ON, PRINT_PULSE_TOKENS_PARAM, type LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { PrinterHealthReport } from "@pos/shared/print-failover";

// Printing redesign: the in-page print agent's module seams (client-only, never throw). The call sites and the
// pulse reach this page's one agent through them, with no React context: an order answer that named a job (a
```

In `apps/cafe/lib/print-agent-seams.ts`, find:

```ts
  pulseDevice = deviceId;
}

export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}`;
}

let readySource: (() => readonly string[]) | null = null;
```

Replace it with:

```ts
  pulseDevice = deviceId;
}

/** Session 3B (the token fix's M-2): the agent also says it prints token slips (&tokens=1), so the pulse counts them. */
export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}&${PRINT_PULSE_TOKENS_PARAM}=${PRINT_HEADER_ON}`;
}

let healthSource: (() => PrinterHealthReport[]) | null = null;

/** Session 3B (spec §10): the agent registers how it reads the health of the printers it prints here, for the wake's
 *  beat. The returned function unregisters it, unless another agent registered since. */
export function setPrinterHealthSource(source: () => PrinterHealthReport[]): () => void {
  healthSource = source;
  return () => {
    if (healthSource === source) healthSource = null;
  };
}

/** The health the wake's beat carries; [] with no agent. */
export function printerHealthReports(): PrinterHealthReport[] {
  try {
    return healthSource?.() ?? [];
  } catch {
    return [];
  }
}

let takenOver: readonly string[] = [];
const takenOverListeners = new Set<() => void>();

/** Session 3B (spec §9.3): the network printers the wake says this device writes now for another device (taken over while
 *  their primary is offline or cannot reach them), so its top-bar dot counts them while it writes them. */
export function setTakenOverPrinters(ids: readonly string[]): void {
  if (ids.join(",") === takenOver.join(",")) return;
  takenOver = [...ids];
  for (const listener of [...takenOverListeners]) listener();
}

export function takenOverPrinterIds(): readonly string[] {
  return takenOver;
}

export function onTakenOverChange(listener: () => void): () => void {
  takenOverListeners.add(listener);
  return () => void takenOverListeners.delete(listener);
}

let readySource: (() => readonly string[]) | null = null;
```

In `apps/cafe/lib/print-agent-slip.ts`, find:

```ts
import { PRINT_ACK_ERROR_MAX_CHARS, printBannerText } from "@pos/shared/print-lifecycle";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_EOD_READY_TIMEOUT_MS, hostPrintSlipOf, type HostPrintSlip, type SlipPrintTarget } from "@/lib/print-host-slips";
import type { PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §7.5, §7.7): what the in-page agent prints for one leased job,
// and what it reports when that fails. Split out of print-agent.ts at the 2A review gate to keep that file
```

Replace it with:

```ts
import { PRINT_ACK_ERROR_MAX_CHARS, printBannerText } from "@pos/shared/print-lifecycle";
import { PRINT_ACK_UNREACHABLE, type LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_EOD_READY_TIMEOUT_MS, hostPrintSlipOf, type HostPrintSlip, type SlipPrintTarget } from "@/lib/print-host-slips";
import type { PrintWriteOutcome } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 1 Session 1C (spec §7.5, §7.7): what the in-page agent prints for one leased job,
// and what it reports when that fails. Split out of print-agent.ts at the 2A review gate to keep that file
```

In `apps/cafe/lib/print-agent-slip.ts`, find:

```ts
 *  slip may have printed, so it is acked "maybe". */
export const PRINT_AGENT_SLIP_DEADLINE_MS = PRINT_HOST_EOD_READY_TIMEOUT_MS + PRINT_HOST_DISPATCH_TIMEOUT_MS + 5_000;

export function failedAckBody(deviceId: string, epoch: number, outcome: PrintWriteOutcome): PrintAgentAckBody {
  const error = outcome.message.trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS).trim();
  return {
    deviceId,
    epoch,
```

Replace it with:

```ts
 *  slip may have printed, so it is acked "maybe". */
export const PRINT_AGENT_SLIP_DEADLINE_MS = PRINT_HOST_EOD_READY_TIMEOUT_MS + PRINT_HOST_DISPATCH_TIMEOUT_MS + 5_000;

/** Session 3B (spec §9.3, P3-3): `network` is true when the job's printer is a network printer this device prints. Its
 *  refusal made before any byte because the printer did not answer (not connected) says "unreachable", so the server
 *  skips this device for it and another device takes the printer over. Nothing that may be on paper, nothing permanent,
 *  and no other refusal (busy, Bluetooth off, not this device's printer) ever says it. */
export function failedAckBody(deviceId: string, epoch: number, outcome: PrintWriteOutcome, network = false): PrintAgentAckBody {
  const error = outcome.message.trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS).trim();
  const unreachable = network && outcome.sent === "no" && !outcome.permanent && outcome.message === PRINTER_NOT_CONNECTED_MESSAGE;
  return {
    deviceId,
    epoch,
```

In `apps/cafe/lib/print-agent-slip.ts`, find:

```ts
    sent: outcome.sent,
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}
```

Replace it with:

```ts
    sent: outcome.sent,
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
    ...(unreachable ? { reason: PRINT_ACK_UNREACHABLE } : {}),
  };
}
```

In `apps/cafe/lib/print-agent-types.ts`, find:

```ts
  sent?: "no" | "maybe";
  permanent?: true;
  error?: string;
}

export interface PendingPrintAck {
```

Replace it with:

```ts
  sent?: "no" | "maybe";
  permanent?: true;
  error?: string;
  /** Session 3B (spec §9.3): a network printer this device could not reach before any byte (PRINT_ACK_UNREACHABLE). */
  reason?: "unreachable";
}

export interface PendingPrintAck {
```

In `apps/cafe/lib/print-agent-types.ts`, find:

```ts
  /** Session 2E: the line a job's refusal holds: its printer, by id (the 2F1 review gate, M-1), else this device's own
   *  printer (""). */
  lineOf?(job: LeasedPrintJob): string;
  readPending(): PendingPrintAck[];
  writePending(entries: PendingPrintAck[]): void;
  now(): number;
```

Replace it with:

```ts
  /** Session 2E: the line a job's refusal holds: its printer, by id (the 2F1 review gate, M-1), else this device's own
   *  printer (""). */
  lineOf?(job: LeasedPrintJob): string;
  /** Session 3B (spec §9.3): the job's printer is a network printer this device prints (its refusal before any byte
   *  is acked "unreachable", so another device takes the printer over). Absent: none is. */
  networkPrinter?(job: LeasedPrintJob): boolean;
  readPending(): PendingPrintAck[];
  writePending(entries: PendingPrintAck[]): void;
  now(): number;
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
        // Nothing reached the printer: it is off or unreachable. No automatic attempt on it until it changes.
        holds.hold(lineOf(job));
      }
      const body = failedAckBody(deps.deviceId, job.epoch, outcome);
      const answer = await deps.ack(job.id, body).catch((error: unknown) => {
        // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
        if (!ackAnswered(error)) acks.keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
```

Replace it with:

```ts
        // Nothing reached the printer: it is off or unreachable. No automatic attempt on it until it changes.
        holds.hold(lineOf(job));
      }
      // Session 3B (spec §9.3): a network printer this device could not reach says so, so another device takes it over.
      const body = failedAckBody(deps.deviceId, job.epoch, outcome, deps.networkPrinter?.(job) === true);
      const answer = await deps.ack(job.id, body).catch((error: unknown) => {
        // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
        if (!ackAnswered(error)) acks.keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
```

In `apps/cafe/lib/printer/native-bridge-v2.ts`, find:

```ts
import { z } from "zod";

import {
  NATIVE_CONNECT_TIMEOUT_MS,
```

Replace it with:

```ts
import { z } from "zod";

import { PRINTER_COVER_STATES, PRINTER_PAPER_STATES } from "@pos/shared/print-failover";

import {
  NATIVE_CONNECT_TIMEOUT_MS,
```

In `apps/cafe/lib/printer/native-bridge-v2.ts`, find:

```ts
// (These are the 2E review gate's ruling F-R2 and its review's M-4 and re-check, and the 2F1 review gate's M-3 and
// its review's wording of the v1 status and BUSY; Session 2F2 implements them and pins them.)
//   · Every other method (app.info, printer.list, permissions, bluetooth, host.background, app.changeUrl) stays v1.

export const NATIVE_BRIDGE_V2 = 2;
```

Replace it with:

```ts
// (These are the 2E review gate's ruling F-R2 and its review's M-4 and re-check, and the 2F1 review gate's M-3 and
// its review's wording of the v1 status and BUSY; Session 2F2 implements them and pins them.)
//   · Every other method (app.info, printer.list, permissions, bluetooth, host.background, app.changeUrl) stays v1.
//   · Phase 3 (spec §10; the page from Session 3B, the app from Session 3C): each listed printer may also carry `paper`
//     ("ok" | "low" | "out"), `cover` ("closed" | "open") and `error` (true), from DLE EOT where the printer answers it.
//     Absent says nothing (an app before 3C, a BLE printer); the page reports them in its wake's beat, and its dot.

export const NATIVE_BRIDGE_V2 = 2;
```

In `apps/cafe/lib/printer/native-bridge-v2.ts`, find:

```ts
}

const poolSchema = z.object({
  printers: z.array(z.object({ state: z.enum(NATIVE_PRINTER_STATES), printer: nativePrinterSchema })),
  defaultId: z.string().nullable(),
  bluetooth: z.enum(NATIVE_BLUETOOTH_STATES),
});
```

Replace it with:

```ts
}

const poolSchema = z.object({
  printers: z.array(
    z.object({
      state: z.enum(NATIVE_PRINTER_STATES),
      printer: nativePrinterSchema,
      paper: z.enum(PRINTER_PAPER_STATES).optional(),
      cover: z.enum(PRINTER_COVER_STATES).optional(),
      error: z.boolean().optional(),
    }),
  ),
  defaultId: z.string().nullable(),
  bluetooth: z.enum(NATIVE_BLUETOOTH_STATES),
});
```

In `apps/cafe/lib/printer/native-pool.ts`, find:

```ts
import { onWindowEvent } from "@/lib/printer/capabilities";
import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer-link";
import { createWriteQueue } from "@/lib/printer/device-printer-write";
```

Replace it with:

```ts
import type { PrinterCoverState, PrinterPaperState } from "@pos/shared/print-failover";
import { onWindowEvent } from "@/lib/printer/capabilities";
import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer-link";
import { createWriteQueue } from "@/lib/printer/device-printer-write";
```

In `apps/cafe/lib/printer/native-pool.ts`, find:

```ts
  printer: NativeDevicePrinter;
  status: "connecting" | "connected" | "disconnected";
  message: string | null;
}

export interface NativePoolSnapshot {
```

Replace it with:

```ts
  printer: NativeDevicePrinter;
  status: "connecting" | "connected" | "disconnected";
  message: string | null;
  /** Session 3B (spec §10): what the app says of its paper, cover and error (DLE EOT, Session 3C); absent until then. */
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
}

export interface NativePoolSnapshot {
```

In `apps/cafe/lib/printer/native-pool.ts`, find:

```ts
}

function poolKey(snapshot: NativePoolSnapshot): string {
  return JSON.stringify([snapshot.active, snapshot.defaultId, snapshot.printers.map((p) => [p.id, p.printer.name, p.printer.transport, p.status, p.message])]);
}

/** The 2F1 review gate (N-1): what the print agent can print on now, the app's connected printers in its order. A down
```

Replace it with:

```ts
}

function poolKey(snapshot: NativePoolSnapshot): string {
  return JSON.stringify([snapshot.active, snapshot.defaultId, snapshot.printers.map((p) => [p.id, p.printer.name, p.printer.transport, p.status, p.message, p.paper, p.cover, p.error])]);
}

/** The 2F1 review gate (N-1): what the print agent can print on now, the app's connected printers in its order. A down
```

In `apps/cafe/lib/printer/native-pool.ts`, find:

```ts
    const view = nativeStatusToSnapshot({ state: entry.state, printer: entry.printer, bluetooth: status.bluetooth }, null);
    if (view.printer === null || view.printer.kind !== "native" || printers.some((p) => p.id === entry.printer.id)) continue;
    const state = view.status === "connecting" || view.status === "connected" ? view.status : "disconnected";
    printers.push({ id: entry.printer.id, printer: view.printer, status: state, message: view.message });
  }
  const defaultId = status.defaultId !== null && printers.some((p) => p.id === status.defaultId) ? status.defaultId : null;
  return { active: true, printers, defaultId };
```

Replace it with:

```ts
    const view = nativeStatusToSnapshot({ state: entry.state, printer: entry.printer, bluetooth: status.bluetooth }, null);
    if (view.printer === null || view.printer.kind !== "native" || printers.some((p) => p.id === entry.printer.id)) continue;
    const state = view.status === "connecting" || view.status === "connected" ? view.status : "disconnected";
    printers.push({
      id: entry.printer.id,
      printer: view.printer,
      status: state,
      message: view.message,
      ...(entry.paper !== undefined ? { paper: entry.paper } : {}),
      ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
      ...(entry.error === true ? { error: true as const } : {}),
    });
  }
  const defaultId = status.defaultId !== null && printers.some((p) => p.id === status.defaultId) ? status.defaultId : null;
  return { active: true, printers, defaultId };
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts lib/print-agent-health.test.ts lib/printer/native-pool.test.ts lib/print-agent-paths.test.ts lib/print-agent-printers.test.ts lib/print-wake.test.ts lib/printer/native-bridge-v2-parity.test.ts lib/print-token-lanes-paths.test.ts lib/print-windows-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 155`; `# pass 155`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-agent-types.ts lib/print-agent-slip.ts lib/print-agent.ts lib/print-agent-seams.ts lib/print-agent-health.ts lib/print-agent-printers.ts lib/printer/native-bridge-v2.ts lib/printer/native-pool.ts hooks/use-print-agent.ts hooks/use-print-agent-wake.ts lib/print-agent.test.ts lib/print-agent-health.test.ts lib/printer/native-pool.test.ts lib/print-agent-paths.test.ts lib/print-agent-printers.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/hooks/use-print-agent-wake.ts apps/cafe/hooks/use-print-agent.ts apps/cafe/lib/print-agent-health.test.ts apps/cafe/lib/print-agent-health.ts apps/cafe/lib/print-agent-paths.test.ts apps/cafe/lib/print-agent-printers.test.ts apps/cafe/lib/print-agent-printers.ts apps/cafe/lib/print-agent-seams.ts apps/cafe/lib/print-agent-slip.ts apps/cafe/lib/print-agent-types.ts apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts apps/cafe/lib/printer/native-bridge-v2.ts apps/cafe/lib/printer/native-pool.test.ts apps/cafe/lib/printer/native-pool.ts apps/cafe/package.json
git commit -m "feat(print): the page's half of Phase 3's wire: the wake says it can take a network printer over (bridge v2), that it prints token slips, and the settled health of its printers; every ack and the pulse say tokens; a network printer it cannot reach is acked unreachable; the app's paper, cover and error are read (Phase 3 Session 3B, B2)"
```

---

### Task B3: a POS app on bridge v2 may take over every network printer another device writes: added to the app ahead of time, printed here once the app has it, named in a lease only while the app reaches it; the dot counts one only while the wake says it writes it; a removal waits while that printer is being written

**Files:**
- Modify: `apps/cafe/lib/print-agent-printers.ts` (`takeoverPrintersOf`, `PRINTER_TAKEOVER_MESSAGE`; `agentPrintersOf`'s `takeoverIds`; `dotPrintersOf(…, takenOver)`; `lanPrintersToAdd`; `lanPrintersToRemove(…, writing)`)
- Modify: `apps/cafe/lib/print-agent-seams.ts` (`markPrinterWriting`, `printersBeingWritten`, `onPrintersWritingChange`), `hooks/use-print-agent.ts` (the print marks its app printer), `hooks/use-agent-printers.ts` (the dot's `takenOver`; the removal waits), `components/print/OtherDevicePrinters.tsx` (the takeover words)
- Tests: `apps/cafe/lib/print-agent-printers.test.ts` (five tests new, one a pin; four tests' lines changed), `lib/printer-ui-paths.test.ts` (Other printers' budget 130)

**Interfaces produced:** `takeoverPrintersOf(printers, deviceId, pool): PrinterConfig[]`, `PRINTER_TAKEOVER_MESSAGE`, `AgentPrinters.takeoverIds`, `dotPrintersOf(…, takenOver = [])`, `lanPrintersToRemove(…, writing = [])` (`lib/print-agent-printers.ts`); `markPrinterWriting(nativeId, on)`, `printersBeingWritten(): string`, `onPrintersWritingChange(listener)` (`lib/print-agent-seams.ts`).

**Which printers (P3-1, P3-2).** On bridge v2 the page says `lanFailover`, so the server may give it any network printer of the setup while that printer's primary is offline or cannot reach it. Those printers (`takeoverPrintersOf`: routable, network, another device's by the setup) are this device's printers too once its POS app has them: in `localIds` (after its own), in `lanIds`, with their targets, listed in `takeoverIds`. They never make it a writer by the setup (`isWriter`).

**Only a writer takes printers over, and never seeds an empty app** (the gate's emulator pre-run, E-1, which its fresh review found too as I-1). Only a device that writes a printer by the setup polls the wake, so only it can be online for a takeover (P3-2); `takeoverPrintersOf` is empty for any other. Before this rule an ordering phone on the Phase 2 APK added every network printer to its app (its notification named them, its Other printers showed a takeover note that was false, its agent leased empty lines whenever a pooled printer connected), and on an app with no printer the first one became the app's default: the kitchen's printer became that phone's own printer (in simple mode it would print the phone's slips). Now `lanPrintersToAdd` adds the printers a device may take over only once its app lists a printer, its own network printer first (the app lists a printer when it is selected, so the order of the requests decides which becomes the default).

**Ahead of time, not on demand (the gate's ruling, against its reviewer's preference).** Each such printer is added to the app when the page sees it (`lanPrintersToAdd`, recorded in `pos.app-lan-added.v1` exactly as 2G's page-added printers, removed by 2G's rule once the setup stops naming it). So: its link is known before any takeover; the lease names it only while the app reaches it, which keeps Session 3A's I-1 premise and gives B1's beat a settled link to report from the first moment (a device that took a printer over and cannot reach it is skipped at its next beat); and a takeover prints at once, with no first connect. The cost: the app probes a down network printer every 30 s on the cafe's own network (no request, no Atlas operation), and each tablet's app lists every network printer (Other printers on this device says why it stays: `PRINTER_TAKEOVER_MESSAGE`, no Remove). On demand would add up to a wake interval of delay to the first slip and leave the device unable to say it cannot reach a printer until it had one.

**The planning review's M-8 (a)–(d).** (a) A taken-over printer is in the agent's lists, so `printerListLooksStale` and the wake's `writesPrinters` never re-read the printers for it. (b) A `lanFailover` device's lease names its connected candidate printers, so the server's who-is-online read runs on each of its leases: one small read, accepted in the plan; every other device's "only when" holds. (c) **The direct-print ready header names a candidate too** (ruled yes): the server makes a slip leased to the asking tab only when that tab's device writes the printer now (`askingTabOf`) and the printer's line is free, so a stale header never prints twice. (d) The per-printer link state is the app's own (`readyPrinterIdsOf`: an app printer is ready only while the app says connected).

**The pin (Session 3A's I-1):** a page names in its lease only a printer it can print to now, a candidate too: `deps.lease(holds.open(ready()))`, with `ready` the app printers the app says are connected. With cf4499e that is the signal that ends a skip. (This pin holds on arrival: it pins code that already behaves so.)

**The dot** counts a candidate printer only while the wake says this device writes it (`takenOver`, B1/B2), never otherwise, and `allLocal` counts the setup's printers only.

**A removal waits while that printer is being written** (the final Phase 2 gate, (a) item 4). The agent marks the app printer each job is written to (`markPrinterWriting`, by the app's id) for the length of the print; `lanPrintersToRemove` leaves a printer being written in the app (and in the record), and the hook runs again when the print is done (`useSyncExternalStore` on the marks).

**Changed existing tests (each a deliberate change):** "2F1: each printer of the app it prints carries its target" (another device's printer now at an address the app does not list); "2F1: the dot…" (`lanPrintersToAdd` adds the candidate too); "2F2 gate (M-4)" (as before for a device that writes nothing; for a writer, another device's network printer is one it may take over: kept, no Remove); "2F2 gate (m-3)" (moved to another device while this one writes another: kept; writes nothing else: removed as before; switched off: removed); the Remove pin, the removal pin, the dot pin and the print pin; Other printers' line budget 130 (was 120).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  lanPrintersToRemove,
  nativeIdOf,
  ownPrinterInSetup,
  printJobCopies,
  printerIsLocal,
  printerListLooksStale,
  readyPrinterIdsOf,
  type DesktopPrinters,
} from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
```

Replace it with:

```ts
  lanPrintersToRemove,
  nativeIdOf,
  ownPrinterInSetup,
  PRINTER_TAKEOVER_MESSAGE,
  printJobCopies,
  printerIsLocal,
  printerListLooksStale,
  readyPrinterIdsOf,
  takeoverPrintersOf,
  type DesktopPrinters,
} from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, localIds: ["counter"], lanIds: ["counter"], targets: {} }, "it writes the counter and the bar; only the counter is its printer (a network printer: Session 3B's lanIds)");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], targets: {} }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, null), { printersMode: false, isWriter: false, localIds: [], lanIds: [], targets: {} }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], targets: {} }, "no device identity");
});

// Phase 2 Session 2E (spec §9.2): one Windows PC prints several printers, each by its own Windows name. An older app
```

Replace it with:

```ts
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, null), { printersMode: true, isWriter: true, localIds: ["counter"], lanIds: ["counter"], takeoverIds: [], targets: {} }, "it writes the counter and the bar; only the counter is its printer (a network printer: Session 3B's lanIds)");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], takeoverIds: [], targets: {} }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, null), { printersMode: false, isWriter: false, localIds: [], lanIds: [], takeoverIds: [], targets: {} }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, null), { printersMode: true, isWriter: false, localIds: [], lanIds: [], takeoverIds: [], targets: {} }, "no device identity");
});

// Phase 2 Session 2E (spec §9.2): one Windows PC prints several printers, each by its own Windows name. An older app
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
test("2F1: each printer of the app it prints carries its target (the app's id, its own paper); a Windows printer's stays", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const bar = printer("bar", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-a", paper: 58 });
  const other = printer("other", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-b" });
  const agent = agentPrintersOf([kitchen, bar, other], "dev-a", NATIVE_TCP, null, POOL);
  assert.deepEqual(agent.localIds, ["bar", "kitchen"], "the printers it writes that the app has (in the setup's order)");
  assert.deepEqual(agent.targets, { kitchen: { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" }, bar: { nativeId: "tcp:10.0.2.2:9101", paper: "58mm" } }, "each at its own paper");
```

Replace it with:

```ts
test("2F1: each printer of the app it prints carries its target (the app's id, its own paper); a Windows printer's stays", () => {
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const bar = printer("bar", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-a", paper: 58 });
  // Session 3B (deliberate change): another device's printer at an address the app does not list; one the app lists is a
  // printer this device may take over (its own test below).
  const other = printer("other", { kind: "lan", host: "10.0.2.9", port: 9100 }, { primaryDeviceId: "dev-b" });
  const agent = agentPrintersOf([kitchen, bar, other], "dev-a", NATIVE_TCP, null, POOL);
  assert.deepEqual(agent.localIds, ["bar", "kitchen"], "the printers it writes that the app has (in the setup's order)");
  assert.deepEqual(agent.targets, { kitchen: { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" }, bar: { nativeId: "tcp:10.0.2.2:9101", paper: "58mm" } }, "each at its own paper");
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  const third = printer("third", { kind: "lan", host: "10.0.2.3", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.4", port: 9100 }, { primaryDeviceId: "dev-b" });
  const off = printer("off", { kind: "lan", host: "10.0.2.5", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(lanPrintersToAdd([kitchen, third, theirs, off], "dev-a", POOL), [{ host: "10.0.2.3", port: 9100 }], "only a routable network printer this device writes that the app lacks");
  assert.deepEqual(lanPrintersToAdd([third], "dev-a", null), [], "never on an app that speaks only v1");
});
```

Replace it with:

```ts
  const third = printer("third", { kind: "lan", host: "10.0.2.3", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.4", port: 9100 }, { primaryDeviceId: "dev-b" });
  const off = printer("off", { kind: "lan", host: "10.0.2.5", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  // Session 3B (deliberate change): also one another device writes, which this device may take over (added ahead of time).
  assert.deepEqual(lanPrintersToAdd([kitchen, third, theirs, off], "dev-a", POOL), [{ host: "10.0.2.3", port: 9100 }, { host: "10.0.2.4", port: 9100 }], "every routable network printer the app lacks: its own, then those it may take over; never one switched off");
  assert.deepEqual(lanPrintersToAdd([third], "dev-a", null), [], "never on an app that speaks only v1");
});
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), true, "v2: the app's default is a setup printer this device writes");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, "tcp:10.0.2.2:9101"), false, "v2: the default is another of the app's printers");
  assert.equal(ownPrinterInSetup([kitchen], "dev-b", null, POOL, "tcp:10.0.2.2:9100"), false, "another device writes it");
  assert.equal(ownPrinterInSetup([{ ...kitchen, enabled: false }], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), false, "a printer switched off prints nothing here");
  assert.equal(ownPrinterInSetup([], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), false, "simple mode: nothing in the setup");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, null), false, "v2: an app with no default");
```

Replace it with:

```ts
  const kitchen = printer("kitchen", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), true, "v2: the app's default is a setup printer this device writes");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, "tcp:10.0.2.2:9101"), false, "v2: the default is another of the app's printers");
  assert.equal(ownPrinterInSetup([kitchen], "dev-b", null, POOL, "tcp:10.0.2.2:9100"), false, "another device writes it (and this one writes nothing)");
  // Session 3B (deliberate change): on bridge v2, for a device that writes a printer too, another device's network printer
  // is one it may take over, so the page keeps it in the app (removing it would only see it added back).
  const barB = printer("bar-b", { kind: "device", deviceId: "dev-b", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.equal(ownPrinterInSetup([kitchen, barB], "dev-b", null, POOL, "tcp:10.0.2.2:9100"), true, "a writer that may take it over keeps it");
  assert.equal(ownPrinterInSetup([kitchen, barB], "dev-b", null, null, null), false, "on v1 another device's printer is never this device's");
  assert.equal(ownPrinterInSetup([{ ...kitchen, enabled: false }], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), false, "a printer switched off prints nothing here");
  assert.equal(ownPrinterInSetup([], "dev-a", null, POOL, "tcp:10.0.2.2:9100"), false, "simple mode: nothing in the setup");
  assert.equal(ownPrinterInSetup([kitchen], "dev-a", null, POOL, null), false, "v2: an app with no default");
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, "bt-classic:00:11:22:33:44:55", added), { remove: ["tcp:10.0.2.2:9101"], record: added }, "9101 no longer named: removed, still recorded while the app lists it");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, "tcp:10.0.2.2:9101", added), { remove: [], record: added }, "the app's default is never removed");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, null, ["tcp:10.0.2.2:9100"]), { remove: [], record: ["tcp:10.0.2.2:9100"] }, "9101 was added by staff (not recorded): kept");
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, primaryDeviceId: "dev-b" }], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, ["tcp:10.0.2.2:9100"], "moved to another device: removed (ids compared ignoring case)");
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, ["tcp:10.0.2.3:9100"]), { remove: [], record: [] }, "one the app no longer lists and the setup no longer names is forgotten");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", null, null, added), { remove: [], record: added }, "never on an app that speaks only v1");
});
```

Replace it with:

```ts
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, "bt-classic:00:11:22:33:44:55", added), { remove: ["tcp:10.0.2.2:9101"], record: added }, "9101 no longer named: removed, still recorded while the app lists it");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, "tcp:10.0.2.2:9101", added), { remove: [], record: added }, "the app's default is never removed");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", POOL, null, ["tcp:10.0.2.2:9100"]), { remove: [], record: ["tcp:10.0.2.2:9100"] }, "9101 was added by staff (not recorded): kept");
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, primaryDeviceId: "dev-b" }], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, ["tcp:10.0.2.2:9100"], "moved to another device, and this one writes nothing else: removed (ids compared ignoring case)");
  // Session 3B (deliberate change): a device that still writes a printer may take the moved one over, so it stays.
  const own = printer("own", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, primaryDeviceId: "dev-b" }, own], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, [], "moved to another device while this one writes another: kept, to take it over");
  assert.deepEqual(lanPrintersToRemove([{ ...kitchen, enabled: false }, own], "dev-a", POOL, null, ["TCP:10.0.2.2:9100"]).remove, ["tcp:10.0.2.2:9100"], "switched off: removed");
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, ["tcp:10.0.2.3:9100"]), { remove: [], record: [] }, "one the app no longer lists and the setup no longer names is forgotten");
  assert.deepEqual(lanPrintersToRemove([kitchen], "dev-a", null, null, added), { remove: [], record: added }, "never on an app that speaks only v1");
});
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  const others = src("apps/cafe/components/print/OtherDevicePrinters.tsx");
  assert.ok(others.includes('const { printers, answered } = usePrintersRead(deviceId !== "");'), "Other printers reads the same entry, with its state");
  assert.ok(others.includes('const known = deviceId === "" || answered;'), "known as the device section knows it");
  assert.match(others, /\{inSetup\.has\(entry\.id\) \? \(\s*<p className="text-xs text-brand-muted">\{IN_SETUP\}<\/p>\s*\) : known \? \(\s*<Button className=\{PRINTER_ACTION_CLASS\} variant="outline" disabled=\{disabled\} onClick=\{\(\) => setRemoving\(entry\.id\)\}>/, "no Remove under Other printers before the setup is known (m-1)");
});

test("PIN (the 2F2 review gate, M-4, m-3): a setup printer never leaves the app from the page; an ask is forgotten once the app lists the printer; the page removes only what it added", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes("for (const key of [...lanAsked]) if (pool.printers.some((entry) => entry.id.toLowerCase() === `tcp:${key}`)) lanAsked.delete(key);"), "an ask is forgotten once the app lists the printer");
  assert.ok(hook.includes("const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added) : { remove: [], record: added };"), "removals only against a printers read that has loaded");
  assert.ok(hook.includes('const LAN_ADDED_KEY = "pos.app-lan-added.v1";'), "the record is kept on the device");
  assert.ok(hook.indexOf("added.push(`tcp:${key}`)") > 0 && hook.indexOf("added.push(`tcp:${key}`)") < hook.indexOf("void nativePool().add({ tcp: lan })"), "recorded before it is asked for");
  const section = src("apps/cafe/components/print/DevicePrinterSection.tsx");
```

Replace it with:

```ts
  const others = src("apps/cafe/components/print/OtherDevicePrinters.tsx");
  assert.ok(others.includes('const { printers, answered } = usePrintersRead(deviceId !== "");'), "Other printers reads the same entry, with its state");
  assert.ok(others.includes('const known = deviceId === "" || answered;'), "known as the device section knows it");
  // Session 3B (deliberate change): a printer this device may take over says so instead of offering Remove.
  assert.match(others, /\{inSetup\.has\(entry\.id\) \? \(\s*<p className="text-xs text-brand-muted">\{IN_SETUP\}<\/p>\s*\) : takeover\.has\(entry\.id\) \? \(\s*<p className="text-xs text-brand-muted">\{TAKEOVER\}<\/p>\s*\) : known \? \(\s*<Button className=\{PRINTER_ACTION_CLASS\} variant="outline" disabled=\{disabled\} onClick=\{\(\) => setRemoving\(entry\.id\)\}>/, "no Remove under Other printers before the setup is known (m-1)");
});

test("PIN (the 2F2 review gate, M-4, m-3): a setup printer never leaves the app from the page; an ask is forgotten once the app lists the printer; the page removes only what it added", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes("for (const key of [...lanAsked]) if (pool.printers.some((entry) => entry.id.toLowerCase() === `tcp:${key}`)) lanAsked.delete(key);"), "an ask is forgotten once the app lists the printer");
  // Session 3B (deliberate change): never a printer a job is being written to now (the final Phase 2 gate, (a) item 4).
  assert.ok(hook.includes("const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added, busy) : { remove: [], record: added };"), "removals only against a printers read that has loaded");
  assert.ok(hook.includes('const LAN_ADDED_KEY = "pos.app-lan-added.v1";'), "the record is kept on the device");
  assert.ok(hook.indexOf("added.push(`tcp:${key}`)") > 0 && hook.indexOf("added.push(`tcp:${key}`)") < hook.indexOf("void nativePool().add({ tcp: lan })"), "recorded before it is asked for");
  const section = src("apps/cafe/components/print/DevicePrinterSection.tsx");
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
test("PIN (2F1): the page follows the app's printers: the agent's lines, the dot, the drain, the wake's heartbeat, the network printers it writes", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /return useMemo\(\(\) => agentPrintersOf\(printers, deviceId, local, desktop, pool\), \[printers, deviceId, local, desktop, pool\]\);/);
  assert.match(hook, /return useMemo\(\(\) => dotPrintersOf\(printers, deviceId, local, desktop, pool\), \[printers, deviceId, local, desktop, pool\]\);/);
  assert.match(hook, /for \(const lan of lanPrintersToAdd\(printers, deviceId, pool\)\) \{/, "a network printer it writes is added to the app");
  // The 2F2 review gate (M-4, deliberate change): asked again once the app has listed it and lost it, not once per page.
  assert.match(hook, /void nativePool\(\)\.add\(\{ tcp: lan \}\)\.catch\(\(\) => undefined\);/, "a local call");
```

Replace it with:

```ts
test("PIN (2F1): the page follows the app's printers: the agent's lines, the dot, the drain, the wake's heartbeat, the network printers it writes", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /return useMemo\(\(\) => agentPrintersOf\(printers, deviceId, local, desktop, pool\), \[printers, deviceId, local, desktop, pool\]\);/);
  // Session 3B (deliberate change): with the printers the wake says it took over.
  assert.match(hook, /return useMemo\(\(\) => dotPrintersOf\(printers, deviceId, local, desktop, pool, takenOver\), \[printers, deviceId, local, desktop, pool, takenOver\]\);/);
  assert.match(hook, /for \(const lan of lanPrintersToAdd\(printers, deviceId, pool\)\) \{/, "a network printer it writes is added to the app");
  // The 2F2 review gate (M-4, deliberate change): asked again once the app has listed it and lost it, not once per page.
  assert.match(hook, /void nativePool\(\)\.add\(\{ tcp: lan \}\)\.catch\(\(\) => undefined\);/, "a local call");
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
test("PIN (2C): the agent prints a leased job through printJobCopies on this device's printers; the station line reaches the paper", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // Session 2E: the same call, inside a body that looks a failed Windows printer up again.
  assert.match(agent, /const print = async \(job: LeasedPrintJob\): Promise<PrintAgentResult> => \{\s*const result = await printJobCopies\(job, readyRef\.current, \(\) => printOnce\(job\)\);/);
  const kot = src("apps/cafe/components/pos/KOTReceipt.tsx");
  const title = kot.indexOf("KITCHEN ORDER");
  const line = kot.indexOf("{stationLine && (");
```

Replace it with:

```ts
test("PIN (2C): the agent prints a leased job through printJobCopies on this device's printers; the station line reaches the paper", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // Session 2E: the same call, inside a body that looks a failed Windows printer up again.
  // Session 3B (deliberate change): the app printer it writes to is marked meanwhile, so the page never removes it mid-print.
  assert.match(agent, /const print = async \(job: LeasedPrintJob\): Promise<PrintAgentResult> => \{[\s\S]*?const result = await printJobCopies\(job, readyRef\.current, \(\) => printOnce\(job\)\);/);
  const kot = src("apps/cafe/components/pos/KOTReceipt.tsx");
  const title = kot.indexOf("KITCHEN ORDER");
  const line = kot.indexOf("{stationLine && (");
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  assert.ok(src("apps/cafe/components/print/PrintHostPrintSources.tsx").includes("kotStationLine={slip.stationLine}"), "the agent's slip carries it");
});
```

Replace it with:

```ts
  assert.ok(src("apps/cafe/components/print/PrintHostPrintSources.tsx").includes("kotStationLine={slip.stationLine}"), "the agent's slip carries it");
});

// Phase 3 Session 3B (spec §9.3; the planning review's M-8 a, d; the 3A review gate): a POS app on bridge v2 says
// lanFailover, so the server may give it any network printer of the setup while that printer's primary is offline or
// cannot reach it. The page adds every such printer to the app ahead of time, prints it once the app has it, names it in
// a lease only while the app reaches it (the signal that ends a skip: Session 3A's I-1), and its dot counts one only while
// the wake says it writes it.
test("3B: on bridge v2 every routable network printer another device writes is one this device may take over; on v1 none", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b" });
  const away = printer("away", { kind: "lan", host: "10.0.2.9", port: 9100 }, { primaryDeviceId: "dev-b" });
  const bt = printer("bt", { kind: "device", deviceId: "dev-b", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "10.0.2.8", port: 9100 }, { primaryDeviceId: "dev-b", enabled: false });
  const all = [mine, theirs, away, bt, off];
  assert.deepEqual(takeoverPrintersOf(all, "dev-a", POOL).map((p) => p.id).sort(), ["away", "theirs"], "network printers only, routable, another device's");
  assert.deepEqual(takeoverPrintersOf(all, "dev-a", null), [], "the release APK (v1) never takes one over");
  assert.deepEqual(takeoverPrintersOf(all, "", POOL), [], "no device identity");
  const agent = agentPrintersOf(all, "dev-a", NATIVE_TCP, null, POOL);
  assert.deepEqual(agent.localIds, ["mine", "theirs"], "its own printer, then the one it may take over that the app has (not the one the app lacks yet)");
  assert.deepEqual(agent.takeoverIds, ["theirs"]);
  assert.deepEqual(agent.lanIds, ["mine", "theirs"], "both network printers: a refusal before any byte is unreachable");
  assert.deepEqual(agent.targets.theirs, { nativeId: "tcp:10.0.2.2:9101", paper: "80mm" }, "printed through the app by its id");
  assert.equal(agent.isWriter, true, "a writer by the setup alone");
  // The gate's emulator pre-run (E-1): a device that writes no printer takes none over (it never polls the wake, so it is
  // never online for one: P3-2), and so never adds them to its app, where the first would become its own printer.
  assert.deepEqual(takeoverPrintersOf([theirs], "dev-a", POOL), [], "a device that writes nothing takes nothing over");
  assert.deepEqual(agentPrintersOf([theirs], "dev-a", NATIVE_TCP, null, POOL).takeoverIds, [], "and lists none");
  const empty = { printers: [] };
  assert.deepEqual(lanPrintersToAdd([mine, theirs], "dev-a", empty).map((p) => p.port), [9100, 9101], "an app with no printer gets its own first (its default), then the one it may take over");
  assert.deepEqual(lanPrintersToAdd([bt, { ...theirs, primaryDeviceId: "dev-b" }, printer("btA", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "FF:EE" })], "dev-a", empty), [], "an app with no printer and none of its own to add: never seeded with another device's printer");
});

test("PIN (3B, Session 3A's I-1): a page names in its lease only a printer it can print to now; the one it may take over too", () => {
  const statusOf = (id: string) => POOL.printers.find((p) => p.id === id)?.status ?? "none";
  const targets = { theirs: { nativeId: "tcp:10.0.2.2:9100", paper: "80mm" as const }, down: { nativeId: "tcp:10.0.2.2:9101", paper: "80mm" as const } };
  assert.deepEqual(readyPrinterIdsOf(["theirs", "down"], targets, true, statusOf), ["theirs"], "the app reaches one and not the other: only that one is ever named");
  const agent = src("apps/cafe/lib/print-agent.ts");
  assert.ok(agent.includes("const data = await deps.lease(holds.open(ready()));"), "the lease names only the ready printers no refusal holds");
  const hook = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(hook.includes("const readyNow = (): string[] => readyPrinterIdsOf(readyRef.current, targetsRef.current, canPrintNow(), printerStatusOf);"), "ready: the app's own state per printer");
  assert.ok(hook.includes("readyPrinters: readyNow,"), "the agent's ready list is that");
  const lib = src("apps/cafe/lib/print-agent-printers.ts");
  assert.ok(lib.includes('return nativeId === undefined ? canPrint : statusOf(nativeId) === "connected";'), "an app printer is ready only while the app says connected");
});

test("3B: the dot counts a printer it may take over only while the wake says it writes it", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b" });
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, POOL), { printersMode: true, isWriter: true, allLocal: true, worst: "connected" }, "the other device's printer is down for this app, but it does not write it now: green");
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, POOL, ["theirs"]), { printersMode: true, isWriter: true, allLocal: true, worst: "disconnected" }, "while the wake says it writes it, its state counts");
});

test("3B: a removal waits while a job is being written to that printer (the final Phase 2 gate, (a) item 4)", () => {
  const added = ["tcp:10.0.2.2:9101"];
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, added, ["TCP:10.0.2.2:9101"]), { remove: [], record: added }, "being written: kept for now, and still recorded");
  assert.deepEqual(lanPrintersToRemove([], "dev-a", POOL, null, added, []), { remove: ["tcp:10.0.2.2:9101"], record: added }, "done: asked to go");
  assert.match(PRINTER_TAKEOVER_MESSAGE, /offline/, "the words under Other printers for a printer it may take over");
});

test("PIN (3B): the page marks the app printer each job is written to, a removal waits for it, and Other printers says why a takeover printer stays", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(hook.includes('const writing = useSyncExternalStore(onPrintersWritingChange, printersBeingWritten, () => "");'), "the printers being written, followed");
  assert.ok(hook.includes("}, [enabled, loaded, printers, deviceId, pool, writing]);"), "a removal runs again once the print is done");
  assert.ok(hook.includes("const takenOver = useSyncExternalStore(onTakenOverChange, takenOverPrinterIds, () => NO_IDS);"), "the dot follows what the wake says it took over");
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes("if (nativeId !== undefined) markPrinterWriting(nativeId, true);") && agent.includes("if (nativeId !== undefined) markPrinterWriting(nativeId, false);"), "marked while it prints, unmarked after");
  const others = src("apps/cafe/components/print/OtherDevicePrinters.tsx");
  assert.ok(others.includes("const TAKEOVER = PRINTER_TAKEOVER_MESSAGE;"), "the takeover words");
});
```

In `apps/cafe/lib/printer-ui-paths.test.ts`, find:

```ts
  [F.connect, 110, true], [F.section, 50, false], [F.type, 60, false],
  // Session 1D: the waiting-slips panel follows the same rules (44px controls, no jargon).
  [F.waiting, 120, true],
  // Session 2F1 (the 2F1 review gate, M-6): the POS app's other printers on bridge v2.
  [F.others, 120, true],
];
const hygieneMutations = [
  append("a console call", "// " + "console" + ".log(1)"),
```

Replace it with:

```ts
  [F.connect, 110, true], [F.section, 50, false], [F.type, 60, false],
  // Session 1D: the waiting-slips panel follows the same rules (44px controls, no jargon).
  [F.waiting, 120, true],
  // Session 2F1 (the 2F1 review gate, M-6): the POS app's other printers on bridge v2. Session 3B: 130 (was 120), a
  // network printer this device may take over says why it stays.
  [F.others, 130, true],
];
const hygieneMutations = [
  append("a console call", "// " + "console" + ".log(1)"),
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts lib/printer-ui-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 63`; `# pass 52`; `# fail 11`

- [ ] **Step 3: The code**

In `apps/cafe/components/print/OtherDevicePrinters.tsx`, find:

```tsx
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useNativePool } from "@/hooks/use-device-printer";
import type { PaperWidth } from "@/lib/constants";
import { PRINTER_IN_SETUP_MESSAGE, agentPrintersOf } from "@/lib/print-agent-printers";
import { PRINTER_CONNECT_FAILED_MESSAGE, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool, type PoolPrinter } from "@/lib/printer/native-pool";
import { cn } from "@/lib/utils";
```

Replace it with:

```tsx
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useNativePool } from "@/hooks/use-device-printer";
import type { PaperWidth } from "@/lib/constants";
import { PRINTER_IN_SETUP_MESSAGE, PRINTER_TAKEOVER_MESSAGE, agentPrintersOf } from "@/lib/print-agent-printers";
import { PRINTER_CONNECT_FAILED_MESSAGE, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool, type PoolPrinter } from "@/lib/printer/native-pool";
import { cn } from "@/lib/utils";
```

In `apps/cafe/components/print/OtherDevicePrinters.tsx`, find:

```tsx
const NOT_YET = "The printer is added, but not connected yet. Check it is on, then tap Reconnect.";
const REMOVE_FAILED = "Could not remove the printer. Try again.";
const IN_SETUP = PRINTER_IN_SETUP_MESSAGE;
const STATUS_WORDS: Record<PoolPrinter["status"], string> = { connected: "Connected", connecting: "Connecting…", disconnected: "Not connected" };

// Printing redesign, Phase 2 Session 2F1 (spec §9.2, §11): on the POS app with bridge v2 one phone or tablet drives
```

Replace it with:

```tsx
const NOT_YET = "The printer is added, but not connected yet. Check it is on, then tap Reconnect.";
const REMOVE_FAILED = "Could not remove the printer. Try again.";
const IN_SETUP = PRINTER_IN_SETUP_MESSAGE;
const TAKEOVER = PRINTER_TAKEOVER_MESSAGE;
const STATUS_WORDS: Record<PoolPrinter["status"], string> = { connected: "Connected", connecting: "Connecting…", disconnected: "Not connected" };

// Printing redesign, Phase 2 Session 2F1 (spec §9.2, §11): on the POS app with bridge v2 one phone or tablet drives
```

In `apps/cafe/components/print/OtherDevicePrinters.tsx`, find:

```tsx
  const others = pool.printers.filter((entry) => entry.id !== pool.defaultId);
  // A printer the setup names this device for is added back by itself (a network printer), so it is not removed here
  // (the 2E gate's review, I-3): the words say where to change it.
  const inSetup = new Set(Object.values(agentPrintersOf(printers, deviceId, null, null, pool).targets).flatMap((target) => (target.nativeId === undefined ? [] : [target.nativeId])));
  // Remove only once the setup is known, as the device section (the final Phase 2 gate, m-1: before, every printer looks unnamed).
  const known = deviceId === "" || answered;
  const disabled = locked || busy;
```

Replace it with:

```tsx
  const others = pool.printers.filter((entry) => entry.id !== pool.defaultId);
  // A printer the setup names this device for is added back by itself (a network printer), so it is not removed here
  // (the 2E gate's review, I-3): the words say where to change it.
  // Session 3B: a network printer this device may take over is added back by itself too; its words say why it stays.
  const agent = agentPrintersOf(printers, deviceId, null, null, pool);
  const appIds = (ids: readonly string[]) => new Set(ids.flatMap((id) => agent.targets[id]?.nativeId ?? []));
  const inSetup = appIds(agent.localIds.filter((id) => !agent.takeoverIds.includes(id)));
  const takeover = appIds(agent.takeoverIds);
  // Remove only once the setup is known, as the device section (the final Phase 2 gate, m-1: before, every printer looks unnamed).
  const known = deviceId === "" || answered;
  const disabled = locked || busy;
```

In `apps/cafe/components/print/OtherDevicePrinters.tsx`, find:

```tsx
              </Button>
              {inSetup.has(entry.id) ? (
                <p className="text-xs text-brand-muted">{IN_SETUP}</p>
              ) : known ? (
                <Button className={PRINTER_ACTION_CLASS} variant="outline" disabled={disabled} onClick={() => setRemoving(entry.id)}>
                  Remove
```

Replace it with:

```tsx
              </Button>
              {inSetup.has(entry.id) ? (
                <p className="text-xs text-brand-muted">{IN_SETUP}</p>
              ) : takeover.has(entry.id) ? (
                <p className="text-xs text-brand-muted">{TAKEOVER}</p>
              ) : known ? (
                <Button className={PRINTER_ACTION_CLASS} variant="outline" disabled={disabled} onClick={() => setRemoving(entry.id)}>
                  Remove
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
```

Replace it with:

```ts
"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
import { isDesktopShell } from "@/lib/desktop-shell";
import { desktopPrintsOnNamed } from "@/lib/desktop-shell-printer";
import { agentPrintersOf, dotPrintersOf, lanPrintersToAdd, lanPrintersToRemove, ownPrinterInSetup, type AgentPrinters, type DesktopPrinters } from "@/lib/print-agent-printers";
import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { nativePool, type NativePoolSnapshot } from "@/lib/printer/native-pool";
import type { PrinterDotPrinters } from "@/lib/printer/printer-dot";
```

Replace it with:

```ts
import { isDesktopShell } from "@/lib/desktop-shell";
import { desktopPrintsOnNamed } from "@/lib/desktop-shell-printer";
import { agentPrintersOf, dotPrintersOf, lanPrintersToAdd, lanPrintersToRemove, ownPrinterInSetup, type AgentPrinters, type DesktopPrinters } from "@/lib/print-agent-printers";
import { onPrintersWritingChange, onTakenOverChange, printersBeingWritten, takenOverPrinterIds } from "@/lib/print-agent-seams";
import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { nativePool, type NativePoolSnapshot } from "@/lib/printer/native-pool";
import type { PrinterDotPrinters } from "@/lib/printer/printer-dot";
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = PRINT_SETUP_STALE_MS;
const NO_PRINTERS: PrinterConfig[] = [];

/** Session 2D: the printers read for a screen that only shows them (the dot, the bill printer, the setup page): the
 *  same cache entry as the agent's, without a print-setup subscription of its own, so an admin save costs one read
```

Replace it with:

```ts
export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = PRINT_SETUP_STALE_MS;
const NO_PRINTERS: PrinterConfig[] = [];
const NO_IDS: readonly string[] = [];

/** Session 2D: the printers read for a screen that only shows them (the dot, the bill printer, the setup page): the
 *  same cache entry as the agent's, without a print-setup subscription of its own, so an admin save costs one read
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
}

/** Session 2D (spec §10): the top-bar dot's view of printers mode. The same printers read as the agent's (one cache
 *  entry): no request of its own. */
export function useDotPrinters(deviceId: string): PrinterDotPrinters {
  const { printers } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  return useMemo(() => dotPrintersOf(printers, deviceId, local, desktop, pool), [printers, deviceId, local, desktop, pool]);
}

// The network printers this page asked the app to add that the app does not list yet: one ask per printer (one the app
```

Replace it with:

```ts
}

/** Session 2D (spec §10): the top-bar dot's view of printers mode. The same printers read as the agent's (one cache
 *  entry): no request of its own. Session 3B: with the network printers the wake says this device took over. */
export function useDotPrinters(deviceId: string): PrinterDotPrinters {
  const { printers } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  const takenOver = useSyncExternalStore(onTakenOverChange, takenOverPrinterIds, () => NO_IDS);
  return useMemo(() => dotPrintersOf(printers, deviceId, local, desktop, pool, takenOver), [printers, deviceId, local, desktop, pool, takenOver]);
}

// The network printers this page asked the app to add that the app does not list yet: one ask per printer (one the app
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
}

/** The printers this device writes, and which it prints here (lib/print-agent-printers.ts). Session 2F1: a network
 *  printer this device writes is added to the POS app's printers on bridge v2 (a local call, no request). */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const { loaded } = usePrintersRead(enabled);
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  useEffect(() => {
    if (!enabled || pool === null || deviceId === "") return;
    for (const key of [...lanAsked]) if (pool.printers.some((entry) => entry.id.toLowerCase() === `tcp:${key}`)) lanAsked.delete(key);
```

Replace it with:

```ts
}

/** The printers this device writes, and which it prints here (lib/print-agent-printers.ts). Session 2F1: a network
 *  printer this device writes is added to the POS app's printers on bridge v2 (a local call, no request). Session 3B:
 *  every network printer it may take over too, ahead of time; a removal waits while a job is being written to it. */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const { loaded } = usePrintersRead(enabled);
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  const writing = useSyncExternalStore(onPrintersWritingChange, printersBeingWritten, () => "");
  useEffect(() => {
    if (!enabled || pool === null || deviceId === "") return;
    for (const key of [...lanAsked]) if (pool.printers.some((entry) => entry.id.toLowerCase() === `tcp:${key}`)) lanAsked.delete(key);
```

In `apps/cafe/hooks/use-agent-printers.ts`, find:

```ts
      void nativePool().add({ tcp: lan }).catch(() => undefined);
    }
    // Only against a printers read that has loaded: before it, every printer the page added would look unnamed.
    const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added) : { remove: [], record: added };
    for (const id of remove) void nativePool().remove(id).catch(() => undefined);
    if (JSON.stringify(record) !== JSON.stringify(readLanAdded())) writeLanAdded(record);
  }, [enabled, loaded, printers, deviceId, pool]);
  return useMemo(() => agentPrintersOf(printers, deviceId, local, desktop, pool), [printers, deviceId, local, desktop, pool]);
}
```

Replace it with:

```ts
      void nativePool().add({ tcp: lan }).catch(() => undefined);
    }
    // Only against a printers read that has loaded: before it, every printer the page added would look unnamed.
    const busy = writing === "" ? [] : writing.split(",");
    const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added, busy) : { remove: [], record: added };
    for (const id of remove) void nativePool().remove(id).catch(() => undefined);
    if (JSON.stringify(record) !== JSON.stringify(readLanAdded())) writeLanAdded(record);
  }, [enabled, loaded, printers, deviceId, pool, writing]);
  return useMemo(() => agentPrintersOf(printers, deviceId, local, desktop, pool), [printers, deviceId, local, desktop, pool]);
}
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  setPrinterHealthSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
```

Replace it with:

```ts
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  markPrinterWriting,
  setPrinterHealthSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
      });
    // Session 2C: a printer job only on this device's own printer, every copy inside its one lease. Session 2E: a Windows
    // printer that failed is looked up again in the Windows app, so one renamed or removed there stops being this PC's.
    const print = async (job: LeasedPrintJob): Promise<PrintAgentResult> => {
      const result = await printJobCopies(job, readyRef.current, () => printOnce(job));
      if (!result.ok && job.printerId !== undefined && targetsRef.current[job.printerId]?.printerName !== undefined) void refreshDesktopPrinterChosen();
      return result;
    };
    // Session 2F1 (spec §9.2): of the printers it prints here, those that can print now: one of the POS app's printers
    // (bridge v2) by its own state, any other while this device's own printer can print (as before).
```

Replace it with:

```ts
      });
    // Session 2C: a printer job only on this device's own printer, every copy inside its one lease. Session 2E: a Windows
    // printer that failed is looked up again in the Windows app, so one renamed or removed there stops being this PC's.
    // Session 3B (the final Phase 2 gate, (a) item 4): the POS app printer it writes to is marked meanwhile, so the page's
    // removal of a network printer it added waits for the print (hooks/use-agent-printers.ts).
    const print = async (job: LeasedPrintJob): Promise<PrintAgentResult> => {
      const nativeId = job.printerId === undefined ? undefined : targetsRef.current[job.printerId]?.nativeId;
      if (nativeId !== undefined) markPrinterWriting(nativeId, true);
      try {
        const result = await printJobCopies(job, readyRef.current, () => printOnce(job));
        if (!result.ok && job.printerId !== undefined && targetsRef.current[job.printerId]?.printerName !== undefined) void refreshDesktopPrinterChosen();
        return result;
      } finally {
        if (nativeId !== undefined) markPrinterWriting(nativeId, false);
      }
    };
    // Session 2F1 (spec §9.2): of the printers it prints here, those that can print now: one of the POS app's printers
    // (bridge v2) by its own state, any other while this device's own printer can print (as before).
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
/** The 2E gate's review (I-3), and the 2F2 review gate (M-4) for this device's own printer: what the printer panel
 *  shows instead of Remove for a printer the setup prints through this device. */
export const PRINTER_IN_SETUP_MESSAGE = "Printer setup prints slips here: to remove it, change or delete that printer in Printer setup first.";

/** Session 2E (spec §9.2): the Windows app's printers. `named`: the app prints a slip on a printer the page names
 *  (desktopPrintsOnNamed); `names`: every printer Windows reports on this PC (null until read); `selected`: the one
```

Replace it with:

```ts
/** The 2E gate's review (I-3), and the 2F2 review gate (M-4) for this device's own printer: what the printer panel
 *  shows instead of Remove for a printer the setup prints through this device. */
export const PRINTER_IN_SETUP_MESSAGE = "Printer setup prints slips here: to remove it, change or delete that printer in Printer setup first.";
/** Session 3B (spec §9.3): what Other printers shows instead of Remove for a network printer this device may take over. */
export const PRINTER_TAKEOVER_MESSAGE = "This device prints it while the device that prints it is offline or cannot reach it. To remove it, change or delete that printer in Printer setup.";

/** Session 2E (spec §9.2): the Windows app's printers. `named`: the app prints a slip on a printer the page names
 *  (desktopPrintsOnNamed); `names`: every printer Windows reports on this PC (null until read); `selected`: the one
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
  localIds: string[];
  /** Session 3B (spec §9.3): those of them that are network printers (a refusal before any byte is "unreachable"). */
  lanIds: string[];
  /** Session 2E: each of them that prints on a named Windows printer, by id: its name and its paper. Session 2F1: each
   *  that is one of the POS app's printers on bridge v2: the app's id and its paper. */
  targets: Record<string, SlipPrintTarget>;
```

Replace it with:

```ts
  localIds: string[];
  /** Session 3B (spec §9.3): those of them that are network printers (a refusal before any byte is "unreachable"). */
  lanIds: string[];
  /** Session 3B (spec §9.3): those of them it may take over (another device writes them by the setup; on bridge v2). */
  takeoverIds: string[];
  /** Session 2E: each of them that prints on a named Windows printer, by id: its name and its paper. Session 2F1: each
   *  that is one of the POS app's printers on bridge v2: the app's id and its paper. */
  targets: Record<string, SlipPrintTarget>;
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts

function printersWrittenBy(printers: readonly PrinterConfig[], deviceId: string): PrinterConfig[] {
  return deviceId === "" ? [] : routablePrinters(printers).filter((printer) => printerWriterDeviceId(printer) === deviceId);
}

/** Session 2E: a Windows printer this PC prints by name (only on an app that can), drawn for its own paper. Session
```

Replace it with:

```ts

function printersWrittenBy(printers: readonly PrinterConfig[], deviceId: string): PrinterConfig[] {
  return deviceId === "" ? [] : routablePrinters(printers).filter((printer) => printerWriterDeviceId(printer) === deviceId);
}

/** Session 3B (spec §9.3): the network printers a POS app on bridge v2 (it says lanFailover) may take over: every
 *  routable one the setup names another device for. The page adds each to the app ahead of time (a local call, no
 *  request; the app probes a down one every 30 s), so its link is known before any takeover, it is named in a lease only
 *  while the app reaches it, and a takeover prints at once. The server grants its line only while this device writes it
 *  now (printerActiveWriter); it never makes this device a writer by the setup. */
export function takeoverPrintersOf(printers: readonly PrinterConfig[], deviceId: string, pool: NativePoolView | null): PrinterConfig[] {
  // The gate's emulator pre-run (E-1): only a device that writes a printer by the setup (P3-2: it polls the wake, so it
  // can be online for one); a device that writes nothing never adds another device's printers to its app.
  if (pool === null || printersWrittenBy(printers, deviceId).length === 0) return [];
  return routablePrinters(printers).filter((printer) => printer.connection.kind === "lan" && printerWriterDeviceId(printer) !== deviceId);
}

/** Session 2E: a Windows printer this PC prints by name (only on an app that can), drawn for its own paper. Session
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts

export function agentPrintersOf(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, desktop: DesktopPrinters | null, pool: NativePoolView | null = null): AgentPrinters {
  const mine = printersWrittenBy(printers, deviceId);
  const here = mine.filter((printer) => printerIsLocal(printer, local, desktop, pool));
  return {
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: here.map((printer) => printer.id),
    lanIds: here.filter((printer) => printer.connection.kind === "lan").map((printer) => printer.id),
    targets: targetsOf(here, desktop, pool),
  };
}
```

Replace it with:

```ts

export function agentPrintersOf(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, desktop: DesktopPrinters | null, pool: NativePoolView | null = null): AgentPrinters {
  const mine = printersWrittenBy(printers, deviceId);
  // Session 3B: a network printer it may take over prints here once the app has it.
  const takeover = takeoverPrintersOf(printers, deviceId, pool).filter((printer) => nativeIdOf(printer, pool) !== null);
  const here = [...mine.filter((printer) => printerIsLocal(printer, local, desktop, pool)), ...takeover];
  return {
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: here.map((printer) => printer.id),
    lanIds: here.filter((printer) => printer.connection.kind === "lan").map((printer) => printer.id),
    takeoverIds: takeover.map((printer) => printer.id),
    targets: targetsOf(here, desktop, pool),
  };
}
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts

/** Session 2D (spec §10): what the top-bar dot needs: printers mode, whether this device writes a printer, and
 *  whether it prints every printer it writes (a printer it writes that is not its own never prints here). Session
 *  2F1: on bridge v2, the worst state among the app's printers it prints. */
export function dotPrintersOf(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, desktop: DesktopPrinters | null, pool: NativePoolView | null = null): PrinterDotPrinters {
  const agent = agentPrintersOf(printers, deviceId, local, desktop, pool);
  const states = Object.values(agent.targets).flatMap((target) => pool?.printers.filter((entry) => entry.id === target.nativeId).map((entry) => entry.status) ?? []);
  const worst = states.reduce<PrinterStatus | undefined>((acc, status) => (acc === undefined || STATUS_WORSE.indexOf(status) > STATUS_WORSE.indexOf(acc) ? status : acc), undefined);
  return {
    printersMode: agent.printersMode,
    isWriter: agent.isWriter,
    allLocal: agent.localIds.length === printersWrittenBy(printers, deviceId).length,
    ...(worst !== undefined ? { worst } : {}),
  };
}

/** Session 2F1 (spec §9.2): the network printers this device writes that the POS app (bridge v2) does not have yet: it
 *  adds each (a local call to the app, no request), so naming a tablet a network printer's printing device is enough. */
export function lanPrintersToAdd(printers: readonly PrinterConfig[], deviceId: string, pool: NativePoolView | null): Array<{ host: string; port: number }> {
  if (pool === null) return [];
  const out: Array<{ host: string; port: number }> = [];
  for (const printer of printersWrittenBy(printers, deviceId)) {
    const connection = printer.connection;
    if (connection.kind === "lan" && nativeIdOf(printer, pool) === null) out.push({ host: connection.host.toLowerCase(), port: connection.port });
  }
```

Replace it with:

```ts

/** Session 2D (spec §10): what the top-bar dot needs: printers mode, whether this device writes a printer, and
 *  whether it prints every printer it writes (a printer it writes that is not its own never prints here). Session
 *  2F1: on bridge v2, the worst state among the app's printers it prints. Session 3B: a printer it may take over counts
 *  only while the wake says it writes it now (`takenOver`). */
export function dotPrintersOf(
  printers: readonly PrinterConfig[],
  deviceId: string,
  local: DevicePrinter | null,
  desktop: DesktopPrinters | null,
  pool: NativePoolView | null = null,
  takenOver: readonly string[] = [],
): PrinterDotPrinters {
  const agent = agentPrintersOf(printers, deviceId, local, desktop, pool);
  const counted = Object.entries(agent.targets).filter(([id]) => !agent.takeoverIds.includes(id) || takenOver.includes(id));
  const states = counted.flatMap(([, target]) => pool?.printers.filter((entry) => entry.id === target.nativeId).map((entry) => entry.status) ?? []);
  const worst = states.reduce<PrinterStatus | undefined>((acc, status) => (acc === undefined || STATUS_WORSE.indexOf(status) > STATUS_WORSE.indexOf(acc) ? status : acc), undefined);
  return {
    printersMode: agent.printersMode,
    isWriter: agent.isWriter,
    allLocal: agent.localIds.filter((id) => !agent.takeoverIds.includes(id)).length === printersWrittenBy(printers, deviceId).length,
    ...(worst !== undefined ? { worst } : {}),
  };
}

/** Session 2F1 (spec §9.2): the network printers this device writes that the POS app (bridge v2) does not have yet: it
 *  adds each (a local call to the app, no request), so naming a tablet a network printer's printing device is enough.
 *  Session 3B: then every network printer it may take over, ahead of time (takeoverPrintersOf). */
export function lanPrintersToAdd(printers: readonly PrinterConfig[], deviceId: string, pool: NativePoolView | null): Array<{ host: string; port: number }> {
  if (pool === null) return [];
  const out: Array<{ host: string; port: number }> = [];
  for (const printer of printersWrittenBy(printers, deviceId)) {
    const connection = printer.connection;
    if (connection.kind === "lan" && nativeIdOf(printer, pool) === null) out.push({ host: connection.host.toLowerCase(), port: connection.port });
  }
  // The gate's emulator pre-run (E-1): never into an app with no printer, unless its own goes in first (the first printer
  // of an empty app becomes its default, this device's own printer: never another device's).
  if (pool.printers.length === 0 && out.length === 0) return out;
  for (const printer of takeoverPrintersOf(printers, deviceId, pool)) {
    const connection = printer.connection;
    if (connection.kind === "lan" && nativeIdOf(printer, pool) === null) out.push({ host: connection.host.toLowerCase(), port: connection.port });
  }
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
 *  30 s and its notification never names a printer nothing prints on. Never one staff added (it was not recorded), and
 *  never the app's default (this device's own printer prints the slips no printer of the setup takes). `record`: what
 *  stays recorded, the ids the setup still names (added, or being added), the app's default, and one asked to go that
 *  the app still lists (the final Phase 2 gate, m-4: a removal that failed or timed out is asked again next time). */
export function lanPrintersToRemove(printers: readonly PrinterConfig[], deviceId: string, pool: NativePoolView | null, defaultId: string | null, added: readonly string[]): { remove: string[]; record: string[] } {
  if (pool === null) return { remove: [], record: [...added] };
  const wanted = new Set(printersWrittenBy(printers, deviceId).flatMap((printer) => (printer.connection.kind === "lan" ? [`tcp:${printer.connection.host}:${printer.connection.port}`.toLowerCase()] : [])));
  const recorded = new Set(added.map((id) => id.toLowerCase()));
  const listed = new Set(pool.printers.map((entry) => entry.id.toLowerCase()));
  const own = defaultId?.toLowerCase() ?? null;
  return {
    remove: pool.printers.filter((entry) => entry.id.toLowerCase() !== own && recorded.has(entry.id.toLowerCase()) && !wanted.has(entry.id.toLowerCase())).map((entry) => entry.id),
    record: added.filter((id) => wanted.has(id.toLowerCase()) || id.toLowerCase() === own || listed.has(id.toLowerCase())),
  };
}
```

Replace it with:

```ts
 *  30 s and its notification never names a printer nothing prints on. Never one staff added (it was not recorded), and
 *  never the app's default (this device's own printer prints the slips no printer of the setup takes). `record`: what
 *  stays recorded, the ids the setup still names (added, or being added), the app's default, and one asked to go that
 *  the app still lists (the final Phase 2 gate, m-4: a removal that failed or timed out is asked again next time).
 *  Session 3B: a network printer it may take over is still named (it stays), and one a job is being written to now
 *  (`writing`, the app's ids) waits until that print is done (the final Phase 2 gate, (a) item 4). */
export function lanPrintersToRemove(
  printers: readonly PrinterConfig[],
  deviceId: string,
  pool: NativePoolView | null,
  defaultId: string | null,
  added: readonly string[],
  writing: readonly string[] = [],
): { remove: string[]; record: string[] } {
  if (pool === null) return { remove: [], record: [...added] };
  const named = [...printersWrittenBy(printers, deviceId), ...takeoverPrintersOf(printers, deviceId, pool)];
  const wanted = new Set(named.flatMap((printer) => (printer.connection.kind === "lan" ? [`tcp:${printer.connection.host}:${printer.connection.port}`.toLowerCase()] : [])));
  const recorded = new Set(added.map((id) => id.toLowerCase()));
  const listed = new Set(pool.printers.map((entry) => entry.id.toLowerCase()));
  const busy = new Set(writing.map((id) => id.toLowerCase()));
  const own = defaultId?.toLowerCase() ?? null;
  return {
    remove: pool.printers
      .filter((entry) => entry.id.toLowerCase() !== own && recorded.has(entry.id.toLowerCase()) && !wanted.has(entry.id.toLowerCase()) && !busy.has(entry.id.toLowerCase()))
      .map((entry) => entry.id),
    record: added.filter((id) => wanted.has(id.toLowerCase()) || id.toLowerCase() === own || listed.has(id.toLowerCase())),
  };
}
```

In `apps/cafe/lib/print-agent-seams.ts`, find:

```ts
  return () => void takenOverListeners.delete(listener);
}

let readySource: (() => readonly string[]) | null = null;

/** Session 2C: the agent of the tab that drains this device's slips registers the printers it prints on (the
```

Replace it with:

```ts
  return () => void takenOverListeners.delete(listener);
}

const writing = new Map<string, number>();
const writingListeners = new Set<() => void>();
let writingKey = "";

/** Session 3B (the final Phase 2 gate, (a) item 4): a job is being written to this POS app printer (its app id) now, or
 *  no longer, so the page's removal of a network printer it added waits until that print is done. */
export function markPrinterWriting(nativeId: string, on: boolean): void {
  const count = (writing.get(nativeId) ?? 0) + (on ? 1 : -1);
  if (count > 0) writing.set(nativeId, count);
  else writing.delete(nativeId);
  const key = [...writing.keys()].sort().join(",");
  if (key === writingKey) return;
  writingKey = key;
  for (const listener of [...writingListeners]) listener();
}

/** The app printers being written to now, as one key ("" for none). */
export function printersBeingWritten(): string {
  return writingKey;
}

export function onPrintersWritingChange(listener: () => void): () => void {
  writingListeners.add(listener);
  return () => void writingListeners.delete(listener);
}

let readySource: (() => readonly string[]) | null = null;

/** Session 2C: the agent of the tab that drains this device's slips registers the printers it prints on (the
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-printers.test.ts lib/printer-ui-paths.test.ts lib/print-agent.test.ts lib/print-agent-paths.test.ts lib/print-agent-health.test.ts lib/print-windows-printers.test.ts lib/print-setup-ui-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 151`; `# pass 151`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-agent-printers.ts lib/print-agent-seams.ts hooks/use-print-agent.ts hooks/use-agent-printers.ts components/print/OtherDevicePrinters.tsx lib/print-agent-printers.test.ts lib/printer-ui-paths.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/components/print/OtherDevicePrinters.tsx apps/cafe/hooks/use-agent-printers.ts apps/cafe/hooks/use-print-agent.ts apps/cafe/lib/print-agent-printers.test.ts apps/cafe/lib/print-agent-printers.ts apps/cafe/lib/print-agent-seams.ts apps/cafe/lib/printer-ui-paths.test.ts
git commit -m "feat(print): a POS app on bridge v2 may take over every network printer another device writes: added to the app ahead of time, printed here once the app has it, named in a lease only while the app reaches it; the dot counts one only while the wake says it writes it; a removal waits while that printer is being written (Phase 3 Session 3B, B3)"
```

---

### Task B4: a printer's problem in its own words: the waiting-slips row and the alarm's notice on every device, and the top-bar dot of the device that prints it

**Files:**
- Modify: `packages/shared/src/print-failover.ts` (`printerHealthProblem`, which `printerProblemOf` now uses)
- Modify: `apps/cafe/lib/print-waiting.ts` (`printWaitingReason(…, printerName)`, `printWaitingGroups(…, printers)`, `printAlarmMessage(…, printerName)`, the alarm's memory of a problem), `components/print/WaitingSlipsCard.tsx`, `hooks/use-print-slip-alarm.ts`
- Modify: `apps/cafe/lib/printer/printer-dot.ts` (the `printer-problem` reason, its words and button name), `lib/print-agent-printers.ts` (`dotPrintersOf`'s `problem`)
- Tests: `packages/shared/src/print-failover.test.ts` (a test new), `apps/cafe/lib/print-waiting.test.ts` (three tests new, one a pin), `lib/printer/printer-dot.test.ts` (a test new; the reasons list), `lib/print-agent-printers.test.ts` (a test new; the dot pin's line changed)

**Interfaces produced:** `printerHealthProblem(health): PrinterProblem | null` (`@pos/shared/print-failover`); `printWaitingReason(row, nowMs, printerName = null)`, `printWaitingGroups(rows, nowMs, printers = [])`, `printAlarmMessage(row, printerName = null)`, `PrintAlarmMemory.problem` (`lib/print-waiting.ts`); `PrinterDotPrinters.problem`, the `printer-problem` reason, `PRINTER_BUTTON_NAME_PROBLEM` (`lib/printer/printer-dot.ts`).

**The panel and the alarm (P3-7).** A queued row with a `problem` (A4's feed) says it in that printer's words (`printerProblemText`, one source), named from this device's printers read: "Bar is out of paper.", "The device that prints Kitchen is offline." A slip waiting over 30 minutes still asks for a tap first. A printer this device does not know by name keeps the words as before (no "The printer" guesswork). The alarm's notice adds the same sentence ("KOT … has not printed yet. Bar is out of paper."), and a shown notice is re-worded, with no second ring, when its printer's problem changes. No request: the panel and the alarm read the printers the page already holds.

**The top-bar dot.** A printer this device prints (by the setup, or taken over while the wake says so) that its POS app says is out of paper, has its cover open or reports an error turns the dot red, headline "Printer needs attention" and that printer's words; its button reads "Printer needs attention — open printer setup". Low paper still prints, so it never turns the dot red. A link that is down says so first ("Printer not connected", with its Reconnect fix). The source is the app's own status (instant; the server's health would be a printers read behind), so in 3B only an app that says paper, cover or error (Session 3C, or the exit's fake app) can turn it red this way.

**Changed existing pins:** the dot's reasons list gains `printer-problem`; the 2F1 dot pin's line (`const row = noHostRow(…)`).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  assert.ok(agent.includes("useEffect(() => {\n    agent?.nudge();\n  }, [agent, canPrint, poolReady]);"), "a change of the app's printers that can print now is a nudge");
  assert.ok(src("apps/cafe/components/layout/PrintHostProvider.tsx").includes("nativePool().init();"), "read once per page, beside the device printer");
  assert.ok(src("apps/cafe/hooks/use-print-agent-wake.ts").includes("...(caps.native ? { nativeProtocol: nativeV2Bridge() !== null ? NATIVE_BRIDGE_V2 : 1 } : {}),"), "the wake says which app prints several printers");
  assert.ok(src("apps/cafe/lib/printer/printer-dot.ts").includes("return noHostRow(lane, printers.worst ?? local, desktopChosen);"), "the dot's worst printer");
});

test("PIN (2C final review, I-2): the pulse and the wake kick the agent only on jobs it can lease", () => {
```

Replace it with:

```ts
  assert.ok(agent.includes("useEffect(() => {\n    agent?.nudge();\n  }, [agent, canPrint, poolReady]);"), "a change of the app's printers that can print now is a nudge");
  assert.ok(src("apps/cafe/components/layout/PrintHostProvider.tsx").includes("nativePool().init();"), "read once per page, beside the device printer");
  assert.ok(src("apps/cafe/hooks/use-print-agent-wake.ts").includes("...(caps.native ? { nativeProtocol: nativeV2Bridge() !== null ? NATIVE_BRIDGE_V2 : 1 } : {}),"), "the wake says which app prints several printers");
  // Session 3B (deliberate change): then a printer problem the app says, when every printer answers.
  assert.ok(src("apps/cafe/lib/printer/printer-dot.ts").includes("const row = noHostRow(lane, printers.worst ?? local, desktopChosen);"), "the dot's worst printer");
});

test("PIN (2C final review, I-2): the pulse and the wake kick the agent only on jobs it can lease", () => {
```

In `apps/cafe/lib/print-agent-printers.test.ts`, find:

```ts
  assert.ok(lib.includes('return nativeId === undefined ? canPrint : statusOf(nativeId) === "connected";'), "an app printer is ready only while the app says connected");
});

test("3B: the dot counts a printer it may take over only while the wake says it writes it", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b" });
```

Replace it with:

```ts
  assert.ok(lib.includes('return nativeId === undefined ? canPrint : statusOf(nativeId) === "connected";'), "an app printer is ready only while the app says connected");
});

test("3B: the dot carries the worst paper, cover or error the app says of a printer it counts, by that printer's name", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a", name: "Kitchen" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b", name: "Bar" });
  const pool = { printers: [{ id: "tcp:10.0.2.2:9100", status: "connected" as const, paper: "low" as const, cover: "open" as const }, { id: "tcp:10.0.2.2:9101", status: "connected" as const, paper: "out" as const }] };
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, pool).problem, { name: "Kitchen", problem: "cover-open" }, "its own printer's cover; the other device's printer does not count");
  assert.deepEqual(dotPrintersOf([mine, theirs], "dev-a", NATIVE_TCP, null, pool, ["theirs"]).problem, { name: "Bar", problem: "paper-out" }, "while it writes the Bar printer, its paper out is worse");
  const low = { printers: [{ id: "tcp:10.0.2.2:9100", status: "connected" as const, paper: "low" as const }] };
  assert.equal(dotPrintersOf([mine], "dev-a", NATIVE_TCP, null, low).problem, undefined, "low paper still prints: no red dot");
});

test("3B: the dot counts a printer it may take over only while the wake says it writes it", () => {
  const mine = printer("mine", { kind: "lan", host: "10.0.2.2", port: 9100 }, { primaryDeviceId: "dev-a" });
  const theirs = printer("theirs", { kind: "lan", host: "10.0.2.2", port: 9101 }, { primaryDeviceId: "dev-b" });
```

In `apps/cafe/lib/print-waiting.test.ts`, find:

```ts
});

// Session 2C (printers mode): the panel names a waiting slip's printer from this device's printer list.
test("2C: a waiting slip's printer by name; none for simple mode, a printer no longer listed, or no printer at all", () => {
  const printers = [{ id: "p-bar", name: "Bar printer" }];
  assert.equal(printerNameOf(printers, "p-bar"), "Bar printer");
```

Replace it with:

```ts
});

// Session 2C (printers mode): the panel names a waiting slip's printer from this device's printer list.
// Phase 3 Session 3B (spec §9.4, §10, P3-7): a slip waiting for its printer says that printer's problem on every device,
// in the printer's own words (printerProblemText), in the panel and on the alarm's notice; the notice is re-worded
// quietly when the problem changes.
test("3B: a waiting slip says its printer's problem in the printer's words; a stale slip still asks for a tap first", () => {
  const printers = [{ id: "p-bar", name: "Bar printer" }];
  const out = row({ printerId: "p-bar", problem: "paper-out" });
  const [section] = printWaitingGroups([out], T0, printers);
  assert.equal(section?.rows[0]?.reason, "Bar printer is out of paper.");
  assert.equal(printWaitingReason(row({ printerId: "p-gone", problem: "device-offline" }), T0), "Not printed yet.", "a printer this device does not know by name: the words as before");
  assert.equal(printWaitingReason(row({ printerId: "p-bar", problem: "paper-out", createdAt: ago(31 * 60_000) }), T0, "Bar printer"), "Waiting over 30 minutes: print it now, or clear it.", "a stale slip needs a tap whatever its printer does");
  assert.equal(printWaitingReason(row({ printerId: "p-bar", problem: "offline", lastError: PRINTER_NOT_CONNECTED_MESSAGE }), T0, "Bar printer"), "Bar printer is not connected.", "the printer's words before the last refusal's");
  assert.equal(printAlarmMessage(out, "Bar printer"), "KOT round 1 · T-4 has not printed yet. Bar printer is out of paper.");
  assert.equal(printAlarmMessage(row({ printerId: "p-bar" }), "Bar printer"), "KOT round 1 · T-4 has not printed yet.", "nothing known: as before");
});

test("3B: a shown notice is re-worded, with no second ring, when its printer's problem changes", () => {
  const kot = row({ id: "k", originDeviceId: "dev-a", printerId: "p-bar" });
  let step = printAlarmStep(new Map(), feedOf([kot]), "dev-a", T0, false);
  assert.equal(step.ring, true);
  step = printAlarmStep(step.memory, feedOf([{ ...kot, problem: "paper-out" }]), "dev-a", T0 + 20_000, false);
  assert.equal(step.ring, false, "no second ring");
  assert.deepEqual(step.show.map((r) => r.problem), ["paper-out"], "the notice is re-worded (same id)");
  step = printAlarmStep(step.memory, feedOf([{ ...kot, problem: "paper-out" }]), "dev-a", T0 + 40_000, false);
  assert.deepEqual(step.show, [], "the same problem again: nothing");
});

test("PIN (3B): the panel and the alarm name the slip's printer for its problem; no request of their own", () => {
  const card = src("apps/cafe/components/print/WaitingSlipsCard.tsx");
  assert.ok(card.includes("const groups = printWaitingGroups(rows ?? [], Date.now(), printers);"), "the panel's reasons name the printer");
  const alarm = src("apps/cafe/hooks/use-print-slip-alarm.ts");
  assert.ok(alarm.includes("printAlarmMessage(row, printerNameOf(qc.getQueryData<PrinterConfig[]>(PRINTERS_KEYS.all) ?? [], row.printerId))"), "the notice names it from the printers already read");
});

test("2C: a waiting slip's printer by name; none for simple mode, a printer no longer listed, or no printer at all", () => {
  const printers = [{ id: "p-bar", name: "Bar printer" }];
  assert.equal(printerNameOf(printers, "p-bar"), "Bar printer");
```

In `apps/cafe/lib/printer/printer-dot.test.ts`, find:

```ts

const REASONS: PrinterDotReason[] = [
  "ok", "device-offline", "checking", "no-printer", "printer-off", "printer-needs-tap",
  "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window",
];

function dotFor(reason: PrinterDotReason): PrinterDot {
```

Replace it with:

```ts

const REASONS: PrinterDotReason[] = [
  "ok", "device-offline", "checking", "no-printer", "printer-off", "printer-needs-tap",
  "printer-elsewhere", "host-offline", "host-printer-off", "host-print-window", "printer-problem",
];

function dotFor(reason: PrinterDotReason): PrinterDot {
```

In `apps/cafe/lib/printer/printer-dot.test.ts`, find:

```ts
  assert.equal(printerDotTone({ show: true, ok: false, reason: "printer-not-here" }), "red");
});
```

Replace it with:

```ts
  assert.equal(printerDotTone({ show: true, ok: false, reason: "printer-not-here" }), "red");
});

// Phase 3 Session 3B (spec §10): a printer this device prints (writes by the setup, or took over) that its POS app says is
// out of paper, has its cover open or reports an error turns the dot red, in that printer's words. Low paper still
// prints, so it never does; a link that is down says so first (its Reconnect fix).
test("3B: a printer of this device out of paper, its cover open or in error is red with its words; low paper is not; a down link first", () => {
  const base = { remote: "none" as const, isHostDevice: false, lane: "raster" as const, local: "connected" as const, deviceOffline: false, desktopChosen: "unknown" as const };
  const printers = { printersMode: true, isWriter: true, allLocal: true, worst: "connected" as const };
  const out = printerDotOf({ ...base, printers: { ...printers, problem: { name: "Kitchen", problem: "paper-out" } } });
  assert.deepEqual(out, { show: true, ok: false, reason: "printer-problem", problem: "Kitchen is out of paper." });
  const hi = { hostLabel: null, printerName: null, isHostDevice: false, canPrintHere: true, localStatus: "connected" as const, desktopNoPrinter: false };
  assert.deepEqual(printerHeadlineOf(out, hi), { headline: "Printer needs attention", detail: "Kitchen is out of paper.", fix: null });
  assert.equal(printerButtonName(out), "Printer needs attention — open printer setup");
  assert.equal(printerDotTone(out), "red");
  const down = printerDotOf({ ...base, printers: { ...printers, worst: "disconnected", problem: { name: "Kitchen", problem: "cover-open" } } });
  assert.equal(down.show && down.reason, "printer-off", "a printer that does not answer: reconnect it first");
  assert.deepEqual(printerDotOf({ ...base, printers }), { show: true, ok: true, reason: "ok" }, "nothing known: green as before");
});
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  printerActiveWriter,
  printerBackupOf,
  printerBackupRefusal,
  printerProblemOf,
  printerProblemText,
  printerSkipEndsFor,
```

Replace it with:

```ts
  printerActiveWriter,
  printerBackupOf,
  printerBackupRefusal,
  printerHealthProblem,
  printerProblemOf,
  printerProblemText,
  printerSkipEndsFor,
```

In `packages/shared/src/print-failover.test.ts`, find:

```ts
  assert.equal(printerProblemOf(kitchen, failover([["counter", true]])), null, "a network printer the counter took over: the primary's old report says nothing");
});

test("printerProblemText: the words every device shows", () => {
  assert.deepEqual(
    PRINTER_PROBLEMS.map((problem) => printerProblemText("Kitchen", problem)),
```

Replace it with:

```ts
  assert.equal(printerProblemOf(kitchen, failover([["counter", true]])), null, "a network printer the counter took over: the primary's old report says nothing");
});

test("printerHealthProblem: the worst thing a report says, worst first; nothing when all is well (Session 3B: the dot reads it)", () => {
  assert.equal(printerHealthProblem({ link: "connected", paper: "out", cover: "open", error: true }), "paper-out");
  assert.equal(printerHealthProblem({ link: "connected", cover: "open", error: true }), "cover-open");
  assert.equal(printerHealthProblem({ link: "connected", error: true }), "error");
  assert.equal(printerHealthProblem({ link: "disconnected", paper: "low" }), "offline");
  assert.equal(printerHealthProblem({ link: "connected", paper: "low" }), "paper-low");
  assert.equal(printerHealthProblem({ link: "connected", paper: "ok", cover: "closed" }), null);
  assert.equal(printerHealthProblem({ link: "connecting" }), null, "a probe in between says nothing");
});

test("printerProblemText: the words every device shows", () => {
  assert.deepEqual(
    PRINTER_PROBLEMS.map((problem) => printerProblemText("Kitchen", problem)),
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 1`; `# pass 0`; `# fail 1`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-waiting.test.ts lib/printer/printer-dot.test.ts lib/print-agent-printers.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 69`; `# pass 62`; `# fail 7`

- [ ] **Step 3: The code**

In `apps/cafe/components/print/WaitingSlipsCard.tsx`, find:

```tsx
    });
  }, [rows]);

  const groups = printWaitingGroups(rows ?? [], Date.now());
  if (groups.length === 0) return null;
  const release = (id: string) =>
    setTapped((prev) => {
```

Replace it with:

```tsx
    });
  }, [rows]);

  const groups = printWaitingGroups(rows ?? [], Date.now(), printers);
  if (groups.length === 0) return null;
  const release = (id: string) =>
    setTapped((prev) => {
```

In `apps/cafe/hooks/use-print-slip-alarm.ts`, find:

```ts
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { isAlertSoundUnlocked, playAlertPing } from "@/lib/alert-sound";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { printAlarmMessage, printAlarmStep, printAlarmSummary, type PrintAlarmMemory } from "@/lib/print-waiting";
import { openPrinterPanel } from "@/lib/printer-panel-open";

// Session 1D (spec §10): the 20 s alarm. A KOT still not printed 20 s after it was made (it is in the
```

Replace it with:

```ts
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PrinterConfig } from "@pos/shared/print-printers";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { PRINTERS_KEYS } from "@/hooks/use-agent-printers";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { isAlertSoundUnlocked, playAlertPing } from "@/lib/alert-sound";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { printAlarmMessage, printAlarmStep, printAlarmSummary, printerNameOf, type PrintAlarmMemory } from "@/lib/print-waiting";
import { openPrinterPanel } from "@/lib/printer-panel-open";

// Session 1D (spec §10): the 20 s alarm. A KOT still not printed 20 s after it was made (it is in the
```

In `apps/cafe/hooks/use-print-slip-alarm.ts`, find:

```ts
      for (const id of step.dismiss) toast.dismiss(`print-alarm-${id}`);
      if ((step.ring || step.summary > 0) && readDevicePrefs().alertSound && isAlertSoundUnlocked()) playAlertPing();
      for (const row of step.show) {
        toast.warning(printAlarmMessage(row), { id: `print-alarm-${row.id}`, duration: Number.POSITIVE_INFINITY, action: SHOW, actionButtonStyle: SHOW_STYLE });
      }
      if (step.summaryWaiting !== page.summary) {
        if (step.summaryWaiting === 0) toast.dismiss(SUMMARY_ID);
```

Replace it with:

```ts
      for (const id of step.dismiss) toast.dismiss(`print-alarm-${id}`);
      if ((step.ring || step.summary > 0) && readDevicePrefs().alertSound && isAlertSoundUnlocked()) playAlertPing();
      for (const row of step.show) {
        // Session 3B: its printer's problem, named from the printers this device already read (no request).
        const message = printAlarmMessage(row, printerNameOf(qc.getQueryData<PrinterConfig[]>(PRINTERS_KEYS.all) ?? [], row.printerId));
        toast.warning(message, { id: `print-alarm-${row.id}`, duration: Number.POSITIVE_INFINITY, action: SHOW, actionButtonStyle: SHOW_STYLE });
      }
      if (step.summaryWaiting !== page.summary) {
        if (step.summaryWaiting === 0) toast.dismiss(SUMMARY_ID);
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
import { PRINT_JOBS_FOR_ME_LIMIT, type LeasedPrintJob, type PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
```

Replace it with:

```ts
import { PRINT_JOBS_FOR_ME_LIMIT, type LeasedPrintJob, type PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { PRINTER_PROBLEMS, printerHealthProblem, type PrinterCoverState, type PrinterPaperState, type PrinterProblem } from "@pos/shared/print-failover";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
/** Session 2F1 (spec §9.2): the POS app's printers on bridge v2 (nativePool()): each one's id and state. null on any
 *  other device, and on an app that speaks only v1 (the release APK), which prints its one printer as before. */
export interface NativePoolView {
  printers: readonly { id: string; status: PrinterStatus }[];
}

/** Session 2F1: the app's id a printer of the setup is, among the app's printers on bridge v2, or null. A LAN printer is
```

Replace it with:

```ts
/** Session 2F1 (spec §9.2): the POS app's printers on bridge v2 (nativePool()): each one's id and state. null on any
 *  other device, and on an app that speaks only v1 (the release APK), which prints its one printer as before. */
export interface NativePoolView {
  printers: readonly { id: string; status: PrinterStatus; paper?: PrinterPaperState; cover?: PrinterCoverState; error?: true }[];
}

/** Session 2F1: the app's id a printer of the setup is, among the app's printers on bridge v2, or null. A LAN printer is
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
}

const STATUS_WORSE: readonly PrinterStatus[] = ["connected", "connecting", "needs-tap", "elsewhere", "disconnected", "none"];

/** Session 2D (spec §10): what the top-bar dot needs: printers mode, whether this device writes a printer, and
 *  whether it prints every printer it writes (a printer it writes that is not its own never prints here). Session
```

Replace it with:

```ts
}

const STATUS_WORSE: readonly PrinterStatus[] = ["connected", "connecting", "needs-tap", "elsewhere", "disconnected", "none"];
/** Session 3B (spec §10): what turns the dot red although every printer answers. Low paper still prints. */
const DOT_PROBLEMS: readonly PrinterProblem[] = ["paper-out", "cover-open", "error"];

/** Session 2D (spec §10): what the top-bar dot needs: printers mode, whether this device writes a printer, and
 *  whether it prints every printer it writes (a printer it writes that is not its own never prints here). Session
```

In `apps/cafe/lib/print-agent-printers.ts`, find:

```ts
  const counted = Object.entries(agent.targets).filter(([id]) => !agent.takeoverIds.includes(id) || takenOver.includes(id));
  const states = counted.flatMap(([, target]) => pool?.printers.filter((entry) => entry.id === target.nativeId).map((entry) => entry.status) ?? []);
  const worst = states.reduce<PrinterStatus | undefined>((acc, status) => (acc === undefined || STATUS_WORSE.indexOf(status) > STATUS_WORSE.indexOf(acc) ? status : acc), undefined);
  return {
    printersMode: agent.printersMode,
    isWriter: agent.isWriter,
    allLocal: agent.localIds.filter((id) => !agent.takeoverIds.includes(id)).length === printersWrittenBy(printers, deviceId).length,
    ...(worst !== undefined ? { worst } : {}),
  };
}
```

Replace it with:

```ts
  const counted = Object.entries(agent.targets).filter(([id]) => !agent.takeoverIds.includes(id) || takenOver.includes(id));
  const states = counted.flatMap(([, target]) => pool?.printers.filter((entry) => entry.id === target.nativeId).map((entry) => entry.status) ?? []);
  const worst = states.reduce<PrinterStatus | undefined>((acc, status) => (acc === undefined || STATUS_WORSE.indexOf(status) > STATUS_WORSE.indexOf(acc) ? status : acc), undefined);
  // Session 3B (spec §10): the worst paper, cover or error the app says of a printer it counts, by that printer's name.
  const problems = counted.flatMap(([id, target]) => {
    const entry = pool?.printers.find((candidate) => candidate.id === target.nativeId);
    const problem = entry === undefined ? null : printerHealthProblem({ link: "connected", paper: entry.paper, cover: entry.cover, error: entry.error });
    const name = printers.find((printer) => printer.id === id)?.name;
    return problem !== null && DOT_PROBLEMS.includes(problem) && name !== undefined ? [{ name, problem }] : [];
  });
  const problem = problems.sort((a, b) => PRINTER_PROBLEMS.indexOf(a.problem) - PRINTER_PROBLEMS.indexOf(b.problem))[0];
  return {
    printersMode: agent.printersMode,
    isWriter: agent.isWriter,
    allLocal: agent.localIds.filter((id) => !agent.takeoverIds.includes(id)).length === printersWrittenBy(printers, deviceId).length,
    ...(worst !== undefined ? { worst } : {}),
    ...(problem !== undefined ? { problem } : {}),
  };
}
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
import type { PrintActionData, PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { isDesktopShellRefusal, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";
```

Replace it with:

```ts
import type { PrintActionData, PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { printerProblemText, type PrinterProblem } from "@pos/shared/print-failover";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { isDesktopShellRefusal, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

export function printWaitingReason(row: PrintAttentionRow, nowMs: number): string {
  if (row.status === "needs-confirm") return "It may already have printed. Check the printer.";
  if (row.status === "failed") {
    return row.lastError && !SERVER_WORDS.test(row.lastError) ? row.lastError : "Tried twice. Check the printer, then retry.";
```

Replace it with:

```ts
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** Session 3B (spec §9.4, §10): `printerName`, the slip's printer as this device's list names it, says its problem. */
export function printWaitingReason(row: PrintAttentionRow, nowMs: number, printerName: string | null = null): string {
  if (row.status === "needs-confirm") return "It may already have printed. Check the printer.";
  if (row.status === "failed") {
    return row.lastError && !SERVER_WORDS.test(row.lastError) ? row.lastError : "Tried twice. Check the printer, then retry.";
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
  // Queued: a stale slip needs a tap whatever its printer does (the agent never leases it by itself),
  // unless staff already tapped it (1D gate M-6: then it only waits for its printer).
  if (!row.approved && nowMs - Date.parse(row.createdAt) > PRINT_HOST_MAX_AGE_MS) return "Waiting over 30 minutes: print it now, or clear it.";
  if (row.lastError) {
    const outcome = printWriteOutcomeOf(new Error(row.lastError));
    // The slip itself was refused once (owner, 1C gate I3): not the printer's fault (1D gate M-6).
```

Replace it with:

```ts
  // Queued: a stale slip needs a tap whatever its printer does (the agent never leases it by itself),
  // unless staff already tapped it (1D gate M-6: then it only waits for its printer).
  if (!row.approved && nowMs - Date.parse(row.createdAt) > PRINT_HOST_MAX_AGE_MS) return "Waiting over 30 minutes: print it now, or clear it.";
  // Session 3B (spec §9.4, §10, P3-7): its printer cannot print now: in that printer's words, on every device.
  if (row.problem !== undefined && printerName !== null) return printerProblemText(printerName, row.problem);
  if (row.lastError) {
    const outcome = printWriteOutcomeOf(new Error(row.lastError));
    // The slip itself was refused once (owner, 1C gate I3): not the printer's fault (1D gate M-6).
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
  rows: Array<{ row: PrintAttentionRow; reason: string; age: string }>;
}

export function printWaitingGroups(rows: readonly PrintAttentionRow[], nowMs: number): PrintWaitingSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: PRINT_WAITING_TITLES[group],
    rows: rows.filter((row) => groupOf(row) === group).map((row) => ({ row, reason: printWaitingReason(row, nowMs), age: printWaitingAge(row.createdAt, nowMs) })),
  })).filter((section) => section.rows.length > 0);
}
```

Replace it with:

```ts
  rows: Array<{ row: PrintAttentionRow; reason: string; age: string }>;
}

export function printWaitingGroups(rows: readonly PrintAttentionRow[], nowMs: number, printers: ReadonlyArray<{ id: string; name: string }> = []): PrintWaitingSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: PRINT_WAITING_TITLES[group],
    rows: rows
      .filter((row) => groupOf(row) === group)
      .map((row) => ({ row, reason: printWaitingReason(row, nowMs, printerNameOf(printers, row.printerId)), age: printWaitingAge(row.createdAt, nowMs) })),
  })).filter((section) => section.rows.length > 0);
}
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
  return row.kind === "kot" || row.status !== "queued";
}

export function printAlarmMessage(row: PrintAttentionRow): string {
  if (row.status === "needs-confirm") return `${row.label} may not have printed.`;
  if (row.status === "failed") return `${row.label} could not print.`;
  return `${row.label} has not printed yet.`;
}

/** A page that opens while slips already wait shows one notice for them, not one per slip (1D gate N-5). */
```

Replace it with:

```ts
  return row.kind === "kot" || row.status !== "queued";
}

export function printAlarmMessage(row: PrintAttentionRow, printerName: string | null = null): string {
  if (row.status === "needs-confirm") return `${row.label} may not have printed.`;
  if (row.status === "failed") return `${row.label} could not print.`;
  // Session 3B (spec §10): a slip that waits because its printer cannot print says why.
  const why = row.problem !== undefined && printerName !== null ? ` ${printerProblemText(printerName, row.problem)}` : "";
  return `${row.label} has not printed yet.${why}`;
}

/** A page that opens while slips already wait shows one notice for them, not one per slip (1D gate N-5). */
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
  /** It already waited when the page opened: the one summary notice stands for it until it leaves the feed or
   *  gets a notice of its own (the Phase 1 final gate, M4). */
  summary?: true;
}

export interface PrintAlarmStep {
```

Replace it with:

```ts
  /** It already waited when the page opened: the one summary notice stands for it until it leaves the feed or
   *  gets a notice of its own (the Phase 1 final gate, M4). */
  summary?: true;
  /** Session 3B: its printer's problem when last seen; a shown notice is re-worded, quietly, when it changes. */
  problem?: PrinterProblem;
}

export interface PrintAlarmStep {
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
      // A notice of its own: the summary no longer stands for it.
      step.ring = true;
      step.show.push(row);
      next.set(row.id, { group, createdAt: row.createdAt, seenAt: nowMs, shown: true, ...approved });
    } else if (group !== was.group || (row.approved === true && was.approved !== true)) {
      // Staff acted on it: quietly.
      if (was.shown) step.dismiss.push(row.id);
```

Replace it with:

```ts
      // A notice of its own: the summary no longer stands for it.
      step.ring = true;
      step.show.push(row);
      next.set(row.id, { group, createdAt: row.createdAt, seenAt: nowMs, shown: true, ...approved, problem: row.problem });
    } else if (group !== was.group || (row.approved === true && was.approved !== true)) {
      // Staff acted on it: quietly.
      if (was.shown) step.dismiss.push(row.id);
```

In `apps/cafe/lib/print-waiting.ts`, find:

```ts
      // Back from a moment's lease (a refused attempt) and still waiting: its notice comes back, without a
      // second ring. A gap must never read as "printed".
      step.show.push(row);
      next.set(row.id, { group, createdAt: was.createdAt, seenAt: nowMs, shown: true, ...approved });
    } else {
      next.set(row.id, { ...was, seenAt: nowMs });
    }
  }
  const oldest = feed.rows.length > 0 ? Date.parse(feed.rows[0]?.createdAt ?? "") : Number.NaN;
```

Replace it with:

```ts
      // Back from a moment's lease (a refused attempt) and still waiting: its notice comes back, without a
      // second ring. A gap must never read as "printed".
      step.show.push(row);
      next.set(row.id, { group, createdAt: was.createdAt, seenAt: nowMs, shown: true, ...approved, problem: row.problem });
    } else {
      // Session 3B: its printer's problem changed: the notice is re-worded (same id), with no second ring.
      if (was.shown && was.problem !== row.problem) step.show.push(row);
      next.set(row.id, { ...was, seenAt: nowMs, problem: row.problem });
    }
  }
  const oldest = feed.rows.length > 0 ? Date.parse(feed.rows[0]?.createdAt ?? "") : Number.NaN;
```

In `apps/cafe/lib/printer/printer-dot.ts`, find:

```ts
import type { PosPulseData } from "@pos/shared/self-order-alert";
import type { DesktopChosen } from "@/lib/printer/desktop-printer-state";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";
```

Replace it with:

```ts
import { printerProblemText, type PrinterProblem } from "@pos/shared/print-failover";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import type { DesktopChosen } from "@/lib/printer/desktop-printer-state";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";
```

In `apps/cafe/lib/printer/printer-dot.ts`, find:

```ts
  // Phase 2 Session 2D (spec §10), printers mode: this device writes a printer that is not its own printer; or it
  // writes none, and its slips print at the cafe's printers.
  | "printer-not-here"
  | "printers-elsewhere";

export type PrinterDot = { show: false } | { show: true; ok: boolean; reason: PrinterDotReason };

export interface PrinterDotInput {
  remote: PrintHostDot;
```

Replace it with:

```ts
  // Phase 2 Session 2D (spec §10), printers mode: this device writes a printer that is not its own printer; or it
  // writes none, and its slips print at the cafe's printers.
  | "printer-not-here"
  | "printers-elsewhere"
  // Phase 3 Session 3B (spec §10): a printer of this device out of paper, with its cover open or in error.
  | "printer-problem";

/** Session 3B: `problem`, a printer-problem dot's words (printerProblemText). */
export type PrinterDot = { show: false } | { show: true; ok: boolean; reason: PrinterDotReason; problem?: string };

export interface PrinterDotInput {
  remote: PrintHostDot;
```

In `apps/cafe/lib/printer/printer-dot.ts`, find:

```ts
  allLocal: boolean;
  /** Session 2F1 (spec §9.2): on the POS app with bridge v2, the worst state among its printers this device prints. */
  worst?: PrinterStatus;
}

const NO_DOT: PrinterDot = { show: false };
```

Replace it with:

```ts
  allLocal: boolean;
  /** Session 2F1 (spec §9.2): on the POS app with bridge v2, the worst state among its printers this device prints. */
  worst?: PrinterStatus;
  /** Session 3B (spec §10): the worst problem the app says of one of them (out of paper, cover open, an error), by name. */
  problem?: { name: string; problem: PrinterProblem };
}

const NO_DOT: PrinterDot = { show: false };
```

In `apps/cafe/lib/printer/printer-dot.ts`, find:

```ts
function printersRow(printers: PrinterDotPrinters, lane: DotLane, local: PrinterStatus, desktopChosen: DesktopChosen): PrinterDot {
  if (!printers.isWriter) return dot("printers-elsewhere");
  if (!printers.allLocal) return dot("printer-not-here");
  return noHostRow(lane, printers.worst ?? local, desktopChosen);
}

export function printerDotOf(input: PrinterDotInput): PrinterDot {
```

Replace it with:

```ts
function printersRow(printers: PrinterDotPrinters, lane: DotLane, local: PrinterStatus, desktopChosen: DesktopChosen): PrinterDot {
  if (!printers.isWriter) return dot("printers-elsewhere");
  if (!printers.allLocal) return dot("printer-not-here");
  const row = noHostRow(lane, printers.worst ?? local, desktopChosen);
  // Session 3B (spec §10): every printer answers, but one is out of paper, has its cover open or reports an error.
  if (printers.problem !== undefined && row.show && row.ok) return { show: true, ok: false, reason: "printer-problem", problem: printerProblemText(printers.problem.name, printers.problem.problem) };
  return row;
}

export function printerDotOf(input: PrinterDotInput): PrinterDot {
```

In `apps/cafe/lib/printer/printer-dot.ts`, find:

```ts
export const PRINTER_BUTTON_NAME_BAD = "Printer not connected — open printer setup";
export const PRINTER_BUTTON_NAME_NONE = "Open printer setup";
export const PRINTER_BUTTON_NAME_CHECKING = "Checking the printer — open printer setup";

// "Checking" is neither good nor bad yet (a printer that is only connecting): the
// header button gets its own name and no dot, so it never reads red or "not connected".
export function printerButtonName(dotState: PrinterDot): string {
  if (!dotState.show) return PRINTER_BUTTON_NAME_NONE;
  if (dotState.reason === "checking") return PRINTER_BUTTON_NAME_CHECKING;
  return dotState.ok ? PRINTER_BUTTON_NAME_OK : PRINTER_BUTTON_NAME_BAD;
}
```

Replace it with:

```ts
export const PRINTER_BUTTON_NAME_BAD = "Printer not connected — open printer setup";
export const PRINTER_BUTTON_NAME_NONE = "Open printer setup";
export const PRINTER_BUTTON_NAME_CHECKING = "Checking the printer — open printer setup";
export const PRINTER_BUTTON_NAME_PROBLEM = "Printer needs attention — open printer setup";
const PROBLEM_HEADLINE = "Printer needs attention";

// "Checking" is neither good nor bad yet (a printer that is only connecting): the
// header button gets its own name and no dot, so it never reads red or "not connected".
export function printerButtonName(dotState: PrinterDot): string {
  if (!dotState.show) return PRINTER_BUTTON_NAME_NONE;
  if (dotState.reason === "checking") return PRINTER_BUTTON_NAME_CHECKING;
  if (dotState.reason === "printer-problem") return PRINTER_BUTTON_NAME_PROBLEM;
  return dotState.ok ? PRINTER_BUTTON_NAME_OK : PRINTER_BUTTON_NAME_BAD;
}
```

In `apps/cafe/lib/printer/printer-dot.ts`, find:

```ts
      };
    case "printers-elsewhere":
      return { headline: "Printing is on", detail: "Each slip prints at its printer (Printer setup).", fix: null };
  }
}

export function printerHeadlineOf(dotState: PrinterDot, input: PrinterHeadlineInput): PrinterHeadline {
  if (!dotState.show) return CHECKING_COPY;
  const label = input.hostLabel !== null && input.hostLabel.trim() !== "" ? input.hostLabel.trim() : null;
  return copyFor(dotState.reason, input, label);
}
```

Replace it with:

```ts
      };
    case "printers-elsewhere":
      return { headline: "Printing is on", detail: "Each slip prints at its printer (Printer setup).", fix: null };
    case "printer-problem":
      return { headline: PROBLEM_HEADLINE, detail: "", fix: null };
  }
}

export function printerHeadlineOf(dotState: PrinterDot, input: PrinterHeadlineInput): PrinterHeadline {
  if (!dotState.show) return CHECKING_COPY;
  if (dotState.reason === "printer-problem") return { headline: PROBLEM_HEADLINE, detail: dotState.problem ?? "", fix: null };
  const label = input.hostLabel !== null && input.hostLabel.trim() !== "" ? input.hostLabel.trim() : null;
  return copyFor(dotState.reason, input, label);
}
```

In `packages/shared/src/print-failover.ts`, find:

```ts
  if (!failover.online.some((device) => device.deviceId === writer)) return "device-offline";
  const health = printer.health;
  if (health === undefined || health.deviceId !== writer || failover.nowMs - Date.parse(health.at) > PRINTER_HEALTH_STALE_MS) return null;
  if (health.paper === "out") return "paper-out";
  if (health.cover === "open") return "cover-open";
  if (health.error === true) return "error";
```

Replace it with:

```ts
  if (!failover.online.some((device) => device.deviceId === writer)) return "device-offline";
  const health = printer.health;
  if (health === undefined || health.deviceId !== writer || failover.nowMs - Date.parse(health.at) > PRINTER_HEALTH_STALE_MS) return null;
  return printerHealthProblem(health);
}

/** The worst thing one report says, worst first (Session 3B: also the top-bar dot, from the POS app's own status). */
export function printerHealthProblem(health: Pick<PrinterHealthReport, "link" | "paper" | "cover" | "error">): PrinterProblem | null {
  if (health.paper === "out") return "paper-out";
  if (health.cover === "open") return "cover-open";
  if (health.error === true) return "error";
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-failover.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && cd /d/kd/lucifer/packages/shared && npx tsc --noEmit && echo SHARED_TSC_OK`
Expected: `# tests 14`; `# pass 14`; `# fail 0`; `SHARED_TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-waiting.test.ts lib/printer/printer-dot.test.ts lib/print-agent-printers.test.ts lib/printer-ui-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 103`; `# pass 103`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-waiting.ts components/print/WaitingSlipsCard.tsx hooks/use-print-slip-alarm.ts lib/printer/printer-dot.ts lib/print-agent-printers.ts lib/print-waiting.test.ts lib/printer/printer-dot.test.ts lib/print-agent-printers.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/components/print/WaitingSlipsCard.tsx apps/cafe/hooks/use-print-slip-alarm.ts apps/cafe/lib/print-agent-printers.test.ts apps/cafe/lib/print-agent-printers.ts apps/cafe/lib/print-waiting.test.ts apps/cafe/lib/print-waiting.ts apps/cafe/lib/printer/printer-dot.test.ts apps/cafe/lib/printer/printer-dot.ts packages/shared/src/print-failover.test.ts packages/shared/src/print-failover.ts
git commit -m "feat(print): a printer's problem in its own words: the waiting-slips row and the alarm's notice on every device (re-worded quietly when it changes), and the top-bar dot of the device that prints it (out of paper, cover open, an error) (Phase 3 Session 3B, B4)"
```

---

### Task B5: the Printer setup page's failover words and the backup printer in the form; GO-LIVE-CHECKLIST's Phase 3 page notes

**Files:**
- Modify: `apps/cafe/lib/print-setup-text.ts` (`DEVICE_TAKES_OVER_TEXT`, `PRINTER_NO_TAKEOVER_TEXT`, `printerFailoverLines`), `lib/print-setup-form.ts` (`PrinterDraft.backupPrinterId`, `printerBodyOf`'s `backupPrinterId`, `BACKUP_PRINTER_NOTE`, `backupChoicesOf`)
- Create: `apps/cafe/components/print/setup/BackupPrinterSelect.tsx`; modify `PrinterFormDialog.tsx`, `PrintersSetupSection.tsx`, `DevicesSetupSection.tsx`
- Modify: `docs/GO-LIVE-CHECKLIST.md` ("Existing cafes: printing failover and the backup printer (printing Phase 3)")
- Tests: `apps/cafe/lib/print-setup-form.test.ts` (two tests new), `lib/print-setup-ui-paths.test.ts` (a pin new; the form's budget 250; the files list), `lib/go-live-runbook.test.ts` (a pin new)

**Interfaces produced:** `printerFailoverLines(printer, printers, devices, thisDeviceId, nowMs): string[]`, `DEVICE_TAKES_OVER_TEXT`, `PRINTER_NO_TAKEOVER_TEXT` (`lib/print-setup-text.ts`); `backupChoicesOf(printers, printerId, saved)`, `BACKUP_PRINTER_NOTE`, `PrinterDraft.backupPrinterId` (`lib/print-setup-form.ts`); `BackupPrinterSelect`.

**Each printer row** (from the page's own printers and devices reads; no request): "Backup: ‹name›" ("(not in use)" once that printer stops taking slips); for a printer routing sends slips to, "Printed now by ‹device›" while another device took it over, its writer's problem in its words (its device offline is the row's own state already), and on a network printer with no other device online that can take it over, "No other device online can take it over while its printing device is offline."

**Each device** that can take a network printer over says "Can take over network printers".

**The form's backup printer** ("4. Backup printer"): "No backup printer", or another printer that takes slips (`backupChoicesOf`); a saved backup that stopped taking slips stays offered, marked "(not in use)", so a save keeps it (B0's rule). The body always carries the field: `null` for none (an absent field keeps a saved backup: A3), and `null` for a saved id the form cannot find among the printers (deleted in the instant before the save), never an error. The words under it: "Its waiting slips print there, marked BACKUP PRINTER, while its own device is offline or no device can reach it." The row's on/off switch saves the same body, so it keeps the backup.

**GO-LIVE-CHECKLIST:** "Existing cafes: printing failover and the backup printer (printing Phase 3)": reload every screen after the deploy (what a page from before it does, and its one small extra read per ack, pulse and wake: the 3A gate's m-6); which devices can take a network printer over (the Phase 2 POS app or later, the Windows app from 1.12.0) and the words the setup shows; the backup printer. Session 3G writes the whole Phase 3 release step.

**Changed existing pins:** the setup screens' files list gains `BackupPrinterSelect.tsx`; the printer form's line budget is 250 (was 240).

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
import { PRINT_SETUP_REFRESH_MIN_MS, PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
import { PRINTERS_MAX, PRINTER_COPIES_MAX, PRINTER_COPIES_MIN, STATIONS_MAX } from "@pos/shared/print-printers";
import { SESSION_MAX_AGE_SECONDS, SESSION_REVALIDATE_MS } from "@pos/shared/constants";
import { TOKENS_RELOAD_HINT } from "@/lib/token-settings-notes";

// Doc<->source parity for docs/GO-LIVE-CHECKLIST.md §A "Pinned facts" — an
```

Replace it with:

```ts
import { PRINT_SETUP_REFRESH_MIN_MS, PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
import { PRINTERS_MAX, PRINTER_COPIES_MAX, PRINTER_COPIES_MIN, STATIONS_MAX } from "@pos/shared/print-printers";
import { SESSION_MAX_AGE_SECONDS, SESSION_REVALIDATE_MS } from "@pos/shared/constants";
import { DEVICE_TAKES_OVER_TEXT, PRINTER_NO_TAKEOVER_TEXT } from "@/lib/print-setup-text";
import { BACKUP_PRINTER_NOTE } from "@/lib/print-setup-form";
import { TOKENS_RELOAD_HINT } from "@/lib/token-settings-notes";

// Doc<->source parity for docs/GO-LIVE-CHECKLIST.md §A "Pinned facts" — an
```

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
  assert.ok(step.includes("change it outside service hours"), "the restart time note");
});
```

Replace it with:

```ts
  assert.ok(step.includes("change it outside service hours"), "the restart time note");
});

// ── Printing Phase 3 Session 3B: the page's failover, the backup printer ─────────
test("PIN §1 (printing Phase 3, Session 3B): failover and the backup printer: reload every screen, a second device that can take a printer over, the setup's words verbatim", () => {
  const step = norm(sectionSlice("### Existing cafes: printing failover and the backup printer (printing Phase 3)"));
  assert.ok(step.includes("Reload every POS screen"), "every screen reloaded after the deploy");
  assert.ok(step.includes(norm(DEVICE_TAKES_OVER_TEXT)) && step.includes(norm(PRINTER_NO_TAKEOVER_TEXT)), "the Devices and Printers words, verbatim");
  assert.ok(step.includes(norm(BACKUP_PRINTER_NOTE)), "the form's backup note, verbatim");
  assert.ok(step.includes("Phase 2 POS app") && step.includes("1.12.0"), "which apps can take a network printer over");
});
```

In `apps/cafe/lib/print-setup-form.test.ts`, find:

```ts
  setUpPrintersBody,
} from "@/lib/print-setup-form";
import { connectionText, deviceName, printerRowState, printersLeftEmptyBy, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2D (spec §11): the Printer setup page's pure half: the form, "Set up printers"
```

Replace it with:

```ts
  setUpPrintersBody,
} from "@/lib/print-setup-form";
import { connectionText, deviceName, printerRowState, printersLeftEmptyBy, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import { DEVICE_TAKES_OVER_TEXT, PRINTER_NO_TAKEOVER_TEXT, printerFailoverLines } from "@/lib/print-setup-text";
import { backupChoicesOf } from "@/lib/print-setup-form";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2D (spec §11): the Printer setup page's pure half: the form, "Set up printers"
```

In `apps/cafe/lib/print-setup-form.test.ts`, find:

```ts
  assert.match(hooks, /if \(ref\.leased !== undefined\) deliverLeasedJob\(ref\.leased\);/, "a test slip leased to this tab prints here at once");
});
```

Replace it with:

```ts
  assert.match(hooks, /if \(ref\.leased !== undefined\) deliverLeasedJob\(ref\.leased\);/, "a test slip leased to this tab prints here at once");
});

// Phase 3 Session 3B (spec §9.4, §11): the backup printer in the printer form. "None", or another printer routing sends
// slips to; a saved backup that stopped taking slips stays offered, marked "(not in use)", so a save keeps it; a saved
// id the form cannot find (deleted in the instant before a save) shows as none and is sent as null, never an error.
const B_SLIPS = { bill: true, kotStations: [], kotAll: false, notices: false, eod: false };
function cfg(id: string, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name: id.toUpperCase(), connection: { kind: "lan", host: `10.0.0.${id.length}`, port: 9100 }, primaryDeviceId: `dev-${id}`, order: 0, paper: 80, slips: B_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

test("3B: the form's backup printer: none, or another printer that takes slips; a saved one that stopped is '(not in use)'; one it cannot find is none, sent as null", () => {
  const printers = [cfg("bar"), cfg("counter"), cfg("off", { enabled: false }), cfg("idle", { slips: { ...B_SLIPS, bill: false } })];
  assert.deepEqual(backupChoicesOf(printers, "bar", ""), [{ id: "counter", label: "COUNTER" }], "never itself, never a printer that takes no slips");
  assert.deepEqual(backupChoicesOf(printers, null, ""), [{ id: "bar", label: "BAR" }, { id: "counter", label: "COUNTER" }], "a new printer may pick any");
  assert.deepEqual(backupChoicesOf(printers, "bar", "off"), [{ id: "counter", label: "COUNTER" }, { id: "off", label: "OFF (not in use)" }], "the saved one, switched off since, stays offered so a save keeps it");
  const saved = printerDraftOf({ ...cfg("bar"), backupPrinterId: "counter" }, []);
  assert.equal(saved.backupPrinterId, "counter");
  assert.equal(printerDraftOf(null, []).backupPrinterId, "", "a new printer: none");
  const body = (draft: typeof saved, list: PrinterConfig[] = printers) => {
    const result = printerBodyOf(draft, list, "bar");
    return result.ok ? result.body.backupPrinterId : "refused";
  };
  assert.equal(body(saved), "counter");
  assert.equal(body({ ...saved, backupPrinterId: "" }), null, "none is sent as null (absent would keep a saved backup: A3)");
  assert.equal(body({ ...saved, backupPrinterId: "gone" }), null, "one the form cannot find: none, never an error");
});

test("3B: a printer row says its backup, who prints it now, its problem in its words, and that no device can take it over", () => {
  const NOW = Date.parse("2026-10-07T12:00:00.000Z");
  const devices: PrintDeviceSummary[] = [
    { deviceId: "dev-kitchen", label: "Kitchen tablet", shell: "android", online: false, lastSeenAt: new Date(NOW - 300_000).toISOString(), nativeProtocol: 2, lanFailover: true },
    { deviceId: "dev-counter", label: "Counter tablet", shell: "android", online: true, lastSeenAt: new Date(NOW).toISOString(), nativeProtocol: 2, lanFailover: true },
  ];
  const counter = cfg("counter", { primaryDeviceId: "dev-counter", health: { link: "connected", paper: "out", deviceId: "dev-counter", at: new Date(NOW - 60_000).toISOString() } });
  const kitchen = cfg("kitchen", { primaryDeviceId: "dev-kitchen", backupPrinterId: "counter" });
  const printers = [kitchen, counter];
  assert.deepEqual(printerFailoverLines(kitchen, printers, devices, "me", NOW), ["Backup: COUNTER", "Printed now by Counter tablet …nter"], "the kitchen tablet offline: the counter took its network printer over");
  assert.deepEqual(printerFailoverLines(counter, printers, devices, "me", NOW), ["COUNTER is out of paper.", PRINTER_NO_TAKEOVER_TEXT], "its writer's fresh report; the kitchen tablet, offline, cannot take it over now");
  assert.deepEqual(printerFailoverLines(kitchen, [kitchen, { ...counter, enabled: false }], devices, "me", NOW)[0], "Backup: COUNTER (not in use)", "a backup that stopped taking slips");
  const off = { ...kitchen, enabled: false };
  assert.deepEqual(printerFailoverLines(off, [off, counter], devices, "me", NOW), ["Backup: COUNTER"], "a printer switched off says only its backup");
  assert.equal(DEVICE_TAKES_OVER_TEXT, "Can take over network printers");
});
```

In `apps/cafe/lib/print-setup-ui-paths.test.ts`, find:

```ts
const src = (rel: string): string => stripComments(raw(rel));
const lines = (text: string): number => text.replace(/\n$/, "").split("\n").length;
const SETUP = "components/print/setup/";
const FILES = ["PrintSetupSections.tsx", "PrintersSetupSection.tsx", "PrinterFormDialog.tsx", "SetUpPrintersCard.tsx", "StationsSetupSection.tsx", "DevicesSetupSection.tsx"].map((f) => `${SETUP}${f}`);

test("PIN (2D): the admin Printer setup page shows the outlet's sections after this device's panel", () => {
  const page = src("app/(dashboard)/printers/page.tsx");
```

Replace it with:

```ts
const src = (rel: string): string => stripComments(raw(rel));
const lines = (text: string): number => text.replace(/\n$/, "").split("\n").length;
const SETUP = "components/print/setup/";
const FILES = ["PrintSetupSections.tsx", "PrintersSetupSection.tsx", "PrinterFormDialog.tsx", "SetUpPrintersCard.tsx", "StationsSetupSection.tsx", "DevicesSetupSection.tsx", "BackupPrinterSelect.tsx"].map((f) => `${SETUP}${f}`);

test("PIN (2D): the admin Printer setup page shows the outlet's sections after this device's panel", () => {
  const page = src("app/(dashboard)/printers/page.tsx");
```

In `apps/cafe/lib/print-setup-ui-paths.test.ts`, find:

```ts
  for (const rel of FILES) {
    const text = raw(rel);
    assert.ok(text.startsWith('"use client";'), `${rel} is a client component`);
    // Session 2F1 (deliberate change): the printer form also lists the POS app's printers (bridge v2).
    const budget = rel.endsWith("PrinterFormDialog.tsx") ? 240 : 220;
    assert.ok(lines(text) <= budget, `${rel} stays <= ${budget} lines, got ${lines(text)}`);
    assert.ok(!/console\./.test(text), `${rel} never logs`);
    assert.ok(!/\.mutate\(/.test(src(rel)), `${rel} awaits mutateAsync (a per-call callback fires only for the latest call)`);
  }
});
```

Replace it with:

```ts
  for (const rel of FILES) {
    const text = raw(rel);
    assert.ok(text.startsWith('"use client";'), `${rel} is a client component`);
    // Session 2F1 (deliberate change): the printer form also lists the POS app's printers (bridge v2). Session 3B: 250
    // (was 240), its backup printer.
    const budget = rel.endsWith("PrinterFormDialog.tsx") ? 250 : 220;
    assert.ok(lines(text) <= budget, `${rel} stays <= ${budget} lines, got ${lines(text)}`);
    assert.ok(!/console\./.test(text), `${rel} never logs`);
    assert.ok(!/\.mutate\(/.test(src(rel)), `${rel} awaits mutateAsync (a per-call callback fires only for the latest call)`);
  }
});

// Phase 3 Session 3B (spec §9.3, §9.4, §11): the setup page's failover words and the backup printer in the form.
test("PIN (3B): each printer row shows its failover lines, each device whether it can take a printer over, and the form saves a backup printer", () => {
  const section = src(`${SETUP}PrintersSetupSection.tsx`);
  assert.ok(section.includes("printerFailoverLines(printer, printers, devices, deviceId, Date.now()).map((line) => ("), "the row's backup, who prints it now, its problem, no takeover");
  const devices = src(`${SETUP}DevicesSetupSection.tsx`);
  assert.ok(devices.includes("{device.lanFailover === true && <p className=\"text-brand-muted\">{DEVICE_TAKES_OVER_TEXT}</p>}"), "a device that can take a network printer over says so");
  const form = src(`${SETUP}PrinterFormDialog.tsx`);
  assert.ok(form.includes("<BackupPrinterSelect printerId={printer?.id ?? null} value={draft.backupPrinterId} printers={printers} onChange={(backupPrinterId) => set({ backupPrinterId })} />"), "the backup printer, chosen in the form");
  const select = src(`${SETUP}BackupPrinterSelect.tsx`);
  assert.ok(select.includes("const choices = backupChoicesOf(printers, printerId, value);"), "the choices from the pure lib");
  assert.ok(select.includes("value={choices.some((choice) => choice.id === value) ? value : NONE}"), "a saved backup it cannot find shows as none");
});
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-setup-form.test.ts lib/print-setup-ui-paths.test.ts lib/go-live-runbook.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 121`; `# pass 116`; `# fail 5`

- [ ] **Step 3: The code**

Create `apps/cafe/components/print/setup/BackupPrinterSelect.tsx`:

```tsx
"use client";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BACKUP_PRINTER_NOTE, backupChoicesOf } from "@/lib/print-setup-form";

const NONE = "none";

// Printing redesign, Phase 3 Session 3B (spec §9.4, §11): the printer form's backup printer. None, or another printer
// routing sends slips to; a saved one that stopped taking slips is still offered ("(not in use)") so a save keeps it, and
// a saved one the form cannot find shows as none (the body then sends null).
export function BackupPrinterSelect({ printerId, value, printers, onChange }: { printerId: string | null; value: string; printers: readonly PrinterConfig[]; onChange: (id: string) => void }) {
  const choices = backupChoicesOf(printers, printerId, value);
  return (
    <div className="space-y-1">
      <Select value={choices.some((choice) => choice.id === value) ? value : NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
        <SelectTrigger aria-label="Backup printer" className={PRINTER_INPUT_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No backup printer</SelectItem>
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-brand-muted">{BACKUP_PRINTER_NOTE}</p>
    </div>
  );
}
```

In `apps/cafe/components/print/setup/DevicesSetupSection.tsx`, find:

```tsx
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_DOT_BAD_CLASS, PRINTER_DOT_OK_CLASS } from "@/components/print/printer-classes";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { deviceName } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

interface DevicesSetupSectionProps {
```

Replace it with:

```tsx
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_DOT_BAD_CLASS, PRINTER_DOT_OK_CLASS } from "@/components/print/printer-classes";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { DEVICE_TAKES_OVER_TEXT, deviceName } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

interface DevicesSetupSectionProps {
```

In `apps/cafe/components/print/setup/DevicesSetupSection.tsx`, find:

```tsx
              </span>
            </div>
            <p className="text-brand-muted">{SHELL_WORDS[device.shell]}</p>
            <p className="text-brand-muted">{writes.length > 0 ? `Prints ${writes.join(", ")}` : "Prints no printer"}</p>
          </div>
        );
```

Replace it with:

```tsx
              </span>
            </div>
            <p className="text-brand-muted">{SHELL_WORDS[device.shell]}</p>
            {device.lanFailover === true && <p className="text-brand-muted">{DEVICE_TAKES_OVER_TEXT}</p>}
            <p className="text-brand-muted">{writes.length > 0 ? `Prints ${writes.join(", ")}` : "Prints no printer"}</p>
          </div>
        );
```

In `apps/cafe/components/print/setup/PrinterFormDialog.tsx`, find:

```tsx
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NativePrinterSelect } from "@/components/print/setup/NativePrinterSelect";
import { WindowsPrinterSelect } from "@/components/print/setup/WindowsPrinterSelect";
import { useDevicePrinter, useNativePool, usePrintCapabilities } from "@/hooks/use-device-printer";
```

Replace it with:

```tsx
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BackupPrinterSelect } from "@/components/print/setup/BackupPrinterSelect";
import { NativePrinterSelect } from "@/components/print/setup/NativePrinterSelect";
import { WindowsPrinterSelect } from "@/components/print/setup/WindowsPrinterSelect";
import { useDevicePrinter, useNativePool, usePrintCapabilities } from "@/hooks/use-device-printer";
```

In `apps/cafe/components/print/setup/PrinterFormDialog.tsx`, find:

```tsx
              <Copies label="Bill copies" value={draft.copiesBill} onChange={(copiesBill) => set({ copiesBill })} />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-brand-rule p-3">
            <span className="font-medium">Printer on</span>
            <Switch aria-label="Printer on" checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
```

Replace it with:

```tsx
              <Copies label="Bill copies" value={draft.copiesBill} onChange={(copiesBill) => set({ copiesBill })} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-medium">4. Backup printer</p>
            <BackupPrinterSelect printerId={printer?.id ?? null} value={draft.backupPrinterId} printers={printers} onChange={(backupPrinterId) => set({ backupPrinterId })} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-brand-rule p-3">
            <span className="font-medium">Printer on</span>
            <Switch aria-label="Printer on" checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
```

In `apps/cafe/components/print/setup/PrintersSetupSection.tsx`, find:

```tsx
import { agentPrintersOf, readyPrinterIdsOf } from "@/lib/print-agent-printers";
import { printerStatusOf } from "@/lib/printer/printer-registry";
import { printerBodyOf, printerDraftOf } from "@/lib/print-setup-form";
import { connectionText, printerRowState, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

interface PrintersSetupSectionProps {
```

Replace it with:

```tsx
import { agentPrintersOf, readyPrinterIdsOf } from "@/lib/print-agent-printers";
import { printerStatusOf } from "@/lib/printer/printer-registry";
import { printerBodyOf, printerDraftOf } from "@/lib/print-setup-form";
import { connectionText, printerFailoverLines, printerRowState, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

interface PrintersSetupSectionProps {
```

In `apps/cafe/components/print/setup/PrintersSetupSection.tsx`, find:

```tsx
                <p className="text-brand-muted">
                  Paper {printer.paper} mm · KOT copies {printer.copies.kot} · Bill copies {printer.copies.bill}
                </p>
                {switchingOff === printer.id ? (
                  <InlineConfirm
                    question={`Switch ${printer.name} off? Slips still waiting for it will show under Couldn't print.`}
```

Replace it with:

```tsx
                <p className="text-brand-muted">
                  Paper {printer.paper} mm · KOT copies {printer.copies.kot} · Bill copies {printer.copies.bill}
                </p>
                {/* Session 3B (spec §9.3, §9.4, §10): its backup, who prints it now, its problem, no takeover. */}
                {printerFailoverLines(printer, printers, devices, deviceId, Date.now()).map((line) => (
                  <p key={line} className="text-brand-muted">
                    {line}
                  </p>
                ))}
                {switchingOff === printer.id ? (
                  <InlineConfirm
                    question={`Switch ${printer.name} off? Slips still waiting for it will show under Couldn't print.`}
```

In `apps/cafe/lib/print-setup-form.ts`, find:

```ts
  copiesKot: number;
  copiesBill: number;
  enabled: boolean;
}

/** This device's own printer as a printer's connection (spec §11 "This device"), or null when it has none the agent
```

Replace it with:

```ts
  copiesKot: number;
  copiesBill: number;
  enabled: boolean;
  /** Session 3B (spec §9.4): the backup printer's id, "" for none. */
  backupPrinterId: string;
}

/** This device's own printer as a printer's connection (spec §11 "This device"), or null when it has none the agent
```

In `apps/cafe/lib/print-setup-form.ts`, find:

```ts
      copiesKot: 1,
      copiesBill: 1,
      enabled: true,
    };
  }
  const known = new Set(stations.map((station) => station.id));
```

Replace it with:

```ts
      copiesKot: 1,
      copiesBill: 1,
      enabled: true,
      backupPrinterId: "",
    };
  }
  const known = new Set(stations.map((station) => station.id));
```

In `apps/cafe/lib/print-setup-form.ts`, find:

```ts
    copiesKot: printer.copies.kot,
    copiesBill: printer.copies.bill,
    enabled: printer.enabled,
  };
}
```

Replace it with:

```ts
    copiesKot: printer.copies.kot,
    copiesBill: printer.copies.bill,
    enabled: printer.enabled,
    backupPrinterId: printer.backupPrinterId ?? "",
  };
}
```

In `apps/cafe/lib/print-setup-form.ts`, find:

```ts
    slips: { bill: draft.bill, kotStations: draft.kotAll ? [] : [...draft.kotStations], kotAll: draft.kotAll, notices: draft.notices, eod: draft.eod },
    copies: { kot: copiesOf(draft.copiesKot), bill: copiesOf(draft.copiesBill) },
    enabled: draft.enabled,
  };
  const clash = printerWriterClash(printers, { connection, primaryDeviceId, enabled: draft.enabled, slips: body.slips }, editingId);
  if (clash !== null) return { ok: false, error: printerClashMessage(clash, { connection }) };
```

Replace it with:

```ts
    slips: { bill: draft.bill, kotStations: draft.kotAll ? [] : [...draft.kotStations], kotAll: draft.kotAll, notices: draft.notices, eod: draft.eod },
    copies: { kot: copiesOf(draft.copiesKot), bill: copiesOf(draft.copiesBill) },
    enabled: draft.enabled,
    // Session 3B (spec §9.4): null for none (an absent field keeps a saved backup, A3), and for one the form cannot find
    // among the printers (deleted in the instant before this save): never an error.
    backupPrinterId: draft.backupPrinterId !== "" && draft.backupPrinterId !== editingId && printers.some((printer) => printer.id === draft.backupPrinterId) ? draft.backupPrinterId : null,
  };
  const clash = printerWriterClash(printers, { connection, primaryDeviceId, enabled: draft.enabled, slips: body.slips }, editingId);
  if (clash !== null) return { ok: false, error: printerClashMessage(clash, { connection }) };
```

In `apps/cafe/lib/print-setup-form.ts`, find:

```ts
    if (other !== undefined) return { ok: false, error: onePrinterAppMessage(other.name) };
  }
  return { ok: true, body };
}

/** Spec §6.6 "Set up printers": this device's printer becomes Printer 1 with Bill, Full KOT copy, Notices and End
```

Replace it with:

```ts
    if (other !== undefined) return { ok: false, error: onePrinterAppMessage(other.name) };
  }
  return { ok: true, body };
}

/** Session 3B (spec §9.4, §11): the form's words under the backup printer. */
export const BACKUP_PRINTER_NOTE = "Its waiting slips print there, marked BACKUP PRINTER, while its own device is offline or no device can reach it.";

/** Session 3B (spec §9.4): the backup printers the form offers: every other printer routing sends slips to, and the one
 *  already saved (`saved`) when it has stopped taking slips since, marked "(not in use)", so a save keeps it. */
export function backupChoicesOf(printers: readonly PrinterConfig[], printerId: string | null, saved: string): Array<{ id: string; label: string }> {
  const choices = routablePrinters(printers)
    .filter((printer) => printer.id !== printerId)
    .map((printer) => ({ id: printer.id, label: printer.name }));
  const kept = saved === "" || choices.some((choice) => choice.id === saved) ? undefined : printers.find((printer) => printer.id === saved && printer.id !== printerId);
  return kept === undefined ? choices : [...choices, { id: kept.id, label: `${kept.name} (not in use)` }];
}

/** Spec §6.6 "Set up printers": this device's printer becomes Printer 1 with Bill, Full KOT copy, Notices and End
```

In `apps/cafe/lib/print-setup-text.ts`, find:

```ts
import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import {
  defaultBillPrinterOf,
  printerTakesSlips,
```

Replace it with:

```ts
import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { printerActiveWriter, printerProblemOf, printerProblemText, type PrinterFailover } from "@pos/shared/print-failover";
import {
  defaultBillPrinterOf,
  printerTakesSlips,
```

In `apps/cafe/lib/print-setup-text.ts`, find:

```ts
  return here.ownState === true ? `Connect ${printer.name} on this device to test it.` : "Connect this device's printer to test it.";
}

/** The toast after a Test print: said plainly when its printing device is away (its slip waits for it). */
export function testPrintSentText(printer: PrinterConfig, state: { tone: PrinterRowTone; text: string }): string {
  const sent = `Test slip sent to ${printer.name}.`;
```

Replace it with:

```ts
  return here.ownState === true ? `Connect ${printer.name} on this device to test it.` : "Connect this device's printer to test it.";
}

/** Session 3B (spec §9.3, §11): what the Devices section says of a device that can take a network printer over. */
export const DEVICE_TAKES_OVER_TEXT = "Can take over network printers";
/** Session 3B: a network printer row with no other device online that could take it over. */
export const PRINTER_NO_TAKEOVER_TEXT = "No other device online can take it over while its printing device is offline.";

/** Session 3B: who is online, from the devices read the page already made (no request of its own). */
function setupFailoverOf(devices: readonly PrintDeviceSummary[], nowMs: number): PrinterFailover {
  return { online: devices.filter((device) => device.online).map((device) => ({ deviceId: device.deviceId, lanFailover: device.lanFailover === true })), nowMs };
}

/** Session 3B (spec §9.3, §9.4, §10): a printer row's failover lines: its backup ("(not in use)" once it stops taking
 *  slips), and for a printer routing sends slips to, who prints it now when another device took it over, the problem
 *  its writer reported (its device offline is the row's own state), and a network printer no other device online could
 *  take over. */
export function printerFailoverLines(printer: PrinterConfig, printers: readonly PrinterConfig[], devices: readonly PrintDeviceSummary[], thisDeviceId: string, nowMs: number): string[] {
  const lines: string[] = [];
  const backup = printer.backupPrinterId === undefined ? undefined : printers.find((row) => row.id === printer.backupPrinterId);
  if (backup !== undefined) lines.push(`Backup: ${backup.name}${routablePrinterOf(printers, backup.id) === null ? " (not in use)" : ""}`);
  if (routablePrinterOf(printers, printer.id) === null) return lines;
  const failover = setupFailoverOf(devices, nowMs);
  const writer = printerActiveWriter(printer, failover);
  if (writer !== null && writer !== printerWriterDeviceId(printer)) lines.push(`Printed now by ${deviceName(writer, devices, thisDeviceId)}`);
  const problem = printerProblemOf(printer, failover);
  if (problem !== null && problem !== "device-offline") lines.push(printerProblemText(printer.name, problem));
  const others = failover.online.some((device) => device.lanFailover && device.deviceId !== printer.primaryDeviceId);
  if (printer.connection.kind === "lan" && !others) lines.push(PRINTER_NO_TAKEOVER_TEXT);
  return lines;
}

/** The toast after a Test print: said plainly when its printing device is away (its slip waits for it). */
export function testPrintSentText(printer: PrinterConfig, state: { tone: PrinterRowTone; text: string }): string {
  const sent = `Test slip sent to ${printer.name}.`;
```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
- [ ] **The daily restart time** (same page): change it outside service hours.
      A change during service can repeat or skip tonight's token, kitchen
      ticket and bill numbers.

---
```

Replace it with:

```markdown
- [ ] **The daily restart time** (same page): change it outside service hours.
      A change during service can repeat or skip tonight's token, kitchen
      ticket and bill numbers.

### Existing cafes: printing failover and the backup printer (printing Phase 3)

From this release a phone or tablet can print another device's network printer
while that device is offline or cannot reach it, every device says why a slip
waits ("Kitchen is out of paper."), and a printer can have a backup printer. The
full Phase 3 release step (the new apps, the real-printer checks) comes with the
Phase 3 release; these notes cover the web part.

- [ ] **Reload every POS screen** after the deploy: Refresh in the POS app,
      reload each browser tab, quit and reopen the Windows app. A page from
      before it prints exactly as before, but never takes another device's
      printer over and never reports a printer's state; until it reloads, its
      acks, pulse and wake each cost one small extra database read.
- [ ] **Who can take a network printer over:** a phone or tablet with the
      Phase 2 POS app (or later) that prints at least one printer of the setup
      (the Windows app from 1.12.0). **Admin → Printer setup → Devices** shows
      "Can take over network printers" under each one. A network printer with
      none online says "No other device online can take it over while its
      printing device is offline." Each such device adds every network printer
      to its POS app by itself (Other printers on this device says why); there is
      nothing to set up.
- [ ] **A backup printer** (optional): **Admin → Printer setup → Edit** a
      printer → **4. Backup printer**. The form says it: "Its waiting slips
      print there, marked BACKUP PRINTER, while its own device is offline or no
      device can reach it." The backup must be switched on and take slips; the
      row then shows "Backup: ‹name›".

---
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-setup-form.test.ts lib/print-setup-ui-paths.test.ts lib/go-live-runbook.test.ts lib/print-setup-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 139`; `# pass 139`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx eslint lib/print-setup-form.ts lib/print-setup-text.ts components/print/setup/BackupPrinterSelect.tsx components/print/setup/PrinterFormDialog.tsx components/print/setup/PrintersSetupSection.tsx components/print/setup/DevicesSetupSection.tsx lib/print-setup-form.test.ts lib/print-setup-ui-paths.test.ts lib/go-live-runbook.test.ts && echo LINT_OK`
Expected: `LINT_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/components/print/setup/BackupPrinterSelect.tsx apps/cafe/components/print/setup/DevicesSetupSection.tsx apps/cafe/components/print/setup/PrinterFormDialog.tsx apps/cafe/components/print/setup/PrintersSetupSection.tsx apps/cafe/lib/go-live-runbook.test.ts apps/cafe/lib/print-setup-form.test.ts apps/cafe/lib/print-setup-form.ts apps/cafe/lib/print-setup-text.ts apps/cafe/lib/print-setup-ui-paths.test.ts docs/GO-LIVE-CHECKLIST.md
git commit -m "feat(print): the Printer setup page's failover words and the backup printer: each row says its backup, who prints it now, its problem and when no device can take it over; each device whether it can; the form saves a backup (null for none); GO-LIVE-CHECKLIST's Phase 3 page notes (Phase 3 Session 3B, B5)"
```

---

### Task B6: full verification, the exit (headless Chrome, then the emulator), the fresh review, Results

**Files:** this plan (a new "Session 3B Results" section at its end), nothing else. Every tool below goes in this session's scratchpad, never in the repo.

- [ ] **Step 1: every suite, once each, in the background, one after another** (run `df -h /d /c` first)

Run, from `/d/kd/lucifer` (the totals the pre-validation saw on the golden tree):

| Run | Expected |
|---|---|
| `cd packages/shared && npm test && npx tsc --noEmit` | `# tests 821`, `# pass 821`, `# fail 0`; tsc 0 |
| `cd apps/cafe && npm test` | `# tests 5010`, `# pass 5009`, `# fail 0`, `# skipped 1` (go-live-dl) |
| `npx tsc --noEmit` and `npm run lint` in each of `apps/cafe`, `apps/hub`, `apps/mobile`; `npm run typecheck` and `npm run lint` in `apps/desktop` | 0, and 0 errors (the 2 old warnings, `lib/masters-blob.test.ts:331`) |
| `cd apps/mobile && npm test && npm run test:app` | 125/125; Jest 3/3 (no app change) |
| `cd apps/desktop && npm test` | 192/192 |
| `npm run test:print-tools` | 8/8 |
| `cd apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_3b npm run verify:print:live` | `435 passed, 0 failed` = 419 + bb 2 (B0) + bd 14 (B1) |

- [ ] **Step 2: the Next production build on the repo (D:)**

Run: `df -h /d` (a build needs ~1.5 GB free), then `cd apps/cafe && npm run build`.
Expected: exit 0, 132 routes (3B adds none; count the lines between "Route (app)" and "First Load JS shared" with awk).

- [ ] **Step 3: no app, desktop or Worker change**

Run: `git diff --stat c08abfc..HEAD -- apps/mobile apps/desktop workers`
Expected: empty. The APKs (arm64 `b10feedb…`, armv7 `86b7ff13…`, x86_64 `3736540b…`) and `POS-Software-Setup-1.11.0.exe` (`348aebe1…`) stay as Phase 2 built them.

- [ ] **Step 4: the exit on headless Chrome with two fake POS apps (spec §14's Phase 3 row, the page's part)**

**The harness** (as the 3A review gate ran it; check `netstat -ano | grep LISTEN` for 3110, 3200, 3201 and 9100–9102 first, and never stop another session's server):
- **The database:** a fresh `pos_scratch_e2e_3bx`. Copy Session 3A's env file (`C:\Users\KARTIK~1.DES\AppData\Local\Temp\claude\d--kd-lucifer\0c228c3b-4e02-4a83-a8a7-f2889fdd14e6\scratchpad\e2e.env`) into this session's scratchpad as `e2e.env` (for `type-secret.py`) and as `e2e3b.env` with only `MONGODB_URI` changed to `mongodb://127.0.0.1:27017/pos_scratch_e2e_3bx` (a Python script that never prints a value). Seed it from `apps/cafe`: `node --env-file=<scratchpad>/e2e3b.env --import tsx scripts/seed-admin.ts`, then `seed-tables.ts`, then `seed-menu.ts`. Copy `ui.py` and `type-secret.py` from the same 3A scratchpad, and `p3a-proxy.mjs` (the counting proxy that also logs the pulse's `tokens=`).
- **The servers** (each a background command with `timeout: 7200000`): this branch's Step 2 build, `cd /d/kd/lucifer/apps/cafe && node --env-file=<scratchpad>/e2e3b.env ../../node_modules/next/dist/bin/next start -p 3110`; the proxy, `node <scratchpad>/p3a-proxy.mjs --listen 3200 --target 3110 --log <scratchpad>/proxy3b.jsonl`; three fake printers from the repo root, `node scripts/fake-escpos-printer.mjs --port <p> --out <scratchpad>\fake3b-<p>` for 9100 (the kitchen's network printer), 9101 (the bar's) and 9102 (the dessert "Bluetooth" printer of device A), each `--out` a long Windows path (`C:\Users\Kartik.desai\…`, never the `KARTIK~1.DES` short form).
- **The tools**, saved with the Write tool exactly as shown: `pw-3b.mjs` (two fake POS apps on bridge v2: device A's app starts with the dessert Bluetooth printer, which prints over TCP to 9102; device B's app starts empty; every print goes over real TCP to the fake printers; per app, printers it cannot reach and a printer's paper, cover and error in its v2 status; a printer out of paper refuses BUSY before any byte, so its slip waits) and `jobs3b.mjs` (the newest jobs, the printers' skips and the devices, no payload). Each runs from `apps/cafe` as `MSYS_NO_PATHCONV=1 node --env-file=<scratchpad>/e2e3b.env <scratchpad>/<tool> <scenario>`, where `<scratchpad>` is the Windows form (`pwd -W`). Locally there is no realtime Worker, so a device hears of a slip aimed at it by its wake (3 s after a job for 2 minutes, else 15 s) or its pulse (20 s): the times below are the harness's, not a cafe's with the Worker.

`<scratchpad>/pw-3b.mjs`:

```js
// The 3A review gate's pre-run of Session 3B's exit (scratchpad only; never in the repo; grown from Session 2F1's
// pw-2f.mjs). Two fake POS apps on bridge v2 (device A and device B), each a headless desktop Chrome with its own
// persistent profile (its own device id) and a fake window.PosNative injected before any page script. Every print goes
// over real TCP to the fake ESC/POS printers (127.0.0.1:9100 kitchen, 9101 bar, 9102 the dessert "Bluetooth" printer),
// so their jobs.log is the paper. Per app: `blocked` (printers this app cannot reach: connect and probe fail) and a
// printer's paper/cover/error (the v2 status Session 3C's app will send; a printer out of paper refuses BUSY, before any
// byte, so its slip waits). Signs in as the e2e admin with a session minted from the env file's AUTH_SECRET (never
// printed); never prints a secret, a token or a payload. Run from apps/cafe:
//   MSYS_NO_PATHCONV=1 node --env-file=<scratchpad>/e2e3b.env <scratchpad>/pw-3b.mjs <scenario>
// PW_BASE (default http://localhost:3200, the counting proxy) is where the pages and the API calls go.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.cwd(), "package.json"));
const mongoose = require("mongoose");
const { encode } = require("next-auth/jwt");
const pwRequire = createRequire("C:/Users/Kartik.desai/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/package.json");
const { chromium } = pwRequire("playwright-core");

const BASE = process.env.PW_BASE ?? "http://localhost:3200";
const COOKIE = "authjs.session-token";
const LOG = path.join(HERE, "pw-3b.jsonl");
const DEVICES = path.join(HERE, "pw-3b-devices.json");
const SHOTS = path.join(HERE, "shots3b");
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const say = (...parts) => console.log(`[${ts()}]`, ...parts);
const log = (entry) => appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString().slice(11, 23), ...entry })}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── the database (reads only, plus the admin session) ──
const uri = process.env.MONGODB_URI ?? "";
if (!/\/pos_scratch_e2e_3b[a-z0-9_]*$/.test(uri)) throw new Error("refusing: not pos_scratch_e2e_3b");
await mongoose.connect(uri);
const db = mongoose.connection.db;
const staff = await db.collection("staffs").findOne({ username: "e2eadmin" }, { projection: { name: 1, role: 1 } });
if (staff === null) throw new Error("e2eadmin not found");
const token = await encode({ token: { name: staff.name, id: String(staff._id), role: staff.role, lastValidated: Date.now() }, secret: process.env.AUTH_SECRET, salt: COOKIE });
const api = async (method, url, body) => {
  const res = await fetch(`${BASE}${url}`, { method, headers: { "content-type": "application/json", cookie: `${COOKIE}=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const jobs = () => db.collection("printjobs").find({}).sort({ createdAt: 1, _id: 1 }).toArray();
const device = (id) => db.collection("printdevices").findOne({ deviceId: id });
const printerByName = (name) => db.collection("printers").findOne({ name });
const short = (id) => (id ?? "").slice(-4);

// ── the fake printers' paper ──
const PORTS = { 9100: "fake3b-9100", 9101: "fake3b-9101", 9102: "fake3b-9102" };
const paper = (port) => {
  const file = path.join(HERE, PORTS[port], "jobs.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l)).filter((j) => (j.bytes ?? 0) > 0);
};

// ── a fake POS app on bridge v2 (node side) ──
function fakeApp(name, initial) {
  const app = { name, printers: initial.printers.map((p) => ({ ...p })), defaultId: initial.defaultId, blocked: new Set(), page: null, prints: [] };
  const hostPort = (p) => {
    const where = p.tcpAt ?? p.id.slice("tcp:".length);
    const cut = where.lastIndexOf(":");
    const host = where.slice(0, cut);
    // The emulator's 10.0.2.2 is this PC's loopback: the headless fake app reaches the same fake printer there.
    return { host: host === "10.0.2.2" ? "127.0.0.1" : host, port: Number(where.slice(cut + 1)) };
  };
  const entryOf = (p) => ({
    state: p.state,
    printer: { id: p.id, name: p.name, transport: p.transport, address: p.address, ...(p.transport === "bt-classic" ? { paired: true } : {}) },
    ...(p.paper !== undefined ? { paper: p.paper } : {}),
    ...(p.cover !== undefined ? { cover: p.cover } : {}),
    ...(p.error === true ? { error: true } : {}),
  });
  app.poolStatus = () => ({ printers: app.printers.map(entryOf), defaultId: app.defaultId, bluetooth: "on" });
  const defaultStatus = () => {
    const p = app.printers.find((x) => x.id === app.defaultId);
    return p === undefined ? { state: "none", printer: null, bluetooth: "on" } : { ...entryOf(p), bluetooth: "on" };
  };
  const coded = (code, message) => ({ __error: { code, message } });
  const tcp = (p, bytes) =>
    new Promise((resolve) => {
      if (app.blocked.has(p.id)) return void setTimeout(() => resolve(false), 300);
      const { host, port } = hostPort(p);
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 2000);
      socket.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        if (bytes === null) socket.end(() => resolve(true));
        else socket.end(bytes, () => resolve(true));
      });
    });
  app.emit = () => {
    if (app.page === null) return;
    app.page.evaluate(([one, two]) => window.__fakeAppDeliver(one, two), [defaultStatus(), app.poolStatus()]).catch(() => undefined);
  };
  app.probe = async (p) => {
    const state = (await tcp(p, null)) ? "connected" : "disconnected";
    if (p.state !== state) {
      p.state = state;
      app.emit();
    }
  };
  app.set = (id, patch) => {
    const p = app.printers.find((x) => x.id === id);
    if (p === undefined) return;
    Object.assign(p, patch);
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete p[key];
    app.emit();
  };
  const add = (target) => {
    const id = target.id ?? `tcp:${target.tcp.host}:${target.tcp.port}`;
    let p = app.printers.find((x) => x.id === id);
    if (p === undefined) {
      const { host, port } = hostPort({ id });
      p = { id, name: `Network printer ${host}:${port}`, transport: "tcp", address: `${host}:${port}`, state: "connecting" };
      app.printers.push(p);
    }
    return p;
  };
  const print = async (id, data) => {
    const p = app.printers.find((x) => x.id === id);
    if (p === undefined) return coded("NOT_CONNECTED", "The printer is not connected.");
    // A printer that says it is out of paper refuses before any byte (the slip waits, so every device sees the row).
    if (p.paper === "out") {
      log({ app: name, print: id, refused: "BUSY (paper out)" });
      return coded("BUSY", "The printer is busy.");
    }
    const bytes = Buffer.from(data, "base64");
    const ok = await tcp(p, bytes);
    app.prints.push({ at: ts(), id, bytes: bytes.length, ok });
    log({ app: name, print: id, bytes: bytes.length, ok });
    if (!ok) {
      if (p.state !== "disconnected") {
        p.state = "disconnected";
        app.emit();
      }
      return coded("NOT_CONNECTED", "The printer is not connected.");
    }
    if (p.state !== "connected") {
      p.state = "connected";
      app.emit();
    }
    return { bytes: bytes.length };
  };
  app.handle = async (method, params, version) => {
    log({ app: name, method, version, printerId: params?.printerId ?? params?.id ?? (params?.tcp ? `tcp:${params.tcp.host}:${params.tcp.port}` : undefined) });
    if (version === 2) {
      if (method === "printer.status") return app.poolStatus();
      if (method === "printer.select") {
        const p = add(params);
        app.defaultId ??= p.id;
        await app.probe(p);
        app.emit();
        return app.poolStatus();
      }
      if (method === "printer.reconnect") {
        const p = app.printers.find((x) => x.id === params.printerId);
        if (p !== undefined) await app.probe(p);
        return app.poolStatus();
      }
      if (method === "printer.forget") {
        app.printers = app.printers.filter((x) => x.id !== params.printerId);
        if (app.defaultId === params.printerId) app.defaultId = app.printers[0]?.id ?? null;
        app.emit();
        return app.poolStatus();
      }
      if (method === "printer.print") return print(params.printerId, params.data);
      return coded("BAD_REQUEST", "bad request");
    }
    switch (method) {
      case "app.info":
        return { app: "pos-mobile", appVersion: "fake-3b", platform: "android", transports: ["bt-classic", "ble", "tcp", "usb"] };
      case "printer.status":
        return defaultStatus();
      case "printer.list":
        return { printers: [] };
      case "printer.reconnect": {
        const p = app.printers.find((x) => x.id === app.defaultId);
        if (p !== undefined) await app.probe(p);
        return defaultStatus();
      }
      case "printer.print":
        return app.defaultId === null ? coded("NOT_CONNECTED", "The printer is not connected.") : print(app.defaultId, params.data);
      case "permissions.request":
        return { granted: true };
      case "bluetooth.enable":
        return { on: true };
      case "host.background":
        return { active: params.active === true };
      default:
        return null;
    }
  };
  // The app's own reconnect loop: a down printer is probed every 3 s (the real app: 2 s, 5 s, 10 s, then 30 s).
  app.loop = setInterval(() => {
    for (const p of app.printers) if (p.state !== "connected") void app.probe(p);
  }, 3000);
  return app;
}

// ── a page as that app ──
async function open(app, profile, url = "/pos") {
  const context = await chromium.launchPersistentContext(path.join(HERE, `pw-3b-${profile}`), {
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    viewport: { width: 1280, height: 1000 },
  });
  await context.addCookies([{ name: COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await context.exposeBinding("__fakeApp", (_source, method, params, version) => app.handle(method, params, version));
  await context.addInitScript(() => {
    const listeners = { 1: new Map(), 2: new Map() };
    const call = async (method, params, version) => {
      const result = await window.__fakeApp(String(method), params ?? null, version === 2 ? 2 : 1);
      if (result !== null && typeof result === "object" && result.__error) throw Object.assign(new Error(result.__error.message), { code: result.__error.code });
      return result;
    };
    const api = {
      version: 1,
      versions: Object.freeze([1, 2]),
      platform: "android",
      request: (method, params, version) => call(method, params, version),
      on: (event, fn, version) => {
        const v = version === 2 ? 2 : 1;
        const set = listeners[v].get(event) ?? new Set();
        listeners[v].set(event, set);
        const entry = { fn };
        set.add(entry);
        return () => set.delete(entry);
      },
    };
    window.__fakeAppDeliver = (one, two) => {
      for (const entry of listeners[1].get("printer.status") ?? []) entry.fn(one);
      for (const entry of listeners[2].get("printer.status") ?? []) entry.fn(two);
    };
    Object.defineProperty(window, "PosNative", { value: Object.freeze(api), writable: false, configurable: false });
    window.ReactNativeWebView = { postMessage: () => undefined };
  });
  const page = context.pages()[0] ?? (await context.newPage());
  app.page = page;
  app.context = context;
  app.errors = [];
  page.on("pageerror", (e) => app.errors.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  app.deviceId = await page.evaluate(() => window.localStorage.getItem("pos.device-id.v1"));
  say(`${app.name} open as device …${short(app.deviceId)}`);
  return page;
}

// A plain browser tab (no POS app): an ordering device that prints nothing.
async function openPlain(name, profile) {
  const context = await chromium.launchPersistentContext(path.join(HERE, `pw-3b-${profile}`), {
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    viewport: { width: 1280, height: 1000 },
  });
  await context.addCookies([{ name: COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${BASE}/pos`, { waitUntil: "networkidle" });
  const app = { name, page, context, errors: [], deviceId: await page.evaluate(() => window.localStorage.getItem("pos.device-id.v1")) };
  say(`${name} (a plain browser tab) open as device …${short(app.deviceId)}`);
  return app;
}

async function close(app) {
  app.page = null;
  await app.context?.close().catch(() => undefined);
  app.context = null;
  say(`${app.name} closed (its page stopped)`);
}

async function order(app, items) {
  const page = app.page;
  if (!page.url().endsWith("/pos")) await page.goto(`${BASE}/pos`, { waitUntil: "networkidle" });
  for (const item of items) {
    await page.getByRole("button", { name: new RegExp(`^${item}`) }).first().click();
    await page.waitForTimeout(500);
    // A product with modifiers opens its modal first: add it plain.
    const add = page.getByRole("dialog").getByRole("button", { name: /^Add \d/ });
    if ((await add.count()) > 0) await add.first().click();
    await page.waitForTimeout(300);
  }
  await page.getByRole("button", { name: "Send to Kitchen" }).click();
  const at = Date.now();
  say(`${app.name} sent ${items.join(" + ")} to the kitchen`);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => undefined);
  return at;
}

async function until(label, check, timeoutMs, everyMs = 1000) {
  const start = Date.now();
  for (;;) {
    const got = await check();
    if (got) {
      say(`${label}: yes after ${((Date.now() - start) / 1000).toFixed(1)} s`);
      return got;
    }
    if (Date.now() - start > timeoutMs) {
      say(`${label}: NO within ${timeoutMs / 1000} s`);
      return null;
    }
    await sleep(everyMs);
  }
}

const jobAfter = async (sinceMs, printerName) => {
  const printer = await printerByName(printerName);
  return (await jobs()).filter((j) => j.createdAt.getTime() >= sinceMs - 2000 && String(j.printerId) === String(printer?._id ?? ""));
};
const describe = (j) => ({ kind: j.kind, status: j.status, target: short(j.targetDeviceId), labels: j.labels ?? [], log: (j.log ?? []).map((l) => `${l.event}${l.deviceId ? `@${short(l.deviceId)}` : ""}${l.detail ? `(${l.detail})` : ""}`) });

// ── the setup, through the admin API ──
async function stations() {
  return (await api("GET", "/api/stations")).json.data ?? [];
}
async function ensureStation(name) {
  if (!(await stations()).some((s) => s.name === name)) await api("POST", "/api/stations", { name });
  return (await stations()).find((s) => s.name === name);
}
async function routeCategory(category, stationName) {
  const row = await db.collection("categories").findOne({ name: category });
  const station = await ensureStation(stationName);
  return (await api("PUT", `/api/categories/${String(row._id)}`, { name: row.name, stationId: station.id })).status;
}
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
async function savePrinter(body) {
  const existing = ((await api("GET", "/api/printers")).json.data ?? []).find((p) => p.name === body.name);
  const res = existing === undefined ? await api("POST", "/api/printers", body) : await api("PUT", `/api/printers/${existing.id}`, body);
  say(`printer ${body.name}: ${res.status}${res.json.error ? ` ${res.json.error}` : ""}`);
  return res.json.data;
}
async function clearPrinters() {
  for (const p of (await api("GET", "/api/printers")).json.data ?? []) await api("DELETE", `/api/printers/${p.id}`);
}

const devicesFile = () => (existsSync(DEVICES) ? JSON.parse(readFileSync(DEVICES, "utf8")) : {});
const BT_ID = "bt-classic:AA:BB:CC:DD:EE:01";
const appA = () => fakeApp("A", { printers: [{ id: BT_ID, name: "Dessert BT", transport: "bt-classic", address: "AA:BB:CC:DD:EE:01", state: "connected", tcpAt: "127.0.0.1:9102" }], defaultId: BT_ID });
const appB = () => fakeApp("B", { printers: [], defaultId: null });

async function setupPrinters(ids) {
  const kitchen = (await stations()).find((s) => s.isDefault);
  const bar = await ensureStation("Bar");
  const dessert = await ensureStation("Desserts");
  say(`category Beverages -> Bar: ${await routeCategory("Beverages", "Bar")}; Desserts -> Desserts: ${await routeCategory("Desserts", "Desserts")}`);
  await savePrinter({ name: "Kitchen", connection: { kind: "lan", host: "127.0.0.1", port: 9100 }, primaryDeviceId: ids.A, paper: 80, slips: { ...NO_SLIPS, bill: true, kotStations: [kitchen.id], notices: true, eod: true }, copies: { kot: 1, bill: 1 }, enabled: true });
  await savePrinter({ name: "Bar", connection: { kind: "lan", host: "127.0.0.1", port: 9101 }, primaryDeviceId: ids.B, paper: 80, slips: { ...NO_SLIPS, kotStations: [bar.id] }, copies: { kot: 1, bill: 1 }, enabled: true });
  await savePrinter({ name: "Dessert", connection: { kind: "device", deviceId: ids.A, transport: "bt-classic", address: "AA:BB:CC:DD:EE:01" }, paper: 80, slips: { ...NO_SLIPS, kotStations: [dessert.id] }, copies: { kot: 1, bill: 1 }, enabled: true });
}

const showDevices = async (ids) => {
  for (const [name, id] of Object.entries(ids)) {
    const row = await device(id);
    say(`device ${name} …${short(id)}: lanFailover=${row?.capabilities?.lanFailover ?? "absent"} nativeProtocol=${row?.nativeProtocol ?? "-"} tokenSlips=${row?.tokenSlips ?? "-"} seen ${row === null ? "never" : `${((Date.now() - row.lastSeenAt.getTime()) / 1000).toFixed(0)} s ago`}`);
  }
};
const showPrinters = async () => {
  for (const p of await db.collection("printers").find({}).toArray()) {
    say(`printer ${p.name}: backup=${p.backupPrinterId ? short(p.backupPrinterId) : "-"} unreachable=[${(p.unreachable ?? []).map((u) => short(u.deviceId)).join(",")}] health=${p.health ? `${p.health.link}${p.health.paper ? `/${p.health.paper}` : ""}@${short(p.health.deviceId)}` : "-"}`);
  }
};

const [scenario] = process.argv.slice(2);
// On the emulator runs device A has only the network printers the page adds (no Bluetooth dessert printer).
const A = scenario?.startsWith("emu") === true ? fakeApp("A", { printers: [], defaultId: null }) : appA();
const B = appB();
try {
  if (scenario === "init") {
    // Mint each profile's device id (kept in its localStorage), then set the printers up for them.
    await clearPrinters();
    await open(A, "a", "/printers");
    await open(B, "b", "/printers");
    const ids = { A: A.deviceId, B: B.deviceId };
    writeFileSync(DEVICES, JSON.stringify(ids));
    await setupPrinters(ids);
  } else if (scenario === "exit1") {
    // Exit 1 (P3-4): A, the kitchen printer's primary, stops; a slip already waiting prints through B within 60 s of A
    // being seen offline, and every slip made after that prints through B at once.
    const ids = devicesFile();
    await open(A, "a");
    await open(B, "b");
    await sleep(20_000);
    await showDevices(ids);
    say(`A's app: ${A.printers.map((p) => `${p.id}=${p.state}`).join(" ")}; B's app: ${B.printers.map((p) => `${p.id}=${p.state}`).join(" ")}`);
    const base = await order(B, ["Margherita Pizza"]);
    await until("a kitchen slip, both online, printed by A", async () => (await jobAfter(base, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.A), 30_000);
    await close(A);
    const stopped = Date.now();
    const waiting = await order(B, ["Margherita Pizza"]);
    const first = await until("the slip made 1 s after A stopped, printed by B", async () => (await jobAfter(waiting, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.B), 240_000, 2000);
    say(`  that slip printed ${((Date.now() - stopped) / 1000).toFixed(0)} s after A stopped: ${JSON.stringify(first === null ? null : describe(first))}`);
    await until("A seen offline (no heartbeat for 90 s)", async () => (await device(ids.A)).lastSeenAt.getTime() < Date.now() - 90_000, 120_000, 2000);
    const after = await order(B, ["Margherita Pizza"]);
    const made = (await jobAfter(after, "Kitchen"))[0];
    say(`  the next slip, made with A offline: target …${short(made?.targetDeviceId)} (B is …${short(ids.B)})`);
    await until("... printed by B", async () => (await jobAfter(after, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.B), 30_000);
    say(`paper on 9100: ${paper(9100).length} slips; B's prints: ${JSON.stringify(B.prints)}`);
    await showPrinters();
  } else if (scenario === "exit2") {
    // Exit 2 (P3-3): A cannot reach the kitchen printer; its refusal before any byte is acked "unreachable", A is
    // skipped, and B prints the slip within seconds.
    const ids = devicesFile();
    await open(A, "a");
    await open(B, "b");
    await sleep(20_000);
    await showDevices(ids);
    A.blocked.add("tcp:127.0.0.1:9100");
    say("A can no longer reach 127.0.0.1:9100 (its app's connect fails); its app still says connected (its last job reached it)");
    const at = await order(B, ["Margherita Pizza"]);
    const done = await until("the kitchen slip printed by B", async () => (await jobAfter(at, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.B), 90_000);
    say(`  ${JSON.stringify(done === null ? null : describe(done))}`);
    say(`A's prints: ${JSON.stringify(A.prints)}; B's prints: ${JSON.stringify(B.prints)}`);
    await showPrinters();
    await sleep(20_000);
    say("20 s on (A's beats say disconnected: its skip already holds, nothing written):");
    await showPrinters();
  } else if (scenario === "exit3") {
    // Exit 3 (P3-7): B's app says the bar printer is out of paper; a bar slip waits; A's panel row and A's notice (A asked
    // for it) say "Bar is out of paper."
    const ids = devicesFile();
    await open(A, "a");
    await open(B, "b");
    await sleep(20_000);
    B.set("tcp:127.0.0.1:9101", { paper: "out" });
    say("B's app: the bar printer is out of paper (its v2 status says paper: out)");
    await sleep(20_000);
    await showPrinters();
    const at = await order(A, ["Masala Chai"]);
    await until("the bar slip in the waiting-slips feed with problem paper-out", async () => {
      const res = await api("GET", "/api/order-requests/pulse");
      return (res.json.data?.printAttention ?? []).find((r) => r.problem === "paper-out");
    }, 60_000, 3000);
    // The alarm's notice on the page that asked for it, open the whole time (it rings at the first pulse after 20 s).
    await A.page.waitForTimeout(22_000);
    const toasts = await A.page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    say(`A's notices: ${JSON.stringify(toasts.map((t) => t.replace(/\s+/g, " ").slice(0, 160)))}`);
    await A.page.goto(`${BASE}/printers`, { waitUntil: "networkidle" });
    await A.page.waitForTimeout(25_000);
    const panel = await A.page.locator("section[aria-label='Slips waiting']").first().innerText().catch(() => "(no panel)");
    say(`A's panel: ${panel.replace(/\s+/g, " ").slice(0, 300)}`);
    await A.page.screenshot({ path: path.join(SHOTS, "exit3-a-panel.png"), fullPage: true });
    B.set("tcp:127.0.0.1:9101", { paper: "ok" });
    say("B's app: paper back in");
    await until("the bar slip printed by B", async () => (await jobAfter(at, "Bar")).find((j) => j.status === "printed"), 60_000);
  } else if (scenario === "exit4") {
    // Exit 4 (P3-5): the dessert printer (A's Bluetooth printer) gets the bar printer as its backup in the form (on B's
    // page); A's page closed: the waiting dessert slip prints at the bar printer with the BACKUP PRINTER banner.
    const ids = devicesFile();
    await open(A, "a");
    await open(B, "b", "/printers");
    await sleep(15_000);
    await B.page.locator("[data-print-setup]").waitFor({ timeout: 20_000 });
    const row = B.page.locator("[data-printer-row]").filter({ hasText: "Dessert" }).first();
    await row.getByRole("button", { name: "Edit" }).click();
    await B.page.getByLabel("Backup printer").click();
    say(`the form offers: ${JSON.stringify(await B.page.getByRole("option").allInnerTexts())}`);
    await B.page.getByRole("option", { name: "Bar", exact: true }).click();
    await B.page.getByRole("button", { name: "Save printer" }).click();
    await B.page.waitForTimeout(2500);
    say(`the Dessert row: ${(await row.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
    await B.page.screenshot({ path: path.join(SHOTS, "exit4-b-setup.png"), fullPage: true });
    await showPrinters();
    const base = await order(B, ["Cheesecake"]);
    await until("a dessert slip, A online, printed by A on its Bluetooth printer", async () => (await jobAfter(base, "Dessert")).find((j) => j.status === "printed"), 30_000);
    await close(A);
    const stopped = Date.now();
    const at = await order(B, ["Cheesecake"]);
    const moved = await until("the dessert slip printed at the bar printer, labelled BACKUP PRINTER", async () => (await jobAfter(at, "Bar")).find((j) => j.status === "printed"), 240_000, 2000);
    say(`  printed ${((Date.now() - stopped) / 1000).toFixed(0)} s after A stopped: ${JSON.stringify(moved === null ? null : describe(moved))}`);
    const bar = paper(9101);
    say(`paper on 9101: ${bar.length} slips, the last ${bar.at(-1)?.bytes ?? 0} bytes; on 9102 (dessert): ${paper(9102).length}`);
  } else if (scenario === "exit5") {
    // Exit 5: a page from before Phase 3 (A, loaded from the c08abfc build) on the 3B server prints as before and never
    // takes a printer over; run with the c08abfc build on 3110 until the prompt, then the gold build.
    const ids = devicesFile();
    // A fresh setup (no skip or backup left by an earlier item), saved before the old page loads.
    await clearPrinters();
    await setupPrinters(ids);
    await open(A, "a");
    say("A's page is loaded (from whatever build serves 3110 now). Swap the server, then touch the go file.");
    // PW_GO names the file (a fresh name per run: a file left by an earlier run would start it at once).
    const go = path.join(HERE, process.env.PW_GO ?? "pw-3b-go");
    await until("the go file", async () => existsSync(go), 600_000, 2000);
    await sleep(15_000);
    await open(B, "b");
    await sleep(40_000);
    await showDevices(ids);
    const at = await order(B, ["Margherita Pizza"]);
    const done = await until("the kitchen slip printed by A, the old page", async () => (await jobAfter(at, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.A), 60_000);
    say(`  ${JSON.stringify(done === null ? null : describe(done))}`);
    await close(B);
    await until("B seen offline", async () => (await device(ids.B)).lastSeenAt.getTime() < Date.now() - 90_000, 150_000, 3000);
    const bar = await order(A, ["Masala Chai"]);
    await sleep(70_000);
    const waiting = (await jobAfter(bar, "Bar"))[0];
    say(`the bar slip with B offline: target …${short(waiting?.targetDeviceId)} status ${waiting?.status} (A, a page from before Phase 3, never takes it over)`);
    await showDevices(ids);
  } else if (scenario === "emu-setup") {
    // The emulator app (the Phase 2 APK) as device B: the kitchen printer at 10.0.2.2:9100 written by A (headless), the
    // bar printer at 10.0.2.2:9101 written by the emulator (its id from a job it printed itself in simple mode).
    const ids = devicesFile();
    const emu = process.argv[3];
    if (!/^[0-9a-f-]{8,}$/.test(emu ?? "")) throw new Error("emu-setup <the emulator app's device id>");
    const kitchen = (await stations()).find((s) => s.isDefault);
    const bar = await ensureStation("Bar");
    await savePrinter({ name: "Kitchen", connection: { kind: "lan", host: "10.0.2.2", port: 9100 }, primaryDeviceId: ids.A, paper: 80, slips: { ...NO_SLIPS, bill: true, kotStations: [kitchen.id], notices: true, eod: true }, copies: { kot: 1, bill: 1 }, enabled: true });
    await savePrinter({ name: "Bar", connection: { kind: "lan", host: "10.0.2.2", port: 9101 }, primaryDeviceId: emu, paper: 80, slips: { ...NO_SLIPS, kotStations: [bar.id] }, copies: { kot: 1, bill: 1 }, enabled: true });
    writeFileSync(DEVICES, JSON.stringify({ ...ids, EMU: emu }));
  } else if (scenario === "emu1") {
    // Exit step 1 on the emulator: A (headless) stops; the emulator app takes the kitchen printer over.
    const ids = devicesFile();
    await open(A, "a");
    const C = await openPlain("C", "c");
    await sleep(25_000);
    await showDevices({ A: ids.A, EMU: ids.EMU });
    const base = await order(C, ["Margherita Pizza"]);
    await until("a kitchen slip, both online, printed by A", async () => (await jobAfter(base, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.A), 40_000);
    await close(A);
    const stopped = Date.now();
    const waiting = await order(C, ["Margherita Pizza"]);
    const first = await until("the slip made 1 s after A stopped, printed by the emulator", async () => (await jobAfter(waiting, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.EMU), 240_000, 2000);
    say(`  printed ${((Date.now() - stopped) / 1000).toFixed(0)} s after A stopped: ${JSON.stringify(first === null ? null : describe(first))}`);
    await until("A seen offline", async () => (await device(ids.A)).lastSeenAt.getTime() < Date.now() - 90_000, 120_000, 2000);
    const after = await order(C, ["Margherita Pizza"]);
    say(`  the next slip, made with A offline: target …${short((await jobAfter(after, "Kitchen"))[0]?.targetDeviceId)} (the emulator is …${short(ids.EMU)})`);
    await until("... printed by the emulator", async () => (await jobAfter(after, "Kitchen")).find((j) => j.status === "printed" && j.targetDeviceId === ids.EMU), 60_000, 2000);
    say(`paper on 9100: ${paper(9100).length} slips`);
    await showPrinters();
    await close(C);
  } else if (scenario === "emu3") {
    // Exit step 3 on the emulator: A's app says the kitchen printer is out of paper; a kitchen slip waits; the emulator's
    // panel (the other device) says "Kitchen is out of paper." (the gate takes a screencap while this waits).
    const ids = devicesFile();
    await open(A, "a");
    const C = await openPlain("C", "c");
    await sleep(25_000);
    A.set("tcp:10.0.2.2:9100", { paper: "out" });
    say("A's app: the kitchen printer is out of paper");
    await sleep(20_000);
    await showPrinters();
    const at = await order(C, ["Margherita Pizza"]);
    await until("the kitchen slip in the feed with problem paper-out", async () => ((await api("GET", "/api/order-requests/pulse")).json.data?.printAttention ?? []).find((r) => r.problem === "paper-out"), 60_000, 3000);
    say("HOLD: open the emulator's printer panel now (120 s)");
    writeFileSync(path.join(HERE, "pw-3b-hold"), "1");
    await sleep(120_000);
    A.set("tcp:10.0.2.2:9100", { paper: "ok" });
    say("A's app: paper back in");
    await until("the kitchen slip printed by A", async () => (await jobAfter(at, "Kitchen")).find((j) => j.status === "printed"), 60_000);
    await close(C);
  } else {
    throw new Error("scenario: init | exit1 | exit2 | exit3 | exit4 | exit5 | emu-setup | emu1 | emu3");
  }
  for (const app of [A, B]) if ((app.errors ?? []).length > 0) say(`${app.name} page errors: ${JSON.stringify(app.errors.slice(0, 6))}`);
} finally {
  clearInterval(A.loop);
  clearInterval(B.loop);
  await close(A).catch(() => undefined);
  await close(B).catch(() => undefined);
  await mongoose.disconnect();
}
```

`<scratchpad>/jobs3b.mjs`:

```js
// Prints the newest print jobs of pos_scratch_e2e_3b (kind, printer name, target tail, status, labels, log) and the
// printers' Phase 3 fields. No payloads, no secrets. Run from apps/cafe: node --env-file=<env> <this> [n]
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "package.json"));
const mongoose = require("mongoose");
const uri = process.env.MONGODB_URI ?? "";
if (!/\/pos_scratch_e2e_3b[a-z0-9_]*$/.test(uri)) throw new Error("refusing");
await mongoose.connect(uri);
try {
  const db = mongoose.connection.db;
  const printers = await db.collection("printers").find({}).toArray();
  const name = (id) => printers.find((p) => String(p._id) === String(id))?.name ?? (id ? `?${String(id).slice(-4)}` : "-");
  const n = Number(process.argv[2] ?? "6");
  const jobs = await db.collection("printjobs").find({}).sort({ createdAt: -1, _id: -1 }).limit(n).toArray();
  for (const j of jobs.reverse()) {
    console.log(`${j.createdAt.toISOString().slice(11, 19)} ${j.kind} ${name(j.printerId)} target …${(j.targetDeviceId ?? "").slice(-4)} ${j.status} [${(j.labels ?? []).join(",")}] ${(j.log ?? []).map((l) => `${l.event}${l.deviceId ? `@${l.deviceId.slice(-4)}` : ""}`).join(" ")}`);
  }
  for (const p of printers) console.log(`printer ${p.name} ${p.connection?.host ?? p.connection?.transport}:${p.connection?.port ?? ""} primary …${(p.primaryDeviceId ?? p.connection?.deviceId ?? "").slice(-4)} unreachable=[${(p.unreachable ?? []).map((u) => `${u.deviceId.slice(-4)}<${u.until.toISOString().slice(11, 19)}`).join(",")}]`);
  const devs = await db.collection("printdevices").find({}).toArray();
  for (const d of devs) console.log(`device …${d.deviceId.slice(-4)} ${d.shell} lanFailover=${d.capabilities?.lanFailover} seen ${d.lastSeenAt.toISOString().slice(11, 19)}`);
} finally {
  await mongoose.disconnect();
}
```

**The scenarios, in this order** (each `pw-3b.mjs <scenario>`; Expected is the gate's run on the golden build):

| # | Scenario | Expected |
|---|---|---|
| 0 | `init` | both profiles' device ids written to `pw-3b-devices.json`; stations Bar and Desserts; Beverages → Bar, Desserts → Desserts; printers Kitchen (LAN 127.0.0.1:9100, primary A: Kitchen KOTs, Bill, Notices, End of day), Bar (LAN 127.0.0.1:9101, primary B: Bar KOTs) and Dessert (A's Bluetooth `AA:BB:CC:DD:EE:01`: Desserts KOTs), each 201 |
| 1 | `exit1` | A and B: `lanFailover=true nativeProtocol=2 tokenSlips=true`. A's app lists the dessert Bluetooth printer, 9100 and 9101, B's app 9101 and 9100, each connected (each added the other's network printer ahead of time). A kitchen slip with both online: printed by A (≈7 s: no Worker here). A's page closed; the slip made 1 s later is **printed by B 91 s after A stopped** (its log: created, retargeted to B, leased by B, printed by B). A seen offline; the next kitchen slip is made for B (`target` B) and **printed at once** (direct, ≈1 s). Kitchen's health `connected` from B (B writes it now); no skip |
| 2 | `exit2` | A cannot reach 9100 (its app still says connected). B's kitchen slip is leased by A, fails before any byte ("not sent: The printer is not connected…") and is acked `unreachable`: Kitchen's `unreachable` = [A], the slip is retargeted to B and **printed by B** (≈18 s after the order here: B hears of it by its wake or pulse; with the Worker, at once). 20 s on, A's beats ("disconnected") have written nothing more (its skip holds), and Kitchen's health is B's |
| 3 | `exit3` | B's app says the bar printer is out of paper: Bar's health `connected/out` from B. A's Masala Chai waits (B's app refuses it BUSY); ≈21 s later the feed's row has `problem: "paper-out"`. **A's notice: "KOT round 1 · ORD-… · Bar has not printed yet. Bar is out of paper."**; **A's panel row: "… · Bar is out of paper. · Bar"**, with Print now and Clear. Paper back in: printed by B within ≈6 s |
| 4 | `exit4` | On B's page, Printer setup → Dessert → Edit: **4. Backup printer** offers "No backup printer", "Kitchen", "Bar" (never Dessert itself); Bar, Save printer: the row says "Backup: Bar". A dessert slip with A online prints on A's Bluetooth printer (9102). A's page closed; the next dessert slip **prints at the bar printer (9101) 91 s after A stopped, labelled BACKUP PRINTER** (log `retargeted (backup printer: Dessert -> Bar)`): 49,854 B against 44,382 B for an unlabelled KOT (the banner) |
| 5 | `exit5` (a page from before 3B) | A's page loaded from the `c08abfc` build, then the server swapped: A's device row has no `lanFailover` and its pulses carry no `tokens=`; B's kitchen slip **prints at A, the old page** (≈4 s; leased and printed by A). B's page closed and seen offline: A's bar slip **stays B's** (`target` B, queued): a page from before 3B never takes a printer over |

**Exit 5's old page.** It needs a build of `c08abfc` (3A's server and a Phase 2 page) served on 3110 while device A's page loads: `git clone --no-hardlinks /d/kd/lucifer <scratchpad>/build-c08`, `git -C <scratchpad>/build-c08 checkout -q c08abfc`, its `node_modules` from the 3A review gate's `link-modules.ps1` (`C:\Users\KARTIK~1.DES\AppData\Local\Temp\claude\d--kd-lucifer\161a7197-e641-419c-9f2b-3ae304a1631d\scratchpad\link-modules.ps1`) with the `next` junction replaced by a real copy of `D:\kd\lucifer\node_modules\next`, and webpack's persistent cache off in that copy's `apps/cafe/next.config.ts` only (`webpack: (config) => { config.cache = false; return config; },` inside `nextConfig`; a C: build then writes ~27 MB); `npm run build` there. Stop this branch's server, serve `build-c08` on 3110, start `pw-3b.mjs exit5` (it saves a fresh setup, loads A's page and waits for the file `<scratchpad>/pw-3b-go`), stop `build-c08`'s server, serve this branch's build on 3110 again, then create `pw-3b-go`. A's page keeps its old code against the new server: the deploy-skew case.

- [ ] **Step 5: the emulator (the Phase 2 APK, bridge v2): exit steps 1 and 3 with the emulator app as device B**

Set-up:
- `df -h /c /d`. Boot `Pixel_7_API_33` yourself with a 2 h background timeout (`-memory 4096 -no-audio -no-snapshot-save`; 2048 when C: has under ~4 GB free, recorded).
- `adb shell pm path com.possoftware.pos`, and hash the APK on the device. As left by the 3A review gate: the **release APK** (`29115bdf…`), on its start screen with no address. Install the Phase 2 x86_64 APK (`C:\Users\KARTIK~1.DES\AppData\Local\Temp\claude\d--kd-lucifer\980d3189-10f0-4165-bdad-ae814b95278b\scratchpad\apk-gate2\pos-emulator-x86_64-release.apk`, hashed `3736540b…` first) with `adb install -r`.
- **Check which POS the app shows before any tap that writes: never the demo.** A second proxy that logs the pulse's whole `device=` (an opaque id, never a header, body or cookie): `p3a-proxy.mjs` with `return q === null ? null : q.slice(0, 8);` changed to `return q;`, saved as `p3b-proxy.mjs`, on 3201 → 3110 (`--log <scratchpad>/proxy3b-emu.jsonl`); `adb reverse tcp:3100 tcp:3201`. On the start screen type `http://localhost:3100`, Open POS; sign in as `e2eadmin` (the password by `type-secret.py` into a field checked to be a password field; never printed). A session the WebView kept from another database answers 401: Account → Sign out, then sign in.
- Give the app its own printer so its page prints and names itself on the pulse: the printer panel → Network printer `10.0.2.2`, port `9101` → Use this network printer. Its device id is the `device=` of its pulses in `proxy3b-emu.jsonl`. Then `pw-3b.mjs emu-setup <that id>`: Kitchen at `10.0.2.2:9100` (primary A; the headless fake app reaches 10.0.2.2 at 127.0.0.1) and Bar at `10.0.2.2:9101` (primary: the emulator). Close the panel, tap Refresh.
- Before `emu1` and `emu3`, nothing else on 3110 may say `lanFailover` (close every other page).

| # | Step | Expected (the gate's run) |
|---|---|---|
| 1 | `emu1` (A headless, C a plain browser tab that orders) | the emulator's device row: `lanFailover=true nativeProtocol=2`; a kitchen slip with A online is printed by A; A closed: the slip made 1 s later is **printed by the emulator 97 s after A stopped** (on 9100, through 10.0.2.2); the next one is made for the emulator at once and printed (≈12 s here: it heard by its wake); Kitchen's health `connected` from the emulator |
| 3 | `emu3`; at its HOLD, open the emulator's printer panel and take a `screencap` | A's app says the kitchen printer is out of paper (Kitchen's health `connected/out` from A); C's kitchen slip waits; ≈21 s later the feed has `problem: "paper-out"`; **the emulator's panel row: "KOT round 1 · ORD-… · Kitchen", "just now · Kitchen is out of paper. · Kitchen"**, with Print now and Clear (screencap); paper back in: printed by A |
| 4 | `adb logcat -b crash -d` | 0 lines |

Put back:
- the setup cleared (every printer deleted through the API; the scratch database is left);
- the app's printers removed (the panel's Remove, after a Refresh lets the page remove the ones it added);
- the app's address cleared (More options → Change POS address → clear the field: its start screen, no address);
- the **release APK** reinstalled (`29115bdf…`, hashed on the device), as found;
- `adb reverse --remove-all`, then `adb reverse tcp:3100 tcp:3100`;
- `adb shell sync`, then `adb emu kill`;
- your servers stopped by PID after checking each command line.

- [ ] **Step 6: the fresh review**

Dispatch a fresh reviewer subagent on **Claude Fable 5.1** (`model: fable`). It is read-only, with scratch tests only in this session's scratchpad (never in the repo). It reviews `c08abfc..HEAD` against this plan (P3-1 to P3-10 as the 3A review gate changed them, the gate's rulings, Session 3B and its Review Focus, passed verbatim) and spec §9.3, §9.4, §9.8, §10, §11, §17. If Fable is rate-limited (HTTP 429), wait for its reset and say so; never switch models silently. Fix every Critical and Important finding by TDD (RED seen first) in its own commit. List the minors in Results for the 3B review gate.

- [ ] **Step 7: Results, commit, push**

Fill "Session 3B Results" below: the commits; each task's RED and GREEN against the Expected lines; every suite's numbers; the build; the exit tables (headless and emulator); the review and its fixes; deviations and rulings; what is open for the 3B gate.

Commit, then push with the token only: `GIT_TERMINAL_PROMPT=0 git push origin feat/printing-phase-3`. Do not merge, do not deploy.

## Session 3B Results (filled in by the implementer)

(Empty until Session 3B runs.)
