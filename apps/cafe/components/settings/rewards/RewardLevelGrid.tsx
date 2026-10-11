"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import {
  REWARD_LEVEL_SIZE_MAX,
  REWARD_LEVEL_SIZE_MIN,
  REWARD_SLOTS_PER_LEVEL_MAX,
} from "@pos/shared/reward-levels";
import type { RewardLevelsDraft } from "@/hooks/use-reward-levels-draft";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BRAND_FIELD_ERROR_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { LoyaltyStampBox } from "@/components/settings/LoyaltyStampBox";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { RewardSlotSheet } from "@/components/settings/rewards/RewardSlotSheet";
import { REWARD_ICON_BUTTON_CLASS } from "@/components/settings/rewards/reward-ui";
import { removeLevel, setLevelSize } from "@/lib/reward-levels-edit";
import { boxHasProblem, requiredNumber } from "@/lib/reward-levels-form";

interface RewardLevelGridProps {
  levels: RewardLevelsDraft;
  /** 0-based. */
  levelIndex: number;
  exampleBill: number;
  onExampleBillChange: (bill: number) => void;
}

// One level of the scratch-card setup, drawn like the stamp card: a row of numbered boxes, a marked box has a reward.
// Tapping a box opens its side panel; nothing is added to the page's draft by looking.
export function RewardLevelGrid({ levels, levelIndex, exampleBill, onExampleBillChange }: RewardLevelGridProps) {
  const cfg = levels.current;
  const level = cfg?.levels[levelIndex];
  // Which box's panel is open (null = closed) and which one its title reads: the title is never cleared on close so it
  // does not flicker while the panel slides out.
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [panelStep, setPanelStep] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (cfg === null || level === undefined) return null;

  const rewarded = new Set(level.slots.map((slot) => slot.step));
  const atSlotMax = level.slots.length >= REWARD_SLOTS_PER_LEVEL_MAX;
  // Never draw fewer boxes than the level already uses (a box past a smaller size must stay visible and reachable), and
  // never more than a level may have (a mistyped size must not draw thousands).
  const size = Number.isFinite(level.size) ? Math.min(Math.max(Math.trunc(level.size), 0), REWARD_LEVEL_SIZE_MAX) : 0;
  const highest = level.slots.reduce((max, slot) => (Number.isFinite(slot.step) && slot.step > max ? slot.step : max), 0);
  const boxes = Math.max(size, highest);
  // Problems of the level itself (its size, its box list), not of one box.
  const levelWide = levels.problems.filter((p) => p.level === levelIndex && p.step === null);
  const sizeError = levelWide.find((p) => p.field === "size")?.message ?? null;
  const levelError = levelWide.find((p) => p.field !== "size")?.message ?? null;

  const open = (step: number) => {
    setPanelStep(step);
    setOpenStep(step);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h4 className="text-[15px] font-semibold text-brand-ink">{`Level ${levelIndex + 1}`}</h4>
        <div className="flex items-end gap-2">
          <div className="w-28">
            <RewardNumberField
              label="Boxes"
              value={level.size}
              min={REWARD_LEVEL_SIZE_MIN}
              max={REWARD_LEVEL_SIZE_MAX}
              error={sizeError}
              onText={(text) => levels.edit((current) => setLevelSize(current, levelIndex, requiredNumber(text)))}
            />
          </div>
          {cfg.levels.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              className={`${REWARD_ICON_BUTTON_CLASS} text-brand-danger hover:text-brand-danger`}
              aria-label={`Remove level ${levelIndex + 1}`}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {levelError && (
        <p className={BRAND_FIELD_ERROR_CLASS} role="alert">
          {levelError}
        </p>
      )}

      {boxes === 0 ? (
        <p className="rounded-md border border-dashed border-brand-rule p-4 text-sm text-brand-muted">
          Set how many boxes this level has to draw it.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
          {Array.from({ length: boxes }, (_, i) => i + 1).map((step) => {
            const hasReward = rewarded.has(step);
            return (
              <LoyaltyStampBox
                key={step}
                at={step}
                noun="Box"
                hasReward={hasReward}
                hasCode={false}
                hasError={boxHasProblem(levels.problems, levelIndex, step)}
                disabled={atSlotMax && !hasReward}
                onOpen={() => open(step)}
              />
            );
          })}
        </div>
      )}

      <p className={HINT_CLASS}>
        {atSlotMax
          ? `A level can have up to ${REWARD_SLOTS_PER_LEVEL_MAX} boxes with rewards. Remove one to place another.`
          : `Tap a box to choose what diners can win there. ${level.slots.length} of ${REWARD_SLOTS_PER_LEVEL_MAX} boxes have a reward.`}
      </p>

      <RewardSlotSheet
        open={openStep !== null}
        levelIndex={levelIndex}
        step={panelStep}
        levels={levels}
        exampleBill={exampleBill}
        onExampleBillChange={onExampleBillChange}
        onClose={() => setOpenStep(null)}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove level ${levelIndex + 1}?`}
        description="Its boxes and rewards are removed. Nothing changes for diners until you save."
        confirmLabel="Remove"
        onConfirm={() => {
          levels.edit((current) => removeLevel(current, levelIndex));
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}
