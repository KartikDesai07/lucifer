"use client";

import { Check, Clock, Ellipsis, Loader2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FLOOR_TILE_GLYPH_CLASS, FLOOR_TILE_TRIGGER_CLASS, FLOOR_TILE_TRIGGER_SPINNER_CLASS } from "@/lib/floor-tile-classes";
import type { FloorMenuAction } from "@/lib/floor-tiles";

interface FloorTileMenuProps {
  tableNo: string;
  actions: readonly FloorMenuAction[];
  /** A write (or its open-bill check) runs for this table: the trigger stays, disabled, with the spinner. */
  busy: boolean;
  onPick: (action: FloorMenuAction) => void;
}

const MENU_LABEL: Record<FloorMenuAction, string> = {
  reserve: "Reserve table",
  free: "Free table",
};

// The tile's secondary actions. A SIBLING of the tile's link (never nested in it: a button inside a link is invalid and a
// tap would do both), in the tile's right slot (design 6.5): a 16px ⋯ on the status line, its 44px touch target (32px
// with a fine pointer) reaching up from the detail line's top, never over it. While busy it stays mounted and disabled
// (today's), its ⋯ swapped for the spinner, so a keyboard user's focus is not lost.
export function FloorTileMenu({ tableNo, actions, busy, onPick }: FloorTileMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          data-ui="floor-tile-more"
          className={FLOOR_TILE_TRIGGER_CLASS}
          aria-label={`More actions for ${tableNo}`}
        >
          {busy ? (
            <Loader2 className={FLOOR_TILE_TRIGGER_SPINNER_CLASS} aria-hidden />
          ) : (
            <Ellipsis className={FLOOR_TILE_GLYPH_CLASS} aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((a) => (
          <DropdownMenuItem key={a} onClick={() => onPick(a)}>
            {a === "reserve" ? <Clock className="mr-2 h-4 w-4" aria-hidden /> : <Check className="mr-2 h-4 w-4" aria-hidden />}
            {MENU_LABEL[a]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
