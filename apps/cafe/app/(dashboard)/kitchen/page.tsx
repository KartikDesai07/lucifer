"use client";

import { useEffect, useState } from "react";
import { ChefHat } from "lucide-react";
import { toast } from "sonner";

import { useKitchenBoard, useTickKitchenLine, useMarkOrderReady } from "@/hooks/use-kitchen";
import { useKitchenRealtime } from "@/hooks/use-realtime";
import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import type { KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { KitchenOrderCard } from "@/components/kitchen/KitchenOrderCard";
import { KitchenFreshnessChip } from "@/components/kitchen/KitchenFreshnessChip";

// P4-A/B — the "Kitchen" order-card board. Deliberately open to both roles —
// staff and admin both work the kitchen, and nothing on this screen reads or
// writes money (plan §5's RBAC note — requireAuth() only, on both API verbs)
// — so this page renders with no admin-only wrapper around it.
const SKELETON_CARDS = 6;

export default function KitchenPage() {
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
  const hasCards = cards.length > 0;

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
      { orderId: card.orderId, ready: true },
      {
        onSettled: () =>
          setReadyInFlight((current) => {
            const next = new Set(current);
            next.delete(card.orderId);
            return next;
          }),
      },
    );
    toast(`${card.tableLabel || card.orderNo} marked ready`, {
      action: {
        label: "Undo",
        onClick: () => ready.mutate({ orderId: card.orderId, ready: false }),
      },
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kitchen"
        description="Every fired order, oldest first. Tick a line off once it's cooked."
        actions={<KitchenFreshnessChip dataUpdatedAt={board.dataUpdatedAt} />}
      />

      <div className="text-sm text-muted-foreground">
        {tabCount} open {tabCount === 1 ? "tab" : "tabs"} · {cards.length}{" "}
        {cards.length === 1 ? "order" : "orders"} · {itemCount} {itemCount === 1 ? "item" : "items"}
      </div>

      {board.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : board.isError ? (
        <p className="text-sm text-destructive">Failed to load the kitchen board. Refresh to retry.</p>
      ) : !hasCards ? (
        <EmptyState
          icon={<ChefHat className="h-8 w-8" />}
          title="All caught up"
          description="Fired orders appear here the moment a round is sent to the kitchen."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {cards.map((card) => (
            <KitchenOrderCard
              key={card.orderId}
              card={card}
              now={now}
              onToggleLine={handleToggle}
              onReady={handleReady}
              lineInFlight={(line) => inFlight.has(line.id)}
              readyInFlight={readyInFlight.has(card.orderId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
