"use client";

import { Controller } from "react-hook-form";
import type { Control, FieldErrors } from "react-hook-form";

import {
  PAY_QR_MINUTES_DEFAULT,
  PAY_QR_MINUTES_MAX,
  PAY_QR_MINUTES_MIN,
  PAY_QR_NO_LIMIT,
  payQrModeOf,
  type PayQrMode,
} from "@pos/shared/print-qr";
import type { SettingsInput } from "@/schemas";
import { SETTINGS_CELL_RIGHT_CLASS, SETTINGS_NUMBER_CLASS, SETTINGS_UNIT_BOX_CLASS } from "@/lib/settings-card-layout";
import { CardField, SettingsSelect, SettingsSwitchRow } from "@/components/settings/SettingsCard";

interface PayQrFieldsProps {
  control: Control<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

const MODE_LABEL: Record<PayQrMode, string> = {
  always: "Always",
  owed: "Only when money is owed",
  never: "Never",
};
const MODE_ORDER: readonly PayQrMode[] = ["always", "owed", "never"];
const MODE_OPTIONS = MODE_ORDER.map((mode) => ({ value: mode, label: MODE_LABEL[mode] }));

// A blank box (or a typed 0) is not a number the owner meant: 0 means No limit and only the switch sets it. NaN
// reaches the schema, which answers with its own plain "Enter the minutes as a whole number".
function minutesFromInput(raw: string): number {
  if (raw.trim() === "") return Number.NaN;
  const n = Number(raw);
  return n === PAY_QR_NO_LIMIT ? Number.NaN : n;
}

// The pay QR's two owner choices (S3b, 01-PLAN Amendment A4): when a bill prints one, and how long it stays valid
// from the bill's first print. Rendered under the UPI ID, which the QR needs, inside the "Pay QR on bills" block.
export function PayQrFields({ control, errors }: PayQrFieldsProps) {
  return (
    <>
      <CardField
        label="When to print the pay QR"
        htmlFor="settings-pay-qr-mode"
        error={errors.payQrMode?.message}
        hint="Always: every bill gets one, and a fully paid bill asks for the full total. A cancelled bill never gets one."
      >
        <Controller
          control={control}
          name="payQrMode"
          render={({ field }) => (
            <SettingsSelect
              id="settings-pay-qr-mode"
              value={payQrModeOf(field.value)}
              onValueChange={field.onChange}
              options={MODE_OPTIONS}
            />
          )}
        />
      </CardField>
      <Controller
        control={control}
        name="payQrValidMinutes"
        render={({ field }) => {
          // A missing value reads as the default, the same way the printed slip reads it.
          const value = typeof field.value === "number" ? field.value : PAY_QR_MINUTES_DEFAULT;
          const noLimit = value === PAY_QR_NO_LIMIT;
          return (
            <>
              <CardField
                label="Minutes valid"
                htmlFor={noLimit ? undefined : "settings-pay-qr-minutes"}
                error={errors.payQrValidMinutes?.message}
                hint="Counted from the bill's first print. The bill shows “Valid till” that time, and a reprint after it leaves the QR off."
              >
                {noLimit ? (
                  <p className="text-[14px] text-muted-foreground">No time limit.</p>
                ) : (
                  <div className={SETTINGS_UNIT_BOX_CLASS}>
                    <input
                      id="settings-pay-qr-minutes"
                      className={SETTINGS_NUMBER_CLASS}
                      type="number"
                      inputMode="numeric"
                      min={PAY_QR_MINUTES_MIN}
                      max={PAY_QR_MINUTES_MAX}
                      step={1}
                      value={Number.isNaN(value) ? "" : value}
                      onChange={(e) => field.onChange(minutesFromInput(e.target.value))}
                      aria-invalid={errors.payQrValidMinutes ? true : undefined}
                    />
                    <span className={SETTINGS_CELL_RIGHT_CLASS}>minutes</span>
                  </div>
                )}
              </CardField>
              <SettingsSwitchRow
                label="No limit"
                sub="The QR prints on every reprint, with no Valid till line."
                checked={noLimit}
                onCheckedChange={(on) => field.onChange(on ? PAY_QR_NO_LIMIT : PAY_QR_MINUTES_DEFAULT)}
              />
            </>
          );
        }}
      />
    </>
  );
}
