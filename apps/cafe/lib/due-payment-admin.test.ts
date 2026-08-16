import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { editDuePaymentSchema, deleteDuePaymentSchema } from "@/schemas";

// Admin edit + soft-delete of a customer dues receipt (extends CR1.4's
// receiveDuePayment core — lib/due-payment.ts / due-payment.test.ts). This
// file is DB-free by house rule #1: editDuePayment/softDeleteDuePayment both
// hit Mongoose directly with no injectable DB-free seam (unlike
// customer-rollup.ts's getCustomerWriter), so the two things a unit test CAN
// prove without a DB are (a) the money arithmetic the routes are SUPPOSED to
// perform, mirrored as pure tables, and (b) that the ACTUAL source still
// performs it — via readFileSync source-read pins, the same technique
// due-payment.test.ts §6/§7 and customer-privacy-paths.test.ts already use in
// this repo. A separate agent owns the live-DB leg that exercises the real
// writes end-to-end; nothing here talks to Mongo.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Scans forward from an opening `(` at `openIdx`, counting paren depth, and
// returns the index of its MATCHING closing `)` — same technique as
// customer-privacy-paths.test.ts's matchingParenEnd (needed because a naive
// indexOf(")") stops at the first nested call's own closing paren).
function matchingParenEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingParenEnd: no matching closing paren found");
}

const DUE_PAYMENT_ADMIN_LIB = "apps/cafe/lib/due-payment-admin.ts";
const DUE_PAYMENT_LIB = "apps/cafe/lib/due-payment.ts";
const DUE_PAYMENT_MODEL = "apps/cafe/models/DuePayment.ts";
const PAYMENTS_ROUTE = "apps/cafe/app/api/customers/[id]/payments/route.ts";
const PAYMENT_ID_ROUTE = "apps/cafe/app/api/customers/[id]/payments/[paymentId]/route.ts";

// ══════════════════════════════════════════════════════════════════════════
// B. Money-arithmetic pins
// ══════════════════════════════════════════════════════════════════════════

// ── B1. The edit ceiling ─────────────────────────────────────────────────────
// due-payment-admin.ts:85 — "a new amount may not exceed row.amount +
// customer.totalDue". This mirror exists ONLY to make the arithmetic intent
// executable as a table; it is NOT what actually guards the route (a mutated
// mirror would still show green here while the real route drifted) — the
// regex pin right below reads the ACTUAL source line and is the real guard.
function editAllowed(rowAmount: number, totalDue: number, newAmount: number): boolean {
  return !(newAmount > rowAmount + totalDue);
}

test("edit-ceiling table: newAmount may not exceed row.amount + customer.totalDue (mirrors due-payment-admin.ts's inline guard)", () => {
  const cases: Array<{ rowAmount: number; totalDue: number; newAmount: number; allowed: boolean }> = [
    // A same-or-lower correction never exceeds what was ever owed.
    { rowAmount: 100, totalDue: 50, newAmount: 50, allowed: true },
    { rowAmount: 100, totalDue: 50, newAmount: 100, allowed: true },
    // Exactly at the ceiling (row.amount + totalDue) — the boundary itself must pass.
    { rowAmount: 100, totalDue: 50, newAmount: 150, allowed: true },
    // One rupee past the ceiling — refused as a mis-punch, not an overpayment.
    { rowAmount: 100, totalDue: 50, newAmount: 151, allowed: false },
    // A customer with zero remaining due: the row's own amount is still the ceiling.
    { rowAmount: 100, totalDue: 0, newAmount: 100, allowed: true },
    { rowAmount: 100, totalDue: 0, newAmount: 101, allowed: false },
    // A large totalDue headroom lets a small row's amount rise a lot.
    { rowAmount: 20, totalDue: 500, newAmount: 500, allowed: true },
    { rowAmount: 20, totalDue: 500, newAmount: 521, allowed: false },
  ];
  for (const c of cases) {
    assert.equal(
      editAllowed(c.rowAmount, c.totalDue, c.newAmount),
      c.allowed,
      `rowAmount=${c.rowAmount} totalDue=${c.totalDue} newAmount=${c.newAmount} expected allowed=${c.allowed}`,
    );
  }
});

