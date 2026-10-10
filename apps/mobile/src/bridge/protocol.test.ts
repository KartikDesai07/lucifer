/// <reference types="node" />
// Pins for src/bridge/protocol.ts against the design's section 9 oracle.
// The cafe parity test (apps/cafe/lib/printer/native-bridge-protocol-parity.test.ts)
// diffs this file against the web copy with the same parsing rules as below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as protocol from './protocol';

const SOURCE = readFileSync(join(__dirname, 'protocol.ts'), 'utf8');

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const CODE = stripComments(SOURCE);

const LISTS: Record<string, string[]> = {
  NATIVE_METHODS: [
    'app.info',
    'printer.status',
    'printer.list',
    'printer.select',
    'printer.reconnect',
    'printer.forget',
    'printer.print',
    'permissions.request',
    'bluetooth.enable',
    'host.background',
    'app.changeUrl',
    'app.battery',
  ],
  NATIVE_EVENTS: ['printer.status', 'app.wake'],
  NATIVE_TRANSPORTS: ['bt-classic', 'ble', 'tcp', 'usb'],
  NATIVE_PRINTER_STATES: ['none', 'connecting', 'connected', 'disconnected'],
  NATIVE_BLUETOOTH_STATES: ['on', 'off', 'unauthorized', 'unsupported'],
  NATIVE_ERROR_CODES: [
    'NOT_CONNECTED',
    'WRITE_FAILED',
    'TOO_LARGE',
    'BUSY',
    'TIMEOUT',
    'UNAUTHORIZED',
    'BLUETOOTH_OFF',
    'UNSUPPORTED',
    'BAD_REQUEST',
    'LOCATION_OFF',
  ],
  NATIVE_PERMISSION_KINDS: ['bluetooth', 'notifications'],
  NATIVE_PLATFORMS: ['android', 'ios'],
  NATIVE_FEATURES: ['battery'],
};

const SCALARS: Record<string, string | number> = {
  NATIVE_BRIDGE_VERSION: 1,
  PRINTER_SCAN_MS: 8000,
  PRINT_DATA_MAX_BASE64_CHARS: 2000000,
  BRIDGE_MESSAGE_MAX_CHARS: 2100000,
  NATIVE_APP_ID: 'pos-mobile',
  NATIVE_GLOBAL: 'PosNative',
  NATIVE_DELIVER_FN: '__posNativeDeliver',
};

// Needles are built by concatenation so this file never matches itself.
function declarationCount(name: string): number {
  return CODE.split('export const ' + name + ' ').length - 1;
}

// Reads the string literals of `export const NAME = [ ... ] as const;`.
function parseList(name: string): string[] {
  const start = CODE.indexOf('export const ' + name + ' = [');
  assert.notEqual(start, -1, name + ' declaration missing');
  const end = CODE.indexOf('] as const;', start);
  assert.notEqual(end, -1, name + ' terminator missing');
  const body = CODE.slice(CODE.indexOf('[', start) + 1, end);
  const literals = body.match(/'[^']*'|"[^"]*"/g) ?? [];
  return literals.map(lit => lit.slice(1, -1));
}

test('every list equals the section 9 oracle, order included', () => {
  for (const name of Object.keys(LISTS)) {
    assert.deepEqual(parseList(name), LISTS[name], name + ' (source)');
    const live = (protocol as Record<string, unknown>)[name];
    assert.deepEqual(live, LISTS[name], name + ' (runtime)');
  }
});

test('lists are non-empty, unique, and declared exactly once', () => {
  // Phase 3 Session 3D deliberately changed: + NATIVE_FEATURES.
  assert.equal(Object.keys(LISTS).length, 9);
  for (const name of Object.keys(LISTS)) {
    const values = parseList(name);
    assert.ok(values.length > 0, name + ' is empty');
    assert.equal(new Set(values).size, values.length, name + ' has duplicates');
    assert.equal(declarationCount(name), 1, name + ' declared once');
  }
});

test('each list has its derived type', () => {
  for (const name of Object.keys(LISTS)) {
    assert.ok(
      CODE.includes('(typeof ' + name + ')[number]'),
      name + ' derived type missing',
    );
  }
});

test('scalars have the contract values and are declared once', () => {
  for (const name of Object.keys(SCALARS)) {
    assert.equal(declarationCount(name), 1, name + ' declared once');
    assert.equal(
      (protocol as Record<string, unknown>)[name],
      SCALARS[name],
      name,
    );
  }
});

test('large scalars use numeric separators, as the web copy does', () => {
  assert.ok(CODE.includes('PRINTER_SCAN_MS = 8_000;'));
  assert.ok(CODE.includes('PRINT_DATA_MAX_BASE64_CHARS = 2_000_000;'));
  assert.ok(CODE.includes('BRIDGE_MESSAGE_MAX_CHARS = 2_100_000;'));
});

test('the print cap sits below the message cap (room for the envelope)', () => {
  assert.ok(
    protocol.PRINT_DATA_MAX_BASE64_CHARS < protocol.BRIDGE_MESSAGE_MAX_CHARS,
  );
});

test('single-quoted literals only (prettier style the parity parser also reads)', () => {
  for (const name of Object.keys(LISTS)) {
    const start = CODE.indexOf('export const ' + name + ' = [');
    const end = CODE.indexOf('] as const;', start);
    assert.ok(
      !CODE.slice(start, end).includes('"'),
      name + ' has a double quote',
    );
  }
});
