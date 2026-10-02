"use client";

import { Button } from "@/components/ui/button";
import { updatedLabel } from "@/lib/floor-tiles";

interface FloorLiveIndicatorProps {
  /** Oldest data timestamp across the floor's queries; 0 = never loaded. */
  updatedAtMs: number;
  /** null until the client clock exists. */
  nowMs: number | null;
  /** A background refresh failed (the grid keeps its last data). */
  refreshFailed: boolean;
  onRetry: () => void;
}

// "Live · updated just now" as plain muted text (no green dot: green is the
// Available colour on this screen) — or, when a background refresh failed, a
// plain notice plus a 44 px Try again. The grid never blanks on a failed poll;
// this line is where the failure shows.
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
  return <p className="text-xs text-brand-muted">{updatedLabel(updatedAtMs, nowMs ?? updatedAtMs)}</p>;
}
