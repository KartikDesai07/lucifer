/**
 * Phase 2 Session 2D live legs — the setup screens' server half (spec §11) against a REAL MongoDB: a printer's Test
 * print, one keyless job on its own line for its one writer, or straight to the asking tab (ar); station writes that
 * never leave the setup half-done and one enabled printer per printing device until Session 2E (as); the devices list
 * (at). Run by scripts/verify-print-host-live.ts after legs an–aq. Each leg sets its outlet up and ends in simple mode.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINT_DIRECT_LEASE_DETAIL } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import { PrintDevice } from "@/models/PrintDevice";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { beatPrintDevice, listPrintDevices } from "@/lib/print-device";
import { leasePrintJobs } from "@/lib/print-lease";
import { createPrinterTestJob } from "@/lib/print-printer-test";
import { createPrinter, replacePrinter } from "@/lib/print-printers";
import { createStation, listStations, updateStation } from "@/lib/print-stations";
import { check, resetCollections } from "./harness";
import { STAFF } from "./lifecycle";

const ADMIN_PC = "live-admin-pc";
const KITCHEN = "live-2d-kitchen-tablet";
const COUNTER = "live-2d-counter-phone";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function body(name: string, over: Partial<PrinterBody>): PrinterBody {
  return { name, connection: { kind: "lan", host: "10.0.0.9", port: 9100 }, paper: 80, slips: NO_SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

async function idOf(made: Promise<{ ok: boolean; data?: { id: string } }>): Promise<string> {
  const result = await made;
  return result.ok && result.data !== undefined ? result.data.id : "";
}

async function fresh(): Promise<void> {
  await Promise.all([resetCollections(), Station.deleteMany({}), Printer.deleteMany({})]);
}

export async function legAR(nowMs: number): Promise<void> {
  console.log("\n(ar) Test print: one keyless slip on the printer's own line for its writer, or straight to the asking tab");
  await fresh();
  const [kitchenStation] = await listStations();
  const kitchen = await idOf(createPrinter(body("Kitchen", { connection: { kind: "lan", host: "10.0.0.61", port: 9100 }, primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, kotStations: [kitchenStation?.id ?? ""], notices: true } })));
  const counter = await idOf(createPrinter(body("Counter", { connection: { kind: "device", deviceId: COUNTER, transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" }, slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true } })));
  const first = await createPrinterTestJob({ printerId: kitchen, queuedBy: "Asha", originDeviceId: ADMIN_PC, nowMs });
  const second = await createPrinterTestJob({ printerId: kitchen, queuedBy: "Asha", originDeviceId: ADMIN_PC, nowMs: nowMs + 1_000 });
  const rows = await PrintJob.find({ kind: "test" }).sort({ createdAt: 1 }).lean();
  const row = rows[0];
  const payload = row === undefined ? null : printJobPayloadSchema.safeParse(JSON.parse(row.payload));
  check("(ar) each tap is one slip: two jobs, keyless, no order", first.ok && second.ok && rows.length === 2 && rows.every((r) => r.jobKey === undefined && r.orderId === undefined));
  check(
    "(ar) on the printer's own line, aimed at its writer, queued, announced like any slip",
    row !== undefined && row.printerId === kitchen && row.targetDeviceId === KITCHEN && row.status === "queued" && row.originDeviceId === ADMIN_PC && row.copies === undefined,
  );
  check(
    "(ar) the slip says what the setup says",
    payload !== null && payload.success && payload.data.kind === "test" && payload.data.printerName === "Kitchen" && payload.data.lines[0] === "Connection: Network 10.0.0.61:9100" && payload.data.requestedBy === "Asha",
  );
  const leased = await leasePrintJobs({ deviceId: KITCHEN, tabId: "kitchen-tab", tokenSlips: true, printerIds: [kitchen], dismissedBy: STAFF, nowMs: nowMs + 2_000 });
  check("(ar) its writer leases it on that printer's line", leased.jobs.length === 1 && leased.jobs[0]?.payload.kind === "test" && leased.jobs[0]?.printerId === kitchen);
  const direct = await createPrinterTestJob({ printerId: counter, queuedBy: "Asha", originDeviceId: COUNTER, leaseTabId: "counter-tab", readyPrinterIds: [counter], nowMs: nowMs + 3_000 });
  const directRow = direct.ok ? await PrintJob.findById(direct.data.id).lean() : null;
  check(
    "(ar) the asking tab that prints that printer gets it leased at once (decision 15)",
    direct.ok && direct.data.leased !== undefined && directRow?.status === "leased" && (directRow.log ?? []).some((entry) => entry.event === "leased" && entry.detail === PRINT_DIRECT_LEASE_DETAIL),
  );
  await replacePrinter(kitchen, body("Kitchen", { connection: { kind: "lan", host: "10.0.0.61", port: 9100 }, primaryDeviceId: KITCHEN, enabled: false, slips: { ...NO_SLIPS, kotStations: [kitchenStation?.id ?? ""], notices: true } }));
  const off = await createPrinterTestJob({ printerId: kitchen, queuedBy: "Asha", nowMs });
  const missing = await createPrinterTestJob({ printerId: "64f0000000000000000000ff", queuedBy: "Asha", nowMs });
  check("(ar) a switched-off printer is refused (409), a missing one 404; nothing made", !off.ok && off.status === 409 && !missing.ok && missing.status === 404 && (await PrintJob.countDocuments({ kind: "test" })) === 3);
  await Printer.deleteMany({});
}

export async function legAS(): Promise<void> {
  console.log("\n(as) a rename saved before the default moves; one enabled printer per printing device (until 2E)");
  await fresh();
  const [kitchen] = await listStations();
  const bar = await idOf(createStation({ name: "Bar" }));
  const both = await updateStation(bar, { name: "Drinks", isDefault: true });
  const defaults = await Station.find({ isDefault: true }).lean();
  check("(as) a rename and make-default in one save: renamed, the one default", both.ok && both.data.name === "Drinks" && both.data.isDefault && defaults.length === 1 && String(defaults[0]?._id) === bar);
  const clash = await updateStation(kitchen?.id ?? "", { name: "drinks", isDefault: true });
  const after = await Station.find({ isDefault: true }).lean();
  check("(as) a rename onto a taken name (any case) is refused and the default stays where it was", !clash.ok && clash.status === 409 && after.length === 1 && String(after[0]?._id) === bar);

  const lan = await createPrinter(body("Kitchen", { primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, kotStations: [bar], notices: true } }));
  // Session 2F1 (deliberate change): a POS app device may write several printers (bridge v2), each a different one
  // (leg aw); the same printer a second time is still refused, naming the first.
  const second = await createPrinter(body("Bar", { primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, bill: true } }));
  check("(as) the same printer a second time for one device is refused (409), naming the first", lan.ok && !second.ok && second.status === 409 && second.error.startsWith("Kitchen already prints"));
  const spare = await createPrinter(body("Spare", { primaryDeviceId: KITCHEN, enabled: false, slips: { ...NO_SLIPS, bill: true } }));
  const spareId = spare.ok ? spare.data.id : "";
  const switchOn = await replacePrinter(spareId, body("Spare", { primaryDeviceId: KITCHEN, slips: { ...NO_SLIPS, bill: true } }));
  check("(as) saved switched off it is kept; switching it on while the first prints is refused", spare.ok && !switchOn.ok && switchOn.status === 409);
  const resave = await replacePrinter(lan.ok ? lan.data.id : "", body("Kitchen", { primaryDeviceId: KITCHEN, copies: { kot: 2, bill: 1 }, slips: { ...NO_SLIPS, kotStations: [bar], notices: true } }));
  check("(as) the first printer saved again is never its own clash", resave.ok && resave.data.copies.kot === 2);
  await Printer.deleteMany({});
}

export async function legAT(nowMs: number): Promise<void> {
  console.log("\n(at) the devices list: the most recently seen first, online by the server's clock");
  await PrintDevice.deleteMany({});
  const caps = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };
  await beatPrintDevice({ deviceId: KITCHEN, label: "POS app", shell: "android", capabilities: caps }, nowMs - 10 * 60_000);
  await beatPrintDevice({ deviceId: COUNTER, label: "POS app", shell: "android", capabilities: caps }, nowMs - 5_000);
  const list = await listPrintDevices(nowMs);
  check("(at) newest first", list.map((d) => d.deviceId).join() === [COUNTER, KITCHEN].join());
  check("(at) online within 90 s, offline after", list[0]?.online === true && list[1]?.online === false && list[1]?.shell === "android" && list[1]?.label === "POS app");
  check("(at) last seen as an ISO time", list[1]?.lastSeenAt === new Date(nowMs - 10 * 60_000).toISOString());
  // Phase 3 Session 3E (spec §9.6): a device that writes network printers says so; a Windows app before 1.12.0 does not.
  check("(at) a POS app writes network printers", list[0]?.lan === true);
  await beatPrintDevice({ deviceId: "live-2d-old-pc", label: "Counter PC", shell: "windows", capabilities: { ...caps, lan: false, bluetooth: false, usb: false, windowsPrinters: true } }, nowMs - 1_000);
  check("(at) a Windows app 1.11.0 does not", (await listPrintDevices(nowMs)).find((d) => d.deviceId === "live-2d-old-pc")?.lan === undefined);
  await PrintDevice.deleteMany({});
}
