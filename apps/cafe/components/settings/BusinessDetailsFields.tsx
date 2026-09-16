"use client";

import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { Field } from "@/components/settings/SettingsFields";

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
