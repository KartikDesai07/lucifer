"use client";

import { useId } from "react";
import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { SELF_ORDER_MODES } from "@pos/shared/public";
import { cn } from "@/lib/utils";
import { SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";

interface SelfOrderCardProps {
  control: Control<SettingsInput>;
}

type SelfOrderMode = (typeof SELF_ORDER_MODES)[number];

// EXHAUSTIVE by construction: a Record keyed on the mode union, not a ternary.
// CB-4 added a third value ("menu"), and the ternary this replaced would have
// compiled unchanged while labelling it "Sends straight to the kitchen" — the
// exact opposite of what it does. A future fourth value now fails tsc here.
const SELF_ORDER_MODE_COPY: Record<(typeof SELF_ORDER_MODES)[number], { label: string; description: string }> = {
  approve: {
    label: "Staff accepts each order",
    description: "The order waits in Order Requests until someone accepts it.",
  },
  auto: {
    label: "Straight to the kitchen",
    description:
      "The order is accepted at once, the same as an order taken at the counter. If that fails, it waits in Order Requests.",
  },
  menu: {
    label: "Menu only",
    description: "Diners see the menu and prices but can't order. Good for replacing a paper menu.",
  },
};

const RECOMMENDED_MODE: SelfOrderMode = "approve";

// Three tiles instead of a drop-down, one column at every width (the copy is a
// sentence long): each is a <label> around a visually hidden native radio, the
// same idiom as GstModePicker.
function SelfOrderModePicker({
  value,
  onChange,
}: {
  value: SelfOrderMode;
  onChange: (value: SelfOrderMode) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">When a diner places an order</legend>
      <div className="grid gap-2">
        {SELF_ORDER_MODES.map((option) => {
          const selected = value === option;
          const copy = SELF_ORDER_MODE_COPY[option];
          const labelId = `${name}-${option}-label`;
          const badgeId = `${name}-${option}-badge`;
          const recommended = option === RECOMMENDED_MODE;
          return (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                selected
                  ? "border-brand-primary bg-brand-primary-soft"
                  : "border-brand-rule bg-brand-slip hover:bg-brand-wash",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                aria-labelledby={recommended ? `${labelId} ${badgeId}` : labelId}
                aria-describedby={`${name}-${option}-description`}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                  selected ? "border-brand-primary" : "border-brand-field",
                )}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-brand-primary" />}
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span id={labelId} className="text-[13px] font-medium text-brand-ink">{copy.label}</span>
                  {recommended && (
                    <span
                      id={badgeId}
                      className="rounded-full border border-brand-rule bg-brand-slip px-2 py-0.5 text-xs font-medium text-brand-ink"
                    >
                      Recommended
                    </span>
                  )}
                </span>
                <span id={`${name}-${option}-description`} className="block text-xs text-brand-muted">
                  {copy.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// QR self-ordering — CR2.2. Settings pass slice 7 (s69): two two-column
// groups, the mode as radio tiles (no drop-down). Every field here is
// Controller-driven with no free-text input, so — unlike BillPrintCard/
// KotPrintCard — this card needs neither `register` nor `errors`: these fields
// can never fail settingsSchema validation from the form UI. The "Show past
// orders to diners" switch is hidden because nothing reads it (the diner Orders
// tab always lists that phone's own orders); the field stays in the schema and
// the qr-ordering section list, so its saved value is sent back unchanged.
export function SelfOrderCard({ control }: SelfOrderCardProps) {
  return (
    <>
      <SettingsGroup
        title="Ordering"
        description="What happens when a diner orders from the menu on their phone."
      >
        <Controller
          control={control}
          name="selfOrderMode"
          render={({ field }) => <SelfOrderModePicker value={field.value} onChange={field.onChange} />}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Tables"
        description="For diners who open the menu link without scanning a table's QR code."
      >
        <Controller
          control={control}
          name="allowTableChange"
          render={({ field }) => (
            <ToggleRow
              label="Let diners pick their table"
              description="When off, they can only order a parcel. A scanned table QR code always sets the table."
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </SettingsGroup>
    </>
  );
}
