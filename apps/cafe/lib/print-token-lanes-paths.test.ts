import "@/lib/hook-harness"; // installs the react / react-to-print / sonner stubs: MUST stay the first import
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { UseReactToPrintOptions } from "react-to-print";

import { mountHook, stubModule } from "@/lib/hook-harness";
import { stripComments } from "@/lib/source-pin-utils";
import { leaseBodySchema } from "@/lib/print-lifecycle-schemas";
import { PrintJob } from "@/models/PrintJob";
import { orderOf } from "@/lib/print-template-golden.fixtures";
import type { Order } from "@/types";

// Print customization S7 Slice B/C pins: how the token slip gets from the order to a printer. Source pins over the
// COMMENT-STRIPPED files (the seam order, the gates), the lease skew fence driven through its real exports, and one
// behavioural leg over the REAL useKotPrintBridge (react-to-print stubbed): KOT, then token, then bill, never two
// print() calls in one flush.

const CAFE = path.join(__dirname, "..");
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8")).replace(/\r\n/g, "\n");
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const at = (src: string, needle: string): number => {
  const found = src.indexOf(needle);
  assert.ok(found !== -1, `needle present: ${needle}`);
  return found;
};
function sourcesUnder(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path.relative(CAFE, full).split(path.sep).join("/"));
    }
  };
  for (const d of dirs) walk(path.join(CAFE, d));
  return out;
}

// ── the seam: KOT first, then the token ──────────────────────────────────────

test("queueKotRound (the one client KOT seam): the KOT routePrint, THEN the token's, gated by opensWithToken, keyed by the token ref", () => {
  const src = code("hooks/use-print-routing.ts");
  const fn = src.slice(at(src, "const queueKotRound = useCallback("), at(src, "const queueVoidSlip = useCallback("));
  const kot = at(fn, "routePrint(() => kotPrintJob(order, resolved), () => localKot(order, resolved), printJobRefOf(order, \"kot\"));");
  const gate = at(fn, "if (opensWithToken(order, resolved)) {");
  const token = at(fn, "routePrint(() => tokenPrintJob(order, { reprint: false }), () => localToken(order), printJobRefOf(order, \"token\"));");
  assert.ok(kot < gate && gate < token, "KOT, then the gate, then the token");
  assert.equal(count(fn, "routePrint("), 2, "exactly two jobs per round");
  assert.ok(fn.includes("[routePrint, localKot, localToken, noteOrder]"), "the callback's deps carry the token's local print");
  assert.ok(src.includes("queueTokenSlip: (order: Order) => void;") && src.includes('Omit<PrintRoutingLocal, "setLastOrder" | "queueTokenSlip">'), "queueTokenSlip is an INPUT of the seam, not part of the routed surface");
});

test("PrintHostDrain (the host's self-order lane) enqueues the same pair in the same order, with no local print", () => {
  const src = code("components/print/PrintHostDrain.tsx");
  const kot = at(src, "routePrint(() => kotPrintJob(order, round), () => undefined, printJobRefOf(order, \"kot\"));");
  const gate = at(src, "if (opensWithToken(order, round)) {");
  const token = at(src, "routePrint(() => tokenPrintJob(order, { reprint: false }), () => undefined, printJobRefOf(order, \"token\"));");
  assert.ok(kot < gate && gate < token);
  assert.equal(count(src, "routePrint("), 2);
});

