"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useKitchenBoard, useTickKitchenLine, useMarkOrderReady } from "@/hooks/use-kitchen";
import { useKitchenRealtime } from "@/hooks/use-realtime";
import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import type { KitchenRow } from "@/lib/kitchen-board";
import {
  readyToastMessage,
  type KitchenOrderCard as KitchenOrderCardData,
} from "@/lib/kitchen-cards";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { KitchenBoardBody } from "@/components/kitchen/KitchenBoardBody";
import { KitchenFreshnessChip } from "@/components/kitchen/KitchenFreshnessChip";
import { NowServingLink } from "@/components/now-serving/NowServingLink";

// P4-A/B — the "Kitchen" order-card board. Deliberately open to both roles —
// staff and admin both work the kitchen, and nothing on this screen reads or
// writes money (plan §5's RBAC note — requireAuth() only, on both API verbs)
// — so this page renders with no admin-only wrapper around it.
// `wide`: a wall display must not lose order cards per row to the 1440px cap.
export default function KitchenPage() {
  return (
    <MenuPageShell wide>
      <KitchenBoard />
    </MenuPageShell>
  );
}

function KitchenBoard() {
  const board = useKitchenBoard();
  const tick = useTickKitchenLine();
  const ready = useMarkOrderReady();
  // Socket slice 1 — the board's ONE realtime connection (this page is the
  // single mount, the same discipline PosPulseProvider documents). It only
  // refetches the board EARLY; the 10s poll above is untouched and remains
  // the fallback and the source of truth if the socket is off or down.
  useKitchenRealtime();
  // The age clock is its OWN interval, decoupled from the 10s data poll — a
  // quiet board still has to age its lines (the freshness chip owns the same
  // cadence for its own label).
  // Row ids with a tick in flight (see handleToggle — per-row, never global).
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  // Order ids with a Ready tap in flight — its OWN set, so a cook clearing
  // one card never disables the Ready button on another.
  const [readyInFlight, setReadyInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), KITCHEN_FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const cards = board.data?.cards ?? [];
  const tabCount = board.data?.tabCount ?? 0;
  const itemCount = cards.reduce((sum, card) => sum + card.totalCount, 0);

  // A ticked line STAYS on the board (only the Ready tap removes a card), so
  // the checkbox can simply flip back — the API already accepts `done:false`.
  // Per-ROW, not one shared `tick.isPending`: a cook ticking several boxes in
  // a row must not have the others silently disabled mid-flight.
  const handleToggle = (row: KitchenRow, done: boolean) => {
    if (inFlight.has(row.id)) return;
    setInFlight((current) => new Set(current).add(row.id));
    tick.mutate(
      { orderId: row.orderId, ref: row.ref, done },
      {
        onSettled: () =>
          setInFlight((current) => {
            const next = new Set(current);
            next.delete(row.id);
            return next;
          }),
      },
    );
    if (!done) return;
    toast(`${row.qty} × ${row.name} marked done`, {
      action: {
        label: "Undo",
        onClick: () => tick.mutate({ orderId: row.orderId, ref: row.ref, done: false }),
      },
    });
  };

  // Ready button: the ONE action that removes a card. Same per-id in-flight +
  // undo-toast discipline as the tick — clearing the wrong card must be
  // recoverable.
  const handleReady = (card: KitchenOrderCardData) => {
    if (readyInFlight.has(card.orderId)) return;
    setReadyInFlight((current) => new Set(current).add(card.orderId));
    ready.mutate(
      // seenFiredAt: what this card actually showed. See MarkOrderReadyInput —
      // it stops the stamp burying a round fired since the last refresh.
      { orderId: card.orderId, ready: true, seenFiredAt: card.newestFiredAt },
      {
        onSettled: () =>
          setReadyInFlight((current) => {
            const next = new Set(current);
            next.delete(card.orderId);
            return next;
          }),
      },
    );
    // The message distinguishes a finished card from one cleared with lines
    // still open — see readyToastMessage for why that matters now.
    toast(readyToastMessage(card), {
      action: {
        label: "Undo",
        onClick: () => ready.mutate({ orderId: card.orderId, ready: false }),
      },
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Service"
        title="Kitchen"
        description="Every fired order, oldest first. Tick a line off once it's cooked."
        actions={<NowServingLink variant="button"><KitchenFreshnessChip dataUpdatedAt={board.dataUpdatedAt} /></NowServingLink>}
      />

      {/* Counts only once the board has loaded (a 0/0/0 line under the skeleton
          or an error would read as an empty kitchen); while it loads the line
          holds its place so the cards do not jump down when they land (CLS). */}
      {board.data !== undefined ? (
        <div className="text-sm text-muted-foreground">
          {tabCount} open {tabCount === 1 ? "tab" : "tabs"} · {cards.length}{" "}
          {cards.length === 1 ? "order" : "orders"} · {itemCount} {itemCount === 1 ? "item" : "items"}
        </div>
      ) : board.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading orders…</div>
      ) : null}

      <KitchenBoardBody
        isLoading={board.isLoading}
        hasData={board.data !== undefined}
        isError={board.isError}
        isPaused={board.isPaused}
        cards={cards}
        now={now}
        onToggleLine={handleToggle}
        onReady={handleReady}
        inFlight={inFlight}
        readyInFlight={readyInFlight}
        onRetry={() => void board.refetch()}
      />
    </>
  );
}
