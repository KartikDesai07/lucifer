import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_TOKEN_ALPHABET,
  PUBLIC_TOKEN_LENGTH,
  PUBLIC_TOKEN_PATTERN,
  PUBLIC_MENU_PATH,
  PUBLIC_API_PREFIX,
  PARCEL_SELECTION,
  PUBLIC_NOTE_MAX_LEN,
  PUBLIC_CODE_LENGTH,
  isPublicToken,
  isPublicCode,
  publicMenuPath,
  publicOrderStatusPath,
  sanitizePublicText,
  effectiveUnitPrice,
  normalizePromoCode,
  resolvePromoDiscount,
  PROMO_INVALID,
  PROMO_INACTIVE,
  PROMO_MIN_SUBTOTAL,
  type PromoCodeConfig,
} from "./public";

// CR2 — the public QR-ordering surface. These pin the two things a public
// identifier and public free text must never get wrong: a token that can be
// guessed or is accepted in a shape we did not mint, and diner text reaching a
// thermal slip or the admin panel with control characters in it.

// ── the table token ─────────────────────────────────────────────────────────

test("the token alphabet excludes every ambiguous character (I, L, O, U) so a sticker can be read by a human", () => {
  for (const banned of ["I", "L", "O", "U"]) {
    assert.ok(
      !PUBLIC_TOKEN_ALPHABET.includes(banned),
      `${banned} must not be in the alphabet — it is unreadable off a printed sticker`,
    );
  }
  // 32 symbols is what makes the length→entropy claim in public.ts true.
  assert.equal(PUBLIC_TOKEN_ALPHABET.length, 32);
  assert.equal(new Set(PUBLIC_TOKEN_ALPHABET).size, 32, "no symbol may repeat");
});

test("the token is long enough to be unguessable for a sticker that lives for years", () => {
  // 14 symbols over 32 = 70 bits. If this ever shrinks, the printed-sticker
  // threat model in public.ts stops holding.
  assert.equal(PUBLIC_TOKEN_LENGTH, 14);
  const bits = PUBLIC_TOKEN_LENGTH * Math.log2(PUBLIC_TOKEN_ALPHABET.length);
  assert.ok(bits >= 64, `token entropy must stay >= 64 bits, got ${bits}`);
});

test("isPublicToken accepts exactly what the alphabet can mint", () => {
  const minted = PUBLIC_TOKEN_ALPHABET.slice(0, PUBLIC_TOKEN_LENGTH);
  assert.equal(minted.length, PUBLIC_TOKEN_LENGTH);
  assert.equal(isPublicToken(minted), true);
  assert.equal(isPublicToken("ZZZZZZZZZZZZZZ"), true);
  assert.equal(isPublicToken("00000000000000"), true);
});

test("isPublicToken rejects every shape we did not mint — this runs BEFORE the value reaches a query", () => {
  const rejected: unknown[] = [
    "",
    "SHORT",
    "TOOLONGTOOLONGTOOLONG",
    "ABCDEFGHJKMNP0".toLowerCase(), // lower case is never minted
    "ABCDEFGHJKMNPI", // I is not in the alphabet
    "ABCDEFGHJKMNPL", // L is not in the alphabet
    "ABCDEFGHJKMNPO", // O is not in the alphabet
    "ABCDEFGHJKMNPU", // U is not in the alphabet
    "ABCDEFGH JKMNP", // a space
    "ABCDEFGHJKMN-P", // a hyphen
    "../../etc/pass",
    "ABCDEFGHJKMNP$",
    "ABCDEFGHJKMNP\n",
    null,
    undefined,
    42,
    {},
    [],
  ];
  for (const value of rejected) {
    assert.equal(
      isPublicToken(value),
      false,
      `${JSON.stringify(value)} must be rejected`,
    );
  }
});

test("the token pattern is anchored at both ends, so no prefix or suffix can ride along", () => {
  assert.equal(PUBLIC_TOKEN_PATTERN.source.startsWith("^"), true);
  assert.equal(PUBLIC_TOKEN_PATTERN.source.endsWith("$"), true);
  assert.equal(isPublicToken("XABCDEFGHJKMNP"), true); // 14 valid chars
  assert.equal(isPublicToken("ABCDEFGHJKMNPQR"), false); // 15 — one too many
});

