# Priced add-ons: an add-on (modifier) can carry an amount (plan)

> 2026-11-02, planned on main after `4e322d8`, re-checked on `27507c2`; to be built in the next session. Tier **L** (money, order writes,
> public writes, printing, a cross-app print contract). Owner ask, decisions, design, slices, checks, verify.
> Pre-code review done (one read-only opus reviewer, tree hash before = after): 1 HIGH + 5 MED + 4 LOW, all folded in.

## The owner's ask (verbatim) and decisions

Ask: "menu me item me one new option chhaiye ... modifiers usme amount wala chhaiye, like abhi one client ko demo me
diya tha usko bahut issue aa raha hai cheese brust click kar sakta hai but usme 100 hai like aese multiple aa sakte
hai like kisi me bhi add on ka charge hota hai so hame proper and thoda fast manage karna hoga, review karo all thing
proper understand karo and uske bad proper next session prompt do." Also: nothing uploaded online, no artifacts.

Requirements: R1 a menu item's add-on can carry an amount; R2 picking "Cheese Burst" adds Rs 100 to that line; R3 many
priced add-ons, on any item; R4 accurate and quick; R5 this session = understand + plan + the next session prompt.

| # | Decision (AskUserQuestion, 2026-11-02, all Recommended) | Consequence |
|---|---|---|
| D1 | Bill shows the item line with the full price, and under it "+ Cheese Burst Rs 100" | every bill design, reprints, Settings preview, Orders detail, the diner's bill view; the KOT stays names only |
| D2 | An item's own % discount applies to the item price ONLY; the add-on is charged in full | Pizza 250 at 10% off + Cheese Burst 100 = line 325; the cashier's whole-bill discount is unchanged (whole subtotal) |
| D3 | Amounts only on add-ons the customer ADDS; an item whose add-ons "come ticked" gets no amount option | modifiersPreselected + amounts is refused; the ticked mode keeps meaning "included in the price" |
| D4 | Whole rupees only (Rs 100, Rs 30) | integer sums: the cart, the server check and the bill can never disagree by rounding |

Applies to BOTH the POS and the QR menu: one server price rule. Without the QR side a diner could pick Cheese Burst free.

## What the code does today (inspected 2026-11-02; paths under apps/cafe unless packages/)

- `Product.modifiers: string[]` names only (models/Product.ts:78, product.schema.ts:65); ~119 app files read it.
- ONE price rule: `derivedLinePrice(product, variation)` lib/public-pricing.ts:64 = `effectiveUnitPrice(base,
  discount)` (packages/shared/src/public.ts:83, rounds). Callers: the QR pricer `priceRequestItems` (public
  order-request create :158/:160, diner edit [shortCode] :203/:205, order-request-create.ts:171/:173,
  order-request-accept.ts:145/:147), the staff menu re-check `orderLinesRefusal` -> `judgeLine`
  (lib/order-availability.ts:69-91: builds its product with a hard-coded `modifiers: []` and no `modifiersPreselected`;
  `MenuProductSource` :35-44 has neither; `line.price !== expected` -> 409 "Price changed"), the POS cart notice
  (lib/cart-availability.ts:85), the reward dish (lib/reward-item-line.ts:98; reward lines carry no modifiers).
- The SIX product reads that feed pricing each `.select(...)` a fixed field list (none will carry a new field until
  added): app/api/public/order-request/route.ts:158, app/api/public/order-request/[shortCode]/route.ts:203,
  lib/order-request-create.ts:171, lib/order-request-accept.ts:145, app/api/orders/route.ts:86,
  app/api/orders/[id]/items/route.ts:99. Plus the public menu read app/api/public/menu/route.ts:117.
- Staff path: modifier text is NOT judged (order-availability.ts:23-24, "it carries no price"); the QR path refuses an
  unknown modifier (public-pricing.ts:107-115 UNKNOWN_MODIFIER_ERROR). The cart's "Update them" re-adds a stale line
  with its OLD modifiers (cart-availability.ts:48-56, :141-148).
