"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { NotPrintedSection } from "@/components/print/NotPrintedSection";
import { PrinterHereCard } from "@/components/print/PrinterHereCard";
import { PrinterSettingsRow, settingsRowSubOf } from "@/components/print/PrinterSettingsRow";
import { PrinterStatusCard } from "@/components/print/PrinterStatusCard";
import { PrinterSettingsView } from "@/components/print/settings/PrinterSettingsView";
import { useDotPrinters } from "@/hooks/use-agent-printers";
import { useAuth } from "@/hooks/use-auth";
import { usePrinterPanelFocus } from "@/hooks/use-printer-panel-focus";
import { heldPrinterSnapshotOf, useCanPrintNow, useDesktopPrinterChosen, useDesktopPrinterSnapshot, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { deviceTransportOf, type TransportWord } from "@/lib/print-agent-here";
import { inAppWebView } from "@/lib/printer/capabilities";
import { devicePrinter } from "@/lib/printer/device-printer";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { nativeBridge } from "@/lib/printer/native-bridge";
import { nativePool } from "@/lib/printer/native-pool";
import { printerDotOf, type DotLane } from "@/lib/printer/printer-dot";
import { deviceNounOf, printerStatusViewOf, type StatusActionKind, type StatusLinkKind } from "@/lib/printer/printer-status-view";
import { reconnectDown, reconnectToastOf, type ReconnectResult } from "@/lib/printer/reconnect-down";

// The printer panel (Printer UX PX-2, spec §6.1 / §6.2 / §6.6): two views in one sheet. The STATUS view (every open): the
// status card (what is wrong, the steps, one fix), the Not printed card, the printers this device prints, and the row to
// the SETTINGS view: the setup as cards (PX-3, PrinterSettingsView), one tap away. One panel in two homes: the top-bar frame (PrinterPanelFrame:
// its head, scroller and Done foot; the view is the button's) and /printers (inline, both views, no row, no Done). It reads
// the pulse for the printing device's name, which only lives there: the deliberate extra reader of the pulse; it mounts
// only where the panel is open, never in the POS screen's render path.

export type PrinterPanelView = "status" | "settings";

const DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]';
const DESIGNATE_SELECTOR = '[data-action="designate"]';
// Each fix that points at the setup, and the part of the settings view it opens on (today's banner targets).
const SETUP_TARGETS: Record<Exclude<StatusActionKind | StatusLinkKind, "reconnect" | "printer-setup">, string> = {
  connect: DEVICE_SECTION_SELECTOR,
  choose: DEVICE_SECTION_SELECTOR,
  "connect-again": DEVICE_SECTION_SELECTOR,
  "set-up-host": DEVICE_SECTION_SELECTOR,
  "print-here": DESIGNATE_SELECTOR,
  "one-device": DESIGNATE_SELECTOR,
};
const RECONNECT_DEPS = { device: () => devicePrinter().reconnect(), native: (id: string) => nativePool().reconnect(id) };

// The device noun's two facts (R13), read on the client only: "this device" before mount, never a hydration mismatch.
const noSubscription = () => () => undefined;
const shortSideNow = (): number => Math.min(window.screen.width, window.screen.height);
const inAppNow = (): boolean => nativeBridge() !== null || inAppWebView();

// Simple mode's printer as the card names it: the saved one and how it is reached; on the Windows app, the chosen printer.
function printerOf(lane: DotLane, saved: DevicePrinter | null, chosen: string | null): { name: string; transport: TransportWord } | null {
  if (lane === "desktop") return chosen !== null ? { name: chosen, transport: "windows" } : null;
  return saved !== null ? { name: saved.name, transport: deviceTransportOf(saved) } : null;
}

// Printers mode: one toast for the whole Reconnect (spec §6.5); a chooser closed on every printer says nothing (F-M5).
function sayReconnected(result: ReconnectResult): void {
  if (result.connected.length === 0 && result.failed.length === 0) return;
  const { tone, text } = reconnectToastOf(result);
  if (tone === "success") toast.success(text);
  else toast.error(text);
}

