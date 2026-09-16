"use client";

import type { Ref } from "react";

import { APP_NAME } from "@pos/shared/constants";
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { Settings } from "@/types";

interface PrintHostTestSlipProps {
  settings?: Settings | null;
  ref?: Ref<HTMLDivElement>;
}

const TEST_SLIP_HEADING = "Print host test";
const TEST_SLIP_BODY = "If this printed with no dialog, this PC prints silently.";

// Print-host plan §B7 (PH-5) — the attestation slip PH-7's "Test print" sends
// through the host's KOT surface. Rendered through the SAME bridge as every
// job (design review MERGED-13), never a component-owned trigger. Fixed 80mm
// like the end-of-day summary; the cafe's own name comes from Settings, the
// generic product name is the fallback (never a hardcoded cafe).
export function PrintHostTestSlip({ settings, ref }: PrintHostTestSlipProps) {
  const printedAt = new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
  return (
    <div ref={ref} className="w-[300px] p-2 text-center font-mono text-sm">
      <p className="font-bold">{settings?.restaurantName?.trim() || APP_NAME}</p>
      <p className="mt-1 font-semibold">{TEST_SLIP_HEADING}</p>
      <p className="mt-1 text-xs">{TEST_SLIP_BODY}</p>
      <p className="mt-1 text-xs">{printedAt}</p>
    </div>
  );
}
