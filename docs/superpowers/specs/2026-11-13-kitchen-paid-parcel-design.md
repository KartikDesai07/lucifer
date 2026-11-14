# Kitchen: a paid Walk-In or parcel order stays until Ready (design, 2026-11-13)

## Intent and why

A client's counter staff take a parcel (takeaway) order, the customer pays at once, and the staff record the payment
with the Pay button. From that moment the order is gone from the Kitchen screen (`/kitchen`) although the kitchen has
not made the food yet, so the cook loses track of an order the customer is waiting for.

The owner's rule (2026-11-13): **a paid Walk-In or parcel order leaves the Kitchen screen when the kitchen taps Ready
on its card. Simple. If nobody taps Ready, it leaves by itself 2 hours after its last kitchen round.**

## How it works today (facts)

- **The POS has no Parcel control.** `buildCreatePayload` in `apps/cafe/hooks/use-pos-tab.ts` never sends `parcel`, and
  no POS component sets it. A parcel taken at the counter is an order with **no table**, which the POS calls
  "Walk-In" (`customerName` defaults to "Walk-In"; `CartHead.tsx`: "Walk-In — no table"). `parcel: true` is written only
  for a customer's QR parcel request (`targetKind === "parcel"`), which also has no table. No later write changes
  `parcel`.
- **The Kitchen screen already groups these two kinds.** `kitchenFilterOf` in `lib/kitchen-header.ts` treats "parcel
  or no table" as one kind, "walkin". A card with no table is labelled "Walk-In" (`lib/kitchen-board.ts`:
  `order.tableNo ?? "Walk-In"`).
- **The Kitchen board shows open tabs only:** `{ status: "Pending", payment: "Unpaid" }` with `kotRounds >= 1`
  (`OPEN_TAB_FILTER` in `lib/token-board.ts`; `GET` in `app/api/kitchen/route.ts`).
- **Tokens ON add a paid arm.** A second arm adds today's PAID token orders until the kitchen marks them Ready, or
  until 120 minutes after their newest kitchen round. See `readKitchenTokenArm` in `lib/token-board-server.ts`, and
  `pendingTokenIds`, `isStalePaidToken` and `TOKEN_STALE_MINUTES` in `lib/token-board.ts`. With tokens OFF there is
  no paid arm.
- **Two counter flows lose the card when tokens are off:**
  1. **KOT first, pay later:** the card is on the board while the tab is open and leaves the moment it is settled.
  2. **Pay Now:** the order is created already paid (`status: "Completed"`, `kotRounds: 1`, KOT round 1 sent to the
     kitchen at creation, `app/api/orders/route.ts`). Its card never appears at all; only the printed KOT reaches the
     kitchen. Pay Now already sends the `order-changed` event the Kitchen screen listens to, so a card for it would
     show straight away.
