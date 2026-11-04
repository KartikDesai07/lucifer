import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { OfflineLine } from "@pos/shared/offline-kot";
import { stripComments } from "@/lib/source-pin-utils";
import { offlineKeptTime, offlineSaleTotalRefusal, offlineVerdictOf, type OfflineAsk } from "@/lib/print-offline-jobs";
import { createOrderPrintJobs } from "@/lib/print-order-jobs";
import { printConfigOf } from "@/lib/print";
import { allocateOpeningSlips } from "@/lib/slip-numbers";

// Printing Phase 5 (spec 2026-11-03 §5.9; plan Task 2): the jobs an offline round makes. The DB behaviour is proven
// live (npm run verify:print:live, leg BH); these are the pure rules and the source pins.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const CREATE = "apps/cafe/app/api/orders/route.ts";
const ROUND = "apps/cafe/app/api/orders/[id]/items/route.ts";
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const askOf = (lines: OfflineLine[], deviceId = "dev-a"): OfflineAsk => ({ deviceId, round: { ref: "O-3", takenAt: 1, lines } });
const line = (printerId: string | null, part: string, targetDeviceId = "dev-a") => ({ printerId, part, targetDeviceId });

test("no offline round means a new job", () => {
  for (const l of [line("p1", "s1"), line("p1", "all"), line(null, "-")]) {
    assert.equal(offlineVerdictOf(l, undefined), "new", `${l.printerId}:${l.part} without the field is made as today`);
  }
});

test("a line printed offline is printed; maybe is a reprint; later is new", () => {
  assert.equal(offlineVerdictOf(line("p1", "s1"), askOf([{ printerId: "p1", part: "s1", outcome: "printed" }])), "printed", "printed");
  assert.equal(offlineVerdictOf(line("p1", "s1"), askOf([{ printerId: "p1", part: "s1", outcome: "maybe" }])), "reprint", "maybe");
  assert.equal(offlineVerdictOf(line("p1", "s1"), askOf([{ printerId: "p1", part: "s1", outcome: "later" }])), "new", "later");
});

test("a station printed elsewhere is a REPRINT; a second printer of the same station is new", () => {
  const two = askOf([{ printerId: "p1", part: "s1", outcome: "printed" }, { printerId: "p2", part: "s1", outcome: "later" }]);
  assert.equal(offlineVerdictOf(line("p2", "s1"), two), "new", "the second printer of the station did not print offline");
  const one = askOf([{ printerId: "p1", part: "s1", outcome: "printed" }]);
  assert.equal(offlineVerdictOf(line("p3", "s1"), one), "reprint", "the station moved to p3 during the outage");
  assert.equal(offlineVerdictOf(line("p1", "all"), one), "new", "a full copy is its own paper");
  assert.equal(offlineVerdictOf(line("p3", "s2"), one), "new", "another station was never printed");
});

test("a station covered by a printed full copy is a REPRINT", () => {
  const full = askOf([{ printerId: "p2", part: "all", outcome: "printed" }]);
  assert.equal(offlineVerdictOf(line("p1", "s1"), full), "reprint", "the full copy carried s1 (the review's C2)");
  const maybe = askOf([{ printerId: "p2", part: "all", outcome: "maybe" }]);
  assert.equal(offlineVerdictOf(line("p1", "s2"), maybe), "reprint", "a full copy that may have printed covers s2 too");
  const later = askOf([{ printerId: "p2", part: "all", outcome: "later" }]);
  assert.equal(offlineVerdictOf(line("p1", "s1"), later), "new", "a full copy that never printed covers nothing");
});

test("a full copy printed on another printer is a REPRINT (the pass printer moved during the outage)", () => {
  // The device routes every line the server would, so a server full copy the field does not name means the setup
  // changed: the full copy now goes to p1, and p2 already printed (or may have printed) the whole round (the 5A review's I1).
  assert.equal(offlineVerdictOf(line("p1", "all"), askOf([{ printerId: "p2", part: "all", outcome: "printed" }])), "reprint", "printed on p2");
  assert.equal(offlineVerdictOf(line("p1", "all"), askOf([{ printerId: "p2", part: "all", outcome: "maybe" }])), "reprint", "maybe on p2");
  assert.equal(offlineVerdictOf(line("p1", "all"), askOf([{ printerId: "p2", part: "all", outcome: "later" }])), "new", "p2 never printed");
  const byDesign = askOf([{ printerId: "p2", part: "all", outcome: "printed" }, { printerId: "p1", part: "all", outcome: "later" }]);
  assert.equal(offlineVerdictOf(line("p1", "all"), byDesign), "new", "two full-copy printers by design: p1's own line is named later");
});

