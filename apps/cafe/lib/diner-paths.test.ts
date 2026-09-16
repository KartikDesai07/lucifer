import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-4 — the diner ACCOUNT + PIN-login security invariants. SOURCE-PIN tests
// (readFileSync, comment-stripped where the rule is about code shape rather
// than prose), same technique as lib/order-request-paths.test.ts — this repo
// has no React/route test framework by design, and these rules (timing-safe
// compare, CAS-guarded PIN claim, no-cache diner payloads, credential
// select:false) are exactly the class of invariant a runtime unit test can't
// observe but a source shape can.
//
// NOT duplicated here — already pinned elsewhere:
//   - packages/shared/src/public-diner.test.ts: public-diner.ts's own PURE
//     math/predicates (stampsRemaining, isValidDinerPin, bucket prefixes,
//     selfOrderingAllowed).
//   - lib/public-rate-limit.test.ts: hitRateLimit's own fixed-window math.
//   - lib/order-request-paths.test.ts: the order-request route's own control
//     order (bot/host/size/parse/honeypot/rate-limit).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Returns the index of `needle` in `src`, asserting it was found — every
// ordering/absence pin below composes this so a missing call fails with a
// clear message instead of a silently-vacuous "-1 < -1" pass (this repo's own
// documented lesson: indexOf -1 passes vacuously).
function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

const CUSTOMER_MODEL = "apps/cafe/models/Customer.ts";
const DINER_SESSION_MODEL = "apps/cafe/models/DinerSession.ts";
const DINER_PIN_LIB = "apps/cafe/lib/diner-pin.ts";
const DINER_SESSION_LIB = "apps/cafe/lib/diner-session.ts";
const DINER_LOGIN_ROUTE = "apps/cafe/app/api/public/diner/login/route.ts";
const DINER_PIN_ROUTE = "apps/cafe/app/api/public/diner/pin/route.ts";
const DINER_ME_ROUTE = "apps/cafe/app/api/public/diner/me/route.ts";
const DINER_LOGOUT_ROUTE = "apps/cafe/app/api/public/diner/logout/route.ts";
const PUBLIC_ORDER_REQUEST_ROUTE = "apps/cafe/app/api/public/order-request/route.ts";

// ── 1. Customer.ts — pinHash select:false, stampOrders select:false + default:undefined ──

test("PIN: models/Customer.ts declares pinHash with `select: false` (a credential must never ride an API payload — the Staff.password discipline), and declares stampOrders with BOTH `select: false` and `default: undefined`", () => {
  const src = stripComments(readSrc(CUSTOMER_MODEL));

  // Positive landmark: the schema itself must exist before we can pin fields
  // inside it — an absence pin with no landmark could pass vacuously if the
  // whole schema block were renamed/moved away.
  const schemaStart = mustIndexOf(src, "export const customerSchema = new Schema<ICustomer>(", "the customerSchema declaration");
  const schemaEnd = src.indexOf("customerSchema.index(", schemaStart);
  assert.ok(schemaEnd > schemaStart, "customerSchema.index( must appear after the schema declaration");
  const schemaBody = src.slice(schemaStart, schemaEnd);

  const pinHashStart = mustIndexOf(schemaBody, "pinHash: {", "the pinHash field declaration");
  const pinHashEnd = schemaBody.indexOf("},", pinHashStart) + 2;
  const pinHashField = schemaBody.slice(pinHashStart, pinHashEnd);
  // Mutation this catches: pinHash losing select:false — the credential hash
  // would then ride any lean() read that doesn't explicitly exclude it,
  // exactly the leak the Staff.password discipline exists to prevent.
  assert.match(pinHashField, /select:\s*false/, "pinHash must declare select: false");

  const stampOrdersStart = mustIndexOf(schemaBody, "stampOrders: {", "the stampOrders field declaration");
  const stampOrdersEnd = schemaBody.indexOf("},", stampOrdersStart) + 2;
  const stampOrdersField = schemaBody.slice(stampOrdersStart, stampOrdersEnd);
  // Mutation this catches (select:false half): stampOrders riding a lean()
  // payload — it is an internal idempotency marker, never a rendered field.
  assert.match(stampOrdersField, /select:\s*false/, "stampOrders must declare select: false");
  // Mutation this catches (default:undefined half): Mongoose's automatic
  // empty-[] default landing on every customer who never earned a stamp —
  // that would break the omit-empty discipline this file's own comment
  // documents (every account with no stamps must store NO key at all).
  assert.match(stampOrdersField, /default:\s*undefined/, "stampOrders must declare default: undefined");
});

