import type { PrinterCoverState, PrinterPaperState } from "@pos/shared/print-failover";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE, type PrinterStatus } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 3 Session 3E (spec §9.6): the network printers the Windows app 1.12.0 writes for this page,
// over raw TCP from its main process (apps/desktop/src/raw-tcp.ts): each one's link and what it says of its paper, cover
// and errors, from its last job or its idle check (lanStatus, every DESKTOP_LAN_CHECK_MS while this device prints;
// hooks/use-agent-printers.ts). A module store (subscribe / snapshot) like nativePool() for the POS app's printers, keyed
// by the POS app's id for the same printer ("tcp:<host>:<port>"). Capability-keyed: only an app that has printRaw and
// lanStatus is active; an older Windows app, or none, prints no network printer. This file never imports the
// desktop-shell seam (lib/printer/lane-print.ts imports it, and the seam imports lane-print.ts).

/** The idle check's cadence: the POS app's own (it asks an idle printer once a minute). */
export const DESKTOP_LAN_CHECK_MS = 60_000;
/** A printer that just failed a slip is asked again this much later (the POS app probes a down printer at 2 s, 5 s…). */
export const DESKTOP_LAN_RECHECK_MS = 5_000;
/** The 3D review gate (the POS app's cadence since the 3B gate): a printer that says it cannot print is asked again
 *  every 10 s (paper put back prints at once), one that does not answer every 30 s, until it is fine. */
export const DESKTOP_LAN_PROBLEM_CHECK_MS = 10_000;
export const DESKTOP_LAN_DOWN_CHECK_MS = 30_000;
/** The Windows app answers a slip within its own 60 s job deadline after the connect (5 s) and a check ahead of it (the
 *  gold's review, m-2: never give up before the app does); past this the page gives up waiting. */
export const DESKTOP_LAN_PRINT_TIMEOUT_MS = 75_000;
/** One call to the app asks at most this many printers (the app's LAN_STATUS_MAX_PRINTERS); a check of more makes more
 *  calls (the 3E review gate, m-5). */
export const DESKTOP_LAN_MAX_PRINTERS = 16;

export interface DesktopLanTarget {
  host: string;
  port: number;
}

/** One network printer the Windows app writes, as the page sees it. */
export interface DesktopLanPrinter {
  /** "tcp:<host>:<port>", lower-case: the POS app's id for the same printer. */
  id: string;
  host: string;
  port: number;
  status: Extract<PrinterStatus, "connecting" | "connected" | "disconnected">;
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
}

export interface DesktopLanSnapshot {
  /** The Windows app writes network printers (1.12.0). */
  active: boolean;
  /** The printers this page watches, in the order it named them. */
  printers: readonly DesktopLanPrinter[];
}

export const EMPTY_DESKTOP_LAN: DesktopLanSnapshot = { active: false, printers: [] };

/** The two bridge calls, bound; null on any other runtime and on an app from before 1.12.0. */
export interface DesktopLanApi {
  printRaw(printer: DesktopLanTarget, data: Uint8Array): Promise<unknown>;
  lanStatus(printers: DesktopLanTarget[]): Promise<unknown>;
}

export function desktopLanApi(): DesktopLanApi | null {
  if (typeof window === "undefined") return null;
  const bridge = window.posDesktop;
  if (bridge === undefined || typeof bridge.printRaw !== "function" || typeof bridge.lanStatus !== "function") return null;
  return { printRaw: bridge.printRaw.bind(bridge), lanStatus: bridge.lanStatus.bind(bridge) };
}

export function desktopLanId(target: DesktopLanTarget): string {
  return `tcp:${target.host}:${target.port}`.toLowerCase();
}

type Health = Pick<DesktopLanPrinter, "paper" | "cover" | "error">;

/** What the app says a printer says of itself; anything it does not know is left out (an older or odd answer). */
function healthOf(value: unknown): Health {
  if (typeof value !== "object" || value === null) return {};
  const { paper, cover, error } = value as Record<string, unknown>;
  return {
    ...(paper === "ok" || paper === "low" || paper === "out" ? { paper } : {}),
    ...(cover === "closed" || cover === "open" ? { cover } : {}),
    ...(error === true ? { error: true as const } : {}),
  };
}

