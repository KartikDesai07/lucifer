"use client";

import { useCallback, useState } from "react";

import { CONNECT_BACK_LABEL, CONNECT_TITLE, connectFlowReducer, connectHeadOf, connectStartOf, type ConnectEntry, type ConnectEvent, type ConnectState } from "@/lib/printer/connect-flow";

// The printer sheet's views (spec §6.1; PX-2 Task 6, PX-3 Task 11): status (every open), settings, and the guided connect
// with its step. Panel-local state, never a route: the top-bar button owns the sheet's (so a sheet sliding shut keeps showing
// its view, Ruling Q) and /printers' panel owns its own. A late event for a flow that was left changes nothing.

export type PrinterPanelView = "status" | "settings" | "connect";

export interface PrinterViews {
  view: PrinterPanelView;
  /** The guided connect's state while (or since) it is shown; null before the first connect. */
  connect: ConnectState | null;
  show(next: "status" | "settings"): void;
  startConnect(entry: ConnectEntry): void;
  send(event: ConnectEvent): void;
}

export function usePrinterViews(): PrinterViews {
  const [view, setView] = useState<PrinterPanelView>("status");
  const [connect, setConnect] = useState<ConnectState | null>(null);
  // Stable, so the button's open listener and the steps' effects never re-run for a new function.
  const show = useCallback((next: "status" | "settings") => setView(next), []);
  const startConnect = useCallback((entry: ConnectEntry) => {
    setConnect(connectStartOf(entry));
    setView("connect");
  }, []);
  const send = useCallback((event: ConnectEvent) => setConnect((state) => (state === null ? null : connectFlowReducer(state, event))), []);
  return { view, connect, show, startConnect, send };
}

const NOOP = (): void => undefined;

/** The sheet's views, handed to the panel by the button, in the shape of the page's own (absent ones do nothing). */
export function sheetViewsOf(props: {
  view?: PrinterPanelView;
  connect?: ConnectState | null;
  onView?: (next: "status" | "settings") => void;
  onConnect?: (entry: ConnectEntry) => void;
  onConnectEvent?: (event: ConnectEvent) => void;
}): PrinterViews {
  return { view: props.view ?? "status", connect: props.connect ?? null, show: props.onView ?? NOOP, startConnect: props.onConnect ?? NOOP, send: props.onConnectEvent ?? NOOP };
}

export const STATUS_TITLE = "Printer";
export const SETTINGS_TITLE = "Printer settings";

export interface PrinterFrameHead {
  title: string;
  sub?: string;
  backLabel?: string;
  onBack?: () => void;
  onCancel?: () => void;
}

/** The frame's head and foot for a view: status, the title only; settings, the back to status; the connect view, its
 *  step's sub, the back to settings, and Cancel (back to settings too, X3) until a printer is connected, then Done. */
export function printerFrameOf(view: PrinterPanelView, connect: ConnectState | null, show: (next: "status" | "settings") => void): PrinterFrameHead {
  if (view === "settings") return { title: SETTINGS_TITLE, onBack: () => show("status") };
  if (view !== "connect" || connect === null) return { title: STATUS_TITLE };
  const head = connectHeadOf(connect);
  const toSettings = (): void => show("settings");
  return { title: CONNECT_TITLE, sub: head.sub, backLabel: CONNECT_BACK_LABEL, onBack: toSettings, onCancel: head.foot === "cancel" ? toSettings : undefined };
}
