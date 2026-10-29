"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { useFloorActions } from "@/hooks/use-floor-actions";
import { useNow } from "@/hooks/use-now";
import { useOrders, OPEN_TABS_QUERY_OPTIONS } from "@/hooks/use-orders";
import { useReservations } from "@/hooks/use-reservations";
import { useSettings } from "@/hooks/use-settings";
import { useTableAreas } from "@/hooks/use-table-areas";
import { useTables } from "@/hooks/use-tables";
import {
  FLOOR_CLOCK_TICK_MS,
  FLOOR_GRID_CLASS,
  buildFloorTiles,
  filterTiles,
  floorCounts,
  floorHeaderLine,
  floorRefreshFailed,
  type FloorFilter,
  type FloorTileModel,
} from "@/lib/floor-tiles";
import { FLOOR_ALL_AREAS, effectiveArea, floorAreaTabs, floorSections, tilesInArea } from "@/lib/floor-areas";
import { FLOOR_BODY_CLASS, FLOOR_CONTROLS_CLASS, FLOOR_PAGE_CLASS, FLOOR_SCROLLER_CLASS } from "@/lib/floor-layout";
import { riseIndexFor } from "@/lib/floor-rise";
import { OPEN_TABS_FILTERS } from "@/lib/table-pick";
import { longStayMinutesOf } from "@/lib/table-status";
import { cafeDateString } from "@/lib/utils";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { FloorAreaSections } from "@/components/tables/FloorAreaSections";
import { FloorAreaTabs } from "@/components/tables/FloorAreaTabs";
import { FloorDialogs } from "@/components/tables/FloorDialogs";
import { FloorRefreshStrip } from "@/components/tables/FloorRefreshStrip";
import { FloorEmptyState, FloorFilterEmpty, FloorSkeleton } from "@/components/tables/FloorStates";
import { FloorStatusChips } from "@/components/tables/FloorStatusChips";
import { FloorTile } from "@/components/tables/FloorTile";

export default function TablesPage() {
  return <FloorContent />;
}

