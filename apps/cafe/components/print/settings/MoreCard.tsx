"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { navigateTo } from "@/lib/navigate";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import {
  PRINTER_MORE_CHEVRON_CLASS,
  PRINTER_MORE_CONFIRM_CLASS,
  PRINTER_MORE_ROW_BAD_CLASS,
  PRINTER_MORE_ROW_CLASS,
  PRINTER_SECTION_CARD_CLASS,
} from "@/components/print/printer-classes";
import { useAuth } from "@/hooks/use-auth";
import { usePrintCapabilities } from "@/hooks/use-device-printer";
import { usePrinterSetupActions } from "@/hooks/use-printer-setup-actions";
import { nativeHasFeature, nativeRequest } from "@/lib/printer/native-bridge";
import { MORE_ROW_WORDS, moreRowsOf, stopQuestionOf, type MoreRow } from "@/lib/printer/settings-view";
import { cn } from "@/lib/utils";

const CHANGE_ADDRESS_FAILED_MESSAGE = "Could not open the address screen. Try again.";
const BATTERY_FAILED_MESSAGE = "Could not open the battery steps. Try again.";

// More (PX-3 Task 10, spec §6.6 item 6; mockup t-settings; was the folded "More options" of PrinterAdvanced.tsx): one list
// of the rarely needed rows, each drawn only where it applies (moreRowsOf), and no card at all when none does. Inside the
// POS app, its address and (an app that has them) its battery steps; removing the printing device from any device that is
// not it (recovery from a phone); for admins, Printer setup. onClose: the sheet's own close (none on /printers).
export function MoreCard({ home, onClose }: { home: "sheet" | "page"; onClose?: () => void }) {
  const { native } = usePrintCapabilities();
  const battery = native && nativeHasFeature("battery");
  const { isAdmin } = useAuth();
  const { printersMode, isHostDevice, hostLabel, clear, clearing } = usePrinterSetupActions();
  const router = useRouter();
  const [confirmClear, setConfirmClear] = useState(false);
  const rows = moreRowsOf({ native, battery, printersMode, isHostDevice, hostSet: hostLabel !== null, isAdmin, home });
  if (rows.length === 0) return null;

  // Fire and forget: the app may leave this page at once, so there is no result to wait for.
  const open: Record<MoreRow, () => void> = {
    "change-address": () => {
      nativeRequest("app.changeUrl").catch(() => toast.error(CHANGE_ADDRESS_FAILED_MESSAGE));
    },
    battery: () => {
      nativeRequest("app.battery").catch(() => toast.error(BATTERY_FAILED_MESSAGE));
    },
    "remove-host": () => setConfirmClear(true),
    // The review's Important 1 (PX-2): below 1280px the full-screen sheet would stay over Printer setup; close it first.
    "printer-setup": () => {
      onClose?.();
      navigateTo(router, "/printers");
    },
  };

  return (
    <div data-ui="printer-more" className={PRINTER_SECTION_CARD_CLASS}>
      {rows.map((row) =>
        row === "remove-host" && confirmClear ? (
          // Its confirm says what it does, so the row needs no help line (X9).
          <div key={row} className={PRINTER_MORE_CONFIRM_CLASS}>
            <InlineConfirm
              question={stopQuestionOf(false)}
              yes="Yes, remove"
              no="No"
              disabled={clearing}
              onYes={() => {
                setConfirmClear(false);
                void clear();
              }}
              onNo={() => setConfirmClear(false)}
            />
          </div>
        ) : (
          <button
            key={row}
            type="button"
            className={cn(PRINTER_MORE_ROW_CLASS, row === "remove-host" && PRINTER_MORE_ROW_BAD_CLASS)}
            onClick={open[row]}
            disabled={row === "remove-host" && clearing}
          >
            <span className="min-w-0 flex-1">{MORE_ROW_WORDS[row]}</span>
            {row !== "remove-host" && <ChevronRight aria-hidden="true" className={PRINTER_MORE_CHEVRON_CLASS} />}
          </button>
        ),
      )}
    </div>
  );
}
