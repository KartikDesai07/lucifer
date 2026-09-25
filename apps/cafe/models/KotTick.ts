import mongoose, { Schema, type Document, type Model } from "mongoose";

// P4-A — the kitchen board's tick state, deliberately its OWN collection, not
// a field on Order. Kitchen progress is ephemeral operational state (a cook's
// checkbox), while the Order document is the permanent financial record;
// mixing the two would add a third writer to the Order's most safety-critical
// CAS surface (the /items and /void routes' whole-array `$set`s) for the sake
// of a checkbox, and would bump `updatedAt` on the hottest doc in the app on
// every tick. See .claude/plan/v2/p4a-kot-board-plan.md §1 for the full
// rejection of storing this on Order instead.
//
// `_id` IS the order's hex id (no separate id needed — one tick doc per
// order); `refs` holds the kotLineRef()s a cook has marked done, as a plain
// $addToSet/$pull set. No TTL index (this is operational state, not a
// registry heartbeat — see ttl-guard.ts) and no money field of any kind.
export interface IKotTick extends Document<string> {
  _id: string;
  refs: string[];
  createdAt: Date;
  updatedAt: Date;
}

const kotTickSchema = new Schema<IKotTick>(
  {
    _id: { type: String, required: true },
    refs: { type: [String], default: [] },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations —
// identical idiom to models/Order.ts.
export const KotTick: Model<IKotTick> =
  (mongoose.models.KotTick as Model<IKotTick>) ??
  mongoose.model<IKotTick>("KotTick", kotTickSchema);
