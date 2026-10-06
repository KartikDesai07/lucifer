import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// Printing redesign Phase 1, Session 1C: the source pins of the agent's wiring. The rules themselves
// are unit-tested (print-agent.test.ts, print-write-outcome.test.ts); these pin that every call site
// reaches them, and that nothing prints a slip outside the queue on a device that has an identity.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CAFE = path.join(REPO_ROOT, "apps/cafe");
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;

function callSites(needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && readFileSync(full, "utf8").includes(needle)) {
        hits.push(path.relative(CAFE, full).split(path.sep).join("/"));
      }
    }
  };
  for (const root of ["app", "components", "hooks"]) walk(path.join(CAFE, root));
  return hits.sort();
}

// R1: an order request opts in only when its call site prints the slips it makes. Each of these hooks
// has exactly one caller, and that caller prints them; a new caller is a deliberate decision.
test("INVENTORY: each printing order mutation has exactly its one known caller, which prints the slip", () => {
  const known: Record<string, string> = {
    "useCreateOrder(": "hooks/use-pos-tab.ts",
    "useAddOrderItems(": "hooks/use-pos-tab.ts",
    "useItemVoid(": "app/(dashboard)/pos/page.tsx",
    "useMoveOrderTable(": "components/orders/MoveTableDialog.tsx",
    "useAcceptOrderRequest(": "app/(dashboard)/requests/page.tsx",
  };
  for (const [hook, caller] of Object.entries(known)) {
    const sites = callSites(hook).filter((f) => !f.startsWith("hooks/use-orders.ts") && !f.startsWith("hooks/use-item-void.ts") && !f.startsWith("hooks/use-order-requests.ts"));
    assert.deepEqual(sites, [caller], `${hook} must be called only from ${caller}; found ${sites.join(", ")}`);
  }
  assert.ok(src("apps/cafe/hooks/use-pos-tab.ts").includes("}, { printsBill: true });"), "the POS settle prints its bill, so it asks the server to make it");
  assert.ok(!src("apps/cafe/components/orders/OrderDetailSheet.tsx").includes("printsBill"), "the Orders sheet's settle never printed, so it never asks");
});

test("PIN (R1): the order requests send the opt-in through apiSend's headers; only Pay Now and the POS settle add the bill", () => {
  const orders = src("apps/cafe/hooks/use-orders.ts");
  assert.ok(orders.includes('apiSend<Order>("/api/orders", "POST", data, printAgentRequestOptions(data.status === "Completed"))'), "create: the KOT, and Pay Now's bill");
  assert.ok(orders.includes('apiSend<Order>(`/api/orders/${id}/items`, "POST", data, printAgentRequestOptions())'), "a round: its KOT");
  assert.ok(orders.includes('apiSend<Order>(`/api/orders/${id}/settle`, "POST", data, options.printsBill === true ? printAgentRequestOptions(true) : {})'), "a settle: the bill only when asked");
  assert.ok(orders.includes('apiSend<Order>(`/api/orders/${id}/table`, "POST", { tableNo }, printAgentRequestOptions())'), "a move: its slip");
  assert.ok(src("apps/cafe/hooks/use-item-void.ts").includes('"POST", data, printAgentRequestOptions())'), "a void: its slip");
  assert.ok(src("apps/cafe/hooks/use-order-requests.ts").includes('`/api/order-requests/${id}/accept`, "POST", undefined, printAgentRequestOptions())'), "an accept: its KOT");
  assert.ok(src("apps/cafe/hooks/use-order-requests.ts").includes("order: { ...result.order, printJobs: result.printJobs }"), "the accept's job rides on the order the KOT print reads");
  assert.ok(src("apps/cafe/hooks/use-self-order-auto-print.ts").includes('`/api/order-requests/${requestId}/kot-claim`, "POST", undefined, printAgentRequestOptions())'), "a self-order claim: its KOT (R4)");
  const api = src("packages/shared/src/api-client.ts");
  assert.ok(api.includes('headers: { ...options.headers, "Content-Type": "application/json" },'), "apiSend keeps its JSON content type whatever a caller adds");
  assert.ok(api.includes("options: { headers?: Record<string, string> } = {},"), "optional and last: every existing caller (cafe and Hub) is unchanged");
});

