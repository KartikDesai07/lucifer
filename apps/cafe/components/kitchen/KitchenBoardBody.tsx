"use client";

import type { KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { KITCHEN_GRID_CLASS } from "@/lib/kitchen-layout";
import { KitchenBoardStates } from "@/components/kitchen/KitchenBoardStates";
import { KitchenOrderCard } from "@/components/kitchen/KitchenOrderCard";

interface KitchenBoardBodyProps {
  isLoading: boolean;
  // Loaded at least once: a failed 10s poll then keeps the cards (the refresh strip shows above the board).
  hasData: boolean;
  isError: boolean;
  // Offline and never loaded (a parked query: no data, no error) — never "All caught up".
  isPaused: boolean;
  /** The cards shown: the board after the header's type filter. */
  cards: KitchenOrderCardData[];
  /** The type filter hides cards (the filtered-empty box when it hides them all). */
  filtered: boolean;
  now: Date;
  onToggleLine: (line: KitchenRow, done: boolean) => void;
  onReady: (card: KitchenOrderCardData) => void;
  // A row id / an order id with a write in flight — owned by useKitchenActions.
  lineInFlight: (id: string) => boolean;
  readyInFlight: (orderId: string) => boolean;
  onRetry: () => void;
}

// The board: its states (KitchenBoardStates: skeleton / error / offline / empty / filtered empty, split out in U4 Task 2,
// ruling K1) or the cards' grid. Handlers, toasts and in-flight sets live in useKitchenActions; the realtime connection
// in the page.
export function KitchenBoardBody({
  isLoading,
  hasData,
  isError,
  isPaused,
  cards,
  filtered,
  now,
  onToggleLine,
  onReady,
  lineInFlight,
  readyInFlight,
  onRetry,
}: KitchenBoardBodyProps) {
  return (
    <KitchenBoardStates isLoading={isLoading} hasData={hasData} isError={isError} isPaused={isPaused} cards={cards} filtered={filtered} onRetry={onRetry}>
      <div data-ui="kitchen-grid" className={KITCHEN_GRID_CLASS}>
        {cards.map((card) => (
          <KitchenOrderCard
            key={card.orderId}
            card={card}
            now={now}
            onToggleLine={onToggleLine}
            onReady={onReady}
            lineInFlight={(line) => lineInFlight(line.id)}
            readyInFlight={readyInFlight(card.orderId)}
          />
        ))}
      </div>
    </KitchenBoardStates>
  );
}
