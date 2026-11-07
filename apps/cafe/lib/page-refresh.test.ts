import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  REFRESH_OFFLINE_MESSAGE,
  REFRESH_PRINTING_MESSAGE,
  cartLines,
  clearDeliberateReload,
  holdCart,
  holdUnsentWork,
  isDeliberateReload,
  markDeliberateReload,
  refreshQuestion,
  reloadStep,
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

// P2 N4: the POS cart also says how many lines it holds, so a new build waits for an empty cart; its unsent lines stay
// Refresh's "changes" exactly as before.
test("the cart: holdCart holds its unsent lines like holdUnsentWork, and its line count; null clears both", () => {
  const cart = Symbol("cart");
  const other = Symbol("other cart");
  const send = Symbol("send");
  assert.equal(cartLines(), 0, "no cart, no lines");
  holdCart(cart, { unsent: true, lines: 3 });
  assert.equal(unsentWork(), "changes", "unsent lines are changes, as holdUnsentWork(token, \"changes\") sets them");
  assert.equal(cartLines(), 3, "and the cart holds three lines");
  holdUnsentWork(send, "unconfirmed");
  assert.equal(unsentWork(), "unconfirmed", "an unconfirmed send still outweighs the cart");
  holdUnsentWork(send, null);
  holdCart(cart, { unsent: false, lines: 2 });
  assert.equal(unsentWork(), null, "fired lines only: nothing a reload loses, Refresh does not ask");
  assert.equal(cartLines(), 2, "but the cart is not empty");
  holdCart(other, { unsent: false, lines: 1 });
  assert.equal(cartLines(), 3, "the lines sum over holders");
  holdCart(cart, null);
  assert.equal(cartLines(), 1, "a cart that unmounted holds no lines");
  assert.equal(unsentWork(), null, "nor any unsent work");
  holdCart(other, { unsent: true, lines: 1 });
  holdCart(other, null);
  assert.equal(cartLines(), 0, "all released");
  assert.equal(unsentWork(), null, "its unsent entry cleared too");
  holdCart(other, null);
  assert.equal(cartLines(), 0, "releasing twice is harmless");
});

test("the question says what a refresh would lose, in plain words", () => {
  assert.match(refreshQuestion("changes"), /not sent yet/, "the cart's lines");
  assert.match(refreshQuestion("changes"), /already sent are safe/, "and what is safe");
  assert.match(refreshQuestion("unconfirmed"), /could not be confirmed/, "an order not confirmed yet");
  assert.match(refreshQuestion("unconfirmed"), /Open tabs before sending it again/, "how not to send it twice");
  assert.match(REFRESH_OFFLINE_MESSAGE, /offline/i, "offline: no reload into an error screen");
  assert.equal(REFRESH_PRINTING_MESSAGE, "A slip is printing. Refresh once it is done.", "printing: no reload under a slip on its way to paper");
});

test("a deliberate refresh is marked, so the page's own leave warning stays quiet; it can be cleared", () => {
  clearDeliberateReload();
  assert.equal(isDeliberateReload(), false);
  markDeliberateReload();
  assert.equal(isDeliberateReload(), true);
  clearDeliberateReload();
  assert.equal(isDeliberateReload(), false);
});

// U0 Task 3 (design 5.3): the header's global buttons run Tables, New order, Refresh, Tokens (when on), the printer.
// U1 Task 1: the printer button now hands its tone to the /pos clock (onToneChange), so the needle is its tag's start.
test("PIN: the header shows Refresh among its global buttons, before the printer icon", () => {
  const header = src("apps/cafe/components/layout/Header.tsx");
  const refreshAt = header.indexOf("<RefreshButton />");
  const printerAt = header.indexOf("<PrinterStatusButton");
  assert.ok(refreshAt >= 0 && printerAt >= 0, "both buttons are in the header");
  assert.ok(refreshAt < printerAt, "Refresh sits before the printer icon (only Tokens may come between)");
  assert.ok(header.indexOf("<HeaderQuickTabs />") < refreshAt, "after Tables and New order");
});

// P2 N4 (the review's R54): Refresh and the header's "Update ready · Reload" chip share one ask-first rule.
test("reloadStep: offline says so (even with work), work a reload loses asks first, nothing to lose reloads", () => {
  assert.deepEqual(reloadStep(false, null), { kind: "offline" }, "offline: no reload into an error screen");
  assert.deepEqual(reloadStep(false, "changes"), { kind: "offline" }, "offline wins over unsent work");
  assert.deepEqual(reloadStep(true, "changes"), { kind: "ask", work: "changes" }, "unsent lines or a dirty form: ask first");
  assert.deepEqual(reloadStep(true, "unconfirmed"), { kind: "ask", work: "unconfirmed" }, "an order being sent: ask first, with its own words");
  assert.deepEqual(reloadStep(true, null), { kind: "reload" }, "nothing to lose: reload");
  // The verifiers' M4: a reload under a slip on its way to paper loses it (the job comes back as a REPRINT).
  assert.deepEqual(reloadStep(true, null, true), { kind: "printing" }, "a slip printing here: says so, no reload");
  assert.deepEqual(reloadStep(true, "changes", true), { kind: "printing" }, "printing before the question: any reload now loses the slip");
  assert.deepEqual(reloadStep(false, null, true), { kind: "offline" }, "offline still first");
  assert.deepEqual(reloadStep(true, null, false), { kind: "reload" }, "not printing: as before");
});

