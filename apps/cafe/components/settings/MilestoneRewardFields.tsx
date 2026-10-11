"use client";

import { useId } from "react";
import { Controller, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  LOYALTY_REWARD_PERCENT_MAX,
  LOYALTY_MIN_BILL_MIN,
  LOYALTY_MIN_BILL_MAX,
} from "@pos/shared/public-diner";
import { LOYALTY_REWARD_QTY_MIN, LOYALTY_REWARD_QTY_MAX } from "@pos/shared/public-diner";
import { Input } from "@/components/ui/input";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { Field } from "@/components/settings/SettingsFields";
import { ProductPicker } from "@/components/settings/ProductPicker";
import { RewardKindSelect, isRewardKind } from "@/components/settings/RewardKindSelect";
import { MilestoneRewardCodeFields } from "@/components/settings/MilestoneRewardCodeFields";

// Same two-place error lesson as PromoCodesFields.tsx: RHF reports a
// milestone row's problems per-ROW (`loyaltyRules.milestones.${i}.<field>`)
// AND, for the duplicate-`at` refinement, at the ARRAY root. Both must render
// or a failed Save can look like nothing happened.
interface RowFieldError {
  message?: unknown;
}
interface MilestoneRowErrors {
  at?: RowFieldError;
  kind?: RowFieldError;
  value?: RowFieldError;
  item?: RowFieldError;
  // CB-5B D8/D11 — the picker's own error path. The item branch's required
  // error lands HERE, not on `item`, so a row that fails to save shows its
  // message on the control the owner actually has to fix.
  itemProductId?: RowFieldError;
  qty?: RowFieldError;
  minBill?: RowFieldError;
  // CB-5D — the two new TTL/code controls' own error paths.
  promoCode?: RowFieldError;
  claimWithinDays?: RowFieldError;
}

function messageOf(field: RowFieldError | undefined): string | undefined {
  const message = field?.message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

// Exported so MilestoneRewardCodeFields.tsx (the CB-5D promo/TTL split-out)
// reads errors from the exact same per-row shape — one lookup, two callers.
// Returns the BARE message: each field sits right under its own label inside a
// panel titled with the stamp number, so a "Reward N:" prefix (N was the array
// index, not the stamp) only added noise.
export function rowFieldMessage(
  milestonesErrors: unknown,
  index: number,
  field: "at" | "kind" | "value" | "item" | "itemProductId" | "qty" | "minBill" | "promoCode" | "claimWithinDays",
): string | undefined {
  if (!milestonesErrors || typeof milestonesErrors !== "object") return undefined;
  const rows = milestonesErrors as Record<number, MilestoneRowErrors | undefined>;
  const message = messageOf(rows[index]?.[field]);
  return message;
}

// Only what the picker needs off a Product — keeps this component from
// depending on the full DTO.
interface PickableProduct {
  _id: string;
  name: string;
}

interface MilestoneRewardFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  index: number;
  setValue: UseFormSetValue<SettingsInput>;
  // CB-5B D8 — passed DOWN rather than fetched per row when the caller is a
  // list: the list is one master-data copy, and a hook per row would
  // subscribe every sibling to the same query (the row deliberately watches
  // only its own field path). Optional because LoyaltyStampGrid's Sheet
  // renders exactly one row standalone with no list above it to fetch this —
  // ProductPicker falls back to calling useProducts() itself. That fallback costs
  // no extra request: useProducts() is served from MasterDataProvider's
  // bootstrap cache, so a second caller just re-reads the same cached query.
  products?: readonly PickableProduct[];
}

