"use client";

import { Check, Clock, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FloorMenuAction } from "@/lib/floor-tiles";

interface FloorTileMenuProps {
  tableNo: string;
  actions: readonly FloorMenuAction[];
  disabled: boolean;
  onPick: (action: FloorMenuAction) => void;
}

const MENU_LABEL: Record<FloorMenuAction, string> = {
  reserve: "Reserve table",
  free: "Free table",
};

// The tile's secondary actions. A SIBLING of the tile's link (never nested in
// it: a button inside a link is invalid and a tap would do both), pinned to the
// tile's top-right corner at a 40 px target.
export function FloorTileMenu({ tableNo, actions, disabled, onPick }: FloorTileMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="absolute right-1 top-1 h-10 w-10 text-brand-muted"
          aria-label={`More actions for ${tableNo}`}
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </Button>
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
