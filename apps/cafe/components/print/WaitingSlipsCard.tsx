"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { usePrintJobActions } from "@/hooks/use-print-job-actions";
import { printWaitingGroups, printerNameOf, type PrintWaitingGroup } from "@/lib/print-waiting";
import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";

// Session 1D (spec §10; the owner's decision after Session 1B): the ONE waiting-slips panel, on every
// device, inside the printer sheet (and /printers). Every slip that is not printed and needs a person,
// in three plain groups, each row with its age, its reason and big buttons: Print now / Retry, Print
// again / It printed (a bill to check), and Clear. Prop-driven: PrinterPanel already reads the pulse,
// so this is not another wide-pulse reader. A tapped row is disabled until its own action answers
// (success or error; 1D final review I-2, and the 1D gate: one promise per tap, so a second row tapped
// meanwhile never leaves the first one dead). The server's CAS makes a repeat tap a no-op. Each button
// names its slip for a screen reader (1D gate M-5).

const SECTION_TITLE = "Slips waiting";

export function WaitingSlipsCard({ pulse }: { pulse: PosPulseData | undefined }) {
  // Session 2C: names each slip's printer (printers mode); the same cached read the agent makes.
  // The agent's entry, read without a subscription of its own (the 2D review gate, M-3: one read per admin save).
  const { printers } = usePrintersRead(true);
  const rows = pulse?.printAttention;
  const { retry, confirm, dismiss } = usePrintJobActions();
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setTapped((prev) => {
      const live = new Set((rows ?? []).map((row) => row.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const groups = printWaitingGroups(rows ?? [], Date.now());
  if (groups.length === 0) return null;
  const release = (id: string) =>
    setTapped((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const tap = (id: string, run: () => Promise<void>) => {
    setTapped((prev) => new Set(prev).add(id));
    void run().finally(() => release(id));
  };

  const actions = (group: PrintWaitingGroup, row: PrintAttentionRow) => {
    const { id, label } = row;
    const off = tapped.has(id);
    const clear = (
      <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={off} aria-label={`Clear ${label}`} onClick={() => tap(id, () => dismiss(id))}>
        Clear
      </Button>
    );
    if (group === "bill") {
      return (
        <>
          <Button className={PRINTER_ACTION_CLASS} disabled={off} aria-label={`Print again ${label}`} onClick={() => tap(id, () => confirm(id, "reprint"))}>
            Print again
          </Button>
          <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={off} aria-label={`It printed ${label}`} onClick={() => tap(id, () => confirm(id, "printed"))}>
            It printed
          </Button>
          {clear}
        </>
      );
    }
    const verb = group === "failed" ? "Retry" : "Print now";
    return (
      <>
        <Button className={PRINTER_ACTION_CLASS} disabled={off} aria-label={`${verb} ${label}`} onClick={() => tap(id, () => retry(id))}>
          {verb}
        </Button>
        {clear}
      </>
    );
  };

  return (
    <section aria-label={SECTION_TITLE} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
      <h3 className="text-base font-semibold">
        {SECTION_TITLE}
        {pulse?.printAttentionTruncated ? " (the latest 20)" : ""}
      </h3>
      {groups.map((section) => (
        <div key={section.group} className="space-y-2">
          <p className="text-sm font-semibold">
            {section.title} ({section.rows.length})
          </p>
          <ul className="space-y-2">
            {section.rows.map(({ row, reason, age }) => (
              <li key={row.id} className="rounded-md bg-background p-3">
                <p className="text-base font-medium">{row.label}</p>
                <p className="text-sm text-muted-foreground">
                  {age} · {reason}
                  {printerNameOf(printers, row.printerId) !== null ? ` · ${printerNameOf(printers, row.printerId)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">{actions(section.group, row)}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
