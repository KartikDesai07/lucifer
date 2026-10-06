"use client";

import { useId } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, Lock, MoreHorizontal } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { EditableBlock } from "@/lib/print-design-editor";

interface BlockRowProps {
  block: EditableBlock;
  label: string;
  /** Position among the rows the editor shows (0-based) and how many there are. */
  index: number;
  total: number;
  locked: boolean;
  /** Why it is locked, in words; null when free. */
  lockText: string | null;
  /** A line another control switches (the bill / ticket number) says so instead of showing a switch; null when it has its own. */
  forcedText: string | null;
  /** A short hint about the line (never a lock); null when there is none. */
  note: string | null;
  /** What the save gate said about this line; null when fine. */
  problem: string | null;
  onToggle: (on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
}

// The three move/drag targets and the edit button are 44x44 at EVERY width (unlike CategoryRow, which shrinks its
// arrows from md): the editor is used on a counter tablet as much as on a computer.
const TARGET_CLASS = "flex h-11 w-11 items-center justify-center text-brand-muted hover:text-brand-ink";

// One line of the slip. `useSortable` supplies the drag wiring; `touch-action: none` sits ONLY on the grip, so the
// rest of the row (and the page) keeps scrolling on a phone. Up/down are the single-pointer alternative to drag.
export function BlockRow({
  block,
  label,
  index,
  total,
  locked,
  lockText,
  forcedText,
  note,
  problem,
  onToggle,
  onMove,
  onEdit,
}: BlockRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const switchId = useId();
  const numberRow = forcedText !== null;
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: transition ?? undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border bg-brand-slip p-1",
        problem ? "border-destructive" : "border-brand-rule",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-1">
        <div className="flex shrink-0 items-center">
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${label}`}
            className={cn(TARGET_CLASS, "touch-none")}
          >
            <GripVertical aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-disabled={index === 0}
            onClick={() => {
              if (index === 0) return;
              onMove(-1);
            }}
            aria-label={`Move ${label} up`}
            className={cn(TARGET_CLASS, "aria-disabled:opacity-30")}
          >
            <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-disabled={index === total - 1}
            onClick={() => {
              if (index === total - 1) return;
              onMove(1);
            }}
            aria-label={`Move ${label} down`}
            className={cn(TARGET_CLASS, "aria-disabled:opacity-30")}
          >
            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-w-0 flex-1 basis-36 px-1 py-1">
          <p className="break-words text-sm font-medium text-brand-ink">{label}</p>
          {lockText && (
            <p className="flex items-start gap-1 text-xs text-brand-muted">
              <Lock aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words">{lockText}</span>
            </p>
          )}
          {numberRow && <p className="break-words text-xs text-brand-muted">{forcedText}</p>}
          {note && <p className="break-words text-xs text-brand-muted">{note}</p>}
          {problem && <p className="break-words text-xs text-destructive">{problem}</p>}
        </div>

        <div className="ml-auto flex shrink-0 items-center">
          {!numberRow && (
            <label htmlFor={switchId} className="flex h-11 w-11 cursor-pointer items-center justify-center">
              <Switch
                id={switchId}
                checked={block.on || locked}
                disabled={locked}
                onCheckedChange={onToggle}
                aria-label={`Print ${label}`}
              />
            </label>
          )}
          <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} className={TARGET_CLASS}>
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}
