import mongoose, { Schema, type Document, type Model } from "mongoose";
import { PRINTER_COVER_STATES, PRINTER_LINK_STATES, PRINTER_PAPER_STATES, type PrinterCoverState, type PrinterLinkState, type PrinterPaperState } from "@pos/shared/print-failover";
import {
  PRINTER_ADDRESS_MAX_CHARS,
  PRINTER_COPIES_MAX,
  PRINTER_COPIES_MIN,
  PRINTER_DEVICE_ID_MAX_CHARS,
  PRINTER_DEVICE_TRANSPORTS,
  PRINTER_NAME_MAX_CHARS,
  PRINTER_PAPER_WIDTHS,
  type PrinterCopies,
  type PrinterDeviceTransport,
  type PrinterPaperWidth,
  type PrinterSlips,
} from "@pos/shared/print-printers";

// Printing redesign, Phase 2 (spec §6.3): one printer of the outlet and the slips it takes. A LAN printer
// is reached over the network by its primary device, and from Phase 3 (§9.3) by another device that can write
// network printers while its primary is offline or cannot reach it; a device printer (Bluetooth, USB, a Windows
// printer, Web Serial or Web Bluetooth) only by the one device that owns it. The request bodies are checked whole by lib/print-printer-schemas.ts; this schema keeps
// the stored shape honest on its own.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts: a plain default-bound model of a
// few rows of print setup. Phase 3 adds the backup printer (`backupPrinterId`, §9.4: saved with the setup) and
// what the server keeps beside the setup: `unreachable` (§9.3, the writers skipped for 5 minutes) and `health` (§10,
// what its writer last reported on the wake).

/** The stored connection: one flat subdocument for both kinds, so it stays one Mongoose path. */
export interface IPrinterConnection {
  kind: "lan" | "device";
  host?: string;
  port?: number;
  deviceId?: string;
  transport?: PrinterDeviceTransport;
  address?: string;
}

export interface IPrinter extends Document {
  name: string;
  connection: IPrinterConnection;
  primaryDeviceId?: string; // LAN only: the device that writes to it
  order: number;
  paper: PrinterPaperWidth;
  slips: PrinterSlips;
  copies: PrinterCopies;
  enabled: boolean;
  backupPrinterId?: string; // Phase 3 (§9.4): another printer's id; omit-empty
  unreachable?: Array<{ deviceId: string; until: Date }>; // Phase 3 (§9.3): server-kept, never saved by the setup
  health?: IPrinterHealth; // Phase 3 (§10): server-kept, never saved by the setup
  createdAt: Date;
  updatedAt: Date;
}

/** Phase 3 (spec §10): a printer's health as its writer last reported it (lib/print-health.ts). */
export interface IPrinterHealth {
  link: PrinterLinkState;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: boolean;
  deviceId: string;
  at: Date;
}

/** A LAN connection has a host and a port and nothing else; a device connection has a device, a transport
 *  and an address and nothing else. */
export function printerConnectionComplete(c: IPrinterConnection | undefined): boolean {
  if (c === undefined) return false;
  const lan = c.host !== undefined || c.port !== undefined;
  const device = c.deviceId !== undefined || c.transport !== undefined || c.address !== undefined;
  if (c.kind === "lan") return c.host !== undefined && c.port !== undefined && !device;
  return c.deviceId !== undefined && c.transport !== undefined && c.address !== undefined && !lan;
}

const connectionSchema = new Schema<IPrinterConnection>(
  {
    kind: { type: String, enum: ["lan", "device"], required: true },
    // Omit-empty: each kind stores only its own fields.
    host: { type: String, trim: true },
    port: { type: Number, min: 1, max: 65535 },
    deviceId: { type: String, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    transport: { type: String, enum: [...PRINTER_DEVICE_TRANSPORTS] },
    address: { type: String, maxlength: PRINTER_ADDRESS_MAX_CHARS },
  },
  { _id: false },
);

const slipsSchema = new Schema<PrinterSlips>(
  {
    bill: { type: Boolean, required: true },
    // Station ids (lib/print-printers.ts checks they exist); a deleted station is pulled from every printer.
    kotStations: { type: [String], required: true },
    kotAll: { type: Boolean, required: true },
    notices: { type: Boolean, required: true },
    eod: { type: Boolean, required: true },
  },
  { _id: false },
);

// Phase 3 (spec §9.3): a writer that could not reach this network printer, skipped for it until `until`.
const unreachableSchema = new Schema<{ deviceId: string; until: Date }>(
  {
    deviceId: { type: String, required: true, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    until: { type: Date, required: true },
  },
  { _id: false },
);

// Phase 3 (spec §10): replaced whole by each report that changed something; omit-empty inside.
const healthSchema = new Schema<IPrinterHealth>(
  {
    link: { type: String, enum: [...PRINTER_LINK_STATES], required: true },
    paper: { type: String, enum: [...PRINTER_PAPER_STATES] },
    cover: { type: String, enum: [...PRINTER_COVER_STATES] },
    error: { type: Boolean },
    deviceId: { type: String, required: true, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const copiesSchema = new Schema<PrinterCopies>(
  {
    kot: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
    bill: { type: Number, required: true, min: PRINTER_COPIES_MIN, max: PRINTER_COPIES_MAX },
  },
  { _id: false },
);

export const printerSchema = new Schema<IPrinter>(
  {
    // unique:true creates the index: staff pick printers by name.
    name: { type: String, required: true, unique: true, trim: true, maxlength: PRINTER_NAME_MAX_CHARS },
    connection: {
      type: connectionSchema,
      required: true,
      validate: { validator: printerConnectionComplete, message: "A printer connection is either a LAN address or one device's printer." },
    },
    primaryDeviceId: { type: String, maxlength: PRINTER_DEVICE_ID_MAX_CHARS },
    order: { type: Number, required: true },
    paper: { type: Number, enum: [...PRINTER_PAPER_WIDTHS], required: true },
    slips: { type: slipsSchema, required: true },
    copies: { type: copiesSchema, required: true },
    enabled: { type: Boolean, required: true },
    // Phase 3 (spec §9.4): where this printer's waiting slips go while its device is offline. A printer deleted is
    // cleared from every printer that named it (lib/print-printers.ts deletePrinter).
    backupPrinterId: { type: String, maxlength: 24 },
    // Omit-empty (no [] default): written only by an ack that could not reach the printer (lib/print-failover.ts).
    unreachable: { type: [unreachableSchema], default: undefined },
    health: { type: healthSchema },
  },
  { timestamps: true },
);

// NO TTL index (ttl-guard default-deny): a printer lives until staff delete it.

export const Printer: Model<IPrinter> =
  (mongoose.models.Printer as Model<IPrinter>) ?? mongoose.model<IPrinter>("Printer", printerSchema);
