# Inventory lite: stock, recipes, wastage, counts, purchases, suppliers (plan)

> 2026-11-10 (s112). Planned on main `0c794d6` (planner agent, code read; no code written). Six slices, one
> session each, each deployable on its own. Slice 1 is **L** (it writes into the settle, cancel and create order
> paths). Slices 2–4 are **M**. Slices 5–6 are **L** (money: supplier dues). The owner's bar: very light on the DB,
> simple, and usable by any business (restaurant, cafe, store, dairy). Never hardcode a cafe name. Plain-English UI
> copy. Dropdowns only (`components/ui/select`, `components/shared/DatePicker`), compact one-line headers.
>
> **Supersedes** `.claude/plan/v2/phase-P9-inventory-procurement.md` §3.2–3.8 for this build (owner ask 2026-11-10:
> lite, not the enterprise P9). P9 remains the reference for its research.

## Owner decisions (2026-11-10, final)

| # | Decision | What it means in code |
|---|---|---|
| D1 | A stock item can be in any unit. A store/dairy item IS its own stock; a restaurant uses recipes. | `Product.stockUse[]` links a menu item to stock items, with optional per-size amounts. "Track this item's own stock" is one tap. |
| D2 | Stock moves only when the bill is settled (or created as Pay Now). It comes back when a settled bill is cancelled. Fewest writes. | No extra write inside the settle CAS. One `bulkWrite` of `$inc` after the CAS wins. No per-sale log documents. |
| D3 | Never block a sale. Stock may go negative. Never change `Product.available`. | Shown red in the list. A pin checks that no inventory code writes `available`. |
| D4 | Purchases (qty, rate, date, supplier), a supplier list with dues, and payments to suppliers. No PO/GRN. | Dues are worked out on read from the entries; there is no stored balance. |

## Verified facts this plan relies on

- **Ways an order becomes Completed: exactly two.**
  - Settle: `app/api/orders/[id]/settle/route.ts`. `settleRefusal` refuses Completed/Cancelled
    (`lib/settle-guard.ts:45-46`). `set.status="Completed"` at :183. CAS filter `status:"Pending"` at :232-244,
    `findOneAndUpdate` at :262. A miss wrote nothing (:266-273). Follow-ups under `allSettled` at :288-292.
  - Pay Now create: `app/api/orders/route.ts`, `status: data.status` at :391, `Order.create` at :512/:565. A twin
    that loses on the send key adopts the winner at :533-536, so follow-ups run once (:589).
- **Nothing else writes `status`**: `updateOrderSchema` is a strict pick of customerName/customerId/tableNo/notes
  (`packages/shared/src/schemas/order.schema.ts:169-172`); void needs `Pending`+`Unpaid` (`items/void/route.ts:52`),
  so a void after settle is impossible; QR accept creates Pending/Unpaid only (`lib/order-request-accept.ts:367-368`);
  `lib/due-payment.ts` never touches Order; create refuses Cancelled (`order.schema.ts:146`).
- **Ways a Completed order is reversed: two.**
  - Cancel: `cancel/route.ts` refuses only `Cancelled` (:45); its CAS is on the status it read (:50-61), so a
    Completed bill can be cancelled, exactly once. Give-backs are swallowed after the CAS lands (:121-187).
  - Admin break-glass `DELETE /api/orders/[id]`: `findByIdAndDelete` returns the doc (:168-169). No UI caller.
- The live Order model is default-bound (`models/Order.ts:391-393`), strict paths (an undeclared path is dropped).
- Products cache: `PRODUCT_LIST` = active products, full docs, no `select` (`lib/masters.ts:43-52`), TTL 20 s
  (`packages/shared/src/cache.ts:28`), per isolate. (`.claude/rules/cafe.md` says 5 min; the shipped value is 20 s.)
- Create's product read is one `$in` with a `.select(...)` string (`orders/route.ts:89-93`), pinned in
  `lib/order-availability-paths.test.ts:23`, `lib/priced-addons-staff-paths.test.ts:20`,
  `lib/removed-modifiers-paths.test.ts:180`.
- Template = Expenses: `models/ExpenseEntry.ts` (Int32 paise, `clientRef` unique :82, soft delete `ACTIVE_EXPENSE`
  :98, TTL guard :102, default-bound); `lib/expenses/entries-write.ts` (clientRef replay :37-82, soft-delete CAS
  :168-183). Nav `AppSidebar.tsx:102`; admin pages `ADMIN_ROUTES` (`packages/shared/src/constants.ts:180-189`); Zod
  schemas in `packages/shared/src/schemas` (re-exported by `apps/cafe/schemas/index.ts`).
- Live-leg kit: `scripts/reward-card-use-live-kit.ts:102-125` (`loadApi` drives the real routes).

## Data model (all default-bound, not federated: the Expense/Area precedent)

- **Units** (`packages/shared/src/inventory.ts`, append-only): `kg, g, L, ml, pcs, packet, box, bottle`. Groups:
  mass {g=1, kg=1000}, volume {ml=1, L=1000}; `pcs`, `packet`, `box`, `bottle` stand alone.
  - Quantities are stored as **integer milli-units of the item's own unit** (`STOCK_QTY_SCALE=1000`): 150 ml of an
    L item = 150; 10 g of a kg item = 10. `qtyToMilli` rounds once at input; `$inc` only adds integers, so
    0.1 + 0.2 L is 100 + 200 = 300 exactly.
  - Mongoose `Number` holding integers, not Int32 (ml stock would overflow Int32 at ~2,147 L).
  - Recipes may use any unit in the same group (converted once at save). Purchases/wastage/counts are in the
    item's own unit. **A unit is fixed once the item is created.**
- **`StockItem`** (`models/StockItem.ts`): `name` (≤60), `unit` (enum), `qty` (milli, default 0), `lowAt?`,
  `lastRatePaise?` (Int32, per one unit), `ownerProductId?`, `archived?`, `v`, timestamps. Index
  `ownerProductId_unique_partial` (unique, partial on `$exists`) makes the one-tap idempotent.
- **`Product.stockUse?`**: `[{ itemId, qty (milli per 1 sold), sizes?: [{name, qty}] }]`, `default: undefined`, set
  only through its own route. Untouched by the CSV import and the product PUT. Existing products byte-identical.
- **`Order.stockUsed?`**: `[{ itemId, qty (milli, min 1) }]`, `default: undefined`: what the sale took out, summed per
  item, sorted by itemId. Written only in the settle CAS `$set` or the Pay Now insert. A cancel adds back exactly
  this, so a recipe edited later never changes the add-back.
- **`StockEntry`** (Slice 4): `kind` ∈ purchase|waste|count|payment, `date` (IST "YYYY-MM-DD"), `lines?`
  `[{itemId, qty (signed milli as applied), counted?, ratePaise?, amountPaise?}]`, `supplierId?`, `totalPaise?`,
  `paidPaise?`, `duePaise?` (signed Int32, omit if 0), `reason?`, `note?`, `createdBy/createdById`, `clientRef`
  (unique), `v`, `deletedAt?/deletedBy?`. Indexes `{date:-1, createdAt:-1}`, `{supplierId:1, date:-1}` (partial).
  TTL forbidden.
- **`Supplier`** (Slice 5): `name`, `phone?`, `note?`, `archived?`, `v`. Dues = `$sum duePaise` over the
  supplier's non-deleted entries (purchase: total − paid; payment: −amount).
- **Cost**: last purchase rate per unit (`lastRatePaise`, "Last bought at ₹X / kg"). Moving average rejected (needs
  on-hand at purchase time; wrong whenever stock is negative or has drifted).
- **Low stock**: `qty ≤ 0` → red "Out" (negative shown "−2 pcs"); `qty ≤ lowAt` → amber "Low". Sort Out, Low, OK,
  then name. Worked out on read.
- **Bytes/year** (busy: 300 bills/day, 4 stock items/bill, 10 manual entries/day): `stockUsed` ≈ 176 B/bill ≈
  **19 MB/yr** (only at outlets that link products); StockEntry ≈ 1.1 MB + ~0.5 MB indexes; StockItem +
  `Product.stockUse` ≈ 50 KB.

