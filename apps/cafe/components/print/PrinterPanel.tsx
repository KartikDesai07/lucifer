"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { BillPrinterSection } from "@/components/print/BillPrinterSection";
import { NotPrintedSection } from "@/components/print/NotPrintedSection";
import { PrinterHereCard } from "@/components/print/PrinterHereCard";
import { PrinterSettingsRow, settingsRowSubOf } from "@/components/print/PrinterSettingsRow";
import { PrinterSetupCard } from "@/components/print/PrinterSetupCard";
import { PrinterStatusCard } from "@/components/print/PrinterStatusCard";
import { useDotPrinters } from "@/hooks/use-agent-printers";
import { useAuth } from "@/hooks/use-auth";
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
// the SETTINGS view: today's setup, unchanged, one tap away. One panel in two homes: the top-bar frame (PrinterPanelFrame:
// its head, scroller and Done foot; the view is the button's) and /printers (inline, both views, no row, no Done). It reads
// the pulse for the printing device's name, which only lives there: the deliberate extra reader of the pulse; it mounts
// only where the panel is open, never in the POS screen's render path.

export type PrinterPanelView = "status" | "settings";

const FRAME_SELECTOR = '[data-ui="printer-panel"]';
const BODY_SELECTOR = '[data-ui="printer-panel-body"]';
const TITLE_SELECTOR = '[data-ui="printer-panel-title"]';
const HEADLINE_SELECTOR = '[data-ui="printer-status-headline"]';
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

// Targets are looked up inside THIS panel, never the whole page (the sheet and /printers can both be mounted).
function focusAndShow(root: HTMLElement | null, selector: string): boolean {
  const target = root?.querySelector<HTMLElement>(selector) ?? null;
  if (target === null) return false;
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
  return true;
}

// One toast for the whole Reconnect (spec §6.5); a chooser closed on every printer says nothing (F-M5).
function sayReconnected(result: ReconnectResult): void {
  if (result.connected.length === 0 && result.failed.length === 0) return;
  const { tone, text } = reconnectToastOf(result);
  if (tone === "success") toast.success(text);
  else toast.error(text);
}

export function PrinterPanel({ home = "sheet", view = "status", onView }: { home?: "sheet" | "page"; view?: PrinterPanelView; onView?: (next: PrinterPanelView) => void }) {
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
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listFocused = useRef(false);
  const hadList = useRef(false);
  const shownView = useRef(view);
  const pendingTarget = useRef<string | null>(null);

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

  // F-M6: a view switch keeps the sheet; it scrolls back to the top, and the focus goes to the part an action pointed at
  // (today's focusAndShow), else to the new view's title.
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    const frame = rootRef.current?.closest<HTMLElement>(FRAME_SELECTOR) ?? null;
    const body = frame?.querySelector<HTMLElement>(BODY_SELECTOR) ?? null;
    if (body !== null) body.scrollTop = 0;
    const target = pendingTarget.current;
    pendingTarget.current = null;
    if (target !== null && focusAndShow(rootRef.current, target)) return;
    frame?.querySelector<HTMLElement>(TITLE_SELECTOR)?.focus({ preventScroll: true });
  }, [view]);

  // F-M6: the Not printed card left (Clear all, the last Clear, its slips printing) while it held the focus: the status
  // card's headline takes it. A focus that went elsewhere is never moved.
  useEffect(() => {
    const has = (listRef.current?.childElementCount ?? 0) > 0;
    const left = hadList.current && !has;
    hadList.current = has;
    if (!left || !listFocused.current) return;
    listFocused.current = false;
    const active = document.activeElement;
    const frame = rootRef.current?.closest(FRAME_SELECTOR) ?? null;
    if (active !== null && active !== document.body && active !== frame) return;
    rootRef.current?.querySelector<HTMLElement>(HEADLINE_SELECTOR)?.focus({ preventScroll: true });
  });

  const openSetup = (selector: string): void => {
    if (home === "page") {
      focusAndShow(rootRef.current, selector);
      return;
    }
    pendingTarget.current = selector;
    onView?.("settings");
  };
  const onAction = (kind: StatusActionKind): void => {
    if (kind !== "reconnect") return openSetup(SETUP_TARGETS[kind]);
    if (statusView.action?.kind !== "reconnect") return;
    // reconnectDown makes its first call before anything is awaited: the tap's user activation reaches the reconnect.
    const run = reconnectDown(statusView.subject, RECONNECT_DEPS);
    setBusy(true);
    void run.then(sayReconnected).finally(() => setBusy(false));
  };
  const onLink = (kind: StatusLinkKind): void => {
    if (kind === "printer-setup") router.push("/printers");
    else openSetup(SETUP_TARGETS[kind]);
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
      onFocus={(event) => {
        listFocused.current = listRef.current?.contains(event.target as Node) ?? false;
      }}
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
      {settings && (
        <>
          <PrinterSetupCard />
          <BillPrinterSection />
        </>
      )}
    </div>
  );
}
