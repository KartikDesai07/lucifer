import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { printerActiveWriter } from "@pos/shared/print-failover";
import {
  PRINT_TEST_LINE_MAX_CHARS,
  routablePrinterOf,
  type PrinterConfig,
  type PrinterDeviceTransport,
  type StationConfig,
} from "@pos/shared/print-printers";
import type { TestPrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { announcesQueuedJob, printerLineIsFree } from "@/lib/print-direct";
import { readPrinterFailover } from "@/lib/print-failover";
import { insertPrintJob } from "@/lib/print-job-insert";
import { PRINTER_NOT_FOUND, listPrinters } from "@/lib/print-printers";
import { listStations, type PrintSetupResult } from "@/lib/print-stations";
import { publishPrintStatus } from "@/lib/realtime-publish";

// Printing redesign, Phase 2 Session 2D (spec §11): a printer's Test print. One keyless job (every tap is one
// slip) on that printer's line, aimed at its one writer, made from the stored printer so the paper says what the
// setup says. It rides the whole lifecycle: the writer leases it (the asking tab at once when it writes this
// printer and can print on it now, decision 15), prints it only if this printer IS its printer, and acks; one
// that cannot print waits in the waiting-slips panel like any slip. Never calls connectDB(). No console.*.

export const PRINT_TEST_LABEL = "Test print";
export const PRINTER_TEST_NOT_ROUTABLE_MESSAGE = "Switch this printer on and choose its slips first: only a printer that takes slips prints.";
const TEST_SLIP_FAILED_MESSAGE = "Could not make the test slip.";

const TRANSPORT_NAMES: Record<PrinterDeviceTransport, string> = {
  "bt-classic": "Bluetooth",
  ble: "Bluetooth LE",
  usb: "USB",
  windows: "Windows printer",
  "web-serial": "USB (browser)",
  "web-bluetooth": "Bluetooth (browser)",
};

function fit(line: string): string {
  return line.length <= PRINT_TEST_LINE_MAX_CHARS ? line : `${line.slice(0, PRINT_TEST_LINE_MAX_CHARS - 1)}…`;
}

function listed(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

/** What the test slip says under the printer's name: its connection, slips, stations, paper and copies. A station
 *  that no longer exists is left out. */
export function printerTestLines(printer: PrinterConfig, stations: readonly StationConfig[]): string[] {
  const c = printer.connection;
  const connection = c.kind === "lan" ? `Network ${c.host}:${c.port}` : `${TRANSPORT_NAMES[c.transport]} ${c.address}`;
  const slips = [
    ...(printer.slips.bill ? ["Bill"] : []),
    ...(printer.slips.kotAll ? ["Full KOT copy"] : []),
    ...(printer.slips.notices ? ["Notices"] : []),
    ...(printer.slips.eod ? ["End of day"] : []),
  ];
  const names = printer.slips.kotStations.flatMap((id) => stations.filter((station) => station.id === id).map((station) => station.name));
  return [
    `Connection: ${connection}`,
    `Slips: ${listed(slips)}`,
    `Stations: ${listed(names)}`,
    `Paper: ${printer.paper} mm`,
    `Copies: KOT ${printer.copies.kot} · Bill ${printer.copies.bill}`,
  ].map(fit);
}

export function printerTestPayload(printer: PrinterConfig, stations: readonly StationConfig[], requestedBy: string, nowMs: number): TestPrintJobPayload {
  return { kind: "test", printerName: printer.name, lines: printerTestLines(printer, stations), requestedBy, requestedAt: new Date(nowMs).toISOString() };
}

/** Makes one test slip for a printer. Refused when the printer is gone (404) or routing may not send it slips
 *  (409: switched off, no printing device, no slip chosen), since its writer's lease takes only routable printers. */
export async function createPrinterTestJob(input: {
  printerId: string;
  queuedBy: string;
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: readonly string[];
  nowMs: number;
}): Promise<PrintSetupResult<PrintJobRef>> {
  const printers = await listPrinters();
  const printer = printers.find((p) => p.id === input.printerId);
  if (printer === undefined) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  const routable = routablePrinterOf(printers, printer.id);
  // Phase 3 (§9.3): the device that writes it now (a network printer taken over while its primary is offline).
  const writer = routable === null ? null : printerActiveWriter(routable, await readPrinterFailover([routable], input.nowMs));
  if (writer === null) return { ok: false, status: 409, error: PRINTER_TEST_NOT_ROUTABLE_MESSAGE };
  const payload = printerTestPayload(printer, await listStations(), input.queuedBy, input.nowMs);
  const asksHere = input.leaseTabId !== undefined && writer === input.originDeviceId && (input.readyPrinterIds ?? []).includes(printer.id);
  const tab = asksHere && input.leaseTabId !== undefined ? { tab: { tabId: input.leaseTabId, direct: await printerLineIsFree(printer.id, input.nowMs) } } : {};
  const made = await insertPrintJob({
    request: { payload, label: `${PRINT_TEST_LABEL} · ${printer.name}` },
    targetDeviceId: writer,
    originDeviceId: input.originDeviceId,
    queuedBy: input.queuedBy,
    line: { printerId: printer.id, copies: 1 },
    ...tab,
    nowMs: input.nowMs,
  });
  if (made === null) return { ok: false, status: 400, error: TEST_SLIP_FAILED_MESSAGE };
  if (announcesQueuedJob(made, made.ref.leased !== undefined)) publishPrintStatus({ id: made.ref.id, status: "queued", target: writer });
  return { ok: true, data: made.ref };
}
