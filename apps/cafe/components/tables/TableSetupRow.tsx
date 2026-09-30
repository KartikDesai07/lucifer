"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, MoreVertical, Pencil, QrCode, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, inr } from "@/lib/utils";
import { tableChargeOf } from "@/lib/receipt";
import { TABLE_STATUS_META, isFreeTable } from "@/lib/table-status";
import { TABLES_QR_PATH } from "@/lib/table-sections";
import type { Table } from "@/types";

// Every control below is 44px on a phone and 40px from md (R20) — the size
// classes are written out in full on each element so Tailwind's scanner and
// the source pin both read them.

interface TableSetupRowProps {
  table: Table;
  index: number;
  total: number;
  disabled: boolean; // a save is pending — dragging AND the arrows pause
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}

// One row of the Setup arrangement list (the CategoryRow shape). `useSortable`
// supplies the drag wiring; `touch-action: none` sits ONLY on the grip button
// so the rest of the row (and the page) keeps scrolling on a phone.
export function TableSetupRow({ table, index, total, disabled, onMove, onEdit, onDelete }: TableSetupRowProps) {
  const t = table.tableNo;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: t,
    disabled,
  });

  // Own translate3d string (no @dnd-kit/utilities import): the same shape
  // CSS.Transform.toString produces for a pure translation.
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: transition ?? undefined,
  };

  const charge = tableChargeOf(table);
  // Configured an amount but never named it — the POS and the order route both
  // treat that as no charge, so this table is silently free.
  const unnamedCharge = (table.chargeAmount ?? 0) > 0 && charge.amount === 0;
  const meta = `${table.capacity} seats${charge.amount > 0 ? ` · ${charge.label} ${inr(charge.amount)}` : ""}`;
  const status = TABLE_STATUS_META[table.status];
  const deletable = isFreeTable(table);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 bg-background px-2 py-3 md:gap-3 md:px-3",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        // aria-disabled, not `disabled`: useSortable({ disabled }) above already
        // stops a drag while a save is pending, and a real `disabled` would
        // drop a keyboard user's focus to <body> right after a drop.
        aria-disabled={disabled}
        aria-label={`Drag to reorder ${t}`}
        className="flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-10 md:w-10"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={t}>
          {t}
        </p>
        <p className="text-xs text-muted-foreground">{meta}</p>
        {/* An amount with no name is not chargeable (lib/receipt.tableChargeOf)
            — say so rather than letting an admin believe a charge is live. */}
        {unnamedCharge && (
          <span className="mt-0.5 flex items-start gap-1.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Charge needs a name before it will apply</span>
          </span>
        )}
      </div>

      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
        {table.publicToken ? "QR ready" : "No QR yet"}
      </span>

      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
          status.chipClass,
        )}
      >
        <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", status.dotClass)} />
        {status.label}
      </span>

      {/* Up/down — the single-pointer alternative to drag (WCAG 2.5.7). aria-disabled
          + a guard (not `disabled`) while saving keeps a keyboard user's focus put.
          Stacked on phones (the name keeps its width); side by side from md. */}
      <div className="flex shrink-0 flex-col md:flex-row">
        <button
          type="button"
          aria-disabled={index === 0 || disabled}
          onClick={() => {
            if (index === 0 || disabled) return;
            onMove(-1);
          }}
          aria-label={`Move ${t} up`}
          className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-10 md:w-10"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-disabled={index === total - 1 || disabled}
          onClick={() => {
            if (index === total - 1 || disabled) return;
            onMove(1);
          }}
          aria-label={`Move ${t} down`}
          className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-10 md:w-10"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 md:h-10 md:w-10"
            aria-label={`More actions for ${t}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" /> Edit table
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={TABLES_QR_PATH} prefetch={false}>
              <QrCode className="mr-2 h-4 w-4" /> QR code
            </Link>
          </DropdownMenuItem>
          {/* The server stays the fence (it refuses a busy table's delete);
              this only stops offering what would fail. */}
          <DropdownMenuItem
            disabled={!deletable}
            onClick={onDelete}
            className={deletable ? "text-destructive" : undefined}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>
              Delete table
              {!deletable && <span className="block text-xs text-muted-foreground">Free it on the floor first</span>}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
