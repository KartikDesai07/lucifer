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

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body || !body.success) {
    throw new Error(body && "error" in body ? body.error : "Request failed");
  }
  return body.data;
}

export function apiGet<T>(url: string): Promise<T> {
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).then((res) =>
    unwrap<T>(res),
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
  }).then((res) => unwrap<T>(res));
}
