/// <reference types="node" />
// Source pins for the mobile app's cross-file contracts (JS <-> Kotlin <->
// manifest <-> package.json <-> README). Every pin is a checker that takes RAW
// source text and returns a list of problems; the real source must yield none,
// and each pin has an in-memory mutation table proving the checker can fail.
// Negative pins sit next to a positive landmark so a blind scan cannot pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const MAIN = join(ROOT, 'android', 'app', 'src', 'main');
const JAVA = join(MAIN, 'java');
const KT_DIR = join(JAVA, 'com', 'possoftware', 'pos', 'printer');
const GRADLE_APP = join(ROOT, 'android', 'app', 'build.gradle');
const GRADLE_ROOT = join(ROOT, 'android', 'build.gradle');
const WEBVIEW_PROPS = join(
  ROOT,
  'node_modules',
  'react-native-webview',
  'android',
  'gradle.properties',
);
const MIN_TS_FILES = 8;
const MIN_KT_FILES = 15;
const WEBKIT_VERSION = '1.14.0';
const WEBVIEW_VERSION = '14.0.1';
const SCAN_MS = 8000;
const MANIFEST_MAX_SDK_COUNT = 3;
const ESCAPED_CODES = [0x2028, 0x2029, 0x3c, 0x3e, 0x26];
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const NATIVE_METHOD_ORACLE = [
  'getSavedOrigin',
  'saveOrigin',
  'clearOrigin',
  'newToken',
  'appInfo',
  'getStatus',
  'listPrinters',
  'selectPrinter',
  'selectTcp',
  'reconnect',
  'forget',
  'print',
  'refreshStatus',
  'enableBluetooth',
  'setHostActive',
  'moveTaskToBack',
  'attachWebView',
  'deliverScript',
];

type Files = Record<string, string>;
type Check = (source: string) => string[];
type Mutation = [from: string, to: string];

function read(path: string): string {
  assert.ok(existsSync(path), 'missing file: ' + path);
  return readFileSync(path, 'utf8');
}

// Line comments first (a glob like src/**/*.ts inside one must not open a
// block comment), then block/KDoc comments; XML comments for the manifest.
function strip(text: string): string {
  return text
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function listFiles(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        out.push(...listFiles(full, keep));
      }
    } else if (keep(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

function loadAll(paths: string[]): Files {
  const files: Files = {};
  for (const path of paths) {
    files[relative(ROOT, path).split(sep).join('/')] = read(path);
  }
  return files;
}

const isTs = (name: string) => /\.tsx?$/.test(name);
const isKt = (name: string) => name.endsWith('.kt');
const kt = (name: string) => read(join(KT_DIR, name));

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setProblems(label: string, a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (const v of a) {
    if (!b.includes(v)) {
      out.push(label + ': ' + v + ' is not on the other side');
    }
  }
  for (const v of b) {
    if (!a.includes(v)) {
      out.push(label + ': ' + v + ' is missing on the first side');
    }
  }
  if (new Set(a).size !== a.length) {
    out.push(label + ': duplicates on the first side');
  }
  if (new Set(b).size !== b.length) {
    out.push(label + ': duplicates on the second side');
  }
  return out;
}

function mutated(source: string, from: string, to: string): string {
  assert.ok(source.includes(from), 'mutation target not found: ' + from);
  return source.split(from).join(to);
}

// Baseline must be clean, then every mutation must be reported.
function everyMutationCaught(
  check: Check,
  source: string,
  table: Mutation[],
): void {
  assert.deepEqual(check(source), [], 'baseline must be clean');
  assert.ok(table.length > 0);
  for (const [from, to] of table) {
    const problems = check(mutated(source, from, to));
    assert.ok(
      problems.length > 0,
      'mutation not caught: ' + from + ' -> ' + to,
    );
  }
}

function tsList(code: string, name: string): string[] {
  const m = new RegExp(
    'export const ' + name + ' = \\[([\\s\\S]*?)\\] as const',
  ).exec(code);
  if (!m) {
    return [];
  }
  return [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]);
}

// ---------------------------------------------------------------- pin 0
test('pin 0: every pinned source file exists', () => {
  const paths = [
    join(ROOT, 'App.tsx'),
    join(ROOT, 'README.md'),
    join(ROOT, 'package.json'),
    GRADLE_APP,
    GRADLE_ROOT,
    join(MAIN, 'AndroidManifest.xml'),
    join(MAIN, 'res', 'xml', 'network_security_config.xml'),
    join(MAIN, 'res', 'xml', 'usb_printer_filter.xml'),
    join(JAVA, 'com', 'possoftware', 'pos', 'MainApplication.kt'),
    join(SRC, 'bridge', 'protocol.ts'),
    join(SRC, 'native', 'PosPrinter.ts'),
    join(SRC, 'screens', 'PosScreen.tsx'),
    ...[
      'BridgeCodes.kt',
      'ScanSession.kt',
      'PosPrinterModule.kt',
      'PosPrinterPackage.kt',
      'WebViewDelivery.kt',
      'PrinterManager.kt',
      'PrinterApi.kt',
      'PrintHostService.kt',
      'TcpTransport.kt',
      'TcpAddress.kt',
      'SelectionFence.kt',
      'BleTransport.kt',
      'PrinterReceivers.kt',
      'PrinterThreads.kt',
      'PrinterTypes.kt',
    ].map(name => join(KT_DIR, name)),
  ];
  for (const path of paths) {
    assert.ok(existsSync(path), 'missing file: ' + path);
  }
});

// ---------------------------------------------------------------- pin 1
function consoleProblems(files: Files): string[] {
  return Object.keys(files).filter(name =>
    /\bconsole\s*(\.|\[)/.test(strip(files[name])),
  );
}
function appAndSrcFiles(): Files {
  const paths = listFiles(SRC, n => isTs(n) && !/\.test\.tsx?$/.test(n));
  return loadAll([join(ROOT, 'App.tsx'), ...paths]);
}

test('pin 1: no console. in App.tsx or non-test src files', () => {
  const files = appAndSrcFiles();
  assert.ok(Object.keys(files).length >= MIN_TS_FILES, 'vision guard');
  assert.ok('App.tsx' in files, 'App.tsx is scanned');
  assert.ok('src/screens/PosScreen.tsx' in files, 'landmark file is scanned');
  for (const text of Object.values(files)) {
    assert.ok(strip(text).trim().length > 0, 'stripper left real code');
  }
  assert.deepEqual(consoleProblems(files), []);
});

test('pin 1 mutation: console use is caught, a comment is not', () => {
  const files = appAndSrcFiles();
  const names = ['App.tsx', 'src/url.ts', 'src/native/PosPrinter.ts'];
  for (const name of names) {
    for (const call of ['console.log(1);', "console['warn'](1);"]) {
      const bad = { ...files, [name]: files[name] + '\n' + call + '\n' };
      assert.deepEqual(consoleProblems(bad), [name]);
    }
  }
  const comment = {
    ...files,
    'App.tsx': files['App.tsx'] + '\n// console.log(1)\n',
  };
  assert.deepEqual(consoleProblems(comment), []);
});

// ---------------------------------------------------------------- pin 2
const KT_PREFIX_GROUPS: Array<[string, string]> = [
  ['TRANSPORT_', 'NATIVE_TRANSPORTS'],
  ['STATE_', 'NATIVE_PRINTER_STATES'],
  ['BT_', 'NATIVE_BLUETOOTH_STATES'],
  ['EVENT_', 'NATIVE_EVENTS'],
];
const BRIDGE_GROUPS = [
  'NATIVE_ERROR_CODES',
  'NATIVE_TRANSPORTS',
  'NATIVE_PRINTER_STATES',
  'NATIVE_BLUETOOTH_STATES',
  'NATIVE_EVENTS',
];

function bridgeCodeProblems(ktSource: string, tsSource: string): string[] {
  const k = strip(ktSource);
  const t = strip(tsSource);
  const out: string[] = [];
  const groups: Record<string, string[]> = {};
  const byName: Record<string, string> = {};
  for (const g of BRIDGE_GROUPS) {
    groups[g] = [];
  }
  for (const m of k.matchAll(/const val (\w+)\s*=\s*"([^"]*)"/g)) {
    byName[m[1]] = m[2];
    if (m[1] === 'PLATFORM') {
      continue;
    }
    const hit = KT_PREFIX_GROUPS.find(([prefix]) => m[1].startsWith(prefix));
    groups[hit ? hit[1] : 'NATIVE_ERROR_CODES'].push(m[2]);
  }
  for (const g of BRIDGE_GROUPS) {
    const js = tsList(t, g);
    if (js.length === 0 || groups[g].length === 0) {
      out.push(g + ': empty on one side');
    }
    out.push(...setProblems(g, groups[g], js));
  }
  const kv = /const val BRIDGE_VERSION\s*=\s*(\d+)/.exec(k)?.[1];
  const tv = /export const NATIVE_BRIDGE_VERSION\s*=\s*(\d+)/.exec(t)?.[1];
  if (kv === undefined || kv !== tv) {
    out.push('BRIDGE_VERSION ' + kv + ' != NATIVE_BRIDGE_VERSION ' + tv);
  }
  const list = /val TRANSPORTS: List<String> =\s*listOf\(([^)]*)\)/.exec(k);
  const listed = (list ? list[1].split(',') : [])
    .map(s => s.trim())
    .filter(Boolean)
    .map(n => byName[n]);
  if (listed.join('|') !== tsList(t, 'NATIVE_TRANSPORTS').join('|')) {
    out.push('TRANSPORTS listOf order differs from NATIVE_TRANSPORTS');
  }
  return out;
}

test('pin 2: BridgeCodes.kt strings equal the protocol.ts lists', () => {
  const ts = read(join(SRC, 'bridge', 'protocol.ts'));
  assert.deepEqual(bridgeCodeProblems(kt('BridgeCodes.kt'), ts), []);
  assert.deepEqual(tsList(ts, 'NATIVE_TRANSPORTS'), [
    'bt-classic',
    'ble',
    'tcp',
    'usb',
  ]);
});

