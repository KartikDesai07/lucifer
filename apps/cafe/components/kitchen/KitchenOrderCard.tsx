"use client";

import type { KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import {
  KITCHEN_CARD_CLASS,
  KITCHEN_CARD_CODE_CLASS,
  KITCHEN_CARD_EDGE_CLASS,
  KITCHEN_CARD_FOOTER_CLASS,
  KITCHEN_CARD_HEAD_CLASS,
  KITCHEN_CARD_LINES_CLASS,
  KITCHEN_CARD_RISE_CLASS,
  KITCHEN_CARD_TITLE_CLASS,
  KITCHEN_CARD_WHERE_CLASS,
  KITCHEN_PILL_BAND_CLASS,
  KITCHEN_PILL_CLASS,
  KITCHEN_READY_CLASS,
  KITCHEN_READY_KIND_CLASS,
} from "@/lib/kitchen-layout";
import { kitchenButton, kitchenCardCode, kitchenCardLate, kitchenFooter, kitchenPill, kitchenWhereLine } from "@/lib/kitchen-view";
import { KitchenLineCard } from "@/components/kitchen/KitchenLineCard";
import { cn } from "@/lib/utils";

interface KitchenOrderCardProps {
  card: KitchenOrderCardData;
  now: Date;
  onToggleLine: (line: KitchenRow, done: boolean) => void;
  onReady: (card: KitchenOrderCardData) => void;
  lineInFlight: (line: KitchenRow) => boolean;
  readyInFlight: boolean;
  /** The HTML's rise when the card first appears (U4 Task 4 decides when). */
  rise?: boolean;
}

// One ORDER's card, the owner's HTML ticket card (U4 Task 3; values 4.1-4.5, design 6.3): the head row (the code, the
// where line, the time pill), the lines, the footer and Mark ready. Every word comes from lib/kitchen-view.ts, every class
// from lib/kitchen-layout.ts. Late is never colour alone: the pill's words, the red border and "Late" read to screen readers.
export function KitchenOrderCard({
  card,
  now,
  onToggleLine,
  onReady,
  lineInFlight,
  readyInFlight,
  rise = false,
}: KitchenOrderCardProps) {
  const nowMs = now.getTime();
  const pill = kitchenPill(card, nowMs);
  const footer = kitchenFooter(card);
  const button = kitchenButton(card);
  const edge = kitchenCardLate(card, nowMs) ? KITCHEN_CARD_EDGE_CLASS.late : KITCHEN_CARD_EDGE_CLASS.normal;

  return (
    <div data-ui="kitchen-card" className={cn(KITCHEN_CARD_CLASS, edge, rise && KITCHEN_CARD_RISE_CLASS)}>
      {/* The head: WHERE before WHAT — the code is the biggest thing on the card. */}
      <div data-ui="kitchen-card-head" className={KITCHEN_CARD_HEAD_CLASS}>
        <div className={KITCHEN_CARD_TITLE_CLASS}>
          <div data-ui="kitchen-card-code" className={KITCHEN_CARD_CODE_CLASS}>
            {kitchenCardCode(card)}
          </div>
          <div data-ui="kitchen-card-where" className={KITCHEN_CARD_WHERE_CLASS}>
            {kitchenWhereLine(card)}
          </div>
        </div>
        <span data-ui="kitchen-card-pill" className={cn(KITCHEN_PILL_CLASS, KITCHEN_PILL_BAND_CLASS[pill.band])} title={pill.title}>
          {pill.text}
          {pill.srLate && <span className="sr-only"> Late</span>}
        </span>
      </div>

      {/* The lines: today's rows until U4 Task 4 rebuilds them as the HTML's. */}
      <div data-ui="kitchen-card-lines" className={KITCHEN_CARD_LINES_CLASS}>
        {card.lines.map((line) => (
          <KitchenLineCard
            key={line.id}
            row={line}
            now={now}
            onToggle={onToggleLine}
            pending={lineInFlight(line)}
          />
        ))}
      </div>

      <div data-ui="kitchen-card-footer" className={KITCHEN_CARD_FOOTER_CLASS}>
        <span>{footer.left}</span>
        <span>{footer.right}</span>
      </div>

      {/* ALWAYS enabled (owner decision 2026-09-26). Ticking is an aid for a slow service, not a precondition: during a
          rush nobody has time to tick each line, and a Ready button that refuses until they do strands the card on the
          wall and makes the board a liability exactly when it matters most. The server never fenced this either (the
          "ready" branch in app/api/kitchen/route.ts — a UI disable is not a fence). A mis-tap is recoverable: the Ready
          toast carries Undo, the right trade against a confirm dialog. The label still names what is UNTICKED, so a cook
          clearing a part-done card knows what they are skipping — the nudge survives, the block does not. */}
      <button
        type="button"
        data-ui="kitchen-card-ready"
        className={cn(KITCHEN_READY_CLASS, KITCHEN_READY_KIND_CLASS[button.kind])}
        disabled={readyInFlight}
        onClick={() => onReady(card)}
      >
        {button.label}
      </button>
    </div>
  );
}
