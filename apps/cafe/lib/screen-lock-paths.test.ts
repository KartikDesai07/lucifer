// Task 15 (PIN lock, spec 2026-10-16 §5.6): the lock is a COVER over the running dashboard, never a sign-out, so the
// print host, the pulse, the alarm and realtime stay mounted under it. Source pins hold the wiring that carries those
// guarantees (the layout order, the cover's isolation, no request on the idle clock, no POS/cart import); render tests
// prove the lock's password form (labels, ids, copy). The layout's older pins (pos-layout-paths, print-host-paths,
// order-request-paths, print-routing, realtime-live-state, session-rolling, token-sheet-paths, settings-shell-paths,
// print-fonts-paths, pos-install-paths) run unchanged beside this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver, keepPreviousData, type QueryObserverResult } from "@tanstack/react-query";

import { stripComments } from "./source-pin-utils";
import { clearPersonScopedQueries, refetchPersonScopedQueries, unlockPlan } from "./screen-lock";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = path.resolve(__dirname, "..");
const exists = (rel: string): boolean => existsSync(path.join(CAFE_ROOT, rel));
const raw = (rel: string): string => (exists(rel) ? readFileSync(path.join(CAFE_ROOT, rel), "utf8") : "");
const read = (rel: string): string => stripComments(raw(rel));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const LAYOUT = "app/(dashboard)/layout.tsx";
const COVER = "components/lock/ScreenLock.tsx";
const FORM = "components/lock/LockPasswordForm.tsx";
const SCRIPT_MODULE = "lib/screen-lock-script.ts";
const LOCK_MODULE = "lib/screen-lock.ts";
const ACCOUNT = "components/layout/SidebarAccount.tsx";
const CSS = "app/globals.css";
const LOGIN = "app/(auth)/login/page.tsx";

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

// ── The layout ──────────────────────────────────────────────────────────────

test("PIN: the dashboard layout runs the no-flash script before <SidebarProvider>, and mounts <ScreenLock /> once, after <SessionKeepalive /> and before <AppSidebar (inside MasterDataProvider)", () => {
  const src = raw(LAYOUT);
  assert.ok(src.length > 0, "landmark: the dashboard layout exists");
  const script = src.indexOf("<script>{SCREEN_LOCK_SCRIPT}</script>");
  const provider = src.indexOf("<SidebarProvider>");
  assert.ok(script >= 0, "the layout renders <script>{SCREEN_LOCK_SCRIPT}</script> (a plain string child)");
  assert.ok(provider >= 0, "landmark: the layout still renders a bare <SidebarProvider>");
  assert.ok(script < provider, "the no-flash script comes before <SidebarProvider> (it runs before the shell paints)");

  const keepalive = src.search(/<SessionKeepalive\s*\/>/);
  const lock = src.search(/<ScreenLock\s*\/>/);
  const sidebar = src.indexOf("<AppSidebar");
  assert.ok(keepalive >= 0, "landmark: <SessionKeepalive /> is still mounted");
  assert.ok(lock >= 0, "the layout mounts <ScreenLock />");
  assert.ok(sidebar >= 0, "landmark: <AppSidebar is still mounted");
  assert.ok(keepalive < lock && lock < sidebar, "<SessionKeepalive /> < <ScreenLock /> < <AppSidebar in the layout");
  assert.equal((src.match(/<ScreenLock\s*\/>/g) ?? []).length, 1, "exactly one <ScreenLock /> per tab");

  const masterOpen = src.indexOf("<MasterDataProvider>");
  const masterClose = src.indexOf("</MasterDataProvider>");
  assert.ok(masterOpen < lock && lock < masterClose, "<ScreenLock /> sits inside MasterDataProvider, so useSettings reads the seeded copy");
});

test("PIN: the server layout imports the script only from the dependency-free lib/screen-lock-script (ruling R16), never lib/screen-lock", () => {
  const src = read(LAYOUT);
  assert.match(
    src,
    /import \{ SCREEN_LOCK_SCRIPT \} from "@\/lib\/screen-lock-script";/,
    "the layout imports SCREEN_LOCK_SCRIPT from @/lib/screen-lock-script",
  );
  assert.ok(!/from "@\/lib\/screen-lock"/.test(src), "the layout never imports @/lib/screen-lock (it reaches a use-client module)");
  assert.match(src, /import \{ ScreenLock \} from "@\/components\/lock\/ScreenLock";/, "the layout imports ScreenLock");
  assert.ok(!/use client/.test(src.slice(0, 200)), "the layout stays a server component");

  const mod = read(SCRIPT_MODULE);
  assert.ok(mod.length > 0, "landmark: lib/screen-lock-script.ts exists");
  assert.ok(!/\bimport\b/.test(mod), "lib/screen-lock-script.ts imports nothing");
  assert.ok(!/use client/.test(mod), "lib/screen-lock-script.ts carries no use-client directive");
  for (const name of ["SCREEN_LOCK_SCRIPT", "LOCK_ATTR", "LOCK_READY_ATTR", "SCREEN_LOCK_STORAGE_KEY"]) {
    assert.match(mod, new RegExp(`export const ${name}\\b`), `lib/screen-lock-script.ts exports ${name}`);
  }
  assert.match(read(LOCK_MODULE), /from "\.\/screen-lock-script"/, "lib/screen-lock.ts re-exports the script module");
});