test("simple mode prints on the asking device only", () => {
  const printed = askOf([{ printerId: null, part: "-", outcome: "printed" }]);
  assert.equal(offlineVerdictOf(line(null, "-", "dev-a"), printed), "printed", "the asking device printed its own KOT");
  assert.equal(offlineVerdictOf(line(null, "-", "dev-host"), printed), "reprint", "a host now prints it: paper is already out");
  const maybe = askOf([{ printerId: null, part: "-", outcome: "maybe" }]);
  assert.equal(offlineVerdictOf(line(null, "-", "dev-a"), maybe), "reprint", "maybe is a reprint");
  const later = askOf([{ printerId: null, part: "-", outcome: "later" }]);
  assert.equal(offlineVerdictOf(line(null, "-", "dev-a"), later), "new", "a waiter phone kept it: printed now");
});

test("a setup switched between simple and printers mode during the outage never prints unlabelled twice", () => {
  const simplePrinted = askOf([{ printerId: null, part: "-", outcome: "printed" }]);
  assert.equal(offlineVerdictOf(line("p1", "s1"), simplePrinted), "reprint", "the whole ticket printed offline covered s1");
  const stationPrinted = askOf([{ printerId: "p1", part: "s1", outcome: "printed" }]);
  assert.equal(offlineVerdictOf(line(null, "-", "dev-a"), stationPrinted), "reprint", "a station ticket printed offline is part of the whole KOT");
  const stationLater = askOf([{ printerId: "p1", part: "s1", outcome: "later" }]);
  assert.equal(offlineVerdictOf(line(null, "-", "dev-a"), stationLater), "new", "nothing printed offline: printed now");
});

// IST is UTC+05:30: 18:20 UTC is 23:50 IST.
const IST = (iso: string): number => Date.parse(`${iso}+05:30`);
test("the kept time is the taken time only on the arrival's day", () => {
  const now = IST("2026-11-04T15:00:00");
  assert.equal(offlineKeptTime(now - 3 * 3_600_000, now, [0, 0, 0]), now - 3 * 3_600_000, "3 h back on the same day is kept");
  assert.equal(offlineKeptTime(IST("2026-11-03T23:50:00"), IST("2026-11-04T00:10:00"), [0, 0, 0]), null, "taken before midnight, arrived after");
  const at0530 = IST("2026-11-04T05:30:00");
  const at0700 = IST("2026-11-04T07:00:00");
  assert.equal(offlineKeptTime(at0530, at0700, [0, 6 * 60, 0]), null, "the KOT series restarted at 06:00 in between");
  assert.equal(offlineKeptTime(at0530, at0700, [0, 0, 0]), at0530, "every series agrees: kept");
  assert.equal(offlineKeptTime(now - 13 * 3_600_000, now, [0, 0, 0]), null, "13 h back is past the window");
  assert.equal(offlineKeptTime(now + 6 * 60_000, now, [0, 0, 0]), null, "6 minutes ahead is past the clock allowance");
});

test("an offline sale whose total changed is refused before any number", () => {
  const sale = { ref: "O-4", takenAt: 1, total: 240, lines: [] };
  assert.equal(offlineSaleTotalRefusal(260, undefined, "Completed"), null, "an online sale is never checked");
  assert.equal(offlineSaleTotalRefusal(260, { ...sale, total: undefined }, "Completed"), null, "a round carries no total");
  assert.equal(offlineSaleTotalRefusal(260, sale, "Pending"), null, "an open tab is not a sale");
  assert.equal(offlineSaleTotalRefusal(240.004, sale, "Completed"), null, "equal to the paisa");
  assert.equal(offlineSaleTotalRefusal(260, sale, "Completed"), "The total is now ₹260; this device took ₹240.", "the sentence");
  assert.equal(offlineSaleTotalRefusal(260.5, { ...sale, total: 240.25 }, "Completed"), "The total is now ₹260.50; this device took ₹240.25.", "paise shown");
  inOrder(src(CREATE), ["offlineSaleTotalRefusal(", "allocateOpeningSlips("], "the create refuses before any slip number");
  inOrder(src(CREATE), ["offlineSaleTotalRefusal(", "nextOrderSequence("], "the create refuses before the order number");
});

test("an offline round whose job creation throws is not swallowed; an online one is", async () => {
  const base = { order: undefined, slips: [{ kind: "kot" as const, round: 1 }], originDeviceId: "dev-a", queuedBy: "Asha", nowMs: 1 };
  assert.deepEqual(await createOrderPrintJobs(base), [], "online: an unreadable order makes nothing and never throws");
  await assert.rejects(createOrderPrintJobs({ ...base, offline: askOf([]) }), "offline: the error reaches the route (503, sent again)");
});

