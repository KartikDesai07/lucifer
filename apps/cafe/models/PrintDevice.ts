import mongoose, { Schema, type Document, type Model } from "mongoose";
import { PRINT_DEVICE_SHELLS, type PrintDeviceCapabilities, type PrintDeviceShell } from "@pos/shared/print-agent-wire";

// Printing redesign, Phase 1 (spec §6.4): one row per device that prints or leases. The heartbeat
// rides the agent's existing wake poll (POST /api/print-jobs/wake) and writes this row at most every
// 30 s (lib/print-device.ts), so it adds no request. A device is online while lastSeenAt is within
// 90 s. Phase 2 adds billPrinterId.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts and models/PrintHost.ts: this is
// operational state (which device is alive), not money or tenant data.

export interface IPrintDevice extends Document {
  deviceId: string; // the device's pos.device-id.v1 value; unique
  label: string;
  shell: PrintDeviceShell;
  capabilities: PrintDeviceCapabilities;
  lastSeenAt: Date;
  appVersion?: string;
  nativeProtocol?: number; // the Android bridge version; 1 = one printer only
  tokenSlips?: boolean; // Phase 3 (the token fix's M-2): what its last lease said: its page prints "token" jobs
  createdAt: Date;
  updatedAt: Date;
}

const capabilitiesSchema = new Schema<PrintDeviceCapabilities>(
  {
    lan: { type: Boolean, required: true },
    bluetooth: { type: Boolean, required: true },
    usb: { type: Boolean, required: true },
    windowsPrinters: { type: Boolean, required: true },
    webSerial: { type: Boolean, required: true },
    webBluetooth: { type: Boolean, required: true },
    // Phase 3 (spec §9.3): it may write any network printer the setup names; absent from a page before Phase 3.
    lanFailover: { type: Boolean },
  },
  { _id: false },
);

export const printDeviceSchema = new Schema<IPrintDevice>(
  {
    // unique:true creates the index — the heartbeat's upsert relies on it (an E11000 means the row
    // exists and is fresh).
    deviceId: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    shell: { type: String, enum: [...PRINT_DEVICE_SHELLS], required: true },
    capabilities: { type: capabilitiesSchema, required: true },
    lastSeenAt: { type: Date, required: true },
    // Omit-empty: absent until a shell reports it.
    appVersion: { type: String },
    nativeProtocol: { type: Number },
    // Phase 3 (the token fix's M-2): written by the lease's touch, and only when it changes.
    tokenSlips: { type: Boolean },
  },
  { timestamps: true },
);

// NO TTL index (ttl-guard default-deny): a device row is tiny, one per device. A row not seen for 7 days
// goes on the print prune's lazy sweep (lib/print-device.ts prunePrintDevices; owner, after Session 1D).

export const PrintDevice: Model<IPrintDevice> =
  (mongoose.models.PrintDevice as Model<IPrintDevice>) ??
  mongoose.model<IPrintDevice>("PrintDevice", printDeviceSchema);
