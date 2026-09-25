import type { AssignedRewardOffer } from "@/components/public/PublicPromoField";
import type { DinerStampCard } from "@/lib/diner-loyalty";

// CB-6C — the shell's two diner-session calls, extracted from
// PublicDinerShell.tsx (file budget). Plain fetch, never TanStack (the diner
// bundle carries no query client). Both swallow network failure into a
// null/void result: the SHELL decides what a failed call means for what is on
// screen (keep the signed-in state on a failed poll; clear local state on a
// failed logout because the server row expires on its own).

const ME_ENDPOINT = "/api/public/diner/me";
const LOGOUT_ENDPOINT = "/api/public/diner/logout";

export interface DinerIdentity {
  name: string;
  mobile: string;
}

export interface DinerMeData {
  diner: DinerIdentity | null;
  stampCard?: DinerStampCard;
  // CB-5D part 2 — codes a milestone claim assigned to this diner. Server-
  // filtered (used/expired never arrive), rendered without re-judging.
  rewards?: AssignedRewardOffer[];
}

// GET /api/public/diner/me — null on a non-success envelope OR a thrown
// fetch, so the caller never has to tell the two apart.
export async function fetchDinerMe(): Promise<DinerMeData | null> {
  try {
    const res = await fetch(ME_ENDPOINT);
    const envelope = (await res.json().catch(() => null)) as
      | { success: true; data: DinerMeData }
      | { success: false; error: string }
      | null;
    return envelope?.success ? envelope.data : null;
  } catch {
    return null;
  }
}

// POST /api/public/diner/logout — fire-and-forget from the caller's point of
// view: a failed call leaves a server row that expires on its own.
export async function postDinerLogout(): Promise<void> {
  try {
    await fetch(LOGOUT_ENDPOINT, { method: "POST" });
  } catch {
    // See the header comment — the local clear is what the diner sees.
  }
}
