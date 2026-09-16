import mongoose, { Schema, type Document, type Model } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Chain — the P8-G registry grouping collection (build-rule #80; landed into F3 by
// the revision pass). ONE doc per franchisor/chain. A chain is a HUB-REGISTRY
// grouping ONLY — there is NO tenantId/branchId/chainId inside any CAFE document
// (#30 stays green): the grouping lives entirely here + on the Tenant's additive
// `chainClientId` FK. F3 seeds NO chains (a standalone cafe has `chainClientId`
// absent); this collection materializes when a franchise is created.
//
// Per-outlet `royalty` on the Tenant block may OVERRIDE this `defaultRoyalty`.
// `_id` IS the `chainClientId` the Tenant FK points at (default ObjectId).
// ─────────────────────────────────────────────────────────────────────────────

// Mongoose Int32 (8.12+) → a real BSON int32; aliased for the generic (the runtime
// value is the real Int32 SchemaType). rateBp is BASIS POINTS (600 = 6.00%).
const Int32 = Schema.Types.Int32 as unknown as NumberConstructor;

/** Bump when the stored Chain shape changes. */
export const CHAIN_SCHEMA_VERSION = 1;

export interface IChainRoyalty {
  rateBp: number; // BASIS POINTS
  basis: "netOfGst" | "netOfDiscount" | "gross";
  minPaise?: number;
}

export interface IChain extends Document {
  // The Fleet-Hub product key. Today there is one shipped product ('cafe-pos');
  // when the generic product-agnostic `products` collection lands (§3.2) this can
  // become an ObjectId FK. String keeps it honest + readable until then.
  productId: string;
  name: string;
  ownerEmail: string; // the franchisor
  franchisorGstin?: string;
  defaultRoyalty?: IChainRoyalty;
  v: number;
  createdAt: Date;
  updatedAt: Date;
}

const chainRoyaltySchema = new Schema<IChainRoyalty>(
  {
    rateBp: { type: Int32, required: true },
    basis: {
      type: String,
      enum: ["netOfGst", "netOfDiscount", "gross"],
      required: true,
    },
    minPaise: { type: Int32 },
  },
  { _id: false, minimize: true },
);

const chainSchema = new Schema<IChain>(
  {
    productId: { type: String, required: true, default: "cafe-pos" },
    name: { type: String, required: true, trim: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true },
    franchisorGstin: { type: String },
    defaultRoyalty: { type: chainRoyaltySchema },
    v: { type: Int32, required: true, default: CHAIN_SCHEMA_VERSION },
  },
  { timestamps: true, minimize: true },
);

// The product-view pivot (the owner's future Fleet Hub — list chains by product).
chainSchema.index({ productId: 1 });

export const Chain: Model<IChain> =
  (mongoose.models.Chain as Model<IChain>) ??
  mongoose.model<IChain>("Chain", chainSchema);

export { chainSchema, chainRoyaltySchema };
