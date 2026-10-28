"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { FloorDialog } from "@/hooks/use-floor-actions";

interface FloorDialogsProps {
  dialog: FloorDialog | null;
  busy: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * The name with U+2060 WORD JOINER after each hyphen-like character (-, U+2010, U+2011, U+2013), so the sheet's body
 * never breaks "T-3" or "T-10" at its hyphen (U3 Task 6 fix, ruling F21: the 378px text from 720px up broke it under
 * both text-wrap: pretty and the greedy wrap). The glyphs stay the same and screen readers skip U+2060. A name is at
 * most TABLE_NO_MAX_LEN = 24 characters (packages/shared/src/constants.ts), about 180px at 14px, so one joined name
 * always fits a phone's line (333px at 375, 318px at 360). The descriptions only: the titles stay plain text.
 */
export function joinNameHyphens(name: string): string {
  return name.replace(/[-\u2010\u2011\u2013]/g, "$&\u2060");
}

function copyFor(dialog: FloorDialog | null): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const t = dialog?.table.tableNo ?? "";
  const n = joinNameHyphens(t);
  if (dialog?.kind === "seat") {
    return {
      title: `Seat guests at ${t}?`,
      description: `The hold on ${n} is released and New Order opens with ${n} picked.`,
      confirmLabel: "Seat now",
      destructive: false,
    };
  }
  return {
    title: `Free ${t}?`,
    description:
      dialog?.table.status === "Reserved"
        ? `The hold on ${n} is released and it shows as available for a new order.`
        : `${n} is marked occupied but has no open bill. Freeing it makes it available for a new order.`,
    confirmLabel: "Free table",
    destructive: true,
  };
}

// The Floor's one confirm dialog: Free table (a Reserved hold, or an Occupied
// table whose bill is already gone) and Seat now. The write itself, and the
// open-bill check that runs first, live in hooks/use-floor-actions.
// U3 Task 6 (design 6.6): in the HTML confirm sheet (U1's look="sheet": 420px, the stacked 46px buttons, a bottom sheet
// below 720px over the safe-area inset); Seat now in the accent, Free table in --bad (destructive), Cancel --surface-3.
// Its Escape and Cancel only call onOpenChange(false), which the hook ignores while the write runs.
export function FloorDialogs({ dialog, busy, onConfirm, onOpenChange }: FloorDialogsProps) {
  // The copy keeps the last dialog while it fades out: `dialog` turns null the
  // moment it closes, which would otherwise flash "Free ?" during the exit.
  const [shown, setShown] = useState<FloorDialog | null>(dialog);
  if (dialog && dialog !== shown) setShown(dialog);
  const copy = copyFor(dialog ?? shown);
  return (
    <ConfirmDialog
      open={dialog !== null}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      destructive={copy.destructive}
      isLoading={busy}
      onConfirm={onConfirm}
      look="sheet"
    />
  );
}
