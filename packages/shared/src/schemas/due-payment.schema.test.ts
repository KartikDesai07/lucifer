import { test } from "node:test";
import assert from "node:assert/strict";

import { editDuePaymentSchema, deleteDuePaymentSchema } from "./due-payment.schema";
import {
  DUES_RECEIPT_MODES,
  SETTLEMENT_PAY_MODES,
  ORDER_REASON_MAX_LEN,
  DUE_PAYMENT_DELETE_NOTE_MIN_LEN,
} from "../constants";

// PATCH /api/customers/[id]/payments/[paymentId] (editDuePaymentSchema) and
// DELETE .../[paymentId] (deleteDuePaymentSchema) — the admin edit/soft-delete
// half of CR1.4's dues-receipt contract. due-payment.schema.test.ts did not
// exist before this file; duePaymentSchema (the create path) is already
// pinned in apps/cafe/lib/due-payment.test.ts §5 — deliberately NOT
// duplicated here.

// ── editDuePaymentSchema ─────────────────────────────────────────────────────

test("editDuePaymentSchema: amount is REQUIRED — unlike the create path's optional 'pay in full', an edit always asserts a figure", () => {
  const r = editDuePaymentSchema.safeParse({ mode: "Cash" });
  assert.equal(r.success, false, "omitting amount must fail — there is no 'in full' default for a correction");
});

test("editDuePaymentSchema: amount rejects zero, a negative value, and a fractional value — positive integer only", () => {
  for (const amount of [0, -50, 100.5]) {
    const r = editDuePaymentSchema.safeParse({ amount, mode: "Cash" });
    assert.equal(r.success, false, `amount ${amount} must be rejected`);
  }
});

test("editDuePaymentSchema: amount accepts a positive integer", () => {
  const r = editDuePaymentSchema.safeParse({ amount: 250, mode: "Cash" });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.amount, 250);
});

test("editDuePaymentSchema: mode is restricted to DUES_RECEIPT_MODES and REJECTS the wider settlement modes — a dues receipt records money ARRIVING", () => {
  // The exact modes that mean the OPPOSITE ("nothing collected") on an order,
  // or have no cash/online attribution (Split) — G7's reasoning applied to
  // the edit path. SETTLEMENT_PAY_MODES minus DUES_RECEIPT_MODES is exactly
  // this set; derived, not hardcoded, so a future enum change can't silently
  // stop covering a mode this pin means to reject.
  const receiptSet = new Set<string>(DUES_RECEIPT_MODES);
  const rejectedModes = SETTLEMENT_PAY_MODES.filter((m) => !receiptSet.has(m));
  assert.ok(rejectedModes.length > 0, "sanity: there must be at least one wide mode to reject");

  for (const mode of rejectedModes) {
    const r = editDuePaymentSchema.safeParse({ amount: 100, mode });
    assert.equal(r.success, false, `${mode} must NOT be a valid edit mode`);
  }
  for (const mode of DUES_RECEIPT_MODES) {
    const r = editDuePaymentSchema.safeParse({ amount: 100, mode });
    assert.equal(r.success, true, `${mode} is a valid dues-receipt mode and must parse`);
  }
});

test("editDuePaymentSchema: note is optional, and bounded above by ORDER_REASON_MAX_LEN", () => {
  const withoutNote = editDuePaymentSchema.safeParse({ amount: 100, mode: "Cash" });
  assert.equal(withoutNote.success, true, "note must be optional");

  const atMax = editDuePaymentSchema.safeParse({
    amount: 100,
    mode: "Cash",
    note: "a".repeat(ORDER_REASON_MAX_LEN),
  });
  assert.equal(atMax.success, true, "a note exactly at ORDER_REASON_MAX_LEN must be accepted");

  const overMax = editDuePaymentSchema.safeParse({
    amount: 100,
    mode: "Cash",
    note: "a".repeat(ORDER_REASON_MAX_LEN + 1),
  });
  assert.equal(overMax.success, false, "a note one character over ORDER_REASON_MAX_LEN must be rejected");
});

