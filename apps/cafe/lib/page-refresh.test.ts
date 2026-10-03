import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { REFRESH_CONFIRM_BODY, hasUnsentWork, holdUnsentWork } from "@/lib/page-refresh";

// The owner (2026-10-03): the POS app has no browser bar, so its top bar carries a Refresh button beside the
// printer icon. It reloads the page like a browser does, and asks first when the POS cart holds lines not sent yet.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

test("unsent work: each holder says whether it holds some; the page has unsent work while any does", () => {
  const cart = Symbol("cart");
  const other = Symbol("other");
  assert.equal(hasUnsentWork(), false, "nothing held at first");
  holdUnsentWork(cart, true);
  assert.equal(hasUnsentWork(), true, "a cart with unsent lines");
  holdUnsentWork(other, true);
  holdUnsentWork(cart, false);
  assert.equal(hasUnsentWork(), true, "another holder still holds some");
  holdUnsentWork(other, false);
  assert.equal(hasUnsentWork(), false, "all released");
  holdUnsentWork(other, false);
  assert.equal(hasUnsentWork(), false, "releasing twice is harmless");
  assert.match(REFRESH_CONFIRM_BODY, /not sent/, "the question says what would be lost");
  assert.match(REFRESH_CONFIRM_BODY, /already sent are safe/, "and what is safe");
});

test("PIN: the top bar shows Refresh right beside the printer icon", () => {
  const header = src("apps/cafe/components/layout/Header.tsx");
  const refreshAt = header.indexOf("<RefreshButton />");
  const printerAt = header.indexOf("<PrinterStatusButton />");
  assert.ok(refreshAt >= 0 && printerAt >= 0, "both buttons are in the top bar");
  assert.ok(refreshAt < printerAt, "Refresh sits just before the printer icon");
});

test("PIN: Refresh shows only inside the POS app, reloads the page, and asks first when cart lines are unsent", () => {
  const button = src("apps/cafe/components/layout/RefreshButton.tsx");
  assert.match(button, /setShown\(inAppWebView\(\)\)/, "inside the POS app only (a browser has its own refresh)");
  assert.match(button, /if \(!shown\) return null;/, "nothing elsewhere");
  assert.match(button, /window\.location\.reload\(\)/, "a full reload, like a browser's");
  assert.match(button, /if \(hasUnsentWork\(\)\) \{\s*setAsking\(true\);\s*return;\s*\}/, "unsent cart lines: ask first");
  assert.match(button, /aria-label="Refresh"/, "named for a screen reader");
  const cart = src("apps/cafe/hooks/use-cart.ts");
  assert.match(cart, /holdUnsentWork\(token, cart\.some\(\(line\) => line\.kotRound === 0\)\)/, "the cart reports lines not fired yet");
  assert.match(cart, /return \(\) => holdUnsentWork\(token, false\);/, "and releases them when it unmounts");
});
