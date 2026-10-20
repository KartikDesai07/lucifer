/**
 * Part C of the staff PIN live leg: the device's remembered people (spec 2026-10-16 §5.2-5.3), through the
 * REAL route handlers GET /api/sign-in/known and POST /api/sign-in/remember. auth() is the harness's stub
 * (signInAs), cookies() the harness's jar of Next's own cookie classes; the device cookie each answer sets is
 * carried by hand into the next call, as a browser would. Rows are seeded through the raw collection, and A's
 * PIN is set through the real admin route (PUT /api/staff/[id]).
 */
import mongoose from "mongoose";
import { PIN_DEVICE_COOKIE, PIN_DEVICE_MAX_AGE_SECONDS } from "@pos/shared/staff-pin";
import { dataOf, type Harness, type RouteRes, type StubUser } from "./verify-staff-pin-live-helpers";

const A = "665f0000000000000000d001"; // active staff, no PIN until the admin sets one
const B = "665f0000000000000000d002"; // has a PIN, remembered, then deactivated
const C = "665f0000000000000000d003"; // active, no PIN (a row from before this release: no PIN keys at all)
const D = "665f0000000000000000d004"; // active admin with a PIN
const A_PIN = "7391";
const KNOWN_KEYS = ["id", "initials", "name", "role", "shortName"];

const stubUser = (id: string, name: string, role: "admin" | "staff" = "staff"): StubUser => ({ id, name, role });
const ASHA = stubUser(A, "Asha Rao");
const BALA = stubUser(B, "Bala Iyer");
const CHITRA = stubUser(C, "Chitra Das");
const DEV = stubUser(D, "Dev Shah", "admin");

function staffCol() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  return db.collection("staffs");
}

async function seed(): Promise<void> {
  const oid = (id: string) => new mongoose.Types.ObjectId(id);
  const base = { mobile: "9876500000", password: "not-a-real-hash", createdAt: new Date(), updatedAt: new Date() };
  await staffCol().insertMany([
    { ...base, _id: oid(A), name: ASHA.name, username: "pinc-a", role: "staff", isActive: true, hasPin: false, pinBlocked: false },
    { ...base, _id: oid(B), name: BALA.name, username: "pinc-b", role: "staff", isActive: true, pin: "5820", hasPin: true, pinBlocked: false },
    { ...base, _id: oid(C), name: CHITRA.name, username: "pinc-c", role: "staff", isActive: true },
    { ...base, _id: oid(D), name: DEV.name, username: "pinc-d", role: "admin", isActive: true, pin: "6142", hasPin: true, pinBlocked: false },
  ]);
}

type Known = Record<string, unknown>;
const peopleOf = (res: RouteRes): Known[] => {
  const people = dataOf(res).people;
  return Array.isArray(people) ? (people as Known[]) : [];
};
const idsOf = (res: RouteRes): string => peopleOf(res).map((p) => String(p.id)).join(",");
const deviceLine = (res: RouteRes): string | undefined => res.setCookie.find((line) => line.startsWith(`${PIN_DEVICE_COOKIE}=`));
/** The Cookie header a browser sends back for the device cookie this answer set ("" when it set none). */
const cookieFrom = (res: RouteRes): string => deviceLine(res)?.split(";")[0] ?? "";
const valueOf = (cookie: string): string => cookie.slice(cookie.indexOf("=") + 1);
const remembered = (res: RouteRes): unknown => dataOf(res).remembered;

