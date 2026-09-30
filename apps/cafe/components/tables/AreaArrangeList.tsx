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

import { useReorderAreas } from "@/hooks/use-areas";
import { AreaRow } from "@/components/tables/AreaRow";
import {
  moveId,
  pickedUpAnnouncement,
  movedAnnouncement,
  droppedAnnouncement,
  cancelledAnnouncement,
} from "@/lib/category-arrange";
import { tablesInArea } from "@/lib/table-areas";
import type { Area, Table } from "@/types";

// A tiny inline modifier in place of @dnd-kit/modifiers (that package is not
// installed): pins the drag to the vertical axis only.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface AreaArrangeListProps {
  areas: Area[];
  tables: Table[];
  onDelete: (area: Area) => void;
}

// DndContext + SortableContext wrapper for the Areas list - the
// CategoryArrangeList shape, keyed by Area._id. Optimistic local `order`
// re-seeded from the server's joined ids; a failed save rolls the local order
// back explicitly (a failed save leaves the server's ids unchanged, so the
// re-seed effect never re-fires for it).
export function AreaArrangeList({ areas, tables, onDelete }: AreaArrangeListProps) {
  const reorder = useReorderAreas();
  const [order, setOrder] = useState<string[]>(() => areas.map((a) => a._id));

  const serverOrder = areas.map((a) => a._id).join("|");
  useEffect(() => {
    setOrder(areas.map((a) => a._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOrder]);

  // The hook's own onError re-reads the live list and commits it BEFORE the
  // per-call onError below fires; rolling back to a pre-drag snapshot would
  // overwrite that fresh read, and the next drag would re-send the same stale
  // set and get another 409, forever. Kept current every render (never read in
  // a dependency array) so the rollback lands on whatever the server most
  // recently confirmed.
  const latestServerIdsRef = useRef<string[]>(areas.map((a) => a._id));
  latestServerIdsRef.current = areas.map((a) => a._id);

  const byId = new Map(areas.map((a) => [a._id, a]));
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

  const move = (id: string, delta: -1 | 1) => {
    if (saving) return;
    const next = moveId(order, id, delta);
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

  const nameOf = (id: string) => byId.get(id)?.name ?? "";
  const positionOf = (id: string) => order.indexOf(id) + 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            pickedUpAnnouncement(nameOf(String(active.id)), positionOf(String(active.id)), order.length),
          onDragOver: ({ active, over }) =>
            over ? movedAnnouncement(nameOf(String(active.id)), positionOf(String(over.id)), order.length) : "",
          onDragEnd: ({ active, over }) =>
            over
              ? droppedAnnouncement(nameOf(String(active.id)), positionOf(String(over.id)), order.length)
              : cancelledAnnouncement(nameOf(String(active.id))),
          onDragCancel: ({ active }) => cancelledAnnouncement(nameOf(String(active.id))),
        },
      }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="divide-y rounded-lg border bg-background">
          {order.map((id, index) => {
            const area = byId.get(id);
            // An area removed by another admin mid-arrange: drop its row rather
            // than crash - the next server refresh re-seeds `order`.
            if (!area) return null;
            return (
              <AreaRow
                key={id}
                area={area}
                index={index}
                total={order.length}
                tableCount={tablesInArea(tables, id).length}
                disabled={saving}
                onMove={(delta) => move(id, delta)}
                onDelete={() => onDelete(area)}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
