import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PRINT_TEST_LINES_MAX, PRINT_TEST_LINE_MAX_CHARS, type PrinterConfig, type StationConfig } from "@pos/shared/print-printers";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_TEST_LABEL, printerTestLines, printerTestPayload } from "@/lib/print-printer-test";

// Printing redesign, Phase 2 Session 2D (spec §11): a printer's Test print. The server writes the slip from the
// stored printer, so the paper says what the setup says, and puts it on that printer's line for its one writer.

const KITCHEN: StationConfig = { id: "s-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "s-bar", name: "Bar", order: 1, isDefault: false };

function printer(over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id: "p1",
    name: "Kitchen printer",
    connection: { kind: "lan", host: "192.168.1.60", port: 9100 },
    primaryDeviceId: "kitchen-tab",
    order: 0,
    paper: 80,
    slips: { bill: false, kotStations: ["s-kitchen"], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

test("2D: the test slip's lines say the connection, the slips, the stations, the paper and the copies", () => {
  assert.deepEqual(printerTestLines(printer(), [KITCHEN, BAR]), [
    "Connection: Network 192.168.1.60:9100",
    "Slips: Notices",
    "Stations: Kitchen",
    "Paper: 80 mm",
    "Copies: KOT 1 · Bill 1",
  ]);
  const counter = printer({
    name: "Counter",
    connection: { kind: "device", deviceId: "counter-phone", transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" },
    primaryDeviceId: undefined,
    paper: 58,
    slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true },
    copies: { kot: 1, bill: 2 },
  });
  assert.deepEqual(printerTestLines(counter, [KITCHEN]), [
    "Connection: Bluetooth AA:BB:CC:DD:EE:FF",
    "Slips: Bill, Full KOT copy, Notices, End of day",
    "Stations: none",
    "Paper: 58 mm",
    "Copies: KOT 1 · Bill 2",
  ]);
  const gone = printer({ slips: { bill: false, kotStations: ["s-gone", "s-bar"], kotAll: false, notices: false, eod: false } });
  assert.equal(printerTestLines(gone, [KITCHEN, BAR])[2], "Stations: Bar", "a station that is gone is left out");
  assert.equal(printerTestLines(gone, [KITCHEN, BAR])[1], "Slips: none");
});

test("2D: every line fits the slip; the payload parses, keyless, with the printer's name and the server's moment", () => {
  const long = printer({ connection: { kind: "device", deviceId: "d", transport: "windows", address: "W".repeat(200) }, primaryDeviceId: undefined });
  const lines = printerTestLines(long, []);
  assert.ok(lines.length <= PRINT_TEST_LINES_MAX, "at most the payload's lines");
  assert.ok(lines.every((line) => line.length <= PRINT_TEST_LINE_MAX_CHARS), "every line within the payload's limit");
  assert.ok((lines[0] ?? "").endsWith("…"), "a long address is cut with an ellipsis");
  const payload = printerTestPayload(printer(), [KITCHEN], "Asha", Date.UTC(2026, 9, 4, 10, 0, 0));
  assert.equal(printJobPayloadSchema.safeParse(payload).success, true, "it parses as a print job payload");
  assert.equal(payload.requestedAt, "2026-10-04T10:00:00.000Z");
  assert.equal(payload.printerName, "Kitchen printer");
  assert.equal(PRINT_TEST_LABEL, "Test print");
});

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

test("PIN (2D): Test print is an admin write on one valid printer id, every answer no-store, the caller's tab named", () => {
  const route = src("app/api/printers/[id]/test/route.ts");
  assert.match(route, /export async function POST\(req: Request, \{ params \}: Params\) \{\s*const authed = await requireAdmin\(\);/, "admin only");
  assert.match(route, /if \(!mongoose\.isValidObjectId\(id\)\) return noStore\(notFound\(PRINTER_NOT_FOUND\)\);/, "the id is checked before the database");
  for (const line of route.split("\n").filter((l) => /\breturn\b/.test(l))) {
    if (/return authed\.error;/.test(line)) continue;
    assert.match(line, /return noStore\(/, line.trim());
  }
  assert.match(route, /const intent = printIntentOf\(req\);/, "the asking device and tab come from the agent headers");
  assert.ok(!/console\./.test(route), "no console");
});

test("PIN (2D): a test slip goes on its printer's line for its writer, or straight to the asking tab; never routed by slip type", () => {
  const lib = src("lib/print-printer-test.ts");
  assert.match(lib, /line: \{ printerId: printer\.id, copies: 1 \}/, "on the printer's own line, one copy");
  assert.match(lib, /targetDeviceId: writer,/, "aimed at the printer's one writer");
  // Phase 3 (§9.3) deliberately changed the writer: the device that writes it now (a network printer taken over).
  assert.match(lib, /const writer = routable === null \? null : printerActiveWriter\(routable, await readPrinterFailover\(\[routable\], input\.nowMs\)\);/, "only a printer routing may send slips to: its lease takes only those");
  assert.match(lib, /publishPrintStatus\(\{ id: made\.ref\.id, status: "queued", target: writer \}\)/, "the writer hears of it as of any slip");
  assert.ok(!/connectDB\(|console\./.test(lib), "never connects, never logs");
  const routing = src("lib/print-printer-routing.ts");
  assert.match(routing, /case "test":\s*return \[\];/, "routing by slip type never sends a test slip anywhere");
  const enqueue = src("app/api/print-jobs/route.ts");
  assert.match(enqueue, /if \(parsed\.data\.payload\.kind === "test"\) return noStore\(failure\(PRINT_TEST_ENQUEUE_MESSAGE, 400\)\);/, "the generic enqueue refuses a test slip");
});

test("PIN (2D): the device prints a test slip on the KOT surface through the same bridge as every slip", () => {
  const sources = src("components/print/PrintHostPrintSources.tsx");
  // Session 2E: drawn for its printer's paper on the Windows app (printSettings; the cafe's settings everywhere else).
  assert.match(sources, /if \(slip === null \|\| slip\.surface === "test"\) \{[\s\S]*?<PrinterTestSlip slip=\{slip\} settings=\{printSettings\} ref=\{kotRef\} \/>/, "rendered into the KOT surface's ref");
  const bridge = src("hooks/use-print-host-bridge.ts");
  assert.match(bridge, /return current\.kind === "test" \|\| current\.slip\.surface === "test" \? "kot" : current\.slip\.surface;/, "the bridge fires the KOT surface for it");
  const slip = src("components/print/PrinterTestSlip.tsx");
  assert.ok(slip.includes("{slip.printerName}") && slip.includes("slip.lines.map(") && slip.includes("{slip.banner}"), "it prints the name, the lines and a REPRINT banner when there is one");
});
