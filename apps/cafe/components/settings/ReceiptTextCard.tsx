"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, SettingsGroup } from "@/components/settings/SettingsFields";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";

const RECEIPT_HEADER_ID = "settings-receipt-header";
const RECEIPT_FOOTER_ID = "settings-receipt-footer";

interface ReceiptTextCardProps {
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Receipt text — split out of the retired GeneralSettingsFields.tsx (CB-UI1
// S3). Rendered above the paper and text size on the Bill print page.
export function ReceiptTextCard({ register, errors }: ReceiptTextCardProps) {
  return (
    <SettingsGroup
      stacked
      title="Header and footer text"
      description="Optional lines at the top and bottom of the bill."
    >
      <Field
        label="Header note"
        htmlFor={RECEIPT_HEADER_ID}
        error={errors.receiptHeader?.message}
        hint="e.g. GST included · Dine-in"
      >
        <Input id={RECEIPT_HEADER_ID} className={BRAND_CONTROL_CLASS} {...register("receiptHeader")} />
      </Field>
      <Field label="Footer message" htmlFor={RECEIPT_FOOTER_ID} error={errors.receiptFooter?.message}>
        <Textarea id={RECEIPT_FOOTER_ID} rows={2} {...register("receiptFooter")} />
      </Field>
    </SettingsGroup>
  );
}
