import type { Metadata } from "next";
import { readPublicMetadata } from "@/lib/public-metadata";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { HTML_RULES_SCRIPT } from "@/lib/html-rules-scope";
import { readLoginBrandName } from "@/lib/login-brand";

// Per request, never prerendered: this page names the cafe (Settings) and nothing else makes it dynamic now that the
// root layout is static, so without this the build would freeze the cafe's name here and read the database at build time.
export const dynamic = "force-dynamic";

// The tab title and icon: the cafe's own, read here (the root layout is static and carries only the generic ones).
export async function generateMetadata(): Promise<Metadata> {
  return readPublicMetadata();
}

// Staff sign-in. The header names the cafe, as the owner's HTML lock/login header does (ruling R39, design 5.6): read
// here on the server with readSettings() (lib/login-brand.ts), the same cached, read-only look-up this page's
// generateMetadata makes for the tab title (lib/public-metadata.ts), so it costs no request and no write. Everything
// else is the client screen, which needs no SessionProvider: signIn works without one, and the dashboard reads the
// new session itself once it opens.
export default async function LoginPage() {
  return (
    <>
      <script>{HTML_RULES_SCRIPT}</script>
      <LoginScreen brandName={await readLoginBrandName()} />
    </>
  );
}
