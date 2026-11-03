"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Undo2, X } from "lucide-react";

import { FLOOR_POS_PATH } from "@/lib/floor-tiles";
import { ORDER_DETAIL_SCROLL_CLASS, ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS } from "@/lib/orders-layout";
import { bannerOf, detailSub, historyFact, stepsOf, tableFact, type FactTone } from "@/lib/reservations-detail-view";
import {
  RES_BANNER_CLASS,
  RES_BANNER_PLAIN_CLASS,
  RES_BANNER_TEXT_CLASS,
  RES_BANNER_TIME_CLASS,
  RES_DETAIL_ASSIGN_CLASS,
  RES_DETAIL_CLOSE_CLASS,
  RES_DETAIL_FOOT_CLASS,
  RES_DETAIL_HEAD_CLASS,
  RES_DETAIL_NAME_CLASS,
  RES_DETAIL_NAME_ROW_CLASS,
  RES_DETAIL_PRIMARY_CLASS,
  RES_DETAIL_SUB_CLASS,
  RES_EDIT_CLASS,
  RES_FACTS_CLASS,
  RES_FACT_KEY_CLASS,
  RES_FACT_ROW_CLASS,
  RES_FACT_VALUE_CLASS,
  RES_GRID_BUTTON_CLASS,
  RES_GRID_CLASS,
  RES_NOTE_CLASS,
  RES_RELATIVE_TONE_CLASS,
  RES_STEPS_CLASS,
  RES_STEP_CLASS,
  RES_STEP_DOT_CLASS,
  RES_STEP_LABEL_CLASS,
  RES_STEP_LINE_CLASS,
  RES_STEP_TIME_CLASS,
} from "@/lib/reservations-layout";
import { detailActions, formatMobile, pastVisits, pillOf, type ResAction } from "@/lib/reservations-view";
import { cn } from "@/lib/utils";
import { ReservationPill } from "@/components/reservations/ReservationPill";
import { offerOnPlainClick } from "@/components/reservations/ReservationRowParts";
import type { Reservation, Table } from "@/types";

interface ReservationDetailProps {
  r: Reservation;
  /** The whole unfiltered list (the guest history reads it). */
  list: readonly Reservation[];
  /** undefined while the tables load. */
  tables: readonly Table[] | undefined;
  nowMs: number;
  today: string;
  /** A status write is running (B13): Seat, Completed, Cancel and Restore are off; Edit, Open order and Book again never. */
  busy: boolean;
  /** In the bottom sheet: the ✕ shows and the name is the dialog's title (B6). */
  sheet: boolean;
  onClose: () => void;
  onAction: (r: Reservation, action: ResAction) => void;
  onEdit: (r: Reservation) => void;
  onAssign: (r: Reservation) => void;
}

const FACT_TONE: Record<FactTone, string> = { plain: "text-foreground", warn: "text-status-warn-ink", faint: "text-subtle-foreground" };
const GRID = {
  complete: { Icon: Check, word: "Completed", tone: "text-status-ok-ink" },
  cancel: { Icon: X, word: "Cancel", tone: "text-status-bad-ink" },
  restore: { Icon: Undo2, word: "Restore", tone: "text-muted-foreground" },
} as const;
const PRIMARY_WORD = { seat: "Seat", openOrder: "Open order", bookAgain: "Book again" } as const;

