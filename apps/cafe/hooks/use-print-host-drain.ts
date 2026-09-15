"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import { PRINT_HOST_MAX_AGE_MS, printJobDrainCandidate, type PrintJobFeedRow } from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { useClaimPrintJob } from "@/hooks/use-print-host";

// Print-host plan §B5 (PH-5) — the print-job drain, a copy of
// use-self-order-auto-print's proven shape: a `claimingRef` re-entry guard, an
// `attemptedRef` pruned against the live feed, ONE claim per effect run, and
// the provider's cross-lane claim lock (MERGED-05) so this lane and the
// self-order lane can never both win a CAS in the same React pass. The feed is
// the narrow `usePrintJobFeed` subscription (§B4 D1 — already age-fenced
// server-side; `printJobDrainCandidate` re-applies the fence against the
// client clock so a row that aged out between tick and claim is skipped).
// Because `busy` flips false at onAfterPrint, the effect re-runs and claims
// the next job WITHOUT waiting for the next 20s tick.

/** The claimed row the server returns (client mirror lives in use-print-host). */
export interface ClaimedPrintJobLike {
  id: string;
  payload: PrintJobPayload;
}

interface UsePrintHostDrainOptions {
  /** Host pref + drain lock held (§B5) — both, or nothing is claimed. */
  enabled: boolean;
  feed: PrintJobFeedRow[];
  /** The bridge's whole claim→onAfterPrint window (MERGED-13). */
  busy: boolean;
  deviceId: string;
  tabId: string;
  claimLockRef: MutableRefObject<boolean>;
  onClaimed: (job: ClaimedPrintJobLike) => void;
  /** A `not-host` refusal: the singleton names another device (§B3). */
  onDemoted: () => void;
}

export function usePrintHostDrain({
  enabled,
  feed,
  busy,
  deviceId,
  tabId,
  claimLockRef,
  onClaimed,
  onDemoted,
}: UsePrintHostDrainOptions): void {
  const claimingRef = useRef(false);
  // Ids this window already claimed (or tried to): the feed stays stale for up
  // to one tick after a won claim, and `busy` flipping back re-runs the effect
  // — without this the same row would be claimed twice (a `raced` answer, a
  // wasted POST). Pruned against the live feed so it stays a handful of ids.
  const attemptedRef = useRef<Set<string>>(new Set());

  const claim = useClaimPrintJob();
  // Only the stable `.mutate` — useMutation returns a fresh object per render
  // (memory `usemutation-object-identity-loops-registries`).
  const { mutate: claimMutate } = claim;

  useEffect(() => {
    if (!enabled || busy || deviceId === "") return;
    if (claimingRef.current || claimLockRef.current) return;

    const liveIds = new Set(feed.map((row) => row.id));
    for (const id of attemptedRef.current) {
      if (!liveIds.has(id)) attemptedRef.current.delete(id);
    }

    const candidate = printJobDrainCandidate(
      feed.filter((row) => !attemptedRef.current.has(row.id)),
      Date.now(),
      PRINT_HOST_MAX_AGE_MS,
    );
    if (!candidate) return;

    // Acquire BOTH guards synchronously before the mutate (§B5 ordering), and
    // mark the attempt before the request leaves so a re-run cannot double it.
    claimingRef.current = true;
    claimLockRef.current = true;
    attemptedRef.current.add(candidate.id);
    claimMutate(
      { id: candidate.id, deviceId, tabId },
      {
        onSuccess: (result) => {
          if (result.claimed) {
            onClaimed(result.job);
            return;
          }
          // `raced` (another window/tab), `not-eligible`/`invalid-payload`/
          // `not-found` (the row is gone) are routine and silent — the row
          // leaves the feed and the attempt is pruned with it. `not-host` means
          // the singleton names another device: stop this lane, like the beat.
          if (result.reason === "not-host") onDemoted();
        },
        onError: () => {
          // A network failure means the server may never have seen the claim
          // — forget the attempt so the next run retries instead of stranding
          // the ticket behind an id this window will never touch again.
          attemptedRef.current.delete(candidate.id);
        },
        onSettled: () => {
          // Released AFTER onSuccess raised `busy` on the bridge, so the
          // self-order lane re-gates on busy, not on a still-held lock.
          claimingRef.current = false;
          claimLockRef.current = false;
        },
      },
    );
  }, [enabled, busy, feed, deviceId, tabId, claimLockRef, claimMutate, onClaimed, onDemoted]);
}
