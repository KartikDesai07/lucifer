// Settings pass (s62) — a successful save must leave the settings cache holding
// the SAVED document. SettingsSectionPage now renders loaded settings over a
// background refetch error, so a cache still holding the pre-save copy would
// remount a section's form from it and the next Save would write the old
// values back (review finding, arbitrated against hooks/use-settings.ts +
// hooks/use-settings-section-form.ts). RUNTIME proofs over a real QueryClient
// (lib/areas-commit.test.ts's approach) plus a SOURCE pin for the hook wiring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { QueryClient } from "@tanstack/react-query";
import { stripComments } from "@/lib/source-pin-utils";
import { SETTINGS_KEYS, commitSettings } from "@/hooks/use-settings";
import type { Settings } from "@/types";

const CLOCK_SKEW_MS = 5 * 60 * 1000;

const doc = (restaurantName: string): Settings => ({ restaurantName }) as Settings;

const failingRead = (qc: QueryClient) =>
  qc
    .fetchQuery({ queryKey: SETTINGS_KEYS.all, queryFn: () => Promise.reject(new Error("offline")), staleTime: 0, retry: false })
    .catch(() => undefined);

test("commitSettings: the saved document replaces the cached pre-save copy and survives a failed re-read", async () => {
  const qc = new QueryClient();
  qc.setQueryData(SETTINGS_KEYS.all, doc("Old name"));

  await commitSettings(qc, doc("New name"));
  assert.equal(qc.getQueryData<Settings>(SETTINGS_KEYS.all)?.restaurantName, "New name");

  // The post-save re-read fails (flaky line): the query is in error, but the
  // data a remounting form starts from is still the SAVED document.
  await failingRead(qc);
  assert.equal(qc.getQueryState(SETTINGS_KEYS.all)?.status, "error");
  assert.equal(qc.getQueryData<Settings>(SETTINGS_KEYS.all)?.restaurantName, "New name");
});

test("commitSettings: lands even when the cached copy is stamped in the future (bootstrap seeds the server clock)", async () => {
  const qc = new QueryClient();
  qc.setQueryData(SETTINGS_KEYS.all, doc("Old name"), { updatedAt: Date.now() + CLOCK_SKEW_MS });

  await commitSettings(qc, doc("New name"));
  assert.equal(qc.getQueryData<Settings>(SETTINGS_KEYS.all)?.restaurantName, "New name");
});

test("commitSettings: the commit is a real fetch (not a manual write), so MasterDataProvider persists it to the device copy", async () => {
  const qc = new QueryClient();
  qc.setQueryData(SETTINGS_KEYS.all, doc("Old name"));
  const manualFlags: boolean[] = [];
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success") manualFlags.push(event.action.manual === true);
  });
  await commitSettings(qc, doc("New name"));
  unsubscribe();
  assert.deepEqual(manualFlags, [false], "exactly one non-manual success action — the provider's write-back trigger");
});

const here = path.dirname(fileURLToPath(import.meta.url));
const USE_SETTINGS = path.join(here, "..", "hooks", "use-settings.ts");
const hookSrc = stripComments(readFileSync(USE_SETTINGS, "utf8"));

/** One exported function's text: from its header to the next top-level export. */
function bodyOf(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `source must contain ${header}`);
  const next = src.indexOf("\nexport ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

// The runtime tests above run with no query observer, so they cannot see a
// dropped cancel or a refetching invalidate — with the sidebar's observer
// mounted, either lets fetchQuery JOIN a network read that may carry the
// pre-save copy (lib/areas-commit.test.ts pins commitAreas the same way).
test("PIN: commitSettings cancels, then invalidates with refetchType none, then commits through fetchQuery", () => {
  const body = bodyOf(hookSrc, "export async function commitSettings");
  const steps = ["cancelQueries(", "invalidateQueries(", "fetchQuery("].map((n) => body.indexOf(n));
  assert.ok(steps[0] >= 0 && steps.every((at, i) => i === 0 || at > steps[i - 1]), `order: cancel, invalidate, fetch (${steps})`);
  assert.ok(/refetchType:\s*"none"/.test(body), "the invalidate must start no network read");
  assert.ok(/staleTime:\s*0/.test(body), "staleTime 0 forces the commit's queryFn to run");
  assert.ok(/queryFn:\s*\(\)\s*=>\s*Promise\.resolve\(saved\)/.test(body), "the commit's queryFn resolves the saved document, never a network read");
});

test("PIN: useUpdateSettings commits the PUT's returned document on success and re-reads only after a failed save", () => {
  const body = bodyOf(hookSrc, "export function useUpdateSettings(");
  const onSuccess = body.slice(body.indexOf("onSuccess:"), body.indexOf("onError:"));
  assert.ok(body.indexOf("onSuccess:") >= 0 && body.indexOf("onError:") > body.indexOf("onSuccess:"), "landmark: onSuccess then onError");
  // Awaited (mutateAsync — and the form's reset — wait for the commit) and
  // caught (a throwing onSuccess sends a SUCCESSFUL save down the error path:
  // a false "Could not save settings" toast).
  assert.match(onSuccess, /\bawait\s+commitSettings\(\s*qc\s*,\s*saved\s*\)\s*\.catch\(/, "onSuccess must await commitSettings(qc, saved).catch(...)");
  assert.ok(!/invalidateQueries/.test(onSuccess), "onSuccess must not re-read: another instance's 45s settings cache can answer with the pre-save copy");
  assert.ok(!/\bonSettled\s*:/.test(body), "no onSettled re-read on success (it would race the commit)");
  const onError = body.slice(body.indexOf("onError:"));
  assert.match(onError, /invalidateQueries\(\s*\{\s*queryKey:\s*SETTINGS_KEYS\.all/, "a failed save re-reads the settings (the old onSettled behaviour, on the error path only)");
});
