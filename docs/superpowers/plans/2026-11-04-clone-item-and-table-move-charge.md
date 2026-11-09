# Clone an item + the table charge after a move (plan)

> 2026-11-04, planned on main `96520d6` (code read, no code written). Two small jobs, one session. Tier: the table
> charge is money (full checks + one deep review + a mutation pass on the two fences); the clone is UI over the
> existing create route. The owner's bar: accurate, smooth and fast, no lag for the client.

## Owner decisions (AskUserQuestion 2026-11-04)

| # | Decision | Consequence |
|---|---|---|
| T1 | After a move, the NEW table's own charge applies; the cashier's earlier change (lowered or waived) is cleared, and they may change it again on the new table. A table with no charge bills no table charge. | what the screen shows = what the bill charges |
| C1 | The copy button sits in the Menu list, beside each item's edit pencil (table rows and phone cards). It opens the item form already filled (name "Pizza (copy)"); nothing is created until Save. | the U5 list gains one icon per row (owner accepted the small design change) |

## A. The table charge after a move (the bug, read in the code)

- The POS keeps the cashier's table-charge change in `chargeOverride` (apps/cafe/hooks/use-pos-tab.ts:86, `undefined` =
  untouched). `selectTable` clears it (:209-212), but a MOVE goes through `applyTabUpdate` (:255-293), which uses the
  raw `setTable` and never touches `chargeOverride`. Its comments (:262-267, :276) say "a move never touches money" -
  stale: the move route now re-prices the table charge to the destination's own (app/api/orders/[id]/table/route.ts:
  139-161, `withTableCharge(chargesFromOrder(order), tableCharge)`; an unseat or a no-charge table = no table entry).
- Both move paths keep the stale override: the POS's own move (app/(dashboard)/pos/page.tsx:267-269,
  `applyTabUpdate(order, { kot: false, keepUnfired: true })`) and a move made on another device (use-pos-tab.ts:170,
  `keepMoney: moneyEditedSince(...)`, which is true whenever an override exists, lib/pending-writes.ts:268).
- The server then re-creates the line: settle `settleCharges` (lib/settle-charges.ts:15-31) builds a table entry from
  `chargeAmount ?? tableEntry?.amount`, labelled "Table charge" when the tab has no entry; the add-round route does the
  same (app/api/orders/[id]/items/route.ts:171-178). Result: a tab moved from a 50 table (lowered to 20) to a table
  with no charge bills "Table charge 20" while the POS hides the row.
- Create already has the right rule (app/api/orders/route.ts, `table.charge.amount > 0 ? (data.chargeAmount ??
  table.charge.amount) : 0`, via `resolveTableCharge`, lib/table-admin.ts:102).

Fix (T1), two fences:
1. Client: `applyTabUpdate` drops `chargeOverride` when the server's tab comes back on a DIFFERENT table than the one
   this POS held (to/from walk-in included), before and regardless of `keepMoney`. Put the rule in a small pure helper
   (lib/pending-writes.ts or beside it; use-pos-tab.ts is already 546 lines: wiring only, never grow it) and correct
   the two stale comments. The same table (a void, a round, a realtime refresh) keeps the override exactly as today.
2. Server (also covers POS tabs not reloaded since the deploy): on settle and on the add-round route, a sent
   `chargeAmount > 0` adjusts the table charge only when the tab's CURRENT table has a configured charge > 0 (the
   create route's rule, the same `resolveTableCharge` helper: one indexed read, only when `chargeAmount` is sent).
   A walk-in or a no-charge table bills no table charge, whatever an old client sends. `chargeAmount: 0` (a waiver)
   and an omitted `chargeAmount` behave exactly as today.

Tests (failing first): the pure helper (same table keeps; a changed table clears; walk-in to table and back clears);
a source pin that `applyTabUpdate` runs it on both paths; the server fence (unit, then route pins); live cases added to
`scripts/verify-table-move-live.ts` (`npm run verify:table-move:live`): (a) tab at a 50 table, settle after a move to a
no-charge table sending `chargeAmount: 20` (an old tab) bills no table charge; (b) a move to an 80 table, settle without
`chargeAmount` bills 80; (c) on an unmoved 50 table, `chargeAmount: 20` still bills 20 and `0` still waives; (d) the
add-round route the same as (a). Mutation pass (main thread, byte backup, alone): helper never clears; the server
fence removed; the fence applied to `chargeAmount: 0`.

## B. Clone an item (C1)

- The Menu list: table rows apps/cafe/components/menu/ItemsTable.tsx (177 lines; the admin-only edit pencil cell
  :164-170, `title="Edit item"`, `aria-label={`Edit ${product.name}`}`, `MENU_EDIT_CLASS`) and phone cards
  components/menu/ItemCards.tsx (131; a tap opens edit for an admin, :77). The page holds `editing` and opens
  `ProductFormSheet` (app/(dashboard)/products/page.tsx:54-65, :206-209; `product` set = edit, null = create).
