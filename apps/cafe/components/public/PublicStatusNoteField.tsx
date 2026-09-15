import { PUBLIC_NOTE_MAX_LEN } from "@pos/shared/public";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PublicStatusNoteFieldProps {
  editable: boolean;
  note: string | undefined;
  noteDraft: string;
  onChange: (value: string) => void;
}

// The note Label/Input (editable) or the read-only note line, extracted out
// of PublicStatusItems.tsx to keep that component under this repo's
// ~300-line budget — verbatim move, no behavior change. Render-only: the
// note DRAFT itself (noteDraft/noteSeedRef) stays owned by the parent's
// state machine; this component only shows it and reports edits upward.
export function PublicStatusNoteField({ editable, note, noteDraft, onChange }: PublicStatusNoteFieldProps) {
  if (!editable) {
    return note ? <p className="text-xs italic text-muted-foreground">Note: {note}</p> : null;
  }
  return (
    <div className="space-y-1">
      <Label htmlFor="public-status-note">Note for the kitchen (optional)</Label>
      <Input
        id="public-status-note"
        className="text-base"
        value={noteDraft}
        onChange={(e) => onChange(e.target.value)}
        maxLength={PUBLIC_NOTE_MAX_LEN}
      />
    </div>
  );
}
