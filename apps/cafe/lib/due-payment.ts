import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import cache from "@/lib/cache";
import { orderSummaryCacheKey } from "@/lib/utils";
import { isDuplicateKeyError } from "@/lib/api-helpers";
import {
  DUES_RECEIPT_MODES,
  type SettlementPayMode,
  type DuesReceiptMode,
} from "@/lib/constants";

// Server core for CR1.4 ("customer dues that tally the drawer") — the shared
// logic BOTH dues-collecting routes call: POST /api/customers/[id]/payments
// (staff) and the settle route (admin, pay-in-full only), which delegates to
// the same core. No auth gate lives here — the two callers guard differently.

// ── resolveDueAmount — PURE, no DB ───────────────────────────────────────────
// Decides how much of a customer's outstanding balance a payment actually
// collects. A non-positive stored balance is a precondition failure
// regardless of what was requested (there is nothing to collect); otherwise
// an omitted `requested` means "pay in full" (CR1.2's omitted-means-full
// rule — a client that asserts a figure the server disagrees with turns a
// full payment into a silent partial + residual due), and a `requested`
// above the balance is refused as a mis-punch, not an overpayment feature.
export function resolveDueAmount(input: {
  balance: number;
  requested?: number;
}): number | { error: string } {
  if (input.balance <= 0) {
    return { error: "This customer has no outstanding dues" };
  }
  if (input.requested === undefined) {
    return input.balance;
  }
  if (input.requested > input.balance) {
    return { error: "Payment exceeds the outstanding balance" };
  }
  return input.requested;
}

