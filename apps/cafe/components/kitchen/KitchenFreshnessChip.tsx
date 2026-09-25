"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import { KITCHEN_STALE_MS } from "@/lib/kitchen-board";
import { CAFE_TIMEZONE } from "@/lib/constants";

interface KitchenFreshnessChipProps {
  dataUpdatedAt: number;
}

function fmtSyncedAt(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

// P4-A — "last synced" chip for the kitchen wall display. Its OWN repaint
// clock (KITCHEN_FRESHNESS_TICK_MS, 30s), deliberately DECOUPLED from the
// board's 10-second data-poll cadence exported alongside it in
// @pos/shared/query — a wall display must not repaint this text 6x/min just
// because the underlying query happens to refetch that often.
export function KitchenFreshnessChip({ dataUpdatedAt }: KitchenFreshnessChipProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), KITCHEN_FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const ageMs = now - dataUpdatedAt;
  const stale = dataUpdatedAt > 0 && ageMs >= KITCHEN_STALE_MS;

  if (stale) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
        <WifiOff className="h-4 w-4" />
        Stale — last synced {fmtSyncedAt(dataUpdatedAt)}
      </span>
    );
  }

  const ageSec = Math.max(0, Math.floor(ageMs / 1000));
  return (
    <span className="text-sm text-muted-foreground">
      Updated {ageSec}s ago
    </span>
  );
}
