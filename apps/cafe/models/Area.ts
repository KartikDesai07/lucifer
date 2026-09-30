import mongoose, { Schema, type Document, type Model } from "mongoose";
import { TABLE_AREA_NAME_MAX_LEN } from "@/lib/constants";

export interface IArea extends Document {
  name: string;
  // Where this area sits in the list the operator arranged (Tables -> Setup ->
  // Areas). The route assigns max + 1 on create and the whole list on reorder.
  displayOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Area names are unique CASE-INSENSITIVELY ("Garden" = "garden"). Collation
// strength 2 is the database's own comparison (ICU), so there is no second
// lower-cased key for a second writer to forget; accents still differ.
export const AREA_NAME_COLLATION = { locale: "en", strength: 2 } as const;

// Exported as a SCHEMA like the other CORE models. NOT federated: areas are a
// small CORE registry collection read through the master data (lib/masters.ts),
// the DuePayment precedent - nothing here joins the per-cluster model registry.
export const areaSchema = new Schema<IArea>(
  {
    // No field-level `unique`: that would build a second, case-sensitive index
    // beside the collation one below.
    name: { type: String, required: true, trim: true, maxlength: TABLE_AREA_NAME_MAX_LEN },
    // No default: the route always sets it, and a missing value sorts first.
    displayOrder: { type: Number, min: 0 },
  },
  { timestamps: true },
);

areaSchema.index({ name: 1 }, { unique: true, collation: AREA_NAME_COLLATION });
// Matches the GET /api/areas sort exactly (the name breaks ties).
areaSchema.index({ displayOrder: 1, name: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Area: Model<IArea> =
  (mongoose.models.Area as Model<IArea>) ?? mongoose.model<IArea>("Area", areaSchema);
