"use client";

import type { UseFormGetValues } from "react-hook-form";
import { toast } from "sonner";

import type { SettingsInput } from "@/schemas";
import type { RewardLevelsDraft } from "@/hooks/use-reward-levels-draft";
import { Button } from "@/components/ui/button";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { copyStampRewards, REWARD_STARTERS, starterConfig } from "@/lib/reward-levels-starters";

interface RewardStarterButtonsProps {
  levels: RewardLevelsDraft;
  getValues: UseFormGetValues<SettingsInput>;
  /** What the copy left out, for the section to keep showing after these buttons are gone. */
  onCopyNotes: (notes: string[]) => void;
}

// The page's own "bills of at least ₹X count" as it is RIGHT NOW (the live form value, so an unsaved edit counts);
// a blank or half-typed field reads as 0 = every bill counts.
const liveMinBill = (getValues: UseFormGetValues<SettingsInput>): number => {
  const value = getValues("loyaltyMinBill");
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const BUTTON_CLASS = "h-auto min-h-11 flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left";

// Where an owner with nothing set up begins: three ready-made setups and a copy of their stamp card. Each one only
// fills the editor (nothing is saved until Save changes, and none is ever switched on).
export function RewardStarterButtons({ levels, getValues, onCopyNotes }: RewardStarterButtonsProps) {
  const copy = () => {
    const result = copyStampRewards(getValues("loyaltyRules"), liveMinBill(getValues));
    if (result.config === null) {
      toast.error(result.notes[0] ?? "Your stamp card could not be copied.");
      return;
    }
    levels.replace(result.config);
    onCopyNotes(result.notes);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {REWARD_STARTERS.map((starter) => (
          <Button
            key={starter.id}
            type="button"
            variant="outline"
            className={BUTTON_CLASS}
            onClick={() => {
              onCopyNotes([]);
              levels.replace(starterConfig(starter.id, liveMinBill(getValues)));
            }}
          >
            <span className="text-sm font-semibold text-brand-ink">{starter.label}</span>
            <span className="text-xs font-normal text-brand-muted">{starter.description}</span>
          </Button>
        ))}
        <Button type="button" variant="outline" className={BUTTON_CLASS} onClick={copy}>
          <span className="text-sm font-semibold text-brand-ink">Copy my stamp rewards</span>
          <span className="text-xs font-normal text-brand-muted">Start from the rewards on your stamp card.</span>
        </Button>
      </div>
      <p className={HINT_CLASS}>You can change everything afterwards. Nothing is saved until you press Save changes.</p>
    </div>
  );
}
