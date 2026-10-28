// U2 final fix wave (2026-10-23; the whole-branch review's Important 1; design 6.10; Ruling P6): the Orders page's cancel
// sheet as a pure controller (lib/orders-cancel-sheet.ts) over fake ports — Escape and "Keep order" close only an idle
// sheet (the request in flight keeps it up), and the cancelled order the server returns becomes the detail only while the
// sheet is still open for that order, so a late success never swaps the operator's newer choice. The page's and the
// hook's wiring, and the sheet's outside-press rule: lib/orders-cancel-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import { cancelSheet, type CancelSheetPorts } from "./orders-cancel-sheet";
import { order } from "./orders-lanes.fixtures";
import type { Order } from "@/types";

/** The page as fake ports: the sheet's order, the request (resolved or failed by the test) and the detail chosen. */
function harness() {
  const h = {
    openFor: null as Order | null,
    pending: false,
    sent: [] as [string, string][],
    chosen: [] as Order[],
    resolve: (_o: Order): void => undefined,
    reject: (_e: Error): void => undefined,
  };
  const ports: CancelSheetPorts = {
    openFor: () => h.openFor,
    setOpenFor: (o) => {
      h.openFor = o;
    },
    pending: () => h.pending,
    send: (id, reason) => {
      h.sent.push([id, reason]);
      h.pending = true;
      return new Promise<Order>((resolve, reject) => {
        h.resolve = (o) => {
          h.pending = false;
          resolve(o);
        };
        h.reject = (e) => {
          h.pending = false;
          reject(e);
        };
      });
    },
    choose: (o) => {
      h.chosen.push(o);
    },
  };
  return { h, sheet: cancelSheet(ports) };
}

const A = order("A", { tableNo: "T-1" });
const B = order("B", { tableNo: "T-2" });
const cancelledA = order("A", { tableNo: "T-1", status: "Cancelled", cancelReason: "Guest left" });

test("cancelSheet: the detail's 'Cancel this order' opens the sheet for that order; Escape or 'Keep order' (onOpenChange(false)) closes an idle sheet; onOpenChange(true) changes nothing", () => {
  const { h, sheet } = harness();
  sheet.open(A);
  assert.equal(h.openFor, A, "open for the order the detail handed over");
  sheet.onOpenChange(true);
  assert.equal(h.openFor, A, "an open request changes nothing");
  sheet.onOpenChange(false);
  assert.equal(h.openFor, null, "idle: Escape / Keep order close it");
  assert.deepEqual(h.sent, [], "no request");
});

test("cancelSheet: 'Cancel order' sends the order's id and the reason; while it is in flight Escape is ignored (the sheet stays up); the success chooses the cancelled order the server returns and closes the sheet", async () => {
  const { h, sheet } = harness();
  sheet.open(A);
  const done = sheet.confirm("Guest left");
  assert.deepEqual(h.sent, [["A", "Guest left"]], "one request for the open order");
  sheet.onOpenChange(false);
  assert.equal(h.openFor, A, "in flight: Escape (onOpenChange(false)) does not dismiss the sheet");
  h.resolve(cancelledA);
  await done;
  assert.deepEqual(h.chosen, [cancelledA], "the server's cancelled order becomes the detail (design 6.6: Notify kitchen at hand)");
  assert.equal(h.openFor, null, "then the sheet closes");
});

test("cancelSheet: a late success when the sheet is no longer open for that order chooses nothing (the operator's newer choice stays)", async () => {
  const closed = harness();
  closed.sheet.open(A);
  const first = closed.sheet.confirm("Guest left");
  closed.h.openFor = null; // the sheet went away by any other path while the request was in flight
  closed.h.resolve(cancelledA);
  await first;
  assert.deepEqual(closed.h.chosen, [], "closed meanwhile: the detail is left as the operator set it");
  assert.equal(closed.h.openFor, null, "and the sheet stays closed");

  const other = harness();
  other.sheet.open(A);
  const second = other.sheet.confirm("Guest left");
  other.sheet.open(B); // the sheet now targets another order
  other.h.resolve(cancelledA);
  await second;
  assert.deepEqual(other.h.chosen, [], "open for another order: A's success chooses nothing");
  assert.equal(other.h.openFor, B, "and the sheet stays open for B");
});

test("cancelSheet: a failed request keeps the sheet open with nothing chosen (the hook toasts it); then Escape closes it again", async () => {
  const { h, sheet } = harness();
  sheet.open(A);
  const done = sheet.confirm("Guest left");
  h.reject(new Error("Could not cancel order"));
  await done;
  assert.deepEqual(h.chosen, [], "nothing chosen");
  assert.equal(h.openFor, A, "the sheet stays open to try again");
  sheet.onOpenChange(false);
  assert.equal(h.openFor, null, "idle again: Escape closes it");
});

test("cancelSheet: 'Cancel order' with no sheet open sends nothing", async () => {
  const { h, sheet } = harness();
  await sheet.confirm("Guest left");
  assert.deepEqual(h.sent, [], "no request without an open sheet");
  assert.deepEqual(h.chosen, [], "nothing chosen");
});
