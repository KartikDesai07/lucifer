// Tables B2 Step 0 - the areas write seam (hooks/use-areas.ts) and the heal
// (hooks/use-table-areas.ts): RUNTIME proofs (lib/tables-commit.test.ts's approach -
// real QueryClient and api-client over a fake fetch) plus SOURCE pins for the hooks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { QueryClient } from "@tanstack/react-query";
import { AREAS_FRESH_PARAM } from "@/lib/area-order";
import { stripComments } from "@/lib/source-pin-utils";
import {
  AREA_KEYS,
  commitAreaChange,
  commitAreas,
  refreshAreasNow,
  withAreaRow,
  withoutAreaRow,
} from "@/hooks/use-areas";
import type { Area } from "@/types";

const CLOCK_SKEW_MS = 5 * 60 * 1000;

const STAMP = "2026-09-30T00:00:00.000Z";
const area = (id: string, name: string): Area => ({ _id: id, name, displayOrder: 0, createdAt: STAMP, updatedAt: STAMP });

const okJson = (data: unknown): Response =>
  new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });

test("withAreaRow replaces IN PLACE or appends last; withoutAreaRow removes by _id; neither mutates its input", () => {
  const list = [area("a", "Garden"), area("b", "Rooftop"), area("c", "Hall")];
  const renamed = area("b", "Terrace");
  const next = withAreaRow(list, renamed);
  assert.deepEqual(next.map((a) => a._id), ["a", "b", "c"]);
  assert.equal(next[1], renamed);
  assert.equal(next[0], list[0]);
  const created = area("z", "Patio");
  assert.deepEqual(withAreaRow(list, created).map((a) => a._id), ["a", "b", "c", "z"]);
  assert.deepEqual(withAreaRow([], created), [created]);
  assert.deepEqual(withoutAreaRow(list, "a").map((a) => a._id), ["b", "c"]);
  assert.deepEqual(withoutAreaRow(list, "nope").map((a) => a._id), ["a", "b", "c"]);
  assert.equal(list[1].name, "Rooftop", "the input list is never mutated");
  assert.deepEqual([...AREA_KEYS.all], ["areas"], "the single-segment key the master blob seeds");
});

test("RUNTIME: commitAreas lands even when the cached list carries a FUTURE dataUpdatedAt (device clock behind the server)", async () => {
  const qc = new QueryClient();
  const seeded = [area("a", "Garden"), area("b", "Rooftop")];
  const reordered = [area("b", "Rooftop"), area("a", "Garden")];
  qc.setQueryData(AREA_KEYS.all, seeded, { updatedAt: Date.now() + CLOCK_SKEW_MS });
  assert.ok((qc.getQueryState(AREA_KEYS.all)?.dataUpdatedAt ?? 0) > Date.now(), "landmark: the seed really is future-stamped");
  await commitAreas(qc, reordered);
  assert.deepEqual(qc.getQueryData(AREA_KEYS.all), reordered);
  qc.clear();
});

test("RUNTIME: commitAreas replaces an areas read already in flight instead of joining it (the read would land its older list)", async () => {
  const qc = new QueryClient();
  const before = [area("a", "Garden"), area("b", "Rooftop")];
  const saved = [area("b", "Rooftop"), area("a", "Garden")];
  qc.setQueryData(AREA_KEYS.all, before);
  let release: (list: Area[]) => void = () => undefined;
  const inFlight = qc
    .fetchQuery({ queryKey: AREA_KEYS.all, queryFn: () => new Promise<Area[]>((r) => { release = r; }), staleTime: 0 })
    .catch(() => undefined);
  const commit = commitAreas(qc, saved);
  release(before); // the older read answers while the commit is running
  await Promise.all([commit, inFlight]);
  assert.deepEqual(qc.getQueryData(AREA_KEYS.all), saved);
  qc.clear();
});

