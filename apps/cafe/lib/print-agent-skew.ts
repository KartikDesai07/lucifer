import { ApiError } from "@/lib/api-client";

// Printing redesign, Phase 3 Session 3C (the 3B review gate's I-1): a page from Phase 3 adds fields to its ack (tokenSlips,
// reason) and to its wake (capabilities.lanFailover, tokenSlips, printers) that a server from before Phase 3 refuses: its
// schemas are strict, so it answers 400 "Validation failed", and the ack store reads a 400 as answered. After a rollback of
// the web, while such a page stays open, every slip it printed would then expire into a REPRINT. So a refused body is sent
// once more without those fields (they mean nothing to that server: it has neither the token fence nor the skip), and once
// that works the page sends the older body until it reloads: a rollback costs one more request per page, not one per ack.
// Nothing changes against a Phase 3 server, which takes the fields. Client-safe.

/** What the shared body validation answers (packages/shared/src/api.ts validationError), on every server version. */
export const OLDER_SERVER_REFUSAL = "Validation failed";

export interface OlderServerFallback {
  send<B, O, T>(body: B, older: (body: B) => O, post: (body: B | O) => Promise<T>): Promise<T>;
}

export function createOlderServerFallback(): OlderServerFallback {
  let olderServer = false;
  return {
    async send(body, older, post) {
      if (olderServer) return post(older(body));
      try {
        return await post(body);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 400 || error.message !== OLDER_SERVER_REFUSAL) throw error;
        const answer = await post(older(body));
        olderServer = true;
        return answer;
      }
    },
  };
}

/** The page's one fallback: the ack and the wake learn together that the server is older. */
export const printAgentSkew = createOlderServerFallback();

function withoutKeys<T extends object>(body: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key))) as Partial<T>;
}

/** An ack as a server from before Phase 3 takes it: no tokenSlips, no reason. */
export function olderAckBody<T extends object>(body: T): Partial<T> {
  return withoutKeys(body, ["tokenSlips", "reason"]);
}

/** A wake as a server from before Phase 3 takes it: no tokenSlips, no printers, and no capabilities.lanFailover. */
export function olderWakeBody<T extends { capabilities: object }>(body: T): Partial<T> {
  return { ...withoutKeys(body, ["tokenSlips", "printers"]), capabilities: withoutKeys(body.capabilities, ["lanFailover"]) } as Partial<T>;
}