export async function runPartC(h: Harness): Promise<void> {
  const { check } = h;
  console.log("\n  Part C - the device's remembered people (sign-in routes)");
  const saved = { AUTH_SECRET: process.env.AUTH_SECRET, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET, TENANT_ID: process.env.TENANT_ID };
  process.env.AUTH_SECRET = "live-leg-only-auth-secret-part-c";
  delete process.env.TENANT_ID;
  try {
    await seed();
    const routes = h.signInRoutes;

    const none = await routes.known();
    check(
      "GET known with no cookie -> 200 { people: [] }, Cache-Control no-store",
      none.status === 200 && Array.isArray(dataOf(none).people) && peopleOf(none).length === 0 && none.cacheControl === "no-store",
      none,
    );

    const strange = await routes.known({ host: "evil.example" });
    process.env.TENANT_ID = "another-cafe";
    const otherTenant = await routes.known();
    delete process.env.TENANT_ID;
    check(
      "GET known from an unknown host, or for another TENANT_ID -> 404 (the tenant check the middleware does not do for /api)",
      strange.status === 404 && otherTenant.status === 404,
      strange,
    );

    h.signInAs(null);
    const anon = await routes.remember();
    check("POST remember with no session -> 401, no device cookie set", anon.status === 401 && !deviceLine(anon), anon);

    h.signInAs(ASHA);
    const first = await routes.remember();
    const line = deviceLine(first) ?? "";
    check(
      `POST remember as A -> 200 { remembered: true } and a Set-Cookie ${PIN_DEVICE_COOKIE} with HttpOnly, SameSite=lax, ` +
        `Max-Age=${PIN_DEVICE_MAX_AGE_SECONDS}, Path=/ (got "${line.replace(/=[^;]*/, "=<value>")}")`,
      first.status === 200 &&
        remembered(first) === true &&
        line.includes("; HttpOnly") &&
        line.includes("; SameSite=lax") &&
        line.includes("; Max-Age=34560000") &&
        line.includes("; Path=/"),
      first,
    );
    const onlyA = cookieFrom(first);

    const noPinYet = await routes.known({ cookie: onlyA });
    check("GET known with A remembered but A has no PIN yet -> []", noPinYet.status === 200 && peopleOf(noPinYet).length === 0, noPinYet);

    h.setRole("admin");
    const set = await h.staff.update(A, { pin: A_PIN });
    const withA = await routes.known({ cookie: onlyA });
    const tile = peopleOf(withA)[0] ?? {};
    check(
      "after an admin sets A's PIN, GET known with the same cookie -> [A] as { id, name, shortName, initials, role } and nothing else",
      set.status === 200 &&
        withA.status === 200 &&
        idsOf(withA) === A &&
        tile.name === "Asha Rao" &&
        tile.shortName === "Asha R." &&
        tile.initials === "AR" &&
        tile.role === "staff" &&
        Object.keys(tile).sort().join(",") === KNOWN_KEYS.join(",") &&
        !JSON.stringify(withA.body).includes(A_PIN) &&
        withA.cacheControl === "no-store",
      withA,
    );

    // C (no PIN), B (has a PIN) and D (an admin with a PIN) sign in on this device after A, in that order.
    let cookie = onlyA;
    const chain: RouteRes[] = [];
    for (const person of [CHITRA, BALA, DEV]) {
      h.signInAs(person);
      const res = await routes.remember(cookie);
      chain.push(res);
      cookie = cookieFrom(res);
    }
    await staffCol().updateOne({ _id: new mongoose.Types.ObjectId(B) }, { $set: { isActive: false } });
    const four = await routes.known({ cookie });
    check(
      `four people remembered (A, C, B, D), B since deactivated -> [D, A]: newest first, not C (no PIN), not B (inactive) (got ${idsOf(four)})`,
      chain.every((r) => remembered(r) === true && Boolean(deviceLine(r))) &&
        four.status === 200 &&
        idsOf(four) === `${D},${A}` &&
        peopleOf(four)[0]?.role === "admin",
      four,
    );

    h.signInAs(ASHA);
    const again = await routes.remember(cookie);
    const reordered = await routes.known({ cookie: cookieFrom(again) });
    check(
      `A signs in again on this device -> A moves to the front: [A, D] (got ${idsOf(reordered)})`,
      remembered(again) === true && idsOf(reordered) === `${A},${D}`,
      reordered,
    );

    const [payload, signature = ""] = valueOf(cookie).split(".");
    const flipped = `${PIN_DEVICE_COOKIE}=${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    const forged = `${PIN_DEVICE_COOKIE}=${valueOf(onlyA).split(".")[0]}.${signature}`; // A-only list, another list's signature
    const garbage = `${PIN_DEVICE_COOKIE}=garbage`;
    const results = await Promise.all([flipped, forged, garbage].map((c) => routes.known({ cookie: c })));
    check(
      "a tampered cookie (signature changed, or a list carrying another list's signature, or garbage) -> [] each time",
      results.every((r) => r.status === 200 && peopleOf(r).length === 0),
      results.find((r) => peopleOf(r).length > 0),
    );

    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const noKey = await routes.remember(cookie);
    const noKeyKnown = await routes.known({ cookie });
    process.env.AUTH_SECRET = "live-leg-only-auth-secret-part-c";
    check(
      "with no signing key: POST remember -> 200 { remembered: false } with no cookie set; GET known -> []",
      noKey.status === 200 && remembered(noKey) === false && !deviceLine(noKey) && peopleOf(noKeyKnown).length === 0,
      noKey,
    );

    const badIds = ["not-a-staff-id", A.toUpperCase(), `${A}0`];
    const bad: RouteRes[] = [];
    for (const id of badIds) {
      h.signInAs(stubUser(id, "Odd Session"));
      bad.push(await routes.remember(cookie));
    }
    check(
      "a session id that is not 24 lower-case hex (would poison the cookie) -> 200 { remembered: false }, no cookie set",
      bad.every((r) => r.status === 200 && remembered(r) === false && !deviceLine(r)),
      bad.find((r) => remembered(r) !== false || deviceLine(r)),
    );
  } finally {
    h.setRole("admin");
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
