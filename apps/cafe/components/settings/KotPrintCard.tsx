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

type KotSwitchName =
  | "kotShowPrices"
  | "kotShowTotal"
  | "kotShowNumber"
  | "kotNumberVoidSlips"
  | "kotShowLogo"
  | "kotShowRestaurantName"
  | "kotShowTable"
  | "kotShowStaff"
  | "kotShowTime"
  | "kotShowNotes";

function KotSwitch({
  control,
  name,
  label,
  description,
}: {
  control: Control<SettingsInput>;
  name: KotSwitchName;
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

interface KotPrintCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// The kitchen ticket (formerly the lone kotShowPrices toggle on the General
// tab). Same conditional-reveal idiom as BillPrintCard: the number-start and
// void-slip-numbering fields only matter once ticket numbering is on.
export function KotPrintCard({ control, register, setValue, watch, errors }: KotPrintCardProps) {
  const showNumber = watch("kotShowNumber");
  const kotNumberStartRegistration = register("kotNumberStart", { setValueAs: blankToMinStart });
  const handleKotNumberStartBlur = makeNumberStartBlurHandler(setValue, "kotNumberStart");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kitchen ticket (KOT)</CardTitle>
        <CardDescription>
          Options for the kitchen order ticket printed from the POS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <KotSwitch
          control={control}
          name="kotShowPrices"
          label="Show prices"
          description="Prints the per-line amount beside each dish on the ticket."
        />
        <KotSwitch
          control={control}
          name="kotShowTotal"
          label="Show total"
          description="Prints the order total at the foot of the ticket."
        />
        <Controller
          control={control}
          name="kotShowNumber"
          render={({ field }) => (
            <ToggleRow
              label="Show ticket number"
              description="Prints a sequential number on each kitchen ticket."
              checked={field.value}
              onChange={(v) => {
                field.onChange(v);
                // Turning the reveal off unmounts the field below without
                // shouldUnregister — a stale invalid value would otherwise
                // survive in form state where the operator can no longer
                // see or fix it, permanently blocking Save.
                if (!v) {
                  setValue("kotNumberStart", PRINT_NUMBER_START_MIN, { shouldValidate: true });
                }
              }}
            />
          )}
        />
        {showNumber && (
          <div className="space-y-4 rounded-lg border p-4">
            <Field
              label="Ticket number starts at"
              error={errors.kotNumberStart?.message}
              hint="Applies from the next ticket onward; the counter resets every day."
            >
              <Input
                type="number"
                min={PRINT_NUMBER_START_MIN}
                max={PRINT_NUMBER_START_MAX}
                {...kotNumberStartRegistration}
                onBlur={(e) => {
                  void kotNumberStartRegistration.onBlur(e);
                  handleKotNumberStartBlur(e);
                }}
              />
            </Field>
            <KotSwitch
              control={control}
              name="kotNumberVoidSlips"
              label="Number void slips"
              description="A void reprint takes the next number in the same series."
            />
          </div>
        )}

        <KotSwitch
          control={control}
          name="kotShowLogo"
          label="Show logo"
          description="Prints the restaurant's logo at the top of the ticket."
        />
        <KotSwitch
          control={control}
          name="kotShowRestaurantName"
          label="Show restaurant name"
          description="Prints the restaurant's name at the top of the ticket."
        />
        <KotSwitch
          control={control}
          name="kotShowTable"
          label="Show table"
          description="Prints which table the order is for."
        />
        <KotSwitch
          control={control}
          name="kotShowStaff"
          label="Show staff"
          description="Prints the name of the staff member who fired the order."
        />
        <KotSwitch
          control={control}
          name="kotShowTime"
          label="Show time"
          description="Prints the time the order was fired."
        />
        <KotSwitch
          control={control}
          name="kotShowNotes"
          label="Show notes"
          description="Prints any special-request notes attached to the order."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Paper width"
            hint="Must match the actual printer, or the ticket will misprint."
          >
            <Controller
              control={control}
              name="kotPaperWidth"
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
              name="kotFontSize"
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
  );
}
