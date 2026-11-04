"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  PRINTER_ACTION_CLASS,
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
  PRINTER_WAITING_CARD_CLASS,
  PRINTER_WAITING_ROW_CLASS,
} from "@/components/print/printer-classes";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cachedTab } from "@/hooks/use-offline-fix";
import { useOfflineOutbox } from "@/hooks/use-offline-outbox";
import { useReplayBlocked, useReplayGate } from "@/hooks/use-offline-replay";
import { useOfflinePrintHere } from "@/hooks/use-offline-send";
import { useServerReach } from "@/hooks/use-server-reach";
import { offlineFixes } from "@/lib/offline-fix";
import { removeNote } from "@/lib/offline-outbox";
import {
  OFFLINE_PRINT_HERE_WARNING,
  offlineBannerOf,
  offlineCountOf,
  offlineDiscard,
  offlineDiscardRefusal,
  offlineRowsOf,
  offlineSendAgain,
  type OfflineRow,
} from "@/lib/offline-orders-view";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn } from "@/lib/utils";

const TITLE = "Offline orders";
const SUB = "Kept on this device until the server has them";
const CHIP_CLASS = cn(
  "h-9 flex-none whitespace-nowrap rounded-[8px] border border-[rgba(255,131,43,.45)] px-3 text-[13px] font-semibold",
  STATUS_CLASSES.warn.tint,
  STATUS_CLASSES.warn.ink,
);
const BANNER_CLASS = cn("rounded-[10px] px-3 py-2.5 text-[13px] font-medium", STATUS_CLASSES.warn.tint, STATUS_CLASSES.warn.ink);

type Asked = { kind: "discard" | "print"; row: OfflineRow };