// ── paths ───────────────────────────────────────────────────────────────────

test("publicMenuPath builds the table URL from a token, and the common URL without one", () => {
  assert.equal(publicMenuPath(), PUBLIC_MENU_PATH);
  assert.equal(publicMenuPath("ABCDEFGHJKMNPQ"), "/m/ABCDEFGHJKMNPQ");
});

test("the public paths are short and carry no tenant slug — one tenant per deployment resolves by host", () => {
  assert.equal(PUBLIC_MENU_PATH, "/m");
  assert.equal(PUBLIC_API_PREFIX, "/api/public");
  // Anything under the API prefix must be nameable in one piece by the
  // middleware matcher, the CSP and a WAF rule.
  assert.ok(PUBLIC_API_PREFIX.startsWith("/api/"));
});

test("the parcel sentinel can never collide with a minted token, so a table lookup cannot be tricked by it", () => {
  assert.equal(isPublicToken(PARCEL_SELECTION), false);
});

// ── free text that reaches paper ────────────────────────────────────────────

test("sanitizePublicText strips control characters — the injection primitive for printer commands, and invisible in the panel", () => {
  // Written as escapes on purpose: a literal control character in source renders
  // invisibly, cannot be matched by an editor, and this repo has been bitten by
  // exactly that before. ESC (0x1B) is the byte that starts an ESC/POS command.
  const ESC = "\u001B";
  const NUL = "\u0000";
  const DEL = "\u007F";
  const BEL = "\u0007";

  // The ESC becomes a space, so the ESC/POS command bytes can never sit flush
  // against the text they were meant to format.
  assert.equal(sanitizePublicText(`no onion${ESC}[1m`), "no onion [1m");
  assert.equal(sanitizePublicText(`a${NUL}b`), "a b");
  assert.equal(sanitizePublicText(`a${DEL}b`), "a b");
  assert.equal(sanitizePublicText(`${BEL}${BEL}ring`), "ring");
  assert.equal(sanitizePublicText(`${ESC}${ESC}${ESC}`), "");

  // Every byte below 0x20, plus DEL, must be gone — checked exhaustively rather
  // than by sampling, so a future rewrite cannot let one slip through.
  for (let code = 0; code < 0x20; code++) {
    const out = sanitizePublicText(`x${String.fromCharCode(code)}y`);
    assert.equal(
      out,
      "x y",
      `0x${code.toString(16)} must not survive (got ${JSON.stringify(out)})`,
    );
  }
  assert.equal(sanitizePublicText(`x${DEL}y`), "x y");
});

test("sanitizePublicText strips bidi-override and zero-width/invisible characters — written as String.fromCharCode, never a literal control/invisible char in source", () => {
  // RLO (U+202E) can visually REVERSE the characters after it on a rendered
  // slip line without changing what characters are actually present — a
  // bidi-hardening gap a bare C0/DEL check would miss entirely. Built via
  // String.fromCharCode (never a literal or a \u escape typed inline) —
  // this repo has been bitten by invisible characters in source before,
  // and this way an editor can always find and re-render the value.
  const RLO = String.fromCharCode(0x202e);
  // ZWSP (U+200B) is invisible in both the panel and on paper, so it would
  // otherwise sail through unnoticed.
  const ZWSP = String.fromCharCode(0x200b);
  assert.equal(sanitizePublicText(`no${RLO}onion`), "no onion");
  assert.equal(sanitizePublicText(`extra${ZWSP}ghee`), "extra ghee");
});

test("sanitizePublicText keeps ordinary text intact, including non-Latin scripts a cafe will really receive", () => {
  assert.equal(sanitizePublicText("less spicy please"), "less spicy please");
  assert.equal(sanitizePublicText("कम मिर्च"), "कम मिर्च");
  assert.equal(sanitizePublicText("no #1 onion & extra ghee!"), "no #1 onion & extra ghee!");
});

