import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import cache from "@/lib/cache";
import { orderSummaryCacheKey } from "@/lib/utils";
import { DUE_PAYMENT_HISTORY_LIMIT, type SettlementPayMode } from "@/lib/constants";
import { ACTIVE_DUE_PAYMENT, canonicalCustomerId } from "./due-payment";

// Split from `lib/due-payment.ts` (see the re-export block at its end) purely
// for the ~300-line file cap — this is the SAME core, just the admin
// history/edit/soft-delete half of it. No auth gate lives here either; the
// routes under app/api/customers/[id]/payments/ own every guard.
//
// THE GOVERNING PRINCIPLE (repeat it here — it is the reason every function
// below orders its writes the way it does): DuePayment rows are the SOURCE OF
// TRUTH; Customer.totalDue is a derived cache the recompute authority rebuilds
// from them. Every operation here writes the PAYMENT ROW FIRST and adjusts
// totalDue SECOND. If the second step fails, reconcile/recompute re-derives a
// balance that agrees with the row — failure heals in the SAFE direction.
// Reversing that order would leave a balance that reconcile silently undoes.

// ── listDuePayments — newest-first history, INCLUDING soft-deleted rows ─────
// The UI shows deleted rows struck through rather than hiding them — an admin
// reviewing a customer's history needs to see that a payment existed and was
// later reversed, not just a gap where it used to be.
export async function listDuePayments(customerId: string) {
  await connectDB();
  return DuePayment.find({ customerId: customerIdFilter(customerId) })
    .sort({ createdAt: -1 })
    .limit(DUE_PAYMENT_HISTORY_LIMIT)
    .lean();
}

// `customerId` is a stored STRING, and ObjectId hex is case-insensitive, so the
// same customer can be spelled two ways in a URL. Match BOTH the raw segment
// and the canonical form: new rows are written canonically (see
// canonicalCustomerId), but a row filed under a non-canonical spelling before
// that must still surface here rather than becoming an invisible receipt.
function customerIdFilter(customerId: string): { $in: string[] } {
  return { $in: [customerId, canonicalCustomerId(customerId)] };
}

export interface EditDuePaymentInput {
  customerId: string;
  paymentId: string;
  amount: number;
  mode: SettlementPayMode;
  note?: string;
  editedBy: string; // session-stamped display name — never client-supplied
}

