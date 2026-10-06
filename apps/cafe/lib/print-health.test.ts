import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINTER_HEALTH_REFRESH_MS, type PrinterHealth, type PrinterHealthReport } from "@pos/shared/print-failover";
import { printerHealthChangedFilter, printerHealthNeedsWrite } from "@/lib/print-health";

// Printing Phase 3 Session 3A (spec §10): health rides the wake. The planning review (M-2): a report is compared with the
// kept health in memory first, so a wake that changes nothing costs no Atlas operation (the filter stays the race guard).
// The writes themselves are proven live (leg bc).

const T0 = Date.parse("2026-10-07T12:00:00.000Z");
const kept: PrinterHealth = { link: "connected", paper: "ok", deviceId: "bar-phone", at: new Date(T0).toISOString() };
const same: PrinterHealthReport = { printerId: "p", link: "connected", paper: "ok" };

test("printerHealthNeedsWrite: nothing kept, or something new, or a refresh due; never the same report again", () => {
  assert.equal(printerHealthNeedsWrite(undefined, "bar-phone", same, T0), true, "nothing kept yet");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", same, T0 + 60_000), false, "the same report a minute later: no write, no operation");
  assert.equal(printerHealthNeedsWrite(kept, "other-phone", same, T0), true, "another writer");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, link: "disconnected" }, T0), true, "the link");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, paper: "out" }, T0), true, "the paper");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { printerId: "p", link: "connected" }, T0), true, "a paper state no longer said");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, cover: "open" }, T0), true, "the cover");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", { ...same, error: true }, T0), true, "an error");
  assert.equal(printerHealthNeedsWrite({ ...kept, error: true }, "bar-phone", same, T0), true, "an error gone");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", same, T0 + PRINTER_HEALTH_REFRESH_MS), false, "not due at exactly 5 minutes");
  assert.equal(printerHealthNeedsWrite(kept, "bar-phone", same, T0 + PRINTER_HEALTH_REFRESH_MS + 1), true, "a steady state refreshed after 5 minutes");
});

test("printerHealthChangedFilter: the same test, as the write's race guard", () => {
  const filter = printerHealthChangedFilter("p", "bar-phone", same, T0) as { _id: string; $or: Array<Record<string, unknown>> };
  assert.equal(filter._id, "p", "one printer");
  assert.deepEqual(filter.$or.map((term) => Object.keys(term)[0]), ["health.deviceId", "health.link", "health.paper", "health.cover", "health.error", "health.at"], "every field the in-memory test reads");
  assert.deepEqual(filter.$or[4], { "health.error": { $ne: null } }, "an absent error matches a kept one that has none");
});
