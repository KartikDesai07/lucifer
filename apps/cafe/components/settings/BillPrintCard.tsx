"use client";

import { Controller } from "react-hook-form";
import type { Control, UseFormWatch } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRINT_LOGO_SIZES } from "@/lib/constants";
import type { Settings } from "@/types";
import {
  HINT_CLASS,
  SectionLink,
  SettingsGroup,
  ToggleRow,
} from "@/components/settings/SettingsFields";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";

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
  watch: UseFormWatch<SettingsInput>;
  settings: Settings;
}

// The customer's slip (settings pass slice 4, s66): the top of the bill;
// the bill number is BillNumberingCard (always shown). Paper and text size
// live in BillPaperFields; the live sample bill is BillPrintPreview. While a
// bill design is being edited the page does not render this card: the
// design's own lines replace these toggles, and their form values stay
// untouched.
export function BillPrintCard({ control, watch, settings }: BillPrintCardProps) {
  const showLogo = watch("billShowLogo");

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
  );
}