// ── 2. stampOrders is a DIFFERENT field from appliedOrders ──────────────────

test("PIN: models/Customer.ts's stampOrders is a DIFFERENT field from appliedOrders — both names must appear, since they guard different $inc writers (sharing one array would make the money rollup and the stamp grant cancel each other's idempotency)", () => {
  const src = stripComments(readSrc(CUSTOMER_MODEL));
  // Positive existence for BOTH names — this IS the pin (their coexistence),
  // not an absence, so no separate landmark is needed beyond these two finds.
  mustIndexOf(src, "appliedOrders?:", "the appliedOrders interface field");
  mustIndexOf(src, "stampOrders?:", "the stampOrders interface field");
  mustIndexOf(src, "appliedOrders: { type: [String]", "the appliedOrders schema field");
  mustIndexOf(src, "stampOrders: { type: [String]", "the stampOrders schema field");
  // Mutation this catches: a refactor collapsing the two markers onto one
  // array (e.g. renaming stampOrders to reuse appliedOrders) — the money
  // rollup's own `$ne: orderId` filter and the stamp grant's `$ne: orderId`
  // filter would then race on the SAME array, and whichever writes second
  // would see the other's orderId already present and silently no-op.
  assert.notEqual("appliedOrders", "stampOrders");
});

// ── 3. DinerSession.ts — no TTL index, DOES index customerId ───────────────

test("PIN: models/DinerSession.ts declares NO TTL index (never `expireAfterSeconds`) — ttl-guard is default-deny and throws at schema registration for anything outside its one allowlisted collection — AND it DOES index customerId, which is what makes counter-side revocation (revokeDinerSessions) possible", () => {
  const src = readSrc(DINER_SESSION_MODEL); // full source, comments included on purpose — this is a banned-string scan
  // Vision guard (positive landmark) for the absence pin below: the file must
  // still declare its two REAL indexes, so this isn't passing because the
  // whole index block was deleted or the file was gutted.
  mustIndexOf(src, "dinerSessionSchema.index({ expiresAt: 1 })", "the expiresAt prune index");
  const customerIdIdx = mustIndexOf(
    src,
    "dinerSessionSchema.index({ customerId: 1 })",
    "the customerId revocation index",
  );
  assert.ok(customerIdIdx >= 0, "positive landmark satisfied: customerId index found");

  // Mutation this catches: a TTL index added directly on this schema —
  // @pos/shared/ttl-guard's assertTtlIndexesAllowed THROWS at schema
  // registration for any collection outside its one allowlisted entry
  // (Heartbeat), so this is a second, independent net over that guard.
  assert.ok(!/expireAfterSeconds/.test(src), "models/DinerSession.ts must never declare expireAfterSeconds");
});

// ── 4. diner-pin.ts — unconditional dummy-hash compare, single bcrypt.compare, both buckets referenced ──

