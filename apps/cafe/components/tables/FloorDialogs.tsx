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

function copyFor(dialog: FloorDialog | null): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const t = dialog?.table.tableNo ?? "";
  if (dialog?.kind === "seat") {
    return {
      title: `Seat guests at ${t}?`,
      description: `The hold on ${t} is released and New Order opens with ${t} picked.`,
      confirmLabel: "Seat now",
      destructive: false,
    };
  }
  return {
    title: `Free ${t}?`,
    description:
      dialog?.table.status === "Reserved"
        ? `The hold on ${t} is released and it shows as available for a new order.`
        : `${t} is marked occupied but has no open bill. Freeing it makes it available for a new order.`,
    confirmLabel: "Free table",
    destructive: true,
  };
}

// The Floor's one confirm dialog: Free table (a Reserved hold, or an Occupied
// table whose bill is already gone) and Seat now. The write itself, and the
// open-bill check that runs first, live in hooks/use-floor-actions.
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
    />
  );
}
