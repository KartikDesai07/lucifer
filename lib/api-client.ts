// Client-side fetch helpers. Every API route returns the CLAUDE.md §7 envelope
// `{ success, data }` (or `{ success: false, error }`); these unwrap `.data` and
// throw on failure so TanStack Query's error path handles it uniformly.

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
  return fetch(url).then((res) => unwrap<T>(res));
}

export function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  payload?: unknown,
): Promise<T> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).then((res) => unwrap<T>(res));
}
