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
import {
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
  PRINT_NUMBER_START_MAX,
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
import { Field, ToggleRow } from "@/components/settings/SettingsFields";
import {
  blankToMinStart,
  capitalizePrintOption,
  makeNumberStartBlurHandler,
} from "@/components/settings/print-form-utils";

type BillSwitchName =
  | "billShowNumber"
  | "billShowLogo"
  | "billShowAddress"
  | "billShowMobile"
  | "billShowGstNumber"
  | "billShowFssai";

function BillSwitch({
  control,
  name,
  label,
  description,
}: {
  control: Control<SettingsInput>;
  name: BillSwitchName;
  label: string;
  description: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ToggleRow
          label={label}
          description={description}
          checked={field.value}
          onChange={field.onChange}
        />
      )}
    />
  );
}

interface BillPrintCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// The customer's slip, regrouped into three cards (CB-UI1 S3): Numbering,
// Show on the bill, and Paper and text. Same registered names, same
// BillSwitch/Field/print-form-utils wiring as before the regroup.
export function BillPrintCard({ control, register, setValue, watch, errors }: BillPrintCardProps) {
  const showNumber = watch("billShowNumber");
  const showLogo = watch("billShowLogo");
  const billNumberStartRegistration = register("billNumberStart", { setValueAs: blankToMinStart });
  const handleBillNumberStartBlur = makeNumberStartBlurHandler(setValue, "billNumberStart");

  // Cross-section hints (audit hazards 1-3): a toggle here prints a value
  // that only Business details / GST & taxes can set. Read from the form's
  // own loaded defaults — no extra fetch.
  const hasLogo = Boolean(watch("logo"));
  const hasGstNumber = Boolean(watch("gstNumber"));
  const hasFssai = Boolean(watch("fssai"));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Numbering</CardTitle>
          <CardDescription>Sequential bill numbers, and where they start.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={control}
            name="billShowNumber"
            render={({ field }) => (
              <ToggleRow
                label="Show bill number"
                description="Prints a sequential number on each bill."
                checked={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  // Turning the reveal off unmounts the field below without
                  // shouldUnregister — a stale invalid value would otherwise
                  // survive in form state where the operator can no longer
                  // see or fix it, permanently blocking Save.
                  if (!v) {
                    setValue("billNumberStart", PRINT_NUMBER_START_MIN, { shouldValidate: true });
                  }
                }}
              />
            )}
          />
          {showNumber && (
            <div className="rounded-lg border p-4">
              <Field
                label="Bill number starts at"
                error={errors.billNumberStart?.message}
                hint="Applies from the next bill onward; the counter resets every day."
              >
                <Input
                  type="number"
                  min={PRINT_NUMBER_START_MIN}
                  max={PRINT_NUMBER_START_MAX}
                  {...billNumberStartRegistration}
                  onBlur={(e) => {
                    void billNumberStartRegistration.onBlur(e);
                    handleBillNumberStartBlur(e);
                  }}
                />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Show on the bill</CardTitle>
          <CardDescription>What prints on the customer&apos;s bill.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <BillSwitch
            control={control}
            name="billShowLogo"
            label="Show logo"
            description="Prints the restaurant's logo at the top of the bill."
          />
          {!hasLogo && (
            <p className="text-xs text-muted-foreground">
              Add a logo in Business details to print it.
            </p>
          )}
          {showLogo && (
            <div className="rounded-lg border p-4">
              <Field label="Logo size">
                <Controller
                  control={control}
                  name="billLogoSize"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRINT_LOGO_SIZES.map((size) => (
                          <SelectItem key={size} value={size}>
                            {capitalizePrintOption(size)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          )}

          <BillSwitch
            control={control}
            name="billShowAddress"
            label="Show address"
            description="Prints the restaurant's address on the bill."
          />
          <BillSwitch
            control={control}
            name="billShowMobile"
            label="Show contact mobile"
            description="Prints the restaurant's contact number on the bill."
          />
          <BillSwitch
            control={control}
            name="billShowGstNumber"
            label="Show GST number"
            description="Prints the GST number on the bill, when one is set."
          />
          {!hasGstNumber && (
            <p className="text-xs text-muted-foreground">
              Add a GST number in GST & taxes to print it.
            </p>
          )}
          <BillSwitch
            control={control}
            name="billShowFssai"
            label="Show FSSAI number"
            description="Prints the FSSAI license number on the bill, when one is set."
          />
          {!hasFssai && (
            <p className="text-xs text-muted-foreground">
              Add an FSSAI licence number in Business details to print it.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paper and text</CardTitle>
          <CardDescription>Must match the actual printer, or the bill will misprint.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paper width">
              <Controller
                control={control}
                name="billPaperWidth"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAPER_WIDTHS.map((width) => (
                        <SelectItem key={width} value={width}>
                          {width}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field label="Font size">
              <Controller
                control={control}
                name="billFontSize"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRINT_FONT_SIZES.map((size) => (
                        <SelectItem key={size} value={size}>
                          {capitalizePrintOption(size)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
