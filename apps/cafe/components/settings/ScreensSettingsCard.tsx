"use client";

import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { TABLE_LONG_STAY_MAX_MINUTES, TABLE_LONG_STAY_MIN_MINUTES } from "@/lib/constants";
import { SETTINGS_CELL_RIGHT_CLASS, SETTINGS_NUMBER_CLASS, SETTINGS_UNIT_BOX_CLASS } from "@/lib/settings-card-layout";
import { SCREEN_LOCK_DEFAULT_MINUTES, SCREEN_LOCK_MINUTES } from "@pos/shared/staff-pin";
import { CardField, SettingsBlock, SettingsCard, SettingsSelect } from "@/components/settings/SettingsCard";
import { PosLayoutPicker } from "@/components/settings/PosLayoutPicker";

const SCREEN_LOCK_LABELS: Record<(typeof SCREEN_LOCK_MINUTES)[number], string> = {
  0: "Off",
  30: "30 minutes",
  60: "1 hour",
  120: "2 hours",
};
const SCREEN_LOCK_OPTIONS = SCREEN_LOCK_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: SCREEN_LOCK_LABELS[minutes],
}));

interface ScreensSettingsCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  className?: string;
}

// How the app's screens work for staff: the New order layout, the Tables screen's long-stay alert and the Screen lock,
// moved here from Business details' separate groups (plan D2, 2026-11-06). The ids are anchors; tables-screen is the
// Tables setup page's "Change" link target.
export function ScreensSettingsCard({ control, register, errors, className }: ScreensSettingsCardProps) {
  return (
    <SettingsCard title="Screens" sub="How the app's screens work for your staff." className={className}>
      {/* New Order screen layout — owner decision 2026-09-29 (UI batch 1 §H). */}
      <SettingsBlock title="New order screen" sub="How items are laid out when staff start a new order.">
        <Controller
          control={control}
          name="posLayout"
          render={({ field }) => <PosLayoutPicker value={field.value ?? "normal"} onChange={field.onChange} />}
        />
      </SettingsBlock>

      <SettingsBlock id="tables-screen" title="Tables screen" sub="How the live floor flags tables.">
        <CardField
          label="Long stay alert"
          htmlFor="settings-long-stay"
          error={errors.tableLongStayMinutes?.message}
          hint={`An occupied table's time turns red, with a Long stay clock, once its bill has been open this long. ${TABLE_LONG_STAY_MIN_MINUTES} to ${TABLE_LONG_STAY_MAX_MINUTES} minutes.`}
        >
          <div className={SETTINGS_UNIT_BOX_CLASS}>
            <input
              id="settings-long-stay"
              className={SETTINGS_NUMBER_CLASS}
              type="number"
              inputMode="numeric"
              min={TABLE_LONG_STAY_MIN_MINUTES}
              max={TABLE_LONG_STAY_MAX_MINUTES}
              step={1}
              aria-invalid={errors.tableLongStayMinutes ? true : undefined}
              {...register("tableLongStayMinutes", { valueAsNumber: true })}
            />
            <span className={SETTINGS_CELL_RIGHT_CLASS}>minutes</span>
          </div>
        </CardField>
      </SettingsBlock>

      <SettingsBlock
        id="screen-lock"
        title="Screen lock"
        sub="The screen locks when nobody has touched it for a while. Staff unlock with their PIN."
      >
        <CardField
          label="Lock the screen after no activity for"
          htmlFor="settings-screen-lock"
          error={errors.screenLockMinutes?.message}
        >
          <Controller
            control={control}
            name="screenLockMinutes"
            render={({ field }) => (
              <SettingsSelect
                id="settings-screen-lock"
                value={String(field.value ?? SCREEN_LOCK_DEFAULT_MINUTES)}
                onValueChange={(v) => field.onChange(Number(v))}
                options={SCREEN_LOCK_OPTIONS}
                className="max-w-48"
              />
            )}
          />
        </CardField>
      </SettingsBlock>
    </SettingsCard>
  );
}
