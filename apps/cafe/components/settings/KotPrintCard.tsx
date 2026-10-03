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
import { PRINT_NUMBER_START_MIN, PRINT_NUMBER_START_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Field,
  HINT_CLASS,
  SectionLink,
  SettingsGroup,
  ToggleRow,
} from "@/components/settings/SettingsFields";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import {
  blankToMinStart,
  makeNumberStartBlurHandler,
} from "@/components/settings/print-form-utils";

const KOT_NUMBER_START_ID = "settings-kot-number-start";
const TOTAL_DESCRIPTION = "Prints the total of the dishes on this ticket, not the whole bill.";
const TOTAL_NEEDS_PRICES = " Turn on Show prices to print the total.";

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

// A toggle with an optional hint under it (a pointer to the section that sets
// the value this toggle prints, or the reason the toggle is switched off).
function KotSwitch({
  control,
  name,
  label,
  description,
  hint,
  disabled,
}: {
  control: Control<SettingsInput>;
  name: KotSwitchName;
  label: string;
  description: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <ToggleRow
            label={label}
            description={description}
            checked={field.value}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
      {hint && <p className={HINT_CLASS}>{hint}</p>}
    </div>
  );
}

interface KotPrintCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// The kitchen's slip (settings pass slice 6, s68): the ticket number, the top
// of the ticket, the order details, then the prices. Paper and text size live
// in KotPaperFields; the live sample ticket is KitchenTicketPreview. Same
// registered names and the same print-form-utils wiring as before the redesign.
export function KotPrintCard({ control, register, setValue, watch, errors }: KotPrintCardProps) {
  const showNumber = watch("kotShowNumber");
  const showPrices = watch("kotShowPrices");
  const kotNumberStartRegistration = register("kotNumberStart", { setValueAs: blankToMinStart });
  const handleKotNumberStartBlur = makeNumberStartBlurHandler(setValue, "kotNumberStart");

  // Cross-section hints (audit hazards 1-3): a toggle here prints a value
  // that only Business details can set. Read from the form's own loaded
  // defaults — no extra fetch.
  const hasLogo = Boolean(watch("logo"));
  const hasRestaurantName = Boolean(watch("restaurantName"));

  return (
    <div className="space-y-6">
      <SettingsGroup
        stacked
        title="Ticket number"
        description="A number the kitchen can call out. It starts again every day."
      >
        <Controller
          control={control}
          name="kotShowNumber"
          render={({ field }) => (
            <ToggleRow
              label="Show ticket number"
              description="Prints a number on each kitchen ticket."
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
          <>
            <Field
              label="Ticket number starts at"
              htmlFor={KOT_NUMBER_START_ID}
              error={errors.kotNumberStart?.message}
              hint="Applies from the next ticket onward; the counter resets every day."
            >
              <Input
                id={KOT_NUMBER_START_ID}
                className={cn(BRAND_CONTROL_CLASS, "w-32")}
                type="number"
                inputMode="numeric"
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
              label="Number cancelled-item slips"
              description="When a dish is cancelled, its slip to the kitchen takes the next number too."
            />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup stacked title="Top of the ticket" description="What prints above the order.">
        <KotSwitch
          control={control}
          name="kotShowLogo"
          label="Show logo"
          description="Prints the restaurant's logo at the top of the ticket."
          hint={
            hasLogo ? undefined : (
              <>
                Add a logo in <SectionLink slug="business">Business details</SectionLink> to print it.
              </>
            )
          }
        />
        <KotSwitch
          control={control}
          name="kotShowRestaurantName"
          label="Show restaurant name"
          description="Prints the restaurant's name at the top of the ticket."
          hint={
            hasRestaurantName ? undefined : (
              <>
                Add a restaurant name in <SectionLink slug="business">Business details</SectionLink> to
                print it.
              </>
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup
        stacked
        title="Order details"
        description="Helps the kitchen match the ticket to the order."
      >
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
          description="Prints the name of the staff member who took the order."
        />
        <KotSwitch
          control={control}
          name="kotShowTime"
          label="Show time"
          description="Prints the time the order was placed."
        />
        <KotSwitch
          control={control}
          name="kotShowNotes"
          label="Show order note"
          description="Prints the note added to the whole order. Notes on a dish always print."
        />
      </SettingsGroup>

      <SettingsGroup stacked title="Prices" description="Kitchen tickets usually leave prices off.">
        <KotSwitch
          control={control}
          name="kotShowPrices"
          label="Show prices"
          description="Prints the amount beside each dish."
        />
        <KotSwitch
          control={control}
          name="kotShowTotal"
          label="Show total"
          description={showPrices ? TOTAL_DESCRIPTION : `${TOTAL_DESCRIPTION}${TOTAL_NEEDS_PRICES}`}
          disabled={!showPrices}
        />
      </SettingsGroup>
    </div>
  );
}
