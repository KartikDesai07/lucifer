// Source pins for background settling (2026-09-28, owner rule: the payment
// popup closes at once, the settle finishes in the background, a failure is
// loud). The decision rules are unit-tested in lib/pending-writes.test.ts and
// lib/settle-guard.test.ts and proven against mongod in
// scripts/verify-order-integrity-live.ts (legs 19-20); these pin the WIRING a
// refactor could silently undo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const PROVIDER = "apps/cafe/components/layout/PendingWritesProvider.tsx";
const LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const POS_TAB = "apps/cafe/hooks/use-pos-tab.ts";
const LANE = "apps/cafe/hooks/use-pos-settle-lane.ts";
const HEADER = "apps/cafe/components/layout/Header.tsx";
const OPEN_TABS = "apps/cafe/components/pos/OpenTabsButton.tsx";
const SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const ROUTE = "apps/cafe/app/api/orders/[id]/settle/route.ts";
const SCHEMA = "packages/shared/src/schemas/order.schema.ts";

const count = (src: string, needle: string) => src.split(needle).length - 1;

test("PIN: the provider sits above every dashboard screen, inside the pulse (its print routing reads it) and around the pages", () => {
  const src = readSrc(LAYOUT);
  const pulse = src.indexOf("<PosPulseProvider>");
  const writes = src.indexOf("<PendingWritesProvider>");
  const masters = src.indexOf("<MasterDataProvider>");
  const main = src.indexOf("<main ");
  assert.ok(pulse >= 0 && writes >= 0 && masters >= 0 && main >= 0, "landmarks: all four elements exist");
  assert.ok(pulse < writes && writes < masters && masters < main, "PosPulseProvider > PendingWritesProvider > MasterDataProvider > main");
  assert.equal(count(src, "<PendingWritesProvider>"), 1, "mounted exactly once");
});

