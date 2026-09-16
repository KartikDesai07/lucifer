/**
 * Seed a NEW cafe's database from a go-live client file (scripts/go-live/).
 * Run by `npm run go-live`; standalone:
 *   MONGODB_URI=… SEED_ADMIN_USERNAME=… SEED_ADMIN_PASSWORD=… npm run seed:client -- --file ../../clients/<name>.json
 *
 * Idempotent and NEVER destructive — a re-run on a cafe that has started
 * editing its data changes nothing:
 *   settings   created only when the cafe has NO Settings document yet
 *   admin      seed-admin.ts (bails when any admin exists)
 *   tables     created only when the cafe has NO tables (seed-tables discipline);
 *              the list comes from the client file — a count or names, never a
 *              compile-time default (CR1.1 floor plans are per-cafe data)
 *   menu       created only when the cafe has NO products (categories + products
 *              upsert-by-name, $setOnInsert) — a live cafe's menu is never touched
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { Table } from "@/models/Table";
import { Product } from "@/models/Product";
import { GST_MODES, GST_RATES, TABLE_NO_MAX_LEN, TABLE_NO_PATTERN, type GstMode } from "@/lib/constants";
import { ensureCategoryId } from "./verify-shared/ensure-category";
import { seedAdmin } from "./seed-admin";

const DEFAULT_CAPACITY = 4;
const DEFAULT_GST_RATE = 5;
const DEFAULT_GST_MODE: GstMode = "inclusive";

interface MenuItem {
  name: string;
  price: number;
  variations?: { name: string; price: number }[];
  modifiers?: string[];
}
interface MenuCategory {
  category: string;
  items: MenuItem[];
}
interface CafeBlock {
  name: string;
  tagline?: string;
  mobile?: string;
  address?: string;
  receiptFooter?: string;
  fssai?: string;
  gst?: { enabled: boolean; number?: string; rate?: number; mode?: string };
}
interface ClientFile {
  cafe: CafeBlock;
  tables?: number | string[];
  menu?: MenuCategory[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readClientFile(file: string): ClientFile {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.cafe) || typeof parsed.cafe.name !== "string" || !parsed.cafe.name.trim()) {
    throw new Error("client file: cafe.name is required");
  }
  const gst = parsed.cafe.gst;
  if (gst !== undefined && gst !== null) {
    if (!isRecord(gst) || typeof gst.enabled !== "boolean") throw new Error("client file: cafe.gst.enabled must be true/false");
    if (gst.rate !== undefined && !(GST_RATES as readonly number[]).includes(gst.rate as number)) throw new Error(`client file: cafe.gst.rate must be one of ${GST_RATES.join(", ")}`);
    if (gst.mode !== undefined && !(GST_MODES as readonly string[]).includes(gst.mode as string)) throw new Error(`client file: cafe.gst.mode must be ${GST_MODES.join(" or ")}`);
  }
  // Shape beyond this point is validated by scripts/go-live/lib.mjs before we run;
  // the cast is the seam between the JSON file and the typed seeders below.
  return parsed as unknown as ClientFile;
}

export async function seedSettings(cafe: CafeBlock): Promise<void> {
  const existing = await Settings.findOne().lean();
  if (existing) {
    console.log(`Settings already exist ("${existing.restaurantName}") — left untouched.`);
    return;
  }
  const gst = cafe.gst;
  await Settings.findOneAndUpdate(
    {},
    {
      $setOnInsert: {
        restaurantName: cafe.name.trim(),
        tagline: cafe.tagline ?? "",
        mobile: cafe.mobile ?? "",
        address: cafe.address ?? "",
        receiptFooter: cafe.receiptFooter ?? "Thank you, visit again!",
        fssai: cafe.fssai ?? "",
        gstEnabled: gst?.enabled ?? false,
        gstNumber: gst?.number ?? "",
        gstRate: gst?.rate ?? DEFAULT_GST_RATE,
        gstMode: (gst?.mode as GstMode | undefined) ?? DEFAULT_GST_MODE,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`Settings created for "${cafe.name.trim()}".`);
}

// The floor plan is PER-CLIENT data (CR1.1: tableNo is validated against the live
// Table collection, never a compile-time list), so the client file must say what
// it wants — a count or explicit names. No hidden default.
export function tableList(tables: ClientFile["tables"]): string[] {
  if (tables === undefined || tables === null) throw new Error('client file: "tables" is required — a count (T-1..T-n) or a list of table names');
  if (typeof tables === "number") return Array.from({ length: tables }, (_, i) => `T-${i + 1}`);
  for (const t of tables) {
    if (t.length > TABLE_NO_MAX_LEN || !TABLE_NO_PATTERN.test(t)) throw new Error(`client file: table name "${t}" is not allowed`);
  }
  return tables;
}

async function seedTables(names: string[]): Promise<void> {
  const existing = await Table.countDocuments();
  if (existing > 0) {
    console.log(`${existing} tables already defined — leaving the floor plan alone.`);
    return;
  }
  let created = 0;
  for (const tableNo of names) {
    const res = await Table.updateOne({ tableNo }, { $setOnInsert: { tableNo, status: "Available", capacity: DEFAULT_CAPACITY } }, { upsert: true });
    created += res.upsertedCount;
  }
  console.log(`${created} tables created (${names[0]} … ${names[names.length - 1]}).`);
}

// EMPTY-MENU BOOTSTRAP ONLY (same discipline as tables): once the cafe has ANY
// product, the starter list is never applied again — an item the cafe removed
// must not come back on the next Go live (which re-runs the seeder for env
// changes). Re-runs are therefore a true no-op for a live cafe.
async function seedMenu(menu: MenuCategory[] | undefined): Promise<void> {
  if (!menu || menu.length === 0) {
    console.log("No menu in the client file — the cafe imports its own (Menu → Import CSV).");
    return;
  }
  const existing = await Product.countDocuments();
  if (existing > 0) {
    console.log(`${existing} products already in the menu — starter menu not applied (the cafe owns its menu now).`);
    return;
  }
  let categories = 0;
  let created = 0;
  let kept = 0;
  for (const [index, cat] of menu.entries()) {
    const categoryId = await ensureCategoryId(cat.category, index + 1);
    categories += 1;
    for (const item of cat.items) {
      const res = await Product.updateOne(
        { name: item.name },
        {
          $setOnInsert: {
            name: item.name,
            categoryId,
            price: item.price,
            discount: 0,
            available: true,
            image: "",
            modifiers: item.modifiers ?? [],
            isActive: true,
            ...(item.variations && item.variations.length > 0 ? { variations: item.variations } : {}),
          },
        },
        { upsert: true },
      );
      if (res.upsertedCount > 0) created += 1;
      else kept += 1;
    }
  }
  console.log(`Menu: ${categories} categories · ${created} products created · ${kept} already present (untouched).`);
}

/** Seed everything that is still empty, over the (cached) default connection.
 *  Exported for reset-demo-db.ts, which drops a DEMO database first and then
 *  seeds it fresh through this very function. Does not disconnect. */
export async function seedClient(file: string): Promise<void> {
  const client = readClientFile(file);
  await connectDB();
  await seedSettings(client.cafe);
  await seedAdmin();
  await seedTables(tableList(client.tables));
  await seedMenu(client.menu);
}

async function main(): Promise<void> {
  const fileFlag = process.argv.indexOf("--file");
  const file = fileFlag >= 0 ? process.argv[fileFlag + 1] : undefined;
  if (!file) throw new Error("usage: npm run seed:client -- --file <clients/<name>.json>");
  await seedClient(file);
  await mongoose.disconnect();
}

// Driver/parse errors can quote the connection string (MongoParseError echoes
// its input). Never let the URI's user:password — or the admin password — reach
// the terminal or the console's streamed log.
const REDACTED = "•••";
export function redactSeedError(text: string): string {
  let out = text.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, `$1${REDACTED}@`);
  for (const secret of [process.env.MONGODB_URI, process.env.SEED_ADMIN_PASSWORD]) {
    if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED);
  }
  return out;
}

// Run standalone only when invoked directly — not when imported by reset-demo-db.ts.
const isMain = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/seed-client.ts");
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(redactSeedError(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    });
}
