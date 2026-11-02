"use client";

import { ModifiersTickedRow } from "@/components/products/ItemSwitchesCard";

// "Modifiers come ticked" control for `Product.modifiersPreselected` (owner,
// 2026-09-29). ON: every modifier starts ticked at the POS and on the diner
// menu, and whatever staff (or the diner) untick prints as "NO …" on the KOT,
// the kitchen screen and the bill. Shown only when the item has modifiers —
// with none there is nothing to tick.
//
// Pulled out of ProductFormSheet.tsx (at its ~300-line budget). U5 Task 3: drawn as a switch row in the HTML's switches look.

interface ModifiersPreselectedFieldProps {
  modifierCount: number;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}

export function ModifiersPreselectedField({ modifierCount, value, onChange }: ModifiersPreselectedFieldProps) {
  if (modifierCount === 0) return null;
  return <ModifiersTickedRow checked={value === true} onCheckedChange={onChange} />;
}

/** What the form saves: always an explicit boolean (an absent key cannot switch
 *  it off over JSON), and never `true` for an item left with no modifiers. */
export function modifiersPreselectedToSave(values: { modifiers?: string[]; modifiersPreselected?: boolean }): boolean {
  return (values.modifiers?.length ?? 0) > 0 && values.modifiersPreselected === true;
}
