import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// T1.S1 — repro + pins for the shared stripComments idiom. phase-CR2
// §23.6.6 found the OLD per-file regex pair misreads a glob-like `/**`
// INSIDE a line comment as a block-comment opener, then swallows everything
// up to the next real `*/` (PublicMenuItem.tsx: ~4KB of live code including
// the `soldOut` declaration). These pins prove (a) the historic bug on real
// source, and (b)-(k) the new scanner's state-machine contract.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// The OLD idiom, verbatim, per phase-CR2 and every *-paths.test.ts local copy.
const oldStrip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PUBLIC_MENU_ITEM_SRC = "apps/cafe/components/public/PublicMenuItem.tsx";

// ── (a) §23.6.6 repro on real source ─────────────────────────────────────────

test("PIN §23.6.6: PublicMenuItem.tsx still carries the components/public/** line comment that triggers the old blindness", () => {
  const raw = readSrc(PUBLIC_MENU_ITEM_SRC);
  // Vision guard: assert the trigger is present in raw source before relying
  // on either stripper's behaviour around it (a moved/deleted comment would
  // make the next two assertions vacuous passes).
  assert.match(raw, /\/\/.*components\/public\/\*\*/, "expected a line comment mentioning components/public/**");

  // Precondition guard for pin (b): the OLD idiom's blindness repro only
  // proves anything if a real block-comment closer exists SOMEWHERE after
  // the trigger for its naive open to (wrongly) pair with — without one,
  // pin (b)'s "the old idiom deletes const soldOut" assertion could start
  // passing for the wrong reason (or stop meaning anything) silently.
  const triggerIndex = raw.indexOf("components/public/**");
  const closerIndex = raw.indexOf("*/", triggerIndex);
  assert.ok(
    triggerIndex !== -1 && closerIndex > triggerIndex,
    "pin (b)'s old-idiom blindness repro needs a block-comment closer after the trigger — if this moved, re-anchor the repro",
  );
});

test("PIN §23.6.6: the OLD stripComments idiom deletes `const soldOut` after that comment (the historic bug)", () => {
  const raw = readSrc(PUBLIC_MENU_ITEM_SRC);
  const oldOut = oldStrip(raw);
  // Mutation this catches: "fixing" the bug by tweaking the OLD regex instead
  // of replacing it — the whole point is that idiom is retired, not patched.
  assert.ok(!oldOut.includes("const soldOut"), "the old idiom is expected to have blinded const soldOut");
});

test("PIN §23.6.6: the NEW stripComments keeps `const soldOut = !product.available;` intact", () => {
  const raw = readSrc(PUBLIC_MENU_ITEM_SRC);
  const newOut = stripComments(raw);
  assert.ok(
    newOut.includes("const soldOut = !product.available;"),
    "the fixed stripper must not blind code after a /** inside a line comment",
  );
});

// ── (b) `/**` inside a line comment does not open a block ───────────────────

test("(b) /** inside a line comment is not a block-comment opener", () => {
  const input = "// see components/public/** for shapes\nconst x = 1;\n/* real */\nconst y = 2;";
  const out = stripComments(input);
  assert.ok(out.includes("const x = 1;"), "code before the real block comment must survive");
  assert.ok(out.includes("const y = 2;"), "code after the real block comment must survive");
  assert.ok(!out.includes("real"), "the genuine block comment must still be removed");
});

// ── (c) /* inside ' " ` strings survives verbatim ────────────────────────────

test("(c) /* inside a single-quoted, double-quoted, or template string is not a comment opener", () => {
  const input = 'const a = "/* not a comment */"; const b = \'/* also fine */\'; const c = `/* template too */`;';
  const out = stripComments(input);
  assert.equal(out, input, "nothing here is a real comment; output must equal input");
});

// ── (d) // inside a block comment is removed with the block ─────────────────

test("(d) // inside a block comment is dropped along with the whole block", () => {
  const input = "/* has a // inside it */\nconst z = 1;";
  const out = stripComments(input);
  assert.ok(!out.includes("has a"), "block comment content, including its embedded //, must be gone");
  assert.ok(out.includes("const z = 1;"), "code after the block comment must survive");
});

// ── (e) URL string + trailing line comment ───────────────────────────────────

test('(e) a URL string keeps its slashes, a trailing line comment is stripped, newline kept', () => {
  const input = 'const u = "https://x.dev/a"; // note\nconst v = 2;';
  const out = stripComments(input);
  assert.ok(out.includes('const u = "https://x.dev/a";'), "the URL string must survive intact");
  assert.ok(!out.includes("note"), "the trailing line comment must be stripped");
  assert.ok(out.includes("\nconst v = 2;"), "the newline the comment sat on must be preserved");
});

