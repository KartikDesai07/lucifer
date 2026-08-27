import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// The table-move + floor-plan-arrangement flow (move-an-order's-table route,
// the hardened PUT it shares a CAS lesson with, the "moved" KOT variant, the
// dialog that owns the one print path, the tables collection route's arrange
// seam, and the Arrange-mode list) has no React/route test framework coverage
// — there is no such framework in this repo, by design (see
// customer-privacy-paths.test.ts's header). These are source-read pins
// (readFileSync over the REAL source), the same technique as that file and
// branding-paths.test.ts.
//
// NOT duplicated here — already pinned elsewhere:
//   - lib/order-table-move.ts's own helpers (tableUnavailableReason,
//     moveOrderFilter, claimTableFilter, occupyUpdate, RELEASE_UPDATE) are
//     unit-pinned in lib/order-table-move.test.ts; this file only pins that
//     the ROUTEs actually call them in the right order, not their internal
//     shapes.
//   - lib/table-order.ts's reorderOps shape is unit-pinned in
//     lib/table-order.test.ts; this file only pins that the caller sends the
//     FULL list, not a delta.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// These pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it. (This bit this repo once already on a banned-string pin.)

// Scans forward from an opening `{` at `openIdx`, counting brace depth, and
// returns the index of its MATCHING closing `}` — used to pull a whole
// function/object BODY out of the source text without truncating on the
// first nested `}` a naive indexOf would hit.
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

const ORDER_TABLE_ROUTE = "apps/cafe/app/api/orders/[id]/table/route.ts";
const ORDER_ROUTE = "apps/cafe/app/api/orders/[id]/route.ts";
const KOT_RECEIPT = "apps/cafe/components/pos/KOTReceipt.tsx";
const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const TABLES_ROUTE = "apps/cafe/app/api/tables/route.ts";
const TABLE_ARRANGE_LIST = "apps/cafe/components/tables/TableArrangeList.tsx";
const TABLE_MODEL = "apps/cafe/models/Table.ts";
const ORDER_DETAIL_SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
// CR2.3 S0 split — the header action row (including the Move-table button)
// moved out of pos/page.tsx into its own component.
const POS_HEADER = "apps/cafe/components/pos/PosHeader.tsx";

// ── 1. the move route is all-staff, not admin-gated ─────────────────────────

test("PIN: POST /api/orders/[id]/table guards with requireAuth (not requireAdmin), and immediately enforces its error branch — the owner chose all-staff, matching Settle rather than the admin-gated Cancel", () => {
  const src = stripComments(readSrc(ORDER_TABLE_ROUTE));

  const authedIdx = src.indexOf("const authed = await requireAuth();");
  assert.ok(authedIdx >= 0, "POST must call requireAuth()");

  // Mutation this catches: declaring `authed` without enforcing its error
  // branch — requireAuth() returns an error-shaped value rather than
  // throwing, so the guard only does anything if the result is checked and
  // returned on.
  const guardWindow = src.slice(authedIdx, authedIdx + 100);
  assert.match(
    guardWindow,
    /if \("error" in authed\) return authed\.error;/,
    'requireAuth() must be immediately followed by `if ("error" in authed) return authed.error;`',
  );

  // Mutation this catches: swapping requireAuth for requireAdmin — the owner
  // explicitly chose all-staff for a table move (AskUserQuestion decision),
  // the same authorization level as Settle.
  assert.ok(
    !/requireAdmin/.test(src),
    "this route must never call requireAdmin — moving a guest's table is a serving task open to all staff",
  );
});

// ── 2. destination claim happens before the order's CAS write ───────────────

