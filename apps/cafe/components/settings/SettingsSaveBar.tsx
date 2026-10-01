import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";

interface SettingsSaveBarProps {
  isDirty: boolean;
  isSaving: boolean;
  onDiscard: () => void;
}

// Sticky per-page Save bar — appears ONLY while the form is dirty, so a
// section a staff member merely opened and left untouched never shows a
// prompt to save. CB-UI1 design contract. 40px buttons; on a narrow phone the
// buttons wrap under the "Unsaved changes" line instead of squeezing it.
export function SettingsSaveBar({ isDirty, isSaving, onDiscard }: SettingsSaveBarProps) {
  if (!isDirty) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-brand-rule bg-brand-slip/95 px-4 py-3 shadow-sm backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <p className="text-sm text-brand-muted">Unsaved changes</p>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={isSaving} className={BRAND_CONTROL_CLASS}>
          Discard
        </Button>
        <Button type="submit" disabled={isSaving} className={BRAND_CONTROL_CLASS}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
