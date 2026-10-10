import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// CB-7 S2 source pins: the shapes a runtime test over fake deps cannot observe. (1) the progress read never
// projects the PIN credential; (2) both new modules are SERVER_ONLY in the client graph walk; (3) the step is wired
// into BOTH follow-up modules, create gated on Completed + a customer; (4) the PIN-set CAS writes the anchor in the
// SAME update as the hash; (5) the staff reset copies the anchor BEFORE it unsets, and never unsets the anchor;
// (6) nothing anywhere under app/ or lib/ unsets the anchor; (7) the stamp grant steps aside while levels are chosen.
// Every pin is a checker function run on the real source (must pass) AND on a mutated copy (must flip), so a
// renamed landmark cannot turn a pin into a vacuous pass. Needles are built where they could match this file itself.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const PROGRESS = "lib/reward-progress.ts";
const PLAN = "lib/reward-progress-plan.ts";
const SETTLE = "lib/settle-followups.ts";
const CREATE = "lib/order-create-followups.ts";
const ORDERS_ROUTE = "app/api/orders/route.ts";
const PIN_ROUTE = "app/api/public/diner/pin/route.ts";
const RESET_ROUTE = "app/api/customers/[id]/diner-pin/route.ts";
const STAMP = "lib/diner-loyalty-earn.ts";
const GUARD = "lib/client-graph-guard.test.ts";
const PROJECTION = "cardSteps rewardsAnchorAt pinSetAt";
const ANCHOR_KEY = "rewardsAnchorAt";
const BANNED_RNG = "Math" + ".random";