async function withFakeFetch(data: Area[], body: (urls: string[]) => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    urls.push(String(input));
    return okJson(data);
  }) as typeof fetch;
  try {
    await body(urls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("RUNTIME: commitAreaChange with NO cached list reads the fresh list and never commits a one-row list", async () => {
  const qc = new QueryClient();
  const live = [area("a", "Garden"), area("b", "Rooftop")];
  const created = area("z", "Patio");
  let changeCalled = false;
  await withFakeFetch(live, async (urls) => {
    assert.equal(qc.getQueryData(AREA_KEYS.all), undefined, "landmark: nothing cached");
    await commitAreaChange(qc, (list) => {
      changeCalled = true;
      return withAreaRow(list, created);
    });
    assert.deepEqual(urls, [`/api/areas?${AREAS_FRESH_PARAM}=1`], "exactly one read, skipping the instance cache");
  });
  assert.equal(changeCalled, false, "the change is not applied to a missing list");
  assert.deepEqual(qc.getQueryData(AREA_KEYS.all), live, "the live list is committed, not [created]");
  qc.clear();
});

test("RUNTIME: commitAreaChange WITH a cached list applies the change and does not touch the network", async () => {
  const qc = new QueryClient();
  qc.setQueryData(AREA_KEYS.all, [area("a", "Garden")]);
  await withFakeFetch([], async (urls) => {
    await commitAreaChange(qc, (list) => withAreaRow(list, area("z", "Patio")));
    assert.equal(urls.length, 0, "no read when the list is cached");
  });
  assert.deepEqual(qc.getQueryData<Area[]>(AREA_KEYS.all)?.map((a) => a._id), ["a", "z"]);
  qc.clear();
});

test("RUNTIME: commitAreaChange swallows an offline read failure (the cache stays as it was)", async () => {
  const qc = new QueryClient();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    await assert.doesNotReject(commitAreaChange(qc, (list) => [...list]));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(qc.getQueryData(AREA_KEYS.all), undefined);
  qc.clear();
});

test("RUNTIME: refreshAreasNow re-reads once when a newer commit lands while its read is in flight (never commits the older list over it)", async () => {
  const qc = new QueryClient();
  const older = [area("a", "Garden")];
  const newer = [area("a", "Garden"), area("b", "Rooftop")];
  const realFetch = globalThis.fetch;
  let calls = 0;
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      await firstGate; // answered BEFORE the newer save reached the server
      return okJson(older);
    }
    return okJson(newer);
  }) as typeof fetch;
  try {
    const pending = refreshAreasNow(qc);
    await commitAreas(qc, newer); // another write commits while the read is in flight
    releaseFirst();
    await pending;
    assert.equal(calls, 2, "the in-flight read is repeated once");
    assert.equal(qc.getQueryData<Area[]>(AREA_KEYS.all)?.length, 2, "the newer list survives");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("RUNTIME: refreshAreasNow with no commit meanwhile reads exactly once, on the fresh URL", async () => {
  const qc = new QueryClient();
  await withFakeFetch([area("a", "Garden")], async (urls) => {
    await refreshAreasNow(qc);
    assert.deepEqual(urls, [`/api/areas?${AREAS_FRESH_PARAM}=1`]);
  });
});

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readRaw = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const AREAS_HOOK = "apps/cafe/hooks/use-areas.ts";
const TABLE_AREAS_HOOK = "apps/cafe/hooks/use-table-areas.ts";
const hookSrc = stripComments(readRaw(AREAS_HOOK));
const healSrc = stripComments(readRaw(TABLE_AREAS_HOOK));

// Needles built by concatenation so this file never contains the literal it bans.
const SET_QUERY_DATA = "set" + "QueryData";
const ON_SETTLED = "on" + "Settled";

/** One exported function's text: from its header to the next top-level export. */
function bodyOf(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `source must contain ${header}`);
  const next = src.indexOf("\nexport ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

test("PIN: use-areas.ts never writes the cache directly - every write is a fetchQuery commit (the device blob only follows real fetches)", () => {
  assert.ok(hookSrc.includes("qc.fetchQuery("), "positive landmark: commitAreas commits through fetchQuery");
  assert.ok(!hookSrc.includes(SET_QUERY_DATA), "no direct cache write in the areas hooks");
  const read = bodyOf(hookSrc, "export function useAreas");
  assert.ok(read.includes("STALE_TIMES.MASTERS") && read.includes("GC_TIMES.MASTERS"), "master windows");
  assert.ok(read.includes('apiGet<Area[]>("/api/areas")') && !read.includes("refetchInterval"), "plain GET, no poll");
  assert.ok(!healSrc.includes(SET_QUERY_DATA), "and none in the heal hook");
});

test("PIN: commitAreas counts the commit, then cancels, then invalidates with refetchType none, then fetches", () => {
  const body = bodyOf(hookSrc, "export async function commitAreas");
  const steps = ["areasCommitSeq += 1", "cancelQueries(", "invalidateQueries(", "fetchQuery("].map((n) => body.indexOf(n));
  // First step present, then strictly increasing: every step exists AND the order holds.
  assert.ok(steps[0] >= 0 && steps.every((at, i) => i === 0 || at > steps[i - 1]), `order: count, cancel, invalidate, fetch (${steps})`);
  assert.ok(/refetchType:\s*"none"/.test(body), "the invalidate must start no network read");
  assert.ok(/staleTime:\s*0/.test(body), "staleTime 0 forces the commit's queryFn to run");
});

test("PIN: refreshAreasNow reads the fresh URL and re-reads once when the commit sequence moved", () => {
  const body = bodyOf(hookSrc, "export async function refreshAreasNow");
  assert.ok(body.includes("AREAS_FRESH_PARAM"), "the read goes through the shared fresh param");
  assert.ok(body.includes("const seq = areasCommitSeq"), "the sequence is captured before the read");
  assert.ok(/seq !== areasCommitSeq\)\s*fresh = await readFresh\(\)/.test(body), "an overtaken read is repeated once");
});

test("PIN: useReorderAreas has NO onSettled invalidate and re-reads the list on ANY error before it toasts", () => {
  const body = bodyOf(hookSrc, "export function useReorderAreas");
  assert.ok(body.includes("apiSend<Area[]>(\"/api/areas\", \"PATCH\""), "positive landmark: it PATCHes the whole id list");
  assert.ok(!body.includes(ON_SETTLED), "an onSettled invalidate's refetch can paint a stale list back");
  assert.ok(!hookSrc.includes(ON_SETTLED), "no hook in the file settles by invalidating");
  assert.ok(body.includes("onSuccess: (fresh) => commitAreas(qc, fresh)"), "success commits the response");
  const reread = body.indexOf("await refreshQuietly(qc)");
  const toast = body.indexOf("toast.error(");
  assert.ok(reread >= 0 && toast >= 0 && reread < toast, "the error re-read comes before the toast");
  assert.ok(body.includes("err.status === 409") && body.includes("? err.message"), "a 409 shows the server's own copy");
  assert.ok(body.includes("Could not save the new order"), "any other failure gets the hook's own copy");
});

test("PIN: useCreateArea settles only AFTER its commit, so a form never holds an id the list lacks", () => {
  const body = bodyOf(hookSrc, "export function useCreateArea");
  const post = body.indexOf('apiSend<Area>("/api/areas", "POST"');
  const commit = body.indexOf("await commitAreaChange(");
  const ret = body.indexOf("return created");
  assert.ok(post >= 0 && commit >= 0 && ret >= 0, "create must POST, commit and return the created area");
  assert.ok(post < commit && commit < ret, "the commit is awaited between the POST and the return");
  assert.ok(body.includes("mutationFn: async"), "the awaited commit lives inside the mutationFn");
  assert.ok(body.includes("void refreshQuietly(qc)"), "a failure (typically a duplicate) re-reads the list");
});

test("PIN: the toasts - success copy and 'err.message ||' fallbacks - are the planned plain-English strings", () => {
  const cases: Array<[string, string, string]> = [
    ["export function useCreateArea", "Area added", "Could not add the area"],
    ["export function useRenameArea", "Area renamed", "Could not rename the area"],
    ["export function useDeleteArea", "Area removed", "Could not remove the area"],
  ];
  for (const [header, ok, fallback] of cases) {
    const body = bodyOf(hookSrc, header);
    assert.ok(body.includes(`toast.success("${ok}")`), `${header} must toast "${ok}"`);
    assert.ok(body.includes(`toast.error(err.message || "${fallback}")`), `${header} must show err.message, falling back to "${fallback}"`);
  }
});

test("PIN: rename PUTs {id,name} to /api/areas/[id] and replaces the row; delete DELETEs and removes it", () => {
  const rename = bodyOf(hookSrc, "export function useRenameArea");
  assert.ok(/"PUT",\s*\{ name \}/.test(rename), "rename sends only the name, by PUT");
  assert.ok(rename.includes("withAreaRow(list, saved)"), "the response replaces the row");
  const remove = bodyOf(hookSrc, "export function useDeleteArea");
  assert.ok(remove.includes('"DELETE"'), "delete uses DELETE");
  assert.ok(remove.includes("withoutAreaRow(list, id)"), "the row is removed by _id");
});

test("PIN: the heal Set is MODULE scope (declared before the hook, not inside it) and the read runs in a useEffect", () => {
  const hookStart = healSrc.indexOf("export function useTableAreas");
  const setDecl = healSrc.indexOf("const triedHealKeys = new Set<string>()");
  assert.ok(hookStart >= 0, "positive landmark: the hook exists");
  assert.ok(setDecl >= 0 && setDecl < hookStart, "the Set is declared at module scope, above the hook");
  assert.ok(/^const triedHealKeys/m.test(healSrc), "declared at column 0, not nested in a function");
  const hook = healSrc.slice(hookStart);
  const effect = hook.indexOf("useEffect(");
  const read = hook.indexOf("refreshAreasNow(");
  assert.ok(effect >= 0 && read > effect, "refreshAreasNow is only reachable from inside the useEffect callback");
  assert.equal(hook.split("refreshAreasNow(").length - 1, 1, "and it is called exactly once");
});

test("PIN: the heal checks and adds its key synchronously BEFORE the read, deletes it on failure, catches, and is capped", () => {
  const hook = healSrc.slice(healSrc.indexOf("export function useTableAreas"));
  const guard = hook.indexOf("triedHealKeys.has(unknownKey)");
  const add = hook.indexOf("triedHealKeys.add(unknownKey)");
  const read = hook.indexOf("refreshAreasNow(");
  const del = hook.indexOf("triedHealKeys.delete(unknownKey)");
  const cap = hook.indexOf("triedHealKeys.size >= AREA_HEAL_TRIES_MAX");
  for (const [name, idx] of [["has", guard], ["add", add], ["read", read], ["delete", del], ["cap", cap]] as const) {
    assert.ok(idx >= 0, `the heal must contain the ${name} step`);
  }
  assert.ok(guard < add && add < read, "has -> add -> read, with no await between the check and the claim");
  assert.ok(cap < add, "the cap is applied before the claim");
  assert.ok(read < del && hook.indexOf(".catch(") > read && hook.indexOf(".catch(") < del, "the key is released inside the read's .catch");
  assert.ok(/AREA_HEAL_TRIES_MAX = 20;/.test(healSrc), "the cap is the planned 20");
});

test("PIN: the heal fires only on a non-empty unknown key, derived from the loaded list (none while areas are undefined)", () => {
  const hook = healSrc.slice(healSrc.indexOf("export function useTableAreas"));
  assert.ok(hook.includes("unknownAreaIdsKey(tables ?? [], areas.data)"), "the key comes from the loaded areas.data");
  assert.ok(/unknownKey === ""/.test(hook), "an empty key returns before any read");
  assert.ok(hook.includes("[unknownKey, qc]"), "the effect is keyed on the unknown-ids key");
});

test("PIN: the areas hooks stay under the 300-line ceiling", () => {
  for (const rel of [AREAS_HOOK, TABLE_AREAS_HOOK]) assert.ok(readRaw(rel).split("\n").length <= 300, rel);
});
