import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { FEDERATED_MODELS } from "@/lib/cluster-registry";
import { ADMIN_ROUTES } from "@pos/shared/constants";
import { expenseEntrySchema } from "@/models/ExpenseEntry";
import { expenseCategorySchema, EXPENSE_CATEGORY_NAME_COLLATION } from "@/models/ExpenseCategory";
import { createExpenseSchema } from "@/schemas";

// Step EXP — structural source pins: Int32 money, no TTL, not federated, index
// DEFINITIONS, the auth gate of every route handler, and "who added it" coming
// from the session only. Pins read the COMMENT-STRIPPED source; each negative
// pin carries a positive landmark. Needles are built by concatenation so a
// needle never matches this file's own text.

const CAFE = path.join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(read(rel));

/** The text of ONE exported handler: from its signature to the next export (or the end). */
function handler(rel: string, verb: string): string {
  const src = code(rel);
  const start = src.indexOf("export async function " + verb + "(");
  assert.ok(start !== -1, `${rel}: ${verb} handler present`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

const ADMIN_CALL = "requireAdmin" + "()";
const AUTH_CALL = "requireAuth" + "()";

const EXPENSES = "app/api/expenses/route.ts";
const EXPENSE_ID = "app/api/expenses/[id]/route.ts";
const CATEGORIES = "app/api/expense-categories/route.ts";
const CATEGORY_ID = "app/api/expense-categories/[id]/route.ts";
const REPORT = "app/api/reports/expenses/route.ts";

// ── models ──────────────────────────────────────────────────────────────────

test("ExpenseEntry: amountPaise (and the edit snapshot's) is Schema.Types.Int32 — schema + source", () => {
  const entry = expenseEntrySchema.path("amountPaise");
  assert.equal(entry.instance, "Int32");
  const edits = expenseEntrySchema.path("edits") as unknown as { schema: typeof expenseEntrySchema };
  assert.equal(edits.schema.path("amountPaise").instance, "Int32");
  assert.equal(edits.schema.path("categoryId").instance, "ObjectId"); // landmark: the snapshot schema is the right one

  const src = code("models/ExpenseEntry.ts");
  assert.ok(src.includes("const Int32 = Schema.Types." + "Int32"), "Int32 is taken from Schema.Types");
  const fieldDecl = "amountPaise: { type: Int32, required: true }";
  assert.equal(src.split(fieldDecl).length - 1, 2, "declared once on the row and once on the edit snapshot");
  assert.equal(src.includes("amountPaise: { type: Number"), false, "no plain-Number paise");
});

test("both expense models call assertSchemaTtlAllowed (TTL-free) and no schema index carries expireAfterSeconds", () => {
  const entry = code("models/ExpenseEntry.ts");
  const category = code("models/ExpenseCategory.ts");
  assert.ok(entry.includes("assertSchemaTtlAllowed(" + '"ExpenseEntry", expenseEntrySchema)'));
  assert.ok(category.includes("assertSchemaTtlAllowed(" + '"ExpenseCategory", expenseCategorySchema)'));
  for (const schema of [expenseEntrySchema, expenseCategorySchema]) {
    const indexes = schema.indexes();
    assert.ok(indexes.length >= 2, "landmark: the schema's indexes were read");
    for (const [, options] of indexes) {
      assert.equal(options && "expireAfterSeconds" in options, false, "no TTL index");
    }
  }
});

test("neither expense model is federated (not in FEDERATED_MODELS, never named in the cluster registry source)", () => {
  assert.ok((FEDERATED_MODELS as readonly string[]).includes("Order"), "landmark: the real list was read");
  assert.ok((FEDERATED_MODELS as readonly string[]).includes("Table"));
  assert.equal((FEDERATED_MODELS as readonly string[]).includes("ExpenseEntry"), false);
  assert.equal((FEDERATED_MODELS as readonly string[]).includes("ExpenseCategory"), false);
  const registry = code("lib/cluster-registry.ts");
  assert.ok(registry.includes("FEDERATED_MODELS"), "landmark: the registry source was read");
  assert.equal(registry.includes("Expense" + "Entry"), false);
  assert.equal(registry.includes("Expense" + "Category"), false);
  // both models bind to the default connection the plain way
  assert.ok(code("models/ExpenseEntry.ts").includes("mongoose.models.ExpenseEntry"));
  assert.ok(code("models/ExpenseCategory.ts").includes("mongoose.models.ExpenseCategory"));
});

test("ExpenseEntry index DEFINITIONS: clientRef unique, {date:-1,createdAt:-1}, {createdById:1,createdAt:-1}", () => {
  const indexes = expenseEntrySchema.indexes();
  assert.equal(indexes.length, 3, "3 declared + _id = the D12 budget of 4");
  const find = (spec: Record<string, number>) =>
    indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify(spec));

  const clientRef = find({ clientRef: 1 });
  assert.ok(clientRef, "clientRef index exists");
  assert.equal(clientRef[1]?.unique, true);
  assert.ok(find({ date: -1, createdAt: -1 }), "list/range sort index (key order matters)");
  assert.ok(find({ createdById: 1, createdAt: -1 }), "staff 'added by me today' index");
  assert.equal(find({ date: -1, createdAt: -1 })?.[1]?.unique, undefined);
});

test("ExpenseCategory index DEFINITIONS: name unique with collation en / strength 2, plus the sort index", () => {
  assert.deepEqual(EXPENSE_CATEGORY_NAME_COLLATION, { locale: "en", strength: 2 });
  const indexes = expenseCategorySchema.indexes();
  const byName = indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify({ name: 1 }));
  assert.ok(byName, "name index exists");
  assert.equal(byName[1]?.unique, true);
  assert.deepEqual(byName[1]?.collation, { locale: "en", strength: 2 });
  assert.ok(indexes.some(([fields]) => JSON.stringify(fields) === JSON.stringify({ displayOrder: 1, name: 1 })));
  // no second, case-sensitive unique key on name (field-level `unique`)
  assert.equal(expenseCategorySchema.path("name").options.unique, undefined);
  assert.equal(indexes.filter(([f]) => JSON.stringify(f) === JSON.stringify({ name: 1 })).length, 1);
});

