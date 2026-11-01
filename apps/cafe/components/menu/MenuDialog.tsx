"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { useOpenerFocus } from "@/hooks/use-opener-focus";
import {
  MENU_DIALOG_BOX_CLASS,
  MENU_DIALOG_CLOSE_CLASS,
  MENU_DIALOG_HEAD_CLASS,
  MENU_DIALOG_SCRIM_CLASS,
  MENU_DIALOG_SUB_CLASS,
  MENU_DIALOG_TITLE_CLASS,
} from "@/lib/menu-editor-layout";
import { cn } from "@/lib/utils";

interface MenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The sub line (13px --text-2): today's description. */
  sub: ReactNode;
  /** Extra classes for the box (the import wizard's width). */
  className?: string;
  children: ReactNode;
}

// The HTML's dialog box (values 10; design 6.9): 440px, radius 14, padding 20, 16px apart, centred; the phone's bottom sheet
// with the inset. The head is the HTML's (title 18px 600, sub 13px --text-2, the 32px round close); the contents are today's.
// It lies over the item editor (z 50 over its 46): a press in it never closes the editor (the editor's own guard).
export function MenuDialog({ open, onOpenChange, title, sub, className, children }: MenuDialogProps) {
  const openerFocus = useOpenerFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="menu-dialog-scrim" className={MENU_DIALOG_SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="menu-dialog" {...openerFocus} className={cn(MENU_DIALOG_BOX_CLASS, className)}>
            <div className={MENU_DIALOG_HEAD_CLASS}>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className={MENU_DIALOG_TITLE_CLASS}>{title}</DialogPrimitive.Title>
                <DialogPrimitive.Description className={MENU_DIALOG_SUB_CLASS}>{sub}</DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close aria-label="Close" title="Close" className={MENU_DIALOG_CLOSE_CLASS}>
                ✕
              </DialogPrimitive.Close>
            </div>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
