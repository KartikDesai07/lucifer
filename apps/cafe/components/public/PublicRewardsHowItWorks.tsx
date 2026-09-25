import { Gift, ReceiptText, Stamp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_SECTION_TITLE_CLASS, PUB_TINT_CLASS, PUB_TONAL_CARD_CLASS } from "@/components/public/public-ui";
import { HOW_IT_WORKS_STEPS } from "@/components/public/public-rewards-view";

// CB-6D-B — NEW. A quiet 3-step strip for first-time diners (owner: "Haan,
// add karo"), signed-in and signed-out alike. No props: the three steps are
// fixed copy (HOW_IT_WORKS_STEPS, public-rewards-view.ts), one icon each.

const STEP_ICONS: readonly LucideIcon[] = [ReceiptText, Stamp, Gift];

export function PublicRewardsHowItWorks() {
  return (
    <div className={cn(PUB_TONAL_CARD_CLASS, "p-5")}>
      <p className={PUB_SECTION_TITLE_CLASS}>How it works</p>
      <ol className="mt-3 space-y-3">
        {HOW_IT_WORKS_STEPS.map((step, i) => {
          const Icon = STEP_ICONS[i];
          return (
            <li key={step} className="flex items-center gap-3">
              <span className={cn(PUB_TINT_CLASS, "grid h-9 w-9 shrink-0 place-items-center rounded-full")}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm">{step}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
