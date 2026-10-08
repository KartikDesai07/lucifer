// Native bridge contract v2 (Phase 2 Session 2F2, spec §9.2): one phone or tablet drives several printers. The
// page's copy is apps/cafe/lib/printer/native-bridge-v2.ts (its header states the contract); a parity pin there
// (native-bridge-v2-parity.test.ts) reads this file, the router, the validation and the injected script. v1
// (./protocol.ts) is unchanged: a page that knows only v1 keeps printing on the app's default printer.

import type {
  NativeBluetoothState,
  NativeErrorCode,
  NativePrinter,
  NativePrinterState,
} from './protocol';

export const BRIDGE_V2 = 2;

/** What window.PosNative.versions says: every bridge version this app speaks. */
export const BRIDGE_VERSIONS = [1, 2] as const;

/** The methods a v2 envelope carries; every other method stays v1. */
export const V2_METHODS = [
  'printer.status',
  'printer.select',
  'printer.reconnect',
  'printer.forget',
  'printer.print',
] as const;
export type V2Method = (typeof V2_METHODS)[number];

/** Phase 3 Session 3C (spec §10): what a printer says of its paper and cover (DLE EOT); the page's lists are
 *  PRINTER_PAPER_STATES and PRINTER_COVER_STATES (@pos/shared/print-failover), pinned in its parity test. */
export const PAPER_STATES = ['ok', 'low', 'out'] as const;
export const COVER_STATES = ['closed', 'open'] as const;

/** One printer of the app's list. Session 3C: with its paper, cover and error when it said them (absent: nothing). */
export type PoolEntry = {
  state: NativePrinterState;
  printer: NativePrinter;
  paper?: (typeof PAPER_STATES)[number];
  cover?: (typeof COVER_STATES)[number];
  error?: true;
};

/** The app's printers in its order, the default's id (null only for an empty list) and Bluetooth. */
export type PoolStatus = {
  printers: PoolEntry[];
  defaultId: string | null;
  bluetooth: NativeBluetoothState;
};

/** A v2 reply carries the version of the request it answers. */
export type BridgeReplyV2 =
  | { v: 2; id: string; ok: true; result: unknown }
  | {
      v: 2;
      id: string;
      ok: false;
      error: { code: NativeErrorCode; message: string };
    };
