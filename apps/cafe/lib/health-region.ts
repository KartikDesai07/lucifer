// Which Vercel region this function runs in. Vercel sets VERCEL_REGION on every deployment (e.g. "iad1", "bom1");
// off Vercel (local dev, tests) it is unset, so the answer is null rather than a guess. Pure on purpose: it reads
// the env object it is given, so a test can pass any value without touching process.env.
export function functionRegion(env: Record<string, string | undefined>): string | null {
  const region = env.VERCEL_REGION?.trim();
  return region ? region : null;
}
