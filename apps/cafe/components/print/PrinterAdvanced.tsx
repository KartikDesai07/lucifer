"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { usePrintCapabilities } from "@/hooks/use-device-printer";
import { nativeRequest } from "@/lib/printer/native-bridge";

const CHANGE_ADDRESS_FAILED_MESSAGE = "Could not open the address screen. Try again.";
const CLEAR_HELP = "If the printing device is down, remove it from any device, even a phone. Waiting slips are cancelled and every device prints its own slips again.";

interface PrinterAdvancedProps {
  /** The remove-the-printing-device control; null while it sits in "Where slips print". */
  clearControl: ReactNode;
}

// Rarely needed controls, folded away: removing the printing device from a
// device that is not it, and (inside the POS app) changing the POS address.
export function PrinterAdvanced({ clearControl }: PrinterAdvancedProps) {
  const { native } = usePrintCapabilities();
  if (clearControl === null && !native) return null;

  // Fire and forget: the app may leave this page at once, so there is no result to wait for.
  const changeAddress = () => {
    nativeRequest("app.changeUrl").catch(() => toast.error(CHANGE_ADDRESS_FAILED_MESSAGE));
  };

  return (
    <Collapsible className={`${BRAND_PANEL_CLASS} rounded-lg border p-4 text-sm`}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="h-11 w-full justify-between px-2 text-base font-semibold text-brand-ink">
          More options
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3">
        {clearControl !== null && (
          <div className="space-y-2">
            {clearControl}
            <p className="text-xs text-brand-muted">{CLEAR_HELP}</p>
          </div>
        )}
        {native && (
          <Button variant="outline" className={PRINTER_ACTION_CLASS} onClick={changeAddress}>
            Change POS address
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
