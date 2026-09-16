import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SettingsSaveBarProps {
  isDirty: boolean;
  isSaving: boolean;
  onDiscard: () => void;
}

// Sticky per-page Save bar — appears ONLY while the form is dirty, so a
// section a staff member merely opened and left untouched never shows a
// prompt to save. CB-UI1 design contract.
export function SettingsSaveBar({ isDirty, isSaving, onDiscard }: SettingsSaveBarProps) {
  if (!isDirty) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <p className="text-sm text-muted-foreground">Unsaved changes</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={isSaving}>
          Discard
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