test("PIN: the root <html> carries suppressHydrationWarning (the no-flash script sets data-pos-locked on it before React hydrates)", () => {
  const src = read("app/layout.tsx");
  const html = src.match(/<html\b[^>]*>/);
  assert.ok(html, "landmark: the root layout renders <html>");
  assert.match(html![0], /\bsuppressHydrationWarning\b/, "the root <html> tag has suppressHydrationWarning");
  assert.equal(count(src, "suppressHydrationWarning"), 1, "only on <html>: nothing below it is excused");
});

test("the script module and lib/screen-lock.ts agree: one storage key, one attribute, and the script reads that key", async () => {
  const script = await import("@/lib/screen-lock-script");
  const lock = await import("@/lib/screen-lock");
  assert.equal(lock.SCREEN_LOCK_SCRIPT, script.SCREEN_LOCK_SCRIPT, "the same script string");
  assert.equal(lock.LOCK_ATTR, script.LOCK_ATTR, "the same lock attribute");
  assert.equal(lock.LOCK_READY_ATTR, script.LOCK_READY_ATTR, "the same ready attribute");
  assert.equal(lock.SCREEN_LOCK_STORAGE_KEY, script.SCREEN_LOCK_STORAGE_KEY, "the same storage key");
  assert.ok(script.SCREEN_LOCK_SCRIPT.includes(JSON.stringify(script.SCREEN_LOCK_STORAGE_KEY)), "the script reads the storage key");
  assert.ok(script.SCREEN_LOCK_SCRIPT.includes(JSON.stringify(script.LOCK_ATTR)), "the script sets the lock attribute");
});

// ── The cover ───────────────────────────────────────────────────────────────

test("PIN: ScreenLock is a portal over everything (dialog, modal, labelled, z-[100]) that makes the rest of the body inert", () => {
  const src = read(COVER);
  assert.ok(src.length > 0, "landmark: components/lock/ScreenLock.tsx exists");
  assert.match(src.slice(0, 40), /"use client"/, "ScreenLock is a client component");
  assert.match(src, /createPortal\(/, "the cover is a portal");
  assert.match(src, /document\.body\s*,?\s*\)/, "the portal goes into document.body");
  for (const needle of ['role="dialog"', 'aria-modal="true"', 'aria-label="Screen locked"', "data-screen-lock", "z-[100]", "fixed inset-0"]) {
    assert.ok(src.includes(needle), `the cover carries ${needle}`);
  }
  assert.match(src, /setAttribute\("inert", ""\)/, "every other body child gets inert while the cover shows");
  assert.match(src, /removeAttribute\("inert"\)/, "and loses it on unlock");
  assert.match(src, /MutationObserver/, "a body child added while locked (a portal) is made inert too");
  // A modal sheet left open under the cover sets pointer-events:none on <body>; the cover must stay tappable.
  assert.ok(src.includes("pointer-events-auto"), "the cover sets pointer-events-auto");
  // A sheet's outside-press / focus / scroll listeners on the document would close it from a tap on the cover.
  assert.match(src, /nativeEvent\.stopImmediatePropagation\(\)/, "the cover keeps its events from the layers below");
  for (const prop of ["onPointerDown=", "onFocus=", "onWheel=", "onTouchMove="]) {
    assert.ok(src.includes(prop), `the cover root handles ${prop}`);
  }
  assert.match(src, /\.key [!=]== "Tab"/, "Tab stays inside the cover");
  assert.match(src, /\.focus\(\)/, "focus moves into the cover when it opens");
});

