import type { Metadata } from "next";
import { readPublicMetadata } from "@/lib/public-metadata";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { HTML_RULES_SCRIPT } from "@/lib/html-rules-scope";
import { readLoginBrandName } from "@/lib/login-brand";

// The tab title and icon: the cafe's own, read here (the root layout is static and carries only the generic ones).
export async function generateMetadata(): Promise<Metadata> {
  return readPublicMetadata();
}

// Staff sign-in. The header names the cafe, as the owner's HTML lock/login header does (ruling R39, design 5.6): read
// here on the server with readSettings(), the same cached, read-only look-up the root layout already makes on /login
// for the tab title (lib/login-brand.ts), so it costs no request and no write. Everything else is the client screen.
export default async function LoginPage() {
  return (
    <>
      <script>{HTML_RULES_SCRIPT}</script>
      <LoginScreen brandName={await readLoginBrandName()} />
    </>
  );
}
