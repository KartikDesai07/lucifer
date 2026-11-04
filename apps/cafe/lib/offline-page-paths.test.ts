// Source pins for the page half of offline KOTs (Printing Phase 5, Session 5B). The rules are runtime-tested in the
// pure modules' own tests (server-reach, offline-outbox-store, offline-send, offline-replay, ...); these pin the
// WIRING a refactor could silently undo: who feeds the offline state, that the store re-reads another tab's write,
// and that the outbox lock and the storage event are the only ways the record moves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const REACH_HOOK = "apps/cafe/hooks/use-server-reach.ts";
const OUTBOX_HOOK = "apps/cafe/hooks/use-offline-outbox.ts";
const OUTBOX_STORE = "apps/cafe/lib/offline-outbox-store.ts";
const PULSE = "apps/cafe/hooks/use-pos-pulse.ts";

test("Task 10: the offline state is fed by the browser's own flag through TanStack's onlineManager", () => {
  const hook = src(REACH_HOOK);
  assert.match(hook, /import \{ onlineManager \} from "@tanstack\/react-query";/, "TanStack's onlineManager");
  assert.ok(hook.includes("useEffect(() => feedBrowserOnline(onlineManager), []);"), "subscribed once per mount, cleaned up");
  assert.ok(hook.includes("useSyncExternalStore(serverReach.subscribe, serverReach.isOffline, () => false)"), "one shared state, online on the server pass");
});

test("Task 10: every pulse result feeds the offline state, once per tick (not per retry)", () => {
  const pulse = src(PULSE);
  assert.ok(pulse.includes('if (dataUpdatedAt > 0) serverReach.report({ type: "pulse", reach: "reached" });'), "an answer reached us");
  assert.ok(pulse.includes('if (errorUpdateCount > 0) serverReach.report({ type: "pulse", reach: reachOf(error) });'), "a failed tick, by reachOf");
});

