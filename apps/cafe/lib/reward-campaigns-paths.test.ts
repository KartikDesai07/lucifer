import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// CB-7 S6 session 3 source pins for festival cards: the shapes a fake-deps runtime test cannot observe. (1) both routes
// are admin-gated BEFORE any database work and share ONE DTO mapper; (2) the owner's list reads a diner's NAME only -
// no mobile number anywhere in the routes or the mapper; (3) the wallet read runs the issue BEFORE it builds the view
// and projects the programme markers, never the PIN hash; (4) the issue step is gated on rewardLevelsEarning and the
// reservation is given back ONLY in the push-miss branch; (5) the new server-only libs are in the client-graph walk.
// Every negative pin has a positive landmark beside it. Needles that could match this file are built by concatenation.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const LIST_ROUTE = "app/api/reward-campaigns/route.ts";
const END_ROUTE = "app/api/reward-campaigns/[id]/route.ts";
const DTO = "lib/reward-campaign-dto.ts";
const ISSUE = "lib/reward-campaign-issue.ts";
const PLAN = "lib/reward-campaign-issue-plan.ts";
const READ = "lib/reward-cards-read.ts";
const GUARD = "lib/client-graph-guard.test.ts";

const BANNED_MOBILE = "mob" + "ile";
const BANNED_HASH = "pin" + "Hash";
const RELEASE_CALL = "deps." + "release(";
const MIN_ONE = "issued: " + "-1";

