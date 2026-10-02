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

- **Keys.** `jobKey` becomes `<kind>:<orderId>:<round|at>:<printerId|targetDeviceId>:<copyIndex>`. A reprint uses `reprint:<Idempotency-Key>`, where the client supplies a UUID.
- **Old rows.** `claimedAt` and `claimedBy` stay on rows written before this change. New code never writes them.
- **Old meaning of "printed".** A historical `printed` row means "claim won". The readback treats rows without `printedAt` as legacy.
- **Indexes:**
  - `{ status: 1, nextAttemptAt: 1, createdAt: 1, _id: 1 }`
  - `{ printerId: 1, status: 1, createdAt: 1, _id: 1 }`
  - `{ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 }`
  - `{ originDeviceId: 1, createdAt: -1 }`
  - `jobKey`: unique and sparse (existing)
- The existing `{ status: 1, createdAt: 1, _id: 1 }` index stays for the prune sweep.

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
             │                  ├─ ack failed, sent:"no" ──────► queued (backoff)
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
| `leased` | ack `failed`, `sent:"no"` | `queued` | `nextAttemptAt = now + backoff(attempts)` |
| `leased` | ack `failed`, `sent:"maybe"` | KOT/notice/EOD: `queued` + REPRINT; bill: `needs-confirm` | `uncertainAttempts+1` |
| `leased` | ack `failed` with a permanent error (`BAD_REQUEST`, `TOO_LARGE`) | `failed` | no retry, alert (§10) |
| `needs-confirm` | cashier decision | `queued` + DUPLICATE / `printed` / `dismissed` | allowed from any device that can see the job |
| `queued` | `uncertainAttempts ≥ 3` or `attempts ≥ 8` | `failed` | checked when acking and by the sweep |
| `failed` | "Print again" | `queued` | Adds REPRINT (KOT) or DUPLICATE (bill) to `labels` if `uncertainAttempts > 0`, then resets `attempts` and `uncertainAttempts` to 0 |
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
  - `order-requests/[id]/accept`, and the auto-accept in `api/public/order-request` → KOT jobs
- **Payloads** come from the existing builders in [lib/print-routing.ts](../../../apps/cafe/lib/print-routing.ts) (`kotPrintJob`, `billPrintJob`, `voidPrintJob`, …), run on the committed order. They are converted with the same snapshot function (`printOrderSnapshot`) the client uses today, so slips look exactly the same.
- **Response:** the route returns `printJobs: [{ id, printerId | targetDeviceId, label }]` (`label` is the existing UI-only text, e.g. "KOT round 2 · T-4"), and the ordering device leases the ones that belong to it straight away.
- **Errors:** if job creation throws after the order commits, the route still returns success and logs the error. The sweep repairs it.
- **Repair sweep.** It runs inside wake/pulse handling, at most once per 60 s per cafe:
  1. Expire leases (§7.2).
  2. Re-create missing jobs. For orders with a KOT round fired in the last 30 min, recompute the expected jobKeys and insert any that are missing. A unique-key collision is a no-op.
  3. Apply limits (stale, failed).
  4. Run the existing retention prune.
- **Retired lane:** once the accept routes create KOT jobs, the QR self-order `/kot-claim` lane and its `kotPrintedAt` CAS are retired. They stay for one release.

### 7.5 Failure classification

`sent:"no"` is reported only when the writer knows that no byte reached the transport.

| Writer | `sent:"no"` | `sent:"maybe"` | Permanent |
|---|---|---|---|
| Android bridge | `NOT_CONNECTED`, `UNAUTHORIZED`, `UNSUPPORTED`, `BUSY`, `BLUETOOTH_OFF` | `WRITE_FAILED`, `TIMEOUT` | `BAD_REQUEST`, `TOO_LARGE` |
| Web Serial / Web Bluetooth | the coded pre-write refusals added in Phase 0 (F0.1) | any error after the first chunk | — |
| Windows app | no printer; cannot open the printer; TCP connect fails | an error after `StartDocPrinter` or after the first TCP write | — |
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
| Failed | `uncertainAttempts ≥ 3` or `attempts ≥ 8` | Caps duplicates when acknowledgements keep getting lost |
| Device offline | no heartbeat for 90 s | |
| Retention | unchanged: resolved 2 h, queued 12 h | |

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
- **The cashier's "print again" resets the counters and sets `approvedAt`.** The copy is neither parked as stale nor failed by the uncertain limit it came from.
- **A spent daily wake share stops the agent's polling** until the next cafe-day. Leasing then rides realtime nudges and the pulse, so the shared cap truly bounds the cafe's total.
- **Dismiss covers `queued`, `needs-confirm` and `failed`, never `leased`.**
- **With a host, the sweep retargets every queued job to the current host** (rows from before Phase 1, and rows from before a re-designation).

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
- **For each lease:** render, then write, then ack. It reports `sent` honestly, following §7.5.
- It processes one job at a time per printer. Different printers can run in parallel.

