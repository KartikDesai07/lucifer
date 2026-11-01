# KOT kitchen order: categories print in the owner's order on every KOT (plan)

> One session. Tier L (printing + order writes) on a fast path: failing tests first, one implementer per disjoint
> slice, the full chain + live legs, one opus review, an arbiter only for contested findings, a short mutation pass.
> Planned 2026-11-01 on main `fe6cff9` (every fact below was read from that tree).

## The owner's ask and decisions (2026-11-01)

Ask: "category me priority jesa khuch set karna hai ki KOT me wo top me aaye … station wise … smooth, fast, accurate".

| # | Decision (all the Recommended option) |
|---|---|
| D1 | A separate **Kitchen order** drag list on the Categories page, beside today's menu order. The menu order and the POS menu do not change. |
| D2 | **No change until it is set.** Until an admin saves a kitchen order, every KOT prints exactly as today (the order the items were added). |
| D3 | A full KOT (one printer prints everything, or a full-copy printer) is sorted **by kitchen order only** (no station grouping). Each station's own KOT is its own items in kitchen order. |
| D4 | **No category headings** on the paper. Only the line order changes; the slip designs stay byte for byte. |

Not asked, so unchanged: the bill, the receipt, the order detail, the diner pages, the menu order, the station
routing rules, every slip design. The Kitchen screen (`/kitchen`) follows the same order inside a round's card (it
is the kitchen's copy of the KOT).

## How it works (one paragraph)

`Category` gains `kotOrder` (absent = not placed). When an order line is WRITTEN, the existing write-time pass
`withKitchenFlags` (it already reads the product and category for skip-KOT, at all four writers) also stamps the
line with `kotRank` = its category's `kotOrder` (omit-empty: no key when the category has none). Every KOT path
already goes through ONE pure helper, `kitchenOrderOf()` in `lib/kitchen-lines.ts` (the server's and the device's
KOT jobs, the browser print, the text KOT, the reprint, Move table, the cancel and moved notices), so the sort
lives there: inside each round, lines by `kotRank` (absent last), ties in the order added. Station routing filters
that sorted list per station, so every station slip and the full copy come out sorted with no routing change.
`printOrderSnapshot` is a whitelist, so `kotRank` never reaches the `.strict()` snapshot schema. The print host,
the Android app and the Windows app need no release.

## Facts this plan stands on (file:line at fe6cff9)

- `models/Category.ts:22-24` `order` (menu), `stationId`, `noKot`; menu drag = `components/menu/CategoryArrangeList.tsx`
  + `useReorderCategories` (`hooks/use-categories.ts:122`) + `PATCH /api/categories` (`app/api/categories/route.ts:49`,
  exact-set rule, 409 on a changed list, `categoryReorderOps`).
- Write-time stamp precedent: `lib/kitchen-lines-server.ts` `withKitchenFlags` (fails open), called by
  `app/api/orders/route.ts`, `app/api/orders/[id]/items/route.ts`, `lib/order-request-accept.ts`,
  `lib/order-request-accept-addround.ts`. Pure half: `lib/kitchen-lines.ts` `stampKitchenFlags`, `kitchenOrderOf`.
- KOT jobs: `lib/print-routing.ts:145` `kotPrintJob` = `printOrderSnapshot(kitchenOrderOf(order))`; also `:271`
  moved, `:305` cancel notice. Direct print: `components/pos/PrintSources.tsx:86`, `OrderDetailSheet.tsx:420`,
  `MoveTableDialog.tsx:288`. Text KOT: `lib/printer/kot-text/kot-text.ts:79`.
- Station split: `lib/print-printer-routing.ts:130` `routeKot` filters `payload.snapshot.items` per station, order kept.
- Snapshot whitelist: `packages/shared/src/print-job.ts:270` `printOrderSnapshot` (items picked field by field);
  `packages/shared/src/schemas/print-job.schema.ts:31-59` item schema `.strict()`.