/** The same rule as the POS app's printers (native-pool.ts poolPrinterCannotPrint): out of paper, its cover open, an error. */
export function desktopLanCannotPrint(entry: Health): boolean {
  return entry.paper === "out" || entry.cover === "open" || entry.error === true;
}

/** What the print agent can print on now: the connected printers that can print. A down printer's checks leave it
 *  unchanged, so they never nudge the agent. */
export function connectedLanKey(snapshot: DesktopLanSnapshot): string {
  return snapshot.printers.filter((entry) => entry.status === "connected" && !desktopLanCannotPrint(entry)).map((entry) => entry.id).join(",");
}

export interface DesktopLanDeps {
  api(): DesktopLanApi | null;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface DesktopLan {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DesktopLanSnapshot;
  /** The network printers this page prints: a new one is checked at once, one no longer named is forgotten. */
  watch(targets: readonly DesktopLanTarget[]): void;
  /** The idle check of every watched printer (one call to the app). */
  check(): Promise<void>;
  /** One finished job to that printer. Rejects with PRINTER_NOT_CONNECTED_MESSAGE when nothing was sent (the page acks a
   *  network printer "unreachable"), PRINTER_WRITE_FAILED_MESSAGE when part of it may be on paper ("maybe"). */
  write(target: DesktopLanTarget, bytes: Uint8Array): Promise<void>;
  printerOf(id: string): DesktopLanPrinter | null;
}

function sameHealth(a: Health, b: Health): boolean {
  return a.paper === b.paper && a.cover === b.cover && a.error === b.error;
}

export function createDesktopLan(deps: DesktopLanDeps): DesktopLan {
  let snapshot: DesktopLanSnapshot = EMPTY_DESKTOP_LAN;
  const listeners = new Set<() => void>();
  let recheck: unknown = null;
  let followUp: unknown = null;
  // The gold's review (m-3): each printer's slips, counted; a check that began before a slip's answer never overwrites it.
  const written = new Map<string, number>();

  const publish = (printers: readonly DesktopLanPrinter[]): void => {
    const active = deps.api() !== null;
    const same =
      active === snapshot.active &&
      printers.length === snapshot.printers.length &&
      printers.every((entry, i) => {
        const was = snapshot.printers[i];
        return was !== undefined && was.id === entry.id && was.status === entry.status && sameHealth(was, entry);
      });
    if (same) return;
    snapshot = { active, printers };
    for (const listener of [...listeners]) listener();
  };

  const update = (id: string, status: DesktopLanPrinter["status"], health: Health): void => {
    written.set(id, (written.get(id) ?? 0) + 1);
    publish(snapshot.printers.map((entry) => (entry.id === id ? { id: entry.id, host: entry.host, port: entry.port, status, ...health } : entry)));
    scheduleFollowUp();
  };

  // The 3D review gate: while a printer cannot print it is asked again every 10 s, while it does not answer every 30 s.
  const scheduleFollowUp = (): void => {
    if (followUp !== null) deps.clearTimer(followUp);
    followUp = null;
    const problem = snapshot.printers.some((entry) => entry.status === "connected" && desktopLanCannotPrint(entry));
    const down = snapshot.printers.some((entry) => entry.status !== "connected");
    if (!problem && !down) return;
    followUp = deps.setTimer(
      () => {
        followUp = null;
        void check();
      },
      problem ? DESKTOP_LAN_PROBLEM_CHECK_MS : DESKTOP_LAN_DOWN_CHECK_MS,
    );
  };

  const check = async (): Promise<void> => {
    const api = deps.api();
    if (api === null || snapshot.printers.length === 0) return;
    const before = new Map(written);
    // The 3E review gate (m-5): every watched printer, at most DESKTOP_LAN_MAX_PRINTERS to a call (the app's limit).
    const targets = snapshot.printers.map((entry) => ({ host: entry.host, port: entry.port }));
    const rows: unknown[] = [];
    for (let at = 0; at < targets.length; at += DESKTOP_LAN_MAX_PRINTERS) {
      let answer: unknown;
      try {
        answer = await api.lanStatus(targets.slice(at, at + DESKTOP_LAN_MAX_PRINTERS));
      } catch {
        answer = null;
      }
      // A refused or odd answer says nothing of those printers (m-4: the follow-up below still runs).
      if (Array.isArray(answer)) rows.push(...answer);
    }
    let printers = snapshot.printers;
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const { host, port, link, health } = row as Record<string, unknown>;
      if (typeof host !== "string" || typeof port !== "number" || (link !== "connected" && link !== "disconnected")) continue;
      const id = desktopLanId({ host, port });
      // A slip's answer that came after this check began is newer than it (the gold's review, m-3): keep that.
      if ((written.get(id) ?? 0) !== (before.get(id) ?? 0)) continue;
      // A job holds the printer now (link null): its own answer says it. Disconnected: nothing it said before stands.
      printers = printers.map((entry) => (entry.id === id ? { id, host: entry.host, port: entry.port, status: link, ...(link === "connected" ? healthOf(health) : {}) } : entry));
    }
    publish(printers);
    scheduleFollowUp();
  };

