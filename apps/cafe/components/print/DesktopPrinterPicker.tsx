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

import { desktopPrinterApi, desktopPrinterSavesToFile, type DesktopPrinter, type DesktopPrintMode } from "@/lib/desktop-shell-printer";
import { publishDesktopPrinterSelection, refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { DesktopPrintMethod } from "@/components/print/DesktopPrintMethod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LOAD_FAILED_MESSAGE = "Could not read the printer list from the desktop app.";
const SAVE_FAILED_MESSAGE = "Could not save the printer — pick it again.";
const SAVED_MESSAGE = "Printer saved — slips will print on it from now on.";
const CLEARED_MESSAGE = "Printer cleared — slips will not print until you pick one.";
const NOT_CHOSEN_VALUE = "";
const NOT_CHOSEN_LABEL = "Not chosen — slips will not print";
// The file-writing devices: one list in the page since Phase 2 Session 2E (lib/desktop-shell-printer.ts).
const savesToFile = desktopPrinterSavesToFile;

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
      // The dot and canPrintNow() read the shared choice: it follows the shell's own answer at once
      // (the re-read below is only a follow-up and may fail).
      publishDesktopPrinterSelection(result.selected);
      void refreshDesktopPrinterChosen();
      toast.success(result.selected === null ? CLEARED_MESSAGE : SAVED_MESSAGE);
    } catch {
      toast.error(SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  // A saved printer Windows no longer lists (removed or renamed) reads "Not chosen" with the hint below — the
  // native select showed its first option the same way; a Radix Select would show an empty box.
  const shownPrinter = selected !== null && (printers ?? []).some((p) => p.name === selected) ? selected : NOT_CHOSEN_VALUE;

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
          <Select value={shownPrinter} disabled={saving} onValueChange={(v) => void choose(v)}>
            <SelectTrigger aria-label="Printer" className="h-11 w-full max-w-sm text-base">
              <SelectValue placeholder={NOT_CHOSEN_LABEL} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_CHOSEN_VALUE} className="pointer-coarse:min-h-11">
                {NOT_CHOSEN_LABEL}
              </SelectItem>
              {printers.map((p) => {
                const virtual = savesToFile(p.name);
                return (
                  <SelectItem key={p.name} value={p.name} disabled={virtual} className="pointer-coarse:min-h-11">
                    {(p.displayName || p.name) + (virtual ? " — saves a file, cannot be used" : "")}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {shownPrinter === NOT_CHOSEN_VALUE && (
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
