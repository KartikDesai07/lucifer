// The name in the login screen's header (ruling R39, final review I2): the owner's HTML lock/login header names the
// cafe (design 5.6, values 4.2), as the lock cover already does from the session's settings. /login has no session,
// so the page reads it on the server with readSettings(): the same in-memory-cached, read-only look-up
// app/layout.tsx's generateMetadata already makes on every /login for the tab title (no new request, no write).
// Never getSettings(): it creates the document, a write per anonymous visit. Server only (Mongoose): the client
// screen gets the name as a prop.
import { APP_NAME } from "@/lib/constants";
import { readSettings } from "@/lib/settings";

type NameSource = { restaurantName?: string | null } | null;

/** The cafe's name, trimmed; the product's name when the cafe has none yet (as the shell's header and nav). */
export function loginBrandNameOf(settings: NameSource): string {
  return settings?.restaurantName?.trim() || APP_NAME;
}

/** The name for /login. A database that cannot be read shows the product's name: the sign-in screen never breaks
 *  over a header word (generateMetadata's own fallback, app/layout.tsx). */
export async function readLoginBrandName(read: () => Promise<NameSource> = readSettings): Promise<string> {
  try {
    return loginBrandNameOf(await read());
  } catch {
    return APP_NAME;
  }
}
