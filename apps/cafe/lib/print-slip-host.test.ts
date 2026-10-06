import "@/lib/hook-harness"; // installs the react / react-to-print / sonner stubs: MUST stay the first import
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { PRINT_KOT_ALARM_MS, PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import type { BillBlock, BillTemplate } from "@pos/shared/print-template";
import { loadedSlipCode, setSlipCodeImport, slipCodeStatus } from "@/components/print/slip/slip-code";
import type { SlipCode } from "@/components/print/slip/slip-code-lazy";
import { mountHook, resetStubs, stubModule, stubs, type MountedHook } from "@/lib/hook-harness";
import { defaultBillTemplate, defaultKotTemplate } from "@/lib/print-template-designs";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import { settingsOf } from "@/lib/print-template-golden.fixtures";
import type { HostPrintSlip } from "@/lib/print-host-slips";
import type { Settings } from "@/types";

// R6 (01-PLAN A4): the print host's load gate (hooks/use-slip-code-pending.ts + the dispatch guard in
// hooks/use-print-host-bridge.ts), driven through the REAL hook bodies (lib/hook-harness.ts) with useSettings stubbed
// to `world.settings`. The chunk import is a held promise (setSlipCodeImport), so no real chunk loads. The store is
// process-wide: the tests run IN ORDER (settled-nothing, fail, then a held import that succeeds).

const world: { settings: Settings | undefined } = { settings: undefined };
stubModule("@/hooks/use-settings", { useSettings: () => ({ data: world.settings }) }); // BEFORE the hooks load
const load = createRequire(__filename);
const { SLIP_CODE_WAIT_MAX_MS, settingsNeedSlipCode, useSlipCodePending } = load("@/hooks/use-slip-code-pending") as typeof import("@/hooks/use-slip-code-pending");
const { usePrintHostBridge } = load("@/hooks/use-print-host-bridge") as typeof import("@/hooks/use-print-host-bridge");

const BASE = settingsOf();
const QR_LINK: BillBlock = { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://example.com/menu" } } as BillBlock;
const classicWithQr: BillTemplate = { ...classicBillTemplate(BASE), blocks: [...classicBillTemplate(BASE).blocks, QR_LINK] };
const withBill = (billTemplate: unknown): Settings => ({ ...BASE, billTemplate });
const withKot = (kotTemplate: unknown): Settings => ({ ...BASE, kotTemplate });
const MODERN = withBill(defaultBillTemplate("modern", BASE));

test("settingsNeedSlipCode: no / unreadable / Classic-without-QR template is false; Classic+QR, Modern/Express/Cafe, kitchenBold, or either of a pair is true", () => {
  const unreadable = { ...defaultBillTemplate("modern", BASE), design: "neon" };
  for (const empty of [null, undefined, {} as Settings, BASE]) assert.equal(settingsNeedSlipCode(empty), false, "no template at all");
  assert.equal(settingsNeedSlipCode(withBill(unreadable)), false, "an unreadable bill falls back to the legacy slip");
  assert.equal(settingsNeedSlipCode(withKot("garbage")), false, "an unreadable kot falls back to the legacy slip");
  assert.equal(settingsNeedSlipCode(withBill(classicBillTemplate(BASE))), false, "Classic bill, no QR");
  assert.equal(settingsNeedSlipCode({ ...BASE, billTemplate: classicBillTemplate(BASE), kotTemplate: classicKotTemplate(BASE) }), false, "both Classic");
  assert.equal(settingsNeedSlipCode(withBill(classicWithQr)), true, "Classic bill with a QR line");
  for (const design of ["modern", "express", "cafe"] as const) assert.equal(settingsNeedSlipCode(withBill(defaultBillTemplate(design, BASE))), true, `${design} bill`);
  assert.equal(settingsNeedSlipCode(withKot(defaultKotTemplate("kitchenBold", BASE))), true, "kitchenBold kot");
  assert.equal(settingsNeedSlipCode({ ...BASE, billTemplate: classicBillTemplate(BASE), kotTemplate: defaultKotTemplate("kitchenBold", BASE) }), true, "the kitchen side alone");
  assert.equal(settingsNeedSlipCode({ ...BASE, billTemplate: defaultBillTemplate("modern", BASE), kotTemplate: classicKotTemplate(BASE) }), true, "the bill side alone");
});

// ── the scene ────────────────────────────────────────────────────────────────

const slipOf = (surface: HostPrintSlip["surface"], title: string): HostPrintSlip => ({ surface, documentTitle: title, order: {} }) as unknown as HostPrintSlip;
const TEXT = { textContent: "A SLIP" } as HTMLDivElement;

interface Held {
  settle(): void;
  reject(): void;
  calls: number;
}
/** An import the test resolves (or rejects) by hand. */
function heldImport(): Held {
  const held: Held = { settle: () => undefined, reject: () => undefined, calls: 0 };
  setSlipCodeImport(() => {
    held.calls += 1;
    return new Promise((resolve, reject) => {
      held.settle = () => resolve({ SLIP_CODE: {} as SlipCode }); // nothing renders under the harness: an empty chunk is enough
      held.reject = () => reject(new Error("offline"));
    });
  });
  return held;
}

/** Mounts the REAL host bridge (one mount at a time: lib/hook-harness.ts keeps ONE shared stubs record). */
function scene(settings: Settings | undefined) {
  world.settings = settings;
  resetStubs();
  const hook: MountedHook<ReturnType<typeof usePrintHostBridge>> = mountHook(() => usePrintHostBridge({ surfacesMounted: true }));
  const bridge = hook.result();
  bridge.kotRef.current = TEXT;
  bridge.receiptRef.current = TEXT;
  bridge.eodRef.current = TEXT;
  return {
    hook,
    queue: (surface: HostPrintSlip["surface"]) => hook.act(() => hook.result().queueSlip(slipOf(surface, `${surface}-job`))),
    /** react-to-print reports the dispatched job done (the one shared onAfterPrint; it also clears the watchdog). */
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
  };
}
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve)); // let a hand-settled import's callbacks run

