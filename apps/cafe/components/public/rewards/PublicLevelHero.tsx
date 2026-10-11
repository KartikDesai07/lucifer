import { cn } from "@/lib/utils";
import { PUB_HERO_LG_CLASS, PUB_HERO_ORNAMENT_CLASS } from "@/components/public/public-ui";
import { POINTS_RULE, type DinerLevelProgress } from "@pos/shared/public-diner-cards";

// CB-7 S4 — the Levels hero: the ONE saturated block on the Rewards tab besides the scratch tiles. Where the diner
// stands (Level 2 of 3), a big "3 / 8", a slim progress bar and how far the next card is. Presentational only.

const PERCENT = 100;

interface PublicLevelHeroProps {
  progress: DinerLevelProgress;
  pointsBalance: number;
}

function nextCardLine(stepsToNextCard: number | null): string | null {
  if (stepsToNextCard === null) return null;
  if (stepsToNextCard === 1) return "1 more order to your next card";
  return `${stepsToNextCard} more orders to your next card`;
}

export function PublicLevelHero({ progress, pointsBalance }: PublicLevelHeroProps) {
  const { level, levelCount, round, size, filled, stepsToNextCard } = progress;
  const percent = size > 0 ? Math.min(PERCENT, Math.round((filled / size) * PERCENT)) : 0;
  const nextLine = nextCardLine(stepsToNextCard);

  return (
    <div className={cn(PUB_HERO_LG_CLASS, "p-6")}>
      <span className={cn(PUB_HERO_ORNAMENT_CLASS, "-right-12 -top-16 h-48 w-48")} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/70">
          Level {level} of {levelCount}
          {round > 0 && ` · round ${round + 1}`}
        </p>
        <p className="mt-1">
          <span className="text-5xl font-semibold tabular-nums">{filled}</span>
          <span className="text-lg text-primary-foreground/80"> / {size} orders</span>
        </p>
        <div
          role="progressbar"
          aria-label="Orders in this level"
          aria-valuemin={0}
          aria-valuemax={size}
          aria-valuenow={filled}
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-primary-foreground/20"
        >
          <div className="h-full rounded-full bg-primary-foreground" style={{ width: `${percent}%` }} />
        </div>
        {nextLine !== null && <p className="mt-4 text-sm text-primary-foreground/90">{nextLine}</p>}
        {pointsBalance > 0 && (
          <p className="mt-1 text-sm text-primary-foreground/90">
            {pointsBalance} {pointsBalance === 1 ? "point" : "points"} · {POINTS_RULE}
          </p>
        )}
      </div>
    </div>
  );
}
