"use client";

import { X } from "lucide-react";

import { PRODUCT_BULK_MAX } from "@pos/shared/constants";
import type { ProductBulkAction } from "@pos/shared/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BulkBarProps {
  count: number;
  isAdmin: boolean;
  archived: boolean;
  isPending: boolean;
  onAction: (action: ProductBulkAction) => void;
  onMove: () => void;
  onArchive: () => void;
  onClear: () => void;
}

// R18 — sticky bottom bar. Staff get the two stock actions only (the route
// enforces this; STAFF_PRODUCT_BULK_ACTIONS mirrors it here for what's even
// offered). lg+ shows every action inline; below lg the extra admin actions
// (Move/Archive/Restore) collapse into one "More" menu. Over PRODUCT_BULK_MAX
// selected, every action disables with the capped-selection message.
export function BulkBar({ count, isAdmin, archived, isPending, onAction, onMove, onArchive, onClear }: BulkBarProps) {
  if (count === 0) return null;
  const overCap = count > PRODUCT_BULK_MAX;
  const disabled = isPending || overCap;

  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      {overCap && (
        <p className="text-xs text-destructive">Select up to {PRODUCT_BULK_MAX} items at a time.</p>
      )}
      {/* G20 — flex-wrap as a safety net (measured fine at 360px, but a
          longer locale string or a narrower device shouldn't be able to push
          this bar sideways). */}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium">{count} selected</span>

        {archived ? (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAction("restore")}>
            Restore
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAction("out-of-stock")}>
              Out of stock
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAction("in-stock")}>
              In stock
            </Button>
          </>
        )}

        {isAdmin && !archived && (
          <>
            {/* lg+: every action inline. */}
            <Button type="button" size="sm" variant="outline" disabled={disabled} className="hidden lg:inline-flex" onClick={onMove}>
              Move to category
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              className="hidden text-destructive lg:inline-flex"
              onClick={onArchive}
            >
              Archive
            </Button>

            {/* Below lg: Move + Archive collapse into one More menu. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={disabled} className="lg:hidden">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={onMove}>Move to category</DropdownMenuItem>
                <DropdownMenuItem onClick={onArchive} className="text-destructive">Archive</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto shrink-0"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
