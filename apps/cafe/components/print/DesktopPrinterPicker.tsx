"use client";

// 2026-09-17. THE blank-print cause on the counter PC: the desktop shell
// printed silently to whatever Windows called the DEFAULT printer, because
// its `deviceName` was null and v1 shipped no picker ("hand-edited on disk").
// On a PC whose default is a virtual device — Microsoft Print to PDF, OneNote,
// XPS Document Writer, Fax — every slip disappears into it: no error, no
// paper, and the thermal printer looks broken while being perfectly healthy.
// The browser print dialog kept working the whole time precisely because the
// operator picks the printer there. This control is that choice, made once.
//
// Feature-detected, never assumed: the installed shell is hand-copied and
// never auto-updates, so an older build exposes a bridge with no picker at
// all. In that case this renders an instruction instead of a dead dropdown.
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { desktopPrinterApi, type DesktopPrinter, type DesktopPrintMode } from "@/lib/desktop-shell-printer";
import { DesktopPrintMethod } from "@/components/print/DesktopPrintMethod";

const LOAD_FAILED_MESSAGE = "Could not read the printer list from the desktop app.";
const SAVE_FAILED_MESSAGE = "Could not save the printer — pick it again.";
const SAVED_MESSAGE = "Printer saved — slips will print on it from now on.";
const CLEARED_MESSAGE = "Printer cleared — slips will not print until you pick one.";
const NOT_CHOSEN_VALUE = "";
// Mirrors NON_PAPER_PRINTER_PATTERNS in apps/desktop/src/shared.ts, which is
// the ENFORCING copy — the shell refuses these whatever this list says. Here
// they are only greyed out with a reason, so the operator understands why.
const NON_PAPER_PATTERNS = [
  "print to pdf",
  "xps document writer",
  "onenote",
  "fax",
  "adobe pdf",
  "pdfcreator",
];

function savesToFile(name: string): boolean {
  const lower = name.toLowerCase();
  return NON_PAPER_PATTERNS.some((p) => lower.includes(p));
}

export function DesktopPrinterPicker() {
  // undefined = still deciding; null = this shell has no picker.
  const [api, setApi] = useState<ReturnType<typeof desktopPrinterApi> | undefined>(undefined);
  const [printers, setPrinters] = useState<DesktopPrinter[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState<DesktopPrintMode | undefined>(undefined);

  // Bridge presence is a CLIENT fact (window.posDesktop) — read after mount,
  // never during render, so the server and the first client paint agree.
  useEffect(() => {
    const found = desktopPrinterApi();
    setApi(found);
    if (!found) return;
    let live = true;
    found
      .listPrinters()
      .then((list) => {
        if (!live) return;
        setPrinters(list.printers);
        setSelected(list.selected);
        setPrintMode(list.printMode);
      })
      .catch(() => {
        if (live) toast.error(LOAD_FAILED_MESSAGE);
      });
    return () => {
      live = false;
    };
  }, []);

  // Not the desktop app at all, or a shell too old to have the picker. Both
  // are normal: most devices are tablets and phones.
  if (api === undefined || api === null) return null;

  const choose = async (value: string) => {
    const name = value === NOT_CHOSEN_VALUE ? null : value;
    setSaving(true);
    try {
      const result = await api.savePrinter(name);
      setSelected(result.selected);
      toast.success(result.selected === null ? CLEARED_MESSAGE : SAVED_MESSAGE);
    } catch {
      toast.error(SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-medium">Printer for this PC</p>
      {printers === null ? (
        <p className="text-xs text-muted-foreground">Reading the printer list…</p>
      ) : printers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Windows reports no printers on this PC. Add the printer in Windows Settings, then reopen
          this page.
        </p>
      ) : (
        <>
          <select
            className="h-9 w-full max-w-sm rounded-md border bg-background px-2 text-sm"
            value={selected ?? NOT_CHOSEN_VALUE}
            disabled={saving}
            onChange={(e) => void choose(e.target.value)}
          >
            <option value={NOT_CHOSEN_VALUE}>Not chosen — slips will not print</option>
            {printers.map((p) => {
              const virtual = savesToFile(p.name);
              return (
                <option key={p.name} value={p.name} disabled={virtual}>
                  {(p.displayName || p.name) + (virtual ? " — saves a file, cannot be used" : "")}
                </option>
              );
            })}
          </select>
          {selected === null && (
            <p className="text-xs text-amber-600">
              No printer is chosen, so slips will not print on this PC. Pick the thermal printer
              above.
            </p>
          )}
          {printers.every((p) => savesToFile(p.name)) && (
            <p className="text-xs text-amber-600">
              Every device on this PC saves a file instead of printing. Connect the thermal printer
              and install its driver, then reopen this page.
            </p>
          )}
          {printers.length > 0 && typeof api.savePrintMode === "function" && printMode !== undefined && (
            <DesktopPrintMethod api={api} savePrintMode={api.savePrintMode} printMode={printMode} />
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Pick the thermal printer. Devices that save a file — Microsoft Print to PDF, XPS, OneNote,
        Fax — cannot be chosen: sending a slip to one of those is why nothing came out of the
        printer, or why a &ldquo;save file&rdquo; window appeared.
      </p>
    </div>
  );
}
