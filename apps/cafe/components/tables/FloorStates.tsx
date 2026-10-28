"use client";

import Link from "next/link";

import { useAuth } from "@/hooks/use-auth";
import {
  FLOOR_EMPTY_ACCENT_BUTTON_CLASS,
  FLOOR_EMPTY_CLASS,
  FLOOR_EMPTY_OUTLINE_BUTTON_CLASS,
  FLOOR_EMPTY_TITLE_CLASS,
  FLOOR_SKELETON_TILE_CLASS,
} from "@/lib/floor-layout";
import { FLOOR_EMPTY_FILTER_TEXT, FLOOR_GRID_CLASS } from "@/lib/floor-tiles";
import { TABLES_SETUP_PATH } from "@/lib/table-sections";
import { Skeleton } from "@/components/ui/skeleton";

// The Floor's loading and empty states (U3 Task 6; design 6.7, values 5.2), out of the page so they render in tests (a
// Next page exports only its default). The HTML has none of them but the empty line: they wear its empty style
// (lib/floor-layout.ts FLOOR_EMPTY_*) with today's words; the first-load error stays the page's own ErrorState.

// Loading shape only: a cafe's real table count is dynamic. A tile's size and corner in the floor grid, so the grid does
// not jump when the tables arrive.
const SKELETON_TILES = 8;

export function FloorSkeleton() {
  return (
    <div data-ui="floor-skeleton" className={FLOOR_GRID_CLASS} aria-hidden>
      {Array.from({ length: SKELETON_TILES }).map((_, i) => (
        <Skeleton key={i} data-ui="floor-skeleton-tile" className={FLOOR_SKELETON_TILE_CLASS} />
      ))}
    </div>
  );
}

// The ONLY role-dependent part of the Floor: every tile action is a staff
// action, so admins and staff see identical tiles. Waits for the session so
// the copy never flips from the staff wording to the admin one.
export function FloorEmptyState() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  if (authLoading) return <FloorSkeleton />;
  return (
    <div data-ui="floor-empty" className={FLOOR_EMPTY_CLASS}>
      <p data-ui="floor-empty-title" className={FLOOR_EMPTY_TITLE_CLASS}>
        {isAdmin ? "No tables yet" : "Floor plan not set up"}
      </p>
      <p data-ui="floor-empty-text">
        {isAdmin ? "Add your tables on the Setup page to see them here." : "Ask an admin to add tables on the Setup page."}
      </p>
      {isAdmin && (
        <Link data-ui="floor-empty-action" href={TABLES_SETUP_PATH} prefetch={false} className={FLOOR_EMPTY_ACCENT_BUTTON_CLASS}>
          Open Setup
        </Link>
      )}
    </div>
  );
}

// The area and the pill leave nothing (values 5.2): the HTML's line, then our way back (design 6.7, as U2 kept Clear
// filters), which resets both the pill and the area (the page's showAllTables).
export function FloorFilterEmpty({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div data-ui="floor-empty" className={FLOOR_EMPTY_CLASS}>
      <p data-ui="floor-empty-text">{FLOOR_EMPTY_FILTER_TEXT}</p>
      <button data-ui="floor-empty-action" type="button" onClick={onShowAll} className={FLOOR_EMPTY_OUTLINE_BUTTON_CLASS}>
        Show all tables
      </button>
    </div>
  );
}
