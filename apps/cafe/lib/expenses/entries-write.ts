import { connectDB } from "@/lib/db";
import { ACTIVE_EXPENSE, ExpenseEntry, type IExpenseEntry } from "@/models/ExpenseEntry";
import { isDuplicateKeyError } from "@pos/shared/api";
import { EXPENSE_SCHEMA_VERSION } from "@pos/shared/expense";
import type { CreateExpenseInput, UpdateExpenseInput } from "@/schemas";
import type { UpdateQuery } from "mongoose";
import { categoryChoiceError } from "./categories";
import { expenseDateError, type ExpenseRow } from "./entries";

// Write side of the expense ledger (Step EXP). No auth gate lives here — the
// routes own that; every identity field (createdBy / createdById / editedBy)
// arrives from the SESSION, never from the request body.

export const EXPENSE_NOT_FOUND_ERROR = "Expense not found";
export const EXPENSE_DELETED_ERROR = "This expense was deleted";
export const EXPENSE_CHANGED_ERROR = "Someone changed this expense. Check it and try again.";

export type ExpenseWriteResult =
  | { ok: true; row: ExpenseRow; replay?: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface CreateExpenseCommand extends CreateExpenseInput {
  createdBy: string;
  createdById: string;
}

// ── createExpense — idempotent on clientRef (D7) ─────────────────────────────
// A retried or double-tapped Save carries the same clientRef and gets the FIRST
// row back (`replay`), never a second expense. The pre-read covers the common
// retry; the duplicate-key catch covers two requests racing past it.
// A replay is only a replay when it is the SAME account sending the SAME
// expense to a row that still counts: a lost response followed by an edited
// re-send (same sheet, same ref) must not be told "added" while its correction
// is dropped — that answers 409 instead, and so does a ref of a deleted row.
export const EXPENSE_ALREADY_SAVED_ERROR = "This expense was already saved. Close this and check the list.";

function replayOf(first: IExpenseEntryLean, input: CreateExpenseCommand): ExpenseWriteResult {
  const same =
    !first.deletedAt &&
    first.createdById === input.createdById &&
    first.name === input.name &&
    first.categoryId.toString() === input.categoryId &&
    first.date === input.date &&
    first.amountPaise === input.amountPaise &&
    first.paymentMode === input.paymentMode &&
    (first.note ?? "") === (input.note ?? "");
  return same ? { ok: true, row: first, replay: true } : { ok: false, status: 409, error: EXPENSE_ALREADY_SAVED_ERROR };
}

type IExpenseEntryLean = ExpenseRow & Pick<IExpenseEntry, "createdById" | "deletedAt">;

export async function createExpense(input: CreateExpenseCommand): Promise<ExpenseWriteResult> {
  await connectDB();
  // The unique clientRef index is what makes the race below safe: never insert
  // before it is guaranteed to exist (connectDB's autoIndex is not awaited —
  // the lib/due-payment.ts / Area precedent; memoized per process).
  await ExpenseEntry.init();
  const existing = await ExpenseEntry.findOne({ clientRef: input.clientRef }).lean();
  if (existing) return replayOf(existing, input);

  try {
    const doc = await ExpenseEntry.create({
      name: input.name,
      categoryId: input.categoryId,
      date: input.date,
      amountPaise: input.amountPaise,
      paymentMode: input.paymentMode,
      // omit-empty: an empty note is no note.
      ...(input.note ? { note: input.note } : {}),
      createdBy: input.createdBy,
      createdById: input.createdById,
      clientRef: input.clientRef,
      v: EXPENSE_SCHEMA_VERSION,
    });
    return { ok: true, row: doc.toObject() };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const first = await ExpenseEntry.findOne({ clientRef: input.clientRef }).lean();
    if (!first) throw error;
    return replayOf(first, input);
  }
}

// ── updateExpense — admin edit, CAS on updatedAt (D6) ────────────────────────
// `expectedUpdatedAt` is the row as the editor SAW it. The CAS filter re-asserts
// it plus "not deleted", so a concurrent edit or delete makes the write miss
// instead of clobbering; the BEFORE values are snapshotted from the very read
// the CAS is pinned to, so the trail can never record a version nobody saw.
export interface UpdateExpenseCommand {
  id: string;
  input: UpdateExpenseInput;
  editedBy: string;
  now: Date;
}

export async function updateExpense(cmd: UpdateExpenseCommand): Promise<ExpenseWriteResult> {
  const { id, input, editedBy, now } = cmd;
  await connectDB();

  const row = await ExpenseEntry.findById(id).lean();
  if (!row) return { ok: false, status: 404, error: EXPENSE_NOT_FOUND_ERROR };
  if (row.deletedAt) return { ok: false, status: 404, error: EXPENSE_DELETED_ERROR };
  if (row.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
    return { ok: false, status: 409, error: EXPENSE_CHANGED_ERROR };
  }

  // An unchanged date may be older than the window now (it aged since the row
  // was added) — only a CHANGED date or category is re-validated.
  const dateChanged = input.date !== undefined && input.date !== row.date;
  if (dateChanged && input.date !== undefined) {
    const dateError = expenseDateError(input.date, now);
    if (dateError) return { ok: false, status: 400, error: dateError };
  }
  const categoryChanged = input.categoryId !== undefined && input.categoryId !== row.categoryId.toString();
  if (categoryChanged && input.categoryId !== undefined) {
    const categoryError = await categoryChoiceError(input.categoryId);
    if (categoryError) return { ok: false, status: 400, error: categoryError };
  }

  // Three note intents: absent = leave, "" = remove ($unset, never an empty
  // string — omit-empty), text = replace.
  const clearNote = input.note === "" && row.note !== undefined;
  const set: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== row.name) set.name = input.name;
  if (categoryChanged) set.categoryId = input.categoryId;
  if (dateChanged) set.date = input.date;
  if (input.amountPaise !== undefined && input.amountPaise !== row.amountPaise) set.amountPaise = input.amountPaise;
  if (input.paymentMode !== undefined && input.paymentMode !== row.paymentMode) set.paymentMode = input.paymentMode;
  if (input.note !== undefined && input.note !== "" && input.note !== row.note) set.note = input.note;

  // A save that changes nothing must not push a trail entry (it would read as
  // evidence that something happened).
  if (Object.keys(set).length === 0 && !clearNote) return { ok: true, row };

  const update: UpdateQuery<IExpenseEntry> = {
    $push: {
      edits: {
        at: now,
        by: editedBy,
        name: row.name,
        categoryId: row.categoryId,
        date: row.date,
        amountPaise: row.amountPaise,
        paymentMode: row.paymentMode,
        ...(row.note !== undefined ? { note: row.note } : {}),
      },
    },
  };
  if (Object.keys(set).length > 0) update.$set = set;
  if (clearNote) update.$unset = { note: "" };

  const updated = await ExpenseEntry.findOneAndUpdate(
    { _id: id, updatedAt: row.updatedAt, ...ACTIVE_EXPENSE },
    update,
    { new: true, runValidators: true },
  ).lean();
  if (updated) return { ok: true, row: updated };

  // CAS miss: gone / deleted since the read → 404, otherwise someone edited it.
  const current = await ExpenseEntry.findById(id).select("deletedAt").lean();
  if (!current || current.deletedAt) return { ok: false, status: 404, error: EXPENSE_DELETED_ERROR };
  return { ok: false, status: 409, error: EXPENSE_CHANGED_ERROR };
}

// ── softDeleteExpense — never removes the row (D6) ───────────────────────────
// CAS on `deletedAt` absent, so a double-tap (or a delete racing an edit)
// misses; an already-deleted or unknown row is a 404.
export async function softDeleteExpense(
  id: string,
  deletedBy: string,
  now: Date,
): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  await connectDB();
  const deleted = await ExpenseEntry.findOneAndUpdate(
    { _id: id, ...ACTIVE_EXPENSE },
    { $set: { deletedAt: now, deletedBy } },
    { new: true },
  )
    .select("_id")
    .lean();
  if (!deleted) return { ok: false, status: 404, error: EXPENSE_NOT_FOUND_ERROR };
  return { ok: true };
}
