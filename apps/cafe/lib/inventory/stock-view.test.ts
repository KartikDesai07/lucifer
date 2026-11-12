import assert from "node:assert/strict";
import { test } from "node:test";

import type { StockItemDto } from "@/types/inventory";
import { sortStockItems, stockBadge } from "./stock-view";

const item = (name: string, qtyMilli: number, lowAtMilli?: number): StockItemDto => ({
  id: name,
  name,
  unit: "pcs",
  qtyMilli,
  ...(lowAtMilli === undefined ? {} : { lowAtMilli }),
});

test("sortStockItems: Out first, then Low, then OK, each by name", () => {
  const items = [item("Zucchini", 9000), item("Milk", 0), item("Bread", 2000, 5000), item("apple", 9000), item("Cheese", -1000), item("Ant", 1000, 1000)];
  assert.deepEqual(
    sortStockItems(items).map((i) => i.name),
    ["Cheese", "Milk", "Ant", "Bread", "apple", "Zucchini"],
    "negative and zero are Out; at or under the line is Low; names ignore case",
  );
});

test("sortStockItems returns a new array and leaves the input alone", () => {
  const items = [item("B", 5000), item("A", 0)];
  const sorted = sortStockItems(items);
  assert.notEqual(sorted, items);
  assert.deepEqual(items.map((i) => i.name), ["B", "A"]);
  assert.deepEqual(sortStockItems([]), []);
});

test("stockBadge: Out and Low have a label and a status token pair; OK has none", () => {
  const out = stockBadge("out");
  const low = stockBadge("low");
  assert.equal(out?.label, "Out");
  assert.equal(low?.label, "Low");
  assert.match(out?.className ?? "", /bg-status-bad-tint text-status-bad-ink/);
  assert.match(low?.className ?? "", /bg-status-warn-tint text-status-warn-ink/);
  assert.equal(stockBadge("ok"), null);
});
