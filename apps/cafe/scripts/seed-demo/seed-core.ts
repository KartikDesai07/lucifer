/**
 * Demo-seed writers: settings/admin/staff/tables/menu bootstrap, plus the
 * shared "insert with OUR timestamps" helper the backdated writers
 * (orders-write.ts, finalize.ts) reuse. Runs after `dropDatabase()` — every
 * function here assumes an EMPTY database.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import bcrypt from "bcryptjs";
import { Types, type Document } from "mongoose";
import { Staff } from "@/models/Staff";
import { Table } from "@/models/Table";
import { Product } from "@/models/Product";
import { Customer } from "@/models/Customer";
import { mintUniquePublicToken } from "@/lib/public-token";
import { ensureCategoryId } from "../verify-shared/ensure-category";
import { seedSettings, tableList } from "../seed-client";
import { seedAdmin } from "../seed-admin";
import type {
  DemoCategory,
  DemoCustomer,
  DemoProduct,
  DemoStaffMember,
  PlannedCustomer,
  PlannedProduct,
  PlannedTable,
  PlannedStaff,
  Rng,
} from "./types";

// seed-client.ts's CafeBlock/ClientFile interfaces are not exported (the plan
// permits adding ONLY `export` to seedSettings/tableList there) — derive the
// parameter shapes structurally instead of importing a type that doesn't exist.
type CafeBlock = Parameters<typeof seedSettings>[0];
type TablesSpec = Parameters<typeof tableList>[0];

const BCRYPT_ROUNDS = 12;
// Cycles across the floor plan so a demo cafe reads as a real one (mostly
// 4-tops with a few 2s and one big table), not a flat capacity for every seat.
const CAPACITY_CYCLE = [2, 4, 4, 6, 4, 2, 8, 4] as const;
const ROOFTOP_CHARGE_AMOUNT = 50;
const ROOFTOP_CHARGE_LABEL = "Rooftop seating";
const ADMIN_WEIGHT = 10;

export interface DemoClientCafe {
  cafe: CafeBlock;
  tables: TablesSpec;
}

/** Settings + admin — delegates to seed-client.ts so the demo cafe bootstraps
 *  identically to a real go-live (idempotent there; here the DB was just
 *  dropped, so both branches always take the "create" path). */
export async function seedBase(client: DemoClientCafe, log: (line: string) => void): Promise<void> {
  await seedSettings(client.cafe);
  await seedAdmin();
  log("Settings and admin account created.");
}

/** 3 named demo staff (bcrypt of the SAME password as SEED_ADMIN_PASSWORD,
 *  role "staff") plus the admin already created by seedBase — returns every
 *  receiver the order planner may pick from, admin included. */
export async function seedStaff(
  staffMembers: readonly DemoStaffMember[],
  password: string,
): Promise<PlannedStaff[]> {
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const created: PlannedStaff[] = [];
  for (const member of staffMembers) {
    const doc = await Staff.create({
      name: member.name,
      username: member.username,
      mobile: member.mobile,
      password: hashed,
      role: "staff",
      isActive: true,
    });
    created.push({ _id: doc._id as Types.ObjectId, name: member.name, weight: member.weight });
  }

  const admin = await Staff.findOne({ role: "admin" });
  if (!admin) throw new Error("seedStaff: no admin account found — seedBase must run first");
  created.push({ _id: admin._id as Types.ObjectId, name: admin.name, weight: ADMIN_WEIGHT });

  return created;
}

/** Floor plan: capacities cycle for variety, displayOrder = position, every
 *  table gets a public QR token, and the LAST table carries the demo's one
 *  extra charge (a rooftop seating fee) so the charge path has real data. */
export async function seedTables(tables: TablesSpec, rng: Rng): Promise<PlannedTable[]> {
  const names = tableList(tables);
  const planned: PlannedTable[] = [];
  for (const [index, tableNo] of names.entries()) {
    const capacity = CAPACITY_CYCLE[index % CAPACITY_CYCLE.length];
    const publicToken = await mintUniquePublicToken((t) => Table.exists({ publicToken: t }).then(Boolean));
    const isLast = index === names.length - 1;
    const chargeAmount = isLast ? ROOFTOP_CHARGE_AMOUNT : undefined;
    const chargeLabel = isLast ? ROOFTOP_CHARGE_LABEL : undefined;
    await Table.create({
      tableNo,
      status: "Available",
      capacity,
      displayOrder: index,
      publicToken,
      ...(chargeAmount !== undefined ? { chargeAmount, chargeLabel } : {}),
    });
    planned.push({ tableNo, capacity, ...(chargeAmount !== undefined ? { chargeAmount, chargeLabel } : {}) });
  }
  // rng is accepted (per the plan's signature) for future variety in the floor
  // plan without changing this function's call sites; nothing here needs a
  // random draw today (capacity/charge are deterministic by position).
  void rng;
  return planned;
}

