import type { ReactNode } from "react";

import { FLOOR_GRID_CLASS, type FloorSection, type FloorTileModel } from "@/lib/floor-tiles";

interface FloorAreaSectionsProps {
  groups: readonly FloorSection[];
  /** Renders one tile; the page owns the actions, this file only lays out. */
  renderTile: (tile: FloorTileModel) => ReactNode;
}

// One page, a heading per area with its tiles below (the owner's "sections"
// choice). A hairline separates sections; the first has none above it.
export function FloorAreaSections({ groups, renderTile }: FloorAreaSectionsProps) {
  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const headingId = `floor-area-${group.key}`;
        return (
          <section
            key={group.key}
            aria-labelledby={headingId}
            className="space-y-3 border-t border-brand-rule pt-4 first:border-t-0 first:pt-0"
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 id={headingId} title={group.name} className="min-w-0 max-w-full truncate text-base font-semibold">
                {group.name}
              </h2>
              <span className="text-xs text-brand-muted">{group.summary}</span>
            </div>
            <div className={FLOOR_GRID_CLASS}>{group.tiles.map((tile) => renderTile(tile))}</div>
          </section>
        );
      })}
    </div>
  );
}
