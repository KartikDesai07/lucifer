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
