"use client";

import { Switch } from "@/components/ui/switch";

// "Modifiers come ticked" control for `Product.modifiersPreselected` (owner,
// 2026-09-29). ON: every modifier starts ticked at the POS and on the diner
// menu, and whatever staff (or the diner) untick prints as "NO …" on the KOT,
// the kitchen screen and the bill. Shown only when the item has modifiers —
// with none there is nothing to tick.
//
// Pulled out of ProductFormSheet.tsx (at its ~300-line budget), the same way
// PublicVisibleField is.

interface ModifiersPreselectedFieldProps {
  modifierCount: number;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}

export function ModifiersPreselectedField({ modifierCount, value, onChange }: ModifiersPreselectedFieldProps) {
  if (modifierCount === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Modifiers come ticked</p>
        <p className="text-xs text-muted-foreground">
          Staff untick what the customer does not want. The kitchen slip prints NO before it.
        </p>
      </div>
      <Switch aria-label="Modifiers come ticked" checked={value === true} onCheckedChange={onChange} />
    </div>
  );
}

/** What the form saves: always an explicit boolean (an absent key cannot switch
 *  it off over JSON), and never `true` for an item left with no modifiers. */
export function modifiersPreselectedToSave(values: { modifiers?: string[]; modifiersPreselected?: boolean }): boolean {
  return (values.modifiers?.length ?? 0) > 0 && values.modifiersPreselected === true;
}
