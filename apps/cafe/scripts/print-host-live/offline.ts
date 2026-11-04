/**
 * Printing Phase 5 live legs (spec 2026-11-03 §5.9; plan Session 5A) against a REAL MongoDB: the jobs a round taken
 * offline makes when it arrives — a line printed on the device is born printed (never leased), one that may have put
 * paper out is born queued with REPRINT, the rest as today (bh); no repair marker, no token, the taken time kept by
 * Mongoose as the order's createdAt (bh). Run by scripts/verify-print-host-live.ts after leg bg. Each leg sets the
 * outlet up itself and ends in simple mode with no host. Leg bi (the replay) is in offline-replay.ts.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import type { OfflineLine } from "@pos/shared/offline-kot";
import { dayRange } from "@pos/shared/utils";
import { Category } from "@/models/Category";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { createPrinter } from "@/lib/print-printers";
import { createStation, listStations } from "@/lib/print-stations";
import { createOrderPrintJobs, openingSlipsOf } from "@/lib/print-order-jobs";
import { offlineKeptTime, type OfflineAsk } from "@/lib/print-offline-jobs";
import { repairMissingKotJobs } from "@/lib/print-repair";
import { printConfigOf } from "@/lib/print";
import { allocateOpeningSlips } from "@/lib/slip-numbers";
import { check, resetCollections, seedPrintHost } from "./harness";
import { HOST, STAFF, rowOf } from "./lifecycle";

export const COUNTER = "live-5a-counter";
const KITCHEN = "live-5a-kitchen";
const BAR = "live-5a-bar";
const TAB = "live-5a-counter-tab";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

export interface Outlet {
  kitchenSt: string;
  barSt: string;
  kitchen: string;
  bar: string;
  counter: string;
  paneer: string;
  mojito: string;
}

function body(name: string, host: string, writer: string, slips: Partial<PrinterBody["slips"]>): PrinterBody {
  return { name, connection: { kind: "lan", host, port: 9100 }, primaryDeviceId: writer, paper: 80, slips: { ...NO_SLIPS, ...slips }, copies: { kot: 1, bill: 1 }, enabled: true };
}

async function idOf(made: Promise<{ ok: boolean; data?: { id: string } }>): Promise<string> {
  const result = await made;
  return result.ok && result.data !== undefined ? result.data.id : "";
}

/** Three network printers: the kitchen (the kitchen station, written by the kitchen tablet), the bar (the bar
 *  station, written by the bar phone) and the counter (the full copy and bills, written by the counter device). */
