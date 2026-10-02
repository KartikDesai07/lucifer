/// <reference types="node" />
// Pins for src/bridge/router.ts and src/bridge/host-gate.ts over a recording fake port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostGate } from './host-gate';
import {
  NATIVE_ERROR_MESSAGES,
  createRouter,
  validateParams,
  type NativePort,
} from './router';
import {
  BRIDGE_MESSAGE_MAX_CHARS,
  NATIVE_ERROR_CODES,
  NATIVE_METHODS,
  PRINT_DATA_MAX_BASE64_CHARS,
  type PrinterStatus,
} from './protocol';

const TOKEN = 'ab'.repeat(32);
const ORIGIN = 'https://pos.example.com';
const FRAME = ORIGIN + '/pos/orders';
const STATUS: PrinterStatus = {
  state: 'connected',
  printer: { id: 'tcp:10.0.0.9:9100', name: 'Kitchen', transport: 'tcp' },
  bluetooth: 'on',
};

type Reply = {
  v: number;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

function setup(
  options: {
    reject?: unknown;
    deliver?: (s: string) => void | Promise<unknown>;
  } = {},
) {
  const log: string[] = [];
  const calls: unknown[][] = [];
  const deliveries: string[] = [];
  const record =
    <T>(name: string, value: T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push([name, ...args]);
      log.push('port:' + name);
      return 'reject' in options
        ? Promise.reject(options.reject)
        : Promise.resolve(value);
    };
  const port: NativePort = {
    appInfo: record('appInfo', {
      appVersion: '1.2.3',
      platform: 'android' as const,
      transports: ['bt-classic', 'tcp'],
    }),
    getStatus: record('getStatus', STATUS),
    listPrinters: record('listPrinters', {
      printers: [{ id: 'x', name: 'X', transport: 'ble' as const }],
    }),
    selectPrinter: record('selectPrinter', STATUS),
    selectTcp: record('selectTcp', STATUS),
    reconnect: record('reconnect', STATUS),
    forget: record('forget', {
      ...STATUS,
      state: 'none' as const,
      printer: null,
    }),
    print: record('print', { bytes: 12 }),
    requestPermission: record('requestPermission', true),
    enableBluetooth: record('enableBluetooth', { on: true }),
    setHostActive: record('setHostActive', { active: true }),
  };
  const router = createRouter({
    port,
    token: TOKEN,
    origin: ORIGIN,
    deliver: script => {
      log.push('deliver');
      deliveries.push(script);
      return options.deliver ? options.deliver(script) : undefined;
    },
    onChangeUrl: () => log.push('changeUrl'),
  });
  const replies = (): Reply[] =>
    deliveries.map(s =>
      JSON.parse(
        s.slice(
          'window.__posNativeDeliver('.length,
          s.length - ');true;'.length,
        ),
      ),
    );
  return { router, calls, deliveries, log, replies };
}

function msg(
  method: unknown,
  params?: unknown,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    v: 1,
    token: TOKEN,
    id: 'q1',
    method,
    params,
    ...extra,
  });
}

async function silent(
  raw: unknown,
  frame: unknown = FRAME,
  label = '',
): Promise<void> {
  const s = setup();
  await s.router.handle(raw, frame);
  assert.deepEqual(s.calls, [], 'native calls: ' + label);
  assert.deepEqual(s.deliveries, [], 'deliveries: ' + label);
  assert.ok(!s.log.includes('changeUrl'), 'changeUrl: ' + label);
}

async function bad(
  method: string,
  params: unknown,
  code = 'BAD_REQUEST',
): Promise<void> {
  const s = setup();
  await s.router.handle(msg(method, params), FRAME);
  assert.deepEqual(
    s.calls,
    [],
    method + ' ' + String(JSON.stringify(params)).slice(0, 60),
  );
  const [reply] = s.replies();
  assert.equal(reply.ok, false);
  assert.equal(reply.error?.code, code);
  assert.equal(
    reply.error?.message,
    NATIVE_ERROR_MESSAGES[code as keyof typeof NATIVE_ERROR_MESSAGES],
  );
}

