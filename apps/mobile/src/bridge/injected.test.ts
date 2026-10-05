/// <reference types="node" />
// Runs the injected script inside a fake window (node:vm) and pins the page-side contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import {
  NATIVE_READY_EVENT,
  buildDeliverScript,
  buildInjectedScript,
  safeJsonForScript,
} from './injected';
import { NATIVE_ERROR_MESSAGES } from './messages';

const TOKEN = 'a1'.repeat(32);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NONCE_BYTES = 16;
const FIXED_BYTE = 0xab;
const MAX_ID_CHARS = 64;

// A WebView crypto whose "random" bytes are fixed, so request ids are known.
const FIXED_CRYPTO = {
  getRandomValues: (a: Uint8Array) => {
    a.fill(FIXED_BYTE);
    return a;
  },
};
// The id of the n-th request of a load with FIXED_CRYPTO.
const idOf = (n: number) =>
  'r' + FIXED_BYTE.toString(16).repeat(NONCE_BYTES) + '-' + n;

type Fake = {
  ctx: vm.Context;
  posted: string[];
  events: { type: string; hadApi: boolean }[];
  run: (code: string) => unknown;
  inject: (token?: string) => void;
  plain: (code: string) => unknown;
};

// withBridge=false leaves window.ReactNativeWebView undefined (the injection
// may run before react-native-webview adds it). webCrypto=null models a
// WebView without window.crypto.
function fakeWindow(
  withBridge = true,
  webCrypto: {
    getRandomValues: (a: Uint8Array) => Uint8Array;
  } | null = webcrypto,
): Fake {
  const posted: string[] = [];
  const events: { type: string; hadApi: boolean }[] = [];
  const sandbox: Record<string, unknown> = {
    Event: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    dispatchEvent: (event: { type: string }) => {
      const api = vm.runInContext('typeof window.PosNative', ctx);
      events.push({ type: event.type, hadApi: api === 'object' });
      return true;
    },
  };
  if (webCrypto !== null) {
    sandbox.crypto = webCrypto;
  }
  if (withBridge) {
    sandbox.ReactNativeWebView = { postMessage: (m: string) => posted.push(m) };
  }
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', ctx);
  const run = (code: string) => vm.runInContext(code, ctx);
  // Results cross the realm boundary as JSON so deepEqual compares plain data.
  const plain = (code: string) =>
    JSON.parse(String(run('JSON.stringify(' + code + ')')));
  const inject = (token = TOKEN) =>
    run(buildInjectedScript({ token, platform: 'android' }));
  return { ctx, posted, events, run, inject, plain };
}

function lastPosted(f: Fake): {
  v: number;
  token: string;
  id: string;
  method: string;
  params?: unknown;
} {
  return JSON.parse(f.posted[f.posted.length - 1]);
}

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

test('PosNative is frozen, non-writable, non-configurable; platform and version set', () => {
  const f = fakeWindow();
  f.inject();
  assert.equal(f.run('Object.isFrozen(window.PosNative)'), true);
  assert.deepEqual(
    f.plain('Object.getOwnPropertyDescriptor(window, "PosNative")'),
    {
      writable: false,
      enumerable: false,
      configurable: false,
      value: { version: 1, versions: [1, 2], platform: 'android' },
    },
  );
  const deliverDesc = f.plain(
    'Object.getOwnPropertyDescriptor(window, "__posNativeDeliver")',
  ) as Record<string, unknown>;
  assert.equal(deliverDesc.writable, false);
  assert.equal(deliverDesc.configurable, false);
  assert.equal(
    f.run('window.PosNative = 1; typeof window.PosNative'),
    'object',
  );
  assert.equal(
    f.run('window.__posNativeDeliver = 1; typeof window.__posNativeDeliver'),
    'function',
  );
  assert.equal(f.run('delete window.PosNative'), false);
  assert.equal(
    f.run('window.PosNative.request = 1; typeof window.PosNative.request'),
    'function',
  );
  assert.equal(f.run('PosNative.version'), 1);
  assert.equal(f.run('PosNative.platform'), 'android');
});

