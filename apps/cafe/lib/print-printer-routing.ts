import {
  DEFAULT_STATION_NAME,
  PRINT_FULL_KOT_NAME,
  defaultBillPrinterOf,
  defaultStationOf,
  printNoPrinterMessage,
  printerWriterDeviceId,
  routablePrinterOf,
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
 *  printer, the default bill printer (fallback). Empty with a full-copy printer: the full copy covers it.
 *  A full-copy printer that also ticks the station is left out: its full copy already holds those lines,
 *  so a station slip beside it would print them twice on one printer (the 2A final review). */
function stationTargets(setup: Setup, stationId: string): { printers: PrinterConfig[]; fallback: boolean } {
  const own = setup.printers.filter((printer) => !printer.slips.kotAll && printer.slips.kotStations.includes(stationId));
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

/** The asking device's own bill printer, when routing may send it bills: routable (the 2A gate's M9, ruled at the
 *  2B gate: a printer that takes no slip has no writer polling the wake) and taking bills (the 2D review gate: a
 *  printer prints only the slips its boxes say, so unticking Bill there sends every device's bills elsewhere). Any
 *  other choice falls back to the default bill printer. */
function chosenBillPrinter(routing: PrintRouting): PrinterConfig | null {
  const printer = routing.billPrinterId === undefined ? null : routablePrinterOf(routing.printers, routing.billPrinterId);
  return printer !== null && printer.slips.bill ? printer : null;
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
    case "token": {
      // Print customization S7 (01-PLAN §8.2): the customer's token slip prints where the bill does: the asking
      // device's bill printer, else the default bill printer (no printer has a token box yet). One copy. Never
      // dropped: with no bill printer it is made failed, visibly, like a bill.
      const printer = chosenBillPrinter(routing) ?? defaultBillPrinterOf(setup.printers);
      return printer === null ? [failed(request, NO_PART, "bills")] : [job(printer, request, 1, NO_PART)];
    }
    case "test":
      // Session 2D: a printer's test slip is made on its own printer's line by its Test print, never by slip type.
      return [];
  }
}

/** A routed job's key (spec §6.5): the slip's own key, then its printer and part, so a replay or a repair
 *  of the same slip collides on the unique jobKey instead of printing twice. A slip with no key (End of day,
 *  a cancel notice, a reprint without an Idempotency-Key) makes jobs with none. */
export function routedJobKey(baseKey: string | undefined, routed: Pick<RoutedPrintJob, "printerId" | "part">): string | undefined {
  return baseKey === undefined ? undefined : `${baseKey}:${routed.printerId ?? "none"}:${routed.part}`;
}
