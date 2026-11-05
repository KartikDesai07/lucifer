"use client";

import type { ReactNode } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PRINTER_BUTTON_FIX_CLASS,
  PRINTER_STATUS_ACT_CLASS,
  PRINTER_STATUS_CARD_CLASS,
  PRINTER_STATUS_CIRCLE_CLASS,
  PRINTER_STATUS_DETAIL_CLASS,
  PRINTER_STATUS_HEAD_CLASS,
  PRINTER_STATUS_LINK_CLASS,
  PRINTER_STATUS_LOOK,
  PRINTER_STATUS_NOTE_CLASS,
  PRINTER_STATUS_STEP_CLASS,
  PRINTER_STATUS_STEP_NUM_CLASS,
  PRINTER_STATUS_STEPS_CLASS,
  PRINTER_STATUS_TOP_CLASS,
  PRINTER_TILE_BAD_CLASS,
  PRINTER_TILE_NEUTRAL_CLASS,
  PRINTER_TILE_OK_CLASS,
} from "@/components/print/printer-classes";
import type { PrinterStatusView, StatusActionKind, StatusLinkKind } from "@/lib/printer/printer-status-view";
import { cn } from "@/lib/utils";

// Printer UX PX-2 (spec §6.2; mockups s-off / s-ready / s-paper / s-none): the one card staff read when the printer
// stops. One line that says what is wrong, at most three steps, ONE button when a tap fixes it, one quiet link to the next
// step, or a note where nothing can be tapped. Props only (the words are printerStatusViewOf's): the panel owns what a tap
// does. role=status so a screen reader hears a change; the circle is decoration, the words carry the meaning.

const RECONNECTING_LABEL = "Reconnecting…";

// The "!" stroke, drawn by hand: lucide's circled alerts would put a ring inside the circle.
function Bang({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 8v5M12 16.5h.01" />
    </svg>
  );
}

// The view marks a bold word as **word**: drawn bold, never with its asterisks.
function marked(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export function PrinterStatusCard({ view, busy, onAction, onLink }: { view: PrinterStatusView; busy: boolean; onAction: (kind: StatusActionKind) => void; onLink: (kind: StatusLinkKind) => void }) {
  const look = PRINTER_STATUS_LOOK[view.tone];
  const checking = view.tone === "checking";
  const Icon = checking ? Loader2 : view.tone === "ok" ? Check : Bang;
  const { action, link } = view;
  const reconnecting = busy && action?.kind === "reconnect";
  return (
    <div role="status" aria-live="polite" data-ui="printer-status" className={cn(PRINTER_STATUS_CARD_CLASS, look.card)}>
      <div className={PRINTER_STATUS_TOP_CLASS}>
        <span aria-hidden="true" className={cn(PRINTER_STATUS_CIRCLE_CLASS, checking ? PRINTER_TILE_NEUTRAL_CLASS : view.tone === "ok" ? PRINTER_TILE_OK_CLASS : PRINTER_TILE_BAD_CLASS)}>
          <Icon className={cn(checking && "motion-safe:animate-spin")} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          {/* F-M6: the focus lands here when the Not printed card leaves while it held the focus. */}
          <p data-ui="printer-status-headline" tabIndex={-1} className={cn(PRINTER_STATUS_HEAD_CLASS, look.head)}>
            {view.headline}
          </p>
          {view.detail !== "" && <p className={PRINTER_STATUS_DETAIL_CLASS}>{marked(view.detail)}</p>}
        </div>
      </div>
      {view.steps.length > 0 && (
        <ol className={PRINTER_STATUS_STEPS_CLASS}>
          {view.steps.map((step, i) => (
            <li key={step} className={PRINTER_STATUS_STEP_CLASS}>
              <span aria-hidden="true" className={PRINTER_STATUS_STEP_NUM_CLASS}>
                {i + 1}
              </span>
              <span>{marked(step)}</span>
            </li>
          ))}
        </ol>
      )}
      {view.note !== null && <p className={PRINTER_STATUS_NOTE_CLASS}>{view.note}</p>}
      {(action !== null || link !== null) && (
        <div className={PRINTER_STATUS_ACT_CLASS}>
          {action !== null && (
            <Button type="button" className={PRINTER_BUTTON_FIX_CLASS} disabled={busy} onClick={() => onAction(action.kind)}>
              {reconnecting && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
              {reconnecting ? RECONNECTING_LABEL : action.label}
            </Button>
          )}
          {link !== null && (
            <button type="button" className={PRINTER_STATUS_LINK_CLASS} onClick={() => onLink(link.kind)}>
              {link.label}
              <ChevronRight aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