test('the token is not reachable from the page', () => {
  const f = fakeWindow();
  f.inject();
  assert.equal(
    f.run('Object.keys(window.PosNative).join(",")'),
    'version,versions,platform,request,on',
  );
  assert.ok(!String(f.run('JSON.stringify(window.PosNative)')).includes(TOKEN));
  assert.ok(!String(f.run('String(window.PosNative.request)')).includes(TOKEN));
  assert.ok(!String(f.run('String(window.PosNative.on)')).includes(TOKEN));
  assert.ok(
    !String(f.run('String(window.__posNativeDeliver)')).includes(TOKEN),
  );
  assert.ok(
    !String(f.run('Object.getOwnPropertyNames(window).join(",")')).includes(
      TOKEN,
    ),
  );
});

test('request posts {v, token, id, method, params} through ReactNativeWebView', () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  f.run('window.PosNative.request("printer.list", { scan: true })');
  assert.equal(f.posted.length, 1);
  assert.deepEqual(lastPosted(f), {
    v: 1,
    token: TOKEN,
    id: idOf(1),
    method: 'printer.list',
    params: { scan: true },
  });
  f.run('window.PosNative.request("printer.status")');
  assert.deepEqual(lastPosted(f), {
    v: 1,
    token: TOKEN,
    id: idOf(2),
    method: 'printer.status',
  });
});

test('a token with quotes and a script end tag stays a plain string', () => {
  const f = fakeWindow();
  const hostile = '"; window.pwned = 1; //</script>' + LS;
  f.inject(hostile);
  f.run('window.PosNative.request("app.info")');
  assert.equal(lastPosted(f).token, hostile);
  assert.equal(f.run('typeof window.pwned'), 'undefined');
});

test('ok replies resolve, error replies reject with code and message', async () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  f.run(
    'globalThis.out = []; window.PosNative.request("printer.status").then(r => out.push(["ok", r]), e => out.push(["err", e.code, e.message]));',
  );
  f.run(
    'window.__posNativeDeliver({ v: 1, id: "' +
      idOf(1) +
      '", ok: true, result: { state: "none" } })',
  );
  f.run(
    'window.PosNative.request("printer.print", { data: "AAAA" }).then(r => out.push(["ok", r]), e => out.push(["err", e.code, e.message, e instanceof Error]));',
  );
  f.run(
    'window.__posNativeDeliver({ v: 1, id: "' +
      idOf(2) +
      '", ok: false, error: { code: "BUSY", message: "Busy now." } })',
  );
  await settle();
  assert.deepEqual(f.plain('out'), [
    ['ok', { state: 'none' }],
    ['err', 'BUSY', 'Busy now.', true],
  ]);
});

test('unknown ids, wrong versions and junk are ignored; a reply settles once', async () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  f.run(
    'globalThis.out = []; window.PosNative.request("app.info").then(r => out.push(r), e => out.push("err"));',
  );
  const reply = (id: string, v: number, result: number) =>
    'window.__posNativeDeliver({ v: ' +
    v +
    ', id: "' +
    id +
    '", ok: true, result: ' +
    result +
    ' })';
  f.run(reply(idOf(99), 1, 1));
  f.run(reply(idOf(1), 2, 2));
  f.run(
    'window.__posNativeDeliver(null); window.__posNativeDeliver("x"); window.__posNativeDeliver({ v: 1 })',
  );
  await settle();
  assert.deepEqual(f.plain('out'), []);
  f.run(reply(idOf(1), 1, 3));
  f.run(reply(idOf(1), 1, 4));
  await settle();
  assert.deepEqual(f.plain('out'), [3]);
});

test('a reply addressed to the previous load never resolves the next load', async () => {
  // Two page loads in one WebView session: each injects a fresh script.
  const first = fakeWindow();
  first.inject();
  first.run('window.PosNative.request("printer.status")');
  const staleId = lastPosted(first).id;
  const second = fakeWindow();
  second.inject();
  second.run(
    'globalThis.out = []; window.PosNative.request("printer.status").then(r => out.push(["ok", r]), e => out.push(["err", e.code]));',
  );
  const freshId = lastPosted(second).id;
  assert.notEqual(staleId, freshId, 'ids differ between loads');
  // The stale reply (native finished the OLD load's request late) arrives now.
  second.run(
    'window.__posNativeDeliver({ v: 1, id: "' +
      staleId +
      '", ok: true, result: "stale" })',
  );
  await settle();
  assert.deepEqual(second.plain('out'), [], 'stale reply must not resolve');
  second.run(
    'window.__posNativeDeliver({ v: 1, id: "' +
      freshId +
      '", ok: true, result: "fresh" })',
  );
  await settle();
  assert.deepEqual(second.plain('out'), [['ok', 'fresh']]);
});

