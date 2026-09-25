import mongoose from "mongoose";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import {
  success,
  notFound,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { buildKitchenRows, type KitchenOrderInput } from "@/lib/kitchen-board";

export const dynamic = "force-dynamic";

// A wall display's row cap, not a paginated list's — bounded so a busy shift
// with many open tabs never hands back an unbounded query result on a 512MB
// M0. Well within an 8s Vercel route (two bounded, indexed queries below).
const OPEN_TAB_LIMIT = 100;

// POST /api/kitchen body — a cook ticking (or un-ticking) one collapsed
// kitchen-board row. `ref` is a kotLineRef() string (qty-free line identity,
// see lib/kitchen-board.ts), never re-derived server-side: the board already
// computed it, and the route only needs to record it.
const tickBodySchema = z.object({
  orderId: z.string(),
  ref: z.string().min(1).max(400),
  done: z.boolean(),
});

// GET /api/kitchen — the live kitchen board. requireAuth() (NOT requireAdmin):
// the kitchen is staffed by non-admins, and nothing here reads or writes
// money, so the staff surface adds no financial authority. Never cached
// (orders TTL is 0 — the board must always read the tab's current state).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();

    const orders = await Order.find({
      status: "Pending",
      payment: "Unpaid",
      kotRounds: { $gte: 1 },
    })
      .select("orderId items kotRounds kotNumbers kotFiredAt tableNo notes source createdAt")
      .sort({ createdAt: 1 })
      .limit(OPEN_TAB_LIMIT)
      .lean();

    const ids = orders.map((order) => String(order._id));
    const ticks = await KotTick.find({ _id: { $in: ids } }).select("refs").lean();
    const ticksByOrder: Record<string, string[]> = {};
    for (const tick of ticks) {
      ticksByOrder[tick._id] = tick.refs;
    }

    const now = new Date();
    const rows = buildKitchenRows({
      orders: orders as KitchenOrderInput[],
      ticksByOrder,
      now,
    });

    return success({ rows, tabCount: orders.length, generatedAt: now.toISOString() });
  } catch (error) {
    return serverError("Failed to load the kitchen board", error);
  }
}

// POST /api/kitchen — tick (or un-tick) one collapsed board row. Idempotent by
// construction: $addToSet/$pull make a double-tap or a retry a no-op, so no
// CAS term is needed here — there is no lost-update hazard on a set. A settled
// tab must not accrue ticks, so the guard below runs before either write.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, tickBodySchema);
  if ("error" in parsed) return parsed.error;

  const { orderId, ref, done } = parsed.data;
  if (!mongoose.isValidObjectId(orderId)) return notFound("Order not found");

  try {
    await connectDB();

    // Both verbs are gated on the tab still being OPEN. That is deliberate for
    // the un-tick too: a settled tab never returns to the board, so its refs
    // are inert, and an ungated $pull would let a stale client keep mutating a
    // closed tab's record. The only cost is the message below — an Undo tapped
    // after someone else settled the tab is told plainly what happened rather
    // than being shown a "not found" that reads like the line vanished.
    const open = await Order.exists({ _id: orderId, status: "Pending", payment: "Unpaid" });
    if (!open) {
      return notFound(
        done
          ? "Tab not found or already settled"
          : "That tab was settled — the line stays marked done",
      );
    }

    if (done) {
      await KotTick.updateOne({ _id: orderId }, { $addToSet: { refs: ref } }, { upsert: true });
    } else {
      await KotTick.updateOne({ _id: orderId }, { $pull: { refs: ref } });
    }

    // A line was ticked (or un-ticked) — nudge every OTHER device's board
    // ahead of its 10s poll. publishCafeEvent defers it past the response and
    // swallows every failure, so it can never delay or fail this write; the
    // poll stays the fallback and the source of truth.
    publishCafeEvent("kot-ticked");
    return success({ orderId, ref, done });
  } catch (error) {
    return serverError("Failed to update the kitchen tick", error);
  }
}