- **The Kitchen POST is gated the same way.** A line tick, Ready and their undo are refused on a paid order ("That tab
  was settled — its card is already off the board") unless it is today's paid token order.

## Words used below

- **Walk-In or parcel order:** an order whose `tableNo` is absent or null (the board's own "Walk-In" rule,
  `tableNo == null`), or that has `parcel: true`.
- **Paid:** `status: "Completed"`. This is the paid-token rule. A sale with a due part also counts.

## Goals

- **G1.** A paid Walk-In or parcel order of the current business day, with at least one kitchen round, is on the
  Kitchen board until the kitchen taps Ready on its card. It leaves by itself 120 minutes after its newest kitchen
  round if nobody taps Ready. This covers both counter flows and QR parcel orders.
- **G2.** It is the same card as today: Walk-In or PARCEL header, line ticks, Ready, and Ready's undo. They all work on
  it through the existing Kitchen POST.
- **G3.** A cancelled order leaves the board, because its status is no longer `Completed`.
- **G4.** The `readyAt` vs newest-fire rule (`isHiddenByReady`) decides "Ready covers it", as for every card. If the
  kitchen tapped Ready before the payment, the card does not come back after the payment.

## Non-goals (nothing else moves)

- **Orders with a table:** unchanged. A table order still leaves the Kitchen board when it is paid, as today (with
  tokens on, its token rule is unchanged too).
- **The token list, the token board and TV, and `app/api/tokens/[id]`:** unchanged.
- **Everything around the order:** billing, payment, settle, cancel, Pay Now, KOT and bill printing, slip numbers,
  offline KOTs, the POS screens, the apps (mobile, desktop) and workers. All unchanged.
- **Settings:** no new setting or switch.

## Anti-goals (failure even if it "works")

- **A paid table order on the Kitchen board.**
- **A card shown twice.** The open arm, the token arm and the new rule can all hold the same order during a settle, or
  when a Walk-In order has a token.
- **A new cost.** No new kind of HTTP request, no new write, no new timer or cron, and no new index (the owner's ₹0
  rule). `print-budget.test.ts` stays unchanged.
- **A slower or failing Kitchen board.** It may cost one bounded read path more per Kitchen refresh, at most.

## Decisions

### The owner's

- **O1.** The case is the client's: counter staff, a parcel, paid at once with the Pay button.
- **O2.** The card leaves when the kitchen taps Ready ("ready pe click pe remove karo simple").
- **O3.** It applies to **every Walk-In (no table) order**: the counter's parcel and the QR parcel. Table orders stay
  exactly as today. No Parcel button is added to the POS.
- **O4.** If nobody taps Ready, the card leaves **2 hours** after its last kitchen round, the same as paid tokens. It
  reuses `TOKEN_STALE_MINUTES` and the same rule.

### Mine (for the owner to check)

- **C1. Today only.** The rule covers the current business day only. That day starts at `slipDayStart(now,
  token.resetMinutes)`, which the token arm already uses, and bill, KOT and token numbers share that restart time. It
  applies with tokens on or off. A Walk-In paid within 2 hours before the restart time leaves at the restart.
- **C2. Tokens on.** A paid Walk-In or parcel order that also has a token number stays one card. Its token-board
  behaviour does not change.
- **C3. The POST gate.** A tick, a Ready and its undo are accepted on today's paid Walk-In or parcel orders. This
  mirrors the paid-token gate, which also does not check Ready or the 2 hours. Every other order stays refused exactly
  as today.
- **C4. The 60-card board is not re-ranked.** `buildKitchenCards` stays untouched: it is oldest first, cut at
  `KITCHEN_CARD_LIMIT`, and does not know which arm a card came from. The guard against old paid cards pushing new work
  off the board is Ready plus the 2-hour exit, which is what token cafes have today. Residual: a kitchen that never
  taps Ready, on a very busy hour, could fill the board for up to 2 hours.
- **C5. Walk-Ins who eat at the counter.** A Walk-In who eats first and pays at the end keeps a card on the board
  until Ready, or for at most 2 hours after the last round. Nothing reappears if the kitchen already tapped Ready. This
  follows O3.

## Constraints

- **₹0.** No new request kind, write, timer or index. The new read is bounded three ways:
  - by today's `createdAt` range, which uses the existing `createdAt` index;
  - by a scan limit like `TOKEN_DAY_SCAN_LIMIT`;
  - by the board's card cap.
- **The token pins stay as they are.**
  - `kitchenOrderFilter(TOKENS_OFF)` is pinned key for key to `OPEN_TAB_FILTER`.
  - `tokenOrderFilter` and the token route read exactly what they read today.
  - Prefer a separate Walk-In filter or gate over widening `kitchenOrderFilter`, because `tokenOrderFilter` is built
    from it.
- **House rules.** Files stay at 300 lines or fewer. Tests come first. Code, docs and commit messages are in English.
- **Untouched areas.** Nothing in `apps/mobile`, `apps/desktop`, `workers`, the printing renderers or the S1 43-file
  pin changes.

## What the deploy does once

Right after the deploy, some of today's paid Walk-In or parcel orders show on the Kitchen board once: those whose
newest round is under 2 hours old and that were never marked Ready. The kitchen taps Ready, or they leave within
2 hours. This is worth one line in the owner's GO-LIVE note.

## Validation (what "done" means)

### Unit tests (pure)

- The Walk-In filter and gate shapes. `tableNo` absent and null count as Walk-In; a table does not; `parcel: true`
  does.
- Which orders show:
  - Ready hides the card, and a round newer than Ready shows it;
  - 2 hours hides it;
  - yesterday's orders are excluded;
  - paid table, cancelled and `kotRounds: 0` orders are excluded;
  - a skip-KOT-only order (no kitchen lines) shows no card;
  - an order in more than one arm is one card.

### Route source pins

- The Kitchen GET merges the Walk-In arm.
- The Kitchen POST accepts a paid Walk-In or parcel order.
- The token route and the token board are byte-for-byte the same.

### A live leg on a real mongod (scratch DB)

- A Pay Now Walk-In is on the board; Ready hides it; undo brings it back.
- A KOT-first Walk-In stays after settle.
- A QR parcel stays after settle.
- A paid table order is not on the board, and a tick on it is refused.
- A paid Walk-In older than 2 hours is gone.
- With tokens on, a paid Walk-In with a token is one card.
- A cancelled Walk-In is gone.

### The rest

- Every suite and every live leg green.
- A local production build, with `/kitchen` checked in a browser for both counter flows.
- A final review.

## Left to the builder

- Where the code lives: one "paid arm" that serves both tokens and Walk-Ins, or a sibling of `readKitchenTokenArm`.
- File and test names.
- Whether the live checks extend an existing kitchen leg or form a new one.
