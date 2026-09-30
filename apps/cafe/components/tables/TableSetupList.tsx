"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type Announcements,
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
import {
  areaGroupKeyMap,
  areaOrderSignature,
  composeAreaOrder,
  groupTablesByArea,
  sameAreaGroup,
  showAreaHeadings,
  tableCountText,
} from "@/lib/table-areas";
import type { Area, Table } from "@/types";

// A tiny inline modifier in place of @dnd-kit/modifiers (that package is not
// installed): pins the drag to the vertical axis only.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// Screen-reader announcements are group-local: "position 2 of 4" counts the
// tables in the SAME area, because that is the only list a table can move in.
function groupAnnouncements(ids: readonly string[]): Announcements {
  const positionIn = (id: string) => ids.indexOf(id) + 1;
  return {
    onDragStart: ({ active }) => pickedUpAnnouncement(String(active.id), positionIn(String(active.id)), ids.length),
    onDragOver: ({ active, over }) =>
      over ? movedAnnouncement(String(active.id), positionIn(String(over.id)), ids.length) : "",
    onDragEnd: ({ active, over }) =>
      over
        ? droppedAnnouncement(String(active.id), positionIn(String(over.id)), ids.length)
        : cancelledAnnouncement(String(active.id)),
    onDragCancel: ({ active }) => cancelledAnnouncement(String(active.id)),
  };
}

interface TableSetupListProps {
  tables: Table[];
  areas: Area[];
  onEdit: (table: Table) => void;
  onDelete: (table: Table) => void;
}

// DndContext + SortableContext wrapper for the Setup arrangement list — the
// CategoryArrangeList shape, keyed by tableNo. Optimistic local `order` (a
// tableNo array) re-seeded from the server's area-grouped order; a failed save
// rolls the local order back explicitly (a failed save leaves the server's order
// unchanged, so the re-seed effect never re-fires for it).
//
// Areas (Tables B2): `order` is ALWAYS the full flat list, contiguous per area
// (composeAreaOrder), and every save sends that full list. Each area renders as
// its own DndContext + list, so a table can only be arranged inside its own
// area; moving it to another area is Edit table. With no areas there is one
// group and no heading - exactly the flat list.
export function TableSetupList({ tables, areas, onEdit, onDelete }: TableSetupListProps) {
  const reorder = useReorderTables();
  const [order, setOrder] = useState<string[]>(() => composeAreaOrder(tables, areas));

  // Keyed on the area-grouped signature: it changes when the order changes AND
  // when a table moves between areas even if the flat order does not.
  const areaSignature = areaOrderSignature(tables, areas);
  useEffect(() => {
    setOrder(composeAreaOrder(tables, areas));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaSignature]);

  // The hook's own onError re-reads the live list and commits it BEFORE the
  // per-call onError below fires; rolling back to a pre-drag snapshot would
  // overwrite that fresh read, and the next drag would re-send the same stale
  // set and get another 409, forever. Kept current every render (never read in
  // a dependency array) so the rollback lands on whatever the server most
  // recently confirmed.
  const latestServerIdsRef = useRef<string[]>(composeAreaOrder(tables, areas));
  latestServerIdsRef.current = composeAreaOrder(tables, areas);

  const byNo = new Map(tables.map((t) => [t.tableNo, t]));
  const groupKeys = areaGroupKeyMap(tables, areas);
  const saving = reorder.isPending;

  // A table removed by another admin mid-arrange drops out of the groups rather
  // than crashing - the next server refresh re-seeds `order`.
  const ordered = order.flatMap((tableNo) => {
    const table = byNo.get(tableNo);
    return table ? [table] : [];
  });
  const groups = groupTablesByArea(ordered, areas);
  const headings = showAreaHeadings(groups);

  // ONE sensors value shared by every group's DndContext (each context keeps its
  // own sensor state; the values are plain descriptors).
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
    // The neighbour must sit in the same area: a step never crosses a heading.
    const neighbour = order[order.indexOf(tableNo) + delta];
    if (neighbour === undefined || !sameAreaGroup(groupKeys, tableNo, neighbour)) return;
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
    // Defensive: each area is its own drag context, so a cross-area drop cannot
    // reach here - but a saved list must never move a table between areas.
    if (!sameAreaGroup(groupKeys, String(active.id), String(over.id))) return;
    save(arrayMove(order, from, to));
  };

  const lists = groups.map((group) => {
    const ids = group.items.map((t) => t.tableNo);
    const headingId = `table-area-${group.key}`;
    return (
      <Fragment key={group.key}>
        {headings && (
          <h2 id={headingId} className="flex items-baseline gap-2 pt-4 first:pt-0">
            <span className="min-w-0 truncate text-sm font-semibold" title={group.name}>
              {group.name}
            </span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">
              {tableCountText(group.items.length)}
            </span>
          </h2>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements: groupAnnouncements(ids) }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul
              className="divide-y rounded-lg border bg-background"
              aria-labelledby={headings ? headingId : undefined}
            >
              {group.items.map((table, index) => (
                <TableSetupRow
                  key={table.tableNo}
                  table={table}
                  index={index}
                  total={group.items.length}
                  disabled={saving}
                  onMove={(delta) => move(table.tableNo, delta)}
                  onEdit={() => onEdit(table)}
                  onDelete={() => onDelete(table)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </Fragment>
    );
  });

  return headings ? <div className="space-y-2">{lists}</div> : <>{lists}</>;
}
