// The session on the device (P2 N2). The staff frame is static (served from the CDN, no function), so the server no
// longer hands the page a session: the dashboard reads it here, once per full page load, from /api/auth/session.
//
// Why not next-auth's own client read (getSession / SessionProvider's first fetch): its fetchData() turns ANY failed
// request into a null session, i.e. "unauthenticated" (SessionKeepalive.tsx has the same note). With a slow or broken
// line that would bounce an admin off /settings (AdminGuard) or show a staff member's shell to an admin, and the
// reverse. So three answers are told apart here, and only a real 200 with nobody signed in is a sign-out:
//   - a session  -> handed to <SessionProvider session=...> once (components/layout/DeviceSessionGate.tsx);
//   - signed out -> a full load of /login, as the middleware would do;
//   - no answer  -> (a network error, any non-200, a body that is not the session JSON, a timeout) tried again with
//                   a short backoff, never read as signed out.
// Nothing is stored on the device: a stored copy could show one person's shell to the next after a sign-out or a
// PIN switch.
//
// Everything with a side effect (fetch, timers) is passed in, so the whole read is testable without a browser.
import type { Session } from "next-auth";

export const SESSION_ENDPOINT = "/api/auth/session";

/** The wait before each retry while nothing answers: 1, 2, 4, then every 8 s. */
export const SESSION_RETRY_MS = [1000, 2000, 4000, 8000] as const;

/** One attempt is abandoned (aborted, counted as no answer) after the backoff's ceiling, not the browser's minutes. */
export const SESSION_ATTEMPT_TIMEOUT_MS = Math.max(...SESSION_RETRY_MS);

const HTTP_OK = 200;

export type SessionAnswer = { kind: "session"; session: Session } | { kind: "signed-out" } | { kind: "no-answer" };

const SIGNED_OUT: SessionAnswer = { kind: "signed-out" };
const NO_ANSWER: SessionAnswer = { kind: "no-answer" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What one /api/auth/session response means. `status` is null when the request never got a response. Auth.js answers
 * 200 + null when nobody is signed in (`{}` is accepted too); a session is a 200 whose user carries a non-empty string
 * id. Anything else (a 200 that is neither of those included) is no answer: never a sign-out.
 */
export function classifySessionAnswer(status: number | null, body: unknown): SessionAnswer {
  if (status !== HTTP_OK) return NO_ANSWER;
  if (body === null) return SIGNED_OUT;
  if (!isObject(body)) return NO_ANSWER;
  if (Object.keys(body).length === 0) return SIGNED_OUT;
  const user = body.user;
  if (isObject(user) && typeof user.id === "string" && user.id.length > 0) {
    return { kind: "session", session: body as unknown as Session };
  }
  return NO_ANSWER;
}

/** The wait before retry number `attempt` (0-based): 1000, 2000, 4000, then 8000 for every later one. */
export function retryDelay(attempt: number): number {
  // Always a whole index in range: NaN and anything below 1 read as the first wait, anything past the end as the last.
  const index = attempt > 0 ? Math.min(Math.floor(attempt), SESSION_RETRY_MS.length - 1) : 0;
  return SESSION_RETRY_MS[index];
}

/** One attempt: an uncached, same-origin GET. Never rejects; an abort or a failure of any kind is no answer. */
export async function askSession(fetchImpl: typeof fetch, signal: AbortSignal): Promise<SessionAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(SESSION_ENDPOINT, { cache: "no-store", credentials: "same-origin", signal });
  } catch {
    return NO_ANSWER;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return classifySessionAnswer(response.status, body);
}

export interface SessionReaderDeps {
  ask(signal: AbortSignal): Promise<SessionAnswer>;
  onSession(session: Session): void;
  onSignedOut(): void;
  setTimer(run: () => void, ms: number): number;
  clearTimer(id: number): void;
  /** Whether the page is hidden now (document.visibilityState === "hidden"). */
  isHidden(): boolean;
  /** Calls `run` each time the page becomes visible; returns what removes the listener. */
  onVisible(run: () => void): () => void;
}

export interface SessionReader {
  /** Abort the attempt in flight (or skip the backoff wait) and ask at once. Nothing once settled or stopped. */
  retryNow(): void;
  /** Abort the attempt in flight, clear every timer and the visibility listener; later answers are ignored (the
   *  gate's unmount). */
  stop(): void;
}

/**
 * Asks at once and keeps asking until a session or a sign-out: each attempt is aborted after
 * SESSION_ATTEMPT_TIMEOUT_MS, and no answer waits retryDelay(n) before the next. Exactly one of onSession /
 * onSignedOut is called, at most once. An attempt that was superseded (Retry, a timeout) or stopped never counts.
 *
 * A hidden page starts no new attempt: during a server outage a tab nobody looks at would otherwise call the session
 * function every 8 s for hours (a free-tier cost). A retry that comes due while hidden is held, an attempt in flight
 * may finish, and the moment the page shows with no attempt in flight it asks at once (the backoff step carries on).
 * The page load's first attempt runs even hidden: one request, as before, so a tab opened in the background (a
 * browser print host) still comes up by itself on a healthy server.
 */
export function startSessionReader(deps: SessionReaderDeps): SessionReader {
  let done = false;
  let failures = 0;
  let current: AbortController | null = null;
  let attemptTimer: number | null = null;
  let retryTimer: number | null = null;
  let stopListening: (() => void) | null = null;

  const finish = () => {
    done = true;
    stopListening?.();
    stopListening = null;
  };

  const clearTimers = () => {
    if (attemptTimer !== null) deps.clearTimer(attemptTimer);
    if (retryTimer !== null) deps.clearTimer(retryTimer);
    attemptTimer = null;
    retryTimer = null;
  };

  const settle = (mine: AbortController, answer: SessionAnswer) => {
    if (done || current !== mine) return;
    current = null;
    clearTimers();
    if (answer.kind === "session") {
      finish();
      deps.onSession(answer.session);
    } else if (answer.kind === "signed-out") {
      finish();
      deps.onSignedOut();
    } else {
      retryTimer = deps.setTimer(retryUnlessHidden, retryDelay(failures));
      failures += 1;
    }
  };

  // Hidden: nothing is scheduled and nothing is in flight, so the visibility listener below is what resumes.
  function retryUnlessHidden() {
    retryTimer = null;
    if (!deps.isHidden()) attempt();
  }

  function attempt() {
    current?.abort();
    clearTimers();
    const mine = new AbortController();
    current = mine;
    attemptTimer = deps.setTimer(() => {
      mine.abort();
      settle(mine, NO_ANSWER);
    }, SESSION_ATTEMPT_TIMEOUT_MS);
    void deps
      .ask(mine.signal)
      .catch(() => NO_ANSWER)
      .then((answer) => settle(mine, answer));
  }

  stopListening = deps.onVisible(() => {
    if (!done && current === null) attempt();
  });
  attempt();
  return {
    retryNow() {
      if (!done) attempt();
    },
    stop() {
      finish();
      current?.abort();
      current = null;
      clearTimers();
    },
  };
}
