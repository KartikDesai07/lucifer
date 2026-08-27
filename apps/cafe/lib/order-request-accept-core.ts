import type { FilterQuery } from "mongoose";
import { releasePromoRedemption } from "@/lib/order-request-accept-promo";
import { Order, type IOrder } from "@/models/Order";
import { OrderRequest, type IOrderRequest, type OrderRequestStatus, type OrderRequestTargetKind } from "@/models/OrderRequest";
import { Table } from "@/models/Table";
import { buildFallbackRequest } from "@/lib/order-request-accept-fallback";
import cache from "@/lib/cache";
import { orderSummaryCacheKey } from "@/lib/utils";
import { FREE_TABLE_FILTER } from "@/lib/table-admin";
import { voidGuardFilter } from "@/lib/order-void";
import { pendingCutoff } from "@/lib/order-request-intake";

// Sibling of lib/order-request-accept.ts (CR2.2 SLICE 4) — split out because
// the accept bridge's full behavior (mirroring TWO routes' write semantics
// plus CAS fencing) does not fit the ~300-line file budget in one file. This
// half holds the DB-free PURE decision/shape helpers (directly unit-tested)
// plus the small async CAS/lookup primitives the orchestrator composes —
// nothing here decides WHICH branch to run, only what each branch needs.

export const REQUEST_REJECTED_ERROR = "This order request was already rejected";
export const REQUEST_GONE_ERROR = "This order request no longer exists";
export const TABLE_STATE_CONFLICT_ERROR = (tableNo: string) =>
  `Table "${tableNo}" is marked occupied but has no open bill — free it on the Tables screen, then accept again.`;
export const TAB_CHANGED_ERROR = "Tab changed or already settled — reopen it and try again";
export const REQUEST_TOO_OLD_ERROR =
  "This request is over 12 hours old — reject it and ask the diner to order again.";

// Read-side twin of the DB-level fence (models/Order.ts's unique+sparse
// multikey index on sourceRequestIds is the write-side half) — a CAS term so
// a request already folded into some OTHER order's tab can't apply twice.
export function acceptGuardFilter(requestId: string): { sourceRequestIds: { $ne: string } } {
  return { sourceRequestIds: { $ne: requestId } };
}

// ── Pure decision/shape helpers (DB-free, directly unit-tested) ─────────────

export type AcceptTarget = "parcel" | "add-round" | "create" | "table-conflict";

// hasOpenTab/tableFree only matter for targetKind "table" — "parcel" returns
// before either is consulted.
export function classifyTarget(
  targetKind: OrderRequestTargetKind,
  hasOpenTab: boolean,
  tableFree: boolean,
): AcceptTarget {
  if (targetKind === "parcel") return "parcel";
  if (hasOpenTab) return "add-round";
  return tableFree ? "create" : "table-conflict";
}

export type ReplayDecision = "replay" | "gone" | "rejected";

// The decision table for a request already at a terminal(-ish) status,
// reached both at step 1 and after a step-2 CAS miss. `orderExists` is
// passed in (never queried here) so the table itself stays DB-free:
// accepted+order found → replay; accepted+no order → gone (data corruption
// or a very unlucky read); rejected → rejected, regardless of any order.
export function decideOnStatus(status: OrderRequestStatus, orderExists: boolean): ReplayDecision | null {
  if (status === "accepted") return orderExists ? "replay" : "gone";
  if (status === "rejected") return "rejected";
  return null; // pending/accepting — proceed with the CAS/accept flow
}

// §1 — the total the diner consented to on the menu page; a mismatch means
// menu/table state moved since submit. (The add-round path compares LINE
// prices only, never a whole-order total — an open tab's total also carries
// earlier rounds it never quoted.) Split out purely so this specific
// create-path comparison is directly unit-testable without a DB.
//
// The ONE tolerated delta (field bug 2026-08-20): a request quoted WITHOUT
// the table charge (charge-once said a sibling pending request / open tab
// already carried it) can still be the FIRST one staff accepts — several
// same-table requests sit in the tray and staff must be free to tap ANY of
// them. In that case the create recompute legitimately exceeds the quote by
// EXACTLY the live charge: accept it, and this order carries the table's
// one-time charge instead of its sibling. Whichever accept order staff picks,
// the TABLE's total converges to the same figure (the sibling then lands as
// an add-round, which never re-adds the charge). A quote that DID carry a
// charge tolerates nothing — any delta there is a real price/charge change.
export function createTotalsMatchQuote(
  computedTotal: number,
  computedCharge: number,
  quotedTotal: number,
  quotedCharge: number,
): boolean {
  if (computedTotal === quotedTotal) return true;
  return quotedCharge === 0 && computedCharge > 0 && computedTotal === quotedTotal + computedCharge;
}

