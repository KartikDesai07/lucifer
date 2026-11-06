import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import {
  SETTINGS_SAVE_BAR_CARD_CLASS,
  SETTINGS_SAVE_DISCARD_CLASS,
  SETTINGS_SAVE_SUBMIT_CLASS,
} from "@/lib/settings-card-layout";
import { ABOVE_TAB_BAR_STICKY_CLASS } from "@/lib/shell-layout";
import { cn } from "@/lib/utils";

// "classic" is every settings page's look today; "card" is the new settings cards' (opt-in, Business details first).
export type SettingsSaveBarLook = "classic" | "card";

interface SettingsSaveBarProps {
  isDirty: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  look?: SettingsSaveBarLook;
}

const CLASSIC_BAR_CLASS =
  "sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-brand-rule bg-brand-slip/95 px-4 py-3 shadow-sm backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]";

// Sticky per-page Save bar — appears ONLY while the form is dirty, so a
// section a staff member merely opened and left untouched never shows a
// prompt to save. CB-UI1 design contract. 40px buttons; on a narrow phone the
// buttons wrap under the "Unsaved changes" line instead of squeezing it. On a
// phone it stops on the tab bar (U0 Task 4), never under it.
export function SettingsSaveBar({ isDirty, isSaving, onDiscard, look = "classic" }: SettingsSaveBarProps) {
  if (!isDirty) return null;

  const card = look === "card";

  return (
    <div
      className={cn(
        card ? SETTINGS_SAVE_BAR_CARD_CLASS : CLASSIC_BAR_CLASS,
        ABOVE_TAB_BAR_STICKY_CLASS,
      )}
    >
      <p className={card ? "text-sm text-muted-foreground" : "text-sm text-brand-muted"}>Unsaved changes</p>
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDiscard}
          disabled={isSaving}
          className={card ? SETTINGS_SAVE_DISCARD_CLASS : BRAND_CONTROL_CLASS}
        >
          Discard
        </Button>
        <Button type="submit" disabled={isSaving} className={card ? SETTINGS_SAVE_SUBMIT_CLASS : BRAND_CONTROL_CLASS}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