- Build: an admin-only copy icon beside the pencil (rows) and on the card (cards), `aria-label={`Copy ${product.name}`}`,
  44 px touch target on the card. It opens the sheet in CREATE mode filled from the source item. The fill builder goes
  in lib/product-form-values.ts (117 lines; the form values builder) - ProductFormSheet.tsx is 292 lines (wiring only).
  Copied: category, price, sizes (variations), discount, photo, icon, add-ons + their amounts, "come ticked", station,
  skip-KOT, QR visibility, available. Name = source name + " (copy)" (no length cap on product names). Never copied:
  `_id`, timestamps, archived state. A stale icon key reads as none (the existing edit rule).
- Save = the existing POST /api/products (admin guard, category check, the add-on amount rule): no new route, no new
  request before Save, nothing created on Cancel.
- The photo is shared by reference, which is safe: removing a photo only clears the field
  (components/shared/ImageUpload.tsx:248-252); nothing in the app calls the image DELETE route.
- Why the " (copy)" name matters: names are not unique (models/Product.ts:112 is a text index only), but the CSV
  import updates by name (app/api/products/import/route.ts, `filter: { name }`), so two items with one name would make
  a later import update only one of them.
- Pins: the U5 menu list is pinned (lib/menu-list-layout.test.ts, lib/menu-items-paths.test.ts, others naming
  `MENU_EDIT_CLASS` / "Edit item"); re-point only what the new icon changes, never weaken an assert.

Tests: the fill builder (every copied field, the name suffix, no `_id`, amounts carried, stale icon dropped); source
pins (icon admin-only in rows and cards, opens create mode with the fill, Save goes through the create hook).

## Verify and ship

Cafe tsc + lint, the touched suites, then the full chain (`/verify-green`: shared, cafe, hub, one at a time), live
legs table-move (with the new cases), orders (order integrity), menu-orders, priced-addons. Browser smoke only if
free RAM allows (check first). One read-only deep review (money: the two fences) -> fix -> owner OK -> demo deploy
ONLY on the owner's OK (posdemo is in client use; never lucifer007; never touch the live DB or demo directly) -> commit
+ push main. No release note needed: an old POS tab is covered by the server fence.

## Results (2026-11-04, built)

> **DONE & VERIFIED 2026-11-04** (s100): main c6cd849 + 1597b17; shared 1051/1051, cafe tsc 0 + lint 0 err + 7432/7432,
> hub 288/288, live table-move 57/0, orders 153/0, menu-orders 9/9, priced-addons 10/10; NOT deployed (owner: commit only).

- A (T1): `chargeOverrideAfterTabUpdate` (lib/pending-writes.ts) clears the cashier's table-charge change in
  `applyTabUpdate` when the server's tab is on another table (walk-in included), before and regardless of `keepMoney`;
  the same table keeps it. Server fence: `fenceTableChargeAmount` inside `settleCharges` (lib/settle-charges.ts) - a
  sent `chargeAmount > 0` bills only while the TAB carries a saved table entry (the source the POS shows,
  hooks/use-pos-charge.ts). The add-round route now builds its charges through `settleCharges` (its inline copy was
  the same logic), so settle, the settle reward gate and add-round share one fenced builder. No DB read.
- Review change (opus, read-only): the plan's fence read the table's LIVE setting (`resolveTableCharge`); the reviewer
  showed a same-table regression (admin zeroes the table's charge mid-tab, the cashier lowers it to 30: the POS shows
  30, the server billed 0, a partial settle 409s forever). Re-keyed to the tab's saved entry; live case (e) pins it.
- B (C1): `copyFormValues` / `formValuesFromProduct` (lib/product-form-values.ts); a Copy button beside the pencil
  (rows) and on the card (44 px, hidden in Select mode); the sheet opens in create mode with the fill.
- Mutation pass (main thread, byte backup, alone): 11/11 killed (helper never/always clears, no normalization, fence
  removed / never fires / fed a constant / hits the waiver, add-round drops the amount, client wiring removed / under
  keepMoney / held = server table).
- DEFERRED (pre-existing, not introduced here): a move made on ANOTHER device while this POS holds the tab open never
  reaches `applyTabUpdate` before this POS's next round (add-round carries no echo), so a stale lowered amount can land
  on a destination that HAS a charge (and a settle after a same-charge move, total unchanged, passes the
  expectedTotal guard). Fix = send what it saw: an optional `expectedTableNo` on addItemsSchema + settleOrderSchema
  (strict, @pos/shared) and drop `chargeAmount` when it differs. Not done now: rare, and a strict-schema field means a
  rollback would 400 every round from tabs that loaded the new JS. Owner to decide.
- Old POS tabs (not reloaded since the deploy) after a move to a no-charge table still hold the stale amount on screen
  while the server bills none: reload the POS once after the deploy.

## Results - the deferred T1 echo (2026-11-05, built)

> **DONE & VERIFIED 2026-11-05** (s101): shared tsc 0 + 1064/1064, cafe tsc 0 + lint 0 err + 7617/7617, hub tsc 0 +
> lint 0 + 288/288, live table-move 72/0 (57 + (f) 9 + (g) 6), orders 153/0; mutation 16/16. NOT deployed: demo deploy
> (T1 + C1 + the echo) only on the owner's OK.

