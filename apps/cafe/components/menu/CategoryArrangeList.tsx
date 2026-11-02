"use client";

import { useEffect, useRef, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
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

import type { StationConfig } from "@pos/shared/print-printers";

import { CATEGORY_KEYS, useReorderCategories } from "@/hooks/use-categories";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { CategoryArrangeListKind } from "@/schemas";
import { CategoryRow } from "@/components/menu/CategoryRow";
import { CATEGORY_CARD_CLASS, CATEGORY_LIST_CLASS, MENU_CATEGORIES_PHONE_QUERY } from "@/lib/menu-categories-layout";
import { soldOutByCategory } from "@/lib/menu-view";
import { categoryHueMap } from "@/lib/pos-categories";
import {
  moveId,
  kitchenArrangement,
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
  /** The stations the page loads: a row's chip names its station (absent = the default station's name). */
  stations: readonly StationConfig[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  // Which arrangement this list edits; "kitchen" = the order dishes print on KOTs.
  list?: CategoryArrangeListKind;
}

// DndContext + SortableContext wrapper for the Categories arrangement list.
// Optimistic local `order` (an id array) re-seeded from the server's joined
// ids; a failed save rolls the local order back explicitly (TableArrangeList
// precedent — the re-seed effect is NOT a substitute for that, since a failed
// save leaves the server's ids unchanged and so never re-fires the effect).
export function CategoryArrangeList({ categories, activeProducts, archivedProducts, stations, onEdit, onDelete, list = "menu" }: CategoryArrangeListProps) {
  const reorder = useReorderCategories(list);
  const idsOf = (): string[] => (list === "kitchen" ? kitchenArrangement(categories) : categories.map((c) => c._id));
  const [order, setOrder] = useState<string[]>(idsOf);

  const serverOrder = idsOf().join("|");
  useEffect(() => {
    setOrder(idsOf());
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
  const latestServerIdsRef = useRef<string[]>(idsOf());
  latestServerIdsRef.current = idsOf();

  const byId = new Map(categories.map((c) => [c._id, c]));
  const counts = itemCountsByCategory(activeProducts, archivedProducts);
  // Any arrangement write (this list's save, or a kitchen Clear) pauses dragging and the arrows.
  const saving = useIsMutating({ mutationKey: CATEGORY_KEYS.arrange }) > 0;
  // Only the look: the rows' dots, meta and chips (values 11).
  const hues = categoryHueMap(categories);
  const soldOut = soldOutByCategory(activeProducts);
  const phone = useMediaQuery(MENU_CATEGORIES_PHONE_QUERY) === true;
  const defaultStationName = stations.find((station) => station.isDefault)?.name ?? "Kitchen";
  const stationNameOf = (category: Category) => stations.find((station) => station.id === category.stationId)?.name ?? defaultStationName;

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
        <div data-ui="categories-card" className={CATEGORY_CARD_CLASS}>
        <ul className={CATEGORY_LIST_CLASS}>
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
                  soldOut={soldOut.get(id) ?? 0}
                  hue={hues.get(id) ?? ""}
                  stationName={stationNameOf(category)}
                  phone={phone}
                  disabled={saving}
                  onMove={(delta) => move(id, delta)}
                  onEdit={() => onEdit(category)}
                  onDelete={() => onDelete(category)}
                />
              );
            })}
          </ul>
        </div>
      </SortableContext>
    </DndContext>
  );
}
