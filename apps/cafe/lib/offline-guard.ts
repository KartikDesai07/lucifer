// What waits while offline (Printing Phase 5, spec 5.10; plan Task 15). The writes that need the server now (settle,
// void, move, cancel, QR accept and reject, reprints, Print bill, End of day, setup saves) are refused on the device
// with one sentence and send nothing: each such mutation runs throwIfOffline as its onMutate (TanStack never calls
// its mutationFn then, and its own onError says the words). An order made offline is not on the server yet, so its
// settle, void, move and cancel wait for its create, online too; so do a tab's while a round of it is still kept on
// this device (spec 5.5: the server's tab lacks that round, so a bill now would close without it). (The error
// boundaries' reload: lib/offline-reload.ts.)

import { ApiError } from "@pos/shared/api-client";
import { isOfflineOrderId } from "@/lib/offline-kot-order";
import { offlineOutbox, type OutboxStore } from "@/lib/offline-outbox-store";
import { serverReach, type ServerReachStore } from "@/lib/server-reach";

export const OFFLINE_NEEDS_INTERNET = "Offline: this needs the internet. Try again once it is back.";
export const OFFLINE_ORDER_NOT_SENT = "This order is still waiting to be sent. Try again once it is sent.";
export const OFFLINE_ROUND_NOT_SENT = "A round of this order is still waiting to be sent (Offline orders). Try again once it is sent.";

/** A refusal made on the device: read as definite (a 4xx: nothing was sent, so no Check and no Send again) and never as
 *  an answer that reached the server (not our envelope). */
const refusal = (message: string): ApiError => new ApiError(message, "http", 400, false);

function orderIdOf(variables: unknown): string | null {
  if (typeof variables === "string") return variables;
  const id = (variables as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : null;
}

/** Any entry of this server order still on the device (waiting, sending, or refused and waiting for staff): a round on a
 *  server tab, or one of an order made offline whose create was saved. (An order made offline is refused above.) */
function keptOnDevice(id: string, outbox: Pick<OutboxStore, "getSnapshot">): boolean {
  const record = outbox.getSnapshot().record;
  return record !== null && record.entries.some((entry) => entry.orderId === id);
}

/** The refusal for a write that needs the server now, or null. `variables`: the mutation's (an order id, or `{ id }`). */
export function offlineRefusalOf(variables: unknown, store: ServerReachStore = serverReach, outbox: Pick<OutboxStore, "getSnapshot"> = offlineOutbox): ApiError | null {
  const id = orderIdOf(variables);
  if (id !== null && isOfflineOrderId(id)) return refusal(OFFLINE_ORDER_NOT_SENT);
  if (store.isOffline()) return refusal(OFFLINE_NEEDS_INTERNET);
  return id !== null && keptOnDevice(id, outbox) ? refusal(OFFLINE_ROUND_NOT_SENT) : null;
}

/** A mutation's onMutate: throws the refusal, so the request is never made. */
export function throwIfOffline(variables: unknown, store: ServerReachStore = serverReach, outbox: Pick<OutboxStore, "getSnapshot"> = offlineOutbox): void {
  const refused = offlineRefusalOf(variables, store, outbox);
  if (refused !== null) throw refused;
}

/** End of day on a device whose outbox still holds entries (spec 5.10, the review's I10): its figures would miss them. */
export function offlineEodWarning(count: number): string {
  return count === 1
    ? "1 offline order is still on this device: send it before End of day."
    : `${count} offline orders are still on this device: send them before End of day.`;
}

export const OFFLINE_HEADER_PRINTING = "Offline — KOTs print here";
export const OFFLINE_HEADER_KEEPING = "Offline — orders are kept on this device";

/** The header's printer button while offline (spec 5.10): the warn (amber) dot, with what a send does here; null online.
 *  Spec 5.10's longer sentence is Offline orders' line (lib/offline-orders-view.ts OFFLINE_SHEET_OFFLINE). */
export function offlineHeaderOf(input: { offline: boolean; printsHere: boolean }): { name: string } | null {
  if (!input.offline) return null;
  return { name: input.printsHere ? OFFLINE_HEADER_PRINTING : OFFLINE_HEADER_KEEPING };
}