test("PIN: every print wrapper follows the job the order's answer made, and a device with an identity never prints locally", () => {
  const wrappers = src("apps/cafe/hooks/use-print-routing.ts");
  for (const kind of ["kot", "void", "bill"]) {
    assert.ok(wrappers.includes(`printJobRefOf(order, "${kind}"))`), `the ${kind} wrapper hands its ref to the seam`);
  }
  const seam = src("apps/cafe/hooks/use-host-routing.ts");
  assert.ok(seam.includes('const shouldRoute = agentDeviceId !== "" || shouldRoutePrint(routing, printHostSeen);'), "an agent always routes: the queue prints, never this page");
  assert.ok(seam.includes("if (ref) {\n        followPrintJob(ref, buildJob);\n        return;\n      }"), "a named job is followed, with no request");
  assert.ok(seam.indexOf("if (!shouldRoute) {") < seam.indexOf("if (ref) {"), "the local fast path stays first (a device with no identity)");
  assert.ok(seam.includes('agentDeviceId === "" ? job : { ...job, headers: printAgentEnqueueHeaders(agentDeviceId) }'), "a missing ref is enqueued as the agent, under today's key");
  assert.ok(seam.includes('if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();'), "an enqueued job is leased now, not on a poll");
  assert.ok(seam.includes('if (ref.status === "queued") kickPrintAgent(ref.printerId);'), "a ref to a resolved job is followed, never leased (M-d); a queued one kicks with its printer (the 2E gate, M-1)");
  assert.ok(seam.includes('const ref = printJobRefOf(order, "moved");'), "the moved slip is followed by ref: its key has the server's movedAt");
  assert.ok(src("apps/cafe/hooks/use-print-host.ts").includes('({ headers, ...input }: EnqueuePrintJobInput) => apiSend<PrintJobEnqueueResult>("/api/print-jobs", "POST", input, { headers })'), "headers are never part of the enqueue body");
});

test("PIN: the provider hands the drain its surfaces, and the bridge's own KOT print no longer reaches a lane", () => {
  const provider = src("apps/cafe/components/layout/PrintHostProvider.tsx");
  assert.ok(provider.includes("surfacesMounted={surfacesMounted}"), "with no host, every device is an agent once its surfaces exist");
  assert.ok(!provider.includes("onKotRound="), "the host lane prints only print jobs");
  const bridge = src("apps/cafe/hooks/use-print-host-bridge.ts");
  assert.equal(count(bridge, "outcomesRef.current.track("), 2, "every slip and the test slip join the outcome line");
  assert.equal(count(bridge, "outcomesRef.current.finish("), 1, "the one settle finishes the slip in front");
  assert.ok(bridge.indexOf("outcomesRef.current.track(done ?? null);") < bridge.indexOf("if (occupiedRef.current) {\n      pendingRef.current.push(slip);"), "a slip is tracked before it waits or prints");
});

test("PIN: the agent leases on events aimed at it, names itself on the pulse (the host too), and only the host polls", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(
    agent.includes('if (job?.status === "queued" && job.target === deviceId) agent.kick(typeof job.printerId === "string" ? job.printerId : undefined);'),
    "a print-status frame for another device never leases (R7); a printer job's frame names its printer (the 2E gate, M-1)",
  );
  assert.ok(agent.includes('} else if (kind === "print-job" && isHost) {'), "the broadcast nudge wakes only the host (no fan-out, M-c)");
  // The Phase 1 final gate (I-2, deliberate change): the host names itself too. With its daily wake share spent and
  // the socket down it heard of other devices' slips from nothing at all (spec §7.10: "leasing then rides realtime
  // nudges and the pulse"); one bounded read on the host's own pulse, no new request.
  assert.ok(agent.includes("if (agent === null || !enabled) return;\n    setPulsePrintDevice(deviceId);"), "every agent names itself on the existing pulse, the host too");
  assert.ok(!agent.includes("if (agent === null || !enabled || isHost) return;"), "the host is no longer left out");
  assert.ok(src("apps/cafe/hooks/use-pos-pulse.ts").includes("apiGet<PosPulseData>(`${POS_PULSE_ENDPOINT}${pulsePrintDeviceQuery()}`)"), "the pulse carries it: no new request");
  // Session 2F1 (deliberate change): or one of the printers it prints here that can print now (a POS app printer on
  // bridge v2 by its own state; any other only while canPrintNow, as before).
  assert.ok(agent.includes("printerReady: () => canPrintNow() || readyNow().length > 0,"), "the agent's gate is the device's own can-print verdict");
  assert.ok(agent.includes("const readyNow = (): string[] => readyPrinterIdsOf(readyRef.current, targetsRef.current, canPrintNow(), printerStatusOf);"), "and its printers' own states");
  assert.ok(agent.includes("PRINT_AGENT_SLIP_DEADLINE_MS"), "its wait on one slip is bounded");
});