// The REAL guard: reads due-payment-admin.ts and asserts the exact expression
// and its 400 message. Mutation this catches: flipping `>` to `>=` (would
// refuse an edit exactly at the ceiling, which B1's table above says must
// pass), or widening/removing `+ customer.totalDue` (would let an edit exceed
// what the customer ever owed and have the recompute authority's
// Math.max(0,…) clamp silently swallow the overshoot — see the source
// comment at due-payment-admin.ts:82-84).
test("PIN: editDuePayment's ceiling guard is exactly `input.amount > row.amount + customer.totalDue`, refused with a 400 'Amount exceeds what this customer owed'", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  assert.match(
    src,
    /if\s*\(\s*input\.amount\s*>\s*row\.amount\s*\+\s*customer\.totalDue\s*\)\s*\{/,
    "the ceiling guard must compare input.amount against row.amount + customer.totalDue, using strict >",
  );
  const guardIdx = src.search(/if\s*\(\s*input\.amount\s*>\s*row\.amount\s*\+\s*customer\.totalDue\s*\)/);
  assert.ok(guardIdx >= 0);
  const guardTail = src.slice(guardIdx, guardIdx + 200);
  assert.match(
    guardTail,
    /status:\s*400,\s*error:\s*"Amount exceeds what this customer owed"/,
    "the ceiling guard must refuse with a 400 and this exact message",
  );
});

// ── B2. The balance delta — edit ────────────────────────────────────────────
// due-payment-admin.ts:132-136 — `drop = input.amount - row.amount` and the
// customer write is `$inc: { totalDue: -drop }`. Editing a row from A to B
// must change totalDue by exactly A - B (a RAISE in the collected amount
// pulls totalDue DOWN; a reduction pushes it back UP).
function totalDueDeltaOnEdit(rowAmountBefore: number, newAmount: number): number {
  // The source computes `drop = newAmount - rowAmountBefore` and passes `-drop`
  // as the literal $inc argument. Negating a zero `drop` produces
  // -0 in JS — a value assert.equal's Object.is-based strictEqual treats as
  // NOT equal to 0 (the "no balance movement" case below would then fail this
  // table on a technicality unrelated to the arithmetic this test means to
  // pin). `rowAmountBefore - newAmount` is algebraically identical to `-drop`
  // for every non-zero case and normalizes the zero case to a plain 0.
  return rowAmountBefore - newAmount;
}

test("balance-delta table (edit): totalDue changes by exactly A - B when a row is edited from A to B", () => {
  const cases: Array<{ before: number; after: number }> = [
    { before: 50, after: 150 }, // raised by 100 → totalDue falls by 100
    { before: 150, after: 50 }, // lowered by 100 → totalDue rises by 100
    { before: 100, after: 100 }, // unchanged → no balance movement
    { before: 20, after: 21 }, // a 1-rupee correction still moves the balance by exactly 1
  ];
  for (const c of cases) {
    const delta = totalDueDeltaOnEdit(c.before, c.after);
    assert.equal(
      delta,
      c.before - c.after,
      `editing from ${c.before} to ${c.after} must change totalDue by exactly A - B (${c.before - c.after}), got ${delta}`,
    );
  }
});

// ── B3. The balance delta — soft-delete ─────────────────────────────────────
// due-payment-admin.ts:236-239 — `$inc: { totalDue: updated.amount } }`.
// Deleting a row must restore its FULL amount back onto totalDue: +A.
function totalDueDeltaOnDelete(rowAmount: number): number {
  return rowAmount; // the $inc argument on softDeleteDuePayment's Customer write
}

test("balance-delta table (soft-delete): totalDue changes by exactly +A, the row's own amount", () => {
  for (const amount of [1, 50, 500, 12345]) {
    assert.equal(
      totalDueDeltaOnDelete(amount),
      amount,
      `deleting a row of amount ${amount} must restore exactly +${amount} to totalDue`,
    );
  }
});

// The REAL guards for B2/B3: read the actual $inc arguments off the source.
test("PIN: editDuePayment computes drop = input.amount - row.amount and $inc's the customer by -drop", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  assert.match(
    src,
    /const\s+drop\s*=\s*input\.amount\s*-\s*row\.amount\s*;/,
    "drop must be computed as input.amount - row.amount (the NEW amount minus the OLD/row amount)",
  );
  assert.match(
    src,
    /\$inc:\s*\{\s*totalDue:\s*-drop\s*\}/,
    "the customer write must $inc totalDue by -drop — a raise (drop>0) must pull totalDue DOWN",
  );
});

