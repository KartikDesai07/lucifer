import { z } from "zod";

import { PRINTER_COVER_STATES, PRINTER_PAPER_STATES } from "@pos/shared/print-failover";

import {
  NATIVE_CONNECT_TIMEOUT_MS,
  NATIVE_PRINT_TIMEOUT_MS,
  NATIVE_REQUEST_TIMEOUT_MS,
  nativeBridge,
  nativeError,
  nativeErrorCode,
  nativePrinterSchema,
} from "@/lib/printer/native-bridge";
import {
  NATIVE_BLUETOOTH_STATES,
  NATIVE_PRINTER_STATES,
  type NativeEvent,
  type NativeMethod,
  type PosNativeApi,
} from "@/lib/printer/native-bridge-protocol";

// Phase 2 Session 2F1 (spec §9.2, plan decision 12): the page half of the POS app bridge, version 2: one phone or
// tablet drives several printers. The app half is Session 2F2's; it mirrors this contract in apps/mobile/src/bridge
// (with a parity pin then). Until an app says it speaks v2, nothing here is ever called: the release APK, and every
// app before 2F2, only speak v1, and this page drives its one printer through native-bridge.ts exactly as before.
//
// The contract (spec §9.2 "Bridge v2"):
//   · window.PosNative keeps `version: 1`; an app that speaks v2 adds `versions: [1, 2]`, and its `request` and `on`
//     take the version as a last argument (absent: 1). A v1 message acts on the app's DEFAULT printer exactly as
//     today, so a page that is not reloaded yet keeps printing with the new app.
//   · v2 printer methods: `printer.status` (every printer of the app), `printer.select` ({ id } | { tcp }: adds that
//     printer to the app's printers and connects it; the first printer of an empty list becomes the default),
//     `printer.reconnect` / `printer.forget` ({ printerId }), `printer.print` ({ printerId, data }). Each answer but
//     the print's is the whole list, like the v2 `printer.status` event the app sends on every change of any printer.
//   · A printer is named by the app's own id (`tcp:host:port`, `bt-classic:<MAC>`, `ble:<MAC>`, `usb:<vendor>:<product>`).
//     The default printer leaving the list (v1 or v2 forget) makes the first remaining printer the default.
//   · The app sends a v1 `printer.status` (its default printer's) whenever that status changes: its state, Bluetooth,
//     and which printer is the default (a select into an empty list, a promotion after a forget, a v1 select or
//     forget), so a page of either version knows this device's printer.
//   · `printer.select` keeps the printer listed (down) when its first connect fails, and the app's own reconnect loop
//     keeps trying, as v1 keeps its one printer.
//   · No v2 status event when nothing a page reads changed (each event nudges the page's agent).
//   · `printer.print` refuses with NOT_CONNECTED only when no byte was sent (the page then reconnects once and sends once
//     more, as on v1); any later failure is WRITE_FAILED (part of the slip may be on paper).
//   · The app's list always holds its default printer: an app updated from v1 moves its one printer into the list as
//     the default, so a page on v2 (which trusts the list alone) still finds this device's printer.
//   · A v1 and a v2 print aimed at the same printer are serialized in the app (one print at a time per printer: the
//     other is refused BUSY before any byte), never interleaved: a print agent's job refused BUSY is sent again after
//     its hold, and a print a person started says so.
//   · A network (tcp) printer has no standing link: the app connects per job, and `printer.select` / `printer.reconnect`
//     only probe it (connect, then close). Between jobs it reads `connected` from the last probe or job that reached
//     it, and `disconnected` once a job's connect or write failed (a print whose connect failed is refused
//     NOT_CONNECTED: no byte sent); the app's own loop then probes it (2 s, 5 s, 10 s, then every 30 s, each probe
//     reported `connecting`) until it answers. On a tcp printer `connected` means "it answered last time".
//   · An app with no printer answers `printer.status` (and every list answer and event) with
//     `{ printers: [], defaultId: null, bluetooth }`: all three keys are always there (`defaultId` is null only for an
//     empty list, else one of the listed ids), the printers in the app's own order (a v2 select adds one last; a v1
//     select of a new printer puts it in the default's place, and of a listed one makes it the default where it is).
//     The page reads such a list as a v2 app with no printer yet.
// (These are the 2E review gate's ruling F-R2 and its review's M-4 and re-check, and the 2F1 review gate's M-3 and
// its review's wording of the v1 status and BUSY; Session 2F2 implements them and pins them.)
//   · Every other method (app.info, printer.list, permissions, bluetooth, host.background, app.changeUrl) stays v1.
//   · Phase 3 (spec §10; the page from Session 3B, the app from Session 3C): each listed printer may also carry `paper`
//     ("ok" | "low" | "out"), `cover` ("closed" | "open") and `error` (true), from DLE EOT where the printer answers it.
//     Absent says nothing (an app before 3C, a BLE printer); the page reports them in its wake's beat, and its dot.

