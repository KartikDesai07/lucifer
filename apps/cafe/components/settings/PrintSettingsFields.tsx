"use client";

import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { BillPrintCard } from "@/components/settings/BillPrintCard";
import { KotPrintCard } from "@/components/settings/KotPrintCard";

interface PrintSettingsFieldsProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// Two independently-configurable printed surfaces (packages/shared/src/constants.ts
// "Print customization" block, apps/cafe/lib/print.ts PrintConfig) — each gets
// its own Card so toggling one surface never reads as touching the other.
export function PrintSettingsFields({
  control,
  register,
  setValue,
  watch,
  errors,
}: PrintSettingsFieldsProps) {
  return (
    <div className="space-y-6">
      <BillPrintCard control={control} register={register} setValue={setValue} watch={watch} errors={errors} />
      <KotPrintCard control={control} register={register} setValue={setValue} watch={watch} errors={errors} />
    </div>
  );
}
