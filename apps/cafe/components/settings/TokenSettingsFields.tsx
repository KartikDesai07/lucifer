"use client";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { blankToMinStart, makeNumberStartBlurHandler } from "@/components/settings/print-form-utils";

const TOKEN_NUMBER_START_ID = "settings-token-number-start";
const RESET_TIME_ID = "settings-number-reset-minutes";
const READY_CLEAR_ID = "settings-token-ready-clear-minutes";

interface TokenSettingsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// The Tokens & numbering page (print customization S6). Nothing here switches or resets another setting by itself:
// "Token numbers start at" stays visible whether tokens are on or off, and the restart time is its own choice.
export function TokenSettingsFields({ control, register, setValue, errors }: TokenSettingsFieldsProps) {
  const tokenNumberStartRegistration = register("tokenNumberStart", { setValueAs: blankToMinStart });
  const handleTokenNumberStartBlur = makeNumberStartBlurHandler(setValue, "tokenNumberStart");
  // The pickers' option lists come from the SAVED values (the form's defaults), never the live field value: a stored
  // off-step time (say 25 minutes) must stay pickable after the owner tries another (auto-memory
  // options-from-live-value-strand-stored-value).
  const { defaultValues: saved } = useFormState({ control });

  return (
    <div className="space-y-6">
      <SettingsGroup title="Tokens" description="A short number for each order, so the customer can be called when it is ready.">
        <Controller
          control={control}
          name="tokenEnabled"
          render={({ field }) => (
            <ToggleRow
              label="Give every order a token"
              description="Every new order gets a token number. It prints on the bill and the kitchen ticket. It also prints on its own token slip with the first kitchen ticket."
              checked={field.value === true}
              onChange={field.onChange}
            />
          )}
        />
        <Field
          label="Token numbers start at"
          htmlFor={TOKEN_NUMBER_START_ID}
          error={errors.tokenNumberStart?.message}
          hint="Applies from the next order onward."
        >
          <Input
            id={TOKEN_NUMBER_START_ID}
            className={cn(BRAND_CONTROL_CLASS, "w-32")}
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
        </Field>
      </SettingsGroup>
      <SettingsGroup
        title="Daily restart time"
        description="Token, kitchen ticket and bill numbers all start again from their start number at this time."
      >
        <Field
          label="Numbers start again at"
          htmlFor={RESET_TIME_ID}
          error={errors.numberResetMinutes?.message}
          hint="A new time takes full effect from the next day. On the day you change it, a few numbers can repeat. Order IDs still change at midnight."
        >
          <Controller
            control={control}
            name="numberResetMinutes"
            render={({ field }) => (
              <Select
                value={String(numberResetMinutesOf(field.value))}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id={RESET_TIME_ID} className={BRAND_CONTROL_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {numberResetOptions(saved?.numberResetMinutes).map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {numberResetLabel(minutes)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </SettingsGroup>
      <SettingsGroup
        title="Ready tokens"
        description="How long a ready token stays on the token list before it clears by itself."
      >
        <Field
          label="Clear a ready token after"
          htmlFor={READY_CLEAR_ID}
          error={errors.tokenReadyClearMinutes?.message}
          hint="Marking it Collected clears it at once."
        >
          <Controller
            control={control}
            name="tokenReadyClearMinutes"
            render={({ field }) => (
              <Select
                value={String(tokenReadyClearMinutesOf(field.value))}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id={READY_CLEAR_ID} className={BRAND_CONTROL_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tokenReadyClearOptions(saved?.tokenReadyClearMinutes).map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {tokenReadyClearLabel(minutes)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </SettingsGroup>
    </div>
  );
}
