"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { Dialog } from "@/components/ui/dialog";
import { keepOpenForNestedDialog } from "@/lib/nested-dialog";
import {
  ORDERS_XL_QUERY,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_SHEET_CLASS,
  ORDER_DETAIL_SHEET_SCRIM_CLASS,
  frameInUse,
  orderDetailFrame,
} from "@/lib/orders-layout";
import { RES_DETAIL_NONE_CLASS, RES_DETAIL_NONE_TITLE_CLASS } from "@/lib/reservations-layout";

interface ReservationDetailFrameProps {
  /** A booking is shown (the sheet opens with it). */
  open: boolean;
  /** The list has not answered (loading, failed, offline): the column shows nothing rather than "No booking selected". */
  waiting: boolean;
  /** The seat dialog, a confirm or the form opened from the detail is up: the frame it opened from stays (frameInUse). */
  nestedOpen: boolean;
  /** ✕ and Escape on the sheet (B6). */
  onClose: () => void;
  /** The content; `sheet` is true in the bottom sheet (the head then draws its ✕ and is the dialog's title). */
  children: (sheet: boolean) => ReactNode;
}

// The detail's two frames (U6 Task 3; design 7, B5, B6; values 10.1, 10.2): from 1280px the page's 400px column (a plain flex
// column, no dialog and no ✕; with nothing chosen it shows the HTML's "No booking selected" once the list has answered),
// below it U2's full-screen bottom sheet (the /pos cart sheet's constants: a Radix dialog over the whole window, its overlay
// mounted and never drawn). One frame for the width, so a resize never remounts the open booking; while the seat dialog, a
// confirm or the form it opened is up, the frame it opened from stays (a frame mounted under an open dialog would take
// Radix's top layer). Ruling P38: a press that closes such a dialog never closes the sheet beneath. The sheet opens from
// state: the shared opener hook gives the focus back to the row that opened it.
export function ReservationDetailFrame({ open, waiting, nestedOpen, onClose, children }: ReservationDetailFrameProps) {
  const forWidth = orderDetailFrame("page", useMediaQuery(ORDERS_XL_QUERY));
  const [heldFrame, setHeldFrame] = useState(forWidth);
  const frame = frameInUse(heldFrame, forWidth, open && nestedOpen);
  if (frame !== heldFrame) setHeldFrame(frame);
  const sheetRef = useRef<HTMLDivElement>(null);
  const openerFocus = useOpenerFocus();

  if (frame === null) return null;
  if (frame === "column") {
    return (
      <div data-ui="reservation-detail" className={ORDER_DETAIL_COLUMN_CLASS}>
        {open ? (
          children(false)
        ) : waiting ? null : (
          <div data-ui="reservation-detail-none" className={RES_DETAIL_NONE_CLASS}>
            <p className={RES_DETAIL_NONE_TITLE_CLASS}>No booking selected</p>
            <p>Pick a booking from the list to see details and seat the guest.</p>
          </div>
        )}
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={ORDER_DETAIL_SHEET_SCRIM_CLASS} />
        <DialogPrimitive.Content
          ref={sheetRef}
          {...openerFocus}
          data-ui="reservation-detail"
          aria-describedby={undefined}
          className={ORDER_DETAIL_SHEET_CLASS}
          onInteractOutside={(e) => keepOpenForNestedDialog(e, sheetRef.current)}
        >
          <KeepWhileClosing show={open}>{children(true)}</KeepWhileClosing>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

// Radix keeps a closing sheet's panel mounted while it slides away, but by then no booking is shown: this keeps the last
// drawn content through that close (set after each commit that shows one, so a render thrown away never changes it).
function KeepWhileClosing({ show, children }: { show: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  useLayoutEffect(() => {
    if (show) last.current = children;
  });
  return show ? children : last.current;
}
