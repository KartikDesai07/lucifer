// Printer UX PX-3 Task 13 (spec §6.9 B11): the notice a refused scan shows, props only, every word the brief's.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ScanRefusalNotice } from "@/components/print/connect/ScanRefusalNotice";

(globalThis as { React?: typeof React }).React = React;

test("the notice asks to Allow, then shows the three steps", () => {
  const allow = renderToStaticMarkup(createElement(ScanRefusalNotice, { refusal: "allow", locked: false, onAllow: () => undefined }));
  assert.ok(allow.includes("Android needs Location to find Bluetooth printers."), "the sentence");
  assert.ok(/<button\b[^>]*>Allow<\/button>/.test(allow), "the Allow button");
  assert.ok(!allow.includes("<ol"), "no steps yet");
  const locked = renderToStaticMarkup(createElement(ScanRefusalNotice, { refusal: "allow", locked: true, onAllow: () => undefined }));
  assert.ok(locked.includes('disabled=""'), "Allow waits while the app is busy");
  const steps = renderToStaticMarkup(createElement(ScanRefusalNotice, { refusal: "settings-steps", locked: false, onAllow: () => undefined }));
  assert.ok(steps.includes("Open Android Settings → Apps → Sandbee POS → Permissions."), "step 1");
  assert.ok(steps.includes("Allow Location (or Nearby devices)."), "step 2");
  assert.ok(steps.includes("Come back and tap <strong>Search again</strong>."), "step 3 with Search again bold");
  assert.ok(!steps.includes(">Allow<"), "no Allow button in the steps");
});
