import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { trackGeometry } from "@/components/public/public-rewards-view";

// CB-6D-B — NEW. The owner's horizontal progress bar with milestone markers
// (Starbucks stars), on the stamp-card hero. Presentational only: all the
// math (fill percent, each marker's left offset, reached-vs-upcoming) comes
// from trackGeometry (public-rewards-view.ts) — this file only lays it out.
// Geometry is applied via inline `style` (never a computed className —
// Tailwind's JIT cannot see a runtime percentage).

interface PublicStampTrackProps {
  cycleLength: number;
  position: number;
  milestones: readonly { at: number }[];
}

export function PublicStampTrack({ cycleLength, position, milestones }: PublicStampTrackProps) {
  const { fillPercent, markers } = trackGeometry(cycleLength, position, milestones);

  return (
    <div className="mt-6 px-3 pb-6" aria-hidden="true">
      <div className="relative h-2 rounded-full bg-primary-foreground/25">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary-foreground"
          style={{ width: fillPercent + "%" }}
        />
        {markers.map((marker) => (
          <span
            key={marker.at}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: marker.leftPercent + "%" }}
          >
            <span
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full",
                marker.reached
                  ? "bg-primary-foreground text-primary"
                  : "border-2 border-primary-foreground/60 bg-primary",
              )}
            >
              {marker.reached && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <span className="absolute left-1/2 top-7 -translate-x-1/2 text-xs font-medium tabular-nums text-primary-foreground/80">
              {marker.at}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
