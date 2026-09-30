"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, Loader2, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRenameArea } from "@/hooks/use-areas";
import { areaNameSchema } from "@/schemas";
import { tableCountText } from "@/lib/table-areas";
import { cn } from "@/lib/utils";
import type { Area } from "@/types";

// Selects the inline rename form (it carries data-area-rename below).
// AreasSheet reads it so Escape cancels the rename instead of closing the sheet.
export const AREA_RENAME_SELECTOR = "[data-area-rename]";

// Every control below is 44px on a phone and 40px from md - the size classes
// are written out in full on each element so Tailwind's scanner and the source
// pin both read them.

interface AreaRowProps {
  area: Area;
  index: number;
  total: number;
  tableCount: number;
  disabled: boolean; // a save is pending - dragging AND the arrows pause
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

// One row of the Areas list (the CategoryRow shape). `useSortable` supplies the
// drag wiring; `touch-action: none` sits ONLY on the grip button so the rest of
// the row (and the sheet) keeps scrolling on a phone. Rename happens inline in
// the row - no dialog stacked on the sheet.
export function AreaRow({ area, index, total, tableCount, disabled, onMove, onDelete }: AreaRowProps) {
  const rename = useRenameArea();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(area.name);
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Put focus back on the Rename button when the form closes, so a keyboard
  // user is not dropped onto the page body.
  useEffect(() => {
    if (wasEditing.current && !editing) renameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const locked = disabled || editing;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: area._id,
    disabled: locked,
  });

  // Own translate3d string (no @dnd-kit/utilities import): the same shape
  // CSS.Transform.toString produces for a pure translation.
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: transition ?? undefined,
  };

  const startRename = () => {
    setDraft(area.name);
    setError(null);
    setEditing(true);
  };
  const cancelRename = () => setEditing(false);

  const saveRename = async (event: FormEvent) => {
    event.preventDefault();
    if (rename.isPending) return;
    const parsed = areaNameSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (parsed.data === area.name) {
      setEditing(false);
      return;
    }
    try {
      await rename.mutateAsync({ id: area._id, name: parsed.data });
      setEditing(false);
    } catch {
      // The hook toasts the server's reason (a duplicate name, for one); the
      // form stays open so the name can be corrected.
    }
  };

  // On the form, not the Input: Escape also cancels when focus is on Save or Cancel.
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 bg-background px-2 py-3 md:gap-2 md:px-3",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        // aria-disabled, not `disabled`: useSortable({ disabled }) above already
        // stops a drag while a save is pending, and a real `disabled` would
        // drop a keyboard user's focus to <body> right after a drop.
        aria-disabled={locked}
        aria-label={`Drag to reorder ${area.name}`}
        className="flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-10 md:w-10"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Up/down - the single-pointer alternative to drag (WCAG 2.5.7).
          aria-disabled + a guard (not `disabled`) keeps a keyboard user's focus
          put. Stacked on phones so the name keeps its width; side by side from md. */}
      <div className="flex shrink-0 flex-col md:flex-row">
        <button
          type="button"
          aria-disabled={index === 0 || locked}
          onClick={() => {
            if (index === 0 || locked) return;
            onMove(-1);
          }}
          aria-label={`Move ${area.name} up`}
          className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-10 md:w-10"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-disabled={index === total - 1 || locked}
          onClick={() => {
            if (index === total - 1 || locked) return;
            onMove(1);
          }}
          aria-label={`Move ${area.name} down`}
          className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-10 md:w-10"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {editing ? (
        <form data-area-rename="" onSubmit={saveRename} onKeyDown={onFormKeyDown} noValidate className="min-w-0 flex-1 space-y-2">
          <Input
            aria-label="Area name"
            aria-invalid={error !== null}
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            className="h-11 md:h-10"
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={rename.isPending} className="h-11 md:h-10">
              {rename.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button type="button" variant="outline" onClick={cancelRename} className="h-11 md:h-10">
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={area.name}>
              {area.name}
            </p>
            <p className="text-xs text-muted-foreground">{tableCount === 0 ? "No tables" : tableCountText(tableCount)}</p>
          </div>
          <div className="flex shrink-0">
            <Button
              ref={renameButton}
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-10 md:w-10"
              aria-label={`Rename ${area.name}`}
              onClick={startRename}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-10 md:w-10"
              aria-label={`Delete ${area.name}`}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
