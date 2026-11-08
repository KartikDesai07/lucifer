"use client";

import { useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";

import type { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  REFRESH_CONFIRM_TITLE,
  REFRESH_OFFLINE_MESSAGE,
  REFRESH_PRINTING_MESSAGE,
  REFRESH_PRINT_CANCEL,
  REFRESH_PRINT_CONFIRM,
  REFRESH_PRINT_QUESTION,
  REFRESH_PRINT_TITLE,
  REFRESH_SETTLE_MS,
  clearDeliberateReload,
  markDeliberateReload,
  printHoldOf,
  refreshQuestion,
  reloadStep,
  unsentWork,
  type UnsentWork,
} from "@/lib/page-refresh";
import { closePrintHost, printHostBusySince } from "@/lib/print-host-busy";
import { serverReach } from "@/lib/server-reach";

// The one ask-first rule for a reload staff ask for: the POS app's Refresh button (the owner, 2026-10-03) and the
// header's "Update ready · Reload" chip (P2 N4, the review's R54), so the two can never drift apart. Offline (the
// page's own offline state or the browser's flag, the reading a tap uses: R59) it says so instead of reloading into an
// error screen; while a slip prints here it says so too (a hold of 30 s or more asks "Refresh anyway" instead, once per
// hold, R72); with work a reload would lose (lib/page-refresh.ts) it asks
// first; confirmed, or with nothing to lose, it tells the page's own leave warning the reload is deliberate (no second,
// native question), runs `beforeReload` (the chip keeps the build it goes to), starts no new print lease or claim
// (lib/print-host-busy.ts) and reloads. A reload that has not torn
// the page down after REFRESH_SETTLE_MS did not happen: the caller's button lets go.

export interface AskFirstReload {
  /** True from the reload until the page goes (or REFRESH_SETTLE_MS passes). */
  reloading: boolean;
  /** The tap. */
  press: () => void;
  /** The question, spread onto the shared ConfirmDialog. */
  dialog: ComponentProps<typeof ConfirmDialog>;
}

export function useAskFirstReload(beforeReload?: () => void): AskFirstReload {
  const [asking, setAsking] = useState<UnsentWork | "print" | null>(null);
  // The stuck hold the print question was opened for, and the one staff said "Refresh anyway" to (their start times).
  const asked = useRef<number | null>(null);
  const waived = useRef<number | null>(null);
  const [reloading, setReloading] = useState(false);

  const reload = () => {
    setAsking(null);
    setReloading(true);
    markDeliberateReload();
    window.setTimeout(() => {
      clearDeliberateReload();
      setReloading(false);
    }, REFRESH_SETTLE_MS);
    beforeReload?.();
    closePrintHost();
    window.location.reload();
  };
  // The tap, and again each question's confirm (`confirmWork`: the work it asked about is now staff's choice;
  // `confirmPrint`: this stuck hold is waived), so going offline or a new slip starting while a question was open is
  // said, never reloaded under (R66). The waiver covers only the hold the question was about: a newer one is judged
  // afresh (R72).
  const decide = (confirmWork: boolean, confirmPrint: boolean) => {
    if (confirmPrint) waived.current = asked.current;
    const offline = serverReach.isOffline() || navigator.onLine === false;
    const since = printHostBusySince();
    const hold = printHoldOf(since, Date.now(), waived.current);
    const step = reloadStep(!offline, confirmWork ? null : unsentWork(), hold.printing, hold.stuck, hold.waived);
    if (step.kind === "offline") {
      setAsking(null);
      toast.error(REFRESH_OFFLINE_MESSAGE);
      return;
    }
    if (step.kind === "printing") {
      setAsking(null);
      toast(REFRESH_PRINTING_MESSAGE);
      return;
    }
    if (step.kind === "ask-print") {
      asked.current = since;
      setAsking("print");
      return;
    }
    if (step.kind === "ask") {
      setAsking(step.work);
      return;
    }
    reload();
  };
  const press = () => decide(false, false);

  return {
    reloading,
    press,
    dialog: {
      open: asking !== null,
      // Only staff closing the question ("Wait" / "Stay" / Escape) forgets the waiver. A close this hook makes itself (the
      // offline step, or a reload that never tore the page down after REFRESH_SETTLE_MS) keeps it by design: staff already
      // answered for that same hold, and a newer hold has another start time anyway.
      onOpenChange: (open: boolean) => {
        if (!open) {
          waived.current = null;
          asked.current = null;
          setAsking(null);
        }
      },
      title: asking === "print" ? REFRESH_PRINT_TITLE : REFRESH_CONFIRM_TITLE,
      description: asking === null ? undefined : asking === "print" ? REFRESH_PRINT_QUESTION : refreshQuestion(asking),
      confirmLabel: asking === "print" ? REFRESH_PRINT_CONFIRM : "Refresh",
      cancelLabel: asking === "print" ? REFRESH_PRINT_CANCEL : "Stay",
      onConfirm: () => (asking === "print" ? decide(false, true) : decide(true, false)),
    },
  };
}
