"use client";

import { useState, type ReactElement } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import {
  SELECTOR_DESCRIPTION,
  SELECTOR_LEGEND,
  SELECTOR_SCRIM_CLASS,
  TABLE_BODY_CLASS,
  TABLE_FOOT_CLASS,
  TABLE_GRID_CLASS,
  TABLE_PANEL_CLASS,
  TABLE_SHEET_TITLE,
  WALK_IN_CHOSEN_CLASS,
  WALK_IN_CLASS,
  WALK_IN_OTHER_CLASS,
  WALK_IN_TABLE_LABEL,
  freeTileCount,
  selectorTile,
} from "@/lib/table-sheet";
import { groupTablesByArea, showAreaHeadings } from "@/lib/table-areas";
import { useTableAreas } from "@/hooks/use-table-areas";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { TableArea, TableLegend, TableSheetHead, TableTile } from "@/components/pos/TableSheet";
import type { Order, Table } from "@/types";

interface TableSelectorProps {
  tables: Table[] | undefined;
  value: string | undefined;
  onChange: (tableNo: string | undefined) => void;
  tabs?: Order[]; // open, unsettled tabs — lets an occupied tile name who is sitting there
  onResume?: (order: Order) => void; // jump straight to that tab instead of picking a table
  // The control this picker opens from: the cart head's Table cell (U1 Task 4, owner Q9). It brings its own words,
  // title and lock (disabled while an order write is in flight); a resumed tab never mounts this picker — moving THAT
  // tab's table goes through MoveTableDialog (server-CAS'd, prints a kitchen slip), not this picker, which only ever
  // writes local cart state.
  trigger: ReactElement;
}

// The owner's HTML "Choose a table" sheet (U1 Task 11; values 9 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.12; owner Q1): "Choose a table" over today's description, the HTML's legend, the cafe's areas in their
// arranged order ("Other tables" for the rest; one flat grid when no area is named) with "{n} free", the 78px tiles and
// today's "Walk-In (no table)" at the foot. Today's taps (lib/table-sheet.ts selectorTile, on the shared tablePickAction):
// an occupied table holding one of today's open tabs resumes it ("₹x open"); an available table is selected ("Free"); an
// occupied table with no known tab and a reserved one cannot take a new order (disabled); the chosen table ("Current")
// can be tapped again. Choosing a table re-derives the charge (the page's selectTable). The parts are TableSheet.tsx.
export function TableSelector({
  tables,
  value,
  onChange,
  tabs,
  onResume,
  trigger,
}: TableSelectorProps) {
  const [open, setOpen] = useState(false);
  const openerFocus = useOpenerFocus();

  const select = (tableNo: string | undefined) => {
    onChange(tableNo);
    setOpen(false);
  };

  const resume = (order: Order) => {
    onResume?.(order);
    setOpen(false);
  };

  const areas = useTableAreas(tables);
  const groups = groupTablesByArea(tables ?? [], areas.data);
  const showHeadings = showAreaHeadings(groups);

  // Rush friction: a tile holding a tab we already know about is a shortcut to that bill instead of a dead end.
  const tileOf = (t: Table) => selectorTile(t, { selected: value === t.tableNo, tabs, canResume: !!onResume });

  const renderTile = (t: Table, index: number) => {
    const tile = tileOf(t);
    return (
      <TableTile
        key={t._id}
        table={t}
        kind={tile.kind}
        label={tile.label}
        title={tile.title}
        disabled={tile.disabled}
        index={index}
        onClick={() => (tile.resume ? resume(tile.resume) : select(t.tableNo))}
      />
    );
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="tp-sheet" className={SELECTOR_SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="tp-panel" {...openerFocus} className={TABLE_PANEL_CLASS}>
            <TableSheetHead title={TABLE_SHEET_TITLE} sub={SELECTOR_DESCRIPTION} />
            <TableLegend items={SELECTOR_LEGEND} />
            {/* A cafe defines its own floor plan (CR1.1), so the list is unbounded: the body scrolls inside the capped
                panel and the Walk-In escape hatch stays on screen at the foot. */}
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
              <button
                type="button"
                data-ui="tp-walkin"
                aria-current={value ? undefined : "true"}
                className={cn(WALK_IN_CLASS, value ? WALK_IN_OTHER_CLASS : WALK_IN_CHOSEN_CLASS, BRAND_PRESS_CLASS)}
                onClick={() => select(undefined)}
              >
                {WALK_IN_TABLE_LABEL}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
