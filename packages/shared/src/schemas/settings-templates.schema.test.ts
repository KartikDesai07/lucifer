import { test } from "node:test";
import assert from "node:assert/strict";

import { settingsSchema, updateSettingsSchema } from "./settings.schema";
import { billFixture, kotFixture, tokenFixture } from "../print-template-fixtures";

// Print customization S2: the slip templates ride the PUT body only. They are deliberately NOT in settingsSchema
// (section forms validate settingsSchema and PUT their own section's keys on every save, so a template there
// would be resent through the write gate or wiped by a null default); updateSettingsSchema adds them, saved whole
// and strictly, with null = clear (the cafe route turns null into $unset).
const billT = (): Record<string, unknown> => billFixture() as unknown as Record<string, unknown>;
const kotT = (): Record<string, unknown> => kotFixture() as unknown as Record<string, unknown>;
const tokenT = (): Record<string, unknown> => tokenFixture() as unknown as Record<string, unknown>;

test("updateSettingsSchema accepts a valid bill + kot template and keeps them in the parsed result", () => {
  const r = updateSettingsSchema.safeParse({ billTemplate: billT(), kotTemplate: kotT() });
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues));
  if (!r.success) return;
  assert.deepEqual(r.data.billTemplate, billT(), "the bill template survives the parse (not stripped as an unknown key)");
  assert.deepEqual(r.data.kotTemplate, kotT(), "the kot template survives the parse");
});

test("updateSettingsSchema accepts null for each template (the clear), alone and beside another field", () => {
  for (const body of [{ billTemplate: null }, { kotTemplate: null }, { billTemplate: null, kotTemplate: null }, { billShowLogo: true, billTemplate: null }]) {
    const r = updateSettingsSchema.safeParse(body);
    assert.ok(r.success, `${JSON.stringify(body)}: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
    if (r.success) for (const [k, v] of Object.entries(body)) assert.deepEqual((r.data as Record<string, unknown>)[k], v, `${k} kept`);
  }
  const absent = updateSettingsSchema.safeParse({ billShowLogo: true });
  assert.ok(absent.success && !("billTemplate" in absent.data) && !("kotTemplate" in absent.data), "an absent template stays absent (no default, no null)");
});

test("updateSettingsSchema rejects a template missing a required block, at a path under billTemplate.blocks", () => {
  const classic = billT();
  const noTotal = { ...classic, blocks: (classic.blocks as { type: string }[]).filter((b) => b.type !== "total") };
  const r = updateSettingsSchema.safeParse({ billTemplate: noTotal });
  assert.equal(r.success, false);
  if (r.success) return;
  assert.ok(r.error.issues.some((i) => i.path[0] === "billTemplate" && i.path[1] === "blocks"), JSON.stringify(r.error.issues.map((i) => i.path)));
  assert.equal(updateSettingsSchema.safeParse({ billTemplate: classic }).success, true, "landmark: the unmodified template passes");
  const kot = kotT();
  const kotNoTitle = { ...kot, blocks: (kot.blocks as { type: string }[]).filter((b) => b.type !== "title") };
  const k = updateSettingsSchema.safeParse({ kotTemplate: kotNoTitle });
  assert.ok(!k.success && k.error.issues.some((i) => i.path[0] === "kotTemplate" && i.path[1] === "blocks"), "kot without title is rejected under kotTemplate.blocks");
});

test("updateSettingsSchema rejects an unknown key in a template, at the top level and inside a block", () => {
  assert.equal(updateSettingsSchema.safeParse({ billTemplate: { ...billT(), extra: 1 } }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ kotTemplate: { ...kotT(), extra: 1 } }).success, false);
  const t = billT();
  const blocks = (t.blocks as Record<string, unknown>[]).map((b, i) => (i === 1 ? { ...b, color: "red" } : b));
  assert.equal(updateSettingsSchema.safeParse({ billTemplate: { ...t, blocks } }).success, false, "unknown key inside a block");
});

test("PIN: settingsSchema carries NO billTemplate / kotTemplate / tokenTemplate key (section forms would resend or wipe the design)", () => {
  // Landmark: the shape is a real, populated one, so the absence below is not an empty-object artifact.
  assert.ok("restaurantName" in settingsSchema.shape && "billShowLogo" in settingsSchema.shape, "landmark: settingsSchema.shape has the print + identity keys");
  for (const key of ["billTemplate", "kotTemplate", "tokenTemplate"]) {
    assert.ok(!(key in settingsSchema.shape), `${key} must stay out of settingsSchema: a section form that validates it would PUT it on every save`);
  }
  // ...while the PUT schema accepts them (the parse test above keeps the values).
  assert.equal(updateSettingsSchema.safeParse({ billTemplate: billT() }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ tokenTemplate: tokenT() }).success, true);
});

// S7: the token template is the third PUT-only slip template.

test("updateSettingsSchema accepts a valid token template and keeps it, accepts null (the clear) alone and beside another field, and leaves an absent one absent", () => {
  const r = updateSettingsSchema.safeParse({ tokenTemplate: tokenT() });
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues));
  if (r.success) assert.deepEqual(r.data.tokenTemplate, tokenT(), "the token template survives the parse (not stripped as an unknown key)");
  for (const body of [{ tokenTemplate: null }, { tokenEnabled: true, tokenTemplate: null }, { billTemplate: null, kotTemplate: null, tokenTemplate: null }]) {
    const n = updateSettingsSchema.safeParse(body);
    assert.ok(n.success, `${JSON.stringify(body)}: ${n.success ? "" : JSON.stringify(n.error.issues)}`);
    if (n.success) assert.equal((n.data as Record<string, unknown>).tokenTemplate, null, "null is kept (the cafe route turns it into $unset)");
  }
  const absent = updateSettingsSchema.safeParse({ tokenEnabled: true });
  assert.ok(absent.success && !("tokenTemplate" in absent.data), "an absent token template stays absent (no default, no null)");
});

test("updateSettingsSchema rejects an invalid token template under tokenTemplate: a missing tokenNo block, a classic design, an unknown key, a stray block type", () => {
  assert.equal(updateSettingsSchema.safeParse({ tokenTemplate: tokenT() }).success, true, "landmark: the unmodified fixture passes");
  const blocks = tokenT().blocks as { type: string }[];
  const noNumber = updateSettingsSchema.safeParse({ tokenTemplate: { ...tokenT(), blocks: blocks.filter((b) => b.type !== "tokenNo") } });
  assert.ok(!noNumber.success && noNumber.error.issues.some((i) => i.path[0] === "tokenTemplate" && i.path[1] === "blocks"), "no tokenNo block is refused under tokenTemplate.blocks");
  const classic = updateSettingsSchema.safeParse({ tokenTemplate: { ...tokenT(), design: "classic" } });
  assert.ok(!classic.success && classic.error.issues.some((i) => i.path[0] === "tokenTemplate" && i.path[1] === "design"), "a token has no classic design");
  assert.equal(updateSettingsSchema.safeParse({ tokenTemplate: { ...tokenT(), extra: 1 } }).success, false, "unknown top-level key");
  assert.equal(updateSettingsSchema.safeParse({ tokenTemplate: { ...tokenT(), blocks: [...blocks, { id: "total", on: true, type: "total" }] } }).success, false, "a bill-only block type (total) is not a token block");
  assert.equal(updateSettingsSchema.safeParse({ tokenTemplate: billT() }).success, false, "a bill template is not a token template");
});
