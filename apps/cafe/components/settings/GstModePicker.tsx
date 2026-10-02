"use client";

import { useId } from "react";

import { GST_MODES } from "@/lib/constants";
import type { GstMode } from "@/lib/constants";
import { sampleGstBill, SAMPLE_ITEM_PRICE } from "@/lib/gst-sample-bill";
import { cn, inr } from "@/lib/utils";

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
  "space-y-0.5 overflow-hidden rounded-md border border-brand-rule bg-brand-paper p-2 text-xs tabular-nums text-brand-ink";

function ExampleRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", muted && "text-brand-muted")}>
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
        <p className="text-brand-muted">Enter a rate to see an example.</p>
      </div>
    );
  }
  const { gst, total } = bill;
  return (
    <div className={EXAMPLE_CLASS}>
      <ExampleRow label="Menu price" value={inr(SAMPLE_ITEM_PRICE)} />
      {!gst.show && <p className="text-brand-muted">No GST at {rate}%</p>}
      {gst.show && gst.inclusive && (
        <>
          <ExampleRow label="Customer pays" value={inr(total)} />
          <p className="text-brand-muted">{inr(gst.gstAmount)} GST inside</p>
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
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                selected
                  ? "border-brand-primary bg-brand-primary-soft"
                  : "border-brand-rule bg-brand-slip hover:bg-brand-wash",
              )}
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
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    selected ? "border-brand-primary" : "border-brand-field",
                  )}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-brand-primary" />}
                </span>
                <span id={`${name}-${option}-label`} className="text-[13px] font-medium text-brand-ink">{copy.label}</span>
              </span>
              <span id={`${name}-${option}-description`} className="text-xs text-brand-muted">{copy.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
