"use client";

import { PRINTER_HINT_CLASS } from "@/components/print/printer-classes";

const TIPS_TITLE = "If the slip did not print";
const TIPS: readonly string[] = [
  "Check the printer is on and has paper.",
  "Keep the printer close to this device.",
  "Go back and tap Reconnect, or tap Change to choose it again.",
  "Check the paper size above matches the roll in the printer.",
];

// Shown when the person answers "No — help me" to the test question. Advice
// only: nothing is sent to the server, no state of its own.
export function PrinterTestTips() {
  return (
    <div role="status" className={`${PRINTER_HINT_CLASS} flex flex-col gap-1`}>
      <p className="font-semibold">{TIPS_TITLE}</p>
      <ul className="list-disc space-y-1 pl-5">
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}
