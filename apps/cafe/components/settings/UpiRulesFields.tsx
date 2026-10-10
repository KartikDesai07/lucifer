"use client";

import { useId } from "react";
import { Controller, useFieldArray, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { UPI_RULES_MAX, UPI_RULE_UPTO_MAX, isValidUpiId } from "@pos/shared/print-qr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BRAND_CONTROL_CLASS, BRAND_FIELD_ERROR_CLASS, BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS } from "@/components/settings/SettingsFields";
import { arrayLevelMessage } from "@/components/settings/PromoCodeRow";

interface UpiRulesFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// A fresh slab has no amount yet: NaN is the schema's own "Enter the amount as a whole number", shown as a blank box.
const BLANK_AMOUNT = Number.NaN;
// 44 px on a phone, 40 px from md up (the Promo codes row idiom).
const TOUCH_CLASS = "h-11 md:h-10";

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
    <div className="space-y-1.5 rounded-md border border-brand-rule bg-brand-paper p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor={amountId} className={BRAND_LABEL_CLASS}>
            Bills up to ₹
          </label>
          <Controller
            control={control}
            name={`upiRules.${index}.upTo`}
            render={({ field }) => (
              <Input
                id={amountId}
                className={cn(BRAND_CONTROL_CLASS, TOUCH_CLASS, "w-full sm:w-32")}
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
            )}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor={upiIdId} className={BRAND_LABEL_CLASS}>
            UPI ID
          </label>
          <Input
            id={upiIdId}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="slab@okaxis"
            className={cn(BRAND_CONTROL_CLASS, TOUCH_CLASS)}
            aria-invalid={upiIdError !== undefined}
            {...register(`upiRules.${index}.upiId`)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0 px-3 text-brand-danger md:h-10"
          onClick={onRemove}
          aria-label={`Remove amount slab ${index + 1}`}
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Remove
        </Button>
      </div>
      {(amountError ?? upiIdError) && (
        <p className={BRAND_FIELD_ERROR_CLASS} role="alert">
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
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-[13px] font-medium text-brand-ink">Different UPI ID by bill amount (optional)</h4>
        <p className={HINT_CLASS}>
          For example, bills up to ₹500 pay to one ID and bills up to ₹2000 to another. Bills above your highest
          amount use the main UPI ID.
        </p>
      </div>
      {arrayError && (
        <p className={BRAND_FIELD_ERROR_CLASS} role="alert">
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
      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          className="h-11 md:h-10"
          onClick={() => append({ upTo: BLANK_AMOUNT, upiId: "" })}
          disabled={atMax || !hasMain}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add an amount slab
        </Button>
        {atMax && <p className={HINT_CLASS}>You can have up to {UPI_RULES_MAX} slabs.</p>}
        {!atMax && !hasMain && <p className={HINT_CLASS}>Add the main UPI ID above first.</p>}
      </div>
    </div>
  );
}
