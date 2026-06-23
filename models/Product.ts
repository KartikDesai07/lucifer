import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IProduct extends Document {
  name: string;
  category: string; // denormalized category name
  price: number;
  discount: number; // percentage 0-100
  available: boolean; // in-stock / "86" toggle — hides from POS ordering when false
  image: string; // Cloudinary public_id
  modifiers: string[];
  isActive: boolean; // false = archived (soft-deleted), hidden from the menu
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    available: { type: Boolean, default: true },
    image: { type: String, default: "" },
    modifiers: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.index({ category: 1 });
productSchema.index({ name: "text" });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Product: Model<IProduct> =
  (mongoose.models.Product as Model<IProduct>) ??
  mongoose.model<IProduct>("Product", productSchema);
