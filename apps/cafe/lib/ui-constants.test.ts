import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CHANNELS } from "@/lib/dashboard/fold";
import { SETTLEMENT_PAY_MODES } from "@/lib/constants";
import {
  AVATAR_HUES,
  CHANNEL_KIND,
  PAY_PILL_KIND,
  PAYMENT_KIND,
  PIN_KEY_CLASS,
  PIN_KEY_CLASS_PHONE,
  RESERVATION_KIND,
  STATUS_CLASSES,
  TABLE_KIND,
  avatarHueIndex,
  type StatusKind,
} from "@/lib/ui";

const KINDS = ["ok", "warn", "bad", "info", "bill", "reserved", "neutral"] as const satisfies readonly StatusKind[];
const PARTS = ["dot", "ink", "tint", "border", "pill"] as const;
const ALLOWED = /^(?:bg|text|border)-(?:status-[a-z]+(?:-(?:ink|tint|border))?|muted-foreground|subtle-foreground|muted|transparent)$/;

test("every status kind has all five strings, naming only status-*, muted and subtle tokens", () => {
  assert.deepEqual(Object.keys(STATUS_CLASSES).sort(), [...KINDS].sort(), "STATUS_CLASSES covers every kind");
  for (const kind of KINDS) {
    for (const part of PARTS) {
      const value = STATUS_CLASSES[kind][part];
      assert.ok(value.length > 0, `${kind}.${part} is not empty`);
      for (const cls of value.split(" ")) {
        assert.match(cls, ALLOWED, `${kind}.${part} class "${cls}" is an allowed token class`);
      }
    }
  }
  assert.equal(STATUS_CLASSES.ok.dot, "bg-status-ok");
  assert.equal(STATUS_CLASSES.ok.ink, "text-status-ok-ink");
  assert.equal(STATUS_CLASSES.ok.tint, "bg-status-ok-tint");
  assert.equal(STATUS_CLASSES.ok.pill, "bg-status-ok-tint text-status-ok-ink");
  for (const kind of ["info", "bill", "reserved"] as const) {
    assert.equal(STATUS_CLASSES[kind].border, `border-status-${kind}-border`, `${kind} border`);
  }
  for (const kind of ["ok", "warn", "bad"] as const) {
    assert.equal(STATUS_CLASSES[kind].border, "border-transparent", `${kind} border`);
  }
  assert.equal(STATUS_CLASSES.neutral.dot, "bg-subtle-foreground");
  assert.equal(STATUS_CLASSES.neutral.ink, "text-muted-foreground");
  assert.equal(STATUS_CLASSES.neutral.tint, "bg-muted");
});

test("payment, channel, table and reservation maps", () => {
  assert.deepEqual(Object.keys(PAYMENT_KIND).sort(), [...SETTLEMENT_PAY_MODES].sort(), "PAYMENT_KIND keys are the pay modes");
  assert.deepEqual(
    PAYMENT_KIND,
    { Online: "info", Cash: "ok", Split: "reserved", Due: "bill", Credit: "warn" },
    "payment kinds",
  );
  assert.deepEqual(PAY_PILL_KIND, { ...PAYMENT_KIND, Unpaid: "neutral" }, "pill kinds add Unpaid");
  assert.deepEqual(Object.keys(CHANNEL_KIND).sort(), [...CHANNELS].sort(), "CHANNEL_KIND keys are the dashboard channel keys");
  assert.deepEqual(
    CHANNEL_KIND,
    { "dine-in": "info", takeaway: "warn", qr: "reserved", counter: "ok" },
    "channel kinds",
  );
  assert.deepEqual(TABLE_KIND, { Available: "ok", Occupied: "info", Reserved: "reserved" }, "table kinds");
  assert.deepEqual(
    RESERVATION_KIND,
    { Booked: "info", Seated: "ok", Completed: "neutral", Cancelled: "bad" },
    "reservation kinds",
  );
  assert.equal(PIN_KEY_CLASS, "h-14");
  assert.equal(PIN_KEY_CLASS_PHONE, "h-[54px]");
});

test("avatar hues: the eight HTML pairs (values 1.6, color-mix precomputed), and a stable index", () => {
  // Owner's HTML values: some pairs are under 4.5:1 (design 9); no contrast floor applies.
  assert.deepEqual(
    AVATAR_HUES.map(({ bg, fg }) => [bg.toLowerCase(), fg.toLowerCase()]),
    [
      ["#d7e2dc", "#1e4e34"],
      ["#d1e8e7", "#056966"],
      ["#eadcfe", "#7337cf"],
      ["#f7d8e5", "#ac2460"],
      ["#d4ebfb", "#127abf"],
      ["#f1e9d1", "#937005"],
      ["#d6e8db", "#196b32"],
      ["#f3dfd1", "#9a4305"],
    ],
    "eight hues, values 1.6 table avBg/avFg in order",
  );
  const first = avatarHueIndex("Rohan Kapoor");
  assert.ok(first >= 0 && first <= 7, `index ${first} is within 0..7`);
  assert.equal(avatarHueIndex("Rohan Kapoor"), first, "same seed, same index");
  assert.equal(avatarHueIndex(""), 0, "empty seed is index 0");
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

test("no component defines a bg-status- class map of its own", () => {
  const offenders: string[] = [];
  for (const file of walk("components")) {
    const text = readFileSync(file, "utf8");
    const kinds = new Set([...text.matchAll(/bg-status-([a-z]+)/g)].map((m) => m[1]));
    if (kinds.size >= 2) offenders.push(`${file} (${[...kinds].join(", ")})`);
  }
  assert.deepEqual(offenders, [], "components use STATUS_CLASSES from lib/ui, never their own map");
});
