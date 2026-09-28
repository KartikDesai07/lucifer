// Why a new file: the order write routes (settle / create / add-round) now
// START their independent reads together with Promise.allSettled, but must
// still CHECK them in today's order — a missing tab 404s before a settings
// failure 500s, exactly as when the reads were sequential. No existing helper
// unwraps a settled result that way; this one is shared by all three routes.

/** The fulfilled value, or the rejection's own reason re-thrown unchanged. */
export function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "fulfilled") return result.value;
  throw result.reason;
}
