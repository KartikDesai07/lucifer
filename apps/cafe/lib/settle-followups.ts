// Why a new file: the settle route ran its post-CAS follow-ups one after
// another, unguarded — a ledger throw turned a settle that had ALREADY LANDED
// into a 500 and skipped the table free after it (the table stayed Occupied
// behind a paid bill). Nothing existing runs "best-effort after a committed
// write" for this route; these are its follow-ups, runnable with fake deps.
//
// Everything here runs only AFTER the settle CAS has landed, so none of it may
// fail the settle (owner decision O4): the four run together via allSettled,
// each failure is absorbed, and the table free never waits on the ledger. A
// missed ledger delta is repaired through the customer reconcile route, the
// same rule the create route already follows; a stuck table is freed by hand
// from the Tables screen; a missed stamp or reward-ladder step is a counter
// conversation.
import { Table } from "@/models/Table";
import type { ISettings } from "@/models/Settings";
import { reconcileLedger } from "@/lib/order";
import { grantStampForSettledOrder } from "@/lib/diner-loyalty-earn";
import { advanceRewardProgress } from "@/lib/reward-progress";

type LedgerTab = Parameters<typeof reconcileLedger>[0];

/** The slice of a settled order these follow-ups read. */
export type SettledTab = LedgerTab & { orderId: string; tableNo?: string; createdAt: Date };

export interface SettleFollowUpDeps {
  reconcileLedger(old: LedgerTab, updated: LedgerTab): Promise<Set<string>>;
  grantStampForSettledOrder: typeof grantStampForSettledOrder;
  advanceRewardProgress: typeof advanceRewardProgress;
  freeTable(tableNo: string, orderId: string): Promise<unknown>;
}

export const SETTLE_FOLLOW_UP_DEPS: SettleFollowUpDeps = {
  reconcileLedger,
  grantStampForSettledOrder,
  advanceRewardProgress,
  // Free the table only if it still points to this order.
  freeTable: (tableNo, orderId) =>
    Table.findOneAndUpdate({ tableNo, currentOrderId: orderId }, { status: "Available", currentOrderId: "" }),
};

/**
 * Ledger, loyalty stamp, reward-ladder step and table free for a settle whose
 * CAS landed. Never rejects. `customersTouched` is true when the customers cache
 * must drop: the ledger moved someone, a stamp was granted, a ladder step was
 * counted, or the ledger outcome is unknown.
 */
export async function runSettleFollowUps(
  old: SettledTab,
  updated: SettledTab,
  settings: ISettings,
  deps: SettleFollowUpDeps = SETTLE_FOLLOW_UP_DEPS,
): Promise<{ customersTouched: boolean }> {
  // CB-4 — one loyalty stamp for this settled bill, at most once per order.
  // Swallowed on purpose: the write is idempotent (a filter-predicate guard on
  // stampOrders), so a retry of the settle cannot double-stamp either.
  const grantStamp = async (): Promise<boolean> => {
    let stamped = false;
    try {
      const granted = await deps.grantStampForSettledOrder(
        settings,
        updated.customerId ? String(updated.customerId) : null,
        updated.orderId,
        // RUPEES — models/Order.ts's total is a plain Number. Do NOT convert:
        // the Int32 paise shape is models/order.ledger.ts, which the settle
        // never reads (see lib/diner-loyalty.ts's unit note).
        updated.total,
      );
      stamped = granted.granted;
    } catch {
      // Swallowed on purpose — see above. No console.* in app/lib code.
    }
    return stamped;
  };
  // CB-7 S2 — one reward-ladder step for this settled bill. Swallowed like the
  // stamp: advanceRewardProgress PROPAGATES, and its own CAS makes a retry of
  // the settle count the order at most once.
  const advanceProgress = async (): Promise<boolean> => {
    let counted = false;
    try {
      const result = await deps.advanceRewardProgress(
        settings,
        updated.customerId ? String(updated.customerId) : null,
        // RUPEES, same unit note as the stamp grant above.
        { orderId: updated.orderId, createdAt: updated.createdAt, total: updated.total },
      );
      counted = result.counted;
    } catch {
      // Swallowed on purpose — see above. No console.* in app/lib code.
    }
    return counted;
  };
  const [ledger, stamped, stepped] = await Promise.allSettled([
    deps.reconcileLedger(old, updated),
    grantStamp(),
    advanceProgress(),
    updated.tableNo ? deps.freeTable(updated.tableNo, updated.orderId) : Promise.resolve(),
  ]);
  const ledgerTouched = ledger.status === "rejected" || ledger.value.size > 0;
  return {
    customersTouched:
      ledgerTouched ||
      (stamped.status === "fulfilled" && stamped.value) ||
      (stepped.status === "fulfilled" && stepped.value),
  };
}