test("PIN: activity is pointerdown/keydown on window in the capture phase; the idle check is a 30 s local timer plus visibilitychange, calling autoLockDue (no request)", () => {
  const src = read(COVER);
  assert.match(
    src,
    /window\.addEventListener\("pointerdown",\s*\w+,\s*(?:true|\{\s*capture:\s*true\s*\})\)/,
    "pointerdown on window, capture phase",
  );
  assert.match(
    src,
    /window\.addEventListener\("keydown",\s*\w+,\s*(?:true|\{\s*capture:\s*true\s*\})\)/,
    "keydown on window, capture phase",
  );
  assert.match(src, /lastActivityAt\.current = Date\.now\(\)/, "activity writes a ref (never state: typing never re-renders the page)");
  assert.match(src, /addEventListener\("visibilitychange"/, "a device that comes back is checked at once");
  assert.match(src, /autoLockDue\(\{/, "the check is autoLockDue");
  assert.match(src, /addEventListener\(SCREEN_LOCK_EVENT/, "the account menu's requestScreenLock reaches the cover");

  const delays = Array.from(src.matchAll(/setInterval\(\s*[^,]+,\s*([\w.]+)\s*\)/g)).map((m) => m[1]);
  assert.ok(delays.length > 0, "landmark: the idle check runs on a setInterval");
  for (const arg of delays) {
    const literal = /^[\d_]+$/.test(arg) ? arg : (src.match(new RegExp(`const ${arg} = ([\\d_]+);`)) ?? [])[1];
    const ms = literal === undefined ? Number.NaN : Number(literal.replace(/_/g, ""));
    assert.ok(ms >= 15_000, `setInterval delay ${arg} is ${ms} ms; nothing on the lock ticks faster than 15 s`);
  }
  assert.match(src, /const IDLE_CHECK_MS = 30_000;/, "the idle check ticks every 30 s");
});

test("PIN: the cover never reaches the POS or the cart, never fetches directly, and never adds a recurring request", () => {
  const src = read(COVER);
  assert.ok(!src.includes("use-cart"), "no use-cart import");
  assert.ok(!/from "@\/components\/pos\//.test(src), "no POS component import");
  assert.ok(!/from "@\/hooks\/use-pos/.test(src), "no POS hook import");
  assert.equal(count(src.replace(/fetchKnownPeople\(/g, ""), "fetch("), 0, "no fetch( of its own");
  assert.ok(!src.includes("refetchInterval"), "no refetchInterval");
  assert.equal(count(src, "fetchKnownPeople("), 1, "one look-up of the remembered people per lock");
  for (const banned of ["use-cart", "fetch("]) {
    assert.ok(!read(FORM).replace(/signInWithPassword\(/g, "").includes(banned), `LockPasswordForm has no ${banned}`);
  }
});

test("PIN: locking writes the state and the attribute; unlocking clears both, leaves an admin page for a non-admin, says who, and remembers the device", () => {
  const src = read(COVER);
  assert.match(src, /writeLockState\(/, "a lock is written to storage (it survives a reload)");
  assert.match(src, /setAttribute\(LOCK_ATTR, ""\)/, "a lock sets LOCK_ATTR on <html>");
  assert.match(src, /removeAttribute\(LOCK_ATTR\)/, "an unlock removes LOCK_ATTR");
  assert.match(src, /setAttribute\(LOCK_READY_ATTR, ""\)/, "the cover marks itself ready (the no-flash CSS lets go)");
  assert.match(src, /readLockState\(/, "a reload reads the stored lock");
  assert.match(src, /clearLockState\(/, "an unlock clears the stored lock");
  assert.match(src, /unlockPlan\(\{/, "what an unlock does comes from the pure unlockPlan");
  assert.match(src, /if \(plan\.redirectHome\) router\.replace\("\/"\)/, "a non-admin leaves an admin page for the Dashboard");
  assert.match(src, /if \(plan\.toast\) toast\.success\(plan\.toast\)/, "a switch says who is signed in now");
  assert.match(src, /rememberThisDevice\(\)/, "every unlock remembers this device");
  assert.match(src, /<PinSignIn\b/, "the lock screen is the login page's picker");
  assert.match(src, /<LockPasswordForm\b/, "with the password form beside it");
  assert.match(src, /lockedAgoLabel\(/, 'the locker\'s tile reads "Locked · N min ago"');
  assert.match(src, /key=\{/, "each lock mounts a fresh cover (PinSignIn's pad stays disabled after a success)");
});

// Fix round 1 (review of 743ecf2..91e88e0): queryClient.resetQueries refetched the ACTIVE person-scoped queries at
// once, while the page under the cover still observed the last person's keys (an admin's "Last 7 days" dashboard
// refetched as staff, its figures kept on screen as the placeholder). The reset is now state-only and ordered.
test("PIN: a switch clears the person-scoped queries with no request, in the order that keeps the last person's data off the next person's screen", () => {
  const src = read(COVER);
  assert.ok(!src.includes("resetQueries("), "the cover never calls resetQueries (it refetches the active queries at once)");
  const body = arrowBody(src, "unlocked");
  assert.ok(body.length > 0, "landmark: the cover has const unlocked = async (...) => { ... }");
  const at = (needle: string, from = 0) => body.indexOf(needle, from);

  // A PIN (the new session has not rendered): clear now, close at once, refetch after the commit.
  const pinBranch = at("if (person !== null && latest.current.user?.id !== person.id)");
  assert.ok(pinBranch >= 0, "the unlock tells whether the new session has rendered yet");
  const clearAll = at("clearPersonScopedQueries(queryClient);", pinBranch);
  const deferred = at("void afterCommit().then(() => refetchPersonScopedQueries(queryClient));", pinBranch);
  assert.ok(clearAll > pinBranch && deferred > clearAll, "PIN: clear the person-scoped state, then refetch only after the commit");

  // A password (rendered under the cover): wait for the commit, load as the new person, clear the rest, then close.
  const otherwise = at("} else {", deferred);
  const waitCommit = at("await afterCommit();", otherwise);
  const refetch = at("await refetchPersonScopedQueries(queryClient);", waitCommit);
  const clearOld = at("clearPersonScopedQueries(queryClient, since);", refetch);
  assert.ok(otherwise > deferred && waitCommit > otherwise, "password: await afterCommit() first");
  assert.ok(refetch > waitCommit && clearOld > refetch, "password: refetch as the new person, then clear what is older");

  const close = body.lastIndexOf("close();");
  assert.ok(close > clearOld, "the cover closes last, after either branch");
  assert.ok(at("rememberThisDevice()") > clearOld && at("rememberThisDevice()") < close, "remember, then close");

  const lib = read(LOCK_MODULE);
  assert.ok(!lib.includes("resetQueries("), "lib/screen-lock.ts never calls resetQueries");
  assert.match(lib, /query\.reset\(\);/, "the clear is Query.reset (state only)");
  assert.match(lib, /refetchQueries\(\{ predicate: \(q\) => isPersonScopedQuery\(q\.queryKey\), type: "active" \}\)/, "the refetch is the active person-scoped queries only");
  assert.match(lib, /ADMIN_ROUTES\.some\(/, "admin pages are read from ADMIN_ROUTES");
});

test('PIN: "Sign out" on the cover clears the lock state first, then signs out through useAuth().logout (ruling R15)', () => {
  const src = read(COVER);
  const body = arrowBody(src, "signOut");
  assert.ok(body.length > 0, "landmark: the cover has const signOut = async () => { ... }");
  const clear = body.indexOf("clearLockState(");
  const out = body.indexOf("await logout()");
  assert.ok(clear >= 0 && out > clear, "clearLockState( comes before await logout()");
  assert.ok(src.includes(">Sign out<") || /\n\s*Sign out\n/.test(src), 'the cover offers "Sign out"');
});

// ── The lock's password form ────────────────────────────────────────────────

const LOCK_COPY = {
  credentials: "Invalid username or password",
  offline: "No internet. Sign-in can't be checked right now. Printing goes on.",
  error: "Couldn't sign in just now. Please try again.",
};

test("PIN: LockPasswordForm signs in in place through signInWithPassword (never signIn directly), with its own ids and the reveal toggle", () => {
  const src = read(FORM);
  assert.ok(src.length > 0, "landmark: components/lock/LockPasswordForm.tsx exists");
  assert.match(src, /import \{[^}]*\bsignInWithPassword\b[^}]*\} from "@\/lib\/pin-sign-in-client";/, "imports signInWithPassword");
  assert.match(src, /await signInWithPassword\(/, "calls signInWithPassword");
  assert.ok(!/\bsignIn\(/.test(src), "never calls next-auth's signIn directly (it could navigate the dashboard away)");
  assert.match(src, /type=\{passwordShown \? "text" : "password"\}/, "the reveal toggle drives the password type");
  assert.match(src, /aria-pressed=\{passwordShown\}/, "the toggle exposes its state");
  assert.match(src, /method="post"/, "the form never GETs credentials into a URL");
});

test("the lock's password form copy: wrong credentials, no internet, server trouble (ruling R14)", async () => {
  const { lockPasswordMessage } = await import("@/components/lock/LockPasswordForm");
  assert.equal(lockPasswordMessage({ kind: "credentials" }), LOCK_COPY.credentials, "credentials");
  assert.equal(lockPasswordMessage({ kind: "offline" }), LOCK_COPY.offline, "offline");
  assert.equal(lockPasswordMessage({ kind: "error" }), LOCK_COPY.error, "error");
  assert.equal(lockPasswordMessage({ kind: "nopin" }), LOCK_COPY.error, "any other refusal reads as try again");
});

async function renderForm(props: Record<string, unknown>): Promise<string> {
  const { LockPasswordForm } = await import("@/components/lock/LockPasswordForm");
  return renderToStaticMarkup(
    createElement(LockPasswordForm, { signedInAs: "Asha Rao", onSignedIn: () => {}, ...props } as React.ComponentProps<
      typeof LockPasswordForm
    >),
  );
}

test("render: the lock's form has the login labels, the lock ids, an empty masked start and the Signed in as line", async () => {
  const html = await renderForm({ onUsePin: () => {} });
  const text = textOf(html);
  assert.ok(text.includes("Signed in as Asha Rao"), `the line "Signed in as Asha Rao" shows (got: ${text})`);
  assert.match(html, /<label[^>]*for="lock-username"[^>]*>Username<\/label>/, 'a "Username" label for lock-username');
  assert.match(html, /<label[^>]*for="lock-password"[^>]*>Password<\/label>/, 'a "Password" label for lock-password');
  assert.match(html, /<input[^>]*id="lock-username"/, "the username field has id lock-username");
  const password = html.match(/<input[^>]*id="lock-password"[^>]*>/);
  assert.ok(password, "the password field has id lock-password");
  assert.match(password![0], /type="password"/, "the password starts masked");
  const username = html.match(/<input[^>]*id="lock-username"[^>]*>/)![0];
  assert.ok(!/value="[^"]+"/.test(username), "the username is never pre-filled (the session has no username)");
  assert.match(html, /aria-label="Show password"/, "the reveal toggle starts as Show password");
  assert.ok(text.includes("Sign in with PIN"), '"Sign in with PIN" shows when there are people to pick');
  assert.ok(!html.includes('id="username"') && !html.includes('id="password"'), "never the login page's own ids (both can be in one document)");
});

test('render: without anyone to pick there is no "Sign in with PIN"', async () => {
  const text = textOf(await renderForm({}));
  assert.ok(!text.includes("Sign in with PIN"), 'no "Sign in with PIN" without people');
  assert.ok(text.includes("Sign in"), "landmark: the submit button");
});

// ── The profile sheet (U0 Task 4: the account menu became the HTML's profile sheet, values 2.7) ─────────────────────

const SHEET = "components/layout/ProfileSheet.tsx";

async function renderSheetBody(props: Record<string, unknown>): Promise<string> {
  const { ProfileSheetBody } = await import("@/components/layout/ProfileSheet");
  return renderToStaticMarkup(
    createElement(ProfileSheetBody, {
      name: "Asha Rao",
      roleLabel: "Admin",
      lockMinutes: 60,
      shortcutLabel: "Ctrl L",
      pathname: "/",
      onLock: () => {},
      onSwitch: () => {},
      onChangePassword: () => {},
      onSignOut: () => {},
      onNavigate: () => {},
      ...props,
    } as React.ComponentProps<typeof ProfileSheetBody>),
  );
}

test("render: the profile sheet's rows are Lock screen, Switch user, Change password, Sign out (today's copy), then the auto-lock line", async () => {
  const text = textOf(await renderSheetBody({}));
  const at = (needle: string) => text.indexOf(needle);
  const order = [
    "Asha Rao",
    "Lock screen",
    "Your open orders stay as they are",
    "Switch user",
    "Lock and let a teammate sign in",
    "Change password",
    "Sign out",
    "Auto-locks after 60 min without activity",
  ];
  for (const needle of order) assert.ok(at(needle) >= 0, `the sheet shows "${needle}" (got: ${text})`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(at(order[i - 1]) < at(order[i]), `"${order[i - 1]}" comes before "${order[i]}"`);
  }
  assert.ok(!text.includes("Theme"), "no Theme block (light only for now)");
});

test("render: the footer is the HTML's words with our setting; off reads Auto-lock is off", async () => {
  assert.ok(textOf(await renderSheetBody({ lockMinutes: 15 })).includes("Auto-locks after 15 min without activity"), "15 minutes");
  assert.ok(textOf(await renderSheetBody({ lockMinutes: 0 })).includes("Auto-lock is off"), "off");
});

test("render: the Lock screen row carries the shortcut chip (desk only), the user block the role beside the ok dot", async () => {
  const html = await renderSheetBody({ shortcutLabel: "⌘L" });
  const chip = /<kbd\b[^>]*data-ui="profile-kbd"[^>]*>([^<]*)<\/kbd>/.exec(html);
  assert.ok(chip, "the Lock screen row has a <kbd> chip");
  assert.equal(chip![1], "⌘L", "it shows the platform's shortcut");
  assert.match(chip![0], /\bhidden\b[^"]*\bdesk:inline\b/, "shown from 1100px only (the HTML's desk)");
  assert.equal((html.match(/data-ui="profile-kbd"/g) ?? []).length, 1, "only Lock screen has a chip");
  const user = /<div\b[^>]*data-ui="profile-user"[^>]*>[\s\S]*?Admin/.exec(html);
  assert.ok(user, "the user block names the role");
});

test("PIN: the sheet's rows do what the menu did: a manual lock, a switch, the password dialog, sign out", () => {
  const src = read(SHEET);
  assert.ok(src.length > 0, "landmark: components/layout/ProfileSheet.tsx exists");
  assert.match(src, /requestScreenLock\("manual"\)/, "Lock screen requests a manual lock");
  assert.match(src, /requestScreenLock\("switch"\)/, "Switch user requests a switch");
  assert.match(src, /<ChangePasswordDialog\b/, "Change password opens the dialog");
  assert.match(src, /void logout\(\)/, "Sign out signs out through useAuth().logout, as today");
  assert.match(src, /screenLockMinutes \?\? SCREEN_LOCK_DEFAULT_MINUTES/, "the line reads the seeded setting, 60 by default");
  assert.match(src, /screenLockLine\(lockMinutes\)/, "the footer is screenLockLine(...)");
});

test("PIN: the nav's user card opens the profile sheet; the dropdown menu is gone", () => {
  const src = read(ACCOUNT);
  assert.ok(src.length > 0, "landmark: SidebarAccount exists");
  assert.match(src, /<ProfileSheet open=\{open\} onOpenChange=\{setOpen\} \/>/, "the card's sheet");
  assert.match(src, /onClick=\{\(\) => setOpen\(true\)\}/, "a tap on the card opens it");
  assert.ok(!src.includes("DropdownMenu"), "no dropdown menu any more");
});

// ── Ctrl/⌘+L (values 2.9) ───────────────────────────────────────────────────

type FakeKey = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: object };
const keyEvent = (k: FakeKey) => {
  const e = { ctrlKey: false, metaKey: false, altKey: false, ...k, target: (k.target ?? { tagName: "BODY" }) as EventTarget, prevented: false };
  return Object.assign(e, { preventDefault: () => void (e.prevented = true) });
};

test("Ctrl+L and ⌘L request a manual lock and keep the browser's own Ctrl+L; never from a field", async () => {
  const { handleLockShortcut, SCREEN_LOCK_EVENT } = await import("./screen-lock");
  const g = globalThis as unknown as { window?: unknown };
  const got: Array<{ type: string; detail: unknown }> = [];
  g.window = { dispatchEvent: (e: { type: string; detail: unknown }) => void got.push({ type: e.type, detail: e.detail }) };
  try {
    const ctrl = keyEvent({ key: "l", ctrlKey: true });
    assert.equal(handleLockShortcut(ctrl), true, "Ctrl+L is the shortcut");
    assert.equal(ctrl.prevented, true, "the address bar does not take it");
    const cmd = keyEvent({ key: "L", metaKey: true });
    assert.equal(handleLockShortcut(cmd), true, "⌘L (and ⌘⇧L) too");
    assert.deepEqual(
      got,
      [
        { type: SCREEN_LOCK_EVENT, detail: { reason: "manual" } },
        { type: SCREEN_LOCK_EVENT, detail: { reason: "manual" } },
      ],
      "each one asks the cover for a manual lock",
    );
    got.length = 0;
    for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "DIV", isContentEditable: true }]) {
      const e = keyEvent({ key: "l", ctrlKey: true, target });
      assert.equal(handleLockShortcut(e), false, `not while typing in ${JSON.stringify(target)}`);
      assert.equal(e.prevented, false, "the field keeps its own Ctrl+L");
    }
    for (const k of [{ key: "l" }, { key: "k", ctrlKey: true }, { key: "l", ctrlKey: true, altKey: true }]) {
      assert.equal(handleLockShortcut(keyEvent(k)), false, `not ${JSON.stringify(k)}`);
    }
    assert.deepEqual(got, [], "nothing else locks");
  } finally {
    delete g.window;
  }
});

test("the chip names the shortcut for the platform: ⌘L on Apple devices, Ctrl L elsewhere", async () => {
  const { lockShortcutLabel } = await import("./screen-lock");
  for (const p of ["MacIntel", "iPhone", "iPad", "macOS"]) assert.equal(lockShortcutLabel(p), "⌘L", p);
  for (const p of ["Win32", "Linux x86_64", "Linux armv8l", "", "Android"]) assert.equal(lockShortcutLabel(p), "Ctrl L", p || "(empty)");
});

test("PIN: the cover's key listener handles Ctrl/⌘+L only while no cover is up", () => {
  const src = read(COVER);
  assert.match(src, /if \(!openRef\.current\) handleLockShortcut\(e\);/, "the shortcut, gated on the cover being down");
  assert.match(src, /import \{[^}]*\bhandleLockShortcut\b[^}]*\} from "@\/lib\/screen-lock";/, "from lib/screen-lock");
});

// ── The no-flash CSS ────────────────────────────────────────────────────────

test("PIN: globals.css hides the page while a stored lock waits for its cover, with a 10 s failsafe, outside the touch block (ruling R13)", async () => {
  const { LOCK_ATTR, LOCK_READY_ATTR } = await import("@/lib/screen-lock-script");
  const css = raw(CSS);
  const selector = `html[${LOCK_ATTR}]:not([${LOCK_READY_ATTR}]) body > *`;
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `globals.css has the rule ${selector}`);
  const rule = css.slice(at, css.indexOf("}", at) + 1);
  assert.match(rule, /visibility:\s*hidden;/, "the rule hides the page");
  assert.match(rule, /animation:\s*pos-lock-failsafe 0s linear 10s forwards;/, "the failsafe animation starts after 10 s");
  assert.match(css, /@keyframes pos-lock-failsafe \{\s*to \{\s*visibility:\s*visible;\s*\}\s*\}/, "the failsafe ends visible");

  const touch = css.indexOf("[data-pos-" + "touch]");
  assert.ok(touch >= 0, "landmark: the touch block");
  const layer = css.lastIndexOf("@layer base", touch);
  const open = css.indexOf("{", layer);
  let depth = 0;
  let close = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  assert.ok(close > open, "landmark: the touch block's own closing brace");
  assert.ok(at < layer || at > close, "the lock rule sits outside the touch block");
});

// ── The login page (ruling R15) ─────────────────────────────────────────────

test("PIN: a sign-in on the login page clears a stale lock before it navigates", () => {
  const src = read(LOGIN);
  assert.match(src, /import \{ clearLockState \} from "@\/lib\/screen-lock";/, "the login page imports clearLockState");
  const finish = arrowBody(src, "finishSignIn");
  assert.ok(finish.length > 0, "landmark: finishSignIn");
  const clear = finish.indexOf("clearLockState(window.localStorage)");
  const replace = finish.indexOf('router.replace("/")');
  assert.ok(clear >= 0, "finishSignIn calls clearLockState(window.localStorage)");
  assert.ok(replace > clear, 'clearLockState comes before router.replace("/")');
  assert.equal(count(src, "clearLockState("), 1, "one call");
});

// ── Unlocking: what it does, and the order of the query clean-up (fix round 1) ──

test("unlockPlan: the same person just continues; anyone else (or an unread session) is a switch", () => {
  const admin = { id: "a1", name: "Priya Sharma", role: "admin" };
  const staff = { id: "s1", name: "  Rohan   Kapoor ", role: "staff" };
  assert.deepEqual(unlockPlan({ before: "a1", next: admin, pathname: "/staff" }), { switched: false, redirectHome: false, toast: null }, "same person");
  assert.deepEqual(unlockPlan({ before: "s1", next: admin, pathname: "/staff" }), { switched: true, redirectHome: false, toast: "Signed in as Priya" }, "an admin stays on an admin page");
  assert.deepEqual(unlockPlan({ before: "a1", next: staff, pathname: "/staff/x" }), { switched: true, redirectHome: true, toast: "Signed in as Rohan" }, "staff leave an admin sub-page");
  assert.equal(unlockPlan({ before: "a1", next: staff, pathname: "/" }).redirectHome, false, "staff stay on the Dashboard");
  assert.equal(unlockPlan({ before: "a1", next: staff, pathname: "/staffing" }).redirectHome, false, "a prefix lookalike is not an admin page");
  assert.deepEqual(unlockPlan({ before: "a1", next: null, pathname: "/reports" }), { switched: true, redirectHome: true, toast: null }, "an unread session: a switch, an unknown role is not an admin, no name");
  assert.equal(unlockPlan({ before: null, next: admin, pathname: "/" }).switched, true, "nobody known at the lock: a switch");
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Figures = { total: string };

// The reviewer's case: an admin on "/" with "Last 7 days", the "Needs attention" strip polling, an order list; then a
// staff member unlocks. The page maps a multi-day choice to Today for staff, and useDashboard keeps the previous
// figures as the placeholder. `staff` flips when the session cookie names the staff member.
async function switchScenario(order: "pin" | "password") {
  const requests: string[] = [];
  let staff = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.mount();
  const who = () => (staff ? "staff" : "admin");
  const range = (from: string, to: string) =>
    client.defaultQueryOptions<Figures, Error, Figures, readonly unknown[]>({
      queryKey: ["dashboard", "range", from, to],
      queryFn: async () => {
        requests.push(`${from === to ? "today" : "7-day"} as ${who()}`);
        await delay(15);
        if (staff && from !== to) throw new Error("403");
        return { total: from === to ? `today for ${who()}` : "ADMIN-7-DAY" };
      },
      placeholderData: keepPreviousData,
      staleTime: 60_000,
    });
  const week = range("2026-10-11", "2026-10-17");
  const today = range("2026-10-17", "2026-10-17");
  const dash = new QueryObserver(client, week);
  const live = new QueryObserver(client, {
    queryKey: ["dashboard", "live"],
    queryFn: async () => {
      requests.push(`live as ${who()}`);
      await delay(15);
      return { total: `live for ${who()}` };
    },
  });
  const orders = new QueryObserver(client, {
    queryKey: ["orders", "list"],
    queryFn: async () => {
      requests.push(`orders as ${who()}`);
      return { total: "orders" };
    },
    staleTime: 60_000,
  });
  const stops = [dash, live, orders].map((o) => o.subscribe(() => {}));
  await delay(60);
  requests.length = 0;

  staff = true;
  const view = (r: QueryObserverResult<Figures>) => `${r.data?.total ?? "-"}${r.isPlaceholderData ? " (placeholder)" : ""}`;
  let firstPaint: string;
  if (order === "pin") {
    clearPersonScopedQueries(client); // before the staff session renders
    firstPaint = view(dash.getOptimisticResult(today)); // the render with the staff session, the cover gone
    dash.setOptions(today); // the page's effect moves the observer
    await refetchPersonScopedQueries(client); // after that commit
  } else {
    firstPaint = view(dash.getOptimisticResult(today)); // signIn rendered the staff session under the cover
    dash.setOptions(today);
    const since = Date.now();
    await refetchPersonScopedQueries(client);
    clearPersonScopedQueries(client, since);
  }
  const atClose = view(dash.getCurrentResult());
  await delay(40);
  const result = {
    requests: [...requests],
    firstPaint,
    atClose,
    settled: view(dash.getCurrentResult()),
    live: live.getCurrentResult().data?.total,
    weekLeft: client.getQueryData(week.queryKey),
    ordersLeft: client.getQueryData<Figures>(["orders", "list"])?.total,
  };
  stops.forEach((stop) => stop());
  client.clear();
  client.unmount();
  return result;
}

test("a PIN switch: the staff member's first paint holds nothing of the admin's, and no multi-day request goes as staff", async () => {
  const r = await switchScenario("pin");
  assert.equal(r.firstPaint, "-", `the first paint after the switch is empty, never the admin's figures (got ${r.firstPaint})`);
  assert.deepEqual(r.requests, ["today as staff", "live as staff"], "only the staff member's own requests, once each");
  assert.equal(r.settled, "today for staff", "the Dashboard settles on today's figures for staff");
  assert.equal(r.live, "live for staff", "the strip that kept its key loaded again as staff");
  assert.equal(r.weekLeft, undefined, "the admin's 7-day figures are gone from the cache");
  assert.equal(r.ordersLeft, "orders", "a query that is not person-scoped is left alone");
});

test("a password switch: the cover lifts only once the page holds the staff member's figures, and no multi-day request goes as staff", async () => {
  const r = await switchScenario("password");
  assert.equal(r.firstPaint, "ADMIN-7-DAY (placeholder)", "landmark: under the cover the staff render briefly holds the placeholder (why the cover waits)");
  assert.equal(r.atClose, "today for staff", `when the cover closes the page shows staff figures, no placeholder (got ${r.atClose})`);
  assert.deepEqual(r.requests, ["today as staff", "live as staff"], "the in-flight Today request is reused; no 7-day request as staff");
  assert.equal(r.live, "live for staff", "the strip loaded again as staff");
  assert.equal(r.weekLeft, undefined, "the admin's 7-day figures are gone from the cache");
  assert.equal(r.ordersLeft, "orders", "a query that is not person-scoped is left alone");
});
