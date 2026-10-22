// U1 Task 5 (2026-10-21): the /pos keys the owner added (owner Q13; design 6.13; values 13.2): "/" focuses the search,
// F8 presses Send KOT, F9 presses Pay. Unlike the HTML (its F8 / F9 work while typing and over open sheets, design 8),
// a key never acts while a field has the focus, while a dialog / sheet / panel is open, while the cart is busy, when its
// button is disabled, or on the keyboard's auto-repeat (plan Review Focus 4: a held F8 sends once).
import { test } from "node:test";
import assert from "node:assert/strict";

import { isPosKey, posKeyAction, type PosKeyState } from "./pos-keys";

// Event targets as the browser hands them: the page itself, a focused field, a focused button.
const at = (tagName: string, extra: Record<string, unknown> = {}): EventTarget => ({ tagName, ...extra }) as unknown as EventTarget;
const BODY = at("BODY");
const BUTTON = at("BUTTON");
const FIELDS: Array<[string, EventTarget]> = [
  ["an input", at("INPUT")],
  ["a textarea", at("TEXTAREA")],
  ["a select", at("SELECT")],
  ["an editable region", at("DIV", { isContentEditable: true })],
];

const READY: PosKeyState = { dialogOpen: false, busy: false, sendEnabled: true, payEnabled: true };
const press = (key: string, over: Partial<{ repeat: boolean; target: EventTarget | null; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  repeat: false,
  target: BODY,
  ...over,
});

test('"/" from the page focuses the search', () => {
  assert.equal(posKeyAction(press("/"), READY), "search", "/ with the focus on the page");
  assert.equal(posKeyAction(press("/", { target: BUTTON }), READY), "search", "/ with the focus on a button");
  assert.equal(posKeyAction(press("/", { target: null }), READY), "search", "/ with no target");
});

test('"/" while typing in a field types a slash (no action)', () => {
  for (const [what, target] of FIELDS) {
    assert.equal(posKeyAction(press("/", { target }), READY), null, `/ in ${what}`);
  }
});

test('"/" does nothing with a dialog open or on auto-repeat; the search box never locks, so a busy cart still allows it', () => {
  assert.equal(posKeyAction(press("/"), { ...READY, dialogOpen: true }), null, "/ under an open dialog");
  assert.equal(posKeyAction(press("/", { repeat: true }), READY), null, "a held / acts once");
  assert.equal(posKeyAction(press("/"), { ...READY, busy: true }), "search", "the search is usable while a send flies");
});

for (const [key, action, enabledKey] of [
  ["F8", "send", "sendEnabled"],
  ["F9", "pay", "payEnabled"],
] as const) {
  test(`${key} presses ${action === "send" ? "Send KOT" : "Pay"} when its button is enabled`, () => {
    assert.equal(posKeyAction(press(key), READY), action, `${key} from the page`);
    assert.equal(posKeyAction(press(key, { target: BUTTON }), READY), action, `${key} with the focus on a button`);
    const otherOff = action === "send" ? { payEnabled: false } : { sendEnabled: false };
    assert.equal(posKeyAction(press(key), { ...READY, ...otherOff }), action, `${key} does not depend on the other button`);
  });

  test(`${key} never acts on auto-repeat, in a field, over a dialog, while busy, or with its button disabled`, () => {
    assert.equal(posKeyAction(press(key, { repeat: true }), READY), null, `a held ${key} acts once (the first press only)`);
    for (const [what, target] of FIELDS) {
      assert.equal(posKeyAction(press(key, { target }), READY), null, `${key} while typing in ${what}`);
    }
    assert.equal(posKeyAction(press(key), { ...READY, dialogOpen: true }), null, `${key} with a dialog, sheet or panel open`);
    assert.equal(posKeyAction(press(key), { ...READY, busy: true }), null, `${key} while a write is in flight or a send is unconfirmed`);
    assert.equal(posKeyAction(press(key), { ...READY, [enabledKey]: false }), null, `${key} with its button disabled`);
  });

  test(`${key} with a modifier held is the browser's or the system's, not ours`, () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
      assert.equal(posKeyAction(press(key, { [mod]: true }), READY), null, `${mod} + ${key}`);
    }
  });
}

test("every other key does nothing", () => {
  for (const key of ["Enter", "Escape", "F7", "F10", "a", "?", " ", "Tab"]) {
    assert.equal(posKeyAction(press(key), READY), null, `${JSON.stringify(key)} is not a /pos key`);
  }
});

// U1 audit wave (report M1; ruling P54): PosKeys asks isPosKey FIRST and returns on any other key before it scans the
// page (3 querySelectorAll + getClientRects per keydown), so typing in a field costs no DOM reads; posKeyAction starts
// with the same check, so the two can never disagree about which keys are the page's.
test("isPosKey: exactly the three /pos keys, checked before anything else", () => {
  for (const key of ["/", "F8", "F9"]) assert.equal(isPosKey(key), true, `${key} is a /pos key`);
  for (const key of ["Enter", "Escape", "F7", "F10", "a", "?", " ", "Tab", "f8", "Divide", ""]) {
    assert.equal(isPosKey(key), false, `${JSON.stringify(key)} is not a /pos key`);
  }
  for (const key of ["a", "Enter", "F10"]) {
    assert.equal(posKeyAction(press(key), READY), null, `posKeyAction drops ${JSON.stringify(key)} as isPosKey does`);
  }
});
