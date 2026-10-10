/**
 * Cases (part 2) for verify-expenses-live.ts (Step EXP): the report totals,
 * admin edit (CAS on updatedAt, before-values trail, omit-empty note, Int32
 * `$type`), soft delete, and the category rules (case-variant duplicate, hide /
 * show as $unset, the cap). Continues from the dataset part 1 seeded:
 *
 *   a staff  today  Ingredients  45050 cash      e admin  d1  Gas          30000 card
 *   b admin  today  Gas         100000 upi       f admin  d2  Ingredients  12345 cash
 *   c staff  d1     Ingredients  20000 cash      g admin  today  Other      7777 upi (Other is HIDDEN)
 *   d admin  d2     Rent        500000 bank      h deleted raw row (999) — never counts
 *
 * Every expected number is a hand-added integer, never read back from the code
 * under test.
 */
import { EXPENSE_CATEGORY_DUPLICATE_ERROR, EXPENSE_CATEGORY_HIDDEN_ERROR, EXPENSE_CATEGORY_LIMIT_ERROR } from "@/lib/expenses/categories";
import { EXPENSE_ALREADY_SAVED_ERROR, EXPENSE_CHANGED_ERROR, EXPENSE_DELETED_ERROR } from "@/lib/expenses/entries-write";
import { EXPENSE_FUTURE_DATE_ERROR } from "@/lib/expenses/entries";
import { addDays } from "@/lib/dashboard/range";
import { EXPENSE_CATEGORIES_MAX } from "@pos/shared/expense";
import {
  ADMIN_NAME,
  GHOST,
  categoriesCol,
  dataOf,
  expenseBody,
  expensesCol,
  idsOf,
  listRows,
  oid,
  same,
  storedCategory,
  storedExpense,
  type Body,
  type Ctx,
  type Harness,
} from "./verify-expenses-live-cases";

const STALE_AT = "2020-01-01T00:00:00.000Z";