// ── (f) regex literal survives the code-state \ rule ─────────────────────────

test("(f) a regex literal with escaped slashes is left intact", () => {
  const input = "const RE = /https?:\\/\\//;";
  const out = stripComments(input);
  assert.equal(out, input, "the regex literal must be copied verbatim");
});

// ── (g) escaped quotes keep one string, following comment still strips ──────

test("(g) escaped quotes inside a double-quoted string do not close it early, and a trailing comment still strips", () => {
  const input = 'const m = "includes \\"rejected\\") repairs"; // tail';
  const out = stripComments(input);
  assert.ok(
    out.includes('const m = "includes \\"rejected\\") repairs";'),
    "the whole escaped-quote string literal must survive as one piece",
  );
  assert.ok(!out.includes("tail"), "the trailing line comment must be stripped, proving the scanner did not desync");
});

// ── (h) nested template interpolation is state-safe ─────────────────────────

test("(h) a template literal with a nested ternary of templates survives, trailing comment strips", () => {
  const input = "const t = `a ${cond ? `x` : `y`} b`; // done";
  const out = stripComments(input);
  assert.ok(out.includes("const t = `a ${cond ? `x` : `y`} b`;"), "the nested template must be preserved verbatim");
  assert.ok(!out.includes("done"), "the trailing line comment must be stripped");
});

// ── (i) /m-anchor safety: newline survives a stripped line comment ──────────

test("(i) the newline after a stripped line comment keeps /m-anchored regexes working", () => {
  const input = "const a = 1; // x\nconst b = 2;";
  const out = stripComments(input);
  assert.match(out, /^const b/m, "a /m anchor must still find the start of the second line");
});

// ── (j) vision-guard negatives: plain comments really are removed ──────────

test("(j) a plain line comment and a plain block comment are both removed", () => {
  const input = "// prose\nconst k = 1;\n/* block */\nconst l = 2;";
  const out = stripComments(input);
  assert.ok(!out.includes("prose"), "vision guard: the line comment content must be absent");
  assert.ok(!out.includes("block"), "vision guard: the block comment content must be absent");
  assert.ok(out.includes("const k = 1;") && out.includes("const l = 2;"), "surrounding code must survive");
});

// ── (k) JSX contraction: a bare apostrophe does not open a string ──────────

test("(k) a JSX contraction like Don't is not mistaken for a string opener", () => {
  const input = "<p>Don't stop</p>\n// gone\nconst z = 3;";
  const out = stripComments(input);
  assert.ok(out.includes("Don't stop"), "the contraction must survive untouched");
  assert.ok(!out.includes("gone"), "the following line comment must still be stripped");
  assert.ok(out.includes("const z = 3;"), "code after the stripped comment must survive");
});

// ── (l) the lib/export.ts / product-import.ts cascade repro ─────────────────

test('(l) value.replace(/"/g, \'""\') inside a template literal does not desync the scanner; a later block comment still strips', () => {
  // The exact idiom found in lib/export.ts and packages/shared/src/product-import.ts:
  // a regex literal containing a bare `"` (/"/g), immediately followed by a
  // single-quoted string that also contains `"` characters ('""'). Before A2
  // (regex-literal detection), the bounded quote-lookahead misread that bare
  // `"` inside the regex as opening a real string, and the resulting state
  // desync silently swallowed the unrelated block comment below into the
  // "output" (i.e. never recognized it as a comment at all).
  const input = 'const s = `"${value.replace(/"/g, \'""\')}"`;\n/* block */\nconst z = 1;';
  const out = stripComments(input);
  assert.ok(
    out.includes('const s = `"${value.replace(/"/g, \'""\')}"`;'),
    "the whole line, including the regex-in-template idiom, must survive verbatim",
  );
  assert.ok(!out.includes("block"), "the later block comment must still be recognized and stripped");
  assert.ok(out.includes("const z = 1;"), "code after the block comment must survive");
});

// ── (m) CRLF parity ──────────────────────────────────────────────────────────

test("(m) CRLF: a line comment stops at \\r (not just \\n), and both are kept in the output", () => {
  const out = stripComments("a // c\r\nb");
  assert.equal(out, "a \r\nb");
});

// ── (n) division guard: identifier/) before / means division, not regex ─────

