"use client";

// Print-host plan §B7 (PH-7) — the card's prop-driven pieces, split out of
// PrintHostCard.tsx for its 180-line budget (the PrinterSetupSteps idiom). No
// state, no hooks, no print machinery: every value is derived by the card and
// passed down. Generic product voice — the host's label comes from the pulse.
// PH-10b (D5): the card now lives on /settings/printing itself, so the
// no-host line no longer links there — it points at the wizard below in
// device-agnostic words (a phone renders only the wizard's device check).
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PrintHostState } from "@pos/shared/print-job";

export interface InlineConfirmProps {
  question: string;
  yes: string;
  no: string;
  disabled: boolean;
  onYes: () => void;
  onNo: () => void;
}

// A small inline yes/no, not a modal: the question is about paper the staff
// member is looking at right now, and the card is already the context.
export function InlineConfirm({ question, yes, no, disabled, onYes, onNo }: InlineConfirmProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{question}</span>
      <Button size="sm" onClick={onYes} disabled={disabled}>{yes}</Button>
      <Button size="sm" variant="outline" onClick={onNo} disabled={disabled}>{no}</Button>
    </div>
  );
}

export interface PrintHostStatusProps {
  /** `null` = unresolved pulse OR a degraded tick (MERGED-19) — never "no host". */
  host: PrintHostState | null;
  /** The configured host's label; null when no host is configured. */
  hostLabel: string | null;
  isHostDevice: boolean;
}

// Where prints go, and whether THIS device is the host — so staff on any
// screen know why a slip did (or did not) come out of the printer beside them.
export function PrintHostStatus({ host, hostLabel, isHostDevice }: PrintHostStatusProps) {
  return (
    <>
      {host === null ? (
        <p className="text-muted-foreground">Print host status is still loading.</p>
      ) : hostLabel !== null ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span>Host: {hostLabel}</span>
            <Badge variant={host.offline ? "destructive" : "default"}>{host.offline ? "Offline" : "Online"}</Badge>
          </div>
          <p className={host.silentMode ? "text-green-600" : "text-amber-600"}>
            {host.silentMode ? "Silent printing confirmed ✓" : "Silent printing not confirmed yet — run a test print on the host PC."}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          No print host is set — every device prints its own slips. Set one up on a PC or laptop with the steps below.
        </p>
      )}
      {isHostDevice ? (
        <p className="text-muted-foreground">This device is the print host — every slip prints here.</p>
      ) : hostLabel !== null ? (
        <p className="text-muted-foreground">Slips from this device print at {hostLabel}.</p>
      ) : null}
    </>
  );
}
