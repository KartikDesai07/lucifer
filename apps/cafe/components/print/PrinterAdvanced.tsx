"use client";

import type { ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import {
  PRINTER_BUTTON_CLASS,
  PRINTER_MORE_BODY_CLASS,
  PRINTER_MORE_CHEVRON_CLASS,
  PRINTER_MORE_TRIGGER_CLASS,
  PRINTER_NOTE_CLASS,
  PRINTER_RULE_BLOCK_CLASS,
  PRINTER_SECTION_CARD_CLASS,
  PRINTER_SECTION_TILE_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePrintCapabilities } from "@/hooks/use-device-printer";
import { nativeHasFeature, nativeRequest } from "@/lib/printer/native-bridge";

const CHANGE_ADDRESS_FAILED_MESSAGE = "Could not open the address screen. Try again.";
const BATTERY_FAILED_MESSAGE = "Could not open the battery steps. Try again.";
const BATTERY_HELP = "Some phones stop the POS app when the screen is off. These steps keep slips printing.";
const CLEAR_HELP = "If the printing device is down, remove it from any device — even a phone. Waiting slips are cancelled and every device prints its own slips again.";

interface PrinterAdvancedProps {
  /** The remove-the-printing-device control; null while it sits in "Where slips print". */
  clearControl: ReactNode;
}

// Rarely needed controls, folded away: removing the printing device from a
// device that is not it, and (inside the POS app) changing the POS address. Phase 3 Session 3D (spec §9.5): and the
// POS app's battery checklist, on an app that says it has one.
export function PrinterAdvanced({ clearControl }: PrinterAdvancedProps) {
  const { native } = usePrintCapabilities();
  if (clearControl === null && !native) return null;

  // Fire and forget: the app may leave this page at once, so there is no result to wait for.
  const changeAddress = () => {
    nativeRequest("app.changeUrl").catch(() => toast.error(CHANGE_ADDRESS_FAILED_MESSAGE));
  };
  const battery = native && nativeHasFeature("battery");
  const openBattery = () => {
    nativeRequest("app.battery").catch(() => toast.error(BATTERY_FAILED_MESSAGE));
  };

  return (
    <Collapsible className={PRINTER_SECTION_CARD_CLASS}>
      <CollapsibleTrigger asChild>
        <button type="button" className={`group ${PRINTER_MORE_TRIGGER_CLASS}`}>
          <span aria-hidden="true" className={PRINTER_SECTION_TILE_CLASS}>
            <SlidersHorizontal />
          </span>
          <span className="min-w-0 flex-1 text-[14px] font-semibold">More options</span>
          <ChevronDown className={PRINTER_MORE_CHEVRON_CLASS} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className={PRINTER_MORE_BODY_CLASS}>
        {clearControl !== null && (
          <div className={PRINTER_RULE_BLOCK_CLASS}>
            {clearControl}
            <p className={PRINTER_NOTE_CLASS}>{CLEAR_HELP}</p>
          </div>
        )}
        {native && (
          <div className={PRINTER_RULE_BLOCK_CLASS}>
            <Button variant="outline" className={PRINTER_BUTTON_CLASS} onClick={changeAddress}>
              Change POS address
            </Button>
          </div>
        )}
        {battery && (
          <div className={PRINTER_RULE_BLOCK_CLASS}>
            <Button variant="outline" className={PRINTER_BUTTON_CLASS} onClick={openBattery}>
              Battery settings for printing
            </Button>
            <p className={PRINTER_NOTE_CLASS}>{BATTERY_HELP}</p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
