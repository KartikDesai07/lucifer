"use client";

const TIPS_TITLE = "If the slip did not print";
const TIPS: readonly string[] = [
  "Check the printer is on and has paper.",
  "Keep the printer close to this device.",
  "Tap Reconnect, or Change printer to choose it again.",
  "Check the paper size above matches the roll in the printer.",
];

// Shown when the person answers "No — help me" to the test question. Advice
// only: nothing is sent to the server, no state of its own.
export function PrinterTestTips() {
  return (
    <div role="status" className="space-y-1 rounded-md bg-brand-wash p-3 text-sm text-brand-ink">
      <p className="font-medium">{TIPS_TITLE}</p>
      <ul className="list-disc space-y-1 pl-5">
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}
