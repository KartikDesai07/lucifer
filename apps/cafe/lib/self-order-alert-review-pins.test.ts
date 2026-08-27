import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CR2.3 adversarial-review fixes (arbitrated 2026-08-22) — one pin per
// confirmed finding, so none of them can silently regress. Technique mirrors
// lib/self-order-alert-paths.test.ts (readFileSync + stripComments).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

const AUTO_PRINT = "apps/cafe/hooks/use-self-order-auto-print.ts";
const BRIDGE = "apps/cafe/hooks/use-kot-print-bridge.ts";
const PULSE_LIB = "apps/cafe/lib/pos-pulse.ts";
const PROVIDER = "apps/cafe/components/layout/PosPulseProvider.tsx";
const ALERT_BAR = "apps/cafe/components/orders/RequestAlertBar.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const REQUESTS_PAGE = "apps/cafe/app/(dashboard)/requests/page.tsx";
const SHARED_CONTRACT = "packages/shared/src/self-order-alert.ts";

test("C1: claimAndPrint depends on the STABLE claim.mutate, never the per-render mutation object", () => {
  const src = stripComments(readSrc(AUTO_PRINT));
  // useMutation returns {...result, mutate} — a NEW object every render, while
  // `mutate` is useCallback-stable. Depending on the object looped: rebuild
  // claimAndPrint -> re-register handler -> provider setState -> context ->
  // page re-render -> new object -> "maximum update depth exceeded".
  assert.match(
    src,
    /const\s*\{\s*mutate:\s*claimMutate\s*\}\s*=\s*claim/,
    "must destructure the stable mutate out of the mutation result",
  );
  assert.match(
    src,
    /\[claimMutate,\s*queueKotRound\]/,
    "claimAndPrint's deps must be the stable [claimMutate, queueKotRound]",
  );
  assert.ok(
    !/\[claim,\s*queueKotRound\]/.test(src),
    "the unstable [claim, ...] dep must never come back — it re-registers the print handler every render and loops React",
  );
});

test("C2: auto path never re-claims an attempted candidate and never toasts a raced result", () => {
  const src = stripComments(readSrc(AUTO_PRINT));
  const addIdx = mustIndexOf(
    src,
    "attemptedRef.current.add(candidate.requestId)",
    "the attempted-set add before the auto claim",
  );
  const autoClaimIdx = mustIndexOf(src, 'claimAndPrint(candidate.requestId, "auto"', "the auto-path claim call");
  assert.ok(addIdx < autoClaimIdx, "the candidate must be marked attempted BEFORE the claim fires");
  assert.match(
    src,
    /filter\(\(row\) => !attemptedRef\.current\.has\(row\.requestId\)\)/,
    "candidate selection must exclude already-attempted rows — the pulse stays stale up to one tick after a claim",
  );
  // Toasts belong to the manual path only: inside onSuccess, the manual guard
  // must come before the first toast call.
  const onSuccessIdx = mustIndexOf(src, "onSuccess:", "the claim onSuccess handler");
  const manualGuardIdx = mustIndexOf(src, 'if (source === "manual")', "the manual-only toast guard");
  const firstToastIdx = mustIndexOf(src, "toast.", "a toast call");
  assert.ok(
    onSuccessIdx < manualGuardIdx && manualGuardIdx < firstToastIdx,
    "every claimed:false toast must sit behind the source === \"manual\" guard — the auto path toasting each tick was review finding C2",
  );
  // A network error must un-attempt the auto candidate so the next tick retries.
  assert.match(
    src,
    /attemptedRef\.current\.delete\(requestId\)/,
    "onError must clear the attempt for the auto path (the server may never have seen the claim)",
  );
});

