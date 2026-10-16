import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PinPad } from "@/components/ui/pin-pad";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StaffAvatar } from "@/components/shared/StaffAvatar";
import { StatusPill, StatusDot } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const noop = () => {};
const pad = (props: Partial<React.ComponentProps<typeof PinPad>> = {}) =>
  renderToStaticMarkup(createElement(PinPad, { value: "12", onChange: noop, onComplete: noop, ...props }));

test("PinPad: 12 named keys, two of four dots filled, a live line", () => {
  const html = pad();
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(buttons.length, 12, "twelve buttons");
  assert.ok(buttons.every((b) => b.includes('type="button"')), "every key is type=button");
  for (const name of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
    assert.ok(html.includes(`>${name}</button>`), `key ${name} is named`);
  }
  assert.ok(html.includes('aria-label="Clear"') || html.includes(">Clear</button>"), "Clear key");
  assert.ok(html.includes('aria-label="Delete last digit"'), "Delete last digit key");
  assert.ok(html.includes("2 of 4 digits entered"), "live line");
  assert.equal((html.match(/data-filled="true"/g) ?? []).length, 2, "two filled dots");
  assert.equal((html.match(/data-filled="false"/g) ?? []).length, 2, "two empty dots");
  assert.ok(html.includes("h-14"), "keys are PIN_KEY_CLASS tall");
  assert.ok(!html.includes('role="alert"') || !html.includes("Incorrect"), "no error by default");
});

test("PinPad: the error sits in role=alert; disabled disables every key", () => {
  const html = pad({ error: "Incorrect PIN" });
  assert.match(html, /role="alert"[^>]*>Incorrect PIN</, "error in a role=alert element");
  const off = pad({ disabled: true });
  const buttons = off.match(/<button[^>]*>/g) ?? [];
  assert.ok(buttons.length === 12 && buttons.every((b) => b.includes("disabled")), "all keys disabled");
});

test("StaffAvatar shows initials; the status dot is optional", () => {
  const html = renderToStaticMarkup(createElement(StaffAvatar, { name: "Priya Sharma", status: "online" }));
  assert.ok(html.includes(">PS<"), "initials PS");
  assert.ok(html.includes("background-color"), "hue as inline style");
  const plain = renderToStaticMarkup(createElement(StaffAvatar, { name: "Priya Sharma" }));
  assert.ok(!plain.includes('data-status'), "no status dot by default");
});

test("StatusPill and StatusDot use the status classes", () => {
  const pill = renderToStaticMarkup(createElement(StatusPill, { kind: "bill", dot: true } as React.ComponentProps<typeof StatusPill>, "Billed"));
  assert.ok(pill.includes("bg-status-bill-tint text-status-bill-ink"), "bill pill classes");
  assert.ok(pill.includes("bg-status-bill"), "dot class");
  assert.ok(pill.includes("Billed"), "label");
  const dot = renderToStaticMarkup(createElement(StatusDot, { kind: "ok" }));
  assert.ok(dot.includes("bg-status-ok") && dot.includes('aria-hidden="true"'), "dot is decorative and coloured");
});

test("SegmentedControl: group, label, aria-pressed on the chosen option only", () => {
  const html = renderToStaticMarkup(
    createElement(SegmentedControl<"a" | "b">, {
      label: "Range",
      value: "b",
      options: [{ value: "a", label: "Today" }, { value: "b", label: "Week" }],
      onChange: noop,
    }),
  );
  assert.ok(html.includes('role="group"') && html.includes('aria-label="Range"'), "group with label");
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1, "one pressed");
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 1, "one not pressed");
  assert.match(html, /aria-pressed="true"[^>]*>Week</, "the chosen one is Week");
});

test("shared states render title, description, action and keep their structure", () => {
  const empty = renderToStaticMarkup(
    createElement(EmptyState, { title: "Nothing yet", description: "Add one", action: createElement("button", null, "Add") }),
  );
  assert.ok(empty.includes("Nothing yet") && empty.includes("Add one") && empty.includes(">Add<"), "empty state content");
  const err = renderToStaticMarkup(createElement(ErrorState, { onRetry: noop }));
  assert.ok(err.includes("Couldn&#x27;t load this") && err.includes(">Retry<"), "error state content");
  const head = renderToStaticMarkup(
    createElement(PageHeader, { title: "Menu", eyebrow: "Catalogue", description: "All items", actions: createElement("i", null, "x") }),
  );
  assert.ok(head.includes("<h2") && head.includes(">Menu</h2>") && head.includes("Catalogue") && head.includes("All items"), "header content");
});
