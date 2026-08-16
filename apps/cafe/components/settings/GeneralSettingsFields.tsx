"use client";

import { Controller } from "react-hook-form";
import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { GST_MODES, GST_RATES } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Field, ToggleRow } from "@/components/settings/SettingsFields";

interface GeneralSettingsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Restaurant details, receipt text, and GST/Tax — the ORIGINAL settings
// sections, unchanged. The Kitchen ticket card that used to live here moved
// out to PrintSettingsFields (print customization tab).
export function GeneralSettingsFields({
  control,
  register,
  setValue,
  watch,
  errors,
}: GeneralSettingsFieldsProps) {
  const gstEnabled = watch("gstEnabled");

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
          <Field label="Logo">
            <Controller
              control={control}
              name="logo"
              render={({ field }) => (
                <ImageUpload
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
        </CardContent>
      </Card>

      {/* Receipt text */}
      <Card>
        <CardHeader>
          <CardTitle>Receipt text</CardTitle>
          <CardDescription>
            Optional header note and the closing line on the bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Header note"
            error={errors.receiptHeader?.message}
            hint="e.g. GST included · Dine-in"
          >
            <Input {...register("receiptHeader")} />
          </Field>
          <Field label="Footer message" error={errors.receiptFooter?.message}>
            <Textarea rows={2} {...register("receiptFooter")} />
          </Field>
        </CardContent>
      </Card>

      {/* GST */}
      <Card>
        <CardHeader>
          <CardTitle>GST / Tax</CardTitle>
          <CardDescription>
            Configure how tax appears on the bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={control}
            name="gstEnabled"
            render={({ field }) => (
              <ToggleRow
                label="Show GST on bills"
                description="Adds a tax breakdown to printed receipts."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />

          {gstEnabled && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>GST mode</Label>
                  <Controller
                    control={control}
                    name="gstMode"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GST_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m === "inclusive"
                                ? "Inclusive (in price)"
                                : "Exclusive (added on top)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    {watch("gstMode") === "inclusive"
                      ? "Prices already include GST; the bill shows the tax portion."
                      : "GST is added on top, increasing the amount charged."}
                  </p>
                </div>

                <Field label="GST rate (%)" error={errors.gstRate?.message}>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    {...register("gstRate", { valueAsNumber: true })}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {GST_RATES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() =>
                          setValue("gstRate", r, { shouldDirty: true })
                        }
                        className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        {r}%
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field
                label="GST number"
                error={errors.gstNumber?.message}
                hint="Printed on the receipt when set."
              >
                <Input
                  placeholder="22AAAAA0000A1Z5"
                  {...register("gstNumber")}
                />
              </Field>
            </div>
          )}

          <Field
            label="FSSAI number"
            error={errors.fssai?.message}
            hint="Printed on the receipt when set."
          >
            <Input {...register("fssai")} />
          </Field>
        </CardContent>
      </Card>
    </>
  );
}
