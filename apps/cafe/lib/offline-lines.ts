import { offlineBannerOf, type OfflineLine } from "@pos/shared/offline-kot";
import { printersModeOn, resolveStationId, type PrinterConfig, type StationConfig } from "@pos/shared/print-printers";
import { roundSkipsKitchen } from "@/lib/kitchen-lines";
import { kotPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { routePrintRequest, type PrintRouting } from "@/lib/print-printer-routing";
import { hostPrintSlipOf, type HostKotSlip } from "@/lib/print-host-slips";
import type { Order } from "@/types";

// Printing Phase 5 (spec 2026-11-03 §5.3, P5-7): which lines of an offline KOT print on this device. The round is
// routed with the server's own pure routing over the device's last read of the setup, so every line kept in the
// outbox is a line the server would make: on the replay the server matches them by printer and part and prints only
// the ones that did not print here. A line prints here only when its printer is one this device can print now; every
// other line waits for the server. Bills and tokens never print offline. PURE: Session 5B's send path calls it.

/** Simple mode's one line: this device's own printer, no part (spec §5.9's `printerId: null`). */
const SIMPLE_PART = "-";
const SIMPLE_COPIES = 1;

/** The routing the server would read for this round (lib/print-routing-context.ts), from what the device holds: null
 *  in simple mode. Each product's station resolved exactly as the server resolves it there. */
export function offlineRoutingOf(input: {
  printers: readonly PrinterConfig[];
  stations: readonly StationConfig[];
  products: readonly { _id: string; categoryId: string; stationId?: string }[];
  categories: readonly { _id: string; stationId?: string }[];
  billPrinterId?: string;
}): PrintRouting | null {
  if (!printersModeOn(input.printers)) return null;
  const categoryStation = new Map(input.categories.map((category) => [category._id, category.stationId]));
  const itemStations = new Map<string, string>();
  for (const product of input.products) {
    const categoryStationId = categoryStation.get(product.categoryId);
    const resolved = resolveStationId(
      {
        ...(product.stationId !== undefined ? { productStationId: product.stationId } : {}),
        ...(categoryStationId !== undefined ? { categoryStationId } : {}),
      },
      input.stations,
    );
    if (resolved !== null) itemStations.set(product._id, resolved);
  }
  return {
    printers: input.printers,
    stations: input.stations,
    itemStations,
    ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
  };
}

/** One routed line of the round's KOT: its printer and part (as the server routes it), its copies, its paper, and
 *  whether it prints on this device. */
export interface OfflineLinePlan {
  printerId: string | null;
  part: string;
  copies: number;
  request: PrintJobRequest;
  here: boolean;
}

export function offlineKotPlan(input: {
  order: Order;
  round: number;
  routing: PrintRouting | null;
  hereIds: readonly string[];
  simple: { printsOwnSlips: boolean; canPrintNow: boolean };
}): OfflineLinePlan[] {
  // The server makes no KOT for a round of only no-kitchen lines (lib/print-order-jobs.ts, kitchenSlipsOf), so the
  // device prints none either: printers mode routes nothing, and simple mode must not print a blank ticket.
  if (roundSkipsKitchen(input.order.items, input.round)) return [];
  const request = kotPrintJob(input.order, input.round);
  if (input.routing === null) {
    // Simple mode: the KOT prints here only when this device prints its own slips and its printer can print now.
    const here = input.simple.printsOwnSlips && input.simple.canPrintNow;
    return [{ printerId: null, part: SIMPLE_PART, copies: SIMPLE_COPIES, request, here }];
  }
  return routePrintRequest(request, input.routing).map((routed) => ({
    printerId: routed.printerId,
    part: routed.part,
    copies: routed.copies,
    request: routed.request,
    here: routed.printerId !== null && input.hereIds.includes(routed.printerId),
  }));
}

/** The printers this device can print now (spec §5.3, the planning review's I11): the ones it writes (`ready`); the
 *  setup's network printers its POS app (bridge v2) reports connected; and on the Windows app 1.12+, which connects per
 *  job, every network printer of the setup. Each once. */
export function offlineHereIds(input: {
  ready: readonly string[];
  setupNetworkIds: readonly string[];
  appConnectedNetworkIds: readonly string[] | null;
  windowsRaw: boolean;
}): string[] {
  const connected = input.appConnectedNetworkIds ?? [];
  const reached = input.setupNetworkIds.filter((id) => input.windowsRaw || connected.includes(id));
  return [...new Set([...input.ready, ...reached])];
}

/** The lines the outbox entry keeps, by plan index: a line printed here is printed, one whose paper may be out is
 *  maybe; another device's line, a write that sent nothing and a line not printed yet wait for the server (later). */
export function offlineLinesOf(
  plan: readonly OfflineLinePlan[],
  outcomes: ReadonlyMap<number, "printed" | "maybe" | "no">,
): OfflineLine[] {
  return plan.map((line, index) => {
    const outcome = line.here ? outcomes.get(index) : undefined;
    return { printerId: line.printerId, part: line.part, outcome: outcome === "printed" || outcome === "maybe" ? outcome : "later" };
  });
}

/** The paper of one line (spec §5.4): its routed slip through today's slip path (`hostPrintSlipOf`, as an agent prints
 *  an online job: a station slip keeps its station header and only its lines), with the banner "OFFLINE · O-3" and no
 *  number box (the server draws the number when the round arrives). Simple mode's one line is the whole round's KOT. */
export function offlineLineSlip(line: Pick<OfflineLinePlan, "request">, ref: string, todayKey: string): HostKotSlip {
  const printed = hostPrintSlipOf(line.request.payload, todayKey);
  if (printed.surface !== "kot") throw new Error("an offline line is always a KOT");
  const slip: HostKotSlip = { ...printed, banner: offlineBannerOf(ref) };
  delete slip.kotRoundNumber;
  return slip;
}
