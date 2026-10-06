import { z } from "zod";

import {
  NATIVE_BLUETOOTH_STATES,
  NATIVE_BRIDGE_VERSION,
  NATIVE_ERROR_CODES,
  NATIVE_PLATFORMS,
  NATIVE_PRINTER_STATES,
  NATIVE_TRANSPORTS,
  NATIVE_APP_ID,
  PRINTER_SCAN_MS,
  type NativeErrorCode,
  type NativeEvent,
  type NativeMethod,
  type PosNativeApi,
} from "@/lib/printer/native-bridge-protocol";

// The page-side half of the POS app bridge. NOTHING here caches the bridge:
// on an old WebView `window.PosNative` can appear AFTER the page's first
// scripts, so every call reads it fresh and the app announces a late arrival
// with the window event below.
export const NATIVE_READY_EVENT = "posnative:ready";

export const NATIVE_REQUEST_TIMEOUT_MS = 10_000; // info, status, host.background, app.changeUrl
// Longer than the app's own worst connect work: Classic pairing takes up to 30 s
// and its insecure retry runs another 30 s (2 x 30 s), and a USB permission
// prompt waits up to 60 s. A parity pin reads the Kotlin constants.
export const NATIVE_CONNECT_TIMEOUT_MS = 75_000; // select, reconnect, forget
export const NATIVE_PROMPT_TIMEOUT_MS = 60_000; // permissions.request, bluetooth.enable
export const NATIVE_SCAN_TIMEOUT_MS = PRINTER_SCAN_MS + NATIVE_REQUEST_TIMEOUT_MS;
// Above the app's own 60 s print limit, below the device write deadline.
export const NATIVE_PRINT_TIMEOUT_MS = 65_000;

const BASE64_SLICE_BYTES = 0x8000;

const NO_BRIDGE_MESSAGE = "The POS app is not available.";
const NO_REPLY_MESSAGE = "The POS app did not answer.";
const BAD_REPLY_MESSAGE = "The POS app sent an answer this page does not understand.";
const FAILED_MESSAGE = "The POS app could not do that.";

const printerSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(NATIVE_TRANSPORTS),
  address: z.string().nullish().transform((v) => v ?? undefined),
  paired: z.boolean().nullish().transform((v) => v ?? undefined),
});
/** Phase 2 Session 2F1: bridge v2 (native-bridge-v2.ts) reads the app's printers with the same shape. */
export const nativePrinterSchema = printerSchema;
const statusSchema = z.object({
  state: z.enum(NATIVE_PRINTER_STATES),
  printer: printerSchema.nullable(),
  bluetooth: z.enum(NATIVE_BLUETOOTH_STATES),
});

const RESULT_SCHEMAS = {
  "app.info": z.object({
    app: z.literal(NATIVE_APP_ID),
    appVersion: z.string(),
    platform: z.enum(NATIVE_PLATFORMS),
    transports: z.array(z.enum(NATIVE_TRANSPORTS)),
  }),
  "printer.status": statusSchema,
  "printer.list": z.object({ printers: z.array(printerSchema) }),
  "printer.select": statusSchema,
  "printer.reconnect": statusSchema,
  "printer.forget": statusSchema,
  "printer.print": z.object({ bytes: z.number().int().nonnegative() }),
  "permissions.request": z.object({ granted: z.boolean() }),
  "bluetooth.enable": z.object({ on: z.boolean() }),
  "host.background": z.object({ active: z.boolean() }),
  // Fire-and-forget: the app may answer with anything (or navigate away).
  "app.changeUrl": z.unknown(),
} as const satisfies Record<NativeMethod, z.ZodTypeAny>;

const EVENT_SCHEMAS = {
  "printer.status": statusSchema,
  "app.wake": z.object({}).passthrough(),
} as const satisfies Record<NativeEvent, z.ZodTypeAny>;

export type NativeResult<M extends NativeMethod> = z.infer<(typeof RESULT_SCHEMAS)[M]>;
export type NativeEventData<E extends NativeEvent> = z.infer<(typeof EVENT_SCHEMAS)[E]>;

