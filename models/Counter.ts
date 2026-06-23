import mongoose, { Schema, type Model } from "mongoose";
import { cafeDateString } from "@/lib/utils";

// Atomic sequence counters. Each document is one named sequence whose `seq` is
// advanced with a single $inc — no read-then-write race, so concurrent order
// creates can never collide on an order number (replaces the old find-max loop).
interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter: Model<ICounter> =
  (mongoose.models.Counter as Model<ICounter>) ??
  mongoose.model<ICounter>("Counter", counterSchema);

// Per-cafe-day key so the daily order sequence (ORD-YYYYMMDD-NNN) resets at the
// IST midnight boundary for free.
function orderCounterKey(date: Date): string {
  return `order-${cafeDateString(date).replace(/-/g, "")}`;
}

// Allocate the next order sequence for the cafe day. One atomic op, no read.
export async function nextOrderSequence(date: Date = new Date()): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: orderCounterKey(date) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return doc?.seq ?? 1;
}

// Recovery path only: raise the day's counter to at least `floor`, then allocate
// the next sequence. Used once if a brand-new counter collides with orders that
// predate it (legacy data / the previous find-max scheme).
export async function bumpOrderSequenceTo(
  floor: number,
  date: Date = new Date(),
): Promise<number> {
  await Counter.findOneAndUpdate(
    { _id: orderCounterKey(date) },
    { $max: { seq: floor } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return nextOrderSequence(date);
}
