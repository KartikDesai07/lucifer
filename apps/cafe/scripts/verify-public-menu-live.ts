/**
 * CR2.1 live leg — the public QR-menu surface's DB-truth the fake-free unit
 * tests cannot prove: that the publicToken index really is unique+sparse (not
 * just declared that way), that PUBLIC_PRODUCT_FILTER's `$ne: false` behaves
 * as documented against REAL saved documents (absent/true/false, plus the
 * isActive gate and the sold-out-must-still-show case), and that
 * toPublicMenuItem/toPublicTable — this feature's whole security boundary —
 * leak no Mongo internals when fed a REAL, unfiltered `.lean()` read rather
 * than a hand-built fixture.
 *
 *   npm run verify:public:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_public_menu npm run verify:public:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops only the two collections it created.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { tableSchema, type ITable } from "@/models/Table";
import { productSchema, type IProduct } from "@/models/Product";
import { mintPublicToken } from "@/lib/public-token";
import { PUBLIC_PRODUCT_FILTER, toPublicMenuItem, toPublicTable } from "@/lib/public-menu";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}public_menu`;
const DUPLICATE_KEY_CODE = 11000;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  const conn = await mongoose.createConnection(uri).asPromise();
  const Table = conn.model<ITable>("Table", tableSchema);
  const Product = conn.model<IProduct>("Product", productSchema);
  await Table.collection.drop().catch(() => undefined);
  await Product.collection.drop().catch(() => undefined);
  // The unique+sparse claim is about a real INDEX, not just the schema
  // declaration — createIndexes() must run before either half of that claim
  // means anything.
  await Table.createIndexes();
  await Product.createIndexes();

  console.log(`\nCR2.1 public QR-menu surface — live against ${dbName}\n`);

  // ── 1. a minted token round-trips through a real Table doc ─────────────────
  const token = mintPublicToken();
  await Table.create({ tableNo: "T-1", capacity: 4, publicToken: token });
  const foundByToken = await Table.find({ publicToken: token }).lean();
  check(
    "a minted token round-trips through a real Table doc and resolves back to exactly one table",
    foundByToken.length === 1 && foundByToken[0]?.tableNo === "T-1",
  );

  // ── 2. sparse unique index: many tokenless tables coexist ──────────────────
  await Table.create({ tableNo: "T-2", capacity: 4 });
  await Table.create({ tableNo: "T-3", capacity: 4 });
  const tokenless = await Table.find({ publicToken: { $exists: false } }).lean();
  check(
    "the sparse unique index allows MANY tables with no publicToken at all to coexist",
    tokenless.length >= 2,
  );

  // ── 2b. the SAME unique index really rejects a duplicate token ─────────────
  let duplicateCode = 0;
  try {
    await Table.create({ tableNo: "T-4", capacity: 4, publicToken: token });
  } catch (e) {
    duplicateCode = (e as { code?: number }).code ?? 0;
  }
  check(
    "creating a SECOND table with the same publicToken raises a duplicate-key error (not a silent overwrite)",
    duplicateCode === DUPLICATE_KEY_CODE,
  );
  const afterDuplicateAttempt = await Table.countDocuments({ tableNo: "T-4" });
  check("the rejected duplicate-token create never actually landed", afterDuplicateAttempt === 0);

  // ── 3. PUBLIC_PRODUCT_FILTER against real saved docs ────────────────────────
  await Product.create({ name: "Filter Coffee", category: "Beverages", price: 40, isActive: true });
  await Product.create({
    name: "Cold Coffee",
    category: "Beverages",
    price: 60,
    isActive: true,
    publicVisible: true,
  });
  await Product.create({
    name: "Staff-Only Combo",
    category: "Beverages",
    price: 999,
    isActive: true,
    publicVisible: false,
  });
  await Product.create({
    name: "Discontinued Cake",
    category: "Bakery",
    price: 80,
    isActive: false,
    publicVisible: true, // publicVisible:true must NOT override an archived item
  });
  const soldOut = await Product.create({
    name: "Sold Out Sandwich",
    category: "Snacks",
    price: 50,
    isActive: true,
    available: false,
  });

  const visibleNames = new Set(
    (await Product.find(PUBLIC_PRODUCT_FILTER).select("name").lean()).map((p) => p.name),
  );
  check("an ABSENT publicVisible is returned by PUBLIC_PRODUCT_FILTER", visibleNames.has("Filter Coffee"));
  check("an explicit publicVisible:true is returned", visibleNames.has("Cold Coffee"));
  check("an explicit publicVisible:false is NOT returned", !visibleNames.has("Staff-Only Combo"));
  check(
    "an archived (isActive:false) product is never returned, even with publicVisible:true",
    !visibleNames.has("Discontinued Cake"),
  );
  check(
    "a sold-out (available:false) product IS returned by the filter — the page shows it struck through, never hides it",
    visibleNames.has("Sold Out Sandwich"),
  );

  // ── 4/5. toPublicMenuItem fed a REAL, UNFILTERED lean doc leaks nothing ─────
  // No .select() here on purpose: toPublicMenuItem — not the query's field
  // list — is this feature's actual security boundary (see the THREAT MODEL
  // comment in lib/public-menu.ts). Feeding it the FULL document (isActive,
  // publicVisible, createdAt, updatedAt, __v, a raw ObjectId _id, all
  // present) is what proves the mapping function itself is what's protecting
  // a diner's browser, not a query projection that a future edit could widen.
  const fullProductDoc = await Product.findById(soldOut._id).lean();
  if (!fullProductDoc) {
    check("the sold-out product must still be found for the toPublicMenuItem leak check", false);
  } else {
    const item = toPublicMenuItem(fullProductDoc);
    const keys = Object.keys(item).sort();
    check(
      "toPublicMenuItem over a REAL unfiltered lean doc returns EXACTLY the allowed key set",
      JSON.stringify(keys) ===
        JSON.stringify(["available", "category", "discount", "id", "image", "modifiers", "name", "price"].sort()),
    );
    check(
      "toPublicMenuItem leaks no Mongo internals (__v, timestamps, isActive, publicVisible, a raw _id)",
      !("__v" in item) &&
        !("isActive" in item) &&
        !("publicVisible" in item) &&
        !("createdAt" in item) &&
        !("updatedAt" in item) &&
        !("_id" in item),
    );
    check(
      "the sold-out state itself survives the mapping (available: false, not omitted)",
      item.available === false,
    );
    check("the mapped id is the stringified real _id", item.id === String(soldOut._id));
  }

  // ── 6. toPublicTable fed a REAL lean Table doc — the token does not survive ─
  const fullTableDoc = await Table.findOne({ tableNo: "T-1" }).lean();
  if (!fullTableDoc) {
    check("the tokened table must still be found for the toPublicTable leak check", false);
  } else {
    const publicTable = toPublicTable(fullTableDoc);
    check(
      "toPublicTable over a REAL lean Table doc that HAS a publicToken returns EXACTLY { tableNo } — the token does not survive the projection",
      JSON.stringify(Object.keys(publicTable)) === JSON.stringify(["tableNo"]) && publicTable.tableNo === "T-1",
    );
  }

  await Table.collection.drop().catch(() => undefined);
  await Product.collection.drop().catch(() => undefined);
  await conn.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
