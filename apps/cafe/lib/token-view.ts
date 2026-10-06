// Print customization S8 — the token board as the screens see it. Client-safe and import-free on purpose: the POS
// token sheet, the Orders list and (S9) the Now Serving screen import this file, never lib/token-board.ts, so the
// kitchen-card builder never rides into their bundles.
//
// The board carries numbers and times only — never a name, an amount or a dish (the S9 TV is public-facing).

/** What staff can do to a token from the POS sheet: mark it ready (or undo that), or hand it over (or undo that). */
export const TOKEN_ACTIONS = ["ready", "unready", "collected", "uncollected"] as const;
export type TokenAction = (typeof TOKEN_ACTIONS)[number];

export interface TokenBoardEntry {
  /** The order's hex id — what POST /api/tokens/[id] is addressed by. */
  id: string;
  number: number;
  /** ISO: the newest fire instant on the order — sent back as seenFiredAt with a Ready mark. */
  firedAt: string;
  /** ISO: when the token was marked ready (ready list only). */
  readySince?: string;
}

export interface TokenBoard {
  enabled: boolean;
  preparing: TokenBoardEntry[];
  ready: TokenBoardEntry[];
  generatedAt: string;
}

export function tokenLabelOf(n: number): string {
  return `Token ${n}`;
}

const byFiredAt = (a: TokenBoardEntry, b: TokenBoardEntry): number => a.firedAt.localeCompare(b.firedAt);

/** The optimistic board after one action — the next fetch replaces it with the server's truth. "uncollected" leaves
 *  the board unchanged: the collected token is no longer in the cache to put back, and the refetch restores it. */
export function applyTokenAction(board: TokenBoard, id: string, action: TokenAction, nowIso: string): TokenBoard {
  const fromPreparing = board.preparing.find((e) => e.id === id);
  const fromReady = board.ready.find((e) => e.id === id);
  switch (action) {
    case "ready": {
      if (!fromPreparing) return board;
      return {
        ...board,
        preparing: board.preparing.filter((e) => e.id !== id),
        ready: [{ ...fromPreparing, readySince: nowIso }, ...board.ready],
      };
    }
    case "unready": {
      if (!fromReady) return board;
      const entry: TokenBoardEntry = { id: fromReady.id, number: fromReady.number, firedAt: fromReady.firedAt };
      return {
        ...board,
        ready: board.ready.filter((e) => e.id !== id),
        preparing: [...board.preparing, entry].sort(byFiredAt),
      };
    }
    case "collected":
      return fromReady ? { ...board, ready: board.ready.filter((e) => e.id !== id) } : board;
    case "uncollected":
      return board;
  }
}