### 9.2 Several printers per device (Phase 2)

| Layer | Today | Change |
|---|---|---|
| Web device-printer store | one record `pos.device-printer.v1` | Keep one record per printer id. A Chrome tab still supports one Web Serial or Web Bluetooth printer. |
| Android bridge | protocol v1, one selected printer | **Protocol v2:** every `printer.*` method takes a `printerId`, and status events carry `printerId`. The web code falls back to single-printer behaviour when `version === 1` (old APKs). |
| Kotlin `PrinterManager` | one `selected` printer and one transport | A pool of per-printer state machines, each with its own transport, reconnect backoff and pause flags. Bluetooth Classic and BLE keep one link per printer; TCP still connects per job. |
| Desktop store | one `deviceName` | A list of printers, each a Windows printer (spooler) or a LAN printer (raw TCP, §9.6). |

### 9.3 Who may lease which job

| Printer | Eligible writer |
|---|---|
| `device` connection | Only `connection.deviceId`. |
| `lan` connection | `primaryDeviceId` while that device is online. Otherwise any online device with `capabilities.lan` (the Android or Windows app). |
| Simple mode | Only `targetDeviceId`. |

- **Unreachable LAN printer:** a writer that cannot reach the printer acks `failed, sent:"no", error:"unreachable"`. The server then skips that device for that printer for 5 minutes, so another writer gets the next lease.

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
- It shows "Keep this tab open, or use the POS app" while it owns a printer, because hidden tabs throttle timers.
- A plain browser cannot drive a LAN printer. Chrome's Local Network Access rules and the lack of raw sockets prevent it.

## 10. Health, status and alerts

- **Heartbeat.** The existing wake poll carries `{ deviceId, label, shell, capabilities, appVersion, nativeProtocol, printers: [{ printerId, state, paper?, cover? }] }`. Every 30 s at most, the server writes `PrintDevice.lastSeenAt` and `Printer.health`. There are no extra requests, which matters for the free-tier budgets in `packages/shared/src/print-job.ts`.
- **Status sources:**
  - **Link state** comes from the transports, as today.
  - **Paper and cover** (Phase 3) come from `DLE EOT` after each job and on a slow idle poll (every 60 s) on LAN, USB and Bluetooth Classic. BLE reports link state only.
  - A **LAN printer's health** comes from the outcome of its last job, plus a probe when idle (one connect and close every 60 s, only while the printer has no queued jobs).
- **On every device:**
  - **Top-bar dot:** the worst state among the printers this device prints to or orders for.
  - **Settings → Printers:** every printer and device.
- **Ordering device:**
  - Each slip shows Queued → Printing → Printed ✓ / Failed ⚠.
    - **Primary source:** a small realtime event `{ kind: "print-status", jobId, status }`. It carries no order content.
    - **Fallback:** `myRecentJobs` on the existing 20 s pulse.
    - No new poll.
  - A KOT still not `printed` after 20 s sounds an alarm and shows a banner. The alarm also plays on every printer device.
- **Failed and needs-confirm list:** shown on all devices, with Print again, It printed (bills only) and Dismiss.
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
| F0.10 | Resolved (owner, 2026-10-02) | `apps/mobile/src/screens/Brand.tsx`, `UrlScreen.tsx`, `theme.ts`, `src/assets/sandbee-logo.png` | Keep GPT's Sandbee branding on the app's own native screens (boot, POS address, error, loading cover). Everything shown after the POS web page loads is the cafe's own brand. The launcher label stays as it is. No code change. |
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
- **Kotlin:** pure-JVM unit tests for the per-printer state machine (Phase 2), plus the existing source pins in `src/mobile-paths.test.ts`.
- **Every phase:** tsc, lint and all suites (cafe, mobile, desktop), then a release APK build and an emulator smoke test against the fake printer.
- **Hardware:** `apps/mobile/TEST-CHECKLIST.md` is updated with the new states, labels and failover checks, and run on real printers before client rollout.

