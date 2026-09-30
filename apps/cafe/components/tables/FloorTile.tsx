"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { Clock, Loader2 } from "lucide-react";

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

const TILE_CLASS =
  "relative flex h-full min-h-28 w-full flex-col overflow-hidden rounded-xl border border-brand-rule bg-brand-slip py-3 pl-4 pr-3 text-left before:absolute before:inset-y-0 before:left-0 before:w-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";
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
    const stay = <span className="shrink-0 text-xs font-semibold tabular-nums text-brand-muted">{formatStayMinutes(tile.minutesOpen)}</span>;
    if (tab) {
      return (
        <>
          {/* Wraps rather than clips: a large bill plus a long stay does not fit
              one line of a 2-per-row phone tile, and money is never truncated. */}
          <span className="mt-1.5 flex min-h-7 flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-lg font-bold tabular-nums">{inr(tab.total)}</span>
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
        <span className="mt-1.5 flex min-h-7 items-center justify-between gap-2">
          {tile.tabsKnown ? (
            <span className="text-sm text-brand-muted">No open bill</span>
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
  const charge = tableChargeOf(table);
  const reservationLine = tile.reservation ? `${tile.reservation.name} · ${formatTime(tile.reservation.time)}` : "Held";
  return (
    <>
      <span className="mt-1.5 block min-h-7 text-sm text-brand-muted">{table.capacity} seats</span>
      <span className={META_LINE}>
        {table.status === "Reserved"
          ? reservationLine
          : tab
            ? `Open bill · ${inr(tab.total)}`
            : charge.amount > 0
              ? `${charge.label} ${inr(charge.amount)}`
              : ""}
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
      <span className={cn("flex min-w-0 items-center gap-2", hasMenu && "pr-10")}>
        <span className="min-w-0 truncate text-[15px] font-bold" title={table.tableNo}>
          {table.tableNo}
        </span>
        {tile.longStay && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-wash px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
            <Clock className="h-3 w-3" aria-hidden /> Long stay
          </span>
        )}
      </span>
      <TileDetails tile={tile} tabsFailed={tabsFailed} />
      <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2">
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", meta.chipClass)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} aria-hidden />
          {meta.label}
        </span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-sm font-semibold", primary === "free" ? "text-brand-danger" : "text-brand-primary")}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {actionLabel}
        </span>
      </span>
    </>
  );

  const className = cn(TILE_CLASS, meta.stripeClass, busy && "opacity-70");
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
      <Link href={FLOOR_POS_PATH} prefetch={false} onClick={(e) => offerOnPlainClick(e, table.tableNo)} className={className}>
        {content}
      </Link>
    );
  } else if (primary === "seat-now" || primary === "free") {
    surface = (
      <button type="button" onClick={() => onTap(tile)} className={className}>
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
