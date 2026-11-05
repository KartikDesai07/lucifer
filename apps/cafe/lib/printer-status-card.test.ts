import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrinterHereCard } from "@/components/print/PrinterHereCard";
import { PrinterSettingsRow, settingsRowSubOf } from "@/components/print/PrinterSettingsRow";
import { PrinterStatusCard } from "@/components/print/PrinterStatusCard";
import type { PrinterHere } from "@/lib/print-agent-here";
import { printerStatusViewOf, type PrinterStatusView, type PrinterStatusViewInput, type StatusActionKind, type StatusLinkKind } from "@/lib/printer/printer-status-view";
import { stripComments } from "@/lib/source-pin-utils";

// PX-2 Task 6 (spec §6.2; mockups s-off / s-ready / s-paper / s-pm-tablet): the status view's parts, drawn from the pure
// words of printerStatusViewOf. Rendered on the server: what a person sees and what a screen reader hears.

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/floor-dialogs.test.ts).
(globalThis as { React?: typeof React }).React = React;

const BASE: PrinterStatusViewInput = {
  dot: { show: true, ok: false, reason: "printer-off" },
  hostLabel: null,
  printer: { name: "RPP02N", transport: "bluetooth" },
  noun: "this tablet",
  isHostDevice: false,
  canPrintHere: false,
  desktopNoPrinter: false,
  localStatus: "disconnected",
  here: [],
  waiting: null,
  notHere: [],
  isAdmin: false,
};
const viewOf = (over: Partial<PrinterStatusViewInput> = {}): PrinterStatusView => printerStatusViewOf({ ...BASE, ...over });
const OFF = viewOf();
const READY = viewOf({ dot: { show: true, ok: true, reason: "ok" }, localStatus: "connected" });
const PAPER = viewOf({ dot: { show: true, ok: false, reason: "printer-problem", problem: "RPP02N is out of paper." }, localStatus: "connected" });

function card(view: PrinterStatusView, busy = false): string {
  return renderToStaticMarkup(createElement(PrinterStatusCard, { view, busy, onAction: () => undefined, onLink: () => undefined }));
}
const buttons = (html: string): string[] => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
const steps = (html: string): string[] => (html.match(/<li[\s\S]*?<\/li>/g) ?? []).map((li) => li.replace(/<[^>]+>/g, ""));

test("a bad card: the headline, the numbered steps with the bold word, one Reconnect button and the link", () => {
  const html = card(OFF);
  assert.ok(html.includes(">Printer not connected<"), "the headline");
  assert.ok(html.includes(">RPP02N · Bluetooth<"), "the detail");
  assert.deepEqual(steps(html), ["1Turn the printer on.", "2Keep it close to this tablet.", "3Tap Reconnect."], "three numbered steps, in order");
  assert.ok(html.includes("<strong>Reconnect</strong>"), "the step's bold word is bold");
  assert.ok(!html.includes("**"), "never the asterisks");
  assert.match(html, /<ol[^>]*>/, "an ordered list");
  const all = buttons(html);
  assert.equal(all.length, 2, "one fixing button and one link");
  assert.match(all[0] ?? "", />Reconnect<\/button>$/, "the button first: Reconnect");
  assert.match(all[1] ?? "", /Still not working\? Connect it again<svg/, "then the quiet link with its chevron");
  assert.ok(html.indexOf("</ol>") < html.indexOf(">Reconnect</button>"), "the button under the steps");
});

test("an ok card has no button", () => {
  const html = card(READY);
  assert.ok(html.includes(">Printer ready<") && html.includes(">RPP02N · Bluetooth<"), "the words");
  assert.equal(buttons(html).length, 0, "nothing to tap");
  assert.ok(!html.includes("<ol"), "no steps");
  const host = card(viewOf({ dot: { show: true, ok: true, reason: "ok" }, hostLabel: "Counter tablet", localStatus: "none" }));
  assert.ok(host.includes("Slips print at <strong>Counter tablet</strong>."), "the detail's bold name is bold too");
});

test("the note shows under the steps", () => {
  const html = card(PAPER);
  assert.deepEqual(steps(html), ["1Put in a new paper roll.", "2Close the cover."], "the two steps");
  const note = html.indexOf(">Waiting slips print by themselves after that.<");
  assert.ok(note > html.indexOf("</ol>"), "the note under the steps");
  assert.equal(buttons(html).length, 0, "out of paper: nothing to tap");
});

test("role=\"status\" and aria-live=\"polite\" on the card; the headline can take the focus; the circle is decoration", () => {
  for (const view of [OFF, READY, PAPER, viewOf({ dot: { show: false } })]) {
    const html = card(view);
    assert.match(html, /^<div role="status" aria-live="polite"/, `${view.headline}: a live status region`);
    assert.match(html, /<p data-ui="printer-status-headline" tabindex="-1"/, `${view.headline}: the headline is focusable (F-M6)`);
    assert.match(html, /<span aria-hidden="true" class="[^"]*size-10/, `${view.headline}: the 40 px circle is hidden from screen readers`);
  }
  assert.ok(card(viewOf({ dot: { show: false } })).includes("motion-safe:animate-spin"), "checking: a spinner that respects reduced motion");
});

test("while Reconnect runs: Reconnecting… with a spinner, and the button waits", () => {
  const [button] = buttons(card(OFF, true));
  assert.ok(button !== undefined && button.includes("Reconnecting…"), "the busy words");
  assert.match(button, / disabled=""/, "disabled until it settles");
  assert.ok(button.includes("motion-safe:animate-spin"), "a spinner");
  const connect = buttons(card(viewOf({ dot: { show: true, ok: false, reason: "no-printer" }, printer: null }), true))[0] ?? "";
  assert.ok(connect.includes(">Connect a printer<"), "only Reconnect says Reconnecting…");
});

