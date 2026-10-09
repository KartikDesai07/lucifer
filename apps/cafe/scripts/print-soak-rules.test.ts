import { test } from "node:test";
import assert from "node:assert/strict";

import { missingSlips, parseSoakArgs, slipOfJobKey, unnamedJobs } from "./print-soak-rules";

// Phase 3 Session 3G (Session 2G's m-5, the final Phase 2 gate's (a) item 5): the soak refuses a malformed address before
// its first order, and in printers mode checks every slip it made against the jobs the database holds for its orders, not
// only the jobs its answers named.

const OUT = ["--out", "C:/fake-9100"];
const exists = () => true;

test("a malformed --agent or --printer value is refused at the start, before any order", () => {
  for (const bad of ["127.0.0.1", ":9100", "127.0.0.1:", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:91x0", "a b:9100"]) {
    assert.throws(() => parseSoakArgs([...OUT, "--agent", bad], exists), /--agent/, `--agent ${bad}`);
  }
  for (const bad of ["Kitchen", "=127.0.0.1:9100", "Kitchen=127.0.0.1", "Kitchen=:9100"]) {
    assert.throws(() => parseSoakArgs([...OUT, "--printer", bad], exists), /--printer/, `--printer ${bad}`);
  }
  assert.deepEqual(parseSoakArgs([...OUT, "--agent", "127.0.0.1:9103"], exists).agent, { host: "127.0.0.1", port: 9103 }, "a good --agent");
  assert.deepEqual(parseSoakArgs([...OUT, "--printer", "Bar printer=127.0.0.1:9101", "--printer", "A=B=127.0.0.1:9104"], exists).printers, [
    { name: "Bar printer", host: "127.0.0.1", port: 9101 },
    { name: "A=B", host: "127.0.0.1", port: 9104 },
  ], "a name may hold '=' (the last one splits)");
  assert.throws(() => parseSoakArgs(["--out", "C:/nowhere"], () => false), /--out/, "a fake printer's folder that does not exist");
  assert.throws(() => parseSoakArgs([...OUT, "--orders", "0"], exists), /--orders/);
  assert.throws(() => parseSoakArgs([...OUT, "--base", "https://cafe.example.com"], exists), /--base/, "a local POS only");
  assert.throws(() => parseSoakArgs([...OUT, "--direct"], exists), /--direct/, "--direct needs a line to print");
});

test("--tokens says how the soak's page says it prints token slips: page (its lease and ack), lease (its lease only)", () => {
  assert.equal(parseSoakArgs(OUT, exists).tokens, null, "not said: a page from before print-customization S7");
  assert.equal(parseSoakArgs([...OUT, "--agent", "127.0.0.1:9103", "--tokens", "page"], exists).tokens, "page");
  assert.equal(parseSoakArgs([...OUT, "--agent", "127.0.0.1:9103", "--tokens", "lease"], exists).tokens, "lease");
  assert.throws(() => parseSoakArgs([...OUT, "--agent", "127.0.0.1:9103", "--tokens", "yes"], exists), /--tokens/);
  assert.throws(() => parseSoakArgs([...OUT, "--tokens", "page"], exists), /--tokens/, "an ordering-only soak prints no token");
});

test("each job belongs to one slip (its key without the printer line), and every slip the soak made must have a job", () => {
  assert.equal(slipOfJobKey("kot:6620aa:2:p-bar:0"), "kot:6620aa:2", "a printers-mode KOT job on the bar's line");
  assert.equal(slipOfJobKey("kot:6620aa:1"), "kot:6620aa:1", "simple mode");
  assert.equal(slipOfJobKey("bill:6620aa:p-counter:0"), "bill:6620aa");
  assert.equal(slipOfJobKey("token:6620aa"), "token:6620aa");
  assert.equal(slipOfJobKey(undefined), null, "a job with no key (a reprint) is no slip of the soak's");
  const made = ["kot:o1:1", "token:o1", "kot:o1:2", "bill:o1", "kot:o2:1", "bill:o2"];
  const jobs = [{ jobKey: "kot:o1:1:p-k:0" }, { jobKey: "kot:o1:1:p-b:0" }, { jobKey: "token:o1:p-c:0" }, { jobKey: "kot:o1:2:p-k:0" }, { jobKey: "bill:o1:p-c:0" }, { jobKey: "kot:o2:1:p-k:0" }];
  assert.deepEqual(missingSlips(made, jobs), ["bill:o2"], "the second order's bill has no job: the soak says so");
  assert.deepEqual(missingSlips(made, [...jobs, { jobKey: "bill:o2:p-c:0" }]), [], "every slip has its jobs");
});

// The final Phase 3 gate (the 3G review's m-3): in printers mode a slip is a job per printer line, each named in the answer
// that made it; a job of the soak's orders that no answer named (a sweep's repair, a duplicate) is counted, as before 3G.
test("a job of the soak's orders that no answer named is counted (a repair or a duplicate)", () => {
  const jobs = [{ _id: "j1" }, { _id: "j2" }, { _id: "j3" }];
  assert.deepEqual(unnamedJobs(jobs, new Set(["j1", "j2", "j3"])), [], "every job named by the answer that made it");
  assert.deepEqual(unnamedJobs(jobs, new Set(["j1", "j3", "j9"])), ["j2"], "j2 no answer named (j9's absence is the missing count's)");
  assert.deepEqual(unnamedJobs([], new Set(["j1"])), [], "no jobs, nothing unnamed");
});

// Phase 3 Session 3G: --failover, two soak writers (the soak's --device and a second one that writes its own printer, so it
// may take a network printer over: the 3A gate's E-1), the orders from a third device, and the soak's writer stopped
// after --stop-after orders (half of them unless said).
test("--failover needs the soak's printers, a printer of the second writer's own and a stop inside the run; its orders come from a third device", () => {
  const base = [...OUT, "--printer", "Kitchen printer=127.0.0.1:9100", "--orders", "20"];
  const second = ["--failover", "soak-b", "--failover-printer", "Bar printer=127.0.0.1:9101"];
  assert.deepEqual(parseSoakArgs([...base, ...second, "--stop-after", "8"], exists).failover, { device: "soak-b", printers: [{ name: "Bar printer", host: "127.0.0.1", port: 9101 }], stopAfter: 8 });
  assert.equal(parseSoakArgs([...base, ...second], exists).failover?.stopAfter, 10, "half the orders unless said");
  assert.equal(parseSoakArgs(base, exists).failover, null, "not asked");
  assert.throws(() => parseSoakArgs([...base, "--failover", "soak-b"], exists), /--failover-printer/, "the second writer writes a printer of its own (E-1)");
  assert.throws(() => parseSoakArgs([...OUT, ...second], exists), /--failover/, "the soak writes the printers that fail over");
  assert.throws(() => parseSoakArgs([...base, ...second, "--direct"], exists), /--direct/, "the orders come from a device that prints nothing");
  assert.throws(() => parseSoakArgs([...base, ...second, "--stop-after", "20"], exists), /--stop-after/, "a stop inside the run");
  assert.throws(() => parseSoakArgs([...base, "--failover", "soak-device", "--failover-printer", "Bar printer=127.0.0.1:9101"], exists), /--failover/, "two different devices");
  assert.throws(() => parseSoakArgs([...base, "--failover-printer", "Bar printer=127.0.0.1:9101"], exists), /--failover-printer/, "a second writer's printer needs --failover");
  assert.throws(() => parseSoakArgs([...base, ...second, "--failover-printer", "Bar printer"], exists), /--failover-printer/, "a malformed address");
});
