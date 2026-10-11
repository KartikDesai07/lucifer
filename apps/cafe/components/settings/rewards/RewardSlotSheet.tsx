"use client";

import type { RewardLevelsDraft } from "@/hooks/use-reward-levels-draft";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RewardSlotEditor } from "@/components/settings/rewards/RewardSlotEditor";

interface RewardSlotSheetProps {
  open: boolean;
  /** 0-based level index and the 1-based box. Kept after close so the title does not flicker while the panel slides out. */
  levelIndex: number;
  step: number;
  levels: RewardLevelsDraft;
  exampleBill: number;
  onExampleBillChange: (bill: number) => void;
  onClose: () => void;
}

// The side panel for one box. Every way out except the editor's own Add / Done / Remove closes it WITHOUT committing
// (Escape, a tap outside, the X, Cancel): the editor works on a local copy that is simply dropped. SheetContent
// unmounts its children when closed, so the editor re-seeds from the saved box each time the panel opens.
export function RewardSlotSheet({ open, levelIndex, step, levels, exampleBill, onExampleBillChange, onClose }: RewardSlotSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md [&>button]:right-1.5 [&>button]:top-1.5 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center">
        <SheetHeader>
          <SheetTitle>{`Level ${levelIndex + 1}, box ${step}`}</SheetTitle>
          <SheetDescription>What a diner can win when they reach this box.</SheetDescription>
        </SheetHeader>
        <RewardSlotEditor
          levels={levels}
          levelIndex={levelIndex}
          step={step}
          exampleBill={exampleBill}
          onExampleBillChange={onExampleBillChange}
          onClose={onClose}
        />
      </SheetContent>
    </Sheet>
  );
}