// The page's frame (U3 Task 1; the Floor values 1.1, 2.1, design 5): under the shell header the page fills the screen
// (the paper frame with its 1440px cap goes) and never scrolls itself; its scroller holds the HTML's body. Every branch
// of the content renders inside it. The live floor's refresh strip (Task 5, design 6.2) is its first child, above the
// scroller, so it sits flush under the shell header (or the U0 request strip) and never scrolls away.
function FloorFrame({ children, strip }: { children: ReactNode; strip?: ReactNode }) {
  return (
    <div data-ui="floor-page" className={FLOOR_PAGE_CLASS}>
      {strip}
      <div data-ui="floor-scroller" className={FLOOR_SCROLLER_CLASS}>
        <div data-ui="floor-body" className={FLOOR_BODY_CLASS}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FloorContent() {
  const tables = useTables();
  const areas = useTableAreas(tables.data);
  const openTabs = useOrders(OPEN_TABS_FILTERS, OPEN_TABS_QUERY_OPTIONS);
  const reservations = useReservations({ date: cafeDateString() });
  const settings = useSettings();
  const now = useNow(FLOOR_CLOCK_TICK_MS);
  const actions = useFloorActions(openTabs);
  // The pill and the area tab reset on every visit (design 6.9); the area is kept as a choice, but the page shows it only
  // while it is still a group (effectiveArea below).
  const [filter, setFilter] = useState<FloorFilter>("all");
  const [area, setArea] = useState(FLOOR_ALL_AREAS);

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

  // The HTML's rise, the grid's first paint's cascade (design 6.5; values 7; ruling F15): one clock for the page, started
  // by the first render with tiles and never reset. Each tile gets its index in its section (after the filters) and the
  // clock's reading, and fixes its rise when it mounts: a tile mounted while its own rise would still run (the first
  // paint; a remount as the areas land a tick after the tables and the flat grid turns into sections, the area heal, a
  // table changing section) joins it part-way; a tile mounted after that (a tab / pill change after the cascade, a table
  // added later) appears at once, so nothing replays (values 12 #19 not copied). The clock is read once per render: the
  // tiles one render mounts commit, and start their rise, together, so they share one reading and the cascade's steps
  // stay even however long the render takes (0 on the first paint). A remount can give a table another index (re-review
  // M1), so while the cascade runs each table keeps the index of the first render it appeared in (lib/floor-rise.ts): its
  // remounted tile continues at its own point on its own curve. The record is dropped once the cascade's window passes.
  // React's Compiler and eslint-plugin-react-hooks 7's purity / refs rules would flag this render-time read and write
  // (rulings F15 / F17 accept it: idempotent under StrictMode; a discarded render only records a start a few ms early).
  const riseStart = useRef<number | null>(null);
  const firstRiseIndex = useRef(new Map<string, number>());
  const hasTiles = tiles.length > 0;
  const riseReadAt = performance.now();
  if (riseStart.current === null && hasTiles) riseStart.current = riseReadAt;
  const riseElapsedMs = riseReadAt - (riseStart.current ?? riseReadAt);

  const retryAll = () => {
    void tables.refetch();
    void openTabs.refetch();
  };

  // A full error screen only when there is nothing to keep showing: with a
  // list already loaded the grid stays and the refresh strip carries the failure.
  if (tables.isError && tables.data === undefined) {
    return (
      <FloorFrame>
        <PageHeader eyebrow="Service" title="Floor" />
        <ErrorState
          title="Couldn't load the floor"
          description="Check the internet connection, then try again."
          onRetry={retryAll}
          retryLabel="Try again"
        />
      </FloorFrame>
    );
  }

  const list = tables.data;
  // Review Focus 1: everything below reads the area shown, never the raw choice (a removed or emptied area shows All).
  const areaTabs = floorAreaTabs(tiles, areas.data);
  const shownArea = effectiveArea(area, areaTabs);
  const inArea = tilesInArea(tiles, areas.data, shownArea);
  const visible = filterTiles(inArea, filter);
  const sections = floorSections(tiles, areas.data, filter, shownArea);
  // The header's second line (design 6.2): its freshness is the older of the two reads, as today; 0 = never loaded.
  const stamps = [tables.dataUpdatedAt, openTabs.dataUpdatedAt].filter((at) => at > 0);
  const updatedAtMs = stamps.length > 0 ? Math.min(...stamps) : 0;
  const strip = <FloorRefreshStrip show={floorRefreshFailed({ tables: list, tablesError: tables.isError, tabsError: openTabs.isError })} onRetry={retryAll} />;
  const showAllTables = () => {
    setFilter("all");
    setArea(FLOOR_ALL_AREAS);
  };

  const renderTile = (tile: FloorTileModel, index: number) => (
    <FloorTile
      key={tile.table._id}
      tile={tile}
      busy={actions.isBusy(tile.table.tableNo)}
      tabsFailed={tabsFailed}
      riseIndex={riseIndexFor(firstRiseIndex.current, tile.table._id, index, riseElapsedMs)}
      riseElapsedMs={riseElapsedMs}
      onTap={actions.tapPrimary}
      onMenu={(t, action) => actions.pickMenu(t.table, action)}
    />
  );

  return (
    <FloorFrame strip={strip}>
      <PageHeader
        eyebrow="Service"
        title="Floor"
        description={list ? floorHeaderLine({ tiles, tabsKnown, updatedAtMs, nowMs }) : "Loading tables…"}
      />

      {/* The HTML's controls row (values 2.2): the area tabs left (two or more groups), the status pills right, their
          counts over the area shown (design 6.3). */}
      {list !== undefined && list.length > 0 && (
        <div data-ui="floor-controls" className={FLOOR_CONTROLS_CLASS}>
          {areaTabs.length > 0 && <FloorAreaTabs tabs={areaTabs} value={shownArea} onChange={setArea} />}
          <FloorStatusChips counts={floorCounts(inArea)} value={filter} revealKey={shownArea} onChange={setFilter} />
        </div>
      )}

      {list === undefined ? (
        <FloorSkeleton />
      ) : list.length === 0 ? (
        <FloorEmptyState />
      ) : visible.length === 0 ? (
        <FloorFilterEmpty onShowAll={showAllTables} />
      ) : sections.showHeadings ? (
        <FloorAreaSections groups={sections.groups} renderTile={renderTile} />
      ) : (
        <div className={FLOOR_GRID_CLASS}>{visible.map((tile, index) => renderTile(tile, index))}</div>
      )}

      <FloorDialogs
        dialog={actions.dialog}
        busy={actions.dialog !== null && actions.isBusy(actions.dialog.table.tableNo)}
        onConfirm={actions.confirm}
        onOpenChange={actions.onDialogOpenChange}
      />
    </FloorFrame>
  );
}
