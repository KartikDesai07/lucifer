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
  ],
});
