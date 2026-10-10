import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOW_SERVING_LANGUAGES,
  ANNOUNCE_FRESH_MS,
  ANNOUNCE_QUEUE_MAX,
  KNOWN_KEYS_MAX,
  INITIAL_ANNOUNCER_STATE,
  readyKeyOf,
  observeBoard,
  enqueueAnnouncements,
  pruneQueue,
  announcementText,
  pickVoice,
  voiceNoticeOf,
  type AnnouncerState,
  type Announcement,
} from "./now-serving-announcer";
import type { TokenBoard, TokenBoardEntry } from "./token-view";

// Print customization S9 — the Now Serving announcer, driven from the plan's §3 contract (09-S9-plan.md). Pure: boards
// in, "what to call out loud" out. Every rule of observeBoard is pinned in the contract's order; the queue helpers, the
// exact spoken strings, the voice picker and the voice notice follow. Nothing here touches a window, a clock or speech.

const T0 = Date.parse("2026-10-06T10:00:00.000Z");
const POLL_MS = 5000;
const iso = (ms: number): string => new Date(ms).toISOString();

function entry(id: string, number: number, readySince?: string): TokenBoardEntry {
  return { id, number, firedAt: iso(T0 - 600_000), ...(readySince === undefined ? {} : { readySince }) };
}

function board(generatedAt: string, ready: TokenBoardEntry[], enabled = true, preparing: TokenBoardEntry[] = []): TokenBoard {
  return { enabled, preparing, ready, generatedAt };
}

/** The first observe of a board: seeds the announcer (rule 4) so the next board is judged by the diff. */
function seeded(ready: TokenBoardEntry[] = [], atMs = T0): AnnouncerState {
  return observeBoard(INITIAL_ANNOUNCER_STATE, board(iso(atMs), ready)).state;
}

const numbersOf = (announce: readonly Announcement[]): number[] => announce.map((a) => a.number);

test("S9 announcer: the exported constants and the initial state have the contract's values", () => {
  assert.deepEqual([...NOW_SERVING_LANGUAGES], ["en", "hi"]);
  assert.equal(ANNOUNCE_FRESH_MS, 120000);
  assert.equal(ANNOUNCE_QUEUE_MAX, 10);
  assert.equal(KNOWN_KEYS_MAX, 1000);
  assert.deepEqual(INITIAL_ANNOUNCER_STATE, { seeded: false, enabled: false, lastGeneratedMs: null, known: [] });
});

test("S9 announcer: readyKeyOf is `${id}@${readySince ?? \"\"}`", () => {
  assert.equal(readyKeyOf(entry("abc", 7, "2026-10-06T10:00:00.000Z")), "abc@2026-10-06T10:00:00.000Z");
  assert.equal(readyKeyOf(entry("abc", 7)), "abc@");
  assert.notEqual(readyKeyOf(entry("abc", 7, "x")), readyKeyOf(entry("abc", 7, "y")));
});

test("S9 announcer rule 1: a stale or out-of-order board returns the SAME state object and announces nothing", () => {
  const prev = seeded([], T0);
  const fresh = entry("n1", 11, iso(T0 + 1000));

  const same = observeBoard(prev, board(iso(T0), [fresh]));
  assert.equal(same.state, prev, "equal generatedAt (an optimistic copy) is dropped by identity");
  assert.deepEqual(same.announce, []);

  const older = observeBoard(prev, board(iso(T0 - 1000), [fresh]));
  assert.equal(older.state, prev, "an older reply is dropped by identity");
  assert.deepEqual(older.announce, []);

  // Rule 1 runs before rule 3: a stale tokens-off board must not flip the state either.
  const staleOff = observeBoard(prev, board(iso(T0 - 1), [], false));
  assert.equal(staleOff.state, prev);
  assert.deepEqual(staleOff.announce, []);

  // Landmark: the very same entry on a strictly newer board IS announced, so the drops above are rule 1, not a dead observer.
  const newer = observeBoard(prev, board(iso(T0 + 1), [fresh]));
  assert.deepEqual(numbersOf(newer.announce), [11]);
  assert.notEqual(newer.state, prev);
});

