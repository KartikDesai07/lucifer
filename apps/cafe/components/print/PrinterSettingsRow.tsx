"use client";

import { ChevronRight, SlidersHorizontal } from "lucide-react";

import {
  PRINTER_SECTION_TILE_CLASS,
  PRINTER_SETTINGS_ROW_CHEVRON_CLASS,
  PRINTER_SETTINGS_ROW_CLASS,
  PRINTER_SETTINGS_ROW_SUB_CLASS,
  PRINTER_SETTINGS_ROW_TEXT_CLASS,
  PRINTER_SETTINGS_ROW_TITLE_CLASS,
} from "@/components/print/printer-classes";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";

// Printer UX PX-2 (spec §6.2, §6.6): the status view's last part, one tap to today's setup (the settings view of the same
// sheet). Setup moved behind it so the fix is the first thing staff see.

const TITLE = "Printer settings";
const SUB = "Connect, change or remove a printer · paper size";

/** The row's sub: a device in printers mode that prints nothing says so with its noun ("This phone has no printer"). */
export function settingsRowSubOf(noun: DeviceNoun, printsNothing: boolean): string {
  if (!printsNothing) return SUB;
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} has no printer · Slips print at the cafe's printers`;
}

export function PrinterSettingsRow({ sub, onOpen }: { sub: string; onOpen: () => void }) {
  return (
    <button type="button" data-ui="printer-settings-row" className={PRINTER_SETTINGS_ROW_CLASS} onClick={onOpen}>
      <span aria-hidden="true" className={PRINTER_SECTION_TILE_CLASS}>
        <SlidersHorizontal />
      </span>
      <span className={PRINTER_SETTINGS_ROW_TEXT_CLASS}>
        <span className={PRINTER_SETTINGS_ROW_TITLE_CLASS}>{TITLE}</span>
        <span className={PRINTER_SETTINGS_ROW_SUB_CLASS}>{sub}</span>
      </span>
      <ChevronRight aria-hidden="true" className={PRINTER_SETTINGS_ROW_CHEVRON_CLASS} />
    </button>
  );
}
