"use client";

import { useState, type ComponentProps } from "react";
import { toast } from "sonner";

import type { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  REFRESH_CONFIRM_TITLE,
  REFRESH_OFFLINE_MESSAGE,
  REFRESH_PRINTING_MESSAGE,
  REFRESH_SETTLE_MS,
  clearDeliberateReload,
  markDeliberateReload,
  refreshQuestion,
  reloadStep,
  unsentWork,
  type UnsentWork,
} from "@/lib/page-refresh";
import { closePrintHost, printHostBusy } from "@/lib/print-host-busy";
import { serverReach } from "@/lib/server-reach";

// The one ask-first rule for a reload staff ask for: the POS app's Refresh button (the owner, 2026-10-03) and the
// header's "Update ready · Reload" chip (P2 N4, the review's R54), so the two can never drift apart. Offline (the
// page's own offline state or the browser's flag, the reading a tap uses: R59) it says so instead of reloading into an
// error screen; while a slip prints here it says so too; with work a reload would lose (lib/page-refresh.ts) it asks
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
  const [asking, setAsking] = useState<UnsentWork | null>(null);
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
  const press = () => {
    const offline = serverReach.isOffline() || navigator.onLine === false;
    const step = reloadStep(!offline, unsentWork(), printHostBusy());
    if (step.kind === "offline") {
      toast.error(REFRESH_OFFLINE_MESSAGE);
      return;
    }
    if (step.kind === "printing") {
      toast(REFRESH_PRINTING_MESSAGE);
      return;
    }
    if (step.kind === "ask") {
      setAsking(step.work);
      return;
    }
    reload();
  };

  return {
    reloading,
    press,
    dialog: {
      open: asking !== null,
      onOpenChange: (open: boolean) => {
        if (!open) setAsking(null);
      },
      title: REFRESH_CONFIRM_TITLE,
      description: asking === null ? undefined : refreshQuestion(asking),
      confirmLabel: "Refresh",
      cancelLabel: "Stay",
      onConfirm: reload,
    },
  };
}
