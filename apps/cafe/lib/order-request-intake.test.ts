import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildRequestDoc,
  pendingCutoff,
  resolvedCutoff,
  acceptingCutoff,
  tableChargeApplies,
  tableChargeAppliesOnEdit,
  quoteRequestTotals,
  PUBLIC_REQUEST_PENDING_TTL_MS,
  PUBLIC_REQUEST_RESOLVED_TTL_MS,
  PUBLIC_REQUEST_ACCEPTING_TTL_MS,
  type IntakeTable,
} from "./order-request-intake";
import type { PricedLine } from "./public-pricing";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import type { ISettings } from "@/models/Settings";
import { computeOrderTotals } from "@/lib/receipt";

// CR2.2 SLICE 5 — DB-free tests for the pure intake math. Control characters
// are built via String.fromCharCode (never a literal control char, and never
// a \u escape typed inline — both have proven unreliable to get through this
// tool chain intact; this repo has been bitten by invisible control
// characters in source before).
const BELL = String.fromCharCode(7);

const TABLE_INPUT: CreatePublicOrderRequestInput = {
  target: { kind: "table", token: "0123456789ABCD" },
  items: [{ productId: "p1", modifiers: [], qty: 1 }],
  name: "Diner",
  mobile: "9876543210",
};

const PARCEL_INPUT: CreatePublicOrderRequestInput = {
  ...TABLE_INPUT,
  target: { kind: "parcel" },
};

const LINE: PricedLine = {
  productId: "p1",
  name: "Filter Coffee",
  price: 40,
  qty: 2,
  modifiers: [],
};

const TABLE: IntakeTable = { tableNo: "T-1", chargeAmount: 20, chargeLabel: "Cover" };

test("buildRequestDoc: sanitizePublicText runs on name — control chars become spaces, whitespace collapses", () => {
  const input: CreatePublicOrderRequestInput = { ...TABLE_INPUT, name: `Ravi${BELL}Kumar` };
  const doc = buildRequestDoc(input, [LINE], null, null, true);
  assert.equal(doc.name, "Ravi Kumar");
});

test("buildRequestDoc: sanitizePublicText runs on note, and note is omitted (not empty string) when absent", () => {
  const withNote = buildRequestDoc({ ...TABLE_INPUT, note: `No${BELL}onion` }, [LINE], null, null, true);
  assert.equal(withNote.note, "No onion");

  const withoutNote = buildRequestDoc(TABLE_INPUT, [LINE], null, null, true);
  assert.equal("note" in withoutNote, false);
});

test("buildRequestDoc: sanitizePublicText runs on every line's instructions", () => {
  const line: PricedLine = { ...LINE, instructions: `Extra${BELL}spicy` };
  const doc = buildRequestDoc(TABLE_INPUT, [line], null, null, true);
  assert.equal(doc.items[0].instructions, "Extra spicy");
});

test("buildRequestDoc: a line's instructions defaults to '' (never undefined) when the priced line carries none", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], null, null, true);
  assert.equal(doc.items[0].instructions, "");
});

test("buildRequestDoc: modifiers are copied through UNTOUCHED — a raw control char is never sanitized away", () => {
  const line: PricedLine = { ...LINE, modifiers: [`Extra${BELL}cheese`] };
  const doc = buildRequestDoc(TABLE_INPUT, [line], null, null, true);
  assert.deepEqual(doc.items[0].modifiers, [`Extra${BELL}cheese`]);
});

test("buildRequestDoc: quote math with a table charge — subtotal, charge and total all reflect it, quotedChargeLabel set, tableNo set from the resolved table", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], TABLE, null, true);
  assert.equal(doc.quotedSubtotal, 80); // 40 * 2
  assert.equal(doc.quotedCharge, 20);
  assert.equal(doc.quotedTotal, 100); // no GST configured (settings null → disabled)
  assert.equal(doc.quotedChargeLabel, "Cover");
  assert.equal(doc.tableNo, "T-1");
  assert.equal(doc.targetKind, "table");
});

test("buildRequestDoc: a parcel (table === null) always quotes zero charge, and omits tableNo/quotedChargeLabel", () => {
  const doc = buildRequestDoc(PARCEL_INPUT, [LINE], null, null, true);
  assert.equal(doc.quotedCharge, 0);
  assert.equal(doc.quotedTotal, 80);
  assert.equal("tableNo" in doc, false);
  assert.equal("quotedChargeLabel" in doc, false);
  assert.equal(doc.targetKind, "parcel");
});

