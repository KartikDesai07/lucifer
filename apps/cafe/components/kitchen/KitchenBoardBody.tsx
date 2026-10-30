"use client";

import { useEffect, useRef } from "react";

import type { KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { KITCHEN_GRID_CLASS } from "@/lib/kitchen-layout";
import { KITCHEN_RISE_NONE, kitchenRiseOf, kitchenRiseSpent } from "@/lib/kitchen-rise";
import { KitchenBoardStates } from "@/components/kitchen/KitchenBoardStates";
import { KitchenOrderCard } from "@/components/kitchen/KitchenOrderCard";

interface KitchenBoardBodyProps {
  isLoading: boolean;
  // Loaded at least once: a failed 10s poll then keeps the cards (the refresh strip shows above the board).
  hasData: boolean;
  isError: boolean;
  // Offline and never loaded (a parked query: no data, no error) — never "All caught up".
  isPaused: boolean;
  /** Every card of the latest answer, before the header's filter (undefined before the first): the rise's record. */
  boardCards: readonly KitchenOrderCardData[] | undefined;
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
  boardCards,
  cards,
  filtered,
  now,
  onToggleLine,
  onReady,
  lineInFlight,
  readyInFlight,
  onRetry,
}: KitchenBoardBodyProps) {
  // The rise (U4 Task 4; design 6.3 Motion; lib/kitchen-rise.ts): the cards new in this answer rise, on the render that
  // shows the answer; once it is on screen the record is spent, so a filter change never rises. Read and written while
  // rendering on purpose (as U3's rise clock, rulings F15 / F17): a re-render of the same answer gets the same record.
  const rise = useRef(KITCHEN_RISE_NONE);
  rise.current = kitchenRiseOf(rise.current, boardCards);
  useEffect(() => {
    rise.current = kitchenRiseSpent(rise.current);
  }, [boardCards]);

  // One permanent wrapper around every state and the grid (U3 VC-3): WebView 109's accessibility tree dropped tiles that
  // a filter round trip or a poll inserted into a container that stayed, until the Floor's lists sat in permanent
  // wrappers. A plain block: the layout is the board's as before.
  return (
    <div data-ui="kitchen-cards">
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
              rise={rise.current.rising.has(card.orderId)}
            />
          ))}
        </div>
      </KitchenBoardStates>
    </div>
  );
}
