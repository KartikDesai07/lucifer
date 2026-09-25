"use client";

import { useEffect, useState } from "react";
import { ChefHat } from "lucide-react";
import { toast } from "sonner";

import { useKitchenBoard, useTickKitchenLine } from "@/hooks/use-kitchen";
import { useKitchenRealtime } from "@/hooks/use-realtime";
import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import type { KitchenRow } from "@/lib/kitchen-board";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { KitchenLineCard } from "@/components/kitchen/KitchenLineCard";
import { KitchenFreshnessChip } from "@/components/kitchen/KitchenFreshnessChip";

// P4-A — the "Kitchen" line board. Deliberately open to both roles — staff
// and admin both work the kitchen, and nothing on this screen reads or
// writes money (plan §5's RBAC note — requireAuth() only, on both API verbs)
// — so this page renders with no admin-only wrapper around it.
const SKELETON_ROWS = 6;

export default function KitchenPage() {
  const board = useKitchenBoard();
  const tick = useTickKitchenLine();
  // Socket slice 1 — the board's ONE realtime connection (this page is the
  // single mount, the same discipline PosPulseProvider documents). It only
  // refetches the board EARLY; the 10s poll above is untouched and remains
  // the fallback and the source of truth if the socket is off or down.
  useKitchenRealtime();
  // The age clock is its OWN interval, deliberately decoupled from the 10s
  // data poll: a quiet board still has to age its lines, and re-deriving
  // `now` per render would leave ages frozen between polls while repainting
  // them needlessly during a burst of ticks. One repaint per tick window is
  // all a minute-resolution age can show (the freshness chip owns the same
  // cadence for its own label).
  // Row ids with a tick in flight (see handleToggle — per-row, never global).
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), KITCHEN_FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const rows = board.data?.rows ?? [];
  const tabCount = board.data?.tabCount ?? 0;
  const hasRows = rows.length > 0;

  // A ticked line LEAVES the board, so the checkbox it was ticked with is
  // gone too — without this there is no way back from a mis-tap on a busy
  // pass, and the kitchen would have to work off the printed ticket. The
  // API already accepts `done:false`, so the undo is the same call inverted.
  // Offered as a toast action rather than a "Done" drawer: the deferred
  // drawer is the plan's Q3, and a mis-tap needs recovery NOW, not a screen.
  // Per-ROW, not one shared `tick.isPending`: a cook finishing three dishes
  // taps three boxes in a row, and a single shared flag would disable the
  // other two mid-flight and DROP those taps silently (no mutation is created,
  // so not even the error toast fires). Only the row actually in flight is
  // disabled — and it is optimistically removed anyway, so this is a guard
  // against a double-tap on the SAME line, nothing wider.
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kitchen"
        description="Every fired line, oldest first. Tick a line off once it's cooked."
        actions={<KitchenFreshnessChip dataUpdatedAt={board.dataUpdatedAt} />}
      />

      <div className="text-sm text-muted-foreground">
        {tabCount} open {tabCount === 1 ? "tab" : "tabs"} · {rows.length} {rows.length === 1 ? "line" : "lines"}
      </div>

      {board.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : board.isError ? (
        <p className="text-sm text-destructive">Failed to load the kitchen board. Refresh to retry.</p>
      ) : !hasRows ? (
        <EmptyState
          icon={<ChefHat className="h-8 w-8" />}
          title="All caught up"
          description="Fired items appear here the moment a round is sent to the kitchen."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <KitchenLineCard
              key={row.id}
              row={row}
              now={now}
              onToggle={handleToggle}
              pending={inFlight.has(row.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