- Kitchen screen: `app/api/kitchen/route.ts:80` selects whole `items` (`KITCHEN_ORDER_SELECT`, `lib/token-board.ts:24`);
  rows sorted `lib/kitchen-board.ts:226` by firedAt → orderId → ref; `lib/kitchen-cards.ts` groups rows, order kept.
- Order line schema: `models/Order.ts:265` (`noKot` omit-empty, strict); client input fence
  `packages/shared/src/schemas/order.schema.ts:49` (no `noKot` key: the client cannot stamp).
- Device cache: `lib/bootstrap-contract.ts:44` `BOOTSTRAP_VERSION = 16` (each DTO shape change bumps it, with a comment).
- The paper pin `PIN (S1)` (`lib/printer/kot-text/text-kot-print.test.ts:322`, 43 files) does NOT include any file this
  plan changes. `lib/print-job-payload-parity.test.ts` stays green because no slip file reads `kotRank`.
- `app/(dashboard)/categories/page.tsx` is 327 lines (over the cap): it must not grow; the new UI is its own component.

## Slices (disjoint files; S1 first, then S2 ‖ S3 ‖ S4)

### S1: data + the stamp + the sort (server/shared, pure first)

| File | Change |
|---|---|
| `packages/shared/src/types.ts` | `Category.kotOrder?: number`; `OrderItem.kotRank?: number` (comment: server-stamped, omit-empty, read only through `lib/kitchen-lines.ts`). |
| `packages/shared/src/schemas/category.schema.ts` | `reorderCategoriesSchema` gains `list: z.enum(["menu","kitchen"]).optional()` (absent = menu = today); a `clearKitchenOrderSchema` `{ list: "kitchen", clear: true }` (PATCH body union). `createCategorySchema` / `updateCategorySchema` do NOT accept `kotOrder` (only the arrange route writes it). |
| `packages/shared/src/schemas/order.schema.ts` | Fence comment beside `noKot`'s: no `kotRank` key (Zod strips it; the stamp overwrites anyway). |
| `apps/cafe/models/Category.ts` | `kotOrder: { type: Number }` (no default, absent = not placed). |
| `apps/cafe/models/Order.ts` | `IOrderItem.kotRank?: number` + line schema `kotRank: { type: Number }` (no default). NOT on the void-trail entry. |
| `apps/cafe/lib/kitchen-lines.ts` | `KitchenFlagged.kotRank?`; `withKotRank(line, rank \| undefined)` omit-empty (same object when unchanged, deletes a stray key); `stampKitchenFlags(lines, facts, skipCategoryIds, categoryRanks = EMPTY_MAP)` stamps kitchen lines from `facts.categoryId`, never a skip line; `kitchenOrderOf` = drop skip lines, then a STABLE sort by (first position of the line's `kotRound`, `kotRank` with absent = last, original index). Returns the SAME array/object when no line carries `kotRank` or nothing moves (so every order before this feature, and every cafe that never sets a kitchen order, is byte for byte today). |
| `apps/cafe/lib/kitchen-lines-server.ts` | The one category read becomes `Category.find({ $or: [{ noKot: true }, { kotOrder: { $exists: true } }] }).select("_id noKot kotOrder")` → the skip set + a rank map (no extra round trip). Still fails open: on a throw, no ranks and no skips (today). |

### S2: the Kitchen screen

| File | Change |
|---|---|
| `apps/cafe/lib/kitchen-board.ts` | `FiredItem.kotRank?`; the row sort becomes firedAt → orderId → kotRank (absent last) → ref. The rank is used for the sort only and is NOT added to the `KitchenRow` wire shape (keep a side value, e.g. sort `{ row, rank }` pairs, then map). Ticks stay addressed by `ref` (unchanged). |

### S3: the admin UI + route

| File | Change |
|---|---|
| `apps/cafe/app/api/categories/route.ts` | PATCH: `list: "kitchen"` → same exact-set check, then `bulkWrite` `kotOrder = index`; the clear body → `updateMany({}, { $unset: { kotOrder: 1 } })`. `cache.del(CACHE_KEY)` after both (the public menu does not read `kotOrder`; its cache stays). GET/list must return `kotOrder` (check `listCategories`' select). Admin only, envelope, 409 wording reused. |
| `apps/cafe/lib/` (where `categoryReorderOps` lives) | `kitchenOrderOps(ids)` beside it. |
| `apps/cafe/hooks/use-categories.ts` | `useReorderCategories(list = "menu")` passes `list`; `useClearKitchenOrder()`; both `commitCategories` on success, refresh on error (today's pattern). |
| `apps/cafe/components/menu/CategoryArrangeList.tsx` | Prop `list: "menu" \| "kitchen"`; kitchen: placed categories by `kotOrder`, then unplaced by menu order; saves through the hook with `list`. |
| NEW `apps/cafe/components/menu/KitchenOrderPanel.tsx` | Menu order / Kitchen order switch (kit `SegmentedControl`, 44 px on touch), the kitchen list, copy: "Kitchen order: dishes print on the kitchen ticket in this order. Drag to arrange." State line when unset: "Not set: kitchen tickets print in the order items were added." "Clear kitchen order" behind an AlertDialog. A category with "No kitchen ticket" shows its existing NoKotTag. |
| `apps/cafe/app/(dashboard)/categories/page.tsx` | Swap the arrange list for `KitchenOrderPanel` (net lines must not grow). |
| `apps/cafe/lib/bootstrap-contract.ts` | `BOOTSTRAP_VERSION` 16 → 17 + comment ("Category gained kotOrder; a v16 blob would show the kitchen order as not set"). Confirm the bootstrap categories part returns `kotOrder`. |

### S4: tests and the live leg (failing first; every new file into `apps/cafe/package.json` testChain)

- `lib/kitchen-lines.test.ts`: no ranks → SAME object; one round ranks [3,1,–,1] → 1,1,3,– (ties as added); two
  rounds stay grouped; skip lines dropped then sorted; `stampKitchenFlags` stamps from the rank map, omits for
  unranked, clears a stray `kotRank`, never ranks a skip line.
- `lib/print-printer-routing.test.ts` (or a new `lib/kitchen-order-routing.test.ts`): `kotPrintJob` of a ranked order
  gives a sorted snapshot; `routeKot` keeps it per station, for the full copy, for the fallback "(NO PRINTER SET)",
  and in simple mode; the snapshot has no `kotRank` key.
- `lib/kitchen-board.test.ts`: one round's card lines by rank, absent last; two rounds by firedAt as today.
- Shared: `reorderCategoriesSchema` list/clear; the order input schema drops `kotRank` (fence pin).
- Route/source pins: PATCH kitchen exact-set + 409 + clear + admin-only; `BOOTSTRAP_VERSION` 17; categories page
  stays ≤ 327 lines and mounts `KitchenOrderPanel`.
- NEW `scripts/verify-kitchen-order-live.ts` (+ `verify:kitchen-order:live`; the skip-KOT leg is 290 lines, so a new
  file) on a `pos_scratch_*` db, dropped at the end: unset → created lines carry no `kotRank`; set the kitchen order
  → create, add a round, QR accept, QR accept add-round all stamp; a moved category; clear → new lines unranked. Grep
  `scripts/` for category/order `*_KEYS` allowlists and add the new keys (memory: DTO allowlists live in live legs).
- Goldens: every KOT golden and the S1 pin unchanged (fixtures carry no rank).

## Check before writing code (the session's first 10 minutes)

1. The POS Send flow builds `kotPrintJob` from the SERVER's saved order (with `kotRank`), not from the local cart. If
   any path prints a KOT from cart lines, those lines have no rank: sort there from the cached categories, or route
   it through the saved order. Same check for Pay-now with KOT and the QR accept print.
2. `lib/print-repair.ts:87` and any other projection that later feeds `kotPrintJob` include `items.kotRank`.
3. `listCategories` and the bootstrap categories part select `kotOrder`; the public menu does not.

## Edge cases (each is a test or a live-leg check)

E1 no kitchen order → byte for byte today. E2 a category added after → its lines print after the placed ones, and it
shows unplaced at the bottom of the list. E3 a category deleted → old orders keep their stamps. E4 a re-arrangement
mid-service → fired lines keep their stamp, the next round uses the new order, a whole-tab reprint keeps each round
together. E5 a product moved to another category → new lines take the new rank. E6 an item-level station override
still routes by station; its rank comes from its category. E7 "No kitchen ticket" lines never print (unchanged). E8
a menu read failure → today's order, the order never fails. E9 equal ranks → the order added. E10 the QR diner's
order → stamped at accept. E11 the bill and every non-kitchen view → unchanged.

## Verify, review, ship

- Chain: shared / cafe / hub tsc + lint + tests; live legs `kitchen-order` (new), `skip-kot`, `order-request`,
  `orders:idem`, `print`; then a local smoke: set a kitchen order, send a 3-category order (one printer, then two
  stations), check the KOT preview / text KOT order and `/kitchen`.
- Mutation pass (alone, no reviewer running): remove the sort, the stamp, the board tie-break, the exact-set check;
  each must turn a test red.
- One opus code-reviewer (read-only) on the diff; arbiter only for a contested finding.
- Deploy: **ask the owner first** — lucifer007 does not have the 214 office-PC commits yet (UI redesign + PIN
  sign-in); deploying this ships them too. posdemo already has them. Then commit + push main.

## Results (2026-11-01/02)

Built as planned (S1 data + stamp + sort, S2 the Kitchen screen tie-break, S3 the Categories "Kitchen order" panel +
PATCH `list: "kitchen"` / clear, `BOOTSTRAP_VERSION` 17, S4 tests + `verify:kitchen-order:live`). Checks 1-3 all held:
every POS / QR / auto-print KOT prints from the server's saved order; the repair re-reads the whole order;
`listCategories` / bootstrap return whole docs and the public menu whitelists `{ name, order }`.

Changes made during the build:

- The sort lives in `kitchenLinesOf` (and so in `kitchenOrderOf`). The local browser KOT and the text KOT pass a
  round's `kotRoundItems` through `kitchenLinesOf`, not `kitchenOrderOf`, so a sort only in `kitchenOrderOf` would have
  left the direct print unsorted. No pinned print file changed (the S1 paper pin and every KOT golden are untouched).
- Review LOW (opus code-reviewer, no HIGH / MED): a kitchen drag save and Clear could cross and leave the screen
  disagreeing with the server. Both writes now share the mutation key `CATEGORY_KEYS.arrange`; the list pauses during a
  clear and Clear is disabled during a save.
- Mutation pass (main thread, byte backup + restore, tree hash identical before / after): 9 / 9 mutants killed (sort,
  pure stamp, server rank map, board tie-break, kitchen exact-set, clear, shared key, kitchen arrangement, hook body).
  The exact-set mutant died only in the live leg, so a source pin now catches it in `npm test` too.

Verification: shared tsc + 1020 / 1020; cafe tsc + lint (0 errors; 2 old warnings in masters-blob.test.ts) + 7043 /
7043; hub tsc + lint + 288 / 288; live legs kitchen-order 9 / 9, skip-kot 8 / 8, orders:idem 35, order-request 240,
print 473, print-template 13; no scratch DB left. The browser smoke could not run on this PC (about 1 GB of RAM free:
next dev + headless Chrome ran out of memory four times); a server render of the panel and the kitchen list passed
instead (row order, the No KOT tag, no `<div>` in a `<p>`). The click-through and the phone layout are the owner's
device check.

Deployed to demo only (owner, 2026-11-02): https://posdemo.sandbee.in READY, health 200. lucifer007 not deployed
(it still lacks the office-PC commits).
