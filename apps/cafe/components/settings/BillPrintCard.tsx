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
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
  PRINT_NUMBER_START_MAX,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Settings } from "@/types";
import { Input } from "@/components/ui/input";
import {
  Field,
  HINT_CLASS,
  SectionLink,
  SettingsGroup,
  ToggleRow,
} from "@/components/settings/SettingsFields";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import {
  blankToMinStart,
  makeNumberStartBlurHandler,
} from "@/components/settings/print-form-utils";

const BILL_NUMBER_START_ID = "settings-bill-number-start";

type BillSwitchName =
  | "billShowLogo"
  | "billShowAddress"
  | "billShowMobile"
  | "billShowGstNumber"
  | "billShowFssai";

// A toggle with an optional hint under it (a pointer to the section that sets
// the value this toggle prints).
function BillSwitch({
  control,
  name,
  label,
  description,
  hint,
}: {
  control: Control<SettingsInput>;
  name: BillSwitchName;
  label: string;
  description: string;
  hint?: React.ReactNode;
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
          />
        )}
      />
      {hint && <p className={HINT_CLASS}>{hint}</p>}
    </div>
  );
}

interface BillPrintCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  settings: Settings;
}

// The customer's slip (settings pass slice 4, s66): the top of the bill, then
// the bill number. Paper and text size live in BillPaperFields; the live
// sample bill is BillPrintPreview. Same registered names and the same
// print-form-utils wiring as before the redesign.
export function BillPrintCard({ control, register, setValue, watch, errors, settings }: BillPrintCardProps) {
  const showNumber = watch("billShowNumber");
  const showLogo = watch("billShowLogo");
  const billNumberStartRegistration = register("billNumberStart", { setValueAs: blankToMinStart });
  const handleBillNumberStartBlur = makeNumberStartBlurHandler(setValue, "billNumberStart");

  // Cross-section hints (audit hazards 1-3): a toggle here prints a value
  // that only Business details / GST & taxes can set. The values come from the
  // form's own loaded defaults, the GST state from the saved settings.
  const hasLogo = Boolean(watch("logo"));
  const hasGstNumber = Boolean(watch("gstNumber"));
  const hasFssai = Boolean(watch("fssai"));
  const gstPrints = settings.gstEnabled && settings.gstRate > 0;

  let gstNumberHint: React.ReactNode;
  if (!hasGstNumber) {
    gstNumberHint = (
      <>
        Add a GST number in <SectionLink slug="taxes">GST &amp; taxes</SectionLink> to print it.
      </>
    );
  } else if (!gstPrints) {
    gstNumberHint = (
      <>
        It prints only while GST is on in <SectionLink slug="taxes">GST &amp; taxes</SectionLink>.
      </>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsGroup stacked title="Top of the bill" description="What prints above the items.">
        <BillSwitch
          control={control}
          name="billShowLogo"
          label="Show logo"
          description="Prints the restaurant's logo at the top of the bill."
          hint={
            hasLogo ? undefined : (
              <>
                Add a logo in <SectionLink slug="business">Business details</SectionLink> to print it.
              </>
            )
          }
        />
        {showLogo && (
          <Controller
            control={control}
            name="billLogoSize"
            render={({ field }) => (
              <PrintSizeChoice
                legend="Logo size"
                options={PRINT_LOGO_SIZES}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
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
          hint={gstNumberHint}
        />
        <BillSwitch
          control={control}
          name="billShowFssai"
          label="Show FSSAI number"
          description="Prints the FSSAI licence number on the bill, when one is set."
          hint={
            hasFssai ? undefined : (
              <>
                Add an FSSAI licence number in <SectionLink slug="business">Business details</SectionLink> to
                print it.
              </>
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup
        stacked
        title="Bill number"
        description="A number on each bill. It starts again every day."
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
    </div>
  );
}
