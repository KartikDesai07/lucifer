import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface ICategory extends Document {
  name: string;
  order: number; // display order in POS
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Category` export below stays for the live v1 routes.
export const categorySchema = new Schema<ICategory>(
  {
    // unique:true creates the index — no separate index() needed for name.
    name: { type: String, required: true, unique: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

categorySchema.index({ order: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Category: Model<ICategory> =
  (mongoose.models.Category as Model<ICategory>) ??
  mongoose.model<ICategory>("Category", categorySchema);
