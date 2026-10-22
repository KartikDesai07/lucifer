"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { SHEET_PANEL_BASE, SHEET_SCRIM_BASE } from "@/lib/sheet-frame";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  /** "sheet" = the owner's HTML confirm (U1 Task 12; only the POS prompts and the send-discard confirm ask for it). */
  look?: "default" | "sheet";
}

// The HTML confirm (values 12.1 in docs/superpowers/specs/2026-10-20-pos-html-values.md; values 0.3 sheetAlign /
// sheetPad / sheetRadius; design 3, 6.12) in the shared sheet frame (lib/sheet-frame.ts, ruling P54). The scrim at
// z-index 50; the panel 420px on --surface with a 1px --border, padding 20, the text and the buttons 16px apart,
// sheetIn .34s, content-sized (no cap: two lines and two buttons).
const SHEET_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");
const SHEET_PANEL_CLASS = cn(SHEET_PANEL_BASE, "max-w-[420px] gap-4 border border-border p-5 motion-safe:animate-sheet-in");
// The title 18px 600 -.01em; the body 14px --text-2 6px under it at 1.5, wrapped "pretty".
const SHEET_TITLE_CLASS = "text-[18px] font-semibold tracking-[-0.01em]";
const SHEET_BODY_CLASS = "mt-1.5 text-[14px] leading-[1.5] text-pretty text-muted-foreground";
// The buttons stacked 8px apart: 46px, a 1px rule, radius 10, 14.5px 600, the UA's 1px 6px (the HTML sets none); the
// spinner and the label centred in one row. The action in --accent (kind 1), or --bad with white text when it is
// destructive (design 6.12); Cancel in --surface-3 (kind 0). No hover look (the HTML's has none); off at .5.
const SHEET_BUTTONS_CLASS = "flex flex-col gap-2";
const SHEET_BUTTON_CLASS =
  "flex h-[46px] w-full cursor-pointer items-center justify-center rounded-[10px] border px-1.5 py-px text-[14.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const SHEET_ACTION_CLASS = "border-primary bg-primary text-primary-foreground";
const SHEET_DESTRUCTIVE_CLASS = "border-status-bad bg-status-bad text-white";
const SHEET_CANCEL_CLASS = "border-transparent bg-surface-3 text-foreground";

type ConfirmSheetProps = Required<Omit<ConfirmDialogProps, "description" | "look">> & Pick<ConfirmDialogProps, "description">;

// The same alert dialog in the HTML's confirm sheet: role alertdialog, the focus on Cancel as it opens, Escape = Cancel,
// an outside tap does not dismiss it; the action keeps it open while it runs (the caller closes it), with today's
// spinner.
function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  isLoading,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay data-ui="confirm-sheet" className={SHEET_SCRIM_CLASS}>
          <AlertDialogPrimitive.Content data-ui="confirm-panel" className={SHEET_PANEL_CLASS}>
            <div data-ui="confirm-text">
              <AlertDialogPrimitive.Title className={SHEET_TITLE_CLASS}>{title}</AlertDialogPrimitive.Title>
              {description && (
                <AlertDialogPrimitive.Description className={SHEET_BODY_CLASS}>{description}</AlertDialogPrimitive.Description>
              )}
            </div>
            <div data-ui="confirm-buttons" className={SHEET_BUTTONS_CLASS}>
              <AlertDialogPrimitive.Action
                data-ui="confirm-action"
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
                disabled={isLoading}
                className={cn(SHEET_BUTTON_CLASS, destructive ? SHEET_DESTRUCTIVE_CLASS : SHEET_ACTION_CLASS, BRAND_PRESS_CLASS)}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {confirmLabel}
              </AlertDialogPrimitive.Action>
              <AlertDialogPrimitive.Cancel
                data-ui="confirm-cancel"
                disabled={isLoading}
                className={cn(SHEET_BUTTON_CLASS, SHEET_CANCEL_CLASS, BRAND_PRESS_CLASS)}
              >
                {cancelLabel}
              </AlertDialogPrimitive.Cancel>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

// Shared confirmation modal for destructive/irreversible actions (CLAUDE.md §10
// — Dialog for confirmations). Used by every management page's delete action.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  isLoading = false,
  onConfirm,
  look = "default",
}: ConfirmDialogProps) {
  if (look === "sheet") {
    return (
      <ConfirmSheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive={destructive}
        isLoading={isLoading}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {cancelLabel}
          </AlertDialogCancel>
          {/* Keep the dialog open while the mutation runs; the caller closes it. */}
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isLoading}
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
