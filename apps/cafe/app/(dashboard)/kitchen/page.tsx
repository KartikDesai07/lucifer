"use client";

import { useEffect, useState } from "react";

import { useKitchenBoard } from "@/hooks/use-kitchen";
import { useKitchenActions } from "@/hooks/use-kitchen-actions";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useKitchenRealtime } from "@/hooks/use-realtime";
import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import { filterCards, kitchenHeaderLine, kitchenStale, type KitchenFilter } from "@/lib/kitchen-header";
import { KITCHEN_BOARD_CLASS, KITCHEN_PAGE_CLASS } from "@/lib/kitchen-layout";
import { PageHeader } from "@/components/shared/PageHeader";
import { RefreshStrip } from "@/components/shared/RefreshStrip";
import { KitchenBoardBody } from "@/components/kitchen/KitchenBoardBody";
import { KitchenTypeFilter } from "@/components/kitchen/KitchenTypeFilter";
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
// scrolls itself. Its first child is the refresh strip (Task 2, design 6.2: flush under the header, never scrolling away),
// then the board, the only scroller, holding every branch of the body.
function KitchenBoard() {
  const board = useKitchenBoard();
  // The tick / Ready writes, their toasts and their per-id in-flight sets (moved out of this page, U4 Task 1).
  const actions = useKitchenActions();
  // Socket slice 1 — the board's ONE realtime connection (this page is the
  // single mount, the same discipline PosPulseProvider documents). It only
  // refetches the board EARLY; the 10s poll above is untouched and remains
  // the fallback and the source of truth if the socket is off or down.
  useKitchenRealtime();
  // The page's clock is its OWN 30s interval, decoupled from the 10s data poll — a quiet board still has to age its
  // cards; it also moves the header line's average and "Updated …" words and decides the refresh strip (design 6.2).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), KITCHEN_FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  // The header's type filter (owner Q2, design 6.1): client-side, reset on every visit. Its control is not drawn below
  // 720px (the HTML's), and there the board shows All whatever was chosen, so a filter picked at 820px and then rotated
  // never hides cards with no control to undo it (values 10 #5, not copied).
  const [filter, setFilter] = useState<KitchenFilter>("all");
  const wide = useMediaQuery("(min-width: 720px)");

  const allCards = board.data?.cards ?? [];
  const cards = filterCards(allCards, wide ? filter : "all");
  const nowMs = now.getTime();

  // The header's second line (owner Q3): the cards shown, their average wait and the freshness once loaded; today's
  // loading words before the first answer; nothing on the first-load error and offline branches.
  return (
    <div data-ui="kitchen-page" className={KITCHEN_PAGE_CLASS}>
      <RefreshStrip
        ui="kitchen"
        show={kitchenStale(board.dataUpdatedAt, nowMs)}
        message="Couldn't refresh the kitchen board. Showing the last update."
        onRetry={() => void board.refetch()}
      />
      <div data-ui="kitchen-board" className={KITCHEN_BOARD_CLASS}>
        <PageHeader
          eyebrow="Service"
          title="Kitchen"
          description={board.data !== undefined ? kitchenHeaderLine({ cards, updatedAtMs: board.dataUpdatedAt, nowMs }) : board.isLoading ? "Loading orders…" : undefined}
          actions={<><KitchenTypeFilter value={filter} onChange={setFilter} /><NowServingLink variant="button" /></>}
        />

        <KitchenBoardBody
          isLoading={board.isLoading}
          hasData={board.data !== undefined}
          isError={board.isError}
          isPaused={board.isPaused}
          boardCards={board.data?.cards}
          cards={cards}
          filtered={cards.length < allCards.length}
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
