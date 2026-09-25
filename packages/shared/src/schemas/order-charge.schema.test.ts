import { test } from "node:test";
import assert from "node:assert/strict";

import { orderChargeInputSchema, extraChargesSchema } from "./order-charge.schema";
import { TABLE_CHARGE_LABEL_MAX_LEN } from "../constants";

// CB-CHG pin 22 — the client-facing charge input is a MONEY FENCE, so the
// things it REFUSES matter more than the things it accepts. Contract:
// .claude/plan/v2/cb-chg-typed-charges-plan.md §3 (fence) + §0 decision 8
// (no limits on the new extra charge).

test("pin22a: a client-sent `type` NEVER survives the parse — the server alone stamps type:'table'", () => {
  // The fence: the schema has no `type` key at all, so a crafted payload
  // carrying one is STRIPPED rather than honoured. That is what stops the
  // staff-facing extras seam from adding or overwriting the TABLE charge
  // (admin config). Same idiom as orderItemSchema having no `reward` key.
  // Note the assertion is on the parsed OUTPUT, not on rejection: zod strips
  // unknown keys by default, and stripping is the property the fence needs —
  // whether the request also 400s is the surrounding body's `.strict()` job,
  // pinned in order.schema.test.ts, not this schema's.
  const parsed = orderChargeInputSchema.safeParse({
    label: "Packing charge",
    amount: 20,
    type: "table",
  });
  assert.equal(parsed.success, true);
  assert.ok(
    parsed.success && !("type" in parsed.data),
    "the parsed value must carry NO type key — the server stamps it, never the client",
  );
  // And the same through the list seam a real body actually uses.
  const list = extraChargesSchema.safeParse([{ label: "Packing", amount: 20, type: "table" }]);
  assert.ok(
    list.success && !("type" in list.data[0]),
    "the array seam must strip it too — that is the path create/add-round/settle bodies use",
  );
});

test("pin22b: amount must be a whole rupee of at least 1 — no paise, no zero, no negative", () => {
  assert.equal(
    orderChargeInputSchema.safeParse({ label: "Packing", amount: 20.5 }).success,
    false,
    "a fractional amount must be rejected at the edge (rupee integers only)",
  );
  assert.equal(
    orderChargeInputSchema.safeParse({ label: "Packing", amount: 0 }).success,
    false,
    "zero must be rejected — an unnamed/zero charge must never reach the bill",
  );
  assert.equal(
    orderChargeInputSchema.safeParse({ label: "Packing", amount: -5 }).success,
    false,
    "a negative amount must be rejected — a charge may not credit the bill",
  );
  assert.equal(
    orderChargeInputSchema.safeParse({ label: "Packing", amount: 1 }).success,
    true,
    "the floor of 1 is itself valid",
  );
});

test("pin22c: label must be real text — blank and whitespace-only are rejected", () => {
  assert.equal(
    orderChargeInputSchema.safeParse({ label: "", amount: 20 }).success,
    false,
    "an empty label must be rejected (amount gates the label — tableChargeOf's shipped rule)",
  );
  assert.equal(
    orderChargeInputSchema.safeParse({ label: "   ", amount: 20 }).success,
    false,
    "whitespace-only must be rejected too — it trims to nothing and would print as a blank line",
  );
  const long = orderChargeInputSchema.safeParse({
    label: "x".repeat(TABLE_CHARGE_LABEL_MAX_LEN + 1),
    amount: 20,
  });
  assert.equal(long.success, false, "a label longer than the slip can print must be rejected");
});

// ── Decision 8 — NO LIMITS on the new extra charge ──────────────────────────
// Owner, 2026-09-25: "hame hamari panel me aesi koi limitation nahi rakhni
// hai." These two pins exist so a future reader cannot "helpfully" restore a
// cap: they assert the ABSENCE of a ceiling, which is a deliberate decision,
// not an oversight. (The table's own TABLE_CHARGE_MAX is a DIFFERENT, still
// bounded admin config and is intentionally untouched — see table.schema.ts.)

test("pin22d: an extra charge amount has NO upper cap (owner decision 8)", () => {
  const big = orderChargeInputSchema.safeParse({ label: "Event hire", amount: 250_000 });
  assert.equal(big.success, true, "a large extra charge must be accepted — the panel sets no ceiling");
});

test("pin22e: the extra-charge LIST has NO count cap (owner decision 8)", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ label: `Charge ${i + 1}`, amount: 10 }));
  const parsed = extraChargesSchema.safeParse(many);
  assert.equal(parsed.success, true, "any number of extra charges must be accepted");
  assert.equal(parsed.success && parsed.data.length, 40, "and all of them must survive the parse");
});

test("pin22f: an empty list parses — absent means unchanged, empty means clear them all", () => {
  const parsed = extraChargesSchema.safeParse([]);
  assert.equal(parsed.success, true, "an empty array is the legal 'remove every extra' payload");
});
