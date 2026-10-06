"use client";

import { useForm } from "react-hook-form";
import type { FieldErrors, Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { settingsSchema, type SettingsInput } from "@/schemas";
import { useUpdateSettings } from "@/hooks/use-settings";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useInAppLeaveGuard, type InAppLeaveGuard } from "@/hooks/use-in-app-leave-guard";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";
import { firstErrorLeaf } from "@/lib/form-errors";
import {
  pickSectionValues,
  sectionForField,
  type SettingsSection,
} from "@/lib/settings-sections";
import type { Settings, UpdateSettingsInput } from "@/types";

// A second, non-form part of a settings page that shares its ONE Save bar and ONE PUT (the Bill print page's
// design draft, print customization S4). Absent on every other page, which then behave exactly as before.
export interface SectionFormExtra {
  /** The extra part has unsaved changes: counts toward the page's dirty flag and puts `body()` in the PUT. */
  dirty: boolean;
  /** A plain sentence when the extra part cannot be saved yet, else null. Checked before anything is sent. */
  problem(): string | null;
  /** What the extra part adds to the PUT body. Called only while `dirty`. */
  body(): UpdateSettingsInput;
  /** Discard drops the extra part's changes with the form's. */
  discard(): void;
  /** The saved document the PUT returned, after the form re-baselined. */
  saved(settings: Settings): void;
}

interface UseSettingsSectionFormResult {
  form: ReturnType<typeof useForm<SettingsInput>>;
  isDirty: boolean;
  isSaving: boolean;
  submit: ReturnType<ReturnType<typeof useForm<SettingsInput>>["handleSubmit"]>;
  discard: () => void;
  leaveGuard: InAppLeaveGuard;
}

// One react-hook-form instance per settings section page, always validated
// against the FULL settingsSchema (so a legacy-invalid field elsewhere on the
// document is still caught, never silently dropped) but submitting ONLY this
// section's own keys through the one PUT /api/settings endpoint.
export function useSettingsSectionForm(
  settings: Settings,
  section: SettingsSection,
  extra?: SectionFormExtra,
): UseSettingsSectionFormResult {
  const updateSettings = useUpdateSettings();

  const form = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsFormDefaults(settings),
  });

  const { handleSubmit, formState, reset, setFocus } = form;
  const isDirty = formState.isDirty || (extra?.dirty ?? false);
  const isSaving = updateSettings.isPending;

  const discard = () => {
    reset();
    extra?.discard();
  };

  useUnsavedGuard(isDirty);
  // A save already in flight still lands, so no leave prompt while saving.
  const leaveGuard = useInAppLeaveGuard(isDirty && !isSaving, discard);

  const onValid = async (values: SettingsInput) => {
    // The extra part is checked first and on its own: a problem there stops the save before anything is sent, and
    // nothing is reset, so the person can fix it and press Save again.
    if (extra?.dirty) {
      const problem = extra.problem();
      if (problem) {
        toast.error(problem);
        return;
      }
    }
    try {
      // The extra part rides along ONLY while it has changes: a save that touched nothing in it never resends it.
      const saved = await updateSettings.mutateAsync({
        ...pickSectionValues(values, section),
        ...(extra?.dirty ? extra.body() : {}),
      });
      // Plain reset(values) — arbitration R1: rhf 7.80.0's `_reset` sets both
      // `_defaultValues` and `_formValues` off `values` unless told to keep
      // one of them, so this alone re-baselines the dirty flag with no extra
      // options. (Not `keepValues: true` — that option is superseded here.)
      reset(values);
      extra?.saved(saved);
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

  return { form, isDirty, isSaving, submit, discard, leaveGuard };
}
