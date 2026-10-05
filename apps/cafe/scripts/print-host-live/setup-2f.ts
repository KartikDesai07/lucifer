/**
 * Phase 2 Session 2F1 live legs — several printers on one phone or tablet (spec §9.2) against a REAL MongoDB: the
 * setup saves several network, Bluetooth and USB printers for one POS app device, each a different one, and refuses
 * the same printer twice, while a browser's printer stays one per device (aw); the devices read says which POS app
 * prints several printers (its wake's bridge version), and one tablet leases each of its printers' lines in one call
 * (ax). Run by scripts/verify-print-host-live.ts after legs au–av. Each leg sets its outlet up and ends with no printer.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import { PrintDevice } from "@/models/PrintDevice";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { beatPrintDevice, listPrintDevices } from "@/lib/print-device";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { createPrinterTestJob } from "@/lib/print-printer-test";
import { createPrinter } from "@/lib/print-printers";
import { check, resetCollections } from "./harness";
import { STAFF } from "./lifecycle";

const TAB = "live-2f-counter-tab";
const BROWSER = "live-2f-browser";
const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };

function lan(name: string, host: string, port: number, over: Partial<PrinterBody> = {}): PrinterBody {
  return {
    name,
    connection: { kind: "lan", host, port },
    primaryDeviceId: TAB,
    paper: 80,
    slips: { ...NO_SLIPS, notices: true },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

function device(name: string, deviceId: string, transport: "bt-classic" | "usb" | "web-serial", address: string): PrinterBody {
  return { name, connection: { kind: "device", deviceId, transport, address }, paper: 80, slips: { ...NO_SLIPS, notices: true }, copies: { kot: 1, bill: 1 }, enabled: true };
}

async function fresh(): Promise<void> {
  await Promise.all([resetCollections(), Station.deleteMany({}), Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}

export async function legAW(): Promise<void> {
  console.log("\n(aw) one POS app device saves several printers, each a different one; the same printer twice, or a browser's second, is refused");
  await fresh();
  const counter = await createPrinter(lan("Counter", "10.0.2.2", 9100, { slips: { ...NO_SLIPS, bill: true, kotAll: true, notices: true, eod: true } }));
  const bar = await createPrinter(lan("Bar", "10.0.2.2", 9101, { paper: 58 }));
  const bt = await createPrinter(device("Kitchen", TAB, "bt-classic", "00:11:22:33:44:55"));
  const usb = await createPrinter(device("Tandoor", TAB, "usb", "0416:5011"));
  check("(aw) two network printers, a Bluetooth and a USB printer of one tablet are all saved", counter.ok && bar.ok && bt.ok && usb.ok && bar.data.paper === 58);
  const sameLan = await createPrinter(lan("Again", "10.0.2.2", 9100));
  check("(aw) the same network printer twice is refused (409), saying so", !sameLan.ok && sameLan.status === 409 && sameLan.error === "Counter already prints on that printer. Choose another printer.");
  const sameBt = await createPrinter(device("Again", TAB, "bt-classic", "BT-CLASSIC:00:11:22:33:44:55"));
  check("(aw) the same Bluetooth printer by the app's whole id, in another case, is refused too", !sameBt.ok && sameBt.status === 409 && sameBt.error === "Kitchen already prints on that printer. Choose another printer.");
  const serial = await createPrinter(device("Serial", BROWSER, "web-serial", "usb"));
  const second = await createPrinter({ ...lan("Browser LAN", "10.0.2.3", 9100), primaryDeviceId: BROWSER });
  check("(aw) a browser's printer stays one per device (409, the 2D words)", serial.ok && !second.ok && second.status === 409 && second.error.startsWith("That device already prints "));
  await Printer.deleteMany({});
}

export async function legAX(nowMs: number): Promise<void> {
  console.log("\n(ax) the devices read says which POS app prints several printers; one tablet leases each of its printers' lines in one call");
  await fresh();
  await beatPrintDevice({ deviceId: TAB, label: "Counter tablet", shell: "android", capabilities: CAPS, nativeProtocol: 2 }, nowMs);
  await beatPrintDevice({ deviceId: "live-2f-old-tab", label: "Counter tablet", shell: "android", capabilities: CAPS, nativeProtocol: 1 }, nowMs);
  await beatPrintDevice({ deviceId: BROWSER, label: "Counter PC", shell: "browser", capabilities: { ...CAPS, lan: false, webSerial: true } }, nowMs);
  const devices = await listPrintDevices(nowMs + 1);
  const byId = new Map(devices.map((d) => [d.deviceId, d]));
  check("(ax) the devices read carries each POS app's bridge version, and nothing for a browser", byId.get(TAB)?.nativeProtocol === 2 && byId.get("live-2f-old-tab")?.nativeProtocol === 1 && !("nativeProtocol" in (byId.get(BROWSER) ?? {})));
  const counter = await createPrinter(lan("Counter", "10.0.2.2", 9100));
  const bar = await createPrinter(lan("Bar", "10.0.2.2", 9101));
  const counterId = counter.ok ? counter.data.id : "";
  const barId = bar.ok ? bar.data.id : "";
  const one = await createPrinterTestJob({ printerId: counterId, queuedBy: "Asha", nowMs });
  const two = await createPrinterTestJob({ printerId: barId, queuedBy: "Asha", nowMs: nowMs + 1 });
  check("(ax) a slip on each of the tablet's printers, both aimed at it", one.ok && two.ok && (await PrintJob.countDocuments({ targetDeviceId: TAB, status: "queued" })) === 2);
  const both = await leasePrintJobs({ deviceId: TAB, tabId: "tab-1", printerIds: [counterId, barId], dismissedBy: STAFF, nowMs: nowMs + 1_000 });
  check("(ax) one lease naming both lines takes one slip of each", both.jobs.length === 2 && new Set(both.jobs.map((j) => j.printerId)).size === 2);
  const acks = await Promise.all(both.jobs.map((j) => ackPrintJob({ id: j.id, deviceId: TAB, epoch: 1, outcome: "printed", nowMs: nowMs + 2_000 })));
  check("(ax) each ack: printed, and more:false for its own line", acks.every((a) => a.status === "printed" && a.more === false));
  await Printer.deleteMany({});
  await PrintDevice.deleteMany({});
}
