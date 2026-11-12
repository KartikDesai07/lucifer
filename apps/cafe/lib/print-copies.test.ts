import { settingsOf } from "./print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { KotBlock } from "@pos/shared/print-template";
import { copiesDrawnOnce, printJobCopies } from "@/lib/print-copies";
import { PRINTER_NOT_LOCAL_MESSAGE } from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import { kotTextJob } from "@/lib/printer/kot-text/kot-text";
import { slipOf } from "@/lib/printer/kot-text/kot-text.fixtures";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";
import { stripComments } from "@/lib/source-pin-utils";
import type { Settings } from "@/types";

// Phase 6 Session 6A Task 7 (spec §9 ruling 24): a kitchen slip's copies on a two-step lane are drawn once and written N
// times; a bill (and everything else) keeps a draw per copy; a copy is never lost and never doubled.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APP = path.join(REPO_ROOT, "apps/cafe");

/** A printOnce that records what it was asked for and answers from a script (default ok, one written). */
function printsWith(results: PrintAgentResult[]) {
  const asked: number[] = [];
  const once = async (writes: number): Promise<PrintAgentResult> => {
    asked.push(writes);
    return results.shift() ?? { ok: true };
  };
  return { asked, once };
}
const wrote = (written: number): PrintAgentResult => ({ ok: true, written }) as PrintAgentResult;
const kot = (copies?: number) => ({ printerId: "p1", kind: "kot" as const, ...(copies !== undefined ? { copies } : {}) });
const bill = (copies?: number) => ({ printerId: "p1", kind: "bill" as const, ...(copies !== undefined ? { copies } : {}) });
const LOCAL = ["p1"];
const outcome = (r: PrintAgentResult) => (r.ok ? null : printWriteOutcomeOf(r.error));

test("a KOT on a two-step lane draws once and writes N times", async () => {
  const p = printsWith([wrote(3)]);
  assert.deepEqual([await printJobCopies(kot(3), LOCAL, p.once, true), p.asked], [{ ok: true }, [3]], "one draw asked for all three copies");
});

test("a bill draws every copy", async () => {
  const p = printsWith([]);
  assert.deepEqual([await printJobCopies(bill(2), LOCAL, p.once, false), p.asked], [{ ok: true }, [1, 1]], "two copies, one draw each");
});

test("a KOT that was not handed off prints the rest one draw each", async () => {
  const p = printsWith([wrote(1)]);
  assert.deepEqual([await printJobCopies(kot(3), LOCAL, p.once, true), p.asked], [{ ok: true }, [3, 1, 1]], "never fewer copies than asked, never more");
  const over = printsWith([wrote(9)]);
  assert.deepEqual([await printJobCopies(kot(3), LOCAL, over.once, true), over.asked], [{ ok: true }, [3]], "an answer over what was asked is clamped: never more");
  const bare = printsWith([{ ok: true }]);
  assert.deepEqual([await printJobCopies(kot(2), LOCAL, bare.once, true), bare.asked], [{ ok: true }, [2, 1]], "no `written` means one copy");
});

test("a job with copies absent or 1 is one printOnce(1), as today", async () => {
  for (const job of [kot(), kot(1), bill(), { printerId: undefined, kind: "kot" as const }]) {
    const p = printsWith([]);
    const result = await printJobCopies(job, LOCAL, p.once, false);
    assert.deepEqual([result, p.asked], [{ ok: true }, [1]], "one draw, one copy");
  }
  const one = printsWith([]);
  assert.deepEqual([await printJobCopies(kot(1), LOCAL, one.once, true), one.asked], [{ ok: true }, [1]], "one copy asks for 1 even when drawn once");
});

test("the first failure before any copy is its own; after a copy it is maybe", async () => {
  const first = printsWith([{ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) }]);
  const r1 = await printJobCopies(bill(2), LOCAL, first.once, false);
  assert.deepEqual([first.asked, outcome(r1)?.sent], [[1], "no"], "the first copy's refusal stands: nothing reached paper");
  const second = printsWith([{ ok: true }, { ok: false, error: new PrintWriteError(PRINTER_WRITE_FAILED_MESSAGE, "no") }]);
  const r2 = await printJobCopies(bill(2), LOCAL, second.once, false);
  assert.deepEqual(outcome(r2), { sent: "maybe", permanent: false, message: PRINTER_WRITE_FAILED_MESSAGE }, "a copy is on paper already: maybe");
  const handed = printsWith([{ ok: false, error: new PrintWriteError(PRINTER_WRITE_FAILED_MESSAGE, "maybe") }]);
  const r3 = await printJobCopies(kot(3), LOCAL, handed.once, true);
  assert.deepEqual([handed.asked, outcome(r3)?.sent], [[3], "maybe"], "a handed-off write's own maybe stays maybe");
  const refused = printsWith([{ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) }]);
  const r4 = await printJobCopies(kot(3), LOCAL, refused.once, true);
  assert.equal(outcome(r4)?.sent, "no", "a draw that failed before any copy: its own failure");
  const late = printsWith([wrote(1), { ok: false, error: new PrintWriteError(PRINTER_WRITE_FAILED_MESSAGE, "no") }]);
  const r5 = await printJobCopies(kot(3), LOCAL, late.once, true);
  assert.deepEqual([late.asked, outcome(r5)?.sent], [[3, 1], "maybe"], "a later draw failing after a copy is written: maybe");
});