test('pin 2 mutation: drift on either side is caught', () => {
  const ts = read(join(SRC, 'bridge', 'protocol.ts'));
  const source = kt('BridgeCodes.kt');
  const table: Mutation[] = [
    ['"WRITE_FAILED"', '"WRITE_FAIL"'],
    ['"bt-classic"', '"bt_classic"'],
    ['"connecting"', '"connectin"'],
    ['"unsupported"', '"unsupportedX"'],
    ['"app.wake"', '"app.wakeup"'],
    ['const val BRIDGE_VERSION = 1', 'const val BRIDGE_VERSION = 2'],
    ['const val PLATFORM = "android"', 'const val EXTRA_CODE = "EXTRA"'],
    [
      'listOf(TRANSPORT_BT_CLASSIC, TRANSPORT_BLE,',
      'listOf(TRANSPORT_BLE, TRANSPORT_BT_CLASSIC,',
    ],
  ];
  everyMutationCaught(s => bridgeCodeProblems(s, ts), source, table);
  const tsTable: Mutation[] = [
    ["'ble'", "'bluetooth-le'"],
    ["'TIMEOUT'", "'TIMED_OUT'"],
    ['NATIVE_BRIDGE_VERSION = 1', 'NATIVE_BRIDGE_VERSION = 3'],
    ["'disconnected',", ''],
    ["'on',", ''],
  ];
  everyMutationCaught(s => bridgeCodeProblems(source, s), ts, tsTable);
});

// ---------------------------------------------------------------- pin 3
function scanMsProblems(tsSource: string, ktFiles: Files): string[] {
  const out: string[] = [];
  const js = /export const PRINTER_SCAN_MS\s*=\s*([\d_]+)\s*;/.exec(
    strip(tsSource),
  );
  const jsValue = js ? Number(js[1].replace(/_/g, '')) : NaN;
  if (jsValue !== SCAN_MS) {
    out.push('protocol.ts PRINTER_SCAN_MS is ' + jsValue);
  }
  const decls: Array<[string, number]> = [];
  for (const [name, text] of Object.entries(ktFiles)) {
    for (const m of strip(text).matchAll(
      /const val PRINTER_SCAN_MS\s*=\s*([\d_]+)L?\b/g,
    )) {
      decls.push([name, Number(m[1].replace(/_/g, ''))]);
    }
  }
  if (decls.length !== 1) {
    out.push('Kotlin declares PRINTER_SCAN_MS ' + decls.length + ' times');
  } else if (!decls[0][0].endsWith('ScanSession.kt')) {
    out.push('declared in ' + decls[0][0]);
  } else if (decls[0][1] !== SCAN_MS) {
    out.push('Kotlin PRINTER_SCAN_MS is ' + decls[0][1]);
  }
  return out;
}
const allKt = () => loadAll(listFiles(KT_DIR, isKt));

test('pin 3: PRINTER_SCAN_MS is 8_000 on both sides', () => {
  const ts = read(join(SRC, 'bridge', 'protocol.ts'));
  const files = allKt();
  assert.ok(Object.keys(files).length >= MIN_KT_FILES, 'vision guard');
  assert.ok(/PRINTER_SCAN_MS\s*=\s*8_000L/.test(strip(kt('ScanSession.kt'))));
  assert.ok(/PRINTER_SCAN_MS\s*=\s*8_000;/.test(strip(ts)));
  assert.deepEqual(scanMsProblems(ts, files), []);
});

test('pin 3 mutation: either value, a duplicate, or a move is caught', () => {
  const ts = read(join(SRC, 'bridge', 'protocol.ts'));
  const files = allKt();
  const scan =
    'android/app/src/main/java/com/possoftware/pos/printer/ScanSession.kt';
  assert.ok(scan in files);
  const table: Mutation[] = [
    ['PRINTER_SCAN_MS = 8_000L', 'PRINTER_SCAN_MS = 9_000L'],
    ['const val PRINTER_SCAN_MS = 8_000L', 'val SCAN_MS_RENAMED = 8_000L'],
    [
      'const val PRINTER_SCAN_MS = 8_000L',
      'const val PRINTER_SCAN_MS = 8_000L\n    const val PRINTER_SCAN_MS = 8_000L',
    ],
  ];
  everyMutationCaught(
    s => scanMsProblems(ts, { ...files, [scan]: s }),
    files[scan],
    table,
  );
  everyMutationCaught(s => scanMsProblems(s, files), ts, [
    ['PRINTER_SCAN_MS = 8_000', 'PRINTER_SCAN_MS = 7_000'],
  ]);
});

