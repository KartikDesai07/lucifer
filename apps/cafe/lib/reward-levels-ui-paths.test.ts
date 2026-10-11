import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { REWARD_OPTION_KINDS } from "@pos/shared/reward-levels";
import { REWARD_KIND_LABELS } from "./reward-levels-copy";
import { stripComments } from "./source-pin-utils";

// CB-7 S3 Slice D: source pins for the scratch-card editor on /settings/loyalty. Every pin is a predicate over
// comment-stripped source (raw where noted), run on the real file AND on an in-memory mutated copy that it must reject.
// Negatives carry a positive landmark. Needles that would match this file's own text are built by concatenation.

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8");
const code = (rel: string): string => stripComments(raw(rel));

const R = "components/settings/rewards";
const PAGE = "app/(dashboard)/settings/loyalty/page.tsx";
const ROUTE = "app/api/settings/reward-levels/route.ts";
const HOOKS = ["hooks/use-reward-levels-draft.ts", "hooks/use-reward-levels-status.ts"];
const LIBS = ["copy", "form", "edit", "starters"].map((n) => `lib/reward-levels-${n}.ts`);
const PICKERS = ["ProductPicker", "CategoryPicker", "RewardKindSelect"].map((n) => `components/settings/${n}.tsx`);
const REWARD_FILES = readdirSync(path.join(CAFE, R)).sort().map((f) => `${R}/${f}`);
const NEW_FILES = [...REWARD_FILES, ...HOOKS, ...LIBS, ROUTE, ...PICKERS];
const NEW_TESTS = ["form", "starters", "ui-paths"].map((n) => `lib/reward-levels-${n}.test.ts`);
const LINE_CAP = 300;

type Pin = (src: string) => boolean;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The pin holds on the real text, and every mutated copy (text edited in memory, never on disk) is rejected.
function pinned(label: string, src: string, pin: Pin, ...mutations: Array<(s: string) => string>): void {
  assert.ok(pin(src), `${label}: holds on the real source`);
  mutations.forEach((mutate, i) => {
    const mutated = mutate(src);
    assert.notEqual(mutated, src, `${label}: mutation ${i} changes the text`);
    assert.ok(!pin(mutated), `${label}: mutation ${i} is caught`);
  });
}

// An import of `spec` plus a use of `usage`: the two halves of one hop of the reachability chain.
const edgePin = (spec: string, usage: string): Pin => (s) => new RegExp(`from "${esc(spec)}"`).test(s) && s.includes(usage);
function edge(fromRel: string, spec: string, usage: string): void {
  pinned(`${fromRel} -> ${spec}`, code(fromRel), edgePin(spec, usage), (s) => s.replace(`from "${spec}"`, 'from "x"'), (s) => s.split(usage).join("<Gone"));
}

// Opening tags of `<name` (JSX attributes hold braces and arrows, so the end is the first `>` outside braces).
function tagsOf(src: string, name: string): string[] {
  const tags: string[] = [];
  const re = new RegExp(`<${name}(?=[\\s>/])`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    let i = m.index;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      else if (src[i] === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index, i + 1));
  }
  return tags;
}
const untypedButtons = (src: string): string[] => [...tagsOf(src, "Button"), ...tagsOf(src, "button")].filter((t) => !/\stype="button"/.test(t));
const lineCount = (src: string): number => src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
const hasCR = (src: string): boolean => src.includes(String.fromCharCode(13));
const body = (src: string, name: string): string => new RegExp(`const ${name} = \\(\\) => \\{[\\s\\S]*?\\n  \\};`).exec(src)?.[0] ?? "";

