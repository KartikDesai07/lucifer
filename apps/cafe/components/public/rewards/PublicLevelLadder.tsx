import { Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_CHIP_CLASS, PUB_SECTION_HEADING_CLASS, PUB_TINT_CLASS, PUB_TONAL_CARD_CLASS } from "@/components/public/public-ui";
import { boxStateOf, type BoxState } from "@/components/public/rewards/ladder-state";
import {
  CARD_STATE_WORDS,
  EVERY_CARD_WINS,
  type DinerLadderBox,
  type DinerLadderLevel,
  type DinerLevelProgress,
} from "@pos/shared/public-diner-cards";

// CB-7 S4 — "How to earn cards": every level and box with its choices and chances, so the diner knows what each
// order is working towards. A box is done, the next one (the engine's own nextBox), or locked (icon + word — never
// colour alone); see ladder-state.ts.
// `progress` null (the cafe is not earning right now) draws every box as a plain row with no state mark.

interface PublicLevelLadderProps {
  ladder: readonly DinerLadderLevel[];
  progress: DinerLevelProgress | null;
}

function choicesLine(box: DinerLadderBox): string {
  return box.choices.map((choice) => `${choice.label} (${choice.chance}%)`).join(" · ");
}

function StateMark({ state }: { state: BoxState }) {
  if (state === "plain") return null;
  if (state === "done") {
    return (
      <span className={cn(PUB_CHIP_CLASS, "shrink-0", PUB_TINT_CLASS)}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Done
      </span>
    );
  }
  if (state === "next") return <span className={cn(PUB_CHIP_CLASS, "shrink-0", PUB_TINT_CLASS)}>Next</span>;
  return (
    <span className={cn(PUB_CHIP_CLASS, "shrink-0 bg-background text-muted-foreground")}>
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      {CARD_STATE_WORDS.locked}
    </span>
  );
}

export function PublicLevelLadder({ ladder, progress }: PublicLevelLadderProps) {
  if (ladder.length === 0) return null;

  return (
    <div>
      <p className={PUB_SECTION_HEADING_CLASS}>How to earn cards</p>
      <div className="mt-3 space-y-3">
        {ladder.map((level) => (
          <div key={level.level} className={cn(PUB_TONAL_CARD_CLASS, "p-5")}>
            <p className="font-pub-display text-base font-semibold">Level {level.level}</p>
            <ul className="mt-3 space-y-3">
              {level.boxes.map((box) => {
                const state = boxStateOf(level.level, box.step, progress);
                return (
                  <li key={box.step} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Order {box.step}</p>
                      <p className="mt-0.5 break-words text-sm text-muted-foreground">
                        {box.choices.length > 1 ? "One of: " : ""}
                        {choicesLine(box)}
                      </p>
                      {box.everyCardWins && <p className="mt-0.5 text-xs text-muted-foreground">{EVERY_CARD_WINS}</p>}
                    </div>
                    <StateMark state={state} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
