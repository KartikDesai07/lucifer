import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_HERO_LG_CLASS, PUB_HERO_ORNAMENT_CLASS } from "@/components/public/public-ui";
import { PublicStampTrack } from "@/components/public/PublicStampTrack";
import { unitWord } from "@/components/public/public-rewards-view";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

// CB-6D-B — the Rewards tab's own hero, rebuilt on Home's accepted stamp-card
// look (owner: "premium lag raha hai"). Same hero literals as
// PublicLoyaltyGlance.tsx (the dot row, the eyebrow, the 5xl number) so the
// two stamp cards read as one surface. Two bodies under the number line: the
// FLAT dot grid (a cafe with a single milestone) unchanged from before, or —
// the owner's decision this session — the horizontal bar with milestone
// markers (PublicStampTrack) for a cafe running a ladder.

const MAX_DRAWN_STAMPS = 12;

interface PublicStampCardProps {
  stampsPerReward: number;
  filled: number;
  unitLabel: string;
  footer: string | null;
  ladder?: readonly ResolvedMilestone[];
  cyclePosition?: number;
}

export function PublicStampCard({
  stampsPerReward,
  filled,
  unitLabel,
  footer,
  ladder,
  cyclePosition,
}: PublicStampCardProps) {
  const isLadder = (ladder?.length ?? 0) > 1;
  const drawn = Math.min(stampsPerReward, MAX_DRAWN_STAMPS);

  return (
    <div className={cn(PUB_HERO_LG_CLASS, "p-6")}>
      <span className={cn(PUB_HERO_ORNAMENT_CLASS, "-right-12 -top-16 h-48 w-48")} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/70">Your stamp card</p>
        <p className="mt-1">
          <span className="text-5xl font-semibold tabular-nums">{filled}</span>
          <span className="text-lg text-primary-foreground/80"> / {stampsPerReward} {unitWord(stampsPerReward, unitLabel)}</span>
        </p>

        {isLadder && ladder ? (
          <PublicStampTrack cycleLength={stampsPerReward} position={cyclePosition ?? 0} milestones={ladder} />
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-1.5" aria-hidden="true">
              {Array.from({ length: drawn }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full",
                    filled > i ? "bg-primary-foreground text-primary" : "border border-primary-foreground/40",
                  )}
                >
                  {filled > i && <Check className="h-4 w-4" aria-hidden="true" />}
                </span>
              ))}
            </div>
            {stampsPerReward > MAX_DRAWN_STAMPS && (
              <p className="mt-2 text-xs text-primary-foreground/80">
                Showing the first {MAX_DRAWN_STAMPS} of {stampsPerReward} {unitLabel}s.
              </p>
            )}
          </>
        )}

        {footer !== null && <p className="mt-4 text-sm text-primary-foreground/90">{footer}</p>}
      </div>
    </div>
  );
}