test("token jobs are made in exactly four places: the routing seam, the host drain, the Orders reprint and the server's opening slips", () => {
  const files = sourcesUnder(["app", "components", "hooks", "lib"]);
  assert.ok(files.length > 300, `landmark: the scan read ${files.length} files`);
  const callers = files.filter((f) => code(f).includes("tokenPrintJob(")).sort();
  assert.deepEqual(callers, ["components/print/PrintHostDrain.tsx", "hooks/use-print-routing.ts", "hooks/use-token-print.ts", "lib/print-order-jobs.ts", "lib/print-routing.ts"]);
  assert.deepEqual(files.filter((f) => /queueTokenSlip/.test(code(f))).sort(), ["hooks/use-pos-print.ts", "hooks/use-print-routing.ts"], "queueTokenSlip: defined in use-pos-print, consumed only by the seam");
  const pos = code("hooks/use-pos-print.ts");
  assert.ok(pos.includes("queueTokenSlip, setLastOrder }"), "use-pos-print hands it to the seam in `local`");
  assert.ok(/const queueTokenSlip = useCallback\(\(order: Order\) => \{\s*setLastOrder\(order\);\s*setShouldPrintToken\(true\);\s*\}, \[\]\);/.test(pos), "it records the order and raises the flag, nothing else");
  assert.ok(pos.includes("shouldPrintToken,") && pos.includes("clearPrintToken,"), "and the hook returns both");
});

// ── the local lane's bridge ──────────────────────────────────────────────────

test("use-kot-print-bridge: a 3rd print job on tokenRef at the BILL width; the token waits for the KOT, the bill waits for both; printBusy and the wedge guard", () => {
  const src = code("hooks/use-kot-print-bridge.ts");
  assert.equal(count(src, "useReactToPrint("), 3, "receipt, KOT, token");
  assert.ok(/contentRef: tokenRef,\s*documentTitle: lastOrder \? `TOKEN-\$\{lastOrder\.orderId\}` : "token",\s*pageStyle: receiptPageStyle\(token\?\.billPaperWidth \?\? kotPaperWidth\),/.test(src), "the token job prints tokenRef at token.billPaperWidth");
  assert.ok(src.includes("if (shouldPrintReceipt && lastOrder && !shouldPrintKot && !shouldPrintToken) {"), "the bill waits for the KOT AND the token");
  assert.ok(src.includes("if (!shouldPrintToken || !lastOrder || shouldPrintKot || tokenPrinting.current) return;"), "the token waits for the KOT and for itself");
  assert.ok(/if \(lastOrder\.tokenNumber === undefined\) \{\s*clearPrintToken\?\.\(\);\s*return;\s*\}/.test(src), "wedge guard: a tokenless order clears the flag instead of holding printBusy");
  assert.ok(src.includes("const printBusy = shouldPrintKot || shouldPrintToken || shouldPrintReceipt || receiptInFlight;"), "printBusy includes the token");
  assert.ok(src.includes("return { receiptRef, kotRef, tokenRef, printBusy };"), "tokenRef is returned");
  assert.ok(/tokenPrinting\.current = false;\s*clearPrintToken\?\.\(\);/.test(src), "the token flag clears at onAfterPrint, not at dispatch");
});

test("PrintSources renders the token only for a tokenRef AND a token number; the host bridge prints a token on the receipt surface", () => {
  const sources = code("components/pos/PrintSources.tsx");
  assert.ok(sources.includes("{tokenRef && order?.tokenNumber !== undefined && ("), "PrintSources gate");
  assert.ok(sources.includes("<TokenSlip order={order} settings={settings} banner={banner} ref={tokenRef} />"));
  const bridge = code("hooks/use-print-host-bridge.ts");
  assert.equal(count(bridge, "useReactToPrint("), 3, "landmark: still exactly three jobs (no fourth for the token)");
  assert.ok(bridge.includes('const node = surface === "receipt" || surface === "token" ? receiptRef.current : surface === "eod" ? eodRef.current : kotRef.current;'), "a token slip's node is the receipt surface's");
  assert.ok(bridge.includes('if (surface === "receipt" || surface === "token") printReceipt();'), "...and it prints through printReceipt");
  const host = code("components/print/PrintHostPrintSources.tsx");
  const token = at(host, 'if (slip.surface === "token") {');
  const receipt = at(host, 'if (slip.surface === "receipt") {');
  assert.ok(token < receipt, "the token branch precedes the receipt's");
  assert.ok(host.includes('<PrintSources order={slip.order} settings={settings.data} kotRef={kotRef} kotVariant="kot" tokenRef={receiptRef} banner={slip.banner} />'), "token: tokenRef={receiptRef}, banner passed");
  assert.equal(count(host, "tokenRef="), 1, "landmark: one token branch");
});

