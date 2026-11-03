"use client";

import { useRef, type FormEventHandler, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { keepOpenForNestedDialog } from "@/lib/nested-dialog";
import {
  MENU_EDITOR_BODY_CLASS,
  MENU_EDITOR_CLOSE_CLASS,
  MENU_EDITOR_FORM_CLASS,
  MENU_EDITOR_HEAD_CLASS,
  MENU_EDITOR_SCRIM_CLASS,
  MENU_EDITOR_SHEET_CLASS,
  MENU_EDITOR_SHEET_SCRIM_CLASS,
  MENU_EDITOR_SUB_CLASS,
  MENU_EDITOR_TITLE_CLASS,
  MENU_EDITOR_XL_QUERY,
} from "@/lib/menu-editor-layout";
import { RES_FORM_FOOT_CLASS, RES_FORM_SIDE_CLASS } from "@/lib/reservation-form-layout";

interface ReservationFormFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sub: string;
  /** The footer's summary and Save. */
  footer: ReactNode;
  children: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

/** The reservation form's frame (values 13.1; design 8.1): U5's editor at the HTML's 480px, a right aside from 1280px and U2's
 *  full-screen bottom sheet below; one Radix dialog whose classes follow the width, so a resize never remounts the form. A press
 *  that lands in a dialog opened over it (the delete confirm) never closes it. Radix's own open focus stays, so the Mobile
 *  number (autoFocus) takes it; the opener is remembered and refocused on close. */
export function ReservationFormFrame({ open, onOpenChange, title, sub, footer, children, onSubmit }: ReservationFormFrameProps) {
  const side = useMediaQuery(MENU_EDITOR_XL_QUERY);
  const panelRef = useRef<HTMLDivElement>(null);
  // Read on the render that opens the form, before anything inside mounts and takes the focus.
  const openerRef = useRef<HTMLElement | null>(null);
  if (open && openerRef.current === null && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    openerRef.current = document.activeElement;
  }
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="reservation-form-scrim" className={side ? MENU_EDITOR_SCRIM_CLASS : MENU_EDITOR_SHEET_SCRIM_CLASS} />
        <DialogPrimitive.Content
          ref={panelRef}
          data-ui="reservation-form"
          className={side ? RES_FORM_SIDE_CLASS : MENU_EDITOR_SHEET_CLASS}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
            openerRef.current = null;
          }}
          onInteractOutside={(e) => keepOpenForNestedDialog(e, panelRef.current)}
        >
          <div data-ui="reservation-form-head" className={MENU_EDITOR_HEAD_CLASS}>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className={cn(MENU_EDITOR_TITLE_CLASS, "tracking-[-.01em]")}>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={MENU_EDITOR_SUB_CLASS}>{sub}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Close" title="Close" className={MENU_EDITOR_CLOSE_CLASS}>
              ✕
            </DialogPrimitive.Close>
          </div>
          <form data-ui="reservation-form-form" className={MENU_EDITOR_FORM_CLASS} onSubmit={onSubmit} noValidate>
            <div data-ui="reservation-form-body" className={MENU_EDITOR_BODY_CLASS}>
              {children}
            </div>
            <div data-ui="reservation-form-foot" className={RES_FORM_FOOT_CLASS}>
              {footer}
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
