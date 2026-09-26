"use client";

import { useId, useState, type ReactNode } from "react";
import { NotebookPen } from "lucide-react";

import { ORDER_NOTES_MAX_LEN } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CartNotesProps {
  value: string;
  onChange: (value: string) => void;
  /** Rendered at the right-hand end of the COLLAPSED note row (the cart's
   *  more-actions trigger). Omitted while the note box is open, where the row
   *  is already carrying its own Done control. */
  trailing?: ReactNode;
}

// Order-level note for a brand-new sale (create-only — Cart.tsx renders this
// only while NOT resuming a tab; a resumed tab's add-round payload carries no
// notes field, so mid-tab notes are a later slice's concern).
// A hardcoded id would duplicate when the desktop Cart (CSS-hidden) and the
// mobile Sheet's Cart are both mounted, pointing the label at a hidden
// textarea — useId() gives each mounted instance its own unique pair.
//
// D9.7: the note box used to render permanently open, eating footer space on
// every sale even though most sales carry no note. It now starts collapsed
// behind a single row; the collapse state lives HERE (not in Cart.tsx, which
// is already over its line budget) since this component already owns the
// note's presentation. A note that already has text always shows its
// (truncated) preview in the collapsed row, so it can never be silently
// forgotten — expanding is for editing, not for finding out one exists.
export function CartNotes({ value, onChange, trailing }: CartNotesProps) {
  const notesId = useId();
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <div className="flex items-center gap-2 border-t p-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-w-0 flex-1 justify-start gap-1.5 px-2 py-1 text-xs text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          <NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {value.trim() === "" ? "Add note" : `Note: ${value}`}
          </span>
        </Button>
        {/* D9.8b — the more-actions trigger rides at the END of this row
            (owner decision 2026-09-26), so the occasional money controls cost
            the footer no row of their own. It is a slot rather than a direct
            import because this component must stay presentational and the
            menu needs the cart's money props. */}
        {trailing}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 border-t p-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={notesId} className="text-xs text-muted-foreground">
          Order note
        </Label>
        {/* The way back. Without it the box can only ever be opened, so the
            space D9.7 set out to reclaim is gone for the rest of the sale
            after one stray tap. Collapsing never clears the text — the
            collapsed row shows it — so this cannot lose a typed note. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto shrink-0 px-2 py-0.5 text-xs text-muted-foreground"
          onClick={() => setExpanded(false)}
        >
          Done
        </Button>
      </div>
      <Textarea
        id={notesId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={ORDER_NOTES_MAX_LEN}
        placeholder="Order note (prints on KOT)"
        rows={2}
        className="text-sm"
        autoFocus
      />
    </div>
  );
}
