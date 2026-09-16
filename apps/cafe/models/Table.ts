import mongoose, { Schema, type Document, type Model } from "mongoose";
import { TABLE_STATUSES, type TableStatus } from "@/lib/constants";

export interface ITable extends Document {
  tableNo: string; // T-1 to T-8
  status: TableStatus;
  currentOrderId?: string; // orderId of active order
  capacity: number;
  // Extra charge this table adds to a bill (whole rupees) and the name it
  // prints under. Admin config, not occupancy — the order lifecycle never
  // writes these. Rupees, not paise: this is a CORE registry collection like
  // Product.price, not the paise-encoded Order ledger.
  chargeAmount?: number;
  chargeLabel?: string;
  // Where this table sits in the floor-plan list the operator arranged by hand
  // (Tables screen → Arrange). Absent on tables that predate arranging, which
  // Mongo sorts before any value — so an un-arranged cafe keeps plain
  // name order. Lower = earlier.
  displayOrder?: number;
  // The table's PUBLIC identity (CR2), printed into its QR sticker — opaque,
  // never the guessable tableNo (see packages/shared/src/public.ts). Absent on
  // every table that predates CR2 until an admin mints one via the token
  // route; minting a fresh value also invalidates whatever sticker was printed
  // for the old one, which is the point of "regenerate".
  publicToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Table` export below stays for the live v1 routes.
export const tableSchema = new Schema<ITable>(
  {
    // unique:true creates the index — no separate index() needed for tableNo.
    tableNo: { type: String, required: true, unique: true },
    status: { type: String, enum: [...TABLE_STATUSES], default: "Available" },
    currentOrderId: { type: String },
    capacity: { type: Number, default: 4 },
    // No `default: 0` — an absent charge stays absent (omit-empty), so the
    // overwhelming majority of tables carry neither field at all.
    chargeAmount: { type: Number, min: 0 },
    chargeLabel: { type: String, trim: true },
    // No default: a table that has never been arranged carries no key, and Mongo
    // sorts a missing field before any value — so a cafe that never arranges its
    // floor plan keeps exactly today's name ordering with no backfill.
    displayOrder: { type: Number, min: 0 },
    // No default — omit-empty, same discipline as chargeAmount/displayOrder
    // above. A minted token overwrites this; nothing else ever should.
    publicToken: { type: String },
  },
  { timestamps: true },
);

// Matches the GET /api/tables sort exactly (displayOrder, then tableNo as the
// tie-break for un-arranged tables sharing the missing-field case).
tableSchema.index({ displayOrder: 1, tableNo: 1 });

// unique + SPARSE: every table that predates CR2 (and any created before an
// admin bothers to mint a sticker) carries no publicToken at all, and a
// plain unique index treats every one of those absent values as the SAME
// null — the second such table would fail to insert. sparse excludes
// documents missing the field from the index entirely, so only two REAL
// tokens can ever collide.
tableSchema.index({ publicToken: 1 }, { unique: true, sparse: true });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Table: Model<ITable> =
  (mongoose.models.Table as Model<ITable>) ??
  mongoose.model<ITable>("Table", tableSchema);
