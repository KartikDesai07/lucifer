"use client";

import { Controller } from "react-hook-form";
import type { Control, UseFormWatch } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  HINT_CLASS,
  SectionLink,
  SettingsGroup,
  ToggleRow,
} from "@/components/settings/SettingsFields";

const TOTAL_DESCRIPTION = "Prints the total of the dishes on this ticket, not the whole bill.";
const TOTAL_NEEDS_PRICES = " Turn on Show prices to print the total.";

// Every on/off field of the kitchen ticket (the numbering card uses this switch too).
type KotSwitchName = {
  [K in keyof SettingsInput & `kot${string}`]: SettingsInput[K] extends boolean ? K : never;
}[keyof SettingsInput & `kot${string}`];

// A toggle with an optional hint under it (a pointer to the section that sets
// the value this toggle prints, or the reason the toggle is switched off).
export function KotSwitch({
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
  watch: UseFormWatch<SettingsInput>;
}

// The kitchen's slip (settings pass slice 6, s68): the top of the ticket, the
// order details, then the prices. The ticket number lives in KotNumberingCard,
// paper and text size in KotPaperFields; the live sample ticket is
// KitchenTicketPreview. The page hides this card while a ticket design is being
// edited (the design's own lines replace these toggles).
export function KotPrintCard({ control, watch }: KotPrintCardProps) {
  const showPrices = watch("kotShowPrices");

  // Cross-section hints (audit hazards 1-3): a toggle here prints a value
  // that only Business details can set. Read from the form's own loaded
  // defaults — no extra fetch.
  const hasLogo = Boolean(watch("logo"));
  const hasRestaurantName = Boolean(watch("restaurantName"));

  return (
    <div className="space-y-6">
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
