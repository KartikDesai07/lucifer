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
import type { KitchenOrderInput } from "@/lib/kitchen-board";
import { buildKitchenCards } from "@/lib/kitchen-cards";

export const dynamic = "force-dynamic";

// A wall display's row cap, not a paginated list's — bounded so a busy shift
// with many open tabs never hands back an unbounded query result on a 512MB
// M0. Well within an 8s Vercel route (two bounded, indexed queries below).
const OPEN_TAB_LIMIT = 100;

// POST /api/kitchen body — a cook ticking (or un-ticking) one collapsed
// kitchen-board row. `ref` is a kotLineRef() string (qty-free line identity,
// see lib/kitchen-board.ts), never re-derived server-side: the board already
// computed it, and the route only needs to record it.
const tickBodySchema = z.discriminatedUnion("action", [
  // Tick (or un-tick) ONE collapsed board row.
  z.object({
    action: z.literal("tick"),
    orderId: z.string(),
    ref: z.string().min(1).max(400),
    done: z.boolean(),
  }),
  // P4-B — clear a whole order's card from the board (or put it back).
  // `action` is REQUIRED with no default on purpose: a defaulted discriminator
  // would let a malformed body silently become a tick.
  z.object({
    action: z.literal("ready"),
    orderId: z.string(),
    ready: z.boolean(),
    // P4-C — the newest fire instant the cook could actually SEE on the card
    // they tapped (the card's own cardFiredAt, ISO). The stamp is written at
    // THIS instant rather than at `now`, so a round fired between the board's
    // last refresh and the tap stays NEWER than the stamp and the card comes
    // straight back. Without it, Ready silently buries a round nobody cooked:
    // isHiddenByReady compares readyAt >= newest kotFiredAt, and a `now` stamp
    // always wins that comparison. Optional so an older client (or a board
    // rendered before this shipped) still works — it then falls back to `now`,
    // which is exactly the previous behaviour, never worse.
    seenFiredAt: z.string().datetime().optional(),
  }),
]);

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
    const ticks = await KotTick.find({ _id: { $in: ids } }).select("refs readyAt").lean();
    const ticksByOrder: Record<string, string[]> = {};
    const readyAtByOrder: Record<string, Date | undefined> = {};
    for (const tick of ticks) {
      ticksByOrder[tick._id] = tick.refs;
      if (tick.readyAt) readyAtByOrder[tick._id] = tick.readyAt;
    }

    const now = new Date();
    const cards = buildKitchenCards({
      orders: orders as KitchenOrderInput[],
      ticksByOrder,
      readyAtByOrder,
    });

    return success({ cards, tabCount: orders.length, generatedAt: now.toISOString() });
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

  const body = parsed.data;
  const { orderId } = body;
  if (!mongoose.isValidObjectId(orderId)) return notFound("Order not found");

  try {
    await connectDB();

    // EVERY verb is gated on the tab still being OPEN. That is deliberate for
    // the un-tick too: a settled tab never returns to the board, so its refs
    // are inert, and an ungated $pull would let a stale client keep mutating a
    // closed tab's record. The only cost is the message below — an Undo tapped
    // after someone else settled the tab is told plainly what happened rather
    // than being shown a "not found" that reads like the line vanished.
    const open = await Order.exists({ _id: orderId, status: "Pending", payment: "Unpaid" });
    if (!open) {
      return notFound(
        body.action === "ready"
          ? "That tab was settled — its card is already off the board"
          : body.done
            ? "Tab not found or already settled"
            : "That tab was settled — the line stays marked done",
      );
    }

    if (body.action === "ready") {
      // NOT fenced on every line being ticked. The UI disables the button until
      // then, but that is a nudge, not a rule: a cook must still be able to
      // clear a card whose last open line the POS just voided. A UI disable is
      // never a fence, and this is the one place where the permissive answer is
      // the correct one — the alternative strands a card on the wall forever.
      // P4-C — stamp the instant the cook could SEE, not the instant the
      // request landed. isHiddenByReady hides an order while
      // readyAt >= newest kotFiredAt, so a `now` stamp also buries any round
      // fired in the gap between the board's last refresh and the tap — food
      // nobody cooked, with nothing on any screen reporting it. Stamping the
      // card's own newest fire instant keeps that newer round strictly later
      // than the stamp, so the card returns on the next read.
      // Clamped to now: a client clock running fast (or a hand-made body) must
      // not be able to park a stamp in the future and suppress rounds that have
      // not happened yet. Falls back to now when absent — the old behaviour.
      const seen = body.seenFiredAt ? new Date(body.seenFiredAt) : null;
      const nowMs = Date.now();
      const stampMs =
        seen && Number.isFinite(seen.getTime()) ? Math.min(seen.getTime(), nowMs) : nowMs;
      // $unset, never null: the board reads readiness as field PRESENCE.
      await KotTick.updateOne(
        { _id: orderId },
        body.ready ? { $set: { readyAt: new Date(stampMs) } } : { $unset: { readyAt: "" } },
        { upsert: true },
      );
    } else if (body.done) {
      await KotTick.updateOne({ _id: orderId }, { $addToSet: { refs: body.ref } }, { upsert: true });
    } else {
      await KotTick.updateOne({ _id: orderId }, { $pull: { refs: body.ref } });
    }

    // The board changed — nudge every OTHER device ahead of its 10s poll.
    // publishCafeEvent defers it past the response and swallows every failure,
    // so it can never delay or fail this write; the poll stays the fallback and
    // the source of truth.
    publishCafeEvent("kot-ticked");
    return success(
      body.action === "ready"
        ? { orderId, ready: body.ready }
        : { orderId, ref: body.ref, done: body.done },
    );
  } catch (error) {
    return serverError("Failed to update the kitchen tick", error);
  }
}