export async function outlet(): Promise<Outlet> {
  await Promise.all([resetCollections(), Order.deleteMany({}), Station.deleteMany({}), Printer.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
  const [kitchenStation] = await listStations();
  const barSt = await idOf(createStation({ name: "Bar" }));
  const kitchenSt = kitchenStation?.id ?? "";
  const food = await Category.create({ name: "Food" });
  const drinks = await Category.create({ name: "Drinks", stationId: barSt });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const kitchen = await idOf(createPrinter(body("Kitchen", "10.0.5.61", KITCHEN, { kotStations: [kitchenSt] })));
  const bar = await idOf(createPrinter(body("Bar", "10.0.5.62", BAR, { kotStations: [barSt] })));
  const counter = await idOf(createPrinter(body("Counter", "10.0.5.63", COUNTER, { bill: true, kotAll: true })));
  return { kitchenSt, barSt, kitchen, bar, counter, paneer: String(paneer._id), mojito: String(mojito._id) };
}

/** An open tab with Paneer and a Mojito in round 1, as the create route writes an offline order: no kotPrintDevices. */
export async function offlineOrder(o: Pick<Outlet, "paneer" | "mojito">, extra: Record<string, unknown> = {}): Promise<string> {
  const doc = await Order.create({
    orderId: `ORD-5A-${new mongoose.Types.ObjectId().toHexString()}`,
    customerName: "Walk-in",
    items: [
      { productId: o.paneer, name: "Paneer Tikka", price: 250, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
      { productId: o.mojito, name: "Mojito", price: 150, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: 400,
    discount: 0,
    total: 400,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Staff",
    kotRounds: 1,
    ...extra,
  });
  return String(doc._id);
}

const askOf = (lines: OfflineLine[]): OfflineAsk => ({ deviceId: COUNTER, round: { ref: "O-3", takenAt: Date.now(), lines } });

async function make(orderId: string, ask: OfflineAsk | undefined, nowMs: number, slips: Array<{ kind: "kot"; round: number } | { kind: "bill" }> = [{ kind: "kot", round: 1 }]) {
  return createOrderPrintJobs({
    order: await Order.findById(orderId).lean(),
    slips,
    originDeviceId: COUNTER,
    leaseTabId: TAB,
    readyPrinterIds: [],
    queuedBy: STAFF,
    nowMs,
    ...(ask !== undefined ? { offline: ask } : {}),
  });
}

export const isPrintedOffline = (row: Awaited<ReturnType<typeof rowOf>>): boolean =>
  row?.status === "printed" && row.printedBy === COUNTER && row.epoch === 0 && row.attempts === 0 && row.lease === undefined &&
  row.log?.map((e) => e.event).join() === "created,printed" && row.log?.[1]?.detail === "offline O-3";
export const isReprint = (row: Awaited<ReturnType<typeof rowOf>>): boolean =>
  row?.status === "queued" && row.labels?.join() === "REPRINT" && row.uncertainAttempts === 1 && row.epoch === 0 && row.lease === undefined;

export async function legBH(nowMs: number): Promise<void> {
  console.log("\n(bh) an offline round's jobs: printed / REPRINT / as today per routed line; no repair, no token, the taken time kept");
  const o = await outlet();
  // Printers mode. The counter device printed the kitchen's slip, may have printed the bar's, and kept its full copy.
  const first = await offlineOrder(o);
  const lines: OfflineLine[] = [
    { printerId: o.kitchen, part: o.kitchenSt, outcome: "printed" },
    { printerId: o.bar, part: o.barSt, outcome: "maybe" },
    { printerId: o.counter, part: "all", outcome: "later" },
  ];
  const refs = await make(first, askOf(lines), nowMs, [{ kind: "kot", round: 1 }]);
  const byPrinter = new Map(refs.map((ref) => [ref.printerId, ref]));
  check("(bh) one job per routed line, as online: kitchen, bar, the counter's full copy", refs.length === 3 && byPrinter.size === 3);
  check("(bh) the kitchen line it printed is born printed (by the device, log 'offline O-3', epoch 0, never leased)", byPrinter.get(o.kitchen)?.status === "printed" && isPrintedOffline(await rowOf(byPrinter.get(o.kitchen)?.id ?? "")));
  check("(bh) the bar line that may have printed is born queued with REPRINT and one uncertain attempt", isReprint(await rowOf(byPrinter.get(o.bar)?.id ?? "")));
  const full = await rowOf(byPrinter.get(o.counter)?.id ?? "");
  check("(bh) the full copy it kept is made as today: queued, unlabelled, on the counter's line", full?.status === "queued" && (full.labels ?? []).length === 0 && full.targetDeviceId === COUNTER);
  const again = await make(first, askOf(lines), nowMs);
  check("(bh) the same request again makes nothing new", again.length === 3 && (await PrintJob.countDocuments({ orderId: first })) === 3);

  // The setup changed: a full copy printed offline covers every station (the review's C2), and the device's own
  // printed line on a printer it writes and names ready is never leased to it (I8).
  const second = await offlineOrder(o);
  const covered = await createOrderPrintJobs({
    order: await Order.findById(second).lean(),
    slips: [{ kind: "kot", round: 1 }],
    originDeviceId: COUNTER,
    leaseTabId: TAB,
    readyPrinterIds: [o.counter],
    queuedBy: STAFF,
    nowMs,
    offline: askOf([{ printerId: o.counter, part: "all", outcome: "printed" }]),
  });
  const coveredBy = new Map(covered.map((ref) => [ref.printerId, ref]));
  check("(bh) a printed full copy: its own line printed, never leased to the ready counter tab", isPrintedOffline(await rowOf(coveredBy.get(o.counter)?.id ?? "")));
  check("(bh) ... and each station line it covered is a REPRINT", isReprint(await rowOf(coveredBy.get(o.kitchen)?.id ?? "")) && isReprint(await rowOf(coveredBy.get(o.bar)?.id ?? "")));

  // The repair: an offline order carries no kotPrintDevices, so the sweep never re-creates its KOT unlabelled.
  await PrintJob.deleteMany({ orderId: { $in: [first, second] } });
  const online = await offlineOrder(o, { kotPrintDevices: [COUNTER] });
  const repaired = await repairMissingKotJobs(nowMs);
  check("(bh) the sweep re-creates an ordinary server round (landmark) and nothing of the offline ones", repaired === 3 && (await PrintJob.countDocuments({ orderId: online })) === 3 && (await PrintJob.countDocuments({ orderId: { $in: [first, second] } })) === 0);

  // Simple mode with no host: the asking device printed its own KOT; a Pay Now's bill then takes the direct lease.
  await Promise.all([Printer.deleteMany({}), resetCollections()]);
  const sale = await offlineOrder(o, { status: "Completed", payment: "Cash", paidAmount: 400 });
  const simple = await make(sale, askOf([{ printerId: null, part: "-", outcome: "printed" }]), nowMs, [{ kind: "kot", round: 1 }, { kind: "bill" }]);
  const [kot, bill] = [simple.find((ref) => ref.kind === "kot"), simple.find((ref) => ref.kind === "bill")];
  check("(bh) simple mode: the KOT printed on the asking device is born printed", isPrintedOffline(await rowOf(kot?.id ?? "")));
  check("(bh) ... and the bill is the request's first live slip: made leased to the asking tab", bill?.status === "leased" && bill.leased !== undefined);
  // A host now prints this device's slips: paper is already out on the asking device, so the host prints a REPRINT.
  await seedPrintHost({ deviceId: HOST, label: "Host", setBy: STAFF, nowMs });
  const hosted = await make(await offlineOrder(o), askOf([{ printerId: null, part: "-", outcome: "printed" }]), nowMs);
  const hostedRow = await rowOf(hosted[0]?.id ?? "");
  check("(bh) simple mode with a host: the KOT printed elsewhere is a REPRINT on the host's line", hosted.length === 1 && isReprint(hostedRow) && hostedRow?.targetDeviceId === HOST);
  await resetCollections();

  // No token for an order made offline.
  const cfg = printConfigOf({ kotShowNumber: true, tokenEnabled: true });
  const withToken = await allocateOpeningSlips(cfg, { kitchen: true });
  const noToken = await allocateOpeningSlips(cfg, { kitchen: true }, undefined, { token: false });
  check("(bh) an online order draws a token (landmark); an offline one draws none", typeof withToken.tokenNumber === "number" && !("tokenNumber" in noToken) && Array.isArray(noToken.kotNumbers));
  const tokenless = await Order.findById(await offlineOrder(o, noToken)).lean();
  check("(bh) ... so its opening slips hold no token", tokenless?.tokenNumber === undefined && openingSlipsOf(tokenless, 1).length === 1);

  // The taken time: kept as createdAt (Mongoose's timestamps keep a supplied createdAt on create); 13 h back is not kept.
  const now = Date.now();
  const takenAt = Math.max(dayRange(new Date(now)).start.getTime() + 1_000, now - 3 * 3_600_000);
  const kept = offlineKeptTime(takenAt, now, [0, 0, 0]);
  const keptRow = await Order.findById(await offlineOrder(o, kept !== null ? { createdAt: new Date(kept) } : {})).lean();
  check("(bh) a kept taken time is the order's createdAt, and the create writes no kotFiredAt", kept === takenAt && keptRow?.createdAt.getTime() === kept && (keptRow.kotFiredAt ?? []).length === 0);
  const late = offlineKeptTime(now - 13 * 3_600_000, now, [0, 0, 0]);
  const lateRow = await Order.findById(await offlineOrder(o, late !== null ? { createdAt: new Date(late) } : {})).lean();
  check("(bh) 13 h back is not kept: the server's time", late === null && Math.abs((lateRow?.createdAt.getTime() ?? 0) - Date.now()) < 60_000);
  await Promise.all([Order.deleteMany({}), Station.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
}
