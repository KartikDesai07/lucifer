"use client";

import { useId } from "react";
import { Controller, useFieldArray, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { UPI_RULES_MAX, UPI_RULE_UPTO_MAX, isValidUpiId } from "@pos/shared/print-qr";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_ADD_BUTTON_CLASS,
  SETTINGS_ERROR_CLASS,
  SETTINGS_HINT_CLASS,
  SETTINGS_INPUT_CLASS,
  SETTINGS_NUMBER_CLASS,
  SETTINGS_REMOVE_BUTTON_CLASS,
  SETTINGS_UNIT_BOX_CLASS,
} from "@/lib/settings-card-layout";
import { CardField, SettingsBlock } from "@/components/settings/SettingsCard";
import { arrayLevelMessage } from "@/components/settings/PromoCodeRow";

interface UpiRulesFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// A fresh slab has no amount yet: NaN is the schema's own "Enter the amount as a whole number", shown as a blank box.
const BLANK_AMOUNT = Number.NaN;
const SLAB_ROW_CLASS = "grid gap-3 rounded-[10px] border border-border-2 bg-surface-2 p-3";
// Stacked on a phone; from sm one line: the amount box, the UPI ID, Remove.
const SLAB_FIELDS_CLASS = "grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end";
const RULES_SUB =
  "For example, bills up to ₹500 pay to one ID and bills up to ₹2000 to another. Bills above your highest " +
  "amount use the main UPI ID.";

// A blank box is not a number the owner meant; anything typed goes to the schema, which wants whole rupees.
function amountFromInput(raw: string): number {
  return raw.trim() === "" ? BLANK_AMOUNT : Number(raw);
}

function messageOf(value: unknown): string | undefined {
  const message = (value as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

interface SlabRowProps extends UpiRulesFieldsProps {
  index: number;
  onRemove: () => void;
}

// One slab: "Bills up to ₹ [amount]  UPI ID [id]". Stacks on a phone, one line from sm up.
function SlabRow({ control, register, errors, index, onRemove }: SlabRowProps) {
  const idBase = useId();
  const amountId = `${idBase}-amount`;
  const upiIdId = `${idBase}-upi`;
  const rowErrors = errors.upiRules?.[index];
  const amountError = messageOf(rowErrors?.upTo);
  const upiIdError = messageOf(rowErrors?.upiId);

  return (
    <div className={SLAB_ROW_CLASS}>
      <div className={SLAB_FIELDS_CLASS}>
        <CardField label="Bills up to ₹" htmlFor={amountId}>
          <Controller
            control={control}
            name={`upiRules.${index}.upTo`}
            render={({ field }) => (
              <div className={SETTINGS_UNIT_BOX_CLASS}>
                <input
                  id={amountId}
                  className={SETTINGS_NUMBER_CLASS}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={UPI_RULE_UPTO_MAX}
                  step={1}
                  value={typeof field.value === "number" && !Number.isNaN(field.value) ? field.value : ""}
                  onChange={(e) => field.onChange(amountFromInput(e.target.value))}
                  onBlur={field.onBlur}
                  aria-invalid={amountError !== undefined}
                />
              </div>
            )}
          />
        </CardField>
        <CardField label="UPI ID" htmlFor={upiIdId}>
          <Input
            id={upiIdId}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="slab@okaxis"
            className={SETTINGS_INPUT_CLASS}
            aria-invalid={upiIdError !== undefined}
            {...register(`upiRules.${index}.upiId`)}
          />
        </CardField>
        <button
          type="button"
          className={cn(SETTINGS_REMOVE_BUTTON_CLASS, "justify-self-start")}
          onClick={onRemove}
          aria-label={`Remove amount slab ${index + 1}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Remove
        </button>
      </div>
      {(amountError ?? upiIdError) && (
        <p className={SETTINGS_ERROR_CLASS} role="alert">
          {amountError ?? upiIdError}
        </p>
      )}
    </div>
  );
}

// "Different UPI ID by bill amount": up to UPI_RULES_MAX slabs under the main UPI ID. The print side picks the slab by
// the amount the QR asks for (print-qr.ts upiIdForAmount); above the highest slab the main ID is used.
export function UpiRulesFields({ control, register, errors }: UpiRulesFieldsProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "upiRules" });
  const mainUpiId = useWatch({ control, name: "upiId" });
  const hasMain = isValidUpiId((mainUpiId ?? "").trim());
  const atMax = fields.length >= UPI_RULES_MAX;
  const arrayError = arrayLevelMessage(errors.upiRules);

  return (
    <SettingsBlock title="Different UPI ID by bill amount (optional)" sub={RULES_SUB}>
      {arrayError && (
        <p className={SETTINGS_ERROR_CLASS} role="alert">
          {arrayError}
        </p>
      )}
      {fields.map((field, index) => (
        <SlabRow
          key={field.id}
          control={control}
          register={register}
          errors={errors}
          index={index}
          onRemove={() => remove(index)}
        />
      ))}
      <div className="grid gap-1.5">
        <button
          type="button"
          className={SETTINGS_ADD_BUTTON_CLASS}
          onClick={() => append({ upTo: BLANK_AMOUNT, upiId: "" })}
          disabled={atMax || !hasMain}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add an amount slab
        </button>
        {atMax && <p className={SETTINGS_HINT_CLASS}>You can have up to {UPI_RULES_MAX} slabs.</p>}
        {!atMax && !hasMain && <p className={SETTINGS_HINT_CLASS}>Add the main UPI ID above first.</p>}
      </div>
    </SettingsBlock>
  );
}
