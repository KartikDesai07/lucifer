import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  PUBLIC_TOKEN_ALPHABET,
  PUBLIC_TOKEN_LENGTH,
  isPublicToken,
} from "@pos/shared/public";
import {
  mintPublicToken,
  mintUniquePublicToken,
  TOKEN_MINT_ATTEMPTS,
  TOKEN_MINT_EXHAUSTED_ERROR,
} from "./public-token";
import { stripComments } from "@/lib/source-pin-utils";

// CR2.1 — the public QR-menu token minter. This is the FIRST unauthenticated
// surface in the app: a weak or biased token generator here is a security bug,
// not a cosmetic one (a guessable token lets a diner read/spam a neighbour's
// table). These tests pin the shape, the entropy source, and the retry
// discipline of mintUniquePublicToken against a fake existence probe (no DB —
// the live leg proves the real unique-index rejection).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PUBLIC_TOKEN_SRC = "apps/cafe/lib/public-token.ts";

// ── mintPublicToken: shape ───────────────────────────────────────────────────

test("mintPublicToken returns PUBLIC_TOKEN_LENGTH characters, every one from PUBLIC_TOKEN_ALPHABET, and isPublicToken() accepts the result", () => {
  const token = mintPublicToken();
  assert.equal(token.length, PUBLIC_TOKEN_LENGTH, "token must be exactly PUBLIC_TOKEN_LENGTH characters");
  for (const char of token) {
    assert.ok(
      PUBLIC_TOKEN_ALPHABET.includes(char),
      `character "${char}" is not in PUBLIC_TOKEN_ALPHABET`,
    );
  }
  // Mutation this catches: a minter and isPublicToken() drifting on shape (an
  // off-by-one length, or a stray lowercase char) — the route that validates
  // a token before ever querying Mongo would then reject every genuine one.
  assert.ok(isPublicToken(token), "isPublicToken() must accept a token mintPublicToken() just produced");
});

// ── mintPublicToken: entropy — no duplicates, no bias ────────────────────────

const MINT_COUNT = 10_000;
// 8 standard deviations of a Binomial(n, 1/32) draw. For a genuinely uniform
// CSPRNG this margin should never be crossed in the lifetime of this suite
// (each symbol's true collapse probability is on the order of 1e-15), but a
// constant generator (one symbol repeated) or a coarse modulo-biased one
// blows straight through it — this is what "deterministic-safe, not flaky"
// means here: the bound is derived from the distribution, not eyeballed.
const SIGMA_MARGIN = 8;

test(`mintPublicToken: ${MINT_COUNT} mints show no duplicate token (70 bits of entropy makes a real collision a never-in-practice event)`, () => {
  const seen = new Set<string>();
  for (let i = 0; i < MINT_COUNT; i++) seen.add(mintPublicToken());
  // Mutation this catches: a generator that draws from a much smaller
  // effective space than PUBLIC_TOKEN_ALPHABET^PUBLIC_TOKEN_LENGTH (e.g. a
  // seeded/non-cryptographic PRNG, or one that discards entropy) would start
  // colliding at this sample size long before a true 70-bit CSPRNG could.
  assert.equal(seen.size, MINT_COUNT, "no two of the minted tokens may be identical");
});