test("S9 announcer rule 1: the first board (lastGeneratedMs null) is never stale", () => {
  const out = observeBoard(INITIAL_ANNOUNCER_STATE, board(iso(T0), []));
  assert.notEqual(out.state, INITIAL_ANNOUNCER_STATE);
  assert.equal(out.state.lastGeneratedMs, T0);
});

test("S9 announcer rule 2: an unparseable generatedAt is processed and leaves lastGeneratedMs unchanged", () => {
  const prev = seeded([], T0);
  const off = observeBoard(prev, board("not a date", [], false));
  assert.notEqual(off.state, prev, "processed, not dropped as stale");
  assert.equal(off.state.enabled, false, "the tokens-off rule ran");
  assert.equal(off.state.seeded, true);
  assert.equal(off.state.lastGeneratedMs, T0, "last stays at the previous parsed instant");
  assert.deepEqual(off.announce, []);

  // First ever board with a bad stamp: seeds (rule 4), last stays null.
  const first = observeBoard(INITIAL_ANNOUNCER_STATE, board("garbage", [entry("a", 1, iso(T0))]));
  assert.equal(first.state.seeded, true);
  assert.equal(first.state.enabled, true);
  assert.equal(first.state.lastGeneratedMs, null);
  assert.ok(first.state.known.includes("a@" + iso(T0)));
  assert.deepEqual(first.announce, []);

  // Because last did not move, an older valid board is still judged against T0.
  const older = observeBoard(off.state, board(iso(T0 - 1000), []));
  assert.equal(older.state, off.state);
});

test("S9 announcer rule 3: tokens off records the instant, keeps known, announces nothing", () => {
  const prev = seeded([entry("a", 1, iso(T0 - 1000))]);
  const out = observeBoard(prev, board(iso(T0 + POLL_MS), [entry("b", 2, iso(T0 + POLL_MS))], false));
  assert.deepEqual(out.announce, []);
  assert.equal(out.state.seeded, true);
  assert.equal(out.state.enabled, false);
  assert.equal(out.state.lastGeneratedMs, T0 + POLL_MS);
  assert.deepEqual(out.state.known, prev.known);
  assert.ok(prev.known.includes("a@" + iso(T0 - 1000)), "landmark: known was not empty to begin with");
});

test("S9 announcer rule 4: the first observe seeds from board.ready and announces nothing", () => {
  const ready = [entry("a", 1, iso(T0 - 1000)), entry("b", 2, iso(T0 - 500))];
  const out = observeBoard(INITIAL_ANNOUNCER_STATE, board(iso(T0), ready));
  assert.deepEqual(out.announce, []);
  assert.equal(out.state.seeded, true);
  assert.equal(out.state.enabled, true);
  assert.equal(out.state.lastGeneratedMs, T0);
  assert.deepEqual([...out.state.known].sort(), ready.map(readyKeyOf).sort());
});

test("S9 announcer rule 4: seeding is not tied to freshness - a token marked ready 5 seconds ago is still silent on first load", () => {
  const out = observeBoard(INITIAL_ANNOUNCER_STATE, board(iso(T0), [entry("a", 1, iso(T0 - 5000))]));
  assert.deepEqual(out.announce, []);
});