test("sanitizePublicText collapses whitespace runs and trims — a diner cannot pad a slip with blank columns", () => {
  assert.equal(sanitizePublicText("   extra    ghee   "), "extra ghee");
  assert.equal(sanitizePublicText("a\tb"), "a b");
  assert.equal(sanitizePublicText("a\nb"), "a b");
  assert.equal(sanitizePublicText("\n\n\n"), "");
  assert.equal(sanitizePublicText("   "), "");
});

test("sanitizePublicText never lengthens its input, so a length cap applied after it still holds", () => {
  for (const input of ["abc", "  a  b  ", "x", "कम मिर्च", ""]) {
    assert.ok(sanitizePublicText(input).length <= input.length);
  }
});

test("the note cap is tight enough for a slip line and is a real number", () => {
  assert.equal(PUBLIC_NOTE_MAX_LEN, 200);
  assert.ok(Number.isInteger(PUBLIC_NOTE_MAX_LEN) && PUBLIC_NOTE_MAX_LEN > 0);
});

// ── pricing ──────────────────────────────────────────────────────────────────

test("effectiveUnitPrice leaves the price unchanged at 0% discount", () => {
  assert.equal(effectiveUnitPrice(150, 0), 150);
});

test("effectiveUnitPrice rounds the discounted amount", () => {
  // 99 * 10% = 9.9 off -> 89.1 -> rounds to 89.
  assert.equal(effectiveUnitPrice(99, 10), 89);
});

test("effectiveUnitPrice floors at 0 and never goes negative", () => {
  assert.equal(effectiveUnitPrice(50, 100), 0);
  assert.equal(effectiveUnitPrice(50, 150), 0);
});

// ── the order-status code ───────────────────────────────────────────────────

test("isPublicCode accepts a 10-char alphabet string and a 14-char token fails it — the two identifiers can never be confused by shape", () => {
  const code = PUBLIC_TOKEN_ALPHABET.slice(0, PUBLIC_CODE_LENGTH);
  assert.equal(code.length, 10);
  assert.equal(isPublicCode(code), true);

  const token = PUBLIC_TOKEN_ALPHABET.slice(0, PUBLIC_TOKEN_LENGTH);
  assert.equal(token.length, 14);
  assert.equal(isPublicCode(token), false);
  assert.equal(isPublicToken(token), true);
});

test("isPublicToken rejects a 10-char code — the converse of the above", () => {
  const code = PUBLIC_TOKEN_ALPHABET.slice(0, PUBLIC_CODE_LENGTH);
  assert.equal(isPublicToken(code), false);
});

test("publicOrderStatusPath encodes the code verbatim into the path", () => {
  const code = PUBLIC_TOKEN_ALPHABET.slice(0, PUBLIC_CODE_LENGTH);
  assert.equal(publicOrderStatusPath(code), `/m/o/${code}`);
});

// ── promo codes (CR2.2c) ─────────────────────────────────────────────────────

test("normalizePromoCode trims and uppercases", () => {
  assert.equal(normalizePromoCode("  save10  "), "SAVE10");
  assert.equal(normalizePromoCode("Save10"), "SAVE10");
  assert.equal(normalizePromoCode("SAVE10"), "SAVE10");
});

const PERCENT_CODE: PromoCodeConfig = { code: "SAVE10", kind: "percent", value: 10, active: true };
const FLAT_CODE: PromoCodeConfig = { code: "FLAT500", kind: "flat", value: 500, active: true };
const INACTIVE_CODE: PromoCodeConfig = { code: "OLDCODE", kind: "flat", value: 50, active: false };
const MIN_SUBTOTAL_CODE: PromoCodeConfig = {
  code: "BIGORDER",
  kind: "flat",
  value: 100,
  minSubtotal: 500,
  active: true,
};
const CODES = [PERCENT_CODE, FLAT_CODE, INACTIVE_CODE, MIN_SUBTOTAL_CODE];

test("resolvePromoDiscount: an unknown code resolves to PROMO_INVALID", () => {
  const r = resolvePromoDiscount(CODES, "NOPE", 1000);
  assert.deepEqual(r, { error: PROMO_INVALID });
});

test("resolvePromoDiscount: an undefined codes array (no promoCodes configured) also resolves to PROMO_INVALID — never a keyed lookup that could throw", () => {
  assert.deepEqual(resolvePromoDiscount(undefined, "SAVE10", 1000), { error: PROMO_INVALID });
});

