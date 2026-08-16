import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Eleven defects were just fixed in the customer due-payment history UI
// (DuePaymentHistory / DuePaymentEditDialog / DuePaymentDeleteDialog /
// CustomerHistoryDialog's Orders tab) and nothing pinned any of them — a
// regression would ship green. There is no React test framework in this repo
// (deliberate): every pin below is a source-read pin (readFileSync over the
// REAL component source), the same technique as customer-privacy-paths.test.ts
// and print-paths.test.ts.
//
// NOT duplicated here — already pinned elsewhere, look there instead:
//   - due-payment.test.ts: the route/schema-level behavior (server validation,
//     DUES_RECEIPT_MODES vs SETTLEMENT_PAY_MODES rejection, totals math).
//   - customer-privacy-paths.test.ts: CustomersPage / CustomerSearch's own
//     isPaused/isError precedence pins (same hazard, different components).
//   - packages/shared/src/schemas/due-payment.schema.test.ts: the Zod schemas
//     themselves (mode enum narrowing, note min-length + trim behavior).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// These pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it. (This bit this repo once already on a banned-string pin.)
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const DUE_PAYMENT_HISTORY = "apps/cafe/components/customers/DuePaymentHistory.tsx";
const DUE_PAYMENT_EDIT_DIALOG = "apps/cafe/components/customers/DuePaymentEditDialog.tsx";
const DUE_PAYMENT_DELETE_DIALOG = "apps/cafe/components/customers/DuePaymentDeleteDialog.tsx";
const CUSTOMER_HISTORY_DIALOG = "apps/cafe/components/customers/CustomerHistoryDialog.tsx";

// ── 1 & 2. DuePaymentHistory — offline is never "nothing", failed refresh keeps rows ──

test("PIN: DuePaymentHistory — a paused (offline) query is read via isPaused and its branch precedes the empty state; a failed refresh is read via isLoadingError, never bare isError", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_HISTORY));

  const isPausedIdx = src.indexOf("payments.isPaused");
  const isLoadingErrorIdx = src.indexOf("payments.isLoadingError");
  const emptyStateIdx = src.indexOf('title="No payments recorded yet"');
  assert.ok(isPausedIdx >= 0, "payments.isPaused must be read");
  assert.ok(isLoadingErrorIdx >= 0, "payments.isLoadingError must be read");
  assert.ok(emptyStateIdx >= 0, "the empty state must exist");

  // Mutation this catches: dropping the isPaused branch entirely (or moving
  // it after the empty-state check) — TanStack v5 parks an offline query at
  // fetchStatus "paused", which reports isLoading=false AND isError=false
  // with no data, landing straight in "No payments recorded yet" for a
  // customer who has in fact paid.
  assert.ok(
    isPausedIdx < emptyStateIdx,
    "the isPaused branch must be checked BEFORE the empty state — otherwise a parked/offline query is indistinguishable from a customer who never paid",
  );
  assert.ok(
    isLoadingErrorIdx < emptyStateIdx,
    "the isLoadingError branch must also be checked before the empty state",
  );

  // Mutation this catches: reverting `payments.isLoadingError` back to bare
  // `payments.isError` — every edit/delete invalidates this query, so a
  // background refetch failing right after (rows already cached) would then
  // wipe the good list and show an error screen instead of the still-valid rows.
  assert.ok(
    !/\bpayments\.isError\b/.test(src),
    "DuePaymentHistory must never read bare payments.isError — only isLoadingError (initial-load failure) may gate the error screen",
  );
});

// ── 3. Same two for the Orders tab, plus Skeleton (not a spinner) ──────────

test("PIN: CustomerHistoryDialog's Orders tab — isPaused and isLoadingError precede the empty state (never bare isError), and the loading state renders Skeleton, not a spinner", () => {
  const src = stripComments(readSrc(CUSTOMER_HISTORY_DIALOG));

  const isLoadingIdx = src.indexOf("orders.isLoading");
  const isPausedIdx = src.indexOf("orders.isPaused");
  const isLoadingErrorIdx = src.indexOf("orders.isLoadingError");
  const emptyStateIdx = src.indexOf('title="No orders yet"');
  assert.ok(isLoadingIdx >= 0, "orders.isLoading must be read");
  assert.ok(isPausedIdx > isLoadingIdx, "orders.isPaused must be checked after isLoading");
  assert.ok(isLoadingErrorIdx > isPausedIdx, "orders.isLoadingError must be checked after isPaused");
  assert.ok(emptyStateIdx > isLoadingErrorIdx, "the empty state must be checked last, after isLoading/isPaused/isLoadingError");

  assert.ok(
    !/\borders\.isError\b/.test(src),
    "the Orders tab must never read bare orders.isError — a failed background refresh must not discard cached orders",
  );

  const loadingBranch = src.slice(src.indexOf("if (orders.isLoading)"), src.indexOf("if (orders.isPaused)"));
  assert.match(
    loadingBranch,
    /<Skeleton/,
    "the Orders tab's loading state must render Skeleton — this repo's rule is skeletons on lists, never a spinner",
  );
  assert.ok(
    !/Loader2|role="status"|spinner/i.test(loadingBranch),
    "the Orders tab's loading state must not fall back to a spinner",
  );
});

