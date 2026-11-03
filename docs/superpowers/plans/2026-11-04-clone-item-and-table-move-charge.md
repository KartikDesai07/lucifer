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
