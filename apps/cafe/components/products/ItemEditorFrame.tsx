"use client";

import { useRef, type FormEventHandler, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { keepOpenForNestedDialog } from "@/lib/nested-dialog";
import {
  MENU_EDITOR_BODY_CLASS,
  MENU_EDITOR_CANCEL_CLASS,
  MENU_EDITOR_CLOSE_CLASS,
  MENU_EDITOR_FOOT_CLASS,
  MENU_EDITOR_FORM_CLASS,
  MENU_EDITOR_HEAD_CLASS,
  MENU_EDITOR_SAVE_CLASS,
  MENU_EDITOR_SCRIM_CLASS,
  MENU_EDITOR_SHEET_CLASS,
  MENU_EDITOR_SHEET_SCRIM_CLASS,
  MENU_EDITOR_SIDE_CLASS,
  MENU_EDITOR_SUB_CLASS,
  MENU_EDITOR_TITLE_CLASS,
  MENU_EDITOR_XL_QUERY,
} from "@/lib/menu-editor-layout";

interface ItemEditorFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sub: string;
  footer: ReactNode;
  children: ReactNode;
  /** The form's submit (the footer's Save is its submit button). */
  onSubmit?: FormEventHandler<HTMLFormElement>;
}

// The item editor's frame (values 9.1; design 6.9; owner rule 2026-10-22): the HTML's 500px aside over its scrim from 1280px,
// U2's full-screen bottom sheet below; one Radix dialog whose classes follow the width, so a resize never remounts the form.
// A press that lands in a dialog opened over it (the icon picker, the archive confirm) never closes it.
export function ItemEditorFrame({ open, onOpenChange, title, sub, footer, children, onSubmit }: ItemEditorFrameProps) {
  const side = useMediaQuery(MENU_EDITOR_XL_QUERY);
  // The panel takes the focus as it opens (no ring on the first field, no phone keyboard: the HTML shows no focused field) and
  // the focus goes back to what opened it (U1 ruling P22).
  const openerFocus = useOpenerFocus();
  const panelRef = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="item-editor-scrim" className={side ? MENU_EDITOR_SCRIM_CLASS : MENU_EDITOR_SHEET_SCRIM_CLASS} />
        <DialogPrimitive.Content
          ref={panelRef}
          {...openerFocus}
          data-ui="item-editor"
          className={side ? MENU_EDITOR_SIDE_CLASS : MENU_EDITOR_SHEET_CLASS}
          onInteractOutside={(e) => keepOpenForNestedDialog(e, panelRef.current)}
        >
          <div data-ui="item-editor-head" className={MENU_EDITOR_HEAD_CLASS}>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className={MENU_EDITOR_TITLE_CLASS}>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={MENU_EDITOR_SUB_CLASS}>{sub}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Close" title="Close" className={MENU_EDITOR_CLOSE_CLASS}>
              ✕
            </DialogPrimitive.Close>
          </div>
          <form data-ui="item-editor-form" className={MENU_EDITOR_FORM_CLASS} onSubmit={onSubmit} noValidate>
            <div data-ui="item-editor-body" className={MENU_EDITOR_BODY_CLASS}>
              {children}
            </div>
            <div data-ui="item-editor-foot" className={MENU_EDITOR_FOOT_CLASS}>
              {footer}
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The footer's two buttons (values 9.1): Cancel (closes, as the close) and Save (submits; off with a spinner while it runs). */
export function ItemEditorFooter({ onCancel, saving, submitLabel }: { onCancel: () => void; saving: boolean; submitLabel: string }) {
  return (
    <>
      <button type="button" data-ui="item-editor-cancel" className={MENU_EDITOR_CANCEL_CLASS} onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" data-ui="item-editor-save" className={MENU_EDITOR_SAVE_CLASS} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {submitLabel}
      </button>
    </>
  );
}