// ---------------------------------------------------------------- pin 4
function methodProblems(ktModule: string, jsWrapper: string): string[] {
  const k = strip(ktModule);
  const j = strip(jsWrapper);
  const out: string[] = [];
  const kotlin = [...k.matchAll(/@ReactMethod\s+fun\s+(\w+)\s*\(/g)].map(
    m => m[1],
  );
  const calls = [...j.matchAll(/\bcall\(\s*'(\w+)'/g)].map(m => m[1]);
  const iface = /export interface PosPrinterModule\s*\{([\s\S]*?)\n\}/.exec(j);
  const declared = iface
    ? [...iface[1].matchAll(/^ {2}(\w+)\(/gm)].map(m => m[1])
    : [];
  out.push(...setProblems('kotlin vs oracle', kotlin, NATIVE_METHOD_ORACLE));
  out.push(...setProblems('js calls vs oracle', calls, NATIVE_METHOD_ORACLE));
  out.push(
    ...setProblems('js interface vs oracle', declared, NATIVE_METHOD_ORACLE),
  );
  return out;
}
function moduleNameProblems(ktModule: string, jsWrapper: string): string[] {
  const k = strip(ktModule);
  const j = strip(jsWrapper);
  const out: string[] = [];
  const name = /const val NAME\s*=\s*"(\w+)"/.exec(k)?.[1];
  const lookup = /NativeModules as \{\s*(\w+)\?:/.exec(j)?.[1];
  if (name !== 'PosPrinter') {
    out.push('Kotlin NAME is ' + name);
  }
  if (lookup !== 'PosPrinter') {
    out.push('JS lookup is ' + lookup);
  }
  if (!/override fun getName\(\): String = NAME\b/.test(k)) {
    out.push('getName() does not return NAME');
  }
  if (!/NativeModules as \{[^}]*\}\)\s*\.PosPrinter;/.test(j)) {
    out.push('JS never reads the module');
  }
  return out;
}

test('pin 4: JS wrapper and Kotlin @ReactMethod list equal the oracle', () => {
  const module = kt('PosPrinterModule.kt');
  const js = read(join(SRC, 'native', 'PosPrinter.ts'));
  assert.equal(NATIVE_METHOD_ORACLE.length, 18);
  assert.ok(strip(module).includes('@ReactMethod'), 'landmark');
  assert.deepEqual(methodProblems(module, js), []);
  assert.deepEqual(moduleNameProblems(module, js), []);
});

test('pin 4 mutation: a renamed, dropped or extra method is caught', () => {
  const module = kt('PosPrinterModule.kt');
  const js = read(join(SRC, 'native', 'PosPrinter.ts'));
  everyMutationCaught(s => methodProblems(s, js), module, [
    ['fun selectTcp(', 'fun selectTcpHost('],
    ['@ReactMethod\n  fun deliverScript(', 'fun deliverScript('],
    [
      '@ReactMethod\n  fun forget(',
      '@ReactMethod\n  fun extraThing(promise: Promise) {}\n\n  @ReactMethod\n  fun forget(',
    ],
  ]);
  everyMutationCaught(s => methodProblems(module, s), js, [
    ["call('moveTaskToBack')", "call('moveTask')"],
    ["clearOrigin: () => call('clearOrigin'),", ''],
    ['  deliverScript(script: string): Promise<null>;\n', ''],
  ]);
  everyMutationCaught(s => moduleNameProblems(s, js), module, [
    ['const val NAME = "PosPrinter"', 'const val NAME = "PosPrinters"'],
    [
      'override fun getName(): String = NAME',
      'override fun getName(): String = "X"',
    ],
  ]);
  everyMutationCaught(s => moduleNameProblems(module, s), js, [
    ['NativeModules as { PosPrinter?:', 'NativeModules as { PosPrinterX?:'],
  ]);
});

// ---------------------------------------------------------------- pin 5
function mainApplicationProblems(text: string): string[] {
  const code = strip(text);
  const out: string[] = [];
  if (!/^\s*add\(PosPrinterPackage\(\)\)\s*$/m.test(code)) {
    out.push('add(PosPrinterPackage()) missing');
  }
  if (
    !/^import com\.possoftware\.pos\.printer\.PosPrinterPackage\s*$/m.test(code)
  ) {
    out.push('PosPrinterPackage import missing');
  }
  if (!code.includes('PackageList(this).packages.apply')) {
    out.push('landmark: packages.apply block missing');
  }
  return out;
}
const mainApplication = () =>
  read(join(JAVA, 'com', 'possoftware', 'pos', 'MainApplication.kt'));

test('pin 5: MainApplication registers PosPrinterPackage', () => {
  assert.deepEqual(mainApplicationProblems(mainApplication()), []);
  const pkg = strip(kt('PosPrinterPackage.kt'));
  assert.ok(/^package com\.possoftware\.pos\.printer\s*$/m.test(pkg));
  assert.ok(/class PosPrinterPackage\b/.test(pkg));
});

test('pin 5 mutation: commented-out or missing wiring is caught', () => {
  everyMutationCaught(mainApplicationProblems, mainApplication(), [
    [
      '          add(PosPrinterPackage())',
      '          // add(PosPrinterPackage())',
    ],
    ['add(PosPrinterPackage())', 'add(OtherPackage())'],
    ['import com.possoftware.pos.printer.PosPrinterPackage', ''],
  ]);
});

// ---------------------------------------------------------------- pin 6
function manifestProblems(xml: string): string[] {
  const x = strip(xml);
  const out: string[] = [];
  const perms = new Map<string, string>();
  for (const m of x.matchAll(/<uses-permission\b[^>]*>/g)) {
    const name = /android:name="android\.permission\.(\w+)"/.exec(m[0]);
    if (name) {
      perms.set(name[1], m[0]);
    }
  }
  if (
    perms.size < 10 ||
    !x.includes('<application') ||
    !x.includes('<activity')
  ) {
    out.push('landmark: permissions/application/activity not found');
  }
  const maxSdk = x.match(/android:maxSdkVersion=/g) ?? [];
  const max30 = x.match(/android:maxSdkVersion="30"/g) ?? [];
  if (
    maxSdk.length !== MANIFEST_MAX_SDK_COUNT ||
    max30.length !== maxSdk.length
  ) {
    out.push(
      'maxSdkVersion="30" count is ' + max30.length + ' of ' + maxSdk.length,
    );
  }
  for (const n of ['BLUETOOTH', 'BLUETOOTH_ADMIN', 'ACCESS_FINE_LOCATION']) {
    if (!perms.get(n)?.includes('android:maxSdkVersion="30"')) {
      out.push(n + ' lacks maxSdkVersion 30');
    }
  }
  if (!perms.get('BLUETOOTH_SCAN')?.includes('neverForLocation')) {
    out.push('BLUETOOTH_SCAN lacks neverForLocation');
  }
  for (const n of [
    'BLUETOOTH_CONNECT',
    'FOREGROUND_SERVICE_CONNECTED_DEVICE',
    'POST_NOTIFICATIONS',
  ]) {
    if (!perms.has(n)) {
      out.push(n + ' missing');
    }
  }
  const service = [...x.matchAll(/<service\b[^>]*>/g)]
    .map(m => m[0])
    .find(tag => tag.includes('android:name=".printer.PrintHostService"'));
  if (!service) {
    out.push('PrintHostService missing');
  } else {
    for (const need of [
      'android:exported="false"',
      'android:foregroundServiceType="connectedDevice"',
    ]) {
      if (!service.includes(need)) {
        out.push('PrintHostService lacks ' + need);
      }
    }
  }
  const app = /<application\b[^>]*>/.exec(x)?.[0] ?? '';
  if (
    !app.includes(
      'android:networkSecurityConfig="@xml/network_security_config"',
    )
  ) {
    out.push('networkSecurityConfig missing');
  }
  const activity = /<activity\b[\s\S]*?<\/activity>/.exec(x)?.[0] ?? '';
  const usb = 'android.hardware.usb.action.USB_DEVICE_ATTACHED';
  const filters =
    activity.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? [];
  if (!filters.some(f => f.includes('<action android:name="' + usb + '"'))) {
    out.push('USB_DEVICE_ATTACHED intent-filter missing');
  }
  const meta = [...activity.matchAll(/<meta-data\b[^>]*>/g)]
    .map(m => m[0])
    .find(tag => tag.includes('android:name="' + usb + '"'));
  if (!meta?.includes('android:resource="@xml/usb_printer_filter"')) {
    out.push('USB meta-data does not point at @xml/usb_printer_filter');
  }
  if (/<receiver\b/.test(x)) {
    out.push('a <receiver> element exists');
  }
  return out;
}
const manifest = () => read(join(MAIN, 'AndroidManifest.xml'));

test('pin 6: AndroidManifest permissions, service, USB and no receiver', () => {
  assert.deepEqual(manifestProblems(manifest()), []);
  const raw = manifest();
  assert.ok(
    raw.includes('<service'),
    'positive landmark beside the receiver pin',
  );
  assert.ok(existsSync(join(MAIN, 'res', 'xml', 'usb_printer_filter.xml')));
  assert.ok(
    existsSync(join(MAIN, 'res', 'xml', 'network_security_config.xml')),
  );
});

test('pin 6 mutation: every manifest needle can fail', () => {
  const perm = (n: string) => 'android:name="android.permission.' + n + '"';
  const table: Mutation[] = [
    [perm('BLUETOOTH') + ' android:maxSdkVersion="30"', perm('BLUETOOTH')],
    [
      perm('ACCESS_FINE_LOCATION') + ' android:maxSdkVersion="30"',
      perm('ACCESS_FINE_LOCATION'),
    ],
    [
      perm('BLUETOOTH_ADMIN') + ' android:maxSdkVersion="30"',
      perm('BLUETOOTH_ADMIN') + ' android:maxSdkVersion="31"',
    ],
    [
      '<uses-feature android:name="android.hardware.bluetooth" ',
      '<uses-permission android:name="android.permission.NFC" android:maxSdkVersion="30" /><uses-feature android:name="android.hardware.bluetooth" ',
    ],
    ['android:usesPermissionFlags="neverForLocation"', ''],
    [perm('BLUETOOTH_CONNECT'), perm('BLUETOOTH_CONNECTX')],
    [
      perm('FOREGROUND_SERVICE_CONNECTED_DEVICE'),
      perm('FOREGROUND_SERVICE_DATA_SYNC'),
    ],
    [perm('POST_NOTIFICATIONS'), perm('POST_NOTIFICATIONSX')],
    [
      'android:name=".printer.PrintHostService"',
      'android:name=".printer.OtherService"',
    ],
    ['android:exported="false"', 'android:exported="true"'],
    [
      'android:foregroundServiceType="connectedDevice"',
      'android:foregroundServiceType="dataSync"',
    ],
    ['android:networkSecurityConfig="@xml/network_security_config"', ''],
    [
      '<action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />',
      '',
    ],
    [
      'android:resource="@xml/usb_printer_filter"',
      'android:resource="@xml/other_filter"',
    ],
    [
      '</application>',
      '<receiver android:name=".BootReceiver" android:exported="false" /></application>',
    ],
  ];
  everyMutationCaught(manifestProblems, manifest(), table);
  const hidden = mutated(
    manifest(),
    '</application>',
    '<!-- <receiver android:name=".X" /> --></application>',
  );
  assert.deepEqual(
    manifestProblems(hidden),
    [],
    'a commented receiver is not an element',
  );
});

// ---------------------------------------------------------------- pin 7
function webkitProblems(gradle: string, libProps: string | null): string[] {
  const g = strip(gradle);
  const out: string[] = [];
  const decls = [
    ...g.matchAll(
      /implementation\s*\(?\s*["']androidx\.webkit:webkit:([^"']+)["']/g,
    ),
  ];
  if (decls.length !== 1 || decls[0][1] !== WEBKIT_VERSION) {
    out.push(
      'app declares ' +
        decls.map(d => d[1]).join(',') +
        ' (want one of ' +
        WEBKIT_VERSION +
        ')',
    );
  }
  if (libProps !== null) {
    const lib = /ReactNativeWebView_webkitVersion\s*=\s*(\S+)/.exec(
      libProps,
    )?.[1];
    if (lib !== WEBKIT_VERSION) {
      out.push('react-native-webview names ' + lib);
    }
  }
  return out;
}

test('pin 7: androidx.webkit is exactly the react-native-webview version', () => {
  const props = existsSync(WEBVIEW_PROPS) ? read(WEBVIEW_PROPS) : null;
  assert.deepEqual(webkitProblems(read(GRADLE_APP), props), []);
  assert.ok(
    props !== null,
    'node_modules webview gradle.properties not found: library half skipped',
  );
});

test('pin 7 mutation: either version drifting is caught', () => {
  const props = read(WEBVIEW_PROPS);
  everyMutationCaught(s => webkitProblems(s, props), read(GRADLE_APP), [
    ['androidx.webkit:webkit:1.14.0', 'androidx.webkit:webkit:1.13.0'],
    ['implementation "androidx.webkit:webkit:1.14.0"', '// gone'],
    [
      'implementation "androidx.webkit:webkit:1.14.0"',
      'implementation "androidx.webkit:webkit:1.14.0"\n    implementation "androidx.webkit:webkit:1.14.0"',
    ],
  ]);
  everyMutationCaught(s => webkitProblems(read(GRADLE_APP), s), props, [
    ['webkitVersion=1.14.0', 'webkitVersion=1.15.0'],
  ]);
});

// ---------------------------------------------------------------- pin 8
function packageProblems(pkgText: string, existing: string[]): string[] {
  const out: string[] = [];
  const pkg = JSON.parse(pkgText) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  if (pkg.dependencies?.['react-native-webview'] !== WEBVIEW_VERSION) {
    out.push(
      'react-native-webview is ' + pkg.dependencies?.['react-native-webview'],
    );
  }
  const script = /^node --import tsx --test (.+)$/.exec(
    pkg.scripts?.test ?? '',
  );
  if (!script) {
    out.push('test script has an unexpected shape');
    return out;
  }
  out.push(
    ...setProblems(
      'test script vs src/**/*.test.ts',
      script[1].trim().split(/\s+/),
      existing,
    ),
  );
  return out;
}
const existingTests = () =>
  listFiles(SRC, n => /\.test\.tsx?$/.test(n)).map(f =>
    relative(ROOT, f).split(sep).join('/'),
  );

test('pin 8: webview is pinned exact and npm test lists every test file', () => {
  const found = existingTests();
  assert.ok(
    found.includes('src/mobile-paths.test.ts'),
    'vision guard: this file counted',
  );
  assert.ok(found.length >= 5);
  assert.deepEqual(
    packageProblems(read(join(ROOT, 'package.json')), found),
    [],
  );
});

test('pin 8 mutation: range, missing, ghost and duplicate entries are caught', () => {
  const text = read(join(ROOT, 'package.json'));
  const found = existingTests();
  everyMutationCaught(s => packageProblems(s, found), text, [
    ['"react-native-webview": "14.0.1"', '"react-native-webview": "^14.0.1"'],
    ['"react-native-webview": "14.0.1"', '"react-native-webview": "~14.0.1"'],
    ['"react-native-webview": "14.0.1"', '"react-native-webview": "14.0.2"'],
    [' src/url.test.ts', ''],
    [' src/mobile-paths.test.ts', ' src/ghost.test.ts'],
    [' src/url.test.ts', ' src/url.test.ts src/url.test.ts'],
  ]);
  assert.ok(
    packageProblems(text, [...found, 'src/new-suite.test.ts']).length > 0,
  );
});

// ---------------------------------------------------------------- pin 9
const README_KEYS: Array<[string, string]> = [
  ['compileSdkVersion', 'compileSdk\\s+'],
  ['buildToolsVersion', 'build-tools\\s+'],
  ['ndkVersion', 'NDK\\s+'],
  ['kotlinVersion', 'Kotlin\\s+'],
];
function readmeProblems(
  gradle: string,
  readme: string,
  pkgText: string,
): string[] {
  const g = strip(gradle);
  const out: string[] = [];
  for (const [key, label] of README_KEYS) {
    const value = new RegExp(key + '\\s*=\\s*"?([\\w.]+)"?').exec(g)?.[1];
    if (value === undefined) {
      out.push(key + ' not found in build.gradle');
    } else if (
      !new RegExp(label + escapeRe(value) + '(?![\\w.])', 'i').test(readme)
    ) {
      out.push('README does not quote ' + key + ' ' + value);
    }
  }
  const node = (JSON.parse(pkgText) as { engines?: { node?: string } }).engines
    ?.node;
  const v = /(\d+)\.(\d+)\.(\d+)/.exec(node ?? '');
  if (!v) {
    out.push('engines.node not parseable');
  } else {
    const forms = [v[0], ...(v[3] === '0' ? [v[1] + '.' + v[2]] : [])];
    if (
      !forms.some(f =>
        new RegExp('Node[^\\n]*?' + escapeRe(f) + '(?![\\d.])').test(readme),
      )
    ) {
      out.push('README does not quote Node ' + v[0]);
    }
  }
  return out;
}

test('pin 9: README quotes the build.gradle template values and engines.node', () => {
  const run = (g: string, r: string, p: string) => readmeProblems(g, r, p);
  const gradle = read(GRADLE_ROOT);
  assert.ok(/ext\s*\{/.test(strip(gradle)), 'landmark: ext block');
  assert.deepEqual(
    run(
      gradle,
      read(join(ROOT, 'README.md')),
      read(join(ROOT, 'package.json')),
    ),
    [],
  );
});

test('pin 9 mutation: gradle, README or engines drifting is caught', () => {
  const gradle = read(GRADLE_ROOT);
  const readme = read(join(ROOT, 'README.md'));
  const pkg = read(join(ROOT, 'package.json'));
  everyMutationCaught(s => readmeProblems(gradle, s, pkg), readme, [
    ['compileSdk 37', 'compileSdk 36'],
    ['build-tools 37.0.0', 'build-tools 36.0.0'],
    ['27.1.12297006, Kotlin', '27.0.0, Kotlin'],
    ['Kotlin 2.2.0', 'Kotlin 2.1.0'],
    ['22.13 or newer', '22.12 or newer'],
  ]);
  everyMutationCaught(s => readmeProblems(s, readme, pkg), gradle, [
    ['compileSdkVersion = 37', 'compileSdkVersion = 38'],
    ['buildToolsVersion = "37.0.0"', 'buildToolsVersion = "38.0.0"'],
    ['ndkVersion = "27.1.12297006"', 'ndkVersion = "28.0.0"'],
    ['kotlinVersion = "2.2.0"', 'kotlinVersion = "2.3.0"'],
  ]);
  everyMutationCaught(s => readmeProblems(gradle, readme, s), pkg, [
    ['>= 22.13.0', '>= 22.14.0'],
  ]);
});

// --------------------------------------------------------------- pin 10
const WEBVIEW_NEEDLES = [
  'setSupportMultipleWindows={false}',
  'mixedContentMode="never"',
  'allowFileAccess={false}',
  'allowFileAccessFromFileURLs={false}',
  'allowUniversalAccessFromFileURLs={false}',
  "originWhitelist={['*']}",
  'onShouldStartLoadWithRequest=',
  'webviewDebuggingEnabled={__DEV__}',
  'source={source}',
  'onLoadEnd={onLoadEnd}',
];
function posScreenProblems(text: string): string[] {
  const code = strip(text);
  const out: string[] = [];
  const element = /<WebView\b[\s\S]*?\n\s*\/>/.exec(code)?.[0] ?? '';
  if (element === '') {
    out.push('landmark: <WebView ... /> element not found');
  }
  for (const needle of WEBVIEW_NEEDLES) {
    if (!element.includes(needle)) {
      out.push('WebView lacks ' + needle);
    }
  }
  if ((code.match(/originWhitelist=/g) ?? []).length !== 1) {
    out.push('originWhitelist must appear exactly once');
  }
  if (!code.includes('documentStart === null ? undefined')) {
    out.push('source is not withheld until attach');
  }
  const body =
    /const onLoadEnd = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[/.exec(
      code,
    )?.[1] ?? '';
  const attach = body.indexOf('PosPrinter.attachWebView(');
  const guard = body.indexOf('attachedRef.current');
  if (attach < 0) {
    out.push('onLoadEnd never re-attaches');
  } else if (guard < 0 || guard > attach) {
    out.push('onLoadEnd re-attach is not guarded by attachedRef.current');
  }
  if ((code.match(/attachedRef\.current = true/g) ?? []).length < 2) {
    out.push('attachedRef is not set by both attach paths');
  }
  return out;
}
const posScreen = () => read(join(SRC, 'screens', 'PosScreen.tsx'));

test('pin 10: PosScreen WebView security props and re-attach guard', () => {
  assert.deepEqual(posScreenProblems(posScreen()), []);
});

test('pin 10 mutation: every prop, the withheld source and the guard can fail', () => {
  const table: Mutation[] = WEBVIEW_NEEDLES.map(n => [n, '']);
  table.push(
    ['mixedContentMode="never"', 'mixedContentMode="always"'],
    ['allowFileAccess={false}', 'allowFileAccess={true}'],
    ["originWhitelist={['*']}", "originWhitelist={['https://*']}"],
    [
      'documentStart === null ? undefined',
      'documentStart === false ? undefined',
    ],
    ['attachedRef.current || script === null', 'script === null'],
    [
      'PosPrinter.attachWebView(tag, script, origin).then(() => {',
      'noop(() => {',
    ],
    ['      attachedRef.current = true;\n    }, noop);', '    }, noop);'],
  );
  everyMutationCaught(posScreenProblems, posScreen(), table);
});

// --------------------------------------------------------------- pin 11
interface DeliverySources {
  delivery: string;
  manager: string;
  api: string;
  service: string;
}
function deliveryProblems(s: DeliverySources): string[] {
  const out: string[] = [];
  const d = strip(s.delivery);
  if (
    !d.includes('fun deliverScript(') ||
    !/webView\?\.get\(\)\?\.evaluateJavascript\(/.test(d)
  ) {
    out.push('landmark: WebViewDelivery does not call evaluateJavascript');
  }
  for (const banned of [
    'dispatchViewManagerCommand',
    'dispatchCommand',
    'receiveCommand',
    'sendEvent',
    'emit(',
  ]) {
    if (d.includes(banned)) {
      out.push('WebViewDelivery uses a React route: ' + banned);
    }
  }
  const arr = /ESCAPED_CODES\s*=\s*intArrayOf\(([^)]*)\)/.exec(d)?.[1] ?? '';
  const codes = arr
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => Number(x));
  out.push(
    ...setProblems(
      'escaped codes',
      codes.map(String),
      ESCAPED_CODES.map(String),
    ),
  );
  if (!d.includes('ESCAPED_CODES.contains(ch.code)')) {
    out.push('escapeForScript does not use ESCAPED_CODES');
  }
  const publish =
    /fun publish\(\)[\s\S]*?\n {2}\}\n/.exec(strip(s.manager))?.[0] ?? '';
  if (
    !publish.includes(
      'WebViewDelivery.deliverEvent(BridgeCodes.EVENT_PRINTER_STATUS,',
    )
  ) {
    out.push(
      'PrinterManager.publish() does not deliver printer.status natively',
    );
  }
  const api = strip(s.api);
  if (!api.includes('PrinterManager.publish()')) {
    out.push('PrinterApi never publishes through PrinterManager');
  }
  for (const banned of ['DeviceEventManagerModule', 'sendEvent', 'emit(']) {
    if (api.includes(banned)) {
      out.push('PrinterApi bypasses native delivery: ' + banned);
    }
  }
  const svc = strip(s.service);
  const wake =
    /if\s*\(\s*!PrinterManager\.appVisible\s*\)\s*\{\s*WebViewDelivery\.deliverEvent\(BridgeCodes\.EVENT_APP_WAKE,/;
  if (!wake.test(svc)) {
    out.push('app.wake is not gated on !PrinterManager.appVisible');
  }
  if ((svc.match(/EVENT_APP_WAKE/g) ?? []).length !== 1) {
    out.push('app.wake must be delivered from exactly one place');
  }
  return out;
}
const deliverySources = (): DeliverySources => ({
  delivery: kt('WebViewDelivery.kt'),
  manager: kt('PrinterManager.kt'),
  api: kt('PrinterApi.kt'),
  service: kt('PrintHostService.kt'),
});

test('pin 11: delivery is native-direct, escaped, and wake is gated', () => {
  assert.deepEqual(deliveryProblems(deliverySources()), []);
});

test('pin 11 mutation: React routes, weaker escapes and ungated wake are caught', () => {
  const base = deliverySources();
  const run = (key: keyof DeliverySources) => (s: string) =>
    deliveryProblems({ ...base, [key]: s });
  everyMutationCaught(run('delivery'), base.delivery, [
    [
      'webView?.get()?.evaluateJavascript(script, null)',
      'webView?.get()?.dispatchCommand(script, null)',
    ],
    [
      'intArrayOf(0x2028, 0x2029, 0x3C, 0x3E, 0x26)',
      'intArrayOf(0x2028, 0x2029, 0x3C, 0x3E)',
    ],
    [
      'intArrayOf(0x2028, 0x2029, 0x3C, 0x3E, 0x26)',
      'intArrayOf(0x2029, 0x3C, 0x3E, 0x26)',
    ],
    [
      'intArrayOf(0x2028, 0x2029, 0x3C, 0x3E, 0x26)',
      'intArrayOf(0x2028, 0x2029, 0x3C, 0x3E, 0x26, 0x22)',
    ],
    ['ESCAPED_CODES.contains(ch.code)', 'false'],
  ]);
  everyMutationCaught(run('manager'), base.manager, [
    [
      'WebViewDelivery.deliverEvent(BridgeCodes.EVENT_PRINTER_STATUS,',
      'sendEvent(BridgeCodes.EVENT_PRINTER_STATUS,',
    ],
    [
      'WebViewDelivery.deliverEvent(BridgeCodes.EVENT_PRINTER_STATUS,',
      'WebViewDelivery.deliverEvent(BridgeCodes.EVENT_APP_WAKE,',
    ],
  ]);
  everyMutationCaught(run('api'), base.api, [
    ['PrinterManager.publish()', 'PrinterManager.status()'],
    [
      'fun onBluetoothStateChanged() {',
      'fun onBluetoothStateChanged() {\n    DeviceEventManagerModule.noop()',
    ],
  ]);
  everyMutationCaught(run('service'), base.service, [
    ['if (!PrinterManager.appVisible) {', 'if (PrinterManager.appVisible) {'],
    ['if (!PrinterManager.appVisible) {', 'run {'],
  ]);
});

// --------------------------------------------------------------- pin 12
function lineSeparatorProblems(files: Files): string[] {
  return Object.keys(files).filter(
    name => files[name].includes(LS) || files[name].includes(PS),
  );
}
function separatorScope(): Files {
  return loadAll([
    join(ROOT, 'App.tsx'),
    ...listFiles(SRC, isTs),
    ...listFiles(JAVA, isKt),
  ]);
}

test('pin 12: no literal U+2028 or U+2029 in src ts(x) or Kotlin', () => {
  const files = separatorScope();
  const names = Object.keys(files);
  assert.ok(
    names.filter(n => isTs(n)).length >= MIN_TS_FILES,
    'vision guard: ts files',
  );
  assert.ok(
    names.filter(n => isKt(n)).length >= MIN_KT_FILES,
    'vision guard: kt files',
  );
  assert.ok(
    names.includes('src/bridge/injected.ts'),
    'landmark: the file that handles the escapes',
  );
  assert.ok(
    files['src/mobile-paths.test.ts'] !== undefined,
    'this file is scanned too',
  );
  assert.deepEqual(lineSeparatorProblems(files), []);
});

test('pin 12 mutation: either character in either language is caught', () => {
  const files = separatorScope();
  const ts = 'src/bridge/injected.ts';
  const ktName =
    'android/app/src/main/java/com/possoftware/pos/printer/WebViewDelivery.kt';
  assert.ok(ktName in files);
  for (const name of [ts, ktName]) {
    for (const ch of [LS, PS]) {
      const bad = { ...files, [name]: files[name] + 'x' + ch + 'y' };
      assert.deepEqual(lineSeparatorProblems(bad), [name]);
    }
  }
});

// --------------------------------------------------------------- pin 13
// The POS screen's self-healing wiring (FX-D2): top-frame backstop, start-page
// HTTP errors, automatic retry that never runs while backgrounded, and the
// per-load nonce in request ids. Behaviour is unit-tested elsewhere; this pins
// that the pieces stay connected to the screen and the injected script.
interface SelfHealSources {
  screen: string;
  guards: string;
  hook: string;
  error: string;
  injected: string;
}
function selfHealProblems(s: SelfHealSources): string[] {
  const out: string[] = [];
  const screen = strip(s.screen);
  const element = /<WebView\b[\s\S]*?\n\s*\/>/.exec(screen)?.[0] ?? '';
  if (element === '') {
    out.push('landmark: <WebView ... /> element not found');
  }
  for (const needle of [
    'onLoadStart={onLoadStart}',
    'onNavigationStateChange={onNavigationStateChange}',
    'onHttpError={onHttpError}',
  ]) {
    if (!element.includes(needle)) {
      out.push('WebView lacks ' + needle);
    }
  }
  const guards = strip(s.guards);
  if (!screen.includes('useLoadGuards({')) {
    out.push('the screen does not use the load guards');
  }
  if (!guards.includes('guardTopFrame(event.nativeEvent.url)')) {
    out.push('onLoadStart does not run the top-frame backstop');
  }
  if (!guards.includes('guardTopFrame(nav.url)')) {
    out.push('onNavigationStateChange does not run the top-frame backstop');
  }
  if (
    !/isStartPageFailure\(url, statusCode, origin\)\) \{\s*onLoadError\(\)/.test(
      guards,
    )
  ) {
    out.push(
      'onHttpError does not send a start-page failure to the error screen',
    );
  }
  if (!screen.includes('onAutoRetry={retryAutomatically}')) {
    out.push('the error screen is not given an automatic retry');
  }
  const hook = strip(s.hook);
  const order = [
    'web?.stopLoading()',
    'spendRecovery(',
    "action === 'recover-and-open'",
    'openExternal(url)',
    'web?.injectJavaScript(',
  ].map(needle => hook.indexOf(needle));
  if (
    order.some(at => at < 0) ||
    order.some((at, i) => i > 0 && at < order[i - 1])
  ) {
    out.push('backstop steps are missing or out of order: ' + order.join(','));
  }
  if (!hook.includes('window.location.replace(')) {
    out.push('backstop does not return to the start page');
  }
  const error = strip(s.error);
  if (!error.includes('AppState.addEventListener(')) {
    out.push('error screen does not follow AppState');
  }
  if (!error.includes('canAutoRetry(autoRetriesUsed, appState)')) {
    out.push('error screen retries without the active-app check');
  }
  if (!error.includes('setTimeout(onAutoRetry, RETRY_DELAY_MS)')) {
    out.push('error screen has no retry timer');
  }
  if (!error.includes('return () => clearTimeout(timer)')) {
    out.push('retry timer is not cleared');
  }
  if (/setInterval\(/.test(error)) {
    out.push('error screen uses setInterval');
  }
  const inj = strip(s.injected);
  if (!inj.includes('window.crypto.getRandomValues(bytes)')) {
    out.push('injected script has no crypto nonce');
  }
  if (!inj.includes('var id = "r" + NONCE + "-" + (seq += 1);')) {
    out.push('request ids do not carry the nonce');
  }
  if (!inj.includes('var NONCE = makeNonce();')) {
    out.push('the nonce is not made once per load');
  }
  return out;
}
const selfHealSources = (): SelfHealSources => ({
  screen: posScreen(),
  guards: read(join(SRC, 'screens', 'use-load-guards.ts')),
  hook: read(join(SRC, 'screens', 'use-top-frame-backstop.ts')),
  error: read(join(SRC, 'screens', 'LoadErrorScreen.tsx')),
  injected: read(join(SRC, 'bridge', 'injected.ts')),
});

test('pin 13: backstop, start-page errors, auto-retry and the id nonce stay wired', () => {
  const s = selfHealSources();
  assert.deepEqual(selfHealProblems(s), []);
  assert.ok(strip(s.error).includes('<Pressable'), 'landmark: error screen UI');
});

test('pin 13 mutation: every connection can be cut', () => {
  const base = selfHealSources();
  const run = (key: keyof SelfHealSources) => (text: string) =>
    selfHealProblems({ ...base, [key]: text });
  everyMutationCaught(run('screen'), base.screen, [
    ['onLoadStart={onLoadStart}', ''],
    ['onNavigationStateChange={onNavigationStateChange}', ''],
    ['onHttpError={onHttpError}', ''],
    ['useLoadGuards({', 'noopGuards({'],
    ['onAutoRetry={retryAutomatically}', ''],
  ]);
  everyMutationCaught(run('guards'), base.guards, [
    ['guardTopFrame(event.nativeEvent.url)', 'noop()'],
    ['guardTopFrame(nav.url)', 'noop()'],
    ['isStartPageFailure(url, statusCode, origin)', 'false'],
    ['onLoadError();', ''],
  ]);
  everyMutationCaught(run('hook'), base.hook, [
    ['web?.stopLoading()', 'web?.reload()'],
    ['spendRecovery(', 'allowAll('],
    ["action === 'recover-and-open'", 'true'],
    ['openExternal(url)', 'noop()'],
    ['web?.injectJavaScript(', 'web?.reload('],
    ['window.location.replace(', 'window.location.assign('],
    [
      'web?.stopLoading();',
      'web?.stopLoading();\n      openExternal(url);\n      web?.injectJavaScript(1);\n      spendRecovery(1, 1);',
    ],
  ]);
  everyMutationCaught(run('error'), base.error, [
    ['AppState.addEventListener(', 'AppState.removeEventListener('],
    ['canAutoRetry(autoRetriesUsed, appState)', 'true'],
    ['setTimeout(onAutoRetry, RETRY_DELAY_MS)', 'noop()'],
    ['return () => clearTimeout(timer)', 'return undefined'],
    [
      'const timer = setTimeout(',
      'const tick = setInterval(onAutoRetry, 1); const timer = setTimeout(',
    ],
  ]);
  everyMutationCaught(run('injected'), base.injected, [
    ['window.crypto.getRandomValues(bytes)', 'Math.random()'],
    ['var id = "r" + NONCE + "-" + (seq += 1);', 'var id = "r" + (seq += 1);'],
    ['var NONCE = makeNonce();', 'var NONCE = "x";'],
  ]);
});

// --------------------------------------------------------------- pin 14
// The Kotlin hardening round (FX-D1): each fix is pinned at the line that makes
// it true, with an in-memory mutation proving the needle can fail.
interface KtSources {
  scan: string;
  receivers: string;
  ble: string;
  host: string;
  manager: string;
  tcp: string;
  tcpAddress: string;
  fence: string;
  api: string;
  codes: string;
  delivery: string;
  types: string;
  usb: string;
  threads: string;
  strings: string;
  protocol: string;
  messages: string;
}
const count = (text: string, needle: string): number =>
  text.split(needle).length - 1;
function inOrder(text: string, needles: string[]): boolean {
  const at = needles.map(needle => text.indexOf(needle));
  return at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1]));
}
function receiverProblems(s: KtSources): string[] {
  const out: string[] = [];
  const scan = strip(s.scan);
  if (count(scan, 'ContextCompat.registerReceiver(') !== 1) {
    out.push('ScanSession must register exactly one receiver');
  }
  if (
    !/IntentFilter\(BluetoothDevice\.ACTION_FOUND\),\s*ContextCompat\.RECEIVER_EXPORTED/.test(
      scan,
    )
  ) {
    out.push('the ACTION_FOUND receiver is not RECEIVER_EXPORTED');
  }
  if (scan.includes('RECEIVER_NOT_EXPORTED')) {
    out.push('ScanSession registers a NOT_EXPORTED receiver');
  }
  const receivers = strip(s.receivers);
  if (!receivers.includes('ContextCompat.RECEIVER_NOT_EXPORTED')) {
    out.push('PrinterReceivers lost RECEIVER_NOT_EXPORTED');
  }
  if (
    !/app, bluetoothReceiver, IntentFilter\(BluetoothAdapter.ACTION_STATE_CHANGED\), ContextCompat.RECEIVER_EXPORTED/.test(
      receivers,
    )
  ) {
    out.push(
      'Bluetooth state receiver must receive privileged Bluetooth broadcasts',
    );
  }
  if (
    !/app, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED/.test(
      receivers,
    )
  ) {
    out.push('USB receiver must remain private');
  }
  return out;
}
function bleProblems(s: KtSources): string[] {
  const ble = strip(s.ble);
  const call =
    'requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)';
  return inOrder(ble, ['discover(g)', call, 'established = true'])
    ? []
    : ['BLE priority is not requested after service discovery'];
}
function serviceProblems(s: KtSources): string[] {
  const out: string[] = [];
  const svc = strip(s.host);
  for (const needle of [
    'ALERT_CHANNEL_ID = "print_host_alert"',
    'NotificationManager.IMPORTANCE_HIGH',
    'const val PAGE_DEAD_TICKS = 2',
    'WebViewDelivery.probePage {',
    'R.string.print_host_alert_title',
  ]) {
    if (!svc.includes(needle)) {
      out.push('PrintHostService lacks ' + needle);
    }
  }
  if (count(svc, 'probePage()') < 2) {
    out.push('the tick never probes the page');
  }
  // stop never reaches stopService before the service has gone foreground
  if (count(svc, 'ctx.stopService(') !== 1) {
    out.push('stopService must be called from exactly one place');
  }
  if (!/if \(foregroundReached\) \{[^}]*ctx\.stopService\(/.test(svc)) {
    out.push('stopService is not guarded by foregroundReached');
  }
  const afterForeground =
    /ServiceCompat\.startForeground\([\s\S]*?foregroundReached = true\s*if \(stopWanted\) \{[^}]*stopSelf\(startId\)/;
  if (!afterForeground.test(svc)) {
    out.push('onStartCommand does not check stopWanted after startForeground');
  }
  // both stop branches stop only their own start command (a newer restart survives)
  if (count(svc, 'stopSelf(startId)') !== 2) {
    out.push('both stop branches must call stopSelf(startId)');
  }
  if (svc.includes('stopSelf()')) {
    out.push('a bare stopSelf() drops a newer start command');
  }
  if (count(svc, 'if (!PrinterManager.appVisible) {') !== 1) {
    out.push('the app.wake gate must appear exactly once');
  }
  return out;
}
function managerProblems(s: KtSources): string[] {
  const out: string[] = [];
  const mgr = strip(s.manager);
  if (!mgr.includes('private val publishLock = Any()')) {
    out.push('PrinterManager has no publishLock');
  }
  const publish = /fun publish\(\)[\s\S]*?\n {2}\}\n/.exec(mgr)?.[0] ?? '';
  const underLock = [
    'synchronized(publishLock) {',
    'lastPublished = snapshot',
    'WebViewDelivery.deliverEvent(',
    'statusObserver?.invoke(snapshot)',
  ];
  if (!inOrder(publish, underLock)) {
    out.push('publish does not deliver under publishLock');
  }
  if (!/if \(source === pending\) \{[\s\S]*?pendingLost = true/.test(mgr)) {
    out.push('a link lost while pending is not recorded');
  }
  if (!/else if \(pendingLost\) \{/.test(mgr)) {
    out.push('the attempt never reads pendingLost');
  }
  if (mgr.includes('object PrinterThreads')) {
    out.push('PrinterThreads is declared in PrinterManager');
  }
  if (!strip(s.threads).includes('object PrinterThreads')) {
    out.push('PrinterThreads.kt does not declare PrinterThreads');
  }
  return out;
}
function tcpProblems(s: KtSources): string[] {
  const out: string[] = [];
  const tcp = strip(s.tcp);
  if (tcp.includes('startReader')) {
    out.push('TcpTransport still has a persistent reader');
  }
  if (!tcp.includes('val addresses = TcpAddress.resolveAll(host)')) {
    out.push('TcpTransport does not resolve through TcpAddress');
  }
  // every private address is tried within ONE connect budget, split over what is left
  for (const needle of [
    'for ((index, address) in addresses.withIndex()) {',
    'connectTo(address, maxOf(MIN_WAIT_MS, left / (addresses.size - index)))',
    'if (e.code != BridgeCodes.NOT_CONNECTED || closing.get()) throw e',
    'val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(CONNECT_TIMEOUT_MS.toLong())',
    's.connect(InetSocketAddress(address, port), timeoutMs)',
  ]) {
    if (!tcp.includes(needle)) {
      out.push('TcpTransport connect lacks ' + needle);
    }
  }
  // the drain has ONE end time, fixed before the loop; every read gets what is left
  const drainEnd =
    'val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DRAIN_TIMEOUT_MS.toLong())';
  if (count(tcp, 'DRAIN_TIMEOUT_MS.toLong()') !== 1) {
    out.push('the drain end time must be computed exactly once');
  }
  const drainOrder = [
    drainEnd,
    'while (true) {',
    'val left = remainingMs(endNanos)',
    'if (left <= 0) break',
    's.soTimeout = left',
    'if (input.read(buffer) < 0) break',
  ];
  if (!inOrder(tcp, drainOrder)) {
    out.push('the drain is not bounded by one overall deadline');
  }
  if (tcp.includes('soTimeout = DRAIN_TIMEOUT_MS')) {
    out.push('a drain read restarts the full timeout');
  }
  if (!tcp.includes('maxOf(MIN_WAIT_MS.toLong(), ms).toInt()')) {
    out.push('a socket wait can reach 0 (= forever)');
  }
  const perJob =
    /override fun write\([\s\S]*?val s = connect\(\)[\s\S]*?s\.shutdownOutput\(\)/;
  if (!perJob.test(tcp)) {
    out.push('write does not connect per job and half-close');
  }
  const addr = strip(s.tcpAddress);
  for (const needle of [
    'address.isSiteLocalAddress',
    'address.isLinkLocalAddress',
    'address.isLoopbackAddress',
    'isUniqueLocalV6(address)',
    'IPV6_UNIQUE_LOCAL_MASK = 0xFE',
    'IPV6_UNIQUE_LOCAL_PREFIX = 0xFC',
  ]) {
    if (!addr.includes(needle)) {
      out.push('TcpAddress lacks ' + needle);
    }
  }
  const refuses =
    /if \(local\.isEmpty\(\)\) throw TransportException\(BridgeCodes\.BAD_REQUEST/;
  if (!refuses.test(addr)) {
    out.push('a non-private resolution is not BAD_REQUEST');
  }
  // ALL private addresses come back, IPv4 first
  for (const needle of [
    'fun resolveAll(host: String): List<InetAddress>',
    'all.filter { isPrivate(it) }',
    '.sortedBy { if (it is Inet4Address) 0 else 1 }',
    'return local\n  }',
  ]) {
    if (!addr.includes(needle)) {
      out.push('TcpAddress lacks ' + needle);
    }
  }
  return out;
}
const tail = (text: string, marker: string): string => {
  const at = text.indexOf(marker);
  return at < 0 ? '' : text.slice(at);
};
// A selection takes a ticket on the timer thread; the DNS fence runs on its own
// thread and commits only while the ticket is still the newest.
function selectionProblems(s: KtSources): string[] {
  const out: string[] = [];
  const api = strip(s.api);
  const fence = strip(s.fence);
  const ticketed = [
    'val ticket = SelectionFence.begin()',
    'fenceThenCommit(ctx, info, ticket, cb)',
  ];
  if (!inOrder(api, ticketed)) {
    out.push('select does not take a ticket before the fence');
  }
  const check =
    'SelectionFence.check(target.first, ticket, cb) { commit(ctx, info, cb) }';
  if (!api.includes(check)) {
    out.push('selecting a tcp: id skips the address fence');
  }
  if (!/SelectionFence\.begin\(\)\s*PrinterManager\.halt\(\)/.test(api)) {
    out.push('forget does not supersede a pending selection');
  }
  if (api.includes('TcpAddress.')) {
    out.push('PrinterApi resolves a host itself');
  }
  for (const needle of [
    'PrinterThreads.dns.submit(',
    'TcpAddress.isForbidden(host)',
    'old.lookup?.cancel(false)',
    'settled.compareAndSet(false, true)',
    'return ++ticket',
  ]) {
    if (!fence.includes(needle)) {
      out.push('SelectionFence lacks ' + needle);
    }
  }
  if (/PrinterThreads\.io|\bio\.execute/.test(fence)) {
    out.push('the DNS fence runs on the io thread');
  }
  const finish = [
    'if (pending.ticket != ticket) {',
    'pending.settle(Reply.Ok(PrinterManager.status()))',
    'return',
    'inFlight = null',
    'if (forbidden) pending.settle(Reply.fail(BridgeCodes.BAD_REQUEST)) else commit()',
  ];
  if (!inOrder(tail(fence, 'private fun finish('), finish)) {
    out.push('a stale selection can still commit');
  }
  const begin = [
    'val old = inFlight',
    'inFlight = null',
    'old.settle(Reply.Ok(',
    'return ++ticket',
  ];
  if (!inOrder(fence, begin)) {
    out.push('a superseded selection is not answered');
  }
  const threads = strip(s.threads);
  const dns = /val dns: ExecutorService =\s*Executors\.newSingleThreadExecutor/;
  if (!dns.test(threads)) {
    out.push('PrinterThreads has no single-thread dns executor');
  }
  if (!threads.includes('"pos-printer-dns"')) {
    out.push('the dns thread is unnamed');
  }
  return out;
}
// A job that hit the watchdog never reports success: it is TIMEOUT and the link is lost.
function watchdogProblems(s: KtSources): string[] {
  const out: string[] = [];
  const run = tail(strip(s.api), 'private fun runPrint(');
  const verdict =
    /t\.write\(bytes\)\s*if \(watchdogFired\(watchdog, timedOut\)\) \{\s*PrinterManager\.onLinkLost\(t\)\s*Reply\.fail\(BridgeCodes\.TIMEOUT\)\s*\} else \{\s*Reply\.Ok\(bytes\.size\)/;
  if (!verdict.test(run)) {
    out.push('a write that returns after the watchdog still counts as printed');
  }
  if (!strip(s.api).includes('!watchdog.cancel(false) || timedOut.get()')) {
    out.push('watchdogFired ignores a watchdog that is already running');
  }
  if (count(run, 'Reply.Ok(bytes.size)') !== 1) {
    out.push('the print job has more than one success path');
  }
  return out;
}
function locationProblems(s: KtSources): string[] {
  const out: string[] = [];
  if (!strip(s.codes).includes('const val LOCATION_OFF = "LOCATION_OFF"')) {
    out.push('BridgeCodes lacks LOCATION_OFF');
  }
  const rejects =
    /else if \(BtAccess\.locationOff\(ctx\)\) \{\s*cb\(Reply\.fail\(BridgeCodes\.LOCATION_OFF\)\)/;
  if (!rejects.test(strip(s.api))) {
    out.push('listPrinters does not reject with LOCATION_OFF');
  }
  const copy = /BridgeCodes\.LOCATION_OFF -> "([^"]*)"/.exec(
    strip(s.types),
  )?.[1];
  const web = /LOCATION_OFF: '([^']*)'/.exec(strip(s.messages))?.[1];
  if (copy === undefined || copy !== web) {
    out.push('LOCATION_OFF copy differs: ' + copy + ' | ' + web);
  }
  const codes = tsList(strip(s.protocol), 'NATIVE_ERROR_CODES');
  if (codes[codes.length - 1] !== 'LOCATION_OFF') {
    out.push('LOCATION_OFF is not the last NATIVE_ERROR_CODES entry');
  }
  return out;
}
function probeProblems(s: KtSources): string[] {
  const out: string[] = [];
  const d = strip(s.delivery);
  const fn = /export const NATIVE_DELIVER_FN\s*=\s*'([^']*)'/.exec(
    strip(s.protocol),
  )?.[1];
  const script = /const val PROBE_SCRIPT = "([^"]*)"/.exec(d)?.[1];
  if (fn === undefined || script !== 'typeof window.' + fn) {
    out.push('PROBE_SCRIPT does not probe ' + fn + ': ' + script);
  }
  if (!d.includes('fun probePage(')) {
    out.push('WebViewDelivery has no probePage');
  }
  if (!d.includes('evaluateJavascript(PROBE_SCRIPT)')) {
    out.push('probePage does not evaluate PROBE_SCRIPT');
  }
  const xml = strip(s.strings);
  for (const name of [
    'print_host_alert_channel_name',
    'print_host_alert_title',
    'print_host_alert_text',
  ]) {
    if (!xml.includes('<string name="' + name + '">')) {
      out.push('strings.xml lacks ' + name);
    }
  }
  return out;
}
const ktSources = (): KtSources => ({
  scan: kt('ScanSession.kt'),
  receivers: kt('PrinterReceivers.kt'),
  ble: kt('BleTransport.kt'),
  host: kt('PrintHostService.kt'),
  manager: kt('PrinterManager.kt'),
  tcp: kt('TcpTransport.kt'),
  tcpAddress: kt('TcpAddress.kt'),
  fence: kt('SelectionFence.kt'),
  api: kt('PrinterApi.kt'),
  codes: kt('BridgeCodes.kt'),
  delivery: kt('WebViewDelivery.kt'),
  types: kt('PrinterTypes.kt'),
  usb: kt('UsbTransport.kt'),
  threads: kt('PrinterThreads.kt'),
  strings: read(join(MAIN, 'res', 'values', 'strings.xml')),
  protocol: read(join(SRC, 'bridge', 'protocol.ts')),
  messages: read(join(SRC, 'bridge', 'messages.ts')),
});
const KT_CHECKS: Array<[string, (s: KtSources) => string[]]> = [
  ['receivers', receiverProblems],
  ['ble', bleProblems],
  ['service', serviceProblems],
  ['manager', managerProblems],
  ['tcp', tcpProblems],
  ['selection', selectionProblems],
  ['watchdog', watchdogProblems],
  ['location', locationProblems],
  ['probe', probeProblems],
];

