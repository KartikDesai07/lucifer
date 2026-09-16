import { z } from "zod";
import {
  DUES_RECEIPT_MODES,
  ORDER_REASON_MAX_LEN,
  DUE_PAYMENT_DELETE_NOTE_MIN_LEN,
} from "../constants";

// POST /api/customers/[id]/payments (+ settle, which delegates to the same
// core) — the cashier records money actually taken against a customer's
// outstanding balance. CR1.4.
export const duePaymentSchema = z
  .object({
    // OMITTED = "pay the customer's FULL outstanding balance, as the SERVER
    // knows it". This is CR1.2 decision 1 verbatim (lib/order.ts derivePayment):
    // a client that asserts a money figure the server disagrees with turns a
    // FULL payment into a silent partial + residual due. MUST stay .optional().
    amount: z.number().int().positive().optional(),
    // G7: a due is RECEIVED only as Cash/Online — Due/Credit mean "nothing
    // collected" on an order, and Split has no cash/online fields on this
    // path (see DUES_RECEIPT_MODES for the full reasoning).
    mode: z.enum(DUES_RECEIPT_MODES), // Cash|Online
    note: z.string().trim().max(ORDER_REASON_MAX_LEN).optional(),
    // Client-anchored idempotency (CR1.3 decision 4: echo IDENTITY, not money).
    // A retried POST with the same ref returns the ORIGINAL payment instead of
    // collecting twice.
    clientRef: z.string().uuid(),
  })
  .strict();

export type DuePaymentInput = z.infer<typeof duePaymentSchema>;

// PATCH /api/customers/[id]/payments/[paymentId] — admin: correct a mis-keyed
// dues receipt (wrong amount/mode/typo'd note). `amount` is REQUIRED here —
// unlike the create path's optional "pay in full" — an edit always asserts a
// figure; there is no natural "in full" default for a correction. Narrowed to
// DUES_RECEIPT_MODES like the create schema, never the wide stored enum.
export const editDuePaymentSchema = z
  .object({
    amount: z.number().int().positive(),
    mode: z.enum(DUES_RECEIPT_MODES),
    note: z.string().trim().max(ORDER_REASON_MAX_LEN).optional(),
  })
  .strict();

// DELETE /api/customers/[id]/payments/[paymentId] — admin: soft-delete a
// wrongly-recorded receipt. `note` is REQUIRED (unlike the edit path's
// optional one) — the whole point of a delete is recording WHY money was
// un-recorded.
export const deleteDuePaymentSchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(
        DUE_PAYMENT_DELETE_NOTE_MIN_LEN,
        `Give a reason (at least ${DUE_PAYMENT_DELETE_NOTE_MIN_LEN} characters)`,
      )
      .max(ORDER_REASON_MAX_LEN, `Keep the reason under ${ORDER_REASON_MAX_LEN} characters`),
  })
  .strict();

export type EditDuePaymentInput = z.infer<typeof editDuePaymentSchema>;
export type DeleteDuePaymentInput = z.infer<typeof deleteDuePaymentSchema>;
