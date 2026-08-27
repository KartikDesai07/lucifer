import { test } from "node:test";
import assert from "node:assert/strict";

import { variationsErrorMessage } from "./variation-errors";

// Regression tests for "Save did nothing and said nothing": the products form used
// to render only the list-level message, so a blank variation row or two rows with
// the same name failed validation invisibly.

test("returns undefined when there is no error at all", () => {
  assert.equal(variationsErrorMessage(undefined), undefined);
  assert.equal(variationsErrorMessage(null), undefined);
  assert.equal(variationsErrorMessage({}), undefined);
});

test("a list-level message (min/max) is returned as-is", () => {
  assert.equal(
    variationsErrorMessage({ message: "Add at least one variation, or turn variations off" }),
    "Add at least one variation, or turn variations off",
  );
});

test("a blank name on the FIRST row is surfaced and numbered for the operator", () => {
  assert.equal(
    variationsErrorMessage({ "0": { name: { message: "Name the variation" } } }),
    "Variation 1: Name the variation",
  );
});

test("a row problem further down the list is numbered correctly, not reported as row 1", () => {
  assert.equal(
    variationsErrorMessage({ "2": { price: { message: "At most 100000" } } }),
    "Variation 3: At most 100000",
  );
});

// The duplicate-name refine is anchored to path ["0","name"], so it lands as a ROW
// error rather than a list message — the exact case that showed nothing before.
test("the duplicate-name refine (anchored at row 0) is surfaced", () => {
  assert.equal(
    variationsErrorMessage({ "0": { name: { message: "Two variations have the same name" } } }),
    "Variation 1: Two variations have the same name",
  );
});

test("the list-level message wins over a row message — it describes the whole set", () => {
  assert.equal(
    variationsErrorMessage({
      message: "At most 20 variations",
      "0": { name: { message: "Name the variation" } },
    }),
    "At most 20 variations",
  );
});

test("the LOWEST-numbered offending row wins, whatever order the keys arrive in", () => {
  assert.equal(
    variationsErrorMessage({
      "3": { name: { message: "third" } },
      "1": { name: { message: "first" } },
    }),
    "Variation 2: first",
  );
});

test("a row whose name is fine but price is not falls through to the price message", () => {
  assert.equal(
    variationsErrorMessage({ "0": { name: {}, price: { message: "Price cannot be negative" } } }),
    "Variation 1: Price cannot be negative",
  );
});

test("non-string / empty messages are ignored rather than rendered as blank text", () => {
  assert.equal(variationsErrorMessage({ message: "" }), undefined);
  assert.equal(variationsErrorMessage({ message: 42 }), undefined);
  assert.equal(variationsErrorMessage({ "0": { name: { message: "" } } }), undefined);
});
