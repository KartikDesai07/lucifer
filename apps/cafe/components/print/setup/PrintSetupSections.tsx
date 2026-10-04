"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { DevicesSetupSection } from "@/components/print/setup/DevicesSetupSection";
import { PrintersSetupSection } from "@/components/print/setup/PrintersSetupSection";
import { StationsSetupSection } from "@/components/print/setup/StationsSetupSection";
import { PRINTERS_KEYS, usePrintersRead } from "@/hooks/use-agent-printers";
import { usePrintDevices, useStations } from "@/hooks/use-print-setup";

const LOADING = "Loading the printer setup…";
const FAILED = "Couldn't load the printer setup. Reload the page to try again.";

// Printing redesign, Phase 2 Session 2D (spec §11; plan decision 11: on the admin Printer setup page, not in
// Settings): Printers, Kitchen stations and Devices, under this device's printer panel. The printers are the same
// read the agent makes (one cache entry), read again when the page opens so an admin edits the setup as it is now.
// Nothing shows until both the printers and the stations are in (the 2D gate's review, I-1 and M-1): an empty list
// while loading would offer Set up printers to a cafe that has printers, or save a printer with its stations gone.
export function PrintSetupSections() {
  const qc = useQueryClient();
  const { deviceId } = usePrintHostContext();
  const { printers, loaded, failed } = usePrintersRead(true);
  const { stations, ready, failed: stationsFailed } = useStations();
  const devices = usePrintDevices();

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
  }, [qc]);

  if (failed || stationsFailed) return <p role="alert" className="text-destructive">{FAILED}</p>;
  if (!loaded || !ready) return <p role="status" className="text-brand-muted">{LOADING}</p>;
  return (
    <div className="space-y-6" data-print-setup>
      <PrintersSetupSection printers={printers} stations={stations} devices={devices} deviceId={deviceId} />
      <StationsSetupSection stations={stations} printers={printers} />
      <DevicesSetupSection devices={devices} printers={printers} deviceId={deviceId} />
    </div>
  );
}
