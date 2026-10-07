import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRINTER_BACKUP_SELF_MESSAGE,
  PRINTER_HEALTH_REFRESH_MS,
  PRINTER_HEALTH_STALE_MS,
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
  printerSkippedWriters,
  printerWriterCanPrint,
  printerWriterOnline,
  printersTakenOverBy,
  type PrinterFailover,
} from "./print-failover";
import { PRINT_DEVICE_PRUNE_MS } from "./print-lifecycle";
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

test("constants: a skip lasts at least 5 minutes and holds while the device's record lives; health is refreshed every 5 minutes and stale after 10", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 300_000);
  // The 3A review gate (I-B, deliberate change): a 3-hour bound sent the printer back to a writer that still could not
  // reach it after a long outage; a skip now ends only when the device says it reaches the printer, or with its record.
  assert.equal(PRINTER_UNREACHABLE_HOLD_MS, PRINT_DEVICE_PRUNE_MS, "a skip holds as long as the device's own record lives (7 days)");
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

test("printerActiveWriter: a writer that could not reach it is skipped for at least 5 minutes, primary or not", () => {
  const skipKitchen = lan("k", "kitchen", { unreachable: [{ deviceId: "kitchen", until: at(PRINTER_UNREACHABLE_SKIP_MS) }] });
  const both = failover([["kitchen", true], ["counter", true]]);
  assert.equal(printerActiveWriter(skipKitchen, both), "counter", "the primary skipped, the counter takes it");
  // Session 3A's final review (I-1): a page never leases a printer it cannot reach, so the skip cannot run out on time
  // alone: the counter keeps the printer until the tablet says it reaches it again (lib/print-failover.ts), or 7 days.
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_SKIP_MS)), "counter", "still the counter's when the 5 minutes are up");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true], ["counter", true]], T0 + PRINTER_UNREACHABLE_HOLD_MS)), "kitchen", "back to the primary once the device's record would be pruned");
  assert.equal(printerActiveWriter(skipKitchen, failover([["kitchen", true]])), "kitchen", "no one else: the primary keeps it");
  const skipCounter = lan("k", "kitchen", { unreachable: [{ deviceId: "counter", until: at(60_000) }] });
  assert.equal(printerActiveWriter(skipCounter, failover([["counter", true], ["bar", true]])), "bar", "the skipped candidate is passed over");
  assert.equal(printerActiveWriter(skipCounter, failover([["counter", true]])), "kitchen", "every candidate skipped: the primary keeps it");
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
});

test("printerSkipEndsFor: a skipped device's lease that names the printer ends its skip, once its first 5 minutes are up", () => {
  // Session 3A's final review (I-1): a page leaves a printer it cannot reach out of its lease (holds.open(ready())), so
  // its lease naming the printer means its app reaches it again.
  const printer = lan("k", "kitchen", { unreachable: [{ deviceId: "kitchen", until: at(PRINTER_UNREACHABLE_SKIP_MS) }] });
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
