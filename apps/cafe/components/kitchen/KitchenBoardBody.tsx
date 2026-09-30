"use client";

import { ChefHat } from "lucide-react";

import type { KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { KitchenOrderCard } from "@/components/kitchen/KitchenOrderCard";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_CARDS = 6; // loading shape only: the real order count is dynamic
const BOARD_GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

interface KitchenBoardBodyProps {
  isLoading: boolean;
  // Loaded at least once: a failed 10s poll then keeps the cards (the chip flips to "Stale").
  hasData: boolean;
  isError: boolean;
  // Offline and never loaded (a parked query: no data, no error) — never "All caught up".
  isPaused: boolean;
  cards: KitchenOrderCardData[];
  now: Date;
  onToggleLine: (line: KitchenRow, done: boolean) => void;
  onReady: (card: KitchenOrderCardData) => void;
  // Row ids / order ids with a write in flight — owned by the page.
  inFlight: ReadonlySet<string>;
  readyInFlight: ReadonlySet<string>;
  onRetry: () => void;
}

// The board's skeleton / error / offline / empty / grid, split out of kitchen/page.tsx to keep it
// inside its line budget. Handlers, toasts, the realtime connection and in-flight sets stay there.
export function KitchenBoardBody({
  isLoading,
  hasData,
  isError,
  isPaused,
  cards,
  now,
  onToggleLine,
  onReady,
  inFlight,
  readyInFlight,
  onRetry,
}: KitchenBoardBodyProps) {
  if (isLoading) {
    return (
      <div className={BOARD_GRID_CLASS} aria-hidden>
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
    return (
      <EmptyState
        icon={<ChefHat className="h-8 w-8" />}
        title="All caught up"
        description="Fired orders appear here the moment a round is sent to the kitchen."
      />
    );
  }

  return (
    <div className={BOARD_GRID_CLASS}>
      {cards.map((card) => (
        <KitchenOrderCard
          key={card.orderId}
          card={card}
          now={now}
          onToggleLine={onToggleLine}
          onReady={onReady}
          lineInFlight={(line) => inFlight.has(line.id)}
          readyInFlight={readyInFlight.has(card.orderId)}
        />
      ))}
    </div>
  );
}
