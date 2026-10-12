import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { REWARD_LEVELS_LAUNCHED } from "@pos/shared/reward-levels";
import { rewardLevelsSwitchOnRefusal } from "@/lib/reward-levels-config";
import { BLOCKED_PLATFORM, BLOCKED_TN } from "@/lib/reward-levels-copy";
import { stripComments } from "./source-pin-utils";

// CB-7 S5 unlock: (1) the pure off -> on refusal's truth table, (2) source pins that the PUT calls it BEFORE the write,
// that the editor switch locks only the off -> on direction, and that the stamp-card section tells the owner when
// levels are on. Every source pin runs on the real text AND on a mutated copy it must reject.

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

const ON = { v: 1, enabled: true, levels: [] };
const OFF = { v: 1, enabled: false, levels: [] };
const FREE = { envFlag: undefined, gstNumber: "27ABCDE1234F1Z5" };
const TN = { envFlag: undefined, gstNumber: "33ABCDE1234F1Z5" };
const FLAG = { envFlag: "true", gstNumber: "27ABCDE1234F1Z5" };
const BOTH = { envFlag: "1", gstNumber: "33ABCDE1234F1Z5" };

test("landmark: the feature is launched, so the refusal below is the only thing between a blocked cafe and the switch", () => {
  assert.equal(REWARD_LEVELS_LAUNCHED, true);
});

test("switch-on refusal: an off -> on flip is refused for a Tamil Nadu GSTIN and for the platform flag, with the matching copy", () => {
  for (const stored of [undefined, null, OFF, { v: 1 }, "junk", [OFF]]) {
    assert.equal(rewardLevelsSwitchOnRefusal(ON, stored, TN), BLOCKED_TN, `TN / ${JSON.stringify(stored)}`);
    assert.equal(rewardLevelsSwitchOnRefusal(ON, stored, FLAG), BLOCKED_PLATFORM, `flag / ${JSON.stringify(stored)}`);
    assert.equal(rewardLevelsSwitchOnRefusal(ON, stored, BOTH), BLOCKED_TN, `both -> the GSTIN copy / ${JSON.stringify(stored)}`);
    assert.equal(rewardLevelsSwitchOnRefusal(ON, stored, FREE), null, `not blocked / ${JSON.stringify(stored)}`);
  }
});

test("switch-on refusal: turning OFF, clearing, an absent blob and re-saving an already-on blob are never refused", () => {
  for (const block of [TN, FLAG, BOTH]) {
    assert.equal(rewardLevelsSwitchOnRefusal(OFF, ON, block), null, "turning off");
    assert.equal(rewardLevelsSwitchOnRefusal(OFF, OFF, block), null, "saving a draft");
    assert.equal(rewardLevelsSwitchOnRefusal(null, ON, block), null, "clearing");
    assert.equal(rewardLevelsSwitchOnRefusal(undefined, ON, block), null, "blob absent from the PUT");
    assert.equal(rewardLevelsSwitchOnRefusal(ON, ON, block), null, "re-saving an already-on blob keeps working");
  }
});

test("switch-on refusal: the env flag fails closed like the engine, a blank or 'off' flag does not block, and the GSTIN is read trimmed", () => {
  for (const envFlag of ["", "  ", "off", "false", "0", null, undefined]) {
    assert.equal(rewardLevelsSwitchOnRefusal(ON, OFF, { envFlag, gstNumber: "" }), null, `flag ${JSON.stringify(envFlag)}`);
  }
  assert.equal(rewardLevelsSwitchOnRefusal(ON, OFF, { envFlag: "yes", gstNumber: undefined }), BLOCKED_PLATFORM);
  assert.equal(rewardLevelsSwitchOnRefusal(ON, OFF, { envFlag: undefined, gstNumber: " 33abcde1234f1z5" }), BLOCKED_TN);
  assert.equal(rewardLevelsSwitchOnRefusal(ON, OFF, { envFlag: undefined, gstNumber: "" }), null, "no GSTIN, no flag: allowed");
});

test("switch-on refusal: the copy is plain English (no code words)", () => {
  for (const copy of [BLOCKED_TN, BLOCKED_PLATFORM]) assert.ok(!/\b(409|PUT|enabled|rewardLevels|env)\b/.test(copy), copy);
});

type Pin = (src: string) => boolean;
function pinned(label: string, src: string, pin: Pin, ...mutations: Array<(s: string) => string>): void {
  assert.ok(pin(src), `${label}: holds on the real source`);
  mutations.forEach((mutate, i) => {
    const mutated = mutate(src);
    assert.notEqual(mutated, src, `${label}: mutation ${i} changes the text`);
    assert.ok(!pin(mutated), `${label}: mutation ${i} is caught`);
  });
}

const ROUTE = "app/api/settings/route.ts";
const CALL = "rewardLevelsSwitchOnRefusal(";