test("PIN: the page runs useRewardLevelsDraft, hands the form extra={levels.extra}, and renders RewardLevelsSection third in the one column", () => {
  const pin: Pin = (s) =>
    /const levels = useRewardLevelsDraft\(settings\);/.test(s) &&
    /<SettingsSectionForm\b[^>]*\bextra=\{levels\.extra\}/.test(s) &&
    /<div className="space-y-6">\s*<LoyaltyCard\b[^>]*\/>\s*<LoyaltyStampGrid\b[^>]*\/>\s*<RewardLevelsSection\b[^>]*levels=\{levels\}[^>]*\/>\s*<\/div>/.test(s);
  pinned("page", code(PAGE), pin, (s) => s.replace("extra={levels.extra}", ""), (s) => s.replace("<LoyaltyStampGrid", "<LoyaltyStampGridX").replace(/(<RewardLevelsSection[^>]*\/>)(\s*)(<\/div>)/, "$3$2$1"), (s) => s.replace("useRewardLevelsDraft(settings)", "null"));
  edge(PAGE, "@/hooks/use-reward-levels-draft", "useRewardLevelsDraft(");
  edge(PAGE, `@/${R}/RewardLevelsSection`, "<RewardLevelsSection");
});

test("PIN: reachability chain, Section -> Grid / Starters / status hook, Grid -> StampBox(noun Box) + Sheet, Sheet -> Editor", () => {
  const sec = `${R}/RewardLevelsSection.tsx`;
  edge(sec, `@/${R}/RewardLevelGrid`, "<RewardLevelGrid");
  edge(sec, `@/${R}/RewardStarterButtons`, "<RewardStarterButtons");
  edge(sec, "@/hooks/use-reward-levels-status", "useRewardLevelsStatus()");
  edge(`${R}/RewardLevelGrid.tsx`, "@/components/settings/LoyaltyStampBox", '<LoyaltyStampBox');
  edge(`${R}/RewardLevelGrid.tsx`, `@/${R}/RewardSlotSheet`, "<RewardSlotSheet");
  pinned("Grid noun", code(`${R}/RewardLevelGrid.tsx`), (s) => /<LoyaltyStampBox\b[^>]*\bnoun="Box"/.test(s), (s) => s.replace('noun="Box"', 'noun="Stamp"'), (s) => s.replace('noun="Box"', ""));
  edge(`${R}/RewardSlotSheet.tsx`, `@/${R}/RewardSlotEditor`, "<RewardSlotEditor");
});

test("PIN: reachability chain, Editor -> OptionFields / Ttl / CostPreview and OptionFields -> Range / ProductPicker / CategoryPicker / Limits", () => {
  const ed = `${R}/RewardSlotEditor.tsx`;
  edge(ed, `@/${R}/RewardOptionFields`, "<RewardOptionFields");
  edge(ed, `@/${R}/RewardTtlFields`, "<RewardTtlFields");
  edge(ed, `@/${R}/RewardCostPreview`, "<RewardCostPreview");
  const of = `${R}/RewardOptionFields.tsx`;
  edge(of, `@/${R}/RewardRangeFields`, "<RewardRangeFields");
  edge(of, "@/components/settings/ProductPicker", "<ProductPicker");
  edge(of, "@/components/settings/CategoryPicker", "<CategoryPicker");
  edge(of, `@/${R}/RewardOptionLimits`, "<RewardOptionLimits");
});

