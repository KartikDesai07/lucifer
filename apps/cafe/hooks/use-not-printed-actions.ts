"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PrintActionData } from "@pos/shared/print-agent-wire";
import type { PrintJobDecision } from "@pos/shared/print-lifecycle";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { kickPrintAgent } from "@/lib/print-agent";
import { clearAllErrorOf, rowAnswerNoticeOf, rowErrorNoticeOf, type RowNotice } from "@/lib/print-job-notices";
import { withoutAttentionRows, type NotPrintedAction } from "@/lib/print-waiting-view";

// Printer UX, PX-2 Task 4 (spec §6.3, §6.9 B1/B2/B8; R10): the Not printed card's own actions. The dashboard band keeps
// usePrintJobActions / useDismissPrintJob, their toasts and behaviour, unchanged. Here every call is apiSend itself, so
// no hook-level toast doubles the one notice a tap gets, and each tap is its own promise (the 1D gate: TanStack's
// per-call mutate() callbacks fire only for the latest call). As today: one request, then this device's agent is woken
// (it may be the one that prints) and the pulse is read once. Never a poll.
//
// A Clear that applied, a slip the server says is gone, and Clear all edit the cached pulse at once, before that one
// read: the row leaves the moment its answer lands and is never drawn again from a stale cache (PX-D2).

/** A tap's answer stays long enough to read (the 1D E2E saw about 1.5 s on the emulator), as the band's. */
const NOTICE_MS = 6_000;
const STAFF = "staff" as const;

type DismissAnswer = { dismissed: boolean; reason?: string };

const jobUrl = (id: string, verb: "retry" | "confirm" | "dismiss"): string => `/api/print-jobs/${encodeURIComponent(id)}/${verb}`;

export function useNotPrintedActions() {
  const qc = useQueryClient();
  const settled = () => {
    kickPrintAgent();
    void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
  };
  const drop = (ids: readonly string[]) => {
    const gone = new Set(ids);
    qc.setQueryData<PosPulseData>(POS_PULSE_KEYS.all, (data) => withoutAttentionRows(data, gone));
  };
  const answered = (id: string, notice: RowNotice) => {
    if (notice?.drop === true) drop([id]);
    if (notice?.tone === "info") toast.info(notice.text, { duration: NOTICE_MS });
    if (notice?.tone === "error") toast.error(notice.text);
    settled();
  };
  const tap = <T extends PrintActionData | DismissAnswer>(id: string, action: NotPrintedAction, send: Promise<T>): Promise<void> =>
    send.then(
      (answer) => {
        if ("dismissed" in answer && answer.dismissed) drop([id]);
        answered(id, rowAnswerNoticeOf(action, answer));
      },
      (error: unknown) => answered(id, rowErrorNoticeOf(error)),
    );
  return {
    // Try again and Print now are one route and say the same when applied.
    retry: (id: string): Promise<void> => tap(id, "try-again", apiSend<PrintActionData>(jobUrl(id, "retry"), "POST", {})),
    confirm: (id: string, decision: PrintJobDecision): Promise<void> =>
      tap(id, decision === "reprint" ? "print-again" : "it-printed", apiSend<PrintActionData>(jobUrl(id, "confirm"), "POST", { decision })),
    dismiss: (id: string): Promise<void> => tap(id, "clear", apiSend<DismissAnswer>(jobUrl(id, "dismiss"), "POST", { reason: STAFF })),
    // ONE request for every id the list holds (shown or folded; at most the feed's 20), not a POST per slip.
    dismissAll: (ids: readonly string[]): Promise<void> =>
      apiSend<{ dismissed: number }>("/api/print-jobs/dismiss", "POST", { ids: [...ids], reason: STAFF })
        .then(
          () => drop(ids),
          (error: unknown) => void toast.error(clearAllErrorOf(error)),
        )
        .finally(settled),
  };
}