// ── 4. A legacy mode is never silently coerced to Cash ──────────────────────

test("PIN: DuePaymentEditDialog — a legacy stored mode outside DUES_RECEIPT_MODES is never coerced to Cash; the membership check leaves the pick null until the admin chooses — a real money bug if this regresses (a legacy 'Credit' row silently flipping to 'Cash' moves phantom cash into a past day's drawer tally)", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_EDIT_DIALOG));

  // The exact banned shape. Mutation this catches: reintroducing
  // `payment.mode === "Online" ? "Online" : "Cash"` as the seed for `mode`.
  assert.ok(
    !/payment\.mode\s*===\s*["']Online["']\s*\?\s*["']Online["']\s*:\s*["']Cash["']/.test(src),
    "the old ternary coercion (mode === 'Online' ? 'Online' : 'Cash') must not reappear",
  );

  assert.match(
    src,
    /function isDuesReceiptMode\(mode:\s*string\):\s*mode is DuesReceiptMode\s*\{\s*return\s*\(DUES_RECEIPT_MODES as readonly string\[\]\)\.includes\(mode\)\s*;\s*\}/,
    "isDuesReceiptMode must check membership in DUES_RECEIPT_MODES — a hand-rolled comparison list would silently drift from the shared enum",
  );

  // Mutation this catches: `setMode(isDuesReceiptMode(payment.mode) ? payment.mode : "Cash")`
  // (or any non-null fallback) — the effect must seed `null`, not a default mode.
  assert.match(
    src,
    /setMode\(\s*isDuesReceiptMode\(payment\.mode\)\s*\?\s*payment\.mode\s*:\s*null\s*\)/,
    "a stored mode outside DUES_RECEIPT_MODES must seed mode as null, never a fallback mode string",
  );

  // Mutation this catches: `canConfirm = validAmount && !isPending` (dropping
  // the `mode !== null` guard) — confirm would then be pressable while no
  // mode was ever chosen, letting a legacy row save with an undefined mode.
  assert.match(
    src,
    /const canConfirm\s*=\s*validAmount\s*&&\s*mode\s*!==\s*null\s*&&\s*!isPending\s*;/,
    "confirm must stay disabled while mode is null — dropping this guard lets a legacy row save without a deliberate Cash/Online pick",
  );
});

// ── 5. A cleared note actually clears ────────────────────────────────────────

test("PIN: DuePaymentEditDialog — clearing a note that HAD content sends note:\"\"; a note that never existed omits the field entirely", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_EDIT_DIALOG));

  assert.match(
    src,
    /const hadNote\s*=\s*!!payment\.note\s*&&\s*payment\.note\.length\s*>\s*0\s*;/,
    "hadNote must track whether the ORIGINAL row had a note",
  );

  // Mutation this catches: collapsing the hadNote branch into the omit branch
  // (`trimmedNote.length > 0 ? { note: trimmedNote } : {}`) — an operator who
  // deliberately empties a note that used to have content would then have
  // that edit silently dropped (the server treats an omitted `note` as
  // "leave unchanged"), so the stale note survives under a success toast.
  assert.match(
    src,
    /const noteField\s*=\s*trimmedNote\.length\s*>\s*0\s*\?\s*\{\s*note:\s*trimmedNote\s*\}\s*:\s*hadNote\s*\?\s*\{\s*note:\s*["']["']\s*\}\s*:\s*\{\}\s*;/,
    "clearing a note that had content must send { note: \"\" }, and a note that never existed must omit the field ({}) — collapsing these branches silently drops a deliberate clear",
  );
});

// ── 6 & 7. Server errors rendered inline; paused mutations checked first ───

