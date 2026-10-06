import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Types } from "mongoose";

import { stripComments } from "@/lib/source-pin-utils";
import { createStationBodySchema, printerBodySchema, updateStationBodySchema } from "@/lib/print-printer-schemas";
import { printerWireOf } from "@/lib/print-printers";
import { stationWireOf } from "@/lib/print-stations";

// Printing redesign, Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A4): the setup routes'
// bodies, the wire shapes, and source pins for the routes and libs (auth, ids, no-store, no connectDB in
// libs). Their database behaviour is proven by the live legs ah–aj.

const STATION = "64f000000000000000000001";

function lanBody(over: Record<string, unknown> = {}) {
  return {
    name: "Kitchen printer",
    connection: { kind: "lan", host: "192.168.1.60" },
    primaryDeviceId: "kitchen-tab",
    paper: 80,
    slips: { bill: false, kotStations: [STATION], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

const DEVICE = { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON TM-T82" };

test("station bodies: a trimmed name of 1–32 characters; an update renames or makes it the default", () => {
  assert.deepEqual(createStationBodySchema.parse({ name: "  Bar " }), { name: "Bar" });
  assert.equal(createStationBodySchema.safeParse({ name: "   " }).success, false);
  assert.equal(createStationBodySchema.safeParse({ name: "x".repeat(33) }).success, false);
  assert.equal(createStationBodySchema.safeParse({ name: "Bar", isDefault: true }).success, false, "a new station is never the default by its body");
  assert.equal(updateStationBodySchema.safeParse({ isDefault: true }).success, true);
  assert.equal(updateStationBodySchema.safeParse({ isDefault: false }).success, false, "the default is moved, never unset");
  assert.equal(updateStationBodySchema.safeParse({}).success, false, "nothing to change");
});

test("printer body: a LAN printer needs its printing device; its port defaults to 9100; the host is the app's rule", () => {
  const parsed = printerBodySchema.parse(lanBody({ connection: { kind: "lan", host: "  192.168.1.60 " } }));
  assert.deepEqual(parsed.connection, { kind: "lan", host: "192.168.1.60", port: 9100 });
  assert.equal(printerBodySchema.parse(lanBody({ connection: { kind: "lan", host: "PRINTER.LOCAL", port: 9101 } })).connection.kind, "lan");
  const noPrimary = printerBodySchema.safeParse(lanBody({ primaryDeviceId: undefined }));
  assert.ok(!noPrimary.success && noPrimary.error.issues.some((i) => i.path[0] === "primaryDeviceId"), "a LAN printer without a printing device");
  for (const host of ["192.168.1.256", "printer:9100", "http://10.0.0.1", "", "a b"]) {
    assert.equal(printerBodySchema.safeParse(lanBody({ connection: { kind: "lan", host } })).success, false, host);
  }
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { kind: "lan", host: "10.0.0.5", port: 70000 } })).success, false);
});

test("printer body: a device printer is its own device's, so it never names another printing device", () => {
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: DEVICE, primaryDeviceId: undefined })).success, true);
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: DEVICE })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { ...DEVICE, transport: "serial" }, primaryDeviceId: undefined })).success, false, "a known transport only");
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { ...DEVICE, address: "" }, primaryDeviceId: undefined })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ connection: { ...DEVICE, host: "10.0.0.1" }, primaryDeviceId: undefined })).success, false, "strict: no mixed connection");
});

test("printer body: paper 58/80, 1–3 copies, station ids once each, every slip type stated, nothing else", () => {
  assert.equal(printerBodySchema.safeParse(lanBody({ paper: 76 })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ copies: { kot: 4, bill: 1 } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ copies: { kot: 1, bill: 0 } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [STATION, STATION], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: ["bar"], kotAll: false, notices: true, eod: false } })).success, false);
  assert.equal(printerBodySchema.safeParse(lanBody({ slips: { bill: true, kotStations: [], kotAll: false, notices: true } })).success, false, "eod must be stated");
  assert.equal(printerBodySchema.safeParse(lanBody({ health: { state: "online" } })).success, false, "strict: what the server keeps is never saved by the form");
  // Phase 3 (spec §9.4): a backup printer by id; anything else is refused.
  assert.equal(printerBodySchema.safeParse(lanBody({ backupPrinterId: STATION })).success, true, "a printer id");
  assert.equal(printerBodySchema.safeParse(lanBody({ backupPrinterId: "counter" })).success, false, "an id only");
  assert.equal(printerBodySchema.safeParse(lanBody({ backupPrinterId: null })).success, true, "null clears it (absent keeps it: the planning review, I-1)");
  assert.equal(printerBodySchema.safeParse(lanBody({ unreachable: [] })).success, false, "the skips are the server's");
  assert.equal(printerBodySchema.safeParse(lanBody({ name: "x".repeat(41) })).success, false);
});

