/**
 * Cases (part 1) for verify-expenses-live.ts (Step EXP): category seeding, staff
 * add / idempotency / own-today list, staff 403s, date + hidden-category
 * validation, the admin range list. Part 2 (edit / delete / report / category
 * rules) is verify-expenses-live-cases-edit.ts. Reads/writes the raw
 * `expenseentries` / `expensecategories` collections (an independent path from
 * the routes); expected copies and limits come from the real constants and every
 * money oracle is a hand-added integer. Runs against a scratch database the
 * caller has already fenced.
 */
import { addDays } from "@/lib/dashboard/range";
import { cafeDateString } from "@/lib/utils";
import { EXPENSE_CATEGORY_HIDDEN_ERROR } from "@/lib/expenses/categories";
import { EXPENSE_FUTURE_DATE_ERROR, EXPENSE_OLD_DATE_ERROR } from "@/lib/expenses/entries";
import { EXPENSE_BACKDATE_MAX_DAYS, EXPENSE_DEFAULT_CATEGORIES, EXPENSE_LIST_MAX } from "@pos/shared/expense";
import {
  ADMIN_ID,
  ADMIN_NAME,
  DAY_MS,
  GHOST,
  SETTLE_MS,
  STAFF_ID,
  STAFF_NAME,
  categoriesCol,
  dataOf,
  expenseBody,
  expensesCol,
  idsOf,
  rawExpense,
  rowsOf,
  same,
  sleep,
  storedCategory,
  storedExpense,
  type Ctx,
  type Harness,
} from "./verify-expenses-live-helpers";

// Re-exported so part 2 and the harness keep one import site.
export * from "./verify-expenses-live-helpers";

