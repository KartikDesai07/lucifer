"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

import { REWARD_OPTIONS_PER_SLOT_MAX, type RewardSlot } from "@pos/shared/reward-levels";
import { optionChances } from "@pos/shared/reward-levels-view";
import type { RewardLevelsDraft } from "@/hooks/use-reward-levels-draft";
import { useProducts } from "@/hooks/use-products";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SheetFooter } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { RewardCostPreview } from "@/components/settings/rewards/RewardCostPreview";
import { RewardOptionFields } from "@/components/settings/rewards/RewardOptionFields";
import { RewardTtlFields } from "@/components/settings/rewards/RewardTtlFields";
import { REWARD_BUTTON_CLASS } from "@/components/settings/rewards/reward-ui";
import {
  newOption,
  newSlot,
  nextOptionId,
  priceOfFrom,
  putSlot,
  removeSlot,
  replaceOption,
  withOption,
  withoutOption,
} from "@/lib/reward-levels-edit";
import { fieldProblem, rewardLevelsProblems } from "@/lib/reward-levels-form";

interface RewardSlotEditorProps {
  levels: RewardLevelsDraft;
  /** 0-based level index and the 1-based box. */
  levelIndex: number;
  step: number;
  exampleBill: number;
  onExampleBillChange: (bill: number) => void;
  /** Closes the panel. Called AFTER a commit, or on its own for Cancel (which commits nothing). */
  onClose: () => void;
}

// The body and footer of one box's side panel. It edits a LOCAL copy of the box, seeded once when the panel opens (the
// sheet mounts this only while open), and writes it to the page's draft only through Add / Done / a confirmed Remove.
// Escape, a tap outside and the X close the panel without ever reaching levels.edit.
export function RewardSlotEditor({ levels, levelIndex, step, exampleBill, onExampleBillChange, onClose }: RewardSlotEditorProps) {
  const cfg = levels.current;
  const [existing] = useState(() => cfg?.levels[levelIndex]?.slots.find((s) => s.step === step));
  const [slot, setSlot] = useState<RewardSlot>(() => existing ?? newSlot(step));
  const isNew = existing === undefined;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const products = useProducts();
  const priceOf = useMemo(() => priceOfFrom(products.data), [products.data]);

  // Problems of the LOCAL copy (the page's `levels.problems` only knows what was committed), so a field is marked as
  // soon as it is wrong, not after Add.
  const problems = useMemo(() => (cfg === null ? [] : rewardLevelsProblems(putSlot(cfg, levelIndex, slot))), [cfg, levelIndex, slot]);

  const weightsOk = slot.options.every((o) => Number.isFinite(o.weight) && o.weight > 0);
  const chances = weightsOk ? optionChances(slot) : slot.options.map(() => 0);
  const atOptionMax = slot.options.length >= REWARD_OPTIONS_PER_SLOT_MAX;
  const scratchError = fieldProblem(problems, levelIndex, step, null, "scratchDays");
  const useError = fieldProblem(problems, levelIndex, step, null, "useDays");
  const boxError = fieldProblem(problems, levelIndex, step, null, "options");

  const commit = () => {
    levels.edit((current) => putSlot(current, levelIndex, slot));
    onClose();
  };
  const remove = () => {
    levels.edit((current) => removeSlot(current, levelIndex, step));
    setConfirmOpen(false);
    onClose();
  };

  return (
    <>
      <div className="space-y-4 py-4">
        {slot.options.map((option, index) => (
          <RewardOptionFields
            key={option.id}
            option={option}
            index={index}
            count={slot.options.length}
            chance={chances[index] ?? 0}
            level={levelIndex}
            step={step}
            problems={problems}
            onChange={(next) => setSlot((s) => replaceOption(s, option.id, next))}
            onRemove={() => setSlot((s) => withoutOption(s, option.id))}
          />
        ))}
        {boxError && <p className="text-xs text-brand-danger">{boxError}</p>}

        <Button
          type="button"
          variant="outline"
          className={`${REWARD_BUTTON_CLASS} w-full`}
          disabled={atOptionMax}
          onClick={() => setSlot((s) => withOption(s, newOption("bill-percent", nextOptionId(s.options))))}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add a reward
        </Button>
        {atOptionMax ? (
          <p className={HINT_CLASS}>{`A box can have up to ${REWARD_OPTIONS_PER_SLOT_MAX} rewards. Remove one to add another.`}</p>
        ) : (
          <p className={HINT_CLASS}>With more than one reward, each diner gets one of them by chance.</p>
        )}

        <RewardCostPreview slot={slot} exampleBill={exampleBill} onExampleBillChange={onExampleBillChange} priceOf={priceOf} />

        <Collapsible defaultOpen={scratchError !== null || useError !== null} className="rounded-md border border-brand-rule">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={`${REWARD_BUTTON_CLASS} w-full justify-between px-3 text-sm font-medium text-brand-ink`}
            >
              Time limits
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-brand-rule p-3">
            <RewardTtlFields
              slot={slot}
              scratchError={scratchError}
              useError={useError}
              onChange={(patch) => setSlot((s) => ({ ...s, ...patch }))}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="mt-auto space-y-3 border-t border-brand-rule pt-4">
        <p className={HINT_CLASS}>Changes save when you press Save changes.</p>
        {isNew ? (
          <SheetFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" className={REWARD_BUTTON_CLASS} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" className={REWARD_BUTTON_CLASS} onClick={commit}>
              Add
            </Button>
          </SheetFooter>
        ) : (
          <SheetFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              className={`${REWARD_BUTTON_CLASS} text-brand-danger hover:text-brand-danger`}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove box
            </Button>
            <Button type="button" className={REWARD_BUTTON_CLASS} onClick={commit}>
              Done
            </Button>
          </SheetFooter>
        )}
      </div>

      {/* INSIDE the sheet's content on purpose (the stamp grid's lesson): Radix decides "outside" by the React tree,
          so a confirm rendered as the sheet's sibling made its Cancel an outside tap that closed the panel too. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove the rewards in box ${step}?`}
        description="Nothing changes for diners until you save."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </>
  );
}
