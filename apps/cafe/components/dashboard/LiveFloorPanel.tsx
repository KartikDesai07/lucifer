"use client";

import { Fragment } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { TABLE_STATUS_META } from "@/lib/table-status";
import { STATUS_CLASSES } from "@/lib/ui";
import { FLOOR_CLOCK_TICK_MS } from "@/lib/floor-tiles";
import { liveTablesModel, type LiveState } from "@/lib/dashboard/live-tables";
import { useNow } from "@/hooks/use-now";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { DashCard } from "@/components/dashboard/DashCard";
import type { Area, Order, Reservation, Table } from "@/types";

// The owner's Live tables card (values 3.6, U0 match Task 7, rulings R15 and R16): the pulsing dot, "{in use} of {all}
// in use · {reserved} reserved", the 8px status bar and its legend, then our areas as zone labels over 92px tiles.
// lib/dashboard/live-tables.ts maps our tables onto the HTML's Free / Eating / Bill printed / Reserved. Read-only,
// with one affordance kept from before: an occupied tile whose order we can resolve opens it in the page's detail
// sheet; every other tile goes to the Floor, as the HTML's "Floor →".

interface LiveFloorPanelProps {
  tables: Table[];
  orders: Order[]; // today's orders + open tabs — to open an occupied table's order
  /** Our floor areas (the persisted master); undefined while not loaded = one "Tables" zone. */
  areas?: Area[];
  /** Today's reservations: a reserved tile shows its booking's time. */
  reservations?: Reservation[];
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onSelectOrder: (order: Order) => void;
}

interface StateLook {
  /** The status bar's segment and the legend's swatch. */
  mark: string;
  /** The tile's surface and border. */
  tile: string;
  dot: string;
  /** Line 2's colour. */
  line: string;
}

/** The HTML's state table (values 3.6). Eating and Reserved are the shared vocabulary's tint and ink; the free tile is
 *  the plain surface with a text-3 line; Bill printed is the theme's bill set (STATUS_CLASSES). */
const LOOK: Record<LiveState, StateLook> = {
  free: { mark: TABLE_STATUS_META.Available.dotClass, tile: "border-border bg-card", dot: TABLE_STATUS_META.Available.dotClass, line: "text-subtle-foreground" },
  eating: {
    mark: TABLE_STATUS_META.Occupied.dotClass,
    tile: TABLE_STATUS_META.Occupied.tileClass,
    dot: TABLE_STATUS_META.Occupied.dotClass,
    line: TABLE_STATUS_META.Occupied.textClass,
  },
  billed: {
    mark: STATUS_CLASSES.bill.dot,
    tile: `${STATUS_CLASSES.bill.border} ${STATUS_CLASSES.bill.tint}`,
    dot: STATUS_CLASSES.bill.dot,
    line: STATUS_CLASSES.bill.ink,
  },
  reserved: {
    mark: TABLE_STATUS_META.Reserved.dotClass,
    tile: TABLE_STATUS_META.Reserved.tileClass,
    dot: TABLE_STATUS_META.Reserved.dotClass,
    line: TABLE_STATUS_META.Reserved.textClass,
  },
};

// The bar, the legend, one zone label and one row of tiles: what the skeleton and the empty state hold.
const TABLES_BODY_PX = 8 + 10 + 16 + 16 + 14 + 7 + 52;

const TILE_CLASS = cn(
  "flex h-[52px] min-w-0 flex-col items-start gap-0.5 rounded-[9px] border px-2 py-[7px] text-left text-foreground hover:border-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
  HTML_PRESS_CLASS,
);

export function LiveFloorPanel({ tables, orders, areas, reservations, loading, isError, onRetry, onSelectOrder }: LiveFloorPanelProps) {
  const now = useNow(FLOOR_CLOCK_TICK_MS);
  const status = loading ? "loading" : isError && tables.length === 0 ? "error" : tables.length === 0 ? "empty" : "ready";
  const model = liveTablesModel({ tables, orders, areas, reservations, nowMs: now ? now.getTime() : null });

  return (
    <DashCard
      variant="dashboard"
      ui="tables-card"
      className="flex flex-col"
      title="Live tables"
      titleAdornment={
        <span data-ui="tables-live-dot" aria-hidden className={cn("size-[7px] rounded-[50%] motion-safe:animate-live-pulse", STATUS_CLASSES.ok.dot)} />
      }
      period={tables.length > 0 ? model.sub : "Right now"}
      link={{ href: "/tables", label: "Floor" }}
      status={status}
      onRetry={onRetry}
      empty={{ title: "No tables set up", description: "Add tables on the Tables screen to see who is seated here." }}
      bodyMinHeight={TABLES_BODY_PX}
    >
      <div data-ui="tables-bar" aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-[4px]">
        {model.segments.map((s) => (
          <span key={s.state} className={LOOK[s.state].mark} style={{ flex: s.n }} />
        ))}
      </div>
      <div data-ui="tables-legend" className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-muted-foreground">
        {model.segments.map((s) => (
          <span key={s.state} data-ui="tables-legend-item" className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-[2px]", LOOK[s.state].mark)} />
            <span>{s.label}</span>
            <b className="font-semibold text-foreground">{s.n}</b>
          </span>
        ))}
      </div>
      {model.zones.map((zone) => (
        <Fragment key={zone.key}>
          <div
            data-ui="tables-zone"
            className="mt-4 mb-[7px] text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground"
          >
            {zone.label}
          </div>
          <div data-ui="tables-grid" className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1.5">
            {zone.tiles.map((tile) => {
              const look = LOOK[tile.state];
              const body = (
                <>
                  <span data-ui="table-tile-name" className="flex max-w-full items-center gap-[5px] text-[12.5px] font-semibold">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-[50%]", look.dot)} />
                    <span className="truncate">{tile.table.tableNo}</span>
                  </span>
                  <span data-ui="table-tile-line" className={cn("max-w-full truncate text-[10.5px] font-medium", look.line)}>
                    {tile.line}
                  </span>
                </>
              );
              const order = tile.order;
              return order ? (
                <button
                  key={tile.table._id}
                  type="button"
                  data-ui="table-tile"
                  title={tile.title}
                  onClick={() => onSelectOrder(order)}
                  className={cn(TILE_CLASS, look.tile)}
                >
                  {body}
                </button>
              ) : (
                <Link
                  key={tile.table._id}
                  href="/tables"
                  prefetch={false}
                  data-ui="table-tile"
                  title={tile.title}
                  className={cn(TILE_CLASS, look.tile)}
                >
                  {body}
                </Link>
              );
            })}
          </div>
        </Fragment>
      ))}
    </DashCard>
  );
}
