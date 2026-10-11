import { test } from "node:test";
import assert from "node:assert/strict";

import { QueryClient } from "@tanstack/react-query";

import { clearDinerCardsCache, DINER_CARDS_KEY, DINER_SCRATCH_MUTATION_KEY } from "@/components/public/rewards/use-diner-cards";

// Behavioural, with a real QueryClient (no React). Lives in lib/, not beside the hook: a components/public test file
// may not import the query client (order-request-paths pin K).
test("clearDinerCardsCache removes every cached wallet AND every scratch mutation, and nothing else", () => {
  const qc = new QueryClient();
  const wallet = { earning: true, progress: null, ladder: null, cards: [], pointsBalance: 0 };
  qc.setQueryData([...DINER_CARDS_KEY, "9876543210"], wallet);
  qc.setQueryData([...DINER_CARDS_KEY, "9123456789"], wallet);
  qc.setQueryData(["other-query"], 1);
  const cache = qc.getMutationCache();
  cache.build(qc, { mutationKey: DINER_SCRATCH_MUTATION_KEY, mutationFn: () => Promise.resolve(null) });
  cache.build(qc, { mutationKey: ["something-else"], mutationFn: () => Promise.resolve(null) });
  assert.equal(cache.findAll({ mutationKey: DINER_SCRATCH_MUTATION_KEY }).length, 1, "landmark: the scratch mutation is cached");

  clearDinerCardsCache(qc);

  assert.equal(qc.getQueryData([...DINER_CARDS_KEY, "9876543210"]), undefined);
  assert.equal(qc.getQueryData([...DINER_CARDS_KEY, "9123456789"]), undefined);
  assert.equal(cache.findAll({ mutationKey: DINER_SCRATCH_MUTATION_KEY }).length, 0);
  assert.equal(qc.getQueryData(["other-query"]), 1, "unrelated queries survive");
  assert.equal(cache.findAll({ mutationKey: ["something-else"] }).length, 1, "unrelated mutations survive");
  qc.clear();
});