// FIX4 — the bridge's age gate. Reuses intake's OWN pending-TTL cutoff (the
// same clock its prune sweep ages un-actioned rows out on) so the two can
// never disagree about what "too old" means. Strictly older-than (not >=):
// a request created EXACTLY at the cutoff is still acceptable.
export function isRequestTooOld(createdAt: Date, now: number): boolean {
  return createdAt.getTime() < pendingCutoff(now).getTime();
}

// FIX6 — the diner's note, carried onto the Order. Shared by both branches:
// the create path calls this with `existingNotes` undefined (there is no tab
// yet), the add-round path passes the tab's own current notes so the diner's
// note is APPENDED, never overwriting whatever staff already wrote there.
export function mergedNote(existingNotes: string | undefined, requestNote: string | undefined): string | undefined {
  if (!requestNote) return existingNotes;
  return existingNotes ? `${existingNotes} | ${requestNote}` : requestNote;
}

// The add-round CAS filter, built exactly like /api/orders/[id]/items/route.ts
// (status/payment/kotRounds/voidGuardFilter) PLUS acceptGuardFilter.
// REQUIRED reciprocal-CAS note (CR1.3 discipline): this filter carries the
// items route's own guard terms, so a writer of Order.items that skipped them
// would re-introduce the re-bill-a-voided-line bug; no other writer touches
// sourceRequestIds, so the acceptGuardFilter term alone completes the guard
// against a double accept.
export function buildAddRoundFilter(
  old: Pick<IOrder, "_id" | "kotRounds" | "voids">,
  requestId: string,
): FilterQuery<IOrder> {
  return {
    _id: old._id,
    status: "Pending",
    payment: "Unpaid",
    kotRounds: old.kotRounds ?? 0,
    ...voidGuardFilter(old.voids?.length ?? 0),
    ...acceptGuardFilter(requestId),
  };
}

// Positional kotNumbers build, mirroring /api/orders/[id]/items/route.ts:
// written at index `round - 1`, never appended; a SHORT/missing existing
// array fills the gap with 0 (never-numbered sentinel) instead of shifting
// later rounds down.
export function buildKotNumbers(
  oldKotNumbers: number[] | undefined,
  round: number,
  ticket: number | undefined,
): number[] | undefined {
  if (ticket === undefined) return undefined;
  return Array.from({ length: round }, (_, i) =>
    i === round - 1 ? ticket : (oldKotNumbers?.[i] ?? 0),
  );
}

// ── Small async CAS/lookup primitives (thin — no branch decisions) ─────────

export async function findByRequestId(requestId: string): Promise<IOrder | null> {
  return Order.findOne({ sourceRequestIds: requestId });
}

// A DEFINITE in-process validation failure (never an ambiguous throw) — safe
// to revert, unlike the client-side never-revert-on-write-throw discipline,
// which exists because a throw does not say whether the write landed. Every
// caller reverts only after a synchronous check has already decided the
// request cannot proceed — nothing here is "maybe it worked".
export async function reject(requestId: string, error: string): Promise<{ error: string; status: 409 }> {
  await OrderRequest.findOneAndUpdate({ _id: requestId, status: "accepting" }, { $set: { status: "pending" } });
  // A fence THIS attempt claimed but never turned into an order is handed
  // back (keyed requestId + orderId-absent — see the helper), or a failed
  // add-round would consume the customer's once-per-customer code forever
  // with no bill behind it (review MED #4). No-op when nothing was claimed.
  await releasePromoRedemption(requestId);
  return { error, status: 409 };
}

// FIX3 — pure decision half of ensureTableClaim, split out so it's directly
// unit-testable without a DB: a table is only worth claiming for a dine-in
// order that's still open and unsettled — a parcel/add-round order never
// matches (an open tab's table is already Occupied by definition).
export function shouldClaimTable(order: Pick<IOrder, "tableNo" | "status" | "payment">): boolean {
  return Boolean(order.tableNo) && order.status === "Pending" && order.payment === "Unpaid";
}

export function tableClaimFilter(tableNo: string): { tableNo: string; status: "Available" } {
  return { tableNo, status: "Available" };
}

// FIX3 — repairs the table claim the crash window between Order.create and
// the request mark otherwise skips (create-path's own claim only runs once,
// at creation time, and a repaired accept reaches finalizeAccept without
// ever running it). No-op once claimed — status:"Available" won't match.
export async function ensureTableClaim(order: IOrder): Promise<void> {
  if (!order.tableNo || !shouldClaimTable(order)) return;
  try {
    await Table.findOneAndUpdate(tableClaimFilter(order.tableNo), {
      status: "Occupied",
      currentOrderId: order.orderId,
    });
    cache.del("tables");
  } catch {
    /* best-effort — see comment above */
  }
}

