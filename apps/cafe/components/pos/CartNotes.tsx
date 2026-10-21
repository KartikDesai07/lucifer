"use client";

import { useId } from "react";

import { ORDER_NOTES_MAX_LEN } from "@/lib/constants";
import { POS_PANEL_FIELD_CLASS } from "@/lib/pos-layout";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FooterPanel, PANEL_TITLE_CLASS } from "@/components/pos/BillOptionsPanel";

interface CartNotesProps {
  value: string;
  onChange: (value: string) => void;
  /** A send carrying this note is in flight — the note cannot change under it. */
  disabled?: boolean;
  /** The cart the panel stays inside. */
  boundary: Element | null;
  /** "Done": closes the panel; never clears the note. */
  onDone: () => void;
}

// Order-level note for a brand-new sale (create-only — Cart.tsx opens this
// only while NOT resuming a tab; a resumed tab's add-round payload carries no
// notes field, so mid-tab notes are a later slice's concern).
// A hardcoded id would duplicate when the desktop Cart (CSS-hidden) and the
// mobile Sheet's Cart are both mounted, pointing the label at a hidden
// textarea — useId() gives each mounted instance its own unique pair.
//
// U1 Task 5 (owner Q11; design 6.7): the footer's Note link opens this panel in the Bill options panel's frame (the
// HTML's popover): "Order note" over the 200-character field, and "Done", which only closes it — the text stays, and
// the Note link previews it ("Note · {first words…}"), so a typed note can never be silently forgotten (D9.7's rule).
export function CartNotes({ value, onChange, disabled, boundary, onDone }: CartNotesProps) {
  const notesId = useId();
  return (
    <FooterPanel
      dataUi="pos-note-panel"
      label="Order note"
      title={<Label htmlFor={notesId} className={cn(PANEL_TITLE_CLASS, "leading-[normal]")}>Order note</Label>}
      focusKey="note"
      boundary={boundary}
      onDone={onDone}
    >
      <Textarea
        id={notesId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={ORDER_NOTES_MAX_LEN}
        placeholder="Order note (prints on KOT)"
        rows={3}
        className={cn(POS_PANEL_FIELD_CLASS, "h-auto min-h-[68px] py-2 leading-[1.4]")}
        disabled={disabled}
      />
    </FooterPanel>
  );
}
