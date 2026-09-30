"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";

import { useReorderTables } from "@/hooks/use-tables";
import { TableSetupRow } from "@/components/tables/TableSetupRow";
import {
  moveId,
  pickedUpAnnouncement,
  movedAnnouncement,
  droppedAnnouncement,
  cancelledAnnouncement,
} from "@/lib/category-arrange";
import type { Table } from "@/types";

// A tiny inline modifier in place of @dnd-kit/modifiers (that package is not
// installed): pins the drag to the vertical axis only.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface TableSetupListProps {
  tables: Table[];
  onEdit: (table: Table) => void;
  onDelete: (table: Table) => void;
}

// DndContext + SortableContext wrapper for the Setup arrangement list — the
// CategoryArrangeList shape, keyed by tableNo. Optimistic local `order` (a
// tableNo array) re-seeded from the server's joined names; a failed save rolls
// the local order back explicitly (a failed save leaves the server's names
// unchanged, so the re-seed effect never re-fires for it).
export function TableSetupList({ tables, onEdit, onDelete }: TableSetupListProps) {
  const reorder = useReorderTables();
  const [order, setOrder] = useState<string[]>(() => tables.map((t) => t.tableNo));

  const serverOrder = tables.map((t) => t.tableNo).join("|");
  useEffect(() => {
    setOrder(tables.map((t) => t.tableNo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOrder]);

  // The hook's own onError re-reads the live list and commits it BEFORE the
  // per-call onError below fires; rolling back to a pre-drag snapshot would
  // overwrite that fresh read, and the next drag would re-send the same stale
  // set and get another 409, forever. Kept current every render (never read in
  // a dependency array) so the rollback lands on whatever the server most
  // recently confirmed.
  const latestServerIdsRef = useRef<string[]>(tables.map((t) => t.tableNo));
  latestServerIdsRef.current = tables.map((t) => t.tableNo);

  const byNo = new Map(tables.map((t) => [t.tableNo, t]));
  const saving = reorder.isPending;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = (next: string[]) => {
    setOrder(next);
    // The hook's own onError still toasts and re-reads the live list; this
    // per-call handler additionally undoes the optimistic move so a failed
    // save never leaves the screen showing an order that was never persisted.
    reorder.mutate(next, { onError: () => setOrder(latestServerIdsRef.current) });
  };

  const move = (tableNo: string, delta: -1 | 1) => {
    if (saving) return;
    const next = moveId(order, tableNo, delta);
    if (next.join("|") === order.join("|")) return;
    save(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    save(arrayMove(order, from, to));
  };

  const positionOf = (tableNo: string) => order.indexOf(tableNo) + 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => pickedUpAnnouncement(String(active.id), positionOf(String(active.id)), order.length),
          onDragOver: ({ active, over }) =>
            over ? movedAnnouncement(String(active.id), positionOf(String(over.id)), order.length) : "",
          onDragEnd: ({ active, over }) =>
            over
              ? droppedAnnouncement(String(active.id), positionOf(String(over.id)), order.length)
              : cancelledAnnouncement(String(active.id)),
          onDragCancel: ({ active }) => cancelledAnnouncement(String(active.id)),
        },
      }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="divide-y rounded-lg border bg-background">
          {order.map((tableNo, index) => {
            const table = byNo.get(tableNo);
            // A table removed by another admin mid-arrange: drop its row rather
            // than crash — the next server refresh re-seeds `order`.
            if (!table) return null;
            return (
              <TableSetupRow
                key={tableNo}
                table={table}
                index={index}
                total={order.length}
                disabled={saving}
                onMove={(delta) => move(tableNo, delta)}
                onEdit={() => onEdit(table)}
                onDelete={() => onDelete(table)}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