test("PIN: the destination claim (claimTableFilter) happens strictly BEFORE the order's CAS write (moveOrderFilter) — this ordering is the whole failure-safety of a cross-cluster move with no transaction", () => {
  const src = stripComments(readSrc(ORDER_TABLE_ROUTE));

  const claimIdx = src.indexOf("claimTableFilter(to)");
  const moveIdx = src.indexOf("moveOrderFilter(id, order.tableNo)");
  assert.ok(claimIdx >= 0, "claimTableFilter(to) must be called to claim the destination table");
  assert.ok(moveIdx >= 0, "moveOrderFilter(id, order.tableNo) must be called to CAS the order write");

  // Mutation this catches: reordering the two writes (or freeing the source
  // first) — claiming the destination first means a throw anywhere after it
  // still leaves the tab holding SOME table; the reverse ordering could
  // strand a tab holding none, or (an unguarded claim) steal a table from
  // another live order.
  assert.ok(
    moveIdx > claimIdx,
    "the order's CAS write (moveOrderFilter) must come strictly after the destination claim (claimTableFilter) in source order",
  );
});

// ── 3. the throw path never releases the claim; the no-match path does ──────

test("PIN: the order write's throw path never releases the destination claim, while its definite no-match path does — a throw is not proof the write failed (never-revert-on-write-throw)", () => {
  const src = stripComments(readSrc(ORDER_TABLE_ROUTE));

  const letMovedIdx = src.indexOf("let moved;");
  assert.ok(letMovedIdx >= 0, "the order write must be preceded by `let moved;`");

  const catchHeaderIdx = src.indexOf("catch (error) {", letMovedIdx);
  assert.ok(catchHeaderIdx >= 0, "the order write must be wrapped in its own try/catch");
  const catchBraceOpen = src.indexOf("{", catchHeaderIdx);
  const catchBraceClose = matchingBraceEnd(src, catchBraceOpen);
  const catchBody = src.slice(catchHeaderIdx, catchBraceClose);

  // Mutation this catches: reverting the destination claim inside this catch
  // — a throw here is NOT proof the order write failed (project lesson:
  // never-revert-on-write-throw), so freeing the claim here could hand the
  // table to someone else while the order may in fact now hold it.
  assert.ok(
    !/freeTableFilter/.test(catchBody),
    "the throw path around the order write must never call freeTableFilter — a throw is not proof the write failed",
  );

  const noMatchIdx = src.indexOf("if (!moved) {", catchBraceClose);
  assert.ok(noMatchIdx >= 0, "a definite no-match branch (`if (!moved) {`) must follow the try/catch");
  const noMatchBraceOpen = src.indexOf("{", noMatchIdx);
  const noMatchBraceClose = matchingBraceEnd(src, noMatchBraceOpen);
  const noMatchBody = src.slice(noMatchIdx, noMatchBraceClose);

  // Mutation this catches: dropping the release call from this branch — the
  // order genuinely did not move here, so the claim on the destination must
  // be given back, or that table is stuck Occupied by a tab that never landed.
  assert.match(
    noMatchBody,
    /freeTableFilter\(to, order\.orderId\)/,
    "the definite no-match branch must release the destination claim via freeTableFilter(to, order.orderId)",
  );
});

// ── 4. PUT's re-occupy is conditional on FREE_TABLE_FILTER; CAS guards tableNo ──

