import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Phase 2 Session 2F2 (spec §9.2): the bridge v2 parity pin, as the v1 bridge (native-bridge-protocol-parity.test.ts)
// and the Windows app (desktop-shell-paths.test.ts) have one. The page's half (native-bridge-v2.ts, native-pool.ts)
// against the POS app's half (apps/mobile/src/bridge: protocol-v2.ts, the router, the validation, the injected
// script; and the Kotlin that sends the v2 event): the method names, the version, the envelope each method carries,
// the reply's version and the list's keys. Both sides are read as TEXT; every checker returns its problems, and each
// also runs against mutated copies that it must catch (a checker that cannot fail proves nothing).

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const KT = "apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/";
interface Sources {
  web: string;
  pool: string;
  appProtocol: string;
  router: string;
  validate: string;
  injected: string;
  delivery: string;
  publish: string;
  json: string;
  codes: string;
}
const sources = (): Sources => ({
  web: readSrc("apps/cafe/lib/printer/native-bridge-v2.ts"),
  pool: readSrc("apps/cafe/lib/printer/native-pool.ts"),
  appProtocol: readSrc("apps/mobile/src/bridge/protocol-v2.ts"),
  router: readSrc("apps/mobile/src/bridge/router.ts"),
  validate: readSrc("apps/mobile/src/bridge/validate.ts"),
  injected: readSrc("apps/mobile/src/bridge/injected.ts"),
  delivery: readSrc(KT + "WebViewDelivery.kt"),
  publish: readSrc(KT + "PrinterPool.kt"),
  json: readSrc(KT + "StatusJson.kt"),
  codes: readSrc(KT + "BridgeCodes.kt"),
});

const METHOD_ORACLE = ["printer.status", "printer.select", "printer.reconnect", "printer.forget", "printer.print"];

