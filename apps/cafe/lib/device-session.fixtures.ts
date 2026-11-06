// Fakes for lib/device-session.test.ts: startSessionReader takes every side effect as a dependency, so a fake clock,
// scripted answers and a fake page (hidden / shown) drive it step by step with no browser and no real time.
import { startSessionReader, type SessionAnswer } from "@/lib/device-session";

export function fakeClock() {
  let nextId = 1;
  const timers = new Map<number, { run: () => void; ms: number }>();
  const list = () => [...timers.values()].map((t) => t.ms).sort((a, b) => a - b);
  return {
    setTimer: (run: () => void, ms: number): number => {
      const id = nextId++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (id: number): void => void timers.delete(id),
    /** The pending timers' durations, shortest first. */
    pending: list,
    /** Runs the first pending timer of this duration (throws when there is none). */
    fire(ms: number): void {
      for (const [id, t] of timers) {
        if (t.ms !== ms) continue;
        timers.delete(id);
        t.run();
        return;
      }
      throw new Error(`no pending ${ms} ms timer (pending: ${list().join(", ")})`);
    },
  };
}

/** Each ask stays open until the test answers it. */
export function scriptedAsk() {
  const calls: { signal: AbortSignal; answer: (a: SessionAnswer) => void }[] = [];
  const ask = (signal: AbortSignal) => new Promise<SessionAnswer>((answer) => void calls.push({ signal, answer }));
  return { ask, calls };
}

/** The page's visibility: hide() flips the flag; show() flips it back and tells every listener. */
export function fakePage(hidden = false) {
  let isHidden = hidden;
  const listeners = new Set<() => void>();
  return {
    isHidden: () => isHidden,
    onVisible: (run: () => void) => {
      listeners.add(run);
      return () => void listeners.delete(run);
    },
    hide: () => void (isHidden = true),
    show() {
      isHidden = false;
      for (const run of [...listeners]) run();
    },
    listeners: () => listeners.size,
  };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

export function harness({ hidden = false }: { hidden?: boolean } = {}) {
  const clock = fakeClock();
  const asked = scriptedAsk();
  const page = fakePage(hidden);
  const seen = { sessions: [] as unknown[], signedOut: 0 };
  const reader = startSessionReader({
    ask: asked.ask,
    onSession: (s) => void seen.sessions.push(s),
    onSignedOut: () => void (seen.signedOut += 1),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isHidden: page.isHidden,
    onVisible: page.onVisible,
  });
  return { clock, asked, page, seen, reader };
}
