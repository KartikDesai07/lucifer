"use client";

import { useState } from "react";
import { MonitorSmartphone } from "lucide-react";

import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PanelSection } from "@/components/print/PanelSection";
import { marked } from "@/components/print/PrinterStatusCard";
import {
  PRINTER_BUTTON_CANCEL_CLASS,
  PRINTER_BUTTON_CLASS,
  PRINTER_BUTTON_PRIMARY_CLASS,
  PRINTER_FIELD_TALL_CLASS,
  PRINTER_LABEL_CLASS,
  PRINTER_NOTE_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePrinterSetupActions } from "@/hooks/use-printer-setup-actions";
import { printForOthersViewOf, stopQuestionOf } from "@/lib/printer/settings-view";

// Mirrors PRINT_HOST_LABEL_MAX_CHARS, which lives in the server-only
// lib/print-host.ts (it imports a Mongoose model, so it cannot be imported
// into a client component).
const LABEL_MAX_CHARS = 60;
const TITLE = "Print for other devices";
const SUB = "Phones and tablets without a printer can send their slips here.";
const PRINT_ALL_ON_THIS = "Print all slips on this device";
const PRINT_ALL_HERE = "Print all slips here";
const PRINT_HERE_INSTEAD = "Print here instead";
const STOP = "Stop printing here";
const HOST_LINE = "This device prints slips for **all devices**.";
const PRINTERS_MODE_LINE = "Printers are set up: each slip prints at its own printer.";
const NO_HOST_REASON = "No printing device is set.";

// "Print for other devices" (PX-3 Task 10, spec §6.6 item 3; mockups t-settings / t-host; was "Where slips print"): whether
// this device prints every device's slips. None set → offer it (a name, then Print all slips here); this device → Stop;
// another device → Move. Printers mode hides it, except on a former printing device (it can still stop). The writes and
// their toasts are the hook's; the words of each state come from printForOthersViewOf.
export function PrintForOthersCard() {
  const actions = usePrinterSetupActions();
  const { host, label, setLabel, designate, designating, clear, clearing } = actions;
  const view = printForOthersViewOf(actions);
  const [naming, setNaming] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  if (view.kind === "hidden") return null;

  // The status card's "print here" fixes focus this (data-action): one per state that designates.
  const designateButton = (text: string, onClick: () => void, primary = false) => (
    <Button data-action="designate" variant={primary ? "default" : "outline"} className={primary ? PRINTER_BUTTON_PRIMARY_CLASS : PRINTER_BUTTON_CLASS} onClick={onClick} disabled={designating}>
      {designating ? "Saving…" : text}
    </Button>
  );
  // B10: printers mode's stop cancels nothing, so its question never says so.
  const stopControl = (printersMode: boolean) =>
    confirmStop ? (
      <InlineConfirm
        question={stopQuestionOf(printersMode)}
        yes={printersMode ? "Yes, stop" : "Yes, remove"}
        no="No"
        disabled={clearing}
        onYes={() => {
          setConfirmStop(false);
          void clear();
        }}
        onNo={() => setConfirmStop(false)}
      />
    ) : (
      <>
        <Button variant="outline" className={PRINTER_BUTTON_CLASS} onClick={() => setConfirmStop(true)} disabled={clearing || host?.configured === false}>
          {STOP}
        </Button>
        {host?.configured === false && <p className={PRINTER_NOTE_CLASS}>{NO_HOST_REASON}</p>}
      </>
    );

  const withSub = view.kind === "offer" || view.kind === "checking";
  return (
    <PanelSection id="printer-where" icon={<MonitorSmartphone />} title={TITLE} sub={withSub ? SUB : undefined}>
      {view.kind === "checking" && <p role="status" className="text-muted-foreground">{view.text}</p>}
      {view.kind === "offer" &&
        (naming ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={PRINTER_LABEL_CLASS}>Name for this device</span>
              <Input value={label} maxLength={LABEL_MAX_CHARS} onChange={(e) => setLabel(e.target.value)} className={PRINTER_FIELD_TALL_CLASS} />
            </label>
            <div className="flex flex-wrap gap-2">
              {designateButton(PRINT_ALL_HERE, () => void designate(), true)}
              <Button variant="outline" className={PRINTER_BUTTON_CANCEL_CLASS} onClick={() => setNaming(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          designateButton(PRINT_ALL_ON_THIS, () => setNaming(true))
        ))}
      {view.kind === "host" && (
        <>
          <p>{marked(view.printersMode ? PRINTERS_MODE_LINE : HOST_LINE)}</p>
          {stopControl(view.printersMode)}
        </>
      )}
      {view.kind === "elsewhere" && (
        <>
          <p>{marked(`Slips print at **${view.host}**.`)}</p>
          {confirmMove ? (
            <InlineConfirm
              question={`${view.host} is printing now. Move printing to this device?`}
              yes="Yes, move"
              no="No"
              disabled={designating}
              onYes={() => {
                setConfirmMove(false);
                void designate();
              }}
              onNo={() => setConfirmMove(false)}
            />
          ) : (
            // The printing device is offline: nothing to interrupt, so it designates at once (today's rule).
            designateButton(PRINT_HERE_INSTEAD, () => (view.online ? setConfirmMove(true) : void designate()))
          )}
        </>
      )}
    </PanelSection>
  );
}