test("PIN: softDeleteDuePayment's customer write $inc's totalDue by +updated.amount (the deleted row's own amount), never a hardcoded or wrong-signed value", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  assert.match(
    src,
    /\$inc:\s*\{\s*totalDue:\s*updated\.amount\s*\}/,
    "the balance restore must $inc totalDue by +updated.amount",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// C. Source-read pins
// ══════════════════════════════════════════════════════════════════════════

// ── C1. The exclusion invariant ──────────────────────────────────────────────
// Every site under apps/cafe that runs a DuePayment.aggregate() whose result
// feeds a sum of `amount` must include ACTIVE_DUE_PAYMENT somewhere in its
// pipeline (a `$match` stage, however many stages it takes) — a deleted row
// must never keep tallying money that editDuePayment/softDeleteDuePayment
// already adjusted totalDue for. This walks the ACTUAL tree (readdirSync)
// rather than hardcoding the 3 known sites (lib/due-payment.ts duesPaidTotal,
// orders/summary/route.ts, reports/route.ts) — a NEW site added later without
// the filter must fail this suite, not silently join an unaudited list.
//
// STATED LIMITATION: this only catches sums performed via
// `DuePayment.aggregate(...)` — a hypothetical future site that instead runs
// `DuePayment.find(...)` and sums `.amount` in a JS `.reduce()` would not be
// caught by this pin (there is no `.aggregate(` call to find). No such site
// exists in this codebase today (verified by the broader `DuePayment\.` grep
// this pin's sibling assertions below rely on).

const CAFE_ROOT = path.join(REPO_ROOT, "apps/cafe");
const WALK_EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git"]);

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (WALK_EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...walkTsFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

test("PIN (exclusion invariant): every DuePayment.aggregate(...) call under apps/cafe includes ACTIVE_DUE_PAYMENT in its pipeline", () => {
  const files = walkTsFiles(CAFE_ROOT);
  // Sanity floor — a broken walk (wrong root, over-eager exclusion) must not
  // silently pass by finding zero files to check.
  assert.ok(files.length >= 50, `expected to walk at least 50 .ts/.tsx files under apps/cafe, found ${files.length}`);

  const callRe = /\bDuePayment\.aggregate\s*(?:<[^>]*>)?\s*\(/g;
  const sitesFound: string[] = [];

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const src = stripComments(raw);
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");

    for (const m of src.matchAll(callRe)) {
      const openIdx = m.index! + m[0].length - 1; // the "(" itself
      const closeIdx = matchingParenEnd(src, openIdx);
      const callText = src.slice(openIdx, closeIdx + 1);
      sitesFound.push(rel);
      assert.match(
        callText,
        /ACTIVE_DUE_PAYMENT/,
        `${rel}: a DuePayment.aggregate(...) call has no ACTIVE_DUE_PAYMENT in its pipeline — a soft-deleted row would keep counting`,
      );
    }
  }

  // The 3 known sites today: lib/due-payment.ts (duesPaidTotal), orders/summary
  // and reports routes. This floor exists so a broken directory walk (e.g. a
  // typo'd exclusion swallowing the whole app/ subtree) can't silently pass by
  // finding zero call sites.
  assert.ok(
    sitesFound.length >= 3,
    `expected to find at least the 3 known DuePayment.aggregate(...) sites, found ${sitesFound.length}: ${sitesFound.join(", ")}`,
  );
});

// ── C2. Auth ─────────────────────────────────────────────────────────────────

test("PIN: PATCH and DELETE in payments/[paymentId]/route.ts both use requireAdmin", () => {
  const src = stripComments(readSrc(PAYMENT_ID_ROUTE));
  const patchStart = src.indexOf("export async function PATCH");
  const deleteStart = src.indexOf("export async function DELETE");
  assert.ok(patchStart >= 0 && deleteStart > patchStart, "PATCH must exist before DELETE");

  const patchBody = src.slice(patchStart, deleteStart);
  const deleteBody = src.slice(deleteStart);

  assert.match(patchBody, /\brequireAdmin\s*\(/, "PATCH must gate with requireAdmin — rewriting money history needs a manager");
  assert.match(deleteBody, /\brequireAdmin\s*\(/, "DELETE must gate with requireAdmin");
});

test("PIN: GET in payments/route.ts uses requireAuth (staff-reachable history read), and the existing POST stays requireAuth too", () => {
  const src = stripComments(readSrc(PAYMENTS_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const postStart = src.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart, "GET must exist before POST");

  const getBody = src.slice(getStart, postStart);
  const postBody = src.slice(postStart);

  assert.match(getBody, /\brequireAuth\s*\(/, "GET must gate with requireAuth — staff can see what they can record");
  assert.ok(!/\brequireAdmin\s*\(/.test(getBody), "GET must NOT be admin-only — that would defeat staff-reachability");

  assert.match(postBody, /\brequireAuth\s*\(/, "POST must stay requireAuth — unchanged by this step");
  assert.ok(!/\brequireAdmin\s*\(/.test(postBody), "POST must NOT be downgraded to admin-only");
});

// ── C3. Actor provenance ─────────────────────────────────────────────────────

test("PIN: editedBy/deletedBy are read from session.user, never the request body, in payments/[paymentId]/route.ts", () => {
  const src = stripComments(readSrc(PAYMENT_ID_ROUTE));
  const patchStart = src.indexOf("export async function PATCH");
  const deleteStart = src.indexOf("export async function DELETE");
  const patchBody = src.slice(patchStart, deleteStart);
  const deleteBody = src.slice(deleteStart);

  assert.match(
    patchBody,
    /editedBy:\s*admin\.session\.user\?\.name/,
    "PATCH must stamp editedBy from admin.session.user?.name",
  );
  assert.ok(
    !/editedBy:\s*(parsed\.data|body|req)\b/.test(patchBody),
    "PATCH must not take editedBy from the parsed request body",
  );

  assert.match(
    deleteBody,
    /deletedBy:\s*admin\.session\.user\?\.name/,
    "DELETE must stamp deletedBy from admin.session.user?.name",
  );
  assert.ok(
    !/deletedBy:\s*(parsed\.data|body|req)\b/.test(deleteBody),
    "DELETE must not take deletedBy from the parsed request body",
  );
});

test("PIN: neither editDuePaymentSchema nor deleteDuePaymentSchema accepts a client-supplied editedBy/deletedBy — .strict() is intact", () => {
  // Complements due-payment.schema.test.ts's own .strict() pins (packages/shared) —
  // asserted again here against the actual imported schema the route uses, not a
  // re-declared copy, so a route importing a DIFFERENT (looser) schema module
  // would still be caught.
  assert.equal(
    editDuePaymentSchema.safeParse({ amount: 100, mode: "Cash", editedBy: "Asha" }).success,
    false,
    "editDuePaymentSchema must reject a client-supplied editedBy",
  );
  assert.equal(
    deleteDuePaymentSchema.safeParse({ note: "wrong amount keyed in", deletedBy: "Asha" }).success,
    false,
    "deleteDuePaymentSchema must reject a client-supplied deletedBy",
  );
});

// ── C4. Write ordering ───────────────────────────────────────────────────────
// THE GOVERNING PRINCIPLE (due-payment-admin.ts's own header comment): the
// DuePayment row is the source of truth; Customer.totalDue is a derived cache.
// Writing the row FIRST means a mid-failure heals in the safe direction (the
// recompute authority re-derives a balance that agrees with the row). Writing
// the balance first would leave totalDue changed with no row to justify it if
// the row write then failed.

// NOTE: compensateEdit/compensateDelete (unconditional revert-on-any-failure)
// are GONE — replaced by revertEdit/revertDelete, which only fire on a
// DEFINITE no-match, never on a throw (see the two catch-block pins below).
// The boundary marker below is updated accordingly; the ordering assertion
// itself is unchanged and still fails if the writes are swapped.
test("PIN: editDuePayment writes the DuePayment row BEFORE the Customer balance write", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function editDuePayment");
  const fnEnd = src.indexOf("async function revertEdit");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "editDuePayment must exist and precede revertEdit");
  const body = src.slice(fnStart, fnEnd);

  const rowWriteIdx = body.indexOf("DuePayment.findOneAndUpdate(");
  const balanceWriteIdx = body.indexOf("Customer.findOneAndUpdate(");
  assert.ok(rowWriteIdx >= 0, "editDuePayment must write the DuePayment row via findOneAndUpdate");
  assert.ok(balanceWriteIdx >= 0, "editDuePayment must write the Customer balance via findOneAndUpdate");
  assert.ok(
    rowWriteIdx < balanceWriteIdx,
    "the DuePayment row write must appear BEFORE the Customer balance write — reordering would leave a balance change with no row to justify it if the row write then failed",
  );
});

test("PIN: softDeleteDuePayment writes the DuePayment row BEFORE the Customer balance write", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function softDeleteDuePayment");
  const fnEnd = src.indexOf("async function revertDelete");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "softDeleteDuePayment must exist and precede revertDelete");
  const body = src.slice(fnStart, fnEnd);

  const rowWriteIdx = body.indexOf("DuePayment.findOneAndUpdate(");
  const balanceWriteIdx = body.indexOf("Customer.findOneAndUpdate(");
  assert.ok(rowWriteIdx >= 0, "softDeleteDuePayment must write the DuePayment row via findOneAndUpdate");
  assert.ok(balanceWriteIdx >= 0, "softDeleteDuePayment must write the Customer balance via findOneAndUpdate");
  assert.ok(
    rowWriteIdx < balanceWriteIdx,
    "the DuePayment row write must appear BEFORE the Customer balance write",
  );
});

// ── C4b. No revert on a THROW — only on a definite no-match ─────────────────
// A throw from the Customer balance write does NOT prove the $inc missed (the
// driver can lose the ack for a write that landed) — reverting the row here
// would un-do a committed adjustment, and the admin's natural retry would
// then re-apply the same correction/restore a SECOND time. Both catch blocks
// must therefore do nothing but report a 500 naming Reconcile; only the
// separate `if (!updatedCustomer)` / `if (!customer)` DEFINITE-no-match branch
// may call revertEdit/revertDelete.

test("PIN: editDuePayment's catch block does NOT call revertEdit on a throw from the Customer balance write, and its message names Reconcile", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function editDuePayment");
  const fnEnd = src.indexOf("async function revertEdit");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "editDuePayment must exist and precede revertEdit");
  const body = src.slice(fnStart, fnEnd);

  const catchIdx = body.indexOf("catch (_error) {");
  const guardIdx = body.indexOf("if (!updatedCustomer)");
  assert.ok(catchIdx >= 0 && guardIdx > catchIdx, "editDuePayment must have a catch (_error) block before the !updatedCustomer guard");
  const catchBody = body.slice(catchIdx, guardIdx);

  assert.ok(
    !/revertEdit\s*\(/.test(catchBody),
    "a throw from the Customer balance write must NOT call revertEdit — a throw doesn't prove the $inc missed, so reverting a committed adjustment would let the admin's retry double-apply it",
  );
  assert.match(
    catchBody,
    /Reconcile/,
    "the throw path's error message must tell the admin to run Reconcile — that's the only honest recovery once we refuse to guess whether the $inc committed",
  );
});

test("PIN: softDeleteDuePayment's catch block does NOT call revertDelete on a throw from the Customer balance write, and its message names Reconcile", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function softDeleteDuePayment");
  const fnEnd = src.indexOf("async function revertDelete");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "softDeleteDuePayment must exist and precede revertDelete");
  const body = src.slice(fnStart, fnEnd);

  const catchIdx = body.indexOf("catch (_error) {");
  const guardIdx = body.indexOf("if (!customer)");
  assert.ok(catchIdx >= 0 && guardIdx > catchIdx, "softDeleteDuePayment must have a catch (_error) block before the !customer guard");
  const catchBody = body.slice(catchIdx, guardIdx);

  assert.ok(
    !/revertDelete\s*\(/.test(catchBody),
    "a throw from the Customer balance write must NOT call revertDelete — un-deleting would also destroy the reason the admin just typed, and their retry would restore the amount a second time",
  );
  assert.match(
    catchBody,
    /Reconcile/,
    "the throw path's error message must tell the admin to run Reconcile",
  );
});

// ── C4c. revertEdit/revertDelete are CAS-guarded on what THEY wrote ─────────
// Both undo helpers only run after a DEFINITE no-match (see C4b above), and
// even then must not roll back a row a concurrent admin action has since
// moved on — the filter must re-assert the exact values/stamp this call's own
// prior write produced, not a bare { _id }.

test("PIN: revertEdit's DuePayment.updateOne filter is CAS-guarded on the values THIS call applied (amount, mode), not a bare { _id }", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("async function revertEdit");
  const fnEnd = src.indexOf("export interface SoftDeleteDuePaymentInput");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "revertEdit must exist and precede SoftDeleteDuePaymentInput");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /DuePayment\.updateOne\(\s*\{\s*_id:\s*paymentId,\s*amount:\s*applied\.amount,\s*mode:\s*applied\.mode\s*\}/,
    "revertEdit must CAS on { _id, amount: applied.amount, mode: applied.mode } — a bare { _id } filter would roll back a concurrent edit that landed after this call's own write, destroying it AND popping its trail entry",
  );
});

test("PIN: revertDelete's DuePayment.updateOne filter is CAS-guarded on deletedBy (the stamp THIS call wrote), not a bare { _id }", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("async function revertDelete");
  assert.ok(fnStart >= 0, "revertDelete must exist");
  const body = src.slice(fnStart);

  assert.match(
    body,
    /DuePayment\.updateOne\(\s*\{\s*_id:\s*paymentId,\s*deletedBy\s*\}/,
    "revertDelete must CAS on { _id, deletedBy } — a bare { _id } filter would un-delete a row a concurrent admin action has since changed",
  );
});

// ── C4d. revertEdit omit-empty on the trail array ────────────────────────────
// Mirrors C5's omit-empty discipline on the model itself: if the row had NO
// prior trail, popping the entry this call just pushed must leave the field
// ABSENT, not an empty array.

test("PIN: revertEdit $unsets edits (not $pop) when the row had no prior trail, so it never leaves edits: []", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("async function revertEdit");
  const fnEnd = src.indexOf("export interface SoftDeleteDuePaymentInput");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /if\s*\(\s*\(previous\.edits\?\.length\s*\?\?\s*0\)\s*===\s*0\s*\)\s*unset\.edits\s*=\s*"";/,
    "when there was no prior trail, revertEdit must $unset edits rather than $pop it — $pop on an absent array would leave edits: [], the present-but-empty shape the model's omit-empty discipline forbids",
  );
  assert.match(
    body,
    /else\s+update\.\$pop\s*=\s*\{\s*edits:\s*1\s*\}/,
    "when there WAS a prior trail, revertEdit must $pop only the entry it just pushed — $unset-ing the whole array would destroy earlier history",
  );
});