test("PIN: background settling runs only on the host print lane, finishes in the provider, prints ONE bill and never a KOT", () => {
  const src = readSrc(PROVIDER);
  // Host lane only: the bill is then a job built from the server's order; the
  // no-host local print reads POS page state a background write must not race.
  assert.match(src, /backgroundReady: shouldRoute,/);
  assert.equal(count(src, "billPrintJob(order, { reprint: false })"), 1, "the settled bill is printed exactly once");
  assert.ok(!src.includes("kotPrintJob("), "a settle fires nothing to the kitchen");
  // The write is driven by the pure orchestrator over the real endpoints.
  assert.match(src, /runSettle\(\s*job\.intent,\s*\{/);
  assert.match(src, /send: \(\) => apiSend<Order>\(`\/api\/orders\/\$\{key\}\/settle`, "POST", job\.payload\)/);
  assert.match(src, /read: \(\) => apiGet<Order>\(`\/api\/orders\/\$\{key\}`\)/);
  // A close/reload while a write is in flight is warned about.
  assert.match(src, /useUnsavedGuard\(writes\.some\(\(w\) => LIVE_STATES\.has\(w\.state\)\)\)/);
  // Double tap: refused synchronously, before any state update.
  assert.match(src, /if \(jobs\.current\.has\(key\)\) \{/);
  // Mutation this catches: registering under ORDER_KEYS.mutation — every live
  // order poll would then pause for the whole retry window.
  assert.match(src, /ORDER_KEYS\.all/, "landmark: the provider refreshes the order caches");
  assert.ok(!src.includes("ORDER_KEYS.mutation"), "background writes must not pause the live polls");
  assert.ok(!/useMutation\(/.test(src), "completion must not depend on a component-scoped mutation");
});

test("PIN: a later settle of a tab knows an earlier send may have landed, and two runs of one tab can never overlap", () => {
  const src = readSrc(PROVIDER);
  // Without this a Retry after "could not confirm" — or a settle of the same
  // tab after reopening it — would read its own landed settle as someone
  // else's: a false "check before giving change" and no bill. Kept per TAB,
  // not per job, because reopening the tab clears the job.
  assert.match(src, /\{ mayHaveLanded: maybeLanded\.current\.has\(key\) \}/, "run passes the tab's memory to runSettle");
  const unknownCase = src.slice(src.indexOf('case "unknown":'));
  assert.ok(src.includes('case "unknown":'), "landmark: the unknown outcome is handled");
  assert.match(unknownCase.slice(0, 120), /maybeLanded\.current\.add\(key\);/, "an unanswered run marks the tab");
  assert.ok(!/maybeLanded\.current\.delete\(key\)/.test(src.slice(src.indexOf("const drop"), src.indexOf("const reopen"))), "dropping the alert keeps the memory");
  assert.match(src, /if \(outcome\.kind !== "unknown" && outcome\.kind !== "failed"\) maybeLanded\.current\.delete\(key\);/, "only a settled/elsewhere/gone answer ends it");
  assert.match(src, /if \(!job \|\| running\.current\.has\(key\)\) return;\s*running\.current\.add\(key\);/, "run refuses a second concurrent run");
  assert.match(src, /running\.current\.delete\(key\);\s*finish\(key, job, outcome\);/, "and frees the key when it ends");
  assert.match(src, /if \(!running\.current\.has\(key\)\) drop\(key\);/, "a write still being sent is never dismissed");
});

test("PIN: the POS settle branch hands off to the background lane BEFORE the foreground settle, and returns without waiting", () => {
  const src = readSrc(POS_TAB);
  const fn = src.slice(src.indexOf("const confirmPayment"), src.indexOf("const enterResume"));
  const lane = fn.indexOf("if (settleLane.backgroundReady) {");
  const enqueue = fn.indexOf("settleLane.enqueueSettle(resumedOrder, settlePayload(result, resumedOrder), draft)");
  const foreground = fn.indexOf("await settleOrder.mutateAsync(");
  assert.ok(lane >= 0 && enqueue > lane && foreground > enqueue, "background check → enqueue → foreground fallback, in that order");
  const branch = fn.slice(lane, foreground);
  assert.ok(!branch.includes("await "), "the background branch must not await anything — the popup closes at once");
  assert.match(branch, /setPaymentOpen\(false\);\s*resetOrder\(\);\s*\}\s*return;/, "closes the popup, frees the POS, and returns");
});

test("PIN: every settle names the tab it priced, and the route refuses a tab that moved BEFORE pricing it", () => {
  // The builder both POS lanes use, and the Orders-page sheet.
  const pos = readSrc(POS_TAB);
  const builder = pos.slice(pos.indexOf("const settlePayload"), pos.indexOf("const confirmPayment"));
  assert.ok(pos.includes("const settlePayload"), "landmark: the settle payload builder exists");
  assert.match(builder, /expectedTotal: tab\.total,/);
  assert.match(builder, /expectedVoids: tab\.voids\?\.length \?\? 0,/);
  const sheet = readSrc(SHEET);
  assert.match(sheet, /expectedTotal: order\.total,/);
  assert.match(sheet, /expectedVoids: order\.voids\?\.length \?\? 0,/);
  // .strict(): a key missing here would 400 every settle rather than drop it —
  // pinned anyway, because the fence is only real if the route receives it.
  const schema = readSrc(SCHEMA);
  const settle = schema.slice(schema.indexOf("export const settleOrderSchema"), schema.indexOf("export const cancelOrderSchema"));
  assert.ok(schema.includes("export const settleOrderSchema"), "landmark: the settle schema exists");
  assert.match(settle, /expectedTotal: z\.number\(\)\.min\(0\)\.optional\(\),/);
  assert.match(settle, /expectedVoids: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\),/);
  // The route: one refusal helper, called on the fresh read, before any pricing.
  const route = readSrc(ROUTE);
  const refusal = route.indexOf("const refusal = settleRefusal(old, data);");
  const pricing = route.indexOf("resolveSettleMoney({");
  assert.ok(refusal >= 0 && pricing > refusal, "settleRefusal runs before resolveSettleMoney");
  assert.match(route, /if \(refusal\) return failure\(refusal, 409\);/);
  assert.ok(!route.includes('old.status === "Completed"'), "the status refusals live in lib/settle-guard.ts only");
});

test("PIN: a tab whose settle is in flight cannot be resumed, settled or moved again from any screen, and shows as settling", () => {
  const pos = readSrc(POS_TAB);
  const resume = pos.slice(pos.indexOf("const requestResume"));
  assert.match(resume.slice(0, 200), /if \(!settleLane\.mayResume\(order\)\) return;/, "requestResume (Open tabs AND the table grid) asks the lane first");
  const lane = readSrc(LANE);
  assert.match(lane, /if \(!lane\.isSettling\(order\._id\)\) return true;/);
  const tabs = readSrc(OPEN_TABS);
  assert.match(tabs, /disabled=\{isSettling\(t\._id\)\}/);
  // The Orders page: the same tab must not be paid a second time on this device.
  const sheet = readSrc(SHEET);
  assert.match(sheet, /const settlingHere = !!order && pendingWrites\.isSettling\(order\._id\);/);
  assert.match(sheet, /onClick=\{\(\) => setSettleOpen\(true\)\} disabled=\{settlingHere\}/);
  assert.match(sheet, /onClick=\{\(\) => setMoveOpen\(true\)\} disabled=\{settlingHere\}/);
});

test("PIN: 'Reopen tab' goes through the POS's own resume (unsent-cart confirm), and the alert clears only once the tab is open", () => {
  const lane = readSrc(LANE);
  assert.match(lane, /latest\.current\.resume\(order\);/, "the reopen hand-off resumes through requestResume");
  assert.ok(!lane.includes("enterResume"), "never straight into enterResume — that replaces an unsent cart without asking");
  const mayResume = lane.slice(lane.indexOf("const mayResume"), lane.indexOf("const resumed"));
  assert.ok(lane.includes("const mayResume") && lane.includes("const resumed"), "landmarks: both helpers exist");
  assert.ok(!mayResume.includes("dismiss"), "asking to resume must not clear the alert — the confirm may be cancelled");
  // Nor may tapping "Reopen tab" itself (browser run 2026-09-28: a cancelled
  // discard-confirm kept the cart but had already lost the alert).
  const provider = readSrc(PROVIDER);
  const reopen = provider.slice(provider.indexOf("const reopen = useCallback"), provider.indexOf("const runRef"));
  assert.ok(provider.includes("const reopen = useCallback") && provider.includes("const runRef"), "landmarks: reopen and runRef exist");
  assert.match(reopen, /setReopenRequest\(\{ orderId: key, draft: job\.draft \}\);/, "landmark: reopen hands the draft over");
  assert.ok(!/\bdrop\(/.test(reopen), "reopen must not drop the alert — only an actually-opened tab clears it");
  const pos = readSrc(POS_TAB);
  const enter = pos.slice(pos.indexOf("const enterResume"), pos.indexOf("const settleLane"));
  assert.match(enter, /settleLane\.resumed\(order\);\s*\};/, "enterResume reports the tab actually opened");
  assert.match(pos, /resume: \(order\) => requestResume\(order\),/);
  // A reopen whose read returns after the operator moved on (opened another
  // tab, changed the cart) is dropped, never swapped onto the screen (review
  // 2026-09-28). The counter effect must precede the reopen effect.
  assert.match(pos, /activity: `\$\{resumedOrder\?\._id \?\? ""\}\|\$\{cart\.length\}`,/);
  const bump = lane.indexOf("activityGen.current += 1;");
  const capture = lane.indexOf("const gen = activityGen.current;");
  assert.ok(bump >= 0 && capture > bump, "the activity counter runs before the reopen effect captures it");
  assert.match(lane, /if \(!mounted\.current \|\| activityGen\.current !== gen\) return;/);
  assert.match(pos, /const cancelResume = \(\) => \{\s*setPendingResume\(null\);\s*settleLane\.resumeCancelled\(\);/);
});

test("PIN: the header shows background settles on every screen", () => {
  assert.match(readSrc(HEADER), /<PendingWritesChip \/>/);
});
