// Task 12 (PIN lock, spec 2026-10-16 §5.3): the login page in the new look. Source pins keep the wiring that carries
// the guarantees (one look-up of the remembered people, the device remembered after a password sign-in, "Sign in
// with PIN" only when there is someone to pick); render tests prove the tiles, the search and the tabs; the pure
// helpers (the date line, the clock, the filter, what the pad shows) are checked at fixed values. The older login
// pins (branding-paths, masters-provider-paths, pos-layout-paths) run unchanged beside this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import type { KnownPerson } from "@/lib/pin-sign-in-client";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = path.resolve(__dirname, "..");
const exists = (rel: string): boolean => existsSync(path.join(CAFE_ROOT, rel));
const read = (rel: string): string => (exists(rel) ? stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8")) : "");

const PAGE = "app/(auth)/login/page.tsx";
const PIN = "components/auth/PinSignIn.tsx";
const SHELL = "components/auth/AuthShell.tsx";

const count = (src: string, needle: string): number => src.split(needle).length - 1;

/** The body of `const <name> = async (...) => { ... };`, by brace matching from its first `{`. */
function arrowBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = async`);
  if (start < 0) return "";
  const open = src.indexOf("{", src.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return "";
}

/** Visible text: tags dropped, whitespace collapsed. */
const textOf = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Each name tile's id and visible text. */
function tilesOf(html: string): { id: string; text: string; tag: string }[] {
  const out: { id: string; text: string; tag: string }[] = [];
  for (const m of html.matchAll(/(<button[^>]*data-staff-id="([^"]+)"[^>]*>)([\s\S]*?)<\/button>/g)) {
    out.push({ id: m[2], text: textOf(m[3]), tag: m[1] });
  }
  return out;
}

const person = (id: string, name: string, shortName: string, initials: string, role: "admin" | "staff"): KnownPerson => ({
  id,
  name,
  shortName,
  initials,
  role,
});

const THREE: KnownPerson[] = [
  person("p1", "Priya Sharma", "Priya S.", "PS", "admin"),
  person("p2", "Rohan Kapoor", "Rohan K.", "RK", "staff"),
  person("p3", "Meera Iyer", "Meera I.", "MI", "staff"),
];

const NINE: KnownPerson[] = [
  ...THREE,
  person("p4", "Ishita Das", "Ishita D.", "ID", "admin"),
  person("p5", "Neha Joshi", "Neha J.", "NJ", "staff"),
  person("p6", "Amit Verma", "Amit V.", "AV", "staff"),
  person("p7", "Ananya Bose", "Ananya B.", "AB", "staff"),
  person("p8", "Arjun Mehta", "Arjun M.", "AM", "staff"),
  person("p9", "Karan Singh", "Karan S.", "KS", "staff"),
];

const noop = () => {};

async function renderPinSignIn(props: Record<string, unknown>): Promise<string> {
  const { PinSignIn } = await import("@/components/auth/PinSignIn");
  return renderToStaticMarkup(
    createElement(PinSignIn, { people: THREE, onUsePassword: noop, onSignedIn: noop, ...props } as React.ComponentProps<
      typeof PinSignIn
    >),
  );
}

// ── The page ────────────────────────────────────────────────────────────────

test("PIN: the login page asks once, on mount, which people this device remembers, and opens on the tiles only when there are any", () => {
  const src = read(PAGE);
  assert.ok(src.length > 0, "landmark: the login page exists");
  assert.match(
    src,
    /import \{[^}]*\bfetchKnownPeople\b[^}]*\} from "@\/lib\/pin-sign-in-client";/,
    "the page imports fetchKnownPeople from lib/pin-sign-in-client",
  );
  assert.equal(count(src, "fetchKnownPeople("), 1, "exactly one fetchKnownPeople( call: one look-up per page load");
  assert.match(
    src,
    /useEffect\(\(\) => \{[^}]*?fetchKnownPeople\(\)[\s\S]*?\}, \[\]\);/,
    "the look-up runs in a mount-only useEffect (empty deps)",
  );
  assert.match(src, /type LoginMode = "loading" \| "pin" \| "password";/, "the page has the three modes");
  assert.match(src, /useState<LoginMode>\("loading"\)/, 'the page starts in "loading": no flash of either form');
  assert.match(src, /known\.length > 0 \? "pin" : "password"/, 'remembered people -> "pin", nobody -> "password"');
  assert.match(src, /<PinSignIn\b/, "the page renders <PinSignIn");
  assert.match(src, /onUsePassword=\{/, "PinSignIn's onUsePassword is wired (switches to the password form)");
  assert.match(src, /onSignedIn=\{finishSignIn\}/, "a PIN sign-in finishes exactly like a password one");
  for (const banned of ["setInterval(", "refetchInterval", "fetch("]) {
    const hits = banned === "fetch(" ? count(src.replace(/fetchKnownPeople\(/g, ""), banned) : count(src, banned);
    assert.equal(hits, 0, `the login page has no ${banned} of its own (no recurring request, no direct fetch)`);
  }
});

test("PIN: after a successful password sign-in the page remembers this device, then lands on the dashboard", () => {
  const src = read(PAGE);
  const finish = arrowBody(src, "finishSignIn");
  assert.ok(finish.length > 0, "landmark: the page has const finishSignIn = async () => { ... }");
  const remember = finish.indexOf("await rememberThisDevice()");
  const replace = finish.indexOf('router.replace("/")');
  const refresh = finish.indexOf("router.refresh()");
  assert.ok(remember >= 0, "finishSignIn awaits rememberThisDevice()");
  assert.ok(replace > remember, 'rememberThisDevice() comes before router.replace("/") (the remember call needs the new session, and runs once)');
  assert.ok(refresh > replace, "router.refresh() follows router.replace");

  const submit = arrowBody(src, "onSubmit");
  const credentials = submit.indexOf('signIn("credentials"');
  const refused = submit.indexOf('setAuthError("Invalid username or password")');
  const finishCall = submit.indexOf("await finishSignIn()");
  assert.ok(credentials >= 0, 'onSubmit still calls signIn("credentials"');
  assert.ok(refused > credentials, "a refused sign-in still shows Invalid username or password");
  assert.ok(finishCall > refused, "only a successful sign-in reaches finishSignIn (after the refusal's return)");
  assert.equal(count(submit, "router.replace("), 0, "onSubmit navigates only through finishSignIn");
});

test('PIN: "Sign in with PIN" shows only when this device remembers someone, after the password form', () => {
  const src = read(PAGE);
  assert.equal(count(src, "Sign in with PIN"), 1, 'one "Sign in with PIN" control');
  assert.match(
    src,
    /\{people\.length > 0 && \(\s*<button\b[^>]*type="button"[\s\S]*?Sign in with PIN/,
    '"Sign in with PIN" is a type="button" rendered only when people.length > 0',
  );
  assert.ok(src.indexOf("Sign in with PIN") > src.indexOf("</form>"), '"Sign in with PIN" sits after the form (the first <button is still the reveal toggle)');
});

// ── The shell ───────────────────────────────────────────────────────────────

test("PIN: AuthShell is the new card (no painting, postmark, stamp or brand card), and the retired pieces are gone", () => {
  const src = read(SHELL);
  assert.ok(src.length > 0, "landmark: AuthShell exists");
  for (const gone of ["PointillistScene", "Postmark", "StampFrame", "BrandCard"]) {
    assert.ok(!src.includes(gone), `AuthShell no longer uses ${gone}`);
  }
  assert.match(src, /import \{ VendorMark \} from "@\/components\/brand\/VendorMark";/, "VendorMark (Powered by Sandbee POS) stays");
  assert.match(src, /<VendorMark\b/, "the shell renders VendorMark");
  assert.match(src, /useNow\(/, "the header clock reads useNow");
  for (const prop of ["brandName", "logo", "title", "intro", "footer", "children"]) {
    assert.match(src, new RegExp(`\\b${prop}\\??:`), `AuthShell keeps its ${prop} prop`);
  }
  for (const file of [
    "components/brand/BrandCard.tsx",
    "components/brand/PointillistScene.tsx",
    "components/brand/Postmark.tsx",
    "components/brand/StampFrame.tsx",
    "lib/brand-art.ts",
    "lib/brand-art.test.ts",
    "lib/brand-steam.ts",
    "lib/brand-steam.test.ts",
    "lib/brand-scene.ts",
  ]) {
    assert.ok(!exists(file), `${file} is removed (nothing imports it any more)`);
  }
  assert.ok(exists("components/brand/VendorMark.tsx") && exists("lib/brand-time.ts"), "VendorMark and brand-time stay (used)");
});

// ── PinSignIn: source ───────────────────────────────────────────────────────

test("PIN: PinSignIn signs in through the shared client and words every refusal with pinFailureMessage, with no fetch of its own", () => {
  const src = read(PIN);
  assert.ok(src.length > 0, "landmark: PinSignIn exists");
  assert.match(src, /signInWithPin\(/, "PinSignIn calls signInWithPin(");
  assert.match(src, /pinFailureMessage\(/, "PinSignIn calls pinFailureMessage(");
  assert.equal(count(src, "fetch("), 0, "PinSignIn makes no fetch( of its own");
  for (const copy of [
    "Select your name to sign in",
    "Sign in with username and password",
    "Forgot PIN?",
    "Ask an admin to tell you or reset your PIN.",
    "All staff",
    "· Enter your 4-digit PIN",
    "Search staff",
  ]) {
    assert.ok(src.includes(copy), `PinSignIn holds the copy "${copy}"`);
  }
  assert.match(src, /<PinPad\b[^>]*\bkeyboard\b/, "the pad listens to the keyboard (a counter PC)");
  assert.match(src, /<StaffAvatar\b[^>]*seed=\{/, "avatars are seeded by the person's id, so a colour is stable");
  assert.match(src, /setInterval\(\s*tick,\s*WAIT_TICK_MS\s*\)/, "the wait counts down on a local timer");
  assert.match(src, /const WAIT_TICK_MS = 1_000;/, "the countdown ticks once a second");
});

// ── PinSignIn: pure helpers ─────────────────────────────────────────────────

test("PIN: the picker's greeting and date line, in fixed English", async () => {
  const { pinGreeting, pickerDateLabel } = await import("@/components/auth/PinSignIn");
  assert.equal(pickerDateLabel(new Date(2026, 9, 16, 20, 27)), "Friday, 16 October", "the mock-up's date line");
  assert.equal(pickerDateLabel(new Date(2027, 0, 3, 9, 0)), "Sunday, 3 January", "no zero padding; month in full");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 20, 27)), "Good evening", "evening, no full stop (the mock-up)");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 9, 0)), "Good morning", "morning");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 14, 0)), "Good afternoon", "afternoon");
});

test("PIN: the header clock reads h:mm AM/PM", async () => {
  const { clockLabel } = await import("@/components/auth/AuthShell");
  assert.equal(clockLabel(new Date(2026, 9, 16, 20, 27)), "8:27 PM", "evening");
  assert.equal(clockLabel(new Date(2026, 9, 16, 0, 5)), "12:05 AM", "just after midnight");
  assert.equal(clockLabel(new Date(2026, 9, 16, 12, 0)), "12:00 PM", "noon");
  assert.equal(clockLabel(new Date(2026, 9, 16, 9, 7)), "9:07 AM", "minutes zero-padded, hours not");
});

test("PIN: the tile filter keeps the role tab and the search together", async () => {
  const { visiblePeople } = await import("@/components/auth/PinSignIn");
  const ids = (list: KnownPerson[]) => list.map((p) => p.id).join(",");
  assert.equal(ids(visiblePeople(NINE, "all", "")), NINE.map((p) => p.id).join(","), "all, no search: everyone, in order");
  assert.equal(ids(visiblePeople(NINE, "admin", "")), "p1,p4", "Admin: the two admins");
  assert.equal(ids(visiblePeople(NINE, "staff", "")).split(",").length, 7, "Staff: the seven others");
  assert.equal(ids(visiblePeople(NINE, "all", "  ro ")), "p2", "a trimmed, case-insensitive name search");
  assert.equal(ids(visiblePeople(NINE, "admin", "rohan")), "", "the search stays inside the chosen tab");
  assert.equal(ids(visiblePeople(NINE, "all", "kapoor")), "p2", "the full name is searched, not only the short one");
});

test("PIN: what the pad shows for each answer (wrong keeps it enabled; a wait or a block disables it)", async () => {
  const { pinPadView } = await import("@/components/auth/PinSignIn");
  assert.deepEqual(pinPadView({ failure: null, waitLeftSec: 0, busy: false }), { message: null, disabled: false }, "idle");
  assert.deepEqual(pinPadView({ failure: null, waitLeftSec: 0, busy: true }), { message: null, disabled: true }, "a try in flight");
  assert.deepEqual(
    pinPadView({ failure: { kind: "wrong", triesLeft: 3 }, waitLeftSec: 0, busy: false }),
    { message: "Incorrect PIN · 3 tries left", disabled: false },
    "wrong: the tries left, the pad enabled",
  );
  assert.deepEqual(
    pinPadView({ failure: { kind: "wrong", triesLeft: 0 }, waitLeftSec: 0, busy: false }),
    { message: "Incorrect PIN", disabled: false },
    "wrong with none left: the pad stays enabled (the next try answers the wait)",
  );
  assert.deepEqual(
    pinPadView({ failure: null, waitLeftSec: 540, busy: false }),
    { message: "Too many wrong PINs. Try again in 9 min.", disabled: true },
    "a wait: disabled, the minutes left",
  );
  assert.deepEqual(
    pinPadView({ failure: null, waitLeftSec: 61, busy: false }).message,
    "Too many wrong PINs. Try again in 2 min.",
    "the countdown's line follows the seconds left",
  );
  assert.equal(pinPadView({ failure: { kind: "blocked" }, waitLeftSec: 0, busy: false }).disabled, true, "blocked: disabled");
  assert.equal(pinPadView({ failure: { kind: "offline" }, waitLeftSec: 0, busy: false }).disabled, false, "offline: try again");
});

// ── PinSignIn: render ───────────────────────────────────────────────────────

test("PIN: three remembered people -> three named tiles with their roles, no search and no tabs", async () => {
  const html = await renderPinSignIn({ people: THREE });
  const tiles = tilesOf(html);
  assert.deepEqual(tiles.map((t) => t.id), ["p1", "p2", "p3"], "one tile per person, in the order given");
  const expected: [string, string][] = [
    ["Priya S.", "Admin"],
    ["Rohan K.", "Staff"],
    ["Meera I.", "Staff"],
  ];
  expected.forEach(([name, role], i) => {
    assert.ok(tiles[i].text.includes(name), `tile ${i + 1} shows ${name} (got "${tiles[i].text}")`);
    assert.ok(tiles[i].text.endsWith(role), `tile ${i + 1} shows the role ${role} under the name (got "${tiles[i].text}")`);
    assert.ok(tiles[i].tag.includes('type="button"'), `tile ${i + 1} is a type="button"`);
  });
  assert.ok(!html.includes('placeholder="Search staff"'), "no search field for three people");
  assert.ok(!html.includes('role="tablist"'), "no role tabs for three people");
  const text = textOf(html);
  assert.ok(text.includes("Select your name to sign in"), "the picker's line");
  assert.ok(text.includes("Sign in with username and password"), "the way to the password form, under the tiles");
});

test("PIN: nine remembered people -> the search field and the tabs All staff 9 / Admin 2 / Staff 7", async () => {
  const html = await renderPinSignIn({ people: NINE });
  assert.equal(tilesOf(html).length, 9, "nine tiles on the All staff tab");
  assert.ok(html.includes('placeholder="Search staff"'), "the search field shows above 8 people");
  assert.ok(html.includes('role="tablist"'), "the role tabs show above 8 people");
  const text = textOf(html);
  for (const tab of ["All staff 9", "Admin 2", "Staff 7"]) {
    assert.ok(text.includes(tab), `the tab "${tab}"`);
  }
});

test("PIN: a highlighted person (the lock screen's locker) shows the label in place of the role", async () => {
  const html = await renderPinSignIn({ people: THREE, highlight: { id: "p1", label: "Locked · 3 min ago" } });
  const [first, second] = tilesOf(html);
  assert.ok(first.text.endsWith("Locked · 3 min ago"), `the highlighted tile carries the label (got "${first.text}")`);
  assert.ok(!first.text.includes("Admin"), "the label replaces the role");
  assert.ok(first.tag.includes('data-highlight="true"'), "the highlighted tile is marked");
  assert.ok(!second.tag.includes('data-highlight="true"'), "only that tile is marked");
});
