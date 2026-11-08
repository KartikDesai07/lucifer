"use client";

import type { MouseEvent } from "react";
import { AppLink } from "@/components/layout/AppLink";
import { Check, Undo2, X } from "lucide-react";

import { FLOOR_POS_PATH } from "@/lib/floor-tiles";
import { offerPosTable } from "@/lib/pos-table-handoff";
import {
  primaryTone,
  RES_ASSIGN_CLASS,
  RES_ICON_CLASS,
  RES_PRIMARY_CARD_CLASS,
  RES_PRIMARY_CLASS,
  RES_PRIMARY_TABLE_CLASS,
  RES_RELATIVE_CLASS,
  RES_RELATIVE_TONE_CLASS,
  RES_RELATIVE_WEIGHT_CLASS,
} from "@/lib/reservations-layout";
import { relativeOf, type ResAction } from "@/lib/reservations-view";
import { cn } from "@/lib/utils";
import type { Reservation } from "@/types";

// The pieces a card row and a table row share (U6 Task 2; values 8.2, 8.3; design 6.3): the primary button, the icon buttons,
// "Assign" and the relative line. They raise intents (`onAction(r, action)`); no write happens here (P17, B17).

/** What a row raises: a status write, Book again or Cancel, by name (the page maps each). */
export type RowIntent = (r: Reservation, action: ResAction) => void;

// A click hands the table to New Order only for a plain primary click (FloorTile's rule): a middle / modifier click opens
// a plain /pos in a new tab, which must not carry the table.
export function offerOnPlainClick(e: MouseEvent<HTMLAnchorElement>, tableNo: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  offerPosTable(tableNo, Date.now());
}

const PRIMARY_WORD = { seat: "Seat", openOrder: "Open order", bookAgain: "Book again" } as const;

interface PrimaryProps {
  r: Reservation;
  action: ResAction;
  selected: boolean;
  busy: boolean;
  /** The data-ui prefix and the variant's size. */
  ui: "reservations-card" | "reservations-row";
  onAction: RowIntent;
}

/** The row's primary (32px): Seat (ink), Open order (the /pos link, accent tint) or Book again (surface-3). Only Seat is
 *  disabled while a status write runs (B13). Any other action has no primary. */
export function RowPrimary({ r, action, selected, busy, ui, onAction }: PrimaryProps) {
  if (action !== "seat" && action !== "openOrder" && action !== "bookAgain") return null;
  const className = cn(RES_PRIMARY_CLASS, ui === "reservations-card" ? RES_PRIMARY_CARD_CLASS : RES_PRIMARY_TABLE_CLASS, primaryTone(action, selected));
  if (action === "openOrder") {
    const tableNo = r.tableNo;
    if (!tableNo) return null;
    return (
      <AppLink href={FLOOR_POS_PATH} data-ui={`${ui}-primary`} onClick={(e) => offerOnPlainClick(e, tableNo)} className={className}>
        {PRIMARY_WORD[action]}
      </AppLink>
    );
  }
  return (
    <button type="button" data-ui={`${ui}-primary`} disabled={action === "seat" && busy} onClick={() => onAction(r, action)} className={className}>
      {PRIMARY_WORD[action]}
    </button>
  );
}

const ICONS = {
  complete: { Icon: Check, title: "Mark completed · guests left", tone: "text-status-ok-ink" },
  cancel: { Icon: X, title: "Cancel booking", tone: "text-status-bad-ink" },
  restore: { Icon: Undo2, title: "Restore booking", tone: "text-muted-foreground" },
} as const;

/** The table row's icon buttons (values 8.2, at most two): the title is the only text; each is a write, so each is
 *  disabled while one runs (B13). */
export function RowIcons({ r, icons, busy, onAction }: { r: Reservation; icons: ResAction[]; busy: boolean; onAction: RowIntent }) {
  return (
    <>
      {icons.map((action) => {
        if (action !== "complete" && action !== "cancel" && action !== "restore") return null;
        const { Icon, title, tone } = ICONS[action];
        return (
          <button
            key={action}
            type="button"
            data-ui="reservations-row-icon"
            title={title}
            aria-label={title}
            disabled={busy}
            onClick={() => onAction(r, action)}
            className={cn(RES_ICON_CLASS, tone)}
          >
            <Icon aria-hidden="true" strokeWidth={1.9} className="size-4" />
          </button>
        );
      })}
    </>
  );
}

/** "Assign" (values 8.2, B26): the dashed button for a Booked or Seated booking with no table. Never disabled. */
export function RowAssign({ onPress }: { onPress: () => void }) {
  return (
    <button type="button" data-ui="reservations-row-assign" onClick={onPress} className={RES_ASSIGN_CLASS}>
      Assign
    </button>
  );
}

/** The relative line under the time (values 19.2): nothing is drawn for most statuses and for other days. */
export function RowRelative({ r, nowMs, today, ui }: { r: Reservation; nowMs: number; today: string; ui: string }) {
  const rel = relativeOf(r, nowMs, today);
  if (!rel.text) return null;
  return (
    <span data-ui={ui} className={cn(RES_RELATIVE_CLASS, RES_RELATIVE_WEIGHT_CLASS[rel.weight], rel.tone && RES_RELATIVE_TONE_CLASS[rel.tone])}>
      {rel.text}
    </span>
  );
}

/** "1 guest", "4 guests". */
export function guestsWord(n: number): string {
  return `${n} guest${n === 1 ? "" : "s"}`;
}