## Settle deduct and cancel add-back

- **Settle**: after the money refusals (:146), start `stockUsedForSale(old.items)`. It never rejects; a read error
  gives `undefined` (no deduct, the sale goes through: D3). Cached `"products"` list first; ids missing there
  (archived items on an open tab, cold cache) get ONE read `Product.find({_id:{$in:missing}, stockUse:{$exists:true}})
  .select("stockUse").lean()`. Before the CAS: `Object.assign(set, stockUsedFields(await stockUsedP))`; no extra
  write. After the CAS wins, `runSettleFollowUps` runs `deps.moveStock(updated.stockUsed, -1)`: one unordered
  `bulkWrite` inside the existing `allSettled`.
- **Pay Now**: add `stockUse` to the product read's select (no extra read). `stockUsedForSale(rewardItems,
  products)` only when `data.status === "Completed"`; only the free reward dish can fall back to the targeted read.
  The insert doc carries it; `runCreateFollowUps` does the −1 move.
- **Cancel**: after the CAS lands, `if (old.status === "Completed" && updated.stockUsed?.length) await
  addBackStockQuietly(updated.stockUsed)`, swallowed like the card/points give-backs. **DELETE**: same, on `deleted`.
- **Exactly once**: the deduct rides the one CAS win (Pending→Completed) or the one insert (send key + orderId
  unique). The add-back rides the one cancel/delete win; a repeat cancel gets 409.
- **Failure behaviour** (never revert on a throw): a `bulkWrite` that throws after the win, or an insert that throws
  but may have committed, loses that bill's deduct (a later cancel would over-credit it). Rare, one bill, and **a
  Count fixes it**. A recipe linked on one isolate can be missed for ≤20 s on another (cache TTL).

| Event | Stock | `stockUsed` |
|---|---|---|
| Open tab: create, rounds, voids, moves, PUT, QR accept | none | none |
| Settle CAS wins | −snapshot (after the win) | set in the same `$set` |
| Settle refused, or CAS miss/409 | none | not written |
| Pay Now insert lands (once, incl. the orderId retry) | −snapshot | in the insert doc |
| Send-key twin or replay | none | none |
| Settled bill cancelled | +snapshot | kept as the record |
| Open tab cancelled, or a repeat cancel | none | none |
| Admin DELETE of a settled bill | +snapshot | gone with the doc |
| Dues payments, reopen, void after settle | not possible / none | none |

## Slice 1: stock core in settle, create and cancel (L), branch `feat/inventory-core`

Create:
- `packages/shared/src/inventory.ts`: units (`STOCK_UNITS`, `StockUnit`, `isStockUnit`, `STOCK_UNIT_GROUP`,
  `STOCK_UNIT_FACTOR`, `STOCK_UNIT_LABEL`); codec (`STOCK_QTY_SCALE`, `qtyToMilli`, `milliToQty`,
  `convertToMilli(qty, from, to): number | null`, `compatibleUnits`, `formatQty(milli, unit)`: "1.25 kg"; under
  1 kg/L shows g/ml); `stockLevel(qty, lowAt?)`, `STOCK_USE_MAX_LINES=10`, `STOCK_ITEM_NAME_MAX_LEN=60`. ≤300 lines.
- `packages/shared/src/inventory.test.ts`; append to the shared `package.json` `test` string.
- `apps/cafe/models/StockItem.ts` (`mongoose.models.StockItem ?? model`).
- `apps/cafe/lib/inventory/stock-use.ts`: `stockUsedOf(items, links)` (pure: sums per item; a line with `variation`
  uses `sizes.find(name===variation)?.qty ?? qty`; skips 0; includes reward lines; empty → `undefined`);
  `stockUsedFields(used)`; `StockLinkDeps {cachedProducts, findLinks}` + `STOCK_LINK_DEPS`;
  `stockUsedForSale(items, known?, deps)` (cache, then missing ids, then one read; catches everything).
- `apps/cafe/lib/inventory/stock-move.ts`: `moveStock(used, sign)` (one `StockItem.bulkWrite(updateOne $inc,
  {ordered:false})`), `addBackStockQuietly(used)`.
- Tests: `lib/inventory/stock-use.test.ts` (pure + fake deps: cache hit, partial hit, cold, throw → undefined);
  `lib/inventory/inventory-core-paths.test.ts` (source pins via `lib/source-pin-utils.ts`, needles concatenated, each
  negative pin with a positive landmark); `models/inventory-models.test.ts` (index shape; enum rejects `"kgs"`; a
  Product/Order saved without the new fields has no key in `toObject()`; `stockUsed.qty` min 1).
- `apps/cafe/scripts/verify-inventory-live.ts` (reuses `loadApi` + auth stub from
  `scripts/reward-card-use-live-kit.ts`; DB `pos_scratch_inventory`, prefix-guarded, drops only that DB) +
  `"verify:inventory:live"` in `apps/cafe/package.json`.

Edit:
- `models/Product.ts`: `IProduct.stockUse?` + `{_id:false}` sub-schema, `default: undefined` (sizes too).
- `models/Order.ts`: `IOrder.stockUsed?` + sub-schema, `default: undefined`, strict-path comment.
- `app/api/orders/[id]/settle/route.ts`: import + 2 lines (start after :146; `Object.assign(set, …)` after :223).
- `lib/settle-followups.ts`: dep `moveStock`, `stockUsed?` on `SettledTab`, a fifth `allSettled` task, header
  "four" → "five". `lib/settle-followups.test.ts`: `moveStock` in `fakeDeps`.
- `app/api/orders/route.ts`: ` stockUse` in the select (:91); `const stockUsed = data.status === "Completed" ? await
  stockUsedForSale(rewardItems, products) : undefined;` before :357; `...stockUsedFields(stockUsed),` in
  `unnumberedDoc`.
- `app/api/orders/[id]/items/route.ts`: same select (keeps the three pins' "one read" meaning).
- `lib/order-create-followups.ts` + test: dep `moveStock`, `landed.stockUsed?`; moves only when
  `landed.status === Completed`.
- `app/api/orders/[id]/cancel/route.ts`: add-back after the points block (:187).
- `app/api/orders/[id]/route.ts` DELETE: add-back after :169.
- The three select pins: move the constant on purpose. Every new test into `testChain`.
- Check `billPrintJob` builds a whitelisted payload (`lib/print-order-jobs.ts:146`); if it spreads the order,
  leave `stockUsed` out.

Pins (`inventory-core-paths.test.ts`): `stockUsedFields(` after `const set` and before
`Order.findOneAndUpdate(filter`; the create call gated on `data.status === "Completed"`; the cancel add-back after
`if (!updated) return failure(` and gated on `old.status === "Completed"`; the DELETE add-back after `if (!deleted)`;
writer census (`stockUsedFields(` only in settle + create routes; `moveStock(`/`addBackStockQuietly(` only in the two
follow-up files and the cancel/DELETE routes); no `available` write under `lib/inventory/**` or `models/StockItem.ts`;
`PRODUCT_LIST` has no `select`; `lib/public-menu.ts` never mentions `stockUse` (landmark `toPublicMenuItem`).

Live cases: (a) seed Milk (L, 10 L), Sugar (kg), Chips (pcs); Chai = 150 ml milk + 10 g sugar, Large = 250 ml milk;
(b) open tab + round + void: no change; (c) settle: exact deltas, `stockUsed` read raw; (d) second settle 409,
unchanged; (e) two concurrent settles move once; (f) cancel restores; second cancel 409, unchanged; (g) Pay Now −3
Chips; send-key replay unchanged; (h) cancel an open tab: no change; (i) unlinked product: no `stockUsed` key;
(j) sell past zero: 200, qty negative, `available` unchanged; (k) recipe edited between settle and cancel: the
snapshot comes back; (l) Int32 overflow probe; (m) DELETE of a settled bill adds back, of a cancelled bill doesn't;
(n) warm cache via GET `/api/products`, then settle: same result.

Verify (one at a time): `packages/shared` `npx tsc --noEmit`, `npm test`; `apps/cafe` `npx tsc --noEmit`,
`npm run lint`, new + touched suites, `npm test`; live `verify:inventory:live`, then `verify:orders:live`,
`verify:orders:idem:live`, `verify:reward-card-use:live`, `verify:table-move:live`, `verify:menu-orders:live`;
`/verify-green`, `/adversarial-review` (diff file + HEAD copies), arbiter, mutation pass (main thread, byte backup,
alone). Mutants: fields moved after the CAS; sign flipped; cancel gate dropped; add-back re-derived from current
recipes; size override ignored; sum → overwrite; Pay Now gate removed; `stockUsedForSale` rethrowing.

## Slice 2: Inventory page and stock items (M)

- Shared `packages/shared/src/schemas/inventory.schema.ts` (exported from `schemas/index.ts`):
  `createStockItemSchema` {name, unit, openingQty?, lowAt?} `.strict()`; `updateStockItemSchema` {name?, lowAt?:
  number|null, archived?} `.strict()` (no unit). Test appended to the shared test string.
- Server: `lib/inventory/items.ts` (DTO with integer `qtyMilli`/`lowAtMilli`/`lastRatePaise`; client formats via
  `@pos/shared/inventory`); `app/api/inventory/items/route.ts` (GET any signed-in user, all active, cap
  `STOCK_ITEMS_MAX=500`, no pagination; POST admin-only, refuses a duplicate active name);
  `app/api/inventory/items/[id]/route.ts` (PATCH admin-only; `null` lowAt → `$unset`).
- Client: `types/inventory.ts`; `hooks/use-inventory.ts` (`useStockItems` `["inventory","items"]`, 30 s, refetch on
  focus; `useCreateStockItem`, `useUpdateStockItem`); `lib/inventory/stock-view.ts` + test (sort, level → tokens);
  `app/(dashboard)/inventory/page.tsx` → `components/inventory/InventoryView.tsx` (one-line header, "Add stock item"
  admin, Skeleton, guided empty state "Add your first stock item, then open Menu, edit an item and set its Stock
  use"); `StockList.tsx` (card look: `SETTINGS_CARD_CLASS` / `SETTINGS_LIST_ROW_*` from
  `lib/settings-card-layout.ts`, red/amber badges); `StockItemSheet.tsx` (unit Select at create only, opening stock,
  low level, archive).
- Wiring: `AppSidebar.tsx` Manage `{ title: "Inventory", url: "/inventory", icon: Boxes }` after Menu;
  `lib/page-titles.ts` `"/inventory"`. Move pins on purpose: `lib/tab-bar-paths.test.ts:87`,
  `lib/nav-skeleton.test.ts` (row "list").
- Pins `lib/inventory/inventory-ui-paths.test.ts`: admin gates; every sheet button `type="button"` or the submit; no
  native date/number input needles.
- Live: staff GET 200, POST 403; PATCH with `unit` → 400; `lowAt:null` unsets.

## Slice 3: "Stock use" in the item editor (M)

- Shared: `stockUseSchema` {lines:[{itemId, qty>0, unit, sizes?:[{name, qty≥0}]}] ≤10, unique itemId} `.strict()`
  (`lines: []` clears); `ownStockSchema` {unit default "pcs"}.
- `lib/inventory/stock-use-write.ts` (fake deps): `setStockUse` (one `$in` read of the stock items; a unit from
  another group → 400 "Pick a unit that fits Milk (L)"; `$set`, or `$unset` when empty); `trackOwnStock` (upsert a
  StockItem by `ownerProductId` with `$setOnInsert` only, re-read on E11000; then `Product.updateOne({_id,
  stockUse:{$exists:false}}, {$set:{stockUse:[{itemId, qty:1000}]}})`; a miss already holding the own link = 200
  replay; any other miss = 409 "This item already uses stock").
- Routes: `app/api/products/[id]/stock-use/route.ts` (GET/PUT admin-only, then `cache.del("products")`);
  `app/api/products/[id]/stock-use/own/route.ts` (POST admin-only). Separate routes on purpose: product schemas
  untouched; after a rollback they 404.
- Client: `hooks/use-stock-use.ts` (fresh GET staleTime 0; invalidates `["stock-use",id]`, `["products"]`,
  `["inventory","items"]`); `lib/inventory/stock-use-form.ts` + test (rows ↔ request; size rows from
  `product.variations`; drop sizes the product no longer has); `components/products/StockUseField.tsx` (row per
  link: item Select, amount `inputMode="decimal"`, unit Select from `compatibleUnits`, "Different amount per size";
  "+ Add stock item", "Track this item's own stock" (unit Select, one tap); "Save stock use" `type="button"`,
  disabled while pending/unchanged, hint "Saved separately from the item details"; create mode hint "Save the item
  first, then set its stock use here.").
- Wiring: `components/products/ProductFormSheet.tsx` `{product && <StockUseField product={product} />}` before the
  archive link (:266).
- Live: 150 ml vs an L item stores 150; g recipe vs L item → 400; `lines:[]` leaves no key; two concurrent one-taps →
  one StockItem linked once; end to end a real Pay Now takes 1 pcs.

## Slice 4: wastage, counts, entries list, delete (M)

- `models/StockEntry.ts` (all four kinds declared now) + model tests (indexes, TTL guard, enum).
- Shared `createStockEntrySchema` = `z.discriminatedUnion("kind", [waste{itemId, qty>0, reason, date, note?,
  clientRef}, count{itemId, counted, date, note?, clientRef}])`, `.strict()` members; `WASTE_REASONS` = Spoiled,
  Spilled or broken, Staff meal, Other.
- `lib/inventory/entries-write.ts` (expense `clientRef` replay pattern): waste = insert then `moveStock(−)`; count =
  `findOneAndUpdate({_id},{$set:{qty:counted}},{new:false})`, before-image gives the delta, insert
  `lines:[{itemId, qty:delta, counted}]` (a retry records delta 0, stock stays right); delete = soft-delete CAS
  `{_id, deletedAt:{$exists:false}}`, then reverse the lines once. `$inc` throw after insert → 500 "Saved, but the
  stock number may be off — count this item".
- `lib/inventory/entries-read.ts`: newest first, `limit ≤ 50`, `before` cursor.
- Routes: `app/api/inventory/entries/route.ts` (GET admin; POST `waste` any signed-in user per F1, `count` admin);
  `app/api/inventory/entries/[id]/route.ts` (DELETE admin).
- UI: `StockAdjustSheet.tsx` (waste|count, item's unit, DatePicker); `EntryList.tsx` (admin, Dialog confirm delete).
  Header actions "Log wastage", "Count stock" (admin) + per-row actions.
- Live: wastage; count records its delta; two concurrent deletes reverse once; same `clientRef` doesn't add twice;
  staff count → 403.

## Slice 5: suppliers and purchases (L, money)

- `models/Supplier.ts`. Shared supplier schemas; purchase member {supplierId?, date, lines 1..20 (unique items,
  qty>0, ratePaise int), paidPaise int, note?, clientRef}; `purchaseLineAmountPaise(qtyMilli, ratePaise) =
  Math.round(qtyMilli*ratePaise/1000)` + `purchaseTotalPaise` in `inventory.ts` (the client preview uses the same).
  Bounds keep math under 2^53 and Int32 (qty ≤ 100,000 units; total ≤ named `STOCK_ENTRY_MAX_TOTAL_PAISE`).
- Write: server computes amounts; paid > total → 400; due > 0 needs an active supplier; insert, then ONE `bulkWrite`
  per line `{$inc:{qty}, $set:{lastRatePaise}}`; deleting a purchase removes both its stock and its due.
- `lib/inventory/suppliers.ts`: `Supplier.find` + one `StockEntry.aggregate` ($match supplierId exists, not
  deleted, duePaise exists → $group $sum).
- Routes `app/api/inventory/suppliers/route.ts` (GET/POST) + `[id]/route.ts` (PATCH), admin-only.
- UI: `PurchaseSheet.tsx` (optional supplier Select, line rows + live total, "Paid now: Full / Part / Nothing", hint
  "Not added to Expenses"); `app/(dashboard)/inventory/suppliers/page.tsx` → `SuppliersView.tsx` (dues red when > 0),
  `SupplierSheet.tsx`. Header "Add purchase", "Suppliers"; `"/inventory/suppliers"` in `ADMIN_ROUTES`; page title.

## Slice 6: pay a supplier and supplier history (L, money, small)

- Payment member {supplierId, amountPaise>0, date, note?, clientRef}; stored `totalPaise = amount`,
  `duePaise = −amount`. Overpaying allowed ("Paid ₹X in advance"). `SupplierPaySheet.tsx`; supplier row → history
  (`useStockEntries({supplierId})`); deleting a payment restores the due.
- Live: payment lowers the due, delete restores it, replay doesn't pay twice.

## Rollback and risks

- No existing request schema changes (create/settle/update/product untouched) → no rollback 400s. New routes 404
  after a rollback; new strict schemas only on new routes.
- `stockUsed`/`stockUse` are forward-only, omit-empty, ignored by old code (writes are `$set`, never `replaceOne`).
- After a rollback, settles stop deducting and cancels stop adding back; a Count fixes it.
- Emergency lever: unlink the item's stock use (Slice 3), or revert Slice 1's three call lines.
- A cold cache costs every settle one more read (overlaps the customer read and the claims); measured in live (n).

## Owner forks (decided 2026-11-10, s112: all three as recommended)

- **F1 Staff rights = (a)**: staff see stock and log wastage; purchase, count, suppliers and payments are admin.
- **F2 What the order stores = the exact `stockUsed` snapshot** (~19 MB/yr busy; exact add-back; a usage report
  later needs no log). Not the `stockOut:true` flag.
- **F3 Purchases and supplier payments stay out of Expenses** (nothing counted twice).

## Results

### Slice 1: stock core in settle, create and cancel (s112, 2026-11-10): DONE

- Built as planned, with three agents on disjoint files (shared codec, cafe core, live leg) and the main thread
  integrating. `packages/shared/src/inventory.ts` (150 lines), `models/StockItem.ts`, `lib/inventory/stock-use.ts`,
  `lib/inventory/stock-move.ts`, `Product.stockUse?`, `Order.stockUsed?`. Settle (+2 lines), Pay Now create, cancel and
  admin DELETE are wired; the create/items product select gains ` stockUse` (the three select pins moved on purpose).
- Verified facts the build added: a void shrinks `items` (`lib/order-void.ts:138-141`), so the snapshot counts only
  what was sold. The products cache is a plain per-isolate LRU (20 s), not a versioned blob, so there's no version bump;
  the snapshot only peeks it. `billPrintJob` goes through the `printOrderSnapshot` whitelist, so `stockUsed` never
  reaches a print job. Line-budget pins in `lib/reward-points-paths.test.ts` (settle ≤330, create ≤635) are met by
  re-wrapping existing comments (same words).
- **Deviation from the plan (main thread):** the cancel add-back is the FIRST statement in the post-CAS try, before
  `reconcileLedger`, not after the points block. A ledger throw there answers 500, and the retry meets the "already
  cancelled" 409, so the add-back placed after it could be skipped for good. It swallows its own failure. Pinned.
- Review (2 opus lenses: races/failure modes; spec/data/pins) found no HIGH. Tree hash before = after (`2c041155`).
  Findings were checked against live probes on the scratch mongod (evidence class: live probe):
  - LOW confirmed: a malformed `itemId` in a stock link made the settle `$set` throw a CastError (bill stays Pending
    = a blocked sale, against D3). Fix: `stockUsedOf` skips a link whose id is not an ObjectId/24-hex (repro test
    first, RED then green).
  - MED (test quality) confirmed: live case (l) started from a double, so it could never see an int32 wrap. Probe:
    a stored 10000 is BSON int32; `$inc` past 2^31 promotes it to a long, exact. Case (l) now starts from an int32
    just under the edge and asserts the value and the "long" type.
  - LOW confirmed: nothing proved the `ownerProductId_unique_partial` index in the DB. New live case (o): the index
    is unique + partial, and a second own-stock row is E11000.
  - Fix round: fresh-eyes opus review, no defects.
- Mutation pass (main thread, alone, byte backup, restore verified by sha1): 12/12 killed: snapshot never stored,
  sign flipped, cancel gate dropped, cancel re-derived from today's recipe, size override ignored, sum → overwrite,
  Pay Now gate removed, `stockUsedForSale` rethrows, malformed-id skip removed, DELETE gate dropped, settle follow-up
  never moves, cancel add-back moved back after the ledger.
- Chain: shared tsc 0 + 1090/1090; cafe tsc 0, lint 0 errors (2 old warnings in `lib/masters-blob.test.ts`),
  8255/8255 (re-measured after the fix round); hub tsc 0, lint 0, 288/288. Live: inventory 15/15 (a–o), orders 153, orders idem 35, reward card use
  48, table move 72, menu orders 9/9.
- Rollback: no request schema changed; `stockUse`/`stockUsed` are omit-empty and ignored by older code. Inert until
  a product is linked (Slice 3 adds the UI); nothing a client sees changes yet.
- Seen, not fixed (pre-existing, out of scope): in `cancel/route.ts` the stamp / scratch-card / points give-backs
  run AFTER `reconcileLedger` in the same try, so a ledger throw skips them and the retry's 409 keeps them skipped.
  Owner call whether to move them up like the stock add-back.
- **Next = Slice 2** (Inventory page + stock items, M).

### Slice 2: Inventory page and stock items (s113, 2026-11-10 to 11-12): DONE

- Built with two implementers on separate files (server; page + nav). The main thread wrote the contract first
  (`schemas/inventory.schema.ts`, `types/inventory.ts`, `STOCK_ITEMS_MAX` / `STOCK_QTY_MAX` in `inventory.ts`) and
  did the integration. Server: `lib/inventory/items.ts`, `app/api/inventory/items/route.ts` (GET any signed-in
  user, POST admin), `app/api/inventory/items/[id]/route.ts` (PATCH admin, no DELETE). Client: `hooks/use-inventory.ts`,
  `lib/inventory/stock-view.ts`, `lib/inventory/stock-item-form.ts`, `app/(dashboard)/inventory/page.tsx`,
  `components/inventory/{InventoryView,StockList,StockItemSheet}.tsx`. The sheet reuses the item editor's frame. The
  Inventory nav row sits under Menu, open to every role.
- **Deviations from the plan text (main thread):**
  - The request keys are `openingQtyMilli` / `lowAtMilli` (integer milli-units), not `openingQty` / `lowAt`, so no
    float reaches the server (the `amountPaise` precedent).
  - `archived` can only be set to `true`; nothing restores an item yet.
  - Staff GET leaves out `lastRatePaise` (it is a cost).
  - A PATCH only matches an ACTIVE item, so editing an item archived meanwhile is a 404.
  - The empty state doesn't mention "Stock use" yet, because that editor ships in Slice 3. Slice 3 updates the copy.
  - The list uses the Settings hub card rows, not a table.
  - The AppSidebar Expenses comment went from 2 lines to 1, so the file stays at its 306-line cap.
- Review: one opus reviewer found no HIGH or MED. Three LOWs, all fixed:
  - A PATCH of an archived item answered 200 and wrote to it. The live repro went RED first; the fix is
    `{ _id, ...ACTIVE }` plus a pin.
  - The staff-POST live case didn't prove that nothing was written.
  - The sidebar cap had been raised. It is now held instead.
  - The fresh-eyes check of the fix round found no defects.
- Mutation pass (main thread, alone, byte backup, sha1 restore, tree hash the same before and after): 14/14 killed
  after one pin fix. The miss was "unit picker shown on edit": the needle `isEdit ? (` also matched the flipped
  `!isEdit ? (`. It is now anchored on `{`.
- Chain on merged main (origin/main 4bd357c, printing Phase 6, merged in):
  - shared: tsc 0, 1097/1097
  - cafe: tsc 0, lint 0 errors (2 old warnings), 8423/8423
  - hub: tsc 0, lint 0, 288/288
  - live: `verify:inventory:items:live` 26/26 (new), `verify:inventory:live` 15/15
- Not done: a browser smoke (low RAM). The owner checks the page on a phone, a tablet and the PC after deploying.
- Rollback: new routes and a new page only; no existing request schema changed. After a rollback, `/inventory` and
  its API 404, and the stock items stay in the DB untouched.
- **Owner decision (s113):** move the cancel route's stamp / scratch-card / points give-backs BEFORE
  `reconcileLedger`, like the stock add-back ("Seen, not fixed" above). This is a separate Tier L fix, done next,
  before Slice 3.
- **Next =** the cancel give-backs fix (L), then Slice 3 (Stock use in the item editor, M).

### Cancel give-backs fix (s114, 2026-11-12): DONE

- Owner decision (s113): give the stamps, the scratch card and the points back BEFORE `reconcileLedger`, like the
  stock add-back. Before this, a ledger throw answered 500 after the cancel had landed, the retry met the "already
  cancelled" 409, and those rewards stayed spent forever.
- Change: `app/api/orders/[id]/cancel/route.ts` now runs the stock add-back, then stamps, then card, then points, and
  only then the ledger reversal. Each give-back still swallows its own failure. The ledger, the table free and the
  cache drops follow, and the publish stays in the `finally`. No request or response shape changed.
- Test first: new live legs k1-k3 (`scripts/reward-card-use-live-legs-cancel.ts`, run by
  `verify:reward-card-use:live`). Each settles a stamp, card or points bill, then makes `Customer.findByIdAndUpdate`
  reject for the ledger's `$inc` of `visits` only (no give-back uses that method). It cancels and expects a 500, the
  order Cancelled, the ledger untouched, a retry 409, and the reward given back. All three went RED on the old
  route, failing on the give-back assertion only; GREEN after.
- Pins: the inventory `PIN cancel` asserts add-back < stamps < card < points < ledger. The ledger and each give-back
  block sit at the follow-ups' own brace depth: not nested, and the ledger is not inside a swallowing try. Exactly one
  `reconcileLedger(` call. The realtime pin's cancel `first` landmark is now the stock add-back.
- Mutation pass (main thread, alone, byte backup, sha1 restore matched, tree diff hash the same): 6 of 7 killed. The
  survivor moves the ledger below the table free. That is allowed: every give-back is still before the ledger, and
  it would even free the table on a ledger throw.
- Review: one opus reviewer found no defects. It checked that the ledger and the give-backs touch different fields
  (clampLedger only sets visits / totalSpend / totalDue; the give-backs use `updateOne`; Customer has no hooks), the
  comment directions, that k1-k3 cannot pass without proving anything, the pin anchoring, and the Unpaid, reassigned
  and no-customer cancels.
- Live: card-use 51/51 (k1-k3 new), points 20/20, inventory 15/15, orders 153/153, reward-redeem 26/26, reward-assign
  22/22, reward-progress 17/17. Pin suites touching the route: 204/204.
- Seen, not fixed (owner call): a ledger throw still skips the table free and the summary cache drops. The table then
  stays Occupied, pointing at a cancelled order, until someone frees it by hand. Moving the table free above the
  ledger is the same kind of one-line move.
- Rollback: statement order only; a revert puts back the old order.
- **Next =** Slice 3 (Stock use in the item editor, M).

### Slice 3: "Stock use" in the item editor (s115, 2026-11-12 to 11-13): DONE

- Built with two implementers on separate files (server; UI). The main thread wrote the contract first:
  `convertMilli` (`packages/shared/src/inventory.ts`), `stockUseSchema` / `ownStockSchema`
  (`schemas/inventory.schema.ts`), `StockUseDto` (`types/inventory.ts`) and the `package.json` test/script entries.
  - Server: `lib/inventory/stock-use-write.ts` (`getStockUse`, `setStockUse`, `trackOwnStock` over injected ports),
    `app/api/products/[id]/stock-use/route.ts` (GET, PUT) and `.../stock-use/own/route.ts` (POST). All three are
    admin-only and clear the products cache after a write.
  - Client: `hooks/use-stock-use.ts`, `lib/inventory/stock-use-form.ts`,
    `components/products/{StockUseField,StockUseRow}.tsx`, wired into `ProductFormSheet.tsx` before the archive link.
    The Inventory empty state now points at Stock use.
- **Deviations from the plan text (main thread):**
  - A line carries `qtyMilli` in the unit the person TYPED (any unit of the item's group), not a float `qty`. The
    server converts once with `convertMilli` (integer × integer ÷ integer, one rounding): the `amountPaise` precedent.
  - The GET returns each linked item's name and unit, and flags an archived one. A link whose item no longer exists
    is left out.
  - A PUT refuses an archived or missing stock item, a size name the menu item doesn't have, an amount that converts
    to 0 (the line, or a size typed above 0), and one over the cap.
  - The one tap refuses an item that already uses stock (409), a duplicate active name (409; it says to pick the
    existing item instead) and the 500-item cap. It restores an archived own item and checks that item's stored name.
  - The own-stock upsert awaits `modelReady(StockItem)` (the office PC's model-init hotfix, merged this session);
    `lib/model-ready-pins.test.ts` now lists 13 sites.
  - The editor shows a stored amount in a unit that reads well (150 milli-L as "150 ml"). Turning "Different amount
    per size" on starts every size at the row's amount.
  - The field renders for admins only (staff can open the menu editor). Its Inventory link is an `AppLink` that
    closes the sheet (R34).
- Review: one opus reviewer found two LOWs, both confirmed in code:
  - A size typed above 0 that converted to 0 was stored silently as "uses none". Repro test RED first, fixed.
  - A one tap that loses its claim to a recipe saved in the same instant answers 409 with the own item already made.
    **Accepted residual**, the items.ts kind, commented in place: the item is unlinked, visible and can be archived,
    and a later tap reuses it.
- Main-thread fixes after the review: the restore path checks the restored name (test RED on the old code); the size
  inputs' ids no longer embed the size name; the editor is keyed by item; the AppLink / R34 fix. Pins moved on
  purpose: `inventory-items-paths` (the own-stock upsert may `findOneAndUpdate`; create stays items.ts only) and
  `model-ready-pins` (13 sites).
- Mutation pass (main thread, alone, byte backup, sha1 restore, tree hash the same before and after): 13 of 13
  killed, plus the `modelReady` site (1 of 1). Mutants: CAS filter dropped, no unit conversion, empty list stored as
  `[]`, size-name check removed, archived item accepted, a size rounding to 0 accepted, replay treated as busy, PUT
  skips the cache clear, GET open to staff, form drops sizes, display unit never shrinks, Enter guard removed, link
  doesn't close the sheet.
- Chain on the merged tree (origin/main 768c486, the model-init hotfix, merged in), run from an `F:` working directory:
  - shared: tsc 0, 1103/1103
  - cafe: tsc 0, lint 0 errors (2 old warnings), 8478/8478
  - hub: tsc 0, lint 0, 288/288 (measured this session; hub untouched by both sides)
  - live: `verify:inventory:stock-use:live` 12/12 (new), `verify:inventory:live` 15/15, `verify:inventory:items:live`
    26/26, `verify:model-ready:live` 14/14, `verify:orders:live` 153/153
- Seen, not fixed (environment, not code): run from a lowercase `f:` working directory (this VS Code session), the
  chain fails `TodayReservations` in `lib/dashboard-layout-paths.test.ts` with "Cannot read properties of null
  (reading 'useContext')". React loads twice, once as `F:\` (through `@pos/shared`) and once as `f:\`. The same suite
  passes 50/50 from `F:`.
- Not done: a browser smoke (low RAM). The owner checks the item editor's Stock use on a phone, a tablet and the PC
  after deploying.
- Rollback: new routes, a new editor section and new shared exports; no existing request schema changed. After a
  rollback the routes 404 and the section is gone. Saved stock use stays on the products and sales still deduct it.
  Unlinking needs the new build.
- **Next =** Slice 4 (wastage, counts, entries list, delete, M).

### Slice 4: wastage, counts, entries list, delete (s116, 2026-11-13): DONE

- Owner checks of Slice 3 (deploy of 7219803, Stock use on devices) and the table-free move call were not reported this
  session; both carry forward.
- Built with two implementers on separate files (server; UI). The main thread wrote the contract first:
  `STOCK_ENTRY_KINDS`, `WASTE_REASONS`, `STOCK_ENTRY_NOTE_MAX_LEN`, `STOCK_ENTRY_PAGE_MAX`,
  `STOCK_ENTRY_BACKDATE_MAX_DAYS` (31) in `packages/shared/src/inventory.ts`; `createStockEntrySchema`,
  `stockEntryListQuerySchema`, `STOCK_ENTRY_CURSOR_PATTERN` in `schemas/inventory.schema.ts` (+ tests);
  `StockEntryDto` / `StockEntryLineDto` / `StockEntryPageDto` in `types/inventory.ts`; `models/StockEntry.ts`.
  - Server: `lib/inventory/entries-read.ts` (date window, cursor, DTO, list), `lib/inventory/entries-write.ts`
    (`createStockEntry`, `deleteStockEntry` over injected ports), `app/api/inventory/entries/route.ts` (GET admin, POST
    wastage any signed-in user / count admin), `app/api/inventory/entries/[id]/route.ts` (DELETE admin, soft).
  - Client: `hooks/use-inventory.ts` (entries infinite query, create, delete; both lists refresh on success AND error),
    `lib/inventory/stock-adjust-form.ts`, `components/inventory/{StockAdjustSheet,EntryList,QtyBox}.tsx`. Inventory
    page: admin header "Add stock item" + a More menu (Log wastage, Count stock) and a Stock / History switch; staff get
    a "Log wastage" header button and a row tap logs wastage for that item; the item editor gains Count stock / Log
    wastage. The More menu is non-modal (it opens a sheet).
- **Deviations from the plan text (main thread):**
  - Request keys are integer milli-units (`qtyMilli`, `countedMilli`), the Slice 2 precedent.
  - The list sorts by `{date:-1, _id:-1}` (index `date_-1__id_-1`), and the cursor is "<date>_<id>", not createdAt.
  - An entry may be dated today back to 31 days. A count is always dated today (no date picker).
  - **A count does not `$set` the stock.** It reads the item's stock number, lands its row (change = counted minus that
    number), then moves stock by exactly that change with `$inc`, through the same insert-then-move helper as a
    wastage. Review s116 (MED, probe-confirmed): the planned `findOneAndUpdate $set` ran BEFORE the row, so a retry
    after a failed insert (with a sale in between) or a same-ref race applied the count twice and left a row that did
    not match what it did to stock. Live cases (p) and (q) went RED on that code and GREEN after.
- Review: one opus reviewer. MED above fixed test first. LOW "a count whose insert fails says Failed though stock
  moved": gone with the fix. Accepted residuals (commented in place): (1) a wastage or count whose move throws after
  its row landed answers "Saved, but the stock number may be off. Count this item." and a later retry replays as
  success; a kill between the two writes is silent (the plan's "a Count fixes it"); (2) fix-round LOW: two admins
  counting the SAME item inside one read-to-move window both add their change (each row still equals what it did; the
  next count fixes it), the items.ts kind.
- Pins moved on purpose: the inventory writer census (`moveStock(` holders gain `entries-write.ts`), `model-ready-pins`
  (14 sites: the StockEntry insert port), `inventory-ui-paths` (header actions now have an admin and a staff branch;
  staff rows open Log wastage). New pins: `inventory-entries-paths` (auth gates, insert-then-move order for both kinds,
  no source `$set`s a stock number, delete CAS, list select), `inventory-entries-ui-paths`.
- Mutation pass (main thread, alone, byte backup, sha1 restore per mutant, tracked-diff hash the same before and after):
  19 of 19 killed. Mutants: count ignores the read number, count moves before its row, replay pre-read skipped, waste
  sign flipped, delete applies instead of reversing, delete CAS without the not-deleted term, replay ignores the
  amount, zero lines moved, archived item accepted, staff may count, date window unchecked, list and delete open to
  staff, list shows deleted rows, cursor repeats the boundary row, History offered to staff, clientRef minted per
  render, create error leaves the lists stale, count dated by the picker.
- Not done: a browser smoke (low RAM). The owner checks the Inventory page on a phone, a tablet and the PC after
  deploying (Log wastage as staff, Count stock and History as admin, delete from History).
- Rollback: new routes, a new collection and new UI only; no existing request schema changed. After a rollback the
  routes 404 and the buttons are gone; entries stay in the DB and the stock numbers they moved stay moved.
- Chain on the final tree, run from an `F:` working directory:
  - shared: tsc 0, 1108/1108
  - cafe: tsc 0, lint 0 errors (2 old warnings in `lib/masters-blob.test.ts`), 8534/8534
  - hub: tsc 0, lint 0, 288/288
  - live: `verify:inventory:entries:live` 32/32 (new; a-o plus count cases p, q), `verify:inventory:live` 15/15,
    `verify:inventory:items:live` 26/26, `verify:inventory:stock-use:live` 12/12, `verify:model-ready:live` 14/14
- **Next =** Slice 5 (suppliers and purchases, L, money).

### Slice 5: suppliers and purchases (s117, 2026-11-13): DONE

- Owner checks of Slice 4 (deploy of cf2f957: wastage, count, History, delete on devices) and the table-free move call were
  not reported this session; both carry forward.
- Main thread wrote the contract first: `SUPPLIER_*` limits, `SUPPLIERS_MAX` (200), `PURCHASE_MAX_LINES` (20),
  `STOCK_RATE_MAX_PAISE` (₹5,00,000 a unit, so qtyMilli × rate ≤ 5×10^15 < 2^53), `STOCK_ENTRY_MAX_TOTAL_PAISE`
  (₹1,00,00,000, Int32), `purchaseLineAmountPaise` (one round per line, half-up, exact) and `purchaseTotalPaise` (sum of the
  rounded lines) in `packages/shared/src/inventory.ts`; the purchase member of `createStockEntrySchema` (strict; lines
  `{itemId, qtyMilli, ratePaise}` 1..20 unique; `paidPaise`; no client amounts or total) with a `superRefine` on the union
  (total cap, `PAID_OVER_TOTAL_ERROR`, `DUE_NEEDS_SUPPLIER_ERROR`), `createSupplierSchema` / `updateSupplierSchema`; DTO
  fields (`StockEntryDto` purchase money, `SupplierDto` with a signed `duePaise`); `models/Supplier.ts`. Then two
  implementers on separate files.
  - Server: `lib/inventory/purchase.ts` (pure: server sums, the three money re-checks, the replay same-check),
    `entries-write.ts` `createPurchase` (pre-read → money 400 → ONE `$in` of active items 404 → active supplier 404 → row →
    `receiveStock`), `stock-move.ts` `receiveStock` (one bulkWrite, `$inc qty` + `$set lastRatePaise`, rate 0 = `$inc`
    only), `entries-read.ts` (purchase money + supplier name in the admin-only History), `lib/inventory/suppliers.ts`
    (dues = ONE aggregate over `ACTIVE_STOCK_ENTRY` with ObjectId casts; list / create / update; archive refused while the
    due is not 0), routes `app/api/inventory/suppliers/route.ts` (GET/POST) + `[id]/route.ts` (PATCH), all admin. The
    entries POST gate is now deny-by-default: anything but a wastage needs admin.
  - Client: `hooks/use-inventory.ts` (suppliers query + create/update; every entry write and delete also refreshes
    suppliers, on error too), `lib/inventory/{purchase-form,supplier-form}.ts`, `components/inventory/{PurchaseSheet,
    PurchaseLineRow,SuppliersView,SupplierSheet}.tsx`, page `/inventory/suppliers` (ADMIN_ROUTES + page title). Inventory
    More menu: Add purchase, Log wastage, Count stock, Suppliers. History shows purchase rows (supplier, total, to pay)
    and the delete confirm says what leaves stock and which dues go. The item editor shows "Last bought at ₹X / unit".
- **Deviations from the plan text:** none in behaviour. A rate of 0 is allowed (free goods) and does not overwrite the
  last price. Archiving a supplier is refused while it has dues either way (owed or paid ahead).
- Review: one opus reviewer, no HIGH or MED. Two LOW, both fixed test first:
  (1) a PIN switch from an admin to staff kept the inventory caches (the stock list carries the admin's last price;
  History and Suppliers carry purchase money), and an item editor left open stayed mounted, showing "Last bought at".
  Fix: `"inventory"` joins `PERSON_SCOPED_QUERY_ROOTS` (screen-lock.test.ts pin RED → green) and the item editor mounts only
  for an admin (new pin RED → green). (2) the live replay check used a purchase with no due, so it could not fail: the
  replayed purchase now owes 60 and the check reads 4560.
- Accepted residuals (commented in place): a purchase's stock move that throws after its row answers 500 "Saved, but the
  stock number may be off" (the Slice 4 kind); deleting a purchase does not restore `lastRatePaise` (the next purchase sets
  it); a purchase landing between an archive's dues check and its write (two admins) can leave an archived supplier with
  a due; a backdated purchase entered later still becomes the "last" price.
- Pins moved on purpose: the entries POST gate needle, the History select / DTO bans (money is allowed in the admin
  list; clientRef, createdById, v and the delete stamp still never), the `receiveStock(` census, ADMIN_ROUTES in the
  go-live runbook pin + `docs/GO-LIVE-CHECKLIST.md`, the person-scoped roots. New: `inventory-purchases-paths`,
  `inventory-purchases-ui-paths`.
- Mutation pass (main thread, alone, byte backup, sha1 restore per mutant, tracked + untracked tree hash the same
  before and after): 28 of 28 killed. Mutants: free line sets the last price, receive takes stock out, server paid>total /
  due-without-supplier / total-cap checks gone, replay ignores paid / rate / the same-check, one archived item among good
  ones accepted, archived supplier accepted, a due of 0 stored, paid stored as total, staff may purchase, dues count
  deleted rows, dues aggregate without ObjectId casts, archive allowed with an advance / with dues, list shows archived
  suppliers, History drops the supplier name, shared line amount floors, shared schema paid>total by 1 / due without a
  supplier allowed, form sends 0 for paid in full, form allows a due without a supplier / part paid over the total,
  entry refresh skips suppliers, item editor mounted for staff, lock switch keeps inventory caches.
- Not done: a browser smoke (low RAM). The owner checks on a phone, a tablet and the PC after deploying: Add purchase
  (two items, Part paid, a supplier), the supplier's due on Suppliers, the purchase in History, delete it (stock and
  due go back), archive a supplier with no dues.
- Rollback: new routes, a new collection and new UI; the only changed request schema is `createStockEntrySchema`, which
  gained a member (old tabs never send it). After a rollback the purchase routes 400/404 and the buttons are gone;
  purchases stay in the DB and the stock they added stays added.
- Chain, run from an `F:` working directory:
  - shared: tsc 0, 1115/1115
  - cafe: tsc 0, lint 0 errors (the 2 old warnings in `lib/masters-blob.test.ts`), 8606/8606 on the final tree
  - hub: tsc 0, lint 0, 288/288
  - live: `verify:inventory:purchases:live` 43/43 (new, cases a-l), `verify:inventory:entries:live` 32/32,
    `verify:inventory:live` 15/15, `verify:inventory:items:live` 26/26, `verify:inventory:stock-use:live` 12/12,
    `verify:model-ready:live` 14/14
- **Next =** Slice 6 (pay a supplier and supplier history, L, money, small).

### Slice 6: pay a supplier and supplier history (s118, 2026-11-13): DONE

- Owner checks of Slice 5 (deploy of 994a902: purchases, suppliers, History delete on devices) and the table-free move call
  were not reported this session; both carry forward.
- Main thread wrote the contract and the server core. Shared: the `payment` member of `createStockEntrySchema` (strict:
  `supplierId`, `amountPaise` 1..`STOCK_ENTRY_MAX_TOTAL_PAISE`, `date`, `note?`, `clientRef`; the amount is always the typed
  one, never a pay-it-all flag) and `supplierId?` on `stockEntryListQuerySchema`. Server: `lib/inventory/entry-replay.ts`
  (pure `sameEntry` for all four kinds, moved out of `entries-write.ts`'s replayOf to keep that file under 300 lines; a
  22-row table and two mutants prove waste/count/purchase replays are unchanged), `entries-write.ts` `createPayment`
  (active supplier or 404, then the row: `totalPaise` = amount, `duePaise` = minus it, no `lines`, so no stock moves), the
  `?supplierId=` filter in `entries-read.ts` and the GET route. Then a test-engineer (unit tests, pins, live leg) and an
  implementer (UI) on separate files.
  - Client: `lib/inventory/payment-form.ts`, `components/inventory/{SupplierPaySheet,SupplierHistorySheet}.tsx`;
    `SuppliersView` (a row opens that supplier's history; its footer hands over to Pay or Edit details; one sheet at a
    time, the supplier looked up by id in the live list); `EntryList` (`supplierId` filter, payment rows show the amount,
    the delete confirm says the amount counts as owed again); `useStockEntries(enabled, supplierId?)` keyed under the
    entries prefix, so every entry write and delete refreshes it.
- **Deviations from the plan text:** the supplier history is a sheet, not a new `/inventory/suppliers/[id]` page (the
  page-title pins walk every page.tsx and need a fixed title). A Suppliers row now opens the history; editing is one tap
  further (Edit details). The pay amount starts at what is owed, capped at the most one payment may be.
- Review: one opus reviewer, no HIGH. Three findings, all fixed test first:
  - MED: deleting a payment or a purchase of an ARCHIVED supplier brought back a due nobody could see or pay (new with
    payments: a due of 0 can now be rows that cancel out). The DELETE route now refuses it with 409
    (`entryMovesArchivedDues` in `suppliers.ts`: an active row with a due whose supplier is archived). Live case (m) RED,
    then green.
  - LOW: Edit details compared the form with the live supplier row, so after another admin's rename a refetch made Save
    undo it (a regression from Slice 5). The editor gets the copy taken when it opened (pin RED, then green).
  - LOW: a due above the one-payment cap prefilled an amount Save refused. The prefill is capped (test RED, then green).
- Accepted residuals: an archive landing between the delete guard's read and the delete's CAS, or a payment landing
  between an archive's dues check and its write (two admins at once, the Slice 5 kind). The sheets now unmount on close, so
  they close without the slide-out.
- Pins moved on purpose: `insertEntry(` count 3 to 4 (createPayment); the list filter needle gains `...supplier`; the
  entries UI needles (`useStockEntries(true, supplierId)`, the URLSearchParams cursor, the hook signature); the History
  empty-state needles. New: `entries-payment.test.ts`, `inventory-payments-paths.test.ts`, `payment-form.test.ts`,
  `inventory-payments-ui-paths.test.ts`, live `verify:inventory:payments:live`.
- Mutation pass (main thread, alone, byte backup, sha1 restore per mutant, tracked diff + untracked file hashes the same
  before and after): 27 of 27 killed. Mutants: due sign flipped, archived supplier paid, a payment moves stock, replay
  ignores the amount / the supplier / a deleted row, waste replay ignores the reason, count replay ignores the count,
  payment dispatched before the replay pre-read, GET drops the supplier, list ignores it, staff may pay, shared schema
  allows 0 / no supplier, form allows 0, the after-text ignores an advance, clientRef minted per render, history key
  outside the entries prefix, amount not prefilled, Pay opens the editor, dues drop payments, history unfiltered, delete
  guard removed, guard refuses every supplier's due rows, editor compares with the live row, prefill not capped, an
  empty note sent.
- Not done: a browser smoke (low RAM). The owner checks on a phone, a tablet and the PC after deploying: Suppliers, tap a
  supplier, its history shows; Pay (amount prefilled; pay part; pay more and see "paid ahead"); the due on the list
  updates; delete a payment in the history (the due comes back); Edit details still edits and archives; after each
  sheet closes the screen still responds to taps.
- Rollback: the new payment member and the optional `supplierId` query key are only sent by new tabs. After a rollback a
  tab still holding the new JS gets 400 on Pay and on a supplier's history until it reloads; payments already saved
  still lower the dues (the old dues sum reads every row's `duePaise`) and show in History as "Payment".
- Chain, run from an `F:` working directory (shared and hub measured before the review fixes, which touched only the
  cafe app; cafe measured again on the final tree):
  - shared: tsc 0, 1119/1119
  - cafe: tsc 0, lint 0 errors (the 2 old warnings in `lib/masters-blob.test.ts`), 8638/8638
  - hub: tsc 0, lint 0, 288/288
  - live: `verify:inventory:payments:live` 31/31 (new, cases a-m), `verify:inventory:purchases:live` 43/43,
    `verify:inventory:entries:live` 32/32, `verify:inventory:live` 15/15, `verify:inventory:items:live` 26/26,
    `verify:inventory:stock-use:live` 12/12, `verify:model-ready:live` 14/14
- **Next =** inventory lite is complete (6 of 6 slices). The owner deploys and checks Slices 4-6 on devices; then the
  owner picks the next work (open call: the table-free move on cancel).

### Table-free move on cancel (s119, 2026-11-13): DONE

- Owner checks: deployed 9c7474b, Suppliers pay + history checked on devices, all fine (so Slices 4-6 are live). Owner
  call on the table-free move: yes, move it. The next work: the owner will say.
- Problem (seen in s114): on cancel, the ledger reversal is not inside a try. A throw there answers 500 after the
  cancel landed, and the retry meets the "already cancelled" 409, so the table free and the summary cache drops below it
  never ran. A Pay Now bill keeps its table (the POS sends `tableNo` on Pay Now; the create occupies it whatever the
  status), so cancelling it left the table Occupied, holding a cancelled bill, until freed by hand.
- Change (`app/api/orders/[id]/cancel/route.ts`): order is now stock add-back, stamps, card, points, table free, the
  two summary drops, then the ledger. The table write sits in its own swallowing try like the give-backs, so its failure
  can never skip the ledger reversal; `cache.del("tables")` runs after it either way (a write that threw may have
  landed). The ledger block still drops today's summary again when it wrote (the early drop ran before it). Only
  today's summary is ever cached, so the early drop of a past day's key is harmless. No request or response shape
  changed; one behaviour did: a table write that throws now answers 200 (the table stays held, as before) instead of a
  500 whose retry was the 409. `useCancelOrder` only toasts on error and refetches orders, tables and customers either way.
- Test first: live legs k4 and k5 in `scripts/reward-card-use-live-legs-cancel.ts` (run by `verify:reward-card-use:live`).
  k4: a Pay Now table bill, the ledger's `$inc` of visits rejects on cancel; expects 500, Cancelled, ledger untouched,
  retry 409, and the table freed. RED on the old route (the table stayed Occupied), GREEN after. k5: same bill,
  `Table.findOneAndUpdate` rejects on cancel; expects 200, Cancelled, visits and spend reversed, table still held. RED
  on the old route (500), GREEN after.
- Pins: the inventory `PIN cancel` now asserts points < table free < today's summary drop < order-day summary drop <
  ledger, all at the follow-ups' own depth; the table write opens its own try with an empty catch, then the tables drop;
  one table write, filtered on this order; the ledger re-drops today's summary before the finally. The realtime pin's
  cancel `last` landmark is now the ledger's own summary drop.
- Mutation pass (main thread, alone, byte backup, sha1 restore per mutant, tree diff the same before and after): 8 of 8
  killed (group back below the ledger, summary drops below it, table write unswallowed, catch rethrows, tables drop only
  on success, ledger re-drop removed, early today drop removed, table filter loses the order guard). The last one first
  SURVIVED (an old gap in the moved block); a pin was added and it is killed.
- Review: one opus reviewer, no HIGH/MED. One LOW (the early today's-summary drop was unpinned) fixed with the pin above.
- Chain, run from an `F:` working directory: shared tsc 0, 1119/1119; cafe tsc 0, lint 0 errors (the 2 old warnings in
  `lib/masters-blob.test.ts`), 8638/8638; hub tsc 0, lint 0, 288/288; live `verify:reward-card-use:live` 53/53 (k4, k5
  new), `verify:orders:live` 153/153, `verify:inventory:live` 15/15, `verify:reward-points:live` 20/20,
  `verify:reward-redeem:live` 26/26, `verify:reward-assign:live` 22/22, `verify:reward-progress:live` 17/17.
- Rollback: statement order only; a revert puts back the old order (a ledger throw would again leave the table held).
- **Next =** the owner deploys and checks a cancel of a Pay Now table bill (the table frees); then the owner picks the
  next work.

## After the phase: VOID becomes CANCEL (s120, 2026-11-13)

> **DONE & VERIFIED 2026-11-13.** The owner deployed 0df98ad; a Pay Now table bill's cancel frees the table. Next work,
> the client's ask: staff and slips never say VOID. The owner picked the KOT title `*** CANCEL ***` and the scope
> "everywhere". Copy only: the `void` kind, the API path, data and identifiers are unchanged.

- Kitchen ticket (on-screen, Classic, Bold, text Classic, text Bold): `*** CANCEL ***`, `N item(s) CANCELLED`; the
  whole-order cancel notice uses the same variant. Cancelled-order bill: `CANCELLED — NOT A VALID RECEIPT`,
  `CANCELLED — no payment due`.
- POS: the sent line's **Cancel**; the dialog "Cancel an item" / "Cancel N × item" with the dismiss renamed **Keep item**
  (two Cancel buttons otherwise, like CancelOrderDialog's "Keep order"). Toasts, item-cancel API errors, orders trail,
  dashboard and reports wording, printer setup notes, job label `Cancelled item <dish>`, status chip `Item cancel`
  (apart from the order's `Cancel notice`), go-live and mobile checklists.
- Tests: needles moved at the same strength; a rendered-output pin (print-template-golden-stored) that no KOT, HTML or
  text, and no cancelled bill prints VOID; label + chip pins (chip RED first). The picture byte pin
  (text-kot-print.test.ts PICTURE_FILES) re-baselined for the 6 slip files changed here, with a dated note.
- Review: one opus reviewer, no HIGH/MED; LOW 1 (chip read "Cancelled item: Cancelled — nothing printed") fixed; LOW 2
  (labels unpinned) pinned. Mutants 6/6 killed (both labels, chip, Bold KOT title, text KOT title, Themed bill line).
- Chain from `F:`: shared tsc 0, 1119/1119; cafe tsc 0, lint 0 errors (2 old warnings), 8641/8641; hub tsc 0, 288/288.
  Pushed main 4cdb1fa (app 4070b5e).
- **Next =** the owner deploys, reloads every POS screen, cancels one sent item and sees `*** CANCEL ***` on the KOT;
  then the owner names the next work.
- Owner checks (s121, 2026-11-14): deployed 4cdb1fa, reloaded, cancelled a sent item: the KOT printed `*** CANCEL ***`
  and the POS showed Cancel / Keep item, all fine (the CANCEL wording is live). The owner will name the next work later.
