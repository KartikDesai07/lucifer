// Client-side fetch helpers. Every API route returns the CLAUDE.md §7 envelope
// `{ success, data }` (or `{ success: false, error }`); these unwrap `.data` and
// throw on failure so TanStack Query's error path handles it uniformly.

// A network blip mid-request must fail visibly, not hang the caller forever
// (e.g. a cashier staring at a spinner mid-settle with no idea whether the
// sale landed). Both read and write paths abort after this ceiling.
const REQUEST_TIMEOUT_MS = 15 * 1000;

type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: Record<string, string[]> };

/** How a request failed — what a caller retrying a WRITE needs to know:
 *  "http"    the server answered with an error (`status` says which);
 *  "timeout" the REQUEST_TIMEOUT_MS abort fired — the server may still have
 *            done the work;
 *  "network" the request never got a response (offline, connection reset) —
 *            again, the server may or may not have received it.
 *  A server answer keeps the server's own message; no answer gets plain copy. */
export type ApiErrorKind = "http" | "network" | "timeout";

export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: ApiErrorKind;
  constructor(message: string, kind: ApiErrorKind, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const REQUEST_FAILED_MESSAGE = "Request failed";

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body || !body.success) {
    throw new ApiError(body && "error" in body ? body.error : REQUEST_FAILED_MESSAGE, "http", res.status);
  }
  return body.data;
}

/** What a caller toasts when the request never got an answer. Plain English —
 *  never the browser's own "Failed to fetch" / "signal timed out" — and never a
 *  claim either way about whether a write was saved (it may have landed). */
export const NETWORK_ERROR_MESSAGE = "Could not reach the server. Check the internet connection.";
export const TIMEOUT_ERROR_MESSAGE = "The server took too long to answer. Check the internet connection.";

/** A fetch that never answered, re-thrown as an ApiError (an abort from the
 *  timeout reads as a TimeoutError). */
function transportError(e: unknown): ApiError {
  const name = e instanceof Error ? e.name : "";
  return name === "TimeoutError" || name === "AbortError"
    ? new ApiError(TIMEOUT_ERROR_MESSAGE, "timeout", null)
    : new ApiError(NETWORK_ERROR_MESSAGE, "network", null);
}

export function apiGet<T>(url: string): Promise<T> {
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).then(
    (res) => unwrap<T>(res),
    (e: unknown) => {
      throw transportError(e);
    },
  );
}

// PUT is this app's update verb almost everywhere; PATCH exists for the few seams
// where an admin-only partial edit is deliberately split from a staff-facing PUT
// so the two can carry different auth guards (tables, CR1.1).
export function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  payload?: unknown,
): Promise<T> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(
    (res) => unwrap<T>(res),
    (e: unknown) => {
      throw transportError(e);
    },
  );
}