- POS cart price: hooks/use-cart.ts:188-207 `effectivePrice` of the variation/product; line key :54-67 includes the
  sorted modifiers. `cartItemFromOrderItem` use-cart.ts:88-105 copies stored lines field by field.
- QR cart price: components/public/public-cart-math.ts:37-40 `resolveUnitPrice`, :48 `reconcileCartWithMenu`,
  `buildRepeatCart` -> `computeAddLine` :82/:180 (re-checks removals only, :172-179). The diner never sends a price
  (public-submit.ts:199-209, public-status-edit.ts:129-137).
- QR accept: lib/order-request-accept.ts writes `request.items` (:164-177); `priced.lines` is used only for the drift
  check `:159` (unit price by index -> PRICE_DRIFT_ERROR). Diner edits re-price via priceRequestItems, then
  `items: quote.items` (order-request-edit.ts:77). The diner's bill view: `toStatusItems` order-request-edit.ts:40-56
  -> `PublicStatusItem` (packages/shared/src/public.ts:265) -> `billFromStatusData` (field-by-field copies).
- Storage: the LIVE order model is models/Order.ts (rupee Number; `getOrderModel` returns `conn.models.Order`); the
  paise ledger schema/codec (order.ledger.ts, codec.ts `encodeOrderForWrite`) is NOT on the write path. Follow the
  kotRank precedent: models/Order.ts + models/OrderRequest.ts + types.ts.
- Money everywhere is `price x qty` of the stored line (lib/receipt.ts, reports/items-pipelines.ts:66, money-breakdown,
  orders/summary, order-void.ts:163, Move table app/api/orders/[id]/table/route.ts:169): once `price` includes the
  add-ons, totals, GST, reports, voids, moves and loyalty need NO change. No split/merge route; no customer display or
  Telegram line-price code; the idempotent replay ignores modifiers (packages/shared/src/order-idem.ts:69-78, same key
  = same body).
- Display: `orderItemModifierLines` (packages/shared/src/modifiers.ts:19) renders "NO a, b" / "+ c, d" on EVERY surface
  (KOT, kitchen, bill, cart, diner, void slip), names only. The Orders detail text is `detailLineMeta`
  (lib/order-detail-view.ts:226-228), not OrderDetailBody.tsx.
- Print contract: `printOrderSnapshot` packages/shared/src/print-job.ts:270 (items map :299-314) is a whitelist; the
  snapshot item schema (schemas/print-job.schema.ts:31-59) is `.strict()`, parsed ONLY on the server (print-jobs
  route :36, print-job-insert.ts:48, print-lease.ts:150, print-queue-claim.ts:149, print-direct.ts:82). The host tab
  imports the TYPE only and spreads the snapshot (lib/print-host-slips.ts:146-147): an old open host tab ignores an
  unknown key and prints the line price with "+ Cheese Burst" (no amount); no bill is lost. The void `line`
  sub-object (schema :176-197) is strict too: never spread `modifierPrices` into it (use-pos-print.ts:92-99 copies
  field by field today). Precedent: removedModifiers / reward / note = `.optional()` key + omit-empty pick.
- Product writes that change `modifiers`: POST/PUT through the generic crud route (app/api/products/[id]/route.ts:14,
  lib/crud-route.ts:260-264, plain `findByIdAndUpdate`, no per-entity hook) and the CSV import's `bulkWrite $set`
  upsert (app/api/products/import/route.ts:208-215). The bulk route does not touch modifiers. `updateProductSchema` and
  `importProductRowSchema` derive from `createProductSchema` via `.partial()` / `.omit()` (product.schema.ts:101,
  :130): a cross-field refine on the create schema would break both.
- Products ride the bootstrap (lib/bootstrap-contract.ts:46 `BOOTSTRAP_VERSION = 17`); the bump discards stored device
  data, it does NOT reload open tabs. No stale-build reload exists (lib/chunk-reload.ts only handles a failed chunk).
