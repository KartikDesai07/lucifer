"use client";

import { Fragment } from "react";

import { cn } from "@/lib/utils";
import { POS_MOVE_TABLE_LIST_CAP_CLASS } from "@/lib/pos-layout";
import { groupTablesByArea, showAreaHeadings } from "@/lib/table-areas";
import { isFreeTable } from "@/lib/table-status";
import { useTableAreas } from "@/hooks/use-table-areas";
import { Button } from "@/components/ui/button";
import type { Table } from "@/types";

// Same colour vocabulary as components/pos/TableSelector.tsx (CLAUDE.md §10
// table colors), duplicated rather than imported: that control's tap means
// "select/resume", this one's means "move a live tab", and nothing should
// couple the two just to share four lines of Tailwind classes.
const STATUS_STYLE: Record<string, string> = {
  Available: "border-green-300 bg-green-50 text-green-700",
  Occupied: "border-red-300 bg-red-50 text-red-700",
  Reserved: "border-amber-300 bg-amber-50 text-amber-700",
};

interface MoveTablePickerProps {
  tables: Table[] | undefined;
  currentTableNo: string | undefined;
  isAssign: boolean;
  // True while the move request is in flight - every control locks.
  disabled: boolean;
  onPick: (table: Table) => void;
  onUnseat: () => void;
  onCancel: () => void;
}

// The free-table picker of MoveTableDialog: the grid, "Remove from table" and
// Cancel. A FRAGMENT - its children sit directly in the dialog's own content.
// It only reports a tap; the confirm step and the mutation stay in the dialog.
export function MoveTablePicker({
  tables,
  currentTableNo,
  isAssign,
  disabled: busy,
  onPick,
  onUnseat,
  onCancel,
}: MoveTablePickerProps) {
  const areas = useTableAreas(tables);
  const groups = groupTablesByArea(tables ?? [], areas.data);
  const showHeadings = showAreaHeadings(groups);

  const renderTile = (t: Table) => {
    const isCurrent = t.tableNo === currentTableNo;
    const tappable = !isCurrent && isFreeTable(t);
    const disabled = !tappable || busy;
    return (
      <button
        key={t._id}
        type="button"
        disabled={disabled}
        onClick={() => onPick(t)}
        className={cn(
          "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-sm font-semibold transition",
          STATUS_STYLE[t.status],
          isCurrent && "ring-2 ring-primary ring-offset-1",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="max-w-full truncate px-1">{t.tableNo}</span>
        <span className="max-w-full truncate text-[10px] font-normal">
          {isCurrent ? "Current" : t.status} · {t.capacity} seats
        </span>
      </button>
    );
  };

  return (
    <>
      <div className={cn("grid grid-cols-3 gap-2 overflow-y-auto", POS_MOVE_TABLE_LIST_CAP_CLASS)}>
        {showHeadings
          ? groups.map((g) => (
              <Fragment key={g.key}>
                <h3 className="col-span-3 truncate pt-1 text-sm font-semibold first:pt-0" title={g.name}>
                  {g.name}
                </h3>
                {g.items.map(renderTile)}
              </Fragment>
            ))
          : (tables ?? []).map(renderTile)}
      </div>

      {/* Its own row, never a grid tile — a tile-shaped control here
          could be mis-tapped while scanning tables. Still gated by the
          dialog's confirm panel before anything fires. */}
      {!isAssign && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-full justify-center text-sm font-medium text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onUnseat}
        >
          Remove from table
        </Button>
      )}

      <Button variant="outline" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </>
  );
}
