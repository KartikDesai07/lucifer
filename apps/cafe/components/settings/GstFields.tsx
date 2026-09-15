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
import { Field, ToggleRow } from "@/components/settings/SettingsFields";

interface GstFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// GST & taxes — split out of the retired GeneralSettingsFields.tsx (CB-UI1
// S3). The FSSAI number moved to Business details; everything else here is
// unchanged.
export function GstFields({ control, register, setValue, watch, errors }: GstFieldsProps) {
  const gstEnabled = watch("gstEnabled");

  return (
    <Card>
      <CardHeader>
        <CardTitle>GST & taxes</CardTitle>
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
      </CardContent>
    </Card>
  );
}