// Phase 2 Session 2B (spec §7.11): direct print on the asking device, wired end to end on the page.
test("PIN (2B): the draining tab offers itself for direct print, every answer that carries a lease reaches its agent, and only it", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes("const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));"), "the tab id only while this agent can print now");
  assert.ok(agent.includes("const offLeased = onLeasedJob((job) => agent.take(job));"), "a leased job is printed by this page's agent");
  const seam = src("apps/cafe/hooks/use-host-routing.ts");
  assert.ok(seam.includes("if (ref.leased !== undefined) deliverLeasedJob(ref.leased);\n      else if (ref.status === \"queued\") kickPrintAgent(ref.printerId);"), "an order answer's leased job prints with no lease request");
  assert.ok(
    seam.includes('if (result.outcome === "queued" && result.leased !== undefined) deliverLeasedJob(result.leased);\n      else if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();'),
    "an enqueue's leased job too (a re-sent slip whose first answer was lost)",
  );
  const calls = src("apps/cafe/lib/print-agent-calls.ts");
  assert.ok(calls.includes("leaseTab: string | null = directPrintTab()"), "every opt-in reads the seam: orders, rounds, settle, moves, voids, accepts, claims and enqueues");
  assert.ok(calls.includes("...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),"));
  const core = src("apps/cafe/lib/print-agent.ts");
  assert.ok(core.includes("if (held.length > 0 && enabled && !busy) return void cycle(true);"), "a held job prints before any lease, past the printer gate (its attempt was made while ready)");
  assert.ok(core.includes("if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;"), "but only well inside its lease (the fresh review, I-1)");
  assert.ok(core.includes("again = answers.get(key)?.more !== false;"), "the ack's more decides the next lease");
  // The 2F1 review gate (N-1, deliberate change): only a change of what can print now is a nudge.
  assert.ok(agent.includes("useEffect(() => {\n    agent?.nudge();\n  }, [agent, canPrint, poolReady]);"), "a printer state change is a nudge, never a lease queued behind a print");
  assert.ok(core.includes("if (opened) nudge();"), "so is the gate opening or the bridge freeing up");
});

// The 2E review gate (M-1): a queued printer job is announced with its printer, so a device whose printer a refusal
// holds leases nothing for it. The Worker relays the frame byte for byte (its type follows, no redeploy needed).
test("PIN (the 2E gate, M-1): a printer job's print-status frame and the order's ref name its printer; the agent kicks with it", () => {
  assert.ok(
    src("apps/cafe/lib/print-printer-jobs.ts").includes('publishPrintStatus({ id: made.ref.id, status: "queued", target: made.ref.targetDeviceId, printerId: job.printerId });'),
    "a new printer job",
  );
  assert.ok(src("apps/cafe/lib/print-job-actions.ts").includes("...(row.printerId !== undefined ? { printerId: row.printerId } : {}) });"), "a retried printer job");
  assert.ok(src("apps/cafe/lib/realtime-publish.ts").includes("  target?: string;\n  printerId?: string;\n}"), "the frame's job type");
  assert.ok(src("workers/realtime/src/index.ts").includes("job?: { id: string; status: string; target?: string; printerId?: string };"), "the Worker's type, for parity");
  assert.ok(src("apps/cafe/hooks/use-print-agent.ts").includes("onPrintAgentKick((printerId) => agent.kick(printerId))"), "an order answer's kick carries it to the agent");
});

test("PIN (spec §7.7): both receipts print the banner first, and every surface forwards it", () => {
  for (const file of ["apps/cafe/components/pos/KOTReceipt.tsx", "apps/cafe/components/pos/OrderReceipt.tsx"]) {
    const s = src(file);
    assert.ok(s.includes("{order && (\n        <>\n          <PrintBanner text={banner} />"), `${file}: the banner is the first thing on the slip`);
  }
  const sources = src("apps/cafe/components/pos/PrintSources.tsx");
  assert.ok(sources.includes("banner={banner} ref={receiptRef}") && sources.includes("banner={banner}\n        ref={kotRef}"), "PrintSources forwards it to both");
  assert.equal(count(src("apps/cafe/components/print/PrintHostPrintSources.tsx"), "banner={slip.banner}"), 2, "the host surfaces pass the slip's banner");
  const banner = src("apps/cafe/components/pos/PrintBanner.tsx");
  assert.ok(banner.includes("if (!text) return null;"), "no banner on a first print");
  assert.ok(banner.includes('printColorAdjust: "exact"'), "a browser print keeps the black");
});
