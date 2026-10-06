"use client";

import Link from "next/link";
import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRINT_NUMBER_START_MIN, PRINT_NUMBER_START_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Field, HINT_CLASS, HINT_LINK_CLASS, SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { blankToMinStart, makeNumberStartBlurHandler } from "@/components/settings/print-form-utils";
import { settingsSectionPath } from "@/lib/settings-sections";

const BILL_NUMBER_START_ID = "settings-bill-number-start";
const GST_NUMBER_HINT = "A GST bill needs a bill number. Turn on Show bill number to print it.";

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

interface BillNumberingCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  // A bill design is being edited and the saved settings print GST. Only a hint: nothing here (or anywhere) turns
  // the number on by itself, and the switch stays free.
  gstHint: boolean;
}

// The bill number group, moved out of BillPrintCard so it stays on the page when a design replaces the layout
// toggles: "Show bill number" is the one control for the number on every design. Same registered names and the
// same print-form-utils wiring as before.
export function BillNumberingCard({ control, register, setValue, watch, errors, gstHint }: BillNumberingCardProps) {
  const showNumber = watch("billShowNumber");
  const billNumberStartRegistration = register("billNumberStart", { setValueAs: blankToMinStart });
  const handleBillNumberStartBlur = makeNumberStartBlurHandler(setValue, "billNumberStart");

  return (
    <SettingsGroup
      stacked
      title="Bill number"
      description={<RestartNote lead="A number on each bill." />}
    >
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
      {gstHint && !showNumber && <p className={HINT_CLASS}>{GST_NUMBER_HINT}</p>}
      {showNumber && (
        <Field
          label="Bill number starts at"
          htmlFor={BILL_NUMBER_START_ID}
          error={errors.billNumberStart?.message}
          hint="Applies from the next bill onward; the counter resets every day."
        >
          <Input
            id={BILL_NUMBER_START_ID}
            className={cn(BRAND_CONTROL_CLASS, "w-32")}
            type="number"
            inputMode="numeric"
            min={PRINT_NUMBER_START_MIN}
            max={PRINT_NUMBER_START_MAX}
            {...billNumberStartRegistration}
            onBlur={(e) => {
              void billNumberStartRegistration.onBlur(e);
              handleBillNumberStartBlur(e);
            }}
          />
        </Field>
      )}
    </SettingsGroup>
  );
}
