"use client";

import Link from "next/link";
import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRINT_NUMBER_START_MIN, PRINT_NUMBER_START_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Field, HINT_LINK_CLASS, SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";
import { KotSwitch } from "@/components/settings/KotPrintCard";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { blankToMinStart, makeNumberStartBlurHandler } from "@/components/settings/print-form-utils";
import { settingsSectionPath } from "@/lib/settings-sections";

const KOT_NUMBER_START_ID = "settings-kot-number-start";

// "Numbers start again at" is set once for the token, the ticket and the bill, on the Tokens & numbering page.
function RestartNote({ lead }: { lead: string }) {
  return (
    <>
      {lead} It starts again every day at the restart time.{" "}
      <Link href={settingsSectionPath("tokens")} className={HINT_LINK_CLASS}>
        Change the restart time
      </Link>
    </>
  );
}

interface KotNumberingCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// The ticket number group, moved out of KotPrintCard so it stays on the page when a design replaces the layout
// toggles: "Show ticket number" is the one control for the number on every design. Same registered names and the
// same print-form-utils wiring as before.
export function KotNumberingCard({ control, register, setValue, watch, errors }: KotNumberingCardProps) {
  const showNumber = watch("kotShowNumber");
  const kotNumberStartRegistration = register("kotNumberStart", { setValueAs: blankToMinStart });
  const handleKotNumberStartBlur = makeNumberStartBlurHandler(setValue, "kotNumberStart");

  return (
    <SettingsGroup
      stacked
      title="Ticket number"
      description={<RestartNote lead="A number the kitchen can call out." />}
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
  );
}
