"use client";

import { useEffect, useId, useRef, useState } from "react";

import { NotPrintedCard } from "@/components/print/NotPrintedCard";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useNotPrintedActions } from "@/hooks/use-not-printed-actions";
import { clearAllAskedOf, notPrintedViewOf, type NotPrintedAction } from "@/lib/print-waiting-view";
import type { PosPulseData } from "@pos/shared/self-order-alert";

// Printer UX, PX-2 Task 4 (spec §6.3): the Not printed card's container, in the printer sheet and on /printers. It holds
// every state the card draws. Prop-driven: PrinterPanel already reads the pulse, so this is not another wide-pulse
// reader. A tapped row is disabled until its own action answers (success or error; 1D final review I-2, and the 1D
// gate: one promise per tap, so a second row tapped meanwhile never leaves the first one dead). The server's CAS makes
// a repeat tap a no-op.

export function NotPrintedSection({ pulse }: { pulse: PosPulseData | undefined }) {
  // Session 2C: names each slip's printer (printers mode); the same cached read the agent makes.
  // The agent's entry, read without a subscription of its own (the 2D review gate, M-3: one read per admin save).
  const { printers } = usePrintersRead(true);
  const rows = pulse?.printAttention;
  const { retry, confirm, dismiss, dismissAll } = useNotPrintedActions();
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  // The ids the confirm asks about, taken when it opens: a KOT that arrives meanwhile is never cleared unasked.
  const [asked, setAsked] = useState<readonly string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [refocus, setRefocus] = useState(0);
  const clearAllRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  useEffect(() => {
    const listed = (rows ?? []).map((row) => row.id);
    setTapped((prev) => {
      const next = new Set([...prev].filter((id) => listed.includes(id)));
      return next.size === prev.size ? prev : next;
    });
    // The confirm closes once none of the slips it asked about is listed (cleared elsewhere, printed).
    setAsked((prev) => clearAllAskedOf(prev, listed));
  }, [rows]);
  // Ruling J: a closed confirm gives the focus back to the head's Clear all (after the render that brings it back).
  useEffect(() => {
    if (refocus > 0) clearAllRef.current?.focus();
  }, [refocus]);

  const view = notPrintedViewOf(rows ?? [], pulse?.printAttentionTruncated === true, Date.now(), printers);
  if (view === null) return null;
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
  const onAction = (id: string, action: NotPrintedAction) => {
    if (action === "clear") tap(id, () => dismiss(id));
    else if (action === "print-again") tap(id, () => confirm(id, "reprint"));
    else if (action === "it-printed") tap(id, () => confirm(id, "printed"));
    else tap(id, () => retry(id));
  };
  const asking = clearAllAskedOf(asked, view.ids);
  const close = () => {
    setAsked(null);
    setRefocus((n) => n + 1);
  };
  const onConfirm = (yes: boolean) => {
    if (!yes || asking === null) return close();
    setBusy(true);
    // The slips it asked about, shown or folded (none that came later); it closes once the answer is in.
    void dismissAll(asking).finally(() => {
      setBusy(false);
      close();
    });
  };

  return (
    <NotPrintedCard
      view={view}
      expanded={expanded}
      onExpanded={setExpanded}
      confirming={asking}
      onClearAll={() => setAsked([...view.ids])}
      onConfirm={onConfirm}
      busy={busy}
      tapped={tapped}
      onAction={onAction}
      clearAllRef={clearAllRef}
      questionId={questionId}
    />
  );
}