- The echo: an optional `expectedTableNo` on addItemsSchema + settleOrderSchema (`tableNoEchoSchema` =
  `z.string().nullable().optional()`: null = walk-in, omitted = not checked; only compared, never stored, so no name
  rules that could 400 a KOT round). The POS sends `table ?? null` on the round and on the settle (use-pos-tab.ts stays
  at its 546-line budget).
- Add-round: `chargeAmountSeenAt` (lib/settle-charges.ts) drops `chargeAmount` (lowered or waived) when the tab now sits
  at another table, so the new table's own saved charge applies.
- Settle REFUSES instead (TAB_CHANGED 409 via `settleRefusal`, lib/settle-guard.ts): dropping would bill an amount the
  cashier never saw (T1: what the screen shows = what the bill charges). `seenOf` (lib/settle-flow.ts) carries the echo,
  so the 409's re-read is "changed" -> onChanged -> applyTabUpdate clears the override -> the cashier re-settles on the
  new charge. One `sameTable` rule (no table / null / "" = walk-in) for the client fence and the server echo.
- Review (opus, read-only, 2 rounds). MED, confirmed from the code: the echo was checked on the route's READ, but neither
  write's CAS guarded `tableNo` (a move changes neither kotRounds nor voids, nor the total between two same-charge
  tables), so a move landing in flight was still overwritten with the old table's charge (pre-existing for rounds too).
  Fixed: `tableGuardFilter` (lib/order-table-move.ts) - the move's own CAS term, now also in the add-round and settle
  CAS (reciprocal). Re-review: no defects. Live case (g) proves the term against Mongo (witness: without it both
  filters still match the moved tab).
- DEFERRED (pre-existing, no `chargeAmount` involved; owner to decide): the void route's CAS
  (app/api/orders/[id]/items/void/route.ts) and the QR accept add-round (lib/order-request-accept-addround.ts,
  `buildAddRoundFilter`) have the same one-way gap: a move landing inside their window gets the old table's charge or
  total written back. One line each (`...tableGuardFilter(old.tableNo)`); rare.
- ROLLBACK HAZARD (told to the owner): both schemas are `.strict()`. After a Vercel rollback, every POS tab that loaded
  the new JS (and every Phase 5 offline round it kept) sends `expectedTableNo` to the old server and gets a 400 on every
  round and settle until that screen reloads. A forward deploy is safe. After any rollback, reload every POS screen.
- PRE-DEPLOY CHECK (2026-11-05): the demo deploy of main carries a070087..26912d6 (U6, printing Phase 5 + follow-ups, T1,
  C1, the echo). Three read-only reviews found 1 HIGH + 2 MED in Phase 5's offline path (a tab with a round still kept on
  the device could be settled; a may-have-landed replay's Discard said nothing was saved; a kept round put back the
  discount/extras it was taken with): fixed test first, chain re-measured green. Record: the printing Phase 5 plan,
  "The pre-deploy check".

## Results - the deferred void + QR-accept table term (2026-11-09, built)

> **DONE & VERIFIED 2026-11-09** (s111, owner pick after the Settings hub check): cafe tsc 0 + lint 0 err (2 old
> warnings) + 8219/8219; live order-request 247/0 (leg35 new), table-move 72/0, orders 153/0; mutation 9/9; opus
> read-only review: no defects (tree hash same before/after). shared/hub untouched. NOT deployed (the owner deploys).

- The fix: the move's own CAS term `...tableGuardFilter(old.tableNo)` in the void route's CAS
  (app/api/orders/[id]/items/void/route.ts) and in `buildAddRoundFilter` (lib/order-request-accept-core.ts, the QR
  accept's round). Both price from the charges of the table they READ; a move changes neither kotRounds nor voids, so
  before this a move landing between their read and write got the old table's total (void) or charges (QR round)
  written back. Now that write misses: the void 409s "Tab changed", the QR accept goes through guardedReject (replay,
  or the request back to pending). The `Pick` types on the accept path carry `tableNo`. No schema or wire change, so no
  rollback hazard; server only.
- Writers of an open tab's money now all carry the term: add-round, settle (2026-11-05), void, QR accept round, and the
  move itself. Cancel and PUT /api/orders/[id] write no money (review checked).
- Tests (failing first): the reciprocal-CAS pin (lib/table-move-charge-fence.test.ts) now covers the void route and
  the accept builder, and refuses a later `tableNo:` key overriding the term in any of the four filters (mutation M7
  survived the first version of this pin); buildAddRoundFilter's six-term pin (lib/order-request-paths.test.ts); a unit
  test for the seated and walk-in forms (lib/order-request-accept.test.ts); live leg35
  (scripts/verify-order-request-live.ts) drives the accept's own read and the real applyAddRound against a tab moved
  inside the window: RED before the fix (the round landed on the moved tab), green after. leg16's stale read now selects
  tableNo, and the orders live leg's three CAS mirrors (void, round, settle) carry the term, as the routes do.
- Mutation pass (main thread, byte backup, alone): 9/9 killed (term removed / fed undefined / fed a constant /
  overridden by a later key, in the accept builder, the void, the add-round and the settle).