test("no template (nothing, Classic): nothing is pending, nothing is fetched, a bill slip dispatches at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); // the dispatch watchdog
  let imports = 0;
  setSlipCodeImport(() => (imports += 1, Promise.reject(new Error("must not be called"))));
  for (const settings of [undefined, BASE, { ...BASE, billTemplate: classicBillTemplate(BASE), kotTemplate: classicKotTemplate(BASE) }]) {
    const pending = mountHook(() => ((world.settings = settings), useSlipCodePending()));
    assert.equal(pending.result(), false, "slipCodePending is false");
    pending.unmount();
    const s = scene(settings);
    s.queue("receipt");
    assert.deepEqual(stubs.printed, ["receipt"], "dispatched at once");
    s.finish();
    s.hook.unmount();
  }
  await settled();
  assert.equal(imports, 0, "a cafe that needs nothing never imports the chunk");
  assert.equal(slipCodeStatus(), "idle");
});

test("rejecting import: the bill is held while the fetch is pending, then dispatched ONCE after the failure (the legacy slip prints)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = heldImport();
  const s = scene(MODERN);
  assert.equal(held.calls, 1, "mounting fetched the chunk (status was idle)");
  assert.equal(slipCodeStatus(), "loading", "landmark: the fetch is in flight");
  s.queue("receipt");
  assert.deepEqual(stubs.printed, [], "held while pending");
  assert.deepEqual(stubs.toasts, [], "no empty-slip / failure message while held");
  held.reject();
  await settled();
  assert.equal(slipCodeStatus(), "failed");
  assert.deepEqual(stubs.printed, ["receipt"], "dispatched exactly once after the failure");
  assert.deepEqual(stubs.toasts, [], "and no message");
  s.finish();
  s.hook.unmount();
});

let held: Held;

test("while the chunk is pending: a kitchen ticket is held too, but the end-of-day report and the test slip are never held", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  held = heldImport();
  const kot = scene(MODERN); // status was "failed": a mount retries the fetch once
  assert.equal(held.calls, 1, "mounting retried the failed fetch");
  assert.equal(slipCodeStatus(), "loading", "landmark: pending");
  kot.queue("kot");
  assert.deepEqual(stubs.printed, [], "the kitchen ticket is held");
  kot.hook.unmount();

  const eod = scene(MODERN);
  eod.hook.act(() => eod.hook.result().setEodReady(true));
  eod.queue("eod");
  assert.deepEqual(stubs.printed, ["eod"], "the end-of-day report dispatches while pending");
  eod.finish();
  eod.hook.unmount();

  const probe = scene(MODERN);
  void probe.hook.result().queueTestSlip().catch(() => undefined);
  assert.deepEqual(stubs.printed, ["kot"], "the attestation test slip dispatches while pending (it rides the kot surface)");
  probe.finish();
  probe.hook.unmount();
  assert.equal(held.calls, 1, "none of this fetched again (a loading chunk is joined, not refetched)");
});

