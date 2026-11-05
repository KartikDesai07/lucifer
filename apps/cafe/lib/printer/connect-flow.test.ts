// Printer UX PX-3 Task 11 (spec §6.7; mockups g1–g6; rulings X3, X4, X10): the guided connect's steps as a pure reducer,
// its head (the sub and the foot), its choices and its found rows. Every pair the reducer does not name changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

import type { NativePrinter } from "@/lib/printer/native-bridge-protocol";
import {
  CONNECT_ADD,
  CONNECT_REPLACE,
  CONNECT_TRANSPORT_WORDS,
  connectChoicesOf,
  connectFlowReducer,
  connectHeadOf,
  connectRowsOf,
  connectStartOf,
  connectTransportOf,
  type ConnectEvent,
  type ConnectState,
  type ConnectStep,
} from "@/lib/printer/connect-flow";

const RPP = { id: "AA:BB", name: "RPP02N" };
const at = (step: ConnectStep, over: Partial<ConnectState> = {}): ConnectState => ({ step, mode: "replace", transport: "bluetooth", target: null, error: null, ...over });

const STEPS: ConnectStep[] = ["type", "list", "connecting", "connected", "question", "tips"];
const EVENTS: ConnectEvent[] = [
  { type: "choose", transport: "usb" },
  { type: "pick", target: RPP },
  { type: "connected" },
  { type: "failed" },
  { type: "tested" },
  { type: "not-printed" },
  { type: "other" },
];
// The table the brief names (mode replace): step + event → the next step.
const TABLE: Record<string, ConnectStep> = {
  "type+choose": "list",
  "list+pick": "connecting",
  "connecting+connected": "connected",
  "connecting+failed": "list",
  "connected+tested": "question",
  "tips+tested": "question",
  "question+not-printed": "tips",
  "tips+other": "type",
};

test("a known transport starts at the list", () => {
  assert.deepEqual(connectStartOf({ mode: "replace", transport: "bluetooth" }), at("list"), "Connect it again: straight to the Bluetooth list");
  assert.deepEqual(connectStartOf({ mode: "add", transport: "network" }), at("list", { mode: "add", transport: "network" }), "add mode keeps its mode");
  assert.deepEqual(connectStartOf(CONNECT_REPLACE), at("type", { transport: null }), "no transport: what kind of printer first");
  assert.deepEqual(connectStartOf(CONNECT_ADD), at("type", { mode: "add", transport: null }), "Connect another printer: the same first step");
  assert.deepEqual([CONNECT_REPLACE, CONNECT_ADD], [{ mode: "replace", transport: null }, { mode: "add", transport: null }], "the two entries from settings and the status card");
});

test("each step and its next", () => {
  const chose = connectFlowReducer(at("type", { transport: null, error: "old" }), { type: "choose", transport: "usb" });
  assert.deepEqual(chose, at("list", { transport: "usb" }), "a choice opens its list, with no old error");
  assert.deepEqual(connectFlowReducer(at("list", { error: "Could not connect" }), { type: "pick", target: RPP }), at("connecting", { target: RPP }), "a pick connects to that printer, a fresh try");
  assert.deepEqual(connectFlowReducer(at("connecting", { target: RPP }), { type: "connected" }), at("connected", { target: RPP }), "connected");
  assert.deepEqual(connectFlowReducer(at("connected", { target: RPP }), { type: "tested" }), at("question", { target: RPP }), "the test slip went: the question");
  assert.deepEqual(connectFlowReducer(at("tips", { target: RPP }), { type: "tested" }), at("question", { target: RPP }), "again from the tips: the question again");
  assert.deepEqual(connectFlowReducer(at("question", { target: RPP }), { type: "not-printed" }), at("tips", { target: RPP }), "No: the tips");
  assert.deepEqual(connectFlowReducer(at("tips", { target: RPP, error: "x" }), { type: "other" }), at("type", { target: null, error: null }), "Choose another printer: the first step, nothing of the last printer");
  for (const [pair, next] of Object.entries(TABLE)) {
    const [step, type] = pair.split("+");
    const event = EVENTS.find((e) => e.type === type);
    assert.ok(event !== undefined, `${pair}: an event of that type`);
    assert.equal(connectFlowReducer(at(step as ConnectStep, { target: RPP }), event).step, next, `${pair} → ${next}`);
  }
});

