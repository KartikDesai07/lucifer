"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";

import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { clockOf } from "@/lib/reservations-view";
import { seatTile } from "@/lib/reservations-tables";
import {
  RES_SEAT_BODY_CLASS,
  RES_SEAT_CLOSE_CLASS,
  RES_SEAT_GRID_CLASS,
  RES_SEAT_HEAD_CLASS,
  RES_SEAT_NOTABLE_CLASS,
  RES_SEAT_PANEL_CLASS,
  RES_SEAT_SCRIM_CLASS,
  RES_SEAT_SUB_CLASS,
  RES_SEAT_SUB_INK_CLASS,
  RES_SEAT_TILE_CLASS,
  RES_SEAT_TILE_FITS_CLASS,
  RES_SEAT_TILE_LABEL_CLASS,
  RES_SEAT_TILE_PLAIN_CLASS,
  RES_SEAT_TILE_SUB_CLASS,
  RES_SEAT_TITLE_CLASS,
} from "@/lib/reservations-layout";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Reservation, Table } from "@/types";

export interface SeatTarget {
  r: Reservation;
  /** "seat": a pick seats the booking there; "assign": a pick only sets its table. */
  mode: "seat" | "assign";
}

interface ReservationSeatDialogProps {
  target: SeatTarget | null;
  /** The whole unfiltered list (the tiles' conflicts read it). */
  list: readonly Reservation[];
  /** undefined while the tables load: a short skeleton grid, "Seat without a table" stays live (B18). */
  tables: readonly Table[] | undefined;
  today: string;
  /** A status write is running (B13): every tile and "Seat without a table" are off. */
  busy: boolean;
  onPick: (tableNo: string) => void;
  onSeatWithoutTable: () => void;
  onClose: () => void;
}

const guestsWord = (n: number): string => `${n} guest${n === 1 ? "" : "s"}`;

// The seat / assign dialog (U6 Task 3; values 14; design 8.2, Q1, B18, B24, B27): a centred 560px dialog from 720px, a bottom
// sheet below (the shared sheet frame). One grid of our tables (no area heads, P22); a tile reads the table's state for
// this booking (lib/reservations-tables.ts seatTile): an Occupied table is off when seating and pickable when assigning,
// a Reserved, conflicting or too small one is still pickable. It only raises the pick: the page writes (its one status
// instance), closes the dialog on success and leaves it open on a failure (B13). Escape and the ✕ close it with no
// change; the panel takes the focus as it opens and the opener gets it back (B27).
export function ReservationSeatDialog({ target, list, tables, today, busy, onPick, onSeatWithoutTable, onClose }: ReservationSeatDialogProps) {
  const openerFocus = useOpenerFocus();
  const r = target?.r;
  const mode = target?.mode ?? "seat";
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="reservation-seat-scrim" className={RES_SEAT_SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="reservation-seat" {...openerFocus} className={RES_SEAT_PANEL_CLASS}>
            <div data-ui="reservation-seat-head" className={RES_SEAT_HEAD_CLASS}>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title data-ui="reservation-seat-title" className={RES_SEAT_TITLE_CLASS}>
                  {r ? (mode === "seat" ? `Seat ${r.name}` : `Assign a table · ${r.name}`) : ""}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description data-ui="reservation-seat-sub" className={RES_SEAT_SUB_CLASS}>
                  {r ? `${guestsWord(r.guests)} · booked for ${clockOf(r.time).full}` : ""}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close data-ui="reservation-seat-close" aria-label="Close" className={RES_SEAT_CLOSE_CLASS}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </DialogPrimitive.Close>
            </div>

            <div data-ui="reservation-seat-body" className={RES_SEAT_BODY_CLASS}>
              {tables === undefined ? (
                <div data-ui="reservation-seat-skeleton" aria-hidden="true" className={RES_SEAT_GRID_CLASS}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-14 rounded-[10px]" />
                  ))}
                </div>
              ) : tables.length === 0 ? (
                <p data-ui="reservation-seat-none" className="text-center text-[13px] text-muted-foreground">
                  No tables are set up yet.
                </p>
              ) : (
                <div data-ui="reservation-seat-grid" className={RES_SEAT_GRID_CLASS}>
                  {r &&
                    tables.map((t) => {
                      const tile = seatTile(t, { id: r._id, date: r.date, time: r.time, guests: r.guests }, list, mode, today);
                      return (
                        <button
                          key={t._id}
                          type="button"
                          data-ui="reservation-seat-tile"
                          disabled={tile.off || busy}
                          onClick={() => onPick(t.tableNo)}
                          className={cn(RES_SEAT_TILE_CLASS, tile.fits ? RES_SEAT_TILE_FITS_CLASS : RES_SEAT_TILE_PLAIN_CLASS)}
                        >
                          <span className={RES_SEAT_TILE_LABEL_CLASS}>
                            <span aria-hidden="true" className={cn("size-1.5 flex-none rounded-[50%]", STATUS_CLASSES[tile.tone].dot)} />
                            <span className="min-w-0">{t.tableNo}</span>
                          </span>
                          {tile.sub !== "" && <span className={cn(RES_SEAT_TILE_SUB_CLASS, RES_SEAT_SUB_INK_CLASS[tile.tone])}>{tile.sub}</span>}
                        </button>
                      );
                    })}
                </div>
              )}
              {mode === "seat" && (
                <button type="button" data-ui="reservation-seat-notable" disabled={busy} onClick={onSeatWithoutTable} className={RES_SEAT_NOTABLE_CLASS}>
                  Seat without a table
                </button>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
