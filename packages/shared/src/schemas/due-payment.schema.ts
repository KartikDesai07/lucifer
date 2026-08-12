import { z } from "zod";
import { DUES_RECEIPT_MODES, ORDER_REASON_MAX_LEN } from "../constants";

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
