"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updatedLabel } from "@/lib/floor-tiles";
import { TABLE_STATUS_META } from "@/lib/table-status";

interface FloorLiveIndicatorProps {
  /** Oldest data timestamp across the floor's queries; 0 = never loaded. */
  updatedAtMs: number;
  /** null until the client clock exists. */
  nowMs: number | null;
  /** A background refresh failed (the grid keeps its last data). */
  refreshFailed: boolean;
  onRetry: () => void;
}

// "Live · updated just now" with a green dot — or, when a background refresh
// failed, a plain notice plus a 44 px Try again. The grid never blanks on a
// failed poll; this line is where the failure shows.
export function FloorLiveIndicator({ updatedAtMs, nowMs, refreshFailed, onRetry }: FloorLiveIndicatorProps) {
  if (refreshFailed) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-brand-danger">
        Couldn&apos;t refresh
        <Button type="button" variant="outline" className="min-h-11 min-w-11" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (updatedAtMs <= 0) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-brand-muted">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TABLE_STATUS_META.Available.dotClass)} aria-hidden />
      {updatedLabel(updatedAtMs, nowMs ?? updatedAtMs)}
    </p>
  );
}
