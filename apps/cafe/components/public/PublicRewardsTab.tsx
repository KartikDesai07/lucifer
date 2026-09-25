"use client";

import { useEffect, useState } from "react";

import { Gift } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import {
  PUB_HERO_LG_CLASS,
  PUB_HERO_ORNAMENT_CLASS,
  PUB_HOME_STACK_CLASS,
  PUB_INVERTED_BUTTON_CLASS,
  PUB_PILL_BUTTON_CLASS,
  PUB_SECTION_HEADING_CLASS,
  PUB_SCREEN_TITLE_CLASS,
} from "@/components/public/public-ui";
import {
  clearRequestedRewardAt,
  readAppliedPromoCode,
  readRequestedRewardAt,
  writeRequestedRewardAt,
} from "@/components/public/public-cart-store";
import { PublicStampCard } from "@/components/public/PublicStampCard";
import { PublicRewardLadder, RewardClaimControl } from "@/components/public/PublicRewardLadder";
import { PublicRewardCodes } from "@/components/public/PublicRewardCodes";
import { PublicRewardsHowItWorks } from "@/components/public/PublicRewardsHowItWorks";
import { cn } from "@/lib/utils";
import { cardProgress, nextRewardLine, rewardWorth, unitWord } from "@/components/public/public-rewards-view";
import type { AssignedRewardOffer } from "@/components/public/PublicPromoField";
import type { DinerStampCard } from "@/lib/diner-loyalty";

// CB-6D-B — the diner's Rewards tab, rebuilt on Home's premium vocabulary
// (owner: "easy to understand and easy to use", Starbucks/premium-cafe
// style). The hero (PublicStampCard) now carries the owner's chosen
// horizontal progress bar with milestone markers for a ladder cafe; the
// rewards themselves render as a separate list of cards below it
// (PublicRewardLadder) rather than as steps ON the bar.
//
// CB-5B S8 — the tab is no longer read-only: an AFFORDABLE reward (the diner
// has >= `at` stamps this cycle) can be selected as this order's claim. The
// selection is an INTENT ONLY (the milestone's `at`, never an amount or a
// dish — see buildOrderRequestBody/use-public-cart-submit.ts, which read it
// back out of the SAME store to build the POST body) and it is bridged
// through public-cart-store.ts rather than props: PublicOrderFlow (which
// owns the Cart) sits between this tab and PublicDinerShell, so a prop chain
// would mean reaching into a component this slice does not own.

interface PublicRewardsTabProps {
  loading: boolean;
  signedIn: boolean;
  card: DinerStampCard | null;
  onSignIn: () => void;
  // NEW — codes already assigned to this diner (CB-5D part 2 minted-code
  // rungs), rendered read-only below the ladder/stamp card. Optional: absent
  // on any surface that hasn't fetched diner/me, or for a signed-out diner.
  rewards?: AssignedRewardOffer[];
}

export function PublicRewardsTab({ loading, signedIn, card, onSignIn, rewards }: PublicRewardsTabProps) {
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
      <div className={PUB_HOME_STACK_CLASS}>
        <Skeleton className="h-44 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    );
  }

  if (!signedIn || !card) {
    return (
      <div className={PUB_HOME_STACK_CLASS}>
        <p className={PUB_SCREEN_TITLE_CLASS}>Rewards</p>
        <div className={cn(PUB_HERO_LG_CLASS, "p-6")}>
          <span className={cn(PUB_HERO_ORNAMENT_CLASS, "-right-12 -top-16 h-48 w-48")} />
          <div className="relative">
            <p className="font-pub-display text-2xl font-semibold">Collect stamps on every visit</p>
            <p className="mt-1 text-sm text-primary-foreground/80">
              Sign in with your mobile number to start collecting stamps and earn a free reward.
            </p>
            <Button
              className={cn("mt-5", PUB_PILL_BUTTON_CLASS, PUB_INVERTED_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
              onClick={onSignIn}
            >
              Sign in
            </Button>
          </div>
        </div>
        <PublicRewardsHowItWorks />
      </div>
    );
  }

  const isLadder = card.ladder.length > 1;

  // F1 — filled/position now come from the single-homed cardProgress(), so
  // the hero AND the rewards list below read the SAME pair (previously the
  // list read the card's raw current-cycle position while the hero read the
  // showFull-adjusted position, so a diner who completed their card saw two
  // different progress numbers on one screen).
  const { filled, position } = cardProgress(card);
  // card.reward mirrors the LAST ladder milestone (resolveLoyaltyConfig
  // derives rewardKind/rewardValue/rewardItem from it), so the "ready to
  // claim" banner below claims that SAME milestone — the ladder always has
  // at least one entry even for a legacy flat-fields cafe, so this is only
  // undefined when the owner deleted every reward row (the
  // `card.ladder.length === 0` branch below).
  const readyRewardAt = card.ladder[card.ladder.length - 1]?.at;

  return (
    <div className={PUB_HOME_STACK_CLASS}>
      <p className={PUB_SCREEN_TITLE_CLASS}>Rewards</p>

      <PublicStampCard
        stampsPerReward={card.stampsPerReward}
        filled={filled}
        unitLabel={card.unitLabel}
        footer={nextRewardLine(card)}
        ladder={isLadder ? card.ladder : undefined}
        cyclePosition={position}
      />

      {card.ladder.length === 0 ? (
        // FIX C — the owner deleted every reward row. dinerStampCard already
        // zeroes rewardsReady/toNextReward for this case (lib/diner-loyalty.ts),
        // but the stale reward copy below must never render even so — an
        // explicit guided state instead, never a claim the cafe didn't make.
        <p className="text-sm text-muted-foreground">
          No reward set up yet. Keep collecting {card.unitLabel}s — the cafe will let you know once a reward is ready.
        </p>
      ) : (
        card.rewardsReady > 0 && (
          <div className="rounded-3xl bg-primary/10 p-5">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Gift className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={PUB_SECTION_HEADING_CLASS}>
                  {card.rewardsReady > 1 ? `You have ${card.rewardsReady} rewards ready` : "You have a reward ready"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add {rewardWorth(card.reward)} to your next order, or show this screen at the counter.
                </p>
                {/* Ladder mode already shows a claim button on the reward's
                    own card (PublicRewardLadder below) — a second one here
                    would be a duplicate for the SAME reward, so this only
                    appears for a flat (non-ladder) card. */}
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
            </div>
          </div>
        )
      )}

      {isLadder && (
        <PublicRewardLadder
          ladder={card.ladder}
          cyclePosition={position}
          stamps={card.stamps}
          unitLabel={card.unitLabel}
          promoApplied={promoApplied}
          selectedAt={selectedAt}
          onSelect={selectReward}
        />
      )}

      <PublicRewardsHowItWorks />

      {rewards && <PublicRewardCodes rewards={rewards} />}

      {card.lifetime > 0 && (
        <p className="text-xs text-muted-foreground">
          You have collected {card.lifetime} {unitWord(card.lifetime, card.unitLabel)} here in total.
        </p>
      )}
    </div>
  );
}
