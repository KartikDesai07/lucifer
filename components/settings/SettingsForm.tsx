"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { settingsSchema, type SettingsInput } from "@/schemas";
import { GST_MODES, GST_RATES } from "@/lib/constants";
import { useUpdateSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import type { Settings } from "@/types";

interface SettingsFormProps {
  settings: Settings;
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const updateSettings = useUpdateSettings();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      restaurantName: settings.restaurantName,
      tagline: settings.tagline,
      mobile: settings.mobile,
      address: settings.address,
      receiptHeader: settings.receiptHeader,
      receiptFooter: settings.receiptFooter,
      gstEnabled: settings.gstEnabled,
      gstNumber: settings.gstNumber,
      gstRate: settings.gstRate,
      gstMode: settings.gstMode,
      kotShowPrices: settings.kotShowPrices,
    },
  });

  const gstEnabled = watch("gstEnabled");

  const onSubmit = (values: SettingsInput) => {
    updateSettings.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {/* Restaurant identity */}
      <Card>
        <CardHeader>
          <CardTitle>Restaurant details</CardTitle>
          <CardDescription>
            Shown at the top of every printed receipt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Restaurant name" error={errors.restaurantName?.message}>
            <Input autoFocus {...register("restaurantName")} />
          </Field>
          <Field label="Tagline" error={errors.tagline?.message}>
            <Input placeholder="Brewed with passion" {...register("tagline")} />
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
        </CardContent>
      </Card>

      {/* KOT */}
      <Card>
        <CardHeader>
          <CardTitle>Kitchen ticket (KOT)</CardTitle>
          <CardDescription>
            Options for the kitchen order ticket printed from the POS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Controller
            control={control}
            name="kotShowPrices"
            render={({ field }) => (
              <ToggleRow
                label="Show prices on KOT"
                description="Off by default — kitchens usually don't need prices."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="submit"
          disabled={updateSettings.isPending || !isDirty}
          size="lg"
        >
          {updateSettings.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
