# Bill line grouping: the same item is one line on the bill (record)

> 2026-11-02, one session, on main after `0dfbb92`. Owner ask, decision, change and evidence.

## The owner's ask and decision

Ask: "mene first one cold drink order kiya uske bad dusra kiya so sab ki entry different aa rahi hai ... one standard
format bill me cold drink ya fir koi bhi item ho same ho to uska group same name and same price ka, all thing proper
accurate billing me manage karna hai."

Decision (AskUserQuestion, Recommended): **Bill + Orders detail.** The printed bill (every design, reprints, previews)
and the Orders page bill detail show one line per item. The POS cart stays one line per round (each round's line keeps
its own Void). The KOT, void slips, token slips, the kitchen screen and reports are unchanged.

Deploy (owner): a deep review of every case first, then **demo only**; lucifer007 is never deployed.

## The change

- `apps/cafe/lib/bill-lines.ts` `billLinesOf(items)`: lines whose printed identity is the same join at the first one's
  place, qty added. The identity is everything a bill line prints: name, variation, add-ons (any order), "NO ..."
  removals, instructions, unit price, the reward flag and its note. Anything different stays its own line, so a note,
  an add-on or FREE never lands against the wrong quantity. Returns the SAME array when nothing repeats.
- Item rows only: `components/pos/OrderReceipt.tsx`, `components/print/slip/bill-classic-blocks.tsx`,
  `bill-modern-blocks.tsx`, `bill-themed-blocks.tsx` (express + cafe), `components/orders/OrderDetailBody.tsx`. Every
  figure (subtotal, discount, GST, charges, total, reward saved, the item count) still comes from the order and its
  stored lines; a grouped row's amount is price x qty, the sum of the rows it holds. The stored order is unchanged.
- The S1 paper pin re-pinned the four changed picture files (dated note); `variation-paths.test.ts` re-pointed its
  OrderReceipt row marker (same checks).

## Evidence

- Tests: `lib/bill-lines.test.ts` (grouping rules, incl. name, price, variation, instructions, add-ons, removals,
  reward, note), `lib/bill-lines-render.test.ts` (legacy + classic / modern / express / cafe, lazy designs loaded: the
  repeated-item bill renders byte for byte the bill of the same order with one merged line; Orders detail pin).
- Mutation pass (main thread, byte backup, tree hash identical): 9 / 9 killed (never groups; key without name, price,
  instructions, reward, note; themed, modern and detail rows ungrouped).
- Reviews: one opus review (found the `variation-paths` pin, fixed), then the deep review: two read-only lenses
  (money accuracy + edge cases; spec fidelity + scope + test strength): no correctness defect; the two test gaps it
  found (name, note not pinned) were reproduced by mutation and closed. Tree hash before = after.
- Side effect, better: `inr` rounds each row to whole rupees, so two Rs 12.50 lines used to print 13 + 13 against a
  Rs 25 subtotal; the grouped row prints 25.
- Out of scope, unchanged: the Orders list row summary (`orders-row.ts`), the diner's phone bill (one QR request only,
  so a repeat across rounds cannot appear there), Telegram notify.
