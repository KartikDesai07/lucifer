"use client";

import { useId } from "react";

import { ORDER_NOTES_MAX_LEN } from "@/lib/constants";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CartNotesProps {
  value: string;
  onChange: (value: string) => void;
}

// Order-level note for a brand-new sale (create-only — Cart.tsx renders this
// only while NOT resuming a tab; a resumed tab's add-round payload carries no
// notes field, so mid-tab notes are a later slice's concern).
// A hardcoded id would duplicate when the desktop Cart (CSS-hidden) and the
// mobile Sheet's Cart are both mounted, pointing the label at a hidden
// textarea — useId() gives each mounted instance its own unique pair.
export function CartNotes({ value, onChange }: CartNotesProps) {
  const notesId = useId();
  return (
    <div className="space-y-1.5 border-t p-3">
      <Label htmlFor={notesId} className="text-xs text-muted-foreground">
        Order note
      </Label>
      <Textarea
        id={notesId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={ORDER_NOTES_MAX_LEN}
        placeholder="Order note (prints on KOT)"
        rows={2}
        className="text-sm"
      />
    </div>
  );
}