test("PIN: Refresh shows only inside the POS app, asks first, then reloads quietly; a refresh that did not happen lets go", () => {
  const button = src("apps/cafe/components/layout/RefreshButton.tsx");
  assert.match(button, /setShown\(inAppWebView\(\)\)/, "inside the POS app only (a browser has its own refresh)");
  assert.match(button, /if \(!shown\) return null;/, "nothing elsewhere");
  // P2 N4 (deliberate move, R54): the ask-first rule moved into hooks/use-ask-first-reload.ts, shared with the chip.
  assert.match(button, /const \{ reloading, press, dialog \} = useAskFirstReload\(\);/, "Refresh uses the shared rule, with nothing extra before its reload");
  assert.match(button, /disabled=\{reloading\}\s*onClick=\{press\}/, "the tap runs the rule; the button rests while reloading");
  assert.match(button, /<ConfirmDialog \{\.\.\.dialog\} \/>/, "the rule's own question");
  assert.ok(!button.includes("location.reload"), "the button reloads only through the rule");
  assert.match(button, /aria-label="Refresh"/, "named for a screen reader");
  const hook = src("apps/cafe/hooks/use-ask-first-reload.ts");
  // P2 N4 (deliberate move, R59): offline is the page's own offline state or the browser's flag, the reading a tap uses
  // (lib/navigate.ts) — the internet down behind a working Wi-Fi is offline too, so the chip / Refresh never reload into
  // the browser's error page.
  assert.match(
    hook,
    /const offline = serverReach\.isOffline\(\) \|\| navigator\.onLine === false;\s*const step = reloadStep\(!offline, unsentWork\(\), printHostBusy\(\)\);/,
    "the decision is lib/page-refresh.ts's, offline read from serverReach and navigator.onLine, printing from this device's print holds",
  );
  assert.match(hook, /import \{ closePrintHost, printHostBusy \} from "@\/lib\/print-host-busy";/, "the print holds and the closing gate");
  assert.match(hook, /if \(step\.kind === "printing"\) \{\s*toast\(REFRESH_PRINTING_MESSAGE\);\s*return;\s*\}/, "printing: says so, no reload (the verifiers' M4)");
  assert.match(hook, /if \(step\.kind === "offline"\) \{\s*toast\.error\(REFRESH_OFFLINE_MESSAGE\);\s*return;\s*\}/, "offline: says so, no reload");
  assert.match(hook, /if \(step\.kind === "ask"\) \{\s*setAsking\(step\.work\);\s*return;\s*\}\s*reload\(\);/, "unsent work: ask first; nothing to lose: reload");
  const reload = hook.slice(hook.indexOf("const reload = "), hook.indexOf("const press = "));
  assert.ok(
    reload.indexOf("markDeliberateReload();") >= 0 && reload.indexOf("markDeliberateReload();") < reload.indexOf("window.location.reload();"),
    "the page's own leave warning is told before the reload (no second, native question)",
  );
  assert.match(reload, /window\.setTimeout\(\(\) => \{\s*clearDeliberateReload\(\);\s*setReloading\(false\);\s*\}, REFRESH_SETTLE_MS\)/, "a reload that never happened lets the button go");
  assert.match(hook, /onOpenChange: \(open: boolean\) => \{\s*if \(!open\) setAsking\(null\);\s*\},/, "Stay (or Escape) closes the question");
  assert.match(hook, /title: REFRESH_CONFIRM_TITLE,/, "the question's title");
  assert.match(hook, /description: asking === null \? undefined : refreshQuestion\(asking\),/, "what a refresh would lose");
  assert.match(hook, /confirmLabel: "Refresh",\s*cancelLabel: "Stay",\s*onConfirm: reload,/, "Refresh / Stay; confirming reloads");
});

test("PIN: one source of truth: the leave warning holds its work for Refresh and stays quiet on a deliberate refresh; the cart and the send hold theirs", () => {
  const guard = src("apps/cafe/hooks/use-unsaved-guard.ts");
  assert.match(guard, /holdUnsentWork\(token, dirty \? "changes" : null\)/, "the guard's dirty state is Refresh's too (a resumed tab, a settings form)");
  assert.match(guard, /if \(isDeliberateReload\(\)\) return;/, "a refresh staff already confirmed is not asked again");
  const cart = src("apps/cafe/hooks/use-cart.ts");
  // P2 N4 (deliberate move): the cart reports through holdCart, which sets the same unsent entry and its line count.
  assert.match(cart, /holdCart\(token, \{ unsent: cart\.some\(\(line\) => line\.kotRound === 0\), lines: cart\.length \}\)/, "the cart reports lines not fired yet (and how many lines it holds)");
  assert.match(cart, /return \(\) => holdCart\(token, null\);/, "and releases them when it unmounts");
  const tab = src("apps/cafe/hooks/use-pos-tab.ts");
  assert.match(tab, /holdUnsentWork\(sendToken, send\.sending !== null \|\| send\.frozen !== null \? "unconfirmed" : null\)/, "a send in flight or not confirmed (the review's I2)");
  assert.match(tab, /return \(\) => holdUnsentWork\(sendToken, null\);/, "released on unmount");
});
