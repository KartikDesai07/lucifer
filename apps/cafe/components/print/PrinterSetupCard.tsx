"use client";

// The printer setup, rebuilt simple (owner, 2026-09-19), then as a panel for
// every kind of printer (2026-10-02). Four parts, in the order an operator
// needs them: where slips print, the printer on this device, a test slip, and
// a few folded-away options. This file owns the state and the writes; the
// parts are prop-driven siblings. Designating a device as the one that prints
// is NOT optional cosmetics: it is the only way a device becomes the printer.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { DevicePrinterSection } from "@/components/print/DevicePrinterSection";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PrintWhereSection } from "@/components/print/PrintWhereSection";
import { PrinterAdvanced } from "@/components/print/PrinterAdvanced";
import { PrinterTestTips } from "@/components/print/PrinterTestTips";
import { useDeviceOnline, usePrintLane } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useClearPrintHost, useDesignatePrintHost } from "@/hooks/use-print-host";
import { useBeatPrintHost } from "@/hooks/use-print-host-beat";
import { readDeviceId } from "@/lib/pos-device-id";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { PRINT_HOST_BUSY_MESSAGE } from "@/lib/print-host-slips";
import { DEVICE_LABEL_PC, defaultDeviceLabel } from "@/lib/printer/print-lane";

const HOST_LABEL_FALLBACK = "Another device";

const RASTER_QUESTION = "Did the test slip print?";
const RASTER_NO = "No — help me";
const WINDOW_QUESTION = "Did it print without a print window?";
const TEST_BUSY_MESSAGE = "This device is busy with another slip — try again in a moment.";
const TEST_WORKS_MESSAGE = "Printing works on this device.";
const ATTEST_SILENT_MESSAGE = "Confirmed — slips print without asking.";
const ATTEST_WINDOW_MESSAGE = "Noted — a print window will open on this device for every slip.";
const ATTEST_FAILED_MESSAGE = "Could not save the test result — run the test print again.";
const NOT_HOST_MESSAGE = "This device is no longer the printing device — status refreshed.";
const NO_DEVICE_ID_MESSAGE = "Device identity not found — check the browser's storage settings.";
const CLEAR_QUESTION = "Removing the printing device cancels every waiting slip. Continue?";
const NO_HOST_TO_CLEAR_MESSAGE = "No printing device was set.";
const NO_HOST_REASON = "No printing device is set.";
const TEST_BUSY_REASON = "Busy with another slip. Try again in a moment.";
const DESIGNATED_MESSAGE = "This device now prints all slips.";

const clearedMessage = (dismissed: number): string =>
  `Printing device removed — ${dismissed} waiting ${dismissed === 1 ? "slip" : "slips"} cancelled.`;

type TestPhase = "idle" | "printing" | "confirm";