test("PIN: lib/diner-pin.ts compares against a dummy hash unconditionally — a module-level dummy hash constant exists and bcrypt.compare is called EXACTLY ONCE in the file (a second, conditional compare would re-open the timing oracle); the file also references BOTH bucket helpers (dinerPinBucket AND dinerSourceBucket)", () => {
  const src = stripComments(readSrc(DINER_PIN_LIB));

  // Positive landmark + existence: the dummy-hash constant itself.
  mustIndexOf(src, "const DUMMY_PIN_HASH = bcrypt.hashSync(", "the module-level dummy PIN hash constant");

  // Mutation this catches: a second bcrypt.compare added on some other branch
  // (e.g. "only compare if a customer was found") — that would let the
  // no-such-mobile path skip bcrypt entirely and return in ~5ms instead of the
  // ~250ms a real compare costs, turning the route into a timing oracle for
  // which mobiles hold an account.
  const compareMatches = src.match(/bcrypt\.compare\(/g) ?? [];
  assert.equal(compareMatches.length, 1, `bcrypt.compare( must appear EXACTLY ONCE in lib/diner-pin.ts, found ${compareMatches.length}`);

  // Both bucket helpers must be referenced — the two-bucket defence (vertical
  // per-mobile + horizontal per-source) collapses to one bucket if either
  // import/call is dropped.
  mustIndexOf(src, "dinerPinBucket(", "a call to dinerPinBucket");
  mustIndexOf(src, "dinerSourceBucket(", "a call to dinerSourceBucket");
});

// ── 5. diner-pin.ts — per-mobile rate limit charged BEFORE the Customer read ──

test("PIN: lib/diner-pin.ts charges the per-mobile rate limit BEFORE it reads the Customer — hitRateLimit must run strictly before Customer.findOne, so an attacker cannot probe the DB for free with a malformed PIN before metering", () => {
  const src = stripComments(readSrc(DINER_PIN_LIB));
  const rateLimitIdx = mustIndexOf(src, "hitRateLimit(", "the per-mobile hitRateLimit call");
  const customerFindIdx = mustIndexOf(src, "Customer.findOne(", "the Customer.findOne lookup");
  // Mutation this catches: reordering so the DB read happens before metering
  // — every malformed/scripted probe would then cost a real Mongo round-trip
  // before ever being charged against the rate-limit bucket meant to bound it.
  assert.ok(rateLimitIdx < customerFindIdx, "hitRateLimit must be called strictly before Customer.findOne");
});

// ── 6. login/route.ts — same message for bad shape and wrong PIN, no distinct "not found", never echoes the body ──

test("PIN: app/api/public/diner/login/route.ts returns the SAME message constant (DINER_LOGIN_FAILED) for a bad shape and a wrong PIN — no distinct \"no such\"/\"not found\"-style message for the mobile, and the route never echoes the request body", () => {
  const src = stripComments(readSrc(DINER_LOGIN_ROUTE));

  // Positive landmark + existence: DINER_LOGIN_FAILED must actually be used,
  // not merely imported.
  const importIdx = mustIndexOf(src, "DINER_LOGIN_FAILED", "an import of DINER_LOGIN_FAILED");
  const useCount = (src.match(/DINER_LOGIN_FAILED/g) ?? []).length;
  // Mutation this catches: importing the constant but never actually using it
  // on both the shape-failure and the verifyDinerPin-failure branches — the
  // import alone proves nothing about which message the caller actually sees.
  assert.ok(useCount >= 2, `DINER_LOGIN_FAILED must be referenced at least twice (import + >=1 use), found ${useCount}`);
  assert.ok(importIdx >= 0, "positive landmark satisfied: DINER_LOGIN_FAILED import found");

  // Mutation this catches: a distinct enumeration-oracle message creeping in
  // for the "no such mobile" case — this route must speak in exactly ONE
  // voice for every login failure. Scoped to the actual STRING-LITERAL
  // arguments passed to failure(...)/success(...)/NextResponse(...) (i.e. text
  // the client can actually receive), not the whole file — the file's own
  // header comment legitimately explains the rule using the phrase
  // ("NEVER distinguishes 'no such mobile' from 'wrong PIN'"), and a banned-
  // phrase scan over the WHOLE file would wrongly trip on that explanation
  // (this repo's own documented trap: a comment stating the rule must not
  // itself fail the pin meant to enforce it).
  const responseLiterals = [...src.matchAll(/(?:failure|success|new NextResponse)\(\s*"([^"]*)"/g)].map(
    (m) => m[1],
  );
  assert.ok(responseLiterals.length > 0, "positive landmark: the route must build at least one response from a string literal");
  for (const literal of responseLiterals) {
    assert.ok(
      !/no such (mobile|account|customer)/i.test(literal),
      `a response literal must never contain a distinct "no such ..." message, found: ${JSON.stringify(literal)}`,
    );
    assert.ok(
      !/mobile.*not found|not found.*mobile/i.test(literal),
      `a response literal must never contain a distinct "mobile ... not found"-style message, found: ${JSON.stringify(literal)}`,
    );
  }

  // Never echo the request body: the success payload must build its `mobile`
  // field from the server-verified `result.mobile` (the DB record), never
  // from the raw submitted `mobile` variable — an echo of the unverified
  // input would let a caller confirm an arbitrary mobile string back to
  // themselves regardless of whether it actually matched an account.
  const successIdx = mustIndexOf(src, "success({ name: result.name, mobile: result.mobile })", "the success payload built from result.*");
  assert.ok(successIdx >= 0, "positive landmark satisfied: the success(...) response literal was found");
  assert.ok(
    !/success\(\{[^)]*mobile:\s*mobile\b/.test(src),
    "the route must never echo the raw submitted `mobile` variable back in the response",
  );
});

// ── 7. pin/route.ts — CAS claim: pinHash:{$exists:false} in the update FILTER ──

test('PIN: app/api/public/diner/pin/route.ts\'s claim is a CAS — the source contains `pinHash: { $exists: false }` inside the update FILTER, which is what stops anyone with a mobile number from overwriting an existing diner\'s PIN', () => {
  const src = stripComments(readSrc(DINER_PIN_ROUTE));

  // Positive landmark: the findOneAndUpdate call itself must exist.
  const updateIdx = mustIndexOf(src, "Customer.findOneAndUpdate(", "the Customer.findOneAndUpdate claim call");
  const updateEnd = src.indexOf(")\n      .select(", updateIdx);
  assert.ok(updateEnd > updateIdx, "the findOneAndUpdate call must be followed by .select(");
  const updateCall = src.slice(updateIdx, updateEnd);

  // The FILTER is the first argument (up to the first top-level `},` that
  // closes it before the $set update object begins) — assert the exact CAS
  // clause appears, and specifically appears before the $set update so it is
  // provably part of the filter and not the update document.
  const casIdx = mustIndexOf(updateCall, "pinHash: { $exists: false }", "the pinHash:{$exists:false} CAS filter clause");
  const setIdx = mustIndexOf(updateCall, "$set:", "the $set update clause");
  // Mutation this catches: moving the $exists:false guard out of the filter
  // (or dropping it entirely) — a plain `{ mobile }` filter would let a
  // second claim on an already-PIN'd account silently overwrite the existing
  // diner's PIN and take over their account, since the mobile number alone is
  // not a secret.
  assert.ok(casIdx < setIdx, "pinHash: { $exists: false } must appear in the FILTER, before the $set update clause");
});

// ── 7b. pin/route.ts — the refusal must tell a NEW diner what to DO ─────────
// OWNER-REPORTED, live 2026-09-16: a first-time diner typed a mobile the cafe
// has never billed and got "We couldn't set a PIN for that number. Please ask
// at the counter." — which reads as a dead end / a broken app. The REFUSAL IS
// CORRECT (a Customer row is minted only when staff accept or settle an order,
// and the CAS above is what stops account takeover); only the WORDING was
// wrong. The message must name the actual next step — place/collect an order
// at the counter first — so the commonest cause of this refusal is actionable.
//
// The hard constraint this pin also guards: the text must stay ONE constant
// used at EVERY refusal branch. Different words per branch would re-open the
// enumeration oracle the route's own header comment exists to close (a caller
// could then tell "no such number" from "already has a PIN").

test("PIN: the set-PIN refusal names the actionable next step (order at the counter first), and is ONE shared constant used at EVERY refusal branch — branch-specific wording would re-open the enumeration oracle the CAS closes", () => {
  const src = stripComments(readSrc(DINER_PIN_ROUTE));

  const declIdx = mustIndexOf(src, "const PIN_SETUP_REFUSED", "the single refusal-message constant");
  const declEnd = src.indexOf(";", declIdx);
  assert.ok(declEnd > declIdx, "the refusal constant must be a terminated declaration");
  const decl = src.slice(declIdx, declEnd);

  // ACTIONABILITY: the diner must be told to order at the counter, not merely
  // to "ask". Mutation this catches: reverting to the bare "Please ask at the
  // counter." wording that shipped.
  assert.match(
    decl,
    /order/i,
    "the refusal must mention placing an order — that is what mints the Customer row a PIN attaches to",
  );
  assert.match(decl, /counter/i, "the refusal must still point the diner at the counter");

  // SINGLE-HOMING: every refusal path uses the constant, and no branch builds
  // its own string. Counted rather than merely present: a NEW branch that
  // hand-wrote its own message would drop this count.
  const uses = src.split("PIN_SETUP_REFUSED").length - 1;
  assert.ok(
    uses >= 6,
    `every refusal branch must reuse PIN_SETUP_REFUSED (declaration + >=5 uses); found ${uses} occurrences`,
  );

  // No OTHER user-facing refusal literal may be minted inside the handler —
  // the shape/weak messages are the deliberate exceptions (they are facts
  // about the typed PIN, not about any account) and come from @pos/shared.
  const failureCalls = src.match(/failure\(\s*"/g) ?? [];
  assert.equal(
    failureCalls.length,
    0,
    "no refusal may be built from an inline string literal — every one must go through the shared constant or a shared message",
  );
});

// ── 8. All four diner routes call noStoreDiner ──────────────────────────────

test("PIN: every one of the four diner routes (login, pin, me, logout) calls noStoreDiner — a per-diner payload must never be cacheable, since a cached copy served to the next phone on the same cafe WiFi is a cross-diner leak", () => {
  for (const rel of [DINER_LOGIN_ROUTE, DINER_PIN_ROUTE, DINER_ME_ROUTE, DINER_LOGOUT_ROUTE]) {
    const src = stripComments(readSrc(rel));
    // Positive landmark: at least one noStoreDiner call. Require >= 2 uses of
    // the identifier (import + call) so this cannot pass on a dead import.
    const uses = (src.match(/noStoreDiner/g) ?? []).length;
    assert.ok(uses >= 2, `${rel} must both import AND call noStoreDiner, found ${uses} reference(s)`);
    mustIndexOf(src, "noStoreDiner(", `a noStoreDiner(...) call in ${rel}`);
  }
});

// ── 9. order-request/route.ts — selfOrderingAllowed before hitRateLimit, never hand-written === "menu" ──

test('PIN: app/api/public/order-request/route.ts calls selfOrderingAllowed and does so BEFORE hitRateLimit (a menu-only cafe must not burn a diner\'s metered slot), and never hand-writes `=== "menu"`', () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_REQUEST_ROUTE));
  const gateIdx = mustIndexOf(src, "selfOrderingAllowed(", "the selfOrderingAllowed(...) gate call");
  const rateLimitIdx = mustIndexOf(src, "hitRateLimit(", "the hitRateLimit(...) charge call");
  // Mutation this catches: moving the menu-only gate after the rate-limit
  // charge — a cafe that has switched ordering off entirely would then burn a
  // diner's metered slot just to be told no, and a scripted client could
  // exhaust the table's whole rate-limit budget against a route that can
  // never succeed.
  assert.ok(gateIdx < rateLimitIdx, "selfOrderingAllowed must be called strictly before hitRateLimit");

  // Mutation this catches: a future edit bypassing the shared predicate with
  // its own literal check — that would silently stop tracking a 4th mode
  // added to SELF_ORDER_MODES later (selfOrderingAllowed is written against
  // the DENY value precisely so a new mode defaults to "allowed" only through
  // that one function, never through a hand-rolled comparison).
  assert.ok(!/===\s*"menu"/.test(src), 'the route must never hand-write `=== "menu"` — only selfOrderingAllowed may decide this');
});

// ── 10. diner-session.ts — httpOnly + sameSite:"lax", revokeDinerSessions deleteMany on customerId ──

test('PIN: lib/diner-session.ts sets the cookie with httpOnly AND sameSite "lax" (NOT "strict" — a QR scan is a cross-site top-level navigation, and "strict" would withhold the cookie on exactly that hop), and revokeDinerSessions does a deleteMany keyed on customerId', () => {
  const src = stripComments(readSrc(DINER_SESSION_LIB));

  const cookieFnStart = mustIndexOf(src, "function cookieOptions(maxAge: number)", "the cookieOptions() function");
  const cookieFnEnd = src.indexOf("\n}", cookieFnStart);
  assert.ok(cookieFnEnd > cookieFnStart, "cookieOptions must close with a top-level }");
  const cookieFnBody = src.slice(cookieFnStart, cookieFnEnd);

  // Mutation this catches: httpOnly dropped or flipped false — the cookie
  // would then be readable from client-side JS, defeating the whole point of
  // an opaque server-resolved session handle.
  assert.match(cookieFnBody, /httpOnly:\s*true/, "cookieOptions must set httpOnly: true");
  // Mutation this catches: sameSite flipped to "strict" — a diner scanning
  // the table's QR code (a cross-site top-level navigation in many Android
  // camera apps) would then never send the cookie on that very first request,
  // making an already-signed-in diner look signed-out every time they scan.
  assert.match(cookieFnBody, /sameSite:\s*"lax"/, 'cookieOptions must set sameSite: "lax", not "strict"');
  assert.ok(!/sameSite:\s*"strict"/.test(cookieFnBody), 'cookieOptions must never set sameSite: "strict"');

  const revokeStart = mustIndexOf(
    src,
    "export async function revokeDinerSessions(customerId: string): Promise<void> {",
    "the revokeDinerSessions function",
  );
  const revokeEnd = src.indexOf("\n}", revokeStart);
  assert.ok(revokeEnd > revokeStart, "revokeDinerSessions must close with a top-level }");
  const revokeBody = src.slice(revokeStart, revokeEnd);
  // Mutation this catches: revokeDinerSessions narrowed to a single-session
  // delete (e.g. keyed on the token) instead of every live session for the
  // account — that would make the counter's "PIN reset" promise false, since
  // a device holding an older cookie would keep authenticating.
  assert.match(
    revokeBody,
    /DinerSession\.deleteMany\(\{\s*customerId\s*\}\)/,
    "revokeDinerSessions must call DinerSession.deleteMany({ customerId })",
  );
});
