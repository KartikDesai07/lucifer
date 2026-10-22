"use client";

import { cn } from "@/lib/utils";
import {
  MOVE_LEGEND,
  REMOVE_LINK_CLASS,
  SECONDARY_BUTTON_CLASS,
  TABLE_BODY_CLASS,
  TABLE_FOOT_CLASS,
  TABLE_GRID_CLASS,
  freeTileCount,
  moveTile,
} from "@/lib/table-sheet";
import { groupTablesByArea, showAreaHeadings } from "@/lib/table-areas";
import { useTableAreas } from "@/hooks/use-table-areas";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { TableArea, TableLegend, TableTile } from "@/components/pos/TableSheet";
import type { Table } from "@/types";

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

// The free-table picker of MoveTableDialog, in the owner's HTML "Choose a table" sheet (U1 Task 11; values 9.1; design
// 6.12): the legend, the areas with "{n} free" and their tiles (TableSheet.tsx), then the foot: "Remove from table" as a
// red link and "Cancel". A FRAGMENT - its parts are rows of the dialog's own panel. Only a free table that is not the
// tab's own can be tapped (lib/table-sheet.ts moveTile, on the shared isFreeTable); it only reports the tap - the
// confirm step and the mutation stay in the dialog.
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

  const tileOf = (t: Table) => moveTile(t, currentTableNo);

  const renderTile = (t: Table, index: number) => {
    const tile = tileOf(t);
    return (
      <TableTile
        key={t._id}
        table={t}
        kind={tile.kind}
        label={tile.label}
        disabled={tile.disabled || busy}
        index={index}
        onClick={() => onPick(t)}
      />
    );
  };

  return (
    <>
      <TableLegend items={MOVE_LEGEND} />
      <div data-ui="tp-body" className={TABLE_BODY_CLASS}>
        {showHeadings
          ? groups.map((g) => (
              <TableArea key={g.key} name={g.name} free={freeTileCount(g.items.map((t) => tileOf(t).kind))}>
                {g.items.map(renderTile)}
              </TableArea>
            ))
          : <div data-ui="tp-grid" className={TABLE_GRID_CLASS}>{(tables ?? []).map(renderTile)}</div>}
      </div>

      <div data-ui="tp-foot" className={TABLE_FOOT_CLASS}>
        {/* Its own row, never a grid tile — a tile-shaped control here
            could be mis-tapped while scanning tables. Still gated by the
            dialog's confirm panel before anything fires. */}
        {!isAssign && (
          <button
            type="button"
            data-ui="tp-remove"
            className={cn(REMOVE_LINK_CLASS, BRAND_PRESS_CLASS)}
            disabled={busy}
            onClick={onUnseat}
          >
            Remove from table
          </button>
        )}
        <button
          type="button"
          data-ui="tp-cancel"
          className={cn(SECONDARY_BUTTON_CLASS, BRAND_PRESS_CLASS)}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </>
  );
}
