import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertDialableUri,
  backupFileName,
  backupKey,
  backupSetFor,
  clusterList,
  dateFromBackupKey,
  daysBetween,
  istParts,
  normalizeDayKey,
  pruneBeforeDate,
  redactUri,
} from "./lib.mjs";

// F2 Step F2.9 — the pure hygiene planning half, proven with zero installs
// (`node --test scripts/db-hygiene/lib.test.mjs`). Pins: the IST calendar, the
// registry enumeration incl. the #19 corrupt-doc refusal and the standby rows,
// the backup stagger (nightly live set / weekly immutable archives / the
// recently-retired RPO hole closed), key naming the prune step can parse back,
// and that ciphertext URIs fail fast WITHOUT being echoed.

const CORE_URI = "mongodb+srv://user:pass@core.mongodb.net/pos";

function fixtureDoc() {
  return {
    _id: "cluster-registry",
    core: { id: "core", uri: "mirror", tag: "C" },
    ledgers: [
      { id: "l-a", uri: "mongodb+srv://u:p@a.mongodb.net/pos", tag: "A", from: null, to: "2026-04-01", active: false },
      { id: "l-a2", uri: "mongodb+srv://u:p@a2.mongodb.net/pos", tag: "A2", from: "2026-04-01", to: "2026-07-01", active: false },
      { id: "l-a3", uri: "mongodb+srv://u:p@a3.mongodb.net/pos", tag: "A3", from: "2026-06-30", to: null, active: true },
    ],
    standby: [{ id: "l-a4", uri: "mongodb+srv://u:p@a4.mongodb.net/pos", empty: true }],
  };
}

// ── IST calendar ──────────────────────────────────────────────────────────────
test("istParts: 21:30 UTC is already the NEXT IST calendar day (03:00 IST)", () => {
  const { date, weekday } = istParts(new Date("2026-07-04T21:30:00.000Z"));
  assert.equal(date, "2026-07-05"); // Sunday
  assert.equal(weekday, 0);
});

test("normalizeDayKey accepts both registry day-key spellings", () => {
  assert.equal(normalizeDayKey("2026-04-01"), "2026-04-01");
  assert.equal(normalizeDayKey("20260401"), "2026-04-01");
  assert.throws(() => normalizeDayKey("2026-4-1"), /unusable day key/);
});

test("daysBetween is signed", () => {
  assert.equal(daysBetween("2026-07-01", "2026-07-05"), 4);
  assert.equal(daysBetween("2026-07-05", "2026-07-01"), -4);
});

// ── Enumeration ───────────────────────────────────────────────────────────────
test("clusterList: core (env URI) + every ledger + every standby", () => {
  const { bootstrap, rows } = clusterList(CORE_URI, fixtureDoc());
  assert.equal(bootstrap, false);
  assert.deepEqual(
    rows.map((r) => [r.id, r.role, r.active ?? null]),
    [
      ["core", "core", null],
      ["l-a", "ledger", false],
      ["l-a2", "ledger", false],
      ["l-a3", "ledger", true],
      ["l-a4", "standby", null],
    ],
  );
  assert.equal(rows[0].uri, CORE_URI); // env-authoritative, never the doc mirror
  assert.equal(rows[4].tag, undefined); // tagless manual-paste standby
});

test("clusterList: no doc = bootstrap core-only; corrupt doc (no ledgers) throws (#19)", () => {
  const { bootstrap, rows } = clusterList(CORE_URI, null);
  assert.equal(bootstrap, true);
  assert.deepEqual(rows.map((r) => r.id), ["core"]);
  assert.throws(() => clusterList(CORE_URI, { ledgers: [] }), /refusing to guess/);
  assert.throws(() => clusterList("", null), /is not set/);
});

// ── URI hygiene ───────────────────────────────────────────────────────────────
test("assertDialableUri: vault ciphertext fails fast and is NEVER echoed", () => {
  assertDialableUri("mongodb://x/db", "ok");
  assertDialableUri("mongodb+srv://x/db", "ok");
  const cipher = "gcm:SECRETCIPHERTEXT";
  try {
    assertDialableUri(cipher, "l-a");
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /not a dialable/);
    assert.ok(!err.message.includes("SECRETCIPHERTEXT"));
  }
});

