import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildKitchenCards,
  readyToastMessage,
  KITCHEN_CARD_LIMIT,
  type KitchenOrderCard,
} from "./kitchen-cards";
import {
  buildKitchenRows,
  kitchenAgeBand,
  KITCHEN_ROW_LIMIT,
  type FiredItem,
  type KitchenOrderInput,
} from "./kitchen-board";

// P4-B — the order-CARD builder, DB-free. buildKitchenRows collapses items
// into lines; buildKitchenCards groups those lines by order, applies the
// lost-ticket "Ready" filter, and re-sorts by the card's own FIFO instant.
// This file is the entire behavioural proof for that grouping + filter layer.

const PRODUCT_A = "1".repeat(24);
const NOW = new Date("2026-09-23T12:00:00.000Z");

function firedItem(over: Partial<FiredItem> = {}): FiredItem {
  return {
    productId: PRODUCT_A,
    name: "Masala Chai",
    qty: 1,
    kotRound: 1,
    ...over,
  };
}

function order(over: Partial<KitchenOrderInput> = {}): KitchenOrderInput {
  return {
    _id: "a".repeat(24),
    orderId: "ORD-20260923-001",
    items: [firedItem()],
    createdAt: NOW,
    ...over,
  };
}

// ── C1 — grouping ────────────────────────────────────────────────────────────

test("C1: three orders group into three cards; lines.length correct per card; no line shared across cards; totalCount/doneCount/allDone correct", () => {
  const ord1 = order({
    _id: "1".repeat(24),
    orderId: "ORD-1",
    items: [firedItem({ instructions: "a" }), firedItem({ instructions: "b" })],
    kotFiredAt: [new Date("2026-09-23T10:00:00.000Z")],
  });
  const ord2 = order({
    _id: "2".repeat(24),
    orderId: "ORD-2",
    items: [firedItem({ instructions: "c" })],
    kotFiredAt: [new Date("2026-09-23T10:05:00.000Z")],
  });
  const ord3 = order({
    _id: "3".repeat(24),
    orderId: "ORD-3",
    items: [firedItem({ instructions: "d" }), firedItem({ instructions: "e" }), firedItem({ instructions: "f" })],
    kotFiredAt: [new Date("2026-09-23T10:10:00.000Z")],
  });

  const cards = buildKitchenCards({
    orders: [ord1, ord2, ord3],
    ticksByOrder: {},
  });

  assert.equal(cards.length, 3, "exactly three cards, one per order");

  const card1 = cards.find((c) => c.orderId === String(ord1._id));
  const card2 = cards.find((c) => c.orderId === String(ord2._id));
  const card3 = cards.find((c) => c.orderId === String(ord3._id));
  assert.ok(card1 && card2 && card3, "all three cards must be found");

  assert.equal(card1!.lines.length, 2, "card1 must carry exactly its own 2 lines");
  assert.equal(card2!.lines.length, 1, "card2 must carry exactly its own 1 line");
  assert.equal(card3!.lines.length, 3, "card3 must carry exactly its own 3 lines");

  // No line appears in two cards: every row id across all cards is unique,
  // and every row's orderId matches the card it landed on.
  const allIds = cards.flatMap((c) => c.lines.map((l) => l.id));
  assert.equal(new Set(allIds).size, allIds.length, "no line id may repeat across cards");
  for (const card of cards) {
    for (const line of card.lines) {
      assert.equal(line.orderId, card.orderId, "every line on a card must belong to that card's order");
    }
  }

  assert.equal(card1!.totalCount, 2);
  assert.equal(card1!.doneCount, 0, "nothing ticked yet");
  assert.equal(card1!.allDone, false);
  assert.equal(card3!.totalCount, 3);
  assert.equal(card3!.doneCount, 0);
  assert.equal(card3!.allDone, false);
});

// ── C2 — FIFO ordering, full positions + count + tie-break ──────────────────

