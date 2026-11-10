# Printing Phase 6: parallel printing on one device (design)

- **Date:** 2026-11-03
- **Status:** approved by the owner on 2026-11-03 in the Phase 5 design round ("Approve both"); built after Phase 5
  (the owner: "Offline first"). Planned on 2026-11-09/10 (branch `feat/printing-phase-6` from `main` 0c794d6): the
  planning rulings are §9, the plan is
  [../plans/2026-11-10-printing-phase-6.md](../plans/2026-11-10-printing-phase-6.md). Where §9 and an earlier section
  differ, §9 wins.
- **Scope:** `apps/cafe` only (the page's print agent and print bridge). No app release, no server change, no paper
  change.
- **Builds on:** [2026-10-02-printing-reliability-design.md](2026-10-02-printing-reliability-design.md) §7.6 (one
  writer per printer, head of line), §9.1 ("Different printers can run in parallel", deferred since Phase 2), §9.2;
  [2026-10-15-printing-phase-4-design.md](2026-10-15-printing-phase-4-design.md) §5.2 (the bridge's text step).

## 1. Summary

A device that writes several printers prints them **strictly one slip after another** today: the agent runs one cycle at
a time (print, then wait for the server's ack, then the next slip), and the page has one print surface. A 3-station
round measured on this PC's fake printers (2026-11-03, `main` 96520d6, pictures): Kitchen starts 652 ms after the tap,
Bar 1,222 ms, Desserts 1,797 ms (medians of 5); each slip is about 550 ms of drawing plus a 1–7 ms write plus its ack.
On a phone with Bluetooth printers each slip is a 2–4 s write and a real ack round trip, so the same round takes about
10–25 s, the last station waiting for every earlier one; and one printer that hangs holds every other printer of the
device for up to 70–140 s.

Phase 6 keeps the drawing one at a time (one surface) but lets each printer **write on its own lane**: the next slip
draws while the previous one is being written, and the ack of one printer's slip never holds another printer. A
printer still prints its own slips one at a time and in order.

## 2. The owner's rules

- "Current perfect working hai, so very very very careful": no slip changes, no lifecycle rule changes.
- Smooth, fast and accurate in a rush; ₹0 forever; nothing unused.

### 2.1 Safety rules (each pinned by a test)

| # | Rule |
|---|---|
| S1 | **No paper changes.** Every slip's bytes are today's: the S1 43-file pin stays green, and an end-to-end run prints the same orders on a build of `main` and on the Phase 6 build and compares the bytes per printer, file for file. |
| S2 | **One writer per printer, in order.** A printer line holds at most one slip in flight on this device; its next slip starts only after its previous slip's write and ack (§7.6's head of line and "KOT before bill" on one printer are kept). |
| S3 | **The lifecycle is today's.** Lease, epoch, ack, `more`, REPRINT / DUPLICATE / BACKUP PRINTER, at most two paper attempts, no attempt while a printer is off, the 60 s hold bound of a held job, the hand-back of a dropped job (`sent:"no"`), the (id, epoch) dedupe, the late-ack store: unchanged per line. |
| S4 | **No new request.** The same leases and acks as today, per slip; `print-budget.test.ts` unchanged; measured with the counting proxy. |
| S5 | **Old and new together.** Bridge v1 (the release APK, one printer), a browser printer (one printer), the Windows app's Windows printers (one main-process queue): one at a time as today (they gain only that another printer's ack never holds them). Nothing of the apps changes. |

## 3. Decisions (the owner, 2026-11-03)

| # | Decision |
|---|---|
| P6-1 | Parallel printing is the missing piece of multiple-printer printing (not backup-on-paper-out, a per-printer Windows method or a faster failover: not asked). |
| P6-2 | It is built after Phase 5 (offline KOTs). |
| P6-3 | (2026-11-09, planning) When a printer's line holds more slips (a rush backlog), its next slip is leased **at once**, per printer (§4.2 as written; §9 ruling 25: at once when the surface is free, else at its next opening). The other option (wait up to 2 s so the printers' next slips share one lease, today's lease count) was not taken. |
| P6-4 | (2026-11-09, planning) No real printers for the check now (two Bluetooth printers on one phone, a network printer): the exit is the fake printers, the emulator and the Windows app; the owner's real-printer check moves into GO-LIVE (§9 ruling 27). |

## 4. Design

### 4.1 Two steps per slip: make the bytes, then write them

Today the bridge (`hooks/use-print-host-bridge.ts`) holds its one slot (`occupiedRef` / `pendingRef`, :69-74, :216-224)
from the render until the write has settled. Phase 6 splits a slip into:

1. **Make the bytes** on the one surface (React render, react-to-print's iframe, `rasterPrint`, or the Phase 4 text
   step), one slip at a time, in arrival order. The slot is released as soon as the bytes exist.
2. **Write the bytes** on the printer's lane: the POS app's `printer.print { printerId }` (bridge v2: the app has one io
   thread per printer, `PrinterThreads.kt`, and the page's `nativePool` a write queue per printer,
   `native-pool.ts:192-210`), or the Windows app's `printRaw` for a network printer (one chain per printer,
   `raw-tcp.ts:326-351`). The write's outcome settles the slip exactly as today (printed / `sent:"no"` / `"maybe"`).

