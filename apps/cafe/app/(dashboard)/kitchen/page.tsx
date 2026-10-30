"use client";

import { useEffect, useState } from "react";

import { useKitchenBoard } from "@/hooks/use-kitchen";
import { useKitchenActions } from "@/hooks/use-kitchen-actions";
import { useKitchenRealtime } from "@/hooks/use-realtime";
import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import { KITCHEN_BOARD_CLASS, KITCHEN_PAGE_CLASS } from "@/lib/kitchen-layout";
import { PageHeader } from "@/components/shared/PageHeader";
import { KitchenBoardBody } from "@/components/kitchen/KitchenBoardBody";
import { KitchenFreshnessChip } from "@/components/kitchen/KitchenFreshnessChip";
import { NowServingLink } from "@/components/now-serving/NowServingLink";

// P4-A/B — the "Kitchen" order-card board. Deliberately open to both roles —
// staff and admin both work the kitchen, and nothing on this screen reads or
// writes money (plan §5's RBAC note — requireAuth() only, on both API verbs)
// — so this page renders with no admin-only wrapper around it.
export default function KitchenPage() {
  return <KitchenBoard />;
}

// The page's frame (U4 Task 1; the Kitchen values 1.1, 6.1, design 5): under the shell header the page fills the screen
// (the paper frame with its 1440px cap goes; a wall display still gets more cards per row, KITCHEN_GRID_CLASS) and never
// scrolls itself; its board is the only scroller and holds every branch of the body. The refresh strip (Task 2) will be
// the page's first child, above the board.
function KitchenBoard() {
  const board = useKitchenBoard();
  // The tick / Ready writes, their toasts and their per-id in-flight sets (moved out of this page, U4 Task 1).
  const actions = useKitchenActions();
  // Socket slice 1 — the board's ONE realtime connection (this page is the
  // single mount, the same discipline PosPulseProvider documents). It only
  // refetches the board EARLY; the 10s poll above is untouched and remains
  // the fallback and the source of truth if the socket is off or down.
  useKitchenRealtime();
  // The age clock is its OWN interval, decoupled from the 10s data poll — a
  // quiet board still has to age its lines (the freshness chip owns the same
  // cadence for its own label).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), KITCHEN_FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const cards = board.data?.cards ?? [];
  const tabCount = board.data?.tabCount ?? 0;
  const itemCount = cards.reduce((sum, card) => sum + card.totalCount, 0);

  return (
    <div data-ui="kitchen-page" className={KITCHEN_PAGE_CLASS}>
      <div data-ui="kitchen-board" className={KITCHEN_BOARD_CLASS}>
        <PageHeader
          eyebrow="Service"
          title="Kitchen"
          description="Every fired order, oldest first. Tick a line off once it's cooked."
          actions={<NowServingLink variant="button"><KitchenFreshnessChip dataUpdatedAt={board.dataUpdatedAt} /></NowServingLink>}
        />

        {/* Counts only once the board has loaded (a 0/0/0 line under the skeleton
            or an error would read as an empty kitchen); while it loads the line
            holds its place so the cards do not jump down when they land (CLS).
            Inside the board above the grid until Task 2 moves the counts into the
            header's second line. */}
        {board.data !== undefined ? (
          <div className="pb-2.5 text-sm text-muted-foreground">
            {tabCount} open {tabCount === 1 ? "tab" : "tabs"} · {cards.length}{" "}
            {cards.length === 1 ? "order" : "orders"} · {itemCount} {itemCount === 1 ? "item" : "items"}
          </div>
        ) : board.isLoading ? (
          <div className="pb-2.5 text-sm text-muted-foreground">Loading orders…</div>
        ) : null}

        <KitchenBoardBody
          isLoading={board.isLoading}
          hasData={board.data !== undefined}
          isError={board.isError}
          isPaused={board.isPaused}
          cards={cards}
          now={now}
          onToggleLine={actions.onToggleLine}
          onReady={actions.onReady}
          lineInFlight={actions.lineInFlight}
          readyInFlight={actions.readyInFlight}
          onRetry={() => void board.refetch()}
        />
      </div>
    </div>
  );
}
