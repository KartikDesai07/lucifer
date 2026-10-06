"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import type { RepeatableBlockType } from "@pos/shared/print-template";
import { Button } from "@/components/ui/button";
import {
  EDITOR_HIDDEN_BLOCK_TYPES,
  addCheck,
  addRepeatable,
  lockContextOf,
  lockReasonOf,
  moveBlock,
  moveBlockTo,
  setBlockOn,
  type EditableTemplate,
  type WriteProblem,
} from "@/lib/print-design-editor";
import type { EditorKind } from "@/lib/print-design-kinds";
import { LOCK_REASON_TEXT } from "@/lib/print-design-labels";
import {
  cancelledAnnouncement,
  droppedAnnouncement,
  movedAnnouncement,
  pickedUpAnnouncement,
} from "@/lib/category-arrange";
import { BlockOptionsSheet } from "@/components/settings/print-design/BlockOptionsSheet";
import { BlockRow } from "@/components/settings/print-design/BlockRow";
import type { Settings } from "@/types";

// Drag is pinned to the vertical axis, as CategoryArrangeList does (the modifiers package is not installed).
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
// Same activation distance as the Categories list: a tap on the grip never starts a drag.
const DRAG_ACTIVATION_DISTANCE_PX = 5;

const ADD_BUTTONS: readonly { type: RepeatableBlockType; label: string }[] = [
  { type: "divider", label: "Add a divider" },
  { type: "customText", label: "Add your own text" },
  { type: "qr", label: "Add a QR code" },
];
// A new text or QR line is empty, so its Sheet opens for typing; a divider needs nothing more.
const OPENS_SHEET: readonly RepeatableBlockType[] = ["customText", "qr"];
const ADD_REASONS_ID = "print-design-add-reasons";

interface BlockEditorProps<T extends EditableTemplate> {
  kind: EditorKind<T>;
  template: T;
  /** The SAVED settings: the lock context (GST, FSSAI) and the UPI ID a new QR line starts from. */
  settings: Settings;
  issues: readonly WriteProblem[];
  onChange: (next: T) => void;
}

// The lines of the slip, top to bottom: a switch, drag and up/down per line, an options Sheet, and the three
// lines a person can add. Drag has a pointer sensor and a keyboard sensor; up/down are the single-pointer
// alternative (WCAG 2.5.7). Locked lines show their reason and cannot be switched off.
export function BlockEditor<T extends EditableTemplate>({ kind, template, settings, issues, onChange }: BlockEditorProps<T>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const lockCtx = lockContextOf(settings);

  const rows = template.blocks.filter((block) => !EDITOR_HIDDEN_BLOCK_TYPES.includes(block.type));
  const ids = rows.map((block) => block.id);
  const nameOf = (id: string) => {
    const type = rows.find((block) => block.id === id)?.type;
    return type ? kind.blockLabel(type) : "";
  };
  // A forced-on line (the bill / ticket number) shows no lock: "Show bill number" / "Show ticket number" alone decides
  // whether it prints (owner, s78 / s79), so "Required on a GST bill" would promise something the print does not do.
  const lockOf = (type: string) => (kind.spec.forcedOn.includes(type) ? null : lockReasonOf(kind.spec, type, lockCtx));
  const visibleIdsOf = (t: T) =>
    t.blocks.filter((block) => !EDITOR_HIDDEN_BLOCK_TYPES.includes(block.type)).map((block) => block.id);

  const move = (id: string, delta: -1 | 1) => {
    const next = moveBlock(template, id, delta, EDITOR_HIDDEN_BLOCK_TYPES);
    if (next === template) return;
    onChange(next);
    const order = visibleIdsOf(next);
    setStatus(movedAnnouncement(nameOf(id), order.indexOf(id) + 1, order.length));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange(moveBlockTo(template, String(active.id), String(over.id)));
  };

  const add = (type: RepeatableBlockType) => {
    if (!addCheck(template, type).ok) return;
    const added = addRepeatable(template, type, settings, kind.allowUpiQr);
    onChange(added.template);
    if (OPENS_SHEET.includes(type)) setEditingId(added.id);
  };

  const refusals = ADD_BUTTONS.flatMap(({ type }) => {
    const check = addCheck(template, type);
    return check.ok ? [] : [check.reason];
  });
  const editingReason = editingId === null ? null : lockOf(template.blocks.find((b) => b.id === editingId)?.type ?? "");

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              pickedUpAnnouncement(nameOf(String(active.id)), ids.indexOf(String(active.id)) + 1, ids.length),
            onDragOver: ({ active, over }) =>
              over ? movedAnnouncement(nameOf(String(active.id)), ids.indexOf(String(over.id)) + 1, ids.length) : "",
            onDragEnd: ({ active, over }) =>
              over
                ? droppedAnnouncement(nameOf(String(active.id)), ids.indexOf(String(over.id)) + 1, ids.length)
                : cancelledAnnouncement(nameOf(String(active.id))),
            onDragCancel: ({ active }) => cancelledAnnouncement(nameOf(String(active.id))),
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {rows.map((block, index) => {
              const reason = lockOf(block.type);
              return (
                <BlockRow
                  key={block.id}
                  block={block}
                  label={kind.blockLabel(block.type)}
                  index={index}
                  total={rows.length}
                  locked={reason !== null}
                  lockText={reason === null ? null : LOCK_REASON_TEXT[reason]}
                  forcedText={kind.spec.forcedOn.includes(block.type) ? kind.forcedRowText : null}
                  note={kind.noteOf(block, template)}
                  problem={issues.find((issue) => issue.blockId === block.id)?.message ?? null}
                  onToggle={(on) => onChange(setBlockOn(template, block.id, on))}
                  onMove={(delta) => move(block.id, delta)}
                  onEdit={() => setEditingId(block.id)}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <div className="flex flex-wrap gap-2">
        {ADD_BUTTONS.map(({ type, label }) => (
          <Button
            key={type}
            type="button"
            variant="outline"
            className="min-h-11"
            aria-disabled={!addCheck(template, type).ok}
            aria-describedby={refusals.length > 0 ? ADD_REASONS_ID : undefined}
            onClick={() => add(type)}
          >
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>
      {refusals.length > 0 && (
        <div id={ADD_REASONS_ID} className="space-y-1 text-xs text-brand-muted">
          {[...new Set(refusals)].map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}

      <BlockOptionsSheet
        kind={kind}
        template={template}
        blockId={editingId}
        settings={settings}
        lockText={editingReason === null ? null : LOCK_REASON_TEXT[editingReason]}
        issues={issues}
        onChange={onChange}
        onClose={() => setEditingId(null)}
      />
    </div>
  );
}
