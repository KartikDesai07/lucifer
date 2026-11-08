"use client";

import { AppLink } from "@/components/layout/AppLink";
import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { settingsSectionPath } from "@/lib/settings-sections";
import {
  BUSINESS_PREVIEW_CLASS,
  SETTINGS_INPUT_CLASS,
  SETTINGS_LINK_CLASS,
  SETTINGS_MAIN_CARD_CLASS,
  SETTINGS_PREVIEW_GRID_CLASS,
} from "@/lib/settings-card-layout";
import type { Settings } from "@/types";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { CardField, SettingsCard } from "@/components/settings/SettingsCard";
import { BillHeaderPreview } from "@/components/settings/BillHeaderPreview";
import { ScreensSettingsCard } from "@/components/settings/ScreensSettingsCard";
import { UpiPaymentsCard } from "@/components/settings/UpiPaymentsCard";

interface BusinessDetailsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  settings: Settings;
}

// Business details — restaurant identity (incl. the FSSAI licence number,
// folded in from the old GST card), the UPI payments, the screen options and
// the product's own branding, split out of the retired GeneralSettingsFields.tsx
// (CB-UI1 S3).
//
// Settings pass (2026-10-01): every label tied to its input, and no autofocus
// (on a phone it opened the keyboard over the logo as soon as the page loaded).
// New UI (2026-11-06, docs/superpowers/plans/2026-11-06-settings-business-ui.md):
// five cards and a Bill preview. One column in DOM order; from 1280px the
// preview is a sticky column beside the cards (lib/settings-card-layout.ts).
export function BusinessDetailsFields({
  control,
  register,
  errors,
  settings,
}: BusinessDetailsFieldsProps) {
  return (
    <div className={SETTINGS_PREVIEW_GRID_CLASS}>
      <SettingsCard
        title="Restaurant"
        sub="Your name, logo and tagline. They print at the top of every bill."
        className={SETTINGS_MAIN_CARD_CLASS}
      >
        <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
          <CardField label="Restaurant logo" hint="On bills, kitchen tickets and the sidebar.">
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
          </CardField>
          <div className="grid content-start gap-4">
            <CardField label="Restaurant name" htmlFor="settings-restaurant-name" error={errors.restaurantName?.message}>
              <Input id="settings-restaurant-name" className={SETTINGS_INPUT_CLASS} {...register("restaurantName")} />
            </CardField>
            <CardField label="Tagline" htmlFor="settings-tagline" error={errors.tagline?.message}>
              <Input id="settings-tagline" className={SETTINGS_INPUT_CLASS} {...register("tagline")} />
            </CardField>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Contact & licence"
        sub="Printed under your name on bills."
        className={SETTINGS_MAIN_CARD_CLASS}
      >
        <CardField label="Address" htmlFor="settings-address" error={errors.address?.message}>
          <Input id="settings-address" className={SETTINGS_INPUT_CLASS} {...register("address")} />
        </CardField>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <CardField label="Contact mobile" htmlFor="settings-mobile" error={errors.mobile?.message}>
            <Input id="settings-mobile" type="tel" inputMode="tel" className={SETTINGS_INPUT_CLASS} {...register("mobile")} />
          </CardField>
          <CardField
            label="FSSAI licence number"
            htmlFor="settings-fssai"
            error={errors.fssai?.message}
            hint="Printed on the bill when set."
          >
            <Input id="settings-fssai" className={SETTINGS_INPUT_CLASS} {...register("fssai")} />
          </CardField>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Bill preview"
        sub={
          <>
            How the top of a bill looks. Choose which lines print in{" "}
            <AppLink href={settingsSectionPath("bill-print")} className={SETTINGS_LINK_CLASS}>
              Bill print
            </AppLink>
            .
          </>
        }
        className={BUSINESS_PREVIEW_CLASS}
        bodyClassName="rounded-b-[12px] bg-surface-2 p-3"
      >
        <BillHeaderPreview control={control} settings={settings} />
      </SettingsCard>

      <UpiPaymentsCard control={control} register={register} errors={errors} className={SETTINGS_MAIN_CARD_CLASS} />

      <ScreensSettingsCard control={control} register={register} errors={errors} className={SETTINGS_MAIN_CARD_CLASS} />

      {/* App branding — the PRODUCT's mark (tab icon, login screen), distinct
          from the restaurant's own logo above. Never printed on a bill. */}
      <SettingsCard
        title="App branding"
        sub="How this POS identifies itself. Never printed on bills."
        className={SETTINGS_MAIN_CARD_CLASS}
      >
        <CardField
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
        </CardField>
      </SettingsCard>
    </div>
  );
}
