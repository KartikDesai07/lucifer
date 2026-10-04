"use client";

import type { Ref } from "react";

import { APP_NAME } from "@pos/shared/constants";
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { HostTestSlip } from "@/lib/print-host-slips";
import type { Settings } from "@/types";

interface PrinterTestSlipProps {
  slip: HostTestSlip;
  settings?: Settings | null;
  ref?: Ref<HTMLDivElement>;
}

const TEST_PRINT_HEADING = "Test print";
const TEST_PRINT_BODY = "If you can read this, this printer prints its slips.";

// Printing redesign, Phase 2 Session 2D (spec §11): a printer's Test print, leased and acknowledged like any slip
// on that printer's line, so it proves the whole path (the server, the printing device, its printer). It names
// the printer and what the setup sends it, so staff can tell the right paper came out. Fixed 80mm like the host's
// test slip; the banner says REPRINT when a lost acknowledgement made it print again.
export function PrinterTestSlip({ slip, settings, ref }: PrinterTestSlipProps) {
  const at = new Date(slip.requestedAt).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
  return (
    <div ref={ref} className="w-[300px] p-2 font-mono text-sm">
      {slip.banner !== undefined && <p className="bg-black py-1 text-center font-bold text-white">{slip.banner}</p>}
      <p className="text-center font-bold">{settings?.restaurantName?.trim() || APP_NAME}</p>
      <p className="mt-1 text-center font-semibold">{TEST_PRINT_HEADING}</p>
      <p className="mt-1 text-center text-base font-bold">{slip.printerName}</p>
      {slip.lines.map((line, index) => (
        <p key={index} className="mt-1 text-xs">
          {line}
        </p>
      ))}
      <p className="mt-1 text-xs">
        {slip.requestedBy} · {at}
      </p>
      <p className="mt-1 text-center text-xs">{TEST_PRINT_BODY}</p>
    </div>
  );
}
