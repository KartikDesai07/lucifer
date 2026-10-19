// Task 11 (PIN lock): source pins for the PIN sign-in wiring (spec 2026-10-16 §5.3-5.4). The behaviour of
// the two routes is proved by part C of scripts/verify-staff-pin-live.ts; these pins keep the shapes that
// carry the guarantees (the device check, the tenant check, no PIN ever read, the edge config stays edge-safe).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const AUTH = "apps/cafe/lib/auth.ts";
const AUTH_CONFIG = "apps/cafe/auth.config.ts";
const KNOWN = "apps/cafe/app/api/sign-in/known/route.ts";
const REMEMBER = "apps/cafe/app/api/sign-in/remember/route.ts";
const CLIENT = "apps/cafe/lib/pin-sign-in-client.ts";
const SIGNIN = "apps/cafe/lib/staff-pin-signin.ts";

test("PIN: lib/auth.ts has the pin provider, reads the device cookie from the request and throws a CredentialsSignin subclass", () => {
  const s = src(AUTH);
  assert.match(s, /id:\s*"pin"/, 'lib/auth.ts declares a provider with id: "pin"');
  assert.match(s, /credentials:\s*\{\s*staffId:\s*\{\s*\},\s*pin:\s*\{\s*\}\s*\}/, "the pin provider's credentials are { staffId: {}, pin: {} }");
  assert.match(s, /import NextAuth,\s*\{\s*CredentialsSignin\s*\}\s*from\s*"next-auth"/, "CredentialsSignin is imported from next-auth");
  assert.match(s, /class PinSignInError extends CredentialsSignin/, "PinSignInError extends CredentialsSignin");
  assert.match(s, /this\.code\s*=\s*encodePinFailure\(/, "the error's code comes from encodePinFailure(");
  assert.match(s, /verifyStaffPinSignIn\(/, "authorize calls verifyStaffPinSignIn(");
  assert.match(s, /readPinDevice\(/, "authorize calls readPinDevice(");
  assert.match(
    s,
    /cookieValue\(\s*request\.headers\.get\("cookie"\),\s*PIN_DEVICE_COOKIE\s*\)/,
    'the device cookie is read from the request: cookieValue(request.headers.get("cookie"), PIN_DEVICE_COOKIE)',
  );
  assert.match(
    s,
    /pinDeviceKey\(\s*process\.env\.AUTH_SECRET\s*\?\?\s*process\.env\.NEXTAUTH_SECRET\s*\)/,
    "the signing key comes from AUTH_SECRET ?? NEXTAUTH_SECRET",
  );
  assert.match(s, /throw new PinSignInError\(/, "a failed try throws PinSignInError(");
  assert.ok(
    !/pruneRateWindows/.test(s),
    "authorize never prunes: a shape or device refusal answers before connectDB, and a prune there buffers 10 s on a cold instance",
  );
});

test("PIN: the rate-window prune runs inside verifyStaffPinSignIn only once the try has reached the database", () => {
  const s = src(SIGNIN);
  const shape = s.indexOf("return SHAPE_FAILURE");
  const device = s.indexOf('kind: "device"');
  const connect = s.indexOf("await connectDB()");
  const prune = s.indexOf("pruneRateWindows(");
  assert.ok(shape >= 0 && device >= 0 && connect >= 0 && prune >= 0, "the shape and device refusals, connectDB() and the prune are all present");
  assert.ok(shape < connect && device < connect, "the shape and device refusals answer before connectDB()");
  assert.ok(prune > connect, "pruneRateWindows( comes after await connectDB()");
  assert.equal((s.match(/pruneRateWindows\(/g) ?? []).length, 1, "exactly one prune call");
  assert.ok(prune < s.indexOf("hitRateLimit("), "the prune is started before the slot is taken, so it runs beside the check");
  assert.match(s, /finally\s*\{\s*await pruned;?\s*\}/, "the prune is awaited in a finally, after the answer is known");
});

test("PIN: lib/auth.ts keeps one sign-in branch in jwt for both providers (the PIN user is stamped like the password user)", () => {
  const s = src(AUTH);
  assert.equal((s.match(/if \(user\) \{/g) ?? []).length, 1, "jwt has exactly one `if (user) {` sign-in branch");
  assert.equal((s.match(/Credentials\(\{/g) ?? []).length, 2, "lib/auth.ts has exactly two Credentials providers");
});

test("PIN: auth.config.ts has the edge stub for the pin provider and stays edge-safe", () => {
  const s = src(AUTH_CONFIG);
  assert.match(
    s,
    /Credentials\(\{\s*id:\s*"pin",\s*credentials:\s*\{\s*staffId:\s*\{\s*\},\s*pin:\s*\{\s*\}\s*\},\s*authorize:\s*\(\)\s*=>\s*null,?\s*\}\)/,
    'auth.config.ts has Credentials({ id: "pin", credentials: { staffId: {}, pin: {} }, authorize: () => null })',
  );
  assert.equal((s.match(/authorize:\s*\(\)\s*=>\s*null/g) ?? []).length, 2, "both edge providers are stubs: authorize: () => null twice");
  for (const banned of ["mongoose", "@/lib/db", "@/models/", "@/lib/pin-device", "@/lib/staff-pin-signin", "node:"]) {
    assert.ok(!s.includes(banned), `auth.config.ts (edge) must not import ${banned}`);
  }
});

test("PIN: GET /api/sign-in/known does the tenant check first, reads only active people with a PIN, never the PIN, and is no-store", () => {
  const s = src(KNOWN);
  assert.match(s, /export async function GET\(/, "the route exports GET");
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)\(/.test(s), "the route exports no write verb");
  assert.match(s, /resolveTenantFromHost\(\s*req\.headers\.get\("host"\)\s*\)/, 'the tenant comes from resolveTenantFromHost(req.headers.get("host"))');
  assert.match(s, /process\.env\.TENANT_ID/, "the tenant is checked against process.env.TENANT_ID");
  assert.match(s, /"Not found",\s*\{\s*status:\s*404\s*\}/, 'a tenant mismatch answers 404 "Not found"');
  assert.match(s, /hasPin:\s*true/, "the read keeps hasPin: true");
  assert.match(s, /isActive:\s*true/, "the read keeps isActive: true");
  assert.match(s, /\.select\(\s*"name role"\s*\)/, 'the read selects exactly "name role"');
  assert.ok(!/\+pin/.test(s), "the route never selects +pin");
  assert.ok(!/\bpinBlocked\b|\bpinFail/.test(s), "the route never reads the PIN's block or fail fields");
  assert.match(s, /no-store/, "the answer is no-store");
  assert.match(s, /readPinDevice\(/, "the people come from the signed device cookie (readPinDevice()");
  const tenant = s.indexOf("resolveTenantFromHost(");
  assert.ok(tenant >= 0 && tenant < s.indexOf("cookies("), "the tenant check comes before the cookie read");
  assert.ok(tenant < s.indexOf("connectDB("), "the tenant check comes before connectDB(");
  assert.ok(s.indexOf("readPinDevice(") < s.indexOf("connectDB("), "a missing or bad cookie answers before connectDB(");
});

test("PIN: POST /api/sign-in/remember calls requireAuth( first, remembers only a valid session id, and sets the cookie with pinDeviceCookieOptions()", () => {
  const s = src(REMEMBER);
  assert.match(s, /export async function POST\(/, "the route exports POST");
  const guard = s.indexOf("requireAuth(");
  assert.ok(guard >= 0, "the route calls requireAuth(");
  assert.ok(guard < s.indexOf("cookies("), "requireAuth( comes before the cookie read");
  assert.ok(guard < s.indexOf("pinDeviceKey("), "requireAuth( comes before the signing key");
  assert.match(s, /rememberPerson\(/, "the route calls rememberPerson(");
  assert.match(s, /signPinDevice\(/, "the route signs the new list with signPinDevice(");
  assert.match(s, /pinDeviceCookieOptions\(\)/, "the cookie is set with pinDeviceCookieOptions()");
  assert.match(s, /\/\^\[0-9a-f\]\{24\}\$\//, "the session id must match /^[0-9a-f]{24}$/ before it is remembered");
  assert.match(s, /remembered:\s*false/, "no key or a bad id answers { remembered: false }");
  assert.match(s, /remembered:\s*true/, "a remembered person answers { remembered: true }");
});

test("PIN: lib/pin-sign-in-client.ts is client-safe and maps every answer to a PinSignInFailure", () => {
  const s = src(CLIENT);
  assert.ok(!/from\s*"@\/models/.test(s), "pin-sign-in-client.ts must not import from @/models");
  assert.ok(!/from\s*"@\/lib\/db"/.test(s), "pin-sign-in-client.ts must not import from @/lib/db");
  assert.ok(!/from\s*"mongoose"/.test(s), "pin-sign-in-client.ts must not import mongoose");
  assert.ok(!/from\s*"@\/lib\/(pin-device|staff-pin-signin|auth)"/.test(s), "pin-sign-in-client.ts must not import a server-only sign-in module");
  assert.match(s, /signIn\(\s*"pin",\s*\{\s*staffId,\s*pin,\s*redirect:\s*false\s*\}\s*\)/, 'signInWithPin calls signIn("pin", { staffId, pin, redirect: false })');
  assert.match(
    s,
    /signIn\(\s*"credentials",\s*\{\s*username,\s*password,\s*redirect:\s*false\s*\}\s*\)/,
    'signInWithPassword calls signIn("credentials", { username, password, redirect: false })',
  );
  assert.match(s, /navigator\.onLine === false/, "an offline device answers offline before the call");
  assert.match(s, /parsePinFailure\(\s*result\.code\s*\)/, "a refused try is parsed from result.code");
  assert.match(s, /"\/api\/sign-in\/known"/, "fetchKnownPeople reads /api/sign-in/known");
  assert.match(s, /"\/api\/sign-in\/remember",\s*"POST"/, "rememberThisDevice POSTs /api/sign-in/remember");
  assert.ok(!/window\.location/.test(s), "the helpers never navigate");
});

test("PIN (ruling R8): both sign-ins ask getProviders() first and never call signIn when it finds no server", () => {
  const s = src(CLIENT);
  assert.match(s, /import \{[^}]*\bgetProviders\b[^}]*\} from "next-auth\/react"/, "getProviders is imported from next-auth/react");
  const guard = s.indexOf("getProviders()");
  assert.ok(guard >= 0, "the helper calls getProviders()");
  for (const call of ['signIn("pin"', 'signIn("credentials"']) {
    const at = s.indexOf(call);
    assert.ok(at > guard, `${call} comes after the getProviders() guard`);
  }
  assert.equal((s.match(/await reachServer\(/g) ?? []).length, 2, "both signInWithPin and signInWithPassword await the reachServer( guard");
  assert.match(s, /if \(!providers\) return "offline"/, "no provider list (the server cannot be reached) -> offline, before signIn");
});

// U0 match Task 6 (design 7): the sales reveal checks the signed-in person's own PIN on the server. The behaviour (a
// signed-out caller refused, the right PIN ok, a wrong PIN in the same window as a PIN sign-in) is proved by part E of
// scripts/verify-staff-pin-live.ts; these pins keep the shapes that carry it.
const VERIFY = "apps/cafe/app/api/sign-in/verify-pin/route.ts";

test("PIN (reveal): POST /api/sign-in/verify-pin calls requireAuth( first and checks only the session's own person, no-store", () => {
  const s = src(VERIFY);
  assert.match(s, /export async function POST\(/, "the route exports POST");
  assert.ok(!/export async function (GET|PUT|PATCH|DELETE)\(/.test(s), "the route exports no other verb");
  const guard = s.indexOf("requireAuth(");
  assert.ok(guard >= 0, "the route calls requireAuth(");
  assert.ok(guard < s.indexOf("req.json("), "requireAuth( comes before the body is read");
  assert.ok(guard < s.indexOf("verifyOwnStaffPin("), "requireAuth( comes before the PIN check");
  assert.match(s, /verifyOwnStaffPin\(\s*\{\s*staffId:\s*guard\.session\.user\.id,/, "the staff id is the session's own (guard.session.user.id)");
  assert.ok(!/body[^;\n]*\.staffId|\bstaffId\s*\}\s*=\s*body/.test(s), "the body's staffId is never read");
  assert.match(s, /encodePinFailure\(/, "a refusal answers the PIN sign-in's own code (encodePinFailure()");
  assert.match(s, /no-store/, "the answer is no-store");
  assert.ok(!/\+pin|Staff\.|connectDB\(/.test(s), "the route reads nothing itself: the check lives in lib/staff-pin-signin.ts");
});

test("PIN (reveal): verifyOwnStaffPin shares the sign-in's one check (one slot, one compare, one prune) without the device step", () => {
  const s = src(SIGNIN);
  assert.match(s, /export async function verifyOwnStaffPin\(/, "lib/staff-pin-signin.ts exports verifyOwnStaffPin");
  assert.equal((s.match(/hitRateLimit\(/g) ?? []).length, 1, "one hitRateLimit( call serves both checks");
  assert.equal((s.match(/timingSafeEqual\(/g) ?? []).length, 1, "one constant-time compare serves both checks");
  const own = s.slice(s.indexOf("export async function verifyOwnStaffPin("));
  const ownBody = own.slice(0, own.indexOf("\n}\n"));
  assert.ok(!/devicePeople|kind: "device"/.test(ownBody), "the own-PIN check has no device step (the person is already signed in)");
  assert.match(ownBody, /isObjectIdString\(staffId\)\s*\|\|\s*!isValidStaffPin\(pin\)/, "the shape is checked first, as in the sign-in");
});
