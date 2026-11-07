// P2 N4: the quiet moment. A page that runs an older build than the server's loads the new one by itself only when
// nobody can lose anything: the screen lock is on, or a minute passed with no input, AND nothing is open, focused,
// in the cart, unsent, waiting in the outbox, in flight or printing, and the device is online. A plain browser with
// alerts on never reloads by itself (its sound would stay locked until a tap): it gets the "Update ready · Reload"
// chip instead, and so does a page whose one self-reload toward this build already happened. Every condition is a row
// of this table.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DIALOG_ROLE_SELECTOR } from "@/lib/nested-dialog";
import {
  QUIET_IDLE_MS,
  UPDATED_NOTE_MS,
  UPDATE_CHECK_MS,
  UPDATE_READY_LABEL,
  UPDATE_RELOAD_KEY,
  dialogOpenIn,
  quietVerdict,
  staleReloadTarget,
  textFieldFocused,
  type QuietDocument,
  type QuietFacts,
} from "@/lib/quiet-reload";

/** Pending, unlocked, idle exactly the quiet time, nothing open / held / unsent / in flight / printing. */
const QUIET: QuietFacts = {
  pending: true,
  locked: false,
  msSinceInput: QUIET_IDLE_MS,
  dialogOpen: false,
  textFocused: false,
  cartItems: 0,
  unsentWork: false,
  outbox: 0,
  mutating: 0,
  printBusy: false,
  soundNeedsGesture: false,
  autoReloadSpent: false,
  offline: false,
};

// Review Focus 3: each of these alone must keep the page as it is.
const BLOCKERS: ReadonlyArray<readonly [string, Partial<QuietFacts>]> = [
  ["a dialog or sheet is open (a payment)", { dialogOpen: true }],
  ["a text field has focus (a typed form)", { textFocused: true }],
  ["the POS cart holds a line", { cartItems: 1 }],
  ["unsent work (unsent lines, an order being sent, a dirty form)", { unsentWork: true }],
  ["an order waits in the offline outbox", { outbox: 1 }],
  ["a write is in flight", { mutating: 1 }],
  ["a print job is leased or printing", { printBusy: true }],
  ["the device is offline (a reload would swap the POS for an error page)", { offline: true }],
];

test("the constants are the spec's, exactly", () => {
  assert.equal(QUIET_IDLE_MS, 60_000, "a minute with no input");
  assert.equal(UPDATED_NOTE_MS, 2000, "the \"Updated\" note shows for 2 s");
  assert.equal(UPDATE_CHECK_MS, 5000, "the local check runs every 5 s while an update waits");
  assert.equal(UPDATE_READY_LABEL, "Update ready · Reload", "the chip's words, exactly");
  assert.equal(UPDATE_RELOAD_KEY, "pos.update.reload", "the loop guard's sessionStorage key");
});

test("all quiet, idle exactly the quiet time: reload", () => {
  assert.equal(quietVerdict(QUIET), "reload", "nothing to lose and nobody there");
});

test("one millisecond short of the quiet time: wait", () => {
  assert.equal(quietVerdict({ ...QUIET, msSinceInput: QUIET_IDLE_MS - 1 }), "wait", "someone touched it under a minute ago");
});

test("the screen lock counts as quiet whatever the last input: reload", () => {
  assert.equal(quietVerdict({ ...QUIET, locked: true, msSinceInput: 0 }), "reload", "a locked screen is a quiet moment");
});

for (const [name, blocker] of BLOCKERS) {
  test(`${name}: alone it keeps "wait", and the lock never overrides it`, () => {
    assert.equal(quietVerdict({ ...QUIET, ...blocker }), "wait", `${name} blocks an idle reload`);
    assert.equal(quietVerdict({ ...QUIET, ...blocker, locked: true, msSinceInput: 0 }), "wait", `${name} blocks a locked reload`);
  });
}

test("no update waiting: wait, whatever else holds (no chip, no reload)", () => {
  assert.equal(quietVerdict({ ...QUIET, pending: false }), "wait", "all quiet but nothing to load");
  assert.equal(quietVerdict({ ...QUIET, pending: false, locked: true }), "wait", "locked but nothing to load");
  assert.equal(quietVerdict({ ...QUIET, pending: false, soundNeedsGesture: true }), "wait", "no chip without an update");
  assert.equal(quietVerdict({ ...QUIET, pending: false, autoReloadSpent: true }), "wait", "no chip without an update");
});

test("Review Focus 4: a plain browser with alerts on never reloads by itself, it shows the chip", () => {
  assert.equal(quietVerdict({ ...QUIET, soundNeedsGesture: true }), "chip", "all quiet: still the chip");
  assert.equal(quietVerdict({ ...QUIET, soundNeedsGesture: true, locked: true, msSinceInput: 0 }), "chip", "locked: still the chip");
  for (const [name, blocker] of BLOCKERS) {
    assert.equal(quietVerdict({ ...QUIET, ...blocker, soundNeedsGesture: true }), "chip", `with ${name}: the chip (staff choose)`);
  }
});

test("the self-reload toward this build already happened (the loop guard): the chip, never a second self-reload", () => {
  assert.equal(quietVerdict({ ...QUIET, autoReloadSpent: true }), "chip", "all quiet: the chip");
  assert.equal(quietVerdict({ ...QUIET, autoReloadSpent: true, locked: true, msSinceInput: 0 }), "chip", "locked: the chip");
  assert.equal(quietVerdict({ ...QUIET, autoReloadSpent: true, cartItems: 2 }), "chip", "with a cart: the chip");
});

