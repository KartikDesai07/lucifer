import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import { PRINTER_WAITING_STUCK_MS, printWaitingPrintersOf, waitingPrintersOf } from "@/lib/print-waiting";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// PX-2 (spec §6.5, PX-D6, R1, F-I2): the printers fresh slips wait for, one narrow string derived once beside the
// waiting count, so a phone that prints nothing turns amber while the kitchen printer is down (the header button never
// reads the wide pulse). Kept out of lib/print-waiting.test.ts (over 300 lines: controller Ruling B).

const T0 = Date.parse("2026-11-05T12:00:00.000Z");
const ago = (ms: number): string => new Date(T0 - ms).toISOString();

function row(over: Partial<PrintAttentionRow> = {}): PrintAttentionRow {
  return { id: "j1", kind: "kot", label: "KOT round 1 · T-4", status: "queued", labels: [], createdAt: ago(10_000), printerId: "p1", ...over };
}

const feed = (rows: PrintAttentionRow[]) => ({ printAttention: rows });

test("printWaitingPrintersOf keys fresh queued rows by printer, counts them, the most first", () => {
  const rows = [
    row({ id: "a", printerId: "p2" }),
    row({ id: "b", printerId: "p1" }),
    row({ id: "c", printerId: "p1" }),
    row({ id: "d", printerId: "p1" }),
    row({ id: "e", printerId: "p3" }),
  ];
  assert.equal(printWaitingPrintersOf(feed(rows), T0), "p1:3::0|p2:1::0|p3:1::0", "the most first, then by id; a quiet rush is not stuck");
});

test("only queued rows on a printer count: no slip of simple mode, none no printer took, no bill to check, no failed one", () => {
  const rows = [
    row({ id: "simple", printerId: undefined }),
    row({ id: "none", printerId: PRINT_JOB_NO_PRINTER }),
    row({ id: "bill", kind: "bill", status: "needs-confirm" }),
    row({ id: "failed", status: "failed", lastError: "x" }),
    row({ id: "q" }),
  ];
  assert.equal(printWaitingPrintersOf(feed(rows), T0), "p1:1::0", "only the queued one on a printer");
});

test("fresh only (R1): an untapped 31-min row and a slip refusal are left out; a tapped 31-min row counts", () => {
  assert.equal(printWaitingPrintersOf(feed([row({ createdAt: ago(31 * 60_000) })]), T0), "", "an untapped stale slip stays in the feed for hours while its printer prints new ones");
  assert.equal(printWaitingPrintersOf(feed([row({ lastError: RASTER_FAILED_MESSAGE })]), T0), "", "the slip itself was refused: not the printer's fault");
  assert.equal(printWaitingPrintersOf(feed([row({ createdAt: ago(31 * 60_000), approved: true })]), T0), "p1:1::1", "staff tapped it: it waits for its printer (and has waited long: stuck)");
  assert.equal(printWaitingPrintersOf(feed([row({ createdAt: ago(30 * 60_000) })]), T0), "p1:1::1", "exactly 30 min is still fresh");
  assert.equal(printWaitingPrintersOf(feed([row({ lastError: PRINTER_NOT_CONNECTED_MESSAGE })]), T0), "p1:1::0", "a printer that is off is exactly what counts");
});

test("stuck (F-I2): a row says its printer's problem, or the oldest fresh row waited over a minute; not at 59 s", () => {
  assert.equal(PRINTER_WAITING_STUCK_MS, 60_000, "one minute");
  assert.equal(printWaitingPrintersOf(feed([row({ problem: "paper-out" })]), T0), "p1:1:paper-out:1", "the server's word from the writer's beat");
  assert.equal(printWaitingPrintersOf(feed([row({ createdAt: ago(61_000) })]), T0), "p1:1::1", "61 s: stuck");
  assert.equal(printWaitingPrintersOf(feed([row({ createdAt: ago(59_000) })]), T0), "p1:1::0", "59 s: a busy printer in a rush");
  assert.equal(printWaitingPrintersOf(feed([row({ id: "new", createdAt: ago(5_000) }), row({ id: "old", createdAt: ago(61_000) })]), T0), "p1:2::1", "the oldest fresh row decides");
  assert.equal(printWaitingPrintersOf(feed([row({ id: "stale", createdAt: ago(40 * 60_000) }), row({ id: "new", createdAt: ago(5_000) })]), T0), "p1:1::0", "a stale untapped row never makes it stuck");
});

test("no rows, no pulse: an empty string", () => {
  assert.equal(printWaitingPrintersOf(undefined, T0), "", "no pulse yet");
  assert.equal(printWaitingPrintersOf({}, T0), "", "an older server with no feed");
  assert.equal(printWaitingPrintersOf(feed([]), T0), "", "nothing waits");
});

test("waitingPrintersOf names them from the printers already read; an unknown id is 'A printer'", () => {
  const printers = [{ id: "p1", name: "Kitchen printer" }, { id: "p2", name: "Bill printer" }];
  assert.deepEqual(
    waitingPrintersOf("p1:3:paper-out:1|p2:1::0|gone:1::1", printers),
    [
      { printerId: "p1", name: "Kitchen printer", count: 3, problem: "paper-out", stuck: true },
      { printerId: "p2", name: "Bill printer", count: 1, stuck: false },
      { printerId: "gone", name: "A printer", count: 1, stuck: true },
    ],
    "the most first; ties in the setup's order, an unknown printer last",
  );
  assert.deepEqual(waitingPrintersOf("", printers), [], "nothing waits");
  assert.deepEqual(waitingPrintersOf("p2:2::0|p1:2::0", printers).map((w) => w.printerId), ["p1", "p2"], "a tie: the setup's order");
  assert.deepEqual(waitingPrintersOf("p1:2:bogus:0", printers)[0], { printerId: "p1", name: "Kitchen printer", count: 2, stuck: false }, "an unknown problem word is dropped");
});

test("the key round-trips: what the provider derives is what the dot reads", () => {
  const key = printWaitingPrintersOf(feed([row({ id: "a", problem: "cover-open" }), row({ id: "b", printerId: "p2", createdAt: ago(70_000) })]), T0);
  assert.deepEqual(
    waitingPrintersOf(key, [{ id: "p1", name: "Kitchen printer" }, { id: "p2", name: "Bill printer" }]).map((w) => [w.name, w.count, w.problem ?? null, w.stuck]),
    [["Kitchen printer", 1, "cover-open", true], ["Bill printer", 1, null, true]],
    "names, counts, problem and stuck survive the string",
  );
});
