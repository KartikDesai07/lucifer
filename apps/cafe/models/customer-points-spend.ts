import { Schema } from "mongoose";

import type { PointsSpendRecord } from "@pos/shared/reward-points";

// CB-7 S6 (§2.7) — one points spend, embedded in Customer.pointsSpends: which bill took points, when, and exactly which
// lots it took from, so a cancel returns precisely that. Every path of PointsSpendRecord is DECLARED here: Mongoose
// strict mode silently drops an undeclared key, so a field added to the shared type but not to this schema would
// vanish on save. `_id: false` (a record is addressed by its orderId, via $elemMatch), no `default:` (omit-empty:
// `returnedAt` exists only once returned), and NO `expires` (the platform allows one registry TTL index; eviction is
// the bounded $slice at spend).
const pointsSpendLotSchema = new Schema<{ id: string; take: number }>(
  {
    id: { type: String, required: true },
    take: { type: Number, required: true },
  },
  { _id: false },
);

export const pointsSpendSchema = new Schema<PointsSpendRecord>(
  {
    orderId: { type: String, required: true },
    at: { type: Date, required: true },
    lots: { type: [pointsSpendLotSchema], required: true },
    returnedAt: { type: Date },
  },
  { _id: false },
);
