"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PrintDeviceSummary, PrintJobRef } from "@pos/shared/print-agent-wire";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { PRINTERS_KEYS } from "@/hooks/use-agent-printers";
import { CATEGORY_KEYS } from "@/hooks/use-categories";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { apiGet, apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { desktopPrinterApi } from "@/lib/desktop-shell-printer";
import { deliverLeasedJob, kickPrintAgent } from "@/lib/print-agent";
import { printAgentHeaders } from "@/lib/print-agent-calls";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 2 Session 2D (spec §11): the Printer setup page's reads and writes. Reads happen on that
// page only (mount and focus; never polled), so they add nothing to an ordering device's day. Every write refreshes
// the printers this device reads (the agent's list too: a save on this device never waits for its print-setup
// frame). House rule: each error is toasted here, at the hook, never in a per-call callback.

export const STATIONS_KEYS = { all: ["stations"] as const };
export const PRINT_DEVICES_KEYS = { all: ["print-devices"] as const };

const NO_STATIONS: StationConfig[] = [];
const NO_DEVICES: PrintDeviceSummary[] = [];
const SAVE_ERROR = "Could not save. Try again.";
const DELETE_ERROR = "Could not delete. Try again.";
const TEST_ERROR = "Could not send the test slip. Try again.";

function errorText(err: Error, fallback: string): string {
  return err.message.trim() || fallback;
}

/** The kitchen stations (the first read seeds the default "Kitchen"). `ready` once the first answer is in: a form
 *  that saves stations waits for it (the 2D gate's review, I-1). */
export function useStations(enabled = true): { stations: StationConfig[]; ready: boolean; failed: boolean } {
  const query = useQuery({ queryKey: STATIONS_KEYS.all, queryFn: () => apiGet<StationConfig[]>("/api/stations"), enabled });
  return { stations: query.data ?? NO_STATIONS, ready: query.isSuccess, failed: query.isError };
}

/** The devices that print or lease (admin), the most recently seen first; whether they are in, and whether the read
 *  failed (the 2D review gate, M-7: an empty list while loading reads as "no device has checked in"). */
export function usePrintDevices(enabled = true): { devices: PrintDeviceSummary[]; loaded: boolean; failed: boolean } {
  const query = useQuery({ queryKey: PRINT_DEVICES_KEYS.all, queryFn: () => apiGet<PrintDeviceSummary[]>("/api/print-devices"), enabled });
  return { devices: query.data ?? NO_DEVICES, loaded: query.isSuccess, failed: query.isError };
}

/** The Windows app's chosen printer, the address a Windows printer is saved with (null: not the Windows app, or
 *  not read). Read once per mount of the form that needs it. */
export function useDesktopPrinterName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktopShell()) return;
    let live = true;
    void desktopPrinterApi()
      ?.listPrinters()
      .then(
        (list) => {
          if (live) setName(list.selected);
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, []);
  return name;
}

export function useSavePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PrinterBody }) =>
      id === undefined ? apiSend<PrinterConfig>("/api/printers", "POST", body) : apiSend<PrinterConfig>(`/api/printers/${encodeURIComponent(id)}`, "PUT", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all }),
    onError: (err: Error) => toast.error(errorText(err, SAVE_ERROR)),
  });
}

export function useDeletePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ deleted: true }>(`/api/printers/${encodeURIComponent(id)}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all }),
    onError: (err: Error) => toast.error(errorText(err, DELETE_ERROR)),
  });
}

/** A printer's Test print. The agent headers name this device and tab: when this tab prints that printer, the
 *  answer carries the slip leased to it and it prints at once; otherwise its printing device hears of it. */
export function useTestPrinter() {
  return useMutation({
    mutationFn: (id: string) => apiSend<PrintJobRef>(`/api/printers/${encodeURIComponent(id)}/test`, "POST", {}, { headers: printAgentHeaders(readDeviceId()) }),
    onSuccess: (ref: PrintJobRef) => {
      if (ref.leased !== undefined) deliverLeasedJob(ref.leased);
      else if (ref.targetDeviceId === readDeviceId()) kickPrintAgent();
    },
    onError: (err: Error) => toast.error(errorText(err, TEST_ERROR)),
  });
}

export function useSaveStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { name?: string; isDefault?: true } }) =>
      id === undefined ? apiSend<StationConfig>("/api/stations", "POST", body) : apiSend<StationConfig>(`/api/stations/${encodeURIComponent(id)}`, "PUT", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: STATIONS_KEYS.all }),
    onError: (err: Error) => toast.error(errorText(err, SAVE_ERROR)),
  });
}

/** A station's delete also changes the categories, items and printers that chose it (they fall back to the default). */
export function useDeleteStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ deleted: true }>(`/api/stations/${encodeURIComponent(id)}`, "DELETE"),
    onSuccess: () =>
      Promise.all([STATIONS_KEYS.all, PRINTERS_KEYS.all, CATEGORY_KEYS.all, PRODUCT_KEYS.all].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    onError: (err: Error) => toast.error(errorText(err, DELETE_ERROR)),
  });
}