// ── auth gates ──────────────────────────────────────────────────────────────

test("admin-only handlers call requireAdmin before any work (and never requireAuth alone)", () => {
  const adminOnly: Array<[string, string]> = [
    [EXPENSE_ID, "PATCH"],
    [EXPENSE_ID, "DELETE"],
    [CATEGORIES, "POST"],
    [CATEGORY_ID, "PATCH"],
    [REPORT, "GET"],
  ];
  for (const [rel, verb] of adminOnly) {
    const body = handler(rel, verb);
    const gate = body.indexOf(ADMIN_CALL);
    assert.ok(gate !== -1, `${verb} ${rel} calls requireAdmin`);
    // the gate precedes params, body parsing, DB and range work
    for (const later of ["await params", "validateBody(", "connectDB(", "parseDashboardRange(", "ExpenseCategory."]) {
      const at = body.indexOf(later);
      if (at !== -1) assert.ok(gate < at, `${verb} ${rel}: requireAdmin precedes ${later}`);
    }
    assert.equal(body.includes(AUTH_CALL), false, `${verb} ${rel} does not settle for requireAuth`);
  }
});

test("any-signed-in handlers (GET+POST /api/expenses, GET /api/expense-categories) call requireAuth, not requireAdmin", () => {
  const open: Array<[string, string]> = [
    [EXPENSES, "GET"],
    [EXPENSES, "POST"],
    [CATEGORIES, "GET"],
  ];
  for (const [rel, verb] of open) {
    const body = handler(rel, verb);
    assert.ok(body.includes(AUTH_CALL), `${verb} ${rel} calls requireAuth`);
    assert.equal(body.includes(ADMIN_CALL), false, `${verb} ${rel} must stay open to staff`);
  }
  // landmark that the scan is not blind: the same file's admin handler DOES gate
  assert.ok(handler(CATEGORIES, "POST").includes(ADMIN_CALL));
});

