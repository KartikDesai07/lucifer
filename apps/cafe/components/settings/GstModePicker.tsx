"use client";

import { useId } from "react";

import { GST_MODES } from "@/lib/constants";
import type { GstMode } from "@/lib/constants";
import { sampleGstBill, SAMPLE_ITEM_PRICE } from "@/lib/gst-sample-bill";
import { cn, inr } from "@/lib/utils";
import {
  SETTINGS_TILE_CLASS,
  SETTINGS_TILE_DOT_CLASS,
  SETTINGS_TILE_OFF_CLASS,
  SETTINGS_TILE_ON_CLASS,
  SETTINGS_TILE_RADIO_CLASS,
  SETTINGS_TILE_RADIO_OFF_CLASS,
  SETTINGS_TILE_RADIO_ON_CLASS,
} from "@/lib/settings-card-layout";

// Plain-English copy for the GST_MODES enum — never render the raw value.
const GST_MODE_COPY: Record<GstMode, { label: string; description: string }> = {
  inclusive: {
    label: "GST in the price",
    description: "Menu prices already include GST. The bill shows the GST part.",
  },
  exclusive: {
    label: "GST added on top",
    description: "GST is added to the bill, so the customer pays more than the menu price.",
  },
};

const EXAMPLE_CLASS =
  "space-y-0.5 overflow-clip rounded-[8px] border border-border-2 bg-surface-2 p-2 text-xs tabular-nums text-foreground";

function ExampleRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// A ₹100 menu item under this tile's mode at the live rate — priced by the
// same helper as the bill preview, so the two can never disagree.
function ModeExample({ mode, rate }: { mode: GstMode; rate: number }) {
  const bill = sampleGstBill({ gstEnabled: true, gstRate: rate, gstMode: mode });
  if (!bill) {
    return (
      <div className={EXAMPLE_CLASS}>
        <p className="text-muted-foreground">Enter a rate to see an example.</p>
      </div>
    );
  }
  const { gst, total } = bill;
  return (
    <div className={EXAMPLE_CLASS}>
      <ExampleRow label="Menu price" value={inr(SAMPLE_ITEM_PRICE)} />
      {!gst.show && <p className="text-muted-foreground">No GST at {rate}%</p>}
      {gst.show && gst.inclusive && (
        <>
          <ExampleRow label="Customer pays" value={inr(total)} />
          <p className="text-muted-foreground">{inr(gst.gstAmount)} GST inside</p>
        </>
      )}
      {gst.show && !gst.inclusive && (
        <>
          <ExampleRow label={`GST @${gst.rate}%`} value={`+${inr(gst.gstAmount)}`} muted />
          <ExampleRow label="Customer pays" value={inr(total)} />
        </>
      )}
      {!gst.show && <ExampleRow label="Customer pays" value={inr(total)} />}
    </div>
  );
}

// Two tiles instead of a drop-down: each is a <label> around a visually hidden
// native radio (same idiom as PosLayoutPicker), with a worked example at the
// live rate in place of a sketch.
export function GstModePicker({
  value,
  onChange,
  rate,
}: {
  value: GstMode;
  onChange: (value: GstMode) => void;
  rate: number;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">How prices work</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GST_MODES.map((option) => {
          const selected = value === option;
          const copy = GST_MODE_COPY[option];
          return (
            <label
              key={option}
              className={cn(SETTINGS_TILE_CLASS, selected ? SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS)}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                aria-labelledby={`${name}-${option}-label`}
                aria-describedby={`${name}-${option}-description ${name}-${option}-example`}
              />
              {/* The radio is named by the tile's label alone; the copy and the
                  worked example describe it (they come first visually). */}
              <div id={`${name}-${option}-example`}>
                <ModeExample mode={option} rate={rate} />
              </div>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(SETTINGS_TILE_RADIO_CLASS, selected ? SETTINGS_TILE_RADIO_ON_CLASS : SETTINGS_TILE_RADIO_OFF_CLASS)}
                >
                  {selected && <span className={SETTINGS_TILE_DOT_CLASS} />}
                </span>
                <span id={`${name}-${option}-label`} className="text-[13px] font-medium text-foreground">{copy.label}</span>
              </span>
              <span id={`${name}-${option}-description`} className="text-xs text-muted-foreground">{copy.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