test("redactUri strips credentials", () => {
  assert.equal(
    redactUri("mongodb+srv://user:p%40ss@host.net/pos"),
    "mongodb+srv://***@host.net/pos",
  );
});

// ── Backup stagger ────────────────────────────────────────────────────────────
// 2026-07-04T21:30Z = IST Sunday 2026-07-05. Fixture: l-a retired 2026-04-01
// (old archive, slot 0 → due on Sunday weekday 0), l-a2 retired 2026-07-01
// (4 days ago → recently-retired nightly), l-a3 active, l-a4 standby.
const NOW = new Date("2026-07-04T21:30:00.000Z");

test("backupSetFor: nightly live set + recently-retired archive; old archive on its weekly slot", () => {
  const { rows } = clusterList(CORE_URI, fixtureDoc());
  const plan = backupSetFor(rows, NOW);
  const by = Object.fromEntries(plan.map((r) => [r.id, r]));
  assert.equal(by.core.due, true);
  assert.equal(by["l-a3"].due, true); // active
  assert.equal(by["l-a4"].due, true); // standby (tiny, keeps the drill honest)
  assert.equal(by["l-a2"].due, true); // retired 4 days ago — trailing writes
  assert.match(by["l-a2"].reason, /recently retired/);
  assert.equal(by["l-a"].due, true); // old archive, slot 0 === Sunday(0)
  assert.match(by["l-a"].reason, /weekly/);
});

test("backupSetFor: an old archive off its slot is skipped — but never a live-set cluster", () => {
  const { rows } = clusterList(CORE_URI, fixtureDoc());
  const monday = new Date("2026-07-05T21:30:00.000Z"); // IST Monday 2026-07-06
  const by = Object.fromEntries(backupSetFor(rows, monday).map((r) => [r.id, r]));
  assert.equal(by["l-a"].due, false); // slot 0, today weekday 1
  assert.match(by["l-a"].reason, /skipped/);
  assert.equal(by.core.due, true);
  assert.equal(by["l-a3"].due, true);
});

test("backupSetFor: forceAll dumps everything (the manual restore drill)", () => {
  const { rows } = clusterList(CORE_URI, fixtureDoc());
  const monday = new Date("2026-07-05T21:30:00.000Z");
  const plan = backupSetFor(rows, monday, true);
  assert.ok(plan.every((r) => r.due));
});

test("backupSetFor: flip-day `to` in the FUTURE (one-day overlap) still counts as recently retired", () => {
  // F2.7 writes the retiring ledger's `to` = start of TOMORROW: on flip day
  // daysBetween(to, today) is -1 — the guard must treat that as recent.
  const rows = [
    { id: "l-x", tag: "X", role: "ledger", active: false, to: "2026-07-06", uri: "mongodb://x/db" },
  ];
  const by = Object.fromEntries(backupSetFor(rows, NOW).map((r) => [r.id, r]));
  assert.equal(by["l-x"].due, true);
  assert.match(by["l-x"].reason, /recently retired/);
});

// ── Naming + retention ────────────────────────────────────────────────────────
test("backup key round-trips through the prune parser; foreign keys are ignored", () => {
  const row = { id: "l-a2", tag: "A2", role: "ledger" };
  const key = backupKey("db-backups/dev", row, "2026-07-05");
  assert.equal(key, "db-backups/dev/A2/2026-07-05.archive.gz.enc");
  assert.equal(dateFromBackupKey(key), "2026-07-05");
  assert.equal(dateFromBackupKey("db-backups/dev/A2/notes.txt"), null);
  assert.equal(backupFileName({ id: "l-s" }, "2026-07-05"), "l-s-2026-07-05.archive.gz");
});

test("pruneBeforeDate: retention window in IST days; garbage retention throws", () => {
  assert.equal(pruneBeforeDate(NOW, 14), "2026-06-21");
  assert.throws(() => pruneBeforeDate(NOW, "soon"), /unusable retentionDays/);
  assert.throws(() => pruneBeforeDate(NOW, 0), /unusable retentionDays/);
});
