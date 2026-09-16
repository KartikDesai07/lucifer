import { Order, type IOrder } from "@/models/Order";
import type { IOrderRequest } from "@/models/OrderRequest";
import { Customer, type ICustomer } from "@/models/Customer";
import { isDuplicateKeyError } from "@pos/shared/api";
import { generateOrderId, dayRange } from "@/lib/utils";
import { bumpOrderSequenceTo } from "@/models/Counter";
import type { GstConfig } from "@/lib/receipt";
import {
  TAB_CHANGED_ERROR,
  buildAddRoundFilter,
  findByRequestId,
  reject,
  finalizeAccept,
} from "@/lib/order-request-accept-core";

// Third sibling of lib/order-request-accept.ts / -core.ts (CR2.2 SLICE 4 +
// arbiter-confirmed review fixes) — split out purely to stay under the
// ~300-line file budget after the fixes landed. Holds the race-repair
// helpers that both branches (add-round here, create/parcel in
// order-request-accept.ts itself) call into: guardedReject (FIX1),
// applyAddRound (the add-round write built on it), createOrFindCustomer
// (FIX7), and recoverOrderCreate (the create path's own dup-key repair,
// moved here from -core.ts for the same line-budget reason). None of these
// decide WHICH branch to run — order-request-accept.ts stays the one
// orchestrator. gstConfigDrifted and isSourceRequestIdsDuplicate (bottom of
// this file, CR2.2d split) moved here from -core.ts purely for ITS own
// line-budget reason — same discipline, no logic changed.
//
// CB-5B S7 split — acceptAddRoundBranch (the add-round target's own
// orchestration, which CR2.2d had parked here) moved OUT to a fifth sibling,
// lib/order-request-accept-addround.ts, purely for this file's line budget:
// the three-kind discount logic S7 adds would not fit here. The WRITE it ends
// in (applyAddRound) stays below, beside the other race-repair helpers, and
// that new file imports it from here.

// FIX1 — the loser-reject race. Every validation-failure/CAS-miss reject that
// can run concurrently with ANOTHER accept attempt's own write for this SAME
// requestId (a retried/duplicate call re-entering "accepting" — step 2 of
// acceptOrderRequest is deliberately re-enterable) must repair-before-revert:
// Mongo serializes the competing findOneAndUpdates on the Order document, so
// if a winner's write already landed, this loser's own miss/failure strictly
// follows it — a subsequent findByRequestId read here is guaranteed to see
// it. Reverting to "pending" WITHOUT this check would strand an
// already-applied request at a non-terminal status forever. Mirrors the
// step-7 dup-key repair (applyAddRound/recoverOrderCreate) exactly.
export type GuardedRejectDecision = "replay" | "revert";

// Pure decision half of guardedReject, split out so it's directly
// unit-testable without a DB — mirrors decideOnStatus's own DB-free
// decision-table discipline (order-request-accept-core.ts).
export function guardedRejectDecision(orderExists: boolean): GuardedRejectDecision {
  return orderExists ? "replay" : "revert";
}

export async function guardedReject(
  requestId: string,
  actor: string,
  error: string,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean } | { error: string; status: 409 }> {
  const winner = await findByRequestId(requestId);
  return guardedRejectDecision(winner != null) === "replay" && winner
    ? finalizeAccept(winner, requestId, actor, true)
    : reject(requestId, error);
}

// The add-round write itself — the CAS attempt, its TAB_CHANGED_ERROR miss
// (now guardedReject'd, FIX1 above), and the step-7 sourceRequestIds
// dup-key repair, unchanged in behavior from the pre-fix version.
export async function applyAddRound(
  openTab: Pick<IOrder, "_id" | "kotRounds" | "voids">,
  update: Record<string, unknown>,
  requestId: string,
  actor: string,
): Promise<{ order: IOrder; request: IOrderRequest; replayed: boolean } | { error: string; status: 409 }> {
  try {
    const updated = await Order.findOneAndUpdate(buildAddRoundFilter(openTab, requestId), update, {
      new: true,
      runValidators: true,
    });
    if (!updated) return guardedReject(requestId, actor, TAB_CHANGED_ERROR);
    return finalizeAccept(updated, requestId, actor, false);
  } catch (e) {
    // A concurrent accept already folded this request into SOME order
    // (sourceRequestIds collision) — hand back what it produced.
    if (isDuplicateKeyError(e) && isSourceRequestIdsDuplicate(e)) {
      const winner = await findByRequestId(requestId);
      if (winner) return finalizeAccept(winner, requestId, actor, true);
    }
    throw e;
  }
}

