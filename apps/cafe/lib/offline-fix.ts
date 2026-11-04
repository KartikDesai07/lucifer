// Fix and send (Printing Phase 5, spec 5.8, ruling 9; plan Task 14). A refused entry (needs staff) opens in the POS
// cart; its next send goes online under a NEW key (the old one was refused: it never landed) with the entry's
// offline lines and taken time, so the server saves the lines printed offline as printed and no second KOT prints; once
// saved, the old entry leaves (an order made offline: its waiting rounds take the new server id).

import type { OfflineLine } from "@pos/shared/offline-kot";
import { removeEntry, settleCreate } from "@/lib/offline-outbox";
import type { OutboxEntry, OutboxRecord } from "@/lib/offline-outbox-schema";
import type { OrderItem } from "@/types";

export interface OfflineFix {
  key: string;
  ref: string;
  at: number;
  lines: OfflineLine[];
  local: string;
  kind: OutboxEntry["kind"];
  sale: boolean;
}

export function offlineFixOf(entry: OutboxEntry): OfflineFix {
  return { key: entry.key, ref: entry.ref, at: entry.at, lines: entry.lines, local: entry.local, kind: entry.kind, sale: entry.sale };
}

/** The fixed send's body: the cart's own (as the online send posts it), a new key, and the entry's offline note; a
 *  sale carries the total the device takes now (`total`). */
export function fixRequestBody(body: Record<string, unknown>, key: string, fix: OfflineFix, total: number): Record<string, unknown> {
  return { ...body, idemKey: key, offline: { ref: fix.ref, takenAt: fix.at, ...(fix.sale ? { total } : {}), lines: fix.lines } };
}

/** The entry's lines as unsent cart lines (round 0), exactly as it kept them. */
export function fixCartItems(entry: OutboxEntry): OrderItem[] {
  const items = (entry.body as { items?: unknown } | null)?.items;
  return (Array.isArray(items) ? (items as OrderItem[]) : []).map((line) => ({ ...line, kotRound: 0 }));
}

/** The server saved the fixed send as `orderId`: the old entry leaves; null when it already did. */
export function finishOfflineFix(record: OutboxRecord, fix: OfflineFix, orderId: string): OutboxRecord | null {
  if (!record.entries.some((entry) => entry.key === fix.key)) return null;
  const next = removeEntry(record, fix.key);
  return fix.kind === "create" ? settleCreate(next, fix.local, orderId) : next;
}

/** A fix asked for from Offline orders (any staff page), taken once by the POS when it is mounted. */
function createFixRequests() {
  let pending: OutboxEntry | null = null;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    request(entry: OutboxEntry) {
      pending = entry;
      tell();
    },
    pending: () => pending,
    take(): OutboxEntry | null {
      const taken = pending;
      pending = null;
      if (taken !== null) tell();
      return taken;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const offlineFixes = createFixRequests();
