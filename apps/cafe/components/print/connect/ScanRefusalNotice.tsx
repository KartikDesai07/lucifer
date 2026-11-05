import { marked } from "@/components/print/PrinterStatusCard";
import { PRINTER_BUTTON_PRIMARY_CLASS, PRINTER_CONNECT_STEPS_CLASS, PRINTER_NOTICE_CLASS, PRINTER_STATUS_STEP_CLASS, PRINTER_STATUS_STEP_NUM_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import type { ScanRefusal } from "@/lib/printer/native-picker-state";

// PX-3 Task 13 (spec §6.9 B11): a Bluetooth scan the app refused. On Android 7-11 scanning needs Location, which the page can
// ask for (Allow); once Android has refused that ask it will not show it again, so the way on is Settings (the steps).
// Props only; the list owns which of the two shows and what Allow does.

export const SCAN_REFUSAL_WORDS = {
  notice: "Android needs Location to find Bluetooth printers.",
  allow: "Allow",
  steps: ["Open Android Settings → Apps → Sandbee POS → Permissions.", "Allow Location (or Nearby devices).", "Come back and tap **Search again**."],
} as const;

export function ScanRefusalNotice({ refusal, locked, onAllow }: { refusal: ScanRefusal; locked: boolean; onAllow(): void }) {
  return (
    <div role="status" className={PRINTER_NOTICE_CLASS}>
      <p>{SCAN_REFUSAL_WORDS.notice}</p>
      {refusal === "allow" ? (
        <Button className={PRINTER_BUTTON_PRIMARY_CLASS} disabled={locked} onClick={onAllow}>
          {SCAN_REFUSAL_WORDS.allow}
        </Button>
      ) : (
        <ol className={PRINTER_CONNECT_STEPS_CLASS}>
          {SCAN_REFUSAL_WORDS.steps.map((step, i) => (
            <li key={step} className={PRINTER_STATUS_STEP_CLASS}>
              <span aria-hidden="true" className={PRINTER_STATUS_STEP_NUM_CLASS}>
                {i + 1}
              </span>
              <span>{marked(step)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
