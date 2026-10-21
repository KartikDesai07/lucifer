"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import { rungOffers, pickDefaultRung, type RungOffer } from "@/lib/reward-rungs";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import { REWARD_NEEDS_NEW_ITEMS, staffCardReward, type StaffRewardCard } from "@pos/shared/reward-card-use";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { cardOffers, type CardBillLine, type CardOffer } from "@/lib/reward-card-offers";
import { canCarryClaim, hasOrderReward } from "@/lib/order-reward-fence";
import type { DiscountUnit } from "@/lib/pos-cart-props";
import type { Order } from "@/types";
import type { CustomerRewardsResponse } from "@/app/api/customers/[id]/rewards/route";

// CB-5B S9 — the STAFF counter's read of a customer's stamp balance + ladder.
// Uncached server-side (route's own doc comment) and given a SHORT client
// staleTime here too: `stamps` moves on every settle/cancel. This hook's key
// sits under the "customers" root, so useCreateOrder/useAddOrderItems/
// useSettleOrder's existing `invalidateQueries({queryKey: CUSTOMER_KEYS.all})`
// already prefix-matches and busts it on every order write — this staleTime
// only bounds staleness BETWEEN writes (a second terminal, same customer).
export const CUSTOMER_REWARDS_KEYS = {
  detail: (customerId: string) => ["customers", customerId, "rewards"] as const,
};

// Exported standalone (not just for useRewardSelection below) — the query
// key is exported too, so a future invalidation can target it directly.
export function useCustomerRewards(customerId: string | undefined) {
  return useQuery({
    queryKey: CUSTOMER_REWARDS_KEYS.detail(customerId ?? ""),
    queryFn: () => apiGet<CustomerRewardsResponse>(`/api/customers/${customerId}/rewards`),
    enabled: !!customerId,
    staleTime: STALE_TIMES.CUSTOMER_SEARCH,
    gcTime: GC_TIMES.DEFAULT,
  });
}

export interface RewardSelection {
  // Named to match CartProps' `rewardLoading` 1:1 (lib/pos-cart-props.ts).
  rewardLoading: boolean;
  stamps: number | undefined;
  rewardOffers: RungOffer[];
  // The reward already granted on a resumed tab (D9: one per order) — shown
  // as the selection but never re-sent (see `pendingRewardAt`).
  existingRewardAt: number | null;
  // TRUE while the resumed tab already carries a reward. The picker must render
  // READ-ONLY in that state: an Order holds one reward, and the add-round route
  // 409s a second claim, so every other rung is unreachable. Without this the
  // chips still look tappable and a tap is a silent no-op — the counter would
  // believe it had switched rungs. A reader gated on state, not a bare
  // `disabled` attribute.
  rewardLocked: boolean;
  // What CartReward should render as selected: the granted one while locked,
  // else this session's own in-progress pick.
  selectedRewardAt: number | null;
  // What a create/add-round payload should actually carry: never on a locked
  // (already-rewarded) tab, `undefined` (omit) rather than `null` otherwise.
  pendingRewardAt: number | undefined;
  // The selected rung as a redemption snapshot, for usePosTotals to PREVIEW the
  // bill with. Display only — it is never sent (the wire carries `at` alone,
  // and the server re-resolves everything). A locked tab reports the reward the
  // order already stores, so a resumed rewarded tab prices like its own bill.
  selectedReward: RedeemedReward | undefined;
  onSelectReward: (at: number | null) => void;
  // CB-7 S5 — the diner's scratch cards. NEVER auto-armed (R7: using a card is an explicit act); picking one clears a
  // picked rung and the reverse; a tab that already carries a reward locks both pickers.
  cardOffers: CardOffer[];
  // Shown as selected: the card the resumed tab already carries while locked, else this session's own pick.
  selectedCardId: string | null;
  // What a create / add-round payload carries: undefined when locked, blocked, a discount is on, or nothing picked.
  pendingCardId: string | undefined;
  // The picked card, for the preview and the applied row.
  selectedCard: StaffRewardCard | undefined;
  onSelectCard: (id: string | null) => void;
  // P2 (UI): a resumed tab that opened with a promo code. It already holds the bill's one reward-family benefit, so
  // BOTH pickers stand down (and the GST preset is refused on it). G1: also a resumed tab with nothing unsent. null = free.
  rewardBlockedReason: string | null;
  promoLocked: boolean;
  onManualDiscountRaw: (value: number) => void;
  onManualDiscountUnit: (unit: DiscountUnit) => void;
  manualDiscountActive: boolean;
}