test("C2: cards sort oldest-first by cardFiredAt — full index positions AND cards.length asserted", () => {
  const oldest = order({
    _id: "1".repeat(24),
    orderId: "ORD-OLD",
    kotFiredAt: [new Date("2026-09-23T09:00:00.000Z")],
    createdAt: new Date("2026-09-23T09:00:00.000Z"),
  });
  const middle = order({
    _id: "2".repeat(24),
    orderId: "ORD-MID",
    kotFiredAt: [new Date("2026-09-23T10:00:00.000Z")],
    createdAt: new Date("2026-09-23T10:00:00.000Z"),
  });
  const newest = order({
    _id: "3".repeat(24),
    orderId: "ORD-NEW",
    kotFiredAt: [new Date("2026-09-23T11:00:00.000Z")],
    createdAt: new Date("2026-09-23T11:00:00.000Z"),
  });

  const cards = buildKitchenCards({ orders: [newest, oldest, middle], ticksByOrder: {} });

  assert.equal(cards.length, 3, "exactly three cards — an ordering pin without a count can pass vacuously");
  assert.equal(cards[0].orderId, String(oldest._id), "index 0 must be the oldest card");
  assert.equal(cards[1].orderId, String(middle._id), "index 1 must be the middle-aged card");
  assert.equal(cards[2].orderId, String(newest._id), "index 2 must be the newest card");
});

test("C2b: identical fire instants tie-break by orderId, deterministically", () => {
  const sameTime = new Date("2026-09-23T10:00:00.000Z");
  const ordZ = order({ _id: "9".repeat(24), orderId: "ORD-Z", kotFiredAt: [sameTime], createdAt: sameTime });
  const ordA = order({ _id: "1".repeat(24), orderId: "ORD-A", kotFiredAt: [sameTime], createdAt: sameTime });

  const cards = buildKitchenCards({ orders: [ordZ, ordA], ticksByOrder: {} });

  assert.equal(cards.length, 2);
  assert.equal(cards[0].orderId, String(ordA._id), "lexicographically smaller orderId must sort first on a tie");
  assert.equal(cards[1].orderId, String(ordZ._id));
});

// ── C3 — cardFiredAt = MIN over NOT-DONE lines; all-done fallback ───────────

test("C3: a card whose round-1 line is done and round-2 is open sorts by ROUND 2's (later) fire time", () => {
  const round1FiredAt = new Date("2026-09-23T08:00:00.000Z"); // earliest overall
  const round2FiredAt = new Date("2026-09-23T11:00:00.000Z");

  const target = order({
    _id: "1".repeat(24),
    orderId: "ORD-TARGET",
    items: [firedItem({ kotRound: 1, instructions: "r1" }), firedItem({ kotRound: 2, instructions: "r2" })],
    kotFiredAt: [round1FiredAt, round2FiredAt],
  });
  // A sibling order fired strictly between round1 and round2 — if target's
  // cardFiredAt fell back to round1 (the done line), target would sort BEFORE
  // this sibling; if it correctly uses round2 (the only open line), target
  // sorts AFTER it.
  const sibling = order({
    _id: "2".repeat(24),
    orderId: "ORD-SIBLING",
    kotFiredAt: [new Date("2026-09-23T09:30:00.000Z")],
    createdAt: new Date("2026-09-23T09:30:00.000Z"),
  });

  // Discover round-1's real kotLineRef by building rows once, unticked.
  const bareRows = buildKitchenRows({ orders: [target], ticksByOrder: {} });
  const round1Row = bareRows.find((r) => r.round === 1);
  assert.ok(round1Row, "round 1 row must exist in the bare build");

  const cards = buildKitchenCards({
    orders: [target, sibling],
    ticksByOrder: { [String(target._id)]: [round1Row!.ref] },
  });

  assert.equal(cards.length, 2, "exactly two cards");
  assert.equal(cards[0].orderId, String(sibling._id), "sibling (fired between the two rounds) must sort FIRST");
  assert.equal(cards[1].orderId, String(target._id), "target must sort AFTER the sibling — its cardFiredAt is round 2's time, not round 1's");
  assert.equal(cards[1].cardFiredAt, round2FiredAt.toISOString(), "cardFiredAt must be round 2's stamp, the only NOT-done line");
});