export async function runEditCases(h: Harness, ctx: Ctx): Promise<void> {
  const { check } = h;
  const { cats, today, d1, d2, id } = ctx;
  h.setRole("admin");
  const range = `from=${d2}&to=${today}`;

  // The updatedAt the admin would SEE, taken through the real list DTO.
  async function fresh(expenseId: string): Promise<string> {
    const rows = listRows(await h.expenses.get(`?${range}`));
    return String(rows.find((r) => r.id === expenseId)?.updatedAt);
  }
  const edits = async (expenseId: string): Promise<Body[]> => ((await storedExpense(expenseId))?.edits ?? []) as Body[];

  // ── report totals (BEFORE any edit / delete) ──────────────────────────────
  const rep = await h.report.get(`?${range}`);
  const r = dataOf(rep);
  const cat = (r.byCategory as Body[] | undefined) ?? [];
  const day = (r.byDay as Body[] | undefined) ?? [];
  const mode = (r.byMode as Body[] | undefined) ?? [];
  check("report: total 715172 over 7 expenses (the deleted row and the 366-day-old row excluded)", rep.status === 200 && r.totalPaise === 715172 && r.count === 7, rep);
  check(
    "report byCategory = Rent 500000, Gas 130000, Ingredients 77395, Other 7777 (hidden), largest first",
    same(cat.map((c) => [c.name, c.totalPaise, c.count, c.hidden]), [
      ["Rent", 500000, 1, false],
      ["Gas", 130000, 2, false],
      ["Ingredients", 77395, 3, false],
      ["Other", 7777, 1, true],
    ]),
    rep,
  );
  check(
    "report byDay (oldest first) = d2 512345 (2), d1 50000 (2), today 152827 (3)",
    same(day.map((x) => [x.date, x.totalPaise, x.count]), [[d2, 512345, 2], [d1, 50000, 2], [today, 152827, 3]]),
    rep,
  );
  check(
    "report byMode (cash, upi, card, bank order) = 77395 (3), 107777 (2), 30000 (1), 500000 (1)",
    same(mode.map((x) => [x.mode, x.totalPaise, x.count]), [["cash", 77395, 3], ["upi", 107777, 2], ["card", 30000, 1], ["bank", 500000, 1]]),
    rep,
  );
  const badRepRange = await h.report.get(`?from=${today}&to=${d2}`);
  check("report with from after to -> 400", badRepRange.status === 400, badRepRange);

  // ── edit: CAS on updatedAt, before-values trail ───────────────────────────
  const u1 = await fresh(id.a);
  const stale = await h.expenses.patch(id.a, { amountPaise: 50000, expectedUpdatedAt: STALE_AT });
  const afterStale = await storedExpense(id.a);
  check(
    "PATCH with a stale expectedUpdatedAt -> 409, row untouched (amount 45050, no edits)",
    stale.status === 409 && stale.body.error === EXPENSE_CHANGED_ERROR && afterStale?.amountPaise === 45050 && !("edits" in (afterStale ?? {})),
    stale,
  );
  const ok1 = await h.expenses.patch(id.a, { name: "Milk x2", amountPaise: 50000, note: "two cartons", expectedUpdatedAt: u1 });
  const trail = await edits(id.a);
  const before = trail[0] ?? {};
  check(
    "PATCH with the fresh expectedUpdatedAt -> 200: new values on the wire, edited:true",
    ok1.status === 200 && dataOf(ok1).amountPaise === 50000 && dataOf(ok1).name === "Milk x2" && dataOf(ok1).note === "two cartons" && dataOf(ok1).edited === true,
    ok1,
  );
  check(
    "raw edits[0] holds the BEFORE values (Milk / 45050 / cash / today / Ingredients, by the admin, no note), and createdBy is unchanged",
    trail.length === 1 &&
      before.name === "Milk" &&
      before.amountPaise === 45050 &&
      before.paymentMode === "cash" &&
      before.date === today &&
      String(before.categoryId) === cats[0] &&
      before.by === ADMIN_NAME &&
      before.at instanceof Date &&
      !("note" in before) &&
      (await storedExpense(id.a))?.createdBy !== ADMIN_NAME,
  );
  const typed = await expensesCol().countDocuments({ _id: oid(id.a), amountPaise: { $type: "int" }, "edits.0.amountPaise": { $type: "int" } });
  const createdTyped = await expensesCol().countDocuments({ _id: oid(id.e), amountPaise: { $type: "int" } });
  check("raw $type: amountPaise is BSON int on the edited row AND edits[0].amountPaise is int; a route-created row is int too", typed === 1 && createdTyped === 1);
  const replayStale = await h.expenses.patch(id.a, { amountPaise: 60000, expectedUpdatedAt: u1 });
  check("a second editor still holding the OLD updatedAt loses -> 409, no second trail entry", replayStale.status === 409 && (await edits(id.a)).length === 1 && (await storedExpense(id.a))?.amountPaise === 50000, replayStale);

  const u2 = await fresh(id.a);
  const clear = await h.expenses.patch(id.a, { note: "", expectedUpdatedAt: u2 });
  const afterClear = await storedExpense(id.a);
  const trail2 = await edits(id.a);
  check(
    'PATCH note "" -> 200 and the raw doc has NO note key (not ""), edits[1] holds the old note',
    clear.status === 200 && !("note" in (afterClear ?? {})) && !("note" in dataOf(clear)) && trail2.length === 2 && trail2[1]?.note === "two cartons" && trail2[1]?.amountPaise === 50000,
    clear,
  );
  const u3 = await fresh(id.a);
  const noop = await h.expenses.patch(id.a, { amountPaise: 50000, expectedUpdatedAt: u3 });
  check("a PATCH that changes nothing -> 200 and pushes NO trail entry (still 2)", noop.status === 200 && (await edits(id.a)).length === 2, noop);
  const empty = await h.expenses.patch(id.a, { expectedUpdatedAt: u3 });
  check("PATCH with only expectedUpdatedAt -> 400 (Nothing to change)", empty.status === 400, empty);
  const futureEdit = await h.expenses.patch(id.a, { date: addDays(today, 1), expectedUpdatedAt: u3 });
  check("PATCH a CHANGED date into the future -> 400, row date unchanged", futureEdit.status === 400 && futureEdit.body.error === EXPENSE_FUTURE_DATE_ERROR && (await storedExpense(id.a))?.date === today, futureEdit);
  const badId = await h.expenses.patch("not-an-id", { amountPaise: 1, expectedUpdatedAt: u3 });
  const ghostId = await h.expenses.patch(GHOST, { amountPaise: 1, expectedUpdatedAt: u3 });
  check("PATCH an invalid id -> 404; a valid id nobody has -> 404", badId.status === 404 && ghostId.status === 404, ghostId);

  // ── hidden category: kept is fine, newly picked is refused ────────────────
  const ug = await fresh(id.g);
  const keepHidden = await h.expenses.patch(id.g, { categoryId: cats[7], amountPaise: 8000, expectedUpdatedAt: ug });
  const trailG = await edits(id.g);
  check(
    "PATCH that KEEPS a now-hidden category but changes the amount -> 200 (amount 8000, trail holds 7777)",
    keepHidden.status === 200 && dataOf(keepHidden).amountPaise === 8000 && trailG.length === 1 && trailG[0]?.amountPaise === 7777 && String(trailG[0]?.categoryId) === cats[7],
    keepHidden,
  );
  const ub = await fresh(id.b);
  const toHidden = await h.expenses.patch(id.b, { categoryId: cats[7], expectedUpdatedAt: ub });
  check(
    "PATCH that MOVES a row INTO the hidden category -> 400 (hidden copy), row untouched",
    toHidden.status === 400 && toHidden.body.error === EXPENSE_CATEGORY_HIDDEN_ERROR && String((await storedExpense(id.b))?.categoryId) === cats[1] && (await edits(id.b)).length === 0,
    toHidden,
  );
  const toGhost = await h.expenses.patch(id.b, { categoryId: GHOST, expectedUpdatedAt: ub });
  check("PATCH into an unknown category -> 400", toGhost.status === 400, toGhost);

  // ── soft delete ───────────────────────────────────────────────────────────
  const del = await h.expenses.del(id.d);
  const gone = await storedExpense(id.d);
  check(
    "admin DELETE -> 200 {deleted:true}; the row still exists raw with deletedAt (Date) and deletedBy",
    del.status === 200 && dataOf(del).deleted === true && gone !== null && gone.deletedAt instanceof Date && gone.deletedBy === ADMIN_NAME,
    del,
  );
  const afterDel = await h.expenses.get(`?${range}`);
  check(
    "deleted row is gone from the list: 6 rows, count 6, total 220345 (a 50000 + b 100000 + c 20000 + e 30000 + f 12345 + g 8000)",
    !idsOf(afterDel).includes(id.d) && dataOf(afterDel).count === 6 && dataOf(afterDel).totalPaise === 220345,
    afterDel,
  );
  const repAfter = await h.report.get(`?${range}`);
  const ra = dataOf(repAfter);
  check("deleted row is gone from the report: total 220345, count 6", repAfter.status === 200 && ra.totalPaise === 220345 && ra.count === 6, repAfter);
  check(
    "report byCategory after edits+delete = Gas 130000, Ingredients 82345, Other 8000 (Rent omitted)",
    same(((ra.byCategory as Body[]) ?? []).map((c) => [c.name, c.totalPaise, c.count]), [["Gas", 130000, 2], ["Ingredients", 82345, 3], ["Other", 8000, 1]]),
    repAfter,
  );
  check(
    "report byDay after = d2 12345 (1), d1 50000 (2), today 158000 (3); byMode = cash 82345 (3), upi 108000 (2), card 30000 (1), bank omitted",
    same(((ra.byDay as Body[]) ?? []).map((x) => [x.date, x.totalPaise, x.count]), [[d2, 12345, 1], [d1, 50000, 2], [today, 158000, 3]]) &&
      same(((ra.byMode as Body[]) ?? []).map((x) => [x.mode, x.totalPaise, x.count]), [["cash", 82345, 3], ["upi", 108000, 2], ["card", 30000, 1]]),
    repAfter,
  );
  const delAgain = await h.expenses.del(id.d);
  check("DELETE again -> 404", delAgain.status === 404, delAgain);
  const patchDeleted = await h.expenses.patch(id.d, { amountPaise: 1, expectedUpdatedAt: String(gone?.updatedAt.toISOString()) });
  check("PATCH a deleted row -> 404 (deleted copy)", patchDeleted.status === 404 && patchDeleted.body.error === EXPENSE_DELETED_ERROR, patchDeleted);
  const delGhost = await h.expenses.del(GHOST);
  check("DELETE an unknown id -> 404", delGhost.status === 404, delGhost);

  // ── categories ────────────────────────────────────────────────────────────
  const dupRename = await h.categories.patch(cats[2], { name: "gas" });
  check(
    "rename to a case-variant of an existing name -> 400 (duplicate copy), name unchanged",
    dupRename.status === 400 && dupRename.body.error === EXPENSE_CATEGORY_DUPLICATE_ERROR && (await storedCategory(cats[2]))?.name === "Salaries",
    dupRename,
  );
  const dupCreate = await h.categories.post({ name: "GAS" });
  check("create a case-variant of an existing name -> 400 (duplicate copy)", dupCreate.status === 400 && dupCreate.body.error === EXPENSE_CATEGORY_DUPLICATE_ERROR && (await categoriesCol().countDocuments()) === 8, dupCreate);
  const selfCase = await h.categories.patch(cats[2], { name: "SALARIES" });
  check("changing a category's OWN letter case is not a duplicate -> 200", selfCase.status === 200 && (await storedCategory(cats[2]))?.name === "SALARIES", selfCase);
  await h.categories.patch(cats[2], { name: "Salaries" });
  const hideOther = await h.categories.patch(cats[6], { hidden: true });
  const showOther = await h.categories.patch(cats[6], { hidden: false });
  check(
    "hide then show: the raw doc has NO hidden key afterwards (an $unset, never hidden:false)",
    hideOther.status === 200 && showOther.status === 200 && dataOf(showOther).hidden === false && !("hidden" in ((await storedCategory(cats[6])) ?? {})),
    showOther,
  );
  const catGhost = await h.categories.patch(GHOST, { hidden: true });
  const catBad = await h.categories.patch("zzz", { hidden: true });
  const catEmpty = await h.categories.patch(cats[0], {});
  check("category PATCH: unknown id -> 404, invalid id -> 404, empty body -> 400", catGhost.status === 404 && catBad.status === 404 && catEmpty.status === 400, catGhost);
  const added = await h.categories.post({ name: "Stationery" });
  check("admin adds a category -> 201, lands at the END (displayOrder 8)", added.status === 201 && dataOf(added).displayOrder === 8 && dataOf(added).hidden === false, added);

  // Fill to the cap, then the next add is refused.
  let allCreated = true;
  while ((await categoriesCol().countDocuments()) < EXPENSE_CATEGORIES_MAX) {
    const n = await categoriesCol().countDocuments();
    const res = await h.categories.post({ name: `Extra ${n}` });
    if (res.status !== 201) {
      allCreated = false;
      check(`filling to the cap: POST #${n} -> 201`, false, res);
      break;
    }
  }
  check(`filled to EXPENSE_CATEGORIES_MAX (${EXPENSE_CATEGORIES_MAX}) with 201s`, allCreated && (await categoriesCol().countDocuments()) === EXPENSE_CATEGORIES_MAX);
  const overCap = await h.categories.post({ name: "One too many" });
  check(
    `the next category POST at the cap -> 400 (limit copy), still ${EXPENSE_CATEGORIES_MAX} rows`,
    overCap.status === 400 && overCap.body.error === EXPENSE_CATEGORY_LIMIT_ERROR && (await categoriesCol().countDocuments()) === EXPENSE_CATEGORIES_MAX,
    overCap,
  );

  await runReplayCases(h, ctx);
}

