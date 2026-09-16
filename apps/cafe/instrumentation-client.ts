import { initBotId } from "botid/client/core";

// Vercel BotID, Basic mode (free on Hobby) — never enable `deepAnalysis`, that
// tier is paid. `protect` must name every server-checked route: a route that
// calls checkBotId() without a matching entry here fails verification by
// design (no client-side signal was ever collected for it). Verification
// always reports "human" in local dev — the deploy probe is what confirms
// this against a real bot.
initBotId({
  protect: [
    { path: "/api/public/order-request", method: "POST" },
    // The diner edit PATCH at /api/public/order-request/[shortCode] — BotID's
    // protect list has no [param] syntax, only trailing `*` wildcards
    // (vercel.com/docs/botid/get-started). Method-scoped, so the sibling
    // cancel POST at .../[shortCode]/cancel is NOT covered by this entry (it
    // deliberately runs without a BotID check — state-limited + idempotent).
    { path: "/api/public/order-request/*", method: "PATCH" },
    // The diner ACCOUNT routes. BOTH call checkBotId() as their FIRST gate, so
    // both MUST be listed — and the cost of omitting them is total, not
    // partial: BotID's patched fetch never even offers a challenge to an
    // unlisted path (botid/dist/client/core — it matches the request against
    // this list and, on no match, returns the ORIGINAL fetch), so no
    // `x-is-human` header is ever sent, the server check fails closed, and
    // EVERY REAL HUMAN gets a 403.
    //
    // That is exactly what shipped: these two routes arrived in 0ea0f28
    // (2026-09-15) already calling checkBotId while this list was last touched
    // in 3cde62b (2026-08-28), so diner sign-in and PIN setup were dead from
    // the day they shipped until this entry landed (owner-reported 2026-09-17).
    // Nothing caught it because checkBotId hardcodes isHuman:true whenever
    // NODE_ENV !== "production" — tsc, lint and every suite stay green with the
    // feature 100% broken. lib/diner-paths.test.ts now carries the closed-set
    // parity pin that fails when a checkBotId caller has no entry here.
    //
    // Static paths, so no wildcard. Deliberately NOT /me or /logout: neither
    // runs checkBotId, and listing them would only add challenge latency.
    { path: "/api/public/diner/pin", method: "POST" },
    { path: "/api/public/diner/login", method: "POST" },
  ],
});
