import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILL_BLOCK_TYPES,
  BILL_LOCKS,
  BILL_REQUIRED_BLOCKS,
  KOT_BLOCK_TYPES,
  KOT_LOCKS,
  KOT_REQUIRED_BLOCKS,
  REPEATABLE_BLOCK_TYPES,
  TOKEN_BLOCK_TYPES,
  TOKEN_LOCKS,
  TOKEN_REQUIRED_BLOCKS,
  billBlockLocked,
  isValidBlockId,
  kotBlockLocked,
  tokenBlockLocked,
  type SlipLockContext,
} from "./print-template";

const ctx = (over: Partial<SlipLockContext>): SlipLockContext => ({ gst: false, fssai: false, banner: false, ...over });

test("isValidBlockId", () => {
  const table: [string, string, boolean][] = [
    ["name", "name", true], ["name", "name-1", false], ["name", "nme", false],
    ["divider", "divider-1", true], ["divider", "divider-999", true], ["divider", "divider", false],
    ["divider", "divider-0", false], ["divider", "divider-01", false], ["divider", "divider-1000", false],
    ["divider", "divider-x", false], ["customText", "customText-12", true], ["customText", "divider-1", false],
    ["qr", "qr-3", true], ["qr", "qr-", false],
  ];
  for (const [type, id, ok] of table) assert.equal(isValidBlockId(type, id), ok, `${type} ${id}`);
});

// LITERAL pins: the loops below iterate the constants, so moving a type between cells would stay green there.
test("the lock tables are pinned to their literal lists", () => {
  assert.deepEqual([...BILL_LOCKS.always], ["name", "dateTime", "items", "total", "cancelBanner", "cancelReason"]);
  assert.deepEqual([...BILL_LOCKS.withGst], ["billNo", "orderId", "gstin", "address", "taxes", "taxIncluded", "title"]);
  assert.deepEqual([...BILL_LOCKS.withFssai], ["fssai"]);
  assert.deepEqual([...BILL_LOCKS.withBanner], []);
  assert.deepEqual([...KOT_LOCKS.always, ...KOT_LOCKS.withGst, ...KOT_LOCKS.withFssai], []);
  assert.deepEqual([...KOT_LOCKS.withBanner], ["title", "table", "items"]);
  assert.deepEqual([...TOKEN_LOCKS.always], ["tokenNo"]);
  assert.deepEqual([...TOKEN_LOCKS.withGst, ...TOKEN_LOCKS.withFssai, ...TOKEN_LOCKS.withBanner], []);
});

test("billBlockLocked: always / withGst / withFssai cells, and nothing else", () => {
  for (const type of BILL_LOCKS.always) assert.equal(billBlockLocked(type, ctx({})), true, type);
  for (const type of BILL_LOCKS.withGst) {
    assert.equal(billBlockLocked(type, ctx({})), false, `${type} off-GST`);
    assert.equal(billBlockLocked(type, ctx({ gst: true })), true, `${type} on-GST`);
  }
  assert.equal(billBlockLocked("fssai", ctx({})), false);
  assert.equal(billBlockLocked("fssai", ctx({ gst: true })), false);
  assert.equal(billBlockLocked("fssai", ctx({ fssai: true })), true);
  assert.equal(billBlockLocked("tagline", ctx({ gst: true, fssai: true, banner: true })), false);
  assert.equal(billBlockLocked("name", ctx({})), true);
  // total is locked unconditionally (a literal check, independent of the table constant)
  assert.equal(billBlockLocked("total", ctx({})), true);
});

test("kotBlockLocked: title, table and items only on a void / moved slip; tokenNo always on a token", () => {
  for (const type of ["title", "table", "items"] as const) {
    assert.equal(kotBlockLocked(type, ctx({})), false, `${type} is free on a normal ticket`);
    assert.equal(kotBlockLocked(type, ctx({ gst: true, fssai: true })), false, `${type}: gst / fssai never lock a ticket`);
    assert.equal(kotBlockLocked(type, ctx({ banner: true })), true, `${type} is locked with the banner`);
    assert.equal(kotBlockLocked(type, ctx({ gst: true, fssai: true, banner: true })), true, `${type} stays locked with everything on`);
  }
  // Every other ticket line stays free even on a void / moved slip (kotNo is the engine's own rule, not a lock).
  for (const type of KOT_BLOCK_TYPES) {
    if (["title", "table", "items"].includes(type)) continue;
    assert.equal(kotBlockLocked(type, ctx({ gst: true, fssai: true, banner: true })), false, `${type} is never locked`);
  }
  assert.equal(tokenBlockLocked("tokenNo", ctx({})), true);
  assert.equal(tokenBlockLocked("label", ctx({ gst: true, fssai: true, banner: true })), false);
});

test("required lists are every lockable block and sit inside their catalogs", () => {
  for (const type of ["name", "dateTime", "items", "total", "cancelBanner", "cancelReason", "billNo", "orderId", "gstin", "address", "taxes", "taxIncluded", "fssai", "title"] as const) {
    assert.ok(BILL_REQUIRED_BLOCKS.includes(type), type);
  }
  assert.equal(BILL_REQUIRED_BLOCKS.length, 14);
  assert.deepEqual([...KOT_REQUIRED_BLOCKS], ["title", "table", "items"]);
  assert.deepEqual([...TOKEN_REQUIRED_BLOCKS], ["tokenNo"]);
  const kinds = [
    { catalog: BILL_BLOCK_TYPES as readonly string[], required: BILL_REQUIRED_BLOCKS, locks: BILL_LOCKS },
    { catalog: KOT_BLOCK_TYPES as readonly string[], required: KOT_REQUIRED_BLOCKS, locks: KOT_LOCKS },
    { catalog: TOKEN_BLOCK_TYPES as readonly string[], required: TOKEN_REQUIRED_BLOCKS, locks: TOKEN_LOCKS },
  ];
  for (const { catalog, required, locks } of kinds) {
    assert.equal(new Set(catalog).size, catalog.length, "no duplicate catalog types");
    for (const type of REPEATABLE_BLOCK_TYPES) assert.ok(catalog.includes(type), `catalog has ${type}`);
    for (const type of required) assert.ok(catalog.includes(type), `required ${type} is in the catalog`);
    for (const list of [locks.always, locks.withGst, locks.withFssai, locks.withBanner]) {
      for (const type of list) assert.ok(catalog.includes(type), `locked ${type} is in the catalog`);
    }
  }
});

test("every locked type is required, and a required list has no duplicates", () => {
  const kinds = [
    { name: "bill", required: BILL_REQUIRED_BLOCKS as readonly string[], locks: BILL_LOCKS },
    { name: "kot", required: KOT_REQUIRED_BLOCKS as readonly string[], locks: KOT_LOCKS },
    { name: "token", required: TOKEN_REQUIRED_BLOCKS as readonly string[], locks: TOKEN_LOCKS },
  ];
  for (const { name, required, locks } of kinds) {
    assert.equal(new Set(required).size, required.length, `${name} required has no duplicates`);
    for (const cell of ["always", "withGst", "withFssai", "withBanner"] as const) {
      for (const type of locks[cell]) assert.ok(required.includes(type), `${name} ${cell} ${type} is required`);
    }
  }
});
