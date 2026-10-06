/**
 * Printing Phase 2 Session 2A live legs (plan 2026-10-03-phase-2-routing.md, Task A6), against a REAL
 * MongoDB: the stations (ah) and printers (ai) setup, and the routing read over a real catalog (aj). Run by
 * scripts/verify-print-host-live.ts after leg ag.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { STATIONS_MAX } from "@pos/shared/print-printers";
import { Category } from "@/models/Category";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { createPrinter, deletePrinter, listPrinters, replacePrinter } from "@/lib/print-printers";
import { createStation, deleteStation, listStations, updateStation } from "@/lib/print-stations";
import { readPrintRouting } from "@/lib/print-routing-context";
import { routePrintRequest } from "@/lib/print-printer-routing";
import { kotPrintJob } from "@/lib/print-routing";
import { baseOrderFields, check } from "./harness";

async function resetSetup(): Promise<void> {
  await Promise.all([Station.deleteMany({}), Printer.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
}

function printerBody(name: string, over: Partial<PrinterBody> = {}): PrinterBody {
  return {
    name,
    connection: { kind: "device", deviceId: `${name}-device`, transport: "bt-classic", address: "00:11:22:33:44:55" },
    paper: 80,
    slips: { bill: false, kotStations: [], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

function idOf(result: { ok: boolean; data?: { id: string } }): string {
  return result.ok && result.data !== undefined ? result.data.id : "";
}

export async function legAH(): Promise<void> {
  console.log("\n(ah) stations: the default seeded once, moved never deleted, a deleted station cleared everywhere");
  await resetSetup();
  const reads = await Promise.all(Array.from({ length: 5 }, () => listStations()));
  const rows = await Station.find().lean();
  check("(ah) five first reads at once seed exactly one station, the default Kitchen", rows.length === 1 && rows[0]?.name === "Kitchen" && rows[0]?.isDefault === true);
  check("(ah) every racing read answers the same one station", reads.every((r) => r.length === 1 && r[0]?.id === String(rows[0]?._id)));

  const bar = await createStation({ name: "Bar" });
  const tandoor = await createStation({ name: "Tandoor" });
  check("(ah) new stations go last, never the default", bar.ok && tandoor.ok && bar.data.order === 1 && tandoor.data.order === 2 && !bar.data.isDefault);
  const twin = await createStation({ name: "Bar" });
  check("(ah) a second station with the same name is refused (409)", !twin.ok && twin.status === 409);

  const moved = await updateStation(idOf(bar), { isDefault: true });
  const defaults = await Station.find({ isDefault: true }).lean();
  check("(ah) making Bar the default moves the flag: exactly one default", moved.ok && defaults.length === 1 && String(defaults[0]?._id) === idOf(bar));
  const delDefault = await deleteStation(idOf(bar));
  check("(ah) the default station can't be deleted (400)", !delDefault.ok && delDefault.status === 400);
  const renameClash = await updateStation(idOf(tandoor), { name: "Kitchen" });
  check("(ah) a rename onto another station's name is refused (409)", !renameClash.ok && renameClash.status === 409);
  const missing = await updateStation(new mongoose.Types.ObjectId().toHexString(), { name: "Grill" });
  check("(ah) a station that does not exist answers 404", !missing.ok && missing.status === 404);

  const tId = idOf(tandoor);
  const category = await Category.create({ name: "Breads", stationId: tId });
  const product = await Product.create({ name: "Naan", categoryId: category._id, price: 40, stationId: tId });
  const printer = await createPrinter(printerBody("Tandoor printer", { slips: { bill: false, kotStations: [tId, idOf(bar)], kotAll: false, notices: true, eod: false } }));
  const deleted = await deleteStation(tId);
  const rawCategory = await Category.collection.findOne({ _id: category._id });
  const rawProduct = await Product.collection.findOne({ _id: product._id });
  const rawPrinter = await Printer.findById(idOf(printer)).lean();
  check("(ah) deleting Tandoor removes it", deleted.ok && (await Station.countDocuments({ _id: tId })) === 0);
  check("(ah) ... and clears it from the category and the item: the field is gone, never null", rawCategory !== null && !("stationId" in rawCategory) && rawProduct !== null && !("stationId" in rawProduct));
  check("(ah) ... and from the printer, keeping its other stations", JSON.stringify(rawPrinter?.slips.kotStations) === JSON.stringify([idOf(bar)]));

  for (let i = (await Station.countDocuments()); i < STATIONS_MAX; i++) await createStation({ name: `Station ${i}` });
  const over = await createStation({ name: "One too many" });
  check(`(ah) at most ${STATIONS_MAX} stations`, !over.ok && over.status === 400 && (await Station.countDocuments()) === STATIONS_MAX);
}

export async function legAI(): Promise<void> {
  console.log("\n(ai) printers: saved whole, in order, a connection replaced never merged");
  await resetSetup();
  const [kitchen] = await listStations();
  const kId = kitchen?.id ?? "";
  const lan = await createPrinter(printerBody("Kitchen printer", {
    connection: { kind: "lan", host: "192.168.1.60", port: 9100 },
    primaryDeviceId: "kitchen-tab",
    slips: { bill: false, kotStations: [kId], kotAll: false, notices: true, eod: false },
  }));
  const counter = await createPrinter(printerBody("Counter printer", { slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true }, copies: { kot: 1, bill: 2 } }));
  const list = await listPrinters();
  check("(ai) two printers listed in the order they were added", lan.ok && counter.ok && list.map((p) => p.name).join() === "Kitchen printer,Counter printer" && list[1]?.order === 1);
  check("(ai) a LAN printer keeps its printing device; a device printer has none", list[0]?.primaryDeviceId === "kitchen-tab" && !("primaryDeviceId" in (list[1] ?? {})));
  const twin = await createPrinter(printerBody("Counter printer"));
  check("(ai) a second printer with the same name is refused (409)", !twin.ok && twin.status === 409);
  const ghost = await createPrinter(printerBody("Bar printer", { slips: { bill: false, kotStations: [new mongoose.Types.ObjectId().toHexString()], kotAll: false, notices: true, eod: false } }));
  check("(ai) a printer for a station that does not exist is refused (400)", !ghost.ok && ghost.status === 400);

  const lanId = idOf(lan);
  const toDevice = await replacePrinter(lanId, printerBody("Kitchen printer", { slips: { bill: false, kotStations: [kId], kotAll: false, notices: true, eod: false } }));
  const raw = await Printer.collection.findOne({ _id: new mongoose.Types.ObjectId(lanId) });
  check("(ai) a LAN printer saved as a device printer keeps no host, port or printing device", toDevice.ok && raw !== null && raw.connection.kind === "device" && !("host" in raw.connection) && !("port" in raw.connection) && !("primaryDeviceId" in raw));
  check("(ai) a save without an order keeps the printer's place", toDevice.ok && toDevice.data.order === 0);
  const back = await replacePrinter(lanId, printerBody("Kitchen printer", { connection: { kind: "lan", host: "192.168.1.61", port: 9101 }, primaryDeviceId: "kitchen-tab-2", order: 5 }));
  check("(ai) ... and back to LAN with a new printing device and a new place", back.ok && back.data.connection.kind === "lan" && back.data.primaryDeviceId === "kitchen-tab-2" && back.data.order === 5);
  const gone = await deletePrinter(lanId);
  const again = await deletePrinter(lanId);
  check("(ai) a deleted printer is gone; deleting it again answers 404", gone.ok && !again.ok && again.status === 404 && (await Printer.countDocuments()) === 1);
}

export async function legAJ(): Promise<void> {
  console.log("\n(aj) routing over a real catalog: item override, category station, the default; simple mode is one read");
  await resetSetup();
  check("(aj) no printers: simple mode, no routing", (await readPrintRouting({ productIds: [] })) === null);
  const [kitchen] = await listStations();
  const bar = await createStation({ name: "Bar" });
  const kId = kitchen?.id ?? "";
  const bId = idOf(bar);
  const off = await createPrinter(printerBody("Spare", { enabled: false, slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true } }));
  check("(aj) a disabled printer keeps simple mode", off.ok && (await readPrintRouting({ productIds: [] })) === null);

  await createPrinter(printerBody("Kitchen printer", { slips: { bill: false, kotStations: [kId], kotAll: false, notices: true, eod: false } }));
  await createPrinter(printerBody("Bar printer", { slips: { bill: false, kotStations: [bId], kotAll: false, notices: true, eod: false } }));
  await createPrinter(printerBody("Counter printer", { slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true } }));
  const drinks = await Category.create({ name: "Drinks", stationId: bId });
  const food = await Category.create({ name: "Food" });
  const mojito = await Product.create({ name: "Mojito", categoryId: drinks._id, price: 150 });
  const coffee = await Product.create({ name: "Hot Coffee", categoryId: drinks._id, price: 90, stationId: kId });
  const paneer = await Product.create({ name: "Paneer Tikka", categoryId: food._id, price: 250 });
  const stray = await Product.create({ name: "Special", categoryId: drinks._id, price: 99, stationId: new mongoose.Types.ObjectId() });
  const ids = [mojito, coffee, paneer, stray].map((p) => String(p._id));

  const routing = await readPrintRouting({ productIds: [...ids, "not-an-id"], billPrinterId: "chosen" });
  const at = (id: string) => routing?.itemStations.get(id);
  check("(aj) printers mode reads the setup", routing !== null && routing.printers.length === 4 && routing.stations.length === 2 && routing.billPrinterId === "chosen");
  check("(aj) the category's station: Mojito prints at the Bar", at(ids[0] ?? "") === bId);
  check("(aj) the item's own station wins: Hot Coffee (Drinks) prints in the Kitchen", at(ids[1] ?? "") === kId);
  check("(aj) no station anywhere: Paneer prints at the default (Kitchen)", at(ids[2] ?? "") === kId);
  check("(aj) an item station that no longer exists falls back to its category's (Bar)", at(ids[3] ?? "") === bId);

  const lines = [mojito, coffee, paneer].map((p) => ({ productId: String(p._id), name: p.name, price: p.price, qty: 1, modifiers: [], instructions: "", kotRound: 1 }));
  const order = baseOrderFields({ _id: new mongoose.Types.ObjectId().toHexString(), items: lines, status: "Pending" });
  const jobs = routing === null ? [] : routePrintRequest(kotPrintJob(order, 1), routing);
  const itemsOf = (i: number) => {
    const payload = jobs[i]?.request.payload;
    return payload?.kind === "kot" ? payload.snapshot.items.map((line) => line.name).join("+") : "";
  };
  check("(aj) end to end: the kitchen gets Hot Coffee and Paneer, the bar the Mojito, the counter all three", jobs.length === 3 && itemsOf(0) === "Hot Coffee+Paneer Tikka" && itemsOf(1) === "Mojito" && itemsOf(2) === "Mojito+Hot Coffee+Paneer Tikka");
  // Session 2C: a saved printer now routes every slip, so the legs after this one start in simple mode again.
  await resetSetup();
}
