import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Cross-app contract pin: the web app's native-bridge protocol
// (apps/cafe/lib/printer/native-bridge-protocol.ts) against the Android/RN
// app's copy (apps/mobile/src/bridge/protocol.ts), the app's injected script,
// and the Kotlin delivery/codes files. Both sides are read as TEXT. Every
// checker is a plain function of source strings so each pin also runs against
// an in-memory MUTATED copy and must throw (a checker that cannot fail proves
// nothing). Declaration needles are built by concatenation so this file never
// contains them literally.

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const WEB_PROTOCOL = "apps/cafe/lib/printer/native-bridge-protocol.ts";
const APP_PROTOCOL = "apps/mobile/src/bridge/protocol.ts";
const WEB_BRIDGE = "apps/cafe/lib/printer/native-bridge.ts";
const APP_INJECTED = "apps/mobile/src/bridge/injected.ts";
const KT_DIR = "apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/";
const KT_DELIVERY = KT_DIR + "WebViewDelivery.kt";
const KT_CODES = KT_DIR + "BridgeCodes.kt";

const DECL = "export " + "const ";
const LIST_END = "] " + "as " + "const";

const LIST_ORACLE: Record<string, readonly string[]> = {
  NATIVE_METHODS: [
    "app.info", "printer.status", "printer.list", "printer.select", "printer.reconnect",
    "printer.forget", "printer.print", "permissions.request", "bluetooth.enable",
    "host.background", "app.changeUrl", "app.battery",
  ],
  NATIVE_EVENTS: ["printer.status", "app.wake"],
  NATIVE_TRANSPORTS: ["bt-classic", "ble", "tcp", "usb"],
  NATIVE_PRINTER_STATES: ["none", "connecting", "connected", "disconnected"],
  NATIVE_BLUETOOTH_STATES: ["on", "off", "unauthorized", "unsupported"],
  NATIVE_ERROR_CODES: [
    "NOT_CONNECTED", "WRITE_FAILED", "TOO_LARGE", "BUSY", "TIMEOUT", "UNAUTHORIZED",
    "BLUETOOTH_OFF", "UNSUPPORTED", "BAD_REQUEST", "LOCATION_OFF",
  ],
  NATIVE_PERMISSION_KINDS: ["bluetooth", "notifications"],
  NATIVE_PLATFORMS: ["android", "ios"],
  NATIVE_FEATURES: ["battery"],
};
const LIST_NAMES = Object.keys(LIST_ORACLE);

const SCALAR_ORACLE: Record<string, string | number> = {
  NATIVE_BRIDGE_VERSION: 1,
  PRINTER_SCAN_MS: 8000,
  PRINT_DATA_MAX_BASE64_CHARS: 2000000,
  BRIDGE_MESSAGE_MAX_CHARS: 2100000,
  NATIVE_APP_ID: "pos-mobile",
  NATIVE_GLOBAL: "PosNative",
  NATIVE_DELIVER_FN: "__posNativeDeliver",
};
const SCALAR_NAMES = Object.keys(SCALAR_ORACLE);
const READY_EVENT = "posnative:ready";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// A mutation helper that cannot find its anchor throws AnchorError, and
// rejects() refuses to count that as the checker catching the mutant.
class AnchorError extends Error {}
function anchor(ok: boolean, msg: string): void {
  if (!ok) throw new AnchorError("mutation anchor missing: " + msg);
}

function rejects(check: () => void, expected?: RegExp | string): void {
  try {
    check();
  } catch (e) {
    assert.ok(!(e instanceof AnchorError), String(e));
    if (expected instanceof RegExp) assert.match(String((e as Error).message), expected);
    return;
  }
  assert.fail(`checker accepted a mutated source${typeof expected === "string" ? ": " + expected : ""}`);
}

// First occurrence only; the replacement must actually change the text.
function mutate(src: string, from: string, to: string): string {
  anchor(src.includes(from), from);
  const out = src.replace(from, () => to);
  anchor(out !== src, "no-op replacement: " + from);
  return out;
}