/** Categories (in display order) + products, wired to the uploaded image refs
 *  (falling back to "" for a product with no image, or whose upload was
 *  skipped/failed). */
export async function seedMenu(
  categories: readonly DemoCategory[],
  products: readonly DemoProduct[],
  imageRefs: ReadonlyMap<string, string>,
): Promise<PlannedProduct[]> {
  const categoryIds = new Map<string, Types.ObjectId>();
  for (const category of categories) {
    categoryIds.set(category.name, await ensureCategoryId(category.name, category.order));
  }

  const docs = products.map((product) => {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`seedMenu: product "${product.name}" references unknown category "${product.category}"`);
    return {
      name: product.name,
      categoryId,
      price: product.price,
      ...(product.variations && product.variations.length > 0 ? { variations: product.variations } : {}),
      discount: product.discount ?? 0,
      available: product.available ?? true,
      image: (product.imageFile && imageRefs.get(product.imageFile)) || "",
      modifiers: product.modifiers ?? [],
      isActive: true,
      ...(product.publicVisible !== undefined ? { publicVisible: product.publicVisible } : {}),
    };
  });

  const inserted = await Product.insertMany(docs);
  return inserted.map((doc, index) => {
    const product = products[index];
    return {
      _id: doc._id as Types.ObjectId,
      name: doc.name,
      price: doc.price,
      variations: product.variations,
      modifiers: doc.modifiers,
      available: doc.available,
      discount: doc.discount,
      weight: product.weight,
    };
  });
}

const DAYS_BEFORE_FIRST_ORDER_MAX = 30;
const DAYS_BEFORE_FIRST_ORDER_MIN = 1;
const DAYS_BEFORE_RANGE_START_MAX = 20;
const DAYS_BEFORE_RANGE_START_MIN = 1;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Insert every demo customer with a pre-generated `_id` (the planner needs
 *  customer ids to exist BEFORE it plans orders) and a `createdAt` that reads
 *  as a real signup: 1-30 days before their first order, or 1-20 days before
 *  the seeded range's start for a customer nobody ordered from. Rollups
 *  (visits/totalSpend/totalDue) are filled in later by finalize.ts. */
export async function seedCustomers(
  customers: readonly (DemoCustomer & { _id: Types.ObjectId })[],
  firstOrderAt: ReadonlyMap<string, Date>,
  rangeStart: Date,
  rng: Rng,
): Promise<PlannedCustomer[]> {
  const docs = customers.map((customer) => {
    const firstOrder = firstOrderAt.get(customer.mobile);
    const createdAt = firstOrder
      ? new Date(firstOrder.getTime() - rng.int(DAYS_BEFORE_FIRST_ORDER_MIN, DAYS_BEFORE_FIRST_ORDER_MAX) * ONE_DAY_MS)
      : new Date(rangeStart.getTime() - rng.int(DAYS_BEFORE_RANGE_START_MIN, DAYS_BEFORE_RANGE_START_MAX) * ONE_DAY_MS);
    return backdatedRaw(Customer, {
      _id: customer._id,
      name: customer.name,
      mobile: customer.mobile,
      notes: customer.notes,
      createdAt,
      updatedAt: createdAt,
    });
  });

  await Customer.collection.insertMany(docs, { ordered: true });
  return customers.map((c) => ({ _id: c._id, name: c.name, mobile: c.mobile, notes: c.notes }));
}

// ── Backdated raw insert ─────────────────────────────────────────────────────
// Mongoose's timestamp hooks stamp "now" on every write; the demo's whole
// point is documents that look like they were created over the last month.
// `new Model(obj)` runs the model's normal casting/validation, `toObject()`
// materialises its schema defaults exactly like a live `create()` would, and
// only then do we overwrite the two timestamp fields before the raw insert —
// so an optional field the object never set stays genuinely absent.
export function backdatedRaw<T extends Document>(
  ModelCtor: new (obj: unknown) => T,
  obj: Record<string, unknown> & { createdAt: Date; updatedAt: Date },
): Record<string, unknown> {
  const doc = new ModelCtor(obj);
  const err = doc.validateSync();
  if (err) throw err;
  const raw = doc.toObject() as Record<string, unknown>;
  raw.createdAt = obj.createdAt;
  raw.updatedAt = obj.updatedAt;
  raw.__v = 0;
  return raw;
}
