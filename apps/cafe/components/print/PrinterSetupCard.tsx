"use client";

// The printing settings page, rebuilt simple (owner, 2026-09-19: "printer
// setup wala page pura kharab hai... unused and extra thing remove karo...
// simple view, proper setup done").
//
// What this REPLACES: a five-step wizard that walked the operator through
// downloading a .bat file which launched Chrome in kiosk-printing mode. That
// was the workaround from before the Windows desktop app existed. With the
// desktop app it is dead weight and the main source of confusion on this page.
//
// What is left is exactly the four things that matter, in the order an
// operator actually needs them:
//   1. Make this PC the one that prints (designate the host)
//   2. Pick the printer on it            (desktop app only)
//   3. Test print
//   4. Remove the print host             (recovery, from any device)
//
// Step 1 is NOT optional cosmetics: designating the host is the only way a
// device ever becomes the printer, so removing it would leave no route to set
// one up at all.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { DesktopPrinterPicker } from "@/components/print/DesktopPrinterPicker";
import { InlineConfirm, PrintHostStatus } from "@/components/print/PrintHostCardParts";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useClearPrintHost, useDesignatePrintHost } from "@/hooks/use-print-host";
import { useBeatPrintHost } from "@/hooks/use-print-host-beat";
import { readDeviceId } from "@/lib/pos-device-id";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { PRINT_HOST_BUSY_MESSAGE } from "@/lib/print-host-slips";

const HOST_LABEL_FALLBACK = "Print host";
const DEFAULT_LABEL = "Counter PC";
// Mirrors PRINT_HOST_LABEL_MAX_CHARS, which lives in the server-only
// lib/print-host.ts (it imports a Mongoose model, so it cannot be imported
// into a client component).
const LABEL_MAX_CHARS = 60;

const TEST_QUESTION = "Did it print without a dialog?";
const TEST_BUSY_MESSAGE = "The print host is busy with another slip — try again in a moment.";
const ATTEST_SILENT_MESSAGE = "Silent printing confirmed";
const ATTEST_DIALOG_MESSAGE = "Noted — a print dialog will appear on this PC for every slip.";
const ATTEST_FAILED_MESSAGE = "Could not save the test result — run the test print again.";
const NOT_HOST_MESSAGE = "This device is no longer the print host — status refreshed.";
const NO_DEVICE_ID_MESSAGE = "Device identity not found — check the browser's storage settings.";
const CLEAR_QUESTION = "Removing the print host cancels every queued slip. Continue?";
const NO_HOST_TO_CLEAR_MESSAGE = "No print host was set.";
const DESIGNATED_MESSAGE = "This PC is now the print host.";

const clearedMessage = (dismissed: number): string =>
  `Print host removed — ${dismissed} queued ${dismissed === 1 ? "slip" : "slips"} cancelled.`;

type TestPhase = "idle" | "printing" | "confirm";

export function PrinterSetupCard() {
  const { pulse } = usePosPulseContext();
  const { queueTestSlip, syncHostPref, isHostDevice, current } = usePrintHostContext();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const [label, setLabel] = useState(DEFAULT_LABEL);
  // The trigger -> onAfterPrint milliseconds, held between "printed" and the
  // operator's yes/no answer.
  const [dtMs, setDtMs] = useState<number | null>(null);

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
      await designate.mutateAsync({ deviceId, label: label.trim() || DEFAULT_LABEL });
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
    const deviceId = readDeviceId();
    if (deviceId === "") {
      toast.error(NO_DEVICE_ID_MESSAGE);
      return;
    }
    try {
      const result = await beat.mutateAsync({ deviceId, silentMode, silentProbeMs: Math.round(dt) });
      if (!result.isHost) return; // onNotHost already spoke
      toast.success(silentMode ? ATTEST_SILENT_MESSAGE : ATTEST_DIALOG_MESSAGE);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Printing on this PC</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <PrintHostStatus host={host} hostLabel={hostLabel} isHostDevice={isHostDevice} />

        {/* 1. Make this PC the one that prints. */}
        {!isHostDevice && (
          <div className="space-y-2 border-t pt-4">
            <p className="font-medium">1. Use this PC for printing</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={label}
                maxLength={LABEL_MAX_CHARS}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={DEFAULT_LABEL}
                className="h-9 max-w-[220px]"
                aria-label="Name for this PC"
              />
              <Button size="sm" onClick={() => void handleDesignate()} disabled={designate.isPending}>
                {designate.isPending ? "Saving…" : "Use this PC"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Every slip from every device will print here. Give it a name you will recognise.
            </p>
          </div>
        )}

        {/* 2. Pick the printer (desktop app only — it renders nothing elsewhere). */}
        <DesktopPrinterPicker />

        {/* 3. Test print. */}
        {isHostDevice && (
          <div className="space-y-2 border-t pt-4">
            <p className="font-medium">Test print</p>
            {phase === "confirm" ? (
              <InlineConfirm
                question={TEST_QUESTION}
                yes="Yes"
                no="No"
                disabled={beat.isPending}
                onYes={() => void handleAttest(true)}
                onNo={() => void handleAttest(false)}
              />
            ) : (
              <Button
                size="sm"
                onClick={() => void handleTestPrint()}
                disabled={current !== null || phase !== "idle" || beat.isPending}
              >
                {phase === "printing" ? "Printing…" : "Print a test slip"}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Prints a small slip, then asks whether a print dialog appeared.
            </p>
          </div>
        )}

        {/* 4. Recovery. */}
        <div className="space-y-2 border-t pt-4">
          {confirmClear ? (
            <InlineConfirm
              question={CLEAR_QUESTION}
              yes="Yes, remove"
              no="No"
              disabled={clear.isPending}
              onYes={() => void handleClear()}
              onNo={() => setConfirmClear(false)}
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmClear(true)}
              disabled={clear.isPending || host?.configured === false}
            >
              Remove print host
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            If this PC is down, remove the print host from any device — even a phone. Queued slips
            are cancelled and every device prints its own slips again.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
