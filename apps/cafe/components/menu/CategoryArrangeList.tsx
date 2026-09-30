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

import { useReorderCategories } from "@/hooks/use-categories";
import { CategoryRow } from "@/components/menu/CategoryRow";
import {
  moveId,
  itemCountsByCategory,
  pickedUpAnnouncement,
  movedAnnouncement,
  droppedAnnouncement,
  cancelledAnnouncement,
} from "@/lib/category-arrange";
import type { Category, Product } from "@/types";

// A tiny inline modifier in place of @dnd-kit/modifiers (D4/R24 — that package
// is not installed): pins the drag to the vertical axis only, same as
// restrictToVerticalAxis would.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface CategoryArrangeListProps {
  categories: Category[];
  activeProducts: Product[];
  archivedProducts: Product[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}

// DndContext + SortableContext wrapper for the Categories arrangement list.
// Optimistic local `order` (an id array) re-seeded from the server's joined
// ids; a failed save rolls the local order back explicitly (TableArrangeList
// precedent — the re-seed effect is NOT a substitute for that, since a failed
// save leaves the server's ids unchanged and so never re-fires the effect).
export function CategoryArrangeList({ categories, activeProducts, archivedProducts, onEdit, onDelete }: CategoryArrangeListProps) {
  const reorder = useReorderCategories();
  const [order, setOrder] = useState<string[]>(() => categories.map((c) => c._id));

  const serverOrder = categories.map((c) => c._id).join("|");
  useEffect(() => {
    setOrder(categories.map((c) => c._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOrder]);

  // The hook's own onError (mutation.js: onError runs, then onSettled, THEN
  // this per-call onError) can re-seed `order` from a fresh ?fresh=1 read
  // BEFORE this callback fires. Rolling back to the `previous` snapshot taken
  // when the drag started would overwrite that fresh read with stale ids --
  // the next drag re-sends the same stale set, gets another 409, forever.
  // Kept current every render (never read in a dependency array) so the
  // rollback always lands on whatever the server most recently confirmed,
  // whether that arrived before or after this callback runs.
  const latestServerIdsRef = useRef<string[]>(categories.map((c) => c._id));
  latestServerIdsRef.current = categories.map((c) => c._id);

  const byId = new Map(categories.map((c) => [c._id, c]));
  const counts = itemCountsByCategory(activeProducts, archivedProducts);
  const saving = reorder.isPending;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = (next: string[]) => {
    setOrder(next);
    // Same explicit-rollback shape as TableArrangeList: the hook's own onError
    // still toasts (and, on a 409, refetches the live list) — this per-call
    // handler additionally undoes the optimistic move so a failed save never
    // leaves the screen showing an order that was never persisted. Rolls back
    // to the LATEST known server order, not the pre-drag snapshot (G2).
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
          onDragStart: ({ active }) => pickedUpAnnouncement(nameOf(String(active.id)), positionOf(String(active.id)), order.length),
          onDragOver: ({ active, over }) =>
            over ? movedAnnouncement(nameOf(String(active.id)), order.indexOf(String(over.id)) + 1, order.length) : "",
          onDragEnd: ({ active, over }) =>
            over
              ? droppedAnnouncement(nameOf(String(active.id)), order.indexOf(String(over.id)) + 1, order.length)
              : cancelledAnnouncement(nameOf(String(active.id))),
          onDragCancel: ({ active }) => cancelledAnnouncement(nameOf(String(active.id))),
        },
      }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="divide-y rounded-lg border">
          {order.map((id, index) => {
            const category = byId.get(id);
            // A category removed by another admin mid-arrange: drop its row
            // rather than crash — the next server refresh re-seeds `order`.
            if (!category) return null;
            return (
              <CategoryRow
                key={id}
                category={category}
                index={index}
                total={order.length}
                counts={counts.get(id)}
                disabled={saving}
                onMove={(delta) => move(id, delta)}
                onEdit={() => onEdit(category)}
                onDelete={() => onDelete(category)}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