test('request ids carry the nonce, stay unique within a load and fit 64 chars', () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  const many = 2000;
  f.run(
    'for (let i = 0; i < ' +
      many +
      '; i += 1) { PosNative.request("app.info"); }',
  );
  const ids = f.posted.map(m => (JSON.parse(m) as { id: string }).id);
  assert.equal(ids.length, many);
  assert.equal(new Set(ids).size, many, 'unique within one load');
  assert.equal(ids[0], idOf(1));
  for (const id of ids) {
    assert.ok(id.length <= MAX_ID_CHARS, 'id too long: ' + id.length);
  }
});

test('without window.crypto the ids still carry a per-load nonce', () => {
  const a = fakeWindow(true, null);
  a.inject();
  a.run('window.PosNative.request("app.info")');
  const b = fakeWindow(true, null);
  b.inject();
  b.run('window.PosNative.request("app.info")');
  const idA = lastPosted(a).id;
  const idB = lastPosted(b).id;
  assert.ok(idA.length <= MAX_ID_CHARS && idA.length > 'r1'.length);
  assert.notEqual(idA, idB);
});

test('events reach listeners; off stops them; a throwing listener does not block others', () => {
  const f = fakeWindow();
  f.inject();
  f.run('globalThis.got = []; globalThis.offB = null;');
  f.run(
    'window.PosNative.on("printer.status", () => { throw new Error("boom"); });',
  );
  f.run('window.PosNative.on("printer.status", d => got.push(["a", d]));');
  f.run(
    'offB = window.PosNative.on("printer.status", d => got.push(["b", d]));',
  );
  f.run('window.PosNative.on("app.wake", d => got.push(["wake", d]));');
  f.run(
    'window.__posNativeDeliver({ v: 1, event: "printer.status", data: { state: "connected" } })',
  );
  f.run('offB()');
  f.run(
    'window.__posNativeDeliver({ v: 1, event: "printer.status", data: { state: "none" } })',
  );
  f.run('window.__posNativeDeliver({ v: 1, event: "app.wake", data: {} })');
  f.run(
    'window.__posNativeDeliver({ v: 1, event: "never.registered", data: 1 })',
  );
  assert.deepEqual(f.plain('got'), [
    ['a', { state: 'connected' }],
    ['b', { state: 'connected' }],
    ['a', { state: 'none' }],
    ['wake', {}],
  ]);
  assert.equal(f.run('typeof window.PosNative.on("x", 5)'), 'function');
  assert.equal(f.run('typeof window.PosNative.on(5, () => 1)'), 'function');
});

// Phase 2 Session 2F2 (spec §9.2): bridge v2 on the page. A request carries its version and only a reply of that
// version settles it; an event reaches only the listeners of its version; a version the app does not speak is refused.
test('v2: request and on take the version last; replies and events are routed by version', async () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  f.run('globalThis.out = []; globalThis.got = [];');
  f.run('window.PosNative.request("printer.status", undefined, 2).then(r => out.push(["v2", r]), e => out.push(["err", e.code]));');
  assert.deepEqual(lastPosted(f), { v: 2, token: TOKEN, id: idOf(1), method: 'printer.status' }, 'the envelope carries v: 2');
  f.run('window.PosNative.request("printer.status").then(r => out.push(["v1", r]));');
  assert.equal(lastPosted(f).v, 1, 'no version: v1');
  f.run('window.__posNativeDeliver({ v: 1, id: "' + idOf(1) + '", ok: true, result: "wrong" })');
  f.run('window.__posNativeDeliver({ v: 2, id: "' + idOf(2) + '", ok: true, result: "wrong" })');
  await settle();
  assert.deepEqual(f.plain('out'), [], 'a reply of another version settles nothing');
  f.run('window.__posNativeDeliver({ v: 2, id: "' + idOf(1) + '", ok: true, result: { printers: [] } })');
  f.run('window.__posNativeDeliver({ v: 1, id: "' + idOf(2) + '", ok: true, result: { state: "none" } })');
  await settle();
  assert.deepEqual(f.plain('out'), [['v2', { printers: [] }], ['v1', { state: 'none' }]]);
  f.run('window.PosNative.on("printer.status", d => got.push(["one", d]));');
  f.run('window.PosNative.on("printer.status", d => got.push(["all", d]), 2);');
  f.run('window.__posNativeDeliver({ v: 1, event: "printer.status", data: { state: "connected" } })');
  f.run('window.__posNativeDeliver({ v: 2, event: "printer.status", data: { printers: [] } })');
  assert.deepEqual(f.plain('got'), [['one', { state: 'connected' }], ['all', { printers: [] }]], 'each event to its own version');
});

