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
export function BusinessDetailsFields({
  control,
  register,
  errors,
}: BusinessDetailsFieldsProps) {
  return (
    <>
      {/* Restaurant identity */}
      <Card>
        <CardHeader>
          <CardTitle>Restaurant details</CardTitle>
          <CardDescription>
            Shown at the top of every printed receipt.
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
          <Field label="Restaurant name" error={errors.restaurantName?.message}>
            <Input autoFocus {...register("restaurantName")} />
          </Field>
          <Field label="Tagline" error={errors.tagline?.message}>
            <Input {...register("tagline")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact mobile" error={errors.mobile?.message}>
              <Input inputMode="tel" {...register("mobile")} />
            </Field>
            <Field label="Address" error={errors.address?.message}>
              <Input {...register("address")} />
            </Field>
          </div>
          <Field
            label="FSSAI licence number"
            error={errors.fssai?.message}
            hint="Printed on the receipt when set."
          >
            <Input {...register("fssai")} />
          </Field>
        </CardContent>
      </Card>

      {/* New Order screen layout — owner decision 2026-09-29 (UI batch 1 §H). */}
      <Card>
        <CardHeader>
          <CardTitle>New order screen</CardTitle>
          <CardDescription>
            How the product grid is arranged when a staff member starts a new order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="New order screen"
            hint="By category shows each category's name above its items, in the order set on the Categories screen."
          >
            <Controller
              control={control}
              name="posLayout"
              render={({ field }) => (
                <Select value={field.value ?? "normal"} onValueChange={field.onChange}>
                  <SelectTrigger>
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
      <Card id="tables-screen">
        <CardHeader>
          <CardTitle>Tables screen</CardTitle>
          <CardDescription>
            How the live floor on the Tables screen flags tables.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Long stay alert (minutes)"
            error={errors.tableLongStayMinutes?.message}
            hint={`An occupied table shows a Long stay label once its bill has been open this long. ${TABLE_LONG_STAY_MIN_MINUTES} to ${TABLE_LONG_STAY_MAX_MINUTES} minutes.`}
          >
            <Input
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
      <Card>
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
