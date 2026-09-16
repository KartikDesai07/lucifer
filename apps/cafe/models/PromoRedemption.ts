import mongoose, { Schema, Types, type Document, type Model } from "mongoose";

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
  // The CUSTOMER's canonical mobile (canonicalPromoMobile) — the fence
  // identity, and deliberately NOT a customerId. CB-5D part 2 gave the
  // COUNTER its own promo path, and one person ordering once from the QR
  // surface and once at the till must land in ONE fence: a public request
  // knows only a mobile, while a counter order knows a customerId, so keying
  // on the id would give the same human two independent fences and let one
  // once-per-customer code be spent twice.
  mobile: string;
  // CB-5D part 2 — OPTIONAL since the counter claims this fence too, and a
  // counter order is born from no OrderRequest. Exactly ONE of requestId /
  // claimOrderId identifies the claimant; `claimantKeyOf` below is the one
  // place that reads whichever is present, so no caller re-derives it.
  requestId?: Types.ObjectId; // the OrderRequest _id that claimed this fence
  // The counter's own claimant key: the orderId the claim was made FOR. Named
  // apart from `orderId` below because the two answer different questions —
  // this one is WHO claimed (a replay of the same order must resume, not be
  // refused), that one is which order finally consumed it (a trace, and on
  // the diner path it is written by a later best-effort backfill).
  claimOrderId?: string;
  orderId?: string; // best-effort backfill once the order write lands (never a money input)
  createdAt: Date;
  updatedAt: Date;
}

export const promoRedemptionSchema = new Schema<IPromoRedemption>(
  {
    code: { type: String, required: true },
    mobile: { type: String, required: true },
    // CB-5D part 2 — no longer `required: true`. A counter claim carries
    // `claimOrderId` instead; the unique {code,mobile} index below is what
    // enforces the fence, and it never depended on this field. Omit-empty:
    // a counter row stores no requestId key at all, and a diner row stores no
    // claimOrderId — so which surface claimed a fence stays readable.
    requestId: { type: Schema.Types.ObjectId },
    claimOrderId: { type: String },
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
