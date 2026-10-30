"use client";

import { useId } from "react";

import type { KitchenRow } from "@/lib/kitchen-board";
import {
  KITCHEN_ROW_BOX_CLASS,
  KITCHEN_ROW_BOX_KIND_CLASS,
  KITCHEN_ROW_CLASS,
  KITCHEN_ROW_DONE_CLASS,
  KITCHEN_ROW_MOD_CLASS,
  KITCHEN_ROW_MOD_KIND_CLASS,
  KITCHEN_ROW_MORE_CLASS,
  KITCHEN_ROW_NAME_CLASS,
  KITCHEN_ROW_NOTE_CLASS,
  KITCHEN_ROW_QTY_CLASS,
  KITCHEN_ROW_TEXT_CLASS,
} from "@/lib/kitchen-layout";
import { orderItemModifierLines, REMOVED_MODIFIER_PREFIX } from "@pos/shared/utils";
import { cn } from "@/lib/utils";

interface KitchenLineCardProps {
  row: KitchenRow;
  onToggle: (row: KitchenRow, done: boolean) => void;
  /** Its own tick write is in flight (useKitchenActions): disabled until that write ends. */
  pending: boolean;
}

// One line of a Kitchen card, the owner's HTML row (U4 Task 4; values 4.1, 4.6; design 6.3): ONE button across the card —
// the whole row is the tap target (P49 moved on purpose: no 40px label around a small box) — toggling the tick exactly as
// today's checkbox did (same request, toast and Undo: useKitchenActions). A checkbox to assistive tech, with today's name
// "Mark {name} done". The round, ticket number, self-order and age left the line for the card (its dividers, where line and
// pill, design 11). Every class: lib/kitchen-layout.ts.
export function KitchenLineCard({ row, onToggle, pending }: KitchenLineCardProps) {
  // A checkbox's content is presentational and its aria-label is its whole name, so the quantity, the modifier lines and
  // the note (today sibling text outside the checkbox) are its description: "2×, NO Mushroom, + Extra cheese, Note: …".
  // The name is not repeated; an id only for a part that is drawn.
  const id = useId();
  const modifierLines = orderItemModifierLines(row);
  const hasMore = modifierLines.length > 0 || Boolean(row.instructions);
  const qtyId = `${id}-qty`;
  const moreId = `${id}-more`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={row.done}
      aria-label={`Mark ${row.name} done`}
      aria-describedby={hasMore ? `${qtyId} ${moreId}` : qtyId}
      data-ui="kitchen-line"
      disabled={pending}
      className={cn(KITCHEN_ROW_CLASS, row.done && KITCHEN_ROW_DONE_CLASS)}
      onClick={() => onToggle(row, !row.done)}
    >
      {/* The drawn box is decoration (the row carries the state). The HTML draws its white tick always, invisible on an
          open box over white (a ticked look in the dark theme, values 10 #1): ours only when ticked. */}
      <span aria-hidden="true" data-ui="kitchen-line-box" className={cn(KITCHEN_ROW_BOX_CLASS, KITCHEN_ROW_BOX_KIND_CLASS[row.done ? "done" : "open"])}>
        {row.done && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        )}
      </span>
      <span id={qtyId} data-ui="kitchen-line-qty" className={KITCHEN_ROW_QTY_CLASS}>
        {row.qty}×
      </span>
      <span data-ui="kitchen-line-text" className={KITCHEN_ROW_TEXT_CLASS}>
        {/* `row.name` ALREADY carries the variation — buildKitchenRows builds it with orderItemLabel(), which appends
            "(Large)" itself. Appending row.variation here too printed it twice ("Café Latte (Large) (Large)"). The field
            stays on the row for callers that need the parts separately; this renderer must not re-add it. */}
        <span data-ui="kitchen-line-name" className={cn(KITCHEN_ROW_NAME_CLASS, row.done && "line-through")}>
          {row.name}
        </span>
        {/* The words come from the shared formatter (the KOT prints the same lines). A removal ("NO Mushroom") is what the
            cook must not miss, so it reads in ink and bold; additions are the HTML's meta. One wrapper (the row's
            description) holds them and the note, drawn only when there is one of them. */}
        {hasMore && (
          <span id={moreId} data-ui="kitchen-line-more" className={KITCHEN_ROW_MORE_CLASS}>
            {modifierLines.map((line) => (
              <span
                key={line}
                data-ui="kitchen-line-mod"
                className={cn(KITCHEN_ROW_MOD_CLASS, KITCHEN_ROW_MOD_KIND_CLASS[line.startsWith(`${REMOVED_MODIFIER_PREFIX} `) ? "removed" : "added"])}
              >
                {line}
              </span>
            ))}
            {row.instructions && (
              <span data-ui="kitchen-line-note" className={KITCHEN_ROW_NOTE_CLASS}>
                Note: {row.instructions}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}
