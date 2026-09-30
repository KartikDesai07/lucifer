"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useFloorActions } from "@/hooks/use-floor-actions";
import { useNow } from "@/hooks/use-now";
import { useOrders, OPEN_TABS_QUERY_OPTIONS } from "@/hooks/use-orders";
import { useReservations } from "@/hooks/use-reservations";
import { useSettings } from "@/hooks/use-settings";
import { useTables } from "@/hooks/use-tables";
import {
  FLOOR_CLOCK_TICK_MS,
  FLOOR_GRID_CLASS,
  buildFloorTiles,
  emptyFilterText,
  filterTiles,
  floorSummaryText,
  statusCounts,
  type FloorFilter,
} from "@/lib/floor-tiles";
import { OPEN_TABS_FILTERS } from "@/lib/table-pick";
import { TABLES_SETUP_PATH } from "@/lib/table-sections";
import { longStayMinutesOf } from "@/lib/table-status";
import { cafeDateString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { FloorDialogs } from "@/components/tables/FloorDialogs";
import { FloorLiveIndicator } from "@/components/tables/FloorLiveIndicator";
import { FloorStatusChips } from "@/components/tables/FloorStatusChips";
import { FloorTile } from "@/components/tables/FloorTile";

// Loading shape only: a cafe's real table count is dynamic.
const SKELETON_TILES = 8;
const SKELETON_TILE_CLASS = "h-28 w-full rounded-xl";

export default function TablesPage() {
  return (
    <MenuPageShell>
      <FloorContent />
    </MenuPageShell>
  );
}

function FloorSkeleton() {
  return (
    <div className={FLOOR_GRID_CLASS} aria-hidden>
      {Array.from({ length: SKELETON_TILES }).map((_, i) => (
        <Skeleton key={i} className={SKELETON_TILE_CLASS} />
      ))}
    </div>
  );
}

// The ONLY role-dependent part of the Floor: every tile action is a staff
// action, so admins and staff see identical tiles. Waits for the session so
// the copy never flips from the staff wording to the admin one.
function FloorEmptyState() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  if (authLoading) return <FloorSkeleton />;
  return (
    <EmptyState
      icon={<LayoutGrid className="h-8 w-8" />}
      title={isAdmin ? "No tables yet" : "Floor plan not set up"}
      description={
        isAdmin
          ? "Add your tables on the Setup page to see them here."
          : "Ask an admin to add tables on the Setup page."
      }
      action={
        isAdmin ? (
          <Button asChild className="mt-2">
            <Link href={TABLES_SETUP_PATH} prefetch={false}>
              Open Setup
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}

function FloorContent() {
  const tables = useTables();
  const openTabs = useOrders(OPEN_TABS_FILTERS, OPEN_TABS_QUERY_OPTIONS);
  const reservations = useReservations({ date: cafeDateString() });
  const settings = useSettings();
  const now = useNow(FLOOR_CLOCK_TICK_MS);
  const actions = useFloorActions(openTabs);
  const [filter, setFilter] = useState<FloorFilter>("all");

  const nowMs = now?.getTime() ?? null;
  const longStayMinutes = longStayMinutesOf(settings.data);
  // R17: the display keys on "the bills have loaded at least once", so a failed
  // background poll keeps the amounts on screen. Only Free / Seat now re-read.
  const tabsKnown = openTabs.data !== undefined;
  const tabsFailed = openTabs.isError && !tabsKnown;

  const tiles = useMemo(
    () =>
      buildFloorTiles({
        tables: tables.data ?? [],
        tabs: openTabs.data,
        reservations: reservations.data,
        nowMs,
        longStayMinutes,
      }),
    [tables.data, openTabs.data, reservations.data, nowMs, longStayMinutes],
  );

  const retryAll = () => {
    void tables.refetch();
    void openTabs.refetch();
  };

  // A full error screen only when there is nothing to keep showing: with a
  // list already loaded the grid stays and the indicator carries the failure.
  if (tables.isError && tables.data === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Tables" title="Floor" />
        <ErrorState
          title="Couldn't load the floor"
          description="Check the internet connection, then try again."
          onRetry={retryAll}
          retryLabel="Try again"
        />
      </div>
    );
  }

  const list = tables.data;
  const visible = filterTiles(tiles, filter);
  const stamps = [tables.dataUpdatedAt, openTabs.dataUpdatedAt].filter((at) => at > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Tables"
        title="Floor"
        description={list ? floorSummaryText(tiles, tabsKnown) : "Loading tables…"}
      />

      {list !== undefined && list.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <FloorStatusChips counts={statusCounts(list)} value={filter} onChange={setFilter} />
          <FloorLiveIndicator
            updatedAtMs={stamps.length > 0 ? Math.min(...stamps) : 0}
            nowMs={nowMs}
            refreshFailed={tables.isError || openTabs.isError}
            onRetry={retryAll}
          />
        </div>
      )}

      {list === undefined ? (
        <FloorSkeleton />
      ) : list.length === 0 ? (
        <FloorEmptyState />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-8 w-8" />}
          title={filter === "all" ? "No tables" : emptyFilterText(filter)}
          action={
            <Button type="button" variant="outline" className="mt-2" onClick={() => setFilter("all")}>
              Show all tables
            </Button>
          }
        />
      ) : (
        <div className={FLOOR_GRID_CLASS}>
          {visible.map((tile) => (
            <FloorTile
              key={tile.table._id}
              tile={tile}
              busy={actions.isBusy(tile.table.tableNo)}
              tabsFailed={tabsFailed}
              onTap={actions.tapPrimary}
              onMenu={(t, action) => actions.pickMenu(t.table, action)}
            />
          ))}
        </div>
      )}

      <FloorDialogs
        dialog={actions.dialog}
        busy={actions.dialog !== null && actions.isBusy(actions.dialog.table.tableNo)}
        onConfirm={actions.confirm}
        onOpenChange={actions.onDialogOpenChange}
      />
    </div>
  );
}
