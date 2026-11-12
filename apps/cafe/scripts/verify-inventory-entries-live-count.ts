/**
 * Count legs of verify-inventory-entries-live.ts (ops CLI support module, not app code). The invariant: every stock
 * change a count makes is EXACTLY the change its row records, so deleting the row undoes it. Two ways to break it,
 * both driven through the real POST route with `StockEntry.create` patched on the shared model:
 *   (p) the insert fails once after the count was applied, a sale lands, and the same sheet saves again;
 *   (q) two requests with the same clientRef are in flight and the SECOND one's insert lands first.
 * (console output is intentional: ops CLI script, not app code.)
 */
import { randomUUID } from "node:crypto";
import mongoose, { type Model } from "mongoose";
import type { IStockEntry } from "@/models/StockEntry";

type Body = Record<string, unknown>;
type Res = { status: number; body: { success: boolean; data?: unknown; error?: string } };
type Create = Model<IStockEntry>["create"];

export interface CountLegKit {
  post: (body: unknown) => Promise<Res>;
  seedItem: (name: string, unit: string, qty: number) => Promise<string>;
  countBody: (itemId: string, countedMilli: number, over?: Body) => Body;
  check: (label: string, ok: boolean, res?: Res) => void;
}

const START = 5000;
const COUNTED = 8000;
const SALE = -3000;
const GATE_WAIT_MS = 5_000; // the gate opens on its own if the second request never inserts (no hang)
const POLL_MS = 10;

// RAW reads and writes (an independent path from the routes).
const raw = (name: string) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("landmark: connected");
  return db.collection(name);
};
const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
const qtyOf = async (id: string) => (await raw("stockitems").findOne({ _id: oid(id) }))?.qty as number | undefined;
const rawInc = async (id: string, by: number) => {
  await raw("stockitems").updateOne({ _id: oid(id) }, { $inc: { qty: by } });
};
/** What the item's ACTIVE rows say they changed, summed. */
async function rowsQtySum(itemId: string): Promise<number> {
  const rows = await raw("stockentries").find({ "lines.itemId": oid(itemId), deletedAt: { $exists: false } }).toArray();
  let sum = 0;
  for (const row of rows) for (const line of row.lines as { itemId: unknown; qty: number }[]) if (String(line.itemId) === itemId) sum += line.qty;
  return sum;
}

function entryModel(): Model<IStockEntry> {
  const model = mongoose.models.StockEntry as Model<IStockEntry> | undefined;
  if (!model) throw new Error("landmark: the StockEntry model is registered by the route import");
  return model;
}

/** Swap `create` for one leg; `restore` puts the real one back. */
function patchCreate(wrap: (real: Create) => Create): () => void {
  const model = entryModel();
  const real = model.create.bind(model) as Create;
  model.create = wrap(real);
  return () => {
    model.create = real;
  };
}

async function waitFor(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, POLL_MS));
}

export async function runCountLegs(kit: CountLegKit): Promise<void> {
  // (p) insert fails once, a sale lands, the same sheet saves again.
  const p = await kit.seedItem("Paneer", "pcs", START);
  const pBody = kit.countBody(p, COUNTED);
  let failOnce = true;
  let restore = patchCreate(
    (real) =>
      (async (...args: Parameters<Create>) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("live leg: insert failed");
        }
        return real(...args);
      }) as unknown as Create,
  );
  let p1: Res;
  try {
    p1 = await kit.post(pBody);
  } finally {
    restore();
  }
  await rawInc(p, SALE);
  const p2 = await kit.post(pBody);
  const pFinal = await qtyOf(p);
  kit.check("(p) the first save fails (500) and the retry saves (201)", p1.status === 500 && p2.status === 201, p2);
  kit.check(
    "(p) stock change minus the sale equals what the rows record (the retry never re-applies a count)",
    pFinal !== undefined && pFinal - START - SALE === (await rowsQtySum(p)) && pFinal === COUNTED,
  );

  // (q) two in-flight saves of one count; the second one's insert lands first.
  const q = await kit.seedItem("Bread", "pcs", START);
  const qBody = kit.countBody(q, COUNTED, { clientRef: randomUUID() });
  let calls = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
    setTimeout(resolve, GATE_WAIT_MS);
  });
  restore = patchCreate(
    (real) =>
      (async (...args: Parameters<Create>) => {
        calls += 1;
        const mine = calls;
        if (mine === 1) await gate;
        try {
          return await real(...args);
        } finally {
          if (mine === 2) open();
        }
      }) as unknown as Create,
  );
  let qBoth: Res[];
  try {
    const first = kit.post(qBody);
    await waitFor(() => calls >= 1, GATE_WAIT_MS);
    const second = kit.post(qBody);
    qBoth = await Promise.all([first, second]);
  } finally {
    restore();
  }
  const qStatuses = qBoth.map((r) => r.status).sort();
  const qFinal = await qtyOf(q);
  kit.check("(q) both answer: one 201 and one replay 200", qStatuses[0] === 200 && qStatuses[1] === 201, qBoth[0]);
  kit.check(
    "(q) stock change equals what the one row records",
    qFinal !== undefined && qFinal - START === (await rowsQtySum(q)) && qFinal === COUNTED,
  );
}