const TIMEOUT_BY_METHOD: Record<NativeMethod, number> = {
  "app.info": NATIVE_REQUEST_TIMEOUT_MS,
  "printer.status": NATIVE_REQUEST_TIMEOUT_MS,
  "printer.list": NATIVE_REQUEST_TIMEOUT_MS,
  "printer.select": NATIVE_CONNECT_TIMEOUT_MS,
  "printer.reconnect": NATIVE_CONNECT_TIMEOUT_MS,
  "printer.forget": NATIVE_CONNECT_TIMEOUT_MS,
  "printer.print": NATIVE_PRINT_TIMEOUT_MS,
  "permissions.request": NATIVE_PROMPT_TIMEOUT_MS,
  "bluetooth.enable": NATIVE_PROMPT_TIMEOUT_MS,
  "host.background": NATIVE_REQUEST_TIMEOUT_MS,
  "app.changeUrl": NATIVE_REQUEST_TIMEOUT_MS,
};

function timeoutOf(method: NativeMethod, params: unknown): number {
  const scanning = method === "printer.list" && typeof params === "object" && params !== null && (params as { scan?: unknown }).scan === true;
  return scanning ? NATIVE_SCAN_TIMEOUT_MS : TIMEOUT_BY_METHOD[method];
}

// A rejected native request is an Error carrying a `code` from the shared list.
export function nativeError(code: NativeErrorCode, message: string): Error & { code: NativeErrorCode } {
  return Object.assign(new Error(message), { code });
}

export function nativeErrorCode(error: unknown): NativeErrorCode | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && (NATIVE_ERROR_CODES as readonly string[]).includes(code) ? (code as NativeErrorCode) : null;
}

// Read at CALL time, never cached (late bridge). Usable only when it speaks
// this protocol version and has both functions.
export function nativeBridge(): PosNativeApi | null {
  if (typeof window === "undefined") return null;
  const bridge = window.PosNative;
  if (!bridge || bridge.version !== NATIVE_BRIDGE_VERSION) return null;
  if (typeof bridge.request !== "function" || typeof bridge.on !== "function") return null;
  return bridge;
}

export async function nativeRequest<M extends NativeMethod>(method: M, params?: unknown): Promise<NativeResult<M>> {
  const bridge = nativeBridge();
  if (bridge === null) throw nativeError("UNSUPPORTED", NO_BRIDGE_MESSAGE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noReply = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(nativeError("TIMEOUT", NO_REPLY_MESSAGE)), timeoutOf(method, params));
  });
  let raw: unknown;
  try {
    raw = await Promise.race([bridge.request(method, params), noReply]);
  } catch (error) {
    // A coded rejection passes through; anything else gets this method's
    // default code. The app's own text is never forwarded to the operator.
    throw nativeErrorCode(error) !== null ? error : nativeError(method === "printer.print" ? "WRITE_FAILED" : "UNSUPPORTED", FAILED_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  const parsed = RESULT_SCHEMAS[method].safeParse(raw);
  if (!parsed.success) throw nativeError("BAD_REQUEST", BAD_REPLY_MESSAGE);
  return parsed.data as unknown as NativeResult<M>;
}

// Subscribes to an app event; a payload that does not match is ignored.
export function nativeOn<E extends NativeEvent>(event: E, fn: (data: NativeEventData<E>) => void): () => void {
  const bridge = nativeBridge();
  if (bridge === null) return () => undefined;
  return bridge.on(event, (data) => {
    const parsed = EVENT_SCHEMAS[event].safeParse(data);
    if (parsed.success) fn(parsed.data as unknown as NativeEventData<E>);
  });
}

export interface NativeClient {
  request: typeof nativeRequest;
  on: typeof nativeOn;
}

export function nativeClient(): NativeClient | null {
  return nativeBridge() === null ? null : { request: nativeRequest, on: nativeOn };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_SLICE_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_SLICE_BYTES));
  }
  return btoa(binary);
}