// ── duesPaidTotal — Σ all-time DuePayment.amount for a customer, rupees ─────
// The function BOTH §1-hazard re-derivers (reconcile/route.ts,
// customer-rollup.ts's recomputeCustomer) must subtract before they `$set`
// totalDue from an Orders-only fan-out, or every run resurrects money the
// cafe already collected.
export async function duesPaidTotal(customerId: string): Promise<number> {
  await connectDB();
  const [row] = await DuePayment.aggregate<{ _id: null; total: number }>([
    { $match: { customerId } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return row?.total ?? 0;
}

// ── foldDuesCollected — PURE, no DB ──────────────────────────────────────────
// Folds raw { mode, amount } DuePayment rows (a day's / a report range's
// worth) into the drawer-tally shape the summary + reports routes return.
// `byMode` carries every dues-RECEIPT mode (Cash/Online, G7) as an explicit
// 0 — a mode nobody used in the period must still show as a real zero, not
// go missing from the object (the drawer is physical).
export interface DuesCollectedRow {
  mode: SettlementPayMode;
  amount: number;
}

export interface DuesCollectedFold {
  total: number;
  count: number;
  // G7: keyed on DUES_RECEIPT_MODES (Cash/Online only) — the receipt surface
  // that actually represents money arriving, not the wide settlement enum.
  byMode: Record<DuesReceiptMode, number>;
}

export function foldDuesCollected(
  rows: ReadonlyArray<DuesCollectedRow>,
): DuesCollectedFold {
  const byMode = Object.fromEntries(
    DUES_RECEIPT_MODES.map((mode) => [mode, 0]),
  ) as Record<DuesReceiptMode, number>;
  let total = 0;
  for (const row of rows) {
    // `row.mode` is typed as the wide SettlementPayMode because it is read
    // straight off the append-only DuePayment history (models/DuePayment.ts
    // deliberately keeps that enum wide) — a row written before this G7 fix
    // can still carry "Due"/"Split"/"Credit". `total` counts every rupee
    // ever received regardless; `byMode` only buckets the receipt-valid
    // modes, since a legacy mode has nowhere honest to bucket into.
    if ((DUES_RECEIPT_MODES as readonly string[]).includes(row.mode)) {
      byMode[row.mode as DuesReceiptMode] += row.amount;
    }
    total += row.amount;
  }
  return { total, count: rows.length, byMode };
}

// ── replayMismatch — PURE, no DB ─────────────────────────────────────────────
// F4: a clientRef is minted once per dialog-open and is NOT re-minted when the
// operator edits the amount/mode before the retry actually lands. Without this
// guard, an idempotency short-circuit that only echoes IDENTITY (CR1.3
// decision 4) would report false success for a payload that was never
// applied. `input.amount` legitimately omits (the settle route always omits
// it) — only compare when the retry actually asserts a figure.
// G3: a clientRef that exists but belongs to a DIFFERENT customer is a
// foreign row, not a replay of THIS attempt (clientRef is client-minted, not
// customer-scoped) — checked here (not by scoping the lookup query) so a
// foreign ref 409s loudly instead of falling through into a decrement.
function replayMismatch(
  existing: { customerId: string; amount: number; mode: SettlementPayMode },
  input: { customerId: string; amount?: number; mode: SettlementPayMode },
): boolean {
  return (
    existing.customerId !== input.customerId ||
    (input.amount !== undefined && existing.amount !== input.amount) ||
    existing.mode !== input.mode
  );
}

// ── receiveDuePayment — the shared server core ───────────────────────────────
export interface ReceiveDuePaymentInput {
  customerId: string;
  amount?: number; // omitted = pay the full balance (see resolveDueAmount)
  mode: SettlementPayMode;
  note?: string;
  clientRef: string; // idempotency key
  receivedBy: string; // session-stamped display name — never client-supplied
}

export async function receiveDuePayment(input: ReceiveDuePaymentInput) {
  if (!mongoose.isValidObjectId(input.customerId)) {
    return { ok: false as const, status: 404, error: "Customer not found" };
  }

  await connectDB();

  // 1. Load the customer (balance is all resolveDueAmount needs).
  const customer = await Customer.findById(input.customerId)
    .select("totalDue")
    .lean();
  if (!customer) {
    return { ok: false as const, status: 404, error: "Customer not found" };
  }

  // 2. Idempotency short-circuit (CR1.3 decision 4 applied to a new field): a
  // double-tapped till must never collect twice. Return the ORIGINAL payment
  // + a FRESH read of the customer (their balance may have moved since).
  const already = await DuePayment.findOne({ clientRef: input.clientRef }).lean();
  if (already) {
    // F4: the same clientRef replayed with a DIFFERENT amount/mode is NOT the
    // same attempt — reporting success here would tell the cashier a payload
    // was recorded that was never applied (drawer/byMode then disagree with
    // what they believe they collected). Refuse instead of echoing the stale row.
    if (replayMismatch(already, input)) {
      return {
        ok: false as const,
        status: 409,
        error: "A different payment was already recorded for this attempt — reopen and check",
      };
    }
    const current = await Customer.findById(input.customerId).lean();
    if (!current) return { ok: false as const, status: 404, error: "Customer not found" };
    // G4: an omitted amount asserts "pay in full" (the settle route's
    // contract) — a replay is only the SAME successful attempt if the
    // balance is actually cleared; otherwise `already` was some other
    // (e.g. partial) payment sharing this clientRef's identity fields.
    if (input.amount === undefined && current.totalDue !== 0) {
      return {
        ok: false as const,
        status: 409,
        error: "A different payment was already recorded for this attempt — reopen and check",
      };
    }
    return { ok: true as const, customer: current, payment: already };
  }

  // 3. Resolve how much this payment actually collects.
  const resolved = resolveDueAmount({ balance: customer.totalDue, requested: input.amount });
  if (typeof resolved !== "number") {
    return { ok: false as const, status: 400, error: resolved.error };
  }

  // G2: `autoIndex`'s createIndexes() is NOT awaited by connectDB() — a
  // cold-start race (two concurrent same-clientRef inserts before the unique
  // index finishes building) can leave two rows for one clientRef, after
  // which the deferred build 11000s and leaves the index PERMANENTLY absent
  // (no `.on("index")` listener surfaces it), silently voiding the whole
  // idempotency/CAS-loser-recovery contract below. `.init()` is memoized per
  // process; a rejection here propagates and fails this write CLOSED — a
  // broken uniqueness constraint on a money path must error, never degrade.
  await DuePayment.init();

  // 4. CAS decrement — the codebase's own idiom (app/api/orders/[id]/settle/
  // route.ts:148-160). The `$gte` guard is what stops two cashiers each
  // collecting the full balance from driving totalDue negative; an unguarded
  // findByIdAndUpdate (today's settle route, which now delegates here) can't.
  const updated = await Customer.findOneAndUpdate(
    { _id: input.customerId, totalDue: { $gte: resolved } },
    { $inc: { totalDue: -resolved } },
    { new: true },
  ).lean();
  if (!updated) {
    // F9: two simultaneous full-balance calls sharing the SAME clientRef both
    // clear the findOne short-circuit above before either inserts; the
    // winner's $inc drops totalDue below `resolved`, so the loser lands here
    // without ever having re-read clientRef. Re-read now — if the winner has
    // since inserted its row, this is the shipped idempotency contract
    // (due-payment.schema.ts:16-18: a retry returns the ORIGINAL payment
    // instead of a false 409), not a genuine balance race. A loser that
    // re-reads BEFORE the winner's insert lands here empty and still 409s —
    // inherent to that narrow window, and it degrades to the prior behavior.
    const raced = await DuePayment.findOne({ clientRef: input.clientRef }).lean();
    if (raced) {
      if (replayMismatch(raced, input)) {
        return {
          ok: false as const,
          status: 409,
          error: "A different payment was already recorded for this attempt — reopen and check",
        };
      }
      const current = await Customer.findById(input.customerId).lean();
      if (current) {
        // G4: same guard as the step-2 short-circuit above.
        if (input.amount === undefined && current.totalDue !== 0) {
          return {
            ok: false as const,
            status: 409,
            error: "A different payment was already recorded for this attempt — reopen and check",
          };
        }
        return { ok: true as const, customer: current, payment: raced };
      }
    }
    return {
      ok: false as const,
      status: 409,
      error: "This customer's balance changed — reopen and try again",
    };
  }

  // 5. Insert the payment record. If it throws, compensate the decrement —
  // never leave a decrement with no record. A duplicate-key error on
  // clientRef means a concurrent identical retry won the race: compensate
  // (our decrement duplicated the winner's) and return the winner's row as
  // success rather than fail the loser outright.
  //
  // G1/G8: the ack for our OWN insert can be lost (election past the pinned
  // 5s serverSelectionTimeoutMS, a persistent network error) while the write
  // itself committed — compensating blindly on ANY throw would then revert a
  // decrement whose row really exists, and the retry that follows finds the
  // row and reports ok=true against an unchanged balance. `paymentId` is
  // pre-minted so it is the ONE token that proves "MY insert landed" —
  // `clientRef` can't, since a duplicate-key WINNER shares the same ref.
  const paymentId = new mongoose.Types.ObjectId();
  try {
    const payment = await DuePayment.create({
      _id: paymentId,
      customerId: input.customerId,
      amount: resolved,
      mode: input.mode,
      note: input.note,
      receivedBy: input.receivedBy,
      clientRef: input.clientRef,
    });

    // 6. Cache pair after any dues write (settle already does both today).
    cache.del("customers");
    cache.del(orderSummaryCacheKey());
    return { ok: true as const, customer: updated, payment: payment.toObject() };
  } catch (error) {
    const mine = await DuePayment.findById(paymentId).lean();
    if (mine) {
      cache.del("customers");
      cache.del(orderSummaryCacheKey());
      return { ok: true as const, customer: updated, payment: mine };
    }

    await Customer.updateOne({ _id: input.customerId }, { $inc: { totalDue: resolved } });
    if (isDuplicateKeyError(error)) {
      const winner = await DuePayment.findOne({ clientRef: input.clientRef }).lean();
      // G3: the dup-key winner's row can belong to a DIFFERENT customer (a
      // foreign clientRef collision) — our decrement was already reverted
      // above, but adopting a foreign row as success would silently leave
      // this customer's own attempt unrecorded. 409 loudly instead.
      if (winner && winner.customerId !== input.customerId) {
        return {
          ok: false as const,
          status: 409,
          error: "A different payment was already recorded for this attempt — reopen and check",
        };
      }
      const current = await Customer.findById(input.customerId).lean();
      if (winner && current) {
        return { ok: true as const, customer: current, payment: winner };
      }
    }
    return { ok: false as const, status: 500, error: "Failed to record the payment" };
  }
}
