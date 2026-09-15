import mongoose, { Schema, type Document, type Model } from "mongoose";
import { CUSTOMER_NOTES, type CustomerNote } from "@/lib/constants";

// CB-5D — one promo code ASSIGNED to this customer by a milestone claim
// (config-time minted code, claim-time assignment — owner decision). This is
// a DISPLAY row for the diner's "my rewards" list and the staff detail view;
// the MONEY fence that actually authorizes a redemption stays
// `PromoRedemption`'s unique {code,mobile} index (models/PromoRedemption.ts)
// — this array must never be read as authority (two identity sources for
// one spend is the exact bug that lesson exists to prevent).
export interface IAssignedReward {
  code: string; // the Settings promo code assigned to this customer
  at: number; // WHICH rung earned it (the milestone stamp count)
  kind: string; // snapshot of the promo kind at assignment
  assignedAt: Date;
  expiresAt?: Date; // absent = never expires (validDays was unset)
  usedAt?: Date; // set when the code is actually spent
  orderId?: string; // which order spent it (audit; never a money input)
}

export interface ICustomer extends Document {
  name: string;
  mobile: string;
  visits: number;
  totalSpend: number;
  totalDue: number; // outstanding balance
  notes: CustomerNote;
  // Idempotency markers for the F2.5 CRM rollup (lib/customer-rollup.ts): the
  // orderIds whose contribution has been applied to this projection, newest last,
  // pruned to APPLIED_ORDERS_MAX. Landed by F2.5 (ownership reconciled vs
  // build-rule #60 — P5 still owns `appliedLoyaltyOrders` + the reconcileLedger
  // rewrite onto the same filter-predicate form).
  appliedOrders?: string[];

  // ── Diner account + stamp loyalty (CB-4) ─────────────────────────────────
  // All OPTIONAL with no default: a walk-in customer created by the staff
  // checkout path has never had an account and must store none of these keys.
  //
  // `pinHash` is a CREDENTIAL — `select: false`, the Staff.password discipline
  // (models/Staff.ts:28): no route can echo what no query returns, and the
  // customer detail/reconcile paths read whole lean docs.
  pinHash?: string;
  // Bumped on every staff reset. A live session row is deleted on reset too,
  // so this is a second, cheap revocation channel rather than the only one.
  pinVersion?: number;
  pinSetAt?: Date;

  // Current card progress. A COUNTER, incremented by a filter-predicate
  // guarded `$inc` (build-rule #60 — the same shape lib/customer-rollup.ts
  // uses for visits/totalSpend), never a read-modify-write.
  stamps?: number;
  // Lifetime stamps earned — never decremented, so "you have earned N rewards"
  // copy cannot be rewritten by an owner retuning stampsPerReward.
  stampsLifetime?: number;
  // Idempotency markers for the STAMP grant, deliberately a SECOND array and
  // never a reuse of `appliedOrders` above: that array's `$ne` filter is what
  // gates the money rollup's own `$inc`, so sharing one array would make a
  // stamp grant and a spend rollup silently cancel each other's guard. P5
  // reserves `appliedLoyaltyOrders` for its points/wallet ledger; this is the
  // CB-4 stamp subset of the same idea, named apart so P5 can land beside it.
  stampOrders?: string[];

  // CB-5B — redemption idempotency markers, a THIRD and FOURTH array, never a
  // reuse of `stampOrders`/`appliedOrders` above: each array's own `$ne`
  // filter is what makes its sibling `$inc` conditional, so sharing one
  // marker between two writers would let whichever lands first silently
  // cancel the other's guard (the same reasoning stampOrders states for
  // appliedOrders, one level up).
  //
  // TWO arrays, not one, because a spend and its return are two INDEPENDENT
  // filter predicates on the same orderId: claimRewardStamps needs
  // `redeemedOrders: {$ne: orderId}` (spend at most once); returnRewardStamps
  // needs `redeemedOrders: orderId` (a return may only fire against a spend
  // that actually landed) AND `returnedOrders: {$ne: orderId}` (the return
  // itself at most once). A single array cannot express both "has this
  // fired" and "has the compensating reversal of THAT already fired" without
  // one write corrupting the other's read.
  redeemedOrders?: string[]; // orders whose redemption has been SPENT
  returnedOrders?: string[]; // orders whose spend has been RETURNED (cancel)

  // CB-5D — the diner-facing "my rewards" list: every promo code assigned to
  // this customer by a milestone claim. `default: undefined`, NOT `[]` — the
  // documented "sparse multikey unique ≠ empty-array safe" bug means an
  // empty array can index as null under a sparse unique index elsewhere in
  // this codebase, so absence is kept as absence rather than materializing
  // an empty array on every customer who has never claimed one.
  rewards?: IAssignedReward[];

