"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { useReorderTables } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import type { Table } from "@/types";

// Same colour vocabulary as TableCard's status dots (Available=green,
// Occupied=red, Reserved=amber). Duplicated rather than imported: TableCard
// owns a heavier config tile, this is a plain arrangement row, and the two
// are meant to stay free to change independently (mirrors MoveTableDialog's
// stance on TableSelector's colours).
const STATUS_STYLES: Record<TableStatus, { dot: string; label: string }> = {
  Available: { dot: "bg-green-500", label: "Available" },
  Occupied: { dot: "bg-red-500", label: "Occupied" },
  Reserved: { dot: "bg-amber-500", label: "Reserved" },
};

interface TableArrangeListProps {
  tables: Table[];
}

// The Categories screen's up/down arrangement, mirrored for the floor plan:
// a tap swaps two neighbours (instant local feedback) and immediately
// persists the WHOLE new list (see PATCH /api/tables) — one round trip, never
// a half-applied swap.
export function TableArrangeList({ tables }: TableArrangeListProps) {
  const reorder = useReorderTables();
  const [order, setOrder] = useState<string[]>(() => tables.map((t) => t.tableNo));

  // Re-seed only when the server's order actually CHANGES — keyed on the
  // joined names in order, not on `tables` itself (a new array reference on
  // every fetch would otherwise re-seed on every poll).
  //
  // This canNOT double as the failure rollback, which is what an earlier version
  // of this comment claimed: when a save fails the server's order is unchanged,
  // so this key is unchanged, so the effect never re-runs and the swap the
  // operator can see stays on screen as if it had saved. The rollback is
  // therefore explicit, in `move` below.
  const serverOrder = tables.map((t) => t.tableNo).join("|");
  useEffect(() => {
    setOrder(tables.map((t) => t.tableNo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOrder]);

  const byTableNo = new Map(tables.map((t) => [t.tableNo, t]));
  const reordering = reorder.isPending;

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const previous = order;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    // The swap shows instantly, but a failed save must take it back: the screen
    // otherwise disagrees with the order the POS picker is actually serving, and
    // the operator — who saw the row move and only a transient toast — would
    // arrange the rest of the floor plan against a position that was never
    // stored. The hook's own onError still toasts; this per-call handler runs
    // alongside it.
    reorder.mutate(next, { onError: () => setOrder(previous) });
  };

  return (
    <ul className="divide-y rounded-lg border">
      {order.map((tableNo, i) => {
        const table = byTableNo.get(tableNo);
        // A table removed by another admin mid-arrange: drop its row rather
        // than crash on missing status/capacity — the next server refresh
        // re-seeds `order` and this gap disappears.
        if (!table) return null;
        const style = STATUS_STYLES[table.status];
        return (
          <li key={tableNo} className="flex items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={i === 0 || reordering}
                  onClick={() => move(i, -1)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={i === order.length - 1 || reordering}
                  onClick={() => move(i, 1)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="font-medium">{table.tableNo}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} />
                {style.label}
              </span>
              <span>Seats {table.capacity}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