test('pin 14: every Kotlin hardening fix is still in place', () => {
  const s = ktSources();
  for (const [name, check] of KT_CHECKS) {
    assert.deepEqual(check(s), [], name);
  }
  assert.ok(
    strip(s.host).includes('ServiceCompat.startForeground('),
    'landmark beside the stopService pin',
  );
});

test('pin 14 mutation: every needle can fail', () => {
  const base = ktSources();
  const run =
    (check: (s: KtSources) => string[], key: keyof KtSources) =>
    (text: string) =>
      check({ ...base, [key]: text });
  const notExported = 'RECEIVER_' + 'NOT_EXPORTED';
  const inner = (name: string) =>
    'ctx.' + name + '(Intent(ctx, PrintHostService::class.java))';
  everyMutationCaught(run(receiverProblems, 'scan'), base.scan, [
    ['ContextCompat.RECEIVER_EXPORTED', 'ContextCompat.' + notExported],
    ['IntentFilter(BluetoothDevice.ACTION_FOUND)', 'IntentFilter("x")'],
    [
      'ContextCompat.registerReceiver(',
      'ContextCompat.registerReceiver(a)\n    ContextCompat.registerReceiver(',
    ],
  ]);
  everyMutationCaught(run(receiverProblems, 'receivers'), base.receivers, [
    ['ContextCompat.' + notExported, 'ContextCompat.RECEIVER_EXPORTED'],
    ['ContextCompat.' + notExported, 'flags'],
    ['ContextCompat.RECEIVER_EXPORTED', 'ContextCompat.' + notExported],
  ]);
  everyMutationCaught(run(bleProblems, 'ble'), base.ble, [
    [
      'requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)',
      'requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_BALANCED)',
    ],
    ['g.requestConnectionPriority(', 'g.noop('],
    ['established = true', 'established = false'],
    ['discover(g)', 'noop(g)'],
  ]);
  everyMutationCaught(run(serviceProblems, 'host'), base.host, [
    ['"print_host_alert"', '"print_host"'],
    [
      'NotificationManager.IMPORTANCE_HIGH',
      'NotificationManager.IMPORTANCE_LOW',
    ],
    ['const val PAGE_DEAD_TICKS = 2', 'const val PAGE_DEAD_TICKS = 3'],
    ['WebViewDelivery.probePage {', 'WebViewDelivery.noop {'],
    ['probePage()\n          refreshNotification', 'refreshNotification'],
    ['if (foregroundReached) {', 'if (true) {'],
    ['if (stopWanted) {', 'if (false) {'],
    ['foregroundReached = true', 'foregroundReached = false'],
    ['if (!PrinterManager.appVisible) {', 'if (PrinterManager.appVisible) {'],
    [inner('stopService'), 'stopSelf()'],
    ['stopSelf(startId)', 'stopSelf()'],
    [
      'stopSelf(startId)\n      return START_NOT_STICKY\n    }\n    foregroundReached',
      'stopSelf()\n      return START_NOT_STICKY\n    }\n    foregroundReached',
    ],
    [
      'stopSelf(startId)\n      return START_NOT_STICKY\n    }\n    probeIssued',
      'stopSelf()\n      return START_NOT_STICKY\n    }\n    probeIssued',
    ],
    ['R.string.print_host_alert_title', 'R.string.print_host_title_printer'],
  ]);
  everyMutationCaught(run(managerProblems, 'manager'), base.manager, [
    ['private val publishLock = Any()', 'private val publishLock2 = Any()'],
    ['synchronized(publishLock) {', 'run {'],
    ['pendingLost = true', 'pendingLost = false'],
    ['else if (pendingLost) {', 'else if (false) {'],
    [
      'object PrinterManager {',
      'object PrinterThreads {}\nobject PrinterManager {',
    ],
  ]);
  everyMutationCaught(run(managerProblems, 'threads'), base.threads, [
    ['object PrinterThreads', 'object Threads'],
  ]);
  everyMutationCaught(run(tcpProblems, 'tcp'), base.tcp, [
    ['TcpAddress.resolveAll(host)', 'listOf(InetAddress.getByName(host))'],
    [
      'for ((index, address) in addresses.withIndex()) {',
      'for ((index, address) in addresses.take(1).withIndex()) {',
    ],
    ['left / (addresses.size - index)', 'left'],
    ['|| closing.get()) throw e', ') throw e'],
    ['e.code != BridgeCodes.NOT_CONNECTED ||', 'false ||'],
    [
      's.connect(InetSocketAddress(address, port), timeoutMs)',
      's.connect(InetSocketAddress(address, port), CONNECT_TIMEOUT_MS)',
    ],
    ['CONNECT_TIMEOUT_MS.toLong())', 'CONNECT_TIMEOUT_MS.toLong() * 2)'],
    ['s.soTimeout = left', 's.soTimeout = DRAIN_TIMEOUT_MS'],
    ['if (left <= 0) break', 'if (left < 0) break'],
    [
      '      while (true) {\n        val left = remainingMs(endNanos)',
      '      while (true) {\n        val endNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DRAIN_TIMEOUT_MS.toLong())\n        val left = remainingMs(endNanos)',
    ],
    ['maxOf(MIN_WAIT_MS.toLong(), ms).toInt()', 'ms.toInt()'],
    ['s.shutdownOutput()', 's.flush()'],
    ['val s = connect()', 'val s = shared'],
    [
      'private fun drain(',
      'private fun startReader(s: Socket) {}\n  private fun drain(',
    ],
  ]);
  everyMutationCaught(run(tcpProblems, 'tcpAddress'), base.tcpAddress, [
    ['address.isSiteLocalAddress', 'false'],
    ['address.isLinkLocalAddress', 'false'],
    ['address.isLoopbackAddress', 'false'],
    ['isUniqueLocalV6(address)', 'false'],
    ['IPV6_UNIQUE_LOCAL_MASK = 0xFE', 'IPV6_UNIQUE_LOCAL_MASK = 0xFF'],
    ['IPV6_UNIQUE_LOCAL_PREFIX = 0xFC', 'IPV6_UNIQUE_LOCAL_PREFIX = 0xFD'],
    [
      'if (local.isEmpty()) throw TransportException(BridgeCodes.BAD_REQUEST, "Not a local address")',
      'if (local.isEmpty()) return all.toList()',
    ],
    ['all.filter { isPrivate(it) }', 'all.toList()'],
    ['if (it is Inet4Address) 0 else 1', 'if (it is Inet4Address) 1 else 0'],
    ['fun resolveAll(host: String)', 'fun resolveSome(host: String)'],
    ['    return local\n  }', '    return local.take(1)\n  }'],
  ]);
  everyMutationCaught(run(selectionProblems, 'api'), base.api, [
    ['val ticket = SelectionFence.begin()', 'val ticket = 0'],
    ['fenceThenCommit(ctx, info, ticket, cb)', 'commit(ctx, info, cb)'],
    [
      'SelectionFence.check(target.first, ticket, cb)',
      'SelectionFence.check(target.second.toString(), ticket, cb)',
    ],
    [
      'SelectionFence.begin()\n          PrinterManager.halt()',
      'PrinterManager.halt()',
    ],
    [
      'PrinterIds.tcpOf(info.id)',
      'PrinterIds.tcpOf(info.id)?.also { TcpAddress.isForbidden(it.first) }',
    ],
  ]);
  everyMutationCaught(run(selectionProblems, 'fence'), base.fence, [
    ['PrinterThreads.dns.submit(', 'PrinterThreads.io.submit('],
    ['TcpAddress.isForbidden(host)', 'false'],
    ['old.lookup?.cancel(false)', 'old.lookup?.hashCode()'],
    ['settled.compareAndSet(false, true)', 'true'],
    ['return ++ticket', 'return ticket'],
    ['if (pending.ticket != ticket) {', 'if (false) {'],
    ['    inFlight = null\n    if (forbidden)', '    if (forbidden)'],
    [
      'if (forbidden) pending.settle(Reply.fail(BridgeCodes.BAD_REQUEST)) else commit()',
      'commit()',
    ],
    ['      old.settle(Reply.Ok(PrinterManager.status()))\n', ''],
    ['PrinterThreads.timer.execute(', 'PrinterThreads.io.execute('],
  ]);
  everyMutationCaught(run(selectionProblems, 'threads'), base.threads, [
    [
      'Executors.newSingleThreadExecutor',
      'Executors.newSingleThreadScheduledExecutor',
    ],
    ['"pos-printer-dns"', '"pos-printer-x"'],
    ['val dns: ExecutorService =', 'val dnsX: ExecutorService ='],
  ]);
  everyMutationCaught(run(watchdogProblems, 'api'), base.api, [
    ['if (watchdogFired(watchdog, timedOut)) {', 'if (false) {'],
    ['!watchdog.cancel(false) || timedOut.get()', 'timedOut.get()'],
    [
      '        PrinterManager.onLinkLost(t)\n        Reply.fail(BridgeCodes.TIMEOUT)\n      } else {',
      '        Reply.fail(BridgeCodes.TIMEOUT)\n      } else {',
    ],
    [
      'Reply.fail(BridgeCodes.TIMEOUT)\n      } else {',
      'Reply.Ok(bytes.size)\n      } else {',
    ],
  ]);
  everyMutationCaught(run(locationProblems, 'codes'), base.codes, [
    [
      'const val LOCATION_OFF = "LOCATION_OFF"',
      'const val LOCATION_OFF = "LOCATION"',
    ],
  ]);
  everyMutationCaught(run(locationProblems, 'api'), base.api, [
    ['BtAccess.locationOff(ctx)', 'false'],
    [
      'cb(Reply.fail(BridgeCodes.LOCATION_OFF))',
      'cb(Reply.fail(BridgeCodes.BUSY))',
    ],
  ]);
  everyMutationCaught(run(locationProblems, 'types'), base.types, [
    ['Turn on Location so this tablet', 'Turn on GPS so this tablet'],
  ]);
  everyMutationCaught(run(locationProblems, 'messages'), base.messages, [
    ['Turn on Location so this tablet', 'Turn on GPS so this tablet'],
  ]);
  everyMutationCaught(run(locationProblems, 'protocol'), base.protocol, [
    ["  'LOCATION_OFF',\n", ''],
    ["  'LOCATION_OFF',\n", "  'LOCATION_OFF',\n  'EXTRA_LAST',\n"],
  ]);
  everyMutationCaught(run(probeProblems, 'delivery'), base.delivery, [
    ['"typeof window.__posNativeDeliver"', '"typeof window.PosNative"'],
    ['fun probePage(', 'fun probe('],
    ['evaluateJavascript(PROBE_SCRIPT)', 'evaluateJavascript("1")'],
  ]);
  everyMutationCaught(run(probeProblems, 'protocol'), base.protocol, [
    ["'__posNativeDeliver'", "'__deliver'"],
  ]);
  everyMutationCaught(run(probeProblems, 'strings'), base.strings, [
    ['print_host_alert_channel_name', 'print_host_alert_chan'],
    ['print_host_alert_title', 'print_host_alert_head'],
    ['print_host_alert_text', 'print_host_alert_body'],
  ]);
});