test("buildRequestDoc: uses the settings-derived GST config exactly like POST /api/orders — exclusive-mode GST is added on top", () => {
  const settings = { gstEnabled: true, gstRate: 10, gstMode: "exclusive" } as ISettings;
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], null, settings, true);
  // subtotal 80, 10% exclusive GST = 8, no charge -> total 88
  assert.equal(doc.quotedSubtotal, 80);
  assert.equal(doc.quotedTotal, 88);
});

// ── Owner field-feedback 2026-08-20 — table charge is per-TABLE-SESSION ─────

test("tableChargeApplies: no open tab, no pending request -> true (first order of the session)", () => {
  assert.equal(tableChargeApplies(false, false), true);
});

test("tableChargeApplies: an open tab already exists -> false", () => {
  assert.equal(tableChargeApplies(true, false), false);
});

test("tableChargeApplies: a pending/accepting request is already in flight -> false", () => {
  assert.equal(tableChargeApplies(false, true), false);
});

test("tableChargeApplies: both -> false", () => {
  assert.equal(tableChargeApplies(true, true), false);
});

test("buildRequestDoc: chargeApplies=false forces the quote to NO_TABLE_CHARGE even though the table itself carries a configured charge", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], TABLE, null, false);
  assert.equal(doc.quotedCharge, 0);
  assert.equal(doc.quotedTotal, 80); // 40 * 2, no charge added
  assert.equal("quotedChargeLabel" in doc, false);
  // tableNo is still set from the resolved table — only the CHARGE is gated,
  // never which table the request targets.
  assert.equal(doc.tableNo, "T-1");
});

// ── CR2.2b §17.C — the edit-time charge-CARRIER rule ────────────────────────

test("tableChargeAppliesOnEdit: no open tab, no OTHER charge-carrier sibling -> true (this request stays/becomes the carrier)", () => {
  assert.equal(tableChargeAppliesOnEdit(false, false), true);
});

test("tableChargeAppliesOnEdit: an open tab already exists -> false (the charge is already on a real bill)", () => {
  assert.equal(tableChargeAppliesOnEdit(true, false), false);
});

test("tableChargeAppliesOnEdit: another sibling is ALREADY the charge carrier -> false (never double the charge)", () => {
  assert.equal(tableChargeAppliesOnEdit(false, true), false);
});

test("tableChargeAppliesOnEdit: both -> false", () => {
  assert.equal(tableChargeAppliesOnEdit(true, true), false);
});

// ── quoteRequestTotals / buildRequestDoc parity ─────────────────────────────
// buildRequestDoc MUST delegate to quoteRequestTotals — the create path's
// output must be byte-identical to what it was before the extraction, and the
// edit (PATCH) path must price identically for the same inputs.

test("quoteRequestTotals: parity with buildRequestDoc's quote fields — WITH a table charge", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], TABLE, null, true);
  const quote = quoteRequestTotals([LINE], TABLE, null, true);
  assert.equal(quote.quotedSubtotal, doc.quotedSubtotal);
  assert.equal(quote.quotedCharge, doc.quotedCharge);
  assert.equal(quote.quotedTotal, doc.quotedTotal);
  assert.equal(quote.quotedChargeLabel, doc.quotedChargeLabel);
  assert.deepEqual(quote.items, doc.items);
});

test("quoteRequestTotals: parity with buildRequestDoc's quote fields — WITHOUT a charge (parcel)", () => {
  const doc = buildRequestDoc(PARCEL_INPUT, [LINE], null, null, true);
  const quote = quoteRequestTotals([LINE], null, null, true);
  assert.equal(quote.quotedSubtotal, doc.quotedSubtotal);
  assert.equal(quote.quotedCharge, doc.quotedCharge);
  assert.equal(quote.quotedTotal, doc.quotedTotal);
  assert.equal("quotedChargeLabel" in quote, false);
  assert.equal("quotedChargeLabel" in doc, false);
  assert.deepEqual(quote.items, doc.items);
});

// ── CR2.2c — promo discount rides the SAME computeOrderTotals call ─────────

test("quoteRequestTotals: quotedDiscount equals exactly what computeOrderTotals produces for the same discount — never a forked/re-derived figure", () => {
  const quote = quoteRequestTotals([LINE], TABLE, null, true, 25);
  const direct = computeOrderTotals({ items: [LINE], discount: 25, charge: 20, cfg: { gstEnabled: false, gstRate: 0, gstMode: "inclusive" } });
  assert.equal(quote.quotedDiscount, direct.discount);
  assert.equal(quote.quotedTotal, direct.total);
});

test("quoteRequestTotals: discount defaults to 0 when omitted — every pre-CR2.2c call site keeps its exact prior behavior", () => {
  const quote = quoteRequestTotals([LINE], null, null, true);
  assert.equal(quote.quotedDiscount, 0);
});

