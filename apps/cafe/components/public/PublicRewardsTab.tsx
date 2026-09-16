"use client";

import { useEffect, useState } from "react";

import { Check, Circle, Stamp } from "lucide-react";

import { inr } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import {
  clearRequestedRewardAt,
  readAppliedPromoCode,
  readRequestedRewardAt,
  writeRequestedRewardAt,
} from "@/components/public/public-cart-store";
import type { DinerStampCard } from "@/lib/diner-loyalty";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

// CB-4 / CB-5A S6 — the diner's Rewards tab: the stamp card, what it is worth,
// and what happens next.
//
// CB-5A adds an OPTIONAL layer on top of the original CB-4 single-reward
// card: a milestone LADDER (card.ladder.length > 1). A cafe that never
// configures one renders byte-identical to the pre-CB-5A screen — see the
// `card.ladder.length <= 1` branch below.
//
// CB-5B S8 — the tab is no longer read-only: an AFFORDABLE rung (the diner
// has >= `at` stamps this cycle) can be selected as this order's reward
// claim. The selection is an INTENT ONLY (the milestone's `at`, never an
// amount or a dish — see buildOrderRequestBody/use-public-cart-submit.ts,
// which read it back out of the SAME store to build the POST body) and it is
// bridged through public-cart-store.ts rather than props: PublicOrderFlow
// (which owns the Cart) sits between this tab and PublicDinerShell, so a
// prop chain would mean reaching into a component this slice does not own.

// How many stamp dots to draw before falling back to a plain count. A card
// configured at 30 stamps would otherwise render a wall of circles on a
// 360px-wide phone.
const MAX_DRAWN_STAMPS = 12;

interface PublicRewardsTabProps {
  loading: boolean;
  signedIn: boolean;
  card: DinerStampCard | null;
  onSignIn: () => void;
}

function rewardWorth(reward: { kind: ResolvedMilestone["kind"]; value: number; item: string }): string {
  const { kind, value, item } = reward;
  if (kind === "item") return item.length > 0 ? item : "a free item";
  if (kind === "percent") return `${value}% off your bill`;
  return `${inr(value)} off your bill`;
}

function unitWord(count: number, unitLabel: string): string {
  return count === 1 ? unitLabel : `${unitLabel}s`;
}

// The claim affordance itself, shared by the ladder view (LadderStep) and the
// single-reward-ready card below. `affordable` is the diner's own
// >= `at` stamps test; `promoApplied` is owner decision D6/A2's mutual
// exclusion (a promo code applied in the cart blocks every rung, and vice
// versa — see PublicCart.tsx/use-public-cart-submit.ts for the other side).
function RewardClaimControl({
  at,
  affordable,
  promoApplied,
  selectedAt,
  onSelect,
}: {
  at: number;
  affordable: boolean;
  promoApplied: boolean;
  selectedAt: number | null;
  onSelect: (at: number | null) => void;
}) {
  const selected = selectedAt === at;

  if (!affordable) {
    return <p className="mt-2 text-xs text-muted-foreground">Not enough stamps yet.</p>;
  }
  if (promoApplied && !selected) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Remove your promo code in the cart to claim this reward.
      </p>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      className={cn("mt-2", PUBLIC_TOUCH_TARGET_CLASS)}
      onClick={() => onSelect(selected ? null : at)}
    >
      {selected ? (
        <>
          <Check className="h-4 w-4" aria-hidden="true" /> Selected for this order
        </>
      ) : (
        "Claim with this order"
      )}
    </Button>
  );
}