test(`mintPublicToken: ${MINT_COUNT} mints show every alphabet symbol, each within ${SIGMA_MARGIN} standard deviations of the uniform expectation — a biased or constant generator fails this`, () => {
  const counts = new Map<string, number>();
  for (const char of PUBLIC_TOKEN_ALPHABET) counts.set(char, 0);

  for (let i = 0; i < MINT_COUNT; i++) {
    const token = mintPublicToken();
    for (const char of token) counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  const totalSymbols = MINT_COUNT * PUBLIC_TOKEN_LENGTH;
  const alphabetSize = PUBLIC_TOKEN_ALPHABET.length;
  const p = 1 / alphabetSize;
  const expected = totalSymbols * p;
  const stdDev = Math.sqrt(totalSymbols * p * (1 - p));
  const lowerBound = expected - SIGMA_MARGIN * stdDev;
  const upperBound = expected + SIGMA_MARGIN * stdDev;

  for (const [symbol, count] of counts) {
    // Mutation this catches: a generator that never draws some symbols at all
    // (count === 0 for a masking/off-by-one bug) or that draws one symbol far
    // more than the others (a modulo-biased or constant generator) — both
    // fail this bound while a true CSPRNG essentially never does.
    assert.ok(
      count > 0,
      `symbol "${symbol}" never appeared in ${MINT_COUNT} mints — the generator is not covering the full alphabet`,
    );
    assert.ok(
      count >= lowerBound && count <= upperBound,
      `symbol "${symbol}" appeared ${count} times, expected within [${lowerBound.toFixed(0)}, ${upperBound.toFixed(0)}] of ${expected.toFixed(0)} — the draw looks biased`,
    );
  }
});

// ── mintPublicToken: entropy SOURCE, pinned by source ────────────────────────

test("PIN: mintPublicToken draws from node:crypto's randomInt, never Math.random — Math.random is not a CSPRNG and must never back a security token", () => {
  const src = stripComments(readSrc(PUBLIC_TOKEN_SRC));
  assert.match(
    src,
    /import \{ randomInt \} from "node:crypto";/,
    "public-token.ts must import randomInt from node:crypto",
  );
  assert.match(src, /randomInt\(0, PUBLIC_TOKEN_ALPHABET\.length\)/, "mintPublicToken must draw with randomInt(0, PUBLIC_TOKEN_ALPHABET.length)");
  // Mutation this catches: swapping randomInt for Math.random() (or a
  // Math.random()-backed helper) anywhere in this file — the QR token is a
  // security boundary (an opaque per-table secret), so its entropy source
  // must be pinned, not left to whatever the next edit reaches for.
  assert.ok(!/Math\.random/.test(src), "public-token.ts must never call Math.random()");
});

// ── mintUniquePublicToken: the retry/exhaustion contract ────────────────────

function fakeProbe(results: boolean[]): { probe: (token: string) => Promise<boolean>; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    probe: async (token: string) => {
      calls.push(token);
      const result = results[i] ?? results[results.length - 1];
      i += 1;
      return result;
    },
  };
}

test("mintUniquePublicToken: happy path probes exactly once and returns a valid token", async () => {
  const { probe, calls } = fakeProbe([false]);
  const token = await mintUniquePublicToken(probe);
  assert.ok(isPublicToken(token), "the returned token must pass isPublicToken()");
  // Mutation this catches: probing again after the FIRST "does not exist"
  // answer (a stray extra call, or an off-by-one loop) — a diner-facing route
  // path must not do avoidable extra work on the common case.
  assert.equal(calls.length, 1, "the happy path must call the exists-probe exactly once");
});

test(`mintUniquePublicToken: retries when the probe keeps saying "exists", up to TOKEN_MINT_ATTEMPTS, then throws the named error`, async () => {
  const { probe, calls } = fakeProbe([true, true, true, true, true]);
  await assert.rejects(
    () => mintUniquePublicToken(probe),
    (error: Error) => error.message === TOKEN_MINT_EXHAUSTED_ERROR,
    "mintUniquePublicToken must throw with TOKEN_MINT_EXHAUSTED_ERROR's exact message",
  );
  // Mutation this catches: retrying forever (no cap — a genuinely broken probe
  // would hang a request), or capping at a DIFFERENT number than the exported
  // TOKEN_MINT_ATTEMPTS constant — the retry count an operator can reason
  // about must be the one this constant actually enforces.
  assert.equal(calls.length, TOKEN_MINT_ATTEMPTS, `the probe must be called exactly TOKEN_MINT_ATTEMPTS (${TOKEN_MINT_ATTEMPTS}) times before giving up`);
});

test('mintUniquePublicToken: probe says "exists" then "free" — returns the SECOND minted token, having probed exactly twice', async () => {
  const { probe, calls } = fakeProbe([true, false]);
  const token = await mintUniquePublicToken(probe);
  assert.equal(calls.length, 2, "the probe must be called exactly twice");
  // Mutation this catches: returning the FIRST token regardless of what the
  // probe said about it (ignoring the "exists" answer entirely) — the whole
  // point of the retry loop is to never hand back a token the probe rejected.
  assert.equal(token, calls[1], "the returned token must be the one the probe was asked about on its SECOND (accepting) call");
});