// ── pin 15: the release build is hardened and small (owner, 2026-10-02: no reverse engineering, a very small
// file). R8 obfuscates + shrinks, resources shrink, one APK per ARM CPU type, native libraries compressed, the JS is
// Hermes bytecode, the WebView page bridge survives R8, and adb backup cannot pull the app data out.
interface ReleaseSources {
  gradle: string;
  props: string;
  rules: string;
  manifest: string;
}
const NEWLINE = String.fromCharCode(10);
const proguardCode = (text: string): string =>
  text
    .split(NEWLINE)
    .filter(line => !line.trim().startsWith('#'))
    .join(NEWLINE);
// Every line trimmed and joined by one space: a multi-line Gradle block reads as one sentence.
const oneLine = (text: string): string =>
  text
    .split(NEWLINE)
    .map(line => line.trim())
    .filter(line => line !== '')
    .join(' ');
function releaseProblems(s: ReleaseSources): string[] {
  const out: string[] = [];
  const g = strip(s.gradle);
  if (!/^def enableProguardInReleaseBuilds = true$/m.test(g)) {
    out.push('R8 is off for release builds');
  }
  if (!g.includes('minifyEnabled enableProguardInReleaseBuilds')) {
    out.push('the release build does not minify');
  }
  if (!g.includes('shrinkResources enableProguardInReleaseBuilds')) {
    out.push('the release build does not shrink resources');
  }
  const splits =
    'abi { enable isReleaseBuild reset() include "arm64-v8a", "armeabi-v7a" universalApk false }';
  if (!oneLine(g).includes(splits)) {
    out.push('release is not one APK per ARM CPU type');
  }
  const releaseTask =
    'def isReleaseBuild = gradle.startParameter.taskNames.any { it.toLowerCase().contains("release") }';
  if (!g.includes(releaseTask)) {
    out.push('the per-CPU split no longer follows the release task');
  }
  const rulesWired =
    'proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"';
  if (!g.includes(rulesWired)) {
    out.push('the project keep rules are not wired into R8');
  }
  if (!/useLegacyPackaging true/.test(g)) {
    out.push('native libraries are not stored compressed');
  }
  if (!/^hermesEnabled=true$/m.test(s.props)) {
    out.push('Hermes is off: the JS would ship as readable source');
  }
  const rules = proguardCode(s.rules);
  if (!rules.includes('@android.webkit.JavascriptInterface <methods>;')) {
    out.push('R8 may rename the WebView page bridge');
  }
  if (
    !rules.includes('-keep class com.reactnativecommunity.webview.** { *; }')
  ) {
    out.push('R8 may strip react-native-webview');
  }
  if (!strip(s.manifest).includes('android:allowBackup="false"')) {
    out.push('adb backup can pull the app data out');
  }
  return out;
}
const releaseSources = (): ReleaseSources => ({
  gradle: read(GRADLE_APP),
  props: read(join(ROOT, 'android', 'gradle.properties')),
  rules: read(join(ROOT, 'android', 'app', 'proguard-rules.pro')),
  manifest: manifest(),
});

