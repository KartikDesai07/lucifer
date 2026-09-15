"use client";

import type { Control, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import type { ReactNode } from "react";

import { useSettingsSectionForm } from "@/hooks/use-settings-section-form";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import type { SettingsSection } from "@/lib/settings-sections";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

export interface SettingsSectionFormHandles {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

interface SettingsSectionFormProps {
  settings: Settings;
  section: SettingsSection;
  children: (handles: SettingsSectionFormHandles) => ReactNode;
}

// Shared form wrapper for every settings section page: owns the ONE
// react-hook-form instance (via useSettingsSectionForm) and hands the exact
// prop set the existing field components already take, so none of their
// signatures change.
export function SettingsSectionForm({ settings, section, children }: SettingsSectionFormProps) {
  const { form, isDirty, isSaving, submit, discard } = useSettingsSectionForm(settings, section);
  const { control, register, setValue, watch, formState } = form;

  return (
    <form onSubmit={submit} noValidate className="space-y-6 pb-24">
      {children({ control, register, setValue, watch, errors: formState.errors })}
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onDiscard={discard} />
    </form>
  );
}
