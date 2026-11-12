import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRINT_HOST_NOT_DRAWN_MESSAGE, createHostSlipTickets, type HostPrintResult } from "@/lib/print-host-tickets";
import { PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

function recorder() {
  const results: HostPrintResult[] = [];
  return { results, done: (r: HostPrintResult) => void results.push(r) };
}

describe("print-host-tickets (Phase 6, spec §9 rulings 10 and 12)", () => {
  it("each slip hears its own result, whatever order the writes end in", async () => {
    const t = createHostSlipTickets();
    const a = recorder();
    const b = recorder();
    const ta = t.add(a.done);
    const tb = t.add(b.done);
    t.dispatched(ta);
    t.dispatched(tb);
    const wa = deferred();
    const wb = deferred();
    const ended: number[] = [];
    t.handOff(ta, () => wa.promise, 1, (tk) => ended.push(tk.seq));
    t.handOff(tb, () => wb.promise, 1, (tk) => ended.push(tk.seq));
    wb.resolve();
    await tick();
    assert.deepEqual(b.results, [{ ok: true, written: 1 }], "B hears its own result first");
    assert.equal(a.results.length, 0, "A has not been told yet");
    wa.resolve();
    await tick();
    assert.deepEqual(a.results, [{ ok: true, written: 1 }], "then A");
    assert.deepEqual(ended, [tb.seq, ta.seq], "onEnd ran in write-end order");
    assert.notEqual(ta.seq, tb.seq, "tickets are told apart");
  });

  it("a one-step slip is settled by the surface", () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const tk = t.add(r.done, "job-1");
    assert.equal(tk.jobId, "job-1", "jobId kept");
    t.dispatched(tk);
    t.settle(tk, { ok: true });
    t.settle(tk, { ok: false, error: new Error("late") });
    assert.deepEqual(r.results, [{ ok: true }], "done once, second settle ignored");
  });

  it("a handed-off slip ignores the surface's settle and is settled by its write", async () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const tk = t.add(r.done);
    t.dispatched(tk);
    const w = deferred();
    t.handOff(tk, () => w.promise, 1, () => {});
    assert.equal(t.handedOff(tk), true, "handedOff is true");
    t.settle(tk, { ok: false, error: new Error("surface") });
    assert.equal(r.results.length, 0, "surface's settle ignored");
    w.resolve();
    await tick();
    assert.deepEqual(r.results, [{ ok: true, written: 1 }], "settled by the write");
  });

  it("writes run in order; the first failure is its own, a later one is maybe", async () => {
    const t = createHostSlipTickets();
    const run = async (failAt: number | null) => {
      const r = recorder();
      const calls: number[] = [];
      const tk = t.add(r.done);
      t.dispatched(tk);
      let n = 0;
      t.handOff(
        tk,
        async () => {
          n += 1;
          calls.push(n);
          if (n === failAt) throw new Error("boom");
        },
        3,
        () => {},
      );
      await tick();
      return { r: r.results, calls };
    };
    const ok = await run(null);
    assert.deepEqual(ok.r, [{ ok: true, written: 3 }], "all three written");
    assert.deepEqual(ok.calls, [1, 2, 3], "in order");
    const f1 = await run(1);
    const e1 = (f1.r[0] as { ok: false; error: unknown }).error;
    assert.equal(f1.r[0].ok, false, "write 1 failed");
    assert.ok(!(e1 instanceof PrintWriteError && e1.sent === "maybe"), "first failure is not a maybe error");
    assert.deepEqual(f1.calls, [1], "the rest never ran");
    const f2 = await run(2);
    const e2 = (f2.r[0] as { ok: false; error: unknown }).error;
    assert.equal(printWriteOutcomeOf(e2).sent, "maybe", "a later failure is maybe");
    assert.deepEqual(f2.calls, [1, 2], "write 3 never ran");
  });

  it("a write that throws synchronously counts as a failure", async () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const tk = t.add(r.done);
    t.dispatched(tk);
    t.handOff(tk, () => { throw new Error("sync"); }, 1, () => {});
    await tick();
    assert.equal(r.results[0]?.ok, false, "sync throw is a failure");
    assert.equal(t.writing(), 0, "no longer writing");
  });

  it("withdraw answers a waiting slip sent no; a drawing or writing one stays", async () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const waiting = t.add(r.done);
    assert.equal(t.withdraw(waiting), true, "a waiting slip is withdrawn");
    const res = r.results[0] as { ok: false; error: unknown };
    assert.equal(res.ok, false, "failed");
    assert.deepEqual(
      printWriteOutcomeOf(res.error),
      { sent: "no", permanent: false, message: PRINT_HOST_NOT_DRAWN_MESSAGE },
      "sent no with the not-drawn sentence",
    );
    const r2 = recorder();
    const drawing = t.add(r2.done);
    t.dispatched(drawing);
    assert.equal(t.withdraw(drawing), false, "a drawing slip stays");
    const w = deferred();
    t.handOff(drawing, () => w.promise, 1, () => {});
    assert.equal(t.withdraw(drawing), false, "a writing slip stays");
    w.resolve();
    await tick();
    assert.equal(t.withdraw(drawing), false, "a finished slip stays");
    assert.equal(r2.results.length, 1, "only its write answered");
  });

  it("unmount answers waiting slips no and drawing slips maybe, and leaves writes in flight", async () => {
    const t = createHostSlipTickets();
    const rw = recorder();
    const rd = recorder();
    const rf = recorder();
    t.add(rw.done);
    const drawing = t.add(rd.done);
    const flying = t.add(rf.done);
    t.dispatched(drawing);
    t.dispatched(flying);
    const w = deferred();
    const ends: HostPrintResult[] = [];
    t.handOff(flying, () => w.promise, 1, (_tk, res) => ends.push(res));
    assert.equal(t.writing(), 1, "one writing");
    assert.deepEqual(t.unmount(), { withdrawn: 1, maybe: 1 }, "counts returned");
    assert.equal(t.writing(), 1, "writing unchanged");
    assert.equal(printWriteOutcomeOf((rw.results[0] as { ok: false; error: unknown }).error).sent, "no", "waiting answered no");
    const dres = rd.results[0] as { ok: false; error: unknown };
    assert.equal(dres.error instanceof PrintWriteError, false, "drawing is the plain failed error");
    assert.equal((dres.error as Error).message, PRINT_HOST_PRINT_FAILED_MESSAGE, "drawing answered with the generic sentence");
    assert.equal(rf.results.length, 0, "the writing slip is not answered yet");
    w.resolve();
    await tick();
    assert.deepEqual(rf.results, [{ ok: true, written: 1 }], "its done at its write's end");
    assert.equal(ends.length, 1, "onEnd still ran");
    assert.equal(t.writing(), 0, "no longer writing");
  });

  it("a hand-off before the dispatch throws", () => {
    const t = createHostSlipTickets();
    const tk = t.add(null);
    assert.throws(() => t.handOff(tk, async () => {}, 1, () => {}), "a waiting ticket cannot be handed off");
  });

  it("dispatched is idempotent and ignored once the ticket is not waiting", () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const tk = t.add(r.done);
    t.dispatched(tk);
    t.dispatched(tk);
    t.settle(tk, { ok: true });
    t.dispatched(tk);
    assert.equal(t.withdraw(tk), false, "finished stays finished");
    assert.equal(r.results.length, 1, "one answer");
  });

  it("a throwing listener never stops the next one", async () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const bad = t.add(() => { throw new Error("listener"); });
    const good = t.add(r.done);
    t.dispatched(bad);
    t.dispatched(good);
    let endRan = false;
    t.handOff(bad, async () => {}, 1, () => { endRan = true; throw new Error("onEnd"); });
    t.settle(good, { ok: true });
    await tick();
    assert.equal(endRan, true, "onEnd ran although done threw");
    assert.deepEqual(r.results, [{ ok: true }], "the next slip still heard its result");
    assert.equal(t.writing(), 0, "nothing wedged");
  });

  it("writing() counts until each write settles", async () => {
    const t = createHostSlipTickets();
    const a = t.add(null);
    const b = t.add(null);
    t.dispatched(a);
    t.dispatched(b);
    const wa = deferred();
    const wb = deferred();
    t.handOff(a, () => wa.promise, 1, () => {});
    t.handOff(b, () => wb.promise, 1, () => {});
    assert.equal(t.writing(), 2, "two writing");
    wa.reject(new Error("x"));
    await tick();
    assert.equal(t.writing(), 1, "one left after a failure");
    wb.resolve();
    await tick();
    assert.equal(t.writing(), 0, "none left");
  });

  it("handedOff stays true after the writes ended, ok or failed", async () => {
    const t = createHostSlipTickets();
    const never = t.add(null);
    assert.equal(t.handedOff(never), false, "a waiting ticket was not handed off");
    t.dispatched(never);
    assert.equal(t.handedOff(never), false, "a drawing ticket was not handed off");
    for (const fail of [false, true]) {
      const tk = t.add(null);
      t.dispatched(tk);
      const w = deferred();
      t.handOff(tk, () => w.promise, 1, () => {});
      if (fail) w.reject(new Error("x"));
      else w.resolve();
      await tick();
      assert.equal(t.writing(), 0, "the write ended");
      assert.equal(t.handedOff(tk), true, `handedOff still true after the write ${fail ? "failed" : "succeeded"}`);
    }
  });

  it("a hand-off of a writing or finished ticket throws", async () => {
    const t = createHostSlipTickets();
    const tk = t.add(null);
    t.dispatched(tk);
    const w = deferred();
    t.handOff(tk, () => w.promise, 1, () => {});
    assert.throws(() => t.handOff(tk, async () => {}, 1, () => {}), "a writing ticket cannot be handed off again");
    w.resolve();
    await tick();
    assert.throws(() => t.handOff(tk, async () => {}, 1, () => {}), "a finished ticket cannot be handed off");
  });
});