test("editDuePaymentSchema: .strict() rejects an unknown key — including a client-supplied editedBy", () => {
  const r = editDuePaymentSchema.safeParse({
    amount: 100,
    mode: "Cash",
    editedBy: "Asha", // server-resolved from the session, never client input — see the actor-provenance pin
  });
  assert.equal(r.success, false, ".strict() must reject a client-supplied editedBy/anything else");
});

// ── deleteDuePaymentSchema ───────────────────────────────────────────────────

test("deleteDuePaymentSchema: note is REQUIRED — the whole point of a delete is recording WHY money was un-recorded", () => {
  const r = deleteDuePaymentSchema.safeParse({});
  assert.equal(r.success, false, "omitting note must fail");
});

test(`deleteDuePaymentSchema: note below DUE_PAYMENT_DELETE_NOTE_MIN_LEN (${DUE_PAYMENT_DELETE_NOTE_MIN_LEN}) is rejected`, () => {
  const tooShort = "a".repeat(DUE_PAYMENT_DELETE_NOTE_MIN_LEN - 1);
  const r = deleteDuePaymentSchema.safeParse({ note: tooShort });
  assert.equal(r.success, false, `a ${tooShort.length}-char note must be rejected`);
});

test("deleteDuePaymentSchema: note accepts exactly DUE_PAYMENT_DELETE_NOTE_MIN_LEN characters", () => {
  const atMin = "a".repeat(DUE_PAYMENT_DELETE_NOTE_MIN_LEN);
  const r = deleteDuePaymentSchema.safeParse({ note: atMin });
  assert.equal(r.success, true);
});

// The min-length check runs AFTER trim() (the schema chains .trim().min(...)):
// a note that LOOKS long enough before trimming but is actually all whitespace
// must not satisfy "required". Mutation this catches: reordering to
// .min(...).trim() (Zod would validate length against the UNTRIMMED string,
// letting "   " through whenever its raw length happens to clear the floor).
test("deleteDuePaymentSchema: a whitespace-only note is rejected AFTER trimming — 'required' cannot be satisfied by padding", () => {
  const whitespaceOnly = " ".repeat(DUE_PAYMENT_DELETE_NOTE_MIN_LEN + 5);
  const r = deleteDuePaymentSchema.safeParse({ note: whitespaceOnly });
  assert.equal(
    r.success,
    false,
    `a note of ${whitespaceOnly.length} raw whitespace characters must still fail — trimmed length is 0`,
  );
});

test("deleteDuePaymentSchema: a note with real content padded by leading/trailing whitespace is trimmed then accepted if the trimmed length clears the floor", () => {
  const padded = " " + "a".repeat(DUE_PAYMENT_DELETE_NOTE_MIN_LEN) + " ";
  const r = deleteDuePaymentSchema.safeParse({ note: padded });
  assert.equal(r.success, true, "the trimmed content clears DUE_PAYMENT_DELETE_NOTE_MIN_LEN and must parse");
  if (r.success) assert.equal(r.data.note, "a".repeat(DUE_PAYMENT_DELETE_NOTE_MIN_LEN));
});

test(`deleteDuePaymentSchema: note is bounded above by ORDER_REASON_MAX_LEN`, () => {
  const atMax = deleteDuePaymentSchema.safeParse({ note: "a".repeat(ORDER_REASON_MAX_LEN) });
  assert.equal(atMax.success, true, "a note exactly at ORDER_REASON_MAX_LEN must be accepted");

  const overMax = deleteDuePaymentSchema.safeParse({ note: "a".repeat(ORDER_REASON_MAX_LEN + 1) });
  assert.equal(overMax.success, false, "a note one character over ORDER_REASON_MAX_LEN must be rejected");
});

test("deleteDuePaymentSchema: .strict() rejects an unknown key — including a client-supplied deletedBy", () => {
  const r = deleteDuePaymentSchema.safeParse({
    note: "a".repeat(DUE_PAYMENT_DELETE_NOTE_MIN_LEN),
    deletedBy: "Asha", // server-resolved from the session, never client input
  });
  assert.equal(r.success, false, ".strict() must reject a client-supplied deletedBy/anything else");
});
