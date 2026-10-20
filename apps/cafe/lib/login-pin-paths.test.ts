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
import { classesOf, expectAll, tagOf } from "./class-tags.fixtures";
import type { KnownPerson } from "@/lib/pin-sign-in-client";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = path.resolve(__dirname, "..");
const exists = (rel: string): boolean => existsSync(path.join(CAFE_ROOT, rel));
const read = (rel: string): string => (exists(rel) ? stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8")) : "");

// The login page's client screen (ruling R39: app/(auth)/login/page.tsx is now a server page that reads the cafe's name
// and renders this component; every client pin below moved with the code).
const PAGE = "components/auth/LoginScreen.tsx";
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

// U0 match Task 10: the class-token helpers are shared (lib/class-tags.fixtures.ts, review m8); the picker's pure
// helpers live in lib/staff-picker.ts (review m9), PinSignIn keeps the component.
const PICKER = "lib/staff-picker.ts";

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

// ── The password form's look (U0 match Task 10, ruling R31, design 5.6) ─────

test("the password form classes are the HTML's form style: 44px fields radius 10 at 15px, 13/600 labels, a 48px button radius 10", async () => {
  const { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, AUTH_BUTTON_CLASS, AUTH_LINK_CLASS } = await import("@/components/auth/auth-classes");
  const { HTML_PRESS_CLASS } = await import("@/components/brand/brand-classes");
  const has = (cls: string, tokens: string[], label: string) => {
    const have = cls.split(/\s+/);
    for (const t of tokens) assert.ok(have.includes(t), `${label} carries ${t} (got "${cls}")`);
  };
  // Ruling R33: 16px below 720px (iPhone Safari zooms a smaller field on focus), the HTML's 15px from 720px; md:15px
  // replaces the kit Input's own md:text-sm, so 720-767px gets 15px too.
  has(AUTH_INPUT_CLASS, ["h-11", "rounded-[10px]", "border", "border-border", "bg-card", "px-3", "text-base", "tab:text-[15px]", "md:text-[15px]", "text-foreground", "placeholder:text-subtle-foreground", "focus-visible:border-primary", "focus-visible:ring-4", "focus-visible:ring-accent", "aria-invalid:border-status-bad"], "a field");
  has(AUTH_LABEL_CLASS, ["text-[13px]", "font-semibold", "text-foreground"], "a label");
  has(AUTH_BUTTON_CLASS, ["h-12", "w-full", "rounded-[10px]", "bg-primary", "text-[15px]", "font-semibold", "text-primary-foreground", "hover:bg-primary-hover"], "the primary button");
  assert.ok(AUTH_BUTTON_CLASS.endsWith(HTML_PRESS_CLASS), "the button presses like the HTML's");
  has(AUTH_LINK_CLASS, ["p-1", "text-[13.5px]", "font-medium", "text-link"], "a link button (the HTML's Forgot PIN?)");

  const page = read(PAGE);
  assert.equal(count(page, "className={AUTH_LABEL_CLASS}"), 2, "the login page's two labels");
  assert.equal(count(page, "AUTH_INPUT_CLASS"), 3, "the login page's two fields (and the import)");
  assert.match(page, /<Button type="submit" className=\{AUTH_BUTTON_CLASS\}/, "the login page's submit");
  assert.ok(!/BRAND_(INPUT|LABEL|BUTTON)_CLASS/.test(page), "no older brand form classes on the login page");
});

test("the login's product logo (review m4): a wide logo keeps its own width (34px tall, up to 136px), a square one the 34px tile", async () => {
  const { loginLogoClasses } = await import("@/components/auth/auth-classes");
  const has = (cls: string, tokens: string[], label: string) => {
    const have = cls.split(/\s+/);
    for (const t of tokens) assert.ok(have.includes(t), `${label} carries ${t} (got "${cls}")`);
  };
  const square = loginLogoClasses(false);
  has(square.tile, ["size-[34px]", "rounded-[9px]", "bg-white", "p-0.5"], "the square tile");
  has(square.image, ["h-full", "w-full", "object-contain"], "the square logo");
  const wide = loginLogoClasses(true);
  has(wide.tile, ["h-[34px]", "min-w-[34px]", "max-w-[8.5rem]", "rounded-[9px]", "border", "border-border", "bg-card", "p-1"], "the wide tile (the login's old wordmark tile)");
  has(wide.image, ["h-full", "w-auto", "max-w-full", "object-contain", "mix-blend-multiply"], "the wide logo at its own width");
  const page = read(PAGE);
  assert.match(page, /onLoad=\{\(e\) => setLogoWide\(isWideLogo\(e\.currentTarget\)\)\}/, "the page reads the logo's shape once it loads");
  assert.match(page, /loginLogoClasses\(logoWide\)/, "and draws the tile for that shape");
  const { isWideLogo } = await import("@/components/auth/auth-classes");
  assert.equal(isWideLogo({ naturalWidth: 300, naturalHeight: 100 }), true, "a 3:1 wordmark is wide");
  assert.equal(isWideLogo({ naturalWidth: 120, naturalHeight: 120 }), false, "a square mark is not");
  assert.equal(isWideLogo({ naturalWidth: 0, naturalHeight: 0 }), false, "an unread image is not");
});

test("the lock's password form renders the same form style", async () => {
  const { LockPasswordForm } = await import("@/components/lock/LockPasswordForm");
  const html = renderToStaticMarkup(
    createElement(LockPasswordForm, { signedInAs: "Asha Rao", onSignedIn: noop, onUsePin: noop } as React.ComponentProps<typeof LockPasswordForm>),
  );
  const label = html.match(/<label[^>]*for="lock-username"[^>]*>/)?.[0] ?? "";
  expectAll(label, ["text-[13px]", "font-semibold"], "the Username label");
  const field = html.match(/<input[^>]*id="lock-password"[^>]*>/)?.[0] ?? "";
  expectAll(field, ["h-11", "rounded-[10px]", "text-base", "tab:text-[15px]", "md:text-[15px]"], "the password field");
  assert.ok(!classesOf(field).includes("md:text-sm"), "the kit Input's md:text-sm gives way (720-767px reads 15px)");
  const submit = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
  expectAll(submit, ["h-12", "rounded-[10px]", "bg-primary"], "the submit button");
  expectAll(tagOf(html, "lock-use-pin"), ["p-1", "text-[13.5px]", "text-link"], "Sign in with PIN");
});

// ── The shell ───────────────────────────────────────────────────────────────

test("the Online chip's words (rulings R28, R32): Online, or Offline (our PIN is checked on the server)", async () => {
  const { onlineChipLabel } = await import("@/components/auth/AuthShell");
  assert.equal(onlineChipLabel(true), "Online", "online");
  assert.equal(onlineChipLabel(false), "Offline", "offline: the HTML's \"PINs still work\" is untrue for us (R32)");
});

test("the online state comes from navigator.onLine and the online/offline events, never a request", () => {
  const src = read("hooks/use-online.ts");
  assert.ok(src.length > 0, "landmark: hooks/use-online.ts exists");
  assert.match(src, /useSyncExternalStore\(/, "one external store");
  assert.match(src, /navigator\.onLine/, "read from navigator.onLine");
  assert.match(src, /addEventListener\("online"/, "the online event");
  assert.match(src, /addEventListener\("offline"/, "the offline event");
  assert.ok(!/fetch\(|setInterval\(/.test(src), "no request and no timer");
  assert.match(read(SHELL), /useOnline\(\)/, "the shell's chip reads it");
});

async function renderShell(props: Record<string, unknown> = {}): Promise<string> {
  const { AuthShell } = await import("@/components/auth/AuthShell");
  return renderToStaticMarkup(
    createElement(
      AuthShell,
      {
        brandName: "Olivea Pizza",
        logo: createElement("span", { "data-ui": "test-logo" }, "O"),
        subline: "Sandbee POS · Counter 1",
        ...props,
      } as React.ComponentProps<typeof AuthShell>,
      createElement("p", null, "body"),
    ),
  );
}

test("AuthShell is the HTML's lock root (values 4.2, ruling R27): fixed full screen, tint, top bar, centred card, footer", async () => {
  const html = await renderShell();
  expectAll(tagOf(html, "auth-root"), ["fixed", "inset-0", "z-[60]", "flex", "flex-col", "overflow-hidden", "bg-background", "text-foreground", "leading-[normal]", "motion-safe:animate-html-fade"], "the root");
  assert.ok(tagOf(html, "auth-root").startsWith("<main "), "the root is the screen's <main>");
  expectAll(tagOf(html, "auth-tint"), ["pointer-events-none", "absolute", "inset-x-0", "top-0", "h-80", "bg-[linear-gradient(180deg,var(--color-accent),transparent)]"], "the tint");
  expectAll(tagOf(html, "auth-header"), ["relative", "flex", "flex-none", "items-center", "gap-3", "px-4", "py-3.5", "tab:px-7", "tab:py-5"], "the top bar");
  assert.ok(html.indexOf('data-ui="test-logo"') > html.indexOf('data-ui="auth-header"'), "the caller's 34px tile sits in the top bar");
  expectAll(tagOf(html, "auth-brand"), ["flex", "min-w-0", "flex-1", "flex-col"], "the name block");
  expectAll(tagOf(html, "auth-name"), ["truncate", "font-brand-script", "text-[20px]", "font-normal", "leading-[1.1]", "text-brand-red"], "the cafe name");
  assert.match(html, /data-ui="auth-name"[^>]*>Olivea Pizza</, "the name");
  expectAll(tagOf(html, "auth-sub"), ["text-[12px]", "text-muted-foreground"], "the product · device line");
  assert.match(html, /data-ui="auth-sub"[^>]*>Sandbee POS · Counter 1</, "the sub line");
  expectAll(tagOf(html, "auth-net"), ["hidden", "tab:flex", "items-center", "gap-[7px]", "whitespace-nowrap", "text-[12.5px]", "text-muted-foreground"], "the Online chip (none on a phone)");
  expectAll(tagOf(html, "auth-net-dot"), ["size-[7px]", "rounded-[50%]", "bg-status-ok"], "the chip's dot");
  assert.ok(textOf(html).includes("Online"), "the chip reads Online (a server render is online)");
  expectAll(tagOf(html, "auth-divider"), ["hidden", "tab:block", "h-5", "w-px", "bg-border"], "the divider");
  expectAll(tagOf(html, "auth-clock"), ["whitespace-nowrap", "text-[13.5px]", "font-medium", "min-w-[61px]"], "the clock, holding its width until the first tick (review m6)");
  expectAll(tagOf(html, "auth-main"), ["relative", "flex", "min-h-0", "flex-1", "flex-col", "items-center", "overflow-auto", "px-3", "pt-1", "pb-2", "tab:px-6", "tab:py-2"], "the main area");
  expectAll(
    tagOf(html, "auth-card"),
    ["my-auto", "flex", "w-full", "flex-col", "gap-5", "max-w-[520px]", "tab:max-w-[680px]", "desk:max-w-[900px]", "rounded-[16px]", "tab:rounded-[20px]", "border", "border-border", "bg-card", "px-4", "py-5", "tab:p-6", "desk:px-8", "desk:py-7", "[box-shadow:0_1px_2px_rgba(0,0,0,.04),0_12px_40px_rgba(0,0,0,.06)]", "motion-safe:animate-html-rise"],
    "the card",
  );
  expectAll(tagOf(html, "auth-footer"), ["relative", "flex", "flex-none", "flex-wrap", "justify-center", "gap-x-[18px]", "gap-y-1.5", "px-4", "pt-2.5", "pb-[calc(14px+env(safe-area-inset-bottom))]", "text-[12.5px]", "text-subtle-foreground"], "the footer");
  assert.match(html, /data-ui="auth-footer"[\s\S]*Powered by Sandbee POS/, "the footer says Powered by Sandbee POS");
  assert.ok(!html.includes("Demo PIN"), "no demo PIN line (ruling R27)");
});

test("AuthShell's footer takes the caller's action before Powered by (the lock's Sign out), and its title/intro/footer stay", async () => {
  const html = await renderShell({
    footerAction: createElement("button", { type: "button" }, "Sign out"),
    title: "Welcome back.",
    intro: "Sign in to continue.",
    footer: "Forgot your password? Ask an admin to reset it.",
  });
  const foot = html.slice(html.indexOf('data-ui="auth-footer"'));
  assert.ok(foot.indexOf(">Sign out<") >= 0 && foot.indexOf(">Sign out<") < foot.indexOf("Powered by"), "Sign out first, then Powered by");
  expectAll(tagOf(html, "auth-title"), ["text-[22px]", "tab:text-[26px]", "font-semibold", "tracking-[-0.02em]"], "the card's title (the greeting's size)");
  expectAll(tagOf(html, "auth-intro"), ["mt-1", "text-[14px]", "text-muted-foreground"], "the intro (the sub line's size)");
  assert.ok(textOf(html).includes("Forgot your password? Ask an admin to reset it."), "the card's own footer stays");
});

test("the HTML's lock motion (values 1.5, 4.2–4.4) is in the theme: fadeIn .4s / .25s ease, rise .45s / .4s on its easing", () => {
  const css = read("app/globals.css");
  assert.ok(css.includes("--animate-html-fade: brand-fade 0.4s ease both;"), "the lock root's fadeIn .4s ease both");
  assert.ok(css.includes("--animate-html-fade-fast: brand-fade 0.25s ease both;"), "the PIN view's fadeIn .25s ease both");
  assert.ok(css.includes("--animate-html-rise: brand-rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "the card's rise .45s");
  assert.ok(css.includes("--animate-html-rise-tile: brand-rise 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "a tile's rise .4s");
  assert.match(css, /@keyframes brand-rise \{\s*from \{\s*opacity: 0;\s*transform: translateY\(12px\);\s*\}\s*to \{\s*opacity: 1;\s*transform: none;\s*\}\s*\}/, "brand-rise is the HTML's rise, verbatim");
  assert.match(css, /@keyframes brand-fade \{\s*from \{\s*opacity: 0;\s*\}\s*to \{\s*opacity: 1;\s*\}\s*\}/, "brand-fade is the HTML's fadeIn, verbatim");
});

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
  // U0 match Task 10 fix 1 (review m9): the pure helpers (the pad's words, the tile lines, the tabs, the dates) moved to
  // lib/staff-picker.ts; PinSignIn calls them, so the refusal words and the copy are checked across both files.
  const helpers = read(PICKER);
  assert.ok(src.length > 0 && helpers.length > 0, "landmark: PinSignIn and lib/staff-picker exist");
  assert.match(src, /signInWithPin\(/, "PinSignIn calls signInWithPin(");
  assert.match(src, /pinPadView\(/, "PinSignIn words the pad through pinPadView(");
  assert.match(helpers, /pinFailureMessage\(/, "pinPadView calls pinFailureMessage(");
  assert.equal(count(src, "fetch(") + count(helpers, "fetch("), 0, "no fetch( of its own");
  for (const copy of [
    "Select your name to sign in",
    "Sign in with username and password",
    "Forgot PIN?",
    "Ask an admin to tell you or reset your PIN.",
    "All staff",
    "· Enter your 4-digit PIN",
    "Search staff",
    // U0 match Task 10 (rulings R28, R30, R37, design 5.6): the HTML's words for a blocked tile, a waiting person's
    // tile and a right PIN.
    "PIN blocked",
    "Try again soon",
    "Unlocking…",
  ]) {
    assert.ok(src.includes(copy) || helpers.includes(copy), `PinSignIn (or its helpers) holds the copy "${copy}"`);
  }
  // Ruling R30: a right PIN shows the HTML's success look while our own sign-in completes, with no wait added.
  const submitAt = src.indexOf("const submit = async");
  const submit = src.slice(submitAt, src.indexOf("if (chosen)", submitAt));
  assert.ok(submitAt >= 0 && submit.length > 0, "landmark: PinSignIn's submit");
  const ok = submit.indexOf("setSucceeded(true)");
  const signedIn = submit.indexOf("await onSignedIn(person)");
  assert.ok(ok >= 0 && signedIn > ok, "the success look is set before (not after) the caller's sign-in completes");
  // Ruling R35: nothing holds the sign-in back for the look (no timer, no frame, no forced flush): on the lock the cover
  // closes in the same render, so the look shows on /login only.
  assert.ok(!/setTimeout\(|wait\(|requestAnimationFrame\(|flushSync\(/.test(submit), "no added wait in the flow");
  assert.match(src, /<PinPad\b[^>]*\bkeyboard\b/, "the pad listens to the keyboard (a counter PC)");
  assert.match(src, /<StaffAvatar\b[^>]*seed=\{/, "avatars are seeded by the person's id, so a colour is stable");
  assert.match(src, /setInterval\(\s*tick,\s*WAIT_TICK_MS\s*\)/, "the wait counts down on a local timer");
  assert.match(src, /const WAIT_TICK_MS = 1_000;/, "the countdown ticks once a second");
});

// ── PinSignIn: pure helpers ─────────────────────────────────────────────────

test("PIN: the picker's greeting and date line, in fixed English", async () => {
  const { pinGreeting, pickerDateLabel } = await import("@/lib/staff-picker");
  assert.equal(pickerDateLabel(new Date(2026, 9, 16, 20, 27)), "Friday, 16 October", "the mock-up's date line");
  assert.equal(pickerDateLabel(new Date(2027, 0, 3, 9, 0)), "Sunday, 3 January", "no zero padding; month in full");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 20, 27)), "Good evening", "evening, no full stop (the mock-up)");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 9, 0)), "Good morning", "morning");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 14, 0)), "Good afternoon", "afternoon");
  // Ruling R28: the HTML's hours (values 4.3): before 12 morning, before 17 afternoon, else evening, by the device clock.
  assert.equal(pinGreeting(new Date(2026, 9, 16, 2, 0)), "Good morning", "2 am is the HTML's morning (hour < 12)");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 0, 0)), "Good morning", "midnight is morning too");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 11, 59)), "Good morning", "11:59 is still morning");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 12, 0)), "Good afternoon", "12:00 starts the afternoon");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 16, 59)), "Good afternoon", "16:59 is still afternoon");
  assert.equal(pinGreeting(new Date(2026, 9, 16, 17, 0)), "Good evening", "17:00 starts the evening");
});

