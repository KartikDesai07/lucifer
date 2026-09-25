import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { PUB_HERO_LG_CLASS, PUB_HERO_ORNAMENT_CLASS, PUB_INVERTED_BUTTON_CLASS, PUB_PRESS_CLASS } from "@/components/public/public-ui";
import type { DinerStampCard } from "@/lib/diner-loyalty";

// CB-6D-A — Home's hero: the stamp card itself, Starbucks-style (the owner's
// own words: "premium, new... classy"). Reads DinerStampCard's already-
// derived fields (never re-derives stamp math) and skips the ladder detail
// the Rewards tab owns. Four states: signed out (an invite), loading
// (skeleton, never an invented number), the card once `stampCard` resolves,
// and null (signed in, loaded, no card at all).

const MAX_DRAWN_STAMPS = 12;

interface PublicLoyaltyGlanceProps {
  signedIn: boolean;
  loading: boolean;
  stampCard: DinerStampCard | null;
  onSignIn: () => void;
  onOpenRewards: () => void;
}

function unitWord(count: number, unitLabel: string): string {
  return count === 1 ? unitLabel : `${unitLabel}s`;
}

export function PublicLoyaltyGlance({ signedIn, loading, stampCard, onSignIn, onOpenRewards }: PublicLoyaltyGlanceProps) {
  if (!signedIn) {
    return (
      <div className={cn(PUB_HERO_LG_CLASS, "p-6")}>
        <span className={cn(PUB_HERO_ORNAMENT_CLASS, "-right-12 -top-16 h-48 w-48")} />
        <div className="relative">
          <p className="font-pub-display text-2xl font-semibold">Collect stamps on every visit</p>
          <p className="mt-1 text-sm text-primary-foreground/80">Sign in and every order counts.</p>
          <Button
            className={cn("mt-5 rounded-full px-5", PUB_INVERTED_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
            onClick={onSignIn}
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <Skeleton className="h-44 w-full rounded-3xl" />;
  }

  if (!stampCard) return null;

  const filled = stampCard.stampsPerReward > 0 ? stampCard.stamps % stampCard.stampsPerReward : 0;
  const showFull = stampCard.rewardsReady > 0 && filled === 0;
  const drawnFilled = showFull ? stampCard.stampsPerReward : filled;
  const drawn = Math.min(stampCard.stampsPerReward, MAX_DRAWN_STAMPS);

  return (
    <button
      type="button"
      onClick={onOpenRewards}
      className={cn(PUB_HERO_LG_CLASS, PUB_PRESS_CLASS, "w-full p-6 text-left")}
    >
      <span className={cn(PUB_HERO_ORNAMENT_CLASS, "-right-12 -top-16 h-48 w-48")} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/70">Your stamp card</p>
        <p className="mt-1">
          <span className="text-5xl font-semibold tabular-nums">{drawnFilled}</span>
          <span className="text-lg text-primary-foreground/80"> / {stampCard.stampsPerReward} {unitWord(stampCard.stampsPerReward, stampCard.unitLabel)}</span>
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5" aria-hidden="true">
          {Array.from({ length: drawn }, (_, i) => (
            <span
              key={i}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full",
                drawnFilled > i ? "bg-primary-foreground text-primary" : "border border-primary-foreground/40",
              )}
            >
              {drawnFilled > i && <Check className="h-4 w-4" aria-hidden="true" />}
            </span>
          ))}
        </div>

        <p className="mt-4 text-sm text-primary-foreground/90">
          {stampCard.rewardsReady > 0
            ? stampCard.rewardsReady > 1
              ? `${stampCard.rewardsReady} rewards ready — tap to claim`
              : "1 reward ready — tap to claim"
            : stampCard.toNextReward === 1
              ? `one more ${stampCard.unitLabel} to your next reward`
              : `${stampCard.toNextReward} more ${unitWord(stampCard.toNextReward, stampCard.unitLabel)} to your next reward`}
        </p>
      </div>
    </button>
  );
}