  // CB-5D part 2 — when the customer's stamps most recently CROSSED a given
  // rung, keyed by that rung's `at` (as a string — Mongoose Map keys cannot
  // contain dots, and `at` is validated as a positive integer at save time
  // (settings-loyalty.schema.ts), so `String(at)` is always a safe key with
  // no collision risk).
  //
  // A MAP, not an array: a rung is addressed by its `at`, not by position —
  // the owner can re-tune the ladder (add/remove/reorder milestones) at any
  // time, and a map read is O(1) at claim time (order-request-reward.ts)
  // with no scan, unlike an array that would have to be searched by `at`
  // and would grow with every re-tuning of the ladder.
  //
  // DISPLAY/GATE input only, never a money authority: this only answers "is
  // the claim window for this rung still open" (isRungClaimWindowClosed).
  // The actual balance that claimRewardStamps spends against is still
  // `stamps` above, fenced by that function's own `$gte` filter — this map
  // can never gate a redemption's money, only its timing.
  rungEarnedAt?: Map<string, Date>;
  createdAt: Date;
  updatedAt: Date;
}

// CB-5D — one assigned reward row. Embedded, `_id: false` (mirrors
// promoCodeSchema in models/settings.subschemas.ts): a customer's own
// rewards list is read and written as part of the customer document, never
// addressed independently. No `default:` on any optional field (omit-empty
// discipline) and no `required:true` on `expiresAt`/`usedAt`/`orderId` —
// every one is legitimately absent for most rows.
const assignedRewardSchema = new Schema<IAssignedReward>(
  {
    code: { type: String, required: true },
    at: { type: Number, required: true },
    kind: { type: String, required: true },
    assignedAt: { type: Date, required: true },
    expiresAt: { type: Date },
    usedAt: { type: Date },
    orderId: { type: String },
  },
  { _id: false },
);

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Customer` export below stays for the live v1 routes. Customer
// lives on the CORE cluster (unique mobile index, CRM rollup target) — never sharded.
export const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    // unique:true creates the index — no separate index() needed for mobile.
    mobile: { type: String, required: true, unique: true },
    visits: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    totalDue: { type: Number, default: 0 },
    notes: { type: String, enum: [...CUSTOMER_NOTES], default: "Regular" },
    // F2.5 rollup dedupe markers. `default: undefined` suppresses Mongoose's
    // automatic empty-[] so an untouched customer stores NO field (omit-empty,
    // #8); `select: false` keeps this internal array out of every read/API
    // payload (the rollup only ever references it in update FILTERS, which
    // projection does not affect). NO index — it is never queried standalone.
    appliedOrders: { type: [String], default: undefined, select: false },

    // CB-4 diner account + stamp loyalty. Same omit-empty discipline as
    // appliedOrders above — NO `default:` on any of them, so a customer who
    // never made an account stores none of these keys.
    //
    // pinHash is `select: false` for the same reason Staff.password is: the
    // customer detail route and the reconcile path read whole documents, and a
    // credential hash must never ride an API payload. Only the diner login
    // route may ask for it, with an explicit `+pinHash` projection.
    pinHash: { type: String, select: false },
    pinVersion: { type: Number },
    pinSetAt: { type: Date },
    stamps: { type: Number },
    stampsLifetime: { type: Number },
    // `select: false` + `default: undefined`, exactly as appliedOrders — this
    // is an internal idempotency marker referenced only in update FILTERS
    // (which projection does not affect), never rendered. NO index: it is
    // never queried standalone.
    stampOrders: { type: [String], default: undefined, select: false },
    // CB-5B redemption markers — same omit-empty/internal-filter-only
    // discipline as stampOrders directly above (see the interface comment
    // for why this is two arrays, not a reuse of an existing one). NO index:
    // neither is ever queried standalone, only as an update filter term.
    redeemedOrders: { type: [String], default: undefined, select: false },
    returnedOrders: { type: [String], default: undefined, select: false },
    // CB-5D — the diner-facing "my rewards" list. `default: undefined`, NOT
    // `[]` (the interface comment above states why); NOT `select: false` —
    // unlike the internal idempotency markers above, this list is meant to
    // be READ (diner "my rewards", staff detail view). NO index: it is
    // never queried standalone, and it is DISPLAY ONLY — it must never gate
    // a redemption (the money fence stays PromoRedemption's unique index).
    rewards: { type: [assignedRewardSchema], default: undefined },
    // CB-5D part 2 — `default: undefined` (NOT `{}`), same omit-empty
    // discipline as the arrays above: a customer who has never crossed a
    // rung stores no `rungEarnedAt` key at all. NOT `select: false` — unlike
    // the internal idempotency markers, the claim gate (order-request-reward.ts)
    // must be able to read this. NO index: it is only ever read by its own
    // customer's _id lookup, never queried standalone.
    rungEarnedAt: { type: Map, of: Date, default: undefined },
  },
  { timestamps: true },
);

customerSchema.index({ name: "text" });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Customer: Model<ICustomer> =
  (mongoose.models.Customer as Model<ICustomer>) ??
  mongoose.model<ICustomer>("Customer", customerSchema);