test("C3: the bridge tracks the receipt through onAfterPrint and both pages gate auto-print on printBusy", () => {
  const bridge = stripComments(readSrc(BRIDGE));
  assert.match(
    bridge,
    /const \[receiptInFlight, setReceiptInFlight\] = useState\(false\)/,
    "receipt in-flight must be STATE (reactive), not a ref — consumers must re-render when the window closes",
  );
  const printJobIdx = mustIndexOf(bridge, "contentRef: receiptRef", "the receipt useReactToPrint job");
  const printJobEnd = matchingBraceEnd(bridge, bridge.lastIndexOf("{", printJobIdx));
  assert.match(
    bridge.slice(printJobIdx, printJobEnd),
    /onAfterPrint:\s*\(\) => setReceiptInFlight\(false\)/,
    "the receipt job must close its in-flight window in onAfterPrint",
  );
  const receiptEffectIdx = mustIndexOf(
    bridge,
    "if (shouldPrintReceipt && lastOrder && !shouldPrintKot)",
    "the receipt dispatch guard",
  );
  const receiptEffectEnd = matchingBraceEnd(bridge, bridge.indexOf("{", receiptEffectIdx));
  assert.match(
    bridge.slice(receiptEffectIdx, receiptEffectEnd),
    /setReceiptInFlight\(true\)/,
    "dispatch must open the in-flight window before print()",
  );
  assert.match(
    bridge,
    /const printBusy = shouldPrintKot \|\| shouldPrintReceipt \|\| receiptInFlight/,
    "printBusy must cover queued AND physically-in-flight jobs",
  );
  assert.match(bridge, /return \{ receiptRef, kotRef, printBusy \}/, "printBusy must be exported");

  // Reachability: both pages must actually gate on it — an exported flag with
  // no consumer would leave C3 open (dead-wiring lesson).
  const pos = stripComments(readSrc(POS_PAGE));
  assert.match(pos, /const \{ receiptRef, kotRef, printBusy \} = useKotPrintBridge\(/, "pos page must take printBusy");
  assert.match(pos, /busy:\s*printBusy \|\| pos\.isBusy/, "pos page must gate auto-print on printBusy");
  const requests = stripComments(readSrc(REQUESTS_PAGE));
  assert.match(requests, /const \{ kotRef, printBusy \} = useKotPrintBridge\(/, "requests page must take printBusy");
  assert.match(requests, /busy:\s*printBusy \|\| acceptingId !== null/, "requests page must gate auto-print on printBusy");
});

test("C4: the pulse serves UNPRINTED self-orders only, with a truncation flag", () => {
  const lib = stripComments(readSrc(PULSE_LIB));
  const queryBIdx = mustIndexOf(lib, "acceptedKotRound: { $exists: true }", "query B's filter");
  assert.match(
    lib.slice(queryBIdx, queryBIdx + 300),
    /kotPrintedAt:\s*\{\s*\$exists:\s*false\s*\}/,
    "query B must exclude printed rows — printed rows occupying the limited slots hid the OLDEST unprinted tickets exactly when the printer device had been offline",
  );
  assert.match(
    lib,
    /selfOrdersTruncated:\s*selfRows\.length === PULSE_SELF_ORDER_LIMIT/,
    "the payload must say when the unprinted backlog reached the limit",
  );
  const contract = stripComments(readSrc(SHARED_CONTRACT));
  assert.match(contract, /selfOrdersTruncated:\s*boolean/, "the shared contract must carry the flag");
  const bar = stripComments(readSrc(ALERT_BAR));
  assert.match(bar, /selfOrdersTruncated/, "the alert bar must surface the truncation to staff");
});

test("C5: the alert bar's Print buttons disable after a tap until the row leaves the payload", () => {
  const bar = stripComments(readSrc(ALERT_BAR));
  assert.match(bar, /disabled=\{tappedIds\.has\(row\.requestId\)\}/, "a tapped button must disable");
  const onClickIdx = mustIndexOf(bar, "setTappedIds((prev) => new Set(prev).add(row.requestId))", "the tap marker");
  const handlerIdx = mustIndexOf(bar, "printHandler(row.requestId)", "the print handler call");
  assert.ok(onClickIdx < handlerIdx, "the tap must be marked before the handler fires");
});

test("C11: the title prefix survives route changes and cleans up on unmount", () => {
  const provider = stripComments(readSrc(PROVIDER));
  assert.match(
    provider,
    /import \{ usePathname \} from "next\/navigation"/,
    "the provider must watch the pathname — Next resets document.title on navigation without the open count moving",
  );
  assert.match(
    provider,
    /\[data\?\.openCount, pathname\]/,
    "the title effect must re-run on route changes, not only on count changes",
  );
  assert.match(
    provider,
    /return \(\) => \{\s*document\.title = document\.title\.replace\(TITLE_PREFIX_RE, ""\);/,
    "unmount (logout) must strip the prefix instead of stranding a stale \"(N)\"",
  );
});

test("C14: claimKotPrint gates on the Order's LIVE state before the claim CAS", () => {
  const lib = stripComments(readSrc(PULSE_LIB));
  const cancelledIdx = mustIndexOf(lib, 'order.status === "Cancelled"', "the cancelled-order gate");
  const roundIdx = mustIndexOf(lib, "roundHasLines", "the voided-round gate");
  const casIdx = mustIndexOf(
    lib,
    'actor: SELF_ORDER_RECEIVER, kotPrintedAt: { $exists: false } }',
    "the claim CAS filter",
  );
  assert.ok(
    cancelledIdx < casIdx && roundIdx < casIdx,
    "both live-state gates must run BEFORE the claim CAS — a cancelled order's (or fully-voided round's) KOT must never reach the kitchen",
  );
  const gateIdx = mustIndexOf(lib, 'if (order.status === "Cancelled" || !roundHasLines) {', "the combined gate");
  const gateEnd = matchingBraceEnd(lib, lib.indexOf("{", gateIdx + 2));
  const gateBlock = lib.slice(gateIdx, gateEnd);
  assert.match(
    gateBlock,
    /\$set:\s*\{\s*kotPrintedAt:\s*new Date\(\)\s*\}/,
    "the gate must resolve the row (stamp the marker) so the dead ticket stops occupying a pulse slot and nagging staff",
  );
  assert.match(gateBlock, /reason:\s*"not-eligible"/, "and must tell the caller nothing is printable");
});