test('every drop path = zero native calls and zero deliveries', async () => {
  await silent('x'.repeat(BRIDGE_MESSAGE_MAX_CHARS + 1), FRAME, 'raw too long');
  await silent(
    msg('printer.status', undefined, {
      pad: 'x'.repeat(BRIDGE_MESSAGE_MAX_CHARS),
    }),
    FRAME,
    'valid request padded past the cap',
  );
  await silent(undefined, FRAME, 'raw undefined');
  await silent(42, FRAME, 'raw number');
  await silent({ v: 1 }, FRAME, 'raw object');
  const ok = msg('printer.status');
  await silent(ok, 'https://evil.example.com/pos', 'other host');
  await silent(ok, 'http://pos.example.com/pos', 'other scheme');
  await silent(ok, 'https://pos.example.com:8443/pos', 'other port');
  await silent(ok, 'https://pos.example.com.evil.com', 'suffix host');
  await silent(ok, 'https://pos.example.com@evil.com/', 'userinfo host');
  await silent(ok, null, 'no frame url');
  await silent(ok, '', 'empty frame url');
  await silent(ok, 'about:blank', 'about:blank frame');
  await silent('{not json', FRAME, 'bad json');
  await silent('[1,2]', FRAME, 'json array');
  await silent('null', FRAME, 'json null');
  await silent('"str"', FRAME, 'json string');
  await silent(
    msg('printer.status', undefined, { v: 2 }),
    FRAME,
    'wrong version',
  );
  await silent(
    msg('printer.status', undefined, { v: '1' }),
    FRAME,
    'version string',
  );
  await silent(msg('printer.status', undefined, { id: 5 }), FRAME, 'id number');
  await silent(msg('printer.status', undefined, { id: '' }), FRAME, 'empty id');
  await silent(
    msg('printer.status', undefined, { id: 'i'.repeat(65) }),
    FRAME,
    'long id',
  );
  await silent(msg(5), FRAME, 'method number');
  await silent(msg(undefined), FRAME, 'method missing');
  await silent(
    JSON.stringify({ v: 1, id: 'q', method: 'printer.status' }),
    FRAME,
    'no token',
  );
  await silent(
    msg('printer.status', undefined, { token: 'cd'.repeat(32) }),
    FRAME,
    'wrong token',
  );
  await silent(
    msg('printer.status', undefined, { token: TOKEN.slice(1) }),
    FRAME,
    'short token',
  );
  await silent(
    msg('printer.status', undefined, { token: TOKEN + 'a' }),
    FRAME,
    'long token',
  );
  await silent(
    msg('printer.status', undefined, { token: 7 }),
    FRAME,
    'numeric token',
  );
  await silent(
    msg('app.changeUrl', undefined, { token: 'cd'.repeat(32) }),
    FRAME,
    'changeUrl wrong token',
  );
});

test('frame check compares origins: bare origin, full URL and case all pass', async () => {
  for (const frame of [
    ORIGIN,
    ORIGIN + '/',
    FRAME + '?a=1#b',
    'HTTPS://POS.Example.COM:443/x',
  ]) {
    const s = setup();
    await s.router.handle(msg('printer.status'), frame);
    assert.deepEqual(s.calls, [['getStatus']], frame);
    assert.equal(s.replies().length, 1, frame);
  }
});

test('each method calls the port once with the right arguments and replies with the right shape', async () => {
  const cases: [string, unknown, unknown[], unknown][] = [
    [
      'app.info',
      undefined,
      ['appInfo'],
      {
        app: 'pos-mobile',
        appVersion: '1.2.3',
        platform: 'android',
        transports: ['bt-classic', 'tcp'],
      },
    ],
    ['printer.status', null, ['getStatus'], STATUS],
    [
      'printer.list',
      undefined,
      ['listPrinters', false],
      { printers: [{ id: 'x', name: 'X', transport: 'ble' }] },
    ],
    [
      'printer.list',
      {},
      ['listPrinters', false],
      { printers: [{ id: 'x', name: 'X', transport: 'ble' }] },
    ],
    [
      'printer.list',
      { scan: true },
      ['listPrinters', true],
      { printers: [{ id: 'x', name: 'X', transport: 'ble' }] },
    ],
    [
      'printer.select',
      { id: 'bt-classic:AA:BB' },
      ['selectPrinter', 'bt-classic:AA:BB'],
      STATUS,
    ],
    [
      'printer.select',
      { tcp: { host: '192.168.1.50', port: 9100 } },
      ['selectTcp', '192.168.1.50', 9100],
      STATUS,
    ],
    [
      'printer.select',
      { tcp: { host: 'PRINTER.local', port: 9100 } },
      ['selectTcp', 'printer.local', 9100],
      STATUS,
    ],
    ['printer.reconnect', {}, ['reconnect'], STATUS],
    [
      'printer.forget',
      undefined,
      ['forget'],
      { ...STATUS, state: 'none', printer: null },
    ],
    [
      'printer.print',
      { data: 'G0AAAAA=' },
      ['print', 'G0AAAAA='],
      { bytes: 12 },
    ],
    [
      'permissions.request',
      { kind: 'bluetooth' },
      ['requestPermission', 'bluetooth'],
      { granted: true },
    ],
    [
      'permissions.request',
      { kind: 'notifications' },
      ['requestPermission', 'notifications'],
      { granted: true },
    ],
    ['bluetooth.enable', undefined, ['enableBluetooth'], { on: true }],
    [
      'host.background',
      { active: true, label: 'Counter' },
      ['setHostActive', true, 'Counter'],
      { active: true },
    ],
    [
      'host.background',
      { active: false },
      ['setHostActive', false, ''],
      { active: true },
    ],
  ];
  for (const [method, params, call, result] of cases) {
    const s = setup();
    await s.router.handle(msg(method, params), FRAME);
    assert.deepEqual(s.calls, [call], method);
    assert.deepEqual(
      s.replies(),
      [{ v: 1, id: 'q1', ok: true, result }],
      method,
    );
  }
  assert.equal(
    new Set(cases.map(c => c[0])).size,
    NATIVE_METHODS.length - 1,
    'all methods but app.changeUrl covered',
  );
});

