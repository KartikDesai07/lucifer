"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { PrintSources } from "@/components/pos/PrintSources";
import { PrintHostTestSlip } from "@/components/print/PrintHostTestSlip";
import { useSettings } from "@/hooks/use-settings";

// MODULE scope (RR-13): declared inside the component it would be a NEW
// component type on every render, remounting the eod queries mid-load.
// ssr:false — the source only ever exists on the host's live page.
const PrintHostEodSource = dynamic(
  () => import("@/components/print/PrintHostEodSource").then((m) => m.PrintHostEodSource),
  { ssr: false },
);

// Same off-screen container the page bridges use — absolute, so it adds zero
// in-flow height to the shell (memory layout-matrix-must-include-in-flow-chrome).
const OFFSCREEN_CLASS = "pointer-events-none absolute left-[-9999px] top-0";

// Print-host plan §B5 (PH-5) — the host's off-screen print sources, rendered
// once in the dashboard layout INSIDE <SidebarInset>, after <main>. Renders
// nothing while the bridge is idle; while a slip is current it mounts exactly
// the surface that slip prints on, into the provider's ref for that surface:
//   · a claimed kot/void/moved/cancel-notice → PrintSources' KOTReceipt
//     (kotRef) — the moved slip's three meta props travel too (PH-4 MUST);
//   · a claimed bill → PrintSources' OrderReceipt (receiptRef);
//   · a claimed eod → PrintHostEodSource inside the eodRef wrapper (the ref
//     stays on a plain div, never threaded through the dynamic boundary);
//   · PH-7's test slip → PrintHostTestSlip on the KOT surface.
export function PrintHostPrintSources() {
  const { current, kotRef, receiptRef, eodRef, setEodReady, reportSurfacesMounted } = usePrintHostContext();
  const settings = useSettings();

  // Tells the provider its refs have a home (2026-09-11): the drain claims
  // nothing and the bridge dispatches nothing until this has run — a job
  // claimed while this component was not mounted (behind MasterDataProvider's
  // first-load placeholder) burned its claim and wedged the bridge.
  useEffect(() => {
    reportSurfacesMounted(true);
    return () => reportSurfacesMounted(false);
  }, [reportSurfacesMounted]);

  if (!current) return null;

  if (current.kind === "test") {
    return (
      <div className={OFFSCREEN_CLASS} aria-hidden>
        <PrintHostTestSlip settings={settings.data} ref={kotRef} />
      </div>
    );
  }

  const { slip } = current;
  if (slip.surface === "eod") {
    return (
      <div className={OFFSCREEN_CLASS} aria-hidden>
        <div ref={eodRef}>
          <PrintHostEodSource
            dateKey={slip.dateKey}
            dateLabel={slip.dateLabel}
            isToday={slip.isToday}
            onReady={setEodReady}
          />
        </div>
      </div>
    );
  }

  if (slip.surface === "receipt") {
    return (
      <PrintSources order={slip.order} settings={settings.data} kotRef={kotRef} kotVariant="kot" receiptRef={receiptRef} />
    );
  }

  return (
    <PrintSources
      order={slip.order}
      settings={settings.data}
      kotRef={kotRef}
      kotRoundItems={slip.kotRoundItems}
      kotRoundLabel={slip.kotRoundLabel}
      kotRoundNumber={slip.kotRoundNumber}
      kotVariant={slip.kotVariant}
      voidReason={slip.voidReason}
      voidedBy={slip.voidedBy}
      voidedAt={slip.voidedAt}
      movedFrom={slip.movedFrom}
      movedBy={slip.movedBy}
      movedAt={slip.movedAt}
    />
  );
}
