"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";

import { usePosPulse } from "@/hooks/use-pos-pulse";
import { ORDER_REQUEST_KEYS } from "@/hooks/use-order-requests";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { playAlertPing, isAlertSoundUnlocked, unlockAlertSound } from "@/lib/alert-sound";
import { pulseArrival, ALERT_REPEAT_MS, type PosPulseData } from "@pos/shared/self-order-alert";

// The document.title prefix this provider stamps on ("(3) " ahead of the
// page's own base title) — stripped back off before re-deriving `base` each
// tick so the prefix is idempotent across repeat ticks and tolerant of Next
// resetting document.title on a route change (the next tick just re-prefixes).
const TITLE_PREFIX_RE = /^\(\d+\)\s/;

type KotPrintHandler = (requestId: string) => void;

interface PosPulseContextValue {
  pulse: PosPulseData | undefined;
  soundUnlocked: boolean;
  unlock: () => void;
  printHandler: KotPrintHandler | null;
  registerKotPrintHandler: (fn: KotPrintHandler) => () => void;
}

const PosPulseContext = createContext<PosPulseContextValue | null>(null);

export function usePosPulseContext(): PosPulseContextValue {
  const ctx = useContext(PosPulseContext);
  if (!ctx) {
    throw new Error("usePosPulseContext must be used inside <PosPulseProvider>");
  }
  return ctx;
}

// CR2.3 §20 — owns ALL consumption of the pulse: the one poll (usePosPulse),
// the arrival diff (pulseArrival) that drives cache invalidation + the sound
// alert, the document.title prefix, the gesture-unlock listener, and the
// print-handler registry a bridge-owning screen (POS/requests) plugs into.
export function PosPulseProvider({ children }: { children: ReactNode }) {
  const { data } = usePosPulse();
  const qc = useQueryClient();
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;

  const prevRef = useRef<PosPulseData | null>(null);
  const lastPingRef = useRef<number>(0);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const [printHandler, setPrintHandler] = useState<KotPrintHandler | null>(null);

  const unlock = useCallback(() => {
    unlockAlertSound();
    setSoundUnlocked(isAlertSoundUnlocked());
  }, []);

  // ONE window-level gesture listener, firing once, so audio unlocks the
  // moment staff interact with the page AT ALL (any click or keypress) —
  // Chrome's autoplay policy requires resume() inside a gesture handler
  // (lib/alert-sound.ts's own header), and this is the earliest one available.
  useEffect(() => {
    const handler = () => unlock();
    window.addEventListener("pointerdown", handler, { once: true, capture: true });
    window.addEventListener("keydown", handler, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", handler, true);
      window.removeEventListener("keydown", handler, true);
    };
  }, [unlock]);

  // The core tick: diff against the previous poll, invalidate what changed,
  // and ring. Skipped ENTIRELY while an order mutation is in flight — a
  // forced invalidate here would clobber the optimistic state use-orders/
  // use-tables deliberately pause their OWN polling for; prevRef is also left
  // un-advanced so the NEXT tick re-diffs against the same prior state and
  // retries once the mutation settles.
  useEffect(() => {
    if (!data || isMutating) return;
    const delta = pulseArrival(prevRef.current, data);

    if (delta.requestsChanged) {
      qc.invalidateQueries({ queryKey: ORDER_REQUEST_KEYS.pending });
    }
    if (delta.selfOrdersChanged) {
      // An auto-accepted self-order claims a table too.
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
    }
    if (delta.ring) {
      const prefs = readDevicePrefs();
      if (prefs.alertSound && isAlertSoundUnlocked()) {
        playAlertPing();
        lastPingRef.current = Date.now();
      }
    }

    prevRef.current = data;
  }, [data, isMutating, qc]);

  // Repeat-nag: while there's an open count, re-ping every ALERT_REPEAT_MS
  // since the last ping — a staff member who misses/ignores the first chime
  // is re-alerted instead of only ever hearing it once per arrival. The same
  // beat re-stamps the title prefix (review C11): Next can reset
  // document.title AFTER our own pathname-keyed effect below already ran, so
  // a periodic re-stamp is the backstop that survives any ordering race.
  useEffect(() => {
    const openCount = data?.openCount ?? 0;
    if (openCount === 0) return;
    const id = window.setInterval(() => {
      const base = document.title.replace(TITLE_PREFIX_RE, "");
      document.title = `(${openCount}) ${base}`;
      const prefs = readDevicePrefs();
      if (!prefs.alertSound || !isAlertSoundUnlocked()) return;
      if (Date.now() - lastPingRef.current >= ALERT_REPEAT_MS) {
        playAlertPing();
        lastPingRef.current = Date.now();
      }
    }, ALERT_REPEAT_MS);
    return () => window.clearInterval(id);
  }, [data?.openCount]);

  // Title prefix — re-derives `base` off the CURRENT document.title (stripping
  // any prefix this same effect stamped earlier) rather than caching it.
  // Keyed on the PATHNAME too (review C11): Next resets document.title on a
  // route change WITHOUT the open count moving, so an openCount-only key left
  // the prefix missing until the next count change — the comment's old "next
  // tick re-prefixes" claim was false (ticks with an unchanged count never
  // re-ran this effect). Cleanup strips the prefix so an unmount (logout)
  // doesn't strand a stale "(N)" on the login screen's title.
  const pathname = usePathname();
  useEffect(() => {
    const openCount = data?.openCount ?? 0;
    const base = document.title.replace(TITLE_PREFIX_RE, "");
    document.title = openCount > 0 ? `(${openCount}) ${base}` : base;
    return () => {
      document.title = document.title.replace(TITLE_PREFIX_RE, "");
    };
  }, [data?.openCount, pathname]);

  const registerKotPrintHandler = useCallback((fn: KotPrintHandler) => {
    // React's setState always CALLS a function argument as an updater — it
    // can never tell "store this function" apart from "here's an updater
    // function" by type alone. Wrapping in `() => fn` is the only way to
    // store a function value in state without React invoking it immediately.
    setPrintHandler(() => fn);
    return () =>
      setPrintHandler((current: KotPrintHandler | null) => (current === fn ? null : current));
  }, []);

  return (
    <PosPulseContext.Provider
      value={{ pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler }}
    >
      {children}
    </PosPulseContext.Provider>
  );
}
