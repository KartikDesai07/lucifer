"use client";

import { Controller, useFieldArray, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { PROMO_CODE_MAX, PROMO_KINDS } from "@pos/shared/public";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/settings/SettingsFields";

interface PromoCodesFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

function promoKindLabel(kind: (typeof PROMO_KINDS)[number]): string {
  return kind === "percent" ? "Percent off" : "Flat ₹ off";
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

function arrayLevelMessage(promoCodesErrors: unknown): string | undefined {
  if (!promoCodesErrors || typeof promoCodesErrors !== "object") return undefined;
  const err = promoCodesErrors as { root?: RowFieldError } & RowFieldError;
  return messageOf(err.root) ?? messageOf(err);
}

interface PromoCodeRowProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  index: number;
  onRemove: () => void;
}

// One row's own kind/code are watched here (not in the parent) so adding or
// removing a row never re-renders every other row's Controller subscriptions.
function PromoCodeRow({ control, register, errors, index, onRemove }: PromoCodeRowProps) {
  const row = useWatch({ control, name: `promoCodes.${index}` });
  const kind = row?.kind ?? "percent";
  const code = row?.code ?? "";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" error={rowFieldMessage(errors.promoCodes, index, "code")}>
          <Controller
            control={control}
            name={`promoCodes.${index}.code`}
            render={({ field }) => (
              <Input
                value={field.value}
                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                maxLength={16}
                placeholder="SAVE10"
              />
            )}
          />
        </Field>

        <Field label="Type">
          <Controller
            control={control}
            name={`promoCodes.${index}.kind`}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMO_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {promoKindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={kind === "percent" ? "Value (%)" : "Value (₹)"}
          hint={kind === "percent" ? "1–100" : undefined}
          error={rowFieldMessage(errors.promoCodes, index, "value")}
        >
          <Input
            type="number"
            min={0}
            max={kind === "percent" ? 100 : undefined}
            {...register(`promoCodes.${index}.value`, { valueAsNumber: true })}
          />
        </Field>

        <Field
          label="Minimum order (₹)"
          hint="Leave blank for no minimum"
          error={rowFieldMessage(errors.promoCodes, index, "minSubtotal")}
        >
          <Controller
            control={control}
            name={`promoCodes.${index}.minSubtotal`}
            render={({ field }) => (
              <Input
                type="number"
                min={0}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
              />
            )}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name={`promoCodes.${index}.active`}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />
              )}
            />
            <span className="text-sm text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name={`promoCodes.${index}.oncePerCustomer`}
              render={({ field }) => (
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                  aria-label="One use per customer"
                />
              )}
            />
            <span className="text-sm text-muted-foreground">One use per customer</span>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${code}`}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

// Promo codes — CR2.2c §17.E. Embedded on Settings, staff-configured, until a
// diner types one into the QR ordering screen (a later slice). Rows are a
// useFieldArray over `promoCodes` per the phase spec — unlike
// VariationInput/ModifierInput (a single Controller over a plain array), each
// row here is individually registered so per-row errors can render inline
// without a collapsing helper.
export function PromoCodesFields({ control, register, errors }: PromoCodesFieldsProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "promoCodes" });
  const atMax = fields.length >= PROMO_CODE_MAX;
  const arrayError = arrayLevelMessage(errors.promoCodes);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Promo codes</CardTitle>
        <CardDescription>
          Codes a customer can type on the QR ordering screen. Leave the list empty to switch promos off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {arrayError && <p className="text-xs text-destructive">{arrayError}</p>}

        {fields.length === 0 && <p className="text-xs text-muted-foreground">No promo codes yet.</p>}

        {fields.map((field, index) => (
          <PromoCodeRow
            key={field.id}
            control={control}
            register={register}
            errors={errors}
            index={index}
            onRemove={() => remove(index)}
          />
        ))}

        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ code: "", kind: "percent", value: 10, active: true })}
            disabled={atMax}
          >
            <Plus className="mr-2 h-4 w-4" /> Add promo code
          </Button>
          {atMax && <p className="text-xs text-muted-foreground">Maximum {PROMO_CODE_MAX} codes</p>}
        </div>
      </CardContent>
    </Card>
  );
}
