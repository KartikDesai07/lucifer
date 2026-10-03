"use client";

import { useId } from "react";
import { Controller, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import type { PromoKind } from "@pos/shared/public";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, ToggleRow } from "@/components/settings/SettingsFields";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";

const PROMO_CODE_INPUT_MAX_LEN = 16;
const PERCENT_MAX = 100;

// This editor cannot set the free dish a kind "item" code needs (it has no
// itemProductId field), so "item" is not offered: a new row could only be an
// unsaveable one. A STORED item code is shown read-only instead (see below):
// switching it to percent/amount would keep its itemProductId and fail the
// schema with no message, and its own option would vanish.
const EDITABLE_PROMO_KINDS = ["percent", "flat"] as const;

// EXHAUSTIVE over PromoKind. The old promoKindLabel labelled everything that
// was not "percent" as "Flat ₹ off", so "item" showed up as a second, identical
// option — and picking it made a row that could not save.
const PROMO_KIND_LABELS: Record<PromoKind, string> = {
  percent: "Percent off",
  flat: "Amount off",
  item: "Free item",
};

function isEditableKind(kind: PromoKind): boolean {
  const editable: readonly PromoKind[] = EDITABLE_PROMO_KINDS;
  return editable.includes(kind);
}

// react-hook-form reports an array field's problems in TWO places (the same
// lesson lib/variation-errors.ts already paid for): per-ROW, at
// `promoCodes.${i}.<field>.message`, and — for the duplicate-code and
// max-length refinements, which have no single row to anchor to — at the
// array's own root. A form that only renders one of the two can fail Save
// silently with nothing visible on screen. Both helpers below take
// `errors.promoCodes` typed as `unknown` rather than fighting RHF's generic
// error-tree type.
interface RowFieldError {
  message?: unknown;
}
interface PromoRowErrors {
  code?: RowFieldError;
  value?: RowFieldError;
  minSubtotal?: RowFieldError;
}

function messageOf(field: RowFieldError | undefined): string | undefined {
  const message = field?.message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function rowFieldMessage(
  promoCodesErrors: unknown,
  index: number,
  field: "code" | "value" | "minSubtotal",
): string | undefined {
  if (!promoCodesErrors || typeof promoCodesErrors !== "object") return undefined;
  const rows = promoCodesErrors as Record<number, PromoRowErrors | undefined>;
  const message = messageOf(rows[index]?.[field]);
  return message ? `Code ${index + 1}: ${message}` : undefined;
}

export function arrayLevelMessage(promoCodesErrors: unknown): string | undefined {
  if (!promoCodesErrors || typeof promoCodesErrors !== "object") return undefined;
  const err = promoCodesErrors as { root?: RowFieldError } & RowFieldError;
  return messageOf(err.root) ?? messageOf(err);
}

interface PromoCodeRowProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  index: number;
  onRemove: (code: string) => void;
}

// One row's own kind/code are watched here (not in the parent) so adding or
// removing a row never re-renders every other row's Controller subscriptions.
export function PromoCodeRow({ control, register, errors, index, onRemove }: PromoCodeRowProps) {
  const row = useWatch({ control, name: `promoCodes.${index}` });
  const kind = row?.kind ?? "percent";
  const code = row?.code ?? "";
  const blank = code.trim() === "";
  const kindEditable = isEditableKind(kind);
  const idBase = useId();
  const codeId = `${idBase}-code`;
  const valueId = `${idBase}-value`;
  const minId = `${idBase}-min`;

  return (
    <div className="space-y-4 rounded-md border border-brand-rule bg-brand-paper p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 truncate text-sm font-semibold text-brand-ink">
          {blank ? "New promo code" : code}
        </h4>
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0 px-3 text-brand-danger md:h-10"
          onClick={() => onRemove(code)}
          aria-label={blank ? "Remove this promo code" : `Remove promo code ${code}`}
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Remove
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          htmlFor={codeId}
          hint="3 to 16 letters or numbers"
          error={rowFieldMessage(errors.promoCodes, index, "code")}
        >
          <Controller
            control={control}
            name={`promoCodes.${index}.code`}
            render={({ field }) => (
              <Input
                id={codeId}
                className={BRAND_CONTROL_CLASS}
                value={field.value}
                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                maxLength={PROMO_CODE_INPUT_MAX_LEN}
                placeholder="SAVE10"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          />
        </Field>

        {kindEditable ? (
          <Controller
            control={control}
            name={`promoCodes.${index}.kind`}
            render={({ field }) => (
              <PrintSizeChoice<PromoKind>
                legend="Discount type"
                options={EDITABLE_PROMO_KINDS}
                value={field.value ?? "percent"}
                onChange={field.onChange}
                labelOf={(option) => PROMO_KIND_LABELS[option]}
              />
            )}
          />
        ) : (
          <Field label="Discount type" hint="Set up outside this page, so it can't be changed here.">
            <p className="flex h-10 items-center text-sm text-brand-ink">{PROMO_KIND_LABELS[kind]}</p>
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {kindEditable && (
          <Field
            label={kind === "percent" ? "Discount (%)" : "Discount (₹)"}
            htmlFor={valueId}
            hint={kind === "percent" ? "1 to 100" : undefined}
            error={rowFieldMessage(errors.promoCodes, index, "value")}
          >
            <Input
              id={valueId}
              className={BRAND_CONTROL_CLASS}
              type="number"
              inputMode="numeric"
              min={0}
              max={kind === "percent" ? PERCENT_MAX : undefined}
              {...register(`promoCodes.${index}.value`, { valueAsNumber: true })}
            />
          </Field>
        )}

        <Field
          label="Minimum order (₹)"
          htmlFor={minId}
          hint="Leave blank for no minimum"
          error={rowFieldMessage(errors.promoCodes, index, "minSubtotal")}
        >
          <Controller
            control={control}
            name={`promoCodes.${index}.minSubtotal`}
            render={({ field }) => (
              <Input
                id={minId}
                className={BRAND_CONTROL_CLASS}
                type="number"
                inputMode="numeric"
                min={0}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
              />
            )}
          />
        </Field>
      </div>

      <Controller
        control={control}
        name={`promoCodes.${index}.active`}
        render={({ field }) => (
          <ToggleRow
            label="Code is on"
            description="Diners can use it now. Turn it off to pause it without deleting it."
            checked={field.value ?? false}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name={`promoCodes.${index}.oncePerCustomer`}
        render={({ field }) => (
          <ToggleRow
            label="One use per customer"
            description="Each mobile number can use it on one order only."
            checked={field.value ?? false}
            onChange={field.onChange}
          />
        )}
      />
    </div>
  );
}