test("PIN: DuePaymentEditDialog — a paused mutation is checked BEFORE the error branch, and a server error renders error.message inline (not toast-only)", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_EDIT_DIALOG));

  const pausedIdx = src.indexOf("editPayment.isPaused");
  const errorIdx = src.indexOf("editPayment.isError");
  assert.ok(pausedIdx >= 0, "editPayment.isPaused must be read");
  assert.ok(
    errorIdx > pausedIdx,
    "editPayment.isPaused must be checked before editPayment.isError — otherwise an offline save renders as a hard failure instead of a waiting-for-connection state",
  );

  // Mutation this catches: dropping the inline <p> and relying on a toast
  // alone — a toast can be missed or dismissed; the dialog must still show
  // the reason for a 400/409 to the admin who is staring right at it.
  assert.match(
    src,
    /\{editPayment\.error\?\.message\s*\|\|\s*["']Could not update the payment\.["']\}/,
    "the mutation's error.message must be rendered inline in the dialog",
  );
});

test("PIN: DuePaymentDeleteDialog — a paused mutation is checked BEFORE the error branch, and a server error renders error.message inline (not toast-only)", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_DELETE_DIALOG));

  const pausedIdx = src.indexOf("deletePayment.isPaused");
  const errorIdx = src.indexOf("deletePayment.isError");
  assert.ok(pausedIdx >= 0, "deletePayment.isPaused must be read");
  assert.ok(
    errorIdx > pausedIdx,
    "deletePayment.isPaused must be checked before deletePayment.isError",
  );

  assert.match(
    src,
    /\{deletePayment\.error\?\.message\s*\|\|\s*["']Could not delete the payment\.["']\}/,
    "the mutation's error.message must be rendered inline in the dialog",
  );
});

// ── 8. The row cap is disclosed via the shared constant, never hardcoded ───

test("PIN: DuePaymentHistory — the row cap is disclosed via the shared DUE_PAYMENT_HISTORY_LIMIT constant, and the literal 100 never appears in this file", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_HISTORY));

  assert.match(
    src,
    /import\s*\{[^}]*\bDUE_PAYMENT_HISTORY_LIMIT\b[^}]*\}\s*from\s*["']@\/lib\/constants["']/,
    "DUE_PAYMENT_HISTORY_LIMIT must be imported from @/lib/constants",
  );
  assert.match(
    src,
    /const atCap\s*=\s*rows\.length\s*>=\s*DUE_PAYMENT_HISTORY_LIMIT\s*;/,
    "atCap must compare rows.length against the imported constant",
  );
  // Mutation this catches: reverting the interpolated notice text back to a
  // hand-copied "Showing the most recent 100 payments" — the two can then
  // drift silently if the server-side limit ever changes.
  assert.match(
    src,
    /Showing the most recent \{DUE_PAYMENT_HISTORY_LIMIT\} payments/,
    "the notice text shown to the operator must interpolate the shared constant, not a hardcoded copy of today's value",
  );
  assert.ok(
    !/\b100\b/.test(src),
    "the literal 100 must never appear in this file — the cap must always be read from DUE_PAYMENT_HISTORY_LIMIT",
  );
});

// ── 9. The delete-note threshold is the shared constant, no local copy ─────

test("PIN: DuePaymentDeleteDialog — the delete-note minimum length is the shared DUE_PAYMENT_DELETE_NOTE_MIN_LEN constant; no local copy, no bare numeric-literal comparison", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_DELETE_DIALOG));

  assert.match(
    src,
    /import\s*\{[^}]*\bDUE_PAYMENT_DELETE_NOTE_MIN_LEN\b[^}]*\}\s*from\s*["']@\/lib\/constants["']/,
    "DUE_PAYMENT_DELETE_NOTE_MIN_LEN must be imported from @/lib/constants",
  );
  assert.match(
    src,
    /const validNote\s*=\s*trimmedNote\.length\s*>=\s*DUE_PAYMENT_DELETE_NOTE_MIN_LEN\s*;/,
    "validNote must compare against the imported constant",
  );

  // Mutation this catches: `const DUE_PAYMENT_DELETE_NOTE_MIN_LEN = 3;` locally
  // (shadowing or replacing the import) — it would compile and pass today,
  // then silently drift from the server's own validation the next time
  // either side's threshold changes, enabling a submit that then 400s.
  assert.ok(
    !/const\s+DUE_PAYMENT_DELETE_NOTE_MIN_LEN\s*=/.test(src),
    "must not locally redeclare DUE_PAYMENT_DELETE_NOTE_MIN_LEN",
  );
  // Scoped to `>=` specifically (the threshold check's own operator) so this
  // doesn't false-positive on the unrelated `trimmedNote.length > 0` presence
  // check a few lines below (that guards the "too short" hint text, not the
  // threshold itself).
  assert.ok(
    !/trimmedNote\.length\s*>=\s*\d/.test(src),
    "trimmedNote's length must only ever be threshold-compared (>=) against the imported constant, never a bare numeric literal",
  );
});