- Sizes (re-measured after merging the office PC's 30 commits, main 27507c2): ModifierModal.tsx 306 (over the ~300
  cap: split first), OrderReceipt.tsx 301, ProductFormSheet.tsx 279, use-cart.ts 297, order-request-accept.ts 474
  (pre-existing), ModifierInput.tsx 66, PublicItemSheet.tsx 216.
- The office PC's U5 (Menu pages + item editor, owner-approved HTML look) and P1 (perf) landed in 27507c2. They touch
  only UI/perf files: none of the money/server files named here changed. The item editor is now ItemEditorFrame.tsx +
  ProductFormSheet.tsx + lib/product-form-values.ts (the form values builder) + ModifierInput.tsx in the U5 look.
- Hub / workers / apps/desktop: zero reads of modifiers or the snapshot.

## Design

Data (omit-empty, no migration: every existing item and order is unchanged):
- `packages/shared/src/types.ts`: `ProductModifierPrice { name: string; price: number }`.
- `Product.modifierPrices?: ProductModifierPrice[]` - ABSENT = every add-on free; lists only priced add-ons.
- `OrderItem.modifierPrices?: ProductModifierPrice[]` - SERVER-stamped snapshot of the amounts this line was charged
  (priced picks only, sorted by name), so a reprint years later prints what was charged (the GST / note snapshot rule).
  Never client-declared: order.schema.ts gets the kotRank-style fence (no key; test it is stripped).
- Mongoose paths on models/Product.ts, models/Order.ts (line schema), models/OrderRequest.ts (strict:true drops an
  undeclared path - the CB-5B note incident), `default: undefined`. Add `modifierPrices` to ALL SIX pricing
  `.select(...)` lists and the public menu select + DTO literal (lib/public-menu.ts:92-106).

The one price rule (D2): `unit = effectiveUnitPrice(base, discount) + addOnTotal(product, line.modifiers)`.
- New pure shared helpers in packages/shared/src/modifiers.ts: `addOnTotal(product, picked)` and
  `lineModifierPrices(product, picked)` (the stamp). Array lookups only (never keyed objects: a modifier named
  "constructor"); an amount counts only when its name is one of `product.modifiers`; 0 when
  `modifiersPreselected === true`. `derivedLinePrice(product, variation, modifiers = [])` adds it, so the QR pricer,
  the accept re-price, the staff 409 check, the POS cart notice and both carts run the SAME function.
- `MenuProductSource` gains `modifiers`, `modifiersPreselected`, `modifierPrices`; `MenuCheckedLine` gains
  `modifiers`; `judgeLine` passes the REAL product fields and the line's modifiers (not `modifiers: []`).
- Staff path now judges added modifiers like the QR path: a picked add-on the product no longer has is a menu
  refusal (409, new reason "option": "Add-on no longer on the menu: Cheese Burst (Pizza)"), and the cart's Update
  (cart-availability.ts reAddOptsOf) DROPS vanished add-ons before re-adding. Otherwise a removed Cheese Burst would
  be re-sent at the base price and print "+ Cheese Burst" free.
- A line repeating one modifier name is refused 400 on both paths (it would print "+ X, X" and could double charge).
- Stamp: every written line gets `modifierPrices` from the product the writer already read: POST /api/orders, the
  items route, order-request-accept, accept-addround (the 4 writers `withKitchenFlags` covers). The QR pricer puts it
  on `PricedLine`, so a stored request line carries it. Accept drift = unit price differs OR the snapshot differs
  (any amount moved -> PRICE_DRIFT reject), so the request's stamp and the fresh stamp are always equal.
- Product write rule (D3, D4): one pure `productAddOnsError(doc)` (shared): every price `int >= 1 <= VARIATION_PRICE_MAX`,
  unique names, each name in `modifiers`, none when `modifiersPreselected === true`. `createProductSchema` stays a plain
  object (so `.partial()` / `.omit()` keep working); the field schema bounds each entry, the helper judges the pair.
  Applied on the RESULTING doc: create = the body; PUT = stored doc merged with the body (a products-specific pre-write
  check, since crud-route has no hook: S0 picks hook vs own handler), so a bare `{modifiersPreselected:true}` on a
  product with amounts is refused; `null` clears (`nullClearsFields`, the variations precedent). CSV import (names
  only, never sends amounts): prune amounts whose name left `modifiers` in the same write (pipeline `$set` with
  `$filter`, or a read first: S0 picks).

