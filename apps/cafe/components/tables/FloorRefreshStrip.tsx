"use client";

import { RefreshStrip } from "@/components/shared/RefreshStrip";

interface FloorRefreshStripProps {
  /** A read of the tables or the open bills failed while tables are on screen (floorRefreshFailed). */
  show: boolean;
  /** Today's Try again: re-read the tables and the open bills. */
  onRetry: () => void;
}

// The Floor's refresh failure (U3 Task 5; design 6.2, owner Q3): the shared strip (components/shared/RefreshStrip.tsx,
// U4 Task 2) with the Floor's words and its floor-* names, the same markup as before. The grid never blanks on a failed
// poll (R17): the tiles keep their last data and the header line keeps its "Updated {m} min ago"; this strip is where the
// failure shows, and it leaves once a read succeeds.
export function FloorRefreshStrip({ show, onRetry }: FloorRefreshStripProps) {
  return <RefreshStrip ui="floor" show={show} message="Couldn't refresh the floor. Showing the last update." onRetry={onRetry} />;
}
