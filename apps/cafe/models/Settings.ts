import mongoose, { Schema, type Document, type Model } from "mongoose";
import { GST_MODES, type GstMode } from "@/lib/constants";

// Singleton document — exactly one Settings doc exists for the cafe. Always
// read/write via findOne()/upsert; never create more than one. Holds the
// restaurant identity + receipt customization that the POS receipt and KOT
// render from (Phase 7).
export interface ISettings extends Document {
  restaurantName: string;
  tagline: string;
  mobile: string;
  address: string;
  receiptHeader: string; // extra note shown under the name on the receipt
  receiptFooter: string; // closing line on the receipt
  gstEnabled: boolean;
  gstNumber: string;
  gstRate: number; // percentage, e.g. 5
  gstMode: GstMode; // "inclusive" | "exclusive"
  kotShowPrices: boolean; // show item prices on the Kitchen Order Ticket
  logo: string; // opaque image ref ("r2:<key>" or a legacy Cloudinary public_id)
  fssai: string; // FSSAI license number, shown on the receipt when set
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Settings` export below stays for the live v1 routes.
export const settingsSchema = new Schema<ISettings>(
  {
    restaurantName: { type: String, default: "", trim: true },
    tagline: { type: String, default: "", trim: true },
    mobile: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    receiptHeader: { type: String, default: "", trim: true },
    receiptFooter: { type: String, default: "", trim: true },
    gstEnabled: { type: Boolean, default: false },
    gstNumber: { type: String, default: "", trim: true },
    gstRate: { type: Number, default: 5, min: 0, max: 100 },
    gstMode: { type: String, enum: [...GST_MODES], default: "inclusive" },
    kotShowPrices: { type: Boolean, default: false },
    logo: { type: String, default: "", trim: true },
    fssai: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Settings: Model<ISettings> =
  (mongoose.models.Settings as Model<ISettings>) ??
  mongoose.model<ISettings>("Settings", settingsSchema);