/** The string literals of `export const NAME = [ ... ] as const;`, or null when it is not declared exactly once. */
function listOf(code: string, name: string): string[] | null {
  const open = "export const " + name + " = [";
  if (code.split(open).length !== 2) return null;
  const start = code.indexOf(open) + open.length;
  const end = code.indexOf("] as const", start);
  if (end < 0) return null;
  return [...code.slice(start, end).matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

function parityProblems(s: Sources): string[] {
  const out: string[] = [];
  const need = (text: string, needle: string, why: string): void => {
    if (!text.includes(needle)) out.push(why);
  };
  // The methods, in order, on both sides.
  const web = listOf(s.web, "NATIVE_V2_METHODS");
  const app = listOf(s.appProtocol, "V2_METHODS");
  if (JSON.stringify(web) !== JSON.stringify(METHOD_ORACLE)) out.push(`the page's v2 methods are ${JSON.stringify(web)}`);
  if (JSON.stringify(app) !== JSON.stringify(METHOD_ORACLE)) out.push(`the app's v2 methods are ${JSON.stringify(app)}`);
  // The version: 2 everywhere, and the app says it speaks 1 and 2.
  need(s.web, "export const NATIVE_BRIDGE_V2 = 2;", "the page's v2 is not 2");
  need(s.appProtocol, "export const BRIDGE_V2 = 2;", "the app's v2 is not 2");
  need(s.appProtocol, "export const BRIDGE_VERSIONS = [1, 2] as const;", "the app does not say it speaks 1 and 2");
  need(s.codes, "const val BRIDGE_V2 = 2", "the Kotlin v2 is not 2");
  // The page sends the version last; the injected script takes it last and routes by it.
  need(s.web, "bridge.request(method, params, NATIVE_BRIDGE_V2)", "the page does not send the version last");
  need(s.web, "NATIVE_BRIDGE_V2,\n  );", "the page does not listen with the version last");
  need(s.injected, "'function request(method, params, version) {',", "the app's request does not take the version last");
  need(s.injected, "'function on(event, fn, version) {',", "the app's on does not take the version last");
  need(s.injected, "'var VERSIONS = ' + safeJsonForScript(BRIDGE_VERSIONS) + ';',", "the injected script does not carry the app's versions");
  need(s.injected, "versions: Object.freeze(VERSIONS.slice())", "window.PosNative does not say its versions");
  need(s.injected, "'  if (!waiter || waiter.v !== message.v) { return; }',", "a reply of another version could settle a request");
  need(s.injected, "\"    var set = listeners.get(message.v + ' ' + message.event);\",", "an event does not reach only its version's listeners");
  // The envelope of each method: what the page sends is exactly what the app takes.
  need(s.pool, 'client.request("printer.print", { printerId: id, data: bytesToBase64(bytes) })', "the page's print is not { printerId, data }");
  need(s.pool, 'client.request("printer.reconnect", { printerId: id })', "the page's reconnect is not { printerId }");
  need(s.pool, 'client.request("printer.forget", { printerId: id })', "the page's forget is not { printerId }");
  need(s.pool, 'client.request("printer.select", target)', "the page's select is not its target ({ id } or { tcp })");
  need(s.validate, "if (!onlyKeys(obj, ['printerId', 'data']) || !validPrinterId(obj.printerId)) {", "the app's print does not take exactly { printerId, data }");
  need(s.validate, "return onlyKeys(obj, ['printerId']) && validPrinterId(obj.printerId)", "the app's reconnect and forget do not take exactly { printerId }");
  need(s.validate, "case 'printer.select':\n      return validateSelect(obj);", "the app's v2 select is not v1's { id } or { tcp }");
  // The reply and the event carry v: 2; the list's keys.
  need(s.router, "(msg.v === NATIVE_BRIDGE_VERSION || msg.v === BRIDGE_V2) &&", "the router does not take a v2 envelope");
  need(s.router, "reply = { v: 2, id, ok: true, result };", "a v2 answer is not a v2 reply");
  need(s.router, "function failureV2(id: string, code: NativeErrorCode): BridgeReplyV2 {\n    return {\n      v: 2,", "a v2 refusal is not a v2 reply");
  need(s.delivery, 'fun deliverEvent(event: String, data: JSONObject, version: Int = VERSION) {', "an app event carries no version of its own");
  need(s.delivery, 'message.put("v", version)', "an app event is not sent with its version");
  need(s.publish, "StatusJson.poolJson(all), BridgeCodes.BRIDGE_V2)", "the list of printers is not sent as a v2 event");
  for (const key of ["printers", "defaultId", "bluetooth"]) {
    need(s.web, `${key}: z.`, `the page does not read the list's ${key}`);
    need(s.json, `json.put("${key}",`, `the app does not send the list's ${key}`);
  }
  need(s.json, 'JSONObject().put("state", entry.state).put("printer", printerJson(entry.printer))', "a listed printer is not { state, printer }");
  return out;
}

type Mutation = [keyof Sources, string, string];
const MUTATIONS: Mutation[] = [
  ["web", '"printer.reconnect", "printer.forget"', '"printer.forget", "printer.reconnect"'],
  ["appProtocol", "'printer.print',", "'printer.write',"],
  ["appProtocol", "BRIDGE_V2 = 2;", "BRIDGE_V2 = 3;"],
  ["appProtocol", "[1, 2] as const", "[1] as const"],
  ["codes", "BRIDGE_V2 = 2", "BRIDGE_V2 = 1"],
  ["web", "bridge.request(method, params, NATIVE_BRIDGE_V2)", "bridge.request(method, params)"],
  ["injected", "'function request(method, params, version) {',", "'function request(method, params) {',"],
  ["injected", "'function on(event, fn, version) {',", "'function on(event, fn) {',"],
  ["injected", "versions: Object.freeze(VERSIONS.slice())", "versions: []"],
  ["injected", "'  if (!waiter || waiter.v !== message.v) { return; }',", "'  if (!waiter) { return; }',"],
  ["injected", "listeners.get(message.v + ' ' + message.event)", "listeners.get(message.event)"],
  ["pool", "{ printerId: id, data: bytesToBase64(bytes) }", "{ id, data: bytesToBase64(bytes) }"],
  ["pool", 'client.request("printer.reconnect", { printerId: id })', 'client.request("printer.reconnect", { id })'],
  ["validate", "onlyKeys(obj, ['printerId', 'data'])", "onlyKeys(obj, ['id', 'data'])"],
  ["validate", "return onlyKeys(obj, ['printerId']) &&", "return onlyKeys(obj, ['id']) &&"],
  ["router", "|| msg.v === BRIDGE_V2) &&", ") &&"],
  ["router", "reply = { v: 2, id, ok: true, result };", "reply = { v: 1, id, ok: true, result } as never;"],
  ["delivery", 'message.put("v", version)', 'message.put("v", VERSION)'],
  ["publish", "StatusJson.poolJson(all), BridgeCodes.BRIDGE_V2)", "StatusJson.poolJson(all))"],
  ["json", 'json.put("defaultId",', 'json.put("default",'],
  ["web", "defaultId: z.", "defaultPrinter: z."],
];

test("2F2: the app's bridge v2 and the page's agree: the methods, the version, each method's envelope, the reply's version and the list's keys", () => {
  assert.deepEqual(parityProblems(sources()), [], "the two halves of bridge v2 agree");
});

test("2F2: the v2 parity pin catches every drift on either side", () => {
  const base = sources();
  for (const [key, from, to] of MUTATIONS) {
    assert.ok(base[key].includes(from), `mutation anchor missing in ${key}: ${from}`);
    const problems = parityProblems({ ...base, [key]: base[key].split(from).join(to) });
    assert.ok(problems.length > 0, `mutation not caught in ${key}: ${from} -> ${to}`);
  }
});
