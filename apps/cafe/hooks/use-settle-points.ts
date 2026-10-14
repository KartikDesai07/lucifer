"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCustomerRewards } from "@/hooks/use-customer-rewards";
import {
  NO_POINTS_HOLD,
  carriedPoints,
  pointsRowState,
  pointsSwitchOn,
  rowWithHold,
  stepPointsHold,
  type PointsRowState,
} from "@/lib/settle-points-view";
import { pointsRedeemedReward } from "@pos/shared/reward-points";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import type { Order } from "@/types";

// CB-7 S6 (§2.7, slice C) — the payment popup's "Use points" switch. Points are spent ONLY at settle or on a Pay Now
// create (status Completed): never on Send to Kitchen or an add-round — so the switch only exists while the popup is
// open and is cleared the moment it closes (otherwise the cart footer would keep a discount no send could carry).

export interface SettlePointsView {
  // Render the row at all: a customer is on the bill and there is something to offer or a reason to give. A walk-in
  // bill, or a customer with no points, shows nothing (a cafe that does not use points never sees the row).
  show: boolean;
  row: PointsRowState;
  // The switch position; the figure it spends is `row.amount`.
  on: boolean;
  // The diner asked for points in the QR cart (owner O2): the row says so.
  asked: boolean;
  // Referentially stable, so the popup's memo keeps working.
  onToggle: (on: boolean) => void;
}

export interface SettlePoints {
  view: SettlePointsView;
  // What this bill spends: row.amount while the switch is on, else 0. Sent as `rewardPoints` (0 = omit).
  amount: number;
  // The same reward the server prices with, for the previews; undefined while off.
  reward: RedeemedReward | undefined;
}

export interface SettlePointsInput {
  customer: { _id: string } | undefined;
  resumedOrder: Order | null;
  // The bill's food total before any discount (the cart's subtotal).
  subtotal: number;
  // The payment popup is open.
  open: boolean;
  promo: boolean;
  // A stamp rung or scratch card is picked on this bill.
  rewardPending: boolean;
  manualDiscount: boolean;
  // A Pay Now send is unconfirmed.
  frozen: boolean;
}

export function useSettlePoints(input: SettlePointsInput): SettlePoints {
  const { customer, resumedOrder, subtotal, open, promo, rewardPending, manualDiscount, frozen } = input;
  // The BILL's customer: a resumed tab spends from its own customer only (the settle route never spends for one attached
  // in the popup), so a customer picked onto a customer-less tab gets no row rather than a switch the server refuses.
  const customerId = resumedOrder ? (resumedOrder.customerId === customer?._id ? resumedOrder.customerId : undefined) : customer?._id;
  // TanStack shares the one request with the reward picker (same key).
  const balance = useCustomerRewards(customerId).data?.points;
  const tabKey = resumedOrder?._id ?? null;

  const row = useMemo(
    () =>
      pointsRowState({
        hasCustomer: customerId !== undefined,
        balance,
        subtotal,
        resumed: resumedOrder,
        promo,
        rewardPending,
        manualDiscount,
        frozen,
      }),
    [customerId, balance, subtotal, resumedOrder, promo, rewardPending, manualDiscount, frozen],
  );

  // The operator's flip, tagged with the customer and tab it was made for (the card-pick pattern in
  // use-customer-rewards.ts) so it can never ride onto another bill.
  const [pick, setPick] = useState<{ customerId: string | undefined; tabKey: string | null; on: boolean } | null>(null);
  const pickStands = pick !== null && pick.customerId === customerId && pick.tabKey === tabKey;
  // Session 2 (owner O2): a QR tab whose diner asked for points starts ON until the operator flips it.
  const asked = resumedOrder?.pointsRequested === true;
  const on = pointsSwitchOn(pickStands ? pick.on : null, asked, row.amount);
  // Clears with the popup, and whenever the pick no longer stands (another customer or tab, an ON with nothing left to
  // offer) — but never while a send is frozen: its replay still carries these points. An OFF stands while the popup is
  // open, so the diner's ask cannot switch it back on.
  useEffect(() => {
    if (pick !== null && (!open || (!frozen && (!pickStands || (pick.on && !on))))) setPick(null);
  }, [pick, open, frozen, pickStands, on]);

  const onToggle = useCallback(
    (next: boolean) => {
      if (!row.usable) return;
      setPick({ customerId, tabKey, on: next });
    },
    [row.usable, customerId, tabKey],
  );

  // A frozen Pay Now replays the request it built: latch what the switch carried when it froze and keep pricing with
  // it, so a balance refetch cannot re-price the bill under the replay. React's "store information from previous
  // renders" pattern (a guarded setState DURING render), so no effect lag lets a refetch land first.
  const live = on && open ? row.amount : 0;
  const [hold, setHold] = useState(NO_POINTS_HOLD);
  const nextHold = stepPointsHold(hold, frozen, live);
  if (nextHold !== hold) setHold(nextHold);
  const amount = carriedPoints(nextHold, frozen, live);
  const shown = useMemo(() => rowWithHold(row, frozen, amount), [row, frozen, amount]);
  const reward = useMemo(() => (amount > 0 ? pointsRedeemedReward(amount) : undefined), [amount]);
  const show = customerId !== undefined && (shown.amount > 0 || shown.reason !== null);
  const view = useMemo(
    () => ({ show, row: shown, on: amount > 0, asked, onToggle }),
    [show, shown, amount, asked, onToggle],
  );
  return { view, amount, reward };
}
