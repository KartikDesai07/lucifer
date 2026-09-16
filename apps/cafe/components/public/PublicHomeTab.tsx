"use client";

import { ClipboardList, LogIn, ReceiptText, Stamp, UtensilsCrossed } from "lucide-react";

import type { PublicOrderRequestStatusData } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import type { DinerStampCard } from "@/lib/diner-loyalty";
import type { HomeLastOrder } from "@/components/public/public-home-data";

// S7 — the diner Home tab: an app-feel landing surface for the TAB (never the
// QR-scan screen — Menu stays the landing tab; see the owner decision in the
// slice brief). Presentational only, like PublicRewardsTab: the shell already
// holds `{diner, stampCard}` from GET /api/public/diner/me and passes it down
// as props — this component fetches nothing.
//
// The loyalty section here is a SUMMARY, not a re-render of the Rewards tab:
// it reuses DinerStampCard's already-derived toNextReward/rewardsReady/
// unitLabel fields rather than re-deriving any stamp math, and it deliberately
// does not draw the ladder detail that tab owns.

// EXHAUSTIVE by construction — a new request status fails tsc here rather
// than rendering a raw enum value onto the Home card. Plain English, matching
// the words PublicMyOrdersTab already shows for the same states.
const LAST_ORDER_STATUS_WORDS: Record<PublicOrderRequestStatusData["status"], string> = {
  pending: "Waiting for the counter",
  accepting: "Being prepared",
  accepted: "Accepted",
  rejected: "This one was cancelled",
};

interface PublicHomeTabProps {
  signedIn: boolean;
  dinerName: string;
  stampCard: DinerStampCard | null;
  lastOrder: HomeLastOrder | null;
  orderingAllowed: boolean;
  onBrowseMenu: () => void;
  onRepeatLast: () => void;
  onOpenOrders: () => void;
  onSignIn: () => void;
}

function unitWord(count: number, unitLabel: string): string {
  return count === 1 ? unitLabel : `${unitLabel}s`;
}

export function PublicHomeTab({
  signedIn,
  dinerName,
  stampCard,
  lastOrder,
  orderingAllowed,
  onBrowseMenu,
  onRepeatLast,
  onOpenOrders,
  onSignIn,
}: PublicHomeTabProps) {
  const greeting = signedIn && dinerName.length > 0 ? `Hi, ${dinerName}` : "Welcome";

  return (
    <div className="space-y-pub-gap p-pub-pad">
      <div>
        <h1 className="text-xl font-semibold">{greeting}</h1>
        <p className="text-sm text-muted-foreground">What would you like to do today?</p>
      </div>

      <Button
        className={`w-full justify-start gap-pub-gap ${PUBLIC_TOUCH_TARGET_CLASS}`}
        onClick={onBrowseMenu}
      >
        <UtensilsCrossed className="h-5 w-5 shrink-0" aria-hidden="true" />
        Browse the menu
      </Button>

      {/* Menu-only cafes must show no ordering affordance at all — not a
          disabled card, HIDDEN entirely. */}
      {orderingAllowed && lastOrder && (
        <button
          type="button"
          onClick={onRepeatLast}
          className={`flex w-full items-center justify-between gap-pub-gap rounded-lg border p-pub-pad text-left ${PUBLIC_TOUCH_TARGET_CLASS}`}
        >
          <span className="flex items-center gap-pub-gap">
            <ReceiptText className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Order again</span>
              <span className="block text-xs text-muted-foreground">
                {lastOrder.itemCount} {lastOrder.itemCount === 1 ? "item" : "items"} · {inr(lastOrder.total)}
              </span>
              {/* What actually HAPPENED to that order. A rejected one still
                  makes a fine reorder — the kitchen may simply have been
                  closed — but the diner must be told, not quietly invited to
                  repeat an order the cafe refused (review 2026-09-13). */}
              <span className="block text-xs text-muted-foreground">
                {LAST_ORDER_STATUS_WORDS[lastOrder.status]}
              </span>
            </span>
          </span>
        </button>
      )}

      {stampCard && (
        <div className="rounded-lg border p-pub-pad">
          <div className="flex items-center gap-pub-gap">
            <Stamp className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium">Your rewards</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {stampCard.rewardsReady > 0
              ? stampCard.rewardsReady > 1
                ? `You have ${stampCard.rewardsReady} rewards ready to claim`
                : "You have a reward ready to claim"
              : stampCard.toNextReward === 1
                ? `One more ${stampCard.unitLabel} and your next reward is ready`
                : `${stampCard.toNextReward} more ${unitWord(stampCard.toNextReward, stampCard.unitLabel)} to your next reward`}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenOrders}
        className={`flex w-full items-center gap-pub-gap rounded-lg border p-pub-pad text-left ${PUBLIC_TOUCH_TARGET_CLASS}`}
      >
        <ClipboardList className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">Your orders</span>
      </button>

      {!signedIn && (
        <button
          type="button"
          onClick={onSignIn}
          className={`flex w-full items-center justify-center gap-pub-gap rounded-lg border border-dashed p-pub-pad ${PUBLIC_TOUCH_TARGET_CLASS}`}
        >
          <LogIn className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">Sign in to save your orders and collect rewards</span>
        </button>
      )}
    </div>
  );
}
