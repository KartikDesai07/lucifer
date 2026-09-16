// Shared comment-stripping idiom for the many *-paths.test.ts source pins
// that read a raw file and assert on the code that's left after comments are
// removed. Replaces the old per-file regex pair
// `.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")`,
// which misreads a glob-like `/**` INSIDE a line comment as a block-comment
// opener and then swallows everything up to the next real `*/` — see
// phase-CR2-public-ordering.md §23.6.6 (PublicMenuItem.tsx repro).
//
// Single left-to-right character scan, one state at a time: code | a line
// comment | a block comment | a single-quoted string | a double-quoted
// string | a template literal. A template literal carries a stack of frames
// so `${ ... }` interpolations (which drop back into code, including nested
// templates inside them) unwind to the right place on their closing `}`.
//
// Documented limits: `${}` nesting is handled by the frame stack, not by
// counting characters some other way; a line comment keeps whichever line
// terminator (`\r` or `\n`) ends it, a block comment drops every newline
// inside it (matches the old idiom's whitespace behaviour, so line numbers
// in single-line contexts don't shift). Regex-literal detection (below) is a
// bounded heuristic — last-significant-char context, never crossing a `\n` —
// not a full JS lexer; a backslash still always copies itself + the next
// char verbatim as a fallback protection inside code/string/template states.
//
// Known mis-lex classes (T1 close-review, arbitrated: keep documented, no
// code churn — all fail LOUD by RETAINING text, never by blinding a pin, and
// none has a live instance in this repo): (1) `} />` followed by a same-line
// comment — `}` counts as regex context; (2) the quote lookahead reads raw
// text, so a quote inside a same-line comment can act as a closer (e.g.
// JSX `Don't` … `owner's` in one line's comment); (3) a property named like
// a keyword (`x.of / 2 // c`) reads as regex context. If a pin ever reddens
// on one of these shapes, fix HERE (and pin it) — not the pin.
const CODE = 0;
const LINE_COMMENT = 1;
const BLOCK_COMMENT = 2;
const SQUOTE = 3;
const DQUOTE = 4;
const TEMPLATE = 5;

type Frame = { kind: "template" } | { kind: "interp"; depth: number };

// A `'` or `"` in code state only opens a string if an unescaped matching
// closer appears before the next newline — JS strings can't contain a raw
// newline, so this bounded lookahead is how a bare JSX contraction like
// "Don't" survives without desyncing the rest of the scan.
function hasUnescapedCloserBeforeNewline(src: string, start: number, quote: string): boolean {
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === "\n") return false;
    if (c === "\\") { j++; continue; }
    if (c === quote) return true;
  }
  return false;
}

// Regex-vs-division disambiguation. A `/` in code state is a regex
// opener only after a token that can't end an expression: one of the listed
// punctuation marks, start-of-input (nothing but whitespace precedes), or a
// handful of keywords that precede an expression. An identifier/number/`)`/
// `]` before it means division.
const REGEX_CONTEXT_PUNCT = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "{", "}"]);
const REGEX_CONTEXT_KEYWORDS = new Set([
  "return", "typeof", "case", "instanceof", "in", "of", "new", "delete", "void", "yield", "throw", "do", "else",
]);
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

function isRegexContext(out: string): boolean {
  let i = out.length - 1;
  while (i >= 0 && (out[i] === " " || out[i] === "\t" || out[i] === "\n" || out[i] === "\r")) i--;
  if (i < 0) return true; // start of input
  const c = out[i];
  if (IDENTIFIER_CHAR.test(c)) {
    let j = i;
    while (j >= 0 && IDENTIFIER_CHAR.test(out[j])) j--;
    return REGEX_CONTEXT_KEYWORDS.has(out.slice(j + 1, i + 1));
  }
  return REGEX_CONTEXT_PUNCT.has(c);
}

// Scans a candidate regex literal starting at src[start] (the opening `/`).
// Honours `\`-escapes and does not treat `/` as a closer while inside a
// `[...]` character class. Never crosses a `\n` — returns null (meaning
// "not a regex after all, fall back to plain code") if one is hit, or if
// end-of-input is reached, before a valid closing `/` is found.
function scanRegexLiteral(src: string, start: number): number | null {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") return null;
    if (c === "\\") { i += 2; continue; }
    if (c === "[") { inClass = true; i += 1; continue; }
    if (c === "]") { inClass = false; i += 1; continue; }
    if (c === "/" && !inClass) return i + 1;
    i += 1;
  }
  return null;
}

export function stripComments(src: string): string {
  const stack: Frame[] = [];
  let state = CODE;
  let out = "";
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (state === CODE) {
      if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
      if (c === "/" && src[i + 1] === "/") { state = LINE_COMMENT; i += 2; continue; }
      if (c === "/" && src[i + 1] === "*") { state = BLOCK_COMMENT; i += 2; continue; }
      if (c === "/" && isRegexContext(out)) {
        const end = scanRegexLiteral(src, i);
        if (end !== null) { out += src.slice(i, end); i = end; continue; }
      }
      if (c === "`") { stack.push({ kind: "template" }); state = TEMPLATE; out += c; i += 1; continue; }
      if (c === "'" || c === '"') {
        if (hasUnescapedCloserBeforeNewline(src, i + 1, c)) {
          state = c === "'" ? SQUOTE : DQUOTE;
        }
        out += c;
        i += 1;
        continue;
      }
      const top = stack[stack.length - 1];
      if (top && top.kind === "interp" && (c === "{" || c === "}")) {
        if (c === "{") { top.depth += 1; out += c; i += 1; continue; }
        if (top.depth > 0) { top.depth -= 1; out += c; i += 1; continue; }
        stack.pop();
        out += c;
        state = TEMPLATE;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }

    if (state === LINE_COMMENT) {
      if (c === "\n" || c === "\r") { out += c; state = CODE; }
      i += 1;
      continue;
    }

    if (state === BLOCK_COMMENT) {
      if (c === "*" && src[i + 1] === "/") { state = CODE; i += 2; continue; }
      i += 1;
      continue;
    }

    if (state === SQUOTE || state === DQUOTE) {
      const quote = state === SQUOTE ? "'" : '"';
      if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
      out += c;
      if (c === quote) state = CODE;
      i += 1;
      continue;
    }

    // state === TEMPLATE
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if (c === "`") { out += c; stack.pop(); state = CODE; i += 1; continue; }
    if (c === "$" && src[i + 1] === "{") {
      out += "${";
      stack.push({ kind: "interp", depth: 0 });
      state = CODE;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }

  return out;
}