// Printing Phase 5 (spec 5.8, 5.10; plan Task 14): the header's "Offline orders · n" chip beside the printer button,
// shown while any offline order or note remains, and its list in the printer panel's frame (values 16: the 420px aside
// over its scrim from 1280px, the full-screen bottom sheet below). Each entry: its state, and Fix and send / Send again
// (after the server refused it), Print KOT here (a half-way send), Discard (confirmed in spec 5.8's words); the notes.
// The chip alone is mounted on every page (one outbox read, no request); the list and its actions mount with the panel.
export function OfflineOrdersSheet() {
  const { record, unreadable } = useOfflineOutbox();
  const side = useMediaQuery(PRINTER_PANEL_XL_QUERY);
  const [open, setOpen] = useState(false);
  const count = offlineCountOf(record);
  if (count === 0 && !unreadable) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" data-ui="offline-orders-chip" className={cn(CHIP_CLASS, HTML_PRESS_CLASS)} aria-label={`${TITLE}: ${count}`}>
          {TITLE} · {count}
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={side ? PRINTER_PANEL_SCRIM_CLASS : PRINTER_PANEL_SHEET_SCRIM_CLASS} />
        <DialogPrimitive.Content data-ui="offline-orders-panel" className={side ? PRINTER_PANEL_SIDE_CLASS : PRINTER_PANEL_SHEET_CLASS}>
          <OfflineOrdersPanel onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function OfflineOrdersPanel({ onClose }: { onClose: () => void }) {
  const { record, unreadable, update } = useOfflineOutbox();
  const { offline } = useServerReach();
  // The last pulse's offlineReplay, from the runner (a narrow store: no pulse context of its own).
  const gate = useReplayGate();
  const blocked = useReplayBlocked();
  const printHere = useOfflinePrintHere();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [asked, setAsked] = useState<Asked | null>(null);

  const rows = offlineRowsOf(record);
  const notes = record?.notes ?? [];
  const banner = offlineBannerOf({ offline, offlineReplay: gate.offlineReplay, pulseKnown: gate.known, blocked, unreadable, entries: rows.length });
  const entryOf = (key: string) => record?.entries.find((entry) => entry.key === key);

  // Fix and send: the entry opens in the POS cart (hooks/use-offline-fix.ts takes it there).
  const fix = (key: string) => {
    const entry = entryOf(key);
    if (entry === undefined) return;
    offlineFixes.request(entry);
    onClose();
    if (pathname !== "/pos") router.push("/pos");
  };
  const confirmAsked = () => {
    if (asked === null) return;
    const { kind, row } = asked;
    setAsked(null);
    if (kind === "discard") {
      // The 5C review's I1: read inside the outbox lock: an entry the runner took meanwhile stays, and staff are told.
      let refused: string | null = null;
      void update((r) => {
        refused = offlineDiscardRefusal(r, row.key);
        return refused === null ? offlineDiscard(r, row.key) : null;
      }).then(() => {
        if (refused !== null) toast.error(refused);
      });
      return;
    }
    const entry = entryOf(row.key);
    if (entry !== undefined) void printHere(row.key, entry.kind === "round" ? cachedTab(qc, entry.orderId) : null);
  };

  return (
    <>
    <div className={PRINTER_PANEL_HEAD_CLASS}>
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
    <div className={PRINTER_PANEL_BODY_CLASS}>
      {banner !== null && <p data-ui="offline-orders-banner" className={BANNER_CLASS}>{banner}</p>}
      {rows.length > 0 && (
        <ul aria-label={TITLE} className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} data-ui="offline-order" className={PRINTER_WAITING_ROW_CLASS}>
              <p className="text-[14px] font-semibold">{row.title}</p>
              <p className="text-[12.5px] text-subtle-foreground">{row.detail}</p>
              <p className={cn("mt-1 text-[13px]", row.state === "needs-staff" ? cn("font-medium", STATUS_CLASSES.warn.ink) : "text-muted-foreground")}>{row.status}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {row.actions.fix && (
                  <Button className={PRINTER_ACTION_CLASS} aria-label={`Fix and send ${row.ref}`} onClick={() => fix(row.key)}>
                    Fix and send
                  </Button>
                )}
                {row.actions.again && (
                  <Button variant="outline" className={PRINTER_ACTION_CLASS} aria-label={`Send again ${row.ref}`} onClick={() => void update((r) => offlineSendAgain(r, row.key))}>
                    Send again
                  </Button>
                )}
                {row.actions.printHere && (
                  <Button variant="outline" className={PRINTER_ACTION_CLASS} aria-label={`Print KOT here ${row.ref}`} onClick={() => setAsked({ kind: "print", row })}>
                    Print KOT here
                  </Button>
                )}
                {row.actions.discard && (
                  <Button variant="outline" className={PRINTER_ACTION_CLASS} aria-label={`Discard ${row.ref}`} onClick={() => setAsked({ kind: "discard", row })}>
                    Discard
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <section aria-label="Notes" className={PRINTER_WAITING_CARD_CLASS}>
          <h3 className={cn("text-[14px] font-semibold", STATUS_CLASSES.warn.ink)}>Notes</h3>
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.key} className={cn(PRINTER_WAITING_ROW_CLASS, "flex items-center gap-3")}>
                <p className="min-w-0 flex-1 text-[13.5px]">{note.text}</p>
                <Button variant="outline" className={PRINTER_ACTION_CLASS} aria-label={`Dismiss: ${note.text}`} onClick={() => void update((r) => removeNote(r, note.key))}>
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
    <div className={PRINTER_PANEL_FOOT_CLASS}>
      <DialogPrimitive.Close className={PRINTER_PANEL_DONE_CLASS}>Done</DialogPrimitive.Close>
    </div>
    <ConfirmDialog
      open={asked !== null}
      onOpenChange={(next) => {
        if (!next) setAsked(null);
      }}
      title={asked?.kind === "print" ? `Print KOT ${asked.row.ref} here?` : `Discard ${asked?.row.ref ?? ""}?`}
      description={asked?.kind === "print" ? OFFLINE_PRINT_HERE_WARNING : asked?.row.discardWords}
      confirmLabel={asked?.kind === "print" ? "Print KOT here" : "Discard"}
      cancelLabel="Keep"
      destructive={asked?.kind === "discard"}
      onConfirm={confirmAsked}
    />
    </>
  );
}
