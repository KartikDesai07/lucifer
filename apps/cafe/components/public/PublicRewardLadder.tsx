"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import {
  PUB_PILL_BUTTON_CLASS,
  PUB_SECTION_HEADING_CLASS,
  PUB_TINT_CLASS,
  PUB_TONAL_CARD_CLASS,
} from "@/components/public/public-ui";
import { ladderRungAffordable, rewardWorth, unitWord } from "@/components/public/public-rewards-view";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

// CB-6D-B — the rewards list under the stamp-card hero (owner: "rewards ki
// list neeche alag" — separate cards, NOT vertical steps; the track/markers
// now live on the hero itself, PublicStampTrack). Each milestone is its own
// tonal card: reached-or-not, what it is worth, how far to it, and the claim
// control.

// CB-5B S8 — the tab is no longer read-only: an AFFORDABLE rung (the diner
// has >= `at` stamps TOTAL, the server's own test — see F1 below) can be
// selected as this order's reward claim. The selection is an INTENT ONLY
// (the milestone's `at`, never an amount or a dish) and is bridged through
// public-cart-store.ts by the caller (PublicRewardsTab), never a prop this
// component owns directly.
//
// F1 (CB-6D-B review fix, HIGH) — the claim control used to gate on
// `milestone.at <= cyclePosition` (the CURRENT cycle's display tick), but the
// server (lib/reward-claim.ts) decides eligibility on the diner's TOTAL
// stamp balance. A diner who completed their card (or banked one) could see
// no claim control anywhere. Fix: the display tick stays cyclePosition-based
// (it IS a "this cycle" indicator), but the claim control now gates on the
// NEW `ladderRungAffordable(stamps, milestone.at)` — the same $gte test the
// server runs.

// The claim affordance itself, shared by each reward card and the
// single-reward-ready card in PublicRewardsTab. `affordable` is the diner's
// own >= `at` stamps test; `promoApplied` is owner decision D6/A2's mutual
// exclusion (a promo code applied in the cart blocks every rung, and vice
// versa — see PublicCart.tsx/use-public-cart-submit.ts for the other side).
export function RewardClaimControl({
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
      variant={selected ? "default" : "outline"}
      className={cn("mt-3", PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
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

interface PublicRewardLadderProps {
  ladder: readonly ResolvedMilestone[];
  cyclePosition: number;
  // F1 — the diner's TOTAL stamp balance, used ONLY to gate the claim control
  // (ladderRungAffordable), never the display tick — see the comment below.
  stamps: number;
  unitLabel: string;
  promoApplied: boolean;
  selectedAt: number | null;
  onSelect: (at: number | null) => void;
}

export function PublicRewardLadder({
  ladder,
  cyclePosition,
  stamps,
  unitLabel,
  promoApplied,
  selectedAt,
  onSelect,
}: PublicRewardLadderProps) {
  // The one upcoming reward the list highlights with "N more to go" — every
  // OTHER upcoming reward states its own `at` but not a countdown.
  const nextAt = ladder.find((m) => m.at > cyclePosition)?.at;

  return (
    <div>
      <p className={PUB_SECTION_HEADING_CLASS}>What you can unlock</p>
      <div className="mt-3 space-y-3">
        {ladder.map((milestone) => {
          // reached = this card's CURRENT-CYCLE progress (the display tick);
          // affordable (below) = the diner's TOTAL stamp balance, the
          // server's own eligibility test — they deliberately differ: a
          // diner who banked a full card or is mid-way through a later cycle
          // can be affordable without reached being true yet this cycle.
          const reached = milestone.at <= cyclePosition;
          const isNext = milestone.at === nextAt;
          const toNext = milestone.at - cyclePosition;

          return (
            <div
              key={milestone.at}
              className={cn(PUB_TONAL_CARD_CLASS, "p-5", isNext && "ring-2 ring-primary/40", "flex items-start gap-4")}
            >
              {reached ? (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </span>
              ) : (
                <span
                  className={cn(
                    PUB_TINT_CLASS,
                    "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums",
                  )}
                >
                  {milestone.at}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium">{rewardWorth(milestone)}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  At {milestone.at} {unitWord(milestone.at, unitLabel)}
                  {isNext ? ` · ${toNext} more to go` : ""}
                </p>
                <RewardClaimControl
                  at={milestone.at}
                  affordable={ladderRungAffordable(stamps, milestone.at)}
                  promoApplied={promoApplied}
                  selectedAt={selectedAt}
                  onSelect={onSelect}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