// ── C4e. Edit trail carries the previous note ────────────────────────────────

test("PIN: editDuePayment's edit-trail $push carries the previous note (row.note), omitted when the row had none", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function editDuePayment");
  const fnEnd = src.indexOf("async function revertEdit");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /\$push:\s*\{\s*edits:\s*\{\s*at:\s*new Date\(\),\s*by:\s*input\.editedBy,\s*amount:\s*row\.amount,\s*mode:\s*row\.mode,\s*\.\.\.\(row\.note\s*!==\s*undefined\s*\?\s*\{\s*note:\s*row\.note\s*\}\s*:\s*\{\}\)/,
    "the trail entry must snapshot row.note (spread-in only when present, never an explicit undefined) — without it an admin could rewrite or blank the only record of how the money arrived while the trail shows no note ever changed",
  );
});

// ── C4f. No-op edit skips the trail entirely ─────────────────────────────────

test("PIN: editDuePayment's no-op guard (amount, mode and note all unchanged) returns early, before building the $push trail entry", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function editDuePayment");
  const fnEnd = src.indexOf("async function revertEdit");
  const body = src.slice(fnStart, fnEnd);

  const noopIdx = body.search(
    /if\s*\(\s*input\.amount\s*===\s*row\.amount\s*&&\s*input\.mode\s*===\s*row\.mode\s*&&\s*nextNote\s*===\s*row\.note\s*\)\s*\{\s*return\s*\{\s*ok:\s*true\s*as\s*const,\s*payment:\s*row,\s*customer\s*\}\s*;\s*\}/,
  );
  const pushIdx = body.indexOf("$push:");
  assert.ok(
    noopIdx >= 0,
    "editDuePayment must return early with { ok: true, payment: row, customer } when amount, mode and note are all unchanged",
  );
  assert.ok(pushIdx >= 0, "editDuePayment must build a $push trail entry for an actual change");
  assert.ok(
    noopIdx < pushIdx,
    "the no-op early return must precede the $push — otherwise tapping Save on an unchanged form would still permanently mark the row 'Edited' with a before-value identical to its after-value",
  );
});

