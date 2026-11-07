// Source pins for P2 N4's quiet reload (components/layout/UpdateWhenQuiet.tsx): a new build loads by itself only after
// a "reload" verdict (lib/quiet-reload.ts, unit-tested), and staff's tap on the header's "Update ready · Reload" chip
// is the only other reload; both remember the build they go to first (the loop guard, and the 2 s "Updated" note
// after). The check is a local 5 s timer armed only while an update waits, and it makes no request. The facts it
// reads come from their one sources: the cart and unsent work (lib/page-refresh.ts), the outbox, the query client's
// writes, the lock, and this device's print holds (lib/print-host-busy.ts), wired into printing with no new line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const code = (rel: string): string => stripComments(raw(rel));
const lines = (rel: string): number => raw(rel).split("\n").length - (raw(rel).endsWith("\n") ? 1 : 0);
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const COMPONENT = "components/layout/UpdateWhenQuiet.tsx";
const VERDICT = "lib/quiet-reload.ts";
const LAYOUT = "app/(dashboard)/layout.tsx";
const HEADER = "components/layout/Header.tsx";
const CART = "hooks/use-cart.ts";
const AGENT = "hooks/use-print-agent.ts";
const SEAMS = "lib/print-agent-seams.ts";
const HOST = "components/layout/PrintHostProvider.tsx";

test("PIN: the page reloads only after a \"reload\" verdict and on the chip's tap, each after writing the build it goes to", () => {
  const src = code(COMPONENT);
  assert.equal(count(src, "location.reload"), 2, "two reloads in the file: the quiet one and the chip's");
  assert.match(
    src,
    /if \(verdict === "reload"\) \{\s*if \(rememberReloadTarget\(\)\) \{\s*window\.location\.reload\(\);/,
    "the quiet reload runs only on a \"reload\" verdict, and only once the guard was written",
  );
  assert.match(
    src,
    /function reloadNow\(\): void \{\s*rememberReloadTarget\(\);\s*window\.location\.reload\(\);\s*\}/,
    "the chip's tap writes the guard, then reloads",
  );
  assert.match(src, /<button\s+type="button"[^>]*onClick=\{reloadNow\}/, "the chip's handler is that tap");
  assert.match(
    src,
    /const target = updatePending\.serverBuild\(\);\s*if \(target === null\) return false;\s*window\.sessionStorage\.setItem\(UPDATE_RELOAD_KEY, target\);/,
    "the guard holds the server build the reload goes to",
  );
  assert.match(src, /guard\.current\.broken = true;\s*showChip\(true\);/, "a guard that could not be written: no reload, the chip instead");
});

test("PIN: on mount the guard is read: the reloaded build says \"Updated\" for 2 s; a reload that missed its build never repeats", () => {
  const src = code(COMPONENT);
  assert.match(
    src,
    /const stored = window\.sessionStorage\.getItem\(UPDATE_RELOAD_KEY\);\s*if \(stored === POS_BUILD\) \{\s*window\.sessionStorage\.removeItem\(UPDATE_RELOAD_KEY\);\s*toast\("Updated", \{ duration: UPDATED_NOTE_MS \}\);\s*\} else guard\.current\.stored = stored;\s*\} catch \{\s*guard\.current\.broken = true;/,
    "the note and the key's removal on the new build; the key kept otherwise; no storage, no self-reload",
  );
  assert.match(
    src,
    /autoReloadSpent: broken \|\| \(stored !== null && stored === updatePending\.serverBuild\(\)\),/,
    "the reload toward this very build already happened: the chip, never a second self-reload",
  );
});

test("PIN: the check is a 5 s local timer armed only while an update waits, cleared when it stops waiting", () => {
  const src = code(COMPONENT);
  assert.match(
    src,
    /const pending = useSyncExternalStore\(updatePending\.subscribe, updatePending\.isPending, \(\) => false\);/,
    "it follows the update store",
  );
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*if \(!pending\) \{\s*showChip\(false\);\s*return;\s*\}[\s\S]*?const timer = window\.setInterval\(check, UPDATE_CHECK_MS\);\s*return \(\) => \{\s*window\.clearInterval\(timer\);\s*showChip\(false\);\s*\};\s*\}, \[pending, queryClient\]\);/,
    "no timer while nothing waits; the 5 s timer otherwise, cleared on change",
  );
  assert.equal(count(src, "setInterval("), 1, "one timer");
  assert.equal(count(src, "setTimeout("), 0, "no other timer");
});