// FIX7 — a Customer.create race: another accept (or a walk-in checkout) can
// mint the same mobile between the caller's existingCustomer lookup and this
// create. mobile is unique on Customer, so that surfaces as E11000; re-read
// the row that won instead of failing the whole accept over a race that
// already resolved itself. Any other failure rethrows unchanged.
export async function createOrFindCustomer(name: string, mobile: string): Promise<ICustomer> {
  try {
    return await Customer.create({ name, mobile });
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    const found = await Customer.findOne({ mobile });
    if (found) return found;
    throw e;
  }
}

// Recovery for the create-path's Order.create call (moved here from -core.ts
// purely for the line budget — the FIRST create attempt itself stays in
// order-request-accept.ts). Two distinct E11000s land here: a sourceRequestIds
// collision means a concurrent accept already won (hand back their order),
// anything else is the ordinary daily-counter race POST /api/orders already
// retries once (bump the counter past today's true last order and retry).
// CB-5B S8 — the caller's chance to MOVE anything keyed on the orderId when
// this function re-numbers the order. Called exactly once, with the NEW id,
// after a duplicate-key rejection has proved the first insert wrote nothing
// and before the retry insert runs. Returns false when the re-key could not be
// completed (the reward's stamps were taken by another device in between), and
// the caller gets `rewardUnfunded` instead of an order.
//
// This exists because a stamp claim's marker is keyed on the orderId: a claim
// left behind on the abandoned number would be unrefundable by the cancel path
// and would stop fencing the order that actually landed.
export interface RecoverOrderCreateHooks {
  onRekey: (retryOrderId: string) => Promise<boolean>;
}

export async function recoverOrderCreate(
  e: unknown,
  doc: Record<string, unknown>,
  requestId: string,
  actor: string,
  hooks?: RecoverOrderCreateHooks,
): Promise<
  | { order: IOrder }
  | { order: IOrder; request: IOrderRequest; replayed: true }
  | { rewardUnfunded: true }
> {
  if (!isDuplicateKeyError(e)) throw e;
  if (isSourceRequestIdsDuplicate(e)) {
    const winner = await findByRequestId(requestId);
    if (winner) return finalizeAccept(winner, requestId, actor, true);
    throw e;
  }
  const { start, end } = dayRange();
  const last = await Order.findOne({ createdAt: { $gte: start, $lte: end } })
    .sort({ orderId: -1 })
    .select("orderId")
    .lean();
  const lastSeq = last?.orderId ? parseInt(last.orderId.split("-").pop() ?? "", 10) : 0;
  const seq2 = await bumpOrderSequenceTo(Number.isFinite(lastSeq) ? lastSeq : 0);
  const retryOrderId = generateOrderId(seq2);
  // Re-key BEFORE the retry insert: the claim must already sit on the number
  // the order is about to carry, never be moved onto it afterwards (a throw in
  // between would then leave a landed order with no claim behind it).
  if (hooks && !(await hooks.onRekey(retryOrderId))) return { rewardUnfunded: true };
  const order = await Order.create({ ...doc, orderId: retryOrderId });
  return { order };
}

// FIX5 — the diner's quote (buildRequestDoc) was priced against LIVE
// settings at submit time; an add-round bills against the TAB's own frozen
// GST snapshot (gstConfigFromOrder). If the two disagree, the cafe changed
// its GST config after the diner quoted but before staff accepted — the
// consented total is simply wrong, and no per-line price compare can catch
// it (GST is not a line field). Moved here from -core.ts (CR2.2d split)
// purely for the line budget — order-request-accept.ts is its only caller.
export function gstConfigDrifted(tabCfg: GstConfig, liveCfg: GstConfig): boolean {
  return (
    tabCfg.gstEnabled !== liveCfg.gstEnabled ||
    tabCfg.gstRate !== liveCfg.gstRate ||
    tabCfg.gstMode !== liveCfg.gstMode
  );
}

// Distinguishes a sourceRequestIds collision (a concurrent accept already
// folded THIS request into an order) from an orderId collision (the ordinary
// daily-counter race POST /api/orders already retries once) — both surface as
// the same E11000, but only the former calls for the step-7 repair lookup.
// Moved here from -core.ts (CR2.2d split) purely for the line budget — this
// file (applyAddRound/recoverOrderCreate above) is its only caller now.
export function isSourceRequestIdsDuplicate(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const kp = (e as { keyPattern?: unknown }).keyPattern;
  return typeof kp === "object" && kp !== null && "sourceRequestIds" in kp;
}
