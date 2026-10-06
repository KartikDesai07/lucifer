import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { PRINTER_DEVICE_ID_MAX_CHARS } from "@pos/shared/print-printers";
import { stationSchema, Station } from "../models/Station";
import { printerSchema, Printer, printerConnectionComplete } from "../models/Printer";
import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { assertSchemaTtlAllowed } from "./ttl-guard";

// Printing redesign, Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A2): DB-free shape tests
// for the station and printer models and the station fields on Category and Product. Every assertion reads
// the compiled schema or validates an unsaved document (the print-job-model.test.ts idiom).

const KITCHEN_ID = "64f000000000000000000001";

function lanPrinter(over: Record<string, unknown> = {}) {
  return {
    name: "Kitchen printer",
    connection: { kind: "lan", host: "192.168.1.60", port: 9100 },
    primaryDeviceId: "kitchen-tab",
    order: 0,
    paper: 80,
    slips: { bill: false, kotStations: [KITCHEN_ID], kotAll: false, notices: true, eod: false },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

test("Station: name is required, unique and trimmed; order and isDefault are required; timestamps on", () => {
  assert.equal(stationSchema.path("name").options.unique, true, "two stations with one name could never be told apart on paper");
  const err = new Station({}).validateSync();
  for (const p of ["name", "order", "isDefault"]) assert.ok(err?.errors[p], `${p} is required`);
  assert.equal(new Station({ name: "  Bar  ", order: 1, isDefault: false }).name, "Bar");
  assert.ok(new Station({ name: "x".repeat(33), order: 1, isDefault: false }).validateSync()?.errors.name, "a name prints on the slip: 32 characters at most");
  assert.equal(stationSchema.get("timestamps"), true);
});

test("Printer: a LAN printer and a device printer validate; name is unique; timestamps on", () => {
  assert.equal(new Printer(lanPrinter()).validateSync(), undefined);
  const device = lanPrinter({
    name: "Counter printer",
    connection: { kind: "device", deviceId: "counter-pc", transport: "windows", address: "EPSON TM-T82" },
    primaryDeviceId: undefined,
  });
  assert.equal(new Printer(device).validateSync(), undefined);
  assert.equal(printerSchema.path("name").options.unique, true);
  assert.equal(printerSchema.get("timestamps"), true);
});

test("Printer: a connection is either a LAN address or one device's printer, never a mix", () => {
  assert.equal(printerConnectionComplete({ kind: "lan", host: "10.0.0.5", port: 9100 }), true);
  assert.equal(printerConnectionComplete({ kind: "lan", host: "10.0.0.5" }), false, "a LAN printer needs its port");
  assert.equal(printerConnectionComplete({ kind: "lan", host: "10.0.0.5", port: 9100, deviceId: "x" }), false);
  assert.equal(printerConnectionComplete({ kind: "device", deviceId: "d", transport: "usb", address: "usb:0483:5743" }), true);
  assert.equal(printerConnectionComplete({ kind: "device", deviceId: "d", transport: "usb" }), false, "a device printer needs its address");
  assert.equal(printerConnectionComplete({ kind: "device", deviceId: "d", transport: "usb", address: "a", port: 9100 }), false);
  assert.equal(printerConnectionComplete(undefined), false);
  const mixed = new Printer(lanPrinter({ connection: { kind: "lan", host: "10.0.0.5", port: 9100, address: "x" } })).validateSync();
  assert.ok(mixed?.errors.connection, "the model refuses a mixed connection on its own");
});

test("Printer: paper, transport, copies and the slips are checked by the model too", () => {
  assert.ok(new Printer(lanPrinter({ paper: 76 })).validateSync()?.errors.paper, "58 or 80 only");
  const badTransport = new Printer(lanPrinter({ connection: { kind: "device", deviceId: "d", transport: "serial", address: "a" } })).validateSync();
  assert.ok(Object.keys(badTransport?.errors ?? {}).some((k) => k.startsWith("connection")), "an unknown transport is refused");
  assert.ok(new Printer(lanPrinter({ copies: { kot: 4, bill: 1 } })).validateSync()?.errors["copies.kot"], "at most three copies");
  assert.ok(new Printer(lanPrinter({ copies: { kot: 1, bill: 0 } })).validateSync()?.errors["copies.bill"], "at least one copy");
  const noSlips = new Printer(lanPrinter({ slips: undefined })).validateSync();
  assert.ok(noSlips?.errors.slips, "the slips are always stated");
});

test("Station and Printer: no TTL index (ttl-guard default-deny)", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Station", stationSchema));
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Printer", printerSchema));
  for (const schema of [stationSchema, printerSchema]) {
    assert.ok(schema.indexes().every(([, options]) => options?.expireAfterSeconds === undefined));
  }
});

test("a device id is the same value everywhere: the shared bound equals the print host's", () => {
  assert.equal(PRINTER_DEVICE_ID_MAX_CHARS, PRINT_HOST_DEVICE_ID_MAX_CHARS);
});

test("Category and Product: stationId is absent unless chosen (omit-empty: existing rows keep their meaning)", () => {
  const category = new Category({ name: "Drinks" });
  assert.equal(category.get("stationId"), undefined);
  const product = new Product({ name: "Tea", categoryId: KITCHEN_ID, price: 20 });
  assert.equal(product.get("stationId"), undefined);
  assert.equal(new Category({ name: "Drinks", stationId: KITCHEN_ID }).validateSync(), undefined);
  assert.equal(String(new Product({ name: "Tea", categoryId: KITCHEN_ID, price: 20, stationId: KITCHEN_ID }).get("stationId")), KITCHEN_ID);
});

function cafeSrc(rel: string): string {
  return stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
}

test("PIN: PUT /api/categories/[id] turns stationId:null into a removed field, never a stored null", () => {
  const src = cafeSrc("app/api/categories/[id]/route.ts");
  assert.match(src, /const \{ stationId, \.\.\.rest \} = parsed\.data;/);
  assert.match(src, /if \(stationId === null\) existing\.set\("stationId", undefined\);/);
  assert.ok(!/existing\.set\(parsed\.data\)/.test(src), "the whole body is never set as it came");
});

test("PIN: PUT /api/products/[id] clears stationId on null like icon and publicVisible", () => {
  const src = cafeSrc("app/api/products/[id]/route.ts");
  assert.match(src, /nullClearsFields: \["variations", "publicVisible", "icon", "stationId"\]/);
});