test("a skip-KOT offline round answers 200 and makes no job", async () => {
  const order = { _id: "64b7f0c2a1d2e3f4a5b6c7d8", items: [{ productId: "x", name: "Water", price: 20, qty: 1, kotRound: 1, noKot: true }] };
  const refs = await createOrderPrintJobs({ order, slips: [{ kind: "kot", round: 1 }], originDeviceId: "dev-a", queuedBy: "Asha", nowMs: 1, offline: askOf([]) });
  assert.deepEqual(refs, [], "a round with no kitchen line wants no job and does not throw (the re-check's N1)");
  for (const rel of [CREATE, ROUND]) {
    const text = src(rel);
    assert.ok(text.includes(".catch(offlineSlipsUnmade)"), `${rel}: only a thrown creation becomes the 503`);
    assert.ok(text.includes("printJobs instanceof Response"), `${rel}: the 503 is answered`);
  }
});

test("a printed job never takes the line's direct lease", () => {
  const text = src("apps/cafe/lib/print-printer-jobs.ts");
  inOrder(text, ["offlineVerdictOf(", "if (verdict !== \"new\")", "continue;", "askingTabOf(job, asking, seen)"], "the verdict comes before the asking tab");
  const simple = src("apps/cafe/lib/print-order-jobs.ts");
  inOrder(simple, ["offlineVerdictOf(", "const first = verdict === \"new\" && live === 0", "insertPrintJob("], "simple mode: only a new job may be the first on the line");
  const insert = src("apps/cafe/lib/print-job-insert.ts");
  assert.ok(insert.includes("failed !== null || offlineMade !== null ? null"), "an offline-made job never has an asking tab (no direct lease)");
});

test("the routes pass the offline round to job creation and refuse it without a device id", () => {
  for (const rel of [CREATE, ROUND]) {
    const text = src(rel);
    assert.ok(/offlineAskOf\(req, (data|parsed\.data)\.offline\)/.test(text), `${rel}: reads the field through offlineAskOf`);
    assert.ok(text.includes("if (\"error\" in offline) return offline.error;"), `${rel}: answers its 400`);
    assert.ok(text.includes("offline: offline.ask,"), `${rel}: passes the round into createOrderPrintJobs`);
    assert.ok(text.includes("withOfflineEcho("), `${rel}: echoes the field`);
  }
  const create = src(CREATE);
  // The owner's answer after 5C (2026-11-04): no token only for an order whose KOT paper printed (or may have) offline.
  assert.ok(create.includes("allocateOpeningSlips(printCfg, { kitchen: kot.kitchen }, undefined, { token: !offlinePaperOut(data.offline) })"), "no token for an order whose paper printed offline");
  assert.ok(create.includes("...(intent && offline.ask === undefined ? { kotPrintDevices: [intent.deviceId] } : {})"), "an offline order is never repaired");
  assert.ok(create.includes("...(kept !== null ? { createdAt: new Date(kept) } : {})"), "the taken time is the order's createdAt");
  assert.ok(!create.includes("kotFiredAt"), "the create route writes no kotFiredAt");
  const round = src(ROUND);
  assert.ok(round.includes("buildKotPrintDevices(old.kotPrintDevices, round, offline.ask === undefined ? intent?.deviceId : undefined)"), "an offline round is never repaired");
  assert.ok(round.includes("const firedAt = new Date(kept ?? nowMs);"), "the taken time is the round's fire time");
});

test("an order taken offline draws no token number", async () => {
  const drawn: string[] = [];
  const deps = { nextSequence: async (series: string) => (drawn.push(series), 7) };
  const cfg = printConfigOf({ kotShowNumber: true, tokenEnabled: true });
  const online = await allocateOpeningSlips(cfg, { kitchen: true }, deps);
  assert.equal(typeof online.tokenNumber, "number", "online: the token is drawn as today");
  drawn.length = 0;
  const offline = await allocateOpeningSlips(cfg, { kitchen: true }, deps, { token: false });
  assert.equal("tokenNumber" in offline, false, "offline: no token (staff call it by O-n)");
  assert.deepEqual(drawn, ["kot"], "offline: only the KOT series is drawn");
});

// The owner's answer after 5C (2026-11-04), the final review's m4: an order kept offline that printed nothing (a send cut
// half-way that never landed, a waiter phone's order) has no OFFLINE · O-n paper for the customer, so it is saved as an
// online order would be: with its token. Only paper printed (or maybe printed) offline means staff call it by O-n.
test("an order with paper printed offline draws no token; one that printed nothing offline draws it as usual", async () => {
  const { offlinePaperOut } = await import("@/lib/print-offline-jobs");
  const round = (outcomes: ("printed" | "maybe" | "later")[]) => ({ ref: "O-3", takenAt: 1, lines: outcomes.map((outcome, i) => ({ printerId: `p${i}`, part: "s", outcome })) });
  assert.equal(offlinePaperOut(undefined), false, "an online order: the token as today");
  assert.equal(offlinePaperOut(round(["later", "later"])), false, "nothing printed offline: the token as usual");
  assert.equal(offlinePaperOut(round(["later", "printed"])), true, "a line printed offline: no token (O-n)");
  assert.equal(offlinePaperOut(round(["maybe"])), true, "a line that may have printed: no token");
});
