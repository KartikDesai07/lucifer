import mongoose, { Schema, type Connection, type Model } from "mongoose";
import { cafeDateString } from "@/lib/utils";

// Atomic sequence counters. Each document is one named sequence whose `seq` is
// advanced with a single $inc — no read-then-write race, so concurrent order
// creates can never collide on an order number (replaces the old find-max loop).
interface ICounter {
  _id: string;
  seq: number;
}

// Exported as a SCHEMA (not only the default-bound model) so the F2 ClusterRouter
// can bind a per-LEDGER Counter via `conn.model('Counter', counterSchema)` —
// schemas-not-models (build-rule #21). The default-bound `Counter` export below
// stays for the still-live v1 routes until P2's cutover.
export const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter: Model<ICounter> =
  (mongoose.models.Counter as Model<ICounter>) ??
  mongoose.model<ICounter>("Counter", counterSchema);

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.3 — connection-aware sequencing. The federation co-locates the
// Counter with the orders it numbers on the ACTIVE ledger (F2 §2.4/§3.3, #4): a
// fresh ledger starts its day-counter cleanly, with NO cross-cluster coordination,
// preserving v1's atomic `findOneAndUpdate($inc)` per cluster. So both allocators
// now take the routed ledger CONNECTION; when none is given they fall back to v1's
// default-bound `Counter`, keeping the still-live v1 order route green until its
// federation cutover (P2 #44/#45 — the route cutover + rupee→paise rewrite).
// ─────────────────────────────────────────────────────────────────────────────

// Resolve the Counter model for a routed LEDGER connection (schemas-not-models,
// #21 — `conn.model(name, schema)`, idempotent per connection), or fall back to
// the v1 default-bound `Counter` when no connection is supplied. Exported for the
// DB-free unit test (selection logic).
export function counterModelFor(conn?: Connection | null): Model<ICounter> {
  if (!conn) return Counter;
  return (
    (conn.models.Counter as Model<ICounter> | undefined) ??
    conn.model<ICounter>("Counter", counterSchema)
  );
}

// Test seam — swap the counter-model resolver so the atomic-op shape, the IST
// cafe-day key, the seq fallback, and the connection pass-through are provable
// DB-free; the live $inc concurrency race is asserted against a seeded M0 in F2's
// integration pass. Never called by application code.
let resolveCounter: (conn?: Connection | null) => Model<ICounter> = counterModelFor;
export function __setCounterModelResolverForTests(
  fn: ((conn?: Connection | null) => Model<ICounter>) | null,
): void {
  resolveCounter = fn ?? counterModelFor;
}

// Per-cafe-day key so the daily order sequence (ORD-<tag>-YYYYMMDD-NNN) resets at
// the IST midnight boundary for free.
function orderCounterKey(date: Date): string {
  return `order-${cafeDateString(date).replace(/-/g, "")}`;
}

// Allocate the next order sequence for the cafe day on the given ledger connection
// (or the v1 default Counter when `conn` is omitted). One atomic op, no read.
export async function nextOrderSequence(
  conn?: Connection | null,
  date: Date = new Date(),
): Promise<number> {
  const doc = await resolveCounter(conn)
    .findOneAndUpdate(
      { _id: orderCounterKey(date) },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    .lean();
  return doc?.seq ?? 1;
}

// Recovery path only: raise the day's counter to at least `floor`, then allocate
// the next sequence. Used once if a brand-new counter collides with orders that
// predate it (legacy data / the previous find-max scheme).
//
// Two call forms — the canonical federated `(ledgerConn, floor, date?)` (F2.3+) and
// the legacy v1 `(floor, date?)` which routes to the default-bound Counter. The
// first argument disambiguates (a number is the floor → v1; anything else is the
// ledger connection), so v1's `bumpOrderSequenceTo(seq)` call site stays untouched.
export async function bumpOrderSequenceTo(floor: number, date?: Date): Promise<number>;
export async function bumpOrderSequenceTo(
  conn: Connection | null,
  floor: number,
  date?: Date,
): Promise<number>;
export async function bumpOrderSequenceTo(
  connOrFloor: Connection | null | number,
  floorOrDate?: number | Date,
  maybeDate?: Date,
): Promise<number> {
  const conn: Connection | null =
    typeof connOrFloor === "number" ? null : connOrFloor;
  const floor: number =
    typeof connOrFloor === "number" ? connOrFloor : (floorOrDate as number);
  const date: Date =
    typeof connOrFloor === "number"
      ? ((floorOrDate as Date | undefined) ?? new Date())
      : (maybeDate ?? new Date());
  await resolveCounter(conn).findOneAndUpdate(
    { _id: orderCounterKey(date) },
    { $max: { seq: floor } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return nextOrderSequence(conn, date);
}