// The booking detail's content (U6 Task 3; values 10.3, 10.4; design 7): the head (name, sub, pill, ✕ on the sheet), the time
// banner, the three steps (from 720px), the body that scrolls (facts, "+ Assign a table", the note, the action grid) and
// the footer (Edit + the primary). It draws one booking and raises intents (`onAction`, `onEdit`, `onAssign`): no write
// happens here. The frame (column or sheet) is ReservationDetailFrame.
export function ReservationDetail({ r, list, tables, nowMs, today, busy, sheet, onClose, onAction, onEdit, onAssign }: ReservationDetailProps) {
  const banner = bannerOf(r, nowMs, today);
  const steps = stepsOf(r);
  const table = tableFact(r, tables);
  const visits = useMemo(() => pastVisits(list, r.mobile, r._id), [list, r.mobile, r._id]);
  const mobile = r.mobile.trim() === "" ? null : formatMobile(r.mobile);
  const { grid: gridActions, primary } = detailActions(r);
  const canAssign = !r.tableNo && (r.status === "Booked" || r.status === "Seated");
  const name = (
    <div data-ui="reservation-detail-name" {...(sheet ? {} : ({ role: "heading", "aria-level": 2 } as const))} className={RES_DETAIL_NAME_CLASS}>
      {r.name}
    </div>
  );

  return (
    <>
      <div data-ui="reservation-detail-head" className={RES_DETAIL_HEAD_CLASS}>
        <div className={RES_DETAIL_NAME_ROW_CLASS}>
          <div className="min-w-0 flex-1">
            {sheet ? <DialogPrimitive.Title asChild>{name}</DialogPrimitive.Title> : name}
            <div data-ui="reservation-detail-sub" className={RES_DETAIL_SUB_CLASS}>{detailSub(r)}</div>
          </div>
          <ReservationPill kind={pillOf(r, nowMs, today)} size="detail" ui="reservation-detail-pill" />
          {sheet && (
            <button type="button" data-ui="reservation-detail-close" title="Close" aria-label="Close" onClick={onClose} className={RES_DETAIL_CLOSE_CLASS}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>

        <div data-ui="reservation-detail-banner" className={RES_BANNER_CLASS}>
          <span data-ui="reservation-detail-time" className={RES_BANNER_TIME_CLASS}>{banner.time}</span>
          <span data-ui="reservation-detail-banner-text" className={cn(RES_BANNER_TEXT_CLASS, banner.tone ? RES_RELATIVE_TONE_CLASS[banner.tone] : RES_BANNER_PLAIN_CLASS)}>
            {banner.text}
          </span>
        </div>

        <div data-ui="reservation-detail-steps" className={RES_STEPS_CLASS}>
          {steps.map((s, i) => (
            <div key={s.label} data-ui="reservation-detail-step" className={RES_STEP_CLASS}>
              <div className="flex items-center">
                <span aria-hidden="true" className={cn(RES_STEP_DOT_CLASS, s.reached ? "bg-status-ok" : r.status === "Cancelled" ? "bg-border" : "bg-surface-3")} />
                <span aria-hidden="true" className={cn(RES_STEP_LINE_CLASS, s.lineDone ? "bg-status-ok" : "bg-border", i === steps.length - 1 && "opacity-0")} />
              </div>
              <span className={cn(RES_STEP_LABEL_CLASS, s.reached ? "text-foreground" : "text-subtle-foreground")}>{s.label}</span>
              {s.time !== "" && <span className={RES_STEP_TIME_CLASS}>{s.time}</span>}
            </div>
          ))}
        </div>
      </div>

      <div data-ui="reservation-detail-scroll" className={cn(ORDER_DETAIL_SCROLL_CLASS, ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS)}>
        <div data-ui="reservation-detail-facts" className={RES_FACTS_CLASS}>
          <Fact label="Table" value={table.text} tone={FACT_TONE[table.tone]} />
          {mobile !== null && <Fact label="Phone" value={mobile} tone={FACT_TONE.plain} />}
          <Fact label="Guest history" value={historyFact(visits)} tone={FACT_TONE.plain} hideOnPhone />
        </div>

        {canAssign && (
          <button type="button" data-ui="reservation-detail-assign" onClick={() => onAssign(r)} className={RES_DETAIL_ASSIGN_CLASS}>
            + Assign a table
          </button>
        )}

        {r.notes && <div data-ui="reservation-detail-note" className={RES_NOTE_CLASS}>{r.notes}</div>}

        {gridActions.length > 0 && (
          <div data-ui="reservation-detail-grid" className={RES_GRID_CLASS}>
            {gridActions.map((action) => {
              if (action !== "complete" && action !== "cancel" && action !== "restore") return null;
              const { Icon, word, tone } = GRID[action];
              return (
                <button key={action} type="button" data-ui="reservation-detail-action" disabled={busy} onClick={() => onAction(r, action)} className={cn(RES_GRID_BUTTON_CLASS, tone)}>
                  <Icon aria-hidden="true" strokeWidth={1.8} className="size-[17px] flex-none" />
                  <span className="w-full">{word}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div data-ui="reservation-detail-foot" className={RES_DETAIL_FOOT_CLASS}>
        <button type="button" data-ui="reservation-detail-edit" onClick={() => onEdit(r)} className={RES_EDIT_CLASS}>
          Edit
        </button>
        <Primary r={r} action={primary} busy={busy} onAction={onAction} />
      </div>
    </>
  );
}

function Fact({ label, value, tone, hideOnPhone = false }: { label: string; value: string; tone: string; hideOnPhone?: boolean }) {
  return (
    <div data-ui="reservation-detail-fact" className={cn(RES_FACT_ROW_CLASS, hideOnPhone && "max-tab:hidden")}>
      <span className={RES_FACT_KEY_CLASS}>{label}</span>
      <span className={cn(RES_FACT_VALUE_CLASS, tone)}>{value}</span>
    </div>
  );
}

/** The footer's primary (values 10.3, always accent): Seat, Open order (the /pos link; a plain click hands the table over,
 *  B17) or Book again. */
function Primary({ r, action, busy, onAction }: { r: Reservation; action: ResAction | null; busy: boolean; onAction: ReservationDetailProps["onAction"] }): ReactNode {
  if (action !== "seat" && action !== "openOrder" && action !== "bookAgain") return null;
  if (action === "openOrder") {
    const tableNo = r.tableNo;
    if (!tableNo) return null;
    return (
      <Link
        href={FLOOR_POS_PATH}
        prefetch={false}
        data-ui="reservation-detail-primary"
        onClick={(e) => {
          offerOnPlainClick(e, tableNo);
        }}
        className={RES_DETAIL_PRIMARY_CLASS}
      >
        {PRIMARY_WORD[action]}
      </Link>
    );
  }
  return (
    <button type="button" data-ui="reservation-detail-primary" disabled={action === "seat" && busy} onClick={() => onAction(r, action)} className={RES_DETAIL_PRIMARY_CLASS}>
      {PRIMARY_WORD[action]}
    </button>
  );
}
