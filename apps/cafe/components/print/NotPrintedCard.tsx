"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PRINTER_BUTTON_CONFIRM_CLASS,
  PRINTER_BUTTON_DANGER_CLASS,
  PRINTER_BUTTON_SLIP_CLASS,
  PRINTER_NOT_PRINTED_BUBBLE_CLASS,
  PRINTER_NOT_PRINTED_BUTTONS_CLASS,
  PRINTER_NOT_PRINTED_CARD_CLASS,
  PRINTER_NOT_PRINTED_CONFIRM_CLASS,
  PRINTER_NOT_PRINTED_CONFIRM_ROW_CLASS,
  PRINTER_NOT_PRINTED_HEAD_CLASS,
  PRINTER_NOT_PRINTED_LABEL_CLASS,
  PRINTER_NOT_PRINTED_LIST_CLASS,
  PRINTER_NOT_PRINTED_META_CLASS,
  PRINTER_NOT_PRINTED_MORE_CLASS,
  PRINTER_NOT_PRINTED_ROW_CLASS,
  PRINTER_NOT_PRINTED_ROW_WRAP_CLASS,
  PRINTER_NOT_PRINTED_SHOW_CLASS,
  PRINTER_NOT_PRINTED_STRONG_CLASS,
  PRINTER_NOT_PRINTED_SUMMARY_CLASS,
  PRINTER_NOT_PRINTED_TEXT_CLASS,
  PRINTER_NOT_PRINTED_TITLE_CLASS,
  PRINTER_NOT_PRINTED_TONE,
} from "@/components/print/printer-classes";
import { NOT_PRINTED_ACTION_WORDS, NOT_PRINTED_SHOWN, type NotPrintedAction, type NotPrintedRow, type NotPrintedView } from "@/lib/print-waiting-view";
import { cn } from "@/lib/utils";

// Printer UX, PX-2 Task 4 (spec §6.3): the "Not printed" card. Props only: it draws what notPrintedViewOf says (the
// rows, their words and the only buttons that work for each), so a Print button on a slip that prints by itself cannot
// come back through markup. Five rows, then "Show all": the sheet is the one scroller, never a list inside it.
// NotPrintedSection holds every state (the tapped rows, expanded, the confirm, the Clear all in flight).

export interface NotPrintedCardProps {
  view: NotPrintedView;
  expanded: boolean;
  onExpanded(next: boolean): void;
  confirming: boolean;
  onClearAll(): void;
  onConfirm(yes: boolean): void;
  busy: boolean;
  tapped: ReadonlySet<string>;
  onAction(id: string, action: NotPrintedAction): void;
}

const TITLE = "Not printed";

/** "{age} · {strong} {reason}": a failed slip with no safe words of its own ends at its bold part, never at " · ". */
function Meta({ row }: { row: NotPrintedRow }) {
  return (
    <p className={cn(PRINTER_NOT_PRINTED_META_CLASS, row.tone !== null && PRINTER_NOT_PRINTED_TONE[row.tone])}>
      {`${row.age} · `}
      {row.strong !== null && <b className={PRINTER_NOT_PRINTED_STRONG_CLASS}>{row.strong}</b>}
      {row.strong !== null && row.reason !== "" ? ` ${row.reason}` : row.reason}
    </p>
  );
}

export function NotPrintedCard({ view, expanded, onExpanded, confirming, onClearAll, onConfirm, busy, tapped, onAction }: NotPrintedCardProps) {
  const folds = view.rows.length > NOT_PRINTED_SHOWN;
  const shown = folds && !expanded ? view.rows.slice(0, NOT_PRINTED_SHOWN) : view.rows;
  const question = `Clear all ${view.ids.length} slips? They will not print.`;
  return (
    <section aria-label={TITLE} className={PRINTER_NOT_PRINTED_CARD_CLASS}>
      <div className={PRINTER_NOT_PRINTED_HEAD_CLASS}>
        <div className="min-w-0 flex-1">
          <h3 className={PRINTER_NOT_PRINTED_TITLE_CLASS}>
            {TITLE}
            <span className={PRINTER_NOT_PRINTED_BUBBLE_CLASS}>{view.badge}</span>
          </h3>
          <p className={PRINTER_NOT_PRINTED_SUMMARY_CLASS}>{view.summary}</p>
        </div>
        {!confirming && (
          <Button variant="outline" className={PRINTER_BUTTON_SLIP_CLASS} onClick={onClearAll}>
            Clear all
          </Button>
        )}
      </div>
      {confirming && (
        // Inline, not a layer over the sheet (PX-D4); Cancel takes the focus when it opens, so a slip is never cleared by a stray Enter.
        <div role="group" aria-label={question} className={PRINTER_NOT_PRINTED_CONFIRM_CLASS}>
          <p>{question}</p>
          <div className={PRINTER_NOT_PRINTED_CONFIRM_ROW_CLASS}>
            <Button className={PRINTER_BUTTON_DANGER_CLASS} disabled={busy} onClick={() => onConfirm(true)}>
              Clear all
            </Button>
            <Button variant="outline" className={PRINTER_BUTTON_CONFIRM_CLASS} disabled={busy} autoFocus onClick={() => onConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ul className={PRINTER_NOT_PRINTED_LIST_CLASS}>
        {shown.map((row) => (
          <li key={row.id} className={cn(PRINTER_NOT_PRINTED_ROW_CLASS, row.actions.length > 2 && PRINTER_NOT_PRINTED_ROW_WRAP_CLASS)}>
            <div className={PRINTER_NOT_PRINTED_TEXT_CLASS}>
              <p className={PRINTER_NOT_PRINTED_LABEL_CLASS}>{row.label}</p>
              <Meta row={row} />
            </div>
            <div className={PRINTER_NOT_PRINTED_BUTTONS_CLASS}>
              {row.actions.map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  className={PRINTER_BUTTON_SLIP_CLASS}
                  disabled={tapped.has(row.id)}
                  aria-label={`${NOT_PRINTED_ACTION_WORDS[action]} ${row.label}`}
                  onClick={() => onAction(row.id, action)}
                >
                  {NOT_PRINTED_ACTION_WORDS[action]}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {folds && (
        <div className={PRINTER_NOT_PRINTED_MORE_CLASS}>
          <button type="button" aria-expanded={expanded} className={PRINTER_NOT_PRINTED_SHOW_CLASS} onClick={() => onExpanded(!expanded)}>
            {expanded ? "Show fewer" : `Show all ${view.rows.length}`}
            {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
        </div>
      )}
    </section>
  );
}