// ── 10 & 11. Deleted rows stay honest; actions are admin-gated and hidden on deleted rows ──

test("PIN: DuePaymentHistory — a deleted row is excluded from the total, marked with BOTH a text 'Deleted' badge and a strike-through, shows who/when/why, and carries no edit/delete actions", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_HISTORY));

  // Mutation this catches: filtering on something other than deletedAt (or
  // not filtering at all) — a soft-deleted (reversed) payment would then
  // still inflate the "collected" total shown to the admin.
  assert.match(
    src,
    /const active\s*=\s*rows\.filter\(\(p\)\s*=>\s*!p\.deletedAt\)\s*;/,
    "the active total/count must filter out rows carrying deletedAt",
  );

  // Text badge, not colour alone. Mutation this catches: dropping the
  // "Deleted" text and relying only on the outline/colour variant, or on the
  // strike-through alone — colour-only signals fail for anyone who can't
  // distinguish it, and a plain outline Badge with no distinguishing text
  // reads identically to the mode badge next to it.
  assert.match(
    src,
    /\{deleted\s*&&\s*\(\s*<Badge[^>]*>\s*Deleted\s*<\/Badge>\s*\)\}/,
    "a deleted row must render a literal 'Deleted' text badge",
  );
  assert.match(
    src,
    /className=\{cn\("font-semibold",\s*deleted\s*&&\s*"line-through"\)\}/,
    "a deleted row's amount must carry a strike-through class in addition to the badge",
  );

  assert.match(src, /Deleted by \{row\.deletedBy\}/, "a deleted row must show WHO deleted it");
  assert.match(
    src,
    /\{row\.deletedAt \? ` · \$\{formatDate\(row\.deletedAt\)\}` : ""\}/,
    "a deleted row must show WHEN it was deleted",
  );
  assert.match(
    src,
    /\{row\.deleteNote \? ` · \$\{row\.deleteNote\}` : ""\}/,
    "a deleted row must show WHY it was deleted",
  );

  // Mutation this catches: gating actions on isAdmin alone (dropping
  // `!deleted`) — an admin would then get Edit/Delete buttons on an already
  // soft-deleted row.
  assert.match(
    src,
    /\{isAdmin\s*&&\s*!deleted\s*&&\s*\(/,
    "edit/delete actions must be gated on isAdmin AND !deleted",
  );
});

// ── 12. Each edit-trail entry shows who and when ─────────────────────────────

test("PIN: DuePaymentHistory — each edit-trail entry shows WHO made the correction and WHEN, not just the amount", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_HISTORY));

  // Mutation this catches: trimming the trail line down to just the amount
  // (e.g. `was {inr(edit.amount)}`) — an amount-only trail can't answer who
  // authorized a correction or when it happened.
  assert.match(
    src,
    /Edited by \{edit\.by\} ·\s*\{formatDate\(edit\.at\)\}/,
    "an edit-trail entry must render edit.by and formatDate(edit.at)",
  );
});

// ── 13. Icon-only buttons carry aria-label ──────────────────────────────────

test("PIN: DuePaymentHistory — the icon-only edit/delete buttons carry aria-label", () => {
  const src = stripComments(readSrc(DUE_PAYMENT_HISTORY));

  const editBtnIdx = src.indexOf("setEditing(row)");
  const deleteBtnIdx = src.indexOf("setDeleting(row)");
  assert.ok(editBtnIdx >= 0, "the edit button's onClick must exist");
  assert.ok(deleteBtnIdx > editBtnIdx, "the delete button's onClick must exist, after the edit button");

  const editBtnBlock = src.slice(editBtnIdx, deleteBtnIdx);
  assert.match(
    editBtnBlock,
    /aria-label="Edit payment"/,
    "the icon-only edit button (a bare Pencil icon, no visible text) must carry aria-label",
  );

  const deleteBtnBlock = src.slice(deleteBtnIdx, deleteBtnIdx + 200);
  assert.match(
    deleteBtnBlock,
    /aria-label="Delete payment"/,
    "the icon-only delete button (a bare Trash2 icon, no visible text) must carry aria-label",
  );
});
