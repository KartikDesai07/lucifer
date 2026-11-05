"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import {
  PRINTER_PANEL_BACK_CLASS,
  PRINTER_PANEL_BODY_CLASS,
  PRINTER_PANEL_CANCEL_CLASS,
  PRINTER_PANEL_CLOSE_CLASS,
  PRINTER_PANEL_COLUMN_CLASS,
  PRINTER_PANEL_DONE_CLASS,
  PRINTER_PANEL_FOOT_CLASS,
  PRINTER_PANEL_HEAD_ROW_CLASS,
  PRINTER_PANEL_HEAD_TEXT_CLASS,
  PRINTER_PANEL_SCRIM_CLASS,
  PRINTER_PANEL_SHEET_CLASS,
  PRINTER_PANEL_SHEET_SCRIM_CLASS,
  PRINTER_PANEL_SIDE_CLASS,
  PRINTER_PANEL_SUB_CLASS,
  PRINTER_PANEL_VIEW_HEAD_CLASS,
  PRINTER_PANEL_VIEW_TITLE_CLASS,
  PRINTER_PANEL_XL_QUERY,
} from "@/components/print/printer-classes";
import { useMediaQuery } from "@/hooks/use-media-query";

// PX-2 (spec §6.1): the old visible sub went; a screen reader still hears what the sheet is for.
const DESCRIPTION = "Printing on this device";
const BACK_LABEL = "Back to printer status";

interface PrinterPanelFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The header's printer button: the dialog's trigger, so it keeps its aria-expanded and gets the focus back on close. */
  trigger?: ReactNode;
  /** The view's title ("Printer", "Printer settings", "Connect a printer"); focusable, so a view switch can move the focus to it (F-M6). */
  title: string;
  /** PX-3 Task 11 (spec §6.1): the connect view's 12.5px line under the title ("Step 2 of 3 · Bluetooth"). */
  sub?: string;
  /** The view's way back (settings → status, connect → settings); absent on the status view. */
  onBack?: () => void;
  /** The back's name: "Back to printer status" unless the view says where it goes. */
  backLabel?: string;
  /** The connect view until a printer is connected: the foot says Cancel (back to settings, X3) instead of Done. */
  onCancel?: () => void;
  children: ReactNode;
}

/** The head's back chevron, drawn by hand (also /printers' inline connect head). */
export function PanelBackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

// The printer panel's frame (values 16; design 7.1; owner rule 2026-10-22): the HTML's 420px aside over its scrim from 1280px,
// U2's full-screen bottom sheet below; ONE Radix dialog whose classes follow the width, so a window resized while it is open
// re-frames it without losing the panel's state or mounting a second one. Head, the one scroller, the fixed Done foot (it
// closes). Escape, the close, Done and a tap on the scrim close it (the bottom sheet has no scrim). On /printers the panel is
// inline and has no frame. PX-2 (spec §6.1): one 62px head line per view (the settings view's back, the title, the close);
// from 720px the contents are a centered 640px column. PX-3 Task 11: the connect view's sub under its title, and its Cancel.
export function PrinterPanelFrame({ open, onOpenChange, trigger, title, sub, onBack, backLabel = BACK_LABEL, onCancel, children }: PrinterPanelFrameProps) {
  const side = useMediaQuery(PRINTER_PANEL_XL_QUERY);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="printer-panel-scrim" className={side ? PRINTER_PANEL_SCRIM_CLASS : PRINTER_PANEL_SHEET_SCRIM_CLASS} />
        <DialogPrimitive.Content data-ui="printer-panel" className={side ? PRINTER_PANEL_SIDE_CLASS : PRINTER_PANEL_SHEET_CLASS}>
          <div data-ui="printer-panel-head" className={PRINTER_PANEL_VIEW_HEAD_CLASS}>
            <div className={PRINTER_PANEL_HEAD_ROW_CLASS}>
              {onBack !== undefined && (
                <button type="button" data-ui="printer-panel-back" aria-label={backLabel} title={backLabel} className={PRINTER_PANEL_BACK_CLASS} onClick={onBack}>
                  <PanelBackIcon />
                </button>
              )}
              <div className={PRINTER_PANEL_HEAD_TEXT_CLASS}>
                <DialogPrimitive.Title data-ui="printer-panel-title" tabIndex={-1} className={PRINTER_PANEL_VIEW_TITLE_CLASS}>{title}</DialogPrimitive.Title>
                {sub !== undefined && <p data-ui="printer-panel-sub" className={PRINTER_PANEL_SUB_CLASS}>{sub}</p>}
              </div>
              <DialogPrimitive.Description className="sr-only">{DESCRIPTION}</DialogPrimitive.Description>
              <DialogPrimitive.Close aria-label="Close" title="Close" className={PRINTER_PANEL_CLOSE_CLASS}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div data-ui="printer-panel-body" className={PRINTER_PANEL_BODY_CLASS}>
            <div className={PRINTER_PANEL_COLUMN_CLASS}>{children}</div>
          </div>
          <div data-ui="printer-panel-foot" className={PRINTER_PANEL_FOOT_CLASS}>
            <div className={PRINTER_PANEL_COLUMN_CLASS}>
              {onCancel !== undefined ? (
                <button type="button" data-ui="printer-panel-cancel" className={PRINTER_PANEL_CANCEL_CLASS} onClick={onCancel}>
                  Cancel
                </button>
              ) : (
                <DialogPrimitive.Close data-ui="printer-panel-done" className={PRINTER_PANEL_DONE_CLASS}>
                  Done
                </DialogPrimitive.Close>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
