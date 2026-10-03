"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PrintActionData } from "@pos/shared/print-agent-wire";
import type { PrintJobDecision } from "@pos/shared/print-lifecycle";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { PRINT_JOB_KEYS, useDismissPrintJob } from "@/hooks/use-print-host";
import { apiSend } from "@/lib/api-client";
import { kickPrintAgent } from "@/lib/print-agent";
import { printRetryNotice } from "@/lib/print-waiting";

// Session 1D (spec §10): the waiting-slips panel's three actions, on the server routes Phase 1A built
// (retry, confirm, dismiss). After a tap: wake this device's agent at once (it may be the one that
// prints the slip; with no host the server also aims a print-status at the printing device, D7), and
// refresh the panel. One request per tap, never a poll.

const ACTION_ERROR = "That did not go through. Check the connection and try again.";

export function usePrintJobActions() {
  const qc = useQueryClient();
  const settled = () => {
    kickPrintAgent();
    void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
  };
  const noticeOf = (answer: PrintActionData) => {
    const notice = printRetryNotice(answer);
    if (notice !== null) toast.info(notice);
  };
  const retry = useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (id: string) => apiSend<PrintActionData>(`/api/print-jobs/${encodeURIComponent(id)}/retry`, "POST", {}),
    onSuccess: noticeOf,
    onError: () => toast.error(ACTION_ERROR),
    onSettled: settled,
  });
  const confirm = useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: ({ id, decision }: { id: string; decision: PrintJobDecision }) =>
      apiSend<PrintActionData>(`/api/print-jobs/${encodeURIComponent(id)}/confirm`, "POST", { decision }),
    onSuccess: noticeOf,
    onError: () => toast.error(ACTION_ERROR),
    onSettled: settled,
  });
  const dismissJob = useDismissPrintJob();
  const dismiss = {
    // onSettled: the panel re-enables the row once Clear answers (1D final review I-2).
    mutate: (id: string, onSettled?: () => void) =>
      dismissJob.mutate(id, {
        onSettled: () => {
          settled();
          onSettled?.();
        },
      }),
  };
  return { retry, confirm, dismiss };
}