test("Orders: the Token button needs a token number on a live order and is disabled while a print is being queued; reprint is always reprint:true at the bill width", () => {
  const sheet = code("components/orders/OrderDetailSheet.tsx");
  assert.ok(sheet.includes("const hasToken = order?.tokenNumber !== undefined && !isCancelled;"), "the gate");
  assert.ok(/\{hasToken && \(\s*<Button variant="outline" onClick=\{printToken\} disabled=\{enqueuePending\}/.test(sheet), "the button: gated, disabled={enqueuePending}");
  assert.ok(sheet.includes("{hasToken && <TokenSlip order={order} settings={settings.data} ref={tokenRef} />}"), "the off-screen slip under the same gate");
  assert.ok(sheet.includes("useTokenPrint({ order, routePrint, localPrintOf, billPaperWidth: printCfg.bill.paperWidth })"), "the sheet's own routePrint and the BILL width");
  const hook = code("hooks/use-token-print.ts");
  assert.ok(hook.includes("routePrint(() => tokenPrintJob(order, { reprint: true }), localPrintOf(order, print));"), "reprint: true through the sheet's routePrint");
  assert.ok(!hook.includes("reprint: false") && count(hook, "reprint:") === 1, "never a first-print token from here");
  assert.ok(hook.includes("pageStyle: receiptPageStyle(billPaperWidth)") && !hook.includes("kotPaperWidth"), "the bill's page style");
  assert.ok(hook.includes("if (!order) return;"), "no order, no job");
});

test("pages: /pos and /requests hand the bridge a token block at the BILL width and PrintSources the tokenRef", () => {
  const pos = code("app/(dashboard)/pos/page.tsx");
  assert.ok(pos.includes("token: { shouldPrintToken: pos.shouldPrintToken, clearPrintToken: pos.clearPrintToken, billPaperWidth: printCfg.bill.paperWidth },"));
  assert.ok(pos.includes("const { receiptRef, kotRef, tokenRef, printBusy } = useKotPrintBridge({") && pos.includes("tokenRef={tokenRef}"));
  const req = code("app/(dashboard)/requests/page.tsx");
  assert.ok(req.includes("token: { shouldPrintToken, clearPrintToken, billPaperWidth: printCfg.bill.paperWidth },"));
  assert.ok(req.includes("const { kotRef, tokenRef, printBusy } = useKotPrintBridge({") && req.includes("tokenRef={tokenRef}"));
  assert.ok(!/receipt: \{/.test(req), "landmark: /requests still has no receipt job");
  assert.ok(req.includes("printBusy={shouldPrintKot || shouldPrintToken}"), "its auto-print waits for the token too");
});

// ── the lease skew fence ─────────────────────────────────────────────────────

test("lease skew fence: tokenSlips is literal true or absent; leaseKindFence is {} for a token page and skips token jobs for an old one", () => {
  const base = { deviceId: "dev-1", tabId: "tab-1" };
  assert.ok(leaseBodySchema.safeParse(base).success, "an old page's body (no tokenSlips) still parses");
  assert.ok(leaseBodySchema.safeParse({ ...base, tokenSlips: true }).success);
  for (const bad of [false, "true", 1, null]) assert.equal(leaseBodySchema.safeParse({ ...base, tokenSlips: bad }).success, false, `tokenSlips: ${JSON.stringify(bad)}`);
  assert.equal(leaseBodySchema.safeParse({ ...base, other: 1 }).success, false, "landmark: the body is still strict");
  const lease = code("lib/print-lease.ts");
  assert.ok(lease.includes('return tokenSlips ? {} : { kind: { $ne: "token" } };'), "the fence source");
  assert.equal(count(lease, "...leaseKindFence(input.tokenSlips)"), 1);
  assert.ok(lease.includes("await PrintJob.findOne({ ...printJobLineFilter(input.deviceId, input.nowMs), ...leaseKindFence(input.tokenSlips) })"), "spread into the head findOne beside the line filter");
  assert.ok(code("app/api/print-jobs/lease/route.ts").includes("tokenSlips: parsed.data.tokenSlips === true,"), "the route passes === true");
  assert.ok(code("hooks/use-print-agent.ts").includes('{ deviceId, tabId, tokenSlips: true }'), "the agent says it can print tokens");
});

test("lease skew fence, through the real leasePrintJobs: the head query carries the kind filter for an old page only", async () => {
  const { leaseKindFence, leasePrintJobs } = createRequire(__filename)("@/lib/print-lease") as typeof import("@/lib/print-lease");
  assert.deepEqual(leaseKindFence(false), { kind: { $ne: "token" } });
  assert.deepEqual(leaseKindFence(true), {});
  const model = PrintJob as unknown as { findOne: (filter: Record<string, unknown>) => unknown };
  const real = model.findOne;
  const seen: Record<string, unknown>[] = [];
  model.findOne = (filter) => {
    seen.push(filter);
    return { sort: () => ({ select: () => ({ lean: async () => null }) }) };
  };
  try {
    for (const tokenSlips of [false, true]) {
      const result = await leasePrintJobs({ deviceId: "dev-1", tabId: "tab-1", dismissedBy: "x", nowMs: Date.UTC(2026, 9, 6), tokenSlips });
      assert.deepEqual(result, { jobs: [], retryAt: null }, "an empty line leases nothing");
    }
  } finally {
    model.findOne = real;
  }
  assert.equal(seen.length, 2, "landmark: one head query per call");
  assert.deepEqual(seen[0].kind, { $ne: "token" }, "old page: token jobs stepped over");
  assert.equal("kind" in seen[1], false, "token page: no kind filter at all");
  assert.ok("deviceId" in seen[0] || Object.keys(seen[0]).length > 1, "landmark: the line filter is still there");
});

// ── behaviour: one print() per flush, KOT -> token -> bill ──────────────────

const TOKEN_ORDER: Order = orderOf({ over: { tokenNumber: 12 } });
const PLAIN_ORDER: Order = orderOf({});
const world = { lastOrder: TOKEN_ORDER as Order | null, kot: false, receipt: false, token: false };
const printed: string[] = [];
const options = new Map<unknown, UseReactToPrintOptions>();
const printers = new Map<unknown, () => void>();
let nameOf: (ref: unknown) => string = () => "?";
stubModule("react-to-print", {
  // One stable print function per content ref, as the real hook's identity is stable between option changes.
  useReactToPrint(opts: UseReactToPrintOptions): () => void {
    options.set(opts.contentRef, opts);
    let print = printers.get(opts.contentRef);
    if (!print) {
      const ref = opts.contentRef;
      print = () => void printed.push(nameOf(ref));
      printers.set(ref, print);
    }
    return print;
  },
});
const { useKotPrintBridge } = createRequire(__filename)("@/hooks/use-kot-print-bridge") as typeof import("@/hooks/use-kot-print-bridge");
const clearKot = (): void => void (world.kot = false);
const clearReceipt = (): void => void (world.receipt = false);
const clearToken = (): void => void (world.token = false);

function scene(lastOrder: Order | null) {
  Object.assign(world, { lastOrder, kot: false, receipt: false, token: false });
  printed.length = 0;
  options.clear();
  printers.clear();
  const hook = mountHook(() =>
    useKotPrintBridge({
      lastOrder: world.lastOrder,
      shouldPrintKot: world.kot,
      clearPrintKot: clearKot,
      kotPaperWidth: "58mm",
      receipt: { shouldPrintReceipt: world.receipt, clearPrintReceipt: clearReceipt, billPaperWidth: "80mm" },
      token: { shouldPrintToken: world.token, clearPrintToken: clearToken, billPaperWidth: "80mm" },
    }),
  );
  const refs = hook.result();
  nameOf = (ref) => (ref === refs.receiptRef ? "receipt" : ref === refs.kotRef ? "kot" : ref === refs.tokenRef ? "token" : "?");
  const finish = (ref: unknown): void => {
    options.get(ref)?.onAfterPrint?.();
    hook.rerender();
  };
  return { hook, refs, finish, busy: () => hook.result().printBusy };
}

test("one batch of KOT + token + bill prints exactly one slip per flush, in that order, each next one only after the previous onAfterPrint", () => {
  const { hook, refs, finish, busy } = scene(TOKEN_ORDER);
  assert.equal(busy(), false, "landmark: idle before anything is queued");
  Object.assign(world, { kot: true, token: true, receipt: true }); // one batch, the way Pay Now queues them
  hook.rerender();
  assert.deepEqual(printed, ["kot"], "flush 1: the KOT alone (token and bill held)");
  assert.equal(busy(), true);
  hook.rerender();
  assert.deepEqual(printed, ["kot"], "a re-render while the KOT is in flight prints nothing more");
  finish(refs.kotRef);
  assert.deepEqual(printed, ["kot", "token"], "flush 2: the token, once the KOT is done");
  assert.equal(busy(), true);
  hook.rerender();
  assert.deepEqual(printed, ["kot", "token"], "the bill still waits for the token's onAfterPrint");
  finish(refs.tokenRef);
  assert.deepEqual(printed, ["kot", "token", "receipt"], "flush 3: the bill");
  assert.equal(busy(), true, "the bill is in flight until its own onAfterPrint");
  finish(refs.receiptRef);
  assert.equal(busy(), false, "idle again");
  assert.deepEqual(printed, ["kot", "token", "receipt"], "nothing printed twice");
  assert.equal(options.get(refs.tokenRef)?.documentTitle, `TOKEN-${TOKEN_ORDER.orderId}`, "landmark: the token job is its own (title)");
  hook.unmount();
});

test("a held tab (KOT + token, no bill) prints KOT then token; a token with no KOT queued prints at once", () => {
  const held = scene(TOKEN_ORDER);
  Object.assign(world, { kot: true, token: true });
  held.hook.rerender();
  assert.deepEqual(printed, ["kot"]);
  held.finish(held.refs.kotRef);
  assert.deepEqual(printed, ["kot", "token"]);
  held.finish(held.refs.tokenRef);
  assert.equal(held.busy(), false);
  held.hook.unmount();
  const alone = scene(TOKEN_ORDER);
  Object.assign(world, { token: true });
  alone.hook.rerender();
  assert.deepEqual(printed, ["token"], "the Requests page's case: a token job on its own");
  alone.hook.unmount();
});

test("wedge guard: a token flag whose lastOrder has no token number clears without printing, and printBusy drops", () => {
  const wedged = scene(PLAIN_ORDER);
  Object.assign(world, { token: true });
  wedged.hook.rerender();
  assert.deepEqual(printed, [], "nothing printed for a tokenless order");
  assert.equal(world.token, false, "the flag was cleared");
  wedged.hook.rerender(); // what the page's setState does after clearPrintToken
  assert.equal(wedged.busy(), false, "printBusy dropped (a stuck flag would hold the auto-print queue forever)");
  wedged.hook.unmount();
  const real = scene(TOKEN_ORDER);
  Object.assign(world, { token: true });
  real.hook.rerender();
  assert.deepEqual(printed, ["token"], "landmark: the same flag with a numbered order does print");
  real.hook.unmount();
});