  const scheduleRecheck = (): void => {
    if (recheck !== null) return;
    recheck = deps.setTimer(() => {
      recheck = null;
      void check();
    }, DESKTOP_LAN_RECHECK_MS);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    watch(targets) {
      const seen = new Set<string>();
      const fresh: DesktopLanPrinter[] = [];
      const printers: DesktopLanPrinter[] = [];
      for (const target of targets) {
        const id = desktopLanId(target);
        if (seen.has(id)) continue;
        seen.add(id);
        const kept = snapshot.printers.find((entry) => entry.id === id);
        if (kept !== undefined) printers.push(kept);
        else {
          const entry: DesktopLanPrinter = { id, host: target.host.toLowerCase(), port: target.port, status: "connecting" };
          printers.push(entry);
          fresh.push(entry);
        }
      }
      publish(printers);
      if (fresh.length > 0) void check();
    },
    check,
    async write(target, bytes) {
      const api = deps.api();
      if (api === null) throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
      const id = desktopLanId(target);
      let timer: unknown = null;
      const noReply = new Promise<never>((_resolve, reject) => {
        timer = deps.setTimer(() => reject(new Error(PRINTER_WRITE_FAILED_MESSAGE)), DESKTOP_LAN_PRINT_TIMEOUT_MS);
      });
      let answer: unknown;
      try {
        answer = await Promise.race([api.printRaw({ host: target.host, port: target.port }, bytes), noReply]);
      } catch (error) {
        // No answer in time (the bytes may have gone out), or the app refused the request itself (a bad address or size:
        // the page never sends one; "maybe" is the safe reading of either).
        update(id, "connecting", {});
        scheduleRecheck();
        throw error instanceof Error && error.message === PRINTER_WRITE_FAILED_MESSAGE ? error : new Error(PRINTER_WRITE_FAILED_MESSAGE);
      } finally {
        if (timer !== null) deps.clearTimer(timer);
      }
      const result = (typeof answer === "object" && answer !== null ? answer : {}) as Record<string, unknown>;
      if (result.ok === true) {
        update(id, "connected", healthOf(result.health));
        return;
      }
      if (result.sent === "no") {
        update(id, "disconnected", {});
        scheduleRecheck();
        throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
      }
      // "maybe": the printer said it cannot print (its link is fine), or the link broke after bytes went out.
      if (result.failure === "cannot-print") update(id, "connected", healthOf(result.health));
      else {
        update(id, "connecting", {});
        scheduleRecheck();
      }
      throw new Error(PRINTER_WRITE_FAILED_MESSAGE);
    },
    printerOf: (id) => snapshot.printers.find((entry) => entry.id === id.toLowerCase()) ?? null,
  };
}

let instance: DesktopLan | null = null;

/** The page's one store of the Windows app's network printers. */
export function desktopLan(): DesktopLan {
  if (instance === null) {
    instance = createDesktopLan({
      api: desktopLanApi,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  }
  return instance;
}

/** Test seam: the page's store replaced (null: a fresh one on the next call). */
export function setDesktopLanInstance(next: DesktopLan | null): void {
  instance = next;
  lastState = null;
}

let lastState: { windows: object; lan: DesktopLanSnapshot } | null = null;

/** A value whose identity changes when the Windows app's printers change: its Windows printers (`windows`, the
 *  desktop printer store's snapshot) or a network printer's state. A refusal's hold is released then. */
export function desktopPrintersState(windows: object): object {
  const lan = desktopLan().getSnapshot();
  if (lastState === null || lastState.windows !== windows || lastState.lan !== lan) lastState = { windows, lan };
  return lastState;
}
