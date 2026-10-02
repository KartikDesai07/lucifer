"use client";

import Link from "next/link";
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
import { Field, SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";
import { GstModePicker } from "@/components/settings/GstModePicker";
import { GstSampleBill } from "@/components/settings/GstSampleBill";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";

interface GstFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  settings: Settings;
}

// GST & taxes — split out of the retired GeneralSettingsFields.tsx (CB-UI1
// S3). Settings pass slice 3 (s65): two-column groups, worked-example tiles
// for how prices work, and a live sample bill.
export function GstFields({ control, register, setValue, watch, errors, settings }: GstFieldsProps) {
  const gstEnabled = watch("gstEnabled");
  const gstRate = watch("gstRate");

  return (
    <div className="space-y-6">
      <SettingsGroup title="GST" description="Turn on if your restaurant charges GST.">
        <Controller
          control={control}
          name="gstEnabled"
          render={({ field }) => (
            <ToggleRow
              label="Charge GST"
              description="Bills show the GST on every sale."
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </SettingsGroup>

      {gstEnabled && (
        <>
          <SettingsGroup title="How prices work" description="Pick how your menu prices relate to GST.">
            <Controller
              control={control}
              name="gstMode"
              render={({ field }) => (
                <GstModePicker value={field.value} onChange={field.onChange} rate={gstRate} />
              )}
            />
          </SettingsGroup>

          <SettingsGroup
            title="GST rate"
            description="The rate on every bill. Most restaurants charge 5%."
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
                    className={cn(
                      "h-11 min-w-16 rounded-md border px-3 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
                      selected
                        ? "border-brand-primary bg-brand-primary-soft text-brand-ink"
                        : "border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash",
                    )}
                  >
                    {r}%
                  </button>
                );
              })}
            </div>
            <Field label="Other rate" htmlFor="settings-gst-rate" error={errors.gstRate?.message}>
              <div className="flex items-center gap-2">
                <Input
                  id="settings-gst-rate"
                  className={cn(BRAND_CONTROL_CLASS, "w-28")}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  {...register("gstRate", { valueAsNumber: true })}
                />
                <span className="text-sm text-brand-muted">%</span>
              </div>
            </Field>
          </SettingsGroup>

          <SettingsGroup title="GST number" description="Your GSTIN. It prints at the top of the bill.">
            <Field label="GSTIN" htmlFor="settings-gst-number" error={errors.gstNumber?.message}>
              <Input
                id="settings-gst-number"
                className={BRAND_CONTROL_CLASS}
                placeholder="22AAAAA0000A1Z5"
                autoCapitalize="characters"
                {...register("gstNumber")}
              />
            </Field>
          </SettingsGroup>

          <SettingsGroup
            title="Bill preview"
            description={
              <>
                A {inr(SAMPLE_ITEM_PRICE)} sample item with these settings. Choose which lines print in{" "}
                <Link
                  href={settingsSectionPath("bill-print")}
                  className="font-medium text-brand-primary underline-offset-2 hover:underline"
                >
                  Bill print
                </Link>
                .
              </>
            }
            panelClassName="bg-brand-wash p-3 sm:p-5"
          >
            <GstSampleBill control={control} settings={settings} />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
