import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// P2 N2: the session on the device. The pure parts are tested in lib/device-session.test.ts; these pins hold the
// wiring a unit test cannot reach (no React test framework here): where SessionProvider lives, that the gate never
// asks next-auth for its first answer, what it renders while it waits, and that it wraps the whole staff shell.
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

const GATE = "components/layout/DeviceSessionGate.tsx";
const PURE = "lib/device-session.ts";
const PROVIDER = "components/layout/MasterDataProvider.tsx";
const DASHBOARD_LAYOUT = "app/(dashboard)/layout.tsx";
const ROOT_LAYOUT = "app/layout.tsx";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(CAFE_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test("PIN: SessionProvider appears only in the gate (app/ and components/, comments stripped); the root layout has no next-auth", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")];
  assert.ok(files.includes(ROOT_LAYOUT) && files.includes(GATE), "landmark: the walk sees the root layout and the gate");
  const hits = files.filter((rel) => code(rel).includes("SessionProvider")).sort();
  assert.deepEqual(hits, [GATE], `SessionProvider must live only in the gate; found in: ${hits.join(", ")}`);
  assert.ok(!code(ROOT_LAYOUT).includes("next-auth"), "the root layout (shared with /login and /m) imports nothing from next-auth");
});

test("PIN: the gate never asks next-auth for its first answer (no getSession, no useSession); it asks with askSession", () => {
  const gate = code(GATE);
  const pure = code(PURE);
  assert.match(gate, /^\s*"use client"/, "the gate is a client component");
  assert.match(gate, /startSessionReader\(/, "landmark: the gate runs the reader");
  assert.match(gate, /askSession\(/, "landmark: each attempt is askSession");
  for (const [name, src] of [["the gate", gate], ["lib/device-session.ts", pure]] as const) {
    for (const banned of ["getSession", "useSession"]) {
      assert.ok(!src.includes(banned), `${name} must not use next-auth's ${banned}: its client fetch turns a failure into a null session`);
    }
    for (const store of ["localStorage", "sessionStorage", "indexedDB"]) {
      assert.ok(!src.includes(store), `${name} must not store the session on the device (${store}): the next person could see it`);
    }
  }
  assert.ok(!/from "next-auth\/react"/.test(pure), "the pure module imports nothing from next-auth/react");
  assert.match(pure, /cache:\s*"no-store"/, "askSession never reads the HTTP cache");
  assert.match(pure, /credentials:\s*"same-origin"/, "askSession sends the cookie, same-origin only");
});

test("PIN: the gate renders the plain placeholder, then after MASTERS_HOLD_MAX_MS the words and Retry; a sign-out goes to /login", () => {
  const gate = code(GATE);
  assert.match(gate, /<SessionProvider session=\{session\}>\{children\}<\/SessionProvider>/, "children only inside the provider");
  assert.equal(gate.split("{children}").length - 1, 1, "children render in exactly one place (never before a session)");
  assert.match(gate, /<ShellPlaceholder \/>/, "the plain placeholder before an answer");
  assert.match(
    gate,
    /<ShellPlaceholder message="Connecting to the server…" onRetry=\{retryNow\} \/>/,
    "the words, exactly, with Retry",
  );
  assert.match(gate, /window\.setTimeout\(\(\) => setSlow\(true\), MASTERS_HOLD_MAX_MS\)/, "the words wait MASTERS_HOLD_MAX_MS");
  assert.match(gate, /if \(slow\) return <ShellPlaceholder message=/, "the words show only once slow");
  assert.match(gate, /window\.location\.assign\("\/login"\)/, "a real sign-out is a full load of /login");
  assert.match(gate, /return \(\) => \{[\s\S]*\.stop\(\)[\s\S]*window\.clearTimeout\(/, "unmount stops the reader and the timer");
});

test("PIN: MasterDataProvider exports ShellPlaceholder and uses it for its own placeholder; Retry is a 44px button", () => {
  const src = code(PROVIDER);
  assert.match(src, /export function ShellPlaceholder\(/, "ShellPlaceholder is exported");
  assert.match(src, /if \(!mounted \|\| holding\) \{\s*return <ShellPlaceholder \/>;/, "the provider's placeholder is ShellPlaceholder");
  const at = src.indexOf("export function ShellPlaceholder(");
  const body = src.slice(at);
  assert.match(body, /<span className="sr-only">Loading<\/span>/, "the plain case keeps the screen reader's Loading");
  assert.match(body, /<Skeleton className="h-24 w-full max-w-sm" \/>/, "the plain case keeps today's skeleton");
  assert.match(body, /<Button[^>]*className="[^"]*\bh-11\b[^"]*"[^>]*onClick=\{onRetry\}[^>]*>\s*Retry\s*<\/Button>/, "Retry: a 44px kit button");
  assert.match(body, /role="status"/, "the words are announced");
});

test("PIN: the dashboard layout wraps everything inside MasterDataProvider in one DeviceSessionGate", () => {
  const src = code(DASHBOARD_LAYOUT).replace(/\{\s*\}/g, "");
  assert.equal(src.split("<DeviceSessionGate>").length - 1, 1, "one gate");
  assert.match(src, /import \{ DeviceSessionGate \} from "@\/components\/layout\/DeviceSessionGate";/, "imported");
  assert.match(src, /<MasterDataProvider>\s*<DeviceSessionGate>/, "the gate is MasterDataProvider's first child");
  assert.match(src, /<\/DeviceSessionGate>\s*<\/MasterDataProvider>/, "and its last");
  const open = src.indexOf("<DeviceSessionGate>");
  const close = src.indexOf("</DeviceSessionGate>");
  for (const inside of ["<DocumentBranding />", "<SessionKeepalive />", "<OfflineReplayRunner />", "<ScreenLock />", "<AppSidebar />", "{children}", "<TabBar />"]) {
    const at = src.indexOf(inside);
    assert.ok(at > open && at < close, `${inside} waits for the session inside the gate`);
  }
});