test("S9 announcer rule 4: re-enabling tokens re-seeds - the ready tokens already on the board are not called", () => {
  let s = seeded([entry("a", 1, iso(T0 - 1000))], T0);
  s = observeBoard(s, board(iso(T0 + POLL_MS), [], false)).state;
  assert.equal(s.enabled, false);

  const back = observeBoard(s, board(iso(T0 + 2 * POLL_MS), [entry("a", 1, iso(T0 - 1000)), entry("b", 2, iso(T0 + 2 * POLL_MS - 1000))]));
  assert.deepEqual(back.announce, [], "nothing announced on the board that turned tokens back on");
  assert.equal(back.state.enabled, true);
  assert.ok(back.state.known.includes("b@" + iso(T0 + 2 * POLL_MS - 1000)), "its ready tokens are now known");

  // Landmark: after the re-seed the diff is live again.
  const next = observeBoard(back.state, board(iso(T0 + 3 * POLL_MS), [entry("c", 3, iso(T0 + 3 * POLL_MS - 1000))]));
  assert.deepEqual(numbersOf(next.announce), [3]);
});

test("S9 announcer rule 5: a newly Ready token is announced once; still Ready on the next poll is silent", () => {
  const s0 = seeded([]);
  const g1 = T0 + POLL_MS;
  const ready = [entry("a", 42, iso(g1 - 1000))];
  const first = observeBoard(s0, board(iso(g1), ready));
  assert.deepEqual(first.announce, [{ key: readyKeyOf(ready[0]), number: 42 }]);

  const second = observeBoard(first.state, board(iso(g1 + POLL_MS), ready));
  assert.deepEqual(second.announce, []);
  const third = observeBoard(second.state, board(iso(g1 + 2 * POLL_MS), ready));
  assert.deepEqual(third.announce, []);
});

test("S9 announcer rule 5: Collected then Undo (the same readySince reappears) is NOT announced again", () => {
  const rs = iso(T0 + 1000);
  const x = entry("x", 5, rs);
  const s1 = observeBoard(seeded([]), board(iso(T0 + POLL_MS), [x]));
  assert.deepEqual(numbersOf(s1.announce), [5], "landmark: called the first time");

  const gone = observeBoard(s1.state, board(iso(T0 + 2 * POLL_MS), []));
  assert.deepEqual(gone.announce, []);
  const undo = observeBoard(gone.state, board(iso(T0 + 3 * POLL_MS), [x]));
  assert.deepEqual(undo.announce, []);
});

test("S9 announcer rule 5: Not ready then Ready again with a NEW readySince is announced again", () => {
  const first = observeBoard(seeded([]), board(iso(T0 + POLL_MS), [entry("x", 5, iso(T0 + 1000))]));
  assert.deepEqual(numbersOf(first.announce), [5]);

  const unready = observeBoard(first.state, board(iso(T0 + 2 * POLL_MS), [], true, [entry("x", 5)]));
  assert.deepEqual(unready.announce, []);

  const again = observeBoard(unready.state, board(iso(T0 + 3 * POLL_MS), [entry("x", 5, iso(T0 + 3 * POLL_MS - 500))]));
  assert.deepEqual(numbersOf(again.announce), [5]);
});

test("S9 announcer rule 5: a kitchen re-tap (still Ready, new readySince) is announced again", () => {
  const first = observeBoard(seeded([]), board(iso(T0 + POLL_MS), [entry("x", 5, iso(T0 + 1000))]));
  const retap = observeBoard(first.state, board(iso(T0 + 2 * POLL_MS), [entry("x", 5, iso(T0 + 2 * POLL_MS - 100))]));
  assert.deepEqual(numbersOf(retap.announce), [5]);
});

test("S9 announcer rule 5: a new round (back to Preparing, Ready later with a new readySince) is announced", () => {
  const first = observeBoard(seeded([]), board(iso(T0 + POLL_MS), [entry("x", 9, iso(T0 + 1000))]));
  assert.deepEqual(numbersOf(first.announce), [9]);
  const preparing = observeBoard(first.state, board(iso(T0 + 2 * POLL_MS), [], true, [entry("x", 9)]));
  assert.deepEqual(preparing.announce, []);
  const round2 = observeBoard(preparing.state, board(iso(T0 + 10 * POLL_MS), [entry("x", 9, iso(T0 + 10 * POLL_MS - 2000))]));
  assert.deepEqual(numbersOf(round2.announce), [9]);
});

