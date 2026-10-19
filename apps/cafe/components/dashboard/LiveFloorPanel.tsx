"use client";

import { Fragment } from "react";
import Link from "next/link";

import { cn, formatTime, inr } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import { TABLE_STATUS_META } from "@/lib/table-status";
import { FLOOR_CLOCK_TICK_MS, minutesOpen, reservationForTable } from "@/lib/floor-tiles";
import { NO_AREA_KEY, groupTablesByArea } from "@/lib/table-areas";
import { useNow } from "@/hooks/use-now";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { DashCard } from "@/components/dashboard/DashCard";
import type { Area, Order, Reservation, Table } from "@/types";

// The owner's Live tables card (values 3.6, U0 match Task 7, ruling R15): the pulsing dot, "{in use} of {all} in use ·
// {reserved} reserved", the 8px status bar and its legend, then our areas as zone labels over 92px tiles. Our three
// table states take the HTML's: Free = Available, Eating = Occupied, Reserved = Reserved. We have no "Bill printed" or
// "KOT pending" table state, so that segment and legend item are left out. Read-only, with one affordance kept from
// before: an occupied tile whose order we can resolve opens it in the page's detail sheet; every other tile goes to the
// Floor, as the HTML's "Floor →".

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

/** The HTML's legend words for our states, in its order (Free, Eating, [Bill printed,] Reserved). */
export const LIVE_TABLE_LEGEND: ReadonlyArray<{ status: TableStatus; label: string }> = [
  { status: "Available", label: "Free" },
  { status: "Occupied", label: "Eating" },
  { status: "Reserved", label: "Reserved" },
];
/** The zone label for tables in no area (or an area this device does not hold). */
export const NO_AREA_ZONE_LABEL = "Tables";

/** A tile's look per state (values 3.6 table): the tile, its dot and its second line. Eating and Reserved are the
 *  shared vocabulary's tint and ink; the HTML's free tile is the plain surface with a text-3 line. */
function tileLook(status: TableStatus): { tile: string; dot: string; line: string } {
  const meta = TABLE_STATUS_META[status];
  if (status === "Available") return { tile: "border-border bg-card", dot: meta.dotClass, line: "text-subtle-foreground" };
  return { tile: meta.tileClass, dot: meta.dotClass, line: meta.textClass };
}

export interface LiveTile {
  table: Table;
  /** Line 2: "{seats} seats", "₹{bill} · {minutes}m", the booking's time, or the state's word. */
  line: string;
  /** The HTML's tile title: "{name} · {seats} seats · {status}". */
  title: string;
  /** An occupied table's order, when we can resolve it (a tap opens it). */
  order?: Order;
}

export interface LiveTablesModel {
  sub: string;
  segments: Array<{ status: TableStatus; label: string; n: number }>;
  zones: Array<{ key: string; label: string; tiles: LiveTile[] }>;
}

export function liveTablesModel(input: {
  tables: readonly Table[];
  orders: readonly Order[];
  areas: readonly Area[] | undefined;
  reservations: readonly Reservation[] | undefined;
  nowMs: number | null;
}): LiveTablesModel {
  const { tables, areas, reservations, nowMs } = input;
  const ordersById = new Map(input.orders.map((o) => [o.orderId, o]));
  const count = (status: TableStatus) => tables.filter((t) => t.status === status).length;
  const segments = LIVE_TABLE_LEGEND.map((s) => ({ ...s, n: count(s.status) }));
  const inUse = count("Occupied");

  const tileOf = (table: Table): LiveTile => {
    const order = table.status === "Occupied" && table.currentOrderId ? ordersById.get(table.currentOrderId) : undefined;
    let line = `${table.capacity} seats`;
    if (table.status === "Occupied") {
      // Only a running bill has an amount and a stay; a settled order (a Pay Now sale) still opens, but says Occupied.
      const running = order?.status === "Pending" ? order : undefined;
      const minutes = running && nowMs !== null ? minutesOpen(running.createdAt, nowMs) : null;
      line = running ? (minutes === null ? inr(running.total) : `${inr(running.total)} · ${minutes}m`) : "Occupied";
    } else if (table.status === "Reserved") {
      const booking = reservationForTable(table.tableNo, reservations);
      line = booking ? formatTime(booking.time) : "Reserved";
    }
    return {
      table,
      line,
      title: `${table.tableNo} · ${table.capacity} seats · ${TABLE_STATUS_META[table.status].label}`,
      order,
    };
  };

  return {
    sub: `${inUse} of ${tables.length} in use · ${count("Reserved")} reserved`,
    segments,
    zones: groupTablesByArea(tables, areas).map((g) => ({
      key: g.key,
      label: g.key === NO_AREA_KEY ? NO_AREA_ZONE_LABEL : g.name,
      tiles: g.items.map(tileOf),
    })),
  };
}

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
  const seg = (s: TableStatus) => TABLE_STATUS_META[s].dotClass;

  return (
    <DashCard
      variant="dashboard"
      ui="tables-card"
      className="flex flex-col"
      title="Live tables"
      titleAdornment={
        <span data-ui="tables-live-dot" aria-hidden className="size-[7px] rounded-[50%] bg-status-ok motion-safe:animate-live-pulse" />
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
          <span key={s.status} className={seg(s.status)} style={{ flex: s.n }} />
        ))}
      </div>
      <div data-ui="tables-legend" className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-muted-foreground">
        {model.segments.map((s) => (
          <span key={s.status} data-ui="tables-legend-item" className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-[2px]", seg(s.status))} />
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
              const look = tileLook(tile.table.status);
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
