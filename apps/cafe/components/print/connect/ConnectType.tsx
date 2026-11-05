"use client";

import { Bluetooth, ChevronRight, Usb, Wifi, type LucideIcon } from "lucide-react";

import {
  PRINTER_CONNECT_CHEVRON_CLASS,
  PRINTER_CONNECT_CHOICE_CLASS,
  PRINTER_CONNECT_CHOICE_SUB_CLASS,
  PRINTER_CONNECT_CHOICE_TILE_CLASS,
  PRINTER_CONNECT_CHOICE_TITLE_CLASS,
  PRINTER_CONNECT_HEADING_CLASS,
  PRINTER_SETTINGS_ROW_TEXT_CLASS,
} from "@/components/print/printer-classes";
import { CONNECT_WORDS, connectChoicesOf, type ConnectTransport } from "@/lib/printer/connect-flow";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";

// Step 1 of the guided connect (PX-3 Task 11, spec §6.7 item 1; mockup g1): what kind of printer, three 72px rows. Props
// only: a tap names the kind, the flow opens its list.

const ICONS: Record<ConnectTransport, LucideIcon> = { bluetooth: Bluetooth, usb: Usb, network: Wifi };

export function ConnectType({ noun, onChoose }: { noun: DeviceNoun; onChoose(transport: ConnectTransport): void }) {
  return (
    <>
      <h3 className={PRINTER_CONNECT_HEADING_CLASS}>{CONNECT_WORDS.question}</h3>
      {connectChoicesOf(noun).map((choice) => {
        const Icon = ICONS[choice.transport];
        return (
          <button key={choice.transport} type="button" data-transport={choice.transport} className={PRINTER_CONNECT_CHOICE_CLASS} onClick={() => onChoose(choice.transport)}>
            <span aria-hidden="true" className={PRINTER_CONNECT_CHOICE_TILE_CLASS}>
              <Icon />
            </span>
            <span className={PRINTER_SETTINGS_ROW_TEXT_CLASS}>
              <span className={PRINTER_CONNECT_CHOICE_TITLE_CLASS}>{choice.title}</span>
              <span className={PRINTER_CONNECT_CHOICE_SUB_CLASS}>{choice.sub}</span>
            </span>
            <ChevronRight aria-hidden="true" className={PRINTER_CONNECT_CHEVRON_CLASS} />
          </button>
        );
      })}
    </>
  );
}
