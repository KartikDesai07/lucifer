"use client";

// Print-standardization plan (.claude/plan/v2/print-standardization-plan.md
// §B1/§B2, slice A2) — the self-service printer setup wizard. Deliberately
// does NOT mount PosPulseProvider (own page-scoped poll instead, §B1) and
// carries NO react-to-print / page-style machinery of any kind: step 4 only
// reads the attestation the PH-7 test-print handshake already writes.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useDesignatePrintHost } from "@/hooks/use-print-host";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { isMobileUserAgent } from "@/lib/print";
import { readDeviceId } from "@/lib/pos-device-id";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { kioskShortcutBat, shortcutTargetString, CHROME_PATHS } from "@/lib/print-host-setup";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  DeviceCheckStep,
  DesignateStep,
  KioskShortcutStep,
  SilentStatusStep,
  DoneStep,
} from "@/components/print/PrinterSetupSteps";

// Not exported from use-pos-pulse.ts (module-private there) — mirrored here
// rather than widening that hook's surface for one extra caller (plan §B1).
const PULSE_ENDPOINT = "/api/order-requests/pulse";
// Deliberately NOT POS_PULSE_KEYS.all: after PH-5 lifts PosPulseProvider to
// the layout, a shared key would let this page's own interval defeat the
// provider's pause semantics (plan §B1).
const WIZARD_PULSE_KEY = ["printer-setup", "pulse"] as const;

const DEFAULT_LABEL = "Counter PC";
const KIOSK_SHORTCUT_FILENAME = "pos-printer-setup.bat";
// `PRINT_HOST_LABEL_MAX_CHARS` lives only in the server-only apps/cafe/lib/
// print-host.ts (imports @/models/PrintHost) — it is NOT exported from
// @pos/shared/print-job as this slice's spec expected. Importing that file
// here would pull a Mongoose model into the client bundle, so the bound is
// mirrored by hand instead; flagged for a shared-package consolidation.
const WIZARD_LABEL_MAX_CHARS = 60;

interface WizardDevice {
  deviceId: string;
  isMobile: boolean;
}

export function PrinterSetupWizard() {
  const [device, setDevice] = useState<WizardDevice | null>(null);
  const [origin, setOrigin] = useState("");
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [shortcutReady, setShortcutReady] = useState(false);
  const designate = useDesignatePrintHost();
  // The layout's PrintHostProvider (PH-5) wraps every dashboard route, this
  // page included — only its pref re-read is used here, never the pulse.
  const { syncHostPref } = usePrintHostContext();

  // Hydration rule (plan §B7): device identity/UA are read only after mount.
  // isMobileUserAgent gates DESIGNATION only (plan §B7 / MERGED-17).
  useEffect(() => {
    setDevice({ deviceId: readDeviceId(), isMobile: isMobileUserAgent() });
    setOrigin(window.location.origin);
  }, []);

  const pulseQuery = useQuery({
    queryKey: WIZARD_PULSE_KEY,
    queryFn: () => apiGet<PosPulseData>(PULSE_ENDPOINT),
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: REFETCH_INTERVALS.POS_PULSE,
  });

  async function handleDesignate() {
    // "" is pos-device-id's documented "no identity" sentinel — the PUT's Zod
    // would 400 on it forever, so it must never leave this handler.
    if (!device || device.deviceId === "") return;
    try {
      await designate.mutateAsync({ deviceId: device.deviceId, label: label.trim() });
      // Designation success MUST write the local printHost pref — mirrors
      // PH-7's contract (plan §B2). `printHostSeen` is NOT ours to write:
      // use-print-routing's own pulse effect owns that flag.
      writeDevicePrefs({ ...readDevicePrefs(), printHost: true });
      // PH-7 MUST (PH-5's DONE record): re-read the pref into the provider so
      // the drain/beat/wake-lock lanes arm on this PC without a reload.
      syncHostPref();
      toast.success("Print host set.");
      void pulseQuery.refetch();
    } catch {
      // Intentional no-op — useDesignatePrintHost's hook-level onError
      // already toasts; a second toast here would double up.
    }
  }

  function handleDownloadShortcut() {
    const blob = new Blob([kioskShortcutBat(origin)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = KIOSK_SHORTCUT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopyTarget() {
    try {
      await navigator.clipboard.writeText(shortcutTargetString(origin, CHROME_PATHS[0]));
      toast.success("Target copied.");
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }

  if (!device) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (device.isMobile) {
    return <DeviceCheckStep isMobile printHost={null} />;
  }

  // Data-first ladder: cached data keeps the wizard rendered through offline
  // blips and refetch failures (paused/errored flags can be true WITH data —
  // repo memory: an offline v5 query is neither loading nor error). Hard-block
  // only when there is nothing at all to render.
  const pulse = pulseQuery.data;
  if (!pulse) {
    if (pulseQuery.isPaused) {
      return (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">
          No connection — check the network and reopen this page.
        </CardContent></Card>
      );
    }
    if (pulseQuery.isLoadingError) {
      return (
        <Card><CardContent className="pt-6 text-sm text-destructive">
          Could not load the print host status. Refresh and try again.
        </CardContent></Card>
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // A null printHost is a degraded tick, not "no host" — designation does not
  // depend on that read, so the steps stay usable under a banner.
  const { printHost } = pulse;
  const stale = pulseQuery.isPaused;
  const degraded = printHost === null;
  const isCurrentHost = printHost !== null && printHost.configured && printHost.deviceId === device.deviceId;

  return (
    <div className="space-y-4">
      {(stale || degraded) && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">
          {stale
            ? "No connection — the status below may be out of date."
            : "Print host status could not be read — it refreshes shortly; you can still designate this PC."}
        </CardContent></Card>
      )}
      <DeviceCheckStep isMobile={false} printHost={printHost} />
      <DesignateStep
        label={label}
        maxLength={WIZARD_LABEL_MAX_CHARS}
        onLabelChange={setLabel}
        onSave={handleDesignate}
        isPending={designate.isPending}
        isCurrentHost={isCurrentHost}
        hasDevice={device.deviceId !== ""}
      />
      <KioskShortcutStep origin={origin} onDownload={handleDownloadShortcut} onCopy={handleCopyTarget} />
      <SilentStatusStep silentMode={printHost?.silentMode === true} />
      <DoneStep
        hostSet={printHost?.configured === true}
        hostLabel={printHost?.label ?? null}
        shortcutReady={shortcutReady}
        onShortcutReadyChange={setShortcutReady}
        silentReady={printHost?.silentMode === true}
      />
    </div>
  );
}