Display (D1): a new `billModifierLines(item)` in modifiers.ts = `orderItemModifierLines` with " Rs N" (the existing
money formatter) after each add-on found in `item.modifierPrices`. Bill surfaces switch to it:
components/pos/OrderReceipt.tsx, print/slip/bill-classic-blocks.tsx, bill-modern-blocks.tsx, bill-themed-blocks.tsx,
lib/order-detail-view.ts `detailLineMeta`, components/public/public-bill-rows.ts (+ `PublicStatusItem` and
`toStatusItems` carry the snapshot). Pickers and carts show amounts: ModifierModal option rows "+Rs 100" with a live
line total, pos-cart-view.ts, PublicItemSheet.tsx, PublicMenuItem.tsx, PublicCartLine.tsx, PublicStatusItemRow.tsx,
orders/OrderRequestCard.tsx. KOT, kitchen screen, void slip, routing and the text KOT keep `orderItemModifierLines` (no
prices on kitchen paper): every KOT golden and the KOT half of the S1 paper pin stay byte-identical. `billLinesOf`'s
key (lib/bill-lines.ts) adds `modifierPrices` SORTED by name (rounds picked [A,B] and [B,A] stay one line). The amount
shown is per item; the line amount is already unit x qty.

Line copies that must carry `modifierPrices` (bill-facing): print-job.ts:299-314 + print-job.schema.ts snapshot item
`.optional()` key, order-request-intake.ts:206-225, order-request-accept.ts:164-177, order-request-edit.ts
`toStatusItems`, use-cart.ts `cartItemFromOrderItem`, the golden fixtures, lib/bill-print-sample.ts (the Settings
preview shows a priced add-on). Must NOT carry it (kitchen-facing): use-pos-print.ts void line, the print-routing void
job, kitchen-board.

Admin UI: components/products/ModifierInput.tsx (66 lines, U5 look: keep it) grows an optional amount per add-on (empty
= free); hidden, and existing amounts flagged, when "Modifiers come ticked" is on. lib/product-form-values.ts carries
`modifierPrices` in and out of the form (absent stays absent; clearing all sends `null`). ProductFormSheet.tsx stays
<= 300 (wiring only). The office PC is rebuilding pages one per session: `git fetch` first and merge before touching
POS / QR screens it may have redone.

Rollout facts (no code; say them in the deploy handover):
- No product has an amount at deploy, so an old open POS tab is fine until an admin sets the first amount. After that
  an old tab prices the base only and gets a 409 it cannot "Update" (its notice runs the old rule). So: after the
  deploy, reload every POS / counter / QR screen BEFORE setting the first amount.
- An old open print host tab prints a priced line's full price with "+ Cheese Burst" and no amount until reloaded.
- Rollback hazard: an older server dismisses stored bill jobs that carry `modifierPrices` ("invalid-payload",
  print-lease.ts:150-155). Clear the amounts before rolling back.

## Slices (next session)

- **S0 Check before writing code** (answered in the pre-code review, see above, except): (a) the product PUT pre-write
  check: a crud-route hook vs products/[id] own handler - pick the smaller; (b) the import prune: pipeline update vs
  read-first; (c) confirm `conn.models.Order` is still registered first (models/Order.ts).
- **S1 shared contract** (first, alone): types.ts, product.schema.ts field bounds + `productAddOnsError` (+tests),
  order.schema.ts fence (+test), modifiers.ts `addOnTotal` / `lineModifierPrices` / `billModifierLines` (+tests),
  print-job.ts snapshot pick + print-job.schema.ts optional key (+parity pins), public.ts `PublicStatusItem`,
  constants.ts.
