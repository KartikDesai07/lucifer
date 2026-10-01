"use client";

import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  POS_LAYOUTS,
  TABLE_LONG_STAY_MAX_MINUTES,
  TABLE_LONG_STAY_MIN_MINUTES,
} from "@/lib/constants";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { Field } from "@/components/settings/SettingsFields";
import { BRAND_CONTROL_CLASS, BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";

// Plain-English labels for the POS_LAYOUTS enum — never render the raw
// camelCase value.
const POS_LAYOUT_LABELS: Record<(typeof POS_LAYOUTS)[number], string> = {
  normal: "Normal",
  byCategory: "By category",
};

interface BusinessDetailsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Business details — restaurant identity (incl. the FSSAI licence number,
// folded in from the old GST card) and the product's own branding, split out
// of the retired GeneralSettingsFields.tsx (CB-UI1 S3).
//
// Settings pass (2026-10-01): 40px fields, white panels, every label tied to
// its input, and no autofocus (on a phone it opened the keyboard over the
// logo as soon as the page loaded).
export function BusinessDetailsFields({
  control,
  register,
  errors,
}: BusinessDetailsFieldsProps) {
  return (
    <>
      {/* Restaurant identity */}
      <Card className={BRAND_PANEL_CLASS}>
        <CardHeader>
          <CardTitle>Restaurant details</CardTitle>
          <CardDescription>
            Your restaurant&apos;s name and contact details, printed at the top of every bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Restaurant logo"
            hint="Printed on bills and kitchen tickets, and shown in the sidebar."
          >
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
          <Field label="Restaurant name" htmlFor="settings-restaurant-name" error={errors.restaurantName?.message}>
            <Input id="settings-restaurant-name" className={BRAND_CONTROL_CLASS} {...register("restaurantName")} />
          </Field>
          <Field label="Tagline" htmlFor="settings-tagline" error={errors.tagline?.message}>
            <Input id="settings-tagline" className={BRAND_CONTROL_CLASS} {...register("tagline")} />
          </Field>
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
        </CardContent>
      </Card>

      {/* New Order screen layout — owner decision 2026-09-29 (UI batch 1 §H). */}
      <Card className={BRAND_PANEL_CLASS}>
        <CardHeader>
          <CardTitle>New order screen</CardTitle>
          <CardDescription>
            How the product grid is arranged when a staff member starts a new order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Layout"
            htmlFor="settings-pos-layout"
            hint="By category shows each category's name above its items, in the order set on the Categories screen."
          >
            <Controller
              control={control}
              name="posLayout"
              render={({ field }) => (
                <Select value={field.value ?? "normal"} onValueChange={field.onChange}>
                  <SelectTrigger id="settings-pos-layout" className={BRAND_CONTROL_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POS_LAYOUTS.map((layout) => (
                      <SelectItem key={layout} value={layout}>
                        {POS_LAYOUT_LABELS[layout]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Tables screen — long-stay threshold; the id is the Setup page's "Change" link target. */}
      <Card id="tables-screen" className={BRAND_PANEL_CLASS}>
        <CardHeader>
          <CardTitle>Tables screen</CardTitle>
          <CardDescription>
            How the live floor on the Tables screen flags tables.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Long stay alert (minutes)"
            htmlFor="settings-long-stay"
            error={errors.tableLongStayMinutes?.message}
            hint={`An occupied table shows a Long stay label once its bill has been open this long. ${TABLE_LONG_STAY_MIN_MINUTES} to ${TABLE_LONG_STAY_MAX_MINUTES} minutes.`}
          >
            <Input
              id="settings-long-stay"
              className={BRAND_CONTROL_CLASS}
              type="number"
              inputMode="numeric"
              min={TABLE_LONG_STAY_MIN_MINUTES}
              max={TABLE_LONG_STAY_MAX_MINUTES}
              step={1}
              {...register("tableLongStayMinutes", { valueAsNumber: true })}
            />
          </Field>
        </CardContent>
      </Card>

      {/* App branding — the PRODUCT's mark (tab icon, login screen), distinct
          from the restaurant's own logo above. Never printed on a bill. */}
      <Card className={BRAND_PANEL_CLASS}>
        <CardHeader>
          <CardTitle>App branding</CardTitle>
          <CardDescription>
            How this POS identifies itself. Not printed on customer bills.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    </>
  );
}
