import { connectDB } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  listCategories,
  listProducts,
  listStaff,
  listTables,
} from "@/lib/masters";
import {
  BOOTSTRAP_VERSION,
  mastersVersionOf,
  type BootstrapPayload,
  type MastersParts,
} from "@/lib/bootstrap-contract";

// GET /api/bootstrap's payload builder (CB-DL-1): the five master parts a
// dashboard tab needs on its first paint, produced by the SAME functions the
// five master routes use — `getSettings()` plus the four `lib/masters.ts` list
// functions — so one authenticated call replaces five and can never serve a
// different query than the routes do.
export async function buildBootstrap(opts: {
  includeStaff: boolean;
}): Promise<BootstrapPayload> {
  // Connect once up front: the five parts then run concurrently without each
  // racing to open the shared connection (connectDB is idempotent, and a part
  // served from the cache needs no DB at all).
  await connectDB();

  const [settings, categories, products, tables, staff] = await Promise.all([
    getSettings(),
    listCategories(),
    listProducts(),
    listTables(),
    // Staff is admin-only: a non-admin session gets `null`, and the client
    // never seeds the staff list from a payload that omits it.
    opts.includeStaff ? listStaff() : Promise.resolve(null),
  ]);

  // The parts are Mongoose lean rows (ObjectId `_id`, Date fields); the payload
  // types are the client DTOs (`string` _id, ISO-string dates). The single
  // conversion between them is the JSON serialisation this route's envelope
  // performs — the same contract every other list route already relies on
  // (`success(await Model.find().lean())`), so this is one explicit cast at the
  // boundary rather than a per-part re-mapping that could drift from the DTOs.
  const parts = {
    settings,
    categories,
    products,
    tables,
    staff,
  } as unknown as MastersParts;

  return {
    v: BOOTSTRAP_VERSION,
    at: new Date().toISOString(),
    // Derived from the parts already loaded — costs no extra query.
    mastersVersion: mastersVersionOf(parts),
    settings: parts.settings,
    categories: parts.categories,
    products: parts.products,
    tables: parts.tables,
    staff: parts.staff,
  };
}
