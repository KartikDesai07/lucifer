/**
 * One in-flight run shared by every caller; a success is kept for the
 * process, a failure is dropped so the NEXT call runs again (unlike
 * Model.init(), whose memoized rejection would stand for the instance's life).
 */
export function memoizeUntilFailure(run: () => Promise<void>): () => Promise<void> {
  let memo: Promise<void> | undefined;
  return () => {
    memo ??= Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        memo = undefined;
        throw error;
      });
    return memo;
  };
}
