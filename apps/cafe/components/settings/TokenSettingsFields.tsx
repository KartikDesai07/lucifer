"use client";

import { AppLink } from "@/components/layout/AppLink";
import { Controller, useFormState } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";

import {
  numberResetLabel,
  numberResetMinutesOf,
  numberResetOptions,
  tokenReadyClearLabel,
  tokenReadyClearMinutesOf,
  tokenReadyClearOptions,
} from "@pos/shared/slip-day";
import type { SettingsInput } from "@/schemas";
import { PRINT_NUMBER_START_MIN, PRINT_NUMBER_START_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CardField, SettingsCard, SettingsSelect, SettingsSwitchRow } from "@/components/settings/SettingsCard";
import { NowServingLink } from "@/components/now-serving/NowServingLink";
import {
  SETTINGS_ALERT_CLASS,
  SETTINGS_HINT_CLASS,
  SETTINGS_INPUT_CLASS,
  SETTINGS_LINK_CLASS,
} from "@/lib/settings-card-layout";
import { blankToMinStart, makeNumberStartBlurHandler } from "@/components/settings/print-form-utils";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { KITCHEN_TOKEN_HINT } from "@/lib/kitchen-lines";
import { NUMBER_RESET_HINT, TOKENS_NO_BILL_PRINTER_WARNING, TOKENS_RELOAD_HINT, tokensHaveNoBillPrinter } from "@/lib/token-settings-notes";

const TOKEN_NUMBER_START_ID = "settings-token-number-start";
const RESET_TIME_ID = "settings-number-reset-minutes";
const READY_CLEAR_ID = "settings-token-ready-clear-minutes";
// The three controls share one width: wide enough for "12:00 am (midnight)", never the whole card on a computer.
const CONTROL_WIDTH_CLASS = "max-w-60";

interface TokenSettingsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// The Tokens & numbering page (print customization S6): three cards in the page's stack. Nothing here switches or
// resets another setting by itself: "Token numbers start at" stays visible whether tokens are on or off, and the
// restart time is its own choice.
export function TokenSettingsFields({ control, register, setValue, errors }: TokenSettingsFieldsProps) {
  const tokenNumberStartRegistration = register("tokenNumberStart", { setValueAs: blankToMinStart });
  const handleTokenNumberStartBlur = makeNumberStartBlurHandler(setValue, "tokenNumberStart");
  // The pickers' option lists come from the SAVED values (the form's defaults), never the live field value: a stored
  // off-step time (say 25 minutes) must stay pickable after the owner tries another (auto-memory
  // options-from-live-value-strand-stored-value).
  const { defaultValues: saved } = useFormState({ control });
  // The token fix (T3): tokens print at the bill printer; the same cached printers read as the agent's (at most one
  // GET /api/printers when a tab opens this page without the cached list; never a recurring request).
  const noBillPrinter = tokensHaveNoBillPrinter(usePrintersRead(true).printers);

  return (
    <>
      <SettingsCard title="Tokens" sub="A short number for each order, so the customer can be called when it is ready.">
        <Controller
          control={control}
          name="tokenEnabled"
          render={({ field }) => (
            <SettingsSwitchRow
              label="Give every order a token"
              sub="Every new order gets a token number. It prints on the bill and the kitchen ticket. It also prints on its own token slip with the first kitchen ticket."
              checked={field.value === true}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <p className={SETTINGS_HINT_CLASS}>{TOKENS_RELOAD_HINT}</p>
        <p className={SETTINGS_HINT_CLASS}>{KITCHEN_TOKEN_HINT}</p>
        {noBillPrinter && (
          <p role="alert" className={SETTINGS_ALERT_CLASS}>
            {TOKENS_NO_BILL_PRINTER_WARNING}{" "}
            <AppLink href="/printers" className={SETTINGS_LINK_CLASS}>
              Open Printer setup
            </AppLink>
          </p>
        )}
        <CardField
          label="Token numbers start at"
          htmlFor={TOKEN_NUMBER_START_ID}
          error={errors.tokenNumberStart?.message}
          hint="Applies from the next order onward."
        >
          <Input
            id={TOKEN_NUMBER_START_ID}
            className={cn(SETTINGS_INPUT_CLASS, CONTROL_WIDTH_CLASS)}
            type="number"
            inputMode="numeric"
            min={PRINT_NUMBER_START_MIN}
            max={PRINT_NUMBER_START_MAX}
            {...tokenNumberStartRegistration}
            onBlur={(e) => {
              void tokenNumberStartRegistration.onBlur(e);
              handleTokenNumberStartBlur(e);
            }}
          />
        </CardField>
        <NowServingLink variant="hint" />
      </SettingsCard>
      <SettingsCard
        title="Daily restart time"
        sub="Token, kitchen ticket and bill numbers all start again from their start number at this time."
      >
        <CardField
          label="Numbers start again at"
          htmlFor={RESET_TIME_ID}
          error={errors.numberResetMinutes?.message}
          hint={NUMBER_RESET_HINT}
        >
          <Controller
            control={control}
            name="numberResetMinutes"
            render={({ field }) => (
              <SettingsSelect
                id={RESET_TIME_ID}
                value={String(numberResetMinutesOf(field.value))}
                onValueChange={(v) => field.onChange(Number(v))}
                options={numberResetOptions(saved?.numberResetMinutes).map((minutes) => ({
                  value: String(minutes),
                  label: numberResetLabel(minutes),
                }))}
                className={CONTROL_WIDTH_CLASS}
              />
            )}
          />
        </CardField>
      </SettingsCard>
      <SettingsCard
        title="Ready tokens"
        sub="How long a ready token stays on the token list before it clears by itself."
      >
        <CardField
          label="Clear a ready token after"
          htmlFor={READY_CLEAR_ID}
          error={errors.tokenReadyClearMinutes?.message}
          hint="Marking it Collected clears it at once."
        >
          <Controller
            control={control}
            name="tokenReadyClearMinutes"
            render={({ field }) => (
              <SettingsSelect
                id={READY_CLEAR_ID}
                value={String(tokenReadyClearMinutesOf(field.value))}
                onValueChange={(v) => field.onChange(Number(v))}
                options={tokenReadyClearOptions(saved?.tokenReadyClearMinutes).map((minutes) => ({
                  value: String(minutes),
                  label: tokenReadyClearLabel(minutes),
                }))}
                className={CONTROL_WIDTH_CLASS}
              />
            )}
          />
        </CardField>
      </SettingsCard>
    </>
  );
}
