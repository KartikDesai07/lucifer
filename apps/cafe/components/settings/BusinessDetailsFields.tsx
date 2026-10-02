"use client";

import Link from "next/link";
import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  TABLE_LONG_STAY_MAX_MINUTES,
  TABLE_LONG_STAY_MIN_MINUTES,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { settingsSectionPath } from "@/lib/settings-sections";
import type { Settings } from "@/types";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { Field, SettingsGroup } from "@/components/settings/SettingsFields";
import { BillHeaderPreview } from "@/components/settings/BillHeaderPreview";
import { PosLayoutPicker } from "@/components/settings/PosLayoutPicker";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";

interface BusinessDetailsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  settings: Settings;
}

// Business details — restaurant identity (incl. the FSSAI licence number,
// folded in from the old GST card) and the product's own branding, split out
// of the retired GeneralSettingsFields.tsx (CB-UI1 S3).
//
// Settings pass (2026-10-01): 40px fields, white panels, every label tied to
// its input, and no autofocus (on a phone it opened the keyboard over the
// logo as soon as the page loaded).
// Settings pass slice 2 (2026-10-02): two-column groups, a live bill-header
// preview, and picture tiles for the New order screen layout.
export function BusinessDetailsFields({
  control,
  register,
  errors,
  settings,
}: BusinessDetailsFieldsProps) {
  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Restaurant"
        description="Your name, logo and tagline. They print at the top of every bill."
      >
        <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <Field label="Restaurant logo" hint="On bills, kitchen tickets and the sidebar.">
            <Controller
              control={control}
              name="logo"
              render={({ field }) => (
                <ImageUpload
                  slot="logo"
                  value={field.value}
                  onChange={field.onChange}
                  alt="Logo"
                />
              )}
            />
          </Field>
          <div className="space-y-4">
            <Field label="Restaurant name" htmlFor="settings-restaurant-name" error={errors.restaurantName?.message}>
              <Input id="settings-restaurant-name" className={BRAND_CONTROL_CLASS} {...register("restaurantName")} />
            </Field>
            <Field label="Tagline" htmlFor="settings-tagline" error={errors.tagline?.message}>
              <Input id="settings-tagline" className={BRAND_CONTROL_CLASS} {...register("tagline")} />
            </Field>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Contact & licence" description="Printed under your name on bills.">
        <Field label="Address" htmlFor="settings-address" error={errors.address?.message}>
          <Input id="settings-address" className={BRAND_CONTROL_CLASS} {...register("address")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact mobile" htmlFor="settings-mobile" error={errors.mobile?.message}>
            <Input id="settings-mobile" type="tel" inputMode="tel" className={BRAND_CONTROL_CLASS} {...register("mobile")} />
          </Field>
          <Field
            label="FSSAI licence number"
            htmlFor="settings-fssai"
            error={errors.fssai?.message}
            hint="Printed on the bill when set."
          >
            <Input id="settings-fssai" className={BRAND_CONTROL_CLASS} {...register("fssai")} />
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Bill preview"
        description={
          <>
            How the top of a bill looks with these details. Choose which lines print in{" "}
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
        <BillHeaderPreview control={control} settings={settings} />
      </SettingsGroup>

      {/* New Order screen layout — owner decision 2026-09-29 (UI batch 1 §H). */}
      <SettingsGroup
        title="New order screen"
        description="How items are laid out when staff start a new order."
      >
        <Controller
          control={control}
          name="posLayout"
          render={({ field }) => (
            <PosLayoutPicker value={field.value ?? "normal"} onChange={field.onChange} />
          )}
        />
      </SettingsGroup>

      {/* Tables screen — long-stay threshold; the id is the Setup page's "Change" link target. */}
      <SettingsGroup
        id="tables-screen"
        title="Tables screen"
        description="How the live floor flags tables."
      >
        <Field
          label="Long stay alert"
          htmlFor="settings-long-stay"
          error={errors.tableLongStayMinutes?.message}
          hint={`An occupied table shows a Long stay label once its bill has been open this long. ${TABLE_LONG_STAY_MIN_MINUTES} to ${TABLE_LONG_STAY_MAX_MINUTES} minutes.`}
        >
          <div className="flex items-center gap-2">
            <Input
              id="settings-long-stay"
              className={cn(BRAND_CONTROL_CLASS, "w-28")}
              type="number"
              inputMode="numeric"
              min={TABLE_LONG_STAY_MIN_MINUTES}
              max={TABLE_LONG_STAY_MAX_MINUTES}
              step={1}
              {...register("tableLongStayMinutes", { valueAsNumber: true })}
            />
            <span className="text-sm text-brand-muted">minutes</span>
          </div>
        </Field>
      </SettingsGroup>

      {/* App branding — the PRODUCT's mark (tab icon, login screen), distinct
          from the restaurant's own logo above. Never printed on a bill. */}
      <SettingsGroup
        title="App branding"
        description="How this POS identifies itself. Never printed on bills."
      >
        <Field
          label="Product logo"
          hint="Shown in the browser tab and on the login screen. A square image works best."
        >
          <Controller
            control={control}
            name="productLogo"
            render={({ field }) => (
              <ImageUpload
                slot="productLogo"
                value={field.value}
                onChange={field.onChange}
                alt="Product logo"
              />
            )}
          />
        </Field>
      </SettingsGroup>
    </div>
  );
}
