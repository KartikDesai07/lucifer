"use client";

import type { ReactNode } from "react";

import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { KITCHEN_EMPTY_FILTER_TEXT } from "@/lib/kitchen-header";
import { KITCHEN_EMPTY_BOX_CLASS, KITCHEN_EMPTY_TITLE_CLASS, KITCHEN_GRID_CLASS, KITCHEN_SKELETON_CARD_CLASS } from "@/lib/kitchen-layout";
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
// the grid (children). Each sits in the board at its padding, as the cards do (design 6.5). The skeleton is six cards of
// the HTML's one-line card in the cards' own grid (one grid, one name); the empty board and the filtered-empty box are
// the HTML's empty box (values 3.6, ruling K2): "All caught up" over today's line, or "No orders here" when Tables or
// Walk-In is chosen with none of its cards on a board that has others ("All" is one tap away in the header).
export function KitchenBoardStates({ isLoading, hasData, isError, isPaused, cards, filtered, onRetry, children }: KitchenBoardStatesProps) {
  if (isLoading) {
    return (
      <div data-ui="kitchen-grid" className={KITCHEN_GRID_CLASS} aria-hidden>
        {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
          <Skeleton key={i} data-ui="kitchen-skeleton-card" className={KITCHEN_SKELETON_CARD_CLASS} />
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
      <div data-ui="kitchen-empty" className={KITCHEN_EMPTY_BOX_CLASS}>
        <p data-ui="kitchen-empty-title" className={KITCHEN_EMPTY_TITLE_CLASS}>
          All caught up
        </p>
        <p>Fired orders appear here the moment a round is sent to the kitchen.</p>
      </div>
    );
  }

  return <>{children}</>;
}