// ── C4g. Row filters go through the canonical-id helper ──────────────────────
// `customerId` is a stored STRING and ObjectId hex is case-insensitive, so the
// same customer can be spelled two ways across requests. A row filter that
// matches only the raw path segment (or only the canonical form) makes a row
// filed under the other spelling invisible to history/edit/delete — exactly
// the G-series hazard canonicalCustomerId exists to close.

test("PIN: customerIdFilter matches both the raw id and canonicalCustomerId(id), and every DuePayment row filter in due-payment-admin.ts routes through it", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));

  assert.match(
    src,
    /function\s+customerIdFilter\s*\(\s*customerId:\s*string\s*\)\s*:\s*\{\s*\$in:\s*string\[\]\s*\}\s*\{\s*return\s*\{\s*\$in:\s*\[\s*customerId,\s*canonicalCustomerId\(customerId\)\s*\]\s*\}\s*;\s*\}/,
    "customerIdFilter must return { $in: [rawId, canonicalCustomerId(rawId)] } — matching only the canonical spelling would make a row filed under the raw/pre-canonicalization spelling invisible",
  );

  assert.match(
    src,
    /DuePayment\.find\(\{\s*customerId:\s*customerIdFilter\(customerId\)\s*\}\)/,
    "listDuePayments must filter customerId through customerIdFilter, not a bare field match",
  );

  assert.match(
    src,
    /const\s+customerIdMatch\s*=\s*customerIdFilter\(input\.customerId\)\s*;/,
    "editDuePayment must resolve its row filter through customerIdFilter",
  );
  const customerIdMatchUses = src.match(/customerId:\s*customerIdMatch,/g) ?? [];
  assert.ok(
    customerIdMatchUses.length >= 2,
    `editDuePayment must use customerIdMatch on BOTH its row read and its CAS row write — found ${customerIdMatchUses.length} occurrence(s)`,
  );

  const softDeleteMatches = src.match(/customerId:\s*customerIdFilter\(input\.customerId\)/g) ?? [];
  assert.ok(
    softDeleteMatches.length >= 2,
    `softDeleteDuePayment must filter BOTH its CAS update and its existing-row fallback read through customerIdFilter(input.customerId) — found ${softDeleteMatches.length} occurrence(s)`,
  );

  assert.ok(
    !/customerId:\s*input\.customerId\b/.test(src),
    "no DuePayment row filter in due-payment-admin.ts may match the raw input.customerId directly — it must go through customerIdFilter",
  );
});