test("PIN: the role tabs count every remembered person (All staff), the admins and the staff (R28, design 5.6)", async () => {
  const { roleTabs } = await import("@/lib/staff-picker");
  assert.deepEqual(
    roleTabs(THREE).map((t) => [t.value, t.label, t.count]),
    [["all", "All staff", 3], ["admin", "Admin", 1], ["staff", "Staff", 2]],
    "three people: All staff 3, Admin 1, Staff 2",
  );
  assert.deepEqual(roleTabs(NINE).map((t) => t.count), [9, 2, 7], "nine people: 9, 2, 7");
  assert.deepEqual(roleTabs([]).map((t) => t.count), [0, 0, 0], "nobody: zero everywhere, the tabs still there");
});

test("PIN: a tile's line under the name: Locked · {ago} for the locker, PIN blocked for a blocked PIN, else the role", async () => {
  const { tileSub } = await import("@/lib/staff-picker");
  const priya = THREE[0];
  const rohan = THREE[1];
  const locker = { id: priya.id, label: "Locked · 3 min ago" };
  assert.deepEqual(tileSub(priya, locker, new Set(), null), { text: "Locked · 3 min ago", tone: "locked" }, "the locker");
  assert.deepEqual(tileSub(rohan, locker, new Set(), null), { text: "Staff", tone: "role" }, "anyone else: the role");
  assert.deepEqual(tileSub(rohan, null, new Set([rohan.id]), null), { text: "PIN blocked", tone: "blocked" }, "a blocked PIN (design 5.6)");
  assert.deepEqual(tileSub(priya, null, new Set(), null), { text: "Admin", tone: "role" }, "an admin's role");
  assert.deepEqual(tileSub(priya, locker, new Set([priya.id]), null), { text: "Locked · 3 min ago", tone: "locked" }, "the locker's mark comes first");
  // Ruling R37: while our local wait runs for a person, the HTML's locked-out words in bad-i (values 4.3 tile states).
  assert.deepEqual(tileSub(rohan, locker, new Set(), rohan.id), { text: "Try again soon", tone: "out" }, "a person in the wait");
  assert.deepEqual(tileSub(rohan, null, new Set([rohan.id]), rohan.id), { text: "PIN blocked", tone: "blocked" }, "a blocked PIN says so, wait or not");
  assert.deepEqual(tileSub(priya, locker, new Set(), priya.id), { text: "Locked · 3 min ago", tone: "locked" }, "the locker's mark still first");
  assert.deepEqual(tileSub(priya, null, new Set(), rohan.id), { text: "Admin", tone: "role" }, "someone else's wait leaves this tile alone");
});

