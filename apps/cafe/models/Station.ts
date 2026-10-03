import mongoose, { Schema, type Document, type Model } from "mongoose";
import { STATION_NAME_MAX_CHARS } from "@pos/shared/print-printers";

// Printing redesign, Phase 2 (spec §6.1): a kitchen station ("Kitchen", "Bar", "Tandoor"). A KOT round
// splits by the station of each item (§8), and each station's slip prints its name (D7). The first read
// seeds one default station, "Kitchen" (lib/print-stations.ts); a category with no station, and every
// station that no longer exists, falls back to the default.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts and models/PrintDevice.ts: a plain
// default-bound model of a few rows of print setup, never money or tenant data.

export interface IStation extends Document {
  name: string; // unique, trimmed; printed on the slip
  order: number; // display order
  isDefault: boolean; // exactly one is the default (defaultStationOf picks one if a write was cut short)
  createdAt: Date;
  updatedAt: Date;
}

export const stationSchema = new Schema<IStation>(
  {
    // unique:true creates the index: two stations with one name could never be told apart on paper.
    name: { type: String, required: true, unique: true, trim: true, maxlength: STATION_NAME_MAX_CHARS },
    order: { type: Number, required: true },
    isDefault: { type: Boolean, required: true },
  },
  { timestamps: true },
);

// NO TTL index (ttl-guard default-deny): a station lives until staff delete it.

export const Station: Model<IStation> =
  (mongoose.models.Station as Model<IStation>) ?? mongoose.model<IStation>("Station", stationSchema);
