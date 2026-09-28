"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { usePendingWrites, type PendingSettle } from "@/components/layout/PendingWritesProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The header's view of background settles (PendingWritesProvider): a quiet
// "Settling Table 3…" while one is in flight, and a red, lasting entry for any
// that did not settle — so a failure never depends on someone having seen a
// toast. Renders nothing when there is nothing to say. Lives in the header,
// which is on every dashboard screen, because the operator may have moved on.

const isLive = (w: PendingSettle) => w.state === "sending" || w.state === "retrying";

function stuckText(w: PendingSettle): string {
  if (w.state === "unknown") return " — couldn't confirm the payment. Check the internet before taking payment again.";
  const reason = w.message ?? "The server refused it";
  return w.state === "gone"
    ? ` is not settled. ${reason}. If you took payment for it, give it back or ring it up again.`
    : ` is not settled. ${reason}. The tab is still open.`;
}

function liveText(live: PendingSettle[]): string {
  if (live.length > 1) return `Settling ${live.length} bills…`;
  const [w] = live;
  return w.state === "retrying" ? `Settling ${w.label}… slow connection, retrying` : `Settling ${w.label}…`;
}

export function PendingWritesChip() {
  const { writes, retry, reopen, dismiss } = usePendingWrites();
  const live = writes.filter(isLive);
  const stuck = writes.filter((w) => !isLive(w));
  if (writes.length === 0) return null;

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2">
      {live.length > 0 && (
        <span role="status" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="truncate">{liveText(live)}</span>
        </span>
      )}
      {stuck.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="destructive" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {stuck.length === 1 ? "1 bill not settled" : `${stuck.length} bills not settled`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {stuck.map((w, i) => (
              <div key={w.key}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="whitespace-normal text-sm font-normal">
                  <span className="font-semibold">{w.label}</span>
                  {stuckText(w)}
                </DropdownMenuLabel>
                {w.state !== "gone" && <DropdownMenuItem onSelect={() => reopen(w.key)}>Reopen tab</DropdownMenuItem>}
                {w.state === "unknown" && <DropdownMenuItem onSelect={() => retry(w.key)}>Retry</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => dismiss(w.key)}>
                  {w.state === "failed" ? "Dismiss (the tab stays open)" : "Dismiss"}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
