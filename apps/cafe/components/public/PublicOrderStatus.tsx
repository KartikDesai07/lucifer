"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  isPublicCode,
  PUBLIC_MENU_PATH,
  PUBLIC_STATUS_REFRESH_COOLDOWN_MS,
  type PublicOrderRequestStatusData,
} from "@pos/shared/public";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { readLastMenuPath, readRefreshAt, writeRefreshAt } from "@/components/public/public-cart-store";
import { PublicMyOrdersChips } from "@/components/public/PublicStatusTimeline";
import { PublicStatusItems } from "@/components/public/PublicStatusItems";
import {
  MAX_DISPLAYED_COOLDOWN_MS,
  PublicStatusActions,
  PublicStatusHead,
  TOO_SOON_MESSAGE,
} from "@/components/public/PublicStatusActions";

// The 1s ticker driving the visible countdown while cooling — display only;
// the SERVER is the fence (statusReadGate), this just repaints the label.
const COOLDOWN_TICK_MS = 1_000;

// A settled order can never change again — once here, the manual refresh
// control is not even offered (nothing left to check).
const TERMINAL_STATUSES = new Set<PublicOrderRequestStatusData["status"]>(["accepted", "rejected"]);

const ORDER_NOT_FOUND_MESSAGE = "We couldn't find that order.";
const RECONNECTING_MESSAGE = "Can't reach the counter right now — showing your last known status.";
const CANCEL_CONFLICT_MESSAGE = "This order is already being prepared — ask at the counter.";
const CANCEL_FAILED_MESSAGE = "Couldn't cancel — please try again.";

interface PublicOrderStatusProps {
  code: string;
}