test('pin 15: the release build is obfuscated, shrunk and split per CPU type', () => {
  assert.deepEqual(releaseProblems(releaseSources()), []);
});

test('pin 15 mutation: every hardening needle can fail', () => {
  const base = releaseSources();
  const run = (key: keyof ReleaseSources) => (text: string) =>
    releaseProblems({ ...base, [key]: text });
  everyMutationCaught(run('gradle'), base.gradle, [
    [
      'def enableProguardInReleaseBuilds = true',
      'def enableProguardInReleaseBuilds = false',
    ],
    ['minifyEnabled enableProguardInReleaseBuilds', 'minifyEnabled false'],
    ['shrinkResources enableProguardInReleaseBuilds', 'shrinkResources false'],
    [
      'include "arm64-v8a", "armeabi-v7a"',
      'include "arm64-v8a", "armeabi-v7a", "x86_64"',
    ],
    ['universalApk false', 'universalApk true'],
    ['useLegacyPackaging true', 'useLegacyPackaging false'],
    ['contains("release")', 'contains("never")'],
    ['"proguard-rules.pro"', '"other-rules.pro"'],
  ]);
  everyMutationCaught(run('props'), base.props, [
    ['hermesEnabled=true', 'hermesEnabled=false'],
  ]);
  everyMutationCaught(run('rules'), base.rules, [
    ['@android.webkit.JavascriptInterface <methods>;', '<methods>;'],
    [
      '-keep class com.reactnativecommunity.webview.** { *; }',
      '# webview rule removed',
    ],
  ]);
  everyMutationCaught(run('manifest'), base.manifest, [
    ['android:allowBackup="false"', 'android:allowBackup="true"'],
  ]);
});

