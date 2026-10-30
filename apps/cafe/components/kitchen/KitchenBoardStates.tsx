"use client";

import type { ReactNode } from "react";
import { ChefHat } from "lucide-react";

import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { KITCHEN_EMPTY_FILTER_TEXT } from "@/lib/kitchen-header";
import { KITCHEN_EMPTY_BOX_CLASS, KITCHEN_GRID_CLASS } from "@/lib/kitchen-layout";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_CARDS = 6; // loading shape only: the real order count is dynamic

interface KitchenBoardStatesProps {
  isLoading: boolean;
  // Loaded at least once: a failed 10s poll then keeps the cards (the refresh strip shows above the board).
  hasData: boolean;
  isError: boolean;
  // Offline and never loaded (a parked query: no data, no error) — never "All caught up".
  isPaused: boolean;
  /** The cards shown (after the header's type filter). */
  cards: readonly KitchenOrderCardData[];
  /** The type filter hides cards (fewer shown than on the board): an empty board then reads "No orders here". */
  filtered: boolean;
  onRetry: () => void;
  /** The cards' grid, drawn when no state applies. */
  children: ReactNode;
}

// The board's states, split out of KitchenBoardBody (U4 Task 2, ruling K1) in today's branch order: the skeleton while
// loading, the error screen for a failed first load, the offline line when never loaded, then the empty board; otherwise
// the grid (children). The filtered-empty box is the HTML's empty box (values 3.6, ruling K2; design 6.5): Tables or
// Walk-In chosen with none of its cards on a board that has others — "All" is one tap away in the header.
export function KitchenBoardStates({ isLoading, hasData, isError, isPaused, cards, filtered, onRetry, children }: KitchenBoardStatesProps) {
  if (isLoading) {
    return (
      <div className={KITCHEN_GRID_CLASS} aria-hidden>
        {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError && !hasData) {
    return (
      <ErrorState
        title="Couldn't load the kitchen board"
        description="Check the internet connection, then try again."
        onRetry={onRetry}
        retryLabel="Try again"
      />
    );
  }

  if (isPaused && !hasData) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        You appear to be offline. The kitchen board will load when the connection is back.
      </p>
    );
  }

  if (cards.length === 0) {
    if (filtered) return <div data-ui="kitchen-filter-empty" className={KITCHEN_EMPTY_BOX_CLASS}>{KITCHEN_EMPTY_FILTER_TEXT}</div>;
    return (
      <EmptyState
        icon={<ChefHat className="h-8 w-8" />}
        title="All caught up"
        description="Fired orders appear here the moment a round is sent to the kitchen."
      />
    );
  }

  return <>{children}</>;
}