test("no expense route exports a verb beyond the planned ones (no category DELETE, no expense PUT)", () => {
  const verbs = (rel: string) =>
    [...code(rel).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(verbs(EXPENSES), ["GET", "POST"]);
  assert.deepEqual(verbs(EXPENSE_ID), ["DELETE", "PATCH"]);
  assert.deepEqual(verbs(CATEGORIES), ["GET", "POST"]);
  assert.deepEqual(verbs(CATEGORY_ID), ["PATCH"]);
  assert.deepEqual(verbs(REPORT), ["GET"]);
});

// ── who added it ────────────────────────────────────────────────────────────

test("POST /api/expenses takes createdBy / createdById from the session; the body schema is strict without them", () => {
  const post = handler(EXPENSES, "POST");
  assert.ok(post.includes("authed.session"), "the session is read");
  assert.ok(/createdBy:\s*user\.name/.test(post), "createdBy from the session user's name");
  assert.ok(post.includes("createdById: user.id"), "createdById from the session user's id");
  // the body is spread FIRST so the session values always win a key clash
  assert.ok(post.indexOf("...parsed.data") !== -1 && post.indexOf("...parsed.data") < post.indexOf("createdBy:"));
  assert.equal(post.includes("parsed.data.createdBy"), false);
  assert.equal(post.includes("body.createdBy"), false);

  // schema side: .strict() and no identity keys
  const schemaSrc = code("../../packages/shared/src/schemas/expense.schema.ts");
  const createDecl = schemaSrc.slice(
    schemaSrc.indexOf("export const createExpenseSchema"),
    schemaSrc.indexOf("export const updateExpenseSchema"),
  );
  assert.ok(createDecl.includes("clientRef: z.string().uuid()"), "landmark: the create schema was read");
  assert.ok(createDecl.includes(".strict()"), "create schema is strict");
  assert.equal(createDecl.includes("createdBy"), false);
  assert.equal(createDecl.includes("createdById"), false);
  const keys = Object.keys(createExpenseSchema.shape);
  assert.ok(keys.includes("clientRef"));
  assert.equal(keys.includes("createdBy"), false);
  assert.equal(keys.includes("createdById"), false);
  // behaviourally: a smuggled identity is REJECTED, not silently dropped
  const base = {
    name: "Milk",
    categoryId: "665f0000000000000000c001",
    date: "2026-10-09",
    amountPaise: 100,
    paymentMode: "cash",
    clientRef: "3f2b8c1e-9d4a-4c7e-8b1a-2f6d5e4c3b2a",
  };
  assert.equal(createExpenseSchema.safeParse(base).success, true, "landmark: the base body is valid");
  assert.equal(createExpenseSchema.safeParse({ ...base, createdBy: "Mallory" }).success, false);
  assert.equal(createExpenseSchema.safeParse({ ...base, createdById: "x" }).success, false);
});

test("PATCH / DELETE stamp editedBy / deletedBy from the session only", () => {
  const patch = handler(EXPENSE_ID, "PATCH");
  assert.ok(/editedBy:\s*authed\.session\.user\.name/.test(patch));
  assert.equal(patch.includes("parsed.data.editedBy"), false);
  const del = handler(EXPENSE_ID, "DELETE");
  assert.ok(del.includes("authed.session.user.name"));
});

// ── shared constant ─────────────────────────────────────────────────────────

test('ADMIN_ROUTES includes "/expenses/categories" and does NOT gate "/expenses" itself (staff may add)', () => {
  assert.ok((ADMIN_ROUTES as readonly string[]).includes("/expenses/categories"));
  assert.ok((ADMIN_ROUTES as readonly string[]).includes("/reports"), "landmark: the real list was read");
  assert.equal((ADMIN_ROUTES as readonly string[]).includes("/expenses"), false);
  // raw source agrees (the pin reads the file, not just the imported value)
  const src = code("../../packages/shared/src/constants.ts");
  assert.ok(src.includes('"/expenses/categories",'));
});

// ── money display ───────────────────────────────────────────────────────────

function componentSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(path.join(CAFE, d))) {
      const rel = d + "/" + name;
      if (statSync(path.join(CAFE, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
    }
  };
  walk(dir);
  return out;
}

test("components/expenses never formats a paise value with inr() — inrPaise is the only money formatter there", () => {
  const files = componentSources("components/expenses");
  assert.ok(files.length >= 5, "landmark: the expenses components were found");
  // `inr(` as a call, or `inr` imported by name (inrPaise is a different identifier).
  const WORD = String.raw`\w`;
  const callNeedle = new RegExp("(^|[^" + WORD + "$.])" + "inr" + String.raw`\(`);
  const importNeedle = new RegExp(String.raw`import\s*\{[^}]*\b` + "inr" + String.raw`\b[^}]*\}`);
  const usingInrPaise = files.filter((f) => code(f).includes("inrPaise" + "("));
  assert.ok(usingInrPaise.length >= 3, "landmark: inrPaise IS used in the expenses components");
  assert.ok(usingInrPaise.some((f) => f.endsWith("ExpenseRow.tsx")), "landmark: the row amount goes through inrPaise");
  for (const f of files) {
    const src = code(f);
    assert.equal(callNeedle.test(src), false, f + " calls inr()");
    assert.equal(importNeedle.test(src), false, f + " imports inr");
  }
  // the needle itself is not blind: it matches a bare call and not inrPaise
  assert.equal(callNeedle.test("x = inr(5)"), true);
  assert.equal(callNeedle.test("x = inrPaise(5)"), false);
});
