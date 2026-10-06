"use client";

import type {
  Control,
  FieldErrors,
  UseFormGetValues,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import type { ReactNode } from "react";

import { useSettingsSectionForm, type SectionFormExtra } from "@/hooks/use-settings-section-form";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import type { SettingsSection } from "@/lib/settings-sections";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

export interface SettingsSectionFormHandles {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
  watch: UseFormWatch<SettingsInput>;
  // Reads the live values at click time without subscribing the page to every keystroke (watch() would).
  getValues: UseFormGetValues<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

interface SettingsSectionFormProps {
  settings: Settings;
  section: SettingsSection;
  // A non-form part of the page that shares this form's Save bar and PUT (the Bill design draft).
  extra?: SectionFormExtra;
  children: (handles: SettingsSectionFormHandles) => ReactNode;
}

// Shared form wrapper for every settings section page: owns the ONE
// react-hook-form instance (via useSettingsSectionForm) and hands the exact
// prop set the existing field components already take, so none of their
// signatures change.
export function SettingsSectionForm({ settings, section, extra, children }: SettingsSectionFormProps) {
  const { form, isDirty, isSaving, submit, discard, leaveGuard } = useSettingsSectionForm(settings, section, extra);
  const { control, register, setValue, watch, getValues, formState } = form;

  return (
    <>
      <form onSubmit={submit} noValidate className="space-y-6 pb-24">
        {children({ control, register, setValue, watch, getValues, errors: formState.errors })}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onDiscard={discard} />
      </form>
      <ConfirmDialog
        open={leaveGuard.prompting}
        onOpenChange={(open) => {
          if (!open) leaveGuard.keepEditing();
        }}
        title="Discard changes?"
        description="You have changes on this page that are not saved. If you leave now, they will be lost."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        onConfirm={leaveGuard.leave}
      />
    </>
  );
}
