"use client";

import { useState } from "react";
import { orderItemLabel } from "@pos/shared/utils";
import { ORDER_REASON_MIN_LEN, ORDER_REASON_MAX_LEN } from "@/lib/constants";
import { inr } from "@/lib/utils";
import {
  useAcceptOrderRequest,
  useRejectOrderRequest,
  type TrayOrderRequest,
} from "@/hooks/use-order-requests";

// CR2.2 fix round (stranded acceptingId) — the accept mutation is owned ONE
// level up, by the containing screen (app/(dashboard)/requests/page.tsx —
// the POS-screen tray this replaced owned it the same way, see its own
// comment): this card only needs the mutate function, typed off the hook
// itself so both files can never drift on the mutation's variables/result
// shape.
type AcceptMutate = ReturnType<typeof useAcceptOrderRequest>["mutate"];
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Order } from "@/types";

interface OrderRequestCardProps {
  request: TrayOrderRequest;
  onAccepted: (order: Order) => void;
  // FIX9 — the tray-level accept lock: the id currently mid-accept
  // tray-wide, or null. Every card reads it to disable its OWN Accept
  // button while ANY card (not just this one) is accepting.
  acceptingId: string | null;
  onAcceptingChange: (id: string | null) => void;
  printBusy: boolean;
  // CR2.2 fix round — the ONE shared accept mutation instance's mutate
  // function, owned by the tray (see AcceptMutate's own comment above).
  acceptMutate: AcceptMutate;
}

const ACCEPTING_BADGE = "resuming needed";
const PROMO_LABEL = "Promo";
const ACCEPTING_COPY =
  "An accept was interrupted — Accept again to finish it safely, or Reject if it shouldn't be billed.";
const PRINT_BUSY_TITLE = "Waiting for the printer";

// One diner self-order request in the staff tray (CR2.2 SLICE 9). Accept
// mints/updates the Order and hands it to the caller so the POS page's
// existing KOT print bridge fires; reject asks for a bounded reason first.
export function OrderRequestCard({
  request,
  onAccepted,
  acceptingId,
  onAcceptingChange,
  printBusy,
  acceptMutate,
}: OrderRequestCardProps) {
  const rejectRequest = useRejectOrderRequest();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  // FIX9 — Accept disables tray-wide (any card mid-accept, or a live print
  // job) on top of the double-tap guard, never just this card's own state.
  const acceptDisabled = acceptingId !== null || rejectRequest.isPending || printBusy;
  // CR2.2 fix round (billed-but-rejected race, same-device guard) — Reject
  // disables tray-wide too, while ANY card is mid-accept: the server side
  // (reject route's post-CAS re-check) is what actually resolves a real
  // cross-device race; this is just the local double-tap guard extended to
  // match Accept's own tray-wide scope.
  const rejectDisabled = acceptingId !== null || rejectRequest.isPending;

  const trimmedReason = reason.trim();
  const reasonTooShort = trimmedReason.length > 0 && trimmedReason.length < ORDER_REASON_MIN_LEN;
  const canReject = trimmedReason.length >= ORDER_REASON_MIN_LEN && !rejectDisabled;

  const createdAt = new Date(request.createdAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleAccept = () => {
    onAcceptingChange(request.id);
    // The hook toasts success/error itself. FIX10 — a replayed accept did no
    // new server-side work, so onAccepted (the caller's queueKotRound) must
    // NOT fire — the KOT for this request already printed once. CR2.2 fix
    // round — no onSettled here: acceptingId reset is now the shared hook's
    // OWN onSettled (hooks/use-order-requests.ts), which fires even if THIS
    // card unmounts before the mutation settles — a per-call onSettled here
    // is exactly the stranding bug that fix closes.
    acceptMutate(request.id, {
      onSuccess: (result) => {
        if (!result.replayed) onAccepted(result.order);
      },
    });
  };

  const openReject = () => {
    setReason("");
    setRejectOpen(true);
  };

  const confirmReject = () => {
    rejectRequest.mutate(
      { id: request.id, reason: trimmedReason },
      { onSuccess: () => setRejectOpen(false) },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {request.targetKind === "table" ? (request.tableNo ?? "Table") : "Parcel"}
            </span>
            <Badge variant="outline">{createdAt}</Badge>
            {/* FIX8 — a stranded "accepting" row (an accept that started and
                never finished) needs to read differently from a fresh
                pending one, or staff have no reason to retry it. */}
            {request.status === "accepting" && <Badge variant="destructive">{ACCEPTING_BADGE}</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {/* mobile already role-masked server-side — never re-mask here */}
            {request.name} · {request.mobile}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="font-semibold">{inr(request.quotedTotal)}</span>
          {/* CR2.2c — a promo the diner applied is money staff must SEE
              before accepting; the accept bridge re-resolves the code against
              live Settings, so this is what was quoted, not a guess. */}
          {request.promoCode && (
            <p className="text-xs text-muted-foreground">
              {PROMO_LABEL} {request.promoCode} −{inr(request.quotedDiscount ?? 0)}
            </p>
          )}
        </div>
      </div>

      {request.status === "accepting" && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{ACCEPTING_COPY}</p>
      )}

      <div className="space-y-1.5">
        {request.items.map((item, i) => (
          <div key={`${item.productId}-${i}`} className="flex justify-between gap-2">
            <div className="min-w-0">
              <span>
                {item.qty} × {orderItemLabel(item)}
              </span>
              {item.modifiers.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  + {item.modifiers.join(", ")}
                </div>
              )}
              {item.instructions && (
                <div className="text-xs italic text-muted-foreground">
                  {item.instructions}
                </div>
              )}
            </div>
            <span className="shrink-0 text-muted-foreground">
              {inr(item.price * item.qty)}
            </span>
          </div>
        ))}
      </div>

      {request.note && (
        <p className="rounded-md bg-muted/60 p-2 text-xs italic">{request.note}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={rejectDisabled} onClick={openReject}>
          Reject
        </Button>
        <Button
          disabled={acceptDisabled}
          onClick={handleAccept}
          title={printBusy ? PRINT_BUSY_TITLE : undefined}
        >
          {request.status === "accepting" ? "Retry accept" : "Accept"}
        </Button>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject this order request?</DialogTitle>
            <DialogDescription>
              The diner sees this reason on their status page.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`reject-reason-${request.id}`}>Reason (required)</Label>
            <Textarea
              id={`reject-reason-${request.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. kitchen closed, item unavailable"
              maxLength={ORDER_REASON_MAX_LEN}
              rows={2}
            />
            {reasonTooShort && (
              <p className="text-xs text-destructive">
                At least {ORDER_REASON_MIN_LEN} characters.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!canReject}
              onClick={confirmReject}
              className="w-full sm:w-auto"
            >
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
