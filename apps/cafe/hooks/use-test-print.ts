"use client";

// The test print and its answer, moved out of PrinterSetupCard.tsx as it was (PX-3 Task 10, spec §6.6): a small slip through
// the bridge's own test window (refused while busy, never queued), then a yes / no. On the printing device the answer is
// the attestation (the host beat: does it print without a print window); on a printer of this device a No shows the tips,
// nothing is reported. The device card draws it ("This device's printer"); Task 11's guided connect answers it with its own
// words.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintLane } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useBeatPrintHost } from "@/hooks/use-print-host-beat";
import { NO_DEVICE_ID_MESSAGE, useDropHostPref } from "@/hooks/use-printer-setup-actions";
import { readDeviceId } from "@/lib/pos-device-id";
import { PRINT_HOST_BUSY_MESSAGE } from "@/lib/print-host-slips";

/** The test's question as the card asks it: a printer on this device (raster), or the printing device's print window. */
export const TEST_QUESTIONS = {
  raster: { question: "Did the test slip print?", no: "No — help me" },
  window: { question: "Did it print without a print window?", no: "No" },
} as const;
const TEST_BUSY_MESSAGE = "This device is busy with another slip — try again in a moment.";
const TEST_WORKS_MESSAGE = "Printing works on this device.";
const ATTEST_SILENT_MESSAGE = "Confirmed — slips print without asking.";
const ATTEST_WINDOW_MESSAGE = "Noted — a print window will open on this device for every slip.";
const ATTEST_FAILED_MESSAGE = "Could not save the test result — run the test print again.";
const NOT_HOST_MESSAGE = "This device is no longer the printing device — status refreshed.";

type TestPhase = "idle" | "printing" | "confirm";

export interface TestPrint {
  /** The printing device, or a device with its own printer (raster): only these can prove a test. */
  testable: boolean;
  raster: boolean;
  phase: TestPhase;
  /** "No — help me" was answered: the tips show. */
  tips: boolean;
  startDisabled: boolean;
  /** Another slip holds the bridge while no test runs (where a test is offered): the card says why Test print waits. */
  deviceBusy: boolean;
  attesting: boolean;
  start(): Promise<void>;
  /** worksWords: the guided connect's "Printing works on {noun}.", in place of the success words of that one answer. */
  answer(printed: boolean, worksWords?: string): Promise<void>;
}

export function useTestPrint(): TestPrint {
  const { queueTestSlip, isHostDevice, printing } = usePrintHostContext();
  const qc = useQueryClient();
  const lane = usePrintLane();
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [showTips, setShowTips] = useState(false);
  // The trigger -> onAfterPrint milliseconds, held between "printed" and the
  // operator's yes/no answer.
  const [dtMs, setDtMs] = useState<number | null>(null);
  const testable = isHostDevice || lane === "raster";
  const dropHostPref = useDropHostPref();

  // Hook-level (memory tanstack-mutate-callbacks-unmount): an `isHost:false`
  // answer means this device was demoted underneath us.
  const beat = useBeatPrintHost({
    onNotHost: () => {
      dropHostPref();
      toast.error(NOT_HOST_MESSAGE);
    },
  });

  const handleTestPrint = async () => {
    setShowTips(false);
    setPhase("printing");
    try {
      setDtMs(await queueTestSlip());
      setPhase("confirm");
    } catch (err) {
      // The bridge toasts its own print failures; only the busy refusal is
      // silent there — and it is a refusal, never a queue.
      if (err instanceof Error && err.message === PRINT_HOST_BUSY_MESSAGE) toast.error(TEST_BUSY_MESSAGE);
      setPhase("idle");
    }
  };

  const handleAttest = async (silentMode: boolean, worksWords?: string) => {
    const dt = dtMs;
    setDtMs(null);
    setPhase("idle");
    if (dt === null) return; // a second tap in the same tick — already answered
    // A printer on this device that did not print: tips only, nothing is reported.
    if (!silentMode && lane === "raster") {
      setShowTips(true);
      return;
    }
    // Not the printing device: the test proves this device's printer, no report.
    if (!isHostDevice) {
      toast.success(worksWords ?? TEST_WORKS_MESSAGE);
      return;
    }
    const deviceId = readDeviceId();
    if (deviceId === "") {
      toast.error(NO_DEVICE_ID_MESSAGE);
      return;
    }
    try {
      const result = await beat.mutateAsync({ deviceId, silentMode, silentProbeMs: Math.round(dt) });
      if (!result.isHost) return; // onNotHost already spoke
      toast.success(silentMode ? (worksWords ?? ATTEST_SILENT_MESSAGE) : ATTEST_WINDOW_MESSAGE);
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    } catch {
      toast.error(ATTEST_FAILED_MESSAGE);
    }
  };

  return {
    testable,
    raster: lane === "raster",
    phase,
    tips: showTips,
    startDisabled: printing || phase !== "idle" || beat.isPending,
    // Only where a test is offered, as the Test print card said it.
    deviceBusy: testable && phase === "idle" && printing,
    attesting: beat.isPending,
    start: handleTestPrint,
    answer: handleAttest,
  };
}
