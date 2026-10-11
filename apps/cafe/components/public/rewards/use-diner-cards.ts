"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import {
  CARD_NOT_SCRATCHABLE,
  CARDS_LOAD_FAILED,
  CARDS_SIGN_IN,
  DINER_CARDS_ENDPOINT,
  dinerScratchPath,
  SCRATCH_BUSY,
  SCRATCH_OFFLINE,
  SCRATCH_PAUSED,
  type DinerCardDto,
  type DinerCardsData,
  type DinerScratchData,
} from "@pos/shared/public-diner-cards";

// CB-7 S4 — the diner's scratch-card wallet as TanStack queries. The diner identity (the mobile) is part of the key,
// so one diner's cached cards can never be shown to the next person on a shared phone; sign-out also removes them.
// Money-adjacent: the scratch is NEVER optimistic — the outcome exists only once the server answers.

export const DINER_CARDS_KEY = ["diner-cards"] as const;
export const DINER_SCRATCH_MUTATION_KEY = [...DINER_CARDS_KEY, "scratch"] as const;

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;

// The wallet with `next` swapped in for the card of the same id (list order kept; no-op when absent or no wallet).
export function replaceCard(prev: DinerCardsData | undefined, next: DinerCardDto): DinerCardsData | undefined {
  if (!prev || !prev.cards.some((card) => card.id === next.id)) return prev;
  return { ...prev, cards: prev.cards.map((card) => (card.id === next.id ? next : card)) };
}

// What the diner reads when a scratch fails. A network drop / timeout says "check your internet"; a 401 (signed
// out) asks to sign in; a refusal keeps the ONE copy the server uses for expired / unknown / someone else's card;
// anything else is the generic retry line.
export function scratchErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return SCRATCH_BUSY;
  if (error.kind === "network" || error.kind === "timeout") return SCRATCH_OFFLINE;
  if (error.status === HTTP_UNAUTHORIZED) return CARDS_SIGN_IN;
  if (error.status === HTTP_NOT_FOUND) return CARD_NOT_SCRATCHABLE;
  if (error.status === HTTP_FORBIDDEN) return SCRATCH_PAUSED;
  return SCRATCH_BUSY;
}

// A signed-out diner can never scratch (every retry is another 401): the sheet hides "Try again" for it.
export function scratchCanRetry(error: unknown): boolean {
  return !isSignedOut(error);
}

function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "http" && error.status === HTTP_UNAUTHORIZED;
}

// The Levels tab wallet-load failure: a 401 means the session ended (sign in, no retry); the rest is a plain retry.
export function cardsLoadErrorCopy(error: unknown): string {
  return isSignedOut(error) ? CARDS_SIGN_IN : CARDS_LOAD_FAILED;
}

export function cardsLoadCanRetry(error: unknown): boolean {
  return !isSignedOut(error);
}

export function useDinerCards(identity: string | null) {
  return useQuery({
    queryKey: [...DINER_CARDS_KEY, identity],
    queryFn: () => apiGet<DinerCardsData>(DINER_CARDS_ENDPOINT),
    enabled: identity !== null,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useScratchCard(identity: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: DINER_SCRATCH_MUTATION_KEY,
    mutationFn: (cardId: string) => apiSend<DinerScratchData>(dinerScratchPath(cardId), "POST"),
    onSuccess: (data) => {
      queryClient.setQueryData<DinerCardsData | undefined>([...DINER_CARDS_KEY, identity], (prev) =>
        replaceCard(prev, data.card),
      );
      void queryClient.invalidateQueries({ queryKey: DINER_CARDS_KEY });
    },
    // A server refusal means the wallet moved on (expired, paused): re-read it. A dropped request changes nothing.
    onError: (error) => {
      if (error instanceof ApiError && error.kind === "http") {
        void queryClient.invalidateQueries({ queryKey: DINER_CARDS_KEY });
      }
    },
  });
}

// Sign-out: forget every cached wallet AND every scratch mutation (its data holds the last revealed outcome).
export function clearDinerCardsCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: DINER_CARDS_KEY });
  const mutations = queryClient.getMutationCache();
  mutations.findAll({ mutationKey: DINER_SCRATCH_MUTATION_KEY }).forEach((mutation) => mutations.remove(mutation));
}

export function useClearDinerCards(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => clearDinerCardsCache(queryClient), [queryClient]);
}
