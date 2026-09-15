/**
 * Persist a planned OrdersPlan (orders, requests, counters, table states) with
 * OUR timestamps, via the backdated-raw-insert discipline (seed-core.ts).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { Counter } from "@/models/Counter";
import { Table } from "@/models/Table";
import { backdatedRaw } from "./seed-core";
import type { OrdersPlan } from "./types";

// Small enough to stay well under Vercel/M0 limits and keep one insertMany
// call from growing unbounded on a 31-day plan (~600+ orders).
const INSERT_BATCH_SIZE = 200;

async function insertInBatches(docs: Record<string, unknown>[], insert: (batch: Record<string, unknown>[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < docs.length; i += INSERT_BATCH_SIZE) {
    await insert(docs.slice(i, i + INSERT_BATCH_SIZE));
  }
}

/** Write every order/request/counter/table-state from a completed plan. */
export async function writeOrders(plan: OrdersPlan): Promise<void> {
  if (plan.orders.length > 0) {
    const orderDocs = plan.orders.map((order) => backdatedRaw(Order, order as unknown as Record<string, unknown> & { createdAt: Date; updatedAt: Date }));
    await insertInBatches(orderDocs, (batch) => Order.collection.insertMany(batch, { ordered: true }));
  }

  if (plan.requests.length > 0) {
    const requestDocs = plan.requests.map((request) =>
      backdatedRaw(OrderRequest, request as unknown as Record<string, unknown> & { createdAt: Date; updatedAt: Date }),
    );
    await insertInBatches(requestDocs, (batch) => OrderRequest.collection.insertMany(batch, { ordered: true }));
  }

  const counterKeys = Object.keys(plan.counters);
  if (counterKeys.length > 0) {
    await Counter.bulkWrite(
      counterKeys.map((key) => ({
        updateOne: {
          filter: { _id: key },
          update: { $set: { seq: plan.counters[key] } },
          upsert: true,
        },
      })),
    );
  }

  for (const state of plan.tableStates) {
    if (state.status === "Occupied") {
      await Table.updateOne({ tableNo: state.tableNo }, { $set: { status: "Occupied", currentOrderId: state.currentOrderId ?? "" } });
    } else {
      await Table.updateOne({ tableNo: state.tableNo }, { $set: { status: "Reserved" } });
    }
  }
}