// ── editDuePayment — correct a mis-keyed dues receipt ────────────────────────
export async function editDuePayment(input: EditDuePaymentInput) {
  if (
    !mongoose.isValidObjectId(input.customerId) ||
    !mongoose.isValidObjectId(input.paymentId)
  ) {
    return { ok: false as const, status: 404, error: "Payment not found" };
  }

  await connectDB();

  // 1. Load the row scoped to this customer — a paymentId that exists but
  // belongs to a DIFFERENT customer must read as "not found", not leak
  // cross-customer existence. Read unfiltered on deletedAt so a deleted row
  // is distinguishable (409) from no row at all (404), rather than both
  // collapsing into the same 404.
  const customerIdMatch = customerIdFilter(input.customerId);
  const row = await DuePayment.findOne({
    _id: input.paymentId,
    customerId: customerIdMatch,
  }).lean();
  if (!row) return { ok: false as const, status: 404, error: "Payment not found" };
  if (row.deletedAt) {
    return {
      ok: false as const,
      status: 409,
      error: "This payment was deleted and cannot be edited",
    };
  }

  // 2. Load the customer — needed both for the guard below and because the
  // response contract hands the caller a fresh customer, never a stale one.
  const customer = await Customer.findById(input.customerId).lean();
  if (!customer) return { ok: false as const, status: 404, error: "Customer not found" };

  // 3. Guard: `amount` must not exceed what this customer ever owed for this
  // row. `row.amount` is already "spent" out of totalDue (it was collected
  // once already), so adding it back to the CURRENT totalDue is the correct
  // ceiling — exceeding it would record the customer as having paid more than
  // they ever owed, and the recompute authority's `Math.max(0, …)` clamp
  // (customer-recompute.ts) would silently swallow the overshoot instead of
  // surfacing it.
  if (input.amount > row.amount + customer.totalDue) {
    return { ok: false as const, status: 400, error: "Amount exceeds what this customer owed" };
  }

  // 4. Resolve the note first. Three distinct intents, and conflating them is
  // how a "cleared" note silently survives: OMITTED means leave it alone, ""
  // means clear it (stored as an $unset, never an empty string — omit-empty),
  // anything else replaces it.
  const clearNote = input.note === "";
  const nextNote = input.note === undefined ? row.note : clearNote ? undefined : input.note;

  // A save that changes nothing must not push a trail entry — otherwise
  // opening the dialog and tapping Save permanently marks the row "Edited"
  // with a before-value identical to its after-value, which is worse than no
  // trail at all because it reads as evidence that something happened.
  if (input.amount === row.amount && input.mode === row.mode && nextNote === row.note) {
    return { ok: true as const, payment: row, customer };
  }

  // 5. CAS the ROW first. The filter re-asserts every value this edit is ABOUT
  // to change plus deletedAt — a concurrent edit or delete landing between our
  // read and this write makes the match fail instead of silently clobbering it.
  const setFields: Record<string, unknown> = { amount: input.amount, mode: input.mode };
  if (input.note !== undefined && !clearNote) setFields.note = input.note;
  const rowUpdate: Record<string, unknown> = {
    $set: setFields,
    // The OLD values, snapshotted before this edit — see IDuePaymentEdit.
    // `note` is carried too: without it an admin could rewrite or blank the
    // only record of HOW the money arrived, and the trail entry would show an
    // unchanged amount/mode, i.e. no evidence anything was touched.
    $push: {
      edits: {
        at: new Date(),
        by: input.editedBy,
        amount: row.amount,
        mode: row.mode,
        ...(row.note !== undefined ? { note: row.note } : {}),
      },
    },
  };
  if (clearNote) rowUpdate.$unset = { note: "" };

  const updated = await DuePayment.findOneAndUpdate(
    {
      _id: input.paymentId,
      customerId: customerIdMatch,
      ...ACTIVE_DUE_PAYMENT,
      amount: row.amount,
      mode: row.mode,
    },
    rowUpdate,
    { new: true },
  ).lean();
  if (!updated) {
    return { ok: false as const, status: 409, error: "This payment changed — reopen and check" };
  }

  // 6. Adjust the derived balance.
  //
  // The step-3 ceiling was computed from a customer read that a CONCURRENT
  // dues collection can invalidate before this write lands. When the edit
  // RAISES the collected amount, totalDue has to fall — so re-assert the
  // headroom here in the filter, the same CAS idiom receiveDuePayment uses for
  // its own decrement. Without it: balance 100, row 50, admin edits it to 150
  // while a cashier collects the remaining 100 — the $inc lands on a balance of
  // 0 and drives totalDue to -100, which the recompute authority's Math.max(0,…)
  // clamp would later hide rather than surface.
  const drop = input.amount - row.amount; // > 0 ⇒ totalDue must fall by this
  const customerFilter =
    drop > 0
      ? { _id: input.customerId, totalDue: { $gte: drop } }
      : { _id: input.customerId };

  let updatedCustomer;
  try {
    updatedCustomer = await Customer.findOneAndUpdate(
      customerFilter,
      { $inc: { totalDue: -drop } },
      { new: true },
    ).lean();
  } catch (_error) {
    // Deliberately NO revert. A throw does not tell us whether the $inc
    // committed — the driver can lose the ack for a write that landed, which is
    // the exact hazard receiveDuePayment pre-mints an _id to detect. Reverting a
    // committed adjustment would leave the row and the balance disagreeing, and
    // the admin's natural retry would then apply the same correction twice. The
    // row is the source of truth and it is already right, so leave it and say
    // plainly that the derived balance may need rebuilding.
    return {
      ok: false as const,
      status: 500,
      error:
        "The payment was updated but this customer's balance may not be — run Reconcile on this customer",
    };
  }
  if (!updatedCustomer) {
    // A no-match is DEFINITE (unlike a throw): the balance write did not
    // happen, so undoing the row is safe — but only under a CAS asserting the
    // row still holds exactly what we just wrote, or a concurrent edit would be
    // rolled back to a value it never had. Distinguish a vanished customer from
    // the guard refusing an edit that no longer fits the balance.
    await revertEdit(input.paymentId, row, input);
    const stillThere = await Customer.exists({ _id: input.customerId });
    return stillThere
      ? {
          ok: false as const,
          status: 409,
          error: "This customer's balance changed — reopen and try again",
        }
      : { ok: false as const, status: 404, error: "Customer not found" };
  }

  cache.del("customers");
  cache.del(orderSummaryCacheKey());
  // See the same pair in softDeleteDuePayment: a receipt edited on a LATER day
  // still belongs to its original day's tally, whose summary is cached under
  // its own key.
  cache.del(orderSummaryCacheKey(updated.createdAt));
  return { ok: true as const, payment: updated, customer: updatedCustomer };
}