test("(n) a / preceded by an identifier or ) is division, not a regex opener", () => {
  const out1 = stripComments("const x = a / b; // note");
  assert.ok(out1.includes("const x = a / b;"), "the division must survive intact");
  assert.ok(!out1.includes("note"), "the trailing line comment must still be stripped");

  const out2 = stripComments("const y = (n)/2 /*XCOMMENT*/;");
  assert.ok(out2.includes("const y = (n)/2"), "the division right after ) must survive intact");
  assert.ok(!out2.includes("XCOMMENT"), "the block comment must still be stripped");
});

// ── (o) regex literal with a character class survives verbatim ─────────────

test("(o) a regex literal containing a [...] character class survives verbatim, trailing comment strips", () => {
  const out = stripComments('const r = /[)"]/g; // tail');
  assert.ok(out.includes('const r = /[)"]/g;'), "the character-class regex must survive verbatim");
  assert.ok(!out.includes("tail"), "the trailing line comment must be stripped");
});

// ── T1.S3 no-copy gate ───────────────────────────────────────────────────────
// Every *-paths.test.ts (and friends) local `stripComments` definition was
// migrated to `import { stripComments } from "@/lib/source-pin-utils"` in
// T1.S3. This walks the whole app for a NEW hand-rolled copy so a future
// file can't silently reintroduce the naive regex this slice retired — it
// blocks BOTH the NAME (a `stripComments` binding) and the OLD IDIOM's own
// regex source text reappearing under some other name.

const CAFE_ROOT = path.join(REPO_ROOT, "apps/cafe");
const GATE_SKIP_DIRS = new Set(["node_modules", ".next"]);
const GATE_CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Deliberately NOT excluding .test.ts here (unlike the S1 pins' own repo
// walk) — a hand-rolled copy could just as easily land in a NEW test file.
const GATE_EXEMPT_REL_PATHS = new Set(["lib/source-pin-utils.ts", "lib/source-pin-utils.test.ts"]);

function walkForGate(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (GATE_SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walkForGate(abs, out);
    } else if (GATE_CODE_FILE_PATTERN.test(entry)) {
      out.push(abs);
    }
  }
}

// Built by concatenation, never as one literal — a literal needle would
// match this very gate's own source line (testing.md's grep-gate rule).
const NEEDLE_CONST_ASSIGN = "stripComments" + " = (";
const NEEDLE_FUNCTION_DECL = "function " + "stripComments";
// A third needle for the old idiom's SOURCE TEXT itself, not just the name —
// so a copy renamed away from `stripComments` still can't sneak back in.
// This is `\*[\s\S]*?\*\/` (the distinguishing body of the old idiom's
// non-greedy block-comment regex, `/\*[\s\S]*?\*\//`), NOT the bare
// `[\s\S]*?` fragment alone — that shorter fragment is a common "match
// across newlines, non-greedy" idiom several UNRELATED regexes in this repo
// already use for other extractions (e.g. customer-privacy-paths.test.ts's
// `<p[^>]*>([\s\S]*?)<\/p>`, print-form.test.ts's onBlur-handler match), so
// it would false-positive on legitimate, unrelated code. The fuller
// `\*[\s\S]*?\*\/` sequence is specific to the old comment-stripper and (per
// a targeted repo grep) appears nowhere else under apps/cafe.
const NEEDLE_OLD_IDIOM_BODY = "\\*[\\s" + "\\S]*?\\*\\/";

test("GATE: no file under apps/cafe hand-rolls a local stripComments definition", () => {
  const files: string[] = [];
  walkForGate(CAFE_ROOT, files);

  const relFiles = files.map((abs) => path.relative(CAFE_ROOT, abs).split(path.sep).join("/"));

  // Vacuous-pass guards: prove the walk actually covered a realistic amount
  // of the app before trusting its "nothing found" verdict.
  assert.ok(relFiles.length >= 100, `expected to walk at least 100 files, walked ${relFiles.length}`);
  assert.ok(
    relFiles.includes("lib/public-surface-paths.test.ts"),
    "the walked set must include lib/public-surface-paths.test.ts (a known migrated file)",
  );

  for (const rel of relFiles) {
    if (GATE_EXEMPT_REL_PATHS.has(rel)) continue;
    const src = readFileSync(path.join(CAFE_ROOT, rel), "utf8");
    assert.ok(!src.includes(NEEDLE_CONST_ASSIGN), `${rel} hand-rolls a local "const stripComments = (" definition`);
    assert.ok(!src.includes(NEEDLE_FUNCTION_DECL), `${rel} hand-rolls a local "function stripComments" definition`);
    assert.ok(
      !src.includes(NEEDLE_OLD_IDIOM_BODY),
      `${rel} contains the OLD idiom's regex source text (\\*[\\s\\S]*?\\*\\/) — the naive block-comment scan this slice retired, even if renamed away from stripComments`,
    );
  }
});