test("PIN: PUT /api/orders/[id]'s re-occupy filter includes FREE_TABLE_FILTER (the stolen-table bug must not come back), and its CAS filter carries a tableNo term when the table is changing", () => {
  const src = stripComments(readSrc(ORDER_ROUTE));

  // Mutation this catches: dropping `...FREE_TABLE_FILTER` from the re-occupy
  // write — an unconditional occupy would silently steal a table another
  // live order already holds, orphaning that order from the Live Floor Panel.
  //
  // Anchored to the CALL, and to the reconciliation block it lives in: a
  // file-wide match for the filter literal would still pass if that literal
  // survived somewhere unused (a leftover const, a comment-free dead branch)
  // while the write itself went out with a bare `{ tableNo: updated.tableNo }`.
  const reconcileIdx = src.indexOf("if (old.tableNo !== updated.tableNo)");
  assert.ok(reconcileIdx >= 0, "PUT must reconcile table occupancy on a table change");
  const reconcileOpen = src.indexOf("{", reconcileIdx);
  const reconcileBody = src.slice(reconcileOpen, matchingBraceEnd(src, reconcileOpen) + 1);
  assert.match(
    reconcileBody,
    /Table\.findOneAndUpdate\(\s*\{ tableNo: updated\.tableNo, \.\.\.FREE_TABLE_FILTER \}/,
    "the re-occupy write itself must be conditional on FREE_TABLE_FILTER",
  );
  assert.ok(
    !/Table\.findOneAndUpdate\(\s*\{\s*tableNo: updated\.tableNo\s*\}/.test(reconcileBody),
    "no unguarded occupy of the destination may exist in the reconciliation block",
  );

  const filterIdx = src.indexOf("const filter = {");
  assert.ok(filterIdx >= 0, "PUT must build its own update filter object");
  const braceOpen = src.indexOf("{", filterIdx);
  const braceClose = matchingBraceEnd(src, braceOpen);
  const filterBody = src.slice(braceOpen + 1, braceClose);

  // Mutation this catches: dropping the tableNo term from the CAS filter — a
  // table MOVE (POST .../table) landing between PUT's read and its write
  // would then be silently reversed here, leaving the new table Occupied by
  // nobody (project lesson: reciprocal-cas-guards).
  assert.match(
    filterBody,
    /tableNo:\s*old\.tableNo\s*\?\?\s*\{\s*\$in:\s*\[null,\s*""\]\s*\}/,
    "PUT's CAS filter must carry a tableNo term guarding the field it is about to overwrite",
  );
});

// ── 5. KOTReceipt's "moved" variant suppresses items ─────────────────────────

test('PIN: KOTReceipt\'s "moved" variant shows the TABLE MOVED banner and gates the item list, item count and round-total blocks behind !isMoved — a list of dishes on a kitchen slip is an instruction to cook them', () => {
  const src = stripComments(readSrc(KOT_RECEIPT));

  assert.match(
    src,
    /\*\*\* TABLE MOVED \*\*\*/,
    "the moved variant must show the *** TABLE MOVED *** banner",
  );
  assert.match(
    src,
    /DO NOT MAKE AGAIN/,
    "the moved variant must warn the kitchen not to remake the food",
  );

  // Mutation this catches: un-gating the item list (e.g. dropping the
  // `!isMoved &&` wrapper) — a moved slip would then print every dish, which
  // reads to a cook as an instruction to cook them again.
  assert.match(
    src,
    /\{!isMoved && \(\s*<div className="space-y-2">\s*\{items\.map\(\(item, i\) => \(/,
    "the item list block must be gated behind `!isMoved && (` immediately wrapping the items.map",
  );

  // Mutation this catches: un-gating the item-count line — even a bare count
  // ("7 item(s)") on a moved slip still reads as something to prepare.
  assert.match(
    src,
    /\{!isMoved && \(\s*<div className="text-center text-\[0\.86em\]">\s*\{items\.reduce\(\(n, it\) => n \+ it\.qty, 0\)\} item\(s\)/,
    "the item-count block must be gated behind `!isMoved && (` immediately wrapping the items.reduce count",
  );

  // Mutation this catches: un-gating the round-total line — it is meaningless
  // (and misleading) on a slip that lists no items and represents no round.
  assert.match(
    src,
    /\{!isMoved && cfg\.showTotal && cfg\.showPrices && \(\s*<div className="text-center text-\[0\.86em\] font-semibold">\s*Round total: \{inr\(roundTotal\)\}/,
    "the round-total block must be gated behind `!isMoved && cfg.showTotal && cfg.showPrices && (`",
  );
});

// ── 6. MoveTableDialog prints via a KOTReceipt sibling of <Dialog> ──────────

test('PIN: MoveTableDialog renders KOTReceipt with variant="moved", and its off-screen print node is a SIBLING of <Dialog>, not nested inside it', () => {
  const src = stripComments(readSrc(MOVE_TABLE_DIALOG));

  const dialogCloseIdx = src.indexOf("</Dialog>");
  assert.ok(dialogCloseIdx >= 0, "the component must render a <Dialog>...</Dialog>");

  const kotReceiptIdx = src.indexOf("<KOTReceipt");
  assert.ok(kotReceiptIdx >= 0, "the component must render <KOTReceipt");

  // Mutation this catches: moving the off-screen print node back inside
  // <DialogContent> — closing the dialog unmounts it (Radix, no forceMount),
  // which would yank the very node react-to-print is cloning, in the same
  // tick the mutation resolves and printSlip() fires.
  assert.ok(
    kotReceiptIdx > dialogCloseIdx,
    "the <KOTReceipt> print node must appear AFTER the closing </Dialog> tag — a sibling, not a descendant, of <Dialog>",
  );

  const kotReceiptWindow = src.slice(kotReceiptIdx, kotReceiptIdx + 250);
  assert.match(
    kotReceiptWindow,
    /variant="moved"/,
    'the off-screen KOTReceipt must be rendered with variant="moved"',
  );
});

// ── 7. GET sorts by displayOrder/tableNo; PATCH is admin; POST computes its own displayOrder ──

test("PIN: GET /api/tables sorts by displayOrder then tableNo, PATCH requires requireAdmin, and POST's displayOrder is computed server-side and spread AFTER parsed.data so a client-supplied value could never win", () => {
  const src = stripComments(readSrc(TABLES_ROUTE));

  const getStart = src.indexOf("export async function GET");
  const postStart = src.indexOf("export async function POST");
  const patchStart = src.indexOf("export async function PATCH");
  assert.ok(
    getStart >= 0 && postStart > getStart && patchStart > postStart,
    "GET, POST and PATCH must all exist, in this order",
  );

  const getBody = src.slice(getStart, postStart);
  const postBody = src.slice(postStart, patchStart);
  const patchBody = src.slice(patchStart);

  // Mutation this catches: sorting only by tableNo (or dropping displayOrder
  // from the sort entirely) — the operator's hand arrangement (Tables screen
  // → Arrange) would then never actually change what order tables appear in.
  assert.match(
    getBody,
    /\.sort\(\{ displayOrder: 1, tableNo: 1 \}\)/,
    "GET must sort by displayOrder then tableNo — the hand arrangement wins, name is only the tie-break",
  );

  // Mutation this catches: swapping requireAdmin for requireAuth on PATCH —
  // arranging the floor plan is config (same seam as POST/PATCH/DELETE on a
  // table), not a staff-facing live-status action.
  assert.match(
    patchBody,
    /const authed = await requireAdmin\(\);/,
    "PATCH /api/tables must guard with requireAdmin",
  );

  // Mutation this catches: reordering `{ ...parsed.data, displayOrder, ... }`
  // to `{ displayOrder, ...parsed.data, ... }` — spreading parsed.data FIRST
  // is what lets the server-computed values win if a client ever slipped a
  // displayOrder (or publicToken, CR2.1) key past createTableSchema; the
  // reverse order would let the client's value silently override them.
  // publicToken joined the literal in CR2.1: every new table mints its QR
  // token server-side (lib/public-token.ts), same discipline as displayOrder.
  assert.match(
    postBody,
    /Table\.create\(\{ \.\.\.parsed\.data, displayOrder, publicToken \}\)/,
    "POST must create the table with the server-computed displayOrder and publicToken spread AFTER parsed.data",
  );
});

// ── 8. TableArrangeList sends the whole list, not a pair ────────────────────

test('PIN: TableArrangeList persists the whole reordered list via useReorderTables, not a pair of indices — a per-tap partial update could not express "where everything else ends up"', () => {
  const src = stripComments(readSrc(TABLE_ARRANGE_LIST));

  const moveStart = src.indexOf("const move = (index: number, dir: -1 | 1) => {");
  assert.ok(moveStart >= 0, "the move() handler must exist");
  const braceOpen = src.indexOf("{", moveStart);
  const braceClose = matchingBraceEnd(src, braceOpen);
  const moveBody = src.slice(braceOpen, braceClose);

  // Mutation this catches: calling reorder.mutate with just the swapped pair
  // (e.g. indices, or [tableNo, targetTableNo]) instead of the whole
  // rebuilt array — the PATCH route's reorderTablesSchema and reorderOps both
  // expect and require the FULL ordered list, not a delta.
  // (The mutate call also carries a per-call onError rollback — pinned
  // separately below — so this matches the argument, not the whole call.)
  assert.match(
    moveBody,
    /setOrder\(next\);\s*reorder\.mutate\(next[,)]/,
    "move() must call reorder.mutate(next) with the whole locally-rebuilt array, right after setOrder(next)",
  );
  // Mutation this catches: passing a pair/delta as the FIRST argument. `next` is
  // built by copying `order` and swapping two entries, so pinning that
  // construction is what proves the argument is the full list.
  assert.match(
    moveBody,
    /const next = \[\.\.\.order\];\s*\[next\[index\], next\[target\]\] = \[next\[target\], next\[index\]\];/,
    "next must be the whole current order with exactly two entries swapped",
  );
});

// ── 9. displayOrder carries no schema default ────────────────────────────────

test("PIN: models/Table.ts's displayOrder schema field has no `default:` — an un-arranged cafe must keep exactly today's name ordering, never get backfilled to an assigned position", () => {
  const src = stripComments(readSrc(TABLE_MODEL));

  assert.match(
    src,
    /displayOrder: \{ type: Number, min: 0 \},/,
    "displayOrder must be declared exactly as `{ type: Number, min: 0 }` in the schema",
  );

  // Mutation this catches: adding a `default: 0` (or any default) — Mongo
  // sorts a MISSING field before any value, so a default would flip every
  // pre-existing table to the BOTTOM of a cafe that has never arranged its
  // floor plan, silently reordering the POS table picker with no user action.
  assert.ok(
    !/displayOrder:\s*\{[^}]*default/.test(src),
    "the displayOrder field definition must never include a `default:` — its absence on old docs is what keeps name order intact",
  );
});

// ── 9. Review fixes (adversarial review of this same change) ────────────────
// Each pin below corresponds to a defect that was FOUND and FIXED during review.
// They are the regression net for bugs this feature actually shipped with once.

test("PIN: a destination the order ALREADY holds is not a conflict — the move's no-match branch 409s only when the table belongs to someone else, and re-asserts its own claim otherwise (a stranded retry could never complete)", () => {
  const src = stripComments(readSrc(ORDER_TABLE_ROUTE));
  const noMatchIdx = src.indexOf("if (!claimed)");
  assert.ok(noMatchIdx >= 0, "the route must handle a failed destination claim");
  const open = src.indexOf("{", noMatchIdx);
  const body = src.slice(open, matchingBraceEnd(src, open) + 1);

  // Mutation this catches: returning the 409 unconditionally (what shipped
  // first). A first attempt whose order write was lost leaves the destination
  // pointing at THIS order; an unconditional reject made every retry fail with
  // "already running a bill" about the order's own claim, stranding the tab on
  // its old table with no path forward except an admin on the Tables screen.
  assert.match(
    body,
    /if \(dest\.currentOrderId !== order\.orderId\) \{\s*return failure\(/,
    "the taken-table 409 must be gated on the destination belonging to a DIFFERENT order",
  );
  // And the fall-through must re-assert our claim, guarded on our own pointer,
  // so a half-written state cannot leave the table reading free under a live tab.
  assert.match(
    body,
    /freeTableFilter\(to, order\.orderId\),\s*occupyUpdate\(order\.orderId\)/,
    "the already-ours path must re-assert the claim via freeTableFilter(to, orderId) + occupyUpdate(orderId)",
  );
});

test("PIN: DELETE /api/orders/[id] frees the table named by the DELETED document, never by the earlier read — a move landing between the two would otherwise strand the real table Occupied forever", () => {
  const src = stripComments(readSrc(ORDER_ROUTE));
  const deleteIdx = src.indexOf("export async function DELETE");
  assert.ok(deleteIdx >= 0, "DELETE handler must exist");
  const body = src.slice(deleteIdx);

  assert.match(
    body,
    /\{ tableNo: deleted\.tableNo, currentOrderId: deleted\.orderId \}/,
    "the table release must be keyed on the document as it was at removal (`deleted`)",
  );
  assert.ok(
    !/tableNo: order\.tableNo, currentOrderId: order\.orderId/.test(body),
    "the pre-delete snapshot must not be what decides which table gets freed",
  );
});

test("PIN: MoveTableDialog's print-once guard is keyed on the slip OBJECT, not on order id + destination — a tab moved T1→T2→T1→T2 in one mount must still print every slip", () => {
  const src = stripComments(readSrc(MOVE_TABLE_DIALOG));
  assert.match(
    src,
    /printedSlipRef\.current === slip/,
    "the guard must compare slip identity, so every fresh move prints",
  );
  // Mutation this catches: going back to a composite string key, which repeats
  // for a destination this order has already been moved to — the kitchen then
  // silently gets no slip for that move.
  assert.ok(
    !/slip\.order\._id\}:\$\{slip\.order\.tableNo/.test(src),
    "an order-id + destination string key must never come back as the print guard",
  );
});

test("PIN: OrderDetailSheet hands the moved order back to its parent — without it the sheet keeps its pre-move snapshot and its own KOT button prints the table the guests just LEFT", () => {
  const src = stripComments(readSrc(ORDER_DETAIL_SHEET));
  const dialogIdx = src.indexOf("<MoveTableDialog");
  assert.ok(dialogIdx >= 0, "the sheet must render MoveTableDialog");
  const element = src.slice(dialogIdx, src.indexOf("/>", dialogIdx));
  assert.match(
    element,
    /onMoved=\{\(moved\) => onSettled\?\.\(moved\)\}/,
    "the moved order must flow back through the sheet's refresh channel",
  );
});

test("PIN: the POS Move-table button is blocked while an order write is in flight — react-to-print keeps ONE fixed-id iframe, so a move slip racing a round's KOT can delete the other job", () => {
  // CR2.3 S0 split — this button now lives in PosHeader.tsx (a pure props-in
  // lift out of pos/page.tsx), so this pin moved with it, plus a reachability
  // check that pos/page.tsx actually feeds the header the LIVE order-write
  // state rather than a stray literal (CR2.1's dead-hook lesson).
  const src = stripComments(readSrc(POS_HEADER));
  assert.match(
    src,
    /disabled=\{!resumedOrder\.tableNo \|\| isBusy\}/,
    "the Move-table trigger must be gated on both a table to move from AND no in-flight order write",
  );

  const posSrc = stripComments(readSrc(POS_PAGE));
  assert.match(posSrc, /<PosHeader\b/, "pos/page.tsx must render <PosHeader");
  assert.match(
    posSrc,
    /resumedOrder=\{pos\.resumedOrder\}/,
    "pos/page.tsx must feed PosHeader the live resumedOrder",
  );
  assert.match(posSrc, /isBusy=\{pos\.isBusy\}/, "pos/page.tsx must feed PosHeader the live isBusy flag");
});

test("PIN: TableArrangeList restores the previous order when a save fails — the re-seed effect cannot do it (a failed save leaves the server order unchanged, so its key never changes)", () => {
  const src = stripComments(readSrc(TABLE_ARRANGE_LIST));
  assert.match(
    src,
    /reorder\.mutate\(next, \{ onError: \(\) => setOrder\(previous\) \}\)/,
    "the optimistic swap must be rolled back explicitly on failure",
  );
});
