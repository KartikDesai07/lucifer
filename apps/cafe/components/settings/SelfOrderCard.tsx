"use client";

import { useId } from "react";
import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { SELF_ORDER_MODES } from "@pos/shared/public";
import { cn } from "@/lib/utils";
import {
  SETTINGS_TILE_CLASS,
  SETTINGS_TILE_DOT_CLASS,
  SETTINGS_TILE_OFF_CLASS,
  SETTINGS_TILE_ON_CLASS,
  SETTINGS_TILE_RADIO_CLASS,
  SETTINGS_TILE_RADIO_OFF_CLASS,
  SETTINGS_TILE_RADIO_ON_CLASS,
} from "@/lib/settings-card-layout";
import { SettingsCard, SettingsSwitchRow } from "@/components/settings/SettingsCard";

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

// The shared tile laid out as a row: the drawn radio beside a sentence-long label. cn is tailwind-merge, so
// flex-row and gap-3 win over the tile's flex-col and gap-2.
const MODE_TILE_CLASS = "min-h-11 flex-row items-start gap-3";

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
              className={cn(SETTINGS_TILE_CLASS, MODE_TILE_CLASS, selected ? SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS)}
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
                  "mt-0.5",
                  SETTINGS_TILE_RADIO_CLASS,
                  selected ? SETTINGS_TILE_RADIO_ON_CLASS : SETTINGS_TILE_RADIO_OFF_CLASS,
                )}
              >
                {selected && <span className={SETTINGS_TILE_DOT_CLASS} />}
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span id={labelId} className="text-[14px] font-semibold text-foreground">{copy.label}</span>
                  {recommended && (
                    <span
                      id={badgeId}
                      className="rounded-full border border-border bg-card px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground"
                    >
                      Recommended
                    </span>
                  )}
                </span>
                <span id={`${name}-${option}-description`} className="block text-[12.5px] leading-snug text-muted-foreground">
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

// QR self-ordering — CR2.2. Settings pass slice 7 (s69): the mode as radio tiles (no drop-down). New UI 2026-11-08
// (docs/superpowers/plans/2026-11-08-settings-qr-ui.md): two SettingsCards. Every field here is
// Controller-driven with no free-text input, so — unlike BillPrintCard/
// KotPrintCard — this card needs neither `register` nor `errors`: these fields
// can never fail settingsSchema validation from the form UI. The "Show past
// orders to diners" switch is hidden because nothing reads it (the diner Orders
// tab always lists that phone's own orders); the field stays in the schema and
// the qr-ordering section list, so its saved value is sent back unchanged.
export function SelfOrderCard({ control }: SelfOrderCardProps) {
  return (
    <>
      <SettingsCard title="Ordering" sub="What happens when a diner orders from the menu on their phone.">
        <Controller
          control={control}
          name="selfOrderMode"
          render={({ field }) => <SelfOrderModePicker value={field.value} onChange={field.onChange} />}
        />
      </SettingsCard>

      <SettingsCard title="Tables" sub="For diners who open the menu link without scanning a table's QR code.">
        <Controller
          control={control}
          name="allowTableChange"
          render={({ field }) => (
            <SettingsSwitchRow
              label="Let diners pick their table"
              sub="When off, they can only order a parcel. A scanned table QR code always sets the table."
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </SettingsCard>
    </>
  );
}