test("ruling R37: the picker hands the running wait's person to tileSub, and that line reads in bad-i", () => {
  const src = read(PIN);
  assert.match(src, /tileSub\(person, highlight, blockedIds, waitingId\)/, "the tile line knows who is in the wait");
  assert.match(src, /const waitingId = wait !== null && waitLeftSec > 0 \? wait\.id : null;/, "only while the wait runs");
  assert.match(src, /out: "text-status-bad-ink"/, "the HTML's locked-out sub colour (bad-i)");
});

test("ruling R34: Escape on the pad goes back to the picker, unless a field has focus or a try is in flight", async () => {
  const { escapeGoesBack } = await import("@/lib/staff-picker");
  assert.equal(escapeGoesBack({ key: "Escape", activeTag: "BODY", busy: false }), true, "Escape with nothing focused");
  assert.equal(escapeGoesBack({ key: "Escape", activeTag: "DIV", busy: false }), true, "Escape on the pad region");
  assert.equal(escapeGoesBack({ key: "Escape", activeTag: "INPUT", busy: false }), false, "never from a field");
  assert.equal(escapeGoesBack({ key: "Escape", activeTag: "TEXTAREA", busy: false }), false, "never from a text area");
  assert.equal(escapeGoesBack({ key: "Escape", activeTag: "BODY", busy: true }), false, "never while a try is in flight (its answer belongs to the pad)");
  assert.equal(escapeGoesBack({ key: "Enter", activeTag: "BODY", busy: false }), false, "only Escape");
});