// Undoes an edit whose balance write DEFINITELY did not happen.
//
// Every part of this is CAS-guarded on `applied` — the values this call itself
// wrote. If another admin has since moved the row on, nothing matches and their
// edit is left standing: rolling the row back to a value it never held would
// destroy their change AND `$pop` their trail entry, leaving a row whose
// recorded history disagrees with the balance everyone derives from it.
async function revertEdit(
  paymentId: string,
  previous: { amount: number; mode: SettlementPayMode; note?: string; edits?: unknown[] },
  applied: { amount: number; mode: SettlementPayMode },
): Promise<void> {
  const set: Record<string, unknown> = { amount: previous.amount, mode: previous.mode };
  const unset: Record<string, unknown> = {};
  if (previous.note !== undefined) set.note = previous.note;
  else unset.note = "";

  const update: Record<string, unknown> = { $set: set };
  // Our $push was the last entry, and the filter below proves no later edit
  // landed. If the row had no trail before, drop the array outright — `$pop`
  // would leave `edits: []`, the present-but-empty shape the model's
  // omit-empty discipline exists to prevent (and which defeats a
  // `{ $exists: false }` style read of "was this ever edited").
  if ((previous.edits?.length ?? 0) === 0) unset.edits = "";
  else update.$pop = { edits: 1 };
  update.$unset = unset;

  await DuePayment.updateOne(
    { _id: paymentId, amount: applied.amount, mode: applied.mode },
    update,
  );
}

export interface SoftDeleteDuePaymentInput {
  customerId: string;
  paymentId: string;
  note: string;
  deletedBy: string; // session-stamped display name — never client-supplied
}

// ── softDeleteDuePayment — mark a wrongly-recorded receipt as reversed ──────
export async function softDeleteDuePayment(input: SoftDeleteDuePaymentInput) {
  if (
    !mongoose.isValidObjectId(input.customerId) ||
    !mongoose.isValidObjectId(input.paymentId)
  ) {
    return { ok: false as const, status: 404, error: "Payment not found" };
  }

  await connectDB();

  // 1. CAS the row first — filter on not-yet-deleted, so a double-tap CAS-
  // misses on the second call instead of restoring the balance twice.
  const updated = await DuePayment.findOneAndUpdate(
    { _id: input.paymentId, customerId: customerIdFilter(input.customerId), ...ACTIVE_DUE_PAYMENT },
    { $set: { deletedAt: new Date(), deletedBy: input.deletedBy, deleteNote: input.note } },
    { new: true },
  ).lean();

  if (!updated) {
    // A null result is either "no such row" or "already deleted" — a
    // follow-up read distinguishes them, so a double-tap reads as the loud
    // 409 it is rather than a misleading 404.
    const existing = await DuePayment.findOne({
      _id: input.paymentId,
      customerId: customerIdFilter(input.customerId),
    }).lean();
    if (!existing) return { ok: false as const, status: 404, error: "Payment not found" };
    return { ok: false as const, status: 409, error: "This payment is already deleted" };
  }

  // 2. Restore the due. Only ever INCREASES totalDue, so no `$gte` guard is
  // needed (unlike receiveDuePayment's decrement).
  let customer;
  try {
    customer = await Customer.findOneAndUpdate(
      { _id: input.customerId },
      { $inc: { totalDue: updated.amount } },
      { new: true },
    ).lean();
  } catch (_error) {
    // Deliberately NO un-delete (same reasoning as editDuePayment): a throw
    // does not say whether the $inc committed. Un-deleting would ALSO destroy
    // the reason the admin just typed, and their natural retry would then
    // restore the amount a SECOND time — over-billing the customer by the full
    // payment while the row shows one clean delete. Leave the row deleted (it
    // is the truth) and name the follow-up.
    return {
      ok: false as const,
      status: 500,
      error:
        "The payment was deleted but this customer's balance may not be — run Reconcile on this customer",
    };
  }
  if (!customer) {
    // Definite non-write, so undo is safe — CAS-guarded on the delete stamp we
    // just wrote so a concurrent change is never clobbered.
    await revertDelete(input.paymentId, input.deletedBy);
    return { ok: false as const, status: 404, error: "Customer not found" };
  }

  cache.del("customers");
  cache.del(orderSummaryCacheKey());
  // Editing or deleting a receipt from an EARLIER day moves that day's dues
  // tally too, and its summary is cached under its own key — clearing only
  // today's would let a past-day EOD slip keep serving the pre-change figure.
  cache.del(orderSummaryCacheKey(updated.createdAt));
  return { ok: true as const, payment: updated, customer };
}

async function revertDelete(paymentId: string, deletedBy: string): Promise<void> {
  await DuePayment.updateOne(
    { _id: paymentId, deletedBy },
    { $unset: { deletedAt: "", deletedBy: "", deleteNote: "" } },
  );
}
