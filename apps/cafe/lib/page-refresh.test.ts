import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  REFRESH_OFFLINE_MESSAGE,
  clearDeliberateReload,
  holdUnsentWork,
  isDeliberateReload,
  markDeliberateReload,
  refreshQuestion,
  unsentWork,
} from "@/lib/page-refresh";

// The owner (2026-10-03): the POS app has no browser bar, so its top bar carries a Refresh button beside the
// printer icon. It reloads the page like a browser does; it asks first when the page holds work that a reload
// would lose, and warns harder while an order is still being sent or could not be confirmed.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

test("unsent work: each holder says what it holds; an unconfirmed send outweighs unsaved changes", () => {
  const cart = Symbol("cart");
  const send = Symbol("send");
  assert.equal(unsentWork(), null, "nothing held at first");
  holdUnsentWork(cart, "changes");
  assert.equal(unsentWork(), "changes", "a cart with unsent lines");
  holdUnsentWork(send, "unconfirmed");
  assert.equal(unsentWork(), "unconfirmed", "a send in flight or not confirmed weighs more");
  holdUnsentWork(send, null);
  assert.equal(unsentWork(), "changes", "back to the cart's changes");
  holdUnsentWork(cart, null);
  assert.equal(unsentWork(), null, "all released");
  holdUnsentWork(cart, null);
  assert.equal(unsentWork(), null, "releasing twice is harmless");
});

test("the question says what a refresh would lose, in plain words", () => {
  assert.match(refreshQuestion("changes"), /not sent yet/, "the cart's lines");
  assert.match(refreshQuestion("changes"), /already sent are safe/, "and what is safe");
  assert.match(refreshQuestion("unconfirmed"), /could not be confirmed/, "an order not confirmed yet");
  assert.match(refreshQuestion("unconfirmed"), /Open tabs before sending it again/, "how not to send it twice");
  assert.match(REFRESH_OFFLINE_MESSAGE, /offline/i, "offline: no reload into an error screen");
});

test("a deliberate refresh is marked, so the page's own leave warning stays quiet; it can be cleared", () => {
  clearDeliberateReload();
  assert.equal(isDeliberateReload(), false);
  markDeliberateReload();
  assert.equal(isDeliberateReload(), true);
  clearDeliberateReload();
  assert.equal(isDeliberateReload(), false);
});

test("PIN: the top bar shows Refresh right beside the printer icon", () => {
  const header = src("apps/cafe/components/layout/Header.tsx");
  const refreshAt = header.indexOf("<RefreshButton />");
  const printerAt = header.indexOf("<PrinterStatusButton />");
  assert.ok(refreshAt >= 0 && printerAt >= 0, "both buttons are in the top bar");
  assert.ok(refreshAt < printerAt, "Refresh sits just before the printer icon");
});

test("PIN: Refresh shows only inside the POS app, asks first, then reloads quietly; a refresh that did not happen lets go", () => {
  const button = src("apps/cafe/components/layout/RefreshButton.tsx");
  assert.match(button, /setShown\(inAppWebView\(\)\)/, "inside the POS app only (a browser has its own refresh)");
  assert.match(button, /if \(!shown\) return null;/, "nothing elsewhere");
  assert.match(button, /if \(navigator\.onLine === false\) \{\s*toast\.error\(REFRESH_OFFLINE_MESSAGE\);\s*return;\s*\}/, "offline: says so, no reload");
  assert.match(button, /const work = unsentWork\(\);\s*if \(work !== null\) \{\s*setAsking\(work\);\s*return;\s*\}/, "unsent work: ask first");
  const reload = button.slice(button.indexOf("const reload = "), button.indexOf("const onPress = "));
  assert.ok(
    reload.indexOf("markDeliberateReload();") >= 0 && reload.indexOf("markDeliberateReload();") < reload.indexOf("window.location.reload();"),
    "the page's own leave warning is told before the reload (no second, native question)",
  );
  assert.match(reload, /window\.setTimeout\(\(\) => \{\s*clearDeliberateReload\(\);\s*setReloading\(false\);\s*\}, REFRESH_SETTLE_MS\)/, "a reload that never happened lets the button go");
  assert.match(button, /aria-label="Refresh"/, "named for a screen reader");
});

test("PIN: one source of truth: the leave warning holds its work for Refresh and stays quiet on a deliberate refresh; the cart and the send hold theirs", () => {
  const guard = src("apps/cafe/hooks/use-unsaved-guard.ts");
  assert.match(guard, /holdUnsentWork\(token, dirty \? "changes" : null\)/, "the guard's dirty state is Refresh's too (a resumed tab, a settings form)");
  assert.match(guard, /if \(isDeliberateReload\(\)\) return;/, "a refresh staff already confirmed is not asked again");
  const cart = src("apps/cafe/hooks/use-cart.ts");
  assert.match(cart, /holdUnsentWork\(token, cart\.some\(\(line\) => line\.kotRound === 0\) \? "changes" : null\)/, "the cart reports lines not fired yet");
  assert.match(cart, /return \(\) => holdUnsentWork\(token, null\);/, "and releases them when it unmounts");
  const tab = src("apps/cafe/hooks/use-pos-tab.ts");
  assert.match(tab, /holdUnsentWork\(sendToken, send\.sending !== null \|\| send\.frozen !== null \? "unconfirmed" : null\)/, "a send in flight or not confirmed (the review's I2)");
  assert.match(tab, /return \(\) => holdUnsentWork\(sendToken, null\);/, "released on unmount");
});