test("a failed connect returns to the list with its words", () => {
  const replace = connectFlowReducer(at("connecting", { target: RPP }), { type: "failed" });
  assert.deepEqual(replace, at("list", { target: RPP, error: "Could not connect to RPP02N. Check it is on, then try again." }), "replace: back to the list, the line names the printer");
  const add = connectFlowReducer(at("connecting", { mode: "add", target: RPP }), { type: "failed" });
  assert.deepEqual(add, at("list", { mode: "add", target: RPP, error: "The printer is added, but not connected yet. Check it is on, then tap Reconnect." }), "add: today's words (X4)");
});

test("add mode has no test step", () => {
  const connected = at("connected", { mode: "add", target: RPP });
  assert.equal(connectFlowReducer(connected, { type: "tested" }), connected, "add ends at connected: no test slip (X4)");
});

test("anything else changes nothing", () => {
  let checked = 0;
  for (const step of STEPS) {
    for (const event of EVENTS) {
      if (TABLE[`${step}+${event.type}`] !== undefined) continue;
      const state = at(step, { target: RPP });
      assert.equal(connectFlowReducer(state, event), state, `${step} + ${event.type}: the same state`);
      checked += 1;
    }
  }
  assert.equal(checked, STEPS.length * EVENTS.length - Object.keys(TABLE).length, "every other pair was checked");
});

test("the head says the step and the foot", () => {
  const heads = STEPS.map((step) => connectHeadOf(at(step)));
  assert.deepEqual(heads, [
    { sub: "Step 1 of 3", foot: "cancel" },
    { sub: "Step 2 of 3 · Bluetooth", foot: "cancel" },
    { sub: "Step 3 of 3", foot: "cancel" },
    { sub: "Step 3 of 3", foot: "done" },
    { sub: "Step 3 of 3", foot: "done" },
    { sub: "Step 3 of 3", foot: "done" },
  ], "type / list / connecting cancel; from connected on, Done (X3)");
  assert.equal(connectHeadOf(at("list", { transport: "usb" })).sub, "Step 2 of 3 · USB", "the USB list");
  assert.equal(connectHeadOf(at("list", { transport: "network" })).sub, "Step 2 of 3 · Wi-Fi or network", "the network form");
  assert.deepEqual(CONNECT_TRANSPORT_WORDS, { bluetooth: "Bluetooth", usb: "USB", network: "Wi-Fi or network" }, "the transports' words");
});

test("the saved printer's transport", () => {
  assert.equal(connectTransportOf("bluetooth"), "bluetooth", "Bluetooth");
  assert.equal(connectTransportOf("usb"), "usb", "USB");
  assert.equal(connectTransportOf("network"), "network", "network");
  assert.equal(connectTransportOf("windows"), null, "a Windows printer: what kind first");
  assert.equal(connectTransportOf("browser"), null, "a port of unknown kind: what kind first");
  assert.equal(connectTransportOf(null), null, "no saved printer");
});

test("the choices: Bluetooth, USB plugged into the device (X10), Wi-Fi or network", () => {
  assert.deepEqual(connectChoicesOf("this tablet"), [
    { transport: "bluetooth", title: "Bluetooth", sub: "Most receipt printers" },
    { transport: "usb", title: "USB cable", sub: "Plugged into this tablet" },
    { transport: "network", title: "Wi-Fi or network", sub: "On the cafe's network" },
  ], "the three rows");
  assert.equal(connectChoicesOf("this phone")[1]?.sub, "Plugged into this phone", "the noun follows the device");
});

test("the found rows: Bluetooth's paired and nearby, the first paired one primary; USB's", () => {
  const printers: NativePrinter[] = [
    { id: "u1", name: "USB-80", transport: "usb" },
    { id: "b1", name: "POS-58", transport: "ble" },
    { id: "c1", name: "RPP02N", transport: "bt-classic", paired: true },
    { id: "c2", name: "MTP-II", transport: "bt-classic", paired: true },
    { id: "t1", name: "Kitchen", transport: "tcp" },
  ];
  assert.deepEqual(connectRowsOf(printers, "bluetooth"), [
    { id: "b1", name: "POS-58", sub: "Nearby", primary: false },
    { id: "c1", name: "RPP02N", sub: "Paired", primary: true },
    { id: "c2", name: "MTP-II", sub: "Paired", primary: false },
  ], "both Bluetooth kinds, in the app's order; only the first paired row is the primary");
  assert.deepEqual(connectRowsOf(printers, "usb"), [{ id: "u1", name: "USB-80", sub: "USB", primary: false }], "the USB entries");
  assert.deepEqual(connectRowsOf([{ id: "b1", name: "POS-58", transport: "ble" }], "bluetooth"), [{ id: "b1", name: "POS-58", sub: "Nearby", primary: false }], "none paired: no primary");
});
