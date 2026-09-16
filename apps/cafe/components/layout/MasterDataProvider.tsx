"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MASTERS_HOLD_MAX_MS,
  MASTERS_PART_KEYS,
  type BootstrapPayload,
  type MastersPartKey,
} from "@/lib/bootstrap-contract";
import {
  readMastersBlob,
  upsertMastersPart,
  writeMastersBlob,
} from "@/lib/masters-blob";
import {
  MASTERS_QUERY_KEYS,
  blobOfPayload,
  seedMasters,
} from "@/lib/masters-seed";

// CB-DL-1 — ONE master-data call per page load.
//
// Every dashboard screen reads settings/categories/products/tables/staff
// through its own hook. Before this provider each of those was a separate
// request per screen (plus a 5-min products poll), which is exactly the
// recurring Mongo work the owner rule forbids. Now:
//
//   1. This device's stored copy (lib/masters-blob.ts) is seeded into the five
//      keys SYNCHRONOUSLY in a useState initializer — during the first render,
//      before any child mounts, so no screen ever paints an empty list it then
//      has to replace. An effect would be one paint too late.
//   2. GET /api/bootstrap runs once (staleTime Infinity, no mount/focus/
//      reconnect refetch, so a client-side navigation inside the tab does not
//      repeat it) and re-seeds + rewrites the device's copy on success.
//   3. Every later successful FETCH of one of the five keys (a mutation's
//      invalidation, a screen that legitimately refetched) is written back into
//      the device's copy, so a reload starts from the newest data this tab saw.
//      Manual setQueryData writes (optimistic updates, our own seeds) are NOT
//      written back — the invalidation refetch that follows them is.
//
// With no usable stored copy (a first launch, or a copy older than the blob's
// max age) children are held back behind a placeholder while the bootstrap is
// actually in flight — that is what guarantees the single call, since
// otherwise every mounted screen would fire its own master fetch first. The
// hold is BOUNDED three ways, because a stuck placeholder reads as "the app
// does not load": it ends on success, on an error (each hook then falls back
// to its own route — the pre-CB-DL-1 behaviour), the moment the query is
// PAUSED (an offline device: TanStack's networkMode "online" parks the fetch
// with neither data nor error — memory `tanstack-paused-query-reads-as-empty`),
// and in any case after MASTERS_HOLD_MAX_MS.
//
// The placeholder is also what the SERVER renders (it has no storage), so the
// first client render shows it too and switches to children only after mount —
// a first client paint that already showed the seeded screens would be a
// hydration mismatch of the whole dashboard shell, which React then discards
// and re-renders from scratch.
//
// Deliberately reads no session/role: the server decides whether the staff part
// is included (it is admin-only), and the client seeds only what arrived.
export const BOOTSTRAP_QUERY_KEY = ["bootstrap"] as const;

// Reverse of MASTERS_QUERY_KEYS for the write-back subscription: the root
// segment of a query key -> the part it belongs to.
const PART_OF_QUERY_ROOT: Record<string, MastersPartKey> = {};
for (const part of MASTERS_PART_KEYS) {
  const root = MASTERS_QUERY_KEYS[part][0];
  if (root !== undefined) PART_OF_QUERY_ROOT[root] = part;
}

const SINGLE_SEGMENT_KEY_LENGTH = 1;

export function MasterDataProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  // Synchronous seed — runs during this render, before children mount.
  const [seededFromBlob] = useState(() => {
    const blob = readMastersBlob();
    if (!blob) return false;
    seedMasters(qc, blob);
    return true;
  });

  const { data, error, fetchStatus } = useQuery({
    queryKey: BOOTSTRAP_QUERY_KEY,
    queryFn: () => apiGet<BootstrapPayload>("/api/bootstrap"),
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Server and first client render agree on the placeholder; children appear
  // after mount (see the header note on hydration).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // The wall-clock ceiling on the hold — armed only when there is no stored
  // copy to paint from.
  const [holdExpired, setHoldExpired] = useState(false);
  useEffect(() => {
    if (seededFromBlob) return;
    const id = window.setTimeout(() => setHoldExpired(true), MASTERS_HOLD_MAX_MS);
    return () => window.clearTimeout(id);
  }, [seededFromBlob]);

  // The last value written back per part. TanStack's structural sharing hands
  // back the SAME reference when a refetch produced an unchanged payload, so
  // this identity check is what stops a poll (e.g. the 30s tables poll, which
  // stays live floor state) from rewriting the device's copy every tick.
  const lastWritten = useRef<Partial<Record<MastersPartKey, unknown>>>({});

  useEffect(() => {
    if (!data) return;
    const blob = blobOfPayload(data);
    // Record BEFORE seeding: seedMasters' own setQueryData calls fire success
    // events through the subscription below, and without the values already
    // recorded each one would echo back as a redundant single-part write of
    // data this effect is about to store in full anyway.
    for (const part of MASTERS_PART_KEYS) {
      if (Object.hasOwn(blob.parts, part)) {
        lastWritten.current[part] = blob.parts[part];
      }
    }
    // force: the bootstrap response is the authoritative refresh — a client
    // clock running ahead must not let an older copy outrank it.
    seedMasters(qc, blob, { force: true });
    writeMastersBlob(blob);
  }, [data, qc]);

  useEffect(() => {
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      // Only a REAL fetch success may write back. query-core stamps every
      // setQueryData success with manual:true (queryClient.js:102 passes
      // { ...options, manual: true } into Query.setData, which dispatches it
      // on the success action; a fetch's own dispatch leaves it undefined), so
      // this excludes our seeds above and every optimistic write.
      if (event.action.manual === true) return;
      const queryKey = event.query.queryKey;
      // Length 1 only: ["products","archived"] is a different list and must
      // never land in the part the POS reads.
      if (queryKey.length !== SINGLE_SEGMENT_KEY_LENGTH) return;
      const root = queryKey[0];
      if (typeof root !== "string") return;
      if (!Object.hasOwn(PART_OF_QUERY_ROOT, root)) return;
      const part = PART_OF_QUERY_ROOT[root];
      const value: unknown = event.query.state.data;
      if (value === undefined) return;
      if (value === lastWritten.current[part]) return;
      lastWritten.current[part] = value;
      upsertMastersPart(part, value, new Date().toISOString());
    });
    return unsubscribe;
  }, [qc]);

  // Holding = no stored copy AND the bootstrap is still genuinely in flight.
  // `fetchStatus === "fetching"` is what excludes a paused (offline) query and
  // a settled one alike; `holdExpired` is the ceiling on the in-flight case.
  const holding =
    !seededFromBlob &&
    data === undefined &&
    error === null &&
    fetchStatus === "fetching" &&
    !holdExpired;

  if (!mounted || holding) {
    return (
      <div className="flex min-h-screen supports-[height:1dvh]:min-h-dvh items-center justify-center p-6">
        <span className="sr-only">Loading</span>
        <Skeleton className="h-24 w-full max-w-sm" />
      </div>
    );
  }

  return <>{children}</>;
}
