import { Gift } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_SECTION_HEADING_CLASS, PUB_TINT_CLASS, PUB_TONAL_CARD_CLASS } from "@/components/public/public-ui";
import { expiryLabel, type AssignedRewardOffer } from "@/components/public/PublicPromoField";

// CB-6D-B — restyled onto the tonal-card vocabulary (Starbucks/premium
// direction), same content as before.

// A code's "worth" line, derivable only for kind:"percent"/"amount" — a
// kind:"item" rung names a specific dish the ladder view already shows, and
// this list never re-states money it cannot itself compute (the code's
// discount is decided server-side when applied).
function codeWorth(kind: string): string | null {
  if (kind === "percent") return "Percent off your bill";
  if (kind === "amount") return "Amount off your bill";
  return null;
}

interface PublicRewardCodesProps {
  rewards: readonly AssignedRewardOffer[];
}

export function PublicRewardCodes({ rewards }: PublicRewardCodesProps) {
  if (rewards.length === 0) return null;

  return (
    <div>
      <p className={PUB_SECTION_HEADING_CLASS}>Your reward codes</p>
      <div className="mt-3 space-y-3">
        {rewards.map((reward) => {
          const worth = codeWorth(reward.kind);
          return (
            <div key={reward.code} className={cn(PUB_TONAL_CARD_CLASS, "flex items-start gap-4 p-5")}>
              <span className={cn(PUB_TINT_CLASS, "grid h-10 w-10 shrink-0 place-items-center rounded-full")}>
                <Gift className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-lg font-semibold tracking-wide">{reward.code}</p>
                {worth && <p className="text-xs text-muted-foreground">{worth}</p>}
                {reward.expiresAt !== undefined && (
                  <p className="text-xs text-muted-foreground">{expiryLabel(reward.expiresAt)}</p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">Apply it in your cart at checkout</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