// GET /api/public/order-request/[code], fetched with PLAIN fetch, never
// apiGet: apiGet collapses a 404 envelope and a network throw into the SAME
// Error, but this screen must tell a diner "we can't find that order"
// (terminal) apart from "can't reach the counter" (transient — keep the
// last known status on screen).
export function PublicOrderStatus({ code }: PublicOrderStatusProps) {
  const [data, setData] = useState<PublicOrderRequestStatusData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Set only by a 429 — cleared on the next successful read.
  const [tooSoon, setTooSoon] = useState(false);
  // Epoch ms the cooldown ends, or 0 while not cooling. Seeded from
  // readRefreshAt() below so a tab reload shows the SAME remaining countdown.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  // Ticks once a second, only while cooling, to repaint the seconds label.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // When the last successful save landed — any fetch ISSUED before this is a
  // stale read of items/total and must not be applied (see fetchStatus below).
  const adoptedAt = useRef(0);
  // Confirm-then-cancel state for the diner's own "Cancel this order" button.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Bumped on a successful cancel — OR a 409 from PublicStatusItems' own
  // Save — to force an immediate re-fetch rather than waiting for the diner
  // to tap Refresh.
  const [refetchToken, setRefetchToken] = useState(0);

  // Seed the cooldown from the persisted timestamp — survives a tab reload.
  useEffect(() => {
    const at = readRefreshAt(code);
    if (at !== null) {
      // Clamped — see MAX_DISPLAYED_COOLDOWN_MS for why a stored timestamp is
      // never trusted as-is.
      const capped = Math.min(at + PUBLIC_STATUS_REFRESH_COOLDOWN_MS, Date.now() + MAX_DISPLAYED_COOLDOWN_MS);
      if (capped > Date.now()) setCooldownUntil(capped);
    }
  }, [code]);

  // The 1s ticker — alive ONLY while actually cooling.
  //
  // The guard below runs at effect SETUP only. When the deadline passes
  // mid-interval nothing changes `cooldownUntil`, so the effect never re-runs
  // and its cleanup never fires — which is why the CALLBACK has to stop
  // itself. Without that self-stop this interval kept ticking for the life of
  // the page, re-rendering the whole status subtree (timeline, every item row,
  // the actions block) once a second while a diner sat waiting for food: the
  // "laggy taps on a cheap Android" class this project has already had a build
  // rejected for (review 2026-09-13). Resetting to 0 also flips the dependency,
  // so the effect re-runs and clears the interval for good.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => {
      if (Date.now() >= cooldownUntil) {
        clearInterval(id);
        setCooldownUntil(0);
        return;
      }
      setNowTick(Date.now());
    }, COOLDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  // Shared by the one mount fetch and the diner's manual Refresh tap.
  // `persistCooldown` is true only for the manual tap — the mount fetch is
  // not diner-initiated, so it must never arm the cooldown itself.
  async function fetchStatus(persistCooldown: boolean): Promise<void> {
    // Stamped BEFORE the request leaves — a fetch issued before a save
    // committed may still land AFTER its 200 (review 2026-08-20).
    const issuedAt = Date.now();
    try {
      const res = await fetch(`/api/public/order-request/${encodeURIComponent(code)}`);
      if (res.status === 404) {
        setNotFound(true);
        setOffline(false);
        return;
      }
      if (res.status === 429) {
        // Server is the fence — Retry-After wins over the client's own
        // timer; a missing/unparseable header falls back to the shared const.
        // CLAMPED: Retry-After is seconds until the fixed WINDOW rolls, so it
        // can be ~600 — a raw adopt would show "Refresh in 573s" and read as a
        // frozen button. Cap the DISPLAYED wait; the server still refuses
        // early taps, which is what actually matters (review 2026-09-13).
        const retryAfterSec = Number(res.headers.get("Retry-After"));
        const retryMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, MAX_DISPLAYED_COOLDOWN_MS)
            : PUBLIC_STATUS_REFRESH_COOLDOWN_MS;
        setCooldownUntil(Date.now() + retryMs);
        setTooSoon(true);
        return;
      }
      if (!res.ok) throw new Error("request failed");
      const envelope = (await res.json().catch(() => null)) as {
        success: true;
        data: PublicOrderRequestStatusData;
      } | null;
      if (!envelope?.success) throw new Error("bad envelope");
      setOffline(false);
      setNotFound(false);
      setTooSoon(false);
      // A read issued before the last successful save is a stale read of
      // items/total (see comment above) — drop the body, but a manual tap's
      // cooldown still arms either way (the diner's own tap still counts).
      const stale = issuedAt < adoptedAt.current;
      if (!stale) setData(envelope.data);
      if (persistCooldown) {
        const at = Date.now();
        writeRefreshAt(code, at);
        setCooldownUntil(at + PUBLIC_STATUS_REFRESH_COOLDOWN_MS);
      }
    } catch {
      // A fetch throw (or a non-404/429 non-OK response) is a connectivity
      // blip, not proof the order is gone — keep the last known status on
      // screen; never fall back to "not found" here.
      setOffline(true);
    }
  }

  useEffect(() => {
    if (!isPublicCode(code)) {
      setNotFound(true);
      return;
    }
    fetchStatus(false);
    // refetchToken is a deliberate re-run trigger, not a value read inside —
    // bumping it after a successful cancel (or a 409 from Save) fetches the
    // fresh status immediately. This is a ONE-SHOT fetch, not a loop: it
    // never re-arms itself, and carries no timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, refetchToken]);

  const cooling = cooldownUntil > nowTick;
  const remainingSeconds = cooling ? Math.ceil((cooldownUntil - nowTick) / 1000) : 0;

  // The diner's explicit "Refresh" tap. Blocked client-side while
  // cooling/in-flight purely for UX; the real fence is the server's
  // statusReadGate on the route itself.
  async function handleRefresh() {
    if (cooling || refreshing || (data && TERMINAL_STATUSES.has(data.status))) return;
    setRefreshing(true);
    try {
      await fetchStatus(true);
    } finally {
      setRefreshing(false);
    }
  }

  // Lets PublicStatusItems' own "Save changes" adopt the PATCH response's
  // total/itemCount immediately (the summary card below reads off `data`,
  // never a second source of truth) instead of waiting on the next poll tick.
  function handleAdopt(total: number, itemCount: number) {
    adoptedAt.current = Date.now();
    setData((prev) => (prev ? { ...prev, total, itemCount } : prev));
  }

  // A 409 mid-save means the request just left "pending" out from under the
  // diner — re-fetch right away so the Timeline/red-card catches up now.
  function handleForceRepoll() {
    setRefetchToken((t) => t + 1);
  }

  // First tap arms the confirm state; second tap actually cancels. A 409
  // means staff already have it — surfaced inline, never re-armed.
  async function handleCancel() {
    if (!confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/public/order-request/${encodeURIComponent(code)}/cancel`, {
        method: "POST",
      });
      if (res.status === 409) {
        setCancelError(CANCEL_CONFLICT_MESSAGE);
        setConfirmingCancel(false);
        setCancelling(false);
        return;
      }
      if (!res.ok) throw new Error("cancel failed");
      setConfirmingCancel(false);
      setCancelling(false);
      setRefetchToken((t) => t + 1); // re-fetch now rather than on the next poll tick
    } catch {
      setCancelError(CANCEL_FAILED_MESSAGE);
      setCancelling(false);
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <EmptyState title="Order not found" description={ORDER_NOT_FOUND_MESSAGE} />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <PublicStatusHead data={data} />

      <PublicStatusItems
        shortCode={code}
        items={data.items}
        note={data.note}
        promoCode={data.promoCode}
        quotedDiscount={data.quotedDiscount}
        status={data.status}
        onAdopt={handleAdopt}
        onForceRepoll={handleForceRepoll}
      />

      {offline && <p className="text-xs text-muted-foreground">{RECONNECTING_MESSAGE}</p>}
      {tooSoon && !offline && <p className="text-xs text-muted-foreground">{TOO_SOON_MESSAGE}</p>}

      {/* Summary card + the Refresh/Cancel controls. Presentational only —
          every piece of state below is owned HERE and handed down, so the
          cooldown, the 429 handling and the cancel CAS stay in one file. */}
      <PublicStatusActions
        data={data}
        canRefresh={!TERMINAL_STATUSES.has(data.status)}
        refreshing={refreshing}
        cooling={cooling}
        remainingSeconds={remainingSeconds}
        onRefresh={handleRefresh}
        cancellable={data.status === "pending"}
        confirmingCancel={confirmingCancel}
        cancelling={cancelling}
        cancelError={cancelError}
        onCancel={handleCancel}
        onDismissCancel={() => setConfirmingCancel(false)}
      />

      {/* "Your orders on this visit" (§17.B point 5) — owns its own state/
          fetch; hidden entirely when empty. */}
      <PublicMyOrdersChips currentCode={code} />

      {/* Order more — always offered, any status — back to wherever this
          order was placed from (readLastMenuPath), or the bare menu. */}
      <Button asChild variant="secondary" size="lg" className="w-full">
        <Link href={readLastMenuPath() ?? PUBLIC_MENU_PATH}>+ Order more items</Link>
      </Button>
    </main>
  );
}
