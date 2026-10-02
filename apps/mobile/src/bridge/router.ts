// The app side of the page bridge. Pure: no react-native import, so node:test
// can drive it with a recording fake port.
//
// Order (every drop in 1-5 is silent: no native call, no delivery):
//  1 raw size  2 posting-frame origin  3 JSON  4 shape  5 token
//  6 known method  7 params  8 native call  9 reply  10 app.changeUrl after reply

import { buildDeliverScript } from './injected';
import { NATIVE_ERROR_MESSAGES } from './messages';
import {
  BRIDGE_MESSAGE_MAX_CHARS,
  NATIVE_APP_ID,
  NATIVE_BRIDGE_VERSION,
  NATIVE_ERROR_CODES,
  NATIVE_METHODS,
  type BridgeReply,
  type NativeErrorCode,
  type NativeMethod,
  type NativePermissionKind,
  type NativePlatform,
  type NativePrinter,
  type PrinterStatus,
} from './protocol';
import { originOf } from '../url';
import { plainObject, validateParams } from './validate';

export { NATIVE_ERROR_MESSAGES };
export { validateParams };

export const MAX_REQUEST_ID_CHARS = 64;

export interface NativePort {
  appInfo(): Promise<{
    appVersion: string;
    platform: NativePlatform;
    transports: string[];
  }>;
  getStatus(): Promise<PrinterStatus>;
  listPrinters(scan: boolean): Promise<{ printers: NativePrinter[] }>;
  selectPrinter(id: string): Promise<PrinterStatus>;
  selectTcp(host: string, port: number): Promise<PrinterStatus>;
  reconnect(): Promise<PrinterStatus>;
  forget(): Promise<PrinterStatus>;
  print(base64: string): Promise<{ bytes: number }>;
  requestPermission(kind: NativePermissionKind): Promise<boolean>;
  enableBluetooth(): Promise<{ on: boolean }>;
  setHostActive(active: boolean, label: string): Promise<{ active: boolean }>;
}

export type RouterDeps = {
  port: NativePort;
  token: string;
  // The saved POS origin; only a page that posts from it is listened to.
  origin: string;
  // Hands a finished script to the native side (evaluateJavascript).
  deliver: (script: string) => void | Promise<unknown>;
  onChangeUrl: () => void;
};

export type Router = { handle(raw: unknown, frameUrl: unknown): Promise<void> };

function errorCodeOf(error: unknown, method: NativeMethod): NativeErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (
    typeof code === 'string' &&
    (NATIVE_ERROR_CODES as readonly string[]).includes(code)
  ) {
    return code as NativeErrorCode;
  }
  return method === 'printer.print' ? 'WRITE_FAILED' : 'UNSUPPORTED';
}

async function callPort(
  port: NativePort,
  method: NativeMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'app.info': {
      const info = await port.appInfo();
      return {
        app: NATIVE_APP_ID,
        appVersion: info.appVersion,
        platform: info.platform,
        transports: info.transports,
      };
    }
    case 'printer.status':
      return port.getStatus();
    case 'printer.list': {
      const { printers } = await port.listPrinters(params.scan === true);
      return { printers };
    }
    case 'printer.select':
      return typeof params.id === 'string'
        ? port.selectPrinter(params.id)
        : port.selectTcp(params.host as string, params.port as number);
    case 'printer.reconnect':
      return port.reconnect();
    case 'printer.forget':
      return port.forget();
    case 'printer.print': {
      const { bytes } = await port.print(params.data as string);
      return { bytes };
    }
    case 'permissions.request':
      return {
        granted: await port.requestPermission(
          params.kind as NativePermissionKind,
        ),
      };
    case 'bluetooth.enable': {
      const { on } = await port.enableBluetooth();
      return { on };
    }
    case 'host.background': {
      const { active } = await port.setHostActive(
        params.active as boolean,
        params.label as string,
      );
      return { active };
    }
    default:
      return null; // app.changeUrl: the router itself acts after the reply
  }
}

function isRequestShape(msg: Record<string, unknown>): msg is {
  v: 1;
  id: string;
  method: string;
  token?: unknown;
  params?: unknown;
} {
  return (
    msg.v === NATIVE_BRIDGE_VERSION &&
    typeof msg.id === 'string' &&
    msg.id.length > 0 &&
    msg.id.length <= MAX_REQUEST_ID_CHARS &&
    typeof msg.method === 'string'
  );
}

// Compares without bailing at the first differing character.
function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) {
    return false;
  }
  let mismatches = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatches += given.charCodeAt(i) === expected.charCodeAt(i) ? 0 : 1;
  }
  return mismatches === 0;
}

function parseMessage(raw: string): Record<string, unknown> | null {
  try {
    return plainObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function createRouter(deps: RouterDeps): Router {
  async function send(reply: BridgeReply): Promise<void> {
    try {
      await deps.deliver(buildDeliverScript(reply));
    } catch {
      // the page may already be gone; nothing useful to do
    }
  }

  function failure(id: string, code: NativeErrorCode): BridgeReply {
    return {
      v: 1,
      id,
      ok: false,
      error: { code, message: NATIVE_ERROR_MESSAGES[code] },
    };
  }

  async function handle(raw: unknown, frameUrl: unknown): Promise<void> {
    if (typeof raw !== 'string' || raw.length > BRIDGE_MESSAGE_MAX_CHARS) {
      return;
    }
    if (typeof frameUrl !== 'string' || originOf(frameUrl) !== deps.origin) {
      return;
    }
    const msg = parseMessage(raw);
    if (
      msg === null ||
      !isRequestShape(msg) ||
      !sameToken(msg.token, deps.token)
    ) {
      return;
    }
    const { id } = msg;
    if (!(NATIVE_METHODS as readonly string[]).includes(msg.method)) {
      await send(failure(id, 'BAD_REQUEST'));
      return;
    }
    const method = msg.method as NativeMethod;
    const checked = validateParams(method, msg.params);
    if (!checked.ok) {
      await send(failure(id, checked.code));
      return;
    }
    let reply: BridgeReply;
    try {
      const result = await callPort(deps.port, method, checked.params);
      reply = { v: 1, id, ok: true, result };
    } catch (error) {
      reply = failure(id, errorCodeOf(error, method));
    }
    await send(reply);
    if (method === 'app.changeUrl' && reply.ok) {
      deps.onChangeUrl();
    }
  }

  return { handle };
}
