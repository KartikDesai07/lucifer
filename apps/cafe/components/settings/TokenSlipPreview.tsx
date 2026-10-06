"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { TokenSlip } from "@/components/print/slip/TokenSlip";
import { sampleTokenOrder } from "@/lib/bill-print-sample";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// The Tokens page's sample slip: the REAL token renderer over a sample order, so it follows the draft (the page hands
// in `settings` with the draft as its tokenTemplate) and the start number the moment either changes. The number shows
// whether tokens are on or off, so the slip can be set up first. A token design is eager and needs no lazy chunk, so
// there is no skeleton here; only a QR line waits for its encoder, and the slip itself re-renders when it is in.
export function TokenSlipPreview({ control, settings }: { control: Control<SettingsInput>; settings: Settings }) {
  const tokenNumberStart = useWatch({ control, name: "tokenNumberStart" });
  // The saved settings (and the draft) with the form's unsaved start number laid over them.
  const live: Settings = { ...settings, tokenNumberStart };
  // Fixed once per mount so the sample's time does not tick while editing.
  const [createdAt] = useState(() => new Date().toISOString());

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto w-fit shadow-sm ring-1 ring-black/5">
        <TokenSlip order={sampleTokenOrder(createdAt, live)} settings={live} />
      </div>
    </div>
  );
}
