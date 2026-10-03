"use client";

import { useId, useState } from "react";
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
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BRAND_CONTROL_CLASS, BRAND_FIELD_ERROR_CLASS } from "@/components/brand/brand-classes";
import { Field, HINT_CLASS, SectionLink, SettingsGroup } from "@/components/settings/SettingsFields";

interface DinerBannersFieldsProps {
  // The SAVED "Diner accounts" switch: banners only show on the Home tab, and
  // the tab shell exists only while diner accounts are on.
  dinerAccountsOn: boolean;
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Same TWO-error-homes reasoning as PromoCodeRow.tsx: per-ROW messages
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
  return message ? `Announcement ${index + 1}: ${message}` : undefined;
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
  onRemove: (title: string, body: string) => void;
}

// One row's own title is watched here (not in the parent) so adding or
// removing a row never re-renders every other row's Controller subscriptions
// — same isolation reasoning as PromoCodeRow.tsx.
function DinerBannerRow({ control, register, errors, index, onRemove }: DinerBannerRowProps) {
  const row = useWatch({ control, name: `dinerBanners.${index}` });
  const title = row?.title ?? "";
  const titleLen = title.length;
  const body = row?.body ?? "";
  const bodyLen = body.length;
  const blank = title.trim() === "";
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const bodyId = `${idBase}-body`;

  return (
    <div className="space-y-4 rounded-md border border-brand-rule bg-brand-paper p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 truncate text-sm font-semibold text-brand-ink">
          {blank ? `Announcement ${index + 1}` : title}
        </h4>
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0 px-3 text-brand-danger md:h-10"
          onClick={() => onRemove(title, body)}
          aria-label={blank ? "Remove this announcement" : `Remove announcement ${title}`}
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Remove
        </Button>
      </div>

      <Field
        label="Title"
        htmlFor={titleId}
        hint={`${titleLen}/${DINER_BANNER_TITLE_MAX_LEN}`}
        error={rowFieldMessage(errors.dinerBanners, index, "title")}
      >
        <Input
          id={titleId}
          className={BRAND_CONTROL_CLASS}
          {...register(`dinerBanners.${index}.title`)}
          maxLength={DINER_BANNER_TITLE_MAX_LEN}
          placeholder="Diwali special"
        />
      </Field>

      <Field
        label="More details (optional)"
        htmlFor={bodyId}
        hint={`${bodyLen}/${DINER_BANNER_BODY_MAX_LEN}`}
        error={rowFieldMessage(errors.dinerBanners, index, "body")}
      >
        <Input
          id={bodyId}
          className={BRAND_CONTROL_CLASS}
          {...register(`dinerBanners.${index}.body`)}
          maxLength={DINER_BANNER_BODY_MAX_LEN}
          placeholder="20% off on all desserts this week"
        />
      </Field>
    </div>
  );
}

// Diner banners — CB-6C S1. Owner-written marketing lines shown on the diner
// Home tab (/m), embedded on Settings. Rows are a useFieldArray over
// `dinerBanners`, one row registered per field (same PromoCodesFields.tsx
// precedent) so per-row errors render inline without a collapsing helper.
// Settings pass slice 7 (s69): a row with a title typed asks before it goes;
// a blank row has nothing to lose and goes at once.
export function DinerBannersFields({ dinerAccountsOn, control, register, errors }: DinerBannersFieldsProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "dinerBanners" });
  // The dialog's open flag and its target are separate on purpose: the target
  // stays set through the close animation, so the title never flickers.
  const [target, setTarget] = useState<{ index: number; label: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const atMax = fields.length >= DINER_BANNER_MAX;
  const arrayError = arrayLevelMessage(errors.dinerBanners);

  // Only a row with neither a title nor details typed has nothing to lose.
  const requestRemove = (index: number, title: string, body: string) => {
    if (title.trim() === "" && body.trim() === "") {
      remove(index);
      return;
    }
    setTarget({ index, label: title.trim() });
    setConfirmOpen(true);
  };

  return (
    <>
      <SettingsGroup
        title="Announcements"
        description={`Short lines diners see on the Home tab of the QR menu, like a special offer. Up to ${DINER_BANNER_MAX}.`}
      >
        {!dinerAccountsOn && (
          <p className={HINT_CLASS}>
            Diners see these only while Diner accounts is on in{" "}
            <SectionLink slug="loyalty">Rewards &amp; loyalty</SectionLink>.
          </p>
        )}

        {arrayError && (
          <p className={BRAND_FIELD_ERROR_CLASS} role="alert">
            {arrayError}
          </p>
        )}

        {fields.length === 0 && (
          <p className="rounded-md border border-dashed border-brand-rule p-4 text-sm text-brand-muted">
            No announcements yet.
          </p>
        )}

        {fields.map((field, index) => (
          <DinerBannerRow
            key={field.id}
            control={control}
            register={register}
            errors={errors}
            index={index}
            onRemove={(title, body) => requestRemove(index, title, body)}
          />
        ))}

        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-10"
            onClick={() => append({ title: "", body: "" })}
            disabled={atMax}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add an announcement
          </Button>
          {atMax && <p className={HINT_CLASS}>You can show up to {DINER_BANNER_MAX} announcements.</p>}
        </div>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={target?.label ? `Remove "${target.label}"?` : "Remove this announcement?"}
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
