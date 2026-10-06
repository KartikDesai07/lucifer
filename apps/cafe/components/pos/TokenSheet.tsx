"use client";

import { useEffect, useState } from "react";
import { Ticket } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PRINTER_ICON_BUTTON_CLASS } from "@/components/print/printer-classes";
import { TokenList } from "@/components/pos/TokenSheetRows";
import { useSettings } from "@/hooks/use-settings";
import { useTokenAction, useTokenBoard } from "@/hooks/use-tokens";
import { useTokenRealtime } from "@/hooks/use-realtime";
import { printConfigOf } from "@/lib/print";
import { tokenLabelOf, type TokenAction, type TokenBoardEntry } from "@/lib/token-view";
import { KITCHEN_FRESHNESS_TICK_MS } from "@pos/shared/query";
import { cn } from "@/lib/utils";

// Print customization S8 — the top-bar Tokens button and its sheet: every token being prepared or ready to hand
// over, with Mark ready / Collected / Not ready. It shows only while tokens are on. The sheet's body mounts only
// while open, so the board fetch, its poll and the realtime connection exist only then (never in the button).
const SHEET_TITLE = "Tokens";
const SHEET_DESCRIPTION = "Orders waiting for the customer. Mark a token ready when the order is done.";
const SKELETON_ROWS = 4;
const EMPTY_TEXT =
  "No tokens yet. Every new order gets one. When the kitchen marks an order ready, its token moves to Ready.";
const OFF_TEXT = "Tokens are off. Turn them on in Settings → Tokens & numbering.";

// The sheet is NON-modal on purpose: a modal sheet sets `pointer-events: none` on <body>, and the toaster (portalled
// under <body>) then swallows every click, so the toast's Undo was dead while the sheet was open (s82 smoke L3/L4) —
// and after a mis-tapped "Collected" that Undo is the only way back. A press on a toast must not close the sheet.
const TOAST_REGION_SELECTOR = "[data-sonner-toaster]";

function keepOpenForToasts(event: { target: EventTarget | null; preventDefault: () => void }): void {
  if (event.target instanceof Element && event.target.closest(TOAST_REGION_SELECTOR)) event.preventDefault();
}

export function TokenSheet() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  if (!printConfigOf(settings.data).token.enabled) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(PRINTER_ICON_BUTTON_CLASS, "xl:w-auto xl:gap-2 xl:px-3")}
          aria-label="Tokens"
          title="Tokens"
        >
          <Ticket aria-hidden="true" />
          <span className="hidden text-sm xl:inline">Tokens</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" onInteractOutside={keepOpenForToasts}>
        <SheetHeader>
          <SheetTitle>{SHEET_TITLE}</SheetTitle>
          <SheetDescription>{SHEET_DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <TokenSheetBody />
      </SheetContent>
    </Sheet>
  );
}

interface DoneToast {
  text: string;
  undo: TokenAction;
}

function TokenSheetBody() {
  const board = useTokenBoard({ enabled: true });
  const act = useTokenAction();
  useTokenRealtime();
  // Token ids with a mark in flight: per row, never global, so tapping one row never disables another
  // (the Kitchen page's idiom).
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  // The "3 min ago" clock is its own interval, decoupled from the data poll.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), KITCHEN_FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // mutateAsync, not mutate(..., { onSettled }): a per-call callback is dropped when another row is tapped before
  // this one settles, which would leave this row's buttons disabled for good. The hook already toasts a failure.
  const run = async (entry: TokenBoardEntry, action: TokenAction, done?: DoneToast) => {
    if (inFlight.has(entry.id)) return;
    setInFlight((current) => new Set(current).add(entry.id));
    try {
      await act.mutateAsync({ id: entry.id, action, seenFiredAt: action === "ready" ? entry.firedAt : undefined });
      if (done) {
        toast(done.text, {
          action: {
            label: "Undo",
            onClick: () => void act.mutateAsync({ id: entry.id, action: done.undo }).catch(() => undefined),
          },
        });
      }
    } catch {
      // useTokenAction's onError has already shown the reason.
    } finally {
      setInFlight((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const data = board.data;
  if (data === undefined) {
    if (board.isError) {
      return (
        <div className="p-4">
          <ErrorState
            title="Could not load the tokens"
            description="Check the internet connection, then try again."
            onRetry={() => void board.refetch()}
            retryLabel="Try again"
          />
        </div>
      );
    }
    return (
      <div className="space-y-2 p-4" aria-hidden>
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (!data.enabled) {
    return <p className="p-4 text-sm text-muted-foreground">{OFF_TEXT}</p>;
  }
  if (data.ready.length === 0 && data.preparing.length === 0) {
    return (
      <div className="p-4">
        <EmptyState icon={<Ticket className="h-8 w-8" aria-hidden="true" />} title={EMPTY_TEXT} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <TokenList
        title="Ready"
        kind="ready"
        entries={data.ready}
        nowMs={nowMs}
        inFlight={inFlight}
        onReady={() => undefined}
        onCollected={(e) => void run(e, "collected", { text: `${tokenLabelOf(e.number)} collected`, undo: "uncollected" })}
        onUnready={(e) => void run(e, "unready")}
      />
      <TokenList
        title="Preparing"
        kind="preparing"
        entries={data.preparing}
        nowMs={nowMs}
        inFlight={inFlight}
        onReady={(e) => void run(e, "ready", { text: `${tokenLabelOf(e.number)} is ready`, undo: "unready" })}
        onCollected={() => undefined}
        onUnready={() => undefined}
      />
    </div>
  );
}
