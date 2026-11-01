import mongoose, { Schema, Types, type Document, type Model } from "mongoose";

export interface ICategory extends Document {
  name: string;
  order: number; // display order in POS
  // Printing Phase 2 (spec §6.2): the kitchen station this category's items print at. ABSENT means the
  // default station (omit-empty, no default below: every category made before Phase 2 keeps meaning that).
  stationId?: Types.ObjectId;
  // Skip-KOT: true = this category's items never go on a kitchen ticket. ABSENT = they do (omit-empty,
  // no default below: every existing category keeps meaning that).
  noKot?: boolean;
  // KOT kitchen order: this category's place on every kitchen ticket (0 = first). ABSENT = not placed
  // (no default: until an admin saves a Kitchen order, every KOT prints in the order items were added).
  // Written ONLY by PATCH /api/categories { list: "kitchen" }; stamped onto order lines as `kotRank`.
  kotOrder?: number;
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
    stationId: { type: Schema.Types.ObjectId },
    noKot: { type: Boolean },
    kotOrder: { type: Number },
  },
  { timestamps: true },
);

categorySchema.index({ order: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Category: Model<ICategory> =
  (mongoose.models.Category as Model<ICategory>) ??
  mongoose.model<ICategory>("Category", categorySchema);