export function PrinterSetupCard() {
  const { pulse } = usePosPulseContext();
  const { queueTestSlip, syncHostPref, isHostDevice, current } = usePrintHostContext();
  const qc = useQueryClient();
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  // The trigger -> onAfterPrint milliseconds, held between "printed" and the
  // operator's yes/no answer.
  const [dtMs, setDtMs] = useState<number | null>(null);
  // Typed text wins; until then the name fits this kind of device (the server
  // render and first paint always use the PC name, so they agree).
  const shownLabel = label ?? (lane === "pending" ? DEVICE_LABEL_PC : defaultDeviceLabel(lane));
  const testable = isHostDevice || lane === "raster";

  // Read-modify-write over a FRESH read (never clobbering a concurrent alert
  // toggle), then syncHostPref() so every lane disarms without a reload.
  const dropHostPref = () => {
    const prefs = readDevicePrefs();
    if (prefs.printHost) writeDevicePrefs({ ...prefs, printHost: false });
    syncHostPref();
  };

  // Hook-level (memory tanstack-mutate-callbacks-unmount): an `isHost:false`
  // answer means this device was demoted underneath us.
  const beat = useBeatPrintHost({
    onNotHost: () => {
      dropHostPref();
      toast.error(NOT_HOST_MESSAGE);
    },
  });
  const designate = useDesignatePrintHost();
  const clear = useClearPrintHost();

  const host = pulse?.printHost ?? null;
  const hostLabel = host !== null && host.configured ? (host.label ?? HOST_LABEL_FALLBACK) : null;

  const handleDesignate = async () => {
    const deviceId = readDeviceId();
    if (deviceId === "") {
      toast.error(NO_DEVICE_ID_MESSAGE);
      return;
    }
    try {
      await designate.mutateAsync({ deviceId, label: shownLabel.trim() || DEVICE_LABEL_PC });
      const prefs = readDevicePrefs();
      writeDevicePrefs({ ...prefs, printHost: true });
      syncHostPref();
      toast.success(DESIGNATED_MESSAGE);
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    } catch {
      // useDesignatePrintHost's hook-level onError already toasted.
    }
  };

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

  const handleAttest = async (silentMode: boolean) => {
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
      toast.success(TEST_WORKS_MESSAGE);
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
      toast.success(silentMode ? ATTEST_SILENT_MESSAGE : ATTEST_WINDOW_MESSAGE);
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    } catch {
      toast.error(ATTEST_FAILED_MESSAGE);
    }
  };

  const handleClear = async () => {
    setConfirmClear(false);
    try {
      const { cleared, dismissed } = await clear.mutateAsync();
      dropHostPref();
      toast.success(cleared ? clearedMessage(dismissed) : NO_HOST_TO_CLEAR_MESSAGE);
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    } catch {
      // The clear mutation's hook-level onError already toasted.
    }
  };

  // Built once: it sits in "Where slips print" on the printing device itself,
  // and under "More options" on every other device (recovery from any device).
  const clearControl = confirmClear ? (
    <InlineConfirm
      question={CLEAR_QUESTION}
      yes="Yes, remove"
      no="No"
      disabled={clear.isPending}
      onYes={() => void handleClear()}
      onNo={() => setConfirmClear(false)}
    />
  ) : (
    <>
      <Button
        variant="outline"
        className={PRINTER_ACTION_CLASS}
        onClick={() => setConfirmClear(true)}
        disabled={clear.isPending || host?.configured === false}
      >
        {isHostDevice ? "Stop printing here" : "Remove the printing device"}
      </Button>
      {host?.configured === false && <p className="text-xs text-brand-muted">{NO_HOST_REASON}</p>}
    </>
  );

  const raster = lane === "raster";
  return (
    <div className="space-y-4">
      <PrintWhereSection
        host={host}
        hostLabel={hostLabel}
        isHostDevice={isHostDevice}
        online={online}
        label={shownLabel}
        onLabelChange={setLabel}
        onDesignate={() => void handleDesignate()}
        designating={designate.isPending}
        stopControl={isHostDevice ? clearControl : null}
      />
      <DevicePrinterSection />

      {testable && (
        <section className={`${BRAND_PANEL_CLASS} space-y-3 rounded-lg border p-4 text-sm`}>
          <h3 className="text-base font-semibold text-brand-ink">Test print</h3>
          {phase === "confirm" ? (
            <InlineConfirm
              question={raster ? RASTER_QUESTION : WINDOW_QUESTION}
              yes="Yes"
              no={raster ? RASTER_NO : "No"}
              disabled={beat.isPending}
              onYes={() => void handleAttest(true)}
              onNo={() => void handleAttest(false)}
            />
          ) : (
            <Button
              className={cn(PRINTER_ACTION_CLASS, "w-full sm:w-auto")}
              onClick={() => void handleTestPrint()}
              disabled={current !== null || phase !== "idle" || beat.isPending}
            >
              {phase === "printing" ? "Printing…" : "Print test slip"}
            </Button>
          )}
          {phase === "idle" && current !== null && <p className="text-xs text-brand-muted">{TEST_BUSY_REASON}</p>}
          {showTips && <PrinterTestTips />}
          <p className="text-xs text-brand-muted">
            {raster ? "Prints a small slip, then asks whether it came out." : "Prints a small slip, then asks whether a print window appeared."}
          </p>
        </section>
      )}

      <PrinterAdvanced clearControl={isHostDevice ? null : clearControl} />
    </div>
  );
}