test("PIN: MilestoneRewardFields uses ProductPicker and RewardKindSelect; the status hook asks the route path that exists as a GET route", () => {
  const ms = "components/settings/MilestoneRewardFields.tsx";
  edge(ms, "@/components/settings/ProductPicker", "<ProductPicker");
  edge(ms, "@/components/settings/RewardKindSelect", "<RewardKindSelect");
  const url = "/api/settings/reward-levels";
  const hook = code(HOOKS[1] as string);
  pinned("status hook url", hook, (s) => s.includes(`apiGet<RewardLevelsStatus>("${url}")`) && s.includes("data?.scratchBlocked") && /scratchBlocked: boolean;/.test(s), (s) => s.replace(url, "/api/other"), (s) => s.replace("data?.scratchBlocked", "data?.blocked"));
  assert.ok(existsSync(path.join(CAFE, "app", url, "route.ts")), "the route file sits at the hook's URL");
  assert.match(code(ROUTE), /export async function GET\(/, "landmark: the route exports GET");
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

test("PIN: lib/reward-levels-form.ts is the ONLY non-test cafe file that imports the reward-levels WRITE schema", () => {
  const needle = "schemas/reward-levels" + ".schema";
  const files = new Map(walk(CAFE).map((f) => [path.relative(CAFE, f).split(path.sep).join("/"), stripComments(readFileSync(f, "utf8"))]));
  const importers = (m: Map<string, string>): string[] => [...m].filter(([rel, src]) => !rel.endsWith(".test.ts") && src.includes(needle)).map(([rel]) => rel);
  assert.ok(files.size > 200, `landmark: the walk saw the whole app (${files.size} files)`);
  assert.ok(files.get("lib/reward-levels-form.ts")?.includes(needle) === true, "landmark: the form lib imports it");
  assert.deepEqual(importers(files), ["lib/reward-levels-form.ts"]);
  assert.deepEqual(importers(new Map([...files, ["components/x.tsx", `import { a } from "@pos/shared/${needle}";`]])), ["lib/reward-levels-form.ts", "components/x.tsx"], "mutation: a second importer is caught");
});

test("PIN: nothing in rewards/, the two hooks or the four reward-levels libs imports the server-only reward-levels config", () => {
  const needle = "reward-levels" + "-config";
  const files = [...REWARD_FILES, ...HOOKS, ...LIBS];
  assert.ok(REWARD_FILES.length >= 11 && files.length >= 17, `landmark: the whole set is covered (${files.length} files)`);
  assert.ok(files.some((rel) => code(rel).includes('from "@/lib/reward-levels-')), "landmark: the set does import sibling reward-levels libs");
  for (const rel of files) {
    pinned(rel, code(rel), (s) => /\bexport\b/.test(s) && !s.includes(needle), (s) => `${s}\nimport { x } from "@/lib/${needle}";`, (s) => `${s}\nawait import("@/lib/${needle}");`);
  }
  assert.ok(code(ROUTE).includes(needle), "landmark: the route IS where the server-only module is used");
});

test("PIN: rewardLevels is not a form section field (settings-sections / settings-form-defaults), raw source, loyaltyRules landmark", () => {
  const needle = "reward" + "Levels";
  for (const rel of ["lib/settings-sections.ts", "lib/settings-form-defaults.ts"]) {
    pinned(rel, raw(rel), (s) => s.includes("loyaltyRules") && !s.includes(needle), (s) => `${s}\n// ${needle}`, (s) => s.replace("loyaltyRules", `${needle}`));
  }
});

// The shape in source is `const switchable = canSwitchOn(accountsOn)` / `disabled={!switchable}` and `checked={switchChecked}`;
// a direct `disabled={!canSwitchOn(` / `checked={canSwitchOn(` also passes. Only the switch* aliases are expanded.
const switchPin: Pin = (s) => {
  const row = /<ToggleRow[\s\S]*?\/>/.exec(s)?.[0] ?? "";
  const defs = new Map([...s.matchAll(/const (switch\w+) = ([^;]+);/g)].map((m) => [m[1], m[2]]));
  const expand = (e: string): string => e.replace(/\bswitch\w+\b/g, (id) => defs.get(id) ?? id);
  const disabled = /disabled=\{([^}]+)\}/.exec(row)?.[1] ?? "";
  const checked = /checked=\{([^}]+)\}/.exec(row)?.[1] ?? "";
  return expand(expand(disabled)).startsWith("!canSwitchOn(") && /^canSwitchOn\(.*\) && .*enabled === true/.test(expand(expand(checked)));
};

test("PIN: the master switch is disabled unless canSwitchOn and shown on only when canSwitchOn && enabled === true", () => {
  const src = code(`${R}/RewardLevelsSection.tsx`);
  assert.match(src, /<ToggleRow\b[\s\S]*?label=\{SWITCH_LABEL\}/, "landmark: the master switch row");
  pinned("switch", src, switchPin, (s) => s.replace("disabled={!switchable}", "disabled={false}"), (s) => s.replace("checked={switchChecked}", "checked={cfg?.enabled === true}"), (s) => s.replace("const switchable = canSwitchOn(accountsOn);", "const switchable = accountsOn;"), (s) => s.replace("switchable && cfg?.enabled === true", "cfg?.enabled === true"));
  assert.ok(switchPin(src.replace("disabled={!switchable}", "disabled={!canSwitchOn(accountsOn)}")), "the direct spelling also passes");
  assert.match(code("lib/reward-levels-form.ts"), /export function canSwitchOn\(accountsOn: boolean\): boolean \{\s*return LAUNCHED && accountsOn;/, "the lock itself is the launch flag AND sign-in");
});

test("PIN: closing the Sheet never reaches levels.edit; only Add, Done and a confirmed Remove commit", () => {
  const sheet = code(`${R}/RewardSlotSheet.tsx`);
  const sheetPin: Pin = (s) => /onOpenChange=\{\(next\) => \{\s*if \(!next\) onClose\(\);\s*\}\}/.test(s) && !/\.(edit|replace)\(/.test(s);
  pinned("sheet", sheet, sheetPin, (s) => s.replace("if (!next) onClose();", "levels.edit((c) => c); onClose();"), (s) => s.replace("if (!next) onClose();", ""));
  const editorRel = `${R}/RewardSlotEditor.tsx`;
  const ed = code(editorRel);
  const editorPin: Pin = (s) => {
    const rest = s.replace(body(s, "commit"), "").replace(body(s, "remove"), "");
    return body(s, "commit").includes("levels.edit(") && body(s, "remove").includes("levels.edit(") && !rest.includes("levels.edit(") && !rest.includes("levels.replace(") &&
      tagsOf(s, "Button").filter((t) => t.includes("onClick={commit}")).length === 2 && s.includes("onConfirm={remove}") && !/\buseEffect\b/.test(s) &&
      tagsOf(s, "ConfirmDialog").length === 1 && /<Button[^>]*onClick=\{onClose\}[^>]*>\s*Cancel\s*<\/Button>/.test(s);
  };
  pinned("editor", ed, editorPin, (s) => s.replace("onClick={onClose}", "onClick={() => levels.edit((c) => c)}"), (s) => s.replace("onConfirm={remove}", "onConfirm={() => setConfirmOpen(false)}"), (s) => s.replace("onClick={commit}", "onClick={onClose}"), (s) => s.replace("const [confirmOpen", "useEffect(() => levels.edit((c) => c), []); const [confirmOpen"));
  assert.match(code(`${R}/RewardLevelGrid.tsx`), /onClose=\{\(\) => setOpenStep\(null\)\}/, "the grid's close handler only hides the panel");
});

test("PIN: the kind dropdown lists all 8 REWARD_OPTION_KINDS through REWARD_KIND_LABELS (runtime and source)", () => {
  assert.equal(REWARD_OPTION_KINDS.length, 8, "landmark: eight kinds");
  assert.deepEqual([...Object.keys(REWARD_KIND_LABELS)].sort(), [...REWARD_OPTION_KINDS].sort(), "a label per kind, none extra");
  assert.equal(new Set(Object.values(REWARD_KIND_LABELS)).size, 8, "labels are distinct and non-empty");
  const pin: Pin = (s) =>
    /import \{[^}]*\bREWARD_OPTION_KINDS\b[^}]*\} from "@pos\/shared\/reward-levels"/.test(s) &&
    /import \{[^}]*\bREWARD_KIND_LABELS\b[^}]*\} from "@\/lib\/reward-levels-copy"/.test(s) &&
    /\{REWARD_OPTION_KINDS\.map\(\(kind\) => \(\s*<SelectItem key=\{kind\} value=\{kind\}[^>]*>\s*\{REWARD_KIND_LABELS\[kind\]\}/.test(s) &&
    !/<SelectItem[^>]*value="[a-z-]+"/.test(s.split("RANGE_LIMITS")[0] ?? "");
  const src = code(`${R}/RewardOptionFields.tsx`);
  pinned("kind select", src, pin, (s) => s.replace("{REWARD_OPTION_KINDS.map(", "{REWARD_OPTION_KINDS.slice(1).map("), (s) => s.replace("{REWARD_KIND_LABELS[kind]}", "{kind}"), (s) => s.replace("<SelectItem key={kind}", '<SelectItem value="none" key={kind}'));
});

test("PIN: every <Button / <button under components/settings/rewards/ carries type=\"button\" (the section sits inside the settings form)", () => {
  const all = REWARD_FILES.filter((f) => f.endsWith(".tsx")).map((rel) => [rel, code(rel)] as const);
  const total = all.reduce((n, [, s]) => n + tagsOf(s, "Button").length + tagsOf(s, "button").length, 0);
  assert.ok(total >= 15, `landmark: the scanner finds the buttons (${total})`);
  for (const [rel, s] of all) {
    assert.deepEqual(untypedButtons(s), [], `${rel}: no untyped button tag`);
    if (tagsOf(s, "Button").length > 0) {
      assert.ok(untypedButtons(s.replace(' type="button"', "")).length > 0, `${rel}: mutation (type dropped) is caught`);
      assert.ok(untypedButtons(s.replace(' type="button"', ' type="submit"')).length > 0, `${rel}: mutation (submit) is caught`);
    }
  }
});

test("PIN: every new file is at most 300 lines and LF-only", () => {
  const files = [...NEW_FILES, ...NEW_TESTS];
  assert.ok(files.length >= 25, `landmark: the new-file set is whole (${files.length})`);
  for (const rel of files) {
    const src = raw(rel);
    assert.ok(lineCount(src) > 5, `${rel}: landmark, not empty`);
    pinned(rel, src, (s) => lineCount(s) <= LINE_CAP && !hasCR(s), (s) => `${s}${"x\n".repeat(LINE_CAP)}`, (s) => s.replace(/\n/g, "\r\n"));
  }
});

test("PIN: the status route is admin-gated, reads no env, is force-dynamic, and answers with exactly { scratchBlocked }", () => {
  const pin: Pin = (s) => {
    const calls = [...s.matchAll(/\bsuccess\(\{([^}]*)\}\)/g)].map((m) => (m[1] ?? "").trim());
    return /export const dynamic = "force-dynamic";/.test(s) && s.includes("export async function GET()") &&
      /const admin = await requireAdmin\(\);\s*if \("error" in admin\) return admin\.error;/.test(s) && s.indexOf("requireAdmin()") < s.indexOf("connectDB()") &&
      !s.includes("process" + ".env") && calls.length === 1 && calls[0] === "scratchBlocked: scratchCardsBlockedFor(settings)" && s.split("success(").length === 2;
  };
  pinned("route", code(ROUTE), pin, (s) => s.replace("scratchBlocked:", "blocked:"), (s) => s.replace("scratchBlocked: scratchCardsBlockedFor(settings)", "scratchBlocked: scratchCardsBlockedFor(settings), settings"), (s) => s.replace('"force-dynamic"', '"auto"'), (s) => s.replace("if (\"error\" in admin) return admin.error;", ""), (s) => `${s}\nconst k = process${".env"}.X;`, (s) => s.replace("requireAdmin()", "null"));
});

test("PIN: 44 px touch targets the smoke measured short (s89h L10) — the toggle row and the box sheet's close X", () => {
  const toggle = code("components/settings/SettingsFields.tsx");
  const rowOk = (src: string): boolean => /className=\{`flex min-h-10 items-center justify-between gap-4 pointer-coarse:min-h-11 /.test(src);
  assert.equal(rowOk(toggle), true, "every settings ToggleRow is 44 px tall on touch");
  assert.equal(rowOk(toggle.replace(" pointer-coarse:min-h-11 ", " ")), false, "vision guard: dropping it flips the pin");
  const sheet = code("components/settings/rewards/RewardSlotSheet.tsx");
  const closeOk = (src: string): boolean => /<SheetContent className="[^"]*\[&>button\]:size-11[^"]*"/.test(src);
  assert.equal(closeOk(sheet), true, "the box sheet's close X is a 44 px target (the expense sheet's override)");
  assert.equal(closeOk(sheet.replace("[&>button]:size-11", "")), false, "vision guard: dropping it flips the pin");
});
