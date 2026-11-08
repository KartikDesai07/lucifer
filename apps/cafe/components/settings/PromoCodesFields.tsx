"use client";

import { useState } from "react";
import { useFieldArray } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Plus } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { PROMO_CODE_MAX } from "@pos/shared/public";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  SETTINGS_ADD_BUTTON_CLASS,
  SETTINGS_ERROR_CLASS,
  SETTINGS_HINT_CLASS,
  SETTINGS_LIST_EMPTY_CLASS,
} from "@/lib/settings-card-layout";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { PromoCodeRow, arrayLevelMessage } from "@/components/settings/PromoCodeRow";

interface PromoCodesFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Promo codes — CR2.2c §17.E. Embedded on Settings, staff-configured; a diner
// types one into the QR ordering screen. Rows are a useFieldArray over
// `promoCodes` per the phase spec — unlike VariationInput/ModifierInput (a
// single Controller over a plain array), each row here is individually
// registered so per-row errors can render inline without a collapsing helper.
// Settings pass slice 7 (s69): a row with a code typed asks before it goes; a
// blank row has nothing to lose and goes at once.
export function PromoCodesFields({ control, register, errors }: PromoCodesFieldsProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "promoCodes" });
  // The dialog's open flag and its target are separate on purpose: the target
  // stays set through the close animation, so the title never flickers.
  const [target, setTarget] = useState<{ index: number; label: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const atMax = fields.length >= PROMO_CODE_MAX;
  const arrayError = arrayLevelMessage(errors.promoCodes);

  const requestRemove = (index: number, code: string) => {
    if (code.trim() === "") {
      remove(index);
      return;
    }
    setTarget({ index, label: code });
    setConfirmOpen(true);
  };

  return (
    <>
      <SettingsCard title="Promo codes" sub="Codes a diner can type when ordering from the QR code.">
        {arrayError && (
          <p className={SETTINGS_ERROR_CLASS} role="alert">
            {arrayError}
          </p>
        )}

        {fields.length === 0 && (
          <p className={SETTINGS_LIST_EMPTY_CLASS}>No promo codes yet. Add one and diners can type it when they order.</p>
        )}

        {fields.map((field, index) => (
          <PromoCodeRow
            key={field.id}
            control={control}
            register={register}
            errors={errors}
            index={index}
            onRemove={(code) => requestRemove(index, code)}
          />
        ))}

        <div className="grid gap-1.5">
          <button
            type="button"
            className={SETTINGS_ADD_BUTTON_CLASS}
            onClick={() => append({ code: "", kind: "percent", value: 10, active: true })}
            disabled={atMax}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a promo code
          </button>
          {atMax && <p className={SETTINGS_HINT_CLASS}>You can have up to {PROMO_CODE_MAX} codes.</p>}
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${target?.label ?? "this code"}?`}
        description="This removes it from the list. Nothing changes for diners until you save."
        confirmLabel="Remove"
        onConfirm={() => {
          if (target) remove(target.index);
          setConfirmOpen(false);
        }}
      />
    </>
  );
}