const LITERAL_SRC = String.raw`(['"])((?:\\.|(?!\1).)*)\1`;
const literalRe = (): RegExp => new RegExp(LITERAL_SRC, "g");

// --- checkers -------------------------------------------------------------

function extractList(src: string, name: string): string[] {
  const code = stripComments(src);
  const open = DECL + name + " = [";
  assert.equal(countOccurrences(code, open), 1, `${name} must be declared exactly once`);
  const start = code.indexOf(open) + open.length;
  const end = code.indexOf(LIST_END, start);
  assert.ok(end > start, `${name} must close with the const-assertion`);
  const body = code.slice(start, end);
  const values = [...body.matchAll(literalRe())].map((m) => m[2]);
  assert.equal(body.replace(literalRe(), "").replace(/[\s,]/g, ""), "", `${name} holds only string literals`);
  assert.ok(values.length > 0, `${name} is non-empty`);
  return values;
}

function extractScalar(src: string, name: string): string | number {
  const code = stripComments(src);
  const open = DECL + name + " = ";
  assert.equal(countOccurrences(code, open), 1, `${name} must be declared exactly once`);
  const rest = code.slice(code.indexOf(open) + open.length);
  const m = /^(?:(['"])(.*?)\1|([0-9][0-9_]*));/.exec(rest);
  assert.ok(m, `${name} must be a plain string or digit literal`);
  return m[3] !== undefined ? Number(m[3].replace(/_/g, "")) : m[2];
}

function checkListParity(webSrc: string, appSrc: string, name: string): void {
  const oracle = LIST_ORACLE[name];
  assert.deepEqual(extractList(webSrc, name), oracle, `web ${name}`);
  assert.deepEqual(extractList(appSrc, name), oracle, `app ${name}`);
}

function checkTypeDerivation(src: string, name: string): void {
  const needle = "(typeof " + name + ")[number]";
  assert.equal(countOccurrences(stripComments(src), needle), 1, `${name} type must derive from the list`);
}

function checkScalarParity(webSrc: string, appSrc: string, name: string): void {
  assert.equal(extractScalar(webSrc, name), SCALAR_ORACLE[name], `web ${name}`);
  assert.equal(extractScalar(appSrc, name), SCALAR_ORACLE[name], `app ${name}`);
}

const DISPATCH_CONST_RE = /dispatchEvent\(new Event\('"\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*"'\)\)/;
const DISPATCH_LITERAL_RE = /dispatchEvent\(new Event\((['"])([^'"]+)\1\)\)/;

function dispatchedReadyEvent(injectedSrc: string): string {
  const code = stripComments(injectedSrc);
  assert.equal(countOccurrences(code, "dispatchEvent("), 1, "exactly one dispatchEvent call");
  const viaConst = DISPATCH_CONST_RE.exec(code);
  if (viaConst) {
    const value = extractScalar(injectedSrc, viaConst[1]);
    assert.equal(typeof value, "string");
    return String(value);
  }
  const viaLiteral = DISPATCH_LITERAL_RE.exec(code);
  assert.ok(viaLiteral, "dispatchEvent(new Event(...)) call shape not found");
  return viaLiteral[2];
}

function checkReadyEvent(webBridgeSrc: string, injectedSrc: string): void {
  assert.equal(extractScalar(webBridgeSrc, "NATIVE_READY_EVENT"), READY_EVENT, "web declaration");
  assert.equal(dispatchedReadyEvent(injectedSrc), READY_EVENT, "app dispatches the web event name");
}

const norm = (s: string): string => s.replace(/\s+/g, " ");
const INJECTED_NEEDLES = [
  "'var NAME = ' + safeJsonForScript(NATIVE_GLOBAL)",
  "'var DELIVER = ' + safeJsonForScript(NATIVE_DELIVER_FN)",
  "'window.' + NATIVE_DELIVER_FN + '('",
  "Object.defineProperty(window, DELIVER,",
  "Object.defineProperty(window, NAME,",
];

function checkInjectedNames(injectedSrc: string, appProtocolSrc: string): void {
  const code = stripComments(injectedSrc);
  const flat = norm(code);
  const imp = /import\s*\{([^}]*)\}\s*from\s*'\.\/protocol'/.exec(code);
  assert.ok(imp, "injected.ts imports from ./protocol");
  const imported = imp[1].split(",").map((s) => s.trim());
  for (const id of ["NATIVE_GLOBAL", "NATIVE_DELIVER_FN"]) {
    assert.ok(imported.includes(id), `${id} imported from ./protocol`);
  }
  for (const needle of INJECTED_NEEDLES) {
    assert.equal(countOccurrences(flat, needle), 1, `injected script uses: ${needle}`);
  }
  // Negative (guarded by the positive landmarks above): no hand-typed copy of
  // either name that could drift from the protocol constants.
  assert.equal(code.includes(String(SCALAR_ORACLE.NATIVE_GLOBAL)), false, "no literal global name");
  assert.equal(code.includes(String(SCALAR_ORACLE.NATIVE_DELIVER_FN)), false, "no literal deliver name");
  assert.equal(extractScalar(appProtocolSrc, "NATIVE_GLOBAL"), SCALAR_ORACLE.NATIVE_GLOBAL);
  assert.equal(extractScalar(appProtocolSrc, "NATIVE_DELIVER_FN"), SCALAR_ORACLE.NATIVE_DELIVER_FN);
}

const KT_CALL_RE = /val call = "window\.([A-Za-z_]\w*) && window\.([A-Za-z_]\w*)\(/;
const KT_EVENT_RE = /const val EVENT_[A-Z_]+ = "([^"]*)"/g;

function checkKotlin(deliverySrc: string, codesSrc: string): void {
  const fn = String(SCALAR_ORACLE.NATIVE_DELIVER_FN);
  const call = KT_CALL_RE.exec(deliverySrc);
  assert.ok(call, "WebViewDelivery.kt deliverEvent call line found");
  assert.equal(call[1], fn, "guard half of the call");
  assert.equal(call[2], fn, "invoked half of the call");
  const names = [...stripComments(deliverySrc).matchAll(/window\.(__\w+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 2, "both window.__ references are present");
  assert.deepEqual([...new Set(names)], [fn], "every window.__ reference is the deliver fn");

  const events = [...stripComments(codesSrc).matchAll(KT_EVENT_RE)].map((m) => m[1]);
  assert.ok(events.length > 0, "BridgeCodes.kt declares EVENT_* constants");
  assert.equal(new Set(events).size, events.length, "EVENT_* values are unique");
  assert.deepEqual([...events].sort(), [...LIST_ORACLE.NATIVE_EVENTS].sort(), "EVENT_* set equals NATIVE_EVENTS");
}

// --- sources --------------------------------------------------------------

const webProtocol = readSrc(WEB_PROTOCOL);
const appProtocol = readSrc(APP_PROTOCOL);
const webBridge = readSrc(WEB_BRIDGE);
const injected = readSrc(APP_INJECTED);
const ktDelivery = readSrc(KT_DELIVERY);
const ktCodes = readSrc(KT_CODES);

function mutateFirstLiteral(src: string, name: string): string {
  const at = src.indexOf(DECL + name + " = [");
  anchor(at >= 0, name);
  const m = literalRe().exec(src.slice(at));
  if (!m) throw new AnchorError(name);
  const quoteEnd = at + m.index + m[0].length - 1;
  return src.slice(0, quoteEnd) + "x" + src.slice(quoteEnd);
}

function mutateScalar(src: string, name: string): string {
  const at = src.indexOf(DECL + name + " = ");
  const semi = src.indexOf(";", at);
  anchor(at >= 0 && semi > at, name);
  const isString = /['"]/.test(src[semi - 1]);
  const cut = isString ? semi - 1 : semi;
  return src.slice(0, cut) + "9" + src.slice(cut);
}

// --- PIN 1: ordered lists -------------------------------------------------

for (const name of LIST_NAMES) {
  test(`${name}: web and app declare the same ordered list (and equal the oracle)`, () => {
    checkListParity(webProtocol, appProtocol, name);
    assert.ok(extractList(webProtocol, name).length === LIST_ORACLE[name].length);
  });
}

// Phase 3 Session 3D deliberately changed: a ninth list, NATIVE_FEATURES (what window.PosNative says it can do).
test("lists pin: the oracle covers exactly the nine lists both files declare", () => {
  assert.equal(LIST_NAMES.length, 9);
  for (const src of [webProtocol, appProtocol]) {
    const declared = countOccurrences(stripComments(src), DECL + "NATIVE_");
    // 9 lists + NATIVE_BRIDGE_VERSION/APP_ID/GLOBAL/DELIVER_FN scalars.
    assert.equal(declared, LIST_NAMES.length + 4, "no undeclared NATIVE_ list slipped in");
  }
});

test("lists pin mutation: a changed literal in either file fails (every list, both sides)", () => {
  for (const name of LIST_NAMES) {
    rejects(() => checkListParity(mutateFirstLiteral(webProtocol, name), appProtocol, name), `web ${name}`);
    rejects(() => checkListParity(webProtocol, mutateFirstLiteral(appProtocol, name), name), `app ${name}`);
  }
});

test("lists pin mutation: reorder, drop, duplicate declaration and missing declaration fail", () => {
  const swapped = mutate(appProtocol, "'app.info',\n  'printer.status',", "'printer.status',\n  'app.info',");
  rejects(() => checkListParity(webProtocol, swapped, "NATIVE_METHODS"));
  const dropped = mutate(webProtocol, '"ios"', "");
  rejects(() => checkListParity(dropped, appProtocol, "NATIVE_PLATFORMS"));
  const doubled = webProtocol + "\n" + DECL + 'NATIVE_EVENTS = ["x"] ' + LIST_END + ";\n";
  rejects(() => checkListParity(doubled, appProtocol, "NATIVE_EVENTS"), /exactly once/);
  const renamed = mutate(appProtocol, DECL + "NATIVE_TRANSPORTS", DECL + "NATIVE_TRANSPORT_LIST");
  rejects(() => checkListParity(webProtocol, renamed, "NATIVE_TRANSPORTS"), /exactly once/);
  const unquoted = mutate(webProtocol, '"ble"', "ble");
  rejects(() => checkListParity(unquoted, appProtocol, "NATIVE_TRANSPORTS"));
});

test("lists pin tolerance: quote style and trailing commas do not matter (parser is not over-strict)", () => {
  const requoted = mutate(webProtocol, '["bluetooth", "notifications"]', "['bluetooth', 'notifications',]");
  checkListParity(requoted, appProtocol, "NATIVE_PERMISSION_KINDS");
});

// --- PIN 2: types derive from the lists ----------------------------------

for (const name of LIST_NAMES) {
  test(`${name}: its type is derived from the list in both files`, () => {
    checkTypeDerivation(webProtocol, name);
    checkTypeDerivation(appProtocol, name);
  });
}

test("type pin mutation: a hand-written union in place of the derivation fails", () => {
  for (const name of LIST_NAMES) {
    const needle = "(typeof " + name + ")[number]";
    rejects(() => checkTypeDerivation(mutate(webProtocol, needle, "string"), name), `web ${name}`);
    rejects(() => checkTypeDerivation(mutate(appProtocol, needle, "string"), name), `app ${name}`);
  }
});

// --- PIN 3: scalars -------------------------------------------------------

for (const name of SCALAR_NAMES) {
  test(`${name}: web and app agree and equal the oracle`, () => {
    checkScalarParity(webProtocol, appProtocol, name);
  });
}

test("scalar pin mutation: a drifted value on either side fails (every scalar)", () => {
  for (const name of SCALAR_NAMES) {
    rejects(() => checkScalarParity(mutateScalar(webProtocol, name), appProtocol, name), `web ${name}`);
    rejects(() => checkScalarParity(webProtocol, mutateScalar(appProtocol, name), name), `app ${name}`);
  }
});

test("scalar pin: digit separators are stripped before comparing (8_000 equals 8000)", () => {
  assert.ok(webProtocol.includes("8_000") && appProtocol.includes("8_000"), "landmark: separators present");
  checkScalarParity(mutate(webProtocol, "8_000", "8000"), mutate(appProtocol, "8_000", "8000"), "PRINTER_SCAN_MS");
});

// --- PIN 4: late-bridge ready event --------------------------------------

test("late-bridge event: web declares it and the app's injected script dispatches exactly that name", () => {
  checkReadyEvent(webBridge, injected);
  assert.equal(extractScalar(injected, "NATIVE_READY_EVENT"), READY_EVENT, "app declaration agrees too");
});

test("late-bridge event mutation: any drift on either side fails", () => {
  rejects(() => checkReadyEvent(mutate(webBridge, READY_EVENT, "posnative:readyy"), injected));
  rejects(() => checkReadyEvent(webBridge, mutate(injected, "'" + READY_EVENT + "'", "'posnative:other'")));
  rejects(() => checkReadyEvent(webBridge, mutate(injected, "NATIVE_READY_EVENT +", "NATIVE_READY_EVENTS +")));
  rejects(() => checkReadyEvent(webBridge, mutate(injected, "dispatchEvent(", "dispatchEvent2(")));
});

// --- PIN 5: injected global + deliver fn ---------------------------------

test("injected script defines window.PosNative and the deliver fn from the protocol constants", () => {
  checkInjectedNames(injected, appProtocol);
});

test("injected names mutation: literal swap, dropped import, or renamed define fails", () => {
  const run = (src: string): void => checkInjectedNames(src, appProtocol);
  rejects(() => run(mutate(injected, "safeJsonForScript(NATIVE_GLOBAL)", "safeJsonForScript('PosNativ')")));
  rejects(() => run(mutate(injected, "'window.' + NATIVE_DELIVER_FN", "'window.' + 'deliver'")));
  // Phase 3 Session 3D deliberately changed: NATIVE_FEATURES sits between them in the import.
  rejects(() => run(mutate(injected, "NATIVE_DELIVER_FN,\n  NATIVE_FEATURES,", "NATIVE_FEATURES,")));
  rejects(() => run(mutate(injected, "defineProperty(window, DELIVER,", "defineProperty(window, DELIVERY,")));
  rejects(() => checkInjectedNames(injected, mutateScalar(appProtocol, "NATIVE_GLOBAL")));
});

// --- PIN 6: Kotlin --------------------------------------------------------

test("Kotlin: WebViewDelivery builds its call with the deliver fn; BridgeCodes EVENT_* equal NATIVE_EVENTS", () => {
  checkKotlin(ktDelivery, ktCodes);
  assert.equal(countOccurrences(stripComments(ktCodes), "const val EVENT_"), LIST_ORACLE.NATIVE_EVENTS.length);
});

test("Kotlin mutation: renamed call half, changed/dropped/extra EVENT_* all fail", () => {
  const fn = String(SCALAR_ORACLE.NATIVE_DELIVER_FN);
  const guard = "window." + fn + " && window.";
  rejects(() => checkKotlin(mutate(ktDelivery, guard, "window.__other && window."), ktCodes));
  rejects(() => checkKotlin(mutate(ktDelivery, guard + fn + "(", guard + "__other("), ktCodes));
  rejects(() => checkKotlin(ktDelivery, mutate(ktCodes, '"app.wake"', '"app.wakeup"')));
  rejects(() => checkKotlin(ktDelivery, mutate(ktCodes, 'const val EVENT_APP_WAKE = "app.wake"', "")));
  rejects(() =>
    checkKotlin(ktDelivery, mutate(ktCodes, "const val PLATFORM", 'const val EVENT_EXTRA = "app.extra"\n  const val PLATFORM')),
  );
});