test("the wait has a ceiling well under the kitchen alarm and the lease", () => {
  assert.equal(SLIP_CODE_WAIT_MAX_MS, 8_000, "the pinned value");
  assert.ok(PRINT_KOT_ALARM_MS === 20_000 && PRINT_LEASE_MS === 90_000, "landmark: the lifecycle constants this is measured against");
  assert.ok(SLIP_CODE_WAIT_MAX_MS < PRINT_KOT_ALARM_MS / 2, "well under the 20 s kitchen alarm");
  assert.ok(SLIP_CODE_WAIT_MAX_MS < PRINT_LEASE_MS / 2, "well under the 90 s lease");
});

test("a chunk that never answers: the bill is held until SLIP_CODE_WAIT_MAX_MS, then dispatched exactly once (legacy slip); a later wait gets a FRESH full ceiling", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); // the ceiling's timer and the dispatch watchdog: no real 8 s sleep
  const s = scene(MODERN); // the import from the previous test is still held: status "loading"
  assert.equal(slipCodeStatus(), "loading", "landmark: still pending");
  s.queue("receipt");
  t.mock.timers.tick(SLIP_CODE_WAIT_MAX_MS - 1);
  assert.deepEqual(stubs.printed, [], "held right up to the ceiling");
  s.hook.act(() => t.mock.timers.tick(1));
  assert.deepEqual(stubs.printed, ["receipt"], "dispatched exactly once at the ceiling");
  assert.deepEqual(stubs.toasts, [], "no message");
  s.hook.act(() => t.mock.timers.tick(SLIP_CODE_WAIT_MAX_MS * 2));
  assert.deepEqual(stubs.printed, ["receipt"], "and not again");
  s.finish();

  // The wait ends (a cafe whose settings stop needing the chunk), then a NEW wait starts (status is still loading).
  world.settings = BASE;
  s.hook.rerender();
  s.queue("receipt");
  assert.deepEqual(stubs.printed, ["receipt", "receipt"], "no template: not held at all");
  s.finish();
  world.settings = MODERN;
  s.hook.rerender();
  s.queue("receipt");
  assert.deepEqual(stubs.printed, ["receipt", "receipt"], "the new wait is pending again: the old give-up did not carry over");
  t.mock.timers.tick(SLIP_CODE_WAIT_MAX_MS - 1);
  assert.deepEqual(stubs.printed, ["receipt", "receipt"], "the fresh ceiling is the full length");
  s.hook.act(() => t.mock.timers.tick(1));
  assert.deepEqual(stubs.printed, ["receipt", "receipt", "receipt"], "and releases once at its end");
  s.finish();
  s.hook.unmount();
});

test("resolving the held import releases a queued bill exactly once; a host that already gave up stays released", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  world.settings = MODERN;
  const early = mountHook(() => useSlipCodePending());
  assert.equal(early.result(), true, "landmark: waiting on the held import");
  early.act(() => t.mock.timers.tick(SLIP_CODE_WAIT_MAX_MS));
  assert.equal(early.result(), false, "gave up at the ceiling");
  const s = scene(MODERN);
  s.queue("receipt");
  assert.deepEqual(stubs.printed, [], "held while pending");
  assert.deepEqual(stubs.toasts, [], "no empty-slip message");
  held.settle();
  await settled();
  assert.ok(loadedSlipCode() !== null && slipCodeStatus() === "ready", "landmark: the chunk is in");
  assert.deepEqual(stubs.printed, ["receipt"], "the receipt surface is dispatched exactly once after the load");
  s.hook.rerender();
  assert.deepEqual(stubs.printed, ["receipt"], "and not again on a later render");
  assert.equal(early.result(), false, "the host that gave up earlier stays released once the store is ready");
  early.unmount();
  s.finish();
  s.hook.unmount();
});
