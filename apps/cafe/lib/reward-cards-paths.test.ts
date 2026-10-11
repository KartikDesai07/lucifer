import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// CB-7 S4 Slice D2: source pins for the diner scratch-card surface (routes, libs, rewards/ components, shell wiring).
// Every pin is a predicate over comment-stripped source, run on the real file AND on an in-memory mutated copy it must
// reject (never on disk). Negatives carry a positive landmark. Needles that would match this file's own text are built
// by concatenation.

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

const CARDS_ROUTE = "app/api/public/diner/cards/route.ts";
const SCRATCH_ROUTE = "app/api/public/diner/cards/[id]/scratch/route.ts";
const RW = "components/public/rewards";
const SHELL = "components/public/PublicDinerShell.tsx";
const HOME = "components/public/PublicHomeTab.tsx";
const SHEET = `${RW}/PublicScratchSheet.tsx`;
const HOOK = `${RW}/use-diner-cards.ts`;

type Pin = (src: string) => boolean;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pinned(label: string, src: string, pin: Pin, ...mutations: Array<(s: string) => string>): void {
  assert.ok(pin(src), `${label}: holds on the real source`);
  mutations.forEach((mutate, i) => {
    const mutated = mutate(src);
    assert.notEqual(mutated, src, `${label}: mutation ${i} changes the text`);
    assert.ok(!pin(mutated), `${label}: mutation ${i} is caught`);
  });
}

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

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}
const SURFACE = ["app", "lib", "components", "hooks"].flatMap((d) => walk(path.join(CAFE, d))).map((f) => path.relative(CAFE, f).split(path.sep).join("/"));
const REWARD_FILES = SURFACE.filter((f) => f.startsWith(`${RW}/`));
const REWARD_TSX = REWARD_FILES.filter((f) => f.endsWith(".tsx"));
const inOrder = (s: string, needles: string[]): boolean => needles.every((n, i) => s.indexOf(n) >= 0 && (i === 0 || s.indexOf(n) > s.indexOf(needles[i - 1] as string)));
// A function body from its signature to the first closing brace at the given indent.
const bodyOf = (s: string, sig: string, indent: string): string => {
  const at = s.indexOf(sig);
  const end = s.indexOf(`\n${indent}}\n`, at);
  return at < 0 || end < 0 ? "" : s.slice(at, end);
};

// A response built outside noStoreDiner, then returned through the `return res` exemption below.
const resAssigned = (s: string): string => s.replace("return noStoreDiner(success", "const res = success(1); return res; void noStoreDiner(success");
// The same, with a type annotation on the declaration.
const resAssignedTyped = (s: string): string => s.replace("return noStoreDiner(success", "const res: Response = success(1); return res; void noStoreDiner(success");

