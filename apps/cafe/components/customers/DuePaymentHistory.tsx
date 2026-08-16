"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useCustomerPayments, type DuePaymentRow } from "@/hooks/use-customers";
import { PAY_STYLES, DUE_PAYMENT_HISTORY_LIMIT } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { DuePaymentEditDialog } from "@/components/customers/DuePaymentEditDialog";
import { DuePaymentDeleteDialog } from "@/components/customers/DuePaymentDeleteDialog";

const SKELETON_ROWS = 4;

interface DuePaymentHistoryProps {
  customerId: string;
}

// The Payments tab of CustomerHistoryDialog. Deleted rows stay in the list
// (owner's decision — the trail matters more than a tidy view) but never
// count toward the total, and never carry actions.
export function DuePaymentHistory({ customerId }: DuePaymentHistoryProps) {
  const { isAdmin } = useAuth();
  const payments = useCustomerPayments(customerId);
  const [editing, setEditing] = useState<DuePaymentRow | null>(null);
  const [deleting, setDeleting] = useState<DuePaymentRow | null>(null);

  const rows = payments.data ?? [];
  // Keyed on payments.data (not the `rows` fallback array, which is a fresh
  // [] reference on every render while loading/empty) so this doesn't recompute
  // needlessly.
  const { activeTotal, activeCount } = useMemo(() => {
    const active = rows.filter((p) => !p.deletedAt);
    return {
      activeTotal: active.reduce((sum, p) => sum + p.amount, 0),
      activeCount: active.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments.data]);

  const hasRows = rows.length > 0;

  // Having cached rows to show beats every status below — a background
  // refetch failing (which happens right after every edit/delete, since
  // those invalidate this list) must not throw away rows still in hand.
  if (!hasRows && payments.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  // Offline, TanStack parks the query as `paused` — isLoading AND isError
  // both false with no data, i.e. indistinguishable from "no payments" unless
  // isPaused is read explicitly. Telling an admin a customer who has paid
  // has never paid anything is the exact defect this guards against.
  if (!hasRows && payments.isPaused) {
    return (
      <p className="text-sm text-muted-foreground">
        You appear to be offline. Payment history will load when the
        connection is back.
      </p>
    );
  }

  // isLoadingError, not bare isError: a failed REFRESH while rows are still
  // cached must fall through to the render below instead of landing here.
  if (!hasRows && payments.isLoadingError) {
    return (
      <ErrorState
        title="Couldn't load payment history"
        description={
          (payments.error as Error)?.message ||
          "Something went wrong while loading. Please try again."
        }
        onRetry={() => payments.refetch()}
      />
    );
  }

  if (!hasRows) {
    return (
      <EmptyState
        title="No payments recorded yet"
        description="Dues collected from this customer will show up here."
      />
    );
  }

  // The server caps the returned history at DUE_PAYMENT_HISTORY_LIMIT rows —
  // without this, a long-standing customer's list looks complete when it is
  // actually truncated.
  const atCap = rows.length >= DUE_PAYMENT_HISTORY_LIMIT;

  return (
    <>
      <div className="mb-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {activeCount} payment{activeCount === 1 ? "" : "s"} collected
        </span>
        <span className="font-semibold">{inr(activeTotal)}</span>
      </div>

      {atCap && (
        <p className="mb-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Showing the most recent {DUE_PAYMENT_HISTORY_LIMIT} payments. Older
          payments aren&apos;t shown.
        </p>
      )}

      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {rows.map((row) => {
          const deleted = !!row.deletedAt;
          const style = PAY_STYLES[row.mode];
          return (
            <div
              key={row._id}
              className={cn("rounded-md border p-2.5 text-sm", deleted && "text-muted-foreground")}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(row.createdAt)} ·{" "}
                    {new Date(row.createdAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Received by {row.receivedBy}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {deleted && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Deleted
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", !deleted && style?.color)}
                  >
                    {style?.label ?? row.mode}
                  </Badge>
                  <span
                    className={cn("font-semibold", deleted && "line-through")}
                  >
                    {inr(row.amount)}
                  </span>
                  {isAdmin && !deleted && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditing(row)}
                        aria-label="Edit payment"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleting(row)}
                        aria-label="Delete payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {row.note && (
                <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
              )}

              {row.edits && row.edits.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {row.edits.map((edit, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">
                      Edited by {edit.by} · {formatDate(edit.at)} · was{" "}
                      {inr(edit.amount)} ({PAY_STYLES[edit.mode]?.label ?? edit.mode})
                      {edit.note ? ` · note was "${edit.note}"` : ""}
                    </p>
                  ))}
                </div>
              )}

              {deleted && (
                <p className="mt-1 text-[11px] text-destructive">
                  Deleted by {row.deletedBy}
                  {row.deletedAt ? ` · ${formatDate(row.deletedAt)}` : ""}
                  {row.deleteNote ? ` · ${row.deleteNote}` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <DuePaymentEditDialog
        customerId={customerId}
        payment={editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <DuePaymentDeleteDialog
        customerId={customerId}
        payment={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      />
    </>
  );
}
