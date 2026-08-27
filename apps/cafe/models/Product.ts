import mongoose, { Schema, type Document, type Model } from "mongoose";
import type { ProductVariation } from "@/types";

export interface IProduct extends Document {
  name: string;
  category: string; // denormalized category name
  price: number;
  // The named sizes this item sells in, each with its own price — ABSENT
  // (never []) when the item is sold one way only. OVERRIDES `price` for
  // ordering when present: the POS makes the operator pick one, and the
  // picked price is what the line bills at (`price` stays the base/reference
  // figure). Omit-empty on purpose (see the schema field below) — the
  // overwhelming majority of items store nothing, which matters on a 512MB M0.
  variations?: ProductVariation[];
  discount: number; // percentage 0-100
  available: boolean; // in-stock / "86" toggle — hides from POS ordering when false
  image: string; // opaque image ref — "r2:<key>" or a legacy Cloudinary public_id (lib/images.ts)
  modifiers: string[];
  isActive: boolean; // false = archived (soft-deleted), hidden from the menu
  // Public QR menu (CR2) visibility — ABSENT means visible, same omit-empty
  // discipline as `variations` above. No default on the schema field below:
  // this repo's overwhelming majority of products predate CR2 and the CSV
  // import has no column for it, so a default would silently rewrite every
  // existing product's meaning the moment it was next saved.
  publicVisible?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// One named size/portion and its own price — embedded, never saved
// independently, so `_id:false` (mirrors orderItemSchema/orderVoidSchema below
// in models/Order.ts).
const productVariationSchema = new Schema<ProductVariation>(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Product` export below stays for the live v1 routes.
export const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    // No `default:` — omit-empty (#8 elsewhere in this file's family, e.g.
    // Order.voids): an item sold one way only stores no key at all, so the
    // overwhelming majority of products never carry this array on a 512MB M0.
    variations: { type: [productVariationSchema], default: undefined },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    available: { type: Boolean, default: true },
    image: { type: String, default: "" },
    modifiers: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    // No `default:` — see the IProduct comment above: absent means visible,
    // and a default here would flip every pre-CR2 product's meaning.
    publicVisible: { type: Boolean },
  },
  { timestamps: true },
);

productSchema.index({ category: 1 });
productSchema.index({ name: "text" });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Product: Model<IProduct> =
  (mongoose.models.Product as Model<IProduct>) ??
  mongoose.model<IProduct>("Product", productSchema);
