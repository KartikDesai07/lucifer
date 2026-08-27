import { randomInt } from "node:crypto";
import {
  PUBLIC_CODE_LENGTH,
  PUBLIC_TOKEN_ALPHABET,
  PUBLIC_TOKEN_LENGTH,
} from "@pos/shared/public";

// Mints the opaque per-table token printed on a QR sticker (see
// packages/shared/src/public.ts for why it exists and why it is NOT tableNo).
// Server-only: node:crypto is not something the diner's menu bundle may import.

// crypto.randomInt(0, 32) draws from Node's CSPRNG with REJECTION SAMPLING
// built in — unlike `Math.random() * 32 | 0` or `randomBytes()[i] % 32`,
// randomInt has no modulo bias because it discards and re-draws any value
// that would make the output range uneven. Every one of the 32 alphabet
// symbols is therefore equally likely on every draw.
//
// `length` defaults to PUBLIC_TOKEN_LENGTH (additive — every existing call
// site is unaffected); mintPublicCode below reuses this same draw at
// PUBLIC_CODE_LENGTH instead of forking the loop.
export function mintPublicToken(length: number = PUBLIC_TOKEN_LENGTH): string {
  let token = "";
  for (let i = 0; i < length; i++) {
    token += PUBLIC_TOKEN_ALPHABET[randomInt(0, PUBLIC_TOKEN_ALPHABET.length)];
  }
  return token;
}

// 70 bits of entropy (32^14) means a genuine collision between two minted
// tokens is a never-in-practice event — this retry loop exists purely so
// that the astronomically unlikely case can never surface to an operator as
// an unhandled unique-index violation (500) instead of a clean, named error.
export const TOKEN_MINT_ATTEMPTS = 3;

export const TOKEN_MINT_EXHAUSTED_ERROR =
  "Could not mint a unique public token — try again";

// `exists` is the caller's own existence probe (kept generic so this module
// never has to import a model) — e.g. `(t) => Table.exists({ publicToken: t }).then(Boolean)`.
// `length` defaults to PUBLIC_TOKEN_LENGTH (additive), same reasoning as
// mintPublicToken above.
export async function mintUniquePublicToken(
  exists: (token: string) => Promise<boolean>,
  length: number = PUBLIC_TOKEN_LENGTH,
): Promise<string> {
  for (let attempt = 0; attempt < TOKEN_MINT_ATTEMPTS; attempt++) {
    const token = mintPublicToken(length);
    if (!(await exists(token))) return token;
  }
  throw new Error(TOKEN_MINT_EXHAUSTED_ERROR);
}

// ── The order-status code ───────────────────────────────────────────────────
// A SEPARATE identifier from the table token above — see PUBLIC_CODE_LENGTH's
// doc comment in packages/shared/src/public.ts for why it is a different
// length. Same alphabet, same CSPRNG draw, same retry/exhaustion discipline —
// reused via the `length` params above rather than forked.
export function mintPublicCode(): string {
  return mintPublicToken(PUBLIC_CODE_LENGTH);
}

// `exists` is the caller's own existence probe, e.g.
// `(c) => Order.exists({ publicCode: c }).then(Boolean)`.
export async function mintUniquePublicCode(
  exists: (code: string) => Promise<boolean>,
): Promise<string> {
  return mintUniquePublicToken(exists, PUBLIC_CODE_LENGTH);
}