test("PIN: both routes are force-dynamic, every return is noStoreDiner, the chain runs in order, the bucket takes the token, no error.message", () => {
  const routes: Array<[string, string[], string, string]> = [
    [CARDS_ROUTE, ["connectDB(", "hitRateLimit(", "readDinerSession(", "readDinerCards("], "dinerCardsBucket(token)", "dinerScratchBucket(token)"],
    [SCRATCH_ROUTE, ["REWARD_CARD_ID_RE.test(", "connectDB(", "hitRateLimit(", "readDinerSession(", "scratchRewardCard("], "dinerScratchBucket(token)", "dinerCardsBucket(token)"],
  ];
  assert.ok(SURFACE.includes(CARDS_ROUTE) && SURFACE.includes(SCRATCH_ROUTE), "landmark: both routes exist");
  for (const [rel, chain, bucket, wrong] of routes) {
    const pin: Pin = (s) => {
      const returns = s.match(/\breturn\b[^;\n]*/g) ?? [];
      // `return res` is exempt only because EVERY `res =` assignment in the file is `const res = noStoreDiner(`.
      const assigned = (s.match(/\bres\s*(?::[^=;]+)?=(?![=>])/g) ?? []).length;
      const viaNoStore = (s.match(/const res = noStoreDiner\(/g) ?? []).length;
      const stray = returns.filter((r) => !r.startsWith("return noStoreDiner(") && !(r === "return res" && viaNoStore >= 1 && assigned === viaNoStore));
      return /export const dynamic = "force-dynamic"/.test(s) && returns.length >= 6 && stray.length === 0 && inOrder(s, chain) && s.includes(bucket) && !/error\.message/.test(s);
    };
    // Mutation: swap the first two chain steps' call sites, so the ordering pin must notice.
    const swapped = (s: string): string => s.replace(chain[0] as string, "@@A@@").replace(chain[1] as string, chain[0] as string).replace("@@A@@", chain[1] as string);
    pinned(rel, code(rel), pin, (s) => s.replace('"force-dynamic"', '"auto"'), (s) => s.replace("return noStoreDiner(success", "return Response.json(success"), swapped, (s) => s.replace(bucket, wrong), (s) => `${s}\nconst m = error.message;`, resAssigned, resAssignedTyped);
  }
});

test("PIN: the +rewardCards projection lives only in lib/reward-cards-read.ts and lib/reward-card-scratch.ts", () => {
  const needle = "+reward" + "Cards";
  const holders = (files: string[], src: (f: string) => string): string[] => files.filter((f) => src(f).includes(needle)).sort();
  assert.ok(SURFACE.length > 200, `landmark: the walk saw the whole app (${SURFACE.length} files)`);
  assert.deepEqual(holders(SURFACE, code), ["lib/reward-card-scratch.ts", "lib/reward-cards-read.ts"]);
  assert.deepEqual(holders([...SURFACE, "x.ts"], (f) => (f === "x.ts" ? needle : code(f))), ["lib/reward-card-scratch.ts", "lib/reward-cards-read.ts", "x.ts"], "mutation: a third holder is caught");
});

test("PIN: scratchFilter matches on _id, a ready card and scratchBy $gte now", () => {
  const pin: Pin = (s) => {
    const fn = bodyOf(s, "export function scratchFilter(", "");
    return fn.includes("_id:") && fn.includes('status: "ready"') && fn.includes("$gte") && !fn.includes("$gt:");
  };
  pinned("scratchFilter", code("lib/reward-card-scratch.ts"), pin, (s) => s.replace("$gte", "$gt"), (s) => s.replace('status: "ready"', 'status: "other"'), (s) => s.replace("_id: customerId,", ""));
});

test("PIN: ScratchCanvas is loaded only through next/dynamic with ssr: false", () => {
  const importers = SURFACE.filter((f) => f.endsWith(".tsx") && /ScratchCanvas"/.test(code(f)));
  assert.deepEqual(importers, [SHEET], "only the sheet references the canvas module");
  // The .catch fallback keeps a failed chunk (offline after the page loaded) from throwing to the error page.
  const pin: Pin = (s) =>
    /dynamic\(\s*\(\) => import\("@\/components\/public\/rewards\/ScratchCanvas"\)\.catch\(\(\) => \(\{ default: StaticFoil \}\)\),\s*\{ ssr: false \},?\s*\)/.test(s) &&
    !/import \w+ from "@\/components\/public\/rewards\/ScratchCanvas"/.test(s);
  pinned(
    "sheet",
    code(SHEET),
    pin,
    (s) => s.replace("ssr: false", "ssr: true"),
    (s) => `import ScratchCanvas from "@/components/public/rewards/ScratchCanvas";\n${s}`,
    (s) => s.replace(".catch(() => ({ default: StaticFoil }))", ""),
  );
});

test("PIN: the scratch sheet reads the outcome only from its own scratch mutation, never the wallet cache", () => {
  const forbidden = ["useDiner" + "Cards(", "getQuery" + "Data", "useQuery" + "Client", "queryClient" + ".", "useQuery" + "(", "useMutation" + "State"];
  const pin: Pin = (s) => s.includes("scratch.data") && /"outcome" in answered/.test(s) && forbidden.every((n) => !s.includes(n));
  pinned("sheet", code(SHEET), pin, ...forbidden.map((n) => (s: string) => `${s}\nconst x = ${n};`), (s) => s.replace("scratch.data", "scratch.dat"));
});

test("PIN: PublicLevelsTab renders every wallet part from the frozen-or-live view, and a 401 on the load shows sign-in with no retry", () => {
  const tab = `${RW}/PublicLevelsTab.tsx`;
  const pin: Pin = (s) =>
    s.includes("const view = frozen ?? query.data;") &&
    (s.match(/\bquery\.data\b/g) ?? []).length === 2 &&
    s.includes("setFrozen(open ? (query.data ?? null) : null)") &&
    s.includes("pointsBalance={view.pointsBalance}") &&
    (s.match(/onSheetChange=\{onSheetChange\}/g) ?? []).length === 2 &&
    (s.match(/part="history"/g) ?? []).length === 2 &&
    s.includes("cardsLoadErrorCopy(query.error)") &&
    s.includes("cardsLoadCanRetry(query.error)") &&
    !s.includes("CARDS_LOAD_FAILED");
  pinned(
    "levels tab",
    code(tab),
    pin,
    (s) => s.replace("frozen ?? query.data", "query.data"),
    (s) => s.replace("pointsBalance={view.pointsBalance}", "pointsBalance={query.data.pointsBalance}"),
    (s) => s.replace("cards={view.cards} earning={view.earning} identity={identity} part=\"history\"", "cards={query.data.cards} earning={view.earning} identity={identity} part=\"history\""),
    (s) => s.replace(" onSheetChange={onSheetChange}", ""),
    (s) => s.replace("{cardsLoadErrorCopy(query.error)}", "{CARDS_LOAD_FAILED}"),
    (s) => s.replace("cardsLoadCanRetry(query.error) && ", ""),
  );
  const wallet = code(`${RW}/PublicCardWallet.tsx`);
  pinned("wallet", wallet, (s) => /onSheetChange\?\.\(open\)/.test(s) && s.includes("onOpenChange={changeSheet}") && s.includes("changeSheet(true)"), (s) => s.replace("onSheetChange?.(open);", ""), (s) => s.replace("changeSheet(true)", "setSheetOpen(true)"));
});

test("PIN: Tap to reveal is disabled after a 401 (it could only re-send forever) and stays an unconditional button", () => {
  const pin: Pin = (s) => /disabled=\{scratch\.isPending \|\| shown !== null \|\| \(scratch\.isError && !canRetry\)\}/.test(s) && /canRetry = scratchCanRetry\(/.test(s) && s.includes("Tap to reveal");
  pinned("sheet", code(SHEET), pin, (s) => s.replace(" || (scratch.isError && !canRetry)", ""), (s) => s.replace("scratchCanRetry(", "(() => true)("));
});

test("PIN: canvas-confetti is imported lazily exactly once, in the file that sets disableForReducedMotion: true", () => {
  const spec = "canvas" + "-confetti";
  assert.deepEqual(SURFACE.filter((f) => code(f).includes(`import("${spec}")`)), [SHEET]);
  assert.equal(SURFACE.filter((f) => new RegExp(`from "${spec}"`).test(code(f))).length, 0, "no static import anywhere");
  // The /m CSP has no worker-src, and the library's default instance is hard-wired to a blob Worker: the burst must
  // come from our own `create(...)` instance with `useWorker: false`, and the default instance is never called.
  const pin: Pin = (s) =>
    (s.match(new RegExp(`import\\("${spec}"\\)`, "g")) ?? []).length === 1 &&
    (s.match(/disableForReducedMotion: true/g) ?? []).length === 2 &&
    /mod\.create\(undefined, \{[^}]*useWorker: false[^}]*\}\)/.test(s) &&
    !/mod\.default\(/.test(s) &&
    !/useWorker: true/.test(s) &&
    !new RegExp(`from "${spec}"`).test(s);
  pinned(
    "sheet",
    code(SHEET),
    pin,
    (s) => s.split("disableForReducedMotion: true").join("disableForReducedMotion: false"),
    (s) => s.replace("disableForReducedMotion: true", "disableForReducedMotion: false"),
    (s) => `import confetti from "${spec}";\n${s}`,
    (s) => `${s}\nvoid import("${spec}");`,
    (s) => s.replace("useWorker: false", "useWorker: true"),
    (s) => s.replace("mod.create(undefined, ", "mod.default("),
    (s) => `${s}\nvoid mod.default({});`,
  );
});

test("PIN: the client never picks a card outcome, no RNG anywhere in components/public/rewards/**", () => {
  const needles = ["Math" + ".random", "reward" + "-rng", "crypto" + "Rng", "getRandom" + "Values", "random" + "Int"];
  assert.ok(REWARD_FILES.length >= 10, `landmark: the whole rewards/ set is covered (${REWARD_FILES.length} files)`);
  for (const rel of REWARD_FILES) {
    pinned(rel, code(rel), (s) => /\bexport\b/.test(s) && needles.every((n) => !s.includes(n)), ...needles.map((n) => (s: string) => `${s}\nconst r = ${n};`));
  }
});

test("PIN: touch-none sits only on the aria-hidden <canvas, the sheet announces via aria-live, Tap to reveal is unconditional", () => {
  const canvasPin: Pin = (s) => {
    const all = (s.match(/touch-none/g) ?? []).length;
    const tags = tagsOf(s, "canvas");
    return all >= 1 && tags.length >= 1 && tags.reduce((n, t) => n + (t.match(/touch-none/g) ?? []).length, 0) === all && tags.every((t) => t.includes('aria-hidden="true"'));
  };
  pinned("canvas", code(`${RW}/ScratchCanvas.tsx`), canvasPin, (s) => s.replace('aria-hidden="true"', ""), (s) => `${s}\nconst c = "touch-none";`);
  for (const rel of REWARD_TSX.filter((f) => !f.endsWith("ScratchCanvas.tsx"))) assert.ok(!code(rel).includes("touch-none"), `${rel}: no touch-none outside the canvas`);
  const tapPin: Pin = (s) => {
    const at = s.indexOf("Tap to reveal");
    const open = at < 0 ? -1 : s.lastIndexOf("<Button", at);
    return open >= 0 && !/(&&|\?|:)\s*\(?$/.test(s.slice(0, open).trimEnd()) && /aria-live="polite"/.test(s);
  };
  pinned("sheet", code(SHEET), tapPin, (s) => s.replace("<Button\n          type=\"button\"\n          className={cn(PUB_PILL", "{open && (<Button\n          type=\"button\"\n          className={cn(PUB_PILL"), (s) => s.replace('aria-live="polite"', ""), (s) => s.replace("Tap to reveal", "Reveal"));
});

test("PIN: use-diner-cards keys on the identity, never serves stale, has no optimistic write, and writes the cache only in onSuccess", () => {
  const pin: Pin = (s) => {
    const keyed = (s.match(/queryKey: \[\.\.\.DINER_CARDS_KEY, identity\]/g) ?? []).length;
    const ok = s.indexOf("onSuccess:");
    const err = s.indexOf("onError:");
    const writes = [...s.matchAll(/setQueryData/g)].map((m) => m.index ?? -1);
    return keyed >= 1 && /staleTime: 0/.test(s) && !/onMutate/.test(s) && ok >= 0 && err > ok && writes.length >= 1 && writes.every((w) => w > ok && w < err);
  };
  pinned("hook", code(HOOK), pin, (s) => s.replace("[...DINER_CARDS_KEY, identity]", "DINER_CARDS_KEY"), (s) => s.replace("staleTime: 0", "staleTime: 60000"), (s) => s.replace("mutationFn:", "onMutate: () => undefined,\n    mutationFn:"), (s) => s.replace("onError: (error) => {", "onError: (error) => {\n      queryClient.setQueryData([], null);"));
});

test("PIN: the scratch mutation carries its key and sign-out clears both the wallet queries and the scratch mutations", () => {
  const pin: Pin = (s) =>
    /mutationKey: DINER_SCRATCH_MUTATION_KEY,/.test(s) &&
    /return useCallback\(\(\) => clearDinerCardsCache\(queryClient\), \[queryClient\]\)/.test(s) &&
    bodyOf(s, "export function clearDinerCardsCache(", "").includes("removeQueries(") &&
    bodyOf(s, "export function clearDinerCardsCache(", "").includes("mutations.remove(");
  pinned("hook", code(HOOK), pin, (s) => s.replace("mutationKey: DINER_SCRATCH_MUTATION_KEY,", ""), (s) => s.replace("mutations.remove(", "mutations.keep("), (s) => s.replace("clearDinerCardsCache(queryClient), [", "undefined, ["));
});

test("PIN: signOut() calls clearCards( and the shell takes it from useClearDinerCards()", () => {
  const pin: Pin = (s) => /const clearCards = useClearDinerCards\(\);/.test(s) && bodyOf(s, "async function signOut()", "  ").includes("clearCards(");
  pinned("shell", code(SHELL), pin, (s) => s.replace("    clearCards();\n", ""), (s) => s.replace("    clearCards();\n", "").replace("  function selectTab(", "  const x = () => clearCards();\n  function selectTab("));
});

test("PIN: reachability, pages -> shell -> tabs -> wallet -> sheet, Home -> level glance, config predicates", () => {
  for (const page of ["app/m/page.tsx", "app/m/[token]/page.tsx"]) {
    edge(page, "@/components/public/PublicDinerShell", "<PublicDinerShell");
    pinned(page, code(page), (s) => s.includes("levelsChosen={diner.levelsChosen}") && s.includes("cardsOn={diner.cardsOn}"), (s) => s.replace("cardsOn={diner.cardsOn}", ""), (s) => s.replace("levelsChosen={diner.levelsChosen}", "levelsChosen"));
  }
  edge(SHELL, `@/${RW}/PublicLevelsTab`, "<PublicLevelsTab");
  edge(SHELL, "@/components/public/PublicRewardsTab", "<PublicRewardsTab");
  const gates: Pin = (s) => s.includes("const rewardsTab = loyaltyEnabled || levelsChosen;") && /\(cardsOn \? \(\s*<PublicLevelsTab/.test(s) && !/rewardsTab = [^;]*cardsOn/.test(s);
  pinned("shell gates", code(SHELL), gates, (s) => s.replace("loyaltyEnabled || levelsChosen;", "loyaltyEnabled || cardsOn;"), (s) => s.replace("(cardsOn ? (", "(levelsChosen ? ("));
  const tab = `${RW}/PublicLevelsTab.tsx`;
  for (const [file, usage] of [["PublicLevelHero", "<PublicLevelHero"], ["PublicLevelLadder", "<PublicLevelLadder"], ["PublicCardWallet", "<PublicCardWallet"]] as const) edge(tab, `@/${RW}/${file}`, usage);
  edge(`${RW}/PublicCardWallet.tsx`, `@/${RW}/PublicScratchSheet`, "<PublicScratchSheet");
  edge(HOME, `@/${RW}/PublicLevelGlance`, "<PublicLevelGlance");
  pinned("home", code(HOME), (s) => /\{levelsChosen \? \(\s*<PublicLevelGlance/.test(s) && s.includes("<PublicLoyaltyGlance"), (s) => s.replace("{levelsChosen ? (", "{loyaltyEnabled ? ("));
  const config: Pin = (s) =>
    /levelsChosen: dinerAccountsOn\(settings\) && rewardLevelsChosen\(settings\)/.test(s) &&
    /cardsOn: dinerAccountsOn\(settings\) && rewardLevelsStored\(settings\)/.test(s) &&
    /DINER_FEATURES_OFF[^=]*= \{[^}]*levelsChosen: false,[^}]*cardsOn: false/.test(s);
  pinned("config", code("lib/public-diner-config.ts"), config, (s) => s.replace("rewardLevelsStored(settings)", "true"), (s) => s.replace("levelsChosen: false", "levelsChosen: true"));
});

test("PIN: no fetch( in components/public/rewards/*.tsx (the hook owns every network call)", () => {
  assert.ok(REWARD_TSX.length >= 6, `landmark: the tsx set is covered (${REWARD_TSX.length} files)`);
  for (const rel of REWARD_TSX) pinned(rel, code(rel), (s) => /\bexport\b/.test(s) && !/\bfetch\(/.test(s), (s) => `${s}\nvoid fetch("/x");`);
});

test("PIN: the shell split, useRepeatOrder( and shellHomeView( are called from the shell", () => {
  edge(SHELL, "@/components/public/use-repeat-order", "useRepeatOrder(");
  edge(SHELL, "@/components/public/public-shell-view", "shellHomeView(");
  pinned("shell", code(SHELL), (s) => /useRepeatOrder\(\(\) => \{/.test(s) && /shellHomeView\(orders, snapshot\)/.test(s), (s) => s.replace("useRepeatOrder(", "useRepeat("), (s) => s.replace("shellHomeView(orders", "pick(orders"));
});