test("ruling R34: the pad opens with focus on its own region (no ring on All staff), and Escape is heard on key-up", () => {
  const src = read(PIN);
  assert.match(src, /padRef\.current\?\.focus\(\)/, "the opening focus goes to the pad region");
  assert.ok(!/backRef\.current\?\.focus\(\)/.test(src), "not to All staff (typed digits would paint its ring, Enter would leave)");
  const view = src.match(/<div\b[^>]*data-ui="pin-view"[^>]*>/)?.[0] ?? "";
  assert.ok(view.includes("tabIndex={-1}"), "the region takes focus without joining the Tab order");
  assert.ok(view.includes('role="group"') && view.includes("aria-labelledby={"), "a screen reader hears the person and the PIN line on arrival");
  assert.ok(view.includes("outline-none"), "no focus ring on the region");
  // The lock cover swallows Escape's key-DOWN at the window (sheets left open under it must not close), so the pad
  // listens for the key-up, the same on the login page and the lock.
  assert.match(src, /window\.addEventListener\("keyup", onKeyUp\)/, "a window key-up listener");
  assert.match(src, /escapeGoesBack\(/, "decided by escapeGoesBack");
  // While a try is in flight (and through the success look) "All staff" is disabled but keeps its strength, as the
  // HTML's link never dims (the keys do the same).
  const back = src.match(/const BACK_CLASS = cn\(\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(back.includes("disabled:pointer-events-none"), "a disabled All staff takes no tap");
  assert.ok(!back.includes("disabled:opacity"), "and is not dimmed");
});

test('PIN: an empty search says "No staff found for “{q}”." (the HTML\'s words, the trimmed query)', async () => {
  const { noStaffLine } = await import("@/lib/staff-picker");
  assert.equal(noStaffLine("zz"), "No staff found for “zz”.", "the HTML's sentence with curly quotes");
  assert.equal(noStaffLine("  ro  "), "No staff found for “ro”.", "the query as filtered (trimmed)");
});

test("PIN: the header clock reads h:mm AM/PM", async () => {
  const { clockLabel } = await import("@/components/auth/AuthShell");
  assert.equal(clockLabel(new Date(2026, 9, 16, 20, 27)), "8:27 PM", "evening");
  assert.equal(clockLabel(new Date(2026, 9, 16, 0, 5)), "12:05 AM", "just after midnight");
  assert.equal(clockLabel(new Date(2026, 9, 16, 12, 0)), "12:00 PM", "noon");
  assert.equal(clockLabel(new Date(2026, 9, 16, 9, 7)), "9:07 AM", "minutes zero-padded, hours not");
});

test("PIN: the tile filter keeps the role tab and the search together", async () => {
  const { visiblePeople } = await import("@/lib/staff-picker");
  const ids = (list: KnownPerson[]) => list.map((p) => p.id).join(",");
  assert.equal(ids(visiblePeople(NINE, "all", "")), NINE.map((p) => p.id).join(","), "all, no search: everyone, in order");
  assert.equal(ids(visiblePeople(NINE, "admin", "")), "p1,p4", "Admin: the two admins");
  assert.equal(ids(visiblePeople(NINE, "staff", "")).split(",").length, 7, "Staff: the seven others");
  assert.equal(ids(visiblePeople(NINE, "all", "  ro ")), "p2", "a trimmed, case-insensitive name search");
  assert.equal(ids(visiblePeople(NINE, "admin", "rohan")), "", "the search stays inside the chosen tab");
  assert.equal(ids(visiblePeople(NINE, "all", "kapoor")), "p2", "the full name is searched, not only the short one");
});

test("PIN: what the pad shows for each answer (wrong keeps it enabled; a wait or a block disables it)", async () => {
  const { pinPadView } = await import("@/lib/staff-picker");
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

// U0 match Task 10 (ruling R28, design 5.6): the HTML shows the search and the role tabs at any count; the earlier
// "only above 8 people" rule (FILTERS_ABOVE) is gone, so three people get them too.
test("PIN: three remembered people -> three named tiles with their roles, and the search and the tabs All staff 3 / Admin 1 / Staff 2", async () => {
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
    assert.ok(tiles[i].tag.includes(`title="${THREE[i].name}"`), `tile ${i + 1} is titled with the full name`);
  });
  assert.ok(html.includes('placeholder="Search staff"'), "the search field shows for three people too");
  assert.ok(html.includes('role="tablist"'), "the role tabs show for three people too");
  const text = textOf(html);
  for (const tab of ["All staff 3", "Admin 1", "Staff 2"]) assert.ok(text.includes(tab), `the tab "${tab}"`);
  assert.ok(text.includes("Select your name to sign in"), "the picker's line");
  assert.ok(text.includes("Sign in with username and password"), "the way to the password form, under the tiles");
});

test("PIN: one remembered person still gets the search and the three tabs (any count)", async () => {
  const html = await renderPinSignIn({ people: [THREE[0]] });
  assert.equal(tilesOf(html).length, 1, "one tile");
  assert.ok(html.includes('placeholder="Search staff"') && html.includes('role="tablist"'), "search and tabs");
  const text = textOf(html);
  for (const tab of ["All staff 1", "Admin 1", "Staff 0"]) assert.ok(text.includes(tab), `the tab "${tab}"`);
});

test("PIN: the picker's look is the HTML's (values 4.3): head row, search box, role tabs, 3/4/6-column grid, tiles", async () => {
  const html = await renderPinSignIn({ people: THREE, highlight: { id: "p1", label: "Locked · 3 min ago" } });
  expectAll(tagOf(html, "pick-head"), ["flex", "flex-wrap", "items-end", "justify-between", "gap-3.5"], "the head row");
  expectAll(tagOf(html, "pick-greeting"), ["text-[22px]", "tab:text-[26px]", "font-semibold", "tracking-[-0.02em]"], "the greeting");
  expectAll(tagOf(html, "pick-sub"), ["mt-1", "text-[14px]", "text-muted-foreground"], "the sub line");
  expectAll(
    tagOf(html, "pick-search"),
    ["flex", "items-center", "gap-2", "h-10", "w-[calc(100%-32px)]", "tab:w-[260px]", "rounded-[8px]", "border", "border-border", "bg-card", "px-3"],
    "the search box",
  );
  expectAll(tagOf(html, "pick-search-input"), ["min-w-0", "flex-1", "border-0", "bg-transparent", "text-base", "tab:text-[14px]", "leading-[normal]", "text-foreground", "outline-none", "placeholder:text-subtle-foreground", "[&::-webkit-search-cancel-button]:appearance-none"], "the search input (no browser clear button: the HTML's has none)");
  expectAll(tagOf(html, "pick-tabs"), ["flex", "w-full", "gap-1", "overflow-x-auto", "border-b", "border-border"], "the role tabs row");
  expectAll(tagOf(html, "pick-tabs-root"), ["-mt-1.5", "flex", "flex-col", "gap-5"], "the tabs block (the HTML's margin-top -6, 20 to the grid)");
  for (let i = 0; i < 3; i += 1) {
    expectAll(
      tagOf(html, "pick-tab", i),
      ["h-10", "flex-none", "px-3", "text-[13.5px]", "font-medium", "text-muted-foreground", "data-[state=active]:font-semibold", "data-[state=active]:text-foreground", "data-[state=active]:[box-shadow:inset_0_-2px_0_var(--color-primary)]", "focus-visible:outline-2", "focus-visible:outline-ring"],
      `role tab ${i + 1}`,
    );
  }
  expectAll(tagOf(html, "pick-tab-count"), ["font-normal", "text-subtle-foreground"], "a tab's count");
  expectAll(tagOf(html, "pick-grid"), ["grid", "grid-cols-3", "gap-1.5", "tab:grid-cols-4", "tab:gap-2", "desk:grid-cols-6"], "the grid");
  const [locked, plain] = tilesOf(html);
  expectAll(locked.tag, ["relative", "flex", "min-w-0", "flex-col", "items-center", "gap-2", "rounded-[12px]", "border", "px-1.5", "pt-3.5", "pb-3", "border-accent-b", "bg-accent", "hover:bg-hover", "hover:border-border"], "the locker's tile");
  expectAll(plain.tag, ["border-transparent", "bg-transparent"], "a plain tile");
  expectAll(tagOf(html, "pick-tile-name"), ["max-w-full", "truncate", "text-[13px]", "tab:text-[14px]", "font-medium"], "a tile's short name");
  expectAll(tagOf(html, "pick-tile-sub", 0), ["whitespace-nowrap", "text-[12px]", "text-accent-foreground"], "the locker's line (accent-i)");
  expectAll(tagOf(html, "pick-tile-sub", 1), ["text-muted-foreground"], "a role line (text-2)");
  expectAll(tagOf(html, "pick-badge"), ["absolute", "-right-0.5", "-bottom-0.5", "size-5", "rounded-[50%]", "bg-ink", "text-on-ink", "[box-shadow:0_0_0_2px_var(--color-card)]"], "the lock badge");
  assert.equal((html.match(/data-ui="pick-badge"/g) ?? []).length, 1, "only the locker's tile carries the badge");
  assert.match(locked.tag, /style="animation-delay:0\.05s"/, "the first tile rises after .05s");
  assert.match(tilesOf(html)[2].tag, /style="animation-delay:0\.11s"/, "the third after .11s (min(.05 + i × .03, .4))");
  expectAll(tagOf(html, "pin-use-password"), ["self-center", "p-1", "text-[13.5px]", "font-medium", "text-link"], "the way to the password form (the HTML's link button)");
});

test("PIN: ruling R29 — two visible tiles with the same short name show the full names instead", async () => {
  const twins: KnownPerson[] = [
    person("a1", "Priya Sharma", "Priya S.", "PS", "staff"),
    person("a2", "Priya Singh", "Priya S.", "PS", "staff"),
    person("a3", "Rohan Kapoor", "Rohan K.", "RK", "staff"),
  ];
  const tiles = tilesOf(await renderPinSignIn({ people: twins }));
  assert.ok(tiles[0].text.startsWith("PS Priya Sharma"), `the first Priya shows her full name (got "${tiles[0].text}")`);
  assert.ok(tiles[1].text.startsWith("PS Priya Singh"), `the second Priya shows hers (got "${tiles[1].text}")`);
  assert.ok(tiles[2].text.startsWith("RK Rohan K."), `Rohan keeps the short name (got "${tiles[2].text}")`);
});

test("PIN: nine remembered people -> the search field and the tabs All staff 9 / Admin 2 / Staff 7", async () => {
  const html = await renderPinSignIn({ people: NINE });
  assert.equal(tilesOf(html).length, 9, "nine tiles on the All staff tab");
  assert.ok(html.includes('placeholder="Search staff"'), "the search field shows");
  assert.ok(html.includes('role="tablist"'), "the role tabs show");
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