test("buildRequestDoc: omit-empty — quotedDiscount is ABSENT when discount is 0 (the default, unchanged from every pre-CR2.2c caller)", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], null, null, true);
  assert.equal("quotedDiscount" in doc, false);
  assert.equal("promoCode" in doc, false);
});

test("buildRequestDoc: a positive discount is stored as quotedDiscount, and the resolved promoCode rides along", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], null, null, true, 8, "SAVE10");
  assert.equal(doc.quotedDiscount, 8);
  assert.equal(doc.promoCode, "SAVE10");
  assert.equal(doc.quotedTotal, 72); // 40*2 - 8
});

test("buildRequestDoc: a resolved-but-ZERO discount still stores promoCode (the code applied) but omits quotedDiscount (nothing was actually given away)", () => {
  const doc = buildRequestDoc(TABLE_INPUT, [LINE], null, null, true, 0, "SAVE10");
  assert.equal("quotedDiscount" in doc, false);
  assert.equal(doc.promoCode, "SAVE10");
});

test("resolvedCutoff/pendingCutoff: cutoff arithmetic is exactly now minus the named TTL", () => {
  const now = 1_700_000_000_000;
  assert.equal(resolvedCutoff(now).getTime(), now - PUBLIC_REQUEST_RESOLVED_TTL_MS);
  assert.equal(pendingCutoff(now).getTime(), now - PUBLIC_REQUEST_PENDING_TTL_MS);
  // The resolved TTL (3 days) must be strictly wider than the pending TTL
  // (12h) - a stale pending request is the urgent case, so its cutoff must
  // always fall LATER (closer to `now`) than the resolved one for the same `now`.
  assert.ok(pendingCutoff(now).getTime() > resolvedCutoff(now).getTime());
});

// ── FIX8 — the "accepting" row gets its own, wider cutoff ───────────────────

test("acceptingCutoff: cutoff arithmetic is exactly now minus PUBLIC_REQUEST_ACCEPTING_TTL_MS (48h)", () => {
  const now = 1_700_000_000_000;
  assert.equal(acceptingCutoff(now).getTime(), now - PUBLIC_REQUEST_ACCEPTING_TTL_MS);
  assert.equal(PUBLIC_REQUEST_ACCEPTING_TTL_MS, 48 * 60 * 60 * 1000);
});

test("acceptingCutoff: strictly wider (further in the past) than pendingCutoff for the same now — an in-flight/crashed accept must outlive the 12h pending sweep", () => {
  const now = 1_700_000_000_000;
  assert.ok(acceptingCutoff(now).getTime() < pendingCutoff(now).getTime());
});

// ── FIX8 — SOURCE PINS on pruneOrderRequests (async/DB, so not directly
// callable here — same limitation order-integrity.test.ts's route pins work
// around) ────────────────────────────────────────────────────────────────
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const intakeSrc = readFileSync(path.join(REPO_ROOT, "apps/cafe/lib/order-request-intake.ts"), "utf8");

test("PIN: pruneOrderRequests filters EVERY deleteMany on createdAt, never updatedAt — createdAt rides the {status:1, createdAt:-1} index", () => {
  const pruneStart = intakeSrc.indexOf("export async function pruneOrderRequests");
  assert.ok(pruneStart >= 0, "pruneOrderRequests must exist");
  const pruneBody = intakeSrc.slice(pruneStart);
  const createdAtHits = (pruneBody.match(/createdAt:\s*\{\s*\$lt:/g) ?? []).length;
  assert.equal(createdAtHits, 3, "all three sweeps (resolved, pending, accepting) must filter on createdAt");
  assert.ok(!/updatedAt:\s*\{\s*\$lt:/.test(pruneBody), "no sweep may filter on updatedAt (no index backs it)");
});

test("PIN: the 12h sweep matches status \"pending\" ONLY — \"accepting\" is excluded and swept separately", () => {
  const pruneStart = intakeSrc.indexOf("export async function pruneOrderRequests");
  const pruneBody = intakeSrc.slice(pruneStart);
  assert.match(
    pruneBody,
    /status:\s*"pending",\s*\n\s*createdAt:\s*\{\s*\$lt:\s*pendingCutoff\(now\)\s*\}/,
    'the pending sweep must filter status:"pending" (a bare string, not $in) against pendingCutoff',
  );
  assert.match(
    pruneBody,
    /status:\s*"accepting",\s*\n\s*createdAt:\s*\{\s*\$lt:\s*acceptingCutoff\(now\)\s*\}/,
    'the accepting sweep must filter status:"accepting" against its OWN acceptingCutoff, not pendingCutoff',
  );
});