test("C3b: when EVERY line is done, cardFiredAt falls back to MIN over all lines — the card does not jump to the end of the queue", () => {
  const round1FiredAt = new Date("2026-09-23T08:00:00.000Z");
  const round2FiredAt = new Date("2026-09-23T11:00:00.000Z");

  const target = order({
    _id: "1".repeat(24),
    orderId: "ORD-TARGET",
    items: [firedItem({ kotRound: 1, instructions: "r1" }), firedItem({ kotRound: 2, instructions: "r2" })],
    kotFiredAt: [round1FiredAt, round2FiredAt],
  });
  // A sibling fired AFTER round2 (the latest line on target) — if the
  // all-done fallback used "now" or the newest line, target would wrongly
  // sort after this sibling; the fallback must still be round1 (the MIN over
  // ALL lines), keeping target ahead of a genuinely-newer sibling.
  const sibling = order({
    _id: "2".repeat(24),
    orderId: "ORD-SIBLING",
    kotFiredAt: [new Date("2026-09-23T11:30:00.000Z")],
    createdAt: new Date("2026-09-23T11:30:00.000Z"),
  });

  const bareRows = buildKitchenRows({ orders: [target], ticksByOrder: {} });
  const round1Row = bareRows.find((r) => r.round === 1);
  const round2Row = bareRows.find((r) => r.round === 2);
  assert.ok(round1Row && round2Row);

  const cards = buildKitchenCards({
    orders: [target, sibling],
    ticksByOrder: { [String(target._id)]: [round1Row!.ref, round2Row!.ref] }, // both ticked -> allDone
  });

  assert.equal(cards.length, 2);
  const targetCard = cards.find((c) => c.orderId === String(target._id));
  assert.ok(targetCard, "the all-done card must still be present");
  assert.equal(targetCard!.allDone, true);
  assert.equal(targetCard!.cardFiredAt, round1FiredAt.toISOString(), "all-done fallback must be MIN over ALL lines (round 1), not round 2 or now");
  assert.equal(cards[0].orderId, String(target._id), "target (oldest overall fire) must sort FIRST, not jump to the end");
  assert.equal(cards[1].orderId, String(sibling._id));
});

// ── C4 — THE HEADLINE: an all-ticked card is STILL PRESENT ─────────────────

test("C4: a card with EVERY line ticked is still present, with allDone === true (old code would have dropped it)", () => {
  const ord = order({
    items: [firedItem({ instructions: "a" }), firedItem({ instructions: "b" })],
    kotFiredAt: [new Date("2026-09-23T10:00:00.000Z")],
  });
  const bareRows = buildKitchenRows({ orders: [ord], ticksByOrder: {} });
  assert.equal(bareRows.length, 2);
  const refs = bareRows.map((r) => r.ref);

  const cards = buildKitchenCards({ orders: [ord], ticksByOrder: { [String(ord._id)]: refs } });

  assert.equal(cards.length, 1, "the card must still be present — against the old code this would have been 0");
  assert.equal(cards[0].allDone, true);
  assert.equal(cards[0].doneCount, 2);
  assert.equal(cards[0].totalCount, 2);
});

// ── C5 — THE LOST-TICKET RULE ───────────────────────────────────────────────

test("C5a: readyAt AFTER the only fired round hides the card", () => {
  // createdAt must be AT OR BEFORE the fired round: newestFiredAtMs falls
  // back to createdAt when it is the LATER of the two (a real hazard for a
  // careless fixture, since order()'s default createdAt is NOW/12:00 —
  // later than every stamp used here).
  const firedAt = new Date("2026-09-23T10:00:00.000Z");
  const ord = order({ kotFiredAt: [firedAt], createdAt: firedAt });
  const readyAt = new Date("2026-09-23T10:05:00.000Z"); // after the only round

  const cards = buildKitchenCards({
    orders: [ord],
    ticksByOrder: {},
    readyAtByOrder: { [String(ord._id)]: readyAt },
  });

  assert.equal(cards.length, 0, "the card must be hidden — readyAt covers the only fired round");
});

test("C5b: readyAt, then a LATER round fired — the card COMES BACK and includes the new round's line", () => {
  const round1FiredAt = new Date("2026-09-23T10:00:00.000Z");
  const readyAt = new Date("2026-09-23T10:05:00.000Z"); // after round 1
  const round2FiredAt = new Date("2026-09-23T10:10:00.000Z"); // AFTER readyAt

  const ord = order({
    items: [firedItem({ kotRound: 1, instructions: "r1" }), firedItem({ kotRound: 2, instructions: "r2" })],
    kotFiredAt: [round1FiredAt, round2FiredAt],
    createdAt: round1FiredAt, // must not outrank round1/round2 in newestFiredAtMs
  });

  const cards = buildKitchenCards({
    orders: [ord],
    ticksByOrder: {},
    readyAtByOrder: { [String(ord._id)]: readyAt },
  });

  assert.equal(cards.length, 1, "the card must be back — round 2 fired after the ready stamp");
  assert.equal(cards[0].totalCount, 2, "both rounds' lines must be present, including the new round's");
  const round2Line = cards[0].lines.find((l) => l.round === 2);
  assert.ok(round2Line, "the new round's line must be among the card's lines");
});

