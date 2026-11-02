"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import {
  PRINTER_PANEL_BODY_CLASS,
  PRINTER_PANEL_CLOSE_CLASS,
  PRINTER_PANEL_DONE_CLASS,
  PRINTER_PANEL_FOOT_CLASS,
  PRINTER_PANEL_HEAD_CLASS,
  PRINTER_PANEL_SCRIM_CLASS,
  PRINTER_PANEL_SHEET_CLASS,
  PRINTER_PANEL_SHEET_SCRIM_CLASS,
  PRINTER_PANEL_SIDE_CLASS,
  PRINTER_PANEL_SUB_CLASS,
  PRINTER_PANEL_TITLE_CLASS,
  PRINTER_PANEL_XL_QUERY,
} from "@/components/print/printer-classes";
import { useMediaQuery } from "@/hooks/use-media-query";

const TITLE = "Printer";
const SUB = "Printer status and setup for this device";

interface PrinterPanelFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The header's printer button: the dialog's trigger, so it keeps its aria-expanded and gets the focus back on close. */
  trigger?: ReactNode;
  children: ReactNode;
}

// The printer panel's frame (values 16; design 7.1; owner rule 2026-10-22): the HTML's 420px aside over its scrim from 1280px,
// U2's full-screen bottom sheet below; ONE Radix dialog whose classes follow the width, so a window resized while it is open
// re-frames it without losing the panel's state or mounting a second one. Head, the one scroller, the fixed Done foot (it
// closes). Escape, the close, Done and a tap on the scrim close it (the bottom sheet has no scrim). On /printers the panel is
// inline and has no frame.
export function PrinterPanelFrame({ open, onOpenChange, trigger, children }: PrinterPanelFrameProps) {
  const side = useMediaQuery(PRINTER_PANEL_XL_QUERY);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="printer-panel-scrim" className={side ? PRINTER_PANEL_SCRIM_CLASS : PRINTER_PANEL_SHEET_SCRIM_CLASS} />
        <DialogPrimitive.Content data-ui="printer-panel" className={side ? PRINTER_PANEL_SIDE_CLASS : PRINTER_PANEL_SHEET_CLASS}>
          <div data-ui="printer-panel-head" className={PRINTER_PANEL_HEAD_CLASS}>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className={PRINTER_PANEL_TITLE_CLASS}>{TITLE}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={PRINTER_PANEL_SUB_CLASS}>{SUB}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Close" title="Close" className={PRINTER_PANEL_CLOSE_CLASS}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </DialogPrimitive.Close>
          </div>
          <div data-ui="printer-panel-body" className={PRINTER_PANEL_BODY_CLASS}>
            {children}
          </div>
          <div data-ui="printer-panel-foot" className={PRINTER_PANEL_FOOT_CLASS}>
            <DialogPrimitive.Close data-ui="printer-panel-done" className={PRINTER_PANEL_DONE_CLASS}>
              Done
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
