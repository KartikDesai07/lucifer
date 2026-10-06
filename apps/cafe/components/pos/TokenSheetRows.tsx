"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tokenLabelOf, type TokenBoardEntry } from "@/lib/token-view";

// Print customization S8 — the rows of the POS token sheet. Split from TokenSheet.tsx to keep it inside its
// line budget. A row never truncates its number and wraps its buttons, so it holds at 360 px.
const MINUTE_MS = 60_000;
const ACTION_CLASS = "min-h-11";

/** "just now" / "3 min ago" for an ISO instant; an unparseable stamp reads as "just now", never NaN. */
export function minutesAgoText(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - new Date(iso).getTime()) / MINUTE_MS);
  return Number.isFinite(minutes) && minutes >= 1 ? `${minutes} min ago` : "just now";
}

export type TokenRowKind = "preparing" | "ready";

interface TokenListProps {
  title: string;
  kind: TokenRowKind;
  entries: TokenBoardEntry[];
  nowMs: number;
  inFlight: ReadonlySet<string>;
  /** Preparing rows: Mark ready. */
  onReady: (entry: TokenBoardEntry) => void;
  /** Ready rows: Collected. */
  onCollected: (entry: TokenBoardEntry) => void;
  /** Ready rows: Not ready. */
  onUnready: (entry: TokenBoardEntry) => void;
}

export function TokenList({ title, kind, entries, nowMs, inFlight, onReady, onCollected, onUnready }: TokenListProps) {
  const headingId = `token-list-${kind}`;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {title} ({entries.length})
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kind === "ready" ? "Nothing is waiting to be collected." : "Nothing is being prepared."}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const busy = inFlight.has(entry.id);
            const since = kind === "ready" ? (entry.readySince ?? entry.firedAt) : entry.firedAt;
            return (
              <li
                key={entry.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border p-3",
                  kind === "ready" && "border-green-600/40 bg-green-50",
                )}
              >
                <div className="min-w-0">
                  <div className="text-3xl font-black leading-none" aria-label={tokenLabelOf(entry.number)}>
                    {entry.number}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {kind === "ready" ? "Ready" : "Ordered"} {minutesAgoText(since, nowMs)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {kind === "preparing" ? (
                    <Button type="button" className={ACTION_CLASS} disabled={busy} onClick={() => onReady(entry)}>
                      Mark ready
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className={ACTION_CLASS}
                        disabled={busy}
                        onClick={() => onUnready(entry)}
                      >
                        Not ready
                      </Button>
                      <Button type="button" className={ACTION_CLASS} disabled={busy} onClick={() => onCollected(entry)}>
                        Collected
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