test("wire shapes: ids are strings; a device printer carries no primaryDeviceId key", () => {
  const id = new Types.ObjectId();
  assert.deepEqual(stationWireOf({ _id: id, name: "Bar", order: 1, isDefault: false }), { id: String(id), name: "Bar", order: 1, isDefault: false });
  const wire = printerWireOf({
    _id: id,
    name: "Counter",
    connection: { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" },
    order: 0,
    paper: 80,
    slips: { bill: true, kotStations: [], kotAll: true, notices: true, eod: true },
    copies: { kot: 1, bill: 2 },
    enabled: true,
  });
  assert.equal(wire.id, String(id));
  assert.ok(!("primaryDeviceId" in wire), "omit-empty on the wire too");
  assert.ok(!("backupPrinterId" in wire) && !("unreachable" in wire), "Phase 3: omit-empty, the backup and the skips");
  assert.deepEqual(wire.connection, { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON" });
});

function src(rel: string): string {
  return stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
}

const ROUTES = ["app/api/stations/route.ts", "app/api/stations/[id]/route.ts", "app/api/printers/route.ts", "app/api/printers/[id]/route.ts"];
const LIBS = ["lib/print-stations.ts", "lib/print-printers.ts", "lib/print-routing-context.ts", "lib/print-printer-routing.ts"];

test("PIN: reads need a signed-in device, every write needs an admin", () => {
  for (const rel of ROUTES) {
    const file = src(rel);
    for (const [, verb, body] of file.matchAll(/export async function (GET|POST|PUT|DELETE)\([^)]*\) \{([\s\S]*?)\n\}/g)) {
      const guard = verb === "GET" ? "requireAuth()" : "requireAdmin()";
      assert.ok(body.trimStart().startsWith(`const authed = await ${guard};`), `${rel} ${verb} starts with ${guard}`);
    }
  }
});

test("PIN: every [id] is checked before the database; every answer after the guard is no-store", () => {
  for (const rel of ROUTES.filter((r) => r.includes("[id]"))) {
    const file = src(rel);
    assert.equal((file.match(/if \(!mongoose\.isValidObjectId\(id\)\) return noStore\(notFound\(/g) ?? []).length, 2, `${rel}: PUT and DELETE`);
  }
  for (const rel of ROUTES) {
    for (const line of src(rel).split("\n").filter((l) => /\breturn\b/.test(l))) {
      if (/return (authed|parsed)\.error;/.test(line)) continue;
      assert.match(line, /return noStore\(/, `${rel}: ${line.trim()}`);
    }
  }
});

test("PIN: the setup libs never connect, never log; the station delete clears the cached category and item lists", () => {
  for (const rel of LIBS) {
    const file = src(rel);
    assert.ok(!/connectDB\(/.test(file), `${rel} never calls connectDB()`);
    assert.ok(!/console\./.test(file), `${rel} never logs`);
  }
  const del = src("app/api/stations/[id]/route.ts");
  assert.match(del, /cache\.del\(CATEGORY_LIST\.cacheKey\);\s*cache\.del\(PRODUCT_LIST\.cacheKey\);/);
});

test("PIN: simple mode costs one read: the printers first, and null before anything else is read", () => {
  const file = src("lib/print-routing-context.ts");
  const first = file.indexOf("await listPrinters()");
  const bail = file.indexOf("if (!printersModeOn(printers)) return null;");
  const stations = file.indexOf("Station.find(");
  assert.ok(first > 0 && bail > first && stations > bail, "listPrinters, then the simple-mode answer, then the rest");
  assert.ok(!/cache\./.test(file), "read fresh: a printer switched off stops getting slips at once");
});

test("PIN: the routing is pure: no model, no database, no clock", () => {
  const file = src("lib/print-printer-routing.ts");
  assert.ok(!/@\/models\//.test(file), "no model import");
  assert.ok(!/Date\.now\(|new Date\(/.test(file), "no clock");
  assert.ok(!/from "mongoose"/.test(file), "no mongoose");
});

// Session 2C (the 2A gate's M7): "Bar" and "bar" would both print BAR, so names are unique ignoring case: a
// pre-check read with a case-insensitive collation (the 2A indexes stay as they are on every database).
test("PIN (2C, M7): a station or printer name is refused when another differs from it only in case", () => {
  for (const [rel, model] of [["lib/print-stations.ts", "Station"], ["lib/print-printers.ts", "Printer"]] as const) {
    const s = src(rel);
    assert.match(s, /const NAME_IGNORING_CASE = \{ locale: "en", strength: 2 \} as const;/, `${rel}: one collation`);
    assert.match(s, new RegExp(`${model}\\.findOne\\(\\{ name, \\.\\.\\.\\(exceptId !== undefined \\? \\{ _id: \\{ \\$ne: exceptId \\} \\} : \\{\\}\\) \\}\\)\\.collation\\(NAME_IGNORING_CASE\\)`), `${rel}: the pre-check`);
  }
});

// Session 2C (the 2B gate's ruling R6): every printer write tells each device to read its printers again (two
// Worker requests per admin save, never per slip). Stations change no device's printers.
test("PIN (2C): each printer write publishes print-setup; the kind is the room's, on both sides", () => {
  const s = src("lib/print-printers.ts");
  assert.equal(s.split('publishCafeEvent("print-setup")').length - 1, 3, "create, replace, delete");
  // The 2D review gate (M-2): a station delete that took the station off a printer is a printers write too.
  assert.equal(src("lib/print-stations.ts").split('publishCafeEvent("print-setup")').length - 1, 1, "only that delete; no other station write");
  assert.match(src("lib/realtime-publish.ts"), /"print-setup",/);
  assert.match(src("../../workers/realtime/src/index.ts"), /"print-setup"/);
});

// Session 2D (spec §11 Devices): the Printer setup page lists the devices that print or lease, and a network
// printer's printing device is chosen from them. An admin read, like the setup writes.
test("PIN (2D): the devices list is an admin read, no-store; its lib never connects or logs and reads one bounded page", () => {
  const route = src("app/api/print-devices/route.ts");
  assert.match(route, /export async function GET\(\) \{\s*const authed = await requireAdmin\(\);/, "admin only");
  for (const line of route.split("\n").filter((l) => /\breturn\b/.test(l))) {
    if (/return authed\.error;/.test(line)) continue;
    assert.match(line, /return noStore\(/, line.trim());
  }
  const lib = src("lib/print-device.ts");
  assert.ok(!/connectDB\(|console\./.test(lib), "never connects, never logs");
  assert.match(lib, /\.sort\(\{ lastSeenAt: -1 \}\)\s*\.limit\(PRINT_DEVICES_LIST_MAX\)/, "newest first, one bounded page");
});

// The 2A gate's M3 and M4, and the 2C review gate's F-3: station writes that never leave the setup half-done, and
// one enabled printer per printing device until Session 2E.
test("PIN (2D, the 2A gate's M3): a rename is saved before the default moves, so a refused rename never leaves no default", () => {
  const s = src("lib/print-stations.ts");
  const body = s.slice(s.indexOf("export async function updateStation("), s.indexOf("export async function deleteStation("));
  const renamed = body.indexOf("station.name = body.name;");
  const saved = body.indexOf("await station.save();");
  const cleared = body.indexOf("await Station.updateMany(");
  assert.ok(renamed >= 0 && saved > renamed && cleared > saved, `rename (${renamed}), its save (${saved}), then the old default cleared (${cleared})`);
});

test("PIN (2D, the 2A gate's M4): every pointer to a station is cleared before the station is deleted", () => {
  const s = src("lib/print-stations.ts");
  const body = s.slice(s.indexOf("export async function deleteStation("));
  const pulled = body.indexOf('Printer.updateMany({ "slips.kotStations": id }');
  const deleted = body.indexOf("await Station.deleteOne({ _id: id });");
  assert.ok(pulled >= 0 && deleted > pulled, `the pointers (${pulled}) before the delete (${deleted})`);
});

// The 2D review gate (M-2): a station delete that took a station off a printer is a printers write, so the other
// devices read their printers again, as after any printer save (two Worker requests per such delete).
test("PIN (the 2D review gate, M-2): a station delete that changed a printer's stations publishes print-setup", () => {
  const s = src("lib/print-stations.ts");
  const body = s.slice(s.indexOf("export async function deleteStation("));
  const pulled = body.indexOf('Printer.updateMany({ "slips.kotStations": id }');
  const deleted = body.indexOf("await Station.deleteOne({ _id: id });");
  const published = body.indexOf('if (printers.modifiedCount > 0) publishCafeEvent("print-setup");');
  assert.ok(pulled >= 0 && deleted > pulled && published > deleted, `the pointers (${pulled}), the delete (${deleted}), then the frame (${published})`);
});

test("PIN (2D, the 2C review gate's F-3): a printer save refuses a second enabled printer for one printing device", () => {
  const s = src("lib/print-printers.ts");
  assert.equal((s.match(/const clash = printerWriterClash\(/g) ?? []).length, 2, "create and replace both check");
  // Session 2E: the words say which clash it is (the same Windows printer twice, or a device that prints one).
  assert.equal((s.match(/if \(clash !== null\) return \{ ok: false, status: 409, error: printerClashMessage\(clash, stored\) \};/g) ?? []).length, 2, "both refuse with 409 and the other printer's name");
});

test("PIN (2C, the 2A gate's Important 1): the wake answers each agent's share from the setup", () => {
  const s = src("app/api/print-jobs/wake/route.ts");
  assert.match(s, /listPrinters\(\)/, "one read of the printers");
  assert.match(s, /agentDailyCap: printAgentDailyCap\(printers, agents\),/);
  // The 2C gate's emulator run: a writer whose printer list missed the frame hears from the same read that the
  // setup no longer names it, so it reads its list again and stops polling.
  assert.match(s, /writesPrinters: printerWriterDevices\(printers\)\.includes\(parsed\.data\.deviceId\),/);
});