A lane that cannot take bytes from the page keeps today's single step: a Windows printer (`printHtmlOn`, which renders
inside the Windows app and runs on its one queue, `print.ts:58-62`), the browser's window.print fallback. Such a slip
holds the surface until its write settles, as today.

### 4.2 One cycle per printer line

The agent (`lib/print-agent.ts`) runs one cycle per printer line instead of one for the device: lease or held job →
print → ack, per line. Lines share only the drawing queue of §4.1. A line's ack (and its `more`) leads only that line's
next lease; a kick or a timer still leases once after running cycles. The simple-mode device line is one line.
Direct-print jobs leased at creation (one per printer line, §7.11) enter their lines at once: a 3-station round starts
drawing the second slip while the first is being written.

### 4.3 Copies

All copies of a job are written in one lease today, each drawn again (`print-agent-printers.ts:346-358`). When a slip's
bytes do not depend on the copy (no slip prints a copy number), the bytes made once are written N times. A test draws
every fixture slip twice and compares the bytes; a design whose two draws differ (a time printed to the second) keeps a
draw per copy.

### 4.4 A stuck printer

A write that hangs holds only its own line, up to today's deadlines (the 70 s device write deadline, the 65 s native
timeout, the 90 s watchdog). Other lines keep drawing and writing. The 60 s bound of a held job (`PRINT_DIRECT_HOLD_MS`)
applies per line.

### 4.5 What does not change

The server, the routing, the slips, the labels, the text KOT decision (Phase 4), the apps, the attestation and Test
print slips (one at a time on the surface), the waiting-slips panel and the alarm.

## 5. Measurement and exit

1. **Paper:** S1 above (old vs new build, bytes per printer, both modes, bridge v1 and v2).
2. **Speed (fake printers):** one device, three station printers and a bill printer, 5 rounds: today's medians
   652 / 1,222 / 1,797 ms; with `--delay 2000` on each fake printer (a slow Bluetooth-like write) the last cut goes
   from about 3 × (draw + 2 s) to about 3 draws + 2 s. The emulator (WebView 109 and 154) the same with two printers.
3. **Requests:** the counting proxy: the same leases and acks per round as `main`.
4. **A stuck printer:** one fake printer with `--delay 60000`: the other printers' slips print at their normal times.
5. **The owner's real-printer check:** two Bluetooth printers on one phone (vendor dependent, spec §15), a network
   kitchen printer, a 3-station round with a bill. (P6-4: a GO-LIVE step, §9 ruling 27.)

