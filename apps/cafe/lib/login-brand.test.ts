// Ruling R39 (final review I2): the login screen's header names the cafe, as the owner's HTML lock/login header does
// (design 5.6, values 4.2), where it used to name the product. /login has no session, so the name is read on the
// server with readSettings(): the same in-memory-cached, read-only look-up app/layout.tsx's generateMetadata already
// makes on every /login (no new request, no write; never getSettings(), which creates the document). The product's
// mark stays the tile, and a database that cannot be read shows the product's name instead of breaking sign-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { APP_NAME } from "@/lib/constants";
import { loginBrandNameOf, readLoginBrandName } from "@/lib/login-brand";
import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

const PAGE = "app/(auth)/login/page.tsx";
const SCREEN = "components/auth/LoginScreen.tsx";
const BRAND = "lib/login-brand.ts";

test("loginBrandNameOf: the cafe's restaurantName, trimmed; the product's name when there is none", () => {
  assert.equal(loginBrandNameOf({ restaurantName: "Olivea Pizza" }), "Olivea Pizza", "the cafe's own name");
  assert.equal(loginBrandNameOf({ restaurantName: "  Olivea   Pizza \n" }), "Olivea   Pizza", "trimmed at both ends (as the shell trims it)");
  assert.equal(loginBrandNameOf({ restaurantName: "   " }), APP_NAME, "a blank name: the product's name");
  assert.equal(loginBrandNameOf({ restaurantName: "" }), APP_NAME, "an empty name: the product's name");
  assert.equal(loginBrandNameOf({}), APP_NAME, "a document older than the field: the product's name");
  assert.equal(loginBrandNameOf(null), APP_NAME, "no settings document yet (a fresh cluster): the product's name");
});

test("readLoginBrandName: one read; a read that fails shows the product's name instead of breaking the sign-in screen", async () => {
  let reads = 0;
  const name = await readLoginBrandName(async () => {
    reads += 1;
    return { restaurantName: " Baseline Cafe " };
  });
  assert.equal(name, "Baseline Cafe", "the cafe's name from the read");
  assert.equal(reads, 1, "exactly one read");
  assert.equal(await readLoginBrandName(async () => null), APP_NAME, "nothing stored: the product's name");
  const failing = await readLoginBrandName(async () => {
    throw new Error("database down");
  });
  assert.equal(failing, APP_NAME, "a database that cannot be read: the product's name, never an error page");
});

test("PIN: the read is readSettings() (cached, read-only), never getSettings(), and only on the server", () => {
  const brand = read(BRAND);
  assert.match(brand, /import \{ readSettings \} from "@\/lib\/settings";/, "the look-up app/layout.tsx already makes on /login");
  assert.match(brand, /read: \(\) => Promise<[^>]*> = readSettings/, "readSettings is the default reader");
  const page = read(PAGE);
  const screen = read(SCREEN);
  for (const [name, src] of [["lib/login-brand.ts", brand], ["the login page", page], ["the login screen", screen]] as const) {
    assert.ok(!src.includes("getSettings"), `${name} never calls getSettings() (it upserts: a write per anonymous visit)`);
    assert.ok(!/\bfetch\(|useSettings|useQuery/.test(src.replace(/fetchKnownPeople\(/g, "")), `${name} adds no request of its own for the name`);
  }
  assert.ok(!/^\s*["']use client["']/m.test(page.slice(0, 200)), "the page is a server component (it reads on the server)");
  assert.match(page, /export default async function LoginPage\(\)/, "an async server page");
  assert.match(page, /<LoginScreen brandName=\{await readLoginBrandName\(\)\} \/>/, "it hands the cafe's name to the client screen");
  assert.ok(/^\s*["']use client["']/m.test(screen.slice(0, 200)), "the screen is the client component the page used to be");
  assert.ok(!screen.includes("login-brand") && !screen.includes("@/lib/settings"), "the client screen never imports the server read");
});

test("the header's cafe-name slot shows brandName; the tile stays the product's mark", () => {
  const screen = read(SCREEN);
  assert.match(screen, /export function LoginScreen\(\{ brandName \}: \{ brandName: string \}\)/, "the screen takes brandName");
  assert.match(screen, /<AuthShell\s+brandName=\{brandName\}/, "the cafe's name goes to the header's name slot");
  assert.ok(!screen.includes("brandName={APP_NAME}"), "no longer the product's name there");
  assert.match(screen, /const productLogoSrc = brandingUrl\("productLogo"\);/, "the tile is still the product's logo (ruling R3)");
  assert.match(screen, /alt=\{APP_NAME\}/, "named as the product");
});
