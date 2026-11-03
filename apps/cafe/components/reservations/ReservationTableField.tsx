"use client";

import { useState } from "react";

import { MENU_EDITOR_FIELD_CLASS, MENU_EDITOR_LABEL_CLASS } from "@/lib/menu-editor-layout";
import { bestFits, tableMessage, type FormValues } from "@/lib/reservation-form";
import {
  RES_FORM_HEAD_CLASS,
  RES_FORM_HINT_CLASS,
  RES_FORM_LINK_CLASS,
  RES_FORM_MESSAGE_CLASS,
  RES_FORM_MESSAGE_TONE_CLASS,
  RES_FORM_OFF_CLASS,
  RES_FORM_ON_CLASS,
  RES_FORM_TABLES_CLASS,
  RES_FORM_TABLE_CLASS,
  RES_FORM_TABLE_LABEL_CLASS,
  RES_FORM_TABLE_SUB_CLASS,
} from "@/lib/reservation-form-layout";
import { RES_SEAT_SUB_INK_CLASS } from "@/lib/reservations-layout";
import { seatTile } from "@/lib/reservations-tables";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Reservation, Table } from "@/types";

interface ReservationTableFieldProps {
  /** undefined while the floor plan loads. */
  tables: readonly Table[] | undefined;
  values: FormValues;
  onPick: (tableNo: string | undefined) => void;
  list: readonly Reservation[];
  editingId: string | null;
  today: string;
  nowMs: number;
}

/** The Table field (values 13.2 #4, 13.6; design 8.1, owner Q3 / Q6): "Unassigned · Choose at arrival", the best-fit chips (or all
 *  tables), the message under them. A chip's words and dot are the seat dialog's tile (lib/reservations-tables.ts seatTile). */
export function ReservationTableField({ tables, values, onPick, list, editingId, today, nowMs }: ReservationTableFieldProps) {
  const [all, setAll] = useState(false);
  const live = tables ?? [];
  const picked = values.tableNo;
  const stale = tables !== undefined && !!picked && !live.some((t) => t.tableNo === picked);
  const shown = all ? live : bestFits(live, values, list, editingId, today, nowMs);
  const message = tableMessage(live, values, list, editingId, today, nowMs);
  const guests = Number.isFinite(values.guests) && values.guests >= 1 ? values.guests : null;
  const hint = all ? "All tables" : guests === null ? "Best fits" : `Best fits for ${guests} guest${guests === 1 ? "" : "s"}`;

  const chip = (on: boolean) => cn(RES_FORM_TABLE_CLASS, on ? RES_FORM_ON_CLASS : RES_FORM_OFF_CLASS);

  return (
    <div data-ui="reservation-form-table" role="group" aria-label="Table" className={MENU_EDITOR_FIELD_CLASS}>
      <div className={RES_FORM_HEAD_CLASS}>
        <span className={MENU_EDITOR_LABEL_CLASS}>Table</span>
        <span className={RES_FORM_HINT_CLASS}>{hint}</span>
      </div>
      <div className={RES_FORM_TABLES_CLASS}>
        <button type="button" data-ui="reservation-form-unassigned" aria-pressed={!picked} className={chip(!picked)} onClick={() => onPick(undefined)}>
          <span className={RES_FORM_TABLE_LABEL_CLASS}>Unassigned</span>
          <span className={cn(RES_FORM_TABLE_SUB_CLASS, "opacity-75")}>Choose at arrival</span>
        </button>
        {stale && picked && (
          <button type="button" data-ui="reservation-form-table-chip" aria-pressed className={chip(true)} onClick={() => onPick(picked)}>
            <span className={RES_FORM_TABLE_LABEL_CLASS}>{picked}</span>
            <span className={RES_FORM_TABLE_SUB_CLASS}>(no longer on the floor plan)</span>
          </button>
        )}
        {shown.map((t) => {
          const on = t.tableNo === picked;
          const tile = seatTile(t, { id: editingId ?? "", date: values.date, time: values.time, guests: Number.isFinite(values.guests) ? values.guests : 1 }, list, "assign", today);
          // A table that is busy (occupied, held, booked, seated) is dimmed; one that is only too small is not (values 13.6).
          const dim = tile.tone === "info" || tile.tone === "reserved" || (tile.tone === "warn" && !tile.sub.startsWith("Seats"));
          const dot = tile.tone === "warn" && dim ? "reserved" : tile.tone;
          return (
            <button
              key={t._id}
              type="button"
              data-ui="reservation-form-table-chip"
              aria-pressed={on}
              title={t.capacity > 0 ? `${t.tableNo} · ${t.capacity} seat${t.capacity === 1 ? "" : "s"}` : t.tableNo}
              className={cn(chip(on), dim && !on && "opacity-70")}
              onClick={() => onPick(t.tableNo)}
            >
              <span className={RES_FORM_TABLE_LABEL_CLASS}>
                <span aria-hidden="true" className={cn("size-1.5 flex-none rounded-[50%]", on ? "bg-on-ink" : STATUS_CLASSES[dot].dot)} />
                <span className="min-w-0">{t.tableNo}</span>
              </span>
              {tile.sub !== "" && (
                <span className={cn(RES_FORM_TABLE_SUB_CLASS, on ? "text-on-ink" : tile.tone === "ok" ? "text-subtle-foreground" : RES_SEAT_SUB_INK_CLASS[tile.tone])}>{tile.sub}</span>
              )}
            </button>
          );
        })}
      </div>
      <button type="button" data-ui="reservation-form-table-toggle" className={RES_FORM_LINK_CLASS} onClick={() => setAll((a) => !a)}>
        {all ? "Show best fits only" : "Show all tables"}
      </button>
      {message && (
        <div data-ui="reservation-form-table-message" role="status" className={cn(RES_FORM_MESSAGE_CLASS, RES_FORM_MESSAGE_TONE_CLASS[message.tone])}>
          {message.text}
        </div>
      )}
    </div>
  );
}