test("S9 announcer rule 5: freshness boundary - exactly ANNOUNCE_FRESH_MS is announced, one ms older is not (but is known)", () => {
  const s0 = seeded([]);
  const g = T0 + POLL_MS;

  const atEdge = entry("edge", 1, iso(g - ANNOUNCE_FRESH_MS));
  const pastEdge = entry("old", 2, iso(g - ANNOUNCE_FRESH_MS - 1));
  const out = observeBoard(s0, board(iso(g), [atEdge, pastEdge]));
  assert.deepEqual(numbersOf(out.announce), [1], "120000 ms announced, 120001 ms not");

  assert.ok(out.state.known.includes(readyKeyOf(pastEdge)), "the stale key still becomes known");
  assert.ok(out.state.known.includes(readyKeyOf(atEdge)));

  // Not announced later either, however the board is re-polled.
  const later = observeBoard(out.state, board(iso(g + POLL_MS), [atEdge, pastEdge]));
  assert.deepEqual(later.announce, []);
});

test("S9 announcer rule 5: an unparseable readySince is announced (freshness cannot be judged)", () => {
  const s0 = seeded([]);
  const odd = entry("odd", 77, "garbage");
  const out = observeBoard(s0, board(iso(T0 + POLL_MS), [odd]));
  assert.deepEqual(out.announce, [{ key: "odd@garbage", number: 77 }]);
  assert.ok(out.state.known.includes("odd@garbage"));
});

test("S9 announcer rule 5: several new tokens are ordered by readySince ascending, then by number", () => {
  const s0 = seeded([]);
  const g = T0 + POLL_MS;
  const t1 = iso(g - 3000);
  const t2 = iso(g - 1000);
  const scrambled = [entry("a", 5, t2), entry("b", 9, t1), entry("c", 3, t1), entry("d", 2, t2)];
  const out = observeBoard(s0, board(iso(g), scrambled));
  assert.deepEqual(numbersOf(out.announce), [3, 9, 2, 5]);
  assert.deepEqual(
    out.announce.map((a) => a.key),
    [readyKeyOf(scrambled[2]), readyKeyOf(scrambled[1]), readyKeyOf(scrambled[3]), readyKeyOf(scrambled[0])],
  );
});

test("S9 announcer rule 5: known is capped at KNOWN_KEYS_MAX, keeping the newest and dropping the oldest", () => {
  const g = T0 + POLL_MS;
  const total = KNOWN_KEYS_MAX + 5;
  // Index 0 is the oldest; all inside the freshness window; the board lists them oldest first.
  const many = Array.from({ length: total }, (_, i) => entry(`id${i}`, i + 1, iso(g - (total - i))));
  const out = observeBoard(seeded([]), board(iso(g), many));
  assert.equal(out.announce.length, total, "landmark: all were new");
  assert.equal(out.state.known.length, KNOWN_KEYS_MAX);
  assert.ok(out.state.known.includes(readyKeyOf(many[total - 1])), "the newest key is kept");
  assert.ok(out.state.known.includes(readyKeyOf(many[5])), "the oldest kept key is the 6th");
  for (let i = 0; i < 5; i++) assert.ok(!out.state.known.includes(readyKeyOf(many[i])), `oldest key ${i} dropped`);
});

test("S9 announcer rule 5: a key learned earlier is the first to go when the cap is hit", () => {
  const g0 = T0;
  const old = entry("old", 1, iso(g0 - 1000));
  const s0 = seeded([old], g0);
  assert.ok(s0.known.includes(readyKeyOf(old)), "landmark: the seed knows it");

  const g = T0 + POLL_MS;
  const batch = Array.from({ length: KNOWN_KEYS_MAX }, (_, i) => entry(`n${i}`, i + 10, iso(g - (KNOWN_KEYS_MAX - i))));
  const out = observeBoard(s0, board(iso(g), batch));
  assert.equal(out.state.known.length, KNOWN_KEYS_MAX);
  assert.ok(!out.state.known.includes(readyKeyOf(old)), "the oldest-learned key was dropped");
  assert.ok(out.state.known.includes(readyKeyOf(batch[0])));
  assert.ok(out.state.known.includes(readyKeyOf(batch[KNOWN_KEYS_MAX - 1])));
});

