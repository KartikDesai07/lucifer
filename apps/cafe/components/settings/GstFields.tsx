"use client";

import { AppLink } from "@/components/layout/AppLink";
import { Controller } from "react-hook-form";
import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { GST_RATES } from "@/lib/constants";
import { cn, inr } from "@/lib/utils";
import { SAMPLE_ITEM_PRICE } from "@/lib/gst-sample-bill";
import { settingsSectionPath } from "@/lib/settings-sections";
import type { Settings } from "@/types";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_CELL_RIGHT_CLASS,
  SETTINGS_CHIP_CLASS,
  SETTINGS_CHIP_OFF_CLASS,
  SETTINGS_CHIP_ON_CLASS,
  SETTINGS_INPUT_CLASS,
  SETTINGS_LINK_CLASS,
  SETTINGS_MAIN_CARD_CLASS,
  SETTINGS_NUMBER_CLASS,
  SETTINGS_PREVIEW_GRID_CLASS,
  SETTINGS_UNIT_BOX_CLASS,
  TAXES_PREVIEW_CLASS,
} from "@/lib/settings-card-layout";
import { CardField, SettingsCard, SettingsSwitchRow } from "@/components/settings/SettingsCard";
import { GstModePicker } from "@/components/settings/GstModePicker";
import { GstSampleBill } from "@/components/settings/GstSampleBill";

interface GstFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  settings: Settings;
}

// GST & taxes — split out of the retired GeneralSettingsFields.tsx (CB-UI1
// S3). Settings pass slice 3 (s65): worked-example tiles for how prices work,
// and a live sample bill.
// New UI (2026-11-08, docs/superpowers/plans/2026-11-08-settings-taxes-ui.md):
// one card per group. One column in DOM order; from 1280px the sample bill is a
// sticky column beside the cards (lib/settings-card-layout.ts). With GST off
// only the GST card shows, in the left column, so it never jumps.
export function GstFields({ control, register, setValue, watch, errors, settings }: GstFieldsProps) {
  const gstEnabled = watch("gstEnabled");
  const gstRate = watch("gstRate");

  return (
    <div className={SETTINGS_PREVIEW_GRID_CLASS}>
      <SettingsCard title="GST" sub="Turn on if your restaurant charges GST." className={SETTINGS_MAIN_CARD_CLASS}>
        <Controller
          control={control}
          name="gstEnabled"
          render={({ field }) => (
            <SettingsSwitchRow
              label="Charge GST"
              sub="Bills show the GST on every sale."
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </SettingsCard>

      {gstEnabled && (
        <>
          <SettingsCard
            title="How prices work"
            sub="Pick how your menu prices relate to GST."
            className={SETTINGS_MAIN_CARD_CLASS}
          >
            <Controller
              control={control}
              name="gstMode"
              render={({ field }) => (
                <GstModePicker value={field.value} onChange={field.onChange} rate={gstRate} />
              )}
            />
          </SettingsCard>

          <SettingsCard
            title="GST rate"
            sub="The rate on every bill. Most restaurants charge 5%."
            className={SETTINGS_MAIN_CARD_CLASS}
          >
            <div role="group" aria-label="Common GST rates" className="flex flex-wrap gap-2">
              {GST_RATES.map((r) => {
                const selected = gstRate === r;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setValue("gstRate", r, { shouldDirty: true, shouldValidate: true })}
                    className={cn(SETTINGS_CHIP_CLASS, selected ? SETTINGS_CHIP_ON_CLASS : SETTINGS_CHIP_OFF_CLASS)}
                  >
                    {r}%
                  </button>
                );
              })}
            </div>
            <CardField label="Other rate" htmlFor="settings-gst-rate" error={errors.gstRate?.message}>
              <div className={SETTINGS_UNIT_BOX_CLASS}>
                <input
                  id="settings-gst-rate"
                  className={SETTINGS_NUMBER_CLASS}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  aria-invalid={errors.gstRate ? true : undefined}
                  {...register("gstRate", { valueAsNumber: true })}
                />
                <span className={SETTINGS_CELL_RIGHT_CLASS}>%</span>
              </div>
            </CardField>
          </SettingsCard>

          <SettingsCard
            title="GST number"
            sub="Your GSTIN. It prints at the top of the bill."
            className={SETTINGS_MAIN_CARD_CLASS}
          >
            <CardField label="GSTIN" htmlFor="settings-gst-number" error={errors.gstNumber?.message}>
              <Input
                id="settings-gst-number"
                className={SETTINGS_INPUT_CLASS}
                placeholder="22AAAAA0000A1Z5"
                autoCapitalize="characters"
                {...register("gstNumber")}
              />
            </CardField>
          </SettingsCard>

          <SettingsCard
            title="Bill preview"
            sub={
              <>
                A {inr(SAMPLE_ITEM_PRICE)} sample item with these settings. Choose which lines print in{" "}
                <AppLink href={settingsSectionPath("bill-print")} className={SETTINGS_LINK_CLASS}>
                  Bill print
                </AppLink>
                .
              </>
            }
            className={TAXES_PREVIEW_CLASS}
            bodyClassName="rounded-b-[12px] bg-surface-2 p-3"
          >
            <GstSampleBill control={control} settings={settings} />
          </SettingsCard>
        </>
      )}
    </div>
  );
}
