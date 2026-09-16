"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { DINER_CANCELLED_REASON, type PublicOrderRequestStatusData } from "@pos/shared/public";
import { readMyCodes } from "@/components/public/public-cart-store";

// Extracted from PublicOrderStatus.tsx (CR2.2b §17.B) — the 3-step "Sent →
// Confirming → Preparing" timeline. NEVER rendered for "rejected": that
// status keeps its own red card (staff reason / diner-cancel copy rules),
// entirely separate from this component (see PublicOrderStatus.tsx). Big
// type, icons + short text, no jargon — the owner's "very very easy" bar.
interface PublicStatusTimelineProps {
  status: Exclude<PublicOrderRequestStatusData["status"], "rejected">;
  acceptedAt?: string;
}

type StepState = "done" | "active" | "future";

// "accepting" (staff have opened the request but not yet confirmed) renders
// IDENTICALLY to "pending" here — the diner sees no difference (SLICE 8 §1,
// same rule the status GET route's own comment documents).
export function PublicStatusTimeline({ status, acceptedAt }: PublicStatusTimelineProps) {
  const accepted = status === "accepted";
  const steps: { label: string; state: StepState }[] = [
    { label: "Order sent ✓", state: "done" },
    { label: "Cafe is confirming…", state: accepted ? "done" : "active" },
    { label: accepted ? "Being prepared ✓" : "Being prepared", state: accepted ? "done" : "future" },
  ];

  return (
    <div className="rounded-lg border p-4">
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3">
            {step.state === "done" ? (
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5" />
              </span>
            ) : step.state === "active" ? (
              <span className="grid h-6 w-6 shrink-0 place-items-center">
                <span className="h-3 w-3 rounded-full bg-primary animate-pulse" />
              </span>
            ) : (
              <span className="grid h-6 w-6 shrink-0 place-items-center">
                <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/30" />
              </span>
            )}
            <span
              className={
                step.state === "future"
                  ? "text-base text-muted-foreground"
                  : "text-base font-medium"
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {/* Kept verbatim from the pre-timeline card — same text/format, just
          relocated to sit under the now-done third step. */}
      {accepted && acceptedAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Accepted at {new Date(acceptedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

// ── "Your orders on this visit" (§17.B point 5) ─────────────────────────────
// Co-located here (rather than a 4th file) to keep PublicOrderStatus.tsx
// under the repo's ~300-line budget — self-contained, no coupling to the
// timeline above: its own state, its own one-time lazy fetch per mount.
const MY_ORDERS_MAX = 4;

interface MyOrderChip {
  code: string;
  // null while loading OR on a fetch failure — the chip still renders, just
  // without a status word (spec: "Fetch failures render the chip without a
  // status word").
  word: string | null;
}

// Deliberately terser than the red-card/Timeline copy above — this is a
// small link list, not the headline status.
function chipWord(data: PublicOrderRequestStatusData): string {
  switch (data.status) {
    case "pending":
    case "accepting":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "rejected":
      return data.rejectedReason === DINER_CANCELLED_REASON ? "Cancelled" : "Rejected";
  }
}

interface PublicMyOrdersChipsProps {
  currentCode: string;
}

// readMyCodes() minus the current code, capped at 4, each lazily GET'd once
// on mount — deliberately separate from PublicOrderStatus's own poll loop
// (that loop owns only THIS order's status). Hidden entirely when empty.
export function PublicMyOrdersChips({ currentCode }: PublicMyOrdersChipsProps) {
  const [chips, setChips] = useState<MyOrderChip[]>([]);

  useEffect(() => {
    const others = readMyCodes()
      .filter((c) => c !== currentCode)
      .slice(0, MY_ORDERS_MAX);
    if (others.length === 0) return;
    setChips(others.map((c) => ({ code: c, word: null })));
    let cancelled = false;
    for (const otherCode of others) {
      fetch(`/api/public/order-request/${encodeURIComponent(otherCode)}`)
        .then(async (res) => {
          if (!res.ok) return;
          const envelope = (await res.json().catch(() => null)) as {
            success: true;
            data: PublicOrderRequestStatusData;
          } | null;
          if (!envelope?.success || cancelled) return;
          const word = chipWord(envelope.data);
          setChips((prev) => prev.map((o) => (o.code === otherCode ? { ...o, word } : o)));
        })
        .catch(() => {
          // Leave word null — the chip stays, just without a status word.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [currentCode]);

  if (chips.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Your orders on this visit</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Link
            key={chip.code}
            href={`/m/o/${chip.code}`}
            className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            #{chip.code}
            {chip.word ? ` — ${chip.word}` : ""}
          </Link>
        ))}
      </div>
    </div>
  );
}
