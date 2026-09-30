"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";

const STAFF_SKELETON_ROWS = 4;

// The no-list states of the Staff page: failed, offline (parked) or loading.
// Only rendered while there is no staff list to show. A parked (offline) query
// reports isLoading AND isError false with no data, so without the isPaused
// branch it would read as "No staff yet" on a team that is simply not loaded.
export function StaffLoadStatus({
  isError,
  isPaused,
  onRetry,
}: {
  isError: boolean;
  isPaused: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load staff"
        description="Check the internet connection, then try again."
        onRetry={onRetry}
        retryLabel="Try again"
      />
    );
  }
  if (isPaused) {
    return (
      <p className="text-sm text-muted-foreground">
        You appear to be offline. Staff will load when the connection is back.
      </p>
    );
  }
  return (
    <div className={cn("space-y-2 rounded-lg border p-4", BRAND_PANEL_CLASS)}>
      {Array.from({ length: STAFF_SKELETON_ROWS }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
