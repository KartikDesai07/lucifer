"use client";

import { useEffect, useState } from "react";

import type { PublicOrderRequestStatusData } from "@pos/shared/public";
import { readMyCodes } from "@/components/public/public-cart-store";
import type { PastOrder } from "@/components/public/public-orders-grouping";

// CB-6C — the diner's order-code fan-out, LIFTED out of PublicMyOrdersTab
// into the shell so Home's active-order card and the Orders tab read ONE
// resolved list. Before this the tab re-fired all 8 reads on every re-entry
// (it unmounts on tab switch); now the shell fires them once per mount and
// hands the result down — fewer reads against the per-code buckets, not more.
//
// Reads the DEVICE's own order-code history (localStorage, written at submit
// time), never a server-side per-account list — holding the code IS the
// authorization, the same model the status page uses, and it works for a
// diner who never made an account.
//
// F8 (CB-6D-B review fix, LOW) — every row is seeded `pending: true` and only
// cleared once its OWN fetch settles (any outcome — see the .finally() below),
// so the tab can tell "still resolving" apart from "resolved with no data"
// on the very first painted frame.

// How many past orders to resolve. Each is one request, so this bounds the
// fan-out on a cheap phone and a 512MB M0 alike. The per-shortCode read-rate
// bucket on GET /api/public/order-request/[shortCode] makes this fan-out safe
// to keep exactly as-is — every code has its own bucket (load-bearing, see
// lib/public-status-read-gate.test.ts).
export const MY_ORDERS_MAX_SHOWN = 8;

// `enabled` false (a cafe running neither diner feature) → `[]` and NO fetch:
// that cafe's menu must stay byte-for-byte as cheap as before the shell.
// `epoch` re-runs the fan-out (sign-out clears the stored codes, so the list
// must be re-read rather than kept). Returns null while the first resolve is
// in flight so callers can draw a skeleton, never an invented empty state.
export function useMyOrders(enabled: boolean, epoch: number): PastOrder[] | null {
  const [orders, setOrders] = useState<PastOrder[] | null>(enabled ? null : []);

  useEffect(() => {
    if (!enabled) {
      setOrders([]);
      return;
    }
    const codes = readMyCodes().slice(0, MY_ORDERS_MAX_SHOWN);
    if (codes.length === 0) {
      setOrders([]);
      return;
    }
    setOrders(codes.map((code) => ({ code, data: null, pending: true })));
    // Guards every in-flight resolve against a setState after unmount.
    let cancelled = false;
    for (const code of codes) {
      fetch(`/api/public/order-request/${encodeURIComponent(code)}`)
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const envelope = (await res.json().catch(() => null)) as
            | { success: true; data: PublicOrderRequestStatusData }
            | null;
          if (!envelope?.success || cancelled) return;
          setOrders((prev) =>
            prev ? prev.map((o) => (o.code === code ? { ...o, data: envelope.data } : o)) : prev,
          );
        })
        .catch(() => {
          // Leave the row with a null payload — it still renders its code and
          // its status page stays reachable (grouped into the trailing bucket).
        })
        // F8 (CB-6D-B review fix, LOW) — clears `pending` on EVERY outcome
        // (success, non-ok, bad envelope, network reject) so a failed row
        // still stops skeletoning and falls back to its unresolved Link.
        .finally(() => {
          if (!cancelled) {
            setOrders((prev) => (prev ? prev.map((o) => (o.code === code ? { code: o.code, data: o.data } : o)) : prev));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, epoch]);

  return orders;
}