test("C5c: readyAt absent/undefined leaves the card present", () => {
  const firedAt = new Date("2026-09-23T10:00:00.000Z");
  const ord = order({ kotFiredAt: [firedAt], createdAt: firedAt });

  const cardsNoKey = buildKitchenCards({ orders: [ord], ticksByOrder: {} }); // readyAtByOrder omitted entirely
  assert.equal(cardsNoKey.length, 1, "omitting readyAtByOrder must leave the card present");

  const cardsUndefined = buildKitchenCards({
    orders: [ord],
    ticksByOrder: {},
    readyAtByOrder: { [String(ord._id)]: undefined },
  });
  assert.equal(cardsUndefined.length, 1, "an explicit undefined readyAt must leave the card present");
});

test("C5d: an unparseable readyAt never hides work — the card stays present", () => {
  const firedAt = new Date("2026-09-23T10:00:00.000Z");
  const ord = order({ kotFiredAt: [firedAt], createdAt: firedAt });

  const cards = buildKitchenCards({
    orders: [ord],
    ticksByOrder: {},
    readyAtByOrder: { [String(ord._id)]: "not-a-real-date" },
  });

  assert.equal(cards.length, 1, "an unparseable stamp must never hide real work");
});

test("C5e: a sibling order without readyAt is unaffected in every (a)-(d) case above — the filter is per-order, not global", () => {
  const makeSibling = (id: string) =>
    order({ _id: id.repeat(24), orderId: `ORD-SIB-${id}`, kotFiredAt: [new Date("2026-09-23T09:00:00.000Z")] });

  // (a) hidden target + sibling
  {
    const firedAt = new Date("2026-09-23T10:00:00.000Z");
    const target = order({ _id: "1".repeat(24), kotFiredAt: [firedAt], createdAt: firedAt });
    const sibling = makeSibling("2");
    const cards = buildKitchenCards({
      orders: [target, sibling],
      ticksByOrder: {},
      readyAtByOrder: { [String(target._id)]: new Date("2026-09-23T10:05:00.000Z") },
    });
    assert.equal(cards.length, 1, "(a) only the sibling must remain");
    assert.equal(cards[0].orderId, String(sibling._id));
  }

  // (b) lost-ticket recovery target + sibling — sibling untouched
  {
    const round1 = new Date("2026-09-23T10:00:00.000Z");
    const ready = new Date("2026-09-23T10:05:00.000Z");
    const round2 = new Date("2026-09-23T10:10:00.000Z");
    const target = order({
      _id: "3".repeat(24),
      items: [firedItem({ kotRound: 1, instructions: "r1" }), firedItem({ kotRound: 2, instructions: "r2" })],
      kotFiredAt: [round1, round2],
      createdAt: round1,
    });
    const sibling = makeSibling("4");
    const cards = buildKitchenCards({
      orders: [target, sibling],
      ticksByOrder: {},
      readyAtByOrder: { [String(target._id)]: ready },
    });
    assert.equal(cards.length, 2, "(b) both target (recovered) and sibling must be present");
    assert.ok(cards.some((c) => c.orderId === String(sibling._id)), "(b) sibling must be unaffected");
  }

  // (c) readyAt absent on target, sibling present regardless
  {
    const firedAt = new Date("2026-09-23T10:00:00.000Z");
    const target = order({ _id: "5".repeat(24), kotFiredAt: [firedAt], createdAt: firedAt });
    const sibling = makeSibling("6");
    const cards = buildKitchenCards({ orders: [target, sibling], ticksByOrder: {} });
    assert.equal(cards.length, 2, "(c) both present");
  }

  // (d) unparseable readyAt on target, sibling unaffected
  {
    const firedAt = new Date("2026-09-23T10:00:00.000Z");
    const target = order({ _id: "7".repeat(24), kotFiredAt: [firedAt], createdAt: firedAt });
    const sibling = makeSibling("8");
    const cards = buildKitchenCards({
      orders: [target, sibling],
      ticksByOrder: {},
      readyAtByOrder: { [String(target._id)]: "garbage" },
    });
    assert.equal(cards.length, 2, "(d) both present — sibling never touched by target's bad stamp");
  }
});