export async function runCases(h: Harness): Promise<Ctx> {
  const { check } = h;
  const today = cafeDateString(new Date());
  const d1 = addDays(today, -1);
  const d2 = addDays(today, -2);

  // ── category seed ─────────────────────────────────────────────────────────
  h.setRole("staff");
  const first = await h.categories.get();
  const cats = rowsOf(first).map((r) => String(r.id));
  check(
    "first GET categories seeds the 8 defaults in order (displayOrder 0..7, none hidden)",
    first.status === 200 &&
      same(rowsOf(first).map((r) => r.name), [...EXPENSE_DEFAULT_CATEGORIES]) &&
      same(rowsOf(first).map((r) => r.displayOrder), [0, 1, 2, 3, 4, 5, 6, 7]) &&
      rowsOf(first).every((r) => r.hidden === false),
    first,
  );
  const second = await h.categories.get();
  check(
    "a 2nd GET stays at 8 (idempotent: same ids, raw count 8)",
    second.status === 200 &&
      same(rowsOf(second).map((r) => r.id), cats) &&
      (await categoriesCol().countDocuments()) === 8,
    second,
  );

  // ── staff add, idempotent on clientRef ────────────────────────────────────
  const aBody = expenseBody(cats[0], today, { name: "Milk", amountPaise: 45050 });
  const created = await h.expenses.post(aBody);
  const a = String(dataOf(created).id);
  const storedA = await storedExpense(a);
  check(
    "staff POST -> 201, createdBy from the stub session, no internals on the wire",
    created.status === 201 &&
      dataOf(created).createdBy === STAFF_NAME &&
      dataOf(created).amountPaise === 45050 &&
      dataOf(created).edited === false &&
      !("clientRef" in dataOf(created)) &&
      !("createdById" in dataOf(created)) &&
      !("v" in dataOf(created)),
    created,
  );
  check(
    "raw row: createdById is the session id, v 1, and no note / edits / deletedAt keys",
    storedA?.createdById === STAFF_ID &&
      storedA?.v === 1 &&
      !("note" in (storedA ?? {})) &&
      !("edits" in (storedA ?? {})) &&
      !("deletedAt" in (storedA ?? {})),
  );
  const replay = await h.expenses.post(aBody);
  check(
    "same clientRef again -> 200 with the SAME id, still exactly 1 row for it",
    replay.status === 200 &&
      dataOf(replay).id === a &&
      (await expensesCol().countDocuments({ clientRef: aBody.clientRef })) === 1 &&
      (await expensesCol().countDocuments()) === 1,
    replay,
  );
  const smuggle = await h.expenses.post(expenseBody(cats[0], today, { createdBy: "Mallory", createdById: ADMIN_ID }));
  check(
    "a smuggled createdBy / createdById in the body -> 400 (strict), nothing written",
    smuggle.status === 400 && (await expensesCol().countDocuments()) === 1,
    smuggle,
  );

  // ── the seeded dataset (hand-computed totals are asserted below and in part 2) ──
  await sleep(SETTLE_MS);
  const b = await rawExpense(
    { name: "Gas cylinder", categoryId: cats[1], date: today, amountPaise: 100000, paymentMode: "upi" },
    { name: ADMIN_NAME, id: ADMIN_ID },
  );
  await sleep(SETTLE_MS);
  const yesterdayAt = new Date(Date.now() - DAY_MS);
  const c = await rawExpense(
    { name: "Old veg", categoryId: cats[0], date: d1, amountPaise: 20000, paymentMode: "cash" },
    { name: STAFF_NAME, id: STAFF_ID },
    { createdAt: yesterdayAt, updatedAt: yesterdayAt },
  );
  const hDeleted = await rawExpense(
    { name: "Deleted veg", categoryId: cats[0], date: today, amountPaise: 999, paymentMode: "cash" },
    { name: STAFF_NAME, id: STAFF_ID },
    { deletedAt: new Date(), deletedBy: ADMIN_NAME },
  );
  h.setRole("admin");
  await sleep(SETTLE_MS);
  const d = dataOf(await h.expenses.post(expenseBody(cats[3], d2, { name: "Rent", amountPaise: 500000, paymentMode: "bank" })));
  await sleep(SETTLE_MS);
  const e = dataOf(await h.expenses.post(expenseBody(cats[1], d1, { name: "Gas refill", amountPaise: 30000, paymentMode: "card" })));
  await sleep(SETTLE_MS);
  const f = dataOf(await h.expenses.post(expenseBody(cats[0], d2, { name: "Flour", amountPaise: 12345, paymentMode: "cash" })));
  await sleep(SETTLE_MS);
  const g = dataOf(await h.expenses.post(expenseBody(cats[7], today, { name: "Misc", amountPaise: 7777, paymentMode: "upi" })));
  const id = { a, b, c, d: String(d.id), e: String(e.id), f: String(f.id), g: String(g.id), h: hDeleted };
  check("admin POSTs of the dataset all returned an id", [d, e, f, g].every((r) => typeof r.id === "string"));

  // ── staff list: own rows created today, whatever the query says ───────────
  h.setRole("staff");
  const mine = await h.expenses.get();
  check(
    "staff GET -> only their own row created today (admin's row, their yesterday-created row and their deleted row excluded)",
    mine.status === 200 &&
      dataOf(mine).scope === "mine-today" &&
      same(idsOf(mine), [a]) &&
      dataOf(mine).count === 1 &&
      dataOf(mine).totalPaise === 45050 &&
      dataOf(mine).truncated === false,
    mine,
  );
  const forced = await h.expenses.get(`?from=${d2}&to=${today}&mode=upi&categoryId=${cats[1]}&limit=1`);
  check(
    "staff GET with from/to/mode/categoryId/limit params is STILL own-today only (params ignored)",
    forced.status === 200 &&
      dataOf(forced).scope === "mine-today" &&
      same(idsOf(forced), [a]) &&
      dataOf(forced).count === 1 &&
      dataOf(forced).totalPaise === 45050,
    forced,
  );
  check(
    "the excluded rows really exist (vision guard: b, c and the deleted row are in the collection)",
    (await storedExpense(b)) !== null && (await storedExpense(c)) !== null && (await storedExpense(hDeleted)) !== null,
  );

  // ── staff may not edit / delete / manage categories / read the report ─────
  const sPatch = await h.expenses.patch(a, { amountPaise: 1, expectedUpdatedAt: new Date().toISOString() });
  check("staff PATCH an expense -> 403", sPatch.status === 403, sPatch);
  const sDel = await h.expenses.del(a);
  check("staff DELETE an expense -> 403, row untouched", sDel.status === 403 && !("deletedAt" in ((await storedExpense(a)) ?? {})), sDel);
  const sCatPost = await h.categories.post({ name: "Staff cat" });
  check("staff category POST -> 403, nothing added", sCatPost.status === 403 && (await categoriesCol().countDocuments()) === 8, sCatPost);
  const sCatPatch = await h.categories.patch(cats[0], { hidden: true });
  check(
    "staff category PATCH -> 403, not hidden",
    sCatPatch.status === 403 && !("hidden" in ((await storedCategory(cats[0])) ?? {})),
    sCatPatch,
  );
  const sReport = await h.report.get();
  check("staff report GET -> 403", sReport.status === 403, sReport);

  // ── date window ───────────────────────────────────────────────────────────
  const future = await h.expenses.post(expenseBody(cats[0], addDays(today, 1)));
  check("future date -> 400 (future copy)", future.status === 400 && future.body.error === EXPENSE_FUTURE_DATE_ERROR, future);
  const tooOld = await h.expenses.post(expenseBody(cats[0], addDays(today, -(EXPENSE_BACKDATE_MAX_DAYS + 1))));
  check("367-days-old date -> 400 (old copy)", tooOld.status === 400 && tooOld.body.error === EXPENSE_OLD_DATE_ERROR, tooOld);
  h.setRole("admin");
  const oldest = addDays(today, -EXPENSE_BACKDATE_MAX_DAYS);
  const edge = await h.expenses.post(expenseBody(cats[0], oldest, { name: "Edge day", amountPaise: 100 }));
  check("exactly 366 days back -> 201 (the boundary is inclusive)", edge.status === 201 && dataOf(edge).date === oldest, edge);

  // ── hidden category refused on add ────────────────────────────────────────
  const hide = await h.categories.patch(cats[7], { hidden: true });
  check(
    "admin hides a category -> 200 hidden:true, raw hidden:true",
    hide.status === 200 && dataOf(hide).hidden === true && (await storedCategory(cats[7]))?.hidden === true,
    hide,
  );
  const onHidden = await h.expenses.post(expenseBody(cats[7], today));
  check("POST with a hidden category -> 400 (hidden copy)", onHidden.status === 400 && onHidden.body.error === EXPENSE_CATEGORY_HIDDEN_ERROR, onHidden);
  const noCat = await h.expenses.post(expenseBody(GHOST, today));
  check("POST with an unknown category -> 400", noCat.status === 400, noCat);

  // ── admin range list: exact count/total over ALL rows, even when limit=1 ──
  const range = `from=${d2}&to=${today}`;
  const all = await h.expenses.get(`?${range}`);
  const wantOrder = [id.g, id.b, id.a, id.e, id.c, id.f, id.d]; // (date desc, createdAt desc)
  check(
    "admin GET range -> scope range, 7 rows newest first, count 7, total 715172 (hand-added)",
    all.status === 200 &&
      dataOf(all).scope === "range" &&
      same(idsOf(all), wantOrder) &&
      dataOf(all).count === 7 &&
      dataOf(all).totalPaise === 715172 &&
      dataOf(all).truncated === false,
    all,
  );
  const one = await h.expenses.get(`?${range}&limit=1`);
  check(
    "limit=1 -> 1 row, truncated:true, count/total STILL cover all 7 rows",
    one.status === 200 && same(idsOf(one), [id.g]) && dataOf(one).truncated === true && dataOf(one).count === 7 && dataOf(one).totalPaise === 715172,
    one,
  );
  const cash = await h.expenses.get(`?${range}&mode=cash`);
  check("mode=cash -> a, c, f only: count 3, total 77395", same(idsOf(cash), [id.a, id.c, id.f]) && dataOf(cash).count === 3 && dataOf(cash).totalPaise === 77395, cash);
  const gas = await h.expenses.get(`?${range}&categoryId=${cats[1]}`);
  check("categoryId=Gas -> b, e only: count 2, total 130000", same(idsOf(gas), [id.b, id.e]) && dataOf(gas).count === 2 && dataOf(gas).totalPaise === 130000, gas);
  const todayOnly = await h.expenses.get();
  check(
    "admin GET with no range -> today's business day only (g, b, a): count 3, total 152827",
    same(idsOf(todayOnly), [id.g, id.b, id.a]) && dataOf(todayOnly).count === 3 && dataOf(todayOnly).totalPaise === 152827,
    todayOnly,
  );
  const edgeDay = await h.expenses.get(`?from=${oldest}&to=${oldest}`);
  check("the 366-day-old row is listed by its own day", edgeDay.status === 200 && dataOf(edgeDay).count === 1 && dataOf(edgeDay).totalPaise === 100, edgeDay);
  const badCat = await h.expenses.get(`?${range}&categoryId=nope`);
  check("garbage categoryId -> 400", badCat.status === 400, badCat);
  const overMax = await h.expenses.get(`?${range}&limit=${EXPENSE_LIST_MAX + 1}`);
  check(`limit above ${EXPENSE_LIST_MAX} -> 400`, overMax.status === 400, overMax);
  const badRange = await h.expenses.get(`?from=${today}&to=${d2}`);
  check("from after to -> 400", badRange.status === 400, badRange);

  return { cats, today, d1, d2, id };
}