// CB-5B S9 — composes the customer-rewards fetch, the A3/D7 auto-default +
// invalidation-safety rules, and the A2/D6 mutual-exclusion wiring into ONE
// call, so use-pos-tab.ts (SURGICAL, line-budget-capped) only owns the plain
// `useState` the spec pins plus this one hook.
//
// `rewardAt`/`setRewardAt` are OWNED by the caller (use-pos-tab.ts) — this
// hook reads/writes them but never holds them, since resetOrder/enterResume
// need to clear them alongside the rest of that file's own tab state.
export function useRewardSelection(
  customer: { _id: string } | undefined,
  billTotal: number,
  resumedOrder: Order | null,
  rewardAt: number | null,
  setRewardAt: (at: number | null) => void,
  discountRaw: number,
  discountUnit: DiscountUnit,
  setDiscountRaw: (value: number) => void,
  setDiscountUnit: (unit: DiscountUnit) => void,
  lines: readonly (CardBillLine & { kotRound: number })[],
  // The promo code typed on the cart right now (null = none). A fresh cart has no resumed order, so the marker alone misses it.
  promoCode: string | null,
): RewardSelection {
  const customerId = customer?._id;
  const rewards = useCustomerRewards(customerId);
  // `billTotal` is the caller's `total` (usePosTotals) — the client-side
  // equivalent of the billTotal each server route gates minBill against
  // (POST /api/orders' plainTotals.total pre-reward; the add-round route's
  // full-item-set total): both match usePosTotals' own formula, and
  // `subtotal` already sums fired + unfired lines on a resumed tab.
  const rewardOffers = rungOffers(rewards.data?.rungs ?? [], billTotal);

  // A tab resumed with its own reward snapshot already spent — no second
  // claim is possible (the add-round route 409s it), so `rewardAt` (this
  // session's pending intent) must never be treated as one for that tab.
  const existingRewardAt = resumedOrder?.rewardAt ?? null;
  // CB-7 S5 — a card order stores no rewardAt, so the lock reads the whole one-reward predicate (kind, rung, card).
  const locked = resumedOrder ? hasOrderReward(resumedOrder) : false;
  // P2 + F6 — a promo on the bill blocks every reward picker (and the stamp auto-default below): a resumed tab's marker, or a
  // code typed on the cart (fresh or resumed). The same flag disables the GST preset in Cart.tsx.
  const promoLocked = resumedOrder?.promoCode !== undefined || promoCode !== null;
  // G1 — a NEW pick needs a round to carry its claim (D9: never at settle); else it would settle as a manual discount.
  const noRound = !canCarryClaim(resumedOrder, lines);
  const blocked = locked || promoLocked || noRound;

  // The scratch-card pick, tagged with the customer and tab it was made for so it can never ride onto another.
  const tabKey = resumedOrder?._id ?? null;
  const [cardPick, setCardPick] = useState<{ id: string; customerId?: string; tabKey: string | null } | null>(null);
  const offersNow = cardOffers(rewards.data?.cards ?? [], billTotal, lines, Date.now());

  // A2/D6: a manual ₹/%/GST discount is on the bill. Hoisted ABOVE the
  // auto-default effect because the effect must not arm a reward against one —
  // a reward and a manual discount are mutually exclusive, so auto-arming here
  // would spend the customer's stamps for a discount the bill never shows
  // (CartReward renders only the "remove the discount" line in this state, so
  // the selection would be invisible while still riding on the payload).
  const manualDiscountActive = discountRaw > 0 || discountUnit === "GST";

  // See the file-level rationale below the exports for why this needs a ref,
  // not a plain "nothing selected" check, to avoid re-stomping an override.
  const autoPickedRef = useRef(false);
  const lastCustomerRef = useRef(customerId);
  if (lastCustomerRef.current !== customerId) {
    lastCustomerRef.current = customerId;
    autoPickedRef.current = false;
  }
  useEffect(() => {
    // G1 — no round to carry the claim: an armed rung stands down like the manual-discount branch below, so the next
    // unsent item re-runs the auto-default and removing it disarms again.
    if (noRound && rewardAt !== null) {
      setRewardAt(null);
      autoPickedRef.current = false;
    }
    if (blocked) return;
    // A2/D6 — never auto-arm against an active manual discount. Staff may
    // still pick one deliberately (onSelectReward clears the discount as it
    // goes); what must never happen is the reward arming itself behind a
    // discount the operator just typed.
    if (manualDiscountActive) {
      // ...and an ALREADY-armed auto-pick must stand down when a discount
      // appears, or it rides silently onto the payload.
      if (rewardAt !== null) {
        setRewardAt(null);
        autoPickedRef.current = false;
      }
      return;
    }
    if (rewardAt !== null) {
      // INVALIDATION SAFETY: a selection that dropped out of `offers` (bill
      // fell below its minBill after an item was removed) or is no longer
      // `usable` must be cleared — sending it is a guaranteed 400.
      if (!rewardOffers.some((o) => o.rung.at === rewardAt && o.usable)) {
        setRewardAt(null);
        autoPickedRef.current = false;
      }
      return;
    }
    // AUTO-DEFAULT (A3/D7), exactly once per "nothing selected" stretch:
    // `autoPickedRef` remembers a pick already ran, so a manual deselect
    // (staff taps the picked rung again) is never silently re-filled by the
    // next tick — `rewardOffers` is a fresh array every render/refetch.
    if (autoPickedRef.current) return;
    const best = pickDefaultRung(rewardOffers);
    if (best) {
      setRewardAt(best.rung.at);
      autoPickedRef.current = true;
    }
  }, [rewardOffers, rewardAt, setRewardAt, blocked, manualDiscountActive, noRound]);

  // The pick that still stands: same customer and tab, still usable on THIS bill, no manual discount on top.
  const pickedOffer =
    cardPick && cardPick.customerId === customerId && cardPick.tabKey === tabKey && !manualDiscountActive && !noRound
      ? offersNow.find((o) => o.card.id === cardPick.id && o.usable)
      : undefined;
  useEffect(() => {
    if (cardPick !== null && !pickedOffer) setCardPick(null);
  }, [cardPick, pickedOffer]);

  // A2/D6 mutual exclusion, client side (the server fences this too). Reused
  // by both use-pos-tab.ts's returned setters — see the file-level note.
  const onManualDiscountRaw = (value: number) => {
    setRewardAt(null);
    setDiscountRaw(value);
  };
  const onManualDiscountUnit = (unit: DiscountUnit) => {
    setRewardAt(null);
    setDiscountUnit(unit);
  };
  const onSelectReward = (at: number | null) => {
    // The READER is gated, not merely the chip: a locked tab's reward is
    // already spent and unswappable (the route 409s a second claim), so a tap
    // that slipped past a `disabled` attribute must still change nothing here.
    if (blocked) return;
    if (at !== null) {
      setDiscountRaw(0);
      setDiscountUnit("₹");
      setCardPick(null);
    }
    setRewardAt(at);
  };
  const onSelectCard = (id: string | null) => {
    // Gated on the reader like onSelectReward; also stands the stamp auto-default down for good (an explicit choice,
    // or an explicit un-choice, is never second-guessed by the next tick).
    if (blocked) return;
    autoPickedRef.current = true;
    if (id !== null) {
      setDiscountRaw(0);
      setDiscountUnit("₹");
      setRewardAt(null);
    }
    setCardPick(id === null ? null : { id, customerId, tabKey });
  };

  // The rung currently driving the preview: this session's pick, matched back
  // against the offers so a stale `rewardAt` (one that dropped out of the
  // ladder) can never price a bill.
  const selectedOffer = rewardOffers.find((o) => o.rung.at === rewardAt && o.usable);

  return {
    rewardLoading: rewards.isLoading,
    stamps: rewards.data?.stamps,
    rewardOffers,
    existingRewardAt,
    rewardLocked: locked,
    selectedRewardAt: locked ? existingRewardAt : rewardAt,
    // DEFENCE IN DEPTH, not a duplicate of the effect above: the effect is a
    // behaviour that runs after a render, so between typing a discount and the
    // effect standing the selection down there is a window in which a tap on
    // "Send to Kitchen" would still carry it. This derivation is evaluated at
    // the moment the payload is built, so the two states can never both reach
    // the wire — A2/D6 on the READER, not just on the control.
    pendingRewardAt: blocked || manualDiscountActive || pickedOffer ? undefined : rewardAt ?? undefined,
    // PREVIEW ONLY, and deliberately `undefined` on a LOCKED tab even though
    // the order carries a reward: enterResume/applyTabUpdate already copy the
    // server's own re-clamped `order.discount` into `discountRaw`, so that tab
    // is ALREADY pricing its reward through the manual arm. Returning a reward
    // here too would apply the same money twice and show a total lower than
    // the bill. A fresh (unlocked) pick is the only case the manual arm knows
    // nothing about, so it is the only case that needs the preview.
    selectedReward: blocked || manualDiscountActive
      ? undefined
      : pickedOffer
        ? staffCardReward(pickedOffer.card) ?? undefined
        : selectedOffer
        ? {
            at: selectedOffer.rung.at,
            kind: selectedOffer.rung.kind,
            value: selectedOffer.rung.value,
            item: selectedOffer.rung.item,
          }
        : undefined,
    onSelectReward,
    cardOffers: offersNow,
    selectedCardId: locked ? resumedOrder?.rewardCardId ?? null : pickedOffer?.card.id ?? null,
    pendingCardId: blocked || manualDiscountActive ? undefined : pickedOffer?.card.id,
    selectedCard: pickedOffer?.card,
    onSelectCard,
    rewardBlockedReason: promoLocked ? PROMO_BLOCKS_REWARD : noRound ? REWARD_NEEDS_NEW_ITEMS : null,
    promoLocked,
    onManualDiscountRaw,
    onManualDiscountUnit,
    // The ONE derivation, hoisted above the effect — not a second copy of the
    // predicate, so the UI's "remove the discount" state, the effect's
    // stand-down and the payload fence can never disagree about what "a manual
    // discount is active" means.
    manualDiscountActive,
  };
}