// ── C6 — row-cap interaction ─────────────────────────────────────────────────
//
// MEASURED against the actual source (not the doc comment's stated intent):
// buildKitchenCards' guard is `if (!lines || lines.length === 0) continue` —
// it only drops an order whose lines were cut to ZERO. A order whose lines
// were cut PARTIALLY (some rows survive the row cap, some don't) is NOT
// dropped: it is built with `totalCount` equal to the SURVIVING line count,
// which understates the true fired count. This contradicts the header
// comment's claim ("drop any order whose lines did not all survive... a card
// with a wrong count is not [visibly missing]"). Fixture below isolates the
// row-level cap (KITCHEN_ROW_LIMIT=200) from the card-level cap
// (KITCHEN_CARD_LIMIT=60) by keeping total card count at 10 — well under 60 —
// so only the row cap can be responsible for what is observed.
test("C6: the card view opts OUT of the row cap, so no card can ever undercount its own order (a LINE cap can split an order; a CARD cap cannot)", () => {
  const fillerOrders = 9;
  const linesPerFiller = 22; // 9 * 22 = 198 filler rows
  const fillers: KitchenOrderInput[] = Array.from({ length: fillerOrders }, (_, i) =>
    order({
      _id: String(i + 1).padStart(24, "0"),
      orderId: `ORD-FILL-${i}`,
      items: Array.from({ length: linesPerFiller }, (_, j) => firedItem({ instructions: `f${i}-${j}` })),
      kotFiredAt: [new Date(NOW.getTime() - (1000 - i) * 60_000)], // strictly older than target
      createdAt: NOW,
    }),
  );
  const target = order({
    _id: "f".repeat(24),
    orderId: "ORD-TARGET",
    items: [
      firedItem({ instructions: "x1" }),
      firedItem({ instructions: "x2" }),
      firedItem({ instructions: "x3" }),
    ],
    kotFiredAt: [new Date(NOW.getTime() - 1 * 60_000)], // newest -> sorts last, straddling the row cap
    createdAt: NOW,
  });

  const orders = [...fillers, target];

  // PRECONDITION — prove this fixture really does straddle the row cap, so a
  // green result below means "the card view is immune", never "the fixture
  // never triggered the cap". Capped (the LINE view's shipped behaviour) cuts
  // the target to 2 of its 3 lines.
  const cappedRows = buildKitchenRows({ orders, ticksByOrder: {} });
  assert.equal(cappedRows.length, KITCHEN_ROW_LIMIT, "row cap must be in effect for the line view");
  const cappedTarget = cappedRows.filter((r) => r.orderId === String(target._id));
  assert.equal(cappedTarget.length, 2, "precondition: the cap must genuinely cut the target order in HALF (2 of 3)");

  // THE RULE: the card builder opts out (capRows:false), so the order arrives
  // whole. An undercounting card is worse than a missing one AND worse than a
  // long board: it tells a cook the order is 2 dishes when 3 were fired, and
  // the third is never cooked with nothing to show it was dropped.
  const cards = buildKitchenCards({ orders, ticksByOrder: {} });
  assert.ok(
    cards.length < KITCHEN_CARD_LIMIT,
    "sanity: stay under the CARD cap, so this test isolates the ROW cap",
  );

  const targetCard = cards.find((c) => c.orderId === String(target._id));
  assert.ok(targetCard, "the partially-cut order must still produce a card");
  assert.equal(
    targetCard!.totalCount,
    3,
    "the card must carry ALL 3 fired lines — never the 2 that survived a line-level cut",
  );
  assert.equal(targetCard!.lines.length, 3, "and its lines array must match that count");
});

// ── C7 — wire round-trip (twin of pin 3c) ───────────────────────────────────

test("C7: JSON.parse(JSON.stringify(card)) keeps cardFiredAt a string, and kitchenAgeBand still works post-wire", () => {
  const stampedAt = new Date("2026-09-23T11:50:00.000Z");
  const cards = buildKitchenCards({
    orders: [order({ kotFiredAt: [stampedAt] })],
    ticksByOrder: {},
  });
  assert.equal(cards.length, 1);

  // Exactly what NextResponse.json + res.json() do to the payload.
  const overTheWire = JSON.parse(JSON.stringify(cards)) as typeof cards;
  const card = overTheWire[0];

  assert.equal(typeof card.cardFiredAt, "string", "cardFiredAt must cross the wire as a string, never a Date");
  assert.equal(card.cardFiredAt, stampedAt.toISOString());

  const band = kitchenAgeBand(card.cardFiredAt, NOW);
  assert.equal(band.key, "warn", "10m old must band as warn, computed from the wire value");
});