- Then in parallel on disjoint files:
  - **S2 server money**: public-pricing.ts, order-availability.ts (product source + line modifiers + reason "option"),
    the six selects + the stamp in the 4 writers, accept drift, models (Product, Order, OrderRequest), products routes
    (resulting-doc check, null-clear), import route prune, public menu route + lib/public-menu.ts DTO,
    order-request-intake/edit (toStatusItems), BOOTSTRAP_VERSION 18 (+parity >= 18), live leg.
  - **S3 POS UI**: ModifierInput.tsx + lib/product-form-values.ts (admin amounts), ModifierModal.tsx (split under 300 first, then amounts + live
    total), use-cart.ts (price + cartItemFromOrderItem), cart-availability.ts (line modifiers, drop vanished add-ons on
    Update), pos-cart-view.ts.
  - **S4 QR UI**: PublicItemSheet.tsx, public-cart-math.ts (`resolveUnitPrice`, reconcile, buildRepeatCart drops
    vanished add-ons), PublicMenuItem.tsx, PublicCartLine.tsx, PublicStatusItemRow.tsx, public-bill-rows.ts,
    OrderRequestCard.tsx.
  - **S5 bill paper**: OrderReceipt.tsx, the 3 bill block files, order-detail-view.ts `detailLineMeta`, bill-lines.ts
    key, bill-print-sample.ts, golden fixtures, S1 paper re-pin of the BILL files only.
- Seam pass after the parallel slices (cart price == server price == bill print for the same pick, POS and QR).

## Tests (failing first, then code)

- Unit: price rule (base, variation, discount on item only, two add-ons, ticked item adds 0, repeated name refused,
  orphan amount ignored, "constructor" name), `productAddOnsError` (int, >= 1, unique, subset of modifiers, ticked
  refused) incl. the PUT resulting-doc case, stamp (sorted, omit-empty, never client-declared), judgeLine (priced line
  accepted at the right price, 409 at the old price, reason "option" for a vanished add-on), cart Update drops a
  vanished add-on, cart + diner price == server price for the same picks (shared fixtures), billLinesOf key ([A,B] vs
  [B,A] one line), accept drift on a moved amount with an unchanged unit total.
- Select pins: each of the six pricing reads and the public menu read selects `modifierPrices` (source pin, the HIGH).
- Render: every bill design + legacy shows "+ Cheese Burst Rs 100" under the line; the KOT designs and text KOT do NOT
  (goldens byte-identical); Orders detail (`detailLineMeta`); diner bill rows.
- New live leg `scripts/verify-priced-addons-live.ts` (+ npm script): POS create right price 201 + stamped snapshot;
  base-only price 409; client-sent `modifierPrices` stripped; items route round; QR request priced by the server
  (quoted total includes the add-on) -> accept -> order line; amount changed between request and accept ->
  PRICE_DRIFT reject; ticked product + amounts -> 400 (create AND a bare PUT); repeated modifier -> 400; add-on removed
  from the menu -> staff 409 "option". Drops its scratch DB.
- Re-run legs: variations, removed-modifiers, order-request, menu-orders (+refusals), public-menu, bootstrap,
  print-template, kitchen-order, orders:idem, order-integrity.
- Mutation pass (main thread, byte backup, alone): no add-on sum; discount applied to add-ons; ticked guard off; a
  select without the field; judgeLine with `modifiers: []`; stamp missing; key unsorted / without modifierPrices; KOT
  showing amounts; cart Update keeping a vanished add-on; DTO missing the field.

## Verify and ship

Full `/verify-green` (shared, cafe, hub sequential; tsc + lint per workspace), live legs above, a local smoke only after
a free-RAM check (POS: pick Cheese Burst -> cart Rs 350 -> bill; QR: same), then `/adversarial-review` post-code (lenses:
money accuracy, contract parity + old tabs, spec fidelity) + arbiter + the mutation pass. Deploy: posdemo is in client
use - demo ONLY on the owner's OK for this change after the deep review, with the reload note above; lucifer007 NEVER.
Then commit + push main. Nothing is uploaded anywhere else (no artifacts; the tracker stays a local file).
