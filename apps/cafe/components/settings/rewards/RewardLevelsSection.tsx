"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import type { Control, UseFormGetValues } from "react-hook-form";
import { Plus } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { REWARD_LEVELS_MAX, REWARD_MIN_BILL_MAX, REWARD_MIN_BILL_MIN } from "@pos/shared/reward-levels";
import { gstinBlocksScratch } from "@pos/shared/reward-levels-engine";
import type { RewardLevelsDraft } from "@/hooks/use-reward-levels-draft";
import { useRewardLevelsStatus } from "@/hooks/use-reward-levels-status";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BRAND_FIELD_ERROR_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS, SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";
import { RewardLevelGrid } from "@/components/settings/rewards/RewardLevelGrid";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { RewardStarterButtons } from "@/components/settings/rewards/RewardStarterButtons";
import { REWARD_BUTTON_CLASS, REWARD_NOTE_CLASS } from "@/components/settings/rewards/reward-ui";
import {
  BLOCKED_PLATFORM,
  BLOCKED_TN,
  REWARD_COST_EXAMPLE_BILL_DEFAULT,
  SWITCH_EFFECT,
  SWITCH_LABEL,
  SWITCH_LOCKED,
  SWITCH_NEEDS_SIGN_IN,
  UNREADABLE_NOTICE,
} from "@/lib/reward-levels-copy";
import { addLevel, minBillValue, setEnabled, setMinBill } from "@/lib/reward-levels-edit";
import { canSwitchOn, optionalNumber, problemSentence } from "@/lib/reward-levels-form";
import type { Settings } from "@/types";

interface RewardLevelsSectionProps {
  levels: RewardLevelsDraft;
  settings: Settings;
  control: Control<SettingsInput>;
  getValues: UseFormGetValues<SettingsInput>;
}

