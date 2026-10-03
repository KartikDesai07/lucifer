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
// (retry, confirm, dismiss). A tap is one request; when it answers, this device's agent is woken (it may
// be the one that prints the slip; with no host the server also aims a print-status at the printing
// device, D7) and the panel is refreshed once. Never a poll.
//
// The 1D review gate: each action returns a promise that settles when ITS request does, success or
// error. TanStack's per-call mutate() callbacks fire only for the latest call, so a second row tapped
// before the first answered would have left the first row disabled; a promise per tap cannot be lost.

const ACTION_ERROR = "That did not go through. Check the connection and try again.";
/** A tap's answer stays long enough to read (the 1D E2E saw about 1.5 s on the emulator). */
const NOTICE_MS = 6_000;

const done = (): void => undefined;

export function usePrintJobActions() {
  const qc = useQueryClient();
  const settled = () => {
    kickPrintAgent();
    void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
  };
  const noticeOf = (answer: PrintActionData) => {
    const notice = printRetryNotice(answer);
    if (notice !== null) toast.info(notice, { duration: NOTICE_MS });
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
  return {
    retry: (id: string): Promise<void> => retry.mutateAsync(id).then(done, done),
    confirm: (id: string, decision: PrintJobDecision): Promise<void> => confirm.mutateAsync({ id, decision }).then(done, done),
    // useDismissPrintJob says its own error; the refresh and the kick follow the answer either way.
    dismiss: (id: string): Promise<void> => dismissJob.mutateAsync(id).then(done, done).finally(settled),
  };
}