test("S9 announcer rule 5: the new state records the instant and stays enabled/seeded", () => {
  const g = T0 + POLL_MS;
  const out = observeBoard(seeded([]), board(iso(g), [entry("a", 1, iso(g - 10))]));
  assert.equal(out.state.lastGeneratedMs, g);
  assert.equal(out.state.enabled, true);
  assert.equal(out.state.seeded, true);
});

test("S9 announcer: enqueueAnnouncements drops adds whose key is already queued", () => {
  const queue: Announcement[] = [
    { key: "a@1", number: 1 },
    { key: "b@1", number: 2 },
  ];
  const out = enqueueAnnouncements(queue, [
    { key: "b@1", number: 2 },
    { key: "c@1", number: 3 },
  ]);
  assert.deepEqual(out, [
    { key: "a@1", number: 1 },
    { key: "b@1", number: 2 },
    { key: "c@1", number: 3 },
  ]);
  assert.deepEqual(enqueueAnnouncements(queue, []), queue);
});

test("S9 announcer: enqueueAnnouncements over ANNOUNCE_QUEUE_MAX keeps the LAST ten", () => {
  const mk = (n: number): Announcement => ({ key: `k${n}@1`, number: n });
  const queue = Array.from({ length: 8 }, (_, i) => mk(i + 1));
  const add = Array.from({ length: 5 }, (_, i) => mk(i + 9)); // 9..13
  const out = enqueueAnnouncements(queue, add);
  assert.equal(out.length, ANNOUNCE_QUEUE_MAX);
  assert.deepEqual(numbersOf(out), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

  const fromEmpty = enqueueAnnouncements([], Array.from({ length: 12 }, (_, i) => mk(i + 1)));
  assert.deepEqual(numbersOf(fromEmpty), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const atCap = enqueueAnnouncements(Array.from({ length: 10 }, (_, i) => mk(i + 1)), []);
  assert.equal(atCap.length, 10, "exactly the cap is not trimmed");
});

test("S9 announcer: pruneQueue is [] when tokens are off", () => {
  const queue: Announcement[] = [{ key: "a@r", number: 1 }];
  const ready = [entry("a", 1, "r")];
  assert.deepEqual(pruneQueue(queue, board(iso(T0), ready, false)), []);
  // Landmark: the same queue and ready list survive when tokens are on.
  assert.deepEqual(pruneQueue(queue, board(iso(T0), ready, true)), queue);
});

test("S9 announcer: pruneQueue keeps only the keys still in board.ready (a collected token is never called)", () => {
  const queue: Announcement[] = [
    { key: "a@r1", number: 1 },
    { key: "b@r2", number: 2 },
    { key: "c@r3", number: 3 },
  ];
  const ready = [entry("c", 3, "r3"), entry("a", 1, "r1"), entry("b", 2, "r2-changed")];
  const out = pruneQueue(queue, board(iso(T0), ready));
  assert.deepEqual(out, [
    { key: "a@r1", number: 1 },
    { key: "c@r3", number: 3 },
  ]);
  assert.deepEqual(pruneQueue(queue, board(iso(T0), [])), []);
});

test("S9 announcer: announcementText has the exact English and Hindi strings", () => {
  assert.equal(announcementText(42, "en"), "Token number 42");
  assert.equal(announcementText(42, "hi"), "टोकन नंबर 42");
  assert.equal(announcementText(7, "en"), "Token number 7");
  assert.equal(announcementText(123456, "hi"), "टोकन नंबर 123456");
});

interface TestVoice {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}
const v = (name: string, lang: string, extra: Partial<TestVoice> = {}): TestVoice => ({ name, lang, ...extra });

test("S9 announcer pickVoice: tags are normalised (case, underscore) and en-IN is preferred over a default en-US", () => {
  const us = v("us", "en-US", { default: true });
  for (const tag of ["en-IN", "en_IN", "EN-in", "en_in"]) {
    const india = v("india", tag);
    assert.equal(pickVoice([us, india], "en"), india, `tag ${tag}`);
    assert.equal(pickVoice([india, us], "en"), india, `tag ${tag} listed first`);
  }
});

test("S9 announcer pickVoice: a default English voice beats a non-default one; a local one beats a network one", () => {
  const gb = v("gb", "en-GB");
  const usDefault = v("us", "en-US", { default: true });
  assert.equal(pickVoice([gb, usDefault], "en"), usDefault);

  const net = v("net", "en-GB");
  const local = v("local", "en-AU", { localService: true });
  assert.equal(pickVoice([net, local], "en"), local);

  // Landmark: with neither flag the first English voice still comes back (any en-*).
  const only = v("only", "en-ZA");
  assert.equal(pickVoice([only], "en"), only);
});

test("S9 announcer pickVoice: among equals the local voice wins", () => {
  const net = v("net", "en-IN", { localService: false });
  const local = v("local", "en-IN", { localService: true });
  assert.equal(pickVoice([net, local], "en"), local);
  assert.equal(pickVoice([local, net], "en"), local);

  const hiNet = v("hiNet", "hi-IN");
  const hiLocal = v("hiLocal", "hi_IN", { localService: true });
  assert.equal(pickVoice([hiNet, hiLocal], "hi"), hiLocal);
});

test("S9 announcer pickVoice: Hindi prefers hi-IN, then any hi-*", () => {
  const other = v("other", "hi-XX");
  const india = v("india", "HI_in");
  assert.equal(pickVoice([other, india], "hi"), india);
  assert.equal(pickVoice([other], "hi"), other);
  assert.equal(pickVoice([v("en", "en-IN", { default: true }), other], "hi"), other, "an English default never outranks Hindi");
});

test("S9 announcer pickVoice: never another language, and an empty list is null", () => {
  const fr = v("fr", "fr-FR", { default: true });
  const de = v("de", "de-DE", { localService: true });
  assert.equal(pickVoice([fr, de], "en"), null);
  assert.equal(pickVoice([fr, de], "hi"), null);
  assert.equal(pickVoice([v("en", "en-US")], "hi"), null);
  assert.equal(pickVoice([v("hi", "hi-IN")], "en"), null);
  assert.equal(pickVoice([], "en"), null);
  assert.equal(pickVoice([], "hi"), null);
  // Landmark: with one matching voice in the mix, it is the one returned.
  const en = v("en", "en-GB");
  assert.equal(pickVoice([fr, en, de], "en"), en);
});

test("S9 announcer voiceNoticeOf: null unless the voice is wanted and the status is missing or unsupported", () => {
  for (const status of ["checking", "ready", "missing", "unsupported"] as const) {
    assert.equal(voiceNoticeOf(status, "en", false), null, `voice off, ${status}`);
    assert.equal(voiceNoticeOf(status, "hi", false), null, `voice off, ${status}`);
  }
  for (const language of ["en", "hi"] as const) {
    assert.equal(voiceNoticeOf("checking", language, true), null);
    assert.equal(voiceNoticeOf("ready", language, true), null);
  }
});

test("S9 announcer voiceNoticeOf: the exact notices", () => {
  assert.equal(voiceNoticeOf("unsupported", "en", true), "This screen cannot speak, so it plays only the chime.");
  assert.equal(voiceNoticeOf("unsupported", "hi", true), "This screen cannot speak, so it plays only the chime.");
  assert.equal(voiceNoticeOf("missing", "en", true), "This device has no English voice, so it plays only the chime.");
  assert.equal(voiceNoticeOf("missing", "hi", true), "This device has no Hindi voice, so it plays only the chime.");
});