## 14. Phases and exit criteria

Each phase gets its own implementation plan and ships on its own. The first plan covers Phases 0 and 1.

| Phase | Contents | Exit criteria |
|---|---|---|
| **0** | §12 fixes | All suites pass; the new tests for F0.1 and F0.2 pass; WebView 109 tints look right on the emulator. |
| **1** | Lifecycle (§7), `PrintDevice` heartbeat, server-side creation and sweep, readback statuses, 20 s alarm, failed/needs-confirm list, labels, and simple mode for existing outlets | With the fake printer: a dropped connection mid-KOT prints a REPRINT copy; a mid-bill drop raises the cashier prompt; killing the host mid-job re-queues it after 90 s; a missing job is repaired by the sweep; no silent loss in a 200-order soak test; the measured free-tier budget in §17.3 passes. |
| **2** | `Station`, `Printer`, station fields on `Category`/`Product`, routing (§8), the setup UI (§11), several printers per device (§9.2) including bridge v2 and the Kotlin pool | One round with kitchen and bar items prints two station KOTs plus the full copy; bills go to the device's bill printer; an old APK (bridge v1) still prints in simple mode. |
| **3** | Failover (§9.3–9.4), `DLE EOT` health, Windows raw TCP, Android hardening (§9.5), Telegram alerts | Stopping the primary LAN writer moves printing to the second device within 90 s; paper-out shows on every device; a killed service restarts; the boot notification appears. |
| **4** | Fast text-mode ESC/POS for KOTs whose text is all Latin (raster stays for Indian scripts and logos), printer discovery, setup polish | A KOT payload is about 10× smaller than raster; Bluetooth KOT time is measured before and after. |
| Later | Offline billing, native print agent, CloudPRNT / Epson Server Direct Print printers | Separate specs. |

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Vercel and Mongo free-tier budgets, from more state writes | The heartbeat rides the existing wake poll; the lease returns the payload; the sweep runs at most once per 60 s; the state changes are only create, lease and ack, three writes per slip. |
| Duplicate paper when acknowledgements keep getting lost | §7.9 late acks; `uncertainAttempts ≥ 3` → `failed`; every repeat is labelled. |
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
| Realtime Worker requests | ≈ 2,735/day (2.7 % of 100k) | same | 2 publishes per slip (created, final status), plus today's ≈ 335 |
| Mongo writes | ≈ 6,000/day (peak well under 10/s) | ≈ 18,000/day | 3 writes per slip, plus at most 1 device upsert per wake. `Printer.health` is written only on change. |
| Mongo storage and transfer | ≤ about 10 MB live; ≈ 6 MB/day of payload reads | same | Unchanged retention (2 h / 12 h); log capped at 20 entries |

**Simple mode without a host** (each device prints its own slips) costs no server requests today. In this design it adds about 2,640 invocations/day on a busy day (lease, ack, retries) and no polling. That is the price of server-side acknowledgement, retry and visibility.

### 17.3 Rules that keep it bounded

1. No new recurring request on ordering devices. Their status comes from realtime events and the existing pulse.
2. No Vercel Cron. The sweep runs inside wake/pulse handling at most once per 60 s.
3. The agents' shared wake cap (§9.1) is pinned by a test.
4. **Budget test** (`packages/shared/src/print-budget.test.ts`, new). It recomputes the two "Vercel invocations" totals in §17.2 from the exported constants. It fails if the worst case exceeds 18,000/day, the normal case exceeds 6,000/day, or any agent cadence is below 3 s.
5. **Phase 1 exit criterion (measured, not estimated):**
   - On a scratch deployment in the owner's own free accounts, run a 2-hour simulated rush (fake printers, scripted orders).
   - Read Vercel → Usage (invocations, Active CPU, provisioned memory) and the Atlas metrics.
   - Extrapolate to a busy day. Printing must use **≤ 15 % of Active CPU** and **≤ 20 % of invocations** on a normal day, with Atlas under 10 ops/s at peak.
   - If not, lower the cadences before release.
