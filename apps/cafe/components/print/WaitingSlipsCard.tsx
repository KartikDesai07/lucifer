"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { usePrintJobActions } from "@/hooks/use-print-job-actions";
import { printWaitingGroups, type PrintWaitingGroup } from "@/lib/print-waiting";
import type { PosPulseData } from "@pos/shared/self-order-alert";

// Session 1D (spec §10; the owner's decision after Session 1B): the ONE waiting-slips panel, on every
// device, inside the printer sheet (and /printers). Every slip that is not printed and needs a person,
// in three plain groups, each row with its age, its reason and big buttons: Print now / Retry, Print
// again / It printed (a bill to check), and Clear. Prop-driven: PrinterPanel already reads the pulse,
// so this is not another wide-pulse reader. A tapped row stays disabled until it leaves the feed.

const SECTION_TITLE = "Slips waiting";

export function WaitingSlipsCard({ pulse }: { pulse: PosPulseData | undefined }) {
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
  const tap = (id: string, run: () => void) => {
    setTapped((prev) => new Set(prev).add(id));
    run();
  };

  const actions = (group: PrintWaitingGroup, id: string) => {
    const off = tapped.has(id);
    const clear = (
      <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => dismiss.mutate(id))}>
        Clear
      </Button>
    );
    if (group === "bill") {
      return (
        <>
          <Button className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => confirm.mutate({ id, decision: "reprint" }))}>
            Print again
          </Button>
          <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => confirm.mutate({ id, decision: "printed" }))}>
            It printed
          </Button>
          {clear}
        </>
      );
    }
    return (
      <>
        <Button className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => retry.mutate(id))}>
          {group === "failed" ? "Retry" : "Print now"}
        </Button>
        {clear}
      </>
    );
  };

  return (
    <section aria-label={SECTION_TITLE} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
      <h3 className="text-base font-semibold">
        {SECTION_TITLE}
        {pulse?.printAttentionTruncated ? " (the oldest 20)" : ""}
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
                </p>
                <div className="mt-2 flex flex-wrap gap-2">{actions(section.group, row.id)}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
