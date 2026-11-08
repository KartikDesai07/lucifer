import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRINT_AGENT_HEADER, PRINT_LEASE_HEADER } from "@pos/shared/print-agent-wire";
import { apiSend } from "@/lib/api-client";
import { printRequestOptions } from "@/lib/print-agent-calls";
import { printHostBusy } from "@/lib/print-host-busy";
import { stripComments } from "@/lib/source-pin-utils";

// R70: a request that names this tab (the lease header) is print work while in flight, so Refresh, the update chip and
// the quiet reload see it: the slips it makes may come back leased to this tab and would expire into a REPRINT if the
// page left first. A request without the lease header is not counted (its slips go to the printer's line).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CAFE = path.join(REPO_ROOT, "apps/cafe");

function pendingFetch() {
  const calls: { resolve: (res: Response) => void; reject: (e: unknown) => void }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (() =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ resolve, reject });
    })) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const ok = () => new Response(JSON.stringify({ success: true, data: 1 }), { status: 200, headers: { "content-type": "application/json" } });
const leaseHeaders = { [PRINT_AGENT_HEADER]: "1", [PRINT_LEASE_HEADER]: "tab-1" };

test("printRequestOptions: nothing for no headers, track only when the headers name this tab", () => {
  assert.deepEqual(printRequestOptions(undefined), {}, "undefined → {}");
  assert.deepEqual(printRequestOptions({}), {}, "empty → {}");
  const lease = printRequestOptions(leaseHeaders);
  assert.equal(lease.headers, leaseHeaders, "the headers are passed on");
  assert.equal(typeof lease.track, "function", "a lease header → tracked");
  const noLease = printRequestOptions({ [PRINT_AGENT_HEADER]: "1" });
  assert.deepEqual(Object.keys(noLease), ["headers"], "no lease header → headers only, no track");
});

test("a request with the lease header counts as print work while pending, and lets go after a success", async () => {
  const f = pendingFetch();
  try {
    assert.equal(printHostBusy(), false, "free before");
    const sent = apiSend("/api/x", "POST", {}, printRequestOptions(leaseHeaders));
    assert.equal(printHostBusy(), true, "busy while the request is pending");
    f.calls[0].resolve(ok());
    assert.equal(await sent, 1, "the caller still gets the value");
    assert.equal(printHostBusy(), false, "free after it settled");
  } finally {
    f.restore();
  }
});

test("... and after a failure too, with the same error for the caller", async () => {
  const f = pendingFetch();
  try {
    const sent = apiSend("/api/x", "POST", {}, printRequestOptions(leaseHeaders)).catch((e: unknown) => e);
    assert.equal(printHostBusy(), true, "busy while pending");
    f.calls[0].reject(new TypeError("Failed to fetch"));
    const error = (await sent) as { kind?: string };
    assert.equal(error.kind, "network", "the caller gets the network ApiError");
    assert.equal(printHostBusy(), false, "free after the failure");
  } finally {
    f.restore();
  }
});

test("a request without the lease header is not counted", async () => {
  const f = pendingFetch();
  try {
    const sent = apiSend("/api/x", "POST", {}, printRequestOptions({ [PRINT_AGENT_HEADER]: "1" }));
    assert.equal(printHostBusy(), false, "its slips go to the printer's line, not this tab");
    f.calls[0].resolve(ok());
    await sent;
    const bare = apiSend("/api/x", "POST", {}, printRequestOptions(undefined));
    assert.equal(printHostBusy(), false, "no headers: not counted");
    f.calls[1].resolve(ok());
    await bare;
  } finally {
    f.restore();
  }
});

// Source pin: print headers reach a request only through printRequestOptions / printAgentRequestOptions.
const KNOWN_BUILDERS = [
  "hooks/use-host-routing.ts", // printAgentEnqueueHeaders → hooks/use-print-host.ts (enqueue)
  "hooks/use-item-void.ts",
  "hooks/use-offline-fix.ts",
  "hooks/use-offline-replay.ts",
  "hooks/use-order-requests.ts", // accept
  "hooks/use-orders.ts", // create, add items, settle, table move
  "hooks/use-print-setup.ts", // test print
  "hooks/use-self-order-auto-print.ts", // kot-claim
];

function sources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push({ rel: path.relative(CAFE, full).split(path.sep).join("/"), text: stripComments(readFileSync(full, "utf8")) });
      }
    }
  };
  for (const root of ["app", "components", "hooks", "lib"]) walk(path.join(CAFE, root));
  return out;
}

test("pin: only the known files build print headers, and every apiSend that sends headers goes through the helper", () => {
  const files = sources().filter((f) => f.rel !== "lib/print-agent-calls.ts");
  const builders = files
    .filter((f) => /printAgentHeaders\(|printAgentEnqueueHeaders\(|printAgentRequestOptions\(/.test(f.text))
    .map((f) => f.rel)
    .sort();
  assert.deepEqual(builders, [...KNOWN_BUILDERS].sort(), "a new file that builds print headers must be added here, and use the helper");
  const byPath = new Map(files.map((f) => [f.rel, f.text]));
  assert.match(byPath.get("hooks/use-print-setup.ts") ?? "", /printRequestOptions\(printAgentHeaders\(/, "test print wraps its headers");
  assert.match(byPath.get("hooks/use-print-host.ts") ?? "", /apiSend<[^>]*>\("\/api\/print-jobs", "POST", input, printRequestOptions\(headers\)\)/, "enqueue wraps its headers");
  const bare: string[] = [];
  const raw: string[] = [];
  for (const f of files) {
    for (const line of f.text.split("\n")) {
      if (/\bapiSend\b[^\n]*\bheaders\b/.test(line) && !line.includes("printRequestOptions(")) bare.push(`${f.rel}: ${line.trim()}`);
      // lib/print-order-jobs.ts is the server's reader of these headers, not a sender.
      if (f.rel !== "lib/print-order-jobs.ts" && /\bPRINT_LEASE_HEADER\b|\bPRINT_AGENT_HEADER\b/.test(line)) raw.push(`${f.rel}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bare, [], "an apiSend that sends headers must use printRequestOptions");
  assert.deepEqual(raw, [], "no cafe source names the print headers itself; they are built in lib/print-agent-calls.ts");
});