test("resolvePromoDiscount: an inactive code resolves to PROMO_INACTIVE", () => {
  const r = resolvePromoDiscount(CODES, "oldcode", 1000); // lower-case on the wire, normalized before lookup
  assert.deepEqual(r, { error: PROMO_INACTIVE });
});

test("resolvePromoDiscount: minSubtotal not met resolves to PROMO_MIN_SUBTOTAL with the EXACT shortfall", () => {
  const r = resolvePromoDiscount(CODES, "BIGORDER", 420);
  assert.deepEqual(r, { error: PROMO_MIN_SUBTOTAL(80) }); // 500 - 420 = 80
});

test("resolvePromoDiscount: minSubtotal met exactly (not short) succeeds", () => {
  const r = resolvePromoDiscount(CODES, "BIGORDER", 500);
  assert.deepEqual(r, { discount: 100, code: "BIGORDER" });
});

test("resolvePromoDiscount: percent FLOORS, never rounds up (333 @ 10% = 33, not 33.3 or 34)", () => {
  const r = resolvePromoDiscount(CODES, "SAVE10", 333);
  assert.deepEqual(r, { discount: 33, code: "SAVE10" });
});

test("resolvePromoDiscount: a flat code resolves to its own value, unmodified by the subtotal", () => {
  const r = resolvePromoDiscount(CODES, "FLAT500", 900);
  assert.deepEqual(r, { discount: 500, code: "FLAT500" });
});

test("resolvePromoDiscount: a flat code larger than the subtotal is CLAMPED to the subtotal — a bill can never go negative", () => {
  const r = resolvePromoDiscount(CODES, "FLAT500", 200);
  assert.deepEqual(r, { discount: 200, code: "FLAT500" });
});

test("resolvePromoDiscount: a computed discount of 0 is still a SUCCESS (percent floor on a tiny subtotal)", () => {
  const r = resolvePromoDiscount(CODES, "SAVE10", 5); // floor(5 * 10 / 100) = 0
  assert.deepEqual(r, { discount: 0, code: "SAVE10" });
});

test("resolvePromoDiscount: a code typed lower/mixed case still resolves — normalized before lookup", () => {
  const r = resolvePromoDiscount(CODES, "  save10  ", 100);
  assert.deepEqual(r, { discount: 10, code: "SAVE10" });
});

test("resolvePromoDiscount: prototype-key code (\"CONSTRUCTOR\") resolves to PROMO_INVALID — Array.prototype.find, never a keyed object lookup", () => {
  const r = resolvePromoDiscount(CODES, "constructor", 1000);
  assert.deepEqual(r, { error: PROMO_INVALID });
});

// ── SPEC P4 — per-customer usage cap: oncePerCustomer round-trip ────────────

const ONCE_CODE: PromoCodeConfig = { code: "ONCE10", kind: "percent", value: 10, active: true, oncePerCustomer: true };
const CODES_WITH_ONCE = [...CODES, ONCE_CODE];

test("resolvePromoDiscount: a code configured with oncePerCustomer:true returns oncePerCustomer:true on success", () => {
  const r = resolvePromoDiscount(CODES_WITH_ONCE, "ONCE10", 100);
  assert.deepEqual(r, { discount: 10, code: "ONCE10", oncePerCustomer: true });
});

test("resolvePromoDiscount: a code with no oncePerCustomer flag (absent/false) omits the key entirely on success — never an explicit false", () => {
  const r = resolvePromoDiscount(CODES_WITH_ONCE, "SAVE10", 100);
  assert.deepEqual(r, { discount: 10, code: "SAVE10" });
  assert.ok(!("oncePerCustomer" in r), "oncePerCustomer must be absent, not undefined or false, on a non-flagged code");
});

test("resolvePromoDiscount: oncePerCustomer:false on the config is treated the same as absent — omitted from the result", () => {
  const codes = [{ ...ONCE_CODE, oncePerCustomer: false }];
  const r = resolvePromoDiscount(codes, "ONCE10", 100);
  assert.deepEqual(r, { discount: 10, code: "ONCE10" });
});