test("PIN: the check reads each fact from its one source", () => {
  const src = code(COMPONENT);
  const facts: ReadonlyArray<readonly [RegExp, string]> = [
    [/pending: updatePending\.isPending\(\),/, "pending from the update store"],
    [/locked: document\.documentElement\.hasAttribute\(LOCK_ATTR\),/, "the lock's attribute on <html>"],
    [/msSinceInput: Date\.now\(\) - lastInputAt\.current,/, "the time since the last input"],
    [/dialogOpen: dialogOpenIn\(document\),/, "an open dialog (not the lock)"],
    [/textFocused: textFieldFocused\(document\),/, "a focused text field"],
    [/cartItems: cartLines\(\),/, "the POS cart's lines"],
    [/unsentWork: unsentWork\(\) !== null,/, "unsent work (Refresh's own question)"],
    [/outbox: offlineOutbox\.getSnapshot\(\)\.record\?\.entries\.length \?\? 0,/, "orders waiting in the offline outbox"],
    [/mutating: queryClient\.isMutating\(\),/, "writes in flight"],
    [/printBusy: printHostBusy\(\),/, "this device's print holds"],
    [/soundNeedsGesture: soundNeedsGesture\(\),/, "the sound rule"],
  ];
  for (const [pattern, why] of facts) assert.match(src, pattern, why);
  assert.match(
    src,
    /return nativeBridge\(\) === null && desktopShell\(\) === null && \(readDevicePrefs\(\)\.alertSound \|\| isDisplayPath\(window\.location\.pathname\)\);/,
    "a plain browser with alerts on, or a display page's voice, needs a tap for sound",
  );
  assert.match(src, /const INPUT_EVENTS = \["pointerdown", "keydown", "wheel", "touchstart"\] as const;/, "the inputs that count");
  assert.match(src, /const INPUT_OPTIONS: AddEventListenerOptions = \{ capture: true, passive: true \};/, "seen first, never blocking");
  assert.match(src, /lastInputAt\.current = Date\.now\(\);\s*try \{/, "a freshly loaded page waits the full quiet time");
  assert.match(src, /window\.addEventListener\(type, onInput, INPUT_OPTIONS\)/, "listened on the window");
  assert.match(src, /window\.removeEventListener\(type, onInput, INPUT_OPTIONS\)/, "and let go on unmount");
});

test("PIN: neither the check nor the verdict makes a request", () => {
  for (const rel of [COMPONENT, VERDICT]) {
    const src = code(rel);
    // Whole names: the component reads the query client (useQueryClient) for isMutating(), never a query of its own.
    for (const banned of [/\bfetch\(/, /\bapiGet\b/, /\bapiSend\b/, /\buseQuery\b/, /\buseMutation\b/, /prefetch/i, /api-client/, /XMLHttpRequest/, /sendBeacon/]) {
      assert.ok(!banned.test(src), `${rel}: no ${banned}`);
    }
  }
  const verdict = code(VERDICT);
  for (const global of ["window.", "document.", "sessionStorage", "localStorage"]) {
    assert.ok(!verdict.includes(global), `${VERDICT} is pure: no "${global}"`);
  }
});

test("PIN: the chip is a real button, named by its exact words, from the header beside Refresh", () => {
  const src = code(COMPONENT);
  assert.match(
    src,
    /<button\s+type="button"\s+data-ui="update-ready-chip"\s+aria-label=\{UPDATE_READY_LABEL\}\s+title=\{UPDATE_READY_LABEL\}/,
    "a button whose accessible name is the chip's words",
  );
  assert.match(src, /<span className="hidden desk:inline">\{UPDATE_READY_LABEL\}<\/span>/, "the words from 1100 px, the icon alone below");
  assert.match(src, /const shown = useSyncExternalStore\(subscribeChip, chipSnapshot, noChip\);\s*if \(!shown\) return null;/, "shown only while the check says chip");
  assert.match(src, /showChip\(verdict === "chip"\);/, "the check sets it from the verdict");
  assert.match(src, /\bh-9\b/, "36 px like the header's buttons");
  assert.match(src, /before:absolute before:-inset-1 before:content-\[''\]/, "a 44 px touch area");
  assert.ok(!src.includes(":has("), "WebView 109: no :has()");
  const header = code(HEADER);
  assert.match(header, /import \{ UpdateReadyChip \} from "@\/components\/layout\/UpdateWhenQuiet";/, "the header imports the chip");
  assert.equal(count(header, "<UpdateReadyChip />"), 1, "rendered once");
  assert.match(header, /<UpdateReadyChip \/>\s*<RefreshButton \/>/, "right before Refresh");
});

test("PIN: the dashboard layout mounts UpdateWhenQuiet once, inside the session gate (with the query client)", () => {
  const src = code(LAYOUT);
  assert.match(src, /import \{ UpdateWhenQuiet \} from "@\/components\/layout\/UpdateWhenQuiet";/, "imported");
  assert.equal(count(src, "<UpdateWhenQuiet />"), 1, "mounted once");
  const at = src.indexOf("<UpdateWhenQuiet />");
  assert.ok(src.indexOf("<DeviceSessionGate>") < at && at < src.indexOf("</DeviceSessionGate>"), "inside the session gate");
});

test("PIN: the cart reports its lines through holdCart, in place (use-cart.ts stays at its 300-line cap)", () => {
  const src = code(CART);
  assert.match(src, /import \{ holdCart \} from "@\/lib\/page-refresh";/, "the one import, renamed in place");
  assert.match(src, /holdCart\(token, \{ unsent: cart\.some\(\(line\) => line\.kotRound === 0\), lines: cart\.length \}\);/, "unsent lines and the line count");
  assert.match(src, /return \(\) => holdCart\(token, null\);/, "released on unmount");
  assert.ok(!src.includes("holdUnsentWork"), "no second report of the same lines");
  assert.ok(lines(CART) <= 300, `use-cart.ts must stay <= 300 lines, got ${lines(CART)}`);
});

test("PIN: the print agent's lease and print are tracked in place; print-agent.ts untouched; the host bridge holds while busy", () => {
  const agent = code(AGENT);
  assert.match(
    agent,
    /lease: \(printerIds\) => trackPrintBusy\(apiSend<PrintLeaseData>\(LEASE_URL, "POST", \{ deviceId, tabId, tokenSlips: true, \.\.\.printerIdsBody\(printerIds\) \}\)\),/,
    "the lease, tracked while in flight",
  );
  assert.match(agent, /print: \(job\) => trackPrintBusy\(print\(job\)\),/, "the print, tracked until it settles");
  assert.match(agent, /markPrinterWriting, trackPrintBusy,\s*setPrinterHealthSource,[\s\S]*?\} from "@\/lib\/print-agent";/, "the name on an existing import line");
  assert.ok(lines(AGENT) <= 340, `use-print-agent.ts must not grow past 340 lines, got ${lines(AGENT)}`);
  assert.ok(lines("lib/print-agent.ts") <= 301, `lib/print-agent.ts must not grow past 301 lines, got ${lines("lib/print-agent.ts")}`);
  assert.match(code(SEAMS), /export \{ trackPrintBusy \} from "@\/lib\/print-host-busy";/, "re-exported through the agent's seams");
  const host = code(HOST);
  assert.match(host, /import \{ holdPrintBusy \} from "@\/lib\/print-host-busy";/, "the provider imports the holder");
  assert.match(host, /const \{ current, busy, kotRef, receiptRef, eodRef, setEodReady, queueSlip, queueTestSlip \} = bridge;/, "busy is the bridge's own");
  assert.match(
    host,
    /useLayoutEffect\(\(\) => \{\s*holdPrintBusy\(busyToken, busy\);\s*return \(\) => holdPrintBusy\(busyToken, false\);\s*\}, \[busyToken, busy\]\);/,
    "held while the bridge is busy, let go on change and on unmount",
  );
});
