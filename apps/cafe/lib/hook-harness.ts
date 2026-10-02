import Module from "node:module";
import type { UseReactToPrintOptions } from "react-to-print";

// Test support (NOT app code): a tiny React-free runtime that runs a REAL hook
// body under node:test. apps/cafe has no DOM and no renderer, so a hook with
// refs, timers and effects (the print host bridge) had no behavioural test.
// This implements exactly the hooks those bodies use -- useState, useRef,
// useCallback, useMemo, useEffect -- with React's own rules: effects run after
// the render that changed their deps, cleanups before the next run, setState
// re-renders until stable. It also stubs the three modules the bridge pulls in
// (react, react-to-print, sonner, use-settings) so that file loads unchanged.
// Install happens when this module is imported, so import it BEFORE the hook.

type Deps = readonly unknown[] | undefined;
type Cleanup = (() => void) | void;
type Updater<T> = T | ((prev: T) => T);
interface EffectSlot {
  deps: Deps;
  cleanup: Cleanup;
}
interface MemoSlot<T> {
  deps: Deps;
  value: T;
}
interface StateSlot<T> {
  value: T;
  set: (next: Updater<T>) => void;
}

const MAX_RENDER_PASSES = 50;
const sameDeps = (a: Deps, b: Deps): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

let active: Runtime<unknown> | null = null;
function runtime(): Runtime<unknown> {
  if (!active) throw new Error("a hook ran outside the harness");
  return active;
}

class Runtime<R> {
  private slots: unknown[] = [];
  private cursor = 0;
  private queued: Array<{ slot: EffectSlot; deps: Deps; run: () => Cleanup }> = [];
  private dirty = false;
  private depth = 0;
  private flushing = false;
  private latest: R | undefined;
  private mounted = true;
  constructor(private readonly body: () => R) {}

  slot<T>(init: () => T): T {
    const at = this.cursor++;
    if (!(at in this.slots)) this.slots[at] = init();
    return this.slots[at] as T;
  }

  effect(run: () => Cleanup, deps: Deps): void {
    const slot = this.slot<EffectSlot>(() => ({ deps: undefined, cleanup: undefined }));
    // A slot that has never run has deps === undefined, which never matches.
    if (!sameDeps(slot.deps, deps) || deps === undefined) this.queued.push({ slot, deps, run });
  }

  schedule(): void {
    this.dirty = true;
    if (this.depth === 0 && !this.flushing) this.flush();
  }

  private flush(): void {
    this.flushing = true;
    try {
      for (let pass = 0; ; pass++) {
        if (pass >= MAX_RENDER_PASSES) throw new Error("the hook never settled (render loop)");
        this.dirty = false;
        this.cursor = 0;
        printHookCounter = 0;
        const previous = active;
        active = this as Runtime<unknown>;
        try {
          this.latest = this.body();
        } finally {
          active = previous;
        }
        const batch = this.queued;
        this.queued = [];
        for (const { slot } of batch) {
          if (typeof slot.cleanup === "function") slot.cleanup();
          slot.cleanup = undefined;
        }
        for (const { slot, deps, run } of batch) {
          slot.deps = deps;
          slot.cleanup = run();
        }
        if (!this.dirty) break;
      }
    } finally {
      this.flushing = false;
    }
  }

  start(): void {
    this.flush();
  }
  result(): R {
    return this.latest as R;
  }
  rerender(): void {
    this.dirty = true;
    this.flush();
  }
  act(fn: () => void): void {
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
    }
    if (this.depth === 0 && this.dirty && this.mounted) this.flush();
  }
  unmount(): void {
    this.mounted = false;
    for (const slot of this.slots) {
      const cleanup = (slot as Partial<EffectSlot> | null)?.cleanup;
      if (typeof cleanup === "function") cleanup();
    }
  }
}

export interface MountedHook<R> {
  result(): R;
  /** Run `fn` (an event, a timer tick), then re-render until stable. */
  act(fn: () => void): void;
  /** Re-render now (something the hook reads outside React changed). */
  rerender(): void;
  unmount(): void;
}

export function mountHook<R>(body: () => R): MountedHook<R> {
  const rt = new Runtime(body);
  rt.start();
  return { result: () => rt.result(), act: (fn) => rt.act(fn), rerender: () => rt.rerender(), unmount: () => rt.unmount() };
}

// ---- the stubbed modules --------------------------------------------------------------------

const fakeReact = {
  useState<T>(init: T | (() => T)): [T, (next: Updater<T>) => void] {
    const rt = runtime();
    const slot = rt.slot<StateSlot<T>>(() => {
      const state: StateSlot<T> = {
        value: typeof init === "function" ? (init as () => T)() : init,
        set: (next) => {
          const value = typeof next === "function" ? (next as (prev: T) => T)(state.value) : next;
          if (Object.is(value, state.value)) return;
          state.value = value;
          rt.schedule();
        },
      };
      return state;
    });
    return [slot.value, slot.set];
  },
  useRef<T>(init: T): { current: T } {
    return runtime().slot(() => ({ current: init }));
  },
  useMemo<T>(factory: () => T, deps: Deps): T {
    const slot = runtime().slot<MemoSlot<T> | { deps: undefined; value: undefined }>(() => ({ deps: undefined, value: undefined }));
    if (!sameDeps(slot.deps, deps)) {
      slot.deps = deps;
      slot.value = factory() as never;
    }
    return slot.value as T;
  },
  useCallback<T>(fn: T, deps: Deps): T {
    return fakeReact.useMemo(() => fn, deps);
  },
  useEffect(run: () => Cleanup, deps?: Deps): void {
    runtime().effect(run, deps);
  },
};

/** What the stubbed react-to-print / sonner saw. Reset between tests with resetStubs(). */
export const SURFACE_ORDER = ["kot", "receipt", "eod"] as const;
export const stubs = {
  toasts: [] as string[],
  printed: [] as string[],
  options: [] as UseReactToPrintOptions[],
};
export function resetStubs(): void {
  stubs.toasts.length = 0;
  stubs.printed.length = 0;
  stubs.options.length = 0;
}

// The bridge calls useReactToPrint three times per render, in this order.
let printHookCounter = 0;
const printers = SURFACE_ORDER.map((surface) => () => void stubs.printed.push(surface));
function fakeUseReactToPrint(options: UseReactToPrintOptions): () => void {
  const index = printHookCounter++ % SURFACE_ORDER.length;
  stubs.options[index] = options;
  return printers[index] as () => void;
}

const STUBBED: Record<string, unknown> = {
  react: fakeReact,
  "react-to-print": { useReactToPrint: fakeUseReactToPrint },
  sonner: { toast: { error: (m: string) => stubs.toasts.push(m), info: () => undefined, success: () => undefined } },
  "@/hooks/use-settings": { useSettings: () => ({ data: undefined }) },
};

/** Replace a module for every require that follows (call BEFORE importing the hook under test). */
export function stubModule(request: string, impl: unknown): void {
  STUBBED[request] = impl;
}

interface ModuleInternals {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
}
const internals = Module as unknown as ModuleInternals;
const realLoad = internals._load;
internals._load = function patchedLoad(this: unknown, request, parent, isMain) {
  return request in STUBBED ? STUBBED[request] : realLoad.call(this, request, parent, isMain);
};

// The bridge arms its timers through window.setTimeout; route them to the (mockable) globals.
const holder = globalThis as unknown as { window?: unknown };
holder.window = {
  setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
};
