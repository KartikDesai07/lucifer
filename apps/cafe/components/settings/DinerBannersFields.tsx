"use client";

import { useFieldArray, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import {
  DINER_BANNER_MAX,
  DINER_BANNER_TITLE_MAX_LEN,
  DINER_BANNER_BODY_MAX_LEN,
} from "@pos/shared/public-diner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/settings/SettingsFields";

interface DinerBannersFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Same TWO-error-homes reasoning as PromoCodesFields.tsx: per-ROW messages
// (title's `.min(1)`/`.max()`) live at `dinerBanners.${i}.<field>.message`,
// while the array's own `.max(DINER_BANNER_MAX)` bound has no single row to
// anchor to and lives at the array root instead.
interface RowFieldError {
  message?: unknown;
}
interface BannerRowErrors {
  title?: RowFieldError;
  body?: RowFieldError;
}

function messageOf(field: RowFieldError | undefined): string | undefined {
  const message = field?.message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function rowFieldMessage(
  bannersErrors: unknown,
  index: number,
  field: "title" | "body",
): string | undefined {
  if (!bannersErrors || typeof bannersErrors !== "object") return undefined;
  const rows = bannersErrors as Record<number, BannerRowErrors | undefined>;
  const message = messageOf(rows[index]?.[field]);
  return message ? `Banner ${index + 1}: ${message}` : undefined;
}

function arrayLevelMessage(bannersErrors: unknown): string | undefined {
  if (!bannersErrors || typeof bannersErrors !== "object") return undefined;
  const err = bannersErrors as { root?: RowFieldError } & RowFieldError;
  return messageOf(err.root) ?? messageOf(err);
}

interface DinerBannerRowProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  index: number;
  onRemove: () => void;
}

// One row's own title is watched here (not in the parent) so adding or
// removing a row never re-renders every other row's Controller subscriptions
// — same isolation reasoning as PromoCodesFields.tsx's PromoCodeRow.
function DinerBannerRow({ control, register, errors, index, onRemove }: DinerBannerRowProps) {
  const row = useWatch({ control, name: `dinerBanners.${index}` });
  const title = row?.title ?? "";
  const titleLen = title.length;
  const bodyLen = (row?.body ?? "").length;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <Field
        label="Title"
        hint={`${titleLen}/${DINER_BANNER_TITLE_MAX_LEN}`}
        error={rowFieldMessage(errors.dinerBanners, index, "title")}
      >
        <Input {...register(`dinerBanners.${index}.title`)} maxLength={DINER_BANNER_TITLE_MAX_LEN} placeholder="Diwali special" />
      </Field>

      <Field
        label="Body"
        hint={`${bodyLen}/${DINER_BANNER_BODY_MAX_LEN}`}
        error={rowFieldMessage(errors.dinerBanners, index, "body")}
      >
        <Input
          {...register(`dinerBanners.${index}.body`)}
          maxLength={DINER_BANNER_BODY_MAX_LEN}
          placeholder="20% off on all desserts this week"
        />
      </Field>

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${title || "banner"}`}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

// Diner banners — CB-6C S1. Owner-written marketing lines shown on the diner
// Home tab (/m), embedded on Settings. Rows are a useFieldArray over
// `dinerBanners`, one row registered per field (same PromoCodesFields.tsx
// precedent) so per-row errors render inline without a collapsing helper.
export function DinerBannersFields({ control, register, errors }: DinerBannersFieldsProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "dinerBanners" });
  const atMax = fields.length >= DINER_BANNER_MAX;
  const arrayError = arrayLevelMessage(errors.dinerBanners);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Announcements on the QR menu</CardTitle>
        <CardDescription>
          Short marketing lines diners see at the top of the QR menu. Leave the list empty to show none.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {arrayError && <p className="text-xs text-destructive">{arrayError}</p>}

        {fields.length === 0 && <p className="text-xs text-muted-foreground">No banners yet.</p>}

        {fields.map((field, index) => (
          <DinerBannerRow
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
            onClick={() => append({ title: "", body: "" })}
            disabled={atMax}
          >
            <Plus className="mr-2 h-4 w-4" /> Add banner
          </Button>
          {atMax && <p className="text-xs text-muted-foreground">Maximum {DINER_BANNER_MAX} banners</p>}
        </div>
      </CardContent>
    </Card>
  );
}
