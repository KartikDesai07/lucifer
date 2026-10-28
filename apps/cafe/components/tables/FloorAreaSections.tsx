import type { ReactNode } from "react";

import type { FloorSection } from "@/lib/floor-areas";
import {
  FLOOR_SECTION_CLASS,
  FLOOR_SECTION_COUNT_CLASS,
  FLOOR_SECTION_HEAD_CLASS,
  FLOOR_SECTION_NAME_CLASS,
} from "@/lib/floor-tile-classes";
import { FLOOR_GRID_CLASS, type FloorTileModel } from "@/lib/floor-tiles";

interface FloorAreaSectionsProps {
  groups: readonly FloorSection[];
  /** Renders one tile (its index in its section: the rise's delay, values 7); the page owns the actions, this file only
   *  lays out. */
  renderTile: (tile: FloorTileModel, index: number) => ReactNode;
}

// One section per area (the owner's "sections" choice), the HTML's (values 3.1, design 6.4): a head with the area's name
// and the count of the tiles shown, its grid 10px below. No divider: the sections sit in the body's column, 16px apart.
export function FloorAreaSections({ groups, renderTile }: FloorAreaSectionsProps) {
  return (
    <>
      {groups.map((group) => {
        const headingId = `floor-area-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} data-ui="floor-section" className={FLOOR_SECTION_CLASS}>
            <div data-ui="floor-section-head" className={FLOOR_SECTION_HEAD_CLASS}>
              <h2 id={headingId} title={group.name} data-ui="floor-section-name" className={FLOOR_SECTION_NAME_CLASS}>
                {group.name}
              </h2>
              <span data-ui="floor-section-count" className={FLOOR_SECTION_COUNT_CLASS}>
                {group.summary}
              </span>
            </div>
            <div data-ui="floor-grid" className={FLOOR_GRID_CLASS}>
              {group.tiles.map((tile, index) => renderTile(tile, index))}
            </div>
          </section>
        );
      })}
    </>
  );
}
