import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PRINT_HOST_BEAT_PRINTER_VALUES } from "@pos/shared/print-host-printer";
import { beatPrintHostUpdate, printHostStateOf } from "./print-host";
import { beatBodySchema } from "./print-host-beat-schema";
import { stripComments } from "./source-pin-utils";

// Bluetooth-print W1 — the host's printer-connection report: beat schema,
// pure update builder, strict state mapping, plus source pins (each mutated
// in memory below so a vacuous needle cannot pass).

const NOW = 1_700_000_000_000;
const DEVICE = { deviceId: "dev-1" };

// ── Beat body schema ─────────────────────────────────────────────────────────

test("beat schema: accepts connected / disconnected / unknown and an absent printer", () => {
  for (const printer of PRINT_HOST_BEAT_PRINTER_VALUES) {
    assert.equal(beatBodySchema.safeParse({ ...DEVICE, printer }).success, true, printer);
  }
  assert.equal(beatBodySchema.safeParse(DEVICE).success, true);
});

test("beat schema: rejects 'on', '' and non-strings for printer, and any extra key (.strict())", () => {
  for (const printer of ["on", "", null, 1, true]) {
    assert.equal(beatBodySchema.safeParse({ ...DEVICE, printer }).success, false, String(printer));
  }
  assert.equal(beatBodySchema.safeParse({ ...DEVICE, printerState: "connected" }).success, false);
});

// ── beatPrintHostUpdate ──────────────────────────────────────────────────────

test("beatPrintHostUpdate: connected / disconnected $set printerState and never $unset", () => {
  for (const printer of ["connected", "disconnected"] as const) {
    const update = beatPrintHostUpdate({ ...DEVICE, printer }, NOW);
    assert.equal(update.$set.printerState, printer);
    assert.equal("$unset" in update, false);
    assert.deepEqual(update.$set.lastSeenAt, new Date(NOW));
  }
});

test("beatPrintHostUpdate: 'unknown' $unsets printerState and never stores the word", () => {
  const update = beatPrintHostUpdate({ ...DEVICE, printer: "unknown" }, NOW);
  assert.deepEqual(update.$unset, { printerState: "" });
  assert.equal("printerState" in update.$set, false);
  assert.deepEqual(update.$set.lastSeenAt, new Date(NOW));
});

test("beatPrintHostUpdate: an absent printer leaves printerState untouched (no $set key, no $unset); silent fields stay omit-empty", () => {
  const bare = beatPrintHostUpdate(DEVICE, NOW);
  assert.deepEqual(Object.keys(bare), ["$set"]);
  assert.deepEqual(Object.keys(bare.$set), ["lastSeenAt"]);
  const full = beatPrintHostUpdate({ ...DEVICE, silentMode: false, silentProbeMs: 0, printer: "connected" }, NOW);
  assert.equal(full.$set.silentMode, false, "an explicit false is still stamped");
  assert.equal(full.$set.silentProbeMs, 0, "an explicit 0 is still stamped");
  assert.equal(full.$set.printerState, "connected");
});

// ── printHostStateOf: the strict mapping ─────────────────────────────────────

test("printHostStateOf: printer maps connected/disconnected, and absent / bogus / prototype-key values to null", () => {
  const host = { deviceId: "d", label: "L", lastSeenAt: new Date(NOW) };
  assert.equal(printHostStateOf({ ...host, printerState: "connected" }, NOW).printer, "connected");
  assert.equal(printHostStateOf({ ...host, printerState: "disconnected" }, NOW).printer, "disconnected");
  assert.equal(printHostStateOf(host, NOW).printer, null);
  for (const bogus of ["bogus", "", "unknown", "Connected", "toString", "__proto__"]) {
    assert.equal(printHostStateOf({ ...host, printerState: bogus }, NOW).printer, null, bogus);
  }
  assert.equal(printHostStateOf(null, NOW).printer, null);
});

// ── Source pins (with in-memory mutation self-check) ─────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const HOST_LIB = "apps/cafe/lib/print-host.ts";
const BEAT_SCHEMA = "apps/cafe/lib/print-host-beat-schema.ts";
const BEAT_ROUTE = "apps/cafe/app/api/print-host/beat/route.ts";
const MODEL = "apps/cafe/models/PrintHost.ts";

