// The id of the build this code was made in. next.config.ts computes it once per build and Next inlines it into
// every bundle (client and server) as NEXT_PUBLIC_POS_BUILD; the pulse reports the server's copy, the page compares
// it with its own. "dev" only where nothing inlined it (tests, the dev server).
export const POS_BUILD: string = process.env.NEXT_PUBLIC_POS_BUILD ?? "dev";
