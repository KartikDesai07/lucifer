"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/settings/SettingsFields";

interface ReceiptTextCardProps {
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Receipt text — split out of the retired GeneralSettingsFields.tsx (CB-UI1
// S3). Rendered above BillPrintCard on the Bill print page.
export function ReceiptTextCard({ register, errors }: ReceiptTextCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receipt text</CardTitle>
        <CardDescription>
          Optional header note and the closing line on the bill.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Header note"
          error={errors.receiptHeader?.message}
          hint="e.g. GST included · Dine-in"
        >
          <Input {...register("receiptHeader")} />
        </Field>
        <Field label="Footer message" error={errors.receiptFooter?.message}>
          <Textarea rows={2} {...register("receiptFooter")} />
        </Field>
      </CardContent>
    </Card>
  );
}
