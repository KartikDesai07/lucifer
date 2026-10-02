// The script that creates window.PosNative inside the POS page, and the script
// that delivers a reply or event to it. Pure strings: no react-native import.
// The injected source contains no backslashes on purpose (nothing to unescape).

import { NATIVE_ERROR_MESSAGES } from './messages';
import {
  BRIDGE_MESSAGE_MAX_CHARS,
  NATIVE_BRIDGE_VERSION,
  NATIVE_DELIVER_FN,
  NATIVE_GLOBAL,
  type DeliverMessage,
  type NativePlatform,
} from './protocol';

export const NATIVE_READY_EVENT = 'posnative:ready';

// Characters that can end or confuse an inline <script>/JS string literal.
// Built from char codes so no raw U+2028/U+2029 ever sits in this source file.
const UNSAFE_IN_SCRIPT = new RegExp(
  '[' + String.fromCharCode(0x2028, 0x2029) + '<>&]',
  'g',
);
const HEX_RADIX = 16;
const HEX_WIDTH = 4;
// Request ids are "r" + a per-load random nonce + "-" + a counter. Every page
// load injects a fresh script whose counter restarts at 1, so without the nonce
// a late reply to the OLD load's "r1" would settle the NEW load's first request.
// 1 + 2 * NONCE_BYTES + 1 + counter digits stays far below the router's 64.
export const NONCE_BYTES = 16;
const BYTE_RANGE = 256;

export function safeJsonForScript(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json.replace(
    UNSAFE_IN_SCRIPT,
    ch =>
      String.fromCharCode(0x5c) +
      'u' +
      ch.charCodeAt(0).toString(HEX_RADIX).padStart(HEX_WIDTH, '0'),
  );
}

export function buildDeliverScript(message: DeliverMessage): string {
  return (
    'window.' + NATIVE_DELIVER_FN + '(' + safeJsonForScript(message) + ');true;'
  );
}

type InjectedOptions = { token: string; platform: NativePlatform };

export function buildInjectedScript({
  token,
  platform,
}: InjectedOptions): string {
  const lines = [
    '(function () {',
    "'use strict';",
    'var NAME = ' + safeJsonForScript(NATIVE_GLOBAL) + ';',
    'var DELIVER = ' + safeJsonForScript(NATIVE_DELIVER_FN) + ';',
    'if (window[NAME]) { return; }',
    'var TOKEN = ' + safeJsonForScript(token) + ';',
    'var PLATFORM = ' + safeJsonForScript(platform) + ';',
    'var VERSION = ' + NATIVE_BRIDGE_VERSION + ';',
    'var MAX_CHARS = ' + BRIDGE_MESSAGE_MAX_CHARS + ';',
    'var MSG_TOO_LARGE = ' +
      safeJsonForScript(NATIVE_ERROR_MESSAGES.TOO_LARGE) +
      ';',
    'var MSG_UNSUPPORTED = ' +
      safeJsonForScript(NATIVE_ERROR_MESSAGES.UNSUPPORTED) +
      ';',
    'var MSG_BAD_REQUEST = ' +
      safeJsonForScript(NATIVE_ERROR_MESSAGES.BAD_REQUEST) +
      ';',
    'var pending = new Map();',
    'var listeners = new Map();',
    'function makeNonce() {',
    '  var bytes = new Uint8Array(' + NONCE_BYTES + ');',
    '  try { window.crypto.getRandomValues(bytes); } catch (e) {',
    '    for (var i = 0; i < bytes.length; i += 1) { bytes[i] = Math.floor(Math.random() * ' +
      BYTE_RANGE +
      '); }',
    '  }',
    "  var hex = '';",
    '  for (var j = 0; j < bytes.length; j += 1) { hex += ("0" + bytes[j].toString(16)).slice(-2); }',
    '  return hex;',
    '}',
    'var NONCE = makeNonce();',
    'var seq = 0;',
    'function fail(message, code) { return Object.assign(new Error(message), { code: code }); }',
    'function request(method, params) {',
    '  return new Promise(function (resolve, reject) {',
    '    var bridge = window.ReactNativeWebView;',
    "    if (!bridge || typeof bridge.postMessage !== 'function') {",
    "      reject(fail(MSG_UNSUPPORTED, 'UNSUPPORTED'));",
    '      return;',
    '    }',
    '    var id = "r" + NONCE + "-" + (seq += 1);',
    '    var text;',
    '    try {',
    '      text = JSON.stringify({ v: VERSION, token: TOKEN, id: id, method: String(method), params: params });',
    '    } catch (e) {',
    "      reject(fail(MSG_BAD_REQUEST, 'BAD_REQUEST'));",
    '      return;',
    '    }',
    '    if (typeof text !== "string" || text.length > MAX_CHARS) {',
    "      reject(fail(MSG_TOO_LARGE, 'TOO_LARGE'));",
    '      return;',
    '    }',
    '    pending.set(id, { resolve: resolve, reject: reject });',
    '    try {',
    '      bridge.postMessage(text);',
    '    } catch (e) {',
    '      pending.delete(id);',
    "      reject(fail(MSG_UNSUPPORTED, 'UNSUPPORTED'));",
    '    }',
    '  });',
    '}',
    'function on(event, fn) {',
    "  if (typeof event !== 'string' || typeof fn !== 'function') { return function () {}; }",
    '  var set = listeners.get(event);',
    '  if (!set) { set = new Set(); listeners.set(event, set); }',
    '  var entry = { fn: fn };',
    '  set.add(entry);',
    '  return function () { set.delete(entry); };',
    '}',
    'function deliver(message) {',
    '  if (!message || message.v !== VERSION) { return; }',
    "  if (typeof message.event === 'string') {",
    '    var set = listeners.get(message.event);',
    '    if (!set) { return; }',
    '    Array.from(set).forEach(function (entry) {',
    '      try { entry.fn(message.data); } catch (e) { /* one listener never breaks another */ }',
    '    });',
    '    return;',
    '  }',
    "  if (typeof message.id !== 'string') { return; }",
    '  var waiter = pending.get(message.id);',
    '  if (!waiter) { return; }',
    '  pending.delete(message.id);',
    '  if (message.ok === true) { waiter.resolve(message.result); return; }',
    '  var error = message.error || {};',
    "  waiter.reject(fail(String(error.message || MSG_UNSUPPORTED), String(error.code || 'UNSUPPORTED')));",
    '}',
    'var api = Object.freeze({ version: VERSION, platform: PLATFORM, request: request, on: on });',
    'Object.defineProperty(window, DELIVER, { value: deliver, writable: false, configurable: false });',
    'Object.defineProperty(window, NAME, { value: api, writable: false, configurable: false });',
    "try { window.dispatchEvent(new Event('" +
      NATIVE_READY_EVENT +
      "')); } catch (e) { /* ready signal is best effort */ }",
    '})();',
    'true;',
  ];
  return lines.join('\n');
}