test('the reply echoes the request id', async () => {
  const s = setup();
  await s.router.handle(msg('printer.status', undefined, { id: 'r42' }), FRAME);
  await s.router.handle(msg('nope', undefined, { id: 'r43' }), FRAME);
  assert.deepEqual(
    s.replies().map(r => r.id),
    ['r42', 'r43'],
  );
});

test('unknown method -> BAD_REQUEST, no native call', async () => {
  for (const method of [
    'printer.destroy',
    'PRINTER.STATUS',
    'app.info ',
    '',
    '__proto__',
    'constructor',
  ]) {
    await bad(method, undefined);
  }
});

test('validation: printer.list', async () => {
  await bad('printer.list', { scan: 'yes' });
  await bad('printer.list', { scan: 1 });
  await bad('printer.list', { scan: true, extra: 1 });
  await bad('printer.list', [true]);
  await bad('printer.list', 'scan');
});

test('validation: printer.select', async () => {
  await bad('printer.select', {});
  await bad('printer.select', undefined);
  await bad('printer.select', { id: '' });
  await bad('printer.select', { id: 5 });
  await bad('printer.select', { id: 'i'.repeat(201) });
  await bad('printer.select', {
    id: 'a',
    tcp: { host: '1.2.3.4', port: 9100 },
  });
  await bad('printer.select', { id: 'a', extra: 1 });
  await bad('printer.select', { tcp: null });
  await bad('printer.select', { tcp: { port: 9100 } });
  await bad('printer.select', { tcp: { host: '1.2.3.4' } });
  await bad('printer.select', { tcp: { host: 'bad host', port: 9100 } });
  await bad('printer.select', { tcp: { host: 'host/../x', port: 9100 } });
  await bad('printer.select', { tcp: { host: '999.1.1.1', port: 9100 } });
  await bad('printer.select', { tcp: { host: 'h'.repeat(254), port: 9100 } });
  await bad('printer.select', { tcp: { host: '1.2.3.4', port: 0 } });
  await bad('printer.select', { tcp: { host: '1.2.3.4', port: 65536 } });
  await bad('printer.select', { tcp: { host: '1.2.3.4', port: 91.5 } });
  await bad('printer.select', { tcp: { host: '1.2.3.4', port: '9100' } });
  await bad('printer.select', {
    tcp: { host: '1.2.3.4', port: 9100, extra: 1 },
  });
  const s = setup();
  await s.router.handle(msg('printer.select', { id: 'i'.repeat(200) }), FRAME);
  await s.router.handle(
    msg('printer.select', { tcp: { host: '1.2.3.4', port: 65535 } }),
    FRAME,
  );
  await s.router.handle(
    msg('printer.select', { tcp: { host: '1.2.3.4', port: 1 } }),
    FRAME,
  );
  assert.equal(s.calls.length, 3);
});

