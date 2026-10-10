// Why a new file: the create route's post-insert follow-ups lived inline in the
// route, where nothing could run them against fake deps and every new follow-up
// (CB-7's reward progress is the next) would have grown a route already past its
// weight. This is the settle-followups.ts shape for the create route: a DI deps
// object, one runner, runnable without a database.
//
// Everything here runs only AFTER the order insert has landed, so none of it may
// fail the request (a 5xx would invite a retry and a duplicate order): the six
// writes run together via allSettled and every failure but the bill numbering is
// absorbed by the route (only `numbered` is read back — a missing number answers
// 503 so the client sends again). Drift in the rest is repairable: a missed
// ledger delta through the customer reconcile route, a stuck table from the
// Tables screen, a stale "my rewards" row is cosmetic.
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import type { ISettings } from "@/models/Settings";
import { issueBillNumbers, type NumberedOrder } from "@/lib/slip-numbers";
import { planHasWork, type BillNumberingPlan } from "@/lib/gst-invoice";
import { ledgerContribution } from "@/lib/order";
import { backfillPromoRedemptionOrderId } from "@/lib/order-request-accept-promo";
import { markAssignedRewardUsed } from "@/lib/assigned-reward-gate";
import { advanceRewardProgress } from "@/lib/reward-progress";
import cache from "@/lib/cache";

type LedgerInput = Parameters<typeof ledgerContribution>[0];
type OrderRef = Parameters<typeof issueBillNumbers>[0];

// Pay Now saves a bill already Completed; only such a bill counts a ladder step on create.
const ORDER_STATUS_COMPLETED = "Completed";

/** A promo code and the mobile its fence row is keyed on, or null when the route has no such write to make. */
export interface PromoWrite {
  code: string;
  mobile: string;
}

/** What the post-insert block reads: the landed order, the numbering plan and the route's precomputed promo gates. */
export interface CreateFollowUpInput {
  landed: { _id: OrderRef; orderId: string; status: string; createdAt: Date; total: number };
  settings: ISettings | null;
  numbering: BillNumberingPlan;
  customerId?: string | null;
  tableNo?: string;
  /** The inputs of ledgerContribution — the runner skips the write when it is all zero. */
  ledger: LedgerInput;
  /** Set when the claimed fence row should learn which order consumed the code. */
  promoTrace: PromoWrite | null;
  /** Set when an ASSIGNED reward code was spent by this order. */
  promoSpent: PromoWrite | null;
}

export interface CreateFollowUpDeps {
  issueBillNumbers: typeof issueBillNumbers;
  backfillPromoRedemptionOrderId: typeof backfillPromoRedemptionOrderId;
  markAssignedRewardUsed: typeof markAssignedRewardUsed;
  advanceRewardProgress: typeof advanceRewardProgress;
  incCustomerLedger(customerId: string, c: { visits: number; spend: number; due: number }): Promise<unknown>;
  /** The claim: occupy the table ONLY if it is currently free. */
  occupyTable(tableNo: string, orderId: string): Promise<unknown>;
}

export const CREATE_FOLLOW_UP_DEPS: CreateFollowUpDeps = {
  issueBillNumbers,
  backfillPromoRedemptionOrderId,
  markAssignedRewardUsed,
  advanceRewardProgress,
  incCustomerLedger: (customerId, c) =>
    Customer.findByIdAndUpdate(customerId, { $inc: { visits: c.visits, totalSpend: c.spend, totalDue: c.due } }),
  // Occupy the table ONLY if it is currently free, so two staff can't claim
  // the same table and overwrite each other's currentOrderId.
  occupyTable: (tableNo, orderId) =>
    Table.findOneAndUpdate({ tableNo, status: "Available" }, { status: "Occupied", currentOrderId: orderId }),
};

/**
 * The six writes that follow a landed create, in one allSettled wave. Never
 * rejects; only the bill-numbering result is returned (the route answers 503 on
 * a rejection and prints from its value).
 * The result names NumberedOrder on purpose: ReturnType<typeof issueBillNumbers>
 * reads the LAST (generic) overload and collapses to unknown, which would untype
 * the route's `numbered.value` without a single tsc error.
 */
export async function runCreateFollowUps(
  input: CreateFollowUpInput,
  deps: CreateFollowUpDeps = CREATE_FOLLOW_UP_DEPS,
): Promise<{ numbered: PromiseSettledResult<NumberedOrder | null> }> {
  const { landed, settings, numbering, customerId, tableNo, ledger, promoTrace, promoSpent } = input;
  // A held "Unpaid" open tab contributes nothing yet (ledgerContribution → 0);
  // its visit/spend/due land at settlement. Every other order contributes now.
  const applyLedger = async (): Promise<void> => {
    if (!customerId) return;
    const c = ledgerContribution(ledger);
    if (!(c.visits || c.spend || c.due)) return;
    await deps.incCustomerLedger(customerId, c);
    cache.del("customers");
  };
  // CB-7 S2 — a Pay Now counter bill (already Completed) takes its reward-ladder
  // step here; an open tab counts later, when it is settled. Swallowed:
  // advanceRewardProgress PROPAGATES, and a missed step is a counter
  // conversation. The loyalty STAMP grant stays absent on create on purpose
  // (plan FLAGS #7 — not fixed unless the owner asks).
  const advanceProgress = async (): Promise<void> => {
    if (landed.status !== ORDER_STATUS_COMPLETED || !customerId) return;
    try {
      const result = await deps.advanceRewardProgress(settings, customerId, {
        orderId: landed.orderId,
        createdAt: landed.createdAt,
        total: landed.total, // RUPEES, as on the settle path
      });
      if (result.counted) cache.del("customers");
    } catch {
      // Swallowed on purpose — see above. No console.* in app/lib code.
    }
  };
  const occupyTable = async (): Promise<void> => {
    if (!tableNo) return;
    await deps.occupyTable(tableNo, landed.orderId);
    cache.del("tables");
  };
  const [numbered] = await Promise.allSettled([
    // This insert WON, so a Pay Now bill takes its number now — exactly once
    // per order: a twin that lost on the send key adopted above, unnumbered.
    planHasWork(numbering) ? deps.issueBillNumbers(landed._id, numbering) : Promise.resolve(null),
    // CB-5D part 2 — the fence's trace (which order consumed this code). The
    // claim above IS the fence; this only makes it readable to staff/ops.
    promoTrace ? deps.backfillPromoRedemptionOrderId(promoTrace.code, promoTrace.mobile, landed.orderId) : null,
    // CB-5D part 2 (owner decision) — the ASSIGNED code is now SPENT, so it
    // leaves the diner's "my rewards" list; a failure costs a stale list row.
    promoSpent ? deps.markAssignedRewardUsed(promoSpent.code, promoSpent.mobile, landed.orderId, new Date()) : null,
    applyLedger(),
    occupyTable(),
    advanceProgress(),
  ]);
  return { numbered };
}
