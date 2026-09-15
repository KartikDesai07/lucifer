"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { InlineConfirm, PrintHostStatus } from "@/components/print/PrintHostCardParts";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useClearPrintHost } from "@/hooks/use-print-host";
import { useBeatPrintHost } from "@/hooks/use-print-host-beat";
import { readDeviceId } from "@/lib/pos-device-id";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { PRINT_HOST_BUSY_MESSAGE } from "@/lib/print-host-slips";

// Print-host plan §B7 (PH-7) — the "this device" print-host card, now on
// /settings/printing (PH-10b) ABOVE the wizard: reachable from any admin
// device, phones included; never UA-gated. Two controls: the staff
// ATTESTATION handshake ("Test print" → the provider's queueTestSlip(), never
// a component-owned react-to-print trigger — design review MERGED-13 — then
// "did it print with no dialog?" → ONE beat carrying silentMode + the raw
// probe ms), and "Clear host", DELETE /api/print-host (MERGED-17). Designation
// is NOT here — the wizard owns it. The sixth deliberate wide-pulse consumer
// (pos-pulse-paths inventory): the host's label/silent status live only on
// pulse.printHost. Device-id/prefs reads happen in handlers only (F8).

const HOST_LABEL_FALLBACK = "Print host";
const TEST_QUESTION = "Did it print without a dialog?";
const TEST_BUSY_MESSAGE = "The print host is busy with another slip — try again in a moment.";
const ATTEST_SILENT_MESSAGE = "Silent printing confirmed ✓";
const ATTEST_DIALOG_MESSAGE = "Noted — a print dialog will appear on this PC for every slip.";
const ATTEST_FAILED_MESSAGE = "Could not save the test result — run the test print again.";
const NOT_HOST_MESSAGE = "This device is no longer the print host — status refreshed.";
const NO_DEVICE_ID_MESSAGE = "Device identity not found — check the browser's storage settings.";
const CLEAR_QUESTION = "Removing the print host cancels every queued slip. Continue?";
const NO_HOST_TO_CLEAR_MESSAGE = "No print host was set.";

function clearedMessage(dismissed: number): string {
  return `Print host removed — ${dismissed} queued ${dismissed === 1 ? "slip" : "slips"} cancelled.`;
}

type TestPhase = "idle" | "printing" | "confirm";

export function PrintHostCard() {
  const { pulse } = usePosPulseContext();
  const { queueTestSlip, syncHostPref, isHostDevice, current } = usePrintHostContext();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  // The resolved trigger→onAfterPrint ms, held between "printed" and the answer.
  const dtRef = useRef<number | null>(null);

  // Read-modify-write over a FRESH read (never clobbering a concurrent alert
  // toggle), then syncHostPref() so every lane disarms without a reload.
  const dropHostPref = () => {
    const prefs = readDevicePrefs();
    if (prefs.printHost) writeDevicePrefs({ ...prefs, printHost: false });
    syncHostPref();
  };

  // Hook-level (memory tanstack-mutate-callbacks-unmount): an `isHost:false`
  // answer to the attestation means this device was demoted underneath us.
  const beat = useBeatPrintHost({
    onNotHost: () => {
      dropHostPref();
      toast.error(NOT_HOST_MESSAGE);
    },
  });
  const clear = useClearPrintHost();

  const handleTestPrint = async () => {
    setPhase("printing");
    try {
      dtRef.current = await queueTestSlip();
      setPhase("confirm");
    } catch (err) {
      // The bridge toasts its own print failures; only the busy refusal is
      // silent there — and it is a refusal, never a queue (A-16).
      if (err instanceof Error && err.message === PRINT_HOST_BUSY_MESSAGE) toast.error(TEST_BUSY_MESSAGE);
      setPhase("idle");
    }
  };

  const handleAttest = async (silentMode: boolean) => {
    const dt = dtRef.current;
    dtRef.current = null;
    setPhase("idle");
    if (dt === null) return; // a second tap in the same tick — already answered
    const deviceId = readDeviceId();
    if (deviceId === "") {
      toast.error(NO_DEVICE_ID_MESSAGE);
      return;
    }
    try {
      // Raw ms, server-side only — no threshold here (§E open question SF-11).
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

  // `null` covers both an unresolved pulse and a degraded tick (MERGED-19):
  // neither is "no host", so neither disables the recovery control below.
  const host = pulse?.printHost ?? null;
  const hostLabel = host !== null && host.configured ? (host.label ?? HOST_LABEL_FALLBACK) : null;
  const testDisabled = current !== null || phase !== "idle" || beat.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Print host</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <PrintHostStatus host={host} hostLabel={hostLabel} isHostDevice={isHostDevice} />

        {isHostDevice && (
          <div className="space-y-2">
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
              <Button size="sm" onClick={() => void handleTestPrint()} disabled={testDisabled}>
                {phase === "printing" ? "Printing…" : "Test print"}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Prints a small test slip — then tell us whether a print dialog appeared.</p>
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
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
            If the host PC is down, remove the print host from here — from a phone too. Queued slips are cancelled and every device prints its own slips again.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