// A clientRef replay is only a replay for the SAME account sending the SAME
// expense to a row that still counts; anything else is a 409 that writes nothing.
async function runReplayCases(h: Harness, ctx: Ctx): Promise<void> {
  const { check } = h;
  const body = expenseBody(ctx.cats[0], ctx.today, { name: "Replay milk", amountPaise: 31000, paymentMode: "upi" });
  const rowsFor = () => expensesCol().countDocuments({ clientRef: body.clientRef });

  h.setRole("staff");
  const first = await h.expenses.post(body);
  const rid = String(dataOf(first).id);
  check("replay: first POST -> 201", first.status === 201 && (await rowsFor()) === 1, first);

  const same = await h.expenses.post(body);
  check("replay: same clientRef + identical body -> 200, the SAME id, still 1 row", same.status === 200 && dataOf(same).id === rid && (await rowsFor()) === 1, same);
  const emptyNote = await h.expenses.post({ ...body, note: "" });
  check("replay: an empty note equals an absent note -> 200, same id", emptyNote.status === 200 && dataOf(emptyNote).id === rid && (await rowsFor()) === 1, emptyNote);

  const diffAmount = await h.expenses.post({ ...body, amountPaise: 32000 });
  const afterDiff = await storedExpense(rid);
  check(
    "replay: same clientRef + different amountPaise -> 409 (already-saved copy), still exactly 1 row, amount NOT overwritten",
    diffAmount.status === 409 && diffAmount.body.error === EXPENSE_ALREADY_SAVED_ERROR && (await rowsFor()) === 1 && afterDiff?.amountPaise === 31000,
    diffAmount,
  );
  const diffNote = await h.expenses.post({ ...body, note: "added later" });
  check("replay: same clientRef + a note the first save did not have -> 409, 1 row, no note written", diffNote.status === 409 && (await rowsFor()) === 1 && !("note" in (afterDiff ?? {})), diffNote);

  h.setRole("admin");
  const otherUser = await h.expenses.post(body);
  check(
    "replay: same clientRef from the OTHER user with an identical body -> 409, still 1 row (not handed the staff row)",
    otherUser.status === 409 && otherUser.body.error === EXPENSE_ALREADY_SAVED_ERROR && (await rowsFor()) === 1,
    otherUser,
  );

  const del = await h.expenses.del(rid);
  check("replay: admin soft-deletes the row", del.status === 200 && "deletedAt" in ((await storedExpense(rid)) ?? {}), del);
  h.setRole("staff");
  const afterDelete = await h.expenses.post(body);
  check(
    "replay: same clientRef + identical body AFTER the row was deleted -> 409 (not 'added'), still 1 row",
    afterDelete.status === 409 && afterDelete.body.error === EXPENSE_ALREADY_SAVED_ERROR && (await rowsFor()) === 1,
    afterDelete,
  );
  h.setRole("admin");
}
