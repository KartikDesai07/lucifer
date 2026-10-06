// Per-method parameter checks for the page bridge. Pure: no react-native.
// Anything unexpected (extra keys, wrong types, bad shapes) is BAD_REQUEST.

import {
  NATIVE_PERMISSION_KINDS,
  PRINT_DATA_MAX_BASE64_CHARS,
  type NativeMethod,
} from './protocol';
import type { V2Method } from './protocol-v2';
import { MAX_PORT, MIN_PORT, isValidHost } from '../url';

export const MAX_PRINTER_ID_CHARS = 200;
export const MAX_HOST_LABEL_CHARS = 80;

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_QUANTUM = 4;

export type Validated =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; code: 'BAD_REQUEST' | 'TOO_LARGE' };

const BAD: Validated = { ok: false, code: 'BAD_REQUEST' };
const own = (o: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key);

export function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

// Accepts exactly the keys listed; anything else is a bad request.
function onlyKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(obj).every(key => allowed.includes(key));
}

function validateSelect(obj: Record<string, unknown>): Validated {
  if (!onlyKeys(obj, ['id', 'tcp'])) {
    return BAD;
  }
  const hasId = own(obj, 'id');
  const hasTcp = own(obj, 'tcp');
  if (hasId === hasTcp) {
    return BAD;
  }
  if (hasId) {
    const id = obj.id;
    const ok =
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= MAX_PRINTER_ID_CHARS;
    return ok ? { ok: true, params: { id } } : BAD;
  }
  const tcp = plainObject(obj.tcp);
  if (tcp === null || !onlyKeys(tcp, ['host', 'port'])) {
    return BAD;
  }
  const { host, port } = tcp;
  const hostOk = typeof host === 'string' && isValidHost(host.toLowerCase());
  const portOk =
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= MIN_PORT &&
    port <= MAX_PORT;
  return hostOk && portOk
    ? { ok: true, params: { host: (host as string).toLowerCase(), port } }
    : BAD;
}

function validatePrint(obj: Record<string, unknown>): Validated {
  const data = obj.data;
  if (!onlyKeys(obj, ['data']) || typeof data !== 'string') {
    return BAD;
  }
  if (data.length > PRINT_DATA_MAX_BASE64_CHARS) {
    return { ok: false, code: 'TOO_LARGE' };
  }
  const shapeOk = data.length % BASE64_QUANTUM === 0 && BASE64_BODY.test(data);
  return shapeOk ? { ok: true, params: { data } } : BAD;
}

function validPrinterId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_PRINTER_ID_CHARS;
}

// Phase 2 Session 2F2 (spec §9.2): bridge v2's printer methods name their
// printer by the app's id; select takes { id } or { tcp } exactly as v1.
export function validateV2Params(
  method: V2Method,
  params: unknown,
): Validated {
  const obj =
    params === undefined || params === null ? {} : plainObject(params);
  if (obj === null) {
    return BAD;
  }
  switch (method) {
    case 'printer.select':
      return validateSelect(obj);
    case 'printer.reconnect':
    case 'printer.forget':
      return onlyKeys(obj, ['printerId']) && validPrinterId(obj.printerId)
        ? { ok: true, params: { printerId: obj.printerId } }
        : BAD;
    case 'printer.print': {
      if (!onlyKeys(obj, ['printerId', 'data']) || !validPrinterId(obj.printerId)) {
        return BAD;
      }
      const checked = validatePrint({ data: obj.data });
      return checked.ok
        ? { ok: true, params: { printerId: obj.printerId, data: checked.params.data } }
        : checked;
    }
    default:
      return Object.keys(obj).length === 0 ? { ok: true, params: {} } : BAD;
  }
}

export function validateParams(
  method: NativeMethod,
  params: unknown,
): Validated {
  const obj =
    params === undefined || params === null ? {} : plainObject(params);
  if (obj === null) {
    return BAD;
  }
  switch (method) {
    case 'printer.list': {
      if (!onlyKeys(obj, ['scan'])) {
        return BAD;
      }
      const scan = obj.scan;
      return scan === undefined || typeof scan === 'boolean'
        ? { ok: true, params: { scan: scan === true } }
        : BAD;
    }
    case 'printer.select':
      return validateSelect(obj);
    case 'printer.print':
      return validatePrint(obj);
    case 'permissions.request': {
      const kind = obj.kind;
      const ok =
        onlyKeys(obj, ['kind']) &&
        typeof kind === 'string' &&
        (NATIVE_PERMISSION_KINDS as readonly string[]).includes(kind);
      return ok ? { ok: true, params: { kind } } : BAD;
    }
    case 'host.background': {
      const { active, label } = obj;
      const ok =
        onlyKeys(obj, ['active', 'label']) &&
        typeof active === 'boolean' &&
        (label === undefined ||
          (typeof label === 'string' && label.length <= MAX_HOST_LABEL_CHARS));
      return ok
        ? {
            ok: true,
            params: { active, label: label === undefined ? '' : label },
          }
        : BAD;
    }
    default:
      return Object.keys(obj).length === 0 ? { ok: true, params: {} } : BAD;
  }
}
