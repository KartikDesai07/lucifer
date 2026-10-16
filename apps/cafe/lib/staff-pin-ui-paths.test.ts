// Task 13 (PIN lock): source pins for the Staff page PIN UI and the Screen lock setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

const FORM = "components/staff/StaffFormSheet.tsx";
const CARD = "components/staff/StaffRowCard.tsx";
const PAGE = "app/(dashboard)/staff/page.tsx";
const HOOK = "hooks/use-staff.ts";
const BUSINESS = "components/settings/BusinessDetailsFields.tsx";

test("PIN UI: the form has a 4-digit numeric PIN field, required on create through staffPinProblem", () => {
  const s = src(FORM);
  assert.match(s, /PIN \(4 digits\)/, "the create label");
  assert.match(s, /id="staff-pin"/, "the field id");
  assert.match(s, /inputMode="numeric"/, "numeric keypad");
  assert.match(s, /maxLength=\{4\}/, "four characters at most");
  assert.match(s, /staffPinProblem/, "the shared validator is used");
  assert.match(s, /STAFF_PIN_MESSAGES/, "the shared messages are used");
  assert.match(s, /setError\(\s*"pin"/, "a bad PIN is reported on the pin field");
});

test("PIN UI: edit has an optional New PIN and a Show button that calls useRevealStaffPin", () => {
  const s = src(FORM);
  assert.match(s, /New PIN/, "the edit label");
  assert.match(s, />\s*Show\s*</, "a Show button");
  assert.match(s, /useRevealStaffPin/, "reveals on demand through the hook");
  const h = src(HOOK);
  assert.match(h, /export function useRevealStaffPin/, "the hook is exported");
  assert.match(h, /apiGet<\{ pin: string \| null \}>\(\s*`\/api\/staff\/\$\{id\}\/pin`/, "GET /api/staff/[id]/pin");
  assert.doesNotMatch(h.slice(h.indexOf("useRevealStaffPin")), /useQuery/, "a mutation, never cached");
});

test("PIN UI: the card and the table show PIN blocked, Unblock PIN and No PIN", () => {
  for (const rel of [CARD, PAGE]) {
    const s = src(rel);
    assert.match(s, /PIN blocked/, rel + " shows the blocked pill");
    assert.match(s, /Unblock PIN/, rel + " has the Unblock PIN action");
    assert.match(s, /No PIN/, rel + " shows the No PIN pill");
    assert.match(s, /StatusPill/, rel + " uses StatusPill");
    assert.match(s, /pinBlocked/, rel + " reads pinBlocked");
    assert.match(s, /hasPin/, rel + " reads hasPin");
  }
  assert.match(src(PAGE), /pinBlocked:\s*false/, "the page unblocks through useUpdateStaff");
});

test("PIN UI: the Screen lock group sits in Business details through the kit Select and is stored as a number", () => {
  const s = src(BUSINESS);
  assert.match(s, /title="Screen lock"/, "group title");
  assert.match(s, /Lock the screen after no activity for/, "field label");
  for (const label of ["Off", "30 minutes", "1 hour", "2 hours"]) {
    assert.ok(s.includes(label), "option " + label);
  }
  assert.match(s, /name="screenLockMinutes"/, "registered as screenLockMinutes");
  assert.match(s, /Number\(/, "string option values convert to numbers");
  assert.match(s, /SelectTrigger/, "kit Select");
  assert.ok(s.indexOf('title="Tables screen"') < s.indexOf('title="Screen lock"'), "after Tables screen");
  assert.ok(s.indexOf('title="Screen lock"') < s.indexOf('title="App branding"'), "before App branding");
});

test("PIN UI: the Settings model, type and form defaults carry screenLockMinutes", () => {
  assert.match(
    src("models/Settings.ts"),
    /screenLockMinutes:\s*\{\s*type:\s*Number,\s*enum:\s*\[0,\s*30,\s*60,\s*120\],\s*default:\s*60\s*\}/,
    "model field",
  );
  assert.match(src("models/settings.types.ts"), /screenLockMinutes:\s*number;/, "type");
  assert.match(
    src("lib/settings-form-defaults.ts"),
    /screenLockMinutes:.*\?\? SCREEN_LOCK_DEFAULT_MINUTES/,
    "form default",
  );
});