test('validation: printer.print', async () => {
  await bad('printer.print', undefined);
  await bad('printer.print', {});
  await bad('printer.print', { data: 5 });
  await bad('printer.print', { data: '' });
  await bad('printer.print', { data: 'AAA' });
  await bad('printer.print', { data: 'AA=A' });
  await bad('printer.print', { data: 'AA==AAAA' });
  await bad('printer.print', { data: 'AAA!' });
  await bad('printer.print', { data: 'AA A' });
  await bad('printer.print', { data: 'AAAA\n' });
  await bad('printer.print', { data: '====' });
  await bad('printer.print', { data: 'AAA===' });
  await bad('printer.print', { data: 'AAAA', extra: 1 });
  await bad(
    'printer.print',
    { data: 'A'.repeat(PRINT_DATA_MAX_BASE64_CHARS + 4) },
    'TOO_LARGE',
  );
  const s = setup();
  await s.router.handle(
    msg('printer.print', { data: 'A'.repeat(PRINT_DATA_MAX_BASE64_CHARS) }),
    FRAME,
  );
  await s.router.handle(msg('printer.print', { data: 'QUJD' }), FRAME);
  await s.router.handle(msg('printer.print', { data: 'QUI=' }), FRAME);
  await s.router.handle(msg('printer.print', { data: 'QQ==' }), FRAME);
  await s.router.handle(msg('printer.print', { data: 'a+/9' }), FRAME);
  assert.equal(s.calls.length, 5);
});

test('validation: permissions.request and host.background', async () => {
  await bad('permissions.request', undefined);
  await bad('permissions.request', {});
  await bad('permissions.request', { kind: 'camera' });
  await bad('permissions.request', { kind: 'toString' });
  await bad('permissions.request', { kind: ['bluetooth'] });
  await bad('permissions.request', { kind: 'bluetooth', extra: 1 });
  await bad('host.background', undefined);
  await bad('host.background', {});
  await bad('host.background', { active: 'true' });
  await bad('host.background', { active: 1 });
  await bad('host.background', { active: true, label: 5 });
  await bad('host.background', { active: true, label: 'l'.repeat(81) });
  await bad('host.background', { active: true, extra: 1 });
  const s = setup();
  await s.router.handle(
    msg('host.background', { active: true, label: 'l'.repeat(80) }),
    FRAME,
  );
  assert.equal(s.calls.length, 1);
});

test('methods without params refuse extra data', async () => {
  for (const method of [
    'app.info',
    'printer.status',
    'printer.reconnect',
    'printer.forget',
    'bluetooth.enable',
    'app.changeUrl',
  ]) {
    await bad(method, { x: 1 });
    await bad(method, [1]);
    await bad(method, 'x');
  }
});

test('validateParams: normalised output', () => {
  assert.deepEqual(validateParams('printer.list', undefined), {
    ok: true,
    params: { scan: false },
  });
  assert.deepEqual(validateParams('host.background', { active: true }), {
    ok: true,
    params: { active: true, label: '' },
  });
  assert.deepEqual(validateParams('printer.status', null), {
    ok: true,
    params: {},
  });
  const proto = JSON.parse('{"__proto__": {"scan": true}}');
  assert.equal(validateParams('printer.list', proto).ok, false);
});

test('native errors map to their code with curated text; the native message never leaks', async () => {
  for (const code of NATIVE_ERROR_CODES) {
    const s = setup({
      reject: Object.assign(new Error('secret content://device/AA:BB'), {
        code,
      }),
    });
    await s.router.handle(msg('printer.print', { data: 'QUJD' }), FRAME);
    const [reply] = s.replies();
    assert.equal(reply.ok, false);
    assert.deepEqual(reply.error, {
      code,
      message: NATIVE_ERROR_MESSAGES[code],
    });
    assert.ok(!s.deliveries[0].includes('secret'), 'native message leaked');
  }
});

test('unknown native codes: WRITE_FAILED for print, UNSUPPORTED for everything else', async () => {
  const rejections: unknown[] = [
    Object.assign(new Error('x'), { code: 'E_WEIRD' }),
    Object.assign(new Error('x'), { code: 42 }),
    Object.assign(new Error('x'), { code: 'toString' }),
    new Error('plain'),
    'string rejection',
    undefined,
    null,
  ];
  for (const reject of rejections) {
    const p = setup({ reject });
    await p.router.handle(msg('printer.print', { data: 'QUJD' }), FRAME);
    assert.equal(p.replies()[0].error?.code, 'WRITE_FAILED', String(reject));
    assert.equal(
      p.replies()[0].error?.message,
      NATIVE_ERROR_MESSAGES.WRITE_FAILED,
    );
    const o = setup({ reject });
    await o.router.handle(msg('printer.list', { scan: true }), FRAME);
    assert.equal(o.replies()[0].error?.code, 'UNSUPPORTED', String(reject));
  }
});

