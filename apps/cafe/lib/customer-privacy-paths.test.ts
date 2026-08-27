import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// A review found that customer-privacy.test.ts pins the HELPER functions
// (maskCustomer/maskCustomers/stripMobileForRole/canSeeFullMobile — masking,
// non-mutation) but nothing pins that the ROUTES and COMPONENTS actually CALL
// them. A new customer-returning route could ship a raw Mongoose doc straight
// past those unit tests with the whole suite green. These are source-read
// pins (readFileSync over the REAL route/component source), the same
// technique as print-paths.test.ts and receipt.test.ts's Cart.tsx pins — this
// repo has no React/route test framework by design.
//
// NOT duplicated here — already pinned elsewhere:
//   - customer-privacy.test.ts: maskCustomer/maskCustomers/stripMobileForRole/
//     canSeeFullMobile's own behavior (masking shape, non-mutation, fail-closed).
//   - packages/shared/src/utils.test.ts: maskMobile's own masking format.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// These pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it. (This bit this repo once already on a banned-string pin.)

// Scans forward from an opening `(` at `openIdx`, counting paren depth, and
// returns the index of its MATCHING closing `)`. A naive `indexOf(")")` from
// the call site would stop at the first nested call's own closing paren
// (e.g. `success(maskCustomer(customer.toObject(), role))` has three), and
// truncate the captured argument list before the code that actually matters.
function matchingParenEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingParenEnd: no matching closing paren found");
}

// Same idea as matchingParenEnd, but for `{...}` — used to pull a whole
// function BODY out of the source text (see the mergeById behavioral pin).
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

const CUSTOMERS_ROUTE = "apps/cafe/app/api/customers/route.ts";
const CUSTOMER_ID_ROUTE = "apps/cafe/app/api/customers/[id]/route.ts";
const PAYMENTS_ROUTE = "apps/cafe/app/api/customers/[id]/payments/route.ts";
const SETTLE_ROUTE = "apps/cafe/app/api/customers/[id]/settle/route.ts";
const RECONCILE_ROUTE = "apps/cafe/app/api/customers/[id]/reconcile/route.ts";
const REPORTS_ROUTE = "apps/cafe/app/api/reports/route.ts";
const CUSTOMERS_PAGE = "apps/cafe/app/(dashboard)/customers/page.tsx";
const CUSTOMER_FORM_SHEET = "apps/cafe/components/customers/CustomerFormSheet.tsx";
const CUSTOMER_SEARCH_COMPONENT = "apps/cafe/components/pos/CustomerSearch.tsx";

// ── A. GET /api/customers — all three return points mask ────────────────────