test("PIN: the settings PUT refuses the flip (409) BEFORE the write, from a fresh stored read and the post-save GSTIN", () => {
  const put = (s: string): string => s.slice(s.indexOf("export async function PUT"));
  const pin: Pin = (s) => {
    const body = put(s);
    const call = body.indexOf(CALL);
    const write = body.indexOf("Settings.findOneAndUpdate(");
    const fresh = body.indexOf('Settings.findOne({}).select("rewardLevels gstNumber").lean()');
    return call > 0 && write > call && fresh > 0 && fresh < call &&
      /refusal !== null\) return failure\(refusal, 409\)/.test(body) &&
      body.includes("gstNumber: parsed.data.gstNumber ?? stored?.gstNumber") &&
      body.includes("envFlag: process.env[SCRATCH_BLOCK_ENV_VAR]") &&
      body.includes("parsed.data.rewardLevels?.enabled === true");
  };
  pinned(
    "settings route",
    code(ROUTE),
    pin,
    (s) => s.replace(CALL, "noRefusal("),
    (s) => s.replace("return failure(refusal, 409)", "return failure(refusal, 400)"),
    (s) => s.replace("parsed.data.gstNumber ?? stored?.gstNumber", "stored?.gstNumber"),
    (s) => s.replace('.select("rewardLevels gstNumber").lean()', ".lean()"),
    (s) => s.replace("const refusal =", "const wrote = await Settings.findOneAndUpdate({}, {}); const refusal ="),
    (s) => s.replace("process.env[SCRATCH_BLOCK_ENV_VAR]", "process.env.OTHER_VAR"),
  );
  assert.ok(code(ROUTE).split(CALL).length === 2, "landmark: exactly one call site");
});

test("PIN: the editor switch is disabled while the lock holds OR scratch cards are blocked and the switch is off; OFF stays open", () => {
  const rel = "components/settings/rewards/RewardLevelsSection.tsx";
  const pin: Pin = (s) => {
    const row = /<ToggleRow[\s\S]*?\/>/.exec(s)?.[0] ?? "";
    return row.includes("disabled={!switchable || (blockedText !== null && !switchChecked)}") && s.includes("const switchChecked = switchable && cfg?.enabled === true;");
  };
  pinned(
    "editor switch",
    code(rel),
    pin,
    (s) => s.replace("(blockedText !== null && !switchChecked)", "blockedText !== null"),
    (s) => s.replace("(blockedText !== null && !switchChecked)", "(blockedText === null && !switchChecked)"),
    (s) => s.replace("disabled={!switchable || ", "disabled={"),
    (s) => s.replace("blockedText !== null && !switchChecked", "blockedText !== null && switchChecked"),
  );
});

test("PIN: Stamp card shows one plain note when levels are on, fed from the SAVED flag the stamp gate reads", () => {
  const card = code("components/settings/LoyaltyCard.tsx");
  const cardPin: Pin = (s) =>
    /levelsChosen: boolean;/.test(s) &&
    /\{levelsChosen && \(\s*<p className=\{REWARD_NOTE_CLASS\} role="status">\s*\{LEVELS_ON_NOTE\}\s*<\/p>\s*\)\}/.test(s) &&
    s.indexOf("{levelsChosen &&") > s.indexOf('title="Stamp card"') &&
    s.indexOf("{levelsChosen &&") < s.indexOf('name="loyaltyEnabled"') &&
    s.includes("Scratch-card levels are on, so diners stop earning stamps. Stamps and codes they already hold can still be used.");
  pinned(
    "LoyaltyCard note",
    card,
    cardPin,
    (s) => s.replace("{levelsChosen && (", "{!levelsChosen && ("),
    (s) => s.replace("{LEVELS_ON_NOTE}", "{null}"),
    (s) => s.replace("diners stop earning stamps", "diners keep earning stamps"),
    (s) => s.replace("{levelsChosen && (", "{levelsChosen || ("),
  );
  assert.ok(!/setValue|onChange=\{\(\) =>|loyaltyEnabled.*false/.test(card.slice(card.indexOf("{levelsChosen &&"), card.indexOf("</p>", card.indexOf("{levelsChosen &&")))), "the note flips no setting");
  const page = code("app/(dashboard)/settings/loyalty/page.tsx");
  const pagePin: Pin = (s) =>
    /<LoyaltyCard\b[^>]*levelsChosen=\{rewardLevelsChosenRaw\(settings\.rewardLevels\)\}/.test(s) &&
    /import \{ rewardLevelsChosenRaw \} from "@pos\/shared\/schemas\/reward-levels-read\.schema";/.test(s);
  pinned(
    "loyalty page prop",
    page,
    pagePin,
    (s) => s.replace("levelsChosen={rewardLevelsChosenRaw(settings.rewardLevels)}", "levelsChosen={true}"),
    (s) => s.replace("rewardLevelsChosenRaw(settings.rewardLevels)", "levels.draft?.enabled === true"),
    (s) => s.replace('from "@pos/shared/schemas/reward-levels-read.schema"', 'from "x"'),
  );
  assert.ok(card.split("\n").length <= 300, "LoyaltyCard stays within the line cap");
});
