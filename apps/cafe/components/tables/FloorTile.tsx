"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Clock, Loader2 } from "lucide-react";

import { cn, formatTime, inr } from "@/lib/utils";
import { FLOOR_POS_PATH, FLOOR_PRIMARY_LABEL, formatStayMinutes, type FloorMenuAction, type FloorTileModel } from "@/lib/floor-tiles";
import { offerPosTable } from "@/lib/pos-table-handoff";
import { tableChargeOf } from "@/lib/receipt";
import { TABLE_STATUS_META } from "@/lib/table-status";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorTileMenu } from "@/components/tables/FloorTileMenu";

interface FloorTileProps {
  tile: FloorTileModel;
  /** A write (or its open-bill check) is running for THIS table only. */
  busy: boolean;
  /** The open bills failed to load and there is no older list to show. */
  tabsFailed: boolean;
  onTap: (tile: FloorTileModel) => void;
  onMenu: (tile: FloorTileModel, action: FloorMenuAction) => void;
}

// A POS table view tile: the status is the tile's own tint and border plus its
// name in words — one signal, said once (no stripe, no chip). The table number
// leads, the bill is the one big figure, and the action is a quiet label.
const TILE_CLASS =
  "flex h-full min-h-28 w-full flex-col rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-1";
// Only a surface that does something on a tap reacts to the pointer.
const TAPPABLE_CLASS = "transition-shadow hover:shadow-md active:shadow-none";
const META_LINE = "block min-h-4 truncate text-xs text-brand-muted";

// The hand-off is offered only for a plain primary click: a middle / modifier
// click opens a plain New Order in a new tab, which must not carry the table.
function offerOnPlainClick(e: MouseEvent<HTMLAnchorElement>, tableNo: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  offerPosTable(tableNo, Date.now());
}

function TileDetails({ tile, tabsFailed }: { tile: FloorTileModel; tabsFailed: boolean }) {
  const { table, tab } = tile;
  if (table.status === "Occupied") {
    const stay = <span className="shrink-0 text-xs font-medium tabular-nums text-brand-muted">{formatStayMinutes(tile.minutesOpen)}</span>;
    if (tab) {
      return (
        <>
          {/* Wraps rather than clips: a large bill plus a long stay does not fit
              one line of a 2-per-row phone tile, and money is never truncated. */}
          <span className="mt-1 flex min-h-7 flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-xl font-bold leading-7 tabular-nums text-brand-ink">{inr(tab.total)}</span>
            {stay}
          </span>
          <span className={META_LINE}>
            {tile.itemCount} {tile.itemCount === 1 ? "item" : "items"} · {tab.customerName || "Walk-in"}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="mt-1 flex min-h-7 items-center justify-between gap-2">
          {tile.tabsKnown ? (
            <span className="text-sm font-medium text-brand-ink">No open bill</span>
          ) : tabsFailed ? (
            <span className="text-sm text-brand-muted">Bill not loaded</span>
          ) : (
            <Skeleton className="h-5 w-16" />
          )}
          {/* The stay time comes from the open bill, so a tile without one shows none. */}
          {tile.tabsKnown ? null : stay}
        </span>
        <span className={META_LINE}>{tile.tabsKnown ? "Tap to free this table" : ""}</span>
      </>
    );
  }
  if (table.status === "Reserved") {
    // Who the table is held for leads; when, and how many it seats, follow.
    const { reservation } = tile;
    return (
      <>
        <span className="mt-1 block min-h-7 truncate text-sm font-medium leading-7 text-brand-ink">
          {reservation ? reservation.name : "Held"}
        </span>
        <span className={META_LINE}>
          {reservation ? `${formatTime(reservation.time)} · ${table.capacity} seats` : `${table.capacity} seats`}
        </span>
      </>
    );
  }
  const charge = tableChargeOf(table);
  return (
    <>
      <span className="mt-1 block min-h-7 text-sm leading-7 text-brand-muted">{table.capacity} seats</span>
      <span className={META_LINE}>
        {tab ? `Open bill · ${inr(tab.total)}` : charge.amount > 0 ? `${charge.label} ${inr(charge.amount)}` : ""}
      </span>
    </>
  );
}

// One table on the live floor: the whole tile is the primary tap target (a link
// to New Order, or a button that opens a confirm), and the ⋯ menu is a sibling.
export function FloorTile({ tile, busy, tabsFailed, onTap, onMenu }: FloorTileProps) {
  const { table, primary, menu } = tile;
  const meta = TABLE_STATUS_META[table.status];
  const actionLabel = FLOOR_PRIMARY_LABEL[primary];
  const hasMenu = menu.length > 0;

  const content = (
    <>
      <span className={cn("flex min-w-0 items-center gap-2", hasMenu && "pr-8")}>
        <span className="min-w-0 truncate text-base font-bold leading-6 text-brand-ink" title={table.tableNo}>
          {table.tableNo}
        </span>
        {tile.longStay && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold", meta.textClass)}>
            <Clock className="h-3 w-3" aria-hidden /> Long stay
          </span>
        )}
      </span>
      <TileDetails tile={tile} tabsFailed={tabsFailed} />
      {/* Wraps rather than clips: on a 360 px phone "Available" + "New order ›" is 3 px wider than the tile (measured),
          and the status word is the tile's only text signal — so the action drops to its own line, still on the right. */}
      <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 pt-2">
        <span className={cn("min-w-0 truncate text-xs font-semibold", meta.textClass)}>{meta.label}</span>
        <span className={cn("ml-auto inline-flex shrink-0 items-center text-xs font-medium", primary === "free" ? "text-brand-danger" : "text-brand-ink")}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
          {actionLabel}
          {actionLabel && !busy && <ChevronRight className="h-3.5 w-3.5 text-brand-muted" aria-hidden />}
        </span>
      </span>
    </>
  );

  const className = cn(TILE_CLASS, meta.tileClass, busy && "opacity-70");
  let surface: ReactNode;
  // While this table's own write (or its open-bill check) runs, the tile is not
  // a target at all: a tap would race the write (e.g. hand a table that is
  // being reserved to New Order, which would then refuse it).
  if (busy) {
    surface = (
      <div aria-busy className={className}>
        {content}
      </div>
    );
  } else if (primary === "open" || primary === "new-order") {
    surface = (
      <Link href={FLOOR_POS_PATH} prefetch={false} onClick={(e) => offerOnPlainClick(e, table.tableNo)} className={cn(className, TAPPABLE_CLASS)}>
        {content}
      </Link>
    );
  } else if (primary === "seat-now" || primary === "free") {
    surface = (
      <button type="button" onClick={() => onTap(tile)} className={cn(className, TAPPABLE_CLASS)}>
        {content}
      </button>
    );
  } else {
    surface = (
      <div className={className}>
        {content}
      </div>
    );
  }

  return (
    <div className="relative">
      {surface}
      {hasMenu && (
        <FloorTileMenu tableNo={table.tableNo} actions={menu} disabled={busy} onPick={(a) => onMenu(tile, a)} />
      )}
    </div>
  );
}