test("PIN: GET /api/customers masks all THREE return points — the search branch, the cache-HIT branch, and the cache-MISS branch — in that order", () => {
  const src = stripComments(readSrc(CUSTOMERS_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const postStart = src.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart, "GET must exist before POST");
  const getBody = src.slice(getStart, postStart);

  const searchIfIdx = getBody.indexOf("if (search) {");
  const cacheHitIfIdx = getBody.indexOf("if (cachedCustomers)");
  const cacheSetIdx = getBody.indexOf("cache.set(CACHE_KEY");
  assert.ok(searchIfIdx >= 0, "the search branch must exist");
  assert.ok(cacheHitIfIdx > searchIfIdx, "the cache-hit check must come after the search branch");
  assert.ok(cacheSetIdx > cacheHitIfIdx, "cache.set must come after the cache-hit check");

  // Requires `role` (the variable read from the session) as the SECOND
  // argument — not just that maskCustomers was called. Mutation this catches:
  // `success(maskCustomers(customers, "admin"))` (masking disabled for
  // everyone) would still match a bare `success(maskCustomers(` pin, but
  // fails this one because the argument isn't the `role` identifier.
  const maskedReturns = [
    ...getBody.matchAll(/success\(\s*maskCustomers\(\s*[A-Za-z_$][\w$]*\s*,\s*role\s*\)\s*\)/g),
  ].map((m) => m.index!);
  assert.equal(
    maskedReturns.length,
    3,
    `expected exactly 3 masked returns in GET (each masking with the \`role\` variable), found ${maskedReturns.length} — every return point (search / cache-hit / cache-miss) must mask using the session's role`,
  );

  assert.ok(
    maskedReturns[0] > searchIfIdx && maskedReturns[0] < cacheHitIfIdx,
    "the SEARCH branch's return must be masked",
  );
  assert.ok(
    maskedReturns[1] > cacheHitIfIdx && maskedReturns[1] < cacheSetIdx,
    "the cache-HIT branch's return must be masked",
  );
  assert.ok(maskedReturns[2] > cacheSetIdx, "the cache-MISS branch's return (after cache.set) must be masked");
});

// ── B. The cache-ordering pin — highest value ────────────────────────────────

test("PIN: cache.set(CACHE_KEY, ...) receives the RAW unmasked `customers` variable, never a masked one — the cache is process-wide and shared across roles, so caching a masked list would show stars to the next ADMIN until TTL", () => {
  const src = stripComments(readSrc(CUSTOMERS_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const postStart = src.indexOf("export async function POST");
  const getBody = src.slice(getStart, postStart);

  const cacheHitIfIdx = getBody.indexOf("if (cachedCustomers)");
  const cacheSetMarker = "cache.set(CACHE_KEY";
  const cacheSetIdx = getBody.indexOf(cacheSetMarker);
  assert.ok(cacheHitIfIdx >= 0, "the cache-hit check must exist");
  assert.ok(cacheSetIdx >= 0, "cache.set(CACHE_KEY, ...) must exist in GET");
  const openParenIdx = getBody.indexOf("(", cacheSetIdx);
  const closeParenIdx = matchingParenEnd(getBody, openParenIdx);
  const cacheSetArgs = getBody.slice(openParenIdx + 1, closeParenIdx);

  // Positive shape pin: the exact, unwrapped argument list.
  assert.match(
    cacheSetArgs,
    /^CACHE_KEY,\s*customers,\s*TTL\.CUSTOMERS$/,
    `cache.set's arguments were "${cacheSetArgs}" — expected the raw \`customers\` variable, unwrapped by any mask call`,
  );
  // Belt-and-suspenders: fails if anyone wraps the argument in maskCustomers,
  // however they reformat the call (e.g. cache.set(CACHE_KEY, maskCustomers(customers, role), TTL.CUSTOMERS)
  // would fail BOTH the regex above and this check).
  assert.ok(
    !/maskCustomers/.test(cacheSetArgs),
    "cache.set must never receive a maskCustomers(...) result — that would permanently poison the shared cache with masked digits for every subsequent admin request until TTL expiry",
  );

  // Provenance, not just spelling: the two checks above only look at the
  // TOKEN passed to cache.set. They would both still pass a rewrite like
  // `const customers = maskCustomers(raw, role); cache.set(CACHE_KEY, customers, TTL.CUSTOMERS);`
  // — `customers` is still the identifier at the call site, but it now HOLDS a
  // masked list. Scope to the cache-MISS branch specifically (from the
  // `await connectDB()` that follows the cache-hit check, to cache.set itself
  // — excluding the cache-hit branch's OWN `maskCustomers(cachedCustomers, role)`
  // call, which legitimately precedes cache.set in the source) and forbid any
  // maskCustomers call appearing in it.
  const postCacheHitIdx = getBody.indexOf("await connectDB();", cacheHitIfIdx);
  assert.ok(
    postCacheHitIdx > cacheHitIfIdx && postCacheHitIdx < cacheSetIdx,
    "the cache-miss branch's connectDB() must exist between the cache-hit check and cache.set",
  );
  const preCacheSetSegment = getBody.slice(postCacheHitIdx, cacheSetIdx);
  assert.ok(
    !/maskCustomers\(/.test(preCacheSetSegment),
    "no maskCustomers( call may appear between the cache-miss branch's connectDB() and cache.set(CACHE_KEY — wherever `customers` is masked before being handed to cache.set, however it's spelled, it poisons the shared cache",
  );
});

// ── A continued. POST /api/customers masks, via .toObject() first ───────────

test("PIN: POST /api/customers masks the created customer, and converts the Mongoose document to a plain object FIRST — spreading a Mongoose doc directly would leak its internals", () => {
  const src = stripComments(readSrc(CUSTOMERS_ROUTE));
  const postStart = src.indexOf("export async function POST");
  assert.ok(postStart >= 0, "POST must exist");
  const postBody = src.slice(postStart);

  assert.match(
    postBody,
    /return created\(maskCustomer\(customer\.toObject\(\), role\)\)/,
    "POST must call created(maskCustomer(customer.toObject(), role)) — customer.toObject() must run BEFORE maskCustomer, or the spread inside maskCustomer leaks the raw Mongoose document's internals",
  );
});

// ── A continued. /api/customers/[id] — GET masks, PUT strips then masks ─────

test("PIN: GET /api/customers/[id] masks its return", () => {
  const src = stripComments(readSrc(CUSTOMER_ID_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const putStart = src.indexOf("export async function PUT");
  assert.ok(getStart >= 0 && putStart > getStart, "GET must exist before PUT");
  const getBody = src.slice(getStart, putStart);

  assert.match(
    getBody,
    /return success\(maskCustomer\(customer, role\)\)/,
    "GET /api/customers/[id] must mask the customer before returning it",
  );
});

test("PIN: PUT /api/customers/[id] calls stripMobileForRole BEFORE findByIdAndUpdate, and masks its return", () => {
  const src = stripComments(readSrc(CUSTOMER_ID_ROUTE));
  const putStart = src.indexOf("export async function PUT");
  const deleteStart = src.indexOf("export async function DELETE");
  assert.ok(putStart >= 0 && deleteStart > putStart, "PUT must exist before DELETE");
  const putBody = src.slice(putStart, deleteStart);

  const stripIdx = putBody.indexOf("stripMobileForRole(");
  const updateIdx = putBody.indexOf("findByIdAndUpdate(");
  assert.ok(stripIdx >= 0, "PUT must call stripMobileForRole");
  assert.ok(updateIdx >= 0, "PUT must call findByIdAndUpdate");
  assert.ok(
    stripIdx < updateIdx,
    "stripMobileForRole must run BEFORE findByIdAndUpdate — otherwise a staff-submitted masked-string echo can reach the write and overwrite the unique-indexed mobile field with stars",
  );

  assert.match(
    putBody,
    /const data = stripMobileForRole\(parsed\.data, role\);/,
    "the stripped update must be captured as `data`",
  );
  assert.match(
    putBody,
    /Customer\.findByIdAndUpdate\(id, data,/,
    "findByIdAndUpdate must be called with the STRIPPED `data`, not the raw parsed body",
  );
  assert.match(
    putBody,
    /return success\(maskCustomer\(customer, role\)\)/,
    "PUT must mask the updated customer before returning it",
  );
});

test("PIN: DELETE /api/customers/[id] uses requireAdmin, while GET and PUT in the same file stay requireAuth", () => {
  // Owner rule: deleting a customer is the one destructive act that takes
  // their whole due-payment HISTORY out of reach with it (DuePayment rows
  // survive, but every read is keyed on the customer, who no longer exists to
  // look up) — so DELETE was moved from requireAuth to requireAdmin. GET/PUT
  // stay staff-reachable by design; a blanket swap of the whole file's guard
  // (e.g. a find-and-replace of requireAuth->requireAdmin) must fail THIS
  // pin too, not just look like a DELETE-only hardening.
  const src = stripComments(readSrc(CUSTOMER_ID_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const putStart = src.indexOf("export async function PUT");
  const deleteStart = src.indexOf("export async function DELETE");
  assert.ok(getStart >= 0 && putStart > getStart, "GET must exist before PUT");
  assert.ok(deleteStart > putStart, "PUT must exist before DELETE");

  const getBody = src.slice(getStart, putStart);
  const putBody = src.slice(putStart, deleteStart);
  const deleteBody = src.slice(deleteStart);

  // Mutation this catches: downgrading DELETE back to requireAuth — any
  // staff account could then permanently delete a customer.
  assert.match(deleteBody, /\brequireAdmin\s*\(\s*\)/, "DELETE must gate with requireAdmin()");
  assert.ok(!/\brequireAuth\s*\(/.test(deleteBody), "DELETE must NOT use requireAuth");

  // Mutation this catches: a blanket requireAuth->requireAdmin swap across
  // the whole file — GET/PUT are staff-reachable by design and must stay so.
  assert.match(getBody, /\brequireAuth\s*\(\s*\)/, "GET must stay requireAuth — staff-reachable by design");
  assert.ok(!/\brequireAdmin\s*\(/.test(getBody), "GET must NOT be downgraded to requireAdmin");
  assert.match(putBody, /\brequireAuth\s*\(\s*\)/, "PUT must stay requireAuth — staff-reachable by design");
  assert.ok(!/\brequireAdmin\s*\(/.test(putBody), "PUT must NOT be downgraded to requireAdmin");
});

// ── A continued. Staff-reachable payments route masks ────────────────────────

test("PIN: POST /api/customers/[id]/payments (requireAuth — staff-reachable) masks its return", () => {
  const src = stripComments(readSrc(PAYMENTS_ROUTE));
  assert.match(src, /requireAuth\(\)/, "this route must stay staff-reachable (requireAuth, not requireAdmin)");
  assert.match(
    src,
    /return success\(maskCustomer\(result\.customer, role\)\)/,
    "the payments route must mask the customer it returns — this is the one customer-returning route staff can reach directly",
  );
});

// ── A continued. Admin-only settle/reconcile mask too (defense in depth) ────

test("PIN: POST /api/customers/[id]/settle masks its return — admin-only today, but the pin is what keeps that true if the guard ever changes", () => {
  const src = stripComments(readSrc(SETTLE_ROUTE));
  assert.match(
    src,
    /return success\(maskCustomer\(result\.customer, role\)\)/,
    "settle must mask the customer it returns",
  );
});

test("PIN: POST /api/customers/[id]/reconcile masks its return — admin-only today, but the pin is what keeps that true if the guard ever changes", () => {
  const src = stripComments(readSrc(RECONCILE_ROUTE));
  assert.match(
    src,
    /return success\(maskCustomer\(updated, role\)\)/,
    "reconcile must mask the customer it returns",
  );
});

// ── A continued. The role plumbing itself — not just that mask calls exist ──
// Every pin above requires a call site to pass `role` as an argument, but
// nothing yet pins where `role` comes FROM. `const role = "admin";` on any of
// these routes disables masking for that route with every pin above still
// green (the call site still literally says `..., role)`).

test("PIN: role is read from the session on every customer-returning route — never hardcoded", () => {
  // requireAuth() routes bind the auth result as `authed`; requireAdmin()
  // routes (settle/reconcile) bind it as `admin` — both real call sites below.
  const authedRoleRe = /const\s+role\s*=\s*authed\.session\.user\.role\s*;/;
  const adminRoleRe = /const\s+role\s*=\s*admin\.session\.user\.role\s*;/;

  const customersSrc = stripComments(readSrc(CUSTOMERS_ROUTE));
  const getStart = customersSrc.indexOf("export async function GET");
  const postStart = customersSrc.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart, "GET must exist before POST");
  assert.match(
    customersSrc.slice(getStart, postStart),
    authedRoleRe,
    "GET /api/customers must read role from authed.session.user.role",
  );
  assert.match(
    customersSrc.slice(postStart),
    authedRoleRe,
    "POST /api/customers must read role from authed.session.user.role",
  );

  const idSrc = stripComments(readSrc(CUSTOMER_ID_ROUTE));
  const idGetStart = idSrc.indexOf("export async function GET");
  const idPutStart = idSrc.indexOf("export async function PUT");
  const idDeleteStart = idSrc.indexOf("export async function DELETE");
  assert.ok(idGetStart >= 0 && idPutStart > idGetStart, "GET must exist before PUT");
  assert.ok(idDeleteStart > idPutStart, "PUT must exist before DELETE");
  assert.match(
    idSrc.slice(idGetStart, idPutStart),
    authedRoleRe,
    "GET /api/customers/[id] must read role from authed.session.user.role",
  );
  assert.match(
    idSrc.slice(idPutStart, idDeleteStart),
    authedRoleRe,
    "PUT /api/customers/[id] must read role from authed.session.user.role",
  );

  assert.match(
    stripComments(readSrc(PAYMENTS_ROUTE)),
    authedRoleRe,
    "POST /api/customers/[id]/payments must read role from authed.session.user.role",
  );
  assert.match(
    stripComments(readSrc(SETTLE_ROUTE)),
    adminRoleRe,
    "POST /api/customers/[id]/settle must read role from admin.session.user.role",
  );
  assert.match(
    stripComments(readSrc(RECONCILE_ROUTE)),
    adminRoleRe,
    "POST /api/customers/[id]/reconcile must read role from admin.session.user.role",
  );
});

// ── A continued. /api/reports staying admin-only is part of THIS contract ──
// /api/reports selects `name mobile totalDue` straight off Customer with no
// maskCustomer call at all (see the comment in lib/customer-privacy.ts) — its
// requireAdmin guard is the ONLY thing keeping that unmasked mobile number
// off a staff screen. None of the pins above touch this file, so downgrading
// it to requireAuth would leak real numbers with the whole rest of this
// suite green.

test("PIN: GET /api/reports stays requireAdmin — this is load-bearing for customer privacy, not just report access control", () => {
  const src = stripComments(readSrc(REPORTS_ROUTE));
  assert.match(
    src,
    /const authed\s*=\s*await requireAdmin\(\);/,
    "GET /api/reports must guard with requireAdmin — customerDues is `name mobile totalDue` with no mask call, so requireAuth here would hand real mobile numbers to staff",
  );
});

// ── A continued. CUSTOMER_SEARCH_LIMIT parity — API cap ↔ UI warning ────────
// The API's search cap and the customers page's truncation notice must read
// the SAME shared constant. If either hardcodes its own number, the two can
// silently drift: the UI could under-warn (say "first 50" while the API
// actually caps at a different number) or over-warn.

test("PIN: CUSTOMER_SEARCH_LIMIT parity — the API cap and the UI truncation warning share the same constant", () => {
  const routeSrc = stripComments(readSrc(CUSTOMERS_ROUTE));
  assert.match(
    routeSrc,
    /import\s*\{[^}]*\bCUSTOMER_SEARCH_LIMIT\b[^}]*\}\s*from\s*["']@\/lib\/constants["']/,
    "the route must import CUSTOMER_SEARCH_LIMIT from @/lib/constants",
  );
  assert.match(
    routeSrc,
    /\.limit\(CUSTOMER_SEARCH_LIMIT\)/,
    "the search query's .limit() must use CUSTOMER_SEARCH_LIMIT, not a hardcoded number",
  );

  const pageSrc = stripComments(readSrc(CUSTOMERS_PAGE));
  assert.match(
    pageSrc,
    /import\s*\{[^}]*\bCUSTOMER_SEARCH_LIMIT\b[^}]*\}\s*from\s*["']@\/lib\/constants["']/,
    "the page must import CUSTOMER_SEARCH_LIMIT from the SAME module as the route",
  );
  assert.match(
    pageSrc,
    /remoteRows\.length\s*>=\s*CUSTOMER_SEARCH_LIMIT/,
    "the truncation flag must compare against CUSTOMER_SEARCH_LIMIT, not a hardcoded number",
  );
  assert.match(
    pageSrc,
    /Showing the first \{CUSTOMER_SEARCH_LIMIT\} matches/,
    "the notice TEXT shown to the operator must interpolate the shared constant, not a hardcoded copy of today's value — otherwise the two can drift apart silently",
  );
});

// ── C. No unmasked customer route — a completeness sweep ────────────────────
// LIMITATION (stated deliberately, per the task): this only proves a route
// that mentions returning something non-trivial via success()/created() also
// IMPORTS @/lib/customer-privacy — not that every such value it returns is
// actually PASSED through a mask call, nor that a route importing the module
// for an unrelated reason doesn't leak a raw doc some other way. The specific
// routes above are what actually pin the real call sites; this sweep exists
// only to catch a FUTURE route added under app/api/customers/ that forgets
// the import (and therefore, almost certainly, the mask call) entirely.

// An object-literal argument made ONLY of literal values (e.g. `{ deleted: true }`)
// never carries customer data through — it needs no mask helper.
const LITERAL_ONLY_ARG = /^\{(\s*[A-Za-z_$][\w$]*\s*:\s*(true|false|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\s*,?)*\s*\}$/;

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (entry.isFile() && entry.name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

test("PIN (completeness sweep, self-limiting — see comment above): every route.ts under app/api/customers/ that returns something other than a trivial literal via success()/created() imports @/lib/customer-privacy", () => {
  const customersApiDir = path.join(REPO_ROOT, "apps/cafe/app/api/customers");
  const files = listRouteFiles(customersApiDir);
  // Sanity floor so a broken directory walk (e.g. wrong path) can't silently
  // pass by iterating zero files.
  assert.ok(
    files.length >= 5,
    `expected to find at least the 5 known customer routes by walking the directory, found ${files.length}`,
  );

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const src = stripComments(raw);
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");

    const calls = [...src.matchAll(/\b(?:success|created)\(/g)];
    let nonLiteralCallFound = false;
    for (const m of calls) {
      const openIdx = m.index! + m[0].length - 1;
      const closeIdx = matchingParenEnd(src, openIdx);
      const arg = src.slice(openIdx + 1, closeIdx).trim();
      if (!LITERAL_ONLY_ARG.test(arg)) {
        nonLiteralCallFound = true;
        break;
      }
    }

    if (nonLiteralCallFound) {
      assert.match(
        src,
        /from ["']@\/lib\/customer-privacy["']/,
        `${rel} returns something other than a trivial literal from success()/created() but does not import @/lib/customer-privacy — a new customer-returning route could ship unmasked`,
      );
    }
  }
});

// ── D. Component pins ────────────────────────────────────────────────────────

test("PIN: CustomersPage — local mobile matching is gated on isAdmin, remote search is disabled for admins, remote rows wait for the debounce to settle, and a failed search reads differently than 'no matches'", () => {
  const src = stripComments(readSrc(CUSTOMERS_PAGE));

  assert.match(
    src,
    /c\.name\.toLowerCase\(\)\.includes\(q\) \|\| \(isAdmin && c\.mobile\.includes\(q\)\)/,
    "the local filter must gate mobile substring matching on isAdmin — a staff client only ever holds a MASKED number, so matching against it either matches every customer sharing the visible prefix or (past the 5th digit) matches nobody",
  );
  assert.match(
    src,
    /useCustomerSearch\(isAdmin \? "" : debounced\)/,
    "the remote search must be disabled for admins (empty query) — an admin's local list already holds real numbers",
  );
  // NOTE: `query` (not `search`) — the debounce is compared TRIMMED against
  // the trimmed current search, matching the query key useCustomerSearch
  // actually uses (see the identical settle-gate pin on CustomerSearch.tsx
  // below). Whitespace-tolerant so a Prettier reflow can't break this.
  assert.match(
    src,
    /const\s+searchSettled\s*=\s*debounced\.trim\(\)\s*===\s*query\s*;/,
    "searchSettled must compare the TRIMMED debounce against the trimmed query — otherwise a stray trailing space makes an already-settled search look unsettled forever, or a real edit look settled too early",
  );
  assert.match(
    src,
    /const remoteRows = !isAdmin && searchSettled \? \(remote\.data \?\? \[\]\) : \[\];/,
    "remote rows must only be used once the debounce has caught up with what's typed — otherwise the table shows confident rows answering a STALE query, and a tap opens the wrong customer's dues",
  );

  // The main list's failed-REFRESH branch must read `isPaused` / `isLoadingError`
  // — not bare `isError` — or a parked/offline query renders as "No customers
  // yet" (isPaused) or throws away a still-good cached list on a failed
  // background refetch (isLoadingError vs isError). Mutation this catches:
  // reverting either branch to `customers.isError`.
  assert.match(
    src,
    /customers\.isPaused\s*&&\s*!hasCustomers/,
    "a parked (offline) list load must be read via isPaused — without it the page tells a cafe with a full customer book that it has 'No customers yet'",
  );
  assert.match(
    src,
    /customers\.isLoadingError/,
    "a failed REFRESH of the main list must be read via isLoadingError (not isError) — a failed refresh with cached rows still in hand must not discard them",
  );
  assert.ok(
    !/\bcustomers\.isError\b/.test(src),
    "the main list must never read bare `customers.isError` — that conflates a failed background refresh (cached rows still valid) with a failed initial load",
  );

  // Ordering: the remote isError branch must render before the generic
  // "No matches" default.
  const remoteIsErrorIfIdx = src.indexOf("if (remote.isError)");
  const noMatchesTitleIdx = src.indexOf('title="No matches"');
  assert.ok(remoteIsErrorIfIdx >= 0, "a distinct error branch must exist for the remote search");
  assert.ok(noMatchesTitleIdx > remoteIsErrorIfIdx, "the remote isError branch must be checked BEFORE the generic 'No matches' branch");

  // Ordering alone would still pass if the failure branch were reworded to
  // say "No matches" too — pin that the two branches actually READ
  // differently, and that the failure branch never claims the customer is
  // absent. This is the mutation ordering-only pins miss entirely.
  const remoteIsErrorBody = src.slice(remoteIsErrorIfIdx, noMatchesTitleIdx);
  const failureTextMatch = remoteIsErrorBody.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(failureTextMatch, "the remote isError branch must render explanatory <p> text");
  const failureText = failureTextMatch[1].replace(/\s+/g, " ").trim();

  const noMatchesTail = src.slice(noMatchesTitleIdx, noMatchesTitleIdx + 200);
  const noMatchesDescMatch = noMatchesTail.match(/description="([^"]*)"/);
  assert.ok(noMatchesDescMatch, "the No-matches branch must have a description");
  const noMatchesText = noMatchesDescMatch[1];

  assert.notEqual(
    failureText,
    noMatchesText,
    "a failed search and 'no matches' must render DIFFERENT text to the operator — identical text makes the two indistinguishable on screen",
  );
  assert.ok(
    !/\bmatch(es)?\b/i.test(failureText) && !/does not exist/i.test(failureText),
    `the failed-search branch's text ("${failureText}") must not claim the customer is absent — that is how an operator ends up creating a duplicate or writing off a due that is genuinely owed`,
  );
});

test("PIN: CustomersPage gates the delete button on isAdmin — the route already 403s a staff DELETE, but the button must not be OFFERED to an account that can't use it", () => {
  const src = stripComments(readSrc(CUSTOMERS_PAGE));

  // `isAdmin && (` is the JSX-guard idiom this file uses elsewhere (e.g. the
  // "Receive payment" action a few lines above it) — it appears exactly once
  // as a literal substring, at the delete button's guard. Locate its matching
  // close paren via the file's own matchingParenEnd helper (JSX inside can
  // contain nested parens, e.g. arrow-fn onClick handlers, so a naive
  // indexOf(")") would truncate early) and require the delete button's own
  // aria-label + onClick to be INSIDE that span.
  const gateMarker = "isAdmin && (";
  const gateIdx = src.indexOf(gateMarker);
  assert.ok(gateIdx >= 0, "an `isAdmin && (` guard must exist in CustomersPage");
  const openParenIdx = gateIdx + gateMarker.length - 1;
  const closeParenIdx = matchingParenEnd(src, openParenIdx);
  const gatedBlock = src.slice(openParenIdx, closeParenIdx + 1);

  // Mutation this catches: deleting the `isAdmin && (` wrapper (and its
  // matching `)}`) while leaving the Button itself untouched — the button
  // would then render unconditionally, offering staff a delete action the
  // route refuses with a 403.
  assert.match(
    gatedBlock,
    /aria-label="Delete customer"/,
    "the isAdmin && ( ... ) block must contain the Delete customer button",
  );
  assert.match(
    gatedBlock,
    /onClick=\{\(\)\s*=>\s*setDeleting\(customer\)\}/,
    "the gated block must be the one whose button triggers setDeleting(customer), not some other isAdmin-gated block",
  );
});

test("PIN: CustomerFormSheet — the edit submit omits mobile when !canEditMobile, submission is blocked while the session is loading, and the mobile input is read-only (never disabled)", () => {
  const src = stripComments(readSrc(CUSTOMER_FORM_SHEET));

  assert.match(
    src,
    /data:\s*canEditMobile\s*\?\s*values\s*:\s*\{\s*name:\s*values\.name,\s*notes:\s*values\.notes\s*\}/,
    "the edit submit must omit mobile entirely when !canEditMobile — a staff client only ever holds the masked string, and sending it risks it reaching the update payload",
  );

  assert.match(
    src,
    /const saving =\s*createCustomer\.isPending \|\| updateCustomer\.isPending \|\| isLoading;/,
    "isLoading must be folded into `saving` — the only window where canEditMobile could be wrong is while the session is still resolving, and nothing may submit during it",
  );
  // The computation alone proves nothing if it is never wired to the prop
  // that actually disables submission. Mutation this catches: inlining
  // `createCustomer.isPending || updateCustomer.isPending` (dropping
  // isLoading) directly into the `saving=` prop and deleting the `const
  // saving = ...` line — the assertion above would then find nothing to
  // match, but ALSO catches the case where `const saving` stays correct while
  // the prop itself is fed something else (e.g. only `createCustomer.isPending`).
  assert.match(
    src,
    /\bsaving=\{saving\}/,
    "the FormSheet's `saving` prop must be wired to the `saving` variable computed above — computing it correctly is worthless if it is never passed through",
  );

  const mobileFieldIdx = src.indexOf('label="Mobile"');
  assert.ok(mobileFieldIdx >= 0, "a Mobile FormField must exist");
  const closeTagIdx = src.indexOf("</FormField>", mobileFieldIdx);
  assert.ok(closeTagIdx > mobileFieldIdx, "the Mobile FormField must close");
  const mobileFieldBlock = src.slice(mobileFieldIdx, closeTagIdx);

  assert.match(
    mobileFieldBlock,
    /readOnly=\{!canEditMobile\}/,
    "the mobile input must use readOnly, gated on !canEditMobile",
  );
  assert.ok(
    !/\bdisabled=/.test(mobileFieldBlock),
    "the mobile input must NOT use `disabled` — react-hook-form drops disabled fields from the submitted values entirely, which would make the WHOLE form unsubmittable while masked, not just the mobile field",
  );
});

// ── D continued. CustomerSearch (POS picker) — no coverage before this ─────
// Same hazard as CustomersPage's remote search, but the stakes are higher
// here: a tap on a stale row attaches the WRONG customer to a live bill, and
// the mistake can't be undone later (the order carries the wrong
// customerId). isPaused/isError must both read as "did not find out", never
// as "no matches".

test("PIN: CustomerSearch (POS picker) — rows are gated on a settled debounce, and isPaused/isError are ruled out before the generic 'No matches' text", () => {
  const src = stripComments(readSrc(CUSTOMER_SEARCH_COMPONENT));

  // Mutation this catches: dropping the settle gate (e.g. `const rows =
  // results ?? [];`) — a stale row from the PREVIOUS query would then render,
  // and once numbers are masked every row reads identically, so a tap
  // attaches the wrong customer to the bill.
  assert.match(
    src,
    /const\s+settled\s*=\s*debounced\.trim\(\)\s*===\s*term\.trim\(\)\s*;/,
    "rows must be gated on the debounce having caught up with what's typed (compared TRIMMED, matching the query key)",
  );
  assert.match(
    src,
    /const\s+rows\s*=\s*settled\s*\?\s*\(results\s*\?\?\s*\[\]\)\s*:\s*\[\]\s*;/,
    "rows must read `results` (the hook's own data) gated by `settled`, falling back to [] when not settled",
  );

  // The rendered list must map `rows` — mapping `results` directly would
  // bypass the settle gate entirely, even if `rows` is still computed above.
  assert.match(src, /\{rows\.map\(\(c\)\s*=>\s*\(/, "the rendered list must map `rows`");
  assert.ok(
    !/\{results\.map\(/.test(src),
    "the rendered list must not map `results` directly — that bypasses the settle gate above",
  );

  // Fail-closed precedence, pinned via the boolean conditions themselves
  // (this file is an if/JSX-condition chain, not sequential branches, so an
  // index-ordering check would be the wrong shape here): isPaused must be
  // ruled out before isError is checked, and both must be ruled out before
  // the generic no-matches text renders. Mutation this catches: reordering
  // any of the three so a plain "no such customer" answer can render while
  // the search is actually offline or failed.
  assert.match(
    src,
    /!searching\s*&&\s*isPaused\s*&&\s*\(/,
    "an offline search (isPaused) must be its own branch",
  );
  assert.match(
    src,
    /!searching\s*&&\s*!isPaused\s*&&\s*isError\s*&&\s*\(/,
    "a failed search (isError) must be checked only after isPaused has been ruled out",
  );
  assert.match(
    src,
    /!searching\s*&&\s*!isPaused\s*&&\s*!isError\s*&&\s*debounced\.trim\(\)\.length\s*>=\s*CUSTOMER_SEARCH_MIN_CHARS\s*&&\s*rows\.length\s*===\s*0\s*&&\s*\(/,
    "the generic 'No matches' text may render only once isPaused AND isError have both been ruled out — otherwise offline/failed reads as 'this customer does not exist', which ends with a duplicate record and an orphaned due",
  );
});

// ── D continued. mergeById — a pure function, pinned BEHAVIORALLY ──────────
// mergeById is not exported (this file has no test framework for React
// components, by design — see the header comment), so it can't be imported
// without modifying source. Instead of pinning its TEXT, extract the actual
// function body via readFileSync + brace-matching and execute it for real —
// this pins the real runtime behavior, not any particular phrasing of it.

test("PIN: CustomersPage — mergeById lets the REMOTE row win on field VALUES for an _id present in both lists (behavioral, not textual)", () => {
  const src = stripComments(readSrc(CUSTOMERS_PAGE));
  const fnStart = src.indexOf("function mergeById(");
  assert.ok(fnStart >= 0, "mergeById must exist");
  const braceOpenIdx = src.indexOf("{", fnStart);
  const braceCloseIdx = matchingBraceEnd(src, braceOpenIdx);
  const fnBody = src.slice(braceOpenIdx + 1, braceCloseIdx);

  // The body only touches its two parameters plus the global Map/Set — no
  // closure over other module bindings — so it can run standalone.
  type Row = { _id: string; totalDue: number };
  const mergeById = new Function("local", "remote", fnBody) as unknown as (
    local: Row[],
    remote: Row[],
  ) => Row[];

  // The stale field that matters in production: totalDue decides whether the
  // Receive-payment button shows at all. A local copy showing an ₹800 due,
  // superseded by a fresh fetch showing ₹500, must not survive the merge.
  const local: Row[] = [
    { _id: "shared", totalDue: 800 },
    { _id: "local-only", totalDue: 100 },
  ];
  const remote: Row[] = [
    { _id: "shared", totalDue: 500 },
    { _id: "remote-only", totalDue: 50 },
  ];
  const merged = mergeById(local, remote);

  const sharedRow = merged.find((c) => c._id === "shared");
  assert.ok(sharedRow, "the row present in both lists must survive the merge");
  assert.equal(
    sharedRow.totalDue,
    500,
    "the REMOTE row's totalDue must win for an _id present in both — mutation: swapping the `??` operands (`c ?? fresh.get(c._id)`) silently reverts to local precedence, because an object is never falsy so the remote branch would never be taken",
  );

  // Rows unique to either side must both survive.
  assert.ok(merged.some((c) => c._id === "local-only"), "a local-only row must survive the merge");
  assert.ok(merged.some((c) => c._id === "remote-only"), "a remote-only row must survive the merge");
  // No duplication of the shared id.
  assert.equal(
    merged.filter((c) => c._id === "shared").length,
    1,
    "the shared _id must appear exactly once — not duplicated by pushing remote's copy alongside local's",
  );
});
