// What waits while offline (Printing Phase 5, spec 5.10; plan Task 15). The writes that need the server now (settle,
// void, move, cancel, QR accept and reject, reprints, Print bill, End of day, setup saves) are refused on the device
// with one sentence and send nothing: each such mutation runs throwIfOffline as its onMutate (TanStack never calls
// its mutationFn then, and its own onError says the words). An order made offline is not on the server yet, so its
// settle, void, move and cancel wait for its create, online too. (The error boundaries' reload: lib/offline-reload.ts.)

import { ApiError } from "@pos/shared/api-client";
import { isOfflineOrderId } from "@/lib/offline-kot-order";
import { serverReach, type ServerReachStore } from "@/lib/server-reach";

export const OFFLINE_NEEDS_INTERNET = "Offline: this needs the internet. Try again once it is back.";
export const OFFLINE_ORDER_NOT_SENT = "This order is still waiting to be sent. Try again once it is sent.";

/** A refusal made on the device: read as definite (a 4xx: nothing was sent, so no Check and no Send again) and never as
 *  an answer that reached the server (not our envelope). */
const refusal = (message: string): ApiError => new ApiError(message, "http", 400, false);

function orderIdOf(variables: unknown): string | null {
  if (typeof variables === "string") return variables;
  const id = (variables as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : null;
}

/** The refusal for a write that needs the server now, or null. `variables`: the mutation's (an order id, or `{ id }`). */
export function offlineRefusalOf(variables: unknown, store: ServerReachStore = serverReach): ApiError | null {
  const id = orderIdOf(variables);
  if (id !== null && isOfflineOrderId(id)) return refusal(OFFLINE_ORDER_NOT_SENT);
  return store.isOffline() ? refusal(OFFLINE_NEEDS_INTERNET) : null;
}

/** A mutation's onMutate: throws the refusal, so the request is never made. */
export function throwIfOffline(variables: unknown, store: ServerReachStore = serverReach): void {
  const refused = offlineRefusalOf(variables, store);
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
