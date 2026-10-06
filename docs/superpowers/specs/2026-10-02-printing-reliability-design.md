# Printing reliability and multi-printer routing: design

- **Date:** 2026-10-02
- **Status:** draft for owner review
- **Scope:** `apps/cafe` (web POS and API), `packages/shared`, `apps/mobile` (Android app), `apps/desktop` (Windows app)
- **Builds on:** [docs/print-research-report.html](../../print-research-report.html) (2026-09-02) and [apps/mobile/REVIEW-2026-10-02.md](../../../apps/mobile/REVIEW-2026-10-02.md)

## 1. Summary

Today a print job is marked `printed` when a print host *claims* it, before anything is rendered or sent ([apps/cafe/lib/print-queue-claim.ts:184-187](../../../apps/cafe/lib/print-queue-claim.ts)). Any later failure loses the slip silently, and the ordering device still shows "Sent ✓". Each outlet also has exactly one print host and one printer, with no routing by kitchen station.

This design changes four things:

1. **At-least-once delivery with acknowledgement.** A job counts as printed only when the device that owns the printer reports a successful write. Failures retry by themselves. A KOT retry that may repeat paper prints **REPRINT**. A bill that may already have printed waits for a one-tap cashier decision and then prints **DUPLICATE**.
2. **Jobs are created on the server, in the same request** that commits the order change. Keys are deterministic, and a repair sweep covers crashes.
3. **Stations, printers and printer devices.**
   - KOTs split by station: category → station, with a per-item override.
   - Bills go to the device's bill printer.
   - An outlet can have many printers, and one device can drive several.
4. **Failover, printer health and alerts,** plus hardening of the Android and Windows agents.

The work ships in five phases (§14). Phase 0 fixes the regressions in the uncommitted 2026-10-02 changes.

## 2. Goals and non-goals

**Goals**

- **G1 No silent loss.** Every KOT and bill either prints or is visibly marked failed, on the ordering device and on the printer device, with one-tap recovery.
- **G2 No unlabelled duplicates.** Any slip that may repeat paper says REPRINT, DUPLICATE or BACKUP PRINTER.
- **G3 Every outlet setup works:**
  - one device and one printer;
  - a counter plus a kitchen printer;
  - several stations with waiter phones;
  - one Windows PC that drives every printer.
- **G4 Recovery without staff.** When the printer, Bluetooth or Wi-Fi comes back, or the app restarts, queued slips print by themselves (within the 30-minute window, §7.8).
- **G5 Early warning.** Printer offline, paper out and device offline show on every device. An alarm sounds when a KOT has not printed within 20 s. Telegram alerts to the owner are optional.
- **G6 Existing outlets keep working** without any new setup.

**Non-goals for this project**

