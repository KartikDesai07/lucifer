import type { SlipPrintTarget } from "@/lib/print-host-slips";

// Phase 6 Session 6A (spec §9 ruling 9): a one-shot hand-off by printer "lane key". The print bridge arms it for the
// slip it is drawing; the two printer writers (printerWriter, the desktop LAN store) pass every write through
// laneWrite(), so the drawing step ends as soon as the bytes exist and the write runs on the printer's own queue.
// Unarmed, a write is exactly what it was. lib/printer/lane-print.ts and lib/desktop-shell.ts stay untouched (S1).

export type LaneKey = string;
export type LaneTake = (write: () => Promise<void>) => void;

export function nativeLaneKey(nativeId: string): LaneKey {
  return `native:${nativeId}`;
}

export function lanLaneKey(target: { host: string; port: number }): LaneKey {
  return `lan:${target.host.toLowerCase()}:${target.port}`;
}

export function laneKeyOfTarget(target: SlipPrintTarget | undefined): LaneKey | null {
  if (target?.nativeId !== undefined) return nativeLaneKey(target.nativeId);
  if (target?.lan !== undefined) return lanLaneKey(target.lan);
  return null;
}

let armed: { key: LaneKey; take: LaneTake } | null = null;

/** Arms the next write of that key (one arm at a time: arming replaces an earlier one). The returned disarm clears
 *  only its own arm and is harmless twice. */
export function armLaneWrite(key: LaneKey, take: LaneTake): () => void {
  const mine = { key, take };
  armed = mine;
  return () => {
    if (armed === mine) armed = null;
  };
}

/** Armed for this key: the arm is spent, `take` gets the write and this answers at once. Otherwise the write itself. */
export function laneWrite(key: LaneKey, write: () => Promise<void>): Promise<void> {
  if (armed !== null && armed.key === key) {
    const { take } = armed;
    armed = null;
    take(write);
    return Promise.resolve();
  }
  return write();
}

/** The same store with its `write` passing through laneWrite (the Windows app's network printers). */
export function withLaneWrites<L extends { write(target: { host: string; port: number }, bytes: Uint8Array): Promise<void> }>(lan: L): L {
  const inner = lan.write.bind(lan);
  return Object.assign(lan, {
    write: (target: { host: string; port: number }, bytes: Uint8Array): Promise<void> => laneWrite(lanLaneKey(target), () => inner(target, bytes)),
  });
}