// The button and the link call back with their kind: the card has no hooks, so its element tree is read as React built it.
function clickables(node: ReactNode, out: { label: string; onClick: () => void }[] = []): { label: string; onClick: () => void }[] {
  if (Array.isArray(node)) node.forEach((child) => clickables(child, out));
  else if (isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) {
    const text = renderToStaticMarkup(createElement("div", null, node.props.children)).replace(/<[^>]+>/g, "");
    if (node.props.onClick !== undefined) out.push({ label: text, onClick: node.props.onClick });
    clickables(node.props.children, out);
  }
  return out;
}

test("the button says its action's kind; the link its link's kind", () => {
  const actions: StatusActionKind[] = [];
  const links: StatusLinkKind[] = [];
  const tree = PrinterStatusCard({ view: OFF, busy: false, onAction: (kind) => actions.push(kind), onLink: (kind) => links.push(kind) });
  const found = clickables(tree);
  assert.deepEqual(found.map((c) => c.label), ["Reconnect", "Still not working? Connect it again"], "two things to tap");
  for (const c of found) c.onClick();
  assert.deepEqual(actions, ["reconnect"], "Reconnect");
  assert.deepEqual(links, ["connect-again"], "the link");
});

const here = (id: string, name: string, over: Partial<PrinterHere> = {}): PrinterHere => ({ id, name, appName: "RPP02N", transport: "bluetooth", nativeId: `bt-classic:${id}`, status: "connected", ...over });

test("On this device: each printer's dot, name over app · transport, and state word; no buttons", () => {
  const list = [
    here("k", "Kitchen printer", { status: "disconnected" }),
    here("b", "Bill printer", { appName: "POS-80" }),
    here("p", "Bar printer", { problem: "paper-out" }),
    here("c", "Cover printer", { problem: "cover-open" }),
    here("e", "Error printer", { problem: "error" }),
    here("w", "Wait printer", { status: "connecting" }),
    here("x", "Office printer", { appName: "EPSON TM-T82", transport: "windows", nativeId: undefined, status: "none" }),
  ];
  const html = renderToStaticMarkup(createElement(PrinterHereCard, { here: list, windowsApp: false }));
  assert.ok(html.includes(">On this device<"), "the card's title");
  assert.equal(buttons(html).length, 0, "no buttons: the card's one Reconnect does it");
  const rows = (html.match(/<li[\s\S]*?<\/li>/g) ?? []).map((li) => li.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|"));
  assert.deepEqual(rows, [
    "|Kitchen printer|RPP02N · Bluetooth|Not connected|",
    "|Bill printer|POS-80 · Bluetooth|Ready|",
    "|Bar printer|RPP02N · Bluetooth|Out of paper|",
    "|Cover printer|RPP02N · Bluetooth|Cover open|",
    "|Error printer|RPP02N · Bluetooth|Error|",
    "|Wait printer|RPP02N · Bluetooth|Connecting…|",
    "|Office printer|EPSON TM-T82 · Windows printer|",
  ], "the setup's order and the spec's words; a Windows printer has no state word");
  assert.match(html, /<span aria-hidden="true" class="[^"]*size-\[9px\][^"]*bg-status-warn/, "a 9 px amber dot for a printer that is down");
  assert.match(html, /<span aria-hidden="true" class="[^"]*size-\[9px\][^"]*bg-status-ok/, "a green one for a ready printer");
  const lan = renderToStaticMarkup(createElement(PrinterHereCard, { here: [here("n", "Kitchen printer", { appName: "192.168.1.60", transport: "network", nativeId: undefined })], windowsApp: true }));
  assert.ok(lan.includes(">192.168.1.60 · network<"), "the Windows app's network printer, as the status card words it");
});

test("Printer settings ›: one row that opens the settings, its sub by the device", () => {
  assert.equal(settingsRowSubOf("this tablet", false), "Connect, change or remove a printer · paper size", "the usual sub");
  assert.equal(settingsRowSubOf("this phone", true), "This phone has no printer · Slips print at the cafe's printers", "a phone in printers mode that prints nothing");
  assert.equal(settingsRowSubOf("this PC", true), "This PC has no printer · Slips print at the cafe's printers", "the device noun as in §6.4");
  let opened = 0;
  const html = renderToStaticMarkup(createElement(PrinterSettingsRow, { sub: settingsRowSubOf("this tablet", false), onOpen: () => (opened += 1) }));
  assert.equal(buttons(html).length, 1, "one button");
  assert.match(html, /^<button type="button" data-ui="printer-settings-row"/, "the whole row is the button");
  assert.ok(html.includes(">Printer settings<") && html.includes(">Connect, change or remove a printer · paper size<"), "its words");
  assert.ok(!/<div/.test(html), "phrasing content only inside a button");
  PrinterSettingsRow({ sub: "", onOpen: () => (opened += 1) }).props.onClick();
  assert.equal(opened, 1, "a tap opens the settings");
});

test("the panel's status view draws card, list, here, settings row in that order", () => {
  const panel = stripComments(readFileSync(path.join(fileURLToPath(new URL("../", import.meta.url)), "components/print/PrinterPanel.tsx"), "utf8"));
  const at = ["<PrinterStatusCard", "<NotPrintedSection pulse={pulse} />", "<PrinterHereCard", "<PrinterSettingsRow", "<PrinterSettingsView home={home} noun={noun} onClose={onClose} />"].map((tag) => panel.indexOf(tag));
  assert.ok(at.every((i) => i >= 0), `every part is drawn: ${at.join(", ")}`);
  assert.ok(at.every((i, n) => n === 0 || i > (at[n - 1] ?? 0)), "status card < Not printed < On this device < Printer settings ›, then the settings view's parts");
});