**The "before" numbers (measured 2026-11-09 on `main` 0c794d6, this PC, headless Chrome as the POS app on bridge v2,
four fake printers, pictures, 5 rounds each, medians; harness `D:\kd\pos-dev-keep\phase6\design-harness\`):**

| Run | Kitchen | Bar | Desserts | Last cut | Requests a round |
|---|---|---|---|---|---|
| M1 (fast fakes) | first byte 649 ms | 1,222 | 1,796 | 1,823 ms | KOT: 3 acks, 0 leases (direct print); bill: 1 ack |
| M1-slow (`--delay 2000` on every printer, the app's write waits for the printer) | cut 2,681 | first byte 3,249, cut 5,273 | 5,849, cut 7,860 | 7,860 ms | the same |
| M1-stuck (Kitchen `--delay 60000`) | cut 60,686 | first byte 63,308 | 63,893 | 63,896 ms | KOT: **5 acks + 2 leases** (Bar and Desserts waited past the 60 s hold bound, were handed back and leased again); bill: 1 ack |

Every slip's bytes were the same in every run (Kitchen 48,342 B, Bar and Desserts 44,382 B, bill 47,838 B); the
database held 60 jobs, all printed, no label, no duplicate key or KOT number. The Phase 6 targets (6B): M1 unchanged
within noise; M1-slow last cut ≈ 3 draws + 2 s (about 3.8 s); M1-stuck Bar and Desserts at their M1 times with 3 acks
and 0 leases a round.

## 6. Free-tier budget

No new request, no new write, no new realtime message. Faster acks change nothing in the counts.

## 7. Sessions (for the Phase 6 plan)

| Session | Delivers |
|---|---|
| 6A | Test first: the bridge's two steps (§4.1) and the agent's cycle per line (§4.2) behind today's interfaces; copies (§4.3); every S-rule's unit test. |
| 6B | The exit: fake printers and the emulator (S1 bytes, the speed and stuck-printer runs, the counting proxy), docs, the fresh review. |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Two writes to one printer at once | S2: one slip in flight per line; the app's BUSY per printer still refuses a second (before any byte) |
| A page unmount while several lines write | Each line hands back or keeps its ack exactly as one line does today (S3); tests per line |
| Bluetooth Classic with several links on one phone | Vendor dependent as today (spec §15); parallel writes may be slower than expected on some phones: measured on the owner's phone before release |
| A bug in the new cycle | The fake-printer soak (`scripts/print-soak.ts`) in printers mode with several printers per device, every job checked on paper |

## 9. Planning rulings (2026-11-09/10, on `main` 0c794d6)

The planning session surveyed one slip's whole path and every place that assumes one slip at a time (file:line below
are `main` 0c794d6), measured the "before" (§5), and asked the owner one question (P6-3). Each ruling says what, why,
and the cost if it is wrong. They bind the plan; where one differs from §1–§8, it wins.

**What changed since 2026-11-03**

1. **Offline KOTs (Phase 5).** An offline slip (`queueOfflineSlip`, `components/layout/PrintHostProvider.tsx:136-146`)
   joins the one drawing queue in arrival order like any slip; on a two-step lane (ruling 8) its write runs on the lane.
   `printOfflineLines` (`lib/offline-send.ts:206-219`) keeps printing an offline round line by line and copy by copy,
   each after the last one's outcome, exactly as today; `OFFLINE · O-n`, the outbox and the replay do not change. Its
   140 s bound now withdraws a slip still waiting to be drawn (ruling 12). *Cost if wrong:* an offline KOT printed
   twice or not at all; pinned per path (plan Tasks 4 and 6, 6B Task 12).
2. **"Clear after this try" (Printer UX).** It lives on the server, per job (`dismissRequestedAt`, `lib/print-dismiss.ts`,
   `lib/print-lease.ts`); the agent reads only an answer's `more` and `nextAttemptAt`, so per line nothing changes.
   *Cost:* a cleared slip on one printer stopping another; pinned by a two-line test (Task 5) and end to end (6B).
3. **"Print busy" means any line busy (P2 and its follow-ups).** The bridge's hold (`PrintHostProvider.tsx:130-134`)
   covers the drawing and every write still in flight; each agent job stays tracked by `trackPrintBusy` until its
   outcome (`hooks/use-print-agent.ts:205-206`). `leaveWhenPrintFree` (`lib/print-host-busy.ts:137`) therefore waits for
   the last line; lines that overlap or hand over without a gap are one continuous hold for `printHostBusySince`, as a
   serial chain is today, so "Refresh anyway" (R72) still comes after 30 s of continuous print work; R70's tracked
   requests, R71's gates, the held-slips source and the closing gate (R60/R65) are unchanged. *Cost:* a reload that cuts
   a write (a REPRINT) or a gate that never opens; every reader gets a two-line test (Task 4).
4. **The pulse, `app.wake`, the realtime nudge, timers.** Unchanged (20 s lively / 60 s calm, the 3 s → 60 s print-job
   poll while the socket is healthy). The agent keeps its one local timer; a lane adds no request and no timer: a
   write is bounded by its writer's own deadlines (the 70 s queue deadline, the 65 s native timeout, the Windows app's
   75 s network-printer bound).
5. **Line references (`main` 0c794d6).** The bridge's slot `hooks/use-print-host-bridge.ts:69-75` (occupied, pending),
   `settle` :93-120, dispatch :182-208 (the text step :200-207), `queueSlip` :222-230, `queueTestSlip` :244-257; the
   outcomes FIFO `lib/print-host-outcomes.ts:19-35`; the late guard `lib/print-host-late-completion.ts:30-54`; the
   agent's cycle `lib/print-agent.ts:117-218`, `kick` :220-241, `nudge` :247-250, `PRINT_DIRECT_HOLD_MS` :40; the lease
   gate `packages/shared/src/print-agent-wire.ts:205-213`; copies `lib/print-agent-printers.ts:345-357`; `printOnce`
   and its 140 s bound `hooks/use-print-agent.ts:160-178` (`PRINT_AGENT_SLIP_DEADLINE_MS`, `lib/print-agent-slip.ts:15`);
   `printerWriter` `lib/printer/printer-registry.ts:12-14`; `nativePool`'s queue per printer
   `lib/printer/native-pool.ts:192-210`; `desktopLan()` `lib/printer/desktop-lan.ts:229` (write), :271-283 (the
   instance); `rasterPrint` `lib/printer/lane-print.ts:138-150`; the server's `more` per printer line
   `lib/print-lease.ts:295-305`; the Windows app `apps/desktop/src/raw-tcp.ts:327-351` (a chain per printer) and
   `apps/desktop/src/print.ts:58-62, :173-185, :234-238` (one queue for Windows printers); the Android app's BUSY per
   printer `PrinterManager.kt:319-347` (a v1 and a v2 print aimed at one printer are serialized, the second refused).
6. **File budgets.** `lib/print-agent.ts` (301 lines), `lib/print-agent-printers.ts` (357), `hooks/use-print-agent.ts`
   (340) must not grow; each sheds code: the per-line scheduler goes to a new `lib/print-lines.ts`, one job's print and
   ack to `lib/print-line-job.ts`, the copies to `lib/print-copies.ts`, the hook's print step to `lib/print-agent-print.ts`.
   `lib/printer/desktop-lan.ts` (299) gains at most one line. The big test files (`lib/print-agent.test.ts` 1,423,
   `lib/print-host-paths.test.ts` 696, `lib/print-agent-printers.test.ts` 593) only shrink; new tests go in new files
   of at most 300 lines.
7. **The emulator.** The kept 4C x86_64 APK `D:\kd\pos-dev-keep\phase4\session-4c\pos-x86_64-4c-99b5b763.apk` speaks
   bridge v2 and carries 2.0.2's Kotlin printing code (4C → 2.0.2 changed only a Kotlin comment, a JVM test and the
   version), and Phase 6 changes no app code (S5): 6B uses it (the 4C/4D procedure: uninstall the as-found 1.0
   `29115bdf`, install, run, put `29115bdf` back). No Android build, so no Gradle download (~4.3 GB) and no D: budget
   beyond the emulator's own.

**The two steps (§4.1)**

8. **Which slips take two steps.** A slip with a target on one of the POS app's printers on bridge v2 (`nativeId`) or a
   network printer of the Windows app (`lan`), on any surface but `test`, whether a job's or an offline slip. Every
   other slip keeps today's one step and holds the surface until its write settles: this device's own printer (bridge
   v1, a browser printer, a v2 app's default in simple mode), a Windows printer (`printHtmlOn`, `printRawOn`, the
   Windows app's one queue), the browser's print window, a printer's Test print job, the attestation and text test
   slips (S5, §4.5).
9. **Where the split happens.** `lib/printer/lane-print.ts` and `lib/desktop-shell.ts` are in the S1 43-file pin
   (byte for byte since `d21ee37`), so neither changes. A new `lib/printer/lane-writes.ts`: the bridge arms one write
   for the slip it draws now, by that slip's lane key (`native:<app id>`, `lan:<host>:<port>`); `printerWriter` and the
   `desktopLan()` instance (wrapped where it is created) pass every write through `laneWrite`, which hands an armed key's
   first write to the bridge and answers at once (the drawing step ends as soon as the bytes exist), and writes every
   other one as today. Only the host bridge gives a slip a raster target (every other `slipPrintOptions` caller passes
   none: `use-kot-print-bridge.ts`, `use-token-print.ts`, `MoveTableDialog.tsx`, `OrderDetailSheet.tsx`,
   `EndOfDayButton.tsx`), and the arm is one-shot and cleared at every settle of the surface. The Phase 4 text step
   writes through the same writers, so it splits the same way with no path of its own. *Cost:* a write handed to the
   wrong slip; pinned (an unarmed write, another key's write and a second write are written as today; Task 2).
10. **Each slip hears its own result.** The outcomes FIFO assumes results come back in queue order; with lanes a later
    slip's write can end first. It is replaced by a ticket per slip (`lib/print-host-tickets.ts`): a one-step slip (or
    a draw that failed before any byte) is settled by the surface, a two-step slip by its write. A write that fails
    toasts with its own slip's job (PX-2's B7 words), not the one being drawn. *Cost:* a wrong ack (a printed slip
    REPRINTed, a lost one acked printed); pinned with writes ending out of order (Task 3).
11. **The watchdog and the late guard stay the surface's.** Drawing stays one at a time, so `PRINT_HOST_DISPATCH_TIMEOUT_MS`
    (90 s) and the late-completion guard keep guarding the surface. The watchdog also disarms the lane, so a draw it
    gave up on writes, if it ever does, inside its own late draw under today's late rules.
12. **A slip never drawn is never "maybe"; a slip drawn is waited for.** The agent's 140 s bound
    (`PRINT_AGENT_SLIP_DEADLINE_MS`) and the offline slip's bound start when the slip is queued; with several lines a
    slip can wait behind other lines' draws. When the bound passes while the slip still waits to be drawn (in the queue,
    or the current slip whose dispatch still waits for the surfaces to mount, a design's code or End of day's figures),
    it is withdrawn (a current one is dropped and the next promoted) and answered `sent: "no"` ("waited too long to be
    drawn on this device": the job goes back to its line unlabelled; an offline line is not printed here, the server
    prints it when back). A slip already on the surface or on its lane is waited for, never answered early: its end is
    bounded already (the watchdog and grace on the surface, 120 s; each write by its writer's deadline, at most 75 s,
    for at most 3 copies); answering "maybe" while its write went on would free its line under a write (S2) and race
    the REPRINT with the original. When the provider unmounts, a waiting slip is answered "no" at once, the slip on the
    surface "maybe" at once (it may still reach paper, today's answer), a write in flight settles by itself. A withdrawn
    slip is no refusal of its printer: it never holds the printer's line (ruling 20), and the agent wishes to lease it
    again. *Why:* "maybe" for a slip that is still queued and then prints would put out a second paper (S3). *Cost:* a
    slip lost or doubled; pinned per path (Tasks 3, 4, 6). (The builder check's items 3, 4 and 11.)
13. **Test print.** Refused while anything prints (drawing or any write in flight), as today. The Test buttons read a
    new context flag `printing` (the bridge's hold) instead of `current !== null` (`hooks/use-test-print.ts:120-122`,
    `components/print/TextKotSection.tsx:126`), so they stay disabled exactly as long as today.

**The cycle per line (§4.2)**

14. **The agent's gate is the surface.** `setGate({ busy })` now gets "the surface is drawing" (`drawing`), not "the
    bridge holds anything": nothing new starts or is leased while a slip is being drawn, and a write in flight holds
    only its own line. A lease asked for while a slip is drawn (a line's `more`, a wish) is made at the surface's next
    opening. `printAgentMayLease` (shared) is unchanged. The page's `drawing` is React state set in an effect, so a
    second held job may start before the gate closes: it waits in the drawing queue and draws in order (S2 per line
    holds; the bound of ruling 12 covers it): accepted, and pinned by a bridge test (the planning review's m-7).
15. **One slip in flight per line (S2).** A line is occupied from the moment its job is taken (from a lease or the held
    list) until its ack is answered or kept for re-sending; a line with a held job waiting is occupied too, so a lease
    never names it (its head is already leased to this tab). The next job of a line starts only after its previous job's
    write and ack.
16. **The device line runs alone.** `PRINT_DEVICE_LINE` slips (simple mode, slips no printer takes) write through
    `devicePrinter()`, while a printer line on the same physical default printer writes through `nativePool()`: two
    queues for one printer, and the app's BUSY per printer would refuse one of them. A device-line job starts only when
    no line is in flight, and no line starts while it is (today's order on that printer). While a device-line job is
    held, no printer-line job starts and nothing is leased until it has started, so it never starves behind younger
    printer-line jobs (the builder check's item 6).
17. **Held jobs (§7.11 direct print).** Oldest first, one start per opening of the surface (as today's "a held job
    prints when the bridge is free"); a held job of an occupied line waits for it. The 60 s bound (`PRINT_DIRECT_HOLD_MS`)
    is per job, so per line (§4.4); measured on `main`, a stuck Kitchen held Bar and Desserts past it (5 acks + 2
    leases a round); per line they start at once. A hand-back (held too long, printing stopped) is a named kick for its
    own line (free at that moment, so it leases at once after the kept acks are flushed), as today's cycle leases right
    after one: the job is back on the server, due after its backoff (the builder check's item 2).
18. **Acks.** `lib/print-agent-acks.ts` is unchanged: acks go one at a time on the wire, so a line waits at most for the
    acks ahead of it (about 0.1–0.3 s each), never for another line's write. The "kept acks first" flush runs before
    every lease, as today, not before a held job's start (no lease is made there).
19. **Quiet after an empty ack, nudges.** `PRINT_AGENT_QUIET_AFTER_ACK_MS` (500 ms) stays device-wide, as today: a
    nudge (a change of this device's state, e.g. a printer's status after its own write) adds no wish within 500 ms of
    any empty ack, nor while any line is in flight (today: "if running, return"); it still starts held jobs. Kicks are
    never held back by the quiet; ruling 25 says when each kind of kick leases (the builder check's item 5: a per-line
    quiet would turn the trailing empty lease back on).
20. **A failure's backoff holds only its own line.** A job back in line (`nextAttemptAt`) sets the one timer for its
    line; it never clears another line's wish to lease (today's `kickedWhileRunning = false` was device-wide). A slip
    withdrawn undrawn (ruling 12) goes back with no hold on its line.
21. **Holds are released as today.** A refusal's hold is per line and ends when this device's printer state identity
    changes or after 30 s (`lib/print-agent-holds.ts`); one printer's change may end another's hold early, as today
    (at most one more lease and one refusal ack per change).
22. **The legacy host self-order lane** (`hooks/use-self-order-auto-print.ts:163`) keeps "the bridge holds anything"
    as its gate.
23. **Already per job or per printer, unchanged:** the waiting-slips panel and the alarm (`lib/print-attention.ts`,
    `hooks/use-print-slip-alarm.ts`, `lib/print-waiting.ts`), dismiss, LAN failover's link memory and "unreachable"
    (`lib/print-agent-health.ts`, `lib/printer/desktop-lan.ts`), `markPrinterWriting`, the `(id, epoch)` dedupe, the
    pending-ack store; the page's own one-slot bridge (`hooks/use-kot-print-bridge.ts`, outside the agent) as today.

**Copies (§4.3)**

24. **The KOT family draws once; bills draw each copy.** The survey: no slip prints a copy number; KOT-kind slips (a
    station slip, a full copy, a whole-tab REPRINT, a QR KOT) take every time from stored order and job fields, and the
    text renderer reads no clock. A bill reads the clock while it is drawn (its "Printed" minute; the Pay QR's validity
    counted from now when no first-print stamp exists) and may load a logo late, so a bill keeps a draw per copy. So: a
    `kot` job with copies > 1 on a two-step lane makes its bytes once and writes them N times, in order, on its printer's
    queue (a failure on the first write is that failure, on a later one "maybe": today's rule); every other job, and
    offline copies, keep today's loop. A slip asked for N writes that was not handed off reports one copy written, and
    the rest print one draw each, so a copy is never lost. A source pin keeps the KOT renderers free of a now-clock,
    including a designed KOT's blocks (the shared slip engine's clock, `SlipEngine.tsx:46` / `slip-context.ts:51`,
    serves bill blocks only). *Cost:* a missing or extra kitchen copy; pinned (Task 7) and end to end (6B Task 11, on
    a classic and on a designed KOT).

**Requests (S4), the owner's answers**

25. **P6-3: the next slip of a line is leased at once.** A lease names every open line that is not occupied (ruling 15)
    and at most one lease is in flight. A line's ack that says `more` leases at once when the surface is free, else at
    its next opening (ruling 14); a hand-back is a wish (ruling 17). **Kicks** (the planning review's I-1: a frame for a
    busy line must not lease the idle lines and miss its job): a kick that names a line (a `print-status` frame, an
    order answer, the timer of that line's backoff) leases at once when that line is free, and when it is occupied it
    becomes that line's `more` (leased when the line frees); an unnamed kick (the pulse, the wake, the host's
    `print-job` nudge, a lease's `retryAt` timer) leases at once only when no line is occupied, and otherwise is kept as
    one wish that itself leases at the first pump after a line frees: today's "a kick while a cycle runs leases once
    after it". A `print-status` frame names its job (`CafeEventJob.id`, `lib/realtime-publish.ts:66-71`): a frame for a
    job this tab holds or prints right now (held, in flight) is no reason to lease, since it arrived after that job's
    own lease (the re-check's I-1: frames landing after the lease would each leave a want and buy an empty lease); a
    line's want from any other named kick is cleared only by a lease that names that line, and is merged with, never
    cleared by, the line's ack's `more`, so a job queued while its line was busy is never left to the pulse. Normal rounds cost today's requests (direct print: 0 leases and 1 ack a slip; a round from another
    device: 1 lease + 1 trailing). In a backlog the lines' wishes that land while slips are drawn share the next
    opening's lease, so with fast writes a backlog costs today's leases; with slow (Bluetooth-like) writes a line's
    `more` lands while the surface is free and a backlog wave costs up to one lease per printer (today one for all), inside
    `print-budget.test.ts`'s model (at most one lease and one ack per slip, plus one trailing lease per burst), which
    stays unchanged. (The builder check's item 1 found the "at once" bounded by the surface.)
26. **S4 as measured.** A scenario test drives today's agent and the new one through the same rounds (direct, from
    another device with its frames before and after the lease's answer, a frame for a busy line and for a free line
    while another line writes, a backlog with fast and with slow writes, a stuck printer, simple mode) and pins both
    counts side by side; only the slow-write backlog may differ upward, by ruling 25; two differ downward on purpose,
    on a one-step device too: the late frames (one empty lease fewer, ruling 25) and the stuck printer (2 acks and 2
    leases fewer a round); neither is an S5 deviation. 6B adds the counting proxy on the fake-printer rounds and the soak's leases per printed slip against the
    same soak on `main`.
27. **P6-4: the real-printer check is a GO-LIVE step.** The merge gate is 6B's exit (fake printers, the emulator on
    WebView 109 and 154, the Windows app). GO-LIVE: the demo cafe first; a cafe where **one** phone prints two Bluetooth
    printers gets Phase 6 only after the owner's check on such a phone (two Bluetooth Classic links, §8); until then
    that account stays on the build before Phase 6 (his admin panel). A device that prints one printer is unaffected
    (one line).
28. **Comments that say "one at a time"** (the headers of `lib/print-agent.ts` and `hooks/use-print-host-bridge.ts:8`
    ("in print order (print-host-outcomes.ts)"), `lib/print-agent-acks.ts:11`, `lib/print-write-outcome.ts:25-26`,
    `lib/print-agent-slip.ts:12-14`) are corrected with the code they describe.

The planning session's builder check (a fresh engineer reading this spec and the plan against the code) raised 2
blockers, 6 important and 6 minor points; every one is folded into the rulings above (12, 14, 16, 17, 19, 20, 25, 26,
28) or into the plan's tasks (the moved pins, the world's start-up, the field order, the budgets). The planning review
(Claude Fable 5.1: "With fixes", 0 critical, 3 important, 5 minor; every file:line checked; no two-paper or lost-slip
path found) is folded the same way (rulings 14, 24, 25, 26; the plan's Tasks 1, 4–7, 11, 14). Its re-check ("With
fixes": 1 important, 4 minor, every earlier fold confirmed) is folded into rulings 17, 19 and 25 and Task 5.