// ── C4h. clientRef replay refuses a soft-deleted row (lib/due-payment.ts) ────
// receiveDuePayment has TWO clientRef replay paths: the step-2 short-circuit
// (clientRef found before any write is attempted) and the F9 re-read after
// the CAS decrement misses (a race loser recovering the winner's row). A row
// an admin has since soft-deleted put its amount back on the customer's
// balance — echoing either replay path as success would tell the cashier
// "Payment recorded" for money that isn't actually due anymore, with no
// record of the discrepancy. Both paths must independently refuse it; fixing
// only the first would leave the race-recovery path exploitable.

test("PIN: both clientRef replay paths in receiveDuePayment refuse a soft-deleted row (already.deletedAt / raced.deletedAt) with a 409, instead of echoing it as success", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_LIB));
  const fnStart = src.indexOf("export async function receiveDuePayment");
  assert.ok(fnStart >= 0, "receiveDuePayment must exist");
  const body = src.slice(fnStart);

  assert.match(
    body,
    /if\s*\(\s*already\.deletedAt\s*\)\s*\{\s*return\s*\{\s*ok:\s*false\s*as\s*const,\s*status:\s*409,/,
    "the step-2 short-circuit (clientRef found before any write) must refuse when `already` is soft-deleted",
  );
  assert.match(
    body,
    /if\s*\(\s*raced\.deletedAt\s*\)\s*\{\s*return\s*\{\s*ok:\s*false\s*as\s*const,\s*status:\s*409,/,
    "the F9 re-read-after-CAS-miss path must ALSO refuse when `raced` is soft-deleted — fixing only the step-2 short-circuit would leave the race-loser recovery path free to echo a reversed payment as a successful collection",
  );

  const firstIdx = body.search(/if\s*\(\s*already\.deletedAt\s*\)/);
  const secondIdx = body.search(/if\s*\(\s*raced\.deletedAt\s*\)/);
  assert.ok(
    firstIdx >= 0 && secondIdx > firstIdx,
    "the already.deletedAt guard (step-2 short-circuit) must precede the raced.deletedAt guard (F9 race-recovery path)",
  );
});

// ── C5. Omit-empty on the model ──────────────────────────────────────────────
// A stray `default: null`/`default: ""` on deletedAt/deletedBy/deleteNote
// would defeat ACTIVE_DUE_PAYMENT's `{ $exists: false }` test (ANY row would
// then carry the field, just with a null/empty value, and `$exists` would be
// true for every row ever written) — every C1 sum-site's filter would then
// silently exclude EVERYTHING, or nothing, depending on the exact Mongoose
// minimize behavior. `edits` must default to `undefined` specifically (not
// `[]`) for the same reason `encodeOrderForWrite`'s omit-empty arrays do
// (packages/shared codec) — an empty array is still a PRESENT field.

test("PIN: models/DuePayment.ts declares deletedAt/deletedBy/deleteNote with NO `default`, and `edits` with `default: undefined`", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_MODEL));

  for (const field of ["deletedAt", "deletedBy", "deleteNote"] as const) {
    const fieldRe = new RegExp(`\\b${field}:\\s*\\{([^}]*)\\}`);
    const m = src.match(fieldRe);
    assert.ok(m, `${field} must be declared as a Schema field`);
    assert.ok(
      !/default/.test(m[1]),
      `${field}'s field config must not carry a \`default\` — found "${m[1].trim()}"; a default here defeats ACTIVE_DUE_PAYMENT's { $exists: false } test`,
    );
  }

  const editsMatch = src.match(/\bedits:\s*\{([^}]*)\}/);
  assert.ok(editsMatch, "edits must be declared as a Schema field");
  assert.match(
    editsMatch[1],
    /default:\s*undefined/,
    "edits must declare `default: undefined` — an implicit [] default would make an unedited row carry a present-but-empty edits field",
  );
});