test('NATIVE_ERROR_MESSAGES covers every code with plain text', () => {
  assert.deepEqual(
    Object.keys(NATIVE_ERROR_MESSAGES).sort(),
    [...NATIVE_ERROR_CODES].sort(),
  );
  for (const code of NATIVE_ERROR_CODES) {
    const text = NATIVE_ERROR_MESSAGES[code];
    assert.ok(
      text.length > 10 && /^[A-Z]/.test(text) && text.endsWith('.'),
      code,
    );
    assert.ok(
      !/[A-Z]{3,}_|Exception|null|undefined/.test(text),
      code + ' reads like a code',
    );
  }
});

test('LOCATION_OFF is the last code and says what to do, word for word', () => {
  assert.equal(
    NATIVE_ERROR_CODES[NATIVE_ERROR_CODES.length - 1],
    'LOCATION_OFF',
  );
  assert.equal(
    NATIVE_ERROR_MESSAGES.LOCATION_OFF,
    'Turn on Location so this tablet can find nearby printers.',
  );
});

test('app.changeUrl: reply first, then onChangeUrl', async () => {
  const s = setup();
  await s.router.handle(msg('app.changeUrl'), FRAME);
  assert.deepEqual(s.log, ['deliver', 'changeUrl']);
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.replies(), [{ v: 1, id: 'q1', ok: true, result: null }]);
});

test('app.changeUrl waits for an async delivery and still runs if delivery fails', async () => {
  const slow = setup({
    deliver: () =>
      new Promise(resolve => setTimeout(resolve, 10)).then(() =>
        slow.log.push('delivered'),
      ),
  });
  await slow.router.handle(msg('app.changeUrl'), FRAME);
  assert.deepEqual(slow.log, ['deliver', 'delivered', 'changeUrl']);
  const broken = setup({
    deliver: () => Promise.reject(new Error('webview gone')),
  });
  await broken.router.handle(msg('app.changeUrl'), FRAME);
  assert.deepEqual(broken.log, ['deliver', 'changeUrl']);
});

test('other methods never trigger onChangeUrl; a throwing deliver never throws out of handle', async () => {
  const s = setup({
    deliver: () => {
      throw new Error('sync failure');
    },
  });
  await s.router.handle(msg('printer.status'), FRAME);
  assert.deepEqual(s.log, ['port:getStatus', 'deliver']);
});

test('createHostGate: foreground applies; background remembers and replies inactive', async () => {
  const applied: [boolean, string][] = [];
  let foreground = true;
  const gate = createHostGate(
    async (active, label) => {
      applied.push([active, label]);
      return { active };
    },
    () => foreground,
  );
  assert.deepEqual(await gate.setHostActive(true, 'Counter'), { active: true });
  assert.deepEqual(applied, [[true, 'Counter']]);
  foreground = false;
  assert.deepEqual(await gate.setHostActive(true, 'Till 2'), { active: false });
  assert.deepEqual(await gate.setHostActive(true, 'Till 3'), { active: false });
  assert.deepEqual(
    applied,
    [[true, 'Counter']],
    'nothing applied while hidden',
  );
  foreground = true;
  await gate.onForeground();
  assert.deepEqual(
    applied,
    [
      [true, 'Counter'],
      [true, 'Till 3'],
    ],
    'latest wish applied once',
  );
  await gate.onForeground();
  assert.equal(applied.length, 2, 'wish is consumed');
});

test('createHostGate: turning the host off is applied even in the background and cancels the wish', async () => {
  const applied: [boolean, string][] = [];
  let foreground = false;
  const gate = createHostGate(
    async (active, label) => {
      applied.push([active, label]);
      return { active };
    },
    () => foreground,
  );
  await gate.setHostActive(true, 'Counter');
  assert.deepEqual(await gate.setHostActive(false, ''), { active: false });
  assert.deepEqual(applied, [[false, '']]);
  foreground = true;
  await gate.onForeground();
  assert.deepEqual(applied, [[false, '']], 'cancelled wish is not revived');
});

test('createHostGate: a failing apply on foreground is swallowed', async () => {
  const gate = createHostGate(
    async () => {
      throw new Error('refused');
    },
    () => false,
  );
  await gate.setHostActive(true, 'x');
  await assert.doesNotReject(gate.onForeground());
});
