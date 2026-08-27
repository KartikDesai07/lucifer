import mongoose, { Schema, type Document, type Model } from "mongoose";

// SPEC P4 (CR2.2c follow-up, phase-CR2-public-ordering.md §17.E/§18) — durable
// usage history for a promo code configured with `oncePerCustomer: true`
// (models/Settings.ts's promoCodeSchema / @pos/shared/public's
// PromoCodeConfig). One row per (code, mobile) pair that has ever CLAIMED the
// fence at accept time (lib/order-request-accept-promo.ts's
// claimPromoRedemption) — the unique compound index below IS the
// enforcement; the quote-time PromoRedemption.exists() check ahead of it
// (order-request-create.ts / order-request-edit.ts) is only a courtesy so a
// diner isn't misled into thinking a doomed code "worked".
//
// Deliberately NOT in the federated registry (mirrors models/OrderRequest.ts
// exactly, for the same reason) — a plain default-bound CORE-cluster model,
// v1-grade. Rows are tiny and bounded by customers × capped codes, never on
// the ledger's paise/sharding discipline.
//
// NO TTL: ttl-guard's default-deny (shared.md) allows exactly one registry
// TTL index platform-wide (Heartbeat). A redemption is the durable "this
// code+mobile pair is used up" fact and must never silently expire — a
// cancelled/voided order still keeps its redemption (§18 doc: a used code
// stays used, simplicity beats refund logic on an M0). This model is never
// walked by the registry's module-load TTL sweep (it is deliberately not
// federated — see above), so its own test pins `assertSchemaTtlAllowed`
// directly, exactly like OrderRequest.ts's own model test does.
export interface IPromoRedemption extends Document {
  code: string; // normalized UPPERCASE, matches PromoCodeConfig.code
  mobile: string; // the request's own mobile — the only identity a public surface has
  requestId: string; // the OrderRequest _id that claimed this fence
  orderId?: string; // best-effort backfill once the order write lands (never a money input)
  createdAt: Date;
  updatedAt: Date;
}

export const promoRedemptionSchema = new Schema<IPromoRedemption>(
  {
    code: { type: String, required: true },
    mobile: { type: String, required: true },
    requestId: { type: String, required: true },
    // No default — omit-empty, mirrors OrderRequest.ts's own optional fields:
    // a redemption claimed before its order write lands carries no key at all.
    orderId: { type: String },
  },
  { timestamps: true },
);

// The enforcement fence itself — a duplicate-key error on THIS index is what
// claimPromoRedemption (order-request-accept-promo.ts) treats as "already
// used", never a courtesy check it could get wrong.
promoRedemptionSchema.index({ code: 1, mobile: 1 }, { unique: true });

// Reuse the compiled model across hot reloads / serverless invocations.
export const PromoRedemption: Model<IPromoRedemption> =
  (mongoose.models.PromoRedemption as Model<IPromoRedemption>) ??
  mongoose.model<IPromoRedemption>("PromoRedemption", promoRedemptionSchema);