// --------------------------------------------------------------- pin 16
// Phase 0 F0.2/F0.7: a USB printer that needs permission while the app is hidden
// is not a denial. Only a shown-and-refused dialog pauses reconnects.
function usbPermissionProblems(s: KtSources): string[] {
  const out: string[] = [];
  const types = strip(s.types);
  const usb = strip(s.usb);
  const manager = strip(s.manager);
  if (!types.includes('class TransportException(val code: String, message: String, val needsForeground: Boolean = false)')) {
    out.push('TransportException must say when a refusal only needs the foreground');
  }
  if (!usb.includes('throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission needed", needsForeground = true)')) {
    out.push('a hidden app must report "needs the foreground", not a denial');
  }
  if (!usb.includes('(target == null || target.deviceName == device.deviceName)')) {
    out.push('a permission reply without EXTRA_DEVICE must still release the wait');
  }
  if (!manager.includes('if (e.needsForeground) usbWaitingForeground = true else usbPermissionPaused = true')) {
    out.push('only a real denial may pause USB reconnects');
  }
  if (!manager.includes('if (usbWaitingForeground && appVisible) selected else null')) {
    out.push('resumeIfPaused must ask again once the app is visible');
  }
  if (!manager.includes('usbPermissionPaused || usbWaitingForeground) return')) {
    out.push('no background reconnect loop while USB waits for permission');
  }
  return out;
}

test('pin 16: USB permission — only a denial pauses; a hidden app asks again when visible', () => {
  assert.deepEqual(usbPermissionProblems(ktSources()), []);
});

test('pin 16 mutation: every USB permission needle can fail', () => {
  const base = ktSources();
  const run = (key: keyof KtSources) => (text: string) => usbPermissionProblems({ ...base, [key]: text });
  everyMutationCaught(run('types'), base.types, [[', val needsForeground: Boolean = false', '']]);
  everyMutationCaught(run('usb'), base.usb, [
    ['"USB permission needed", needsForeground = true', '"USB permission needed"'],
    ['(target == null || target.deviceName == device.deviceName)', '(target?.deviceName == device.deviceName)'],
  ]);
  everyMutationCaught(run('manager'), base.manager, [
    ['if (e.needsForeground) usbWaitingForeground = true else usbPermissionPaused = true', 'usbPermissionPaused = true'],
    ['if (usbWaitingForeground && appVisible) selected else null', 'if (false) selected else null'],
    ['usbPermissionPaused || usbWaitingForeground) return', 'usbPermissionPaused) return'],
  ]);
});