- Offline billing (taking orders without internet). The design must not block adding it later.
- A native print agent that runs without the web page (a queue in Kotlin or in Electron's main process). This is a later phase. The server API in §7.3 is agent-agnostic so it can be added without server changes.
- Cloud-polling printers (Star CloudPRNT, Epson Server Direct Print). These are a later printer type.
- A separate KOT number series per station (decision D7).
- Kitchen display (KDS) changes.

**Hard constraints (owner rule, 2026-10-02)**

The product is sold to many cafes. Each cafe runs on **its own free accounts**: Vercel Hobby (active plus standby), Atlas M0 (one org per cafe), and Cloudflare (R2 plus the realtime Worker with a SQLite-backed Durable Object). See [docs/PLATFORM.md](../../PLATFORM.md) §1–3.

After setup, neither the cafe nor the owner pays anything. So:

- **No paid service or plan feature:**
  - no Vercel Pro features;
  - no paid print relays (PrintNode, QZ Tray licences);
  - no Firebase or FCM project per cafe;
  - no SMS.
- **No Vercel Cron.** Hobby allows only once-a-day crons. Periodic server work rides requests that already exist.
- **Every new recurring request must fit the free-tier budget in §17, and a test pins it.**
  - Overrunning Vercel Hobby's monthly allowance stops the cafe's site until the allowance resets (`docs/GO-LIVE-CHECKLIST.md:904-912`).
  - The printing budget therefore has to hold in the worst case, not only on an average day.
- **Quality bar:** cafes pay for this. Each phase ships only after its exit criteria (§14) pass, including the fake-printer end-to-end tests.

## 3. Owner decisions (2026-10-02 session)

| # | Question | Decision |
|---|---|---|
| D1 | Which outlet setups must work? | All of them: one device and one printer; counter plus kitchen; several stations with waiter phones; a Windows PC driving every printer. |
| D2 | A KOT fails mid-print and nobody knows whether paper came out | Retry automatically. The retry prints **REPRINT**. |
| D3 | The same for a bill | If nothing was sent, retry silently. If unsure, show the cashier a one-tap prompt ("Print the bill again?"). A reprint prints **DUPLICATE**. |
| D4 | Internet down | Out of scope. During short outages jobs wait and print once the connection is back. Offline billing is a later project. |
| D5 | Routing KOTs across stations | Category → station, with a per-item override. |
| D6 | Architecture | Server-side queue with printer agents (approach 1), including Android host hardening. |
| D7 | KOT numbering | One KOT number per round, as today. Each station's slip shows the station name. |
| D8 | Order of work | Phases 0 → 4 as in §14. |

## 4. Current state (2026-10-02, including uncommitted changes)

### 4.1 How a slip reaches paper today

- **Triggers run on the client, after the server commits the order:**
  - send to kitchen and Pay Now ([hooks/use-pos-tab.ts](../../../apps/cafe/hooks/use-pos-tab.ts) :317, :384-385)
  - settle (:165)
  - void ([app/(dashboard)/pos/page.tsx](../../../apps/cafe/app/(dashboard)/pos/page.tsx) :67-70)
  - table move ([components/orders/MoveTableDialog.tsx](../../../apps/cafe/components/orders/MoveTableDialog.tsx) :124-133)
  - order-request accept ([app/(dashboard)/requests/page.tsx](../../../apps/cafe/app/(dashboard)/requests/page.tsx) :73-74)
  - QR self-orders through `/kot-claim` ([hooks/use-self-order-auto-print.ts](../../../apps/cafe/hooks/use-self-order-auto-print.ts) :159-200)
  - manual reprints and end of day
- **Routing** ([lib/print-routing.ts](../../../apps/cafe/lib/print-routing.ts) :41-56):
  - With a designated print host, every device enqueues a `PrintJob` (`POST /api/print-jobs`) in a second request.
  - Without a host, each device prints its own slips on its own lane.
- **The host polls** (wake every 3/15/60 s, pulse every 20 s, plus a Cloudflare Durable Object nudge), then claims each job with a compare-and-set (CAS) that sets `status: "printed"`.
- **Rendering.** Slips are React components:
  - rasterised to ESC/POS `GS v 0` ([lib/printer/raster.ts](../../../apps/cafe/lib/printer/raster.ts), [escpos.ts](../../../apps/cafe/lib/printer/escpos.ts)),
  - or sent to the Windows spooler by the desktop shell ([apps/desktop/src/print-job.ts](../../../apps/desktop/src/print-job.ts)),
  - or printed with `window.print()`.
- **Transports:**
  - Web Serial and Web Bluetooth ([lib/printer/transport-*.ts](../../../apps/cafe/lib/printer/)).
  - The Android bridge to Kotlin: Bluetooth Classic, BLE, USB and TCP 9100 ([apps/mobile/android/.../printer/](../../../apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/)).
  - The Windows spooler, raw or through the driver ([apps/desktop/src/raw-spool.ts](../../../apps/desktop/src/raw-spool.ts)).

### 4.2 Gaps this design closes

| Gap | Evidence |
|---|---|
| A claim counts as printed. Any later failure (write error, paper out, cancelled dialog, reload, lost response) loses the slip, while the ordering device shows "Sent ✓". | `print-queue-claim.ts:178-187`; `packages/shared/src/print-job.ts:21-24` |
| The order and its job are saved in two requests. A failed enqueue drops the KOT, and the only signal is a toast. | `hooks/use-host-routing.ts:196-197` |
| One host and one printer per outlet. No routing by station or slip type, no copies, no backup printer. | `models/PrintHost.ts` (singleton `"primary"`); `lib/printer/device-printer-store.ts` (one record); Kotlin `PrinterManager` (one `selected`); desktop `store.ts` (one `deviceName`) |
| No paper or cover status. A LAN printer's "connected" comes from one probe. On desktop, "connected" means a printer is chosen. | Kotlin `ClassicTransport` discards read bytes; `TcpTransport.kt:11-15`; `apps/desktop/src/printer-check.ts` |
| On Android the service is `START_NOT_STICKY` and nothing restores it after a reboot. | `PrintHostService.kt:135`; the manifest has no `BOOT_COMPLETED` |
| No alerts for print failures. | `lib/telegram` has none |

## 5. Architecture

```
 Ordering device (waiter phone / counter / QR accept)
     │  one request: the order change
     ▼
 Server (Vercel + Mongo)
   order CAS succeeds ──► PrintJobs created in the same request
                          jobKey = kind:order:round|at:printer|device:copy (dedupe)
   repair sweep: missing jobs re-created with the same keys (no duplicates)
     │  realtime nudge (existing Durable Object socket) + poll fallback
     ▼
 Printer devices (agents): Android app · Windows app · Chrome tab
   lease (device, epoch, 90 s) → render → write → ACK printed
   failed, nothing sent  → back to queue, silent retry with backoff
   failed, maybe sent    → KOT: retry with REPRINT · bill: needs-confirm → DUPLICATE
   lease expired         → treated as "maybe sent"
     ▼
 Printers: kitchen LAN · bar Bluetooth · bill USB · Windows printer
```

**Principles**

1. The server is the source of truth for every job and its outcome.
2. A printer has at most one writer at a time, and the server enforces it.
3. A job is `printed` only after its writer acknowledges a successful write.
4. Every retry that may repeat paper is labelled.
5. Agents run in the web page in all three shells (Android WebView, Windows app, Chrome). Their server API (§7.3) does not depend on the page, so a native agent can replace it later.

## 6. Data model

All new models follow the house rules for `PrintJob`/`PrintHost`:
- plain, default-bound models, not in the federated registry;
- no TTL index (ttl-guard);
- omit-empty optional fields.

### 6.1 `Station` (new, Phase 2)

```ts
interface IStation {
  name: string;        // unique, trimmed, e.g. "Kitchen", "Bar", "Tandoor"
  order: number;       // display order
  isDefault: boolean;  // exactly one default station
  createdAt: Date;
  updatedAt: Date;
}
```

The first read seeds one default station called "Kitchen".

### 6.2 `Category` and `Product` (changed, Phase 2)

- `Category.stationId?: ObjectId`. If absent, the category uses the default station.
- `Product.stationId?: ObjectId`. If absent, the product uses its category's station.
- **Resolution:** `product.stationId ?? category.stationId ?? defaultStation`. An unknown or deleted station falls back to the default station.
- **Snapshot:** the print payload carries each item's resolved station at job-creation time. A later menu edit never changes a queued job.

### 6.3 `Printer` (new, Phase 2)

```ts
interface IPrinter {
  name: string;                       // e.g. "Kitchen printer", "Counter 1 bill"
  connection:
    | { kind: "lan"; host: string; port: number }            // port default 9100
    | { kind: "device"; deviceId: string;                     // the only device that can reach it
        transport: "bt-classic" | "ble" | "usb" | "windows" | "web-serial" | "web-bluetooth";
        address: string };                                     // transport-specific id
  primaryDeviceId?: string;           // LAN only: preferred writer
  order: number;                      // display order on Settings → Printers; the first bill printer is the default
  paper: 58 | 80;
  slips: {
    bill: boolean;
    kotStations: string[];            // station ids this printer receives KOTs for
    kotAll: boolean;                  // a full copy of every KOT (counter / expo)
    notices: boolean;                 // void, moved, cancel notices
    eod: boolean;
  };
  copies: { kot: number; bill: number };  // 1–3
  backupPrinterId?: string;
  enabled: boolean;
  health?: {
    state: "online" | "offline" | "paper-out" | "cover-open" | "unknown";
    at: Date;
    byDeviceId: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.4 `PrintDevice` (new, Phase 1)

```ts
interface IPrintDevice {
  deviceId: string;       // the existing pos.device-id.v1 value; unique
  label: string;          // e.g. "Counter PC", "Kitchen tablet"
  shell: "android" | "windows" | "browser";
  capabilities: { lan: boolean; bluetooth: boolean; usb: boolean;
                  windowsPrinters: boolean; webSerial: boolean; webBluetooth: boolean };
  billPrinterId?: string; // Phase 2
  lastSeenAt: Date;
  appVersion?: string;
  nativeProtocol?: number; // Android bridge version; 1 = one printer only
}
```

- The heartbeat rides the existing wake poll, so it adds no new request (§10). The wake poll upserts this record.
- A device is **online** when `lastSeenAt` is within 90 s.
- A row not seen for 7 days is pruned (owner, after Session 1D: a reset or reinstalled device gets a new id); a device that comes back writes its row again.

### 6.5 `PrintJob` (changed, Phase 1)

```ts
status: "queued" | "leased" | "printed" | "needs-confirm" | "failed" | "dismissed";
targetDeviceId?: string;     // simple mode (§6.6): the device that must print it
printerId?: string;          // Phase 2 routing; replaces targetDeviceId once printers exist
copyIndex: number;           // 0-based
epoch: number;               // incremented by every lease
lease?: { deviceId: string; tabId: string; epoch: number; expiresAt: Date };
attempts: number;            // leases granted
uncertainAttempts: number;   // attempts that may have printed
nextAttemptAt: Date;         // backoff gate
labels: Array<"REPRINT" | "DUPLICATE" | "BACKUP PRINTER">;  // printed as one banner; empty = none
approvedAt?: Date;           // staff tapped "Print now" on a stale job (§7.2)
printedAt?: Date;            // set only by a successful acknowledgement
printedBy?: string;          // device id or staff name
lastError?: string;
originDeviceId: string;      // drives the readback on the ordering device
log: Array<{ at: Date;
             event: "created" | "leased" | "printed" | "failed" | "expired"
                  | "retargeted" | "confirmed" | "dismissed" | "late-ack";
             deviceId?: string; detail?: string }>;  // capped at 20 entries
```

- **Keys.** `jobKey` becomes `<kind>:<orderId>:<round|at>:<printerId|targetDeviceId>:<copyIndex>`. A reprint uses `reprint:<Idempotency-Key>`, where the client supplies a UUID. Phase 1's simple mode keeps today's keys (one job per slip; §7.10); the printer and copy parts arrive with Phase 2 printers.
- **Old rows.** `claimedAt` and `claimedBy` stay on rows written before this change. New code never writes them.
- **Old meaning of "printed".** A historical `printed` row means "claim won". The readback treats rows without `printedAt` as legacy.
- **Indexes:**
  - `{ status: 1, nextAttemptAt: 1, createdAt: 1, _id: 1 }` (not created in Phase 1, §7.10: no query uses it)
  - `{ printerId: 1, status: 1, createdAt: 1, _id: 1 }` (Phase 2)
  - `{ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 }`
  - ~~`{ originDeviceId: 1, createdAt: -1 }`~~ dropped at the Phase 1 final gate (m-1): it served `myRecentJobs`, which the 1C gate replaced with the one attention feed; nothing reads by it. Phase 1 was never deployed, so no database has it.
  - `jobKey`: unique and sparse (existing)
- The existing `{ status: 1, createdAt: 1, _id: 1 }` index stays for the prune sweep and the attention feed. Phase 1 creates exactly three `PrintJob` indexes (pinned).

### 6.6 Compatibility: simple mode

- **When it applies:** while no enabled `Printer` record has slips assigned.
- **Routing is exactly today's:**
  - a designated host → `targetDeviceId = host.deviceId`;
  - no host → `targetDeviceId = originDeviceId`, so each device prints its own slips.
- **What changes:** only the lifecycle (§7). Jobs are created on the server, leased, acknowledged and retried.
- **No migration:** the existing `PrintHost`, each device's printer choice, and the settings keep working, so Phase 1 deploys without data migration.
- **Phase 2 adds "Set up printers",** which converts the current setup:
  - "Printer 1" is created from the host's printer (or each device's printer) with every slip type enabled;
  - every category is assigned to the default station.

## 7. Job lifecycle (Phase 1)

### 7.1 States

```
created ─► queued ──lease──► leased ──ack printed──► printed ✓
             ▲                  │
             │                  ├─ ack failed, sent:"no" ──────► queued (backoff; never an attempt)
             │                  ├─ ack failed, sent:"maybe" ─┬─ KOT/notice/EOD ─► queued + REPRINT
             │                  │                            └─ bill ───────────► needs-confirm
             │                  └─ lease expired (sweep or next lease) ─► same as sent:"maybe"
             │
             ├── needs-confirm ──cashier "print again"──► queued + DUPLICATE
             │                 ──cashier "it printed"───► printed (printedBy = staff)
             ├── stale (queued > 30 min) ──"Print now"──► leasable again
             └── failed ──"Print again"──► queued (+ REPRINT/DUPLICATE if uncertainAttempts > 0)

any unresolved ──dismiss (staff, order cancelled, host cleared)──► dismissed
```

### 7.2 Transition rules (enforced by the server)

| From | Event | To | Rule |
|---|---|---|---|
| — | create | `queued` | `attempts=0`, `uncertainAttempts=0`, `nextAttemptAt=now`, `epoch=0` |
| `queued` (`nextAttemptAt ≤ now`, not stale) | lease by an eligible device (§9.3) at its printer's head of line (§7.6) | `leased` | CAS on `{_id, status:"queued", epoch}`. Sets `epoch+1`, `lease.expiresAt = now + 90 s`, `attempts+1` |
| `leased` (`expiresAt < now`) | expiry, applied by the sweep or lazily by the next lease query | KOT/notice/EOD: `queued`, adds REPRINT to `labels`; bill: `needs-confirm` | `uncertainAttempts+1`, log `expired` |
| `leased` | ack `printed` with a matching epoch | `printed` | sets `printedAt` and `printedBy`, clears `lease` |
| `leased` | ack `failed`, `sent:"no"` | `queued` | `nextAttemptAt = now + backoff(attempts)`. Never counts toward the limit (owner, after Session 1B); the agent stops leasing until its printer is back (§9.1) |
| `leased` | ack `failed`, `sent:"maybe"` | KOT/notice/EOD: `queued` + REPRINT; bill: `needs-confirm` | `uncertainAttempts+1` |
| `leased` | ack `failed` with a permanent error (`BAD_REQUEST`, `TOO_LARGE`) | `failed` | no retry, alert (§10) |
| `needs-confirm` | cashier decision | `queued` + DUPLICATE / `printed` / `dismissed` | allowed from any device that can see the job. "Print again" is the bill's one labelled retry: `uncertainAttempts = 1`, `attempts = 0`, `approvedAt = now` |
| `queued` | `uncertainAttempts ≥ 2` (the owner's two-attempt rule, §7.8) | `failed` | checked when acking and by the sweep; leases refused before writing never count |
| `failed` | "Retry" | `queued` | Adds REPRINT (KOT) or DUPLICATE (bill) to `labels` if `uncertainAttempts > 0`, then sets `attempts = 0` and `uncertainAttempts = 1`: one staff tap is one more attempt |
| `queued`, stale (`createdAt` older than 30 min, no `approvedAt`) | "Print now" | `queued`, leasable | Stale is derived, not stored: a stale job can't be leased and doesn't block the head of line. The tap sets `approvedAt = now`. |
| any unresolved | dismiss | `dismissed` | existing reasons, plus `"cashier"` |

**Backoff after `sent:"no"`:** 2 s, 5 s, 10 s, 30 s, then every 30 s.

### 7.3 Server API

| Endpoint | Body → response | Notes |
|---|---|---|
| `POST /api/print-jobs/lease` | `{ deviceId, tabId, printerIds?, jobIds? }` → `[{ id, epoch, kind, payload, labels, copyIndex, printerId?, attempt }]` | At most one job per printer (head of line). `jobIds` lets the ordering device lease the jobs it just created without waiting for a poll. Also counts as a heartbeat. |
| `POST /api/print-jobs/[id]/ack` | `{ epoch, outcome: "printed" \| "failed", sent?: "no" \| "maybe", error?, printerHealth? }` → `{ status }` | Idempotent per `(id, epoch)`. Late acknowledgements are handled as in §7.9. |
| `POST /api/print-jobs/[id]/confirm` | `{ decision: "reprint" \| "printed" \| "dismiss" }` | Only for `needs-confirm` jobs. |
| `POST /api/print-jobs/[id]/retry` | — | Moves `failed` or stale jobs back to `queued`. |
| `POST /api/print-jobs/[id]/dismiss` | existing | |
| `POST /api/print-jobs` | existing, now requires the `Idempotency-Key` header | Only for prints the client starts (staff reprints, EOD, cancel notices without an order mutation). |
| `GET /api/print-jobs/wake` | existing | The response adds `jobsForMe` (count, oldest age) and `myRecentJobs` (status of jobs this device created in the last 15 min). Carries the heartbeat (§10). |
| `POST /api/print-jobs/[id]/claim` | existing | Kept with today's semantics for one release so tabs that haven't reloaded keep working, then removed. |

### 7.4 Server-side creation (outbox) and repair sweep

- **Routes that create jobs** do so after their order CAS succeeds, in the same request:
  - `orders/[id]/items` (a fired round) → KOT jobs
  - `orders/[id]/settle` and Pay Now → bill jobs, when the request asks to print
  - void → void notice
  - `orders/[id]/table` → moved notice
  - `orders/[id]/cancel` with notify → cancel notice
  - `order-requests/[id]/accept` → KOT jobs; for a QR self-order, the lane's `order-requests/[id]/kot-claim` when an agent claims it (§7.10: the public auto-accept itself makes no job)
- **Payloads** come from the existing builders in [lib/print-routing.ts](../../../apps/cafe/lib/print-routing.ts) (`kotPrintJob`, `billPrintJob`, `voidPrintJob`, …), run on the committed order. They are converted with the same snapshot function (`printOrderSnapshot`) the client uses today, so slips look exactly the same.
- **Response:** the route returns `printJobs: [{ id, printerId | targetDeviceId, label }]` (`label` is the existing UI-only text, e.g. "KOT round 2 · T-4"), and the ordering device leases the ones that belong to it straight away.
- **Errors:** if job creation throws after the order commits, the route still returns success and logs the error. The sweep repairs it. (Phase 1: the error is swallowed, because server libs never log; the repair covers a KOT round and the ordering device re-sends any other slip its answer did not name, §7.10.)
- **Repair sweep.** It runs inside wake/pulse handling, at most once per 60 s per cafe:
  1. Expire leases (§7.2).
  2. Re-create missing jobs. For orders with a KOT round fired in the last 30 min, recompute the expected jobKeys and insert any that are missing. A unique-key collision is a no-op. Phase 1 repairs only the KOT rounds the server owns (`Order.kotPrintDevices`, §7.10), so it never re-prints a round an old tab printed itself.
  3. Apply limits (stale, failed).
  4. Run the existing retention prune.
- **The self-order lane stays** (§7.10, the 1B review gate): its `/kot-claim` CAS still picks the one lane that prints a QR KOT, and for an agent that claim makes the KOT a print job. A tab from before Phase 1 still claims and prints it itself.

### 7.5 Failure classification

`sent:"no"` is reported only when the writer knows that no byte reached the transport.

| Writer | `sent:"no"` | `sent:"maybe"` | Permanent |
|---|---|---|---|
| Android bridge | `NOT_CONNECTED`, `UNAUTHORIZED`, `UNSUPPORTED`, `BUSY`, `BLUETOOTH_OFF` | `WRITE_FAILED`, `TIMEOUT` | `BAD_REQUEST`, `TOO_LARGE` |
| Web Serial / Web Bluetooth | the coded pre-write refusals added in Phase 0 (F0.1) | any error after the first chunk | — |
| Windows app | no printer; cannot open the printer; TCP connect fails | an error after `StartDocPrinter` or after the first TCP write | — |
| Windows app, as built (Phase 1 final gate, I-3) | the shell's own sentences for no printer chosen, a printer that writes files, no server address, no spooler, the chosen printer not found (unwrapped from the IPC error); "the slip did not finish drawing" is the slip's own refusal (§7.10, 1C gate I3) | everything else: no answer, refused, access denied, a Windows error, a short write, a driver failure | a blank slip, a slip too long |
| Render step (raster or desktop capture) | timeout or error; nothing was sent | — | a payload that cannot be rendered |
| Lease expiry | — | always | — |

### 7.6 Ordering and one writer per printer

- **Head of line.** For each printer (or each target device in simple mode), only the oldest unresolved job, `queued` or `leased`, can be leased. Jobs that are `needs-confirm`, `failed` or stale are parked and do not block the jobs behind them.
- **Contended leases.** Every candidate competes for the same head job, so the CAS lets exactly one writer win. A printer therefore never has two writers.
- **KOT before bill.** For the same order, jobs created in one request get increasing `createdAt` in kind order: KOT first, then bill. This keeps today's "KOT before bill" guarantee.

### 7.7 Labels

- **REPRINT:**
  - a KOT, notice or EOD retried after a `maybe` failure or a lease expiry;
  - every staff reprint of a KOT.
- **DUPLICATE:**
  - any bill printed after a `maybe` attempt;
  - every staff bill reprint (today's `reprint: true`).
- **BACKUP PRINTER:** a job printed on a printer's backup instead of the printer itself (§9.4).
- **Rendering:** the labels print as one large inverted banner at the top of the slip, for example "BACKUP PRINTER · REPRINT", from a new `banner` prop on `KOTReceipt` and `OrderReceipt`. Labels live on the job, not in the payload, so the payload snapshot stays unchanged. Labels are only ever added, never removed.

### 7.8 Timers and limits

| Name | Value | Why |
|---|---|---|
| Lease | 90 s | Covers rendering (12 s) plus the write deadline (70 s) |
| Backoff after `sent:"no"` | 2, 5, 10, 30 s, then every 30 s | Matches today's reconnect cadence |
| KOT alarm | 20 s from creation without `printed` | |
| Stale, needs a tap | queued > 30 min (`PRINT_HOST_MAX_AGE_MS`, unchanged) | Stops yesterday's KOT printing at opening time |
| Failed | the second attempt that may have printed (`uncertainAttempts ≥ 2`); a refusal (`sent:"no"`) never counts | The owner's rule after Session 1B: the first attempt plus one labelled retry, then staff decide (§10's panel). No automatic attempt while the printer is off (§9.1) |
| Device offline | no heartbeat for 90 s | |
| Retention | waiting slips (queued, needs-confirm, failed, a leased row) 3 h, unless staff acted on it in the last 15 min or it is still leased (a lease that runs, or ran out within 15 min; final gate M3); finished slips (printed, dismissed) 45 min; `PrintDevice` rows unseen for 7 days. The panel's feed reads 3 h 15 min (final gate M2) | The owner, after Session 1D: no print data kept longer than needed. Never under the KOT repair window (30 min) plus 15 min, or a deleted printed row could be re-created and print twice |

### 7.9 Late acknowledgements

- **On the agent:** after a successful write, the agent records `{ jobId, epoch }` in localStorage as "printed, ack pending". It retries the ack every 5 s for 10 minutes and clears the entry once the server answers.
- **On the server:** a late ack is accepted if the job has not been leased again since that epoch, i.e. it is still `leased` with that epoch, or it is `queued` or `needs-confirm` after expiring from that epoch. The job is marked `printed` and the log records `late-ack`.
- **If the job was leased again:** the ack is logged and otherwise ignored. The new attempt carries REPRINT, or for a bill it is `needs-confirm`.

### 7.10 Phase 1 decisions (implementation plan, 2026-10-02)

The Phase 1 plan ([2026-10-02-phase-1-lifecycle.md](../plans/2026-10-02-phase-1-lifecycle.md)) makes these choices where this spec left room:

- **Phase 2 items.** `printerIds` / `jobIds` on lease, and the `printerId` field and index, arrive with printers in Phase 2. In simple mode a device's line holds only jobs targeted at it, so the lease call itself is "lease mine now".
- **No `{status, nextAttemptAt, createdAt, _id}` index.** No Phase 1 query uses it.
- **`myRecentJobs` rides the 20 s pulse, not the wake.** Only agents poll wake; Active CPU is the tightest limit.
- **A `"retried"` log event** covers Print again and Print now.
- **The cashier's "print again" sets `approvedAt` and is the bill's one labelled retry** (corrected at the Session 1C review gate, M8: since the owner's rule after Session 1B it sets `uncertainAttempts = 1`, not 0). The copy is never parked as stale, and a second "maybe" fails it.
- **A spent daily wake share stops the agent's polling** until the next cafe-day. Leasing then rides realtime nudges and the pulse, so the shared cap truly bounds the cafe's total.
- **Dismiss covers `queued`, `needs-confirm` and `failed`, never `leased`.**
- **With a host, the sweep retargets every queued job to the current host** (rows from before Phase 1, and rows from before a re-designation).
- **The agent's wake is a new `POST` beside the unchanged `GET`.** Tabs from before Phase 1 keep polling the read-only `GET` for one release.
- **The sweep throttle is per server instance, not per cafe.** Every step is idempotent, so two instances sweeping in the same minute only repeat no-ops.

**Rulings at the Session 1A review gate (2026-10-03).** Implemented in Session 1B unless noted:

- **Opt-in by header (§7.4).** An order request creates its slips on the server only when its call site sends `x-pos-print-agent: 1` and `x-pos-device-id`; `x-pos-print-bill: 1` adds the bill (Pay Now, the POS settle). Without them the route creates nothing and answers exactly as before, so a tab from before Phase 1 keeps printing its own slips and nothing prints twice. A bad print header never refuses an order write. The answer carries `printJobs: [{ id, kind, targetDeviceId, label }]` only when the request opted in.
- **Simple mode keeps today's job keys (§6.5).** `kot:<orderId>:<round>`, `bill:<orderId>`, `void:…`, `moved:…`: one job per slip, so a server-made job and an old tab's enqueue of the same slip collide on the unique key instead of printing twice, and a retarget never changes the key the repair looks for. The printer and copy parts join the key with Phase 2 printers.
- **The repair (§7.4 step 2) covers server-owned KOT rounds only.** The order CAS records `Order.kotPrintDevices` (positional, like `kotIdemKeys`; `""` = a round its tab printed). Bills, voids and moves are not repaired; the client re-sends any slip its answer did not name, under the same key. Replays create nothing.
- **The public auto-accept**, with a host, queues its KOT for the host in the same request, so it prints with no POS tab open. It does not stamp `kotPrintedAt`: the self-order lane stays as the backstop and builds the same key. With no host nothing is made and the lane prints it as today.
  - **Deferred to Session 1C (Session 1B final review, C1).** Only the page lanes build the same key. The print host's own self-order lane wins `/kot-claim` and prints the KOT locally, with no job, so a server-made job would print a second, unlabelled KOT for every auto-accepted QR order. Until 1C makes that lane job-aware, the auto-accept creates nothing and answers exactly as before Phase 1.
- **No host: a waiting job goes back to the device that asked for it** (the 1A review's I1 part 2). The sweep and the host teardown send every `queued`, `needs-confirm` or `failed` job to its `originDeviceId`, keeping its state and labels; only a job no device asked for is dismissed as `host-cleared`. With a host, parked and failed jobs move to the host too. Never a leased job.
- **Only the host polls the wake in Phase 1** (the 1A review's I3, and its recommendation 1). With no host no device polls: each prints its own slips from its own order responses, `print-status` events aimed at it, local retry timers and the pulse (§17.2 "no polling", §17.3 rule 1). One poller keeps the shared daily cap exact. Dividing the cap by agents online, or by agents seen this cafe-day, does not bound agents that join late (one alone spends 9,600 wake hits before two more arrive, then each spends 4,800). When several agents poll (Phase 2), the cap becomes a server-side split of the cafe's remaining daily allowance, which agents report on their 30 s heartbeat.
- **`print-status` (§10)** is `{ kind: "print-status", job: { id, status, target? } }`: `"queued"` with its device when a job is created, then the final state (printed, needs-confirm, failed, dismissed). An agent leases on the events aimed at it, so a nudge never fans out into empty leases. The `print-job` nudge is published for server-made jobs only when a host exists (one agent). Realtime cost: 3 Worker requests per slip (§17.2).
- **The lease CAS is also fenced on `targetDeviceId`**, so a job retargeted between the read and the CAS is not leased by its old device. A lease call that ran out of steps answers `retryAt` = now + 2 s. A failed lease heartbeat no longer fails a lease that committed.
- **Answered by the owner after Session 1B (see the next block):** refusals never count, and the limit is two attempts that may print.

**Rulings at the Session 1B review gate (2026-10-03).** The owner's decisions after Session 1B, and the gate's rulings; implemented in Session 1C unless noted:

- **No automatic attempt while a printer is off (owner).** An agent never leases while its device cannot print (`canPrintNow()`: no printer, not connected, or open in another tab), and after a refusal (`sent:"no"`) it leases again only once its printer's state changes, or after 30 s. A refusal marks nothing as attempted.
- **At most two attempts per slip when the printer is ready (owner).** The first, plus one labelled retry: REPRINT for a KOT; for a bill, the cashier's DUPLICATE prompt. Then the slip is `failed` and waits in the panel (§10). Counting, pinned: `uncertainAttempts` counts a "maybe" failure, a permanent failure after a byte left, and an expired lease; `PRINT_MAX_PAPER_ATTEMPTS = 2`; `attempts` (leases) only paces the backoff. The cashier's print again and a staff Retry each set `uncertainAttempts = 1`: one tap, one try. This replaces `attempts ≥ 8` and `uncertainAttempts ≥ 3` (§7.2, §7.8).
- **R4 becomes the job-aware self-order lane.** The agent's `/kot-claim` makes the KOT a print job in the same request (today's key), for the device that prints now. One creator per KOT, because the claim CAS still lets exactly one lane win; the public auto-accept stays exactly as live today and makes no job. A failed create keeps the claim and names no job, and the lane enqueues the KOT under the same key. No added request or write.
- **Every device with an identity prints through the agent.** Its call sites never print a slip themselves: the order requests opt in (R1), a slip the answer named is followed by its id, and one it did not name is enqueued as the agent under today's key. The host leases for the whole cafe; with no host, every device leases its own line. Only a device with no identity keeps today's local print.
- **A failure's class comes from its curated sentence** (`lib/print-write-outcome.ts`): refused before any byte left is "no", too large or blank is permanent, anything else is "maybe". The write queue is unchanged: the agent prints one job at a time.
- **With no host, agents never lease on the broadcast `print-job` nudge** (1B's M-c): a job sent home reaches its device through the pulse's `printJobsForMe` (the agent names itself with `?device=` on the existing pulse) within 20 s, or a `print-status` aimed at it.
- **1B's minors:** a ref carries its job's status (M-d); an enqueue that finds its host gone sends a row with an asking device home (M-a); an enqueued row announces itself (M-e); a staff accept the server prints writes `kotPrintDevices` in the same order write (M-f). M-b and M-g: no change.
- **Known limit (gate finding G5):** on the Android app's TCP lane, a printer that cuts the connection after the raster was buffered reads as printed. The post-job `DLE EOT` check (§9.6, §10, Phase 3) detects it.
- **The one waiting-slips panel lands in Session 1D** (§10): its rows come from 1D's pulse feed, with no host only 1D's pulse sweep moves them, and 1C and 1D release together.
- **Nothing is deployed until every phase is done (owner).** The free-tier check is a local measurement (§17.3 item 5).

**Rulings at the Session 1C review gate (2026-10-03).** Implemented in Session 1D unless noted:

- **A slip that cannot be drawn counts (owner, I3).** A refusal caused by the slip itself (it could not be drawn in time, or its end-of-day figures never loaded) counts toward the two attempts: the second one for a slip while its printer is ready sends it to `failed` ("Couldn't print"), freeing its device's line. A refusal because the printer is off (not connected, Bluetooth off, busy, open in another tab, no printer) still never counts. The agent counts per slip in memory and acks the second one `permanent`; the server rule is unchanged.
- **The agent's minors.** An unanswered failed ack is kept and re-sent like a printed one (so a lost answer never turns a refusal into a counted "maybe"); the pending-ack store keeps an in-memory copy when storage refuses a write; each lease waits for any ack still on the wire; a maybe whose answer names a retry time costs no extra lease.
- **The budget, recounted.** One trailing empty lease per burst (Phase 1's busy day: 2,400 lease and ack requests ≤ the 2,640 estimate) and the refusal re-check per device (at most 2,880 requests a day for a printer that reports ready but keeps refusing) are pinned. Phase 2's stations must recount (one lease per round).
- **One attention feed (§10).** The waiting-slips panel, the printer button's count and the 20 s alarm read ONE bounded read on the existing pulse: every slip still `queued` 20 s after it was made, every `needs-confirm` and every `failed` slip of the last 12 h, oldest first, at most 20, each naming its asking and its printing device. `myRecentJobs` is not added: a second read on the hottest poll was not worth it (Active CPU is the tightest limit).
- **Readback by exception (§10).** A slip that prints needs nobody. Every slip that has not printed within 20 s shows with its state on every device, `/pos` included, through the printer button's count and the panel.
- **The alarm (§10)** fires at the first pulse after the 20 s mark (between 20 s and 40 s), once per slip, on the device that asked for it and on the device that prints it, for a KOT and for a bill to check. Its notice carries a Show button that opens the printer sheet (on a phone the notice covers the top bar).
- **The pulse runs the sweep** after its answer, at most once per 60 s per instance (§17.3 rule 2): with no host it is the only request that expires leases, sends jobs home and repairs KOT rounds. **A staff Retry or Print again is aimed** at the printing device with a `print-status`, since with no host agents never lease on the broadcast.
- **Old tabs (the 1A reviewer's recommendation 3): no change.** They keep today's pulse feeds for the release window; the dashboard band stays one release and goes with the old claim drain.

**Rulings at the Session 1D review gate (2026-10-03).** The owner's decisions after Session 1D, and the gate's rulings; implemented in Session 1E unless noted:

- **The newest 20 (owner, I-1 option A).** The waiting-slips feed reads the newest 20 rows (`{createdAt: -1, _id: -1}` on the same index; `explain()`: a merge of index scans, no in-memory sort) and shows them oldest first, so a new problem always shows and rings; the older backlog stays in the count ("20+").
- **No extra print data (owner).** Waiting slips nobody acted on are deleted 3 h after they were made (was 12 h), and the feed's window follows; a slip staff acted on (Print now, Retry, Print again) or whose lease ran within the last 15 min is kept until then, so nothing is deleted mid-print. Finished slips go 45 min after they were made (was 2 h): never sooner than the KOT repair's 30 min window plus a margin, since a job is never made before its round fired and the repair would re-create a deleted printed row and print it twice. `PrintDevice` rows unseen for 7 days go too. It all rides the existing prune (the pulse's `after()` sweep, at most every 5 min per instance, the existing index): no cron, no new request. The repair keeps its own 12 h window for candidate orders, so a long-sitting table's new round is still repaired.
- **The alarm, remembered.** Once per slip; again only when it gets worse; a slip staff acted on loses its notice quietly; a slip that leaves the feed is remembered for a minute (a moment's lease never rings twice); while the feed is cut, a slip older than the page is kept; a slip of any kind that could not print rings; a page that opens while slips wait shows one summary; an unmount takes its notices down.
- **A tapped row is released by its own answer** (one promise per tap; TanStack's per-call callbacks fire only for the latest call).
- **An ack the server did not really answer is kept:** 401, 403, 408 and 429 are no answer.
- **1C, 1D and 1E ship together.** A failed ack kept in the pending store would be re-sent as "printed" by a 1C-only build: never deploy, or roll back to, a 1C-only build.
- **Replays after a prune: no guard.** A "Send again" replay that comes after its finished row was pruned would enqueue it again; it exists only while that POS is frozen on an unconfirmed send, so it is not a realistic path at 45 min, and a guard would add an order read to every client enqueue.
- **Measured, no change:** a backgrounded or screen-off Android host drew and printed KOTs in 2–4 s (no I3 drawing timeout); F1's dropped unrelated kick costs latency only (≤ 30 s); a slow slip's lease expiring under its own agent is resolved by the late ack (§7.9).

**Rulings at the Phase 1 final review gate (2026-10-03).** Fixed on the branch at the gate (TDD), unless noted:

- **The dashboard band's Print is the lifecycle's Print now (I-1).** On a new build the host's "older slips" Print called the old `/claim`: it marked the row printed before any paper and printed it without its REPRINT/DUPLICATE banner. It now calls the panel's own Print now (`/retry`), so the agent prints the slip through the lifecycle (banner, ack), and a tapped row is released by its own answer. New builds never call `/claim`; it stays one release for old tabs. No server-side guard on `/claim`: a labelled row reaches an old host tab only after a rollback (ruled out), and a refused claim would stall that tab's drain on the row.
- **The host names itself on the pulse too (I-2).** Spec text above already said a spent wake share leaves leasing to realtime nudges and the pulse; the host was left out of the pulse, so with the socket down and its share spent it heard of other devices' slips from nothing. Every agent now names itself (`?device=`): one bounded, index-backed read on the host's own pulse, no new request. Proven on the device with every wake answered 503: a KOT made by another device leased 35 ms after the next pulse and printed.
- **The Windows app's failures are classified (I-3, §7.5).** The host bridge unwraps the shell's own sentence from the IPC error; before, every Windows failure read as "maybe" (a PC with no printer chosen turned each KOT into REPRINT, then "Couldn't print"). The sentences are copied in `lib/desktop-shell-messages.ts` and pinned word for word against `apps/desktop/src`. The panel shows a Windows refusal in the shell's own words ("No printer is chosen for this PC…").
- **The pulse's own cost, measured (I-4).** See the plan's "Phase 1 final review (gate)": the pulse before and after Phase 1 on the same database and traffic, counted as printing.
- **Minors.** M2: the feed's window is the queued retention plus the acted grace (3 h 15 min), so a slip tapped before its 3 h stays shown while the prune keeps it. M3: the grace keeps a slip staff acted on lately, or one still leased (every way out of a lease clears it); wording only. M4: the summary notice counts the slips it stands for and goes with the last of them. M5: the feed reads one row more than it shows, so exactly 20 waiting reads "20", and the alarm keeps a cut-off notice only when something was really cut off. M6: Print now on a stale slip is staff acting on it: its notice goes quietly. M7: TEST-CHECKLIST's "Couldn't print" names the printer's own sentence too. M8: the soak refuses a database that is not local, and stops after its first order unless that order is in its own database. M9: no change (a test tool; its agent mode is exact). M10: stale hours fixed in comments, leg labels and test names; a message-less `assert.equal` cannot hang (only a falsy `assert.ok` without a message reads the source).
- **Reviewer minors.** m-1: the unused `{ originDeviceId, createdAt }` index is dropped (§6.5). m-2: an older Worker refuses `print-status`; the go-live run redeploys the Worker before the app, and GO-LIVE-CHECKLIST says to use it (not `npm run deploy` alone) for such a release. m-3: no change: production is HTTPS, and every shell here (WebView 109+, Electron, `localhost`) has Web Locks.
- **The alarm rings after an untouched restart.** The page tried the sound only from a touch, so a printing device that restarted untouched never rang. It now tries once on mount as well. Measured on WebView 109 with today's APK: Android's WebView lets the page's own AudioContext start without a touch, so the ring sounds with no app change (the APKs stay byte-identical). The Windows app is expected to behave the same (Electron's default autoplay policy); the owner checks it (TEST-CHECKLIST). A plain browser tab still needs one touch.
- **Seen at the gate, a test artifact:** a script that backdated a printed job's `createdAt` 31 minutes before its round fired let the 45 min prune delete it inside the 30 min repair window, and the repair printed the round again. A real job is always made after its round fired, so the pinned floor (finished retention ≥ repair window + 15 min) holds; the run shows why that floor matters.

### 7.11 Direct print on the asking device (Phase 2 plan, the owner, 2026-10-04)

The owner, after the client's first day on Phase 1: when the device that takes an order is the one that prints it, print there at once, without the realtime round trip and with the fewest server requests. Phase 1 already leases from the order's own answer (no realtime wait), but it still spends a lease request, publishes realtime messages the device does not need, and the echo can cost an empty lease. Phase 2 Session 2B (plan decisions 15 and 16):

- **Leased at creation.** When an order request (or `/kot-claim`, or a client-started enqueue) comes from the tab that drains this device's slips with its printer ready (header `x-pos-print-lease: <tabId>`), and the slip's printing device is the asking device, the first slip of each line in that request is created already `leased` to that tab (epoch 1, the §7.2 lease fields, log `created` + `leased` "direct") in one write, provided its line holds no older `queued` or `leased` job (§7.6). The answer carries the leased job; the tab prints at once and acks. Any other slip is created `queued` as before. Printers mode (Session 2C) applies the same rule per printer line for the printer's writer.
- **Cost.** A slip the asking device prints itself costs one request (its ack) instead of two, one database write fewer, and no realtime request.
- **No realtime message to yourself.** A job leased at creation publishes no "queued" `print-status` and no `print-job` nudge, and its final state is not published when its creation lease acks it; the asking tab's readback takes that state from its own ack. Realtime, with the poll and the pulse as fallbacks, carries only slips that another device, or another tab of the same device, prints.
- **Failures keep §7's rules.** A tab that dies before printing lets the lease expire after 90 s (KOT: REPRINT; bill: `needs-confirm`). An answer that never arrived is delivered again when the client re-sends the slip under the same key: the enqueue answers a job still leased to the same device and tab with that lease. The agent ignores a job it already holds, is printing or has acked-pending, so the delivery is at-least-once with an idempotent consumer. A tab reloaded in between has a new id; its old lease expires and the KOT prints REPRINT, as for a refresh mid-print.
- **The ack answers `more`** (Phase 2 plan decision 9): the agent leases again only when the acked job's line holds a job due now, so a burst no longer ends with an empty lease.

**As built at the 2A review gate (2026-10-04; Session 2B's exact code, proven on the emulator).** Where the bullets above left room, or the gate found more:
- **No final state is published at all (gate finding G-1).** Phase 1's final `print-status` frames (printed, needs-confirm, failed, dismissed) had no listener: the readback chip and the waiting-slips panel read the pulse's feeds (§10), and an agent leases only on a `queued` frame aimed at its own device. So no lifecycle transition and no dismiss publishes anything; only a new `queued` job is announced to the device that prints it (and, in host mode, the host's `print-job` nudge). The asking tab's readback therefore needs nothing from its own ack: it reads the pulse as before. A slip another device prints costs 2 Worker requests (was 3), a printers-mode slip 1 (was 2) (§17.2).
- **The jobs a device is told about are the ones a lease can act on (G-2).** The wake's `jobsForMe` and the pulse's `printJobsForMe` leave out a lease that is still running (it is being printed, often by this very tab), and still count one that ran out, so the lease call that expires it comes. A change of the agent's own state (the bridge freeing up from its own slip, its printer's status, the gate) looks at the line only when the agent is idle; it never queues a lease behind a running cycle, whose ack's `more` already answers. Job signals (an answer's job, a `queued` frame, the pulse, the wake, a timer) still lease once after a running cycle.
- **`more`** is true when the ACKING device's line holds a queued job, due now or in backoff (a job in backoff is then leased once, and the lease's `retryAt` sets the agent's timer). It is answered only when the acked job left the line (printed, needs-confirm, failed); a job back in the queue is its line's head, and its `nextAttemptAt` says when. A failed read drops only the hint. An absent `more` (an older server) means "lease again", as in Phase 1.
- **Who may be made leased.** Only the first slip of a request on its line, when the request names its tab, the slip prints on the asking device, and the line is free (no job leased, no queued job that is fresh or approved: the lease's own line filter, one read). The header is sent only while the tab drains this device's slips, its printer can print now and no refusal holds it; one header both asks for direct print and lets the enqueue hand a lost lease back. A Pay Now's bill is made queued and is reached through the KOT's `more`; it is not announced to the device printing the KOT.
- **The enqueue (`POST /api/print-jobs`)** with the header reads the host once: no host, or the asking device is the host → the slip is the asking device's own (made leased on a free line; a slip still leased to the same device and tab, its lease running, at the same epoch, is handed back); another device is the host → Phase 1's enqueue, unchanged.
- **A job made leased that the agent cannot print at once** (the bridge busy, the drain lock lost for a moment) waits its turn on the page; one that arrives after the printer went off is printed anyway and refused (`sent:"no"`, never counted), so it goes back in line instead of expiring into a REPRINT. But a held job prints only within 60 s of its arrival (the 90 s lease less 30 s; its lease began at most one 15 s request timeout earlier), so its print always starts inside its lease; an older one is dropped unprinted, since its lease may have run out and another writer may have printed it as REPRINT (Session 2B's fresh review, I-1). A page that unmounts drops what it held. Dropped leases expire (KOT: REPRINT; bill: `needs-confirm`). *(Superseded by Session 2B's final review, I-1, below: a held job dropped unprinted is handed back as a refusal; only a tab that dies with it still lets its lease expire.)*
- **No new field.** A job made leased is an ordinary leased job (the same fields `planLease` sets); its log says `leased` with the detail `direct`.

**Changed by Session 2B's final review (2026-10-04; the 2B gate re-checks it).**
- **One (id, epoch) prints once however it reached the tab (C-1).** The enqueue hands back any running lease of the asking device and tab, including one the agent took through the lease call; a Send again landing while that job printed (or before its lease answer) printed it twice, unlabelled. The agent now remembers every (id, epoch) it prints, whatever the path, and drops a held twin: the consumer is idempotent for "holds, is printing, or has acked-pending".
- **A held job dropped unprinted is handed back as a refusal (I-1).** The 60 s bound and a page that stops used to drop a held job with no ack, so a slip the tab knew it never sent expired into a REPRINT KOT or the cashier's question. It is now acked `failed`, `sent:"no"` (never counted), before any lease; the server applies it only while the job is still leased at that epoch (§7.2), and ignores it once the lease's expiry has been applied (the job queued as REPRINT, or `needs-confirm`), at a new epoch, or on a resolved job, so it can never cause a second paper. A lease that ran out but is not yet swept still takes it, rightly: nothing was sent (worded at the 2B gate, M-C). A dropped job therefore prints again unlabelled; only a tab that dies with it still lets its lease expire.

**As built at the 2B review gate (2026-10-04; Session 2C's Task C0, and printers mode).**
- **A lease is handed back only within one request timeout of its start (I-A).** The enqueue hands a running lease back to the asking tab only while at least 75 s of its 90 s remain (`PRINT_LEASE_MS` less the 15 s request timeout); a held job prints only within 60 s of its arrival, so its print always starts inside its lease. A later re-send gets Phase 1's answer and the lease expires into one REPRINT. Without the bound, a drain lock moving between two windows of one PC could print one KOT twice.
- **A stop during a hand-back hands back the job the cycle took (M-A)**, and a hand-back applied by the agent's 5 s retry sets the agent's timer from its answer (M-B).
- **Printers mode (Session 2C).** The first job of a request on a printer line that the asking device writes and names as ready (`x-pos-print-ready: <printerIds>`, beside `x-pos-print-lease`) is made leased to the asking tab when that line is free. Every other new queued job is announced to its printer's writer only; no host nudge is published (the host plays no part in printers mode).

## 8. Routing (Phase 2)

Routing is a pure function, `routeJobs(event, catalog, printers, devices)`, with unit tests. It returns `{ printerId, payload, copyIndex, jobKey }[]`.

| Event | Rule |
|---|---|
| **KOT round** | Group the round's items by resolved station. For each station that has items, send that station's items to every printer whose `slips.kotStations` includes the station. Send the whole round to every printer with `slips.kotAll`. Repeat per copy (`copies.kot`). Each slip shows the station name and the round's single KOT number. |
| **KOT, station without a printer** | Send it to the `kotAll` printers, labelled with the station name. If there are none, send it to the default bill printer with the header "‹STATION› (no printer set)". **A KOT is never dropped.** If there is no printer at all, the job goes `failed` straight away with the error "No printer is set up" and an alert. |
| **Bill / receipt** | Use the originating device's `billPrinterId`. If it isn't set, use the default bill printer: the first enabled printer with `slips.bill`, by `order`. Repeat per copy (`copies.bill`). |
| **Void / modify notice** | Send to the printers of the voided item's station (resolved from the snapshot). |
| **Moved / cancel notice** | Send to the printers of every station that received a KOT for this order. |
| **End of day** | Use the requesting device's bill printer. |
| **Simple mode** | §6.6: one job to `targetDeviceId`, exactly as today. |

### 8.1 Phase 2 decisions (implementation plan, 2026-10-03)

The Phase 2 plan ([2026-10-03-phase-2-routing.md](../plans/2026-10-03-phase-2-routing.md)) makes these choices where this spec left room or where its text would hurt a cafe. Each is a numbered decision there.

- **One writer per printer in Phase 2.** A device printer is written only by its own device; a LAN printer only by its printing device (`primaryDeviceId`, required for LAN). The "any online LAN device" rule of §9.3 and the backup printer of §9.4 are Phase 3's failover.
- **All copies of a slip are one job** (`PrintJob.copies`, 1–3), not one job per copy (§6.5 `copyIndex`): a copy never costs another lease and ack (§17). A retry that may repeat paper repeats every copy, labelled.
- **The job key adds the station:** `<slip key>:<printerId | none>:<stationId | all | ->`; a printer that takes two stations gets one slip per station. Simple mode keeps today's keys.
- **A station no printer takes rides the full copy** when a full-copy printer exists (it already holds those lines; a separate slip would print every KOT twice in the commonest setup). Otherwise the default bill printer prints it as "‹STATION› (NO PRINTER SET)"; with neither it fails at once, visibly: a KOT is never dropped.
- **A full copy that is its round's only slip is today's KOT, unchanged**; beside station slips it says "ALL STATIONS". A cafe converted from simple mode sees no change on paper.
- **Notices follow the KOT:** a void, moved or cancel notice goes to every printer its station's KOT reaches (own printers, full copies, fallback) that has Notices on. The voided item's station comes from today's menu (order lines store no station).
- **The device's bill printer lives on the device** and rides the request as a header (`x-pos-bill-printer`), instead of `PrintDevice.billPrinterId` (§6.4): an ordering-only device has no `PrintDevice` row (only pollers beat, §7.10 R6), and rows go after 7 days unseen.
- **In printers mode only writers poll the wake,** sharing 14,000 hits a day split by the writers the setup names (never by who is online): the server-side split §7.10 asked for, with no new write.
- **The ack answers `more`,** so an agent never leases to find an empty line; with copies as one job a slip stays at one lease and one ack. The recount (§17.2 with stations): normal day 4,800 (two stations) and 5,790 (plus a full copy); worst case 17,628; 2 realtime requests per slip in printers mode.
- **No `backupPrinterId` or `health` on `Printer` until Phase 3.** Phase 2's printer dot is its writer's heartbeat and link state.
- **The setup screens live on the admin Printer setup page (`/printers`)**, not in Settings: Settings sections are bound to Settings-document fields.
- **Android bridge v2 keeps v1:** the new APK answers v1 messages exactly as today, so a page not yet deployed keeps printing with it; a v2 page opts in.
- **A deleted station is cleared everywhere it was chosen** (categories, items, printers); the default station can't be deleted, only moved.
- **The routing read is never cached** (a printer switched off stops getting slips at once); simple mode pays one small read per order request.

**As built at the 2B review gate (Session 2C's exact code, 2026-10-04).** Where the decisions above left room, or the gate found more (plan: "2B review gate: rulings"):
- **Every slip is routed at creation in printers mode, whoever asks** (the order routes, `/kot-claim`, the enqueue): one job per printer line, aimed at the printer's writer, under `<slip key>:<printer | none>:<part>`, so replays, re-sends and repairs collide. The enqueue answers a slip that became several jobs with the first id plus every job, and `not-routed` when nothing routes (never a local print).
- **A slip no printer takes is made failed at once** (`printerId: "none"`, its reason, its log); simple mode's sweep never moves it, and a staff Retry is refused: "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order."
- **A printer line is leased only by its writer** (the printer routable, its writer this device: one read of the printers per lease call), fenced on the printer and claiming the job for that writer in the same write; at most one job per line; `more` asks the acked job's own line.
- **Every device is an agent in printers mode.** Jobs for me (the pulse, the wake) count every job aimed at the device and name the printers of its printer jobs. A device whose printer list is stale (a missed `print-setup` frame) reads it again, at most once a minute, when a printer job aimed at it is on a printer it does not print on, or when the wake says the setup no longer names it a writer.
- **A printer job prints only on its own printer**: a LAN printer whose `host:port` is the app's selected printer, a device printer whose transport and address match, a Windows printer on the Windows app; any other is refused `sent:"no"` (never counted). Copies are written one after another in one lease; a failure after the first copy is "maybe".
- **The sweep moves a waiting printer job to its printer's current writer**, and fails a queued one whose printer was removed, switched off or left with no writer; a bill waiting for the cashier's answer keeps waiting. A staff Retry on a printer that still takes slips puts the job on its current writer; on a gone one it is refused, never guessed onto another printer. The repair routes a server-owned round with no job again, with today's setup.
- **Each device reads the outlet's printers** (`GET /api/printers`) on mount, on a `print-setup` frame (published by printer writes only), on focus at most every 30 min, and when its list looks stale (above). Names are unique ignoring case (a pre-check); a device's bill printer counts only when routable.

**Changed by Session 2C's final review (2026-10-04; the 2C gate re-checks it).**
- **A device printer is this device's printer by the id the app reports (I-1).** The Android app names its printer `<transport>:<id>` (`bt-classic:<MAC>`, `ble:<MAC>`, `usb:<vendor>:<product>`). A device printer's `address` may hold the bare id (as §6.3 says) or that whole id; either matches. Before, a Bluetooth, BLE or USB printer was never this device's, so its slips would have waited forever once the setup screens (Session 2D) let staff save one. *(The 2C gate, F-2: compared ignoring case, since the app spells a MAC upper-case and a USB id lower-case and an address typed by hand may not.)*
- **Only jobs an agent can lease kick it (I-2).** Jobs for me name the printers of the printer jobs they count and, beside them, whether one waits on the device's own simple-mode line (`ownLine`; absent in simple mode, whose answer is unchanged). The pulse and the wake kick a lease, and the wake keeps its fast cadence, only for the device's own line or a printer it prints here. Jobs on a printer it writes but does not print on (a second printer before §9.2's several printers per device; a printer whose address is not its own) wait visibly in the panel, and the list is read again at most once a minute; before, they kicked an empty lease on every pulse and every wake for the whole service. *(The 2C gate, F-1: the answer covers the device's oldest 20 waiting jobs; a full answer kicks, since a job the agent can lease may wait behind them.)*

**As built at the 2C review gate (Session 2D's exact code, 2026-10-04).** Where the decisions above left room, or the gate found more (plan: "2C review gate: rulings"):
- **Staff set the outlet up on the admin Printer setup page** (§11). "Set up printers" shows only while no printer exists, and only on the device that prints today (the print host when one is set; with no host, this device): Printer 1 is this device's own printer with Bill, Full KOT copy, Notices and End of day, one copy each, so its paper does not change. "Add printer" appears only once a printer exists (a first printer with only some slips would switch the cafe to printers mode with slips going nowhere).
- **One device prints one printer until §9.2's several printers per device (Session 2E):** the setup form and the server refuse a second routable printer (enabled, taking a slip) for one writer; a Windows or browser serial printer is matched by transport alone, so a second would print on the first one's paper.
- **A device printer is saved from the printer that device saved, never typed** (the app's own spelling of its id; the app's network printer becomes a LAN printer that device prints). A LAN printer's printing device is chosen from the Android app devices the setup page knows (a device is known once it has polled the wake), or this device in the Android app.
- **Test print** is a keyless `test` job on that printer's line for its writer (leased at once to the asking tab when it prints that printer), refused for a printer that is not routable; it rides the lifecycle like any slip.
- **This device's bill printer** is chosen in the printer panel among the routable printers that take bills, kept on the device and sent with every print request (decision 7).
- **A replay or re-send after an admin changed the setup** inside one request's retry window routes to the new printer, and both print (inherent to the key adding the printer, decision 3; the repair is immune: it routes only a round with no job). Accepted at the 2C gate (M-4).
- **Station writes never leave the setup half-done:** a rename is saved before the default moves; a delete clears every pointer before the station goes, and names any printer it leaves with no slip.

**Changed by Session 2D's final review (2026-10-04; the 2D gate re-checks it).**
- **The bill printer picker says what routing does (M-6).** *(Rewritten by the 2D review gate.)* Routing sends this device's bills, and its End of day, to its choice while that printer is routable **and takes bills**: a printer prints only the slips its boxes say (the 2B gate had counted any routable choice, so a tablet's bills kept printing at a printer whose Bill box the admin had unticked). A choice whose Bill box was unticked later, or that was switched off or deleted, shows the default and says why ("‹printer› no longer takes bills, so this device's bills go to the default."); the section shows only while some routable printer takes bills, and promises End of day only for a chosen printer (with "Default" it goes to the first End of day printer, §8).
- **"Set up printers" says where other devices' slips go (M-1).** Its confirmation reads "Printer 1 is set up. This device's paper does not change, and other devices' slips print here too." (with no print host, every device's slips now print at Printer 1); before, it said "Nothing changes on paper".

**As built at the 2D review gate (Session 2E's exact code, 2026-10-05).** Where §9.2 left room, or the gate found more (plan: "2D review gate: rulings"):
- **One Windows PC prints several printers** (§9.2): a printer job names its Windows printer (`printHtmlOn`, desktop 1.11.0) and is drawn, and its page sized, for that printer's paper; a PC may write several Windows printers, each a different one (Windows names compared ignoring case). An older Windows app prints only its chosen printer: another Windows printer is never local there, so its slips wait visibly and never print on that paper. Every other device prints one printer until Session 2F (an Android app on bridge v1; a Chrome tab, §9.7).
- **A refusal holds only its own printer** on the Windows app (everywhere else the device's one printer, as before); the lease, direct print and the kicks name only the printers no refusal holds, and a held printer is tried again when its hold ends.
- **Every job of a slip leased to the asking tab reaches it:** with two printers on one device a slip is leased once per printer line (decision 15), and each prints at once.
- **A station delete that took a station off a printer publishes `print-setup`**, as a printer save does.

**Changed by Session 2E's final review (2026-10-05; the 2E gate re-checks it).**
- **A Pay Now's bill follows its KOTs on a PC that prints two printers (I-1).** With a slip leased to the asking tab on two printers' lines, the agent printed both KOTs at once but lost the first KOT's `more` (the bill waiting behind it on its line) while it printed the second, so the bill waited for the pulse or the wake (up to 20–60 s at the counter). The agent now keeps its wish to lease (an ack's `more`, a kick while it printed) until a cycle leases: the bill is leased right after the KOTs, as on one printer (§7.11: a Pay Now's bill follows its KOT through the ack's `more`). *(The 2E review gate: sound, with two notes. The wish to lease also comes from an ack with no answer (Phase 1's "lease again"). And the fix let a job leased to the tab and taken while a cycle ran count as a wish to lease, so a round leased on two printers' lines ended with one empty lease (G-E1, up to ≈ 450 on the busy day for a counter PC that prints two printers); Session 2F1 fixes it, and only then is the cost "as on one printer".)*

**As built at the 2E review gate (Session 2F1's exact code, 2026-10-05).** Where §9.2 left room, or the gate found more (plan: "2E review gate: rulings"):
- **No request after a `more: false` ack.** A job leased to the asking tab is no wish to lease, so a direct round on two printers ends with its acks; a state change within 500 ms of a printed ack that said `more: false` leases nothing (a kick, a timer or a held job still does); a kick for a slip on a printer this tab cannot lease now (held, or not printed here) leases nothing (the order's queued ref and the `print-status` frame name the printer; the realtime Worker relays the frame as it is); a hold's end is looked at 50 ms after it, on the tab's own clock.
- **One phone or tablet prints several printers on bridge v2** (§9.2): a printer job of one of the POS app's printers is written to it by the app's id (`printer.print { printerId }`), the default's included, and drawn at that printer's paper; a slip with no printer of its own (simple mode, the device panel's test) goes to the app's default as on v1. On v2 the app's list alone says which printers are this device's: a printer the app no longer lists is not local, and its slips wait visibly. Each printer has its own state, readiness, refusal hold and write queue; slips print one at a time through the page's one print surface (no parallel writes in Phase 2). A network printer the setup names this device for is added to the app by itself.
- **The release APK (bridge v1) is untouched:** nothing of v2 is called, one printer, no target; another printer saved for such a tablet waits visibly and never prints on its printer's paper.
- **The setup's one-printer rule is per printer family:** a device may write several printers of one family, each a different one (Windows printers by name; the POS app's network, Bluetooth, BLE and USB printers by the app's id), never the same printer twice; a browser's printer stays one per device. The form refuses a second printer for a tablet whose app speaks only v1 (from its `nativeProtocol`, sent with its wake); the server does not know app versions.

**As built at the 2F1 review gate (Session 2F2's exact code, 2026-10-05).** Where the 2F1 review or the gate found more (plan: "2F1 review gate: rulings"):
- **A printer job's refusal holds only its own printer's line** (M-1, with the 2E gate's M-9): a job whose printer left the POS app's list between the request and the print no longer holds the device line (which paused every printer of the tablet); a slip with no printer still holds it.
- **A down printer's reconnect probes lease nothing** (N-1): on bridge v2 the agent is nudged only when what can print now changes (this device's own printer, or which of the app's printers are connected), never by a printer flipping between `connecting` and `disconnected` while the app probes it.
- **Removing this device's printer keeps the one the app promotes** (G-2): on an app with several printers the panel's Remove makes the first remaining one the default (the contract), and the page takes it as this device's printer from the app's answer; with none left, "No printer set up" as before.
- **The app's printers** (§9.2): one manager, io thread and busy flag per printer; v1 acts on the default exactly as before; the list in `Prefs` with the v1 keys naming the default; one publish for both versions; the notification's worst state.

**As built at the 2F2 review gate (Session 2G's exact code, 2026-10-05).** Where the 2F2 review or the gate found more (plan: "2F2 review gate: rulings"):
- **A printer the setup prints through a device never leaves that device's POS app from the page** (M-4, seen live at the gate): the printer panel offers no Remove for it, this device's own printer included (the 2E gate's I-3 sentence instead, shown once the printers read has answered), and Change printer on a bridge v2 app keeps it in the app (a new printer is added, then chosen; one the app lists is only chosen). So a setup network printer that leaves the app another way (an older page or app) is added back with no reload.
- **The page removes from the app only what it added** (m-3): it records, on the device, the network printers it added by itself, and removes one once no routable printer of the setup this device writes names it (deleted, moved to a new address, moved to another device, switched off), never the app's default and never one staff added, and only against a printers read that has loaded. A moved printer that was this device's own printer is removed by staff in the panel (the gold review's m-A: removing the default by itself would let a printer switched off in the setup change the device's printer for good).
- **A printer the app makes this device's printer starts at the default paper** (m-1): the saved paper is that printer's own.
- **Not in Phase 2:** the app's notification naming two network printers on one address apart (m-2, Phase 4); `PoolList.restore` with a damaged `Prefs` file (m-4, accepted); a JVM test of `PrinterPool`'s publish chain (Phase 3, with the Android hardening); a failed job's cycle keeping a kick for another line (M-11, accepted: the pulse covers it within 20 s).

**As built at the final Phase 2 gate (2026-10-06; plan: "Phase 2 final gate: rulings").**
- **The setup is known once the printers read has answered** (some answer in hand; a failed refetch keeps it), never on a failure with nothing read (Session 2G's review, m-1 and m-2). Until then neither the device section nor **Other printers on this device** offers Remove, and Change printer keeps this device's printer in the POS app (one kept by mistake costs a Remove; a setup printer dropped would leave its slips waiting).
- **A network printer the page asked the app to remove stays in the page's record until the app no longer lists it** (m-4), so a removal that failed or timed out is asked again on the next change.
- **Accepted:** the page removing a network printer it added while a slip is being written to it (an admin re-addresses or switches it off at that very moment) cuts that write: "maybe", so a KOT prints once more labelled REPRINT and a bill asks the cashier. Phase 3's Android hardening may defer such a removal while that printer writes. The not-routed toast's words for a KOT round with no lines (a reprint of a wholly voided round) are Phase 4's setup polish; a new Bluetooth or USB printer chosen by Change printer connecting twice is Phase 3's app code (Session 2G's m-3).
- **The go-live run** for an existing cafe is written in `docs/GO-LIVE-CHECKLIST.md` ("Existing cafes: the printing Phase 2 release"): the Worker first (the `print-setup` kind), then the web, then every open POS screen reloaded (a page from before the deploy never prints a printer's slips: it leases only its own device line), then the apps (the Windows app 1.11.0; the new APK), and Set up printers only when the cafe wants stations. No data migration.

## 9. Printer devices (agents)

### 9.1 What an agent does

- It runs in the web page. A Web Lock makes sure only one tab per device drains jobs, as today.
- It knows which printers it can write to: its own device printers, plus LAN printers it is eligible for (§9.3).
- **Leasing:**
  - It leases immediately when its own order response returns job ids. No poll is needed for the most common case.
  - It also leases on a realtime nudge.
  - **Poll fallback:**
    - socket verified healthy: every 60 s;
    - socket not healthy: every 3 s, but only while the agent has seen a job in the last 2 minutes; otherwise every 15 s.
  - **Shared daily cap.** The cafe's agents share today's single-host cap of 14,400 wake hits per cafe-day. Each agent's cap is `floor(14,400 / onlineAgentCount)`; the wake response includes the agent count. Past its cap, an agent polls every 30 s until the next cafe-day. More printer devices therefore never raise the cafe's request total (§17).
  - **Phase 1: only the host polls** (§7.10, the 1A review gate). With no host no device polls the wake; it leases from its own order responses, `print-status` events aimed at it, local retry timers and the pulse. A divided cap cannot bound agents that join late, so Phase 2 replaces the division with a server-side split of the cafe's remaining daily allowance.
- **It never leases while its device cannot print** (owner, after Session 1B): no printer, not connected, or open in another tab. After a refusal (`sent:"no"`) it waits until its printer's state changes, or 30 s, so a printer that is off costs no attempts and no requests.
- **For each lease:** render, then write, then ack. It reports `sent` honestly, following §7.5.
- It processes one job at a time per printer. Different printers can run in parallel. *(As built through Session 2F1: a page has one print surface, so slips print one at a time across printers, each printer keeping its own line, readiness, refusal hold and write queue (the 2D gate's E-R5, the 2E gate's F-R5). Parallel writes are not in Phase 2.)*

### 9.2 Several printers per device (Phase 2)

| Layer | Today | Change |
|---|---|---|
| Web device-printer store | one record `pos.device-printer.v1` | Keep one record per printer id. A Chrome tab still supports one Web Serial or Web Bluetooth printer. |
| Android bridge | protocol v1, one selected printer | **Protocol v2:** every `printer.*` method takes a `printerId`, and status events carry `printerId`. The web code falls back to single-printer behaviour when `version === 1` (old APKs). |
| Kotlin `PrinterManager` | one `selected` printer and one transport | A pool of per-printer state machines, each with its own transport, reconnect backoff and pause flags. Bluetooth Classic and BLE keep one link per printer; TCP still connects per job. |
| Desktop store | one `deviceName` | A list of printers, each a Windows printer (spooler) or a LAN printer (raw TCP, §9.6). |

*As built at the 2D review gate (Session 2E):* the Windows app keeps its one chosen printer (`deviceName`) and prints any printer the page names (`printHtmlOn`) when Windows reports it at that moment; a printer is saved by its Windows name from the printers Windows reports, so the app keeps no list of its own, and its print method stays one per PC. The per-printer web store and the Kotlin pool are Session 2F's (bridge v2), where a web lane first drives two printers; a Chrome tab stays at one (§9.7).

*As built at the 2E review gate (Session 2F1 the page, Session 2F2 the app):* **no per-printer web store** (ruling F-R3): the app's own storage (`Prefs`, a list from 2F2) is the record of the device's printers, mirrored by the page on every load and every v2 event; `pos.device-printer.v1` stays this device's own (default) printer for every page, old and new. **The bridge v2 contract** (the header of `apps/cafe/lib/printer/native-bridge-v2.ts`; 2F2 implements and pins it): `version: 1` stays and an app that speaks v2 adds `versions: [1, 2]`; `request` and `on` take the version last (absent: 1); v2's printer methods are `printer.status` (every printer), `printer.select` (`{ id }` or `{ tcp }`: added and connected), `printer.reconnect` and `printer.forget` (`{ printerId }`) and `printer.print` (`{ printerId, data }`), each answer but the print's the whole list, like the v2 `printer.status` event the app sends on every change a page reads (and never when nothing changed); a printer is named by the app's id (`tcp:host:port`, `bt-classic:<MAC>`, `ble:<MAC>`, `usb:<vendor>:<product>`). A v1 message acts on the app's default printer exactly as today, and the app sends a v1 `printer.status` on every change of the default; the first printer of an empty list becomes the default, the default leaving promotes the first remaining one, and the list always holds the default (an app updated from v1 moves its one printer into it). A printer whose first connect fails stays listed, down, while the app keeps reconnecting; `printer.print` refuses with NOT_CONNECTED only when no byte was sent (the page reconnects once and sends once more), WRITE_FAILED after; a v1 and a v2 print aimed at one printer are serialized in the app (BUSY before any byte), never interleaved. Every other method stays v1.

*As built at the 2F1 review gate (Session 2F2, the app):* the contract gains two sentences: a network (tcp) printer has no standing link (the app connects per job; it reads `connected` from the last probe or job that reached it, a print whose connect fails is NOT_CONNECTED with no byte sent, and the app's loop then probes it at 2 s, 5 s, 10 s and every 30 s, each probe reported `connecting`), and an app with no printer answers `{ printers: [], defaultId: null, bluetooth }` (all three keys always there; the printers in the app's own order). The v1 `printer.status` follows every change of the default printer's status (its state, Bluetooth, which printer it is). In the app: **one `PrinterManager` per printer, each with its own io thread and busy flag** (BUSY per printer; a blocked connect never stalls another printer), kept by `PrinterPool` as a list with a default; a v1 select of a new printer replaces the default in its place (a printer already listed becomes the default, the old one staying listed) and a v1 forget removes it, exactly as v1 replaced and forgot its one printer (the same events in the same order), while a v2 select adds a printer and a v2 forget removes one; `Prefs` keeps the list and its default, and **the v1 keys always name the default** (an app updated from v1 finds its one printer as the default; an older app reinstalled over this one still finds this device's printer, and a change it makes is followed); one publish sends the v1 and the v2 `printer.status`, each only when what it carries changed; a v2 print to a printer the app does not list is NOT_CONNECTED; a selection in flight is superseded only by one of its own slot (the default for v1, its printer for v2); the print-host notification says the worst state across the printers. The state machine imports nothing from Android (`PrinterEnv`), so JUnit 4 runs it on the JVM (§13).

*As built at the 2F2 review gate (Session 2G, the page):* the page never takes a printer the setup prints through this device out of the app (no Remove for it; Change printer adds then chooses), adds back a setup network printer the app lost, and removes a network printer it added once the setup stops naming it (§8.1). No app code changes in Session 2G.

### 9.3 Who may lease which job

| Printer | Eligible writer |
|---|---|
| `device` connection | Only `connection.deviceId`. |
| `lan` connection | `primaryDeviceId` while that device is online. Otherwise any online device with `capabilities.lan` (the Android or Windows app). *As planned for Phase 3 (§9.8):* the first online device that says `capabilities.lanFailover` (by device id), because a Phase 2 POS-app page says `lan: true` but cannot take a printer over. |
| Simple mode | Only `targetDeviceId`. |

- **Unreachable LAN printer:** a writer that cannot reach the printer acks `failed, sent:"no", error:"unreachable"`. The server then skips that device for that printer for 5 minutes, so another writer gets the next lease. *As planned (§9.8):* the ack says `reason: "unreachable"` (a field of its own; `error` stays the writer's free text).

### 9.4 Failover

- **LAN printer:** handled by the eligibility rule in §9.3. No staff action is needed.
- **Device printer whose device is offline (no heartbeat for 90 s):**
  - With `backupPrinterId` set: the server moves the printer's queued jobs that have not been tried, or were only refused with `sent:"no"`, to the backup. Each moved job gets BACKUP PRINTER added to `labels` and a `retargeted` log entry.
  - Without a backup: show the alert "‹Printer› device is offline" (§10).
- **The device comes back:** jobs that were not moved print in order.

### 9.5 Android hardening (Phase 3)

- **Service:**
  - Foreground service type `connectedDevice`.
  - `START_STICKY`.
  - After a kill, the service restarts, and the activity re-creates the WebView on the next open.
- **Page death** (`onRenderProcessGone`, or the existing page-dead watchdog): remount the WebView automatically, instead of only showing a notification.
- **After a reboot:** a `BOOT_COMPLETED` receiver posts a notification, "POS printing is off. Tap to start." Android blocks launching an activity from the background, and a native agent is out of scope.
- **Battery:** an in-app checklist for battery restrictions on Xiaomi, Oppo, Vivo and Samsung (from dontkillmyapp.com), with direct links into the settings where Android allows them.
- **Phase 0 USB fixes:** F0.2 and F0.7 below.

### 9.6 Windows hardening (Phase 3)

- **LAN printers:** raw TCP to port 9100 from Electron's main process, connecting per job. After the write, send `DLE EOT 1/2/4` and read the status (paper, cover, error).
- **Windows printers:** stay on the spooler. Its "complete" only means the bytes were sent, and the readback says so.
- **Printer presence:** checked every 60 s, not only at startup.

### 9.7 Chrome tab

- It drives at most one Web Serial or Web Bluetooth printer.
- It shows "Keep this tab open, or use the POS app" while it owns a printer, because hidden tabs throttle timers. *(Session 2E: "Keep this tab open, or use the POS app: a hidden or closed tab prints late or not at all.", under this device's printer.)*
- A plain browser cannot drive a LAN printer. Chrome's Local Network Access rules and the lack of raw sockets prevent it.

### 9.8 Phase 3 decisions (implementation plan, 2026-10-06)

The plan `docs/superpowers/plans/2026-10-06-phase-3-hardening.md` holds each decision with what it costs if wrong (P3-1 to P3-10). In short:

- **Who writes a printer now** (§9.3, `printerActiveWriter` in `@pos/shared/print-failover`):
  - a device printer is always its own device's;
  - a network printer is its primary's while the primary is online and has not failed to reach it in the last 5 minutes;
  - otherwise it goes to the first online device that says `capabilities.lanFailover`, by device id;
  - with none, it stays the primary's.
  
  Job creation, the lease, a staff Retry, a Test print and the sweep all ask this one question. "Online" is the heartbeat on the writers' wake, so only the setup's writer devices can take a printer over, and no device starts polling to become able to.
- **The 5-minute skip.** An ack `failed, sent:"no", reason:"unreachable"` from the printer's writer now records `{ deviceId, until }` on the printer (`Printer.unreachable`). The waiting slips move at once to the device that takes it over.
- **Failover timing.** The primary is seen offline 30–90 s after it stops (60 s heartbeat, 90 s window). From then on every new slip is made for the second device. A slip already waiting moves on the next sweep (≤ 60 s more). Detecting it faster would need new requests (§17).
- **The backup printer** (§9.4, `Printer.backupPrinterId`). On the sweep, a printer whose writer now is offline sends its queued slips that never reached paper to its backup, while the backup's writer is online. They print with BACKUP PRINTER first among their labels. A network printer moves only when no device is left to take it over. A slip that may have printed, a bill waiting for the cashier and a slip being printed never move.
- **Health rides the heartbeat** (§10). The wake carries `printers: [{ printerId, link, paper?, cover?, error? }]`. The server keeps it (`Printer.health`) only from the printer's writer now, and only when it changed or a steady one is due its 5-minute refresh. A report says nothing after 10 minutes, or from another device.
- **Every device sees a printer's problem** with no new poll. Each slip waiting on a printer carries that printer's problem in the pulse's waiting-slips feed: device offline, out of paper, cover open, an error, not connected, low on paper. The words are `printerProblemText`.
- **The token fix's M-2.** A page from before print-customization S7 is never told `more` for a token, nor counted one by the pulse or the wake. A Phase 3 page says `tokenSlips`; an older one is answered from its device's last lease (`PrintDevice.tokenSlips`).

## 10. Health, status and alerts

- **Heartbeat.** The existing wake poll carries `{ deviceId, label, shell, capabilities, appVersion, nativeProtocol, printers: [{ printerId, state, paper?, cover? }] }`. Every 30 s at most, the server writes `PrintDevice.lastSeenAt` and `Printer.health`. There are no extra requests, which matters for the free-tier budgets in `packages/shared/src/print-job.ts`.
- **Status sources:**
  - **Link state** comes from the transports, as today.
  - **Paper and cover** (Phase 3) come from `DLE EOT` after each job and on a slow idle poll (every 60 s) on LAN, USB and Bluetooth Classic. BLE reports link state only.
  - A **LAN printer's health** comes from the outcome of its last job, plus a probe when idle (one connect and close every 60 s, only while the printer has no queued jobs).
- **On every device:**
  - **Top-bar dot:** the worst state among the printers this device prints to or orders for. *(As built at the 2C gate, Session 2D: in printers mode it is the worst state among the printers this device writes, red when one it writes is not its own printer, and green for a device that writes none, whose slips print at the cafe's printers; simple mode is unchanged. Its words: "A printer is not on this device", "Printing is on · Each slip prints at its printer". Session 2E: on the Windows app a printer it writes is its own when Windows reports that printer on this PC; on an older Windows app only its chosen printer. Session 2F1: on bridge v2 a printer it writes is its own when the POS app lists it, each with its own state, and the dot shows the worst; on the release APK (v1) only its one printer.)*
  - **Settings → Printers:** every printer and device.
- **Ordering device:**
  - Each slip shows Queued → Printing → Printed ✓ / Failed ⚠.
    - **Primary source:** a small realtime event `{ kind: "print-status", job: { id, status, target? } }` (§7.10: `target` names the printing device on "queued"). It carries no order content.
    - **Fallback:** `myRecentJobs` on the existing 20 s pulse.
    - No new poll.
  - A KOT still not `printed` after 20 s sounds an alarm and shows a banner. The alarm also plays on every printer device.
  - **As ruled at the Session 1C review gate (§7.10):** the readback is by exception (a slip not printed within 20 s shows with its state on every device, through the printer button's count and the panel; a printed slip needs nobody), and the alarm fires at the first pulse after the 20 s mark, with a notice that opens the panel.
  - **As ruled at the Session 1D review gate (§7.10):** the feed holds the newest 20 waiting slips, shown oldest first (the backlog stays in "20+"); the alarm rings once per slip and again only when it gets worse (waiting → check the bill → could not print), a slip of any kind that could not print rings, a page that opens while slips wait shows one summary notice, and a slip staff acted on loses its notice quietly.
- **One waiting-slips panel** (owner, after Session 1B; Session 1D): every slip that is not printed yet and needs no more from the system, in one clear, simple panel on every device, opened from the printer dot, which shows their count. Three groups, in plain words:
  - **Waiting for the printer:** queued for a printer that is off or not ready, or older than 30 minutes ("stale"). Retry (Print now) and Clear.
  - **Check the bill:** a bill that may already have printed (`needs-confirm`). Print again (DUPLICATE), It printed, and Clear.
  - **Couldn't print:** `failed` (two attempts that may have printed, or a slip that can never print). Retry (one more attempt) and Clear.

  Each row names the slip ("KOT round 2 · T-4"), how long it has waited, and why, without jargon.
- **Telegram (optional, per cafe):** uses the existing integration (`models/TelegramChat.ts`). It alerts when:
  - a job has waited more than 60 s because its printer is offline;
  - a job has `failed`;
  - a printer device has been offline more than 2 minutes while jobs wait for it.

  Each printer sends at most one alert per 10 minutes.

## 11. Setup UI (Phase 2)

- **Settings → Printers:**
  - **List:** every printer with its live dot, slips, stations and paper width.
  - **Add printer:**
    1. Choose the connection:
       - LAN: IP address and port, with a static IP / DHCP-reservation tip;
       - **This device**: Bluetooth or USB scan, done on the device that will own the printer;
       - **Windows printer**: done in the Windows app.
    2. Choose slips: the Bill checkbox, the KOT stations, "Full KOT copy", Notices and End of day.
    3. Choose paper width, copies and a backup printer.
  - **Test print:** prints the printer's name, connection, IP, slips, stations, paper width and the time.
- **Settings → Stations:** add or rename stations, and pick a station for each category. The product form gets a "Kitchen station" override.
- **Settings → Devices:** each device's online status, its label, and "Bill printer for this device".
- **The current printer panel** (`components/print/*`) becomes the "This device" view: the printers this device owns and their state.
- **As built at the 2C review gate (Session 2D; plan decision 11):** the setup lives on the admin Printer setup page (`/printers`), under this device's printer panel: **Printers** (Set up printers first; Add printer, each printer's state in words, on/off, Test print, Edit, Delete, and what the setup leaves without a printer), **Kitchen stations** (add, rename, make default, delete) and **Devices** (each device, online or last seen, the printers it prints). The category dialog and the item form gain "Kitchen station". "Bill printer for this device" sits in the printer panel (it is the device's own). No backup printer yet (Phase 3).
- **As built at the 2D review gate (Session 2E):** on the Windows app (1.11.0) a printer of this PC is chosen under "Windows printer" from the printers Windows reports (a file printer listed but not choosable), on the cafe's KOT paper unless changed; an older Windows app offers its chosen printer and says it prints one. A Windows row names its printer. Test print is offered only when its slip can print; switching a printer off asks first.
- **As built at the 2E review gate (Session 2F1):** on a POS app that speaks bridge v2, the printer form's "Device printer" chooses one of the app's printers (a network one is saved as a LAN printer this device prints); one tablet may write several printers, each a different one, and a tablet whose app prints one printer is refused a second in words. The printer panel lists the app's other printers under "Other printers on this device" (Reconnect, Remove, "Add another printer"); a printer the setup names this device for says to change it in Printer setup first instead of Remove. A failed devices read hides only what needs the devices; the Windows form asks "Choose the Windows printer."

## 12. Phase 0: fixes to the uncommitted 2026-10-02 changes

**Keep** these changes as they are:
- USB cancellation and permission matching;
- refusing two identical VID/PID printers;
- the exported Bluetooth-state receiver;
- the Classic cancellation race fix;
- treating a BLE mid-write `NOT_CONNECTED` as `WRITE_FAILED`;
- USB discovery dedupe;
- transport-specific hints;
- the CSS RGB fallbacks;
- the mobile UI.

**Fix:**

| # | Severity | Where | Fix |
|---|---|---|---|
| F0.1 | High | `lib/printer/device-printer-write.ts:60-62`, `device-printer-link.ts:226`, `transport-ble.ts:123`, `transport-serial.ts:87` | Web lanes raise coded errors for refusals made before writing (no transport, GATT disconnected before the first chunk, no writable stream). Treat them like native `NOT_CONNECTED`: one reconnect plus the ONE resend. Every other web error stays "may have printed". Tests cover both paths. |
| F0.2 | High | `PrinterManager.kt:208-217`, `UsbTransport.kt:77` | Pause the USB reconnect loop only after an explicit denial, i.e. a dialog was shown and `hasPermission` is false afterwards. "Permission needed while in the background" leaves the printer `disconnected` and retries the open when `onHostResume` or `ACTION_USB_DEVICE_ATTACHED` arrives with the app visible. `resumeIfPaused()` also covers this state. |
| F0.3 | Medium | `NativePrinterPicker.tsx:210` | Disable Find printers only when Bluetooth is `off`, `unauthorized` or `unsupported`. Treat `null` (unknown) as enabled; the native scan reports its own error. |
| F0.4 | Medium | `NativePrinterPicker.tsx:93-107` | One `load()` using `Promise.allSettled`, shared by mount and Refresh. A status failure never discards a good list. |
| F0.5 | Low | `NativePrinterPicker.tsx:208` | A separate `refreshing` state for the Refresh label. |
| F0.6 | Low | `NativePrinterPicker.tsx:62-65` | Drop the initial status reply if an event arrived after the request started. Subscribe on `NATIVE_READY_EVENT` when the bridge appears after mount. |
| F0.7 | Low | `UsbTransport.kt:118` | If `EXTRA_DEVICE` is missing, release the latch anyway. The `hasPermission` re-check right after it decides. |
| F0.8 | Medium (UI) | `postcss.config.mjs`, `postcss-tint-fallback.cjs`, `lib/css-compat.test.ts`, `packages/shared/src/appearance*.ts` | Done in Phase 0. A PostCSS step rewrites Tailwind's solid fallback for each tint to `rgb(var(--x-rgb) / N%)`, with per-theme channel twins (`--x-rgb`). Runtime theme tokens (diner menu, appearance preview) carry their own twins. Tests cover the tints, both themes, the plugin order, and the one allow-listed solid token (`--border`). Verified on the emulator's WebView 109. |
| F0.9 | Low | `apps/mobile/src/screens/WorkspaceCover.tsx:40`, `Brand.tsx:28` | Route the cover's Try again through the shared retry accounting. Move the inline style into a StyleSheet (lint warning). |
| F0.10 | Resolved (owner, 2026-10-02) | `apps/mobile/src/screens/Brand.tsx`, `UrlScreen.tsx`, `theme.ts`, `src/assets/sandbee-logo.png` | Keep GPT's Sandbee branding on the app's own native screens (boot, POS address, error, loading cover). Everything shown after the POS web page loads is the cafe's own brand. The launcher label stays as it is. No code change. **2026-10-03 (owner):** the launcher label is now **Sandbee POS** (`app_name`, `app.json` displayName; pinned in `mobile-paths.test.ts`). |
| F0.11 | Done | repository root | `.playwright-mcp` (browser-tool session snapshots) is in the root `.gitignore`. |

## 13. Testing

- **Unit (node:test):**
  - the lifecycle state machine (every row of §7.2), including epoch fencing, late acks, backoff, labels and limits;
  - routing (§8), including fallbacks and copies;
  - sweep idempotency;
  - failure classification per writer.
- **Live Mongo:** new legs in `verify:print:live` (`scripts/verify-print-host-live.ts`):
  - two devices leasing the same head job;
  - lease expiry followed by a late ack;
  - stale-epoch acks;
  - head-of-line parking;
  - sweep repair of a missing KOT job;
  - backup retargeting.
- **Fake LAN printer (new tool, `scripts/fake-escpos-printer.mjs`):** Node, no dependencies.
  - Listens on port 9100 and saves every job to a folder with timestamps.
  - Flags: `--drop-after <bytes>`, `--delay <ms>`, `--paper-out` and `--cover-open` (answers to `DLE EOT`), `--refuse`.
  - The emulator reaches it at `10.0.2.2:9100`, and the Windows app at `127.0.0.1`.
  - This tests the LAN path end to end without hardware: the "maybe sent" REPRINT path, backoff, failover between two agents, and health reporting.
- **Kotlin:** pure-JVM unit tests for the per-printer state machine (Phase 2), plus the existing source pins in `src/mobile-paths.test.ts`. *As built (Session 2F2):* JUnit 4 (`testImplementation`), run by `gradlew :app:testDebugUnitTest` with the Gradle cache on D:: `PrinterManagerTest` (the backoff, Bluetooth and USB pause flags, a dropped link, BUSY per printer, NOT_CONNECTED before any byte, the watchdog, a printer that left the list), `PoolListTest` (the list's rules, the v1 migration and an older app's change), `PoolStatusTest` (de-duplication per bridge version, the notification's worst state); `mobile-paths.test.ts` pin 19 pins the pool's shape, and the cafe's `native-bridge-v2-parity.test.ts` pins the app's bridge v2 against the page's. *Not yet (the 2F2 review gate):* a JVM test of `PrinterPool`'s change → halt → save → publish chain needs seams in `PrinterPool`; Phase 3, with the Android hardening.
- **The soak (`scripts/print-soak.ts`, Phase 2 Session 2G):** besides Phase 1's host and agent runs, it drives direct print (`--direct`: the lease header, the jobs an answer carries printed first, a lease only when an ack says `more`) and printers mode (`--printer`: the soak writes its printers; or the emulator app writes them while the soak orders), checking every job the answers named on paper. Session 2G measures the free-tier budget in both modes with it.
- **Every phase:** tsc, lint and all suites (cafe, mobile, desktop), then a release APK build and an emulator smoke test against the fake printer.
- **Hardware:** `apps/mobile/TEST-CHECKLIST.md` is updated with the new states, labels and failover checks, and run on real printers before client rollout. *Phase 2 (Session 2G):* "Stations and printers checks" (two Bluetooth printers on one phone, a LAN kitchen printer, a station with no printer, copies, a deleted station, a printer switched off and powered off, the notification, an order lost on the device that prints it, a setup printer in the panel, a moved network printer, two USB prompts) beside the Windows section (the 2E gate's Part C).

## 14. Phases and exit criteria

Each phase gets its own implementation plan and ships on its own. The first plan covers Phases 0 and 1.

| Phase | Contents | Exit criteria |
|---|---|---|
| **0** | §12 fixes | All suites pass; the new tests for F0.1 and F0.2 pass; WebView 109 tints look right on the emulator. |
| **1** | Lifecycle (§7), `PrintDevice` heartbeat, server-side creation and sweep, readback statuses, 20 s alarm, the one waiting-slips panel, labels, and simple mode for existing outlets | With the fake printer: an attempt that may have printed (a lost ack, a mid-job drop on a lane that can see it) prints a REPRINT copy; on a bill it raises the cashier prompt; killing the host mid-job re-queues it after 90 s; a printer that is off costs no attempt; a missing job is repaired by the sweep; no silent loss in a 200-order soak test; the locally measured free-tier budget in §17.3 passes. (Android's TCP lane cannot see a mid-slip cut: §7.10, Phase 3.) |
| **2** | `Station`, `Printer`, station fields on `Category`/`Product`, routing (§8), the setup UI (§11), several printers per device (§9.2) including bridge v2 and the Kotlin pool; direct print on the asking device (§7.11) | One round with kitchen and bar items prints two station KOTs plus the full copy; bills go to the device's bill printer; an old APK (bridge v1) still prints in simple mode; a slip the asking device prints itself costs one request and no realtime message. *Met:* Session 2G's exit on the emulator and its measurement in both modes (§17.2), re-checked at the final Phase 2 gate (2026-10-06); real printers (`TEST-CHECKLIST.md`) are the owner's before release. |
| **3** | Failover (§9.3–9.4), `DLE EOT` health, Windows raw TCP, Android hardening (§9.5), Telegram alerts | Stopping the primary LAN writer moves printing to the second device within 90 s; paper-out shows on every device; a killed service restarts; the boot notification appears. *As planned (2026-10-06, §9.8):* "within 90 s" is measured as "every slip made 90 s or more after the primary stops prints on the second device; one already waiting prints within 60 s more", and the exit adds the owner's measured free-tier check of both modes with tokens on (§17.2). Sessions 3A–3G. |
| **4** | Fast text-mode ESC/POS for KOTs whose text is all Latin (raster stays for Indian scripts and logos), printer discovery, setup polish | A KOT payload is about 10× smaller than raster; Bluetooth KOT time is measured before and after. |
| Later | Offline billing, native print agent, CloudPRNT / Epson Server Direct Print printers | Separate specs. |

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Vercel and Mongo free-tier budgets, from more state writes | The heartbeat rides the existing wake poll; the lease returns the payload; the sweep runs at most once per 60 s; the state changes are only create, lease and ack, three writes per slip. |
| Duplicate paper when acknowledgements keep getting lost | §7.9 late acks; the second attempt that may have printed → `failed` (the owner's two-attempt rule); every repeat is labelled. |
| Old tabs and old APKs during the rollout | `/claim` and `/kot-claim` stay for one release; bridge v1 keeps simple-mode behaviour. |
| Head-of-line blocking by a poisoned job | Permanent errors go straight to `failed`; parked states don't block; the limits in §7.8. |
| Clock skew between devices | All lease and expiry times use server time. |
| Bluetooth Classic with several links on one phone (vendor dependent) | Phase 2 tests with two printers on the emulator and on real phones. The docs recommend LAN printers for the kitchen, as Petpooja and Toast advise. |
| Large raster jobs over BLE | Phase 4 text mode; chunking stays as it is. |

## 16. References

Research from 2026-10-02, with sources:

- **Vendors:**
  - Petpooja: <https://blog.petpooja.com/glossary/hardware-integration/> and <https://blog.petpooja.com/industry-business-guides/bridge-server-works-inside-pos-local/>
  - eZee Optimus: <https://yanoljacloudsolution.freshdesk.com/en/support/solutions/articles/9000235749-how-to-setup-kot-receipt-printer-in-ezee-optimus->
  - Toast: <https://doc.toasttab.com/doc/platformguide/adminAddKitchenPrinter.html> and <https://support.toasttab.com/en/article/Double-Printing>
  - Square: <https://squareup.com/help/us/en/article/8245-set-up-printer-profiles>
  - Lightspeed: <https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804607010-Managing-printing-profiles>
  - Loyverse: <https://help.loyverse.com/help/using-kitchen-printers>
- **Printer protocols:**
  - Star CloudPRNT job confirmation: <https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-reference/http-method-reference/job-confirmation-delete/index.html>
  - Epson Server Direct Print: <https://files.support.epson.com/pdf/pos/bulk/server_direct_print_um_en_revk.pdf>
  - ESC/POS `DLE EOT`: <https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/dle_eot.html>
- **Reliability patterns:**
  - leases and visibility timeout: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
  - fencing: <https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html>
  - transactional outbox: <https://microservices.io/patterns/data/transactional-outbox.html>
  - idempotency: <https://stripe.com/blog/idempotency>
- **Android:**
  - foreground service types: <https://developer.android.com/develop/background-work/services/fgs/service-types>
  - OEM battery limits: <https://dontkillmyapp.com/>
- **Browser limits:** <https://developer.chrome.com/blog/local-network-access>
- **Windows spooler status:** <https://learn.microsoft.com/en-us/windows/win32/printdocs/job-info-1>

## 17. Free-tier budget (per cafe)

### 17.1 Limits that bind printing (verified 2026-10-02)

| Provider (each cafe's own account) | Limit | Source |
|---|---|---|
| Vercel Hobby | 1,000,000 function invocations, **4 h Active CPU**, 360 GB-hrs provisioned memory, 100 GB fast data transfer, 10 GB fast origin transfer — per month. Overrunning a compute allowance can stop the site until the allowance resets. | <https://vercel.com/docs/limits/fair-use-guidelines> (updated 2026-09-14); `docs/GO-LIVE-CHECKLIST.md:904-912` |
| Vercel Hobby | Commercial-use restriction | Owner-accepted risk with mandatory written disclosure: `docs/PLATFORM.md` §1 and §3 |
| Atlas Free (M0) | 0.5 GB storage, **100 operations/s** (throttled above), 10 GB in + 10 GB out per rolling 7 days, 500 connections, no backups, paused after 30 days with zero connections | <https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/> |
| Cloudflare Workers Free (realtime Durable Object) | 100,000 requests/day; SQLite storage backend only | `workers/realtime/README.md` |

**Active CPU is the tightest limit.** Four hours a month is about 8 minutes of CPU a day for the whole app. Every recurring request must be justified in this table.

### 17.2 Printing traffic

A busy day is assumed:
- open 12 h;
- 300 orders;
- 1,200 slips (1.5 KOT rounds × 2 stations + 1 bill per order);
- 3 printer devices and 5 ordering devices.

| Item | Normal day (socket healthy) | Worst case (socket down all day) | How it stays bounded |
|---|---|---|---|
| Job creation | 0 extra | 0 extra | Done inside the order request that already exists (§7.4) |
| Lease + ack | 2,400 | 2,400 | 2 per slip. The ordering device leases its own jobs from the order response (no poll). Retries of its own jobs use a local timer from the ack response (no poll). |
| Retries (assume 10 %) | 240 | 240 | Backoff (§7.2) |
| Agent wake polls | 2,160 (3 × 720, 60 s) | ≤ 14,400 | One cap of 14,400 per cafe-day, shared by every agent (§9.1). It is never multiplied by the number of devices. |
| Status readback, heartbeats, sweep, Telegram | 0 extra | 0 extra | They ride the realtime event, the wake poll, the lease call and the existing 20 s pulse |
| **Vercel invocations** | **≈ 4,800/day ≈ 144k/month (14 % of 1M)** | **≈ 17,040/day ≈ 511k/month (51 %)** | The worst case equals today's host worst case (14,400 wake + 2,400 enqueue/claim) |
| Active CPU, estimated at 10 ms per print request (measured in Phase 1) | ≈ 48 s/day ≈ 24 min/month (10 %) | ≈ 170 s/day ≈ 85 min/month (35 %) | Phase 1 exit criterion (below) |
| Realtime Worker requests | ≈ 2,735/day (2.7 % of 100k) | same | 2 publishes per slip another device prints (its "queued" `print-status` and the host's `print-job` nudge; the final state is no longer published, §7.11 G-1; it was 3, ≈ 3,935/day), 0 for a slip the asking device prints itself, plus today's ≈ 335. Pinned in `print-budget.test.ts` (≤ 5 %). |
| Mongo writes | ≈ 6,000/day (peak well under 10/s) | ≈ 18,000/day | 3 writes per slip, plus at most 1 device upsert per wake. `Printer.health` is written only on change. |
| Mongo storage and transfer | ≤ about 10 MB live; ≈ 6 MB/day of payload reads | same | Retention 45 min (finished) / 3 h (waiting), devices 7 days (owner, after Session 1D); log capped at 20 entries |

**Simple mode without a host** (each device prints its own slips) costs no server requests today. In this design it adds about 2,640 invocations/day on a busy day (lease, ack, retries) and no polling. That is the price of server-side acknowledgement, retry and visibility.

**Direct print (Phase 2 Session 2B, §7.11).** A slip the asking device prints itself is made leased with its order: 1 request (its ack), 2 Mongo writes (the create and the ack) and no Worker request; Pay Now on one printer costs 3 print requests (the KOT's ack, the bill's lease and ack; Phase 1: 5). With the ack's `more`, no burst ends with an empty lease. A cafe whose one device takes and prints every order: ≈ 1,200 print requests on the busy day at worst (every bill riding with its KOT), ≈ 1,920 with the host's wake on a healthy socket, and no Worker request for printing. Pinned in `print-budget.test.ts`.

**Printers mode (Phase 2 Session 2C, the 2B gate).** Reading the printers costs at most 192 requests a day (8 devices, a focus read at most twice an hour for 12 h), plus one per page load and per admin save (whose `print-setup` frame costs 2 Worker requests); a list shown stale by the pulse or the wake is read again at most once a minute (at most 30 times for one waiting slip, which leaves the count after 30 min). With every read the heavy setup stays under both ceilings: 5,982 on a normal day, 17,820 worst case. When the counter device takes every order, each round's full copy costs it one request (direct print per printer line): the heavy day is 5,340 with the wake (was 5,790). Pinned in `print-budget.test.ts`.

**The setup screens (Phase 2 Session 2D, the 2C gate).** No new recurring request: the setup page reads the printers, the stations and the devices when it opens (never polled); a Test print costs its create, a lease and an ack (and two Worker requests when another device prints it); the top-bar dot and the bill printer read the agent's printers entry with no request or subscription of their own, so an admin save still costs one printers read per device. A device whose list keeps looking stale (a printer it writes whose address is not its own printer) reads it at most once a minute (at most ~720 a day), and its dot shows that printer red (the 2C gate, F-5). The wake's read of the printers costs one small Mongo read per poll (at most 14,400 a day, ~0.17 operations a second on M0's 100; the 2C gate, M-3).

**Several printers on one Windows PC (Phase 2 Session 2E, the 2D gate).** No new recurring request: `printHtmlOn` and the Windows printer list are local calls to the app; the lease names fewer printers while one is held; a Windows printer that keeps refusing costs one lease and one ack per 30 s while its slip waits (Phase 1's rule for a refusing printer, now per printer), and one renamed or removed in Windows stops being leased once the app's list is read again. A station delete that took a station off a printer costs two Worker requests (its `print-setup` frame).

**Several printers on one phone or tablet (Phase 2 Session 2F1, the 2E gate).** No new recurring request: the app's printers are read and followed with local bridge calls, and `nativeProtocol` rides the existing wake. A status event from the app nudges the agent only when the list changed (the bridge v2 contract) and never within 500 ms of a `more: false` ack. The 2E gate's fixes remove three kinds of empty lease: after a round leased to the tab on two printers' lines (up to ≈ 450 on the busy day for a counter PC that prints two printers), after a state change right after such an ack (≤ 1 per such moment), and for each kicked slip on a held printer (≈ 450–900 a day while one printer stays held).

**The page's printers on one phone or tablet (Phase 2 Session 2G, the 2F2 gate).** No new request: adding a setup printer to the app, adding one back and removing one the setup no longer names are local bridge calls. A printer job refused because its printer left the app's list costs one lease at its hold's end (+30 s), as a Windows printer's hold since Session 2E (the 2F2 gate's reviewer, R-3). Session 2G measures both modes locally (the counting proxy, process CPU, opcounters) with the soak driving direct print and printers mode.

**Token slips in printers mode (the owner's ruling, 2026-10-06, option A: accept and measure).** Print customization S7 added a token slip per order, at a lease and an ack (2 requests: the token fix makes it never leased at creation). Two printers-mode days then go over the ceilings, and have since S7: the 2C counter day (the counter takes every order and writes the full copy and the bills) is **6,000** a day, **6,192** with every printer-list read; the heavy setup (orders taken on devices that print nothing) is **6,450** (**6,642**) on a normal day and **18,288** (**18,480**) at worst. Against the real limits: 6,642 a day is 19.9 % of the free 33,333 invocations a day (1,000,000 a month), and 18,480 is 55 % (a day with the socket down all day). The owner accepted both: a token cafe has its own ceilings (`PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY` 6,700, `PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY` 18,500), and a cafe without tokens is still held to 6,000 / 18,000. The pins count every slip at its own lease and ack (Session 2G measured 1.63 requests a job in printers mode, and P4's measured day was 2,940 against the pinned 5,790), so the measured day is the gate: **Phase 3's exit measures a token cafe in both modes** against §17.3 item 5 (at most 20 % of the invocations and 15 % of the Active CPU on the busy day). If it fails, the Phase 3 plan's fallback (the slips one request puts on one printer line ride one lease) lands before release. Options the owner did not take: a capability header that makes a token direct again (it moves neither day: on the counter day the token waits behind the full copy, and on the heavy day another device prints it), cutting the cost now, and shrinking the writers' wake cap on a token cafe.

**Phase 1 polls with one device at most** (§7.10): the host in host mode, nobody without a host. The "3 printer devices" columns above are Phase 2's target design; `print-budget.test.ts` pins both. With no host, each agent names itself on the existing 20 s pulse (`?device=`, one bounded read on a request that already runs), so no device adds a request.

### 17.3 Rules that keep it bounded

1. No new recurring request on ordering devices. Their status comes from realtime events and the existing pulse.
2. No Vercel Cron. The sweep runs inside wake/pulse handling at most once per 60 s.
3. The agents' shared wake cap (§9.1) is pinned by a test.
4. **Budget test** (`packages/shared/src/print-budget.test.ts`, new). It recomputes the two "Vercel invocations" totals in §17.2 from the exported constants. It fails if the worst case exceeds 18,000/day, the normal case exceeds 6,000/day, or any agent cadence is below 3 s. *The owner's ruling (2026-10-06):* a cafe in printers mode with a token per order is held to 6,700 / 18,500 instead, and its two days are pinned exactly (§17.2, "Token slips in printers mode").
5. **Phase 1 exit criterion (measured locally, not estimated).** Nothing is deployed until every phase is done (owner, after Session 1B), so the measurement runs on the owner's PC:
   - The local POS (`next start`), the emulator app as host, the fake printer, and the 200-order soak plus a 30-minute idle run, through a scratchpad counting proxy that logs every request's route, status and duration.
   - The server process's CPU time and `db.serverStatus().opcounters` before and after each run, and the peak over any 10 s window.
   - Report requests per slip, per order and per minute by route, CPU ms per request, and Mongo operations per slip; extrapolate to the busy day (§17.2). Printing must use **≤ 15 % of Active CPU** and **≤ 20 % of invocations** on a normal day, with Atlas under 10 ops/s at peak. The local CPU per request stands in for Vercel's Active CPU, and the report says so.
   - If not, lower the cadences before release.