test('v2: a version the app does not speak is refused and posts nothing; its listener is a no-op', async () => {
  const f = fakeWindow();
  f.inject();
  f.run('globalThis.out = [];');
  f.run('window.PosNative.request("printer.status", undefined, 3).then(() => out.push("ok"), e => out.push(e.code));');
  await settle();
  assert.deepEqual(f.plain('out'), ['UNSUPPORTED']);
  assert.equal(f.posted.length, 0, 'nothing posted');
  assert.equal(f.run('typeof window.PosNative.on("printer.status", () => 1, 3)'), 'function');
  f.run('window.__posNativeDeliver({ v: 3, event: "printer.status", data: 1 })');
  assert.deepEqual(f.plain('window.PosNative.versions'), [1, 2], 'what the app says it speaks');
});

test('injecting twice is a no-op: first token wins, one ready event', () => {
  const f = fakeWindow();
  f.inject(TOKEN);
  const first = f.run('window.PosNative');
  f.inject('ff'.repeat(32));
  assert.equal(f.run('window.PosNative') === first, true);
  f.run('window.PosNative.request("app.info")');
  assert.equal(lastPosted(f).token, TOKEN);
  assert.equal(f.events.length, 1);
});

test('posnative:ready fires last, after PosNative exists', () => {
  const f = fakeWindow();
  f.inject();
  assert.deepEqual(f.events, [{ type: NATIVE_READY_EVENT, hadApi: true }]);
  assert.equal(NATIVE_READY_EVENT, 'posnative:ready');
  const script = buildInjectedScript({ token: TOKEN, platform: 'android' });
  const defineAt = script.lastIndexOf('Object.defineProperty(window');
  const readyAt = script.indexOf(NATIVE_READY_EVENT);
  assert.ok(
    defineAt > 0 && readyAt > defineAt,
    'ready dispatch comes after the definitions',
  );
  assert.equal(script.split(NATIVE_READY_EVENT).length - 1, 1);
});

test('a message over the cap rejects TOO_LARGE and posts nothing', async () => {
  const f = fakeWindow();
  f.inject();
  f.run(
    'globalThis.out = []; window.PosNative.request("printer.print", { data: "A".repeat(2200000) }).then(() => out.push("ok"), e => out.push([e.code, e.message]));',
  );
  await settle();
  assert.equal(f.posted.length, 0);
  assert.deepEqual(f.plain('out'), [
    ['TOO_LARGE', NATIVE_ERROR_MESSAGES.TOO_LARGE],
  ]);
});

test('a message exactly at the cap is still posted', () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  const overhead = JSON.stringify({
    v: 1,
    token: TOKEN,
    id: idOf(1),
    method: 'printer.print',
    params: { data: '' },
  }).length;
  f.run(
    'window.PosNative.request("printer.print", { data: "A".repeat(' +
      (2100000 - overhead) +
      ') })',
  );
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].length, 2100000);
});