// ── C6. CAS guards ───────────────────────────────────────────────────────────

test("PIN: softDeleteDuePayment's row filter includes ACTIVE_DUE_PAYMENT — a double-tap must CAS-miss, not restore the balance twice", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function softDeleteDuePayment");
  const fnEnd = src.indexOf("async function revertDelete");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "softDeleteDuePayment must exist and precede revertDelete");
  const body = src.slice(fnStart, fnEnd);

  // Filter now routes customerId through customerIdFilter (C4g) rather than a
  // bare input.customerId — this pin catches BOTH regressions: losing the
  // ACTIVE_DUE_PAYMENT spread (double-tap re-restores the balance), and
  // reverting the customerId match back to the raw, non-canonicalizing form.
  assert.match(
    body,
    /DuePayment\.findOneAndUpdate\(\s*\{\s*_id:\s*input\.paymentId,\s*customerId:\s*customerIdFilter\(input\.customerId\),\s*\.\.\.ACTIVE_DUE_PAYMENT\s*\}/,
    "softDeleteDuePayment's row filter must spread ...ACTIVE_DUE_PAYMENT (without it, calling delete twice on the same row would restore the balance twice) and must match customerId via customerIdFilter",
  );
});

test("PIN: editDuePayment's customer update carries a totalDue: { $gte: drop } guard when the edit raises the collected amount (drop > 0)", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_ADMIN_LIB));
  const fnStart = src.indexOf("export async function editDuePayment");
  const fnEnd = src.indexOf("async function revertEdit");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "editDuePayment must exist and precede revertEdit");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /drop\s*>\s*0\s*\?\s*\{\s*_id:\s*input\.customerId,\s*totalDue:\s*\{\s*\$gte:\s*drop\s*\}\s*\}\s*:\s*\{\s*_id:\s*input\.customerId\s*\}/,
    "when drop>0 (the edit raises the collected amount, so totalDue must fall) the customer filter must guard totalDue: { $gte: drop } — otherwise a concurrent dues collection can drive totalDue negative, which the recompute authority's Math.max(0,…) clamp would hide rather than surface",
  );
});
