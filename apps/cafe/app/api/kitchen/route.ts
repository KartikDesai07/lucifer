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
import { getSettings } from "@/lib/settings";
import {
  TOKENS_OFF,
  filterModeOf,
  kitchenOrderFilter,
  kitchenSelectOf,
  mergeKitchenArms,
  tokenModeOf,
} from "@/lib/token-board";
import { readKitchenTokenArm, writeKotReady } from "@/lib/token-board-server";

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

    // S8 — tokens on adds today's PAID token orders as a second arm; tokens off is exactly the open-tab query.
    const mode = tokenModeOf(await getSettings(), new Date());
    const open = await Order.find({ ...kitchenOrderFilter(TOKENS_OFF), kotRounds: { $gte: 1 } })
      .select(kitchenSelectOf(filterModeOf(mode)))
      .sort({ createdAt: 1 })
      .limit(OPEN_TAB_LIMIT)
      .lean();
    const tokenArm = mode.enabled ? await readKitchenTokenArm(mode.dayStart) : [];
    const orders = mergeKitchenArms(open as unknown as KitchenOrderInput[], tokenArm);

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
      orders,
      ticksByOrder,
      readyAtByOrder,
    });

    return success({ cards, tabCount: open.length, generatedAt: now.toISOString() });
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
    const mode = tokenModeOf(await getSettings(), new Date());

    // EVERY verb is gated on the tab still being OPEN. That is deliberate for
    // the un-tick too: a settled tab never returns to the board, so its refs
    // are inert, and an ungated $pull would let a stale client keep mutating a
    // closed tab's record. The only cost is the message below — an Undo tapped
    // after someone else settled the tab is told plainly what happened rather
    // than being shown a "not found" that reads like the line vanished.
    // S8: with tokens on, "open" also covers today's paid token orders (kitchenOrderFilter).
    const open = await Order.exists({ _id: orderId, ...kitchenOrderFilter(filterModeOf(mode)) });
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
      // The stamp rules (P4-C seenFiredAt clamp, readyMarkedAt, $unset never null) live in
      // readyStampMs / readyUpdateOf (lib/token-board.ts); writeKotReady is the one Ready writer.
      await writeKotReady(orderId, body.ready, body.seenFiredAt);
    } else if (body.done) {
      await KotTick.updateOne({ _id: orderId }, { $addToSet: { refs: body.ref } }, { upsert: true });
    } else {
      await KotTick.updateOne({ _id: orderId }, { $pull: { refs: body.ref } });
    }

    // The board changed — nudge every OTHER device ahead of its 10s poll.
    // publishCafeEvent sends it at once (after() only keeps the invocation alive — which is why it sits after every follow-up) and swallows every failure,
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
