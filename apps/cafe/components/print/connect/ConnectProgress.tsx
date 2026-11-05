"use client";

import { marked } from "@/components/print/PrinterStatusCard";
import { PRINTER_CONNECT_BIG_CLASS, PRINTER_CONNECT_BIG_DETAIL_CLASS, PRINTER_CONNECT_BIG_HEAD_CLASS, PRINTER_CONNECT_BIG_SPIN_CLASS } from "@/components/print/printer-classes";
import { CONNECT_WORDS, connectingWordsOf } from "@/lib/printer/connect-flow";

// Step 3 of the guided connect while the app connects (PX-3 Task 11, spec §6.7 item 3; mockup g3): a 48px spinner, the
// printer's name and how long it can take. Props only; role=status so a screen reader hears it start.
export function ConnectProgress({ name }: { name: string }) {
  return (
    <div role="status" className={PRINTER_CONNECT_BIG_CLASS}>
      <span aria-hidden="true" className={PRINTER_CONNECT_BIG_SPIN_CLASS} />
      <p className={PRINTER_CONNECT_BIG_HEAD_CLASS}>{connectingWordsOf(name)}</p>
      <p className={PRINTER_CONNECT_BIG_DETAIL_CLASS}>{marked(CONNECT_WORDS.wait)}</p>
    </div>
  );
}
