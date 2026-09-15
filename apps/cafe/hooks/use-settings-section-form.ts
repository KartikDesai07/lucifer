"use client";

import { useForm } from "react-hook-form";
import type { FieldErrors, Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { settingsSchema, type SettingsInput } from "@/schemas";
import { useUpdateSettings } from "@/hooks/use-settings";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";
import { firstErrorLeaf } from "@/lib/form-errors";
import {
  pickSectionValues,
  sectionForField,
  type SettingsSection,
} from "@/lib/settings-sections";
import type { Settings } from "@/types";

interface UseSettingsSectionFormResult {
  form: ReturnType<typeof useForm<SettingsInput>>;
  isDirty: boolean;
  isSaving: boolean;
  submit: ReturnType<ReturnType<typeof useForm<SettingsInput>>["handleSubmit"]>;
  discard: () => void;
}

// One react-hook-form instance per settings section page, always validated
// against the FULL settingsSchema (so a legacy-invalid field elsewhere on the
// document is still caught, never silently dropped) but submitting ONLY this
// section's own keys through the one PUT /api/settings endpoint.
export function useSettingsSectionForm(
  settings: Settings,
  section: SettingsSection,
): UseSettingsSectionFormResult {
  const updateSettings = useUpdateSettings();

  const form = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsFormDefaults(settings),
  });

  const { handleSubmit, formState, reset, setFocus } = form;
  const isDirty = formState.isDirty;
  const isSaving = updateSettings.isPending;

  useUnsavedGuard(isDirty);

  const onValid = async (values: SettingsInput) => {
    try {
      await updateSettings.mutateAsync(pickSectionValues(values, section));
      // Plain reset(values) — arbitration R1: rhf 7.80.0's `_reset` sets both
      // `_defaultValues` and `_formValues` off `values` unless told to keep
      // one of them, so this alone re-baselines the dirty flag with no extra
      // options. (Not `keepValues: true` — that option is superseded here.)
      reset(values);
    } catch {
      // useUpdateSettings already toasts the failure (hooks/use-settings.ts)
      // — do not reset on a rejected save, and no second toast here.
    }
  };

  const onInvalid = (formErrors: FieldErrors<SettingsInput>) => {
    // The nested sections (appearance object, promoCodes array) report their
    // error under the container key with no message of its own — walk to the
    // first leaf so the toast names the real problem and setFocus() targets a
    // registered input, not the container (review 2026-09-08).
    const leaf = firstErrorLeaf(formErrors);
    if (!leaf) return;
    const [rootKey] = leaf.path.split(".");
    const owner = sectionForField(rootKey as keyof SettingsInput);
    if (owner && owner.slug === section.slug) {
      toast.error(leaf.message || "Check the highlighted field before saving");
      // The dotted leaf path IS the registered field name for setFocus; the
      // cast only narrows the string we built back to react-hook-form's Path.
      setFocus(leaf.path as Path<SettingsInput>);
      return;
    }
    // The field belongs to a DIFFERENT section (or none) — this page cannot
    // fix it, so name the section that can rather than failing silently.
    toast.error(`Fix "${owner?.title ?? "another section"}" first`);
  };

  const submit = handleSubmit(onValid, onInvalid);
  const discard = () => reset();

  return { form, isDirty, isSaving, submit, discard };
}
