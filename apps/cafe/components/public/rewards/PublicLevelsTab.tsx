"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { PUB_HOME_STACK_CLASS, PUB_SCREEN_TITLE_CLASS } from "@/components/public/public-ui";
import { PublicRewardsTab } from "@/components/public/PublicRewardsTab";
import { PublicCardWallet } from "@/components/public/rewards/PublicCardWallet";
import { PublicLevelHero } from "@/components/public/rewards/PublicLevelHero";
import { PublicLevelInvite } from "@/components/public/rewards/PublicLevelGlance";
import { PublicLevelLadder } from "@/components/public/rewards/PublicLevelLadder";
import { cardsLoadCanRetry, cardsLoadErrorCopy, DINER_CARDS_KEY, useDinerCards } from "@/components/public/rewards/use-diner-cards";
import type { AssignedRewardOffer } from "@/components/public/PublicPromoField";
import type { DinerStampCard } from "@/lib/diner-loyalty";
import { POINTS_RULE, SCRATCH_PAUSED, type DinerCardsData } from "@pos/shared/public-diner-cards";

// CB-7 S4 — the Rewards tab for a cafe that has Reward Levels. The shell (Slice D2) renders this instead of
// PublicRewardsTab when `cardsOn`; everything the old tab needed (`loading`, `card`, `rewards`, `onSignIn`) comes
// through unchanged so the stamp card and reward codes keep working inside it.
//
//   levelsChosen  the owner picked Reward Levels: title, hero, cards, ladder, stamps (only while the diner has any),
//                 past cards.
//   !levelsChosen a blob is stored but levels are not the active scheme: the stamp tab renders AT ONCE (it never waits
//                 on the cards read) and the wallet is added only if the read actually returned cards.

interface PublicLevelsTabProps {
  // The signed-in diner's mobile (the query-key identity); null = signed out.
  identity: string | null;
  levelsChosen: boolean;
  // Accounts on AND a levels blob stored — only then is the wallet read at all.
  cardsOn: boolean;
  loyaltyEnabled: boolean;
  // The shell's /me load is still in flight.
  loading: boolean;
  card: DinerStampCard | null;
  rewards?: AssignedRewardOffer[];
  onSignIn: () => void;
}

export function PublicLevelsTab({
  identity,
  levelsChosen,
  cardsOn,
  loyaltyEnabled,
  loading,
  card,
  rewards,
  onSignIn,
}: PublicLevelsTabProps) {
  const query = useDinerCards(cardsOn ? identity : null);
  const signedIn = identity !== null;
  // While a scratch sheet is open the whole screen reads a frozen copy of the wallet: the scratch answer refreshes the
  // cache, and the hero points, the past-cards count or the grid must not move before the diner has seen the reveal.
  const [frozen, setFrozen] = useState<DinerCardsData | null>(null);
  const view = frozen ?? query.data;
  const onSheetChange = (open: boolean): void => setFrozen(open ? (query.data ?? null) : null);
  const queryClient = useQueryClient();
  // Re-reads the wallet through an invalidation (the hook owns every network call).
  const reload = () => void queryClient.invalidateQueries({ queryKey: DINER_CARDS_KEY });

  // Points the diner already holds always show (plan §2.11 predicate 3): the hero carries them while there is a level,
  // otherwise this line — in BOTH branches, so a cafe that switched Reward Levels off still shows the balance.
  const pointsLine =
    view && !view.progress && view.pointsBalance > 0 ? (
      <p className="text-sm text-muted-foreground">
        {view.pointsBalance} {view.pointsBalance === 1 ? "point" : "points"} · {POINTS_RULE}
      </p>
    ) : null;

  const stampsTab = (embedded: boolean) => (
    <PublicRewardsTab
      loading={loading}
      signedIn={signedIn}
      card={card}
      onSignIn={onSignIn}
      rewards={rewards}
      embedded={embedded}
    />
  );

  if (!levelsChosen) {
    const cards = view?.cards ?? [];
    return (
      <>
        {loyaltyEnabled && stampsTab(false)}
        {cards.length > 0 && view && (
          <div className="space-y-6 px-pub-pad pb-2">
            {pointsLine}
            <PublicCardWallet cards={cards} earning={view.earning} identity={identity} onSheetChange={onSheetChange} />
            <PublicCardWallet cards={cards} earning={view.earning} identity={identity} part="history" />
          </div>
        )}
      </>
    );
  }

  if (loading) {
    return (
      <div className={PUB_HOME_STACK_CLASS}>
        <Skeleton className="h-44 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className={PUB_HOME_STACK_CLASS}>
        <p className={PUB_SCREEN_TITLE_CLASS}>Rewards</p>
        <PublicLevelInvite title="Earn scratch cards" onSignIn={onSignIn} />
      </div>
    );
  }

  const hasStamps = card !== null && (card.stamps > 0 || card.rewardsReady > 0 || (rewards?.length ?? 0) > 0);

  return (
    <div className={PUB_HOME_STACK_CLASS}>
      <p className={PUB_SCREEN_TITLE_CLASS}>Rewards</p>

      {query.isPending && (
        <>
          <Skeleton className="h-44 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </>
      )}

      {query.isError && (
        <div className="space-y-2 rounded-2xl bg-muted p-4">
          <p className="text-sm">{cardsLoadErrorCopy(query.error)}</p>
          {cardsLoadCanRetry(query.error) && (
            <Button variant="outline" className={PUBLIC_TOUCH_TARGET_CLASS} onClick={reload}>
              Try again
            </Button>
          )}
        </div>
      )}

      {view && (
        <>
          {!view.earning && <p className="text-sm text-muted-foreground">{SCRATCH_PAUSED}</p>}
          {pointsLine}
          {view.progress && <PublicLevelHero progress={view.progress} pointsBalance={view.pointsBalance} />}
          <PublicCardWallet cards={view.cards} earning={view.earning} identity={identity} onSheetChange={onSheetChange} />
          {view.ladder && <PublicLevelLadder ladder={view.ladder} progress={view.progress} />}
        </>
      )}

      {hasStamps && stampsTab(true)}

      {view && <PublicCardWallet cards={view.cards} earning={view.earning} identity={identity} part="history" />}
    </div>
  );
}