export const NATIVE_BRIDGE_V2 = 2;

/** The methods a v2 envelope carries. */
export const NATIVE_V2_METHODS = ["printer.status", "printer.select", "printer.reconnect", "printer.forget", "printer.print"] as const;
export type NativeV2Method = (typeof NATIVE_V2_METHODS)[number];

/** What an app that speaks v2 adds to window.PosNative (Session 2F2). */
interface PosNativeV2Api extends PosNativeApi {
  readonly versions?: readonly number[];
  request(method: NativeMethod, params?: unknown, version?: number): Promise<unknown>;
  on(event: NativeEvent, fn: (data: unknown) => void, version?: number): () => void;
}

const poolSchema = z.object({
  printers: z.array(
    z.object({
      state: z.enum(NATIVE_PRINTER_STATES),
      printer: nativePrinterSchema,
      paper: z.enum(PRINTER_PAPER_STATES).optional(),
      cover: z.enum(PRINTER_COVER_STATES).optional(),
      error: z.boolean().optional(),
    }),
  ),
  defaultId: z.string().nullable(),
  bluetooth: z.enum(NATIVE_BLUETOOTH_STATES),
});

/** The app's printers (v2 `printer.status`, its event, and every printer.* answer but the print's). */
export type NativePoolStatus = z.infer<typeof poolSchema>;

const RESULT_SCHEMAS = {
  "printer.status": poolSchema,
  "printer.select": poolSchema,
  "printer.reconnect": poolSchema,
  "printer.forget": poolSchema,
  "printer.print": z.object({ bytes: z.number().int().nonnegative() }),
} as const satisfies Record<NativeV2Method, z.ZodTypeAny>;

export type NativeV2Result<M extends NativeV2Method> = z.infer<(typeof RESULT_SCHEMAS)[M]>;

const TIMEOUTS: Record<NativeV2Method, number> = {
  "printer.status": NATIVE_REQUEST_TIMEOUT_MS,
  "printer.select": NATIVE_CONNECT_TIMEOUT_MS,
  "printer.reconnect": NATIVE_CONNECT_TIMEOUT_MS,
  "printer.forget": NATIVE_CONNECT_TIMEOUT_MS,
  "printer.print": NATIVE_PRINT_TIMEOUT_MS,
};

const NO_BRIDGE_MESSAGE = "The POS app is not available.";
const NO_REPLY_MESSAGE = "The POS app did not answer.";
const BAD_REPLY_MESSAGE = "The POS app sent an answer this page does not understand.";
const FAILED_MESSAGE = "The POS app could not do that.";

/** The app's bridge when it speaks v2 (read at call time, never cached: a late bridge, as in v1); null otherwise. */
export function nativeV2Bridge(): PosNativeV2Api | null {
  const bridge = nativeBridge() as PosNativeV2Api | null;
  if (bridge === null || !Array.isArray(bridge.versions) || !bridge.versions.includes(NATIVE_BRIDGE_V2)) return null;
  return bridge;
}

export async function nativeV2Request<M extends NativeV2Method>(method: M, params?: unknown): Promise<NativeV2Result<M>> {
  const bridge = nativeV2Bridge();
  if (bridge === null) throw nativeError("UNSUPPORTED", NO_BRIDGE_MESSAGE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noReply = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(nativeError("TIMEOUT", NO_REPLY_MESSAGE)), TIMEOUTS[method]);
  });
  let raw: unknown;
  try {
    raw = await Promise.race([bridge.request(method, params, NATIVE_BRIDGE_V2), noReply]);
  } catch (error) {
    // As in v1: a coded rejection passes through; anything else gets this method's default code.
    throw nativeErrorCode(error) !== null ? error : nativeError(method === "printer.print" ? "WRITE_FAILED" : "UNSUPPORTED", FAILED_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  const parsed = RESULT_SCHEMAS[method].safeParse(raw);
  if (!parsed.success) throw nativeError("BAD_REQUEST", BAD_REPLY_MESSAGE);
  return parsed.data as unknown as NativeV2Result<M>;
}

/** The app's v2 `printer.status` event: the whole list after any printer changed. A payload that does not match is ignored. */
export function nativeV2OnStatus(fn: (status: NativePoolStatus) => void): () => void {
  const bridge = nativeV2Bridge();
  if (bridge === null) return () => undefined;
  return bridge.on(
    "printer.status",
    (data) => {
      const parsed = poolSchema.safeParse(data);
      if (parsed.success) fn(parsed.data);
    },
    NATIVE_BRIDGE_V2,
  );
}

export interface NativeV2Client {
  request: typeof nativeV2Request;
  onStatus: typeof nativeV2OnStatus;
}

export function nativeV2Client(): NativeV2Client | null {
  return nativeV2Bridge() === null ? null : { request: nativeV2Request, onStatus: nativeV2OnStatus };
}