// Comment-stripped and CRLF-normalised (autocrlf can flip a checkout).
const norm = (src: string): string => stripComments(src).replace(/\r\n/g, "\n");
const read = (rel: string): string => norm(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

function mustIndexOf(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

// The text from an opening bracket at `open` through its matching close. These snippets hold no brackets in strings.
function balanced(src: string, open: number): string {
  const opener = src[open];
  const closer = opener === "(" ? ")" : opener === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === opener) depth += 1;
    else if (src[i] === closer) {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced ${opener} at ${open}`);
}

// The top-level (depth 0) comma-separated arguments of a `(...)` call text.
function topLevelArgs(call: string): string[] {
  const inner = call.slice(1, -1);
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if ("({[".includes(c)) depth += 1;
    else if (")}]".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

// The call text of the first `needle(` at or after `from`.
function callAt(src: string, needle: string, label: string, from = 0): { text: string; index: number } {
  const index = mustIndexOf(src, `${needle}(`, label, from);
  return { text: balanced(src, index + needle.length), index };
}

// ── 1. the read projection ───────────────────────────────────────────────────────────────────────────────────────

// Every `.select("...")` literal in the file, in order.
const selectsOf = (src: string): string[] => [...src.matchAll(/\.select\(\s*"([^"]*)"\s*\)/g)].map((m) => m[1]);

function projectionViolations(progressSrc: string, planSrc: string): string[] {
  const out: string[] = [];
  const progressSelects = selectsOf(progressSrc);
  if (progressSelects.length !== 1 || progressSelects[0] !== PROJECTION) {
    out.push(`reward-progress.ts selects ${JSON.stringify(progressSelects)}, expected exactly [${JSON.stringify(PROJECTION)}]`);
  }
  for (const [name, src] of [["reward-progress.ts", progressSrc], ["reward-progress-plan.ts", planSrc]] as const) {
    for (const sel of selectsOf(src)) if (/pinHash/.test(sel)) out.push(`${name} projects pinHash: ${sel}`);
    if (/\+pinHash/.test(src)) out.push(`${name} asks for +pinHash`);
  }
  return out;
}

test("PIN: the progress read projects exactly 'cardSteps rewardsAnchorAt pinSetAt' - never pinHash, in either new file", () => {
  const progress = read(PROGRESS);
  const plan = read(PLAN);
  assert.ok(progress.includes("Customer.findById(customerId)"), "landmark: the real read is in this file");
  assert.ok(plan.includes("pinHash: { $exists: true }"), "landmark: the plan file still checks pinHash in the CAS FILTER (so this scan sees real code)");
  assert.deepEqual(projectionViolations(progress, plan), []);
  // Vision guards: each mutation must be reported.
  assert.ok(projectionViolations(progress.replace(PROJECTION, `${PROJECTION} +pinHash`), plan).length > 0, "+pinHash flips it");
  assert.ok(projectionViolations(progress.replace(PROJECTION, "cardSteps rewardsAnchorAt"), plan).length > 0, "a changed projection flips it");
  assert.ok(projectionViolations(progress, `${plan}\nM.find().select("pinHash name");`).length > 0, "a pinHash select in the plan file flips it");
});

test("PIN: neither new file uses the non-secure generator, and the plan file reads no clock (raw bytes)", () => {
  for (const rel of [PROGRESS, PLAN]) {
    const raw = readFileSync(path.join(CAFE_ROOT, rel), "utf8");
    assert.equal(raw.includes(BANNED_RNG), false, `${rel} must not use ${BANNED_RNG}`);
  }
  const plan = read(PLAN);
  assert.ok(plan.includes("export function planProgressStep"), "landmark: the real plan file");
  assert.equal(plan.includes("Date." + "now"), false, "the pure plan reads no ambient clock");
  assert.equal(plan.includes("new Date" + "()"), false, "the pure plan reads no ambient clock");
});

// ── 2. SERVER_ONLY registration ──────────────────────────────────────────────────────────────────────────────────

test("PIN: client-graph-guard lists reward-progress and reward-progress-plan as SERVER_ONLY", () => {
  const guard = stripComments(readFileSync(path.join(CAFE_ROOT, GUARD), "utf8"));
  const line = guard.split("\n").find((l) => l.includes("const SERVER_ONLY ="));
  assert.ok(line, "landmark: the guard still declares SERVER_ONLY");
  const regexOf = (l: string) => new RegExp(l.slice(l.indexOf("/"), l.lastIndexOf("/") + 1).slice(1, -1));
  const cafe = (rel: string) => path.join(CAFE_ROOT, rel).replace(/\\/g, "/");
  const re = regexOf(line);
  assert.ok(re.test(cafe("models/Customer.ts")), "landmark: the regex still matches a model");
  assert.ok(re.test(cafe(PROGRESS)), "reward-progress.ts is server-only in the client graph walk");
  assert.ok(re.test(cafe(PLAN)), "reward-progress-plan.ts is server-only in the client graph walk");
  assert.equal(re.test(cafe("lib/reward-levels-label.ts")), false, "the regex is not a blanket reward-* ban");
  // Vision guard: with the two modules removed from the alternation the same checks must fail.
  const removed = line.replace("|progress-plan|progress", "");
  assert.notEqual(removed, line, "landmark: the mutation really changed the line");
  const mutated = regexOf(removed);
  assert.equal(mutated.test(cafe(PROGRESS)), false, "a guard without the entry no longer covers reward-progress.ts");
  assert.equal(mutated.test(cafe(PLAN)), false, "nor reward-progress-plan.ts");
  assert.ok(mutated.test(cafe("lib/reward-rng.ts")), "landmark: the mutated regex still matches its other entries");
});

// ── 3. wiring in both follow-up modules ──────────────────────────────────────────────────────────────────────────

function settleWiringViolations(src: string): string[] {
  const out: string[] = [];
  for (const needle of [
    'import { advanceRewardProgress } from "@/lib/reward-progress";',
    "advanceRewardProgress: typeof advanceRewardProgress;",
    "  advanceRewardProgress,\n",
    "deps.advanceRewardProgress(",
    "counted = result.counted;",
  ]) {
    if (!src.includes(needle)) out.push(`missing ${JSON.stringify(needle)}`);
  }
  const all = src.indexOf("Promise.allSettled([");
  const end = all === -1 ? -1 : src.indexOf("]);", all);
  const wave = all === -1 || end === -1 ? "" : src.slice(all, end);
  if (!wave.includes("advanceProgress(),")) out.push("advanceProgress() is not a member of the allSettled wave");
  if (!/stepped\.status === "fulfilled" && stepped\.value/.test(src)) out.push("customersTouched ignores the progress result");
  return out;
}

function createWiringViolations(src: string): string[] {
  const out: string[] = [];
  for (const needle of [
    'import { advanceRewardProgress } from "@/lib/reward-progress";',
    "advanceRewardProgress: typeof advanceRewardProgress;",
    "  advanceRewardProgress,\n",
    'const ORDER_STATUS_COMPLETED = "Completed";',
  ]) {
    if (!src.includes(needle)) out.push(`missing ${JSON.stringify(needle)}`);
  }
  const gate = src.indexOf("if (landed.status !== ORDER_STATUS_COMPLETED || !customerId) return;");
  const call = src.indexOf("deps.advanceRewardProgress(");
  if (gate === -1) out.push("the Completed + customerId gate is missing or reshaped");
  if (call === -1) out.push("deps.advanceRewardProgress( is not called");
  if (gate !== -1 && call !== -1 && gate > call) out.push("the gate must come BEFORE the progress call");
  const all = src.indexOf("Promise.allSettled([");
  const end = all === -1 ? -1 : src.indexOf("]);", all);
  const wave = all === -1 || end === -1 ? "" : src.slice(all, end);
  if (!wave.includes("advanceProgress(),")) out.push("advanceProgress() is not a member of the allSettled wave");
  return out;
}

test("PIN: the settle follow-ups run the progress step inside the allSettled wave and count it toward customersTouched", () => {
  const src = read(SETTLE);
  assert.ok(src.includes("grantStampForSettledOrder: typeof grantStampForSettledOrder;"), "landmark: the real settle follow-ups file");
  assert.deepEqual(settleWiringViolations(src), []);
  assert.ok(settleWiringViolations(src.replace("    advanceProgress(),\n", "")).length > 0, "dropping the wave member flips it");
  assert.ok(settleWiringViolations(src.replace("stepped.value", "false")).length > 0, "ignoring the result flips it");
  assert.ok(settleWiringViolations(src.replace("  advanceRewardProgress,\n", "")).length > 0, "dropping the real dep flips it");
});

test("PIN: the create follow-ups run progress only for a Completed bill with a customer, inside the allSettled wave", () => {
  const src = read(CREATE);
  assert.ok(src.includes("issueBillNumbers: typeof issueBillNumbers;"), "landmark: the real create follow-ups file");
  assert.deepEqual(createWiringViolations(src), []);
  assert.ok(createWiringViolations(src.replace("landed.status !== ORDER_STATUS_COMPLETED", 'landed.status !== "Pending"')).length > 0, "a Pending-based gate flips it");
  assert.ok(createWiringViolations(src.replace(" || !customerId) return;", ") return;")).length > 0, "dropping the customer test flips it");
  assert.ok(createWiringViolations(src.replace("    advanceProgress(),\n", "")).length > 0, "dropping the wave member flips it");
  // The gate sits before the call even when only the order of the two is swapped.
  const gate = "if (landed.status !== ORDER_STATUS_COMPLETED || !customerId) return;";
  const swapped = src.replace(gate, "").replace("deps.advanceRewardProgress(", `${gate}\n      deps.advanceRewardProgress(`);
  assert.deepEqual(createWiringViolations(swapped), [], "landmark: the checker accepts a gate that precedes the call");
  const late = src.replace(gate, "").replace("      if (result.counted)", `      ${gate}\n      if (result.counted)`);
  assert.ok(createWiringViolations(late).length > 0, "a gate AFTER the call flips it");
});

test("PIN: the create route reaches progress only through runCreateFollowUps, handing it the settings and the customer", () => {
  const src = read(ORDERS_ROUTE);
  const call = callAt(src, "runCreateFollowUps", "the create route's follow-up call");
  const arg = topLevelArgs(call.text)[0];
  assert.ok(/\blanded\b/.test(arg) && /\bsettings\b/.test(arg) && /\bcustomerId\b/.test(arg), "landed, settings and customerId are passed");
  assert.equal(src.includes("advanceRewardProgress"), false, "the route never calls progress itself (one wiring point)");
});

// ── 4. PIN set: the anchor rides the same CAS ────────────────────────────────────────────────────────────────────

function pinSetViolations(src: string): string[] {
  const out: string[] = [];
  const claim = src.indexOf("Customer.findOneAndUpdate(");
  if (claim === -1) return ["no Customer.findOneAndUpdate( in the PIN-set route"];
  const call = balanced(src, claim + "Customer.findOneAndUpdate".length);
  const [filter, update] = topLevelArgs(call);
  if (!filter || !filter.includes("pinHash: { $exists: false }")) out.push("the CAS filter lost pinHash: { $exists: false }");
  if (!update || !update.includes("pinHash") || !update.includes("$set")) out.push("the update no longer sets pinHash");
  if (!update || !update.includes("$min: { rewardsAnchorAt: setAt }")) out.push("the SAME update literal does not carry $min: { rewardsAnchorAt: setAt }");
  if (!update || !update.includes("pinSetAt: setAt")) out.push("pinSetAt and the anchor no longer share one `setAt`");
  const decl = src.indexOf("const setAt = new Date();");
  if (decl === -1 || decl > claim) out.push("setAt is not declared before the CAS");
  if (count(src, "$min: { " + ANCHOR_KEY + ":") !== 1) out.push("the anchor $min must appear exactly once in the route");
  if (/Customer\.updateOne\([^)]*rewardsAnchorAt/.test(src)) out.push("the anchor is written by a separate updateOne");
  return out;
}

test("PIN: the PIN-set CAS writes $min { rewardsAnchorAt } in the SAME update literal as pinHash, in one findOneAndUpdate", () => {
  const src = read(PIN_ROUTE);
  assert.ok(src.includes("startDinerSession("), "landmark: the real PIN-set route");
  assert.deepEqual(pinSetViolations(src), []);
  assert.ok(pinSetViolations(src.replace(" $min: { rewardsAnchorAt: setAt },", "")).length > 0, "dropping the $min flips it");
  // Moving the $min into a second write must flip it too.
  const split = src
    .replace(" $min: { rewardsAnchorAt: setAt },", "")
    .replace("await startDinerSession(", "await Customer.updateOne({ mobile }, { $min: { rewardsAnchorAt: setAt } });\n    await startDinerSession(");
  assert.ok(pinSetViolations(split).length > 0, "a separate anchor write flips it");
  assert.ok(pinSetViolations(src.replace("pinSetAt: setAt", "pinSetAt: new Date()")).length > 0, "a different instant for pinSetAt flips it");
});

// ── 5. staff reset: anchor copy first, $unset never names the anchor ─────────────────────────────────────────────

const UNSET_LITERAL = '$unset: { pinHash: "", pinSetAt: "" }';

function resetViolations(src: string): string[] {
  const out: string[] = [];
  if (count(src, UNSET_LITERAL) !== 1) out.push(`the reset $unset literal is not exactly ${UNSET_LITERAL}`);
  for (const block of unsetBlocks(src)) if (block.includes(ANCHOR_KEY)) out.push(`an $unset names the anchor: ${block}`);
  const anchor = src.indexOf("Customer.updateOne(");
  const reset = src.indexOf("Customer.findOneAndUpdate(");
  if (anchor === -1) out.push("the anchor Customer.updateOne( is missing");
  if (reset === -1) out.push("the reset Customer.findOneAndUpdate( is missing");
  if (anchor !== -1 && reset !== -1 && anchor > reset) out.push("the anchor update must come BEFORE the reset");
  if (anchor !== -1) {
    const [filter, pipeline] = topLevelArgs(balanced(src, anchor + "Customer.updateOne".length));
    if (!filter?.includes("rewardsAnchorAt: { $exists: false }") || !filter.includes("pinSetAt: { $exists: true }") || !filter.includes("pinHash: { $exists: true }")) {
      out.push("the anchor filter must be: PIN holder, pinSetAt present, no anchor yet");
    }
    if (pipeline?.replace(/\s+/g, " ") !== '[{ $set: { rewardsAnchorAt: "$pinSetAt" } }]') out.push("the anchor update is not the pinSetAt pipeline copy");
  }
  const revoke = src.indexOf("await revokeDinerSessions(id)");
  if (revoke === -1 || (reset !== -1 && revoke < reset)) out.push("sessions are revoked only AFTER the reset");
  return out;
}

test("PIN: the staff reset copies pinSetAt into the anchor BEFORE its $unset, and the $unset is exactly { pinHash, pinSetAt }", () => {
  const src = read(RESET_ROUTE);
  assert.ok(src.includes("return success({ reset: true });"), "landmark: the real reset route");
  assert.deepEqual(resetViolations(src), []);
  // Vision guards.
  assert.ok(resetViolations(src.replace(UNSET_LITERAL, '$unset: { pinHash: "", pinSetAt: "", rewardsAnchorAt: "" }')).length > 0, "naming the anchor in the $unset flips it");
  assert.ok(resetViolations(src.replace('[{ $set: { rewardsAnchorAt: "$pinSetAt" } }]', "[]")).length > 0, "a changed pipeline flips it");
  const anchorAt = src.indexOf("await Customer.updateOne(");
  const resetAt = src.indexOf("const reset = await Customer.findOneAndUpdate(");
  assert.ok(anchorAt !== -1 && resetAt !== -1 && anchorAt < resetAt, "landmark: the mutation below starts from the right order");
  const anchorBlock = src.slice(anchorAt, resetAt);
  const swapped = src.slice(0, anchorAt) + src.slice(resetAt, src.indexOf("if (!reset)")) + anchorBlock + src.slice(src.indexOf("if (!reset)"));
  assert.ok(resetViolations(swapped).length > 0, "running the anchor copy after the reset flips it");
  assert.ok(resetViolations(src.replace("await Customer.updateOne(", "await Customer.deleteMany(")).length > 0, "removing the anchor updateOne flips it");
});

// ── 6. the sweep: nothing unsets the anchor ──────────────────────────────────────────────────────────────────────

// The operand of every `$unset` in a source text: the braces/brackets/string that follow it.
function unsetBlocks(src: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf("$unset", from);
    if (at === -1) return blocks;
    from = at + "$unset".length;
    let i = from;
    // Skip whitespace, the colon, and the closing quote of a quoted "$unset" key (a quote followed by a colon).
    while (i < src.length && (/[\s:]/.test(src[i]) || ((src[i] === '"' || src[i] === "'") && src[i + 1] === ":"))) i += 1;
    const c = src[i];
    if (c === "{" || c === "[") blocks.push(balanced(src, i));
    else if (c === '"' || c === "'" || c === "`") blocks.push(src.slice(i, src.indexOf(c, i + 1) + 1));
    else blocks.push(src.slice(from, from + 80));
  }
}

function sourceFilesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(CAFE_ROOT, rel));
  return out;
}

test("PIN: no $unset anywhere under app/ or lib/ names rewardsAnchorAt (the anchor survives every reset)", () => {
  const files = [...sourceFilesUnder("app"), ...sourceFilesUnder("lib")];
  assert.ok(files.length > 200, `landmark: the walk saw the real tree (${files.length} files)`);
  let unsets = 0;
  let sawReset = false;
  const offenders: string[] = [];
  for (const file of files) {
    const src = norm(readFileSync(file, "utf8"));
    for (const block of unsetBlocks(src)) {
      unsets += 1;
      if (block.includes(ANCHOR_KEY)) offenders.push(`${path.relative(CAFE_ROOT, file)}: ${block}`);
    }
    if (file.endsWith(path.join("diner-pin", "route.ts")) && src.includes(UNSET_LITERAL)) sawReset = true;
  }
  assert.ok(unsets >= 1 && sawReset, `landmark: the sweep reached the reset route's $unset (${unsets} $unset blocks seen)`);
  assert.deepEqual(offenders, []);
  // Vision guards on the scanner itself: each shape of $unset operand is read.
  assert.ok(unsetBlocks('x({ $unset: { a: "", rewardsAnchorAt: "" } })')[0].includes(ANCHOR_KEY), "an object operand is read");
  assert.ok(unsetBlocks('x([{ $unset: ["rewardsAnchorAt"] }])')[0].includes(ANCHOR_KEY), "an array operand is read");
  assert.ok(unsetBlocks('x([{ $unset: "rewardsAnchorAt" }])')[0].includes(ANCHOR_KEY), "a string operand is read");
  assert.equal(unsetBlocks('x({ $set: { rewardsAnchorAt: 1 } })').length, 0, "a $set is not an $unset");
});

// ── 7. the stamp switch ──────────────────────────────────────────────────────────────────────────────────────────

function stampSwitchViolations(src: string): string[] {
  const out: string[] = [];
  const off = src.indexOf('if (!dinerLoyaltyOn(settings)) return { granted: false, reason: "loyalty-off" };');
  const levels = src.indexOf('if (rewardLevelsChosen(settings)) return { granted: false, reason: "levels-on" };');
  const read = src.indexOf("Customer.findById(customerId)");
  const write = src.indexOf("Customer.updateOne(");
  if (off === -1) out.push("the loyalty-off check is missing or reshaped");
  if (levels === -1) out.push("the levels-on check is missing or reshaped");
  if (read === -1 || write === -1) out.push("the Customer read/write landmarks are missing");
  if (off !== -1 && levels !== -1 && levels < off) out.push("levels-on must come AFTER loyalty-off");
  if (levels !== -1 && read !== -1 && levels > read) out.push("levels-on must come BEFORE the Customer read");
  if (!src.includes('"levels-on"')) out.push('the result type no longer names "levels-on"');
  if (!src.includes('import { rewardLevelsChosen } from "@/lib/reward-levels-config";')) out.push("rewardLevelsChosen is not imported from the config module");
  return out;
}

test("PIN: grantStampForSettledOrder returns levels-on right after loyalty-off and before any Customer read", () => {
  const src = read(STAMP);
  assert.ok(src.includes("export async function grantStampForSettledOrder("), "landmark: the real stamp grant file");
  assert.deepEqual(stampSwitchViolations(src), []);
  const check = 'if (rewardLevelsChosen(settings)) return { granted: false, reason: "levels-on" };';
  assert.ok(stampSwitchViolations(src.replace(check, "")).length > 0, "removing the check flips it");
  const late = src.replace(check, "").replace("const nextCount =", `${check}\n  const nextCount =`);
  assert.ok(stampSwitchViolations(late).length > 0, "a check AFTER the read flips it");
  assert.ok(stampSwitchViolations(src.replace("rewardLevelsChosen(settings)", "rewardLevelsEarning(settings)")).length > 0, "the OWNER's-mode predicate is pinned (not the blocked-aware one)");
});