type Pin = (code: string) => string[];
interface PinCase {
  file: string;
  pin: Pin;
  mutations: { name: string; apply: (code: string) => string }[];
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Everything from `export async function beatPrintHost` to the end of the file. */
const beatBody = (code: string): string => {
  const at = code.indexOf("export async function beatPrintHost(");
  return at < 0 ? "" : code.slice(at);
};

/** The `beatPrintHostUpdate` function text (up to the CAS function). */
const updateBody = (code: string): string => {
  const at = code.indexOf("export function beatPrintHostUpdate(");
  const end = code.indexOf("export async function beatPrintHost(");
  return at < 0 || end < at ? "" : code.slice(at, end);
};

const CASES: Record<string, PinCase> = {
  hostLibSelects: {
    file: HOST_LIB,
    pin: (code) => {
      const problems: string[] = [];
      if (!/const PRINT_HOST_STATE_SELECT = "deviceId label lastSeenAt silentMode printerState";/.test(code))
        problems.push("PRINT_HOST_STATE_SELECT must list printerState");
      if (count(code, ".select(PRINT_HOST_STATE_SELECT)") !== 3) problems.push("all three selects must use PRINT_HOST_STATE_SELECT");
      if (/\.select\("/.test(code)) problems.push("no select may carry an inline field literal");
      return problems;
    },
    mutations: [
      { name: "drop printerState from the select list", apply: (c) => c.replace("silentMode printerState", "silentMode") },
      { name: "one select back to an inline literal", apply: (c) => c.replace(".select(PRINT_HOST_STATE_SELECT)", '.select("deviceId label")') },
    ],
  },
  designationUnset: {
    file: HOST_LIB,
    pin: (code) =>
      /\$unset:\s*\{\s*silentMode:\s*"",\s*silentProbeMs:\s*"",\s*printerState:\s*""\s*\}/.test(code)
        ? []
        : ["designation must $unset silentMode, silentProbeMs and printerState"],
    mutations: [{ name: "drop the printerState key", apply: (c) => c.replace(', printerState: "" }', " }") }],
  },
  beatCas: {
    file: HOST_LIB,
    pin: (code) => {
      const problems: string[] = [];
      const body = beatBody(code);
      if (!/\{\s*key:\s*PRINT_HOST_KEY,\s*deviceId:\s*input\.deviceId\s*\}/.test(body)) problems.push("the beat CAS filter must carry key AND deviceId");
      if (!/\{\s*new:\s*true,\s*runValidators:\s*true\s*\}/.test(body)) problems.push("beatPrintHost must pass { new: true, runValidators: true }");
      if (!/beatPrintHostUpdate\(input,\s*nowMs\)/.test(body)) problems.push("beatPrintHost must build its update with beatPrintHostUpdate(");
      return problems;
    },
    mutations: [
      { name: "drop runValidators", apply: (c) => c.replace("{ new: true, runValidators: true }", "{ new: true }") },
      { name: "drop deviceId from the CAS filter", apply: (c) => c.replace("{ key: PRINT_HOST_KEY, deviceId: input.deviceId },\n    beatPrintHostUpdate", "{ key: PRINT_HOST_KEY },\n    beatPrintHostUpdate") },
      { name: "inline the update instead of beatPrintHostUpdate(", apply: (c) => c.replace("beatPrintHostUpdate(input, nowMs),\n", "{ $set: { lastSeenAt: new Date(nowMs) } },\n") },
    ],
  },
  updateBuilder: {
    file: HOST_LIB,
    pin: (code) => {
      const problems: string[] = [];
      const body = updateBody(code);
      if (!/input\.printer === PRINT_HOST_BEAT_PRINTER_UNKNOWN\) return \{ \$set, \$unset: \{ printerState: "" \} \}/.test(body))
        problems.push('"unknown" must return an $unset of printerState');
      if (!/printerState: input\.printer \}/.test(body)) problems.push("connected/disconnected must $set printerState from the input");
      if (!/input\.printer === undefined\) return \{ \$set \}/.test(body)) problems.push("an absent printer must leave printerState untouched");
      return problems;
    },
    mutations: [
      { name: "unknown stores $set null", apply: (c) => c.replace('return { $set, $unset: { printerState: "" } }', "return { $set: { ...$set, printerState: null } }") },
      { name: "drop the unset key", apply: (c) => c.replace('$unset: { printerState: "" } }', "$unset: {} }") },
      { name: "absent printer falls through to $set", apply: (c) => c.replace("input.printer === undefined) return { $set };", "false) return { $set };") },
    ],
  },
  strictMapper: {
    file: HOST_LIB,
    pin: (code) =>
      /PRINT_HOST_PRINTER_STATES\.find\(\(s\) => s === v\) \?\? null/.test(code) ? [] : ["printerStateOf must be a strict === match over PRINT_HOST_PRINTER_STATES"],
    mutations: [
      { name: "=== to a loose includes match", apply: (c) => c.replace("s === v", "String(v).includes(s)") },
      { name: "default to a state instead of null", apply: (c) => c.replace("(s) => s === v) ?? null", '(s) => s === v) ?? "connected"') },
    ],
  },
  beatSchema: {
    file: BEAT_SCHEMA,
    pin: (code) => {
      const problems: string[] = [];
      if (!/printer:\s*z\.enum\(PRINT_HOST_BEAT_PRINTER_VALUES\)\.optional\(\)/.test(code)) problems.push("printer must be z.enum(PRINT_HOST_BEAT_PRINTER_VALUES).optional()");
      if (!/\}\)\s*\.strict\(\)/.test(code)) problems.push("the beat schema must stay .strict()");
      return problems;
    },
    mutations: [
      { name: "required printer", apply: (c) => c.replace("PRINT_HOST_BEAT_PRINTER_VALUES).optional()", "PRINT_HOST_BEAT_PRINTER_VALUES)") },
      { name: "free-string printer", apply: (c) => c.replace("z.enum(PRINT_HOST_BEAT_PRINTER_VALUES)", "z.string()") },
      { name: "drop .strict()", apply: (c) => c.replace(".strict()", "") },
    ],
  },
  beatRoute: {
    file: BEAT_ROUTE,
    pin: (code) => {
      const problems: string[] = [];
      if (!/import \{ beatBodySchema \} from "@\/lib\/print-host-beat-schema";/.test(code)) problems.push("the route must import beatBodySchema from lib/print-host-beat-schema");
      if (/\bz\.object\(/.test(code)) problems.push("the route must not declare its own body schema");
      if (!/printer:\s*parsed\.data\.printer,/.test(code)) problems.push("the route must pass printer: parsed.data.printer through");
      const auth = code.indexOf("requireAuth()");
      const validate = code.indexOf("validateBody(req, beatBodySchema)");
      const connect = code.indexOf("await connectDB()");
      if (!(auth >= 0 && auth < validate && validate < connect)) problems.push("order must stay auth -> validate -> connectDB");
      return problems;
    },
    mutations: [
      { name: "drop the printer pass-through", apply: (c) => c.replace("printer: parsed.data.printer,", "") },
      { name: "local body schema again", apply: (c) => c.replace("export const dynamic", "const local = z.object({});\nexport const dynamic") },
      { name: "connectDB before auth", apply: (c) => c.replace("const authed = await requireAuth();", "await connectDB();\n  const authed = await requireAuth();") },
    ],
  },
  model: {
    file: MODEL,
    pin: (code) => {
      const problems: string[] = [];
      if (!/printerState:\s*\{\s*type:\s*String,\s*enum:\s*\[\.\.\.PRINT_HOST_PRINTER_STATES\]\s*\}/.test(code)) problems.push("printerState must be a String enum over PRINT_HOST_PRINTER_STATES");
      if (/printerState:[^\n]*default/.test(code)) problems.push("printerState must have NO default (omit-empty)");
      return problems;
    },
    mutations: [
      { name: "add a default", apply: (c) => c.replace("enum: [...PRINT_HOST_PRINTER_STATES] }", "enum: [...PRINT_HOST_PRINTER_STATES], default: null }") },
      { name: "drop the enum", apply: (c) => c.replace("type: String, enum: [...PRINT_HOST_PRINTER_STATES]", "type: String") },
    ],
  },
};

for (const [name, c] of Object.entries(CASES)) {
  test(`PIN ${name}: holds on the real source, and every in-memory mutation breaks it`, () => {
    const code = stripComments(read(c.file));
    assert.ok(code.length > 200, `${c.file} must be readable (vision guard)`);
    assert.deepEqual(c.pin(code), [], `${c.file} must satisfy the pin`);
    for (const m of c.mutations) {
      const mutated = m.apply(code);
      assert.notEqual(mutated, code, `mutation "${m.name}" must actually change the source (needle drifted?)`);
      assert.ok(c.pin(mutated).length > 0, `mutation "${m.name}" must be caught by the pin`);
    }
  });
}