// CB-7 S3 — the scratch-card editor on the loyalty page: a switch, the cafe-wide minimum bill, and every level
// STACKED, each with its own row of boxes (owner answer Q3). It rides the page's ONE Save bar through `levels.extra`,
// and renders INSIDE the settings <form>, so every button here is type="button".
//
// The switch is locked while the feature is not launched, sign-in is off, or scratch cards are blocked for this cafe
// (Tamil Nadu GSTIN / platform flag): shown OFF and disabled, and the stored value is never rewritten by that. A
// block locks only the OFF -> ON direction: a switch that is already ON stays usable so the owner can turn it OFF. A newly opened box or a looked-at level never creates a draft.
export function RewardLevelsSection({ levels, settings, control, getValues }: RewardLevelsSectionProps) {
  const accountsOn = useWatch({ control, name: "dinerAccountsEnabled" }) === true;
  const status = useRewardLevelsStatus();
  // The cost line's example bill: screen state only, never saved, shared by every box's panel.
  const [exampleBill, setExampleBill] = useState(REWARD_COST_EXAMPLE_BILL_DEFAULT);
  const [copyNotes, setCopyNotes] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Discard (or a Save) ends the draft the copy notes describe, so they go with it — reset during render, React's
  // pattern for state that follows a prop (s89h review: the notes outlived a Discard).
  const [wasDirty, setWasDirty] = useState(levels.dirty);
  if (wasDirty !== levels.dirty) {
    setWasDirty(levels.dirty);
    if (!levels.dirty) setCopyNotes([]);
  }

  const cfg = levels.current;
  const switchable = canSwitchOn(accountsOn);
  const launched = canSwitchOn(true);
  const switchChecked = switchable && cfg?.enabled === true;
  const switchText = !launched ? SWITCH_LOCKED : !accountsOn ? SWITCH_NEEDS_SIGN_IN : SWITCH_EFFECT;
  // Nothing at all while the answer is loading: a note that flashes in and out is worse than a late one.
  const blockedText = gstinBlocksScratch(settings.gstNumber) ? BLOCKED_TN : status.scratchBlocked === true ? BLOCKED_PLATFORM : null;
  const minBillError = levels.problems.find((p) => p.level === null && p.field === "minBill")?.message ?? null;
  const firstProblem = levels.problems[0];

  return (
    <>
      <SettingsGroup
        title="Scratch cards"
        description="Diners scratch a card for a surprise reward as they keep coming back. Set up the levels below."
      >
        <ToggleRow
          label={SWITCH_LABEL}
          description={switchText}
          disabled={!switchable || (blockedText !== null && !switchChecked)}
          checked={switchChecked}
          onChange={(next) => {
            // Reachable only while launched; with nothing set up there is nothing to switch on.
            if (cfg !== null) levels.edit((current) => setEnabled(current, next));
          }}
        />

        {blockedText !== null && (
          <p className={REWARD_NOTE_CLASS} role="status">
            {blockedText}
          </p>
        )}

        {levels.unreadable && (
          <div className={`${REWARD_NOTE_CLASS} space-y-3`} role="status">
            <p>{UNREADABLE_NOTICE}</p>
            <Button type="button" variant="outline" className={REWARD_BUTTON_CLASS} onClick={() => levels.replace(null)}>
              Start over
            </Button>
          </div>
        )}

        {cfg !== null && (
          <RewardNumberField
            label="Bills of at least (₹)"
            value={cfg.minBill}
            min={REWARD_MIN_BILL_MIN}
            max={REWARD_MIN_BILL_MAX}
            error={minBillError}
            hint="Only bills at or above this amount count toward a card. Leave blank to count every bill."
            onText={(text) => levels.edit((current) => setMinBill(current, minBillValue(optionalNumber(text))))}
          />
        )}

        {levels.nothingSetUp && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-brand-ink">Start from a ready-made setup</p>
            <RewardStarterButtons levels={levels} getValues={getValues} onCopyNotes={setCopyNotes} />
          </div>
        )}

        {cfg !== null && !switchChecked && (
          <div>
            <Button type="button" variant="ghost" className={`${REWARD_BUTTON_CLASS} px-2 text-brand-danger hover:text-brand-danger`} onClick={() => setConfirmOpen(true)}>
              Start over
            </Button>
          </div>
        )}
      </SettingsGroup>

      {cfg !== null && (
        <SettingsGroup
          title="Levels"
          description="A card with boxes. Tap a box to say what diners can win there. Each level is a fresh card with its own boxes."
        >
          {firstProblem !== undefined && (
            <p className={BRAND_FIELD_ERROR_CLASS} role="alert">
              {`Fix this before you save. ${problemSentence(firstProblem)}`}
            </p>
          )}

          {copyNotes.length > 0 && (
            <div className={`${REWARD_NOTE_CLASS} space-y-2`} role="status">
              <p className="font-medium">Some of your stamp rewards were left out:</p>
              <ul className="list-disc space-y-1 pl-5">
                {copyNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <Button type="button" variant="outline" className={REWARD_BUTTON_CLASS} onClick={() => setCopyNotes([])}>
                Dismiss
              </Button>
            </div>
          )}

          {cfg.levels.map((_, index) => (
            // A level has no id of its own; the list only ever changes by adding at the end or removing one, and each
            // grid keeps nothing but which box is open, so the position is a safe key.
            <div key={index} className="border-t border-brand-rule pt-4 first:border-t-0 first:pt-0">
              <RewardLevelGrid levels={levels} levelIndex={index} exampleBill={exampleBill} onExampleBillChange={setExampleBill} />
            </div>
          ))}

          {levels.positionWarning !== null && (
            <p className={REWARD_NOTE_CLASS} role="status">
              {levels.positionWarning}
            </p>
          )}

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className={`${REWARD_BUTTON_CLASS} w-full sm:w-auto`}
              disabled={cfg.levels.length >= REWARD_LEVELS_MAX}
              onClick={() => levels.edit(addLevel)}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add a level
            </Button>
            <p className={HINT_CLASS}>
              {cfg.levels.length >= REWARD_LEVELS_MAX
                ? `You can have up to ${REWARD_LEVELS_MAX} levels.`
                : "After the last level, diners repeat it."}
            </p>
          </div>
        </SettingsGroup>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Start over?"
        description="This clears your scratch-card setup. Nothing changes for diners until you save."
        confirmLabel="Start over"
        onConfirm={() => {
          levels.replace(null);
          setCopyNotes([]);
          setConfirmOpen(false);
        }}
      />
    </>
  );
}
