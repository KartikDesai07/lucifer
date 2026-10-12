import type { DinerCardsData } from "@pos/shared/public-diner-cards";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import { Customer } from "@/models/Customer";
import type { ISettings } from "@/models/Settings";
import { buildDinerCardsData } from "@/lib/reward-cards-view";
import { resolveRewardLevels, rewardLevelsEarning } from "@/lib/reward-levels-config";

// CB-7 S4 — the IO half of GET /api/public/diner/cards: one lean read of THIS diner's progress counter + cards,
// then the pure view (lib/reward-cards-view.ts). SERVER-ONLY (Customer model + the env-reading config; registered in
// client-graph-guard.test.ts). `rewardCards` is select:false, so it is asked for by name; a plain customer read
// (staff lists, the cached customers payload) never carries a card.

export interface WalletRead {
  cardSteps?: number;
  rewardCards?: RewardCardSnapshot[];
}

// The seam the tests fake: the one database call and the two ambient inputs (clock, environment).
export interface DinerCardsDeps {
  readWallet(customerId: string): Promise<WalletRead | null>;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export const DINER_CARDS_DEPS: DinerCardsDeps = {
  readWallet: (customerId) => Customer.findById(customerId).select("cardSteps +rewardCards").lean(),
  now: () => new Date(),
  env: process.env,
};

// The diner's wallet, or null when the account is gone. Progress + ladder follow rewardLevelsEarning (switched off,
// blocked or unreadable -> none); the cards and the points balance always show what the diner already holds.
export async function readDinerCards(
  settings: ISettings | null,
  customerId: string,
  deps: DinerCardsDeps = DINER_CARDS_DEPS,
): Promise<DinerCardsData | null> {
  const wallet = await deps.readWallet(customerId);
  if (!wallet) return null;
  return buildDinerCardsData({
    earning: rewardLevelsEarning(settings, deps.env),
    cfg: resolveRewardLevels(settings),
    cardSteps: wallet.cardSteps ?? 0,
    cards: wallet.rewardCards ?? [],
    now: deps.now(),
  });
}

// CB-7 S5 — ONE card of THIS diner (the claim reads the card it is about to spend; the release reads the immutable
// validUntil it puts back). The read is keyed on the customer's id, so another diner's card id is simply absent. A bare
// "_id +rewardCards" returns only the cards (never the rest of the customer row).
export async function readCardOf(customerId: string, cardId: string): Promise<RewardCardSnapshot | null> {
  const row = await Customer.findById(customerId).select("_id +rewardCards").lean();
  return row?.rewardCards?.find((c) => c.id === cardId) ?? null;
}

// CB-7 S5 — EVERY card of THIS diner, for the staff POS picker (GET /api/customers/[id]/rewards). The caller filters
// to the usable ones and maps them through the staff allowlist (lib/reward-cards-staff.ts); this read never reaches a
// browser. An unknown customer reads as no cards.
export async function readWalletCardsOf(customerId: string): Promise<RewardCardSnapshot[]> {
  const row = await Customer.findById(customerId).select("_id +rewardCards").lean();
  return row?.rewardCards ?? [];
}