const norm = (src: string): string => stripComments(src).replace(/\r\n/g, "\n");
const read = (rel: string): string => norm(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

function mustIndexOf(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

test("both routes: requireAdmin is called and refused BEFORE the first connectDB / model call", () => {
  for (const rel of [LIST_ROUTE, END_ROUTE]) {
    const src = read(rel);
    const guard = mustIndexOf(src, "requireAdmin(", `${rel} requireAdmin`);
    mustIndexOf(src, '"error" in admin', `${rel} the refusal return`);
    const db = mustIndexOf(src, "connectDB(", `${rel} connectDB`);
    assert.ok(guard < db, `${rel}: requireAdmin must come before connectDB`);
    // no model call inside a handler may precede its guard (a helper above the first handler is not a handler)
    const handlers = src.slice(src.indexOf("export async function "));
    const handlerGuard = handlers.indexOf("requireAdmin(");
    for (const model of ["Customer.", "RewardCampaign."]) {
      const at = handlers.indexOf(model);
      if (at !== -1) assert.ok(handlerGuard < at, `${rel}: ${model} used before the admin guard`);
    }
  }
  // the POST handler is gated too (the GET is the first handler in the list route)
  const list = read(LIST_ROUTE);
  const post = mustIndexOf(list, "export async function POST", "POST handler");
  const postGuard = mustIndexOf(list, "requireAdmin(", "POST requireAdmin", post);
  assert.ok(postGuard < mustIndexOf(list, "connectDB(", "POST connectDB", post));
  assert.ok(read(END_ROUTE).includes("export async function PATCH"), "landmark: the end route is a PATCH");
});

test("both routes share the ONE DTO mapper (no second mapper, no mobile number anywhere)", () => {
  for (const rel of [LIST_ROUTE, END_ROUTE]) {
    const src = read(rel);
    assert.ok(src.includes("campaignDtoOf("), `${rel} must map through campaignDtoOf`);
    assert.ok(src.includes('from "@/lib/reward-campaign-dto"'), `${rel} imports the shared mapper`);
  }
  assert.ok(read(DTO).includes("export function campaignDtoOf("), "landmark: the mapper lives in the dto lib");
  for (const rel of [LIST_ROUTE, END_ROUTE, DTO]) {
    assert.equal(read(rel).toLowerCase().includes(BANNED_MOBILE), false, `${rel} must never touch a mobile number`);
  }
});

test("the owner's lists read a diner's NAME only: every Customer.find selects exactly name", () => {
  for (const rel of [LIST_ROUTE, END_ROUTE]) {
    const src = read(rel);
    const finds = count(src, "Customer.find(");
    assert.ok(finds >= 1, `${rel}: landmark - a Customer.find exists`);
    assert.equal(count(src, 'Customer.find({ _id: { $in: '), finds, `${rel}: every Customer.find is the id-list lookup`);
    assert.equal(count(src, '.select("name")'), finds, `${rel}: every Customer.find selects only name`);
  }
  assert.equal(count(read(LIST_ROUTE), "Customer.find("), 1, "the list reads the picked diners with ONE find");
});

test("readDinerCards runs the issue BEFORE building the view, re-reads only on an issue, and never projects the PIN hash", () => {
  const src = read(READ);
  const fn = mustIndexOf(src, "export async function readDinerCards(", "readDinerCards");
  const issue = mustIndexOf(src, "deps.issueCampaigns(", "the issue call", fn);
  const build = mustIndexOf(src, "buildDinerCardsData({", "the view build", fn);
  assert.ok(issue < build, "the issue must run before the view is built");
  assert.ok(src.slice(issue, build).includes("> 0"), "the wallet is re-read only when at least one card was issued");
  assert.ok(src.includes('select("cardSteps rewardsAnchorAt pinSetAt +rewardCards")'), "landmark: the wallet projection carries the programme markers");
  assert.equal(src.includes(BANNED_HASH), false, "the wallet read must never name the PIN hash");
  assert.ok(src.includes("issueCampaignCards("), "landmark: the real dep is the issue lib");
});

test("the issue lib is gated on rewardLevelsEarning first and never projects the PIN hash", () => {
  const src = read(ISSUE);
  const fn = mustIndexOf(src, "export async function issueCampaignCards(", "issueCampaignCards");
  const gate = mustIndexOf(src, "rewardLevelsEarning(", "the earning gate", fn);
  assert.ok(gate < mustIndexOf(src, "deps.findActive(", "the campaign read", fn), "the gate must precede the campaign read");
  assert.equal(src.includes(BANNED_HASH), false, "the issue lib must never name the PIN hash");
  assert.ok(src.includes("pinSetAt"), "landmark: pinSetAt stands in for holding a PIN");
  const plan = read(PLAN);
  assert.equal(plan.includes(".select(" + BANNED_HASH), false);
  assert.ok(plan.includes(BANNED_HASH + ": { $exists: true }"), "landmark: the push FILTER (not a projection) names it");
  assert.ok(plan.includes("ACTIVE_CAMPAIGNS_SELECT"), "landmark: the campaign read has its own projection");
});

test("the reservation is given back ONLY in the push-miss branch (never after a throw)", () => {
  const src = read(ISSUE);
  assert.equal(count(src, RELEASE_CALL), 1, "exactly one compensation call site");
  const reserve = mustIndexOf(src, "deps.reserve(", "the reservation");
  const push = mustIndexOf(src, "deps.pushCard(", "the push", reserve);
  const release = mustIndexOf(src, RELEASE_CALL, "the release");
  const miss = mustIndexOf(src, "matchedCount === 0", "the push-miss test", push);
  assert.ok(reserve < push && push < miss && miss < release, "reserve, push, miss branch, release - in that order");
  const catchAt = mustIndexOf(src, "} catch {", "the swallow");
  assert.ok(release < catchAt, "the release sits before (outside) the catch block");
  assert.equal(src.slice(catchAt).includes("release("), false, "the catch block never compensates");
  const planSrc = read(PLAN);
  assert.equal(count(planSrc, MIN_ONE), 1, "the -1 decrement is defined once");
  assert.ok(planSrc.includes("issued: 1"), "landmark: the reservation increment is there too");
  assert.equal(count(src, MIN_ONE), 0, "the issue lib itself never writes a -1");
});

test("the new server-only libs are registered in the client graph walk; the dto lib stays pure", () => {
  const guard = read(GUARD);
  assert.ok(guard.includes("campaign-issue-plan|campaign-issue"), "both issue modules are SERVER_ONLY");
  assert.ok(guard.includes("card-scratch|cards-read"), "landmark: the earlier registrations are still there");
  const dto = read(DTO);
  assert.equal(dto.includes("@/models/"), false, "the dto mapper must not import a model");
  assert.equal(dto.includes('from "mongoose"'), false, "the dto mapper must not import mongoose");
});

// Review lens A LOW-4: the POST cap counts EVERY campaign not yet ended, so the owner's list must always show those - else a
// campaign planned far ahead could fall off the newest-20 page (unendable, still issuing, still holding a slot). Sorting by
// endsAt descending puts every not-yet-ended campaign (endsAt >= now) ahead of every ended one (endsAt < now).
test("the owner's list is ordered by endsAt descending, so every campaign not yet ended is on the page", () => {
  const src = read(LIST_ROUTE);
  const get = src.slice(mustIndexOf(src, "export async function GET", "the GET handler"), mustIndexOf(src, "export async function POST", "the POST handler"));
  mustIndexOf(get, ".sort({ endsAt: -1 })", "the endsAt-descending sort");
  assert.equal(count(get, "createdAt: -" + "1"), 0, "the page is no longer cut by creation time");
  mustIndexOf(get, ".limit(CAMPAIGNS_LIST_MAX)", "landmark: the page is still bounded");
});