test('no ReactNativeWebView -> UNSUPPORTED; the bridge is looked up at call time', async () => {
  const f = fakeWindow(false);
  f.inject();
  f.run(
    'globalThis.out = []; window.PosNative.request("app.info").then(() => out.push("ok"), e => out.push([e.code, e.message]));',
  );
  await settle();
  assert.deepEqual(f.plain('out'), [
    ['UNSUPPORTED', NATIVE_ERROR_MESSAGES.UNSUPPORTED],
  ]);
  assert.equal(f.posted.length, 0);
  // react-native-webview adds its object AFTER the script ran
  f.run(
    'window.ReactNativeWebView = { postMessage: m => globalThis.late = m };',
  );
  f.run('window.PosNative.request("app.info")');
  assert.equal(
    lastPosted({ ...f, posted: [String(f.run('late'))] }).method,
    'app.info',
  );
});

test('a throwing postMessage rejects UNSUPPORTED and forgets the request', async () => {
  const f = fakeWindow();
  f.inject();
  f.run(
    'window.ReactNativeWebView = { postMessage() { throw new Error("gone"); } };',
  );
  f.run(
    'globalThis.out = []; window.PosNative.request("app.info").then(() => out.push("ok"), e => out.push(e.code));',
  );
  await settle();
  assert.deepEqual(f.plain('out'), ['UNSUPPORTED']);
});

test('unserialisable params reject BAD_REQUEST', async () => {
  const f = fakeWindow();
  f.inject();
  f.run(
    'globalThis.out = []; const c = {}; c.self = c; window.PosNative.request("app.info", c).then(() => out.push("ok"), e => out.push(e.code));',
  );
  await settle();
  assert.deepEqual(f.plain('out'), ['BAD_REQUEST']);
  assert.equal(f.posted.length, 0);
});

test('deliver round trip keeps U+2028, U+2029 and a script end tag intact', async () => {
  const f = fakeWindow(true, FIXED_CRYPTO);
  f.inject();
  const tricky = 'a' + LS + 'b' + PS + 'c</script><!--&amp;>"\'';
  f.run(
    'globalThis.out = []; window.PosNative.on("printer.status", d => out.push(d)); window.PosNative.request("printer.status").then(r => out.push(r));',
  );
  const reply = buildDeliverScript({
    v: 1,
    id: idOf(1),
    ok: true,
    result: { name: tricky },
  });
  const event = buildDeliverScript({
    v: 1,
    event: 'printer.status',
    data: { name: tricky },
  });
  for (const script of [reply, event]) {
    for (const bad of [LS, PS, '<', '>', '&']) {
      assert.ok(
        !script.includes(bad),
        'raw ' + bad.charCodeAt(0).toString(16) + ' in delivered script',
      );
    }
    assert.ok(script.startsWith('window.__posNativeDeliver('));
    assert.ok(script.endsWith(');true;'));
    f.run(script);
  }
  await settle();
  assert.deepEqual(f.plain('out'), [{ name: tricky }, { name: tricky }]);
});

test('safeJsonForScript escapes exactly the unsafe characters and round-trips', () => {
  const value = {
    s: LS + PS + '<>&',
    n: 5,
    u: undefined,
    nested: ['</script>'],
  };
  const text = safeJsonForScript(value);
  assert.ok(text.includes('\\u2028') && text.includes('\\u2029'));
  assert.ok(
    text.includes('\\u003c') &&
      text.includes('\\u003e') &&
      text.includes('\\u0026'),
  );
  assert.deepEqual(JSON.parse(text), {
    s: LS + PS + '<>&',
    n: 5,
    nested: ['</script>'],
  });
  assert.equal(safeJsonForScript(undefined), 'null');
  assert.equal(safeJsonForScript('plain'), '"plain"');
});

test('source files contain no raw U+2028/U+2029 or stray control characters', () => {
  const dirs = [__dirname, join(__dirname, '..')];
  let checked = 0;
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) {
        continue;
      }
      const text = readFileSync(join(dir, name), 'utf8');
      assert.ok(
        !text.includes(LS) && !text.includes(PS),
        name + ' has U+2028/9',
      );
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        const allowed = code === 0x09 || code === 0x0a;
        assert.ok(
          code >= 0x20 || allowed,
          name + ' has control char ' + code + ' at ' + i,
        );
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 8, 'vision guard: scanned ' + checked + ' files');
});
