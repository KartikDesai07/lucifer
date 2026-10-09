/**
 * Phase 2 Session 2E live legs — several printers on one Windows PC (spec §9.2) against a REAL MongoDB: the setup
 * saves each of a PC's Windows printers by name and refuses the same one twice, while every other device still prints
 * one printer (au); one PC leases each of its Windows printers' lines by name, in one call or one at a time, so a
 * printer it does not name (one a refusal holds) keeps its slip waiting (av). Run by scripts/verify-print-host-live.ts
 * after legs ar–at. Each leg sets its outlet up and ends with no printer.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { createPrinterTestJob } from "@/lib/print-printer-test";
import { createPrinter, replacePrinter } from "@/lib/print-printers";
import { check, resetCollections } from "./harness";
import { STAFF } from "./lifecycle";

const PC = "live-2e-counter-pc";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function windows(name: string, address: string, over: Partial<PrinterBody> = {}): PrinterBody {
  return {
    name,
    connection: { kind: "device", deviceId: PC, transport: "windows", address },
    paper: 80,
    slips: { ...NO_SLIPS, notices: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

async function fresh(): Promise<void> {
  await Promise.all([resetCollections(), Station.deleteMany({}), Printer.deleteMany({})]);
}

export async function legAU(): Promise<void> {
  console.log("\n(au) one Windows PC saves each of its Windows printers by name; the same one twice, or a second kind, is refused");
  await fresh();
  const counter = await createPrinter(windows("Counter", "EPSON TM-T82", { slips: { ...NO_SLIPS, bill: true, kotAll: true, notices: true, eod: true } }));
  const kitchen = await createPrinter(windows("Kitchen", "Kitchen TVS", { paper: 58 }));
  check("(au) two Windows printers of one PC are both saved", counter.ok && kitchen.ok && kitchen.data.paper === 58);
  const twice = await createPrinter(windows("Again", "epson tm-t82"));
  check("(au) the same Windows printer twice (any case) is refused (409), saying so", !twice.ok && twice.status === 409 && twice.error === "Counter already prints on that Windows printer. Choose another Windows printer.");
  // Phase 3 Session 3E (deliberately changed): the Windows app 1.12.0 writes a network printer beside its Windows printers.
  const lan = await createPrinter({ ...windows("Network", ""), connection: { kind: "lan", host: "10.0.0.9", port: 9100 }, primaryDeviceId: PC });
  check("(au) a network printer for that PC is saved beside its Windows printers (3E)", lan.ok);
  const lanTwice = await createPrinter({ ...windows("Network again", ""), connection: { kind: "lan", host: "10.0.0.9", port: 9100 }, primaryDeviceId: PC });
  check("(au) the same network printer twice for that PC is refused (409), saying so", !lanTwice.ok && lanTwice.status === 409 && lanTwice.error === "Network already prints on that printer. Choose another printer.");
  const spare = await createPrinter(windows("Spare", "EPSON TM-T82", { enabled: false }));
  const spareId = spare.ok ? spare.data.id : "";
  const onAgain = await replacePrinter(spareId, windows("Spare", "EPSON TM-T82"));
  const moved = await replacePrinter(spareId, windows("Spare", "Bar Printer"));
  check("(au) one saved off on the same printer is kept; switched on it is refused; on another Windows printer it saves", spare.ok && !onAgain.ok && onAgain.status === 409 && moved.ok && moved.data.enabled);
  await Printer.deleteMany({});
}

export async function legAV(nowMs: number): Promise<void> {
  console.log("\n(av) one PC leases each of its Windows printers' lines by name; one it does not name keeps its slip waiting");
  await fresh();
  const counter = await createPrinter(windows("Counter", "EPSON TM-T82", { slips: { ...NO_SLIPS, bill: true, kotAll: true, notices: true, eod: true } }));
  const kitchen = await createPrinter(windows("Kitchen", "Kitchen TVS"));
  const counterId = counter.ok ? counter.data.id : "";
  const kitchenId = kitchen.ok ? kitchen.data.id : "";
  const one = await createPrinterTestJob({ printerId: counterId, queuedBy: "Asha", nowMs });
  const two = await createPrinterTestJob({ printerId: kitchenId, queuedBy: "Asha", nowMs: nowMs + 1 });
  check("(av) a slip on each printer, both aimed at the PC", one.ok && two.ok && (await PrintJob.countDocuments({ targetDeviceId: PC, status: "queued" })) === 2);
  const onlyCounter = await leasePrintJobs({ deviceId: PC, tabId: "pc-tab", tokenSlips: true, printerIds: [counterId], dismissedBy: STAFF, nowMs: nowMs + 1_000 });
  const waiting = await PrintJob.findOne({ printerId: kitchenId }).lean();
  check("(av) a lease naming the counter only (the kitchen printer held) takes the counter's slip; the kitchen's waits", onlyCounter.jobs.length === 1 && onlyCounter.jobs[0]?.printerId === counterId && waiting?.status === "queued");
  const both = await leasePrintJobs({ deviceId: PC, tabId: "pc-tab", tokenSlips: true, printerIds: [counterId, kitchenId], dismissedBy: STAFF, nowMs: nowMs + 2_000 });
  check("(av) named again, its line gives its slip; the counter's line holds its leased one (head of line per printer)", both.jobs.length === 1 && both.jobs[0]?.printerId === kitchenId);
  const acked = await ackPrintJob({ id: both.jobs[0]?.id ?? "", deviceId: PC, epoch: 1, outcome: "printed", nowMs: nowMs + 3_000 });
  check("(av) its ack: printed, and more:false for its own line, whatever the counter's holds", acked.status === "printed" && acked.more === false);
  await Printer.deleteMany({});
}
