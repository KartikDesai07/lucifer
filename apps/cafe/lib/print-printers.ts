import type { Types } from "mongoose";
import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINTERS_MAX, printerWriterClash, printerWriterTakenMessage, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import { Printer, type IPrinter, type IPrinterConnection } from "@/models/Printer";
import { Station } from "@/models/Station";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import type { PrintSetupResult } from "@/lib/print-stations";
import { publishCafeEvent } from "@/lib/realtime-publish";

// Printing redesign, Phase 2 (spec §6.3, §11): the outlet's printers. The setup screens (Session 2D) save a
// printer whole; the routing (lib/print-printer-routing.ts) and, from Session 2C, the agent read them as
// PrinterConfig. Never calls connectDB() (the routes do). No console.*.

export const PRINTER_NOT_FOUND = "Printer not found";
export const PRINTER_EXISTS_MESSAGE = "A printer with this name already exists.";
export const PRINTERS_FULL_MESSAGE = `A cafe can have at most ${PRINTERS_MAX} printers.`;
export const PRINTER_UNKNOWN_STATION_MESSAGE = "A chosen station no longer exists. Reload and choose again.";

/** Session 2C (the 2A gate's M7): a printer name is unique ignoring case (a pre-check read; see print-stations.ts). */
const NAME_IGNORING_CASE = { locale: "en", strength: 2 } as const;

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  return (await Printer.findOne({ name, ...(exceptId !== undefined ? { _id: { $ne: exceptId } } : {}) }).collation(NAME_IGNORING_CASE).select("_id").lean()) !== null;
}

type PrinterRow = Pick<IPrinter, "name" | "connection" | "primaryDeviceId" | "order" | "paper" | "slips" | "copies" | "enabled"> & {
  _id: Types.ObjectId;
};

function connectionWireOf(c: IPrinterConnection): PrinterConnection {
  return c.kind === "lan"
    ? { kind: "lan", host: c.host ?? "", port: c.port ?? 0 }
    : { kind: "device", deviceId: c.deviceId ?? "", transport: c.transport ?? "bt-classic", address: c.address ?? "" };
}

/** A stored printer as the API sends it (the model's validator keeps each connection complete, so the
 *  fallbacks above never show). */
export function printerWireOf(row: PrinterRow): PrinterConfig {
  return {
    id: String(row._id),
    name: row.name,
    connection: connectionWireOf(row.connection),
    ...(row.primaryDeviceId !== undefined ? { primaryDeviceId: row.primaryDeviceId } : {}),
    order: row.order,
    paper: row.paper,
    slips: {
      bill: row.slips.bill,
      kotStations: [...(row.slips.kotStations ?? [])],
      kotAll: row.slips.kotAll,
      notices: row.slips.notices,
      eod: row.slips.eod,
    },
    copies: { kot: row.copies.kot, bill: row.copies.bill },
    enabled: row.enabled,
  };
}

const PRINTER_SELECT = "name connection primaryDeviceId order paper slips copies enabled";

/** Every printer in display order (disabled ones too: the setup screen lists them). */
export async function listPrinters(): Promise<PrinterConfig[]> {
  const rows = await Printer.find().select(PRINTER_SELECT).sort({ order: 1, _id: 1 }).lean<PrinterRow[]>();
  return rows.map(printerWireOf);
}

/** Every station a printer takes KOTs for must exist now (a stale form never saves a dead id). */
async function stationsExist(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  return (await Station.countDocuments({ _id: { $in: ids } })) === ids.length;
}

export async function createPrinter(body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, ...stored } = body;
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  const existing = await listPrinters();
  if (existing.length >= PRINTERS_MAX) return { ok: false, status: 400, error: PRINTERS_FULL_MESSAGE };
  const last = existing.length === 0 ? -1 : Math.max(...existing.map((row) => row.order));
  if (await nameTaken(stored.name)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  // Session 2D (the 2C review gate, F-3): one enabled printer per printing device until Session 2E.
  const clash = printerWriterClash(existing, stored);
  if (clash !== null) return { ok: false, status: 409, error: printerWriterTakenMessage(clash.name) };
  // The unique name index must exist before the first insert (house rule: crud-route.ts).
  await Printer.init();
  try {
    const created = await Printer.create({ ...stored, order: order ?? last + 1 });
    // Session 2C: every device reads its printers again (two Worker requests per admin save, never per slip).
    publishCafeEvent("print-setup");
    return { ok: true, data: printerWireOf(created) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
    throw error;
  }
}

/** Saves a printer whole (the setup form's one unit). The connection is replaced, never merged (a LAN
 *  printer moved to a device keeps no host); an absent order keeps its place; an absent primaryDeviceId is
 *  removed (a device printer never has one). */
export async function replacePrinter(id: string, body: PrinterBody): Promise<PrintSetupResult<PrinterConfig>> {
  const { order, ...stored } = body;
  const printer = await Printer.findById(id);
  if (printer === null) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  if (!(await stationsExist(stored.slips.kotStations))) return { ok: false, status: 400, error: PRINTER_UNKNOWN_STATION_MESSAGE };
  if (await nameTaken(stored.name, id)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
  const clash = printerWriterClash(await listPrinters(), stored, id);
  if (clash !== null) return { ok: false, status: 409, error: printerWriterTakenMessage(clash.name) };
  printer.set("connection", stored.connection);
  printer.set("primaryDeviceId", stored.primaryDeviceId);
  printer.set({ name: stored.name, paper: stored.paper, slips: stored.slips, copies: stored.copies, enabled: stored.enabled });
  if (order !== undefined) printer.order = order;
  try {
    await printer.save();
    publishCafeEvent("print-setup");
    return { ok: true, data: printerWireOf(printer) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, status: 409, error: PRINTER_EXISTS_MESSAGE };
    throw error;
  }
}

export async function deletePrinter(id: string): Promise<PrintSetupResult<{ deleted: true }>> {
  const res = await Printer.deleteOne({ _id: id });
  if (res.deletedCount !== 1) return { ok: false, status: 404, error: PRINTER_NOT_FOUND };
  publishCafeEvent("print-setup");
  return { ok: true, data: { deleted: true } };
}