// The final review's C1: offline, a reload shows the browser's "no internet" page (or the app's error screen) instead of
// the POS, and no offline KOT can be taken until someone taps Retry. The chip still shows: a tap on it is staff's own
// choice, under Refresh's offline rule.
test("offline: never a self-reload, but the chip still shows where it would", () => {
  assert.equal(quietVerdict({ ...QUIET, offline: true }), "wait", "all quiet but offline: wait");
  assert.equal(quietVerdict({ ...QUIET, offline: true, locked: true, msSinceInput: 0 }), "wait", "locked but offline: wait");
  assert.equal(quietVerdict({ ...QUIET, offline: true, soundNeedsGesture: true }), "chip", "a plain browser with alerts on: the chip (staff choose)");
  assert.equal(quietVerdict({ ...QUIET, offline: true, autoReloadSpent: true }), "chip", "the loop guard: the chip (staff choose)");
  assert.equal(quietVerdict({ ...QUIET, offline: true, pending: false }), "wait", "nothing to load: wait");
});

// The review's minor (fix round 1): a key left by a reload that landed on the old build is forgotten once the server
// reports another valid build, so a later report of that build earns one quiet reload again.
test("staleReloadTarget: the server moved on from the build an earlier reload missed", () => {
  assert.equal(staleReloadTarget(null, "b"), false, "no key: nothing to forget");
  assert.equal(staleReloadTarget("b", null), false, "no report yet (a fresh load): keep the key");
  assert.equal(staleReloadTarget("b", "b"), false, "the server still reports that build: keep it (the chip, never a second self-reload)");
  assert.equal(staleReloadTarget("b", "c"), true, "a newer build: forget it");
  assert.equal(staleReloadTarget("b", "a"), true, "back to another build (a rollback): forget it");
  assert.equal(staleReloadTarget("b", ""), false, "an empty report is not a build");
});

// ── The DOM facts, over minimal fakes ────────────────────────────────────────

interface FakeOpts {
  lock?: boolean;
  insideLock?: boolean;
  hidden?: boolean;
  state?: string;
}

function fakeDialog(opts: FakeOpts = {}) {
  return {
    closest(selector: string): object | null {
      if (selector === "[data-screen-lock]") return opts.lock || opts.insideLock ? {} : null;
      if (selector === "[hidden]") return opts.hidden ? {} : null;
      return null;
    },
    getAttribute(name: string): string | null {
      return name === "data-state" ? (opts.state ?? null) : null;
    },
  };
}

function fakeDoc(dialogs: ReturnType<typeof fakeDialog>[], activeElement: QuietDocument["activeElement"] = null): QuietDocument {
  return {
    activeElement,
    querySelectorAll(selector: string) {
      assert.equal(selector, DIALOG_ROLE_SELECTOR, "it looks for dialogs and alert dialogs (the app's one selector)");
      return dialogs;
    },
  };
}

test("dialogOpenIn: the lock's own cover is not a dialog that blocks; any other dialog is", () => {
  assert.equal(dialogOpenIn(fakeDoc([])), false, "no dialog");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog({ lock: true })])), false, "the lock's cover alone");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog()])), true, "a Radix dialog (a payment, a sheet)");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog({ insideLock: true })])), false, "a dialog inside the lock");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog({ lock: true }), fakeDialog()])), true, "a dialog left open under the lock");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog({ state: "open" })])), true, "an open one says so");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog({ state: "closed" })])), false, "a closed one never counts");
  assert.equal(dialogOpenIn(fakeDoc([fakeDialog({ hidden: true })])), false, "a hidden one never counts");
});

const focused = (tagName: string, type?: string, isContentEditable = false) => ({ tagName, type, isContentEditable });

test("textFieldFocused: an editable text field anywhere, the lock's password included", () => {
  assert.equal(textFieldFocused(fakeDoc([], null)), false, "nothing focused");
  assert.equal(textFieldFocused(fakeDoc([], focused("BODY"))), false, "the page itself");
  assert.equal(textFieldFocused(fakeDoc([], focused("BUTTON", "button"))), false, "a button");
  assert.equal(textFieldFocused(fakeDoc([], focused("INPUT", "text"))), true, "a text input");
  for (const type of ["search", "email", "number", "tel", "url", "date"]) {
    assert.equal(textFieldFocused(fakeDoc([], focused("INPUT", type))), true, `an input of type ${type}`);
  }
  assert.equal(textFieldFocused(fakeDoc([], focused("INPUT", "password"))), true, "the lock's focused password input");
  for (const type of ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]) {
    assert.equal(textFieldFocused(fakeDoc([], focused("INPUT", type))), false, `an input of type ${type} is not typed into`);
  }
  assert.equal(textFieldFocused(fakeDoc([], focused("INPUT", "CHECKBOX"))), false, "the type in any case");
  assert.equal(textFieldFocused(fakeDoc([], focused("TEXTAREA"))), true, "a textarea");
  assert.equal(textFieldFocused(fakeDoc([], focused("SELECT"))), true, "a select");
  assert.equal(textFieldFocused(fakeDoc([], focused("DIV", undefined, true))), true, "a contenteditable");
});
