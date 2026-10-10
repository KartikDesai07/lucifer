import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

// Owner rule (said twice, 2026-10-10/11): the browser's own "sasta HTML" popups must never open anywhere — every date,
// time, colour and pick-one field uses the app's own control (DatePicker, TimePicker, the accent Popover, Select).
// This sweep reads every screen under app/ and components/ (the shadcn primitives in components/ui are the app's own
// controls and are skipped). Needles are built by concatenation so this file never contains them as literals.

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".next", "ui"]);
const NATIVE_TYPES = ["date", "time", "datetime-local", "month", "week", "color"] as const;
const NATIVE_SELECT = new RegExp("<" + "select[\\s>]");

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTsx(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".tsx")) out.push(path.join(dir, entry.name));
  }
  return out;
}

// Any spelling of a literal type (s89g review): type="x", type='x', type = "x", type={"x"}, type={`x`}.
const typeRe = (kind: string): RegExp => new RegExp("\\btype\\s*=\\s*\\{?\\s*[\"'`]" + kind + "[\"'`]\\s*\\}?");
const NATIVE_DATALIST = new RegExp("<" + "datalist[\\s>]");

function nativePickersIn(src: string): string[] {
  const hits: string[] = [];
  for (const kind of NATIVE_TYPES) {
    if (typeRe(kind).test(src)) hits.push("type " + kind);
  }
  if (NATIVE_SELECT.test(src)) hits.push("select tag");
  if (NATIVE_DATALIST.test(src)) hits.push("datalist tag");
  return hits;
}

test("PIN: no screen renders a native date / time / colour input or a native select (the app's own pickers only)", () => {
  const files = [...walkTsx(path.join(CAFE_ROOT, "app")), ...walkTsx(path.join(CAFE_ROOT, "components"))];
  // Vision guards: the walk really covered the screens, including the four that used to be native.
  assert.ok(files.length > 150, `the walk saw only ${files.length} .tsx files`);
  for (const known of ["EventFormSheet.tsx", "ReservationFormSheet.tsx", "AppearanceAccentInput.tsx", "DesktopPrinterPicker.tsx", "ExpenseFormSheet.tsx"]) {
    assert.ok(files.some((file) => file.endsWith(path.sep + known)), `the walk reaches ${known}`);
  }
  assert.ok(!files.some((file) => file.includes(path.sep + "components" + path.sep + "ui" + path.sep)), "components/ui is skipped");

  const offenders = files
    .map((file) => ({ file: path.relative(CAFE_ROOT, file), hits: nativePickersIn(stripComments(readFileSync(file, "utf8"))) }))
    .filter((row) => row.hits.length > 0);
  assert.deepEqual(offenders, [], "native pickers found");
});

test("PIN: the detector itself sees every native picker it bans (and not the app's own Select)", () => {
  for (const kind of NATIVE_TYPES) {
    assert.deepEqual(nativePickersIn("<input type=" + '"' + kind + '"' + " />"), ["type " + kind], `sees type ${kind}`);
  }
  assert.deepEqual(nativePickersIn("<Input type={" + '"' + "time" + '"' + "} />"), ["type time"], "sees type={\"time\"}");
  assert.deepEqual(nativePickersIn("<Input type={`" + "date" + "`} />"), ["type date"], "sees a template-literal type");
  assert.deepEqual(nativePickersIn("<input type = " + "'" + "color" + "'" + " />"), ["type color"], "sees spaces around =");
  assert.deepEqual(nativePickersIn("<" + "datalist id=\"x\">"), ["datalist tag"], "sees a native datalist");
  assert.deepEqual(nativePickersIn("<Input type={kind === 1 ? \"text\" : \"password\"} />"), [], "a text/password switch is fine");
  assert.deepEqual(nativePickersIn("<" + "select className=\"x\">"), ["select tag"], "sees a native select");
  assert.deepEqual(nativePickersIn("<Select value={v}><SelectTrigger /><SelectItem value=\"a\" /></Select>"), [], "the app's Select is fine");
  assert.deepEqual(nativePickersIn("<input type=\"text\" />"), [], "a text input is fine");
});
