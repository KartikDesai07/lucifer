"use client";

import { Gift } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import {
  PUB_CHIP_CLASS,
  PUB_HERO_LG_CLASS,
  PUB_HERO_ORNAMENT_CLASS,
  PUB_INVERTED_BUTTON_CLASS,
  PUB_PRESS_CLASS,
  PUB_TINT_CLASS,
  PUB_TONAL_CARD_CLASS,
} from "@/components/public/public-ui";
import { scratchableCount } from "@/components/public/rewards/wallet-view";
import { useDinerCards } from "@/components/public/rewards/use-diner-cards";
import { CARDS_SIGN_IN } from "@pos/shared/public-diner-cards";

// CB-7 S4 — the Home card for a cafe running Reward Levels: a sign-in invite, a skeleton while the first read is in
// flight, then one tonal card ("Level 2 · 3 of 8 orders" + a "1 card to scratch" chip). Tapping it opens Rewards.
// It reads the wallet itself (the same query the Rewards tab uses, so the two share one cached answer).

interface PublicLevelInviteProps {
  title: string;
  onSignIn: () => void;
}

// The signed-out invite, shared with the Rewards tab.
export function PublicLevelInvite({ title, onSignIn }: PublicLevelInviteProps) {
  return (
    <div className={cn(PUB_HERO_LG_CLASS, "p-6")}>
      <span className={cn(PUB_HERO_ORNAMENT_CLASS, "-right-12 -top-16 h-48 w-48")} />
      <div className="relative">
        <p className="font-pub-display text-2xl font-semibold">{title}</p>
        <p className="mt-1 text-sm text-primary-foreground/80">{CARDS_SIGN_IN}</p>
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

interface PublicLevelGlanceProps {
  identity: string | null;
  loading: boolean;
  onSignIn: () => void;
  onOpenRewards: () => void;
}

export function PublicLevelGlance({ identity, loading, onSignIn, onOpenRewards }: PublicLevelGlanceProps) {
  const query = useDinerCards(identity);

  if (loading) return <Skeleton className="h-24 w-full rounded-3xl" />;
  if (identity === null) return <PublicLevelInvite title="Earn scratch cards" onSignIn={onSignIn} />;
  if (query.isPending) return <Skeleton className="h-24 w-full rounded-3xl" />;
  if (!query.data) return null;

  const { progress } = query.data;
  const toScratch = scratchableCount(query.data);
  if (progress === null && toScratch === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpenRewards}
      className={cn(PUB_TONAL_CARD_CLASS, PUB_PRESS_CLASS, "flex w-full flex-col items-start gap-2 p-5 text-left")}
    >
      {progress !== null && (
        <span className="font-pub-display text-lg font-semibold">
          Level {progress.level} · {progress.filled} of {progress.size} orders
        </span>
      )}
      {toScratch > 0 && (
        <span className={cn(PUB_CHIP_CLASS, PUB_TINT_CLASS)}>
          <Gift className="h-3.5 w-3.5" aria-hidden="true" />
          {toScratch === 1 ? "1 card to scratch" : `${toScratch} cards to scratch`}
        </span>
      )}
    </button>
  );
}