test("Task 10: every read-modify-write of the outbox runs under its Web Lock; the hook re-reads another tab's write", () => {
  const store = src(OUTBOX_STORE);
  assert.ok(store.includes("locks.request(OUTBOX_LOCK, () => work())"), "the Web Lock pos-offline-outbox");
  assert.equal((store.match(/writeOutbox\(/g) ?? []).length, 1, "one write site, inside update");
  const hook = src(OUTBOX_HOOK);
  assert.ok(hook.includes('window.addEventListener("storage", onStorage);'), "the storage event");
  assert.ok(hook.includes("if (event.key === OUTBOX_KEY || event.key === null) void offlineOutbox.refresh();"), "only the outbox key (or a clear)");
  assert.ok(hook.includes("if (snapshot.unreadable && offlineOutbox.claimUnreadableReport()) toast.warning(OUTBOX_UNREADABLE_MESSAGE);"), "the unreadable record is said once");
});

test("Task 11: the POS sends carry their offline facts; the payment sheet is offline-aware for a new sale only", () => {
  const tab = src("apps/cafe/hooks/use-pos-tab.ts");
  assert.ok(tab.includes("const send = usePosSend(useOfflineSend());"), "the keep port");
  assert.ok(tab.includes("offline: { body: round ? round.data : create, shownTotal: total, base: resumedOrder, done: offlineDone(() => tabIdRef.current === startedFor && resetOrder()) },"), "Send to Kitchen's facts");
  assert.ok(tab.includes("offline: { body: sale, shownTotal: modalTotals.total, base: null, done: offlineDone(() => { setPaymentOpen(false); resetOrder(); }) },"), "Pay Now's facts: the total taken");
  const modal = src("apps/cafe/components/pos/PaymentModal.tsx");
  assert.ok(modal.includes("const offlineSale = useServerReach().offline && newSale;"), "only a new sale (a settle waits: Task 15)");
  assert.ok(modal.includes("<PaymentModeGrid modes={shownModes} mode={mode} onSelect={setMode} locked={locked} />"), "the modes offline");
  assert.ok(modal.includes("picker={onSelectCustomer && !offlineSale && <CustomerSearch"), "no customer picker offline");
  assert.ok(modal.includes("splitMismatch || !shownModes.includes(mode)));"), "a mode chosen before the outage is not sent offline");
  assert.ok(modal.includes("<PaymentPoints points={points} disabled={locked || offlineSale} />"), "points need the internet");
  const provider = src("apps/cafe/components/layout/PrintHostProvider.tsx");
  assert.ok(provider.includes("queueSlip(slip, (result) => {"), "the offline slip rides the one bridge");
  assert.ok(provider.includes('const deadline = window.setTimeout(() => resolve("maybe"), PRINT_AGENT_SLIP_DEADLINE_MS);'), "bounded as the agent's wait: maybe");
  const send = src("apps/cafe/hooks/use-pos-send.ts");
  assert.ok(send.includes("onAnswer: (error) => void reportWriteAnswer(error, serverReach, () => checkPulseReach(qc)),"), "each answer feeds the state; a miss is checked once");
  const reads = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.ok(reads.includes('apiGet<PrinterConfig[] | PrintersRead>("/api/printers?stations=1")'), "the stations ride the one printers read");
});

test("Task 12: a held send is parked once offline, uncertain and with no paper; Print KOT here is staff's tap only", () => {
  const send = src("apps/cafe/hooks/use-pos-send.ts");
  assert.ok(send.includes("onOfflineChange: serverReach.subscribe,"), "the controller hears the page go offline");
  assert.ok(send.includes("parkHeld: (held) => offlineRef.current?.park(held) ?? Promise.resolve(false),"), "the park port");
  const hook = src("apps/cafe/hooks/use-offline-send.ts");
  assert.ok(hook.includes("print: false, uncertain: true, ...ctx };"), "a parked send prints nothing by itself (S3)");
  assert.equal((hook.match(/printEntryHere\(/g) ?? []).length, 1, "Print KOT here has one caller: staff's button");
});

test("Task 13: one replay runner per tab in the shell; one tab of the device sends; it follows the answer, never enqueues", () => {
  const layout = src("apps/cafe/app/(dashboard)/layout.tsx");
  assert.equal((layout.match(/<OfflineReplayRunner \/>/g) ?? []).length, 1, "mounted once");
  assert.ok(layout.indexOf("<OfflineReplayRunner />") > layout.indexOf("<PosPulseProvider>"), "inside the pulse provider");
  const hook = src("apps/cafe/hooks/use-offline-replay.ts");
  assert.ok(hook.includes("await locks.request(REPLAY_LOCK, { ifAvailable: true }, async (lock) => {"), "one tab sends; a busy lock skips");
  assert.ok(hook.includes("printAgentRequestOptions(entry.sale)"), "the print headers of an online send (a sale: the bill header)");
  assert.ok(hook.includes("const offlineReplay = pulse?.offlineReplay === true;"), "only once the server says it takes offline replays");
  assert.ok(hook.includes("const pulse = qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all);") && !hook.includes("usePosPulseContext("), "read from the cache at each tick: no new pulse reader");
  assert.ok(!hook.includes("/api/print-jobs") && !hook.includes("useEnqueuePrintJob"), "never a slip enqueued for an entry");
  assert.ok(!hook.includes("useQuery("), "no observer of its own: the pulse stays the one poller");
  assert.ok(hook.includes("retryAfterRef.current = Date.now() + REFETCH_INTERVALS.POS_PULSE;"), "a miss waits a pulse tick");
});

test("Task 14: the POS lists the orders made offline and their tables read taken; the header's chip opens Offline orders", () => {
  const header = src("apps/cafe/components/pos/PosHeader.tsx");
  assert.ok(header.includes("const tabs = useOfflineTabs(openTabs);"), "Open tabs");
  const cart = src("apps/cafe/components/pos/CartHead.tsx");
  assert.ok(cart.includes("tables={offlineTables}") && cart.includes("tabs={offlineTabs}"), "the table choice");
  const row = src("apps/cafe/components/pos/OpenTabsButton.tsx");
  assert.ok(row.includes("{offline ?? row.status}"), "the Offline · O-n chip where the status goes");
  const shell = src("apps/cafe/components/layout/Header.tsx");
  assert.ok(shell.indexOf("<OfflineOrdersSheet />") > 0 && shell.indexOf("<OfflineOrdersSheet />") < shell.indexOf("<PrinterStatusButton"), "beside the printer button");
  const sheet = src("apps/cafe/components/pos/OfflineOrdersSheet.tsx");
  assert.ok(sheet.includes("className={side ? PRINTER_PANEL_SIDE_CLASS : PRINTER_PANEL_SHEET_CLASS}"), "below 1280 px the panel is a full-screen sheet from the bottom");
  assert.ok(!sheet.includes("<select"), "never a native select");
  assert.ok((sheet.match(/className=\{PRINTER_ACTION_CLASS\}/g) ?? []).length >= 5, "44 px buttons");
  assert.ok(sheet.includes("if (count === 0 && !unreadable) return null;"), "only while an order or a note remains");
  const send = src("apps/cafe/hooks/use-pos-send.ts");
  assert.ok(send.includes("reset: () => {\n      fixRef.current = null;\n      send.reset();"), "clearing the cart disarms Fix and send");
  const fix = src("apps/cafe/hooks/use-offline-fix.ts");
  assert.ok(fix.includes("fixRequestBody(facts.body, key, fix, facts.shownTotal)"), "a new key with the entry's offline lines");
});
