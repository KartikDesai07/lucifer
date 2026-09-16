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
import type { PrintJobFeedRow } from "@pos/shared/print-job";
import { hostRoutingOf, type PrintHostRouting } from "@/lib/print-routing";
import {
  prunePrintReadback,
  recordPrintReadback,
  type PrintReadbackEntry,
  type PrintReadbackRecord,
} from "@/lib/print-readback";

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

// CB-1d.3b (C1) — the print lane as its OWN context, derived ONCE here from
// the pulse with hostRoutingOf (MERGED-19's only sanctioned derivation) and
// provided as a plain string. React re-renders a context consumer only when
// the provided value changes, so useHostRouting — reached from PosPage's own
// render via usePosTab → usePosPrint → usePrintRouting — re-renders only
// when the LANE moves (unknown → host/no-host, a designation, a degraded
// tick), never on every payload-changing tick the way a `pulse` read did
// (measured ~187 renders per changed tick on /pos after C2). The `null`
// default is the crash fence: usePrintHostRouting throws outside
// <PosPulseProvider> exactly as usePosPulseContext does. Deliberately NOT a
// second TanStack observer: usePosPulse stays the single poller.
const PrintHostRoutingContext = createContext<PrintHostRouting | null>(null);

export function usePrintHostRouting(): PrintHostRouting {
  const routing = useContext(PrintHostRoutingContext);
  if (routing === null) {
    throw new Error("usePrintHostRouting must be used inside <PosPulseProvider>");
  }
  return routing;
}

// PH-5 — the drain feed (§B4 D1) as its OWN narrow context, same discipline
// as the lane above: the print-job drain subscribes to this array alone, never
// to the wide pulse value, so it re-renders only when the feed itself changes
// (TanStack's structural sharing keeps an unchanged array's identity across
// ticks). The empty constant is module-level so an unresolved pulse provides
// one stable identity, not a fresh [] per render. `null` default = the same
// crash fence as the two accessors above.
const EMPTY_PRINT_JOBS: PrintJobFeedRow[] = [];
const PrintJobFeedContext = createContext<PrintJobFeedRow[] | null>(null);

export function usePrintJobFeed(): PrintJobFeedRow[] {
  const feed = useContext(PrintJobFeedContext);
  if (feed === null) {
    throw new Error("usePrintJobFeed must be used inside <PosPulseProvider>");
  }
  return feed;
}

// PH-8 (§B7, MERGED-10 / A-17) — this device's OWN outstanding print jobs, as
// TWO narrow contexts: the recorder (a []-stable function, so useHostRouting
// — reached from PosPage's own render — never re-renders when the set moves)
// and the entries (read by RequestAlertBar alone, which already re-renders
// per tick). Pruned HERE against the three feeds on every tick because this
// provider owns all consumption of the pulse. `null` defaults = crash fence.
type PrintReadbackRecorder = (record: PrintReadbackRecord) => void;
const EMPTY_READBACK: PrintReadbackEntry[] = [];
const PrintReadbackRecordContext = createContext<PrintReadbackRecorder | null>(null);
const PrintReadbackContext = createContext<PrintReadbackEntry[] | null>(null);

export function usePrintReadbackRecorder(): PrintReadbackRecorder {
  const record = useContext(PrintReadbackRecordContext);
  if (record === null) {
    throw new Error("usePrintReadbackRecorder must be used inside <PosPulseProvider>");
  }
  return record;
}

export function usePrintReadback(): PrintReadbackEntry[] {
  const entries = useContext(PrintReadbackContext);
  if (entries === null) {
    throw new Error("usePrintReadback must be used inside <PosPulseProvider>");
  }
  return entries;
}

// CR2.3 §20 — owns ALL consumption of the pulse: the one poll (usePosPulse),
// the arrival diff (pulseArrival) that drives cache invalidation + the sound
// alert, the document.title prefix, the gesture-unlock listener, and the
// print-handler registry a bridge-owning screen (POS/requests) plugs into,
// the derived print-lane context (usePrintHostRouting), and PH-8's readback
// set (usePrintReadbackRecorder / usePrintReadback).
export function PosPulseProvider({ children }: { children: ReactNode }) {
  const { data } = usePosPulse();
  const qc = useQueryClient();
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;

  const prevRef = useRef<PosPulseData | null>(null);
  const lastPingRef = useRef<number>(0);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  // PH-5 — a STACK, not a single slot: the host's layout-level lane
  // (PrintHostDrain) and a page's own lane (pos/requests) now coexist on the
  // host PC, and a single last-wins slot lost the provider's handler the
  // moment a page unmounted (its cleanup nulled the slot). The band gets the
  // most recent registrant; unregistering removes only that entry.
  const [printHandlers, setPrintHandlers] = useState<KotPrintHandler[]>([]);
  const printHandler = printHandlers[printHandlers.length - 1] ?? null;

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

  // The readback set (PH-8). Recorded from useHostRouting.enqueue's single
  // site with the id the SERVER answered; advanced against D1/D2/D3 on each
  // tick. Both helpers return the SAME array when nothing changed, so React
  // bails out of the setState — a quiet tick re-renders no readback consumer.
  // Deliberately NOT gated on `isMutating` like the arrival diff above: this
  // touches no query cache, so an in-flight order mutation has nothing to lose.
  const [readback, setReadback] = useState<PrintReadbackEntry[]>(EMPTY_READBACK);
  const recordPrintJob = useCallback((record: PrintReadbackRecord) => {
    setReadback((current) => recordPrintReadback(current, record, Date.now()));
  }, []);
  useEffect(() => {
    if (!data) return;
    setReadback((current) => prunePrintReadback(current, data, Date.now()));
  }, [data]);

  const registerKotPrintHandler = useCallback((fn: KotPrintHandler) => {
    // Function values live inside the array, so React never mistakes one for
    // an updater. Push on register; the cleanup removes exactly its own entry.
    setPrintHandlers((current) => [...current, fn]);
    return () => setPrintHandlers((current) => current.filter((h) => h !== fn));
  }, []);

  const routing = hostRoutingOf(data);
  const printJobs = data?.printJobs ?? EMPTY_PRINT_JOBS;

  return (
    <PrintHostRoutingContext.Provider value={routing}>
      <PrintJobFeedContext.Provider value={printJobs}>
        <PrintReadbackRecordContext.Provider value={recordPrintJob}>
          <PrintReadbackContext.Provider value={readback}>
            <PosPulseContext.Provider
              value={{ pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler }}
            >
              {children}
            </PosPulseContext.Provider>
          </PrintReadbackContext.Provider>
        </PrintReadbackRecordContext.Provider>
      </PrintJobFeedContext.Provider>
    </PrintHostRoutingContext.Provider>
  );
}