// FIX2 — pure filter-shape half of finalizeAccept's CAS: "pending" joins
// "accepting" since a racing guardedReject can leave the row there mid-flight.
//
// CR2.2 fix round (billed-but-rejected race) — "rejected" ALSO joins the set:
// an Order carrying this requestId PROVABLY exists at every finalizeAccept
// call site, so a reject that raced the order write and landed "rejected"
// moments earlier must still lose here — the alternative is a billed Order
// whose request permanently reads "rejected" (finalizeAccept never retries).
// "rejected" is reachable here ONLY inside that seconds-wide race — step 1's
// terminal-status short-circuit and the step-2 claim CAS both already refuse
// a long-settled rejected request before it ever nears finalizeAccept.
export function finalizeCasFilter(requestId: string): FilterQuery<IOrderRequest> {
  return { _id: requestId, status: { $in: ["accepting", "pending", "rejected"] } };
}

// Step 8 — mark accepted, CAS-guarded on status:"accepting" so a concurrent
// finisher (the step-7 dup-key repair race) can never double-write this
// transition; if a competitor already won it, this re-reads what they left.
//
// buildFallbackRequest (finalizeAccept's synthesized-request fallback for the
// pruned-mid-flight case below) moved to lib/order-request-accept-fallback.ts
// — a CR2.3 mechanical split to stay under the ~300-line budget after the D9
// acceptedKotRound stamp landed. Zero behavior change: still the ONE caller,
// just imported back in above.

export async function finalizeAccept(
  order: IOrder,
  requestId: string,
  actor: string,
  replayed: boolean,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean }> {
  // FIX3 — repairs the table claim on every path that reaches here,
  // including the repair paths that never ran the create-path's own claim.
  await ensureTableClaim(order);

  // FIX2 — finalizeCasFilter also accepts "pending" (a racing guardedReject
  // can revert this request there between ITS OWN findByRequestId miss and
  // this write landing); once an Order provably carries this requestId,
  // "accepted" is the truth regardless of what a loser left behind.
  const marked = await OrderRequest.findOneAndUpdate(
    finalizeCasFilter(requestId),
    { $set: { status: "accepted", acceptedOrderId: order.orderId, acceptedAt: new Date(), actor } },
    { new: true },
  );
  const reread = marked ?? (await OrderRequest.findById(requestId));
  // FIX2 — pruned mid-flight: pruneOrderRequests (lib/order-request-intake.ts)
  // can delete this exact row between the CAS above and the re-read if it
  // straddled a TTL cutoff at the wrong instant. The Order is real and
  // already carries this requestId — synthesize the response's request half
  // (buildFallbackRequest, imported above) instead of 500ing staff out of an
  // accept that actually worked.
  const request: IOrderRequest = reread ?? buildFallbackRequest(order, requestId, actor, new Date());

  // CR2.3 D9 — stamp the auto-print marker (read later by lib/pos-pulse.ts's
  // claimKotPrint). `!replayed`: a replayed accept can find the winner order
  // several KOT rounds ahead of the one THIS request caused, so only the
  // original finalize may stamp `order.kotRounds`. `$exists:false`: idempotent
  // under a retried finalize — never overwrite an already-stamped round.
  if (!replayed) {
    await OrderRequest.updateOne(
      { _id: requestId, acceptedKotRound: { $exists: false } },
      { $set: { acceptedKotRound: order.kotRounds } },
    );
  }

  cache.del(orderSummaryCacheKey());
  return { order, request, replayed };
}

export async function replayAccepted(
  requestId: string,
  request: IOrderRequest,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: true } | { error: string; status: 404 }> {
  const order = await findByRequestId(requestId);
  return decideOnStatus("accepted", order != null) === "replay" && order
    ? { order, request, replayed: true }
    : { error: REQUEST_GONE_ERROR, status: 404 };
}

// Live open-tab/table-free state for a "table" targetKind — untouched for
// "parcel" (which never needs either).
export async function resolveOpenTabState(request: IOrderRequest) {
  if (request.targetKind !== "table" || !request.tableNo) return { openTab: null, tableFree: true };
  const openTab = await Order.findOne({ tableNo: request.tableNo, status: "Pending", payment: "Unpaid" })
    .sort({ createdAt: -1 })
    .lean();
  if (openTab) return { openTab, tableFree: true };
  const tableFree = (await Table.exists({ tableNo: request.tableNo, ...FREE_TABLE_FILTER })) != null;
  return { openTab: null, tableFree };
}
