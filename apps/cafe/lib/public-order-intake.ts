import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";

import {
  PARCEL_BUCKET_KEY,
  PUBLIC_ORDER_BODY_MAX_BYTES,
  PUBLIC_ORDER_RATE_MAX,
  PUBLIC_ORDER_RATE_MAX_PARCEL,
} from "@pos/shared/public";
import {
  createPublicOrderRequestSchema,
  type CreatePublicOrderRequestInput,
} from "@pos/shared/schemas/public-order.schema";
import { failure, created } from "@/lib/api-helpers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { peekRateLimit } from "@/lib/public-rate-limit";
import {
  honeypotFallback,
  buildHoneypotResponse,
  BOT_DENIED_MESSAGE,
  BODY_TOO_LARGE_MESSAGE,
  BAD_REQUEST_MESSAGE,
} from "@/lib/order-request-create";
import { sameOriginOk, ORIGIN_DENIED_MESSAGE } from "@/lib/public-origin-gate";

// Sibling of app/api/public/order-request/route.ts (line-budget split, mirrors
// the CR2.2d precedent of lib/order-request-create.ts) — holds steps 1-5 of
// POST's own numbered control flow (see the route's file-level comment for
// the full 12-step contract; that comment stays in route.ts, which still runs
// steps 6-12). Nothing here decides the real path's own control order beyond
// what these five steps already owned before the split.

// Every response from this route is uncacheable (this is a write, and its
// success payload names a specific diner's order) and nosniff — mirrors the
// noStore helper in the sibling public GET routes.
export function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export type IntakeResult =
  | { kind: "respond"; response: NextResponse }
  | { kind: "proceed"; data: CreatePublicOrderRequestInput; now: number; bucket: string; max: number };

// Steps 1-5 of POST /api/public/order-request — see the route's file-level
// comment for why this exact order is a documented security contract.
export async function intakePublicOrderRequest(req: Request): Promise<IntakeResult> {
  // 1. Bot check. Always isBot:false in local dev (no client-side signal
  // was ever collected outside a real deploy) — the production curl-403 is
  // the deploy probe's success signal, not something reproducible here.
  const bot = await checkBotId();
  if (bot.isBot) return { kind: "respond", response: noStore(failure(BOT_DENIED_MESSAGE, 403)) };

  // 2. Host gate — same tenant + Tier-B assertion as middleware.ts, run by
  // hand because /api is outside the middleware's matcher.
  const tenant = await resolveTenantFromHost(req.headers.get("host"));
  const configuredTenant = process.env.TENANT_ID;
  if (!tenant || (configuredTenant && tenant.tenantId !== configuredTenant)) {
    return { kind: "respond", response: noStore(new NextResponse("Not found", { status: 404 })) };
  }

  // 2.5. Same-origin check — DEFENCE IN DEPTH behind BotID (§1), which is the
  // PRIMARY fence: BotID's client-side challenge means a cross-site POST is
  // already rejected 403 before this ever runs (arbitrated 2026-09-13, live-
  // probed with a valid body). This is a cheap belt-and-braces backstop, not
  // a replacement — see lib/public-origin-gate.ts for the full semantics
  // (notably: both headers absent is allowed, for the QR-camera-app case).
  // Placed BEFORE the rate limiter (§7, in route.ts) so a cross-site request
  // never burns an honest diner's metered slot.
  if (!sameOriginOk(req.headers.get("origin"), req.headers.get("referer"), req.headers.get("host"))) {
    return { kind: "respond", response: noStore(failure(ORIGIN_DENIED_MESSAGE, 403)) };
  }

  // 3. Body size cap — see the file-level comment for why bytes, not chars.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > PUBLIC_ORDER_BODY_MAX_BYTES) {
    return { kind: "respond", response: noStore(failure(BODY_TOO_LARGE_MESSAGE, 413)) };
  }

  // 4. Parse. Neither failure below ever echoes `raw`.
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { kind: "respond", response: noStore(failure(BAD_REQUEST_MESSAGE, 400)) };
  }

  // Honeypot lift — BEFORE Zod (see the file-level comment). Hazard-free:
  // `body` here is our own freshly parsed object, never re-served to any
  // caller. FIX-CR2.2 (non-string hp) — ANY non-empty value counts as
  // filled, not only a string: a deliberate non-string `hp` (an object, a
  // number, `true`) is still a bot tell, and the diner UI never sends this
  // field at all, so "absent" and "empty string" are the only honest values.
  const bodyObj =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  const hpFilled = bodyObj?.hp !== undefined && bodyObj.hp !== "";
  if (bodyObj) delete bodyObj.hp;

  // Shape-validate what's left.
  const parsed = createPublicOrderRequestSchema.safeParse(body);
  if (!parsed.success) return { kind: "respond", response: noStore(failure(BAD_REQUEST_MESSAGE, 400)) };
  const data = parsed.data;

  // Resolved once here (needs only `data.target`, no DB) — reused by both
  // the honeypot peek (§5) and the real hitRateLimit charge (§7) below, so
  // the two can never independently drift.
  const now = Date.now();
  const bucket = data.target.kind === "table" ? data.target.token : PARCEL_BUCKET_KEY;
  const max = data.target.kind === "table" ? PUBLIC_ORDER_RATE_MAX : PUBLIC_ORDER_RATE_MAX_PARCEL;

  // 5. Honeypot branch — see buildHoneypotResponse's own comment above.
  // FIX-CR2.2 (metering) — peek (never increments) the bucket a real
  // request would be charged; already at/over cap means this exact bucket
  // is already spent, so a bot gets the zero-real-work fallback instead of
  // buildHoneypotResponse's own Table/Product/Settings reads.
  if (hpFilled) {
    const peeked = await peekRateLimit(bucket, now);
    if (peeked >= max) {
      return { kind: "respond", response: noStore(created(honeypotFallback(data.target.kind === "parcel"))) };
    }
    const pretend = await buildHoneypotResponse(data);
    // A promo the real path would 422 must 422 here too — same status, same
    // message — or one probe tells the honeypot apart.
    if ("promoError" in pretend) {
      return { kind: "respond", response: noStore(failure(pretend.promoError, 422)) };
    }
    return { kind: "respond", response: noStore(created(pretend)) };
  }

  return { kind: "proceed", data, now, bucket, max };
}
