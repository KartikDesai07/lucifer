import { test } from "node:test";
import assert from "node:assert/strict";

import { isActivePath } from "./nav-active";

test("isActivePath: the Dashboard row lights on / only — not on every page", () => {
  assert.equal(isActivePath("/", "/"), true);
  assert.equal(isActivePath("/orders", "/"), false, "every path starts with '/', so root must be an exact match");
});

test("isActivePath: a row lights on its own page and its sub-pages", () => {
  assert.equal(isActivePath("/orders", "/orders"), true);
  assert.equal(isActivePath("/orders/65f0c2", "/orders"), true);
  assert.equal(isActivePath("/customers/abc/edit", "/customers"), true);
});

test("isActivePath: a sibling that only shares a prefix does not light the row", () => {
  assert.equal(isActivePath("/orders-archive", "/orders"), false);
  assert.equal(isActivePath("/pos", "/po"), false);
  assert.equal(isActivePath("/kitchen", "/orders"), false);
});