// One step on the ladder: reached (Check), or upcoming (Circle). Distance to
// an upcoming step is shown only on the NEXT one — the research brief's
// "explicit progress to next threshold", not repeated on every future step.
function LadderStep({
  milestone,
  cyclePosition,
  isNext,
  promoApplied,
  selectedAt,
  onSelect,
}: {
  milestone: ResolvedMilestone;
  cyclePosition: number;
  isNext: boolean;
  promoApplied: boolean;
  selectedAt: number | null;
  onSelect: (at: number | null) => void;
}) {
  const reached = milestone.at <= cyclePosition;
  return (
    <div className={cn("rounded-lg border p-pub-pad", reached && "border-primary bg-primary/5")}>
      <div className="flex items-center gap-pub-gap">
        {reached ? (
          <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {milestone.at} in: {rewardWorth(milestone)}
          </p>
          {isNext && !reached && (
            <p className="text-xs text-muted-foreground">{milestone.at - cyclePosition} more to reach this</p>
          )}
        </div>
      </div>
      <RewardClaimControl
        at={milestone.at}
        affordable={reached}
        promoApplied={promoApplied}
        selectedAt={selectedAt}
        onSelect={onSelect}
      />
    </div>
  );
}

export function PublicRewardsTab({ loading, signedIn, card, onSignIn }: PublicRewardsTabProps) {
  // Hydrated from the store on mount so a diner who picked a reward, left the
  // tab, and came back still sees it selected — and so a promo applied while
  // this tab wasn't mounted is picked up the moment it is.
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const [promoApplied, setPromoApplied] = useState(false);

  useEffect(() => {
    setSelectedAt(readRequestedRewardAt());
    setPromoApplied(readAppliedPromoCode() !== null);
  }, []);

  function selectReward(at: number | null) {
    if (at === null) {
      clearRequestedRewardAt();
    } else {
      writeRequestedRewardAt(at);
    }
    setSelectedAt(at);
  }

  if (loading) {
    return (
      <div className="space-y-pub-gap p-pub-pad">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (!signedIn || !card) {
    return (
      <div className="p-pub-pad">
        <EmptyState
          icon={<Stamp className="h-8 w-8" aria-hidden="true" />}
          title="Collect stamps on every visit"
          description="Sign in with your mobile number to start collecting stamps and earn a free reward."
          action={
            <Button className={PUBLIC_TOUCH_TARGET_CLASS} onClick={onSignIn}>
              Sign in
            </Button>
          }
        />
      </div>
    );
  }

  const isLadder = card.ladder.length > 1;

  const drawn = Math.min(card.stampsPerReward, MAX_DRAWN_STAMPS);
  // Progress within the CURRENT card, not the lifetime total: a diner on their
  // third card should see 2/8, not 18/8.
  const filled = card.stampsPerReward > 0 ? card.stamps % card.stampsPerReward : 0;
  // A completed card reads as full rather than as an empty new one — the
  // moment a diner earns a reward is the moment this screen must celebrate,
  // not reset to zero.
  const showFull = card.rewardsReady > 0 && filled === 0;
  // The one upcoming step the ladder highlights with "N more to reach this" —
  // every OTHER upcoming step states its own `at` but not a countdown.
  const nextLadderAt = card.ladder.find((m) => m.at > card.cyclePosition)?.at;
  // card.reward mirrors the LAST ladder milestone (resolveLoyaltyConfig
  // derives rewardKind/rewardValue/rewardItem from it), so the "ready to
  // claim" banner below claims that SAME milestone — the ladder always has
  // at least one entry even for a legacy flat-fields cafe, so this is only
  // undefined when the owner deleted every reward row (the
  // `card.ladder.length === 0` branch below).
  const readyRewardAt = card.ladder[card.ladder.length - 1]?.at;

  return (
    <div className="space-y-pub-gap p-pub-pad">
      {!isLadder ? (
        <div className="rounded-lg border p-pub-pad">
          <p className="text-sm text-muted-foreground">Your stamp card</p>
          <p className="mt-1 text-2xl font-semibold">
            {showFull ? card.stampsPerReward : filled} / {card.stampsPerReward}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden="true">
            {Array.from({ length: drawn }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-6 w-6 rounded-full border",
                  (showFull ? card.stampsPerReward : filled) > i ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
          {card.stampsPerReward > MAX_DRAWN_STAMPS && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {MAX_DRAWN_STAMPS} of {card.stampsPerReward} stamps.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border p-pub-pad">
          <p className="text-sm text-muted-foreground">Your reward ladder</p>
          <p className="mt-1 text-2xl font-semibold">
            {card.cyclePosition} {unitWord(card.cyclePosition, card.unitLabel)}
          </p>
          <div className="mt-3 space-y-1.5">
            {card.ladder.map((milestone) => (
              <LadderStep
                key={milestone.at}
                milestone={milestone}
                cyclePosition={card.cyclePosition}
                isNext={milestone.at === nextLadderAt}
                promoApplied={promoApplied}
                selectedAt={selectedAt}
                onSelect={selectReward}
              />
            ))}
          </div>
        </div>
      )}

      {card.ladder.length === 0 ? (
        // FIX C — the owner deleted every reward row. dinerStampCard already
        // zeroes rewardsReady/toNextReward for this case (lib/diner-loyalty.ts),
        // but the stale reward copy below must never render even so — an
        // explicit guided state instead, never a claim the cafe didn't make.
        <p className="text-sm text-muted-foreground">
          No reward set up yet. Keep collecting {card.unitLabel}s — the cafe will let you know once a reward is ready.
        </p>
      ) : card.rewardsReady > 0 ? (
        <div className="rounded-lg border border-primary bg-primary/5 p-pub-pad">
          <p className="font-medium">
            {card.rewardsReady > 1
              ? `You have ${card.rewardsReady} rewards ready`
              : "You have a reward ready"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add {rewardWorth(card.reward)} to your next order, or show this screen at the counter.
          </p>
          {/* Ladder mode already shows a claim button on the rung itself
              (LadderStep above) — a second one here would be a duplicate for
              the SAME reward, so this only appears for a flat (non-ladder)
              card. */}
          {!isLadder && readyRewardAt !== undefined && (
            <RewardClaimControl
              at={readyRewardAt}
              affordable
              promoApplied={promoApplied}
              selectedAt={selectedAt}
              onSelect={selectReward}
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {card.toNextReward === 1
            ? `One more ${card.unitLabel} and your next reward is `
            : `${card.toNextReward} more ${unitWord(card.toNextReward, card.unitLabel)} and your next reward is `}
          {rewardWorth(card.reward)}.
        </p>
      )}

      {card.lifetime > 0 && (
        <p className="text-xs text-muted-foreground">
          You have collected {card.lifetime} {unitWord(card.lifetime, card.unitLabel)} here in total.
        </p>
      )}
    </div>
  );
}