// onClose: the sheet's own close (the header button's); none on /printers.
export function PrinterPanel({ home = "sheet", view = "status", onView, onClose }: { home?: "sheet" | "page"; view?: PrinterPanelView; onView?: (next: PrinterPanelView) => void; onClose?: () => void }) {
  const { pulse } = usePosPulseContext();
  const remote = usePrintHostDot();
  const { isHostDevice, deviceId } = usePrintHostContext();
  // PX-2 (spec §6.9 B6): held through the app's own retries, as the header button reads it.
  const snapshot = heldPrinterSnapshotOf(useDevicePrinter());
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const desktopChosen = useDesktopPrinterChosen();
  const desktop = useDesktopPrinterSnapshot();
  const canPrintHere = useCanPrintNow();
  const dotPrinters = useDotPrinters(deviceId);
  const { isAdmin } = useAuth();
  const router = useRouter();
  const shortSide = useSyncExternalStore(noSubscription, shortSideNow, () => null);
  const inApp = useSyncExternalStore(noSubscription, inAppNow, () => false);
  const [busy, setBusy] = useState(false);
  // F-M6 (spec §6.1): the views' scroll and focus, and where a fix that points at the setup lands.
  const { rootRef, listRef, onFocus, openSetup } = usePrinterPanelFocus({ home, view, onView });

  const dot = printerDotOf({ remote, isHostDevice, lane, local: snapshot.status, printers: dotPrinters, deviceOffline: !online, desktopChosen });
  const host = pulse?.printHost ?? null;
  const noun = deviceNounOf(lane, inApp, shortSide);
  const here = dotPrinters.here ?? [];
  const statusView = printerStatusViewOf({
    dot,
    hostLabel: host !== null && host.configured ? host.label : null,
    printer: printerOf(lane, snapshot.printer, desktop.selected),
    noun,
    isHostDevice,
    canPrintHere,
    desktopNoPrinter: lane === "desktop" && desktopChosen === "none",
    localStatus: snapshot.status,
    here,
    waiting: dotPrinters.waiting ?? null,
    notHere: dotPrinters.notHere ?? [],
    isAdmin,
  });
  // On /printers, which IS Printer setup, a link to it would go nowhere.
  const cardView = home === "page" && statusView.link?.kind === "printer-setup" ? { ...statusView, link: null } : statusView;

  const onAction = (kind: StatusActionKind): void => {
    if (kind !== "reconnect") return openSetup(SETUP_TARGETS[kind]);
    if (statusView.action?.kind !== "reconnect") return;
    // Ruling P: an empty subject is this device's own printer (simple mode): today's call and today's toast ("Printer
    // connected." or the device's own reason). Printers mode reconnects every printer that is down (spec §6.5). Either way
    // the first call is made here, before anything is awaited (the tap's user activation), and neither promise rejects, so
    // the button always comes back.
    const run = statusView.subject.length === 0 ? toastConnectOutcome(devicePrinter().reconnect()) : reconnectDown(statusView.subject, RECONNECT_DEPS).then(sayReconnected);
    setBusy(true);
    void run.finally(() => setBusy(false));
  };
  const onLink = (kind: StatusLinkKind): void => {
    // The review's Important 1: below 1280px the full-screen sheet would stay over Printer setup; close it first (as the
    // offline orders sheet's Fix and send does).
    if (kind === "printer-setup") {
      onClose?.();
      router.push("/printers");
    } else openSetup(SETUP_TARGETS[kind]);
  };
  const status = home === "page" || view === "status";
  const settings = home === "page" || view === "settings";

  // data-printer-panel scopes the fixes' focus targets to THIS panel; the Not printed card's wrapper draws no box of its
  // own (display: contents), it only tells the panel whether the focus is inside the card.
  return (
    <div
      ref={rootRef}
      data-printer-panel
      className="flex flex-col gap-3"
      onFocus={onFocus}
    >
      {status && (
        <>
          <PrinterStatusCard view={cardView} busy={busy} onAction={onAction} onLink={onLink} />
          <div ref={listRef} className="contents">
            <NotPrintedSection pulse={pulse} />
          </div>
          {dotPrinters.printersMode && here.length > 0 && <PrinterHereCard here={here} windowsApp={noun === "this PC"} />}
        </>
      )}
      {home === "sheet" && view === "status" && <PrinterSettingsRow sub={settingsRowSubOf(noun, dotPrinters.printersMode && !dotPrinters.isWriter)} onOpen={() => onView?.("settings")} />}
      {settings && <PrinterSettingsView home={home} noun={noun} onClose={onClose} />}
    </div>
  );
}