// The reward-editing controls for one milestone row (everything except
// "Stamps needed" and the remove button, which stay with each caller). Shared
// by LoyaltyStampGrid's per-box Sheet. Kept as its own component so a second
// caller (a per-level card, next) reuses the controls instead of copying them.
//
// Watches its own kind (not the parent) so mounting/unmounting this component
// never re-renders every sibling's Controller subscriptions.
export function MilestoneRewardFields({ control, register, errors, index, setValue, products }: MilestoneRewardFieldsProps) {
  const kindId = useId();
  const itemId = useId();
  const valueId = useId();
  const qtyId = useId();
  const minBillId = useId();

  const row = useWatch({ control, name: `loyaltyRules.milestones.${index}` });
  const kind = row?.kind ?? "flat";

  return (
    <>
      <Controller
        control={control}
        name={`loyaltyRules.milestones.${index}.kind`}
        render={({ field }) => {
          const kindError = rowFieldMessage(errors.loyaltyRules?.milestones, index, "kind");
          return (
            <Field label="Reward" htmlFor={kindId} error={kindError}>
              <RewardKindSelect
                id={kindId}
                value={isRewardKind(field.value) ? field.value : "flat"}
                onChange={(next) => {
                  field.onChange(next);
                  // Switching AWAY from a free item must drop the dish with
                  // it. RHF keeps hidden fields (shouldUnregister defaults
                  // false), so without this the rung would carry a dead
                  // product reference, and switching back would re-use it
                  // without the owner ever re-picking — the reference and the
                  // shown name silently diverging. The shared schema rejects
                  // that combination, so this also keeps Save working.
                  if (next !== "item") {
                    setValue(`loyaltyRules.milestones.${index}.itemProductId`, undefined, {
                      shouldDirty: true,
                    });
                    setValue(`loyaltyRules.milestones.${index}.qty`, undefined, { shouldDirty: true });
                    setValue(`loyaltyRules.milestones.${index}.item`, "", { shouldDirty: true });
                  }
                }}
              />
            </Field>
          );
        }}
      />

      {kind === "item" ? (
        <Field
          label="Free item"
          htmlFor={itemId}
          error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "itemProductId")}
          hint="Pick it from your menu. The kitchen ticket and the bill both use this item."
        >
          {/* CB-5B D8 — a PICKER, not free text. The bill and the kitchen
              ticket are built from the product this points at, and a typed
              name cannot survive the dish being renamed or deleted. The
              name is still stored alongside, but only for display. */}
          <Controller
            control={control}
            name={`loyaltyRules.milestones.${index}.itemProductId`}
            render={({ field }) => (
              <ProductPicker
                id={itemId}
                value={field.value ?? ""}
                currentName={row?.item}
                onChange={(next, name) => {
                  field.onChange(next);
                  // Keep the display name in step with the reference. Both
                  // travel together or the ladder would read one dish while
                  // the bill printed another.
                  setValue(`loyaltyRules.milestones.${index}.item`, name, {
                    shouldDirty: true,
                  });
                }}
                products={products}
              />
            )}
          />
        </Field>
      ) : (
        <Field
          label={kind === "percent" ? "Value (%)" : "Value (₹)"}
          htmlFor={valueId}
          error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "value")}
        >
          <Input
            id={valueId}
            type="number"
            inputMode="numeric"
            className={BRAND_CONTROL_CLASS}
            min={0}
            max={kind === "percent" ? LOYALTY_REWARD_PERCENT_MAX : undefined}
            {...register(`loyaltyRules.milestones.${index}.value`, { valueAsNumber: true })}
          />
        </Field>
      )}

      {kind === "item" && (
        <Field
          label="How many"
          htmlFor={qtyId}
          error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "qty")}
          hint="Leave blank for one"
        >
          {/* CB-5B D11 — blank means ONE, never zero. The claim stores this
              count, so changing it later cannot shrink a reward a diner has
              already claimed. */}
          <Controller
            control={control}
            name={`loyaltyRules.milestones.${index}.qty`}
            render={({ field }) => (
              <Input
                id={qtyId}
                type="number"
                inputMode="numeric"
                className={BRAND_CONTROL_CLASS}
                min={LOYALTY_REWARD_QTY_MIN}
                max={LOYALTY_REWARD_QTY_MAX}
                value={field.value ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  field.onChange(next === "" ? undefined : Number(next));
                }}
              />
            )}
          />
        </Field>
      )}

      {/* CB-5D — the promo-code + claim-window controls: split into their own
          component to keep this file under its line cap (see that file's
          header comment). Same row, same per-row error plumbing. */}
      <MilestoneRewardCodeFields control={control} errors={errors} index={index} />

      <Field
        label="Minimum bill (₹)"
        htmlFor={minBillId}
        error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "minBill")}
        hint="Leave blank for no minimum"
      >
        <Controller
          control={control}
          name={`loyaltyRules.milestones.${index}.minBill`}
          render={({ field }) => (
            <Input
              id={minBillId}
              type="number"
              inputMode="numeric"
              className={BRAND_CONTROL_CLASS}
              min={LOYALTY_MIN_BILL_MIN}
              max={LOYALTY_MIN_BILL_MAX}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            />
          )}
        />
      </Field>
    </>
  );
}
