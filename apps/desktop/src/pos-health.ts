// Native apps 2.0 (spec §9): the address window's one check before it saves an address. GET <origin>/api/health once,
// following no redirect. A POS answers with JSON that names its tenant: 200 when its database is up, 503 when it is down
// (the address is right either way, so it is saved and the POS page shows its own error). Any other answer is not a POS
// at that address; no answer at all, or none within 5 seconds, is a network problem. One request per typed address,
// nothing recurring (the free-tier rule). Pure: the fetch is passed in (Electron's net.fetch from url-window.ts), so
// node:test drives it with a fake.

export const HEALTH_PATH = "/api/health";
export const HEALTH_TIMEOUT_MS = 5_000;

export type PosCheck = { ok: true } | { ok: false; error: string };

export interface HealthInit {
  method: "GET";
  redirect: "manual";
  cache: "no-store";
  headers: Record<string, string>;
  signal: AbortSignal;
}

/** The part of fetch this check uses (Electron's net.fetch in the app, a fake in the tests). */
export type HealthFetch = (url: string, init: HealthInit) => Promise<{ status: number; json(): Promise<unknown> }>;

const FOUND_STATUSES = [200, 503];

export function notFoundError(host: string): string {
  return `We couldn't find a POS at ${host}. Check the name.`;
}

export function unreachableError(host: string): string {
  return `Couldn't reach ${host}. Check the internet connection.`;
}

/** The host (and port) of an origin normalizePosUrl made: "scheme://host[:port]". */
function hostOf(origin: string): string {
  return origin.replace(/^[a-z]+:\/\//, "");
}

function isPosHealth(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { tenant, ok } = body as { tenant?: unknown; ok?: unknown };
  return typeof tenant === "string" && typeof ok === "boolean";
}

export async function checkPos(origin: string, fetcher: HealthFetch, timeoutMs = HEALTH_TIMEOUT_MS): Promise<PosCheck> {
  const host = hostOf(origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Awaited<ReturnType<HealthFetch>>;
    try {
      response = await fetcher(origin + HEALTH_PATH, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      return { ok: false, error: unreachableError(host) };
    }
    if (!FOUND_STATUSES.includes(response.status)) {
      return { ok: false, error: notFoundError(host) };
    }
    try {
      return isPosHealth(await response.json()) ? { ok: true } : { ok: false, error: notFoundError(host) };
    } catch {
      // Not JSON: another site's page.
      return { ok: false, error: notFoundError(host) };
    }
  } finally {
    clearTimeout(timer);
  }
}