test("a job not on this device's printers is refused sent no", async () => {
  for (const bytesOnce of [false, true]) {
    const away = printsWith([]);
    const refused = await printJobCopies(kot(2), ["p-counter"], away.once, bytesOnce);
    assert.deepEqual([away.asked, outcome(refused)], [[], { sent: "no", permanent: false, message: PRINTER_NOT_LOCAL_MESSAGE }], "refused, nothing sent, never counted");
  }
  const simple = printsWith([]);
  assert.deepEqual([await printJobCopies({ kind: "kot" }, [], simple.once, false), simple.asked], [{ ok: true }, [1]], "the device's own simple-mode line: one copy, as today");
});

test("copiesDrawnOnce: a KOT with copies on a lane only", () => {
  const native = { paper: "80mm" as const, nativeId: "tcp:1.2.3.4:9100" };
  const lan = { paper: "80mm" as const, lan: { host: "10.0.0.9", port: 9100 } };
  const windows = { paper: "80mm" as const, printerName: "Counter" };
  assert.equal(copiesDrawnOnce({ kind: "kot", copies: 2 }, native), true, "kot/2/native");
  assert.equal(copiesDrawnOnce({ kind: "kot", copies: 1 }, native), false, "kot/1");
  assert.equal(copiesDrawnOnce({ kind: "kot" }, native), false, "kot/no copies");
  assert.equal(copiesDrawnOnce({ kind: "bill", copies: 2 }, native), false, "bill/2/native");
  assert.equal(copiesDrawnOnce({ kind: "kot", copies: 2 }, windows), false, "kot/2/printerName");
  assert.equal(copiesDrawnOnce({ kind: "kot", copies: 2 }, lan), true, "kot/2/lan");
  assert.equal(copiesDrawnOnce({ kind: "kot", copies: 2 }, undefined), false, "kot/2/no target");
});

// What the KOT renderers must not read: any clock. A copy is the same bytes only if nothing in them changes with time.
const CLOCK = [/new\s+Date\s*\(\s*\)/, /Date\s*\.\s*now\s*\(/, /performance\s*\.\s*now\s*\(/];
const KOT_BLOCKS = ["components/print/slip/kot-classic-blocks.tsx", "components/print/slip/kot-bold-blocks.tsx"];

function clockReaders(files: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    const code = stripComments(text);
    if (CLOCK.some((re) => re.test(code))) hits.push(`${name}: clock`);
    if (KOT_BLOCKS.includes(name) && /\bnowMs?\b/.test(code)) hits.push(`${name}: now from the slip context`);
  }
  return hits;
}
function kotRendererSources(): Record<string, string> {
  const dir = path.join(APP, "lib/printer/kot-text");
  const lib = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/\.fixtures\.tsx?$/.test(f))
    .map((f) => `lib/printer/kot-text/${f}`);
  const out: Record<string, string> = {};
  for (const rel of ["components/pos/KOTReceipt.tsx", ...KOT_BLOCKS, ...lib]) out[rel] = readFileSync(path.join(APP, rel), "utf8");
  return out;
}

test("the KOT renderers read no clock", () => {
  const sources = kotRendererSources();
  assert.ok(Object.keys(sources).length >= 8, "the pin reads KOTReceipt, both block files and the text KOT's files");
  assert.deepEqual(clockReaders(sources), [], "no new Date(), Date.now(), performance.now(), no `now` from the slip context");
  const bite = {
    ...sources,
    [KOT_BLOCKS[0]]: `${sources[KOT_BLOCKS[0]]}\nconst t = Date.now();\n`,
    [KOT_BLOCKS[1]]: `${sources[KOT_BLOCKS[1]]}\nconst { nowMs } = ctx;\n`,
  };
  assert.equal(clockReaders(bite).length, 2, "the pin bites: a clock read and a `nowMs` read are both caught");
});

test("the text KOT's bytes are the same twice", () => {
  const plain = settingsOf({ logo: "" });
  const qr = (): Settings => {
    const template = classicKotTemplate(plain);
    const block = { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://menu.example.com" } } as unknown as KotBlock;
    return { ...plain, kotTemplate: { ...template, blocks: [...template.blocks, block] } } as Settings;
  };
  const cases: Array<[string, ReturnType<typeof slipOf>, Settings]> = [
    ["a plain KOT", slipOf("round-label-number"), plain],
    ["a REPRINT banner", slipOf("round-banner-reprint"), plain],
    ["a VOID", slipOf("void-reason-by-at"), plain],
    ["a MOVED", slipOf("moved-from-by-at"), plain],
    ["a cancel notice", slipOf("cancel-notice-reason"), plain],
    ["an OFFLINE banner", slipOf("round-label-number", { banner: "OFFLINE · O-3" }), plain],
    ["a QR round", slipOf("round-label-number"), qr()],
  ];
  for (const [name, slip, settings] of cases) {
    const a = kotTextJob({ slip, settings, columns: 48 });
    const b = kotTextJob({ slip, settings, columns: 48 });
    if (name === "a QR round") {
      assert.deepEqual([a, b], [{ ok: false, refusal: "picture" }, { ok: false, refusal: "picture" }], `${name}: a QR code has no text form, so it prints as a picture (its copies' raster bytes: 6B Task 11)`);
      continue;
    }
    assert.ok(a.ok && b.ok, `${name}: prints as text`);
    if (a.ok && b.ok) {
      assert.ok(a.bytes.length > 0, `${name}: real bytes, not empty`);
      assert.deepEqual(a.bytes, b.bytes, `${name}: the same bytes twice`);
    }
  }
});