// ── C8 — parcel channel, independent of tableLabel ──────────────────────────

test("C8: parcel:true produces card.parcel === true; without it, false — independent of tableLabel (a parcel order and a dine-in walk-in both lack a table)", () => {
  const parcelOrder = order({
    _id: "1".repeat(24),
    orderId: "ORD-PARCEL",
    parcel: true,
    tableNo: undefined,
    kotFiredAt: [new Date("2026-09-23T10:00:00.000Z")],
  });
  const walkInOrder = order({
    _id: "2".repeat(24),
    orderId: "ORD-WALKIN",
    parcel: false,
    tableNo: undefined,
    kotFiredAt: [new Date("2026-09-23T10:05:00.000Z")],
  });

  const cards = buildKitchenCards({ orders: [parcelOrder, walkInOrder], ticksByOrder: {} });
  const parcelCard = cards.find((c) => c.orderId === String(parcelOrder._id));
  const walkInCard = cards.find((c) => c.orderId === String(walkInOrder._id));
  assert.ok(parcelCard && walkInCard);

  assert.equal(parcelCard!.parcel, true, "parcel:true must produce card.parcel === true");
  assert.equal(walkInCard!.parcel, false, "no parcel flag must produce card.parcel === false");

  assert.equal(parcelCard!.tableLabel, "Walk-In", "a parcel order also has no table");
  assert.equal(walkInCard!.tableLabel, "Walk-In", "a dine-in walk-in has no table either");
  assert.equal(parcelCard!.tableLabel, walkInCard!.tableLabel, "both share the SAME tableLabel — parcel must be a distinct channel, never inferred from a missing table");
});

test("C8b: parcel absent on the order (undefined) defaults card.parcel to false", () => {
  const ord = order({ parcel: undefined, kotFiredAt: [new Date("2026-09-23T10:00:00.000Z")] });
  const cards = buildKitchenCards({ orders: [ord], ticksByOrder: {} });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].parcel, false, "an order with no parcel field at all must default card.parcel to false, not undefined");
});

// ── readyToastMessage (owner decision 2026-09-26: Ready no longer needs ticks) ──

const cardFor = (over: Partial<KitchenOrderCard>): KitchenOrderCard => ({
  orderId: "o1",
  orderNo: "ORD-1",
  tableLabel: "T-3",
  parcel: false,
  selfOrder: false,
  ticketNumbers: [],
  lines: [],
  doneCount: 0,
  totalCount: 0,
  allDone: false,
  cardFiredAt: "2026-09-26T10:00:00.000Z",
  cardFiredAtApprox: false,
  ...over,
});

test("R1: a fully-ticked card's toast does NOT mention unticked lines", () => {
  const msg = readyToastMessage(cardFor({ doneCount: 3, totalCount: 3, allDone: true }));
  assert.equal(msg, "T-3 marked ready");
  assert.ok(!/not ticked/.test(msg), "a finished card must not claim anything was skipped");
});

test("R2: a part-done card's toast names how many lines were NOT ticked", () => {
  const msg = readyToastMessage(cardFor({ doneCount: 1, totalCount: 4 }));
  assert.equal(msg, "T-3 marked ready — 3 lines not ticked");
});

test("R3: singular for exactly one unticked line", () => {
  const msg = readyToastMessage(cardFor({ doneCount: 2, totalCount: 3 }));
  assert.equal(msg, "T-3 marked ready — 1 line not ticked", "must read '1 line', never '1 lines'");
});

test("R4: falls back to the order number when there is no table label (parcel / walk-in)", () => {
  const msg = readyToastMessage(
    cardFor({ tableLabel: "", orderNo: "ORD-9", doneCount: 0, totalCount: 2 }),
  );
  assert.equal(msg, "ORD-9 marked ready — 2 lines not ticked");
});

test("R5: a zero-line card cannot produce a negative or '0 lines' message", () => {
  assert.equal(readyToastMessage(cardFor({ doneCount: 0, totalCount: 0 })), "T-3 marked ready");
  // Defensive: doneCount > totalCount must not yield "-1 lines not ticked".
  assert.equal(readyToastMessage(cardFor({ doneCount: 5, totalCount: 3 })), "T-3 marked ready");
});
