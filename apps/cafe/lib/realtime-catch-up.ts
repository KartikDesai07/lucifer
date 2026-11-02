import type { NudgeTimers } from "@/lib/realtime-invalidate";

// ─────────────────────────────────────────────────────────────────────────────
// Perf P1 deep review I-1 (2026-11-02) — the catch-up rounds are spaced.
//
// A drop of the room runs ONE catch-up round (hooks/use-realtime.ts
// useRealtimeCatchUp): the live lists, the floor, the Kitchen and token boards,
// the dashboard and today's summary, 5–7 requests. A link that flaps (open →
// close every few seconds on bad cafe Wi-Fi) or a room that closes right after
// it accepts would run one such round per cycle — more than today's 30 s polls
// ever cost. So the rounds are at least REALTIME_CATCH_UP_SPACING_MS apart: the
// first request runs at once; a request inside the window after a round folds
// into ONE round at the window's end. A fetch is then never more than one
// window (today's 30 s live-list poll) behind a drop, and a flap costs at most
// one round per window. The overdue echo of this device's own write (final
// review I2) asks through the same spacer.
// ─────────────────────────────────────────────────────────────────────────────

/** I-1: the least time between two catch-up rounds — today's live-list poll (REFETCH_INTERVALS.LIVE_LISTS). */
export const REALTIME_CATCH_UP_SPACING_MS = 30_000;

export interface RoundSpacer {
  /** Asks for a round: at once outside the window, else once at its end. */
  request: () => void;
  /** Drops a deferred round; nothing runs afterwards. */
  dispose: () => void;
}

const BROWSER_TIMERS: NudgeTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createRoundSpacer(
  fire: () => void,
  spacingMs: number = REALTIME_CATCH_UP_SPACING_MS,
  timers: NudgeTimers = BROWSER_TIMERS,
  now: () => number = () => Date.now(),
): RoundSpacer {
  let lastAt: number | null = null;
  let handle: unknown;
  let waiting = false;
  let disposed = false;
  const run = (): void => {
    waiting = false;
    if (disposed) return;
    lastAt = now();
    fire();
  };
  return {
    request: () => {
      if (disposed || waiting) return; // a deferred round already covers this one
      // Capped at one window: a clock set back never pushes the round further out.
      const wait = lastAt === null ? 0 : Math.min(lastAt + spacingMs - now(), spacingMs);
      if (wait <= 0) {
        run();
        return;
      }
      waiting = true;
      handle = timers.setTimeout(run, wait);
    },
    dispose: () => {
      disposed = true;
      waiting = false;
      timers.clearTimeout(handle);
    },
  };
}
