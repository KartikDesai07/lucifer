"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import {
  TABLE_AREA_CLASS,
  TABLE_AREA_HEAD_CLASS,
  TABLE_CLOSE_CLASS,
  TABLE_GRID_CLASS,
  TABLE_HEAD_CLASS,
  TABLE_LEGEND_CLASS,
  TABLE_LEGEND_DOT_CLASS,
  TABLE_LEGEND_ITEM_CLASS,
  TABLE_SUB_CLASS,
  TABLE_TILE_CLASS,
  TABLE_TILE_DOT_CLASS,
  TABLE_TILE_LABEL_CLASS,
  TABLE_TILE_NAME_CLASS,
  TABLE_TILE_SEATS_CLASS,
  TABLE_TILE_TONES,
  TABLE_TILE_TOP_CLASS,
  TABLE_TITLE_CLASS,
  freeText,
  seatsText,
  tileDelay,
  type LegendItem,
  type TableTileKind,
} from "@/lib/table-sheet";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { Table } from "@/types";

// The parts of the owner's HTML "Choose a table" sheet (U1 Task 11; values 9.1 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.12), drawn the same in the New Order table picker
// (TableSelector.tsx) and the Move / Assign dialog (components/orders/MoveTableDialog.tsx + MoveTablePicker.tsx). Each
// caller owns its Radix dialog, its rule (lib/table-sheet.ts) and what a tap does; these only draw. The look is
// lib/table-sheet.ts.

/** The head: the title over the sub (the dialog's title and description), and the ✕. */
export function TableSheetHead({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <div data-ui="tp-head" className={TABLE_HEAD_CLASS}>
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title data-ui="tp-title" className={TABLE_TITLE_CLASS}>{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description data-ui="tp-sub" className={TABLE_SUB_CLASS}>{sub}</DialogPrimitive.Description>
      </div>
      <DialogPrimitive.Close data-ui="tp-close" aria-label="Close" className={cn(TABLE_CLOSE_CLASS, BRAND_PRESS_CLASS)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </DialogPrimitive.Close>
    </div>
  );
}

/** The legend: each word after its tile's dot. */
export function TableLegend({ items }: { items: readonly LegendItem[] }) {
  return (
    <div data-ui="tp-legend" className={TABLE_LEGEND_CLASS}>
      {items.map((item) => (
        <span key={item.kind} className={TABLE_LEGEND_ITEM_CLASS}>
          <span aria-hidden="true" className={cn(TABLE_LEGEND_DOT_CLASS, TABLE_TILE_TONES[item.kind].dot)} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** A named area: its name and "{n} free" over its tiles. */
export function TableArea({ name, free, children }: { name: string; free: number; children: ReactNode }) {
  return (
    <div data-ui="tp-area" className={TABLE_AREA_CLASS}>
      <div data-ui="tp-area-head" className={TABLE_AREA_HEAD_CLASS}>
        <span className="min-w-0 truncate" title={name}>{name}</span>
        <span className="flex-none">{freeText(free)}</span>
      </div>
      <div data-ui="tp-grid" className={TABLE_GRID_CLASS}>
        {children}
      </div>
    </div>
  );
}

/** One table: its name and seats over the label in its kind's colours; the caller decides what a tap does. */
export function TableTile({
  table,
  kind,
  label,
  title,
  disabled,
  index,
  onClick,
}: {
  table: Table;
  kind: TableTileKind;
  label: string;
  /** The tile's title (the open tab's customer); the table's full name without one. */
  title?: string;
  disabled: boolean;
  /** Its place in its area: the rise's delay. */
  index: number;
  onClick: () => void;
}) {
  const tone = TABLE_TILE_TONES[kind];
  return (
    <button
      type="button"
      data-ui="tp-tile"
      data-kind={kind}
      aria-current={kind === "current" ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
      title={title ?? table.tableNo}
      style={{ animationDelay: tileDelay(index) }}
      className={cn(TABLE_TILE_CLASS, tone.tile, BRAND_PRESS_CLASS)}
    >
      <span className={TABLE_TILE_TOP_CLASS}>
        <span className={TABLE_TILE_NAME_CLASS}>{table.tableNo}</span>
        <span className={TABLE_TILE_SEATS_CLASS}>{seatsText(table.capacity)}</span>
      </span>
      <span className={cn(TABLE_TILE_LABEL_CLASS, tone.label)}>
        <span aria-hidden="true" className={cn(TABLE_TILE_DOT_CLASS, tone.dot)} />
        {label}
      </span>
    </button>
  );
}
